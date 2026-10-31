import { AudioFrameBuffer } from "./frameBuffer.js";

const frameBuffer = new AudioFrameBuffer();
const chunk = Buffer.alloc(2000);
const frames = frameBuffer.addChunk(chunk);

// console.log("Frames produced:", frames.length);
// console.log(
//   "Frame sizes:",
//   frames.map((frame) => frame.length),
// );

// const continuityBuffer = new AudioFrameBuffer();

// const firstChunk = Buffer.alloc(500, 1);
// const secondChunk = Buffer.alloc(600, 2);

// const firstResult = continuityBuffer.addChunk(firstChunk);
// const secondResult = continuityBuffer.addChunk(secondChunk);

// console.log("First call frames:", firstResult.length);
// console.log("Second call frames:", secondResult.length);

// const frame = secondResult[0];

// console.log("First byte:", frame?.[0]);
// console.log("Byte at index 499:", frame?.[499]);
// console.log("Byte at index 500:", frame?.[500]);
// console.log("Last byte:", frame?.[959]);

const resetBuffer = new AudioFrameBuffer();

resetBuffer.addChunk(Buffer.alloc(500, 1));

resetBuffer.reset();

const result = resetBuffer.addChunk(Buffer.alloc(500, 2));

console.log("Frames after reset:", result.length);
