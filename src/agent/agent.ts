import { type Schedule } from "agents";
import { AIChatAgent } from "agents/ai-chat-agent";
import {
  createDataStreamResponse,
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import type { Env } from "../shared/env";
import { agentContext, processToolCalls } from "./agent-utils";
import { tools, executions } from "../tools";
import { logger } from "../utils";
import { log } from "console";
import type { Connection, ConnectionContext, WSMessage } from "partyserver";

/**
 * Main Chat Agent class. Extends AIChatAgent from Cloudflare's agentic SDK.
 */
export class Chat extends AIChatAgent<Env> {
  async onStart() {
    logger.debug("Chat agent started");
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
              You are Kaylee, a friendly AI assistant.
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
    logger.debug("executeTask", {
      description,
      task,
    });
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
