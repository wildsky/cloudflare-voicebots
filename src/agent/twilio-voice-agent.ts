import { VoiceAgent } from "./voice-agent";
import {
  TwilioService,
  type TwilioStreamData,
  type TwilioCallData,
} from "../services/twilio/twilio-service";
import { DatabaseService } from "../services/database";
import { logger } from "../utils";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import type { Env } from "../shared/env";

export class TwilioVoiceAgent extends VoiceAgent {
  private twilioService!: TwilioService;
  private database!: DatabaseService;
  private currentStreamSid?: string;
  private currentCallSid?: string;
  private currentCallerId?: string;
  private twilioConnection?: Connection;
  private currentUser?: any; // Store user data in instance memory
  private servicesInitialized = false;
  private greetingSent = false;

  /**
   * Initialize services if not already done
   */
  private async ensureServicesInitialized() {
    if (!this.servicesInitialized) {
      this.twilioService = new TwilioService(this.env);
      this.database = new DatabaseService(this.env.USER_DB);
      this.servicesInitialized = true;
      logger.info("Services initialized in TwilioVoiceAgent");
    }
  }

  /**
   * Override fetch to handle both webhooks and WebSocket in same DO instance
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    console.log("AGENT: TwilioVoiceAgent fetch called", {
      method: request.method,
      pathname: url.pathname,
      fullUrl: request.url,
      hasUpgrade: !!request.headers.get('Upgrade')
    });

    // Ensure services are initialized before handling any requests
    await this.ensureServicesInitialized();

    // Handle Twilio webhook (HTTP POST) - check if pathname ends with the expected route
    if (request.method === 'POST' && url.pathname.endsWith('/twilio/voice')) {
      console.log("Handling Twilio voice webhook");
      return this.handleWebhook(request);
    }

    // Handle Twilio status webhook (HTTP POST)
    if (request.method === 'POST' && url.pathname.endsWith('/twilio/status')) {
      console.log("Handling Twilio status webhook");
      return this.handleStatusWebhook(request);
    }

    // Handle WebSocket upgrade - check for pattern /agents/twiliovoice/twilio/{callSid}/websocket
    if (request.headers.get('Upgrade') === 'websocket' && url.pathname.includes('/twilio/') && url.pathname.endsWith('/websocket')) {
      console.log("Handling WebSocket upgrade");
      return this.handleWebSocket(request);
    }

    // Fall back to parent handler for other requests
    return super.fetch(request);
  }

  async onStart() {
    // Initialize services
    await this.ensureServicesInitialized();
    
    // Call parent onStart to initialize STT/TTS services
    await super.onStart();

    // Override TTS audio callback for Twilio support
    if (this.tts) {
      this.tts.onAudio((audioChunk) => {
        if (this.currentStreamSid) {
          // Send to Twilio via WebSocket
          this.sendAudioToTwilio(audioChunk);
        }
      });
    }
  }

  /**
   * Handle Twilio webhook - look up user and store in instance memory
   */
  private async handleWebhook(request: Request): Promise<Response> {
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

      // Reset stream ID for new call to ensure greeting triggers on first media event
      this.currentStreamSid = undefined;

      console.log("WEBHOOK: Incoming Twilio call - single DO approach", {
        ...callData,
        doInstanceInfo: {
          hasCurrentUser: !!this.currentUser,
          hasCurrentCallSid: !!this.currentCallSid,
          instanceId: this.ctx.id?.toString().substring(0, 8) || 'unknown'
        }
      });

      // Store call information in instance memory
      this.currentCallSid = callData.CallSid;
      this.currentCallerId = callData.From;

      // Look up user by phone number and store in both instance memory AND DO storage
      const phoneNumber = this.twilioService.extractPhoneNumber(callData.From);
      try {
        this.currentUser = await this.database.getUserByPhone(phoneNumber);
        
        // Store phone number and user data in DO storage for WebSocket instance access
        if (this.currentUser) {
          // Store user data and phone number in DO storage for cross-instance access
          await this.ctx.storage.put(`user:${callData.CallSid}`, this.currentUser);
          await this.ctx.storage.put(`phone:${callData.CallSid}`, callData.From);
          
          console.log("User data stored in DO storage for cross-instance access", {
            callSid: callData.CallSid,
            userName: `${this.currentUser.fName} ${this.currentUser.lName}`,
            fromPhone: callData.From
          });
        } else {
          // Even if no user found, store the phone number for potential lookup
          await this.ctx.storage.put(`phone:${callData.CallSid}`, callData.From);
        }
        
        logger.info("User lookup result - stored in DO memory and storage", {
          phoneNumber,
          userFound: !!this.currentUser,
          userName: this.currentUser ? `${this.currentUser.fName} ${this.currentUser.lName}` : null,
        });
      } catch (error) {
        logger.error("Error looking up user by phone", { phoneNumber, error });
        this.currentUser = null;
      }

      // Generate WebSocket URL pointing to same DO instance
      const wsUrl = this.generateWebSocketUrlSingleDO();

      // Return TwiML to start media stream (no personalization here)
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
   * Handle WebSocket upgrade request
   */
  private async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Extract CallSid from path: /agents/twiliovoice/twilio/{callSid}/websocket
    const pathParts = url.pathname.split('/');
    const callSidFromPath = pathParts.length >= 5 ? pathParts[4] : null;
    
    // Try to load user data from DO storage if not already in memory
    if (!this.currentUser && callSidFromPath) {
      try {
        // Try to get user data from DO storage first
        const storedUserData = await this.ctx.storage.get(`user:${callSidFromPath}`);
        if (storedUserData) {
          this.currentUser = storedUserData as User;
          this.currentCallSid = callSidFromPath;
          console.log("User data loaded from DO storage for cross-instance access", {
            callSid: callSidFromPath,
            userName: `${this.currentUser.fName} ${this.currentUser.lName}`
          });
        } else {
          // If not in DO storage, check if we have the From phone number to look up user
          const fromPhoneData = await this.ctx.storage.get(`phone:${callSidFromPath}`);
          if (fromPhoneData) {
            const userData = await this.database.getUserDataFromTwilioNumber(fromPhoneData as string);
            if (userData) {
              this.currentUser = userData;
              this.currentCallSid = callSidFromPath;
              // Store in DO storage for future use
              await this.ctx.storage.put(`user:${callSidFromPath}`, userData);
              console.log("User data loaded from database and cached in DO storage", {
                callSid: callSidFromPath,
                userName: `${this.currentUser.fName} ${this.currentUser.lName}`
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to load user data", { 
          callSid: callSidFromPath, 
          error: error?.message || error?.toString() || 'Unknown error',
          errorType: error?.constructor?.name || 'Unknown type'
        });
      }
    }
    
    console.log("WEBSOCKET: WebSocket upgrade - path parameter analysis", {
      fullPath: url.pathname,
      pathParts,
      extractedCallSid: callSidFromPath,
      storedCallSid: this.currentCallSid,
      hasUserData: !!this.currentUser,
      userName: this.currentUser?.fName,
      doInstanceInfo: {
        hasCurrentUser: !!this.currentUser,
        hasCurrentCallSid: !!this.currentCallSid,
        instanceId: this.ctx.id?.toString().substring(0, 8) || 'unknown'
      }
    });

    // For WebSocket requests, we need to handle them manually since we're using DO WebSocket
    // but still integrate with the agents framework connection management
    const { 0: client, 1: server } = new WebSocketPair();
    
    // Accept the WebSocket in the Durable Object context
    this.ctx.acceptWebSocket(server);
    
    // Return the client to Twilio
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  /**
   * Generate WebSocket URL for media streaming
   */
  private generateWebSocketUrlSingleDO(): string {
    const url = new URL(
      this.env.CLOUDFLARE_WORKERS_URL || "https://your-worker-domain.workers.dev"
    );
    url.protocol = "wss:";
    
    console.log("WEBHOOK: Generating WebSocket URL", {
      hasCurrentCallSid: !!this.currentCallSid,
      currentCallSid: this.currentCallSid,
      baseUrl: url.toString()
    });
    
    // Use consistent room "twilio" instead of dynamic CallSid to ensure same DO instance
    url.pathname = `/agents/twiliovoice/twilio/${this.currentCallSid || 'default'}/websocket`;
    
    console.log("WEBHOOK: Generated WebSocket URL with consistent room", {
      finalUrl: url.toString()
    });
    
    return url.toString();
  }


  // Note: onRequest method removed - now handled by fetch() override

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

    // If we have both WebSocket connection and StreamSid, send greeting
    if (this.currentStreamSid && this.tts) {
      logger.info("WebSocket connected, sending greeting now", {
        streamSid: this.currentStreamSid,
        hasTTS: !!this.tts,
        ttsType: this.tts?.constructor?.name,
      });
      
      try {
        await this.tts.sendText("Hello! I'm Kaylee. How can I help you today?", true);
        logger.info("Greeting sent to TTS successfully");
      } catch (error) {
        logger.error("Error sending greeting to TTS", error);
      }
    }
  }

  async onMessage(connection: Connection, message: WSMessage) {
    // Handle Twilio media stream messages
    if (typeof message === "string") {
      try {
        const data = JSON.parse(message);
        
        // Log the raw message to see what Twilio is actually sending
        console.log("TWILIO RAW MESSAGE:", JSON.stringify(data, null, 2));
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
          logger.info("StreamSid set to", this.currentStreamSid);
          
          // Send personalized greeting using stored user data (only once)
          if (!this.greetingSent) {
            console.log("STREAM START: Sending personalized greeting", {
              streamSid: this.currentStreamSid,
              hasUserData: !!this.currentUser,
              userName: this.currentUser ? `${this.currentUser.fName} ${this.currentUser.lName}` : null,
              doInstanceInfo: {
                hasCurrentUser: !!this.currentUser,
                hasCurrentCallSid: !!this.currentCallSid,
                instanceId: this.ctx.id?.toString().substring(0, 8) || 'unknown'
              }
            });
            
            // Ensure TTS is initialized before sending greeting
            if (!this.tts) {
              console.log("STREAM START: TTS not initialized, initializing now...");
              try {
                await this.onStart();
              } catch (error) {
                console.error("STREAM START: Failed to initialize TTS", error);
              }
            }
            
            if (this.tts && this.currentUser) {
              const greeting = `Hello ${this.currentUser.fName}! I'm Kaylee. How can I help you today?`;
              logger.info("Sending personalized greeting", { greeting, userName: this.currentUser.fName });
              await this.tts.sendText(greeting, true);
              this.greetingSent = true;
            } else if (this.tts) {
              const greeting = "Hello! I'm Kaylee. How can I help you today?";
              logger.info("Sending generic greeting - no user data found", { greeting });
              await this.tts.sendText(greeting, true);
              this.greetingSent = true;
            } else {
              logger.warn("No TTS service available for greeting - initialization failed");
            }
          } else {
            console.log("STREAM START: Greeting already sent, skipping");
          }
          
          return;
        }

        if (event === "connected") {
          logger.info("Twilio stream connected", {
            streamSid,
            callSid,
          });
          
          // Connected event doesn't have streamSid, but we should initialize services anyway
          console.log("STREAM CONNECTED: Initializing services", {
            hasUserData: !!this.currentUser,
            userName: this.currentUser ? `${this.currentUser.fName} ${this.currentUser.lName}` : null
          });
          
          // Initialize services regardless of streamSid
          if (!this.tts) {
            console.log("STREAM CONNECTED: TTS not initialized, initializing now...");
            try {
              await this.onStart();
            } catch (error) {
              console.error("STREAM CONNECTED: Failed to initialize TTS", error);
            }
          }
          
          // Send personalized greeting immediately on connected (only if not already sent)
          if (!this.greetingSent) {
            if (this.tts && this.currentUser) {
              const greeting = `Hello ${this.currentUser.fName}! I'm Kaylee. How can I help you today?`;
              logger.info("Sending personalized greeting on connected", { greeting, userName: this.currentUser.fName });
              await this.tts.sendText(greeting, true);
              this.greetingSent = true;
            } else if (this.tts) {
              const greeting = "Hello! I'm Kaylee. How can I help you today?";
              logger.info("Sending generic greeting on connected - no user data found", { greeting });
              await this.tts.sendText(greeting, true);
              this.greetingSent = true;
            } else {
              logger.warn("No TTS service available for greeting on connected - initialization failed");
            }
          } else {
            console.log("STREAM CONNECTED: Greeting already sent, skipping");
          }
          
          return;
        }

        if (event === "media" && media) {
          // Debug logging for stream detection
          console.log("MEDIA EVENT: Stream detection check", {
            incomingStreamSid: streamSid,
            currentStreamSid: this.currentStreamSid,
            willTriggerGreeting: !!(streamSid && streamSid !== this.currentStreamSid),
            hasUserData: !!this.currentUser,
            userName: this.currentUser ? `${this.currentUser.fName} ${this.currentUser.lName}` : null
          });
          
          // Initialize services and send greeting if this is a new stream
          // Check if streamSid is different from current one (new stream)
          if (streamSid && streamSid !== this.currentStreamSid) {
            console.log("MEDIA: New stream detected, initializing services and sending greeting", {
              newStreamSid: streamSid,
              oldStreamSid: this.currentStreamSid,
              hasUserData: !!this.currentUser,
              userName: this.currentUser ? `${this.currentUser.fName} ${this.currentUser.lName}` : null,
              doInstanceInfo: {
                hasCurrentUser: !!this.currentUser,
                hasCurrentCallSid: !!this.currentCallSid,
                instanceId: this.ctx.id?.toString().substring(0, 8) || 'unknown'
              }
            });
            
            this.currentStreamSid = streamSid;
            
            // Initialize services if not already done
            if (!this.tts || !this.stt) {
              console.log("MEDIA: Services not initialized, initializing now...");
              try {
                await this.onStart();
                console.log("MEDIA: Services initialized successfully");
              } catch (error) {
                console.error("MEDIA: Failed to initialize services", error);
              }
            }
            
            // Send personalized greeting
            if (this.tts && this.currentUser) {
              const greeting = `Hello ${this.currentUser.fName}! I'm Kaylee. How can I help you today?`;
              logger.info("Sending personalized greeting", { greeting, userName: this.currentUser.fName });
              console.log("MEDIA: Sending personalized greeting", { greeting });
              try {
                await this.tts.sendText(greeting, true);
                console.log("MEDIA: Personalized greeting sent successfully");
              } catch (error) {
                console.error("MEDIA: Failed to send personalized greeting", error);
              }
            } else if (this.tts) {
              const greeting = "Hello! I'm Kaylee. How can I help you today?";
              logger.info("Sending generic greeting - no user data found", { greeting });
              console.log("MEDIA: Sending generic greeting", { greeting });
              try {
                await this.tts.sendText(greeting, true);
                console.log("MEDIA: Generic greeting sent successfully");
              } catch (error) {
                console.error("MEDIA: Failed to send generic greeting", error);
              }
            } else {
              logger.warn("No TTS service available for greeting - initialization failed");
              console.log("MEDIA: No TTS service available for greeting");
            }
          }
          
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

        // Catch-all for unhandled events
        if (event) {
          console.log(`UNHANDLED TWILIO EVENT: ${event}`, {
            event,
            streamSid,
            callSid,
            hasMedia: !!media,
            fullData: data
          });
        }
      } catch (error) {
        logger.error("Error parsing Twilio message", { error, message });
      }
      
      // For string messages from Twilio, don't call super.onMessage as it expects ArrayBuffer
      return;
    }

    // Only delegate to parent for ArrayBuffer messages (audio data)
    await super.onMessage(connection, message);
  }

  /**
   * Override webSocketMessage to handle null pointer errors from agents framework
   */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      console.log("WEBSOCKET MESSAGE: Received message", {
        wsExists: !!ws,
        messageType: typeof message,
        messageLength: message instanceof ArrayBuffer ? message.byteLength : message.length,
        doInstanceInfo: {
          hasCurrentUser: !!this.currentUser,
          hasCurrentCallSid: !!this.currentCallSid,
          instanceId: this.ctx.id?.toString().substring(0, 8) || 'unknown'
        }
      });

      if (!ws) {
        console.warn("WEBSOCKET MESSAGE: Received message with null WebSocket - ignoring");
        return;
      }

      // Handle as string message (Twilio messages are JSON)
      if (typeof message === 'string') {
        await this.onMessage(ws as any, message);
      } else if (message instanceof ArrayBuffer) {
        await this.onMessage(ws as any, message);
      }
    } catch (error) {
      console.error("WEBSOCKET MESSAGE: Error handling message", { 
        error: error?.message || error?.toString() || 'Unknown error',
        errorType: error?.constructor?.name || 'Unknown type'
      });
    }
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
    if (this.currentStreamSid) {
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

        // Send via Durable Object WebSocket to Twilio
        const webSockets = this.ctx.getWebSockets();
        webSockets.forEach(ws => {
          ws.send(JSON.stringify(mediaMessage));
        });

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
   * Override WebSocket close handler to prevent null reference errors
   */
  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    try {
      console.log("WEBSOCKET: Base class close handler", {
        code,
        reason,
        wasClean,
        currentCallSid: this.currentCallSid
      });
      
      // Call parent handler safely
      if (super.webSocketClose) {
        await super.webSocketClose(ws, code, reason, wasClean);
      }
    } catch (error) {
      console.error("WEBSOCKET: Error in close handler", error);
    }
  }

  /**
   * Override WebSocket error handler to prevent crashes
   */
  async webSocketError(ws: WebSocket, error: Error) {
    try {
      console.error("WEBSOCKET: Base class error handler", error);
      
      // Call parent handler safely
      if (super.webSocketError) {
        await super.webSocketError(ws, error);
      }
    } catch (handlerError) {
      console.error("WEBSOCKET: Error in error handler", handlerError);
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
