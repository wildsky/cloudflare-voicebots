/**
 * Abstract base for a speech-to-text (STT) service.
 * The key idea is to unify how STT is started, how audio is sent,
 * and how transcripts are received—regardless of the provider.
 */
export abstract class SpeechToTextService {
  /**
   * Optional initialization or connection logic, e.g. open a WebSocket
   */
  abstract connect(): Promise<void>;

  /**
   * Send raw audio data to the STT engine.
   */
  abstract sendAudioChunk(chunk: ArrayBuffer): Promise<void>;

  /**
   * Close/cleanup underlying resources (WS connections, etc.).
   */
  abstract close(): Promise<void>;

  /**
   * Allows consumers to register a callback to receive transcripts.
   * For partial vs. final transcripts, set `isFinal: boolean`.
   */
  abstract onTranscription(
    cb: (transcript: { text: string; isFinal: boolean }) => void
  ): void;

  /**
   * Unregister a transcription callback.
   */
  abstract offTranscription(
    cb: (transcript: { text: string; isFinal: boolean }) => void
  ): void;
}
