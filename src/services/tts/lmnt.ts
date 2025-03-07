
import { logger } from "@/utils";
import { TextToSpeechService } from "./tts";
import Lmnt from "lmnt-node"; // Assuming lmnt-sdk is the correct package name
import { log } from "console";
import { createWriteStream } from 'fs';

export class LmntTTS extends TextToSpeechService {
    private apiKey: string;
    private client?: Lmnt;
    private session?: Lmnt.Speech.Sessions.SpeechSession;
    
    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }

    async connect() {
        // Initialize the connection to the LMNT API
        logger.debug("Connecting to LMNT TTS API");
        // Gets API Key from environment variable LMNT_API_KEY
        const lmnt = new Lmnt({apiKey: this.apiKey});

        // Prepare an output file to which we write streamed audio. This
        // could alternatively be piped to a media player or another remote client.
        // const audioFile = createWriteStream('stream-output.mp3');

        // Construct the streaming connection with our desired voice
        const speechSession = lmnt.speech.sessions.create({
            voice: 'morgan',
        });

        logger.debug("LMNT TTS session created");

        const writeTask = async () => {
            // Simulate a message stream w/ a 1 second delay between messages.
            logger.debug("Sending messages to LMNT TTS");
            for (let i = 0; i < 5; i++) {
                speechSession.appendText(`Hello, world!`);
                logger.debug(` ** Sent to LMNT -- Message ${i} ** `);
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            // After `finish` is called, the server will close the connection
            // when it has finished synthesizing.
            speechSession.finish();
        };

        const readTask = async () => {
            for await (const message of speechSession) {
            const audioBytes = Buffer.byteLength(message.audio);
            logger.debug(` ** Received from LMNT -- ${audioBytes} bytes ** `);
            // audioFile.write(message.audio);
            }

            speechSession.close();
        };
        await Promise.all([writeTask(), readTask()]);
        // audioFile.close();
    }

    async sendText(text: string, flush?: boolean): Promise<void> {
        if (!this.session) {
            logger.error("LMNT session not initialized. Call connect() first.");
            throw new Error("Session not initialized. Call connect() first.");
        }

        // Send the text to LMNT
        this.session.appendText(text);
        if (flush) {
            this.session.finish();
        }
    }

    async close(): Promise<void> {
        if (this.session) {
            await this.session.close();
        }
    }

    onAudio(cb: (chunk: ArrayBuffer) => void): void {
        if (!this.session) {
            logger.error("LMNT session not initialized. Call connect() first.");
            throw new Error("Session not initialized. Call connect() first.");
        }
        
        logger.debug("Listening for audio chunks from LMNT TTS");

        // for await (const chunk of this.session) {
        //     logger.debug("Received audio chunk from LMNT TTS", { chunk });
        //     cb(chunk.audio);
        // }
        // Start a task in the background to listen for audio chunks
        // this.session is basically an async iterator
        // (async () => {
        //     if (!this.session) {
        //         logger.error("CB: LMNT session not initialized. Call connect() first.");
        //         return;
        //     }
        //     for await (const chunk of this.session) {
        //         logger.debug("Received audio chunk from LMNT TTS", { chunk });
        //         cb(chunk.audio);
        //     }
        // })();
    }

    offAudio(cb: (chunk: ArrayBuffer) => void): void {
        // Implement if needed
        logger.warn("offAudio not implemented for LMNT TTS");
    }

    async halt(): Promise<void> {
        if (this.session) {
            await this.session.close();
        }
    }
}