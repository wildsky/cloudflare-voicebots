import { AudioSink } from "./audio";

/**
 * LocalSpeakerSink uses the Web Audio API (AudioContext) to play
 * raw PCM or other audio data (e.g., MP3 if you'd decode it).
 * 
 * It buffers incoming chunks in a queue and plays them sequentially.
 */
export class LocalSpeakerSink extends AudioSink {
    private audioContext: AudioContext;
    private queue: Array<ArrayBuffer> = [];
    private isPlaying = false;
    private isStarted = false;

    constructor() {
        super();
        // Create the AudioContext up front
        // Browsers may require a user gesture before audio can actually play
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    /**
     * Start the sink. For example, resuming AudioContext if it's suspended.
     */
    async start(): Promise<void> {
        // Some browsers won't allow playback until a user gesture calls .resume()
        if (this.audioContext.state === "suspended") {
            await this.audioContext.resume();
        }
        this.isStarted = true;
    }

    /**
     * Stop the sink: close the AudioContext and clear the queue.
     */
    async stop(): Promise<void> {
        // You can close the AudioContext to free resources
        // Or just pause (suspend) if you prefer
        this.queue = [];
        this.isPlaying = false;
        this.isStarted = false;
        await this.audioContext.close();
    }

    /**
     * Accept a chunk for playback. We'll enqueue it and then
     * start playing if we're not currently busy.
     */
    async write(chunk: ArrayBuffer): Promise<void> {
        // If user hasn't called start() yet, we won't decode until they do
        if (!this.isStarted) {
            await this.start();
        }

        this.queue.push(chunk);

        // If we aren't currently playing audio, begin the next item immediately
        if (!this.isPlaying) {
            this.playNext();
        }
    }

    /**
     * Internal method to handle queueing logic
     */
    private async playNext() {
        if (this.queue.length === 0) {
            // Nothing to play
            this.isPlaying = false;
            return;
        }

        this.isPlaying = true;
        const nextChunk = this.queue.shift()!; // remove first item

        try {
            // Convert the chunk to an AudioBuffer
            // Note: This requires the chunk to be in a format that the browser can decode
            // If it's raw PCM (linear16), you might need to do a manual decode or transform to WAV first.
            const buffer = await this.audioContext.decodeAudioData(nextChunk.slice(0));
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioContext.destination);

            source.onended = () => {
                // When finished playing this chunk, move on to the next
                this.playNext();
            };

            source.start(0); // Start playback
        } catch (error) {
            console.error("[BrowserAudioSink] Error decoding/playing chunk:", error);
            // Skip this chunk, go on to the next
            this.playNext();
        }
    }
}
