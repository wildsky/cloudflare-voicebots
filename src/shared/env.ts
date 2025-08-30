import type { AgentNamespace } from "agents";
import type { Chat } from "../agent/agent";
import type { VoiceAgent } from "../agent/voice-agent";

export type Env = {
  OPENAI_API_KEY: string;
  DEEPGRAM_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  LMNT_API_KEY: string;

  Chat: AgentNamespace<Chat>;
  voicechat: AgentNamespace<VoiceAgent>;
  CONVERSATION: DurableObjectNamespace;  // New binding for conversation persistence
};