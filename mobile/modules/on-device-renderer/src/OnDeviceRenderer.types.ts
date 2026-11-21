export type OnDeviceRendererModuleEvents = {
  onRenderProgress: (params: RenderProgressEvent) => void;
};

export type RenderProgressEvent = {
  /** Export progress from 0 to 100. */
  progress: number;
};
