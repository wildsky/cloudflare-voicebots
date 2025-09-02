import type { Env } from "../shared/env";
import { logger } from "../utils";

/**
 * Handle initial Twilio voice webhook and route to appropriate DO instance
 */
export async function handleTwilioVoiceWebhook(request: Request, env: Env): Promise<Response> {
  try {
    // Clone the request to read form data without consuming the original body
    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();
    const callSid = formData.get("CallSid") as string;
    
    if (!callSid) {
      return new Response("Missing CallSid", { status: 400 });
    }
    
    logger.info("Routing Twilio voice webhook to DO", { callSid });
    
    // Create DO instance explicitly using CallSid as the ID
    const doId = env.twiliovoice.idFromName(callSid);
    const twilioVoiceStub = env.twiliovoice.get(doId);
    
    // Forward the original request to the DO instance
    const doUrl = new URL(request.url);
    doUrl.pathname = `/agents/twiliovoice/${callSid}/twilio/voice`;
    
    return twilioVoiceStub.fetch(new Request(doUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    }));
  } catch (error) {
    logger.error("Error routing Twilio voice webhook", error);
    
    const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Sorry, there was an error connecting your call. Please try again later.</Say>
    <Hangup/>
</Response>`;
    
    return new Response(errorTwiml, {
      headers: { "Content-Type": "application/xml" },
    });
  }
}

/**
 * Handle Twilio status webhook and route to appropriate DO instance
 */
export async function handleTwilioStatusWebhook(request: Request, env: Env): Promise<Response> {
  try {
    // Clone the request to read form data without consuming the original body
    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();
    const callSid = formData.get("CallSid") as string;
    
    if (!callSid) {
      return new Response("Missing CallSid", { status: 400 });
    }
    
    logger.info("Routing Twilio status webhook to DO", { callSid });
    
    // Get the same DO instance using CallSid
    const doId = env.twiliovoice.idFromName(callSid);
    const twilioVoiceStub = env.twiliovoice.get(doId);
    
    // Forward the original request to the DO instance
    const doUrl = new URL(request.url);
    doUrl.pathname = `/agents/twiliovoice/${callSid}/twilio/status`;
    
    return twilioVoiceStub.fetch(new Request(doUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    }));
  } catch (error) {
    logger.error("Error routing Twilio status webhook", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}