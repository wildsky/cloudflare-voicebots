import { logger } from "@/utils";
import { TextToSpeechService } from "./tts";

export interface InworldTTSConfig {
    apiKey: string;
    voiceId?: string;
    modelId?: string;
}

export class InworldTTS extends TextToSpeechService {
    private apiKey: string;
    private voiceId: string;
    private modelId: string;
    private callbacks: Array<(audioChunk: ArrayBuffer) => void> = [];

    constructor(config: InworldTTSConfig) {
        super();
        this.apiKey = config.apiKey;
        this.voiceId = config.voiceId || 'Hades';
        this.modelId = config.modelId || 'inworld-tts-1';
    }

    async connect(): Promise<void> {
        logger.debug("Inworld TTS connected");
        // No persistent connection needed for REST API
    }

    onAudio(callback: (audioChunk: ArrayBuffer) => void) {
        this.callbacks.push(callback);
    }

    offAudio(callback: (audioChunk: ArrayBuffer) => void) {
        this.callbacks = this.callbacks.filter(cb => cb !== callback);
    }

    async halt(): Promise<void> {
        logger.debug("Halting Inworld TTS");
        // No persistent connection to halt
    }

    async sendText(text: string, flush: boolean = false) {
        if (!text.trim() || text.trim().length === 1) {
            // Skip empty text or single characters (punctuation only)
            return;
        }

        try {
            logger.debug("Sending text to Inworld TTS", { text, flush, voiceId: this.voiceId });

            const response = await fetch('https://api.inworld.ai/tts/v1alpha/text:synthesize', {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    input: {
                        text: text
                    },
                    voice: {
                        name: this.voiceId
                    },
                    audioConfig: {
                        audioEncoding: "LINEAR16"
                    }
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error("Inworld TTS API error", { status: response.status, error: errorText });
                return;
            }

            // For non-streaming response, read all data at once
            const arrayBuffer = await response.arrayBuffer();
            const responseText = new TextDecoder().decode(arrayBuffer);
            
            try {
                const data = JSON.parse(responseText);
                
                // Handle the response format from API
                const audioContent = data.result?.audioContent || data.audioContent;
                if (audioContent) {
                    // Decode base64 audio and send to callbacks
                    const binaryString = atob(audioContent);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    const audioBuffer = bytes.buffer;
                    
                    logger.debug("Received audio chunk from Inworld TTS", { size: audioBuffer.byteLength });
                    this.callbacks.forEach(callback => callback(audioBuffer));
                }
                if (data.usage) {
                    logger.debug("Inworld TTS usage", data.usage);
                }
            } catch (e) {
                logger.error("Failed to parse Inworld TTS response", { error: e.message, responseText: responseText.slice(0, 200) });
            }
        } catch (error) {
            logger.error("Error sending text to Inworld TTS", { error: error.message });
        }
    }

    async close() {
        logger.debug("Closing Inworld TTS connection");
        this.callbacks = [];
    }
}