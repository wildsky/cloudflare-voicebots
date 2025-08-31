import { logger } from "@/utils";
import { AudioSource } from "./audio";

/**
 * LocalMicrophoneSource captures audio from the user's microphone
 * and emits chunks of raw binary data (ArrayBuffer).
 */
export class LocalMicrophoneSource extends AudioSource {
  private mediaRecorder?: MediaRecorder;
  private callbacks: Array<(chunk: ArrayBuffer) => void> = [];
  private isRecording = false;

  async start(): Promise<void> {
    if (this.isRecording) return;
    this.isRecording = true;

    // Request microphone permission and start capturing
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });

    this.mediaRecorder.addEventListener("dataavailable", async (event) => {
      console.log(
        "[DEBUG] Browser: Audio data captured, size:",
        event.data.size,
        "callbacks:",
        this.callbacks.length
      );
      if (event.data.size > 0) {
        const arrayBuffer = await event.data.arrayBuffer();
        console.log(
          "[DEBUG] Browser: Calling",
          this.callbacks.length,
          "callbacks with ArrayBuffer size:",
          arrayBuffer.byteLength
        );
        this.callbacks.forEach((cb) => cb(arrayBuffer));
      }
    });

    // Start recording, collect data in small chunks
    this.mediaRecorder.start(250);
  }

  async stop(): Promise<void> {
    if (!this.isRecording || !this.mediaRecorder) return;
    this.isRecording = false;
    this.mediaRecorder.stop();
    this.mediaRecorder = undefined;
  }

  onAudioData(callback: (chunk: ArrayBuffer) => void): void {
    this.callbacks.push(callback);
  }

  offAudioData(callback: (chunk: ArrayBuffer) => void): void {
    this.callbacks = this.callbacks.filter((cb) => cb !== callback);
  }
}
