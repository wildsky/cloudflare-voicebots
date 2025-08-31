import type { AgentNamespace } from "agents";
import type { Chat } from "../agent/agent";
import type { VoiceAgent } from "../agent/voice-agent";

export type Env = {
  OPENAI_API_KEY: string;
  DEEPGRAM_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  LMNT_API_KEY: string;
  INWORLD_API_KEY: string;
  INWORLD_WORKSPACE_ID: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  TWILIO_WEBHOOK_SECRET: string;
  CLOUDFLARE_WORKERS_URL: string;

  Chat: AgentNamespace<Chat>;
  voicechat: AgentNamespace<VoiceAgent>;
  twiliovoice: AgentNamespace<
    import("../agent/twilio-voice-agent").TwilioVoiceAgent
  >;
  CONVERSATION: DurableObjectNamespace; // New binding for conversation persistence
  USER_DB: D1Database; // Database for user information
};
