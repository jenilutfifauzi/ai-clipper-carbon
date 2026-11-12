// Re-export the native module. On web, it will be resolved to OnDeviceRendererModule.web.ts
// and on native platforms to OnDeviceRendererModule.ts
export { default } from './src/OnDeviceRendererModule';
export * from './src/OnDeviceRenderer.types';
