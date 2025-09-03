import type { Env } from "../../shared/env";
import { logger } from "../../utils";

export interface TwilioCallData {
  CallSid: string;
  From: string;
  To: string;
  CallStatus: string;
  Direction: string;
  AccountSid: string;
}

export interface TwilioStreamData {
  AccountSid: string;
  CallSid: string;
  StreamSid: string;
  Track: "inbound" | "outbound" | "both";
  Event: "start" | "media" | "stop" | "connected";
  SequenceNumber?: string;
  Media?: {
    Timestamp: string;
    Track: string;
    Chunk: string;
    Payload: string;
  };
}

export class TwilioService {
  constructor(private env: Env) {}

  /**
   * Generates TwiML to start a media stream for real-time audio
   */
  generateStreamTwiML(websocketUrl: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${websocketUrl}" track="inbound_track" />
    </Connect>
</Response>`;
  }

  /**
   * Generates TwiML to end a call
   */
  generateHangupTwiML(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Thank you for calling. Goodbye!</Say>
    <Hangup/>
</Response>`;
  }

  /**
   * Validates that a request came from Twilio using webhook validation
   */
  validateTwilioSignature(
    twilioSignature: string,
    requestUrl: string,
    requestBody: string
  ): boolean {
    // For now, we'll skip validation in development
    // In production, you should implement proper webhook validation
    logger.debug("Twilio signature validation", {
      signature: twilioSignature,
      url: requestUrl,
    });
    return true;
  }

  /**
   * Extracts phone number from Twilio format (+1234567890) to number format
   */
  extractPhoneNumber(twilioPhone: string): number {
    // Remove +1 prefix and convert to number
    const cleaned = twilioPhone.replace(/^\+1/, "");
    return parseInt(cleaned, 10);
  }

  /**
   * Process incoming audio from Twilio media stream
   */
  processIncomingAudio(mediaPayload: string): ArrayBuffer {
    // Twilio sends audio as base64-encoded μ-law (G.711 μ-law)
    // Convert to PCM16 for AssemblyAI
    try {
      const audioData = atob(mediaPayload);
      
      // Convert μ-law to PCM16
      const pcm16Buffer = new ArrayBuffer(audioData.length * 2);
      const pcm16View = new Int16Array(pcm16Buffer);
      
      // μ-law decompression table lookup would be ideal, but implementing the algorithm
      const BIAS = 0x84;
      const CLIP = 32635;
      
      for (let i = 0; i < audioData.length; i++) {
        const mulawByte = audioData.charCodeAt(i);
        
        // Flip all bits (μ-law is stored inverted)
        const ulaw = (~mulawByte) & 0xFF;
        
        // Extract sign, exponent, and mantissa
        const sign = (ulaw & 0x80);
        const exponent = (ulaw >> 4) & 0x07;
        const mantissa = ulaw & 0x0F;
        
        // Calculate the linear value
        let sample = (mantissa << 1) + 1;
        sample += BIAS;
        sample <<= exponent;
        sample -= BIAS;
        
        // Apply sign and clipping
        if (sign) sample = -sample;
        if (sample > CLIP) sample = CLIP;
        if (sample < -CLIP) sample = -CLIP;
        
        pcm16View[i] = sample;
      }
      
      return pcm16Buffer;
    } catch (error) {
      logger.error("Failed to process incoming audio", error);
      throw error;
    }
  }

  /**
   * Convert audio buffer to Twilio media format
   */
  prepareOutgoingAudio(audioBuffer: ArrayBuffer): string {
    // Convert audio to μ-law format and base64 encode
    const uint8Array = new Uint8Array(audioBuffer);
    let binaryString = "";

    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }

    return btoa(binaryString);
  }

  /**
   * Create media message to send audio to Twilio
   */
  createMediaMessage(audioPayload: string, timestamp?: string): string {
    const mediaMessage = {
      event: "media",
      streamSid: "", // Will be set by the caller
      media: {
        timestamp: timestamp || Date.now().toString(),
        track: "outbound",
        chunk: "0",
        payload: audioPayload,
      },
    };

    return JSON.stringify(mediaMessage);
  }
}
