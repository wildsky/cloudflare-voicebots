import { type Schedule } from "agents";
import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type DataStreamWriter,
  type Message,
  type StreamTextOnFinishCallback,
  type TextStreamPart,
  type UIMessage,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import type { Env } from "../shared/env";
import { agentContext, processToolCalls } from "./agent-utils";
import { tools, executions } from "../tools";
import { logger } from "../utils";
import { log } from "console";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";
import { AssemblyAIStt, type SpeechToTextService } from "@/services/stt";
import type { TextUIPart } from "@ai-sdk/ui-utils";
import type { TextToSpeechService } from "@/services/tts/tts";
import { InworldTTS } from "@/services/tts/inworld-tts";
import { ElevenLabsTTS } from "@/services/tts/elevenlabs";
import { createWriteStream } from "fs";
import { initializeDatabaseTools } from "@/tools/database";

const sentence_fragment_delimiters: string = ".?!;:,\n…)]}。-";
const full_sentence_delimiters: string = ".?!\n…。";

export class VoiceAgent extends AIChatAgent<Env> {
  protected connection?: Connection;
  protected stt?: SpeechToTextService;
  protected tts?: TextToSpeechService;
  private transcriptAccumulator: TextUIPart[] = [];
  private currentAbortController?: AbortController;
  private textBuffer: string = "";

  async onRequest(request: Request) {
    logger.debug("VoiceAgent received HTTP request", { request });

    const url = new URL(request.url);

    // Handle get-messages requests
    if (url.pathname.endsWith("/get-messages")) {
      if (request.method === "GET") {
        return new Response(JSON.stringify(this.messages), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Delegate other requests to parent
    return new Response("Not implemented", { status: 501 });
  }

  async onStart() {
    logger.debug("VoiceAgent agent started");

    // Initialize database tools with D1 binding
    initializeDatabaseTools(this.env.USER_DB);
    logger.debug("Database tools initialized");

    logger.debug("Initializing STT service");

    console.log("🔍 STT ENV DEBUG:", {
      hasAssemblyAIKey: !!this.env.ASSEMBLYAI_API_KEY,
      keyLength: this.env.ASSEMBLYAI_API_KEY?.length || 0,
      keyPreview:
        this.env.ASSEMBLYAI_API_KEY?.substring(0, 8) + "..." || "undefined",
      allEnvKeys: Object.keys(this.env).filter((k) => k.includes("API_KEY")),
    });

    // Initialize the STT service
    this.stt = new AssemblyAIStt(this.env.ASSEMBLYAI_API_KEY);
    this.stt.onTranscription(this.handleTranscript.bind(this));

    logger.debug("Connecting to STT service");
    await this.stt.connect();

    logger.debug("STT service connected");

    // Choose TTS service - uncomment the one you want to use
    // this.tts = new InworldTTS({
    //   apiKey: this.env.INWORLD_API_KEY,
    //   voiceId: "Elizabeth",
    //   modelId: "inworld-tts-1",
    // });

    this.tts = new ElevenLabsTTS({
      apiKey: this.env.ELEVENLABS_API_KEY,
      voiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel - clear female voice
      modelId: "eleven_flash_v2_5",
      optimizeLatency: 3,
      outputFormat: "pcm_16000", // Request PCM format for easier conversion
    });

    logger.debug("Connecting to TTS service");
    await this.tts.connect();
    logger.debug("TTS service connected");

    this.tts.onAudio((audioChunk) => {
      // For TTS, we want to forward 'audioChunk' back to the client
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
    });
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    logger.debug("VoiceAgent agent connected", { connection });

    this.connection = connection;
    // Don't call connection.accept() - parent class handles this with hibernation
  }

  async handleTranscript(transcript: { text: string; isFinal: boolean }) {
    // logger.debug("Received transcript from STT service", { transcript });

    if (transcript.text.length > 0) {
      // Craft a message chunk
      const messageChunk: TextUIPart = {
        type: "text",
        text: transcript.text,
      };

      this.transcriptAccumulator.push(messageChunk);
    }

    // Accumulate the transcript messages if not final
    if (transcript.isFinal && this.transcriptAccumulator.length > 0) {
      // If the transcript is final, save the accumulated messages
      const finalTranscript: Message = {
        id: generateId(),
        role: "user",
        content: this.transcriptAccumulator.map((part) => part.text).join(" "),
        parts: this.transcriptAccumulator,
        createdAt: new Date(),
      };
      this.transcriptAccumulator = [];
      // Save the message chunk to the conversation logs
      await this.saveMessages([...this.messages, finalTranscript]);
    }
  }

  async onNewGeneratedChunk(event: { chunk: TextStreamPart<any> }) {
    const { chunk } = event;

    // Debug log all chunk types
    console.log("CHUNK TYPE:", chunk.type, chunk);

    if (chunk.type == "text-delta") {
      // Accumulate text in buffer
      this.textBuffer += chunk.textDelta;

      const isEndOfSentence = full_sentence_delimiters.includes(
        chunk.textDelta[chunk.textDelta.length - 1]
      );

      if (isEndOfSentence) {
        // Send complete sentence to TTS
        logger.debug("Sending complete sentence to TTS service", {
          text: this.textBuffer,
        });
        this.tts?.sendText(this.textBuffer.trim(), true);
        this.textBuffer = ""; // Clear buffer
      }
    } else if (chunk.type == "tool-call") {
      console.log("TOOL CALL CHUNK:", chunk.toolName, chunk.args);
    } else if (chunk.type == "tool-result") {
      console.log("TOOL RESULT CHUNK:", chunk.result);
      // Tool results should be spoken too
      if (typeof chunk.result === "string") {
        logger.debug("Sending tool result to TTS service", {
          text: chunk.result,
        });
        this.tts?.sendText(chunk.result, true);
      }
    } else if (chunk.type == "finish") {
      // Send any remaining text
      if (this.textBuffer.trim()) {
        logger.debug("Sending final text to TTS service", {
          text: this.textBuffer,
        });
        this.tts?.sendText(this.textBuffer.trim(), true);
        this.textBuffer = "";
      }
    }
  }

  // // Called for each message received on the WebSocket connection
  async onMessage(connection: Connection, message: WSMessage) {
    // If the message is an audio chunk, process it with the STT service
    if (message instanceof ArrayBuffer) {
      logger.debug(
        `Received audio chunk from client ID: ${connection.id}, size: ${message.byteLength} bytes`
      );
      await this.stt?.sendAudioChunk(message);
      return;
    }
    super.onMessage(connection, message);
  }

  /**
   * Called when a chat message arrives from the user.
   * It returns a streaming response (text + possible tool calls).
   */
  async onChatMessage(onFinish: StreamTextOnFinishCallback<{}>) {
    // Use AsyncLocalStorage to store this agent instance context
    // so that Tools can access the agent via agentContext.getStore().
    return agentContext.run(this, async () => {
      return createDataStreamResponse({
        execute: async (dataStream: DataStreamWriter) => {
          // 1. Process possible tool calls (human-in-the-loop confirmations)
          const processedMessages = await processToolCalls({
            messages: this.messages,
            dataStream,
            tools,
            executions,
          });

          // 2) Abort any existing generation if it's still running
          if (this.currentAbortController) {
            this.currentAbortController.abort();
            // Also halt the TTS service
            // this.tts?.halt();
          }

          // 3) Create a fresh AbortController
          this.currentAbortController = new AbortController();

          // 4) Create OpenAI client
          const openai = createOpenAI({ apiKey: this.env.OPENAI_API_KEY });

          // 5) Stream the AI response, passing abortSignal from our controller
          const result = streamText({
            model: openai("gpt-4o-2024-11-20"),
            system: `
                            You are Kaylee, a helpful voice assistant that can do various tasks. 
                            When the user asks about weather, use the getWeatherInformation tool.
                            You can also schedule tasks to be executed later. 
                            The current time is: ${new Date().toISOString()}.
                            Remember to speak naturally and conversationally since this is a voice call.
                            `,
            messages: processedMessages,
            tools,
            onFinish,
            onChunk: this.onNewGeneratedChunk.bind(this),
            onToolCall: async ({ toolCall }) => {
              console.log("TOOL CALL:", toolCall.toolName, toolCall.args);
            },
            maxSteps: 10,
            abortSignal: this.currentAbortController.signal, // <-- important
          });

          // 6) Merge text stream into dataStream (for normal chat UI)
          result.mergeIntoDataStream(dataStream);
        },
      });
    });
  }

  /**
   * Called by the scheduling tool whenever a scheduled event fires.
   * We simply add a new assistant message to the conversation logs.
   */
  async executeTask(description: string, task: Schedule<string>) {
    const content = `scheduled message: ${description}`;
    const parts: TextUIPart[] = [
      {
        type: "text",
        text: content,
      },
    ];

    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "assistant",
        content: content,
        parts: parts,
        createdAt: new Date(),
      },
    ]);
  }
}
