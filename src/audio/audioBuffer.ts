export type AudioBuffers = {
  wake: Buffer[];
  pending: Buffer[];
  command: Buffer[];
};

export const createAudioBuffers = (): AudioBuffers => {
  return { wake: [], pending: [], command: [] };
};

export const resetAudioBuffers = (buffers: AudioBuffers): void => {
  buffers.wake.length = 0;
  buffers.pending.length = 0;
  buffers.command.length = 0;
};
