import {
    type Schedule,
} from "agents-sdk";
import { AIChatAgent } from "agents-sdk/ai-chat-agent";
import {
    createDataStreamResponse,
    generateId,
    streamText,
    type StreamTextOnFinishCallback,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import type { Env } from "../shared/env";
import { agentContext, processToolCalls } from "./agent-utils";
import { tools, executions } from "../tools/basics";

/**
 * Main Chat Agent class. Extends AIChatAgent from Cloudflare's agentic SDK.
 */
export class Chat extends AIChatAgent<Env> {
    /**
     * Called when a chat message arrives from the user.
     * It returns a streaming response (text + possible tool calls).
     */
    async onChatMessage(onFinish: StreamTextOnFinishCallback<{}>) {
        // Use AsyncLocalStorage to store this agent instance context
        // so that Tools can access the agent via agentContext.getStore().
        return agentContext.run(this, async () => {
            return createDataStreamResponse({
                execute: async (dataStream) => {
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
                        maxSteps: 10,
                    });

                    // Merge the AI’s text stream into the dataStream (so the client sees the text in real-time).
                    result.mergeIntoDataStream(dataStream);
                },
            });
        });
    }

    /**
     * Called by the scheduling tool whenever a scheduled event fires.
     * We simply add a new user message to the conversation logs.
     */
    async executeTask(description: string, task: Schedule<string>) {
        await this.saveMessages([
            ...this.messages,
            {
                id: generateId(),
                role: "user",
                content: `scheduled message: ${description}`,
            },
        ]);
    }
}
