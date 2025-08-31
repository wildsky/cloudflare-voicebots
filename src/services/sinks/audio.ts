/**
 * Abstract base for an audio sink (a "speaker").
 * Provide a standard interface to play raw audio data.
 */
export abstract class AudioSink {
  /**
   * Start or initialize any playback resources if needed.
   */
  abstract start(): Promise<void>;

  /**
   * Stop or free resources, if needed.
   */
  abstract stop(): Promise<void>;

  /**
   * Accept an audio chunk to be played or queued for playback.
   */
  abstract write(chunk: ArrayBuffer): Promise<void>;
}
