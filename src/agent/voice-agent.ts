import {
    type Schedule,
} from "agents-sdk";
import { AIChatAgent } from "agents-sdk/ai-chat-agent";
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
import { ElevenLabsTTS } from "@/services/tts/elevenlabs";
import { LmntTTS } from "@/services/tts/lmnt";
import { createWriteStream } from "fs";

const sentence_fragment_delimiters: string = ".?!;:,\n…)]}。-";
const full_sentence_delimiters: string = ".?!\n…。";

export class VoiceAgent extends AIChatAgent<Env> {
    private connection?: Connection;
    private stt?: SpeechToTextService;
    private tts?: TextToSpeechService;
    private transcriptAccumulator: TextUIPart[] = [];

    async onStart() {
        logger.debug("VoiceAgent agent started");

        logger.debug("Initializing STT service");

        // Initialize the STT service
        this.stt = new DeepgramStt(this.env.DEEPGRAM_API_KEY);
        this.stt.onTranscription(this.handleTranscript.bind(this));

        logger.debug("Connecting to STT service");
        await this.stt.connect();

        logger.debug("STT service connected");

        this.tts = new ElevenLabsTTS({
            apiKey: this.env.ELEVENLABS_API_KEY,
            voiceId: '21m00Tcm4TlvDq8ikWAM',
            modelId: 'eleven_flash_v2_5',
            optimizeLatency: 4
        });
        this.tts.onAudio((audioChunk) => {
            // For TTS, we want to forward 'audioChunk' back to the client
            if (this.connection) {
                const base64Audio = btoa(
                    String.fromCharCode(...new Uint8Array(audioChunk))
                );

                this.connection.send(
                    JSON.stringify({
                        type: "audio-chunk",
                        data: base64Audio
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
        // Check the request at ctx.request
        // Authenticate the client
        // Give them the OK.
        connection.accept();
    }

    async handleTranscript(transcript: { text: string; isFinal: boolean }) {
        // logger.debug("Received transcript from STT service", { transcript });

        if (transcript.text.length > 0) {
            // Craft a message chunk 
            const messageChunk: TextUIPart = {
                type: "text",
                text: transcript.text,
            }

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
                createdAt: new Date()
            };
            this.transcriptAccumulator = [];
            // Save the message chunk to the conversation logs
            await this.saveMessages([
                ...this.messages,
                finalTranscript,
            ]);
        }
    }

    async onNewGeneratedChunk(event: { chunk: TextStreamPart<any> }) {
        const { chunk } = event;
        if (chunk.type == "text-delta") {
            // Send the text delta to the TTS service
            // Determine wether to flush based on if the sentence is complete.
            // Check if the end of the sentence is reached by comparing the last character with the delimiters
            const isEndOfSentence = full_sentence_delimiters.includes(chunk.textDelta[chunk.textDelta.length - 1]);
            const isEndOfParagraph = sentence_fragment_delimiters.includes(chunk.textDelta[chunk.textDelta.length - 1]);
            const flush = isEndOfSentence || isEndOfParagraph;
            logger.debug("Sending text delta to TTS service", { chunk, flush });
            this.tts?.sendText(chunk.textDelta, flush);
        } else if (chunk.type == "finish") {
            logger.debug("Received finish event from AI", { chunk });
            this.tts?.sendText(" ", true);
        }
    }

    // // Called for each message received on the WebSocket connection
    async onMessage(connection: Connection, message: WSMessage) {
        // If the message is an audio chunk, process it with the STT service
        if (message instanceof ArrayBuffer) {
            // logger.debug(`Received audio chunk from client ID: ${connection.id}`);
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
                    // 2. Create an OpenAI client
                    const openai = createOpenAI({
                        apiKey: this.env.OPENAI_API_KEY,
                    });

                    // const abortSignal = new AbortController().signal;

                    // 3. Stream AI response (GPT-4 or whichever model you pick)
                    //    Merges tool usage instructions if user or AI requested them.
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
                        // abortSignal: abortSignal,
                    });

                    // Merge the AI’s text stream into the dataStream (so the client sees the text in real-time).
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
        const parts: TextUIPart[] = [{
            type: "text",
            text: content,
        }]

        await this.saveMessages([
            ...this.messages,
            {
                id: generateId(),
                role: "assistant",
                content: content,
                parts: parts,
                createdAt: new Date()
            },
        ]);
    }
}
