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
    this.voiceId = config.voiceId || "Elizabeth";
    this.modelId = config.modelId || "inworld-tts-1";
  }

  async connect(): Promise<void> {
    logger.debug("Inworld TTS connected");
    // No persistent connection needed for REST API
  }

  onAudio(callback: (audioChunk: ArrayBuffer) => void) {
    this.callbacks.push(callback);
  }

  offAudio(callback: (audioChunk: ArrayBuffer) => void) {
    this.callbacks = this.callbacks.filter((cb) => cb !== callback);
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
      logger.debug("Sending text to Inworld TTS", {
        text,
        flush,
        voiceId: this.voiceId,
        audioFormat: "MULAW",
        sampleRate: 8000,
      });

      const requestBody = {
        input: {
          text: text,
        },
        voice: {
          name: this.voiceId,
        },
        audioConfig: {
          audioEncoding: "MULAW",
          sampleRateHertz: 8000,
        },
      };
      
      logger.debug("Making Inworld TTS request", {
        url: "https://api.inworld.ai/tts/v1alpha/text:synthesize",
        body: requestBody,
      });

      const response = await fetch(
        "https://api.inworld.ai/tts/v1alpha/text:synthesize",
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      logger.debug("Inworld TTS response status", {
        status: response.status,
        statusText: response.statusText,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Inworld TTS API error", {
          status: response.status,
          error: errorText,
        });
        return;
      }

      // For non-streaming response, read all data at once
      const arrayBuffer = await response.arrayBuffer();
      const responseText = new TextDecoder().decode(arrayBuffer);

      try {
        const data = JSON.parse(responseText);
        
        logger.debug("Inworld TTS response data", {
          hasResult: !!data.result,
          hasAudioContent: !!(data.result?.audioContent || data.audioContent),
          dataKeys: Object.keys(data),
        });

        // Handle the response format from API
        const audioContent = data.result?.audioContent || data.audioContent;
        if (audioContent) {
          // Decode base64 audio (WAV file with μ-law data from Inworld)
          const binaryString = atob(audioContent);
          const wavBytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            wavBytes[i] = binaryString.charCodeAt(i);
          }
          
          // Extract μ-law data from WAV file
          const mulawBytes = this.extractMulawFromWav(wavBytes);
          const audioBuffer = mulawBytes.buffer;

          logger.debug("Received audio chunk from Inworld TTS", {
            size: audioBuffer.byteLength,
            firstBytes: Array.from(new Uint8Array(audioBuffer.slice(0, 10))).map(b => b.toString(16).padStart(2, '0')).join(' '),
            responseFormat: data.audioConfig || "unknown",
            callbackCount: this.callbacks.length,
          });
          this.callbacks.forEach((callback) => callback(audioBuffer));
        } else {
          logger.error("No audio content in Inworld TTS response", {
            response: JSON.stringify(data).substring(0, 500),
          });
        }
        if (data.usage) {
          logger.debug("Inworld TTS usage", data.usage);
        }
      } catch (e) {
        logger.error("Failed to parse Inworld TTS response", {
          error: e.message,
          responseText: responseText.slice(0, 200),
        });
      }
    } catch (error) {
      logger.error("Error sending text to Inworld TTS", {
        error: error.message,
      });
    }
  }

  async close() {
    logger.debug("Closing Inworld TTS connection");
    this.callbacks = [];
  }

  /**
   * Extract μ-law audio data from WAV file
   */
  private extractMulawFromWav(wavBytes: Uint8Array): Uint8Array {
    // WAV file structure:
    // - RIFF header (12 bytes): "RIFF" + filesize + "WAVE"
    // - fmt chunk: describes audio format 
    // - data chunk: contains the actual audio data
    
    try {
      // Find the "data" chunk
      let dataStart = -1;
      for (let i = 0; i < wavBytes.length - 4; i++) {
        if (wavBytes[i] === 0x64 && wavBytes[i+1] === 0x61 && 
            wavBytes[i+2] === 0x74 && wavBytes[i+3] === 0x61) { // "data"
          dataStart = i + 8; // Skip "data" + 4-byte size
          break;
        }
      }
      
      if (dataStart === -1) {
        logger.error("Could not find data chunk in WAV file");
        return new Uint8Array(0);
      }
      
      // Extract audio data (everything after the data chunk header)
      const audioData = wavBytes.slice(dataStart);
      
      logger.debug("Extracted μ-law from WAV", {
        originalSize: wavBytes.length,
        extractedSize: audioData.length,
        dataStartIndex: dataStart
      });
      
      return audioData;
    } catch (error) {
      logger.error("Error extracting μ-law from WAV", error);
      return new Uint8Array(0);
    }
  }
}
