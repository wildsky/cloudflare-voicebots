import { AsyncLocalStorage } from "node:async_hooks"; // or a polyfill if needed
import type { Message } from "ai";
import type { z } from "zod";
import {
  convertToCoreMessages,
  type DataStreamWriter,
  type ToolSet,
  formatDataStreamPart,
  type ToolExecutionOptions,
} from "ai";

import { APPROVAL } from "../shared/approval";
import type { Chat } from "./agent";

/**
 * Agent context: holds a reference to the current Chat agent so Tools can access it.
 */
export const agentContext = new AsyncLocalStorage<Chat>();

/**
 * Checks if `key` is a valid property on `obj`.
 * TS type helper to avoid string indexing warnings.
 */
function isValidToolName<K extends PropertyKey, T extends object>(
  key: K,
  obj: T
): key is K & keyof T {
  return key in obj;
}

/**
 * Processes any pending tool calls that require human approval,
 * executes them if approved, and writes the results to the data stream.
 */
export async function processToolCalls<
  Tools extends ToolSet,
  ExecutableTools extends {
    [Tool in keyof Tools as Tools[Tool] extends { execute: Function }
      ? never
      : Tool]: Tools[Tool];
  },
>({
  dataStream,
  messages,
  tools,
  executions,
}: {
  dataStream: DataStreamWriter;
  messages: Message[];
  tools: Tools;
  executions: {
    [K in keyof Tools & keyof ExecutableTools]?: (
      args: z.infer<ExecutableTools[K]["parameters"]>,
      context: ToolExecutionOptions
    ) => Promise<unknown>;
  };
}): Promise<Message[]> {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage?.parts) return messages;

  const processedParts = await Promise.all(
    lastMessage.parts.map(async (part) => {
      if (part.type !== "tool-invocation") return part;

      const { toolInvocation } = part;
      const toolName = toolInvocation.toolName;

      // Must have an 'execute' entry AND be in 'result' state
      if (!(toolName in executions) || toolInvocation.state !== "result") {
        return part;
      }

      let result: unknown;
      // If user approved the tool call
      if (toolInvocation.result === APPROVAL.YES) {
        if (!isValidToolName(toolName, executions)) {
          return part;
        }
        const executor = executions[toolName];
        if (executor) {
          result = await executor(toolInvocation.args, {
            messages: convertToCoreMessages(messages),
            toolCallId: toolInvocation.toolCallId,
          });
        } else {
          result = "Error: No tool executor found.";
        }
      } else if (toolInvocation.result === APPROVAL.NO) {
        result = "Error: User denied tool execution.";
      } else {
        // If unhandled, skip.
        return part;
      }

      // Stream the tool result back to the client
      dataStream.write(
        formatDataStreamPart("tool_result", {
          toolCallId: toolInvocation.toolCallId,
          result,
        })
      );

      // Update the invocation part so subsequent logic knows the result
      return {
        ...part,
        toolInvocation: {
          ...toolInvocation,
          result,
        },
      };
    })
  );

  // Return the original messages, but replace the last message with the processed parts
  const newLastMessage = { ...lastMessage, parts: processedParts };
  return [...messages.slice(0, -1), newLastMessage];
}
