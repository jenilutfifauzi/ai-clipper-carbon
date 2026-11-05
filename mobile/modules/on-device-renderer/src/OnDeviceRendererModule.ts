import { NativeModule, requireNativeModule } from "expo";

import { OnDeviceRendererModuleEvents } from "./OnDeviceRenderer.types";

declare class OnDeviceRendererModule extends NativeModule<OnDeviceRendererModuleEvents> {
  renderPortraitClipAsync(
    sourceUri: string,
    startMs: number,
    endMs: number,
  ): Promise<string>;
  cancelRenderAsync(): Promise<boolean>;
}

export default requireNativeModule<OnDeviceRendererModule>("OnDeviceRenderer");
