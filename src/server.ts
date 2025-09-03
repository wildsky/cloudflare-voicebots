import { routeAgentRequest } from "agents";
import type { Env } from "./shared/env";
import type { Chat } from "./agent/agent";
import { logger } from "./utils";
import {
  handleTwilioVoiceWebhook,
  handleTwilioStatusWebhook,
} from "./routes/twilio";

// export type { Env } from "./shared/env";
export { Chat } from "./agent/agent";
export { VoiceAgent } from "./agent/voice-agent";
export { TwilioVoiceAgent } from "./agent/twilio-voice-agent";
export { ConversationDO } from "./conversations";

/**
 * The worker entry point, which routes all incoming fetch requests.
 * If the request matches the /agents/... pattern, it's routed to our Chat agent.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // FIRST THING: Log that we got ANY request
    console.log("🚀 WORKER HIT:", request.method, request.url);

    logger.debug("Worker fetch event", { request });
    if (!env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set. Make sure to set it locally in .dev.vars, and deploy secrets with `wrangler secret bulk .dev.vars`."
      );
      return new Response("OPENAI_API_KEY is not set", { status: 500 });
    }

    const url = new URL(request.url);

    console.log("SERVER: Request received", {
      method: request.method,
      pathname: url.pathname,
      fullUrl: request.url,
      isWebSocket: request.headers.get("Upgrade") === "websocket",
      isTwilioPath: url.pathname.startsWith("/agents/twiliovoice/"),
    });

    // Handle Twilio webhooks explicitly to ensure proper DO routing
    if (
      request.method === "POST" &&
      (url.pathname === "/twilio/voice" ||
        url.pathname === "/agents/twiliovoice/twilio/voice")
    ) {
      return handleTwilioVoiceWebhook(request, env);
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/twilio/status" ||
        url.pathname === "/agents/twiliovoice/twilio/status")
    ) {
      return handleTwilioStatusWebhook(request, env);
    }

    // If routeAgentRequest can't find a matching Agent route, return 404
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
