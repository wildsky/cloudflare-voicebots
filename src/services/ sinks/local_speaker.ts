// src/services/audioSink/LocalSpeaker.ts

import { AudioSink } from "./audio";

/**
 * LocalSpeaker uses Web Audio API in the browser to play audio chunks as they arrive.
 */
export class LocalSpeaker extends AudioSink {
  private audioContext: AudioContext;
  private playing = false;
  private queue: ArrayBuffer[] = [];

  constructor() {
    super();
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  async start(): Promise<void> {
    // Resume AudioContext if it's in suspended state (common on first user gesture)
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async stop(): Promise<void> {
    // Optionally close or suspend the audio context
    this.playing = false;
    this.queue = [];
    await this.audioContext.close();
  }

  async write(chunk: ArrayBuffer): Promise<void> {
    // Enqueue the chunk
    this.queue.push(chunk);

    if (!this.playing) {
      this.playNext();
    }
  }

  private playNext() {
    if (this.queue.length === 0) {
      this.playing = false;
      return;
    }
    this.playing = true;

    const nextChunk = this.queue.shift()!;
    this.audioContext.decodeAudioData(nextChunk.slice(0), (audioBuffer) => {
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      source.onended = () => {
        this.playNext();
      };

      source.start(0);
    }, (err) => {
      console.error("Error decoding audio chunk:", err);
      this.playNext();
    });
  }
}
