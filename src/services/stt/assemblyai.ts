import { SpeechToTextService } from "./stt";
import { logger } from "@/utils";

/**
 * AssemblyAI STT service for real-time transcription
 */
export class AssemblyAIStt extends SpeechToTextService {
  private ws?: WebSocket;
  private apiKey: string;
  private transcriptionCallbacks: Array<
    (t: { text: string; isFinal: boolean }) => void
  > = [];
  private shouldReconnect = false;
  private currentToken?: string;
  private tokenExpiresAt?: Date;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;


  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
    console.log("🔑 ASSEMBLYAI CONSTRUCTOR:", {
      apiKeyProvided: !!apiKey,
      apiKeyLength: apiKey?.length || 0,
      apiKeyPreview: apiKey?.substring(0, 8) + "..." || "undefined"
    });
  }

  /**
   * Check if the current token is still valid
   */
  private isTokenValid(): boolean {
    if (!this.currentToken || !this.tokenExpiresAt) {
      return false;
    }
    
    // Check if token expires in less than 30 seconds (preemptive renewal)
    const now = new Date();
    const thirtySecondsFromNow = new Date(now.getTime() + 30000);
    
    return this.tokenExpiresAt > thirtySecondsFromNow;
  }

  /**
   * Generate a temporary token for WebSocket authentication
   */
  private async generateTemporaryToken(): Promise<string> {
    // If we have a valid token, reuse it
    if (this.isTokenValid() && this.currentToken) {
      console.log("♻️ ASSEMBLYAI: Reusing existing valid token");
      return this.currentToken;
    }

    console.log("🔑 ASSEMBLYAI: Generating new temporary token...");
    
    try {
      // Use the v3 Universal Streaming token endpoint
      const response = await fetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=600", {
        method: "GET",
        headers: {
          "Authorization": this.apiKey
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("💥 ASSEMBLYAI: Token generation failed:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText
        });
        throw new Error(`Failed to generate AssemblyAI token: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      // Store token and calculate expiry time (9.5 minutes to be safe)
      this.currentToken = data.token;
      this.tokenExpiresAt = new Date(Date.now() + (9.5 * 60 * 1000));
      
      console.log("✅ ASSEMBLYAI: Temporary token generated successfully", {
        expiresAt: this.tokenExpiresAt.toISOString(),
        validForMinutes: 9.5
      });
      
      return data.token;
    } catch (error) {
      console.error("💥 ASSEMBLYAI: Error generating temporary token:", error);
      throw error;
    }
  }

  /**
   * Connect to AssemblyAI WebSocket for real-time transcription
   */
  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      logger.debug("AssemblyAI session already connected");
      return;
    }

    logger.debug("Connecting to AssemblyAI STT service...");

    // Generate temporary token for WebSocket authentication
    let tempToken: string;
    try {
      tempToken = await this.generateTemporaryToken();
    } catch (error) {
      console.error("💥 ASSEMBLYAI: Failed to generate token, cannot connect");
      throw error;
    }

    // Use the temporary token as a query parameter (Cloudflare Workers compatible)
    const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=8000&token=${tempToken}`;
    
    console.log("🔧 ASSEMBLYAI SESSION CREATING:", {
      wsUrl: wsUrl.replace(tempToken, "***TEMP_TOKEN***"),
      hasToken: !!tempToken,
      sessionCreated: new Date().toISOString()
    });

    // Create WebSocket connection directly
    console.log("🔄 ASSEMBLYAI: Creating direct WebSocket connection...");
    
    try {
      this.ws = new WebSocket(wsUrl);
      console.log("🔄 ASSEMBLYAI: WebSocket object created successfully");
    } catch (error) {
      console.error("💥 ASSEMBLYAI: Failed to create WebSocket:", error);
      throw error;
    }
    
    this.ws.onopen = () => {
      console.log("🎉 ASSEMBLYAI SESSION OPENED SUCCESSFULLY!");
      logger.debug("AssemblyAI session opened. Listening for audio data...");
      
      // Reset reconnection attempts on successful connection
      this.reconnectAttempts = 0;
      this.shouldReconnect = true; // Enable auto-reconnect for future disconnections
    };

    this.ws.onerror = (error) => {
      console.log("💥 ASSEMBLYAI SESSION ERROR:", error);
      logger.error("AssemblyAI session error:", error);
    };

    this.ws.onclose = (event) => {
      console.log("💔 ASSEMBLYAI SESSION CLOSED:", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        timestamp: new Date().toISOString()
      });
      logger.debug("AssemblyAI session closed");
      
      // Handle different close codes
      const isAuthError = event.code === 1008 || event.reason?.includes("Unauthorized");
      const isTokenExpired = event.reason?.includes("expired") || event.reason?.includes("invalid");
      
      if (isAuthError || isTokenExpired) {
        console.log("🔄 ASSEMBLYAI: Token expired or invalid, clearing for regeneration");
        this.currentToken = undefined;
        this.tokenExpiresAt = undefined;
      }
      
      if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const backoffDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000);
        
        console.log(`🔄 ASSEMBLYAI: Reconnecting (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${backoffDelay}ms...`);
        
        setTimeout(() => {
          this.connect().catch(error => {
            console.error("💥 ASSEMBLYAI: Reconnection failed:", error);
          });
        }, backoffDelay);
      } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error("💥 ASSEMBLYAI: Max reconnection attempts reached, giving up");
        this.shouldReconnect = false;
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("🎤 ASSEMBLYAI MESSAGE EVENT:", {
          hasData: !!data,
          messageType: data.type,
          dataKeys: data ? Object.keys(data) : []
        });

        if (data.type === "Begin") {
          console.log("🎤 ASSEMBLYAI SESSION BEGAN:", {
            sessionId: data.id,
            expiresAt: data.expires_at
          });
        } else if (data.type === "Turn") {
          const text = data.transcript || "";
          const isFinal = data.turn_is_formatted || false;

          console.log("🎤 ASSEMBLYAI TRANSCRIPT DETAILS:", {
            text,
            textLength: text.length,
            isFinal,
            willFireCallbacks: text.length > 0,
            callbackCount: this.transcriptionCallbacks.length
          });

          // Fire callbacks for any non-empty transcription
          if (text.length > 0) {
            console.log("🎤 ASSEMBLYAI FIRING CALLBACKS:", { 
              text, 
              isFinal, 
              callbackCount: this.transcriptionCallbacks.length 
            });
            this.transcriptionCallbacks.forEach((cb) => {
              cb({ text, isFinal });
            });
          }
        } else if (data.type === "Termination") {
          console.log("🎤 ASSEMBLYAI SESSION TERMINATED:", {
            audioDuration: data.audio_duration_seconds,
            sessionDuration: data.session_duration_seconds
          });
        }
      } catch (error) {
        console.error("💥 ASSEMBLYAI MESSAGE ERROR:", error);
        logger.error("AssemblyAI message error:", error);
      }
    };
  }

  /**
   * Send audio chunk to AssemblyAI
   */
  async sendAudioChunk(chunk: ArrayBuffer): Promise<void> {
    if (!this.ws) {
      console.error("💥 ASSEMBLYAI: No WebSocket connection exists");
      if (this.shouldReconnect) {
        logger.debug("Reconnecting to AssemblyAI...");
        await this.connect();
        // Try again after reconnection
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.sendAudioChunk(chunk);
        }
      }
      return;
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      console.error("💥 ASSEMBLYAI: WebSocket not in OPEN state:", {
        currentState: this.ws.readyState,
        CONNECTING: WebSocket.CONNECTING,
        OPEN: WebSocket.OPEN,
        CLOSING: WebSocket.CLOSING,
        CLOSED: WebSocket.CLOSED
      });
      
      if (this.shouldReconnect) {
        logger.debug("Reconnecting to AssemblyAI...");
        await this.connect();
        return;
      } else {
        return;
      }
    }

    try {
      // AssemblyAI expects raw PCM audio data
      // Convert ArrayBuffer to Buffer and send
      const buffer = new Uint8Array(chunk);
      console.log("🎤 ASSEMBLYAI: Sending audio chunk", {
        bufferSize: buffer.byteLength,
        wsState: this.ws.readyState
      });
      
      this.ws.send(buffer);
    } catch (error) {
      console.error("💥 ASSEMBLYAI: Error sending audio chunk:", error);
      // Don't reconnect on send errors to avoid infinite loops
    }
  }

  /**
   * Close the AssemblyAI WebSocket connection
   */
  async close(): Promise<void> {
    this.shouldReconnect = false;
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Send termination message
      try {
        const terminateMessage = { type: "Terminate" };
        console.log("🔄 ASSEMBLYAI SENDING TERMINATE MESSAGE:", terminateMessage);
        this.ws.send(JSON.stringify(terminateMessage));
      } catch (error) {
        console.error("Error sending AssemblyAI terminate message:", error);
      }
      
      this.ws.close();
    }
  }

  /**
   * Add transcription callback
   */
  onTranscription(cb: (t: { text: string; isFinal: boolean }) => void) {
    this.transcriptionCallbacks.push(cb);
  }

  /**
   * Remove transcription callback
   */
  offTranscription(cb: (t: { text: string; isFinal: boolean }) => void) {
    this.transcriptionCallbacks = this.transcriptionCallbacks.filter(
      (fn) => fn !== cb
    );
  }
}