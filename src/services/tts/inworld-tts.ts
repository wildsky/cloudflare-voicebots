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
          audioEncoding: "LINEAR16",
          sampleRateHertz: 16000,
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
          // Decode base64 audio 
          const binaryString = atob(audioContent);
          const pcmBytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            pcmBytes[i] = binaryString.charCodeAt(i);
          }
          
          // Downsample from 16kHz to 8kHz, then convert to μ-law
          const downsampledPcm = this.downsample16to8(pcmBytes);
          const mulawBytes = this.convertLinear16ToMulaw(downsampledPcm);
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
   * Downsample from 16kHz to 8kHz by taking every other sample
   */
  private downsample16to8(pcmBytes: Uint8Array): Uint8Array {
    // Simple downsampling: take every other sample (16kHz -> 8kHz)
    const outputSize = pcmBytes.length / 2;
    const downsampled = new Uint8Array(outputSize);
    
    for (let i = 0; i < outputSize; i += 2) {
      // Take every other 16-bit sample (skip one)
      downsampled[i] = pcmBytes[i * 2];
      downsampled[i + 1] = pcmBytes[i * 2 + 1];
    }
    
    return downsampled;
  }

  /**
   * Convert LINEAR16 PCM to μ-law encoding for Twilio
   * Simple conversion - assumes 8kHz 16-bit signed PCM input
   */
  private convertLinear16ToMulaw(pcmBytes: Uint8Array): Uint8Array {
    // LINEAR16 is 16-bit samples (2 bytes per sample)
    const samples = pcmBytes.length / 2;
    const mulawBytes = new Uint8Array(samples);
    
    for (let i = 0; i < samples; i++) {
      // Read 16-bit signed sample (try both endianness)
      const sampleLE = (pcmBytes[i * 2 + 1] << 8) | pcmBytes[i * 2]; // little-endian
      const sampleBE = (pcmBytes[i * 2] << 8) | pcmBytes[i * 2 + 1]; // big-endian
      
      // Convert unsigned to signed (assuming little-endian first)
      let signedSample = sampleLE > 32767 ? sampleLE - 65536 : sampleLE;
      
      // Convert to μ-law
      let mulaw = this.linearToMulaw(signedSample);
      mulawBytes[i] = mulaw;
    }
    
    return mulawBytes;
  }

  /**
   * Convert a linear 16-bit sample to μ-law
   * Standard ITU-T G.711 μ-law encoding
   */
  private linearToMulaw(sample: number): number {
    const BIAS = 0x84;
    const CLIP = 8159;
    
    // Get the sign and make sample positive
    const sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    
    // Clip the sample
    if (sample > CLIP) sample = CLIP;
    
    // Add bias
    sample += BIAS;
    
    // Find the exponent and mantissa
    let exponent = 7;
    for (let exp = 0; exp < 8; exp++) {
      if (sample <= (0xFF << exp)) {
        exponent = exp;
        break;
      }
    }
    
    const mantissa = (sample >> (exponent + 3)) & 0x0F;
    
    // Create the μ-law byte
    const mulaw = ~(sign | (exponent << 4) | mantissa);
    
    return mulaw & 0xFF;
  }
}
