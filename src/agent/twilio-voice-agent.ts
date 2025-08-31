import { VoiceAgent } from "./voice-agent";
import {
  TwilioService,
  type TwilioStreamData,
  type TwilioCallData,
} from "../services/twilio/twilio-service";
import { logger } from "../utils";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import type { Env } from "../shared/env";

export class TwilioVoiceAgent extends VoiceAgent {
  private twilioService!: TwilioService;
  private currentStreamSid?: string;
  private currentCallSid?: string;
  private currentCallerId?: string;
  private twilioConnection?: Connection;

  async onStart() {
    // Initialize Twilio service after env is available
    this.twilioService = new TwilioService(this.env);
    
    // Call parent onStart to initialize services
    await super.onStart();

    // Override TTS audio callback for Twilio support
    if (this.tts) {
      this.tts.onAudio((audioChunk) => {
        logger.debug("TTS audio callback triggered", {
          hasStreamSid: !!this.currentStreamSid,
          hasTwilioConnection: !!this.twilioConnection,
          audioSize: audioChunk.byteLength || audioChunk.length
        });
        
        if (this.currentStreamSid && this.twilioConnection) {
          // Send to Twilio instead of browser
          this.sendAudioToTwilio(audioChunk);
        } else {
          // Fall back to browser audio (original behavior)
          if (this.connection) {
            const base64Audio = btoa(
              String.fromCharCode(...new Uint8Array(audioChunk))
            );

            this.connection.send(
              JSON.stringify({
                type: "audio-chunk",
                data: base64Audio,
              })
            );
          }
        }
      });
    }
  }

  async onRequest(request: Request) {
    logger.debug("TwilioVoiceAgent received HTTP request", {
      url: request.url,
      method: request.method,
    });

    const url = new URL(request.url);

    // Handle Twilio webhook endpoints
    if (url.pathname.endsWith("/twilio/voice")) {
      return this.handleVoiceWebhook(request);
    } else if (url.pathname.endsWith("/twilio/status")) {
      return this.handleStatusWebhook(request);
    }

    // Delegate to parent for other endpoints
    return super.onRequest(request);
  }

  /**
   * Handle incoming Twilio voice webhook (when call is initiated)
   */
  private async handleVoiceWebhook(request: Request): Promise<Response> {
    try {
      const formData = await request.formData();
      const callData: TwilioCallData = {
        CallSid: formData.get("CallSid") as string,
        From: formData.get("From") as string,
        To: formData.get("To") as string,
        CallStatus: formData.get("CallStatus") as string,
        Direction: formData.get("Direction") as string,
        AccountSid: formData.get("AccountSid") as string,
      };

      logger.info("Incoming Twilio call", callData);

      // Store call information
      this.currentCallSid = callData.CallSid;
      this.currentCallerId = callData.From;

      // Look up user by phone number
      const phoneNumber = this.twilioService.extractPhoneNumber(callData.From);
      logger.debug("Extracted phone number", {
        phoneNumber,
        originalFrom: callData.From,
      });

      // Generate WebSocket URL for media streaming
      const wsUrl = this.generateWebSocketUrl();

      // Return TwiML to start media stream
      const twiml = this.twilioService.generateStreamTwiML(wsUrl);

      return new Response(twiml, {
        headers: { "Content-Type": "application/xml" },
      });
    } catch (error) {
      logger.error("Error handling voice webhook", error);

      const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Sorry, there was an error connecting your call. Please try again later.</Say>
    <Hangup/>
</Response>`;

      return new Response(errorTwiml, {
        headers: { "Content-Type": "application/xml" },
      });
    }
  }

  /**
   * Handle Twilio call status webhook
   */
  private async handleStatusWebhook(request: Request): Promise<Response> {
    try {
      const formData = await request.formData();
      const callStatus = formData.get("CallStatus") as string;
      const callSid = formData.get("CallSid") as string;

      logger.info("Call status update", { callSid, callStatus });

      if (
        callStatus === "completed" ||
        callStatus === "busy" ||
        callStatus === "no-answer" ||
        callStatus === "canceled"
      ) {
        // Clean up resources when call ends
        await this.handleCallEnd(callSid);
      }

      return new Response("OK");
    } catch (error) {
      logger.error("Error handling status webhook", error);
      return new Response("Error", { status: 500 });
    }
  }

  /**
   * Generate WebSocket URL for Twilio media streaming
   */
  private generateWebSocketUrl(): string {
    // Use current request URL to build WebSocket URL
    const url = new URL(
      this.env.CLOUDFLARE_WORKERS_URL ||
        "https://your-worker-domain.workers.dev"
    );
    url.protocol = "wss:";
    url.pathname = "/agents/twiliovoice/websocket";

    // Add call identifier as query parameter
    if (this.currentCallSid) {
      url.searchParams.set("callSid", this.currentCallSid);
    }

    return url.toString();
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    logger.debug("TwilioVoiceAgent WebSocket connected", {
      connectionId: connection.id,
      url: ctx.request.url
    });

    // Store the Twilio connection
    this.twilioConnection = connection;

    // Call parent connect handler
    await super.onConnect(connection, ctx);

    // Check if this is a Twilio call connection
    const url = new URL(ctx.request.url);
    const callSid = url.searchParams.get("callSid");

    if (callSid) {
      this.currentCallSid = callSid;
      logger.info("Twilio call connected via WebSocket", { callSid });
    } else {
      logger.warn("WebSocket connected without callSid parameter");
    }
  }

  async onMessage(connection: Connection, message: WSMessage) {
    // Handle Twilio media stream messages
    if (typeof message === "string") {
      try {
        const data = JSON.parse(message);
        
        // Log the raw message to see what Twilio is actually sending
        logger.debug("Twilio WebSocket message received", {
          rawData: JSON.stringify(data).substring(0, 200),
          event: data.event || data.Event,
          streamSid: data.streamSid || data.StreamSid,
          hasMedia: !!(data.media || data.Media)
        });

        // Handle both uppercase and lowercase field names from Twilio
        const event = data.event || data.Event;
        const streamSid = data.streamSid || data.StreamSid;
        const callSid = data.callSid || data.CallSid;
        const media = data.media || data.Media;
        
        if (event === "start") {
          logger.info("Twilio stream started", {
            streamSid,
            callSid,
          });
          this.currentStreamSid = streamSid;
          
          // Send initial greeting to the caller
          logger.info("Sending greeting to TTS", { 
            hasTTS: !!this.tts,
            streamSid: this.currentStreamSid,
            hasConnection: !!this.twilioConnection,
            ttsType: this.tts?.constructor?.name,
          });
          
          if (this.tts) {
            try {
              await this.tts.sendText("Hello! I'm Kaylee. How can I help you today?", true);
              logger.info("Greeting sent to TTS successfully");
            } catch (error) {
              logger.error("Error sending greeting to TTS", error);
            }
          } else {
            logger.error("TTS service not initialized");
          }
          
          return;
        }

        if (event === "media" && media) {
          // Convert Twilio audio to format expected by STT
          const payload = media.payload || media.Payload;
          if (payload) {
            const audioBuffer = this.twilioService.processIncomingAudio(
              payload
            ) as ArrayBuffer;

            // Send to STT service (existing logic)
            if (this.stt) {
              await this.stt.sendAudioChunk(audioBuffer);
            }
          }
          return;
        }

        if (event === "stop") {
          logger.info("Twilio stream stopped", { streamSid });
          await this.handleCallEnd(callSid);
          return;
        }
      } catch (error) {
        logger.error("Error parsing Twilio message", { error, message });
      }
    }

    // Delegate to parent for non-Twilio messages
    await super.onMessage(connection, message);
  }

  /**
   * Override onNewGeneratedChunk to handle Twilio audio output
   */
  async onNewGeneratedChunk(event: { chunk: any }) {
    // Call parent implementation for text processing
    await super.onNewGeneratedChunk(event);

    // For Twilio calls, we need to intercept the TTS audio and send it via WebSocket
    // This will be handled by overriding the TTS onAudio callback in onStart
  }

  /**
   * Send audio chunk to Twilio via WebSocket
   */
  private sendAudioToTwilio(audioChunk: ArrayBuffer | Buffer) {
    if (this.currentStreamSid && this.twilioConnection) {
      try {
        // Convert audio to Twilio format
        const arrayBuffer = audioChunk instanceof ArrayBuffer 
          ? audioChunk 
          : audioChunk.buffer.slice(audioChunk.byteOffset, audioChunk.byteOffset + audioChunk.byteLength);
        const twilioPayload = this.twilioService.prepareOutgoingAudio(arrayBuffer as ArrayBuffer);

        // Create media message
        const mediaMessage = {
          event: "media",
          streamSid: this.currentStreamSid,
          media: {
            timestamp: Date.now().toString(),
            track: "outbound",
            chunk: "0",
            payload: twilioPayload,
          },
        };

        // Send via WebSocket to Twilio
        this.twilioConnection.send(JSON.stringify(mediaMessage));

        logger.debug("Sent audio to Twilio", {
          streamSid: this.currentStreamSid,
          payloadLength: twilioPayload.length,
          samplePayload: twilioPayload.substring(0, 50),
          originalSize: arrayBuffer.byteLength,
        });
      } catch (error) {
        logger.error("Error sending audio to Twilio", error);
      }
    }
  }

  /**
   * Handle call end - cleanup resources
   */
  private async handleCallEnd(callSid: string) {
    logger.info("Cleaning up resources for ended call", { callSid });

    this.currentCallSid = undefined;
    this.currentStreamSid = undefined;
    this.currentCallerId = undefined;

    // Stop TTS and STT services if needed
    if (this.tts) {
      // await this.tts.disconnect();
    }

    if (this.stt) {
      // await this.stt.disconnect();
    }
  }

  /**
   * Get current caller's phone number
   */
  getCurrentCallerPhone(): number | undefined {
    if (this.currentCallerId) {
      return this.twilioService.extractPhoneNumber(this.currentCallerId);
    }
    return undefined;
  }
}
