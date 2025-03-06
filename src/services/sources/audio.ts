/**
 * Abstract base class that represents any audio source.
 * Examples include: microphone, an audio file stream, etc.
 */
export abstract class AudioSource {
    /**
     * Start capturing or fetching audio from this source.
     */
    abstract start(): Promise<void>;
  
    /**
     * Stop capturing audio from this source.
     */
    abstract stop(): Promise<void>;
  
    /**
     * Register a callback to receive audio data chunks (e.g., ArrayBuffer).
     */
    abstract onAudioData(callback: (chunk: ArrayBuffer) => void): void;
  
    /**
     * Deregister a callback if you need to remove listeners.
     */
    abstract offAudioData(callback: (chunk: ArrayBuffer) => void): void;
  }
  