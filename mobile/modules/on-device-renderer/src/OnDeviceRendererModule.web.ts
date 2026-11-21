import { registerWebModule, NativeModule } from 'expo';

import { OnDeviceRendererModuleEvents } from './OnDeviceRenderer.types';

class OnDeviceRendererModule extends NativeModule<OnDeviceRendererModuleEvents> {
  async renderPortraitClipAsync(): Promise<string> {
    throw new Error('On-device video rendering is available in the Android development build only.');
  }

  async renderPortraitClipWithOverlaysAsync(): Promise<string> {
    throw new Error('On-device video rendering is available in the Android development build only.');
  }

  async cancelRenderAsync(): Promise<boolean> {
    return false;
  }
}

export default registerWebModule(OnDeviceRendererModule, 'OnDeviceRendererModule');
