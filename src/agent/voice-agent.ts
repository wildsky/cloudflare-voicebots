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
import { DeepgramStt, type SpeechToTextService } from "@/services/stt";
import type { TextUIPart } from "@ai-sdk/ui-utils";
import type { TextToSpeechService } from "@/services/tts/tts";
import { InworldTTS } from "@/services/tts/inworld-tts";
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

    // Initialize the STT service
    this.stt = new DeepgramStt(this.env.DEEPGRAM_API_KEY);
    this.stt.onTranscription(this.handleTranscript.bind(this));

    logger.debug("Connecting to STT service");
    await this.stt.connect();

    logger.debug("STT service connected");

    this.tts = new InworldTTS({
      apiKey: this.env.INWORLD_API_KEY,
      voiceId: "Elizabeth",
      modelId: "inworld-tts-1",
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

    logger.debug("Connecting to TTS service");
    await this.tts.connect();
    logger.debug("TTS service connected");
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
                            You are a helpful assistant that can do various tasks. If the user asks,
                            you can schedule tasks to be executed later. The input may include a date/time/cron pattern
                            to be passed to a scheduling tool. The time is now: ${new Date().toISOString()}.
                            `,
            messages: processedMessages,
            tools,
            onFinish,
            onChunk: this.onNewGeneratedChunk.bind(this),
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
