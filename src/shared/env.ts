import type { AgentNamespace } from "agents-sdk";
import type { Chat } from "../agent/agent";

/**
 * Environment variables & bindings for your Worker + Agents.
 */
export type Env = {
  OPENAI_API_KEY: string;
  Chat: AgentNamespace<Chat>;
  // Add other environment variables or DO bindings here
};
