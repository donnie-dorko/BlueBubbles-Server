import { RouterContext } from "koa-router";
import { Next } from "koa";

import { Server } from "@server";
import { FileSystem } from "@server/fileSystem";
import { getChatResponse } from "@server/databases/imessage/entity/Chat";
import { getMessageResponse } from "@server/databases/imessage/entity/Message";
import { DBMessageParams } from "@server/databases/imessage/types";
import { isEmpty, isNotEmpty, safeTrim } from "@server/helpers/utils";
import { ChatInterface } from "@server/api/v1/interfaces/chatInterface";

import { FileStream, Success } from "../responses/success";
import { IMessageError, NotFound } from "../responses/errors";

export class ChatRouter {
    static async count(ctx: RouterContext, _: Next) {
        const chats = await Server().iMessageRepo.getChats();
        const serviceCounts: { [key: string]: number } = {};
        for (const chat of chats) {
            if (!Object.keys(serviceCounts).includes(chat.serviceName)) {
                serviceCounts[chat.serviceName] = 0;
            }

            serviceCounts[chat.serviceName] += 1;
        }

        const data = { total: chats.length, breakdown: serviceCounts };
        return new Success(ctx, { data }).send();
    }

    static async find(ctx: RouterContext, _: Next) {
        const withQuery = ((ctx.request.query.with ?? "") as string)
            .toLowerCase()
            .split(",")
            .map(e => safeTrim(e));
        const withParticipants = withQuery.includes("participants");
        const withLastMessage = withQuery.includes("lastmessage");

        const chats = await Server().iMessageRepo.getChats({
            chatGuid: ctx.params.guid,
            withParticipants
        });

        if (isEmpty(chats)) throw new NotFound({ error: "Chat does not exist!" });

        const res = await getChatResponse(chats[0]);
        if (withLastMessage) {
            res.lastMessage = await getMessageResponse(await Server().iMessageRepo.getChatLastMessage(ctx.params.guid));
        }

        return new Success(ctx, { data: res }).send();
    }

    static async getMessages(ctx: RouterContext, _: Next) {
        const withQuery = ((ctx.request.query.with ?? "") as string)
            .toLowerCase()
            .split(",")
            .map(e => safeTrim(e));
        const withAttachments = withQuery.includes("attachment") || withQuery.includes("attachments");
        const withHandle = withQuery.includes("handle") || withQuery.includes("handles");
        const { sort, before, after, offset, limit } = ctx?.request.query ?? {};

        const chats = await Server().iMessageRepo.getChats({
            chatGuid: ctx.params.guid,
            withParticipants: false
        });

        if (isEmpty(chats)) throw new NotFound({ error: "Chat does not exist!" });

        const opts: DBMessageParams = {
            chatGuid: ctx.params.guid,
            withAttachments,
            withHandle,
            offset: offset ? Number.parseInt(offset as string, 10) : 0,
            limit: limit ? Number.parseInt(limit as string, 10) : 100,
            sort: sort as "ASC" | "DESC",
            before: before ? Number.parseInt(before as string, 10) : null,
            after: after ? Number.parseInt(after as string, 10) : null
        };

        // Fetch the info for the message by GUID
        const messages = await Server().iMessageRepo.getMessages(opts);
        const results = [];
        for (const msg of messages ?? []) {
            results.push(await getMessageResponse(msg));
        }

        return new Success(ctx, { data: results }).send();
    }

    static async query(ctx: RouterContext, _: Next) {
        const { body } = ctx.request;

        // Pull out the filters
        const withQuery = (body?.with ?? [])
            .filter((e: any) => typeof e === "string")
            .map((e: string) => safeTrim(e.toLowerCase()));
        const withParticipants = withQuery.includes("participants");
        const withLastMessage = withQuery.includes("lastmessage");
        const withArchived = withQuery.includes("archived");
        const guid = body?.guid;
        const { sort, offset, limit } = body;

        // Fetch the chats
        const results = await ChatInterface.get({
            guid,
            withParticipants,
            withLastMessage,
            withArchived,
            offset: offset ? Number.parseInt(offset, 10) : 0,
            limit: limit ? Number.parseInt(limit, 10) : 1000,
            sort
        });

        // Build metadata to return
        const metadata = {
            total: await Server().iMessageRepo.getChatCount(),
            offset,
            limit
        };

        return new Success(ctx, { data: results, metadata }).send();
    }

    static async update(ctx: RouterContext, _: Next): Promise<void> {
        const { body } = ctx.request;
        const { guid } = ctx.params;
        const displayName = body?.displayName;

        const chats = await Server().iMessageRepo.getChats({ chatGuid: guid, withParticipants: true });
        if (isEmpty(chats)) throw new NotFound({ error: "Chat does not exist!" });

        let chat = chats[0];
        const updated = [];
        const errors: string[] = [];
        if (displayName) {
            if (chat.participants.length <= 1) {
                throw new IMessageError({ message: "Cannot rename a non-group chat!", error: "Chat is not a group" });
            }

            try {
                chat = await ChatInterface.setDisplayName(chat, displayName);
                updated.push("displayName");
            } catch (ex: any) {
                errors.push(ex?.message ?? ex);
            }
        }

        if (isNotEmpty(errors)) {
            throw new IMessageError({ message: "Chat update executed with errors!", error: errors.join(", ") });
        }

        const data = await getChatResponse(chat);
        if (isEmpty(updated)) {
            return new Success(ctx, { data, message: "Chat not updated! No update information provided!" }).send();
        }

        return new Success(ctx, {
            message: `Successfully updated the following fields: ${updated.join(", ")}`,
            data
        }).send();
    }

    static async create(ctx: RouterContext, _: Next): Promise<void> {
        const { body } = ctx.request;
        const addresses = body?.addresses;
        const message = body?.message;
        const method = body?.method;
        const service = body?.service;
        const tempGuid = body?.tempGuid;

        const chat = await ChatInterface.create({ addresses, message, method, service, tempGuid });
        if (!chat) throw new IMessageError({ error: "Failed to create chat!" });

        // Convert the data to an API response
        const data = await getChatResponse(chat);

        // Inject the tempGuid back into the messages (if available)
        if (isNotEmpty(tempGuid)) {
            for (const i of data.messages ?? []) {
                i.tempGuid = tempGuid;
            }
        }

        return new Success(ctx, { data, message: "Successfully created chat!" }).send();
    }

    static async addParticipant(ctx: RouterContext, next: Next): Promise<void> {
        await ChatRouter.toggleParticipant(ctx, next, "add");
    }

    static async markRead(ctx: RouterContext, _: Next): Promise<void> {
        const { guid } = ctx.params;
        await Server().privateApiHelper.markChatRead(guid);
        await Server().emitMessage("chat-read-status-changed", {
            chatGuid: guid,
            read: true
        });

        return new Success(ctx, { message: "Successfully marked chat as read!" }).send();
    }

    static async removeParticipant(ctx: RouterContext, next: Next): Promise<void> {
        await ChatRouter.toggleParticipant(ctx, next, "remove");
    }

    static async toggleParticipant(ctx: RouterContext, _: Next, action: "add" | "remove"): Promise<void> {
        const { body } = ctx.request;
        const { guid } = ctx.params;
        const address = body?.address;

        const chats = await Server().iMessageRepo.getChats({ chatGuid: guid, withParticipants: true });
        if (isEmpty(chats)) throw new NotFound({ error: "Chat does not exist!" });

        // Add the participant to the chat
        let chat = chats[0];
        chat = await ChatInterface.toggleParticipant(chat, address, action);

        return new Success(ctx, { data: await getChatResponse(chat) }).send();
    }

    static async getGroupIcon(ctx: RouterContext, _: Next): Promise<void> {
        const { guid } = ctx.params;

        const chats = await Server().iMessageRepo.getChats({ chatGuid: guid, withParticipants: false });
        if (isEmpty(chats)) throw new NotFound({ error: "Chat does not exist!" });

        const chat = chats[0];
        const iconPath = await Server().iMessageRepo.getGroupIconPath(chat.guid);
        if (!iconPath) {
            throw new NotFound({
                message: "The requested resource was not found",
                error: "Unable to find icon for the selected chat"
            });
        }

        return new FileStream(ctx, FileSystem.getRealPath(iconPath), "image/jfif").send();
    }

    static async deleteChat(ctx: RouterContext, _: Next): Promise<void> {
        const { guid } = ctx.params;
        await ChatInterface.delete({ guid });
        return new Success(ctx, { message: `Successfully deleted chat!` }).send();
    }
}