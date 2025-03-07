import { createClient, LiveTranscriptionEvents, DeepgramClient, ListenLiveClient } from "@deepgram/sdk";
import { SpeechToTextService } from "./stt";
import { logger } from "@/utils";
import { log } from "console";

/**
 * DeepgramStt uses the official @deepgram/sdk v3 to handle real-time transcription.
 */
export class DeepgramStt extends SpeechToTextService {
    private deepgram: DeepgramClient;
    private session?: ListenLiveClient;
    private transcriptionCallbacks: Array<(t: { text: string; isFinal: boolean }) => void> = [];
    private shouldReconnect = true;

    /**
     * If you're constructing with an API key:
     */
    constructor(private apiKey: string) {
        super();
        this.deepgram = createClient(this.apiKey);
    }

    private createSession() {
        this.session = this.deepgram.listen.live({
            model: "nova-3",
            // language: "en-US",
            smart_format: true,
            // encoding: "linear16",
            // channels: 1,
            // sample_rate: 16000,
            interim_results: true,
            utterance_end_ms: 1000,
            vad_events: true,
            endpointing: 200,
        });
        return this.session;
    }

    /**
     * Connect to Deepgram by creating a live session.
     * You can customize your config here (sample_rate, channels, etc.).
     */
    async connect(): Promise<void> {
        if (this.session && this.session.isConnected()) {
            logger.debug("Deepgram session already connected");
            return;
        }
        // Create the session
        // This call does not immediately open the WS, but sets up config & readiness
        this.session = this.createSession();

        // When the session "opens" (WS connected), we add transcript listeners
        this.session.on(LiveTranscriptionEvents.Open, () => {
            logger.debug("Deepgram session opened. Listening for audio data...");
            // For each transcript event from Deepgram
            this.session?.on(LiveTranscriptionEvents.Transcript, (data) => {
                // logger.debug("Received transcript data:", data, data.channel);
                /**
                 * The "data" you get from Deepgram can contain partial and final transcripts.
                 * Typically, final transcripts have something like `is_final === true`.
                 */
                if (!data) return;
                // If you want to check data.is_final:
                const isChunkConfident = Boolean(data.is_final);
                const isFinal = Boolean(data.speech_final);
                const text = data.channel?.alternatives?.[0]?.transcript || "";

                // Fire the STT callbacks so consumers can handle partial or final transcripts
                if (isChunkConfident || isFinal) {
                    // logger.debug("Final text chunk received:", text, isFinal);
                    this.transcriptionCallbacks.forEach((cb) => {
                        cb({ text, isFinal });
                    });
                }
            });
        });

        this.session.on(LiveTranscriptionEvents.Error, (error) => {
            logger.error("Deepgram session error:", error);
        });
        this.session.on(LiveTranscriptionEvents.Close, () => {
            logger.debug("Deepgram session closed");
            if (this.shouldReconnect) {
                logger.debug("Reconnecting to Deepgram...");
                setTimeout(() => {
                    this.connect();
                }, 1000); // Retry after 1 second
            }
        });
    }

    /**
     * For each chunk of audio data, send to Deepgram over the open session.
     */
    async sendAudioChunk(chunk: ArrayBuffer): Promise<void> {
        if (!this.session || !this.session.isConnected()) {
            logger.error("Deepgram session is not connected. Cannot send audio chunk.");

            if (this.shouldReconnect) {
                logger.debug("Reconnecting to Deepgram...");
                await this.connect();
            } else {
                return;
            }
        }
        // logger.debug("Sending audio chunk to Deepgram:", chunk);
        this.session?.send(chunk);
    }

    /**
     * Clean up the session, close the WebSocket.
     */
    async close(): Promise<void> {
        this.shouldReconnect = false; // Stop further reconnection attempts
        if (this.session && this.session.isConnected()) {
            this.session.requestClose();
        }
    }

    /**
     * Manage external transcription callbacks
     */
    onTranscription(cb: (t: { text: string; isFinal: boolean }) => void) {
        this.transcriptionCallbacks.push(cb);
    }

    offTranscription(cb: (t: { text: string; isFinal: boolean }) => void) {
        this.transcriptionCallbacks = this.transcriptionCallbacks.filter((fn) => fn !== cb);
    }
}
