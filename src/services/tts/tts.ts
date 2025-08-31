/**
 * Abstract base for a text-to-speech (TTS) service.
 *
 * The key idea is: you connect or set up the TTS service,
 * send text or partial text, and the service streams audio data back.
 *
 * The service can call onAudio callbacks with raw audio data (e.g. PCM or base64).
 */
export abstract class TextToSpeechService {
  /**
   * Connect, e.g. open a WebSocket
   */
  abstract connect(): Promise<void>;

  /**
   * Send text to be synthesized.
   * Optionally specify flush=true to indicate the end of a chunk or conversation turn.
   */
  abstract sendText(text: string, flush?: boolean): Promise<void>;

  /**
   * Close or tear down the TTS session.
   */
  abstract close(): Promise<void>;

  /**
   * Register a callback that receives audio chunks as they are synthesized.
   * The typical case is receiving raw PCM or base64-encoded audio.
   */
  abstract onAudio(
    cb: (chunk: ArrayBuffer | Buffer<ArrayBufferLike>) => void
  ): void;

  /**
   * Unregister the callback.
   */
  abstract offAudio(
    cb: (chunk: ArrayBuffer | Buffer<ArrayBufferLike>) => void
  ): void;

  /**
   * Halt/Interrupt the current TTS session. This is done to interrupt the service, if for example
   * the user starts to speak in the middle of the TTS output for a voice assistant.
   */
  abstract halt(): Promise<void>;
}
