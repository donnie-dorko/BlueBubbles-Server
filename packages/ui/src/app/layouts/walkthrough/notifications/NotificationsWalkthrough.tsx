import React, { useRef, useState, useEffect } from 'react';
import {
    Box,
    Text,
    SlideFade,
    Alert,
    AlertIcon,
    Link,
    SimpleGrid,
    useBoolean,
    Stack,
    Button,
    Tabs,
    Tab,
    TabList,
    TabPanels,
    TabPanel,
    Image
} from '@chakra-ui/react';
import { LogsTable } from '../../../components/tables/LogsTable';
import { DropZone } from '../../../components/DropZone';
import { useAppDispatch, useAppSelector } from '../../../hooks';
import { ErrorDialog, ErrorItem } from '../../../components/modals/ErrorDialog';
import { readFile } from '../../../utils/GenericUtils';
import { getOauthUrl } from '../../../utils/IpcUtils';
import { isValidClientConfig, isValidFirebaseUrl, isValidServerConfig } from '../../../utils/FcmUtils';
import { saveFcmClient, saveFcmServer } from '../../../actions/FcmActions';
import { setConfig } from '../../../slices/ConfigSlice';
import GoogleIcon from '../../../../images/walkthrough/google-icon.png';


let dragCounter = 0;

export const NotificationsWalkthrough = (): JSX.Element => {
    const dispatch = useAppDispatch();
    const alertRef = useRef(null);

    const serverLoaded = (useAppSelector(state => state.config.fcm_server !== null) ?? false);
    const clientLoaded = (useAppSelector(state => state.config.fcm_client !== null) ?? false);
    const [isDragging, setDragging] = useBoolean();
    let logs = useAppSelector(state => state.logStore.logs);
    const [oauthUrl, setOauthUrl] = useState('');
    const [errors, setErrors] = useState([] as Array<ErrorItem>);
    const alertOpen = errors.length > 0;

    useEffect(() => {
        getOauthUrl().then(url => setOauthUrl(url));
    }, []);

    logs = logs.filter(log => log.message.startsWith('[GCP]'));

    const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();

        dragCounter = 0;
        setDragging.off();
        
        // I'm not sure why, but we need to copy the file data _before_ we read it using the file reader.
        // If we do not, the data transfer file list gets set to empty after reading the first file.
        const listCopy: Array<Blob> = [];
        for (let i = 0; i < e.dataTransfer.files.length; i++) {
            listCopy.push(e.dataTransfer.files.item(i) as Blob);
        }

        // Actually read the files
        const errors: Array<ErrorItem> = [];
        for (let i = 0; i < listCopy.length; i++) {
            try {
                const fileStr = await readFile(listCopy[i]);
                const validClient = isValidClientConfig(fileStr);
                const validServer = isValidServerConfig(fileStr);
                const jsonData = JSON.parse(fileStr);

                if (validClient) {
                    const test = isValidFirebaseUrl(jsonData);
                    if (test) {
                        await saveFcmClient(jsonData);
                        dispatch(setConfig({ name: 'fcm_client', 'value': jsonData }));
                    } else {
                        throw new Error(
                            'Your Firebase setup does not have a real-time database enabled. ' +
                            'Please enable the real-time database in your Firebase Console.'
                        );
                    }
                } else if (validServer) {
                    await saveFcmServer(jsonData);
                    dispatch(setConfig({ name: 'fcm_server', 'value': jsonData }));
                } else {
                    throw new Error('Invalid Google FCM File!');
                }
            } catch (ex: any) {
                errors.push({ id: String(i), message: ex?.message ?? String(ex) });
            }
        }

        if (errors.length > 0) {
            setErrors(errors);
        }
    };

    const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (dragCounter === 0) {
            setDragging.on();
        }

        dragCounter += 1;
    };

    const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.stopPropagation();
        e.preventDefault();
    };

    const onDragLeave = () => {
        dragCounter -= 1;
        if (dragCounter === 0) {
            setDragging.off();
        }
    };

    const closeAlert = () => {
        setErrors([]);
    };

    return (
        <SlideFade in={true} offsetY='150px'>
            <Box
                px={5}
                onDragEnter={(e) => onDragEnter(e)}
                onDragLeave={() => onDragLeave()}
                onDragOver={(e) => onDragOver(e)}
                onDrop={(e) => onDrop(e)}    
            >
                <Text fontSize='4xl'>Notifications &amp; Firebase</Text>
                <Text fontSize='md' mt={5}>
                    BlueBubbles utilizes Google FCM (Firebase Cloud Messaging) to deliver notifications to your devices.
                    We do this so the client do not need to hold a connection to the server at all times. As a result,
                    BlueBubbles can deliver notifications even when the app is running in the background. It also means
                    BlueBubbles will use less battery when running in the background.
                </Text>
                <Alert status='info' mt={5}>
                    <AlertIcon />
                    If you do not complete this setup, you will not receive notifications!
                </Alert>
                <Box mt={3} />
                <Tabs>
                    <TabList>
                        <Tab>Google Login</Tab>
                        <Tab>Manual Setup</Tab>
                    </TabList>
                    <TabPanels>
                        <TabPanel>
                            <Text fontSize='md'>
                                Using the button below, you can authorize BlueBubbles to manage your Google Cloud Platform account temporarily.
                                This will allow BlueBubbles to automatically create your Firebase project and setup the necessary configurations.
                            </Text>
                            <Link
                                href={oauthUrl}
                                target="_blank"
                                _hover={{ textDecoration: 'none' }}
                            >
                                <Button pl={10} pr={10} mt={3} leftIcon={<Image src={GoogleIcon} mr={1} width={5} />} variant='outline'>
                                    Continue with Google
                                </Button>
                            </Link>
                            <Box mt={3} />
                            <LogsTable logs={logs} caption={'Once authenticated, you can monitor the project setup process via these logs.'} />
                        </TabPanel>
                        <TabPanel>
                            <Text fontSize='md' mt={5}>
                                The manual setup with Google FCM is optional and can allow for a more flexible setup for complex deployments.
                                For instance, you may want to do a manual setup if you have multiple iMessage accounts and want to use
                                the same Google account for notifications. Follow the step by step
                                instructions here: <Link
                                    as='span'
                                    href='https://docs.bluebubbles.app/server/installation-guides/manual-setup'
                                    color='brand.primary'
                                    target='_blank'>Manual Setup Docs</Link>
                            </Text>
                            <Text fontSize='3xl' mt={3}>Firebase Links</Text>
                            <Stack direction='row' mt={3}>
                                <Button
                                    size='xs'
                                >
                                    <Link
                                        href="https://console.firebase.google.com/u/0/project/_/database"
                                        target="_blank"
                                    >
                                        Enable Realtime Database
                                    </Link>
                                </Button>
                                <Button
                                    size='xs'
                                >
                                    <Link
                                        href="https://console.firebase.google.com/u/0/project/_/settings/general"
                                        target="_blank"
                                    >
                                        Google Services JSON Download
                                    </Link>
                                </Button>
                                <Button
                                    size='xs'
                                >
                                    <Link
                                        href="https://console.firebase.google.com/u/0/project/_/settings/serviceaccounts/adminsdk"
                                        target="_blank"
                                    >
                                        Admin SDK JSON Download
                                    </Link>
                                </Button>
                            </Stack>

                            <Text fontSize='3xl' mt={3}>Firebase Configurations</Text>
                            <SimpleGrid columns={2} spacing={5} mt={5}>
                                <DropZone
                                    text="Drag n' Drop Google Services JSON"
                                    loadedText="Google Services JSON Successfully Loaded!"
                                    isDragging={isDragging}
                                    isLoaded={clientLoaded}
                                />
                                <DropZone
                                    text="Drag n' Drop Admin SDK JSON"
                                    loadedText="Admin SDK JSON Successfully Loaded!"
                                    isDragging={isDragging}
                                    isLoaded={serverLoaded}
                                />
                            </SimpleGrid>
                        </TabPanel>
                    </TabPanels>
                </Tabs>
            </Box>

            <ErrorDialog
                errors={errors}
                modalRef={alertRef}
                onClose={() => closeAlert()}
                isOpen={alertOpen}
            />
        </SlideFade>
    );
};