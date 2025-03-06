import { routeAgentRequest } from "agents-sdk";
import type { Env } from "./shared/env";
import type { Chat } from "./agent/agent";

// export type { Env } from "./shared/env";
export * from "./agent/agent";

/**
 * The worker entry point, which routes all incoming fetch requests.
 * If the request matches the /agents/... pattern, it’s routed to our Chat agent.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set. Make sure to set it locally in .dev.vars, and deploy secrets with `wrangler secret bulk .dev.vars`."
      );
      return new Response("OPENAI_API_KEY is not set", { status: 500 });
    }

    // If routeAgentRequest can't find a matching Agent route, return 404
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
