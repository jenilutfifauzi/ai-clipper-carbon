// What is dragged from the asset panel onto the timeline, as a DataTransfer type: a Media Library
// item (its id), a Text Preset (its id), or a Transition's kind; and onto the timeline or the
// preview, a Stickers tile (its Shape Kind); and onto the timeline, a Filters card (its Look's id),
// which makes an Adjustment Layer.
export const DRAG_MEDIA = "application/x-clipper-media";
export const DRAG_TEXT = "application/x-clipper-text";
export const DRAG_TRANSITION = "application/x-clipper-transition";
export const DRAG_SHAPE = "application/x-clipper-shape";
export const DRAG_LOOK = "application/x-clipper-look";
