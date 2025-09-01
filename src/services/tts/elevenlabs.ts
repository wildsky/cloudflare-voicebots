// import WebSocket from 'ws'; // For Node.js environments
import { TextToSpeechService } from "./tts";
import { logger } from "../../utils";

interface ElevenLabsOptions {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  optimizeLatency?: number;
  outputFormat?: string;
}

export class ElevenLabsTTS extends TextToSpeechService {
  public ws: WebSocket | null = null;
  private audioCallbacks: Set<(chunk: ArrayBuffer) => void> = new Set();
  private options: ElevenLabsOptions;
  private isConnected: boolean = false;
  private shouldReconnect: boolean = true;
  private reconnectDelay: number = 1000; // 1 second delay before reconnecting
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(options: ElevenLabsOptions) {
    super();
    this.options = {
      modelId: "eleven_flash_v2_5", // Default to Flash model for lowest latency
      optimizeLatency: 3, // Max optimization for speed
      outputFormat: 'pcm_16000',
      ...options,
    };
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    return new Promise((resolve, reject) => {
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.options.voiceId}/stream-input?optimize_streaming_latency=${this.options.optimizeLatency}&model_id=${this.options.modelId}&output_format=${this.options.outputFormat}`;
      logger.info("Connecting to ElevenLabs WebSocket:", url);
      try {
        this.ws = new WebSocket(url);
      } catch (error) {
        logger.error("Error creating WebSocket:", error);
        reject(error);
        return;
      }

      logger.info("WebSocket created, setting up event handlers");

      this.ws.onopen = () => {
        this.isConnected = true;
        logger.info("WebSocket opened, sending initial message");

        // Send initial configuration for the session
        const initialMessage = {
          text: " ",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
          // generation_config: { chunk_length_schedule: [120, 160, 250, 290] },
          auto_mode: true, // Enable auto mode for automatic handling of generation
          xi_api_key: this.options.apiKey,
        };
        logger.info("Sending initial message:", initialMessage);
        this.ws?.send(JSON.stringify(initialMessage));

        // Start heartbeat to keep the connection alive
        this.startHeartbeat();
        resolve();
      };

      this.ws.onmessage = (event) => {
        console.log("ELEVENLABS: Received WebSocket message", {
          dataType: typeof event.data,
          dataLength: event.data?.length || event.data?.byteLength,
          isString: typeof event.data === "string",
          isArrayBuffer: event.data instanceof ArrayBuffer,
          callbackCount: this.audioCallbacks.size
        });
        
        const data = event.data;
        let audio: string;
        if (typeof data === "string") {
          try {
            const parsedData = JSON.parse(data);
            console.log("ELEVENLABS: Parsed string message", {
              hasAudio: !!parsedData.audio,
              audioLength: parsedData.audio?.length,
              messageKeys: Object.keys(parsedData),
              fullMessage: parsedData
            });
            audio = parsedData.audio;
          } catch (e) {
            logger.error("ELEVENLABS: Error parsing message:", e);
            console.log("ELEVENLABS: Raw unparseable message:", data);
            return;
          }
        } else if (data instanceof ArrayBuffer) {
          // Handle binary data
          console.log("ELEVENLABS: Received binary data", {
            byteLength: data.byteLength
          });
          audio = Buffer.from(data).toString("base64");
        } else {
          logger.error("ELEVENLABS: Unknown data type:", typeof data);
          console.log("ELEVENLABS: Unknown data value:", data);
          return;
        }
        
        if (audio && audio.length > 0) {
          console.log("ELEVENLABS: Processing audio data", {
            base64Length: audio.length,
            callbackCount: this.audioCallbacks.size,
            willProcessCallbacks: this.audioCallbacks.size > 0
          });
          
          const audioBuffer = Buffer.from(audio, "base64");
          
          // Convert PCM to μ-law for Twilio compatibility
          const pcmBytes = new Uint8Array(audioBuffer);
          const downsampledPcm = this.downsample16to8(pcmBytes);
          const mulawBytes = this.convertLinear16ToMulaw(downsampledPcm);
          
          console.log("ELEVENLABS: Calling audio callbacks", {
            callbackCount: this.audioCallbacks.size,
            originalSize: audioBuffer.length,
            downsampledSize: downsampledPcm.length,
            mulawSize: mulawBytes.length
          });
          
          for (const callback of this.audioCallbacks) {
            try {
              callback(mulawBytes.buffer);
              console.log("ELEVENLABS: Audio callback executed successfully");
            } catch (error) {
              console.error("ELEVENLABS: Error in audio callback:", error);
            }
          }
        } else {
          console.log("ELEVENLABS: No audio data in message or audio is empty", {
            hasAudio: !!audio,
            audioLength: audio?.length
          });
        }
      };

      this.ws.onerror = (error) => {
        logger.error("WebSocket error:", error);
        // Attempt reconnection if allowed
        if (this.shouldReconnect) {
          this.reconnect();
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        logger.info("WebSocket closed");
        this.stopHeartbeat();
        // Attempt reconnection if allowed
        if (this.shouldReconnect) {
          this.reconnect();
        }
      };
    });
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.send(JSON.stringify({ text: " " }));
      }
    }, 15000); // Ping every 15 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private reconnect(): void {
    logger.info(`Attempting to reconnect in ${this.reconnectDelay} ms...`);
    setTimeout(() => {
      if (!this.isConnected && this.shouldReconnect) {
        this.connect().catch((error) => {
          logger.error("Reconnection failed:", error);
        });
      }
    }, this.reconnectDelay);
  }

  async sendText(text: string, flush: boolean = false): Promise<void> {
    console.log("ELEVENLABS: sendText called", {
      text,
      flush,
      isConnected: this.isConnected,
      hasWebSocket: !!this.ws,
      textLength: text?.length
    });
    
    // Wait for connection if not yet connected but WebSocket exists
    if (!this.isConnected && this.ws) {
      console.log("ELEVENLABS: WebSocket exists but not connected, waiting for connection...");
      
      // Wait up to 3 seconds for connection
      const maxWaitTime = 3000;
      const startTime = Date.now();
      
      while (!this.isConnected && (Date.now() - startTime < maxWaitTime)) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
      }
      
      console.log("ELEVENLABS: Connection wait finished", {
        isConnected: this.isConnected,
        waitTime: Date.now() - startTime
      });
    }
    
    if (!this.isConnected || !this.ws) {
      console.error("ELEVENLABS: WebSocket not connected after waiting", {
        isConnected: this.isConnected,
        hasWebSocket: !!this.ws
      });
      throw new Error("WebSocket not connected");
    }

    if (flush) {
      // Send the accumulated text and mark it as a complete chunk
      const message = {
        text: text,
        flush: true,
      };
      console.log("ELEVENLABS: Sending flush message:", message);
      logger.info("ELEVENLABS: Sending message:", message);
      this.ws.send(JSON.stringify(message));
    } else {
      const message = { text };
      console.log("ELEVENLABS: Sending non-flush message:", message);
      this.ws.send(JSON.stringify(message));
    }
  }

  async close(): Promise<void> {
    this.shouldReconnect = false; // Stop further reconnection attempts
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
    this.stopHeartbeat();
  }

  onAudio(cb: (chunk: ArrayBuffer) => void): void {
    this.audioCallbacks.add(cb);
  }

  offAudio(cb: (chunk: ArrayBuffer) => void): void {
    this.audioCallbacks.delete(cb);
  }

  async halt(): Promise<void> {
    if (this.isConnected && this.ws) {
      // Send a message to interrupt current synthesis
      const interruptMessage = {
        text: "",
        interrupt: true,
      };
      this.ws.send(JSON.stringify(interruptMessage));
    }
  }

  /**
   * Downsample from 16kHz to 8kHz by taking every other sample
   */
  private downsample16to8(pcmBytes: Uint8Array): Uint8Array {
    const outputSize = pcmBytes.length / 2;
    const downsampled = new Uint8Array(outputSize);
    
    for (let i = 0; i < outputSize; i += 2) {
      downsampled[i] = pcmBytes[i * 2];
      downsampled[i + 1] = pcmBytes[i * 2 + 1];
    }
    
    return downsampled;
  }

  /**
   * Convert LINEAR16 PCM to μ-law encoding for Twilio
   */
  private convertLinear16ToMulaw(pcmBytes: Uint8Array): Uint8Array {
    const samples = pcmBytes.length / 2;
    const mulawBytes = new Uint8Array(samples);
    
    for (let i = 0; i < samples; i++) {
      const sampleLE = (pcmBytes[i * 2 + 1] << 8) | pcmBytes[i * 2];
      let signedSample = sampleLE > 32767 ? sampleLE - 65536 : sampleLE;
      let mulaw = this.linearToMulaw(signedSample);
      mulawBytes[i] = mulaw;
    }
    
    return mulawBytes;
  }

  /**
   * Convert a linear 16-bit sample to μ-law
   */
  private linearToMulaw(sample: number): number {
    const BIAS = 0x84;
    const CLIP = 8159;
    
    const sign = (sample >> 8) & 0x80;
    if (sign !== 0) sample = -sample;
    
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;
    
    let exponent = 7;
    for (let exp = 0; exp < 8; exp++) {
      if (sample <= (0xFF << exp)) {
        exponent = exp;
        break;
      }
    }
    
    const mantissa = (sample >> (exponent + 3)) & 0x0F;
    const mulaw = ~(sign | (exponent << 4) | mantissa);
    
    return mulaw & 0xFF;
  }
}
