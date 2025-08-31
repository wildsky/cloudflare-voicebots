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
      // outputFormat: 'pcm_16000',
      ...options,
    };
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    return new Promise((resolve, reject) => {
      const url = `wss://api.elevenlabs.io/v1/text-to-speech/${this.options.voiceId}/stream-input?optimize_streaming_latency=${this.options.optimizeLatency}&model_id=${this.options.modelId}`;
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
        const data = event.data;
        let audio: string;
        if (typeof data === "string") {
          try {
            const parsedData = JSON.parse(data);
            audio = parsedData.audio;
          } catch (e) {
            logger.error("Error parsing message:", e);
            return;
          }
        } else if (data instanceof ArrayBuffer) {
          // Handle binary data
          audio = Buffer.from(data).toString("base64");
        } else {
          logger.error("Unknown data type:", typeof data);
          return;
        }
        if (audio) {
          const audioBuffer = Buffer.from(audio, "base64");
          for (const callback of this.audioCallbacks) {
            callback(audioBuffer.buffer);
          }
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
    if (!this.isConnected || !this.ws) {
      throw new Error("WebSocket not connected");
    }

    if (flush) {
      // Send the accumulated text and mark it as a complete chunk
      const message = {
        text: text,
        flush: true,
      };
      logger.info("Sending message:", message);
      this.ws.send(JSON.stringify(message));
    } else {
      this.ws.send(JSON.stringify({ text }));
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
}
