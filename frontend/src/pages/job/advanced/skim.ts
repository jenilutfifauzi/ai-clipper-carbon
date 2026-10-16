import { rememberedSwitch } from "../../../remembered";

/**
 * The Skim's two switches (GLOSSARY.md): whether the Advanced Edit's Timeline skims, and whether a
 * skim is heard. Per browser, both off unless turned on; without storage, a change lasts for the
 * page's life only, as the Magnetic timeline's does.
 */
const skim = rememberedSwitch("ai-clipper-skim", false);
const sound = rememberedSwitch("ai-clipper-skim-sound", false);

/** Whether the Skim is on. */
export const useSkim = skim.use;
export const setSkim = skim.set;
/** The Skim turned on, or off. */
export const toggleSkim = () => skim.set(!skim.read());

/** Whether a skim is heard, in snippets. */
export const useSkimSound = sound.use;
export const setSkimSound = sound.set;
