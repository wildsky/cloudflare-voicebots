import type { AgentNamespace } from "agents-sdk";
// import type { Chat } from "../agent/agent";
import type { VoiceAgent } from "../agent/voice-agent";

/**
 * Environment variables & bindings for your Worker + Agents.
 */
export type Env = {
  OPENAI_API_KEY: string;
  DEEPGRAM_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  LMNT_API_KEY: string;

  Chat: AgentNamespace<VoiceAgent>;
  // Voice: AgentNamespace<VoiceAgent>;    // Our new voice assistant agent
  // Add other environment variables or DO bindings here
};
