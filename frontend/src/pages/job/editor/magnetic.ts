import { rememberedSwitch } from "../../../remembered";

/**
 * The Magnetic timeline's switch (GLOSSARY.md): whether the layers follow the Main Track in the
 * Advanced Edit and the clip editor's trim. Per browser, on unless turned off; without storage, it
 * is on, and a change lasts for the page's life only.
 */
const magnetic = rememberedSwitch("ai-clipper-magnetic", true);

export const setMagnetic = magnetic.set;

/** Whether the Magnetic timeline is on. */
export const useMagnetic = magnetic.use;
