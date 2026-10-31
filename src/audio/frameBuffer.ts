const SAMPLE_RATE = 16000;
const FRAME_DURATION_MS = 30;
const BYTES_PER_SAMPLE = 2;

const FRAME_SIZE_BYTES =
  (SAMPLE_RATE * FRAME_DURATION_MS * BYTES_PER_SAMPLE) / 1000;

export class AudioFrameBuffer {
  addChunk = (chunk: Buffer): Buffer[] => {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    const frames: Buffer[] = [];

    while (this.#buffer.length >= FRAME_SIZE_BYTES) {
      const frame = this.#buffer.subarray(0, FRAME_SIZE_BYTES);
      frames.push(frame);
      this.#buffer = this.#buffer.subarray(FRAME_SIZE_BYTES);
    }

    return frames;
  };

  reset = (): void => {
    this.#buffer = Buffer.alloc(0);
  };

  #buffer = Buffer.alloc(0);
}
