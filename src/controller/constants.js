/** Timings, sizes, and labels shared by the Quire controller. */

import { TEXT_FONTS } from '../drawing.js';

export const SAVE_DELAY_MS = 400;
export const FONT_STACKS = TEXT_FONTS;
export const NUDGE = 5;
export const NUDGE_FAST = 25;
/** Elements that tick when the mouse reaches them. */
export const HOVER_SOUND_TARGETS = 'button:not(:disabled), .tile';
/** Letter size on the size row while the text box tool is active. */
export const SIZE_LETTER_PX = { 1: 11, 3: 15, 6: 19 };
/** Ops that can be added to the canvas one at a time without a full replay. */
export const INCREMENTAL_OPS = new Set(['stroke', 'line', 'rect', 'ellipse', 'curve', 'poly', 'stamp', 'fill', 'text', 'clear']);

export const STAMP_LABELS = { star: 'Star', heart: 'Heart', smile: 'Smiley', arrow: 'Arrow', bolt: 'Lightning', cloud: 'Cloud' };
/** Magnifier zoom steps: the sheet at 100%, 200% and 400%. */
export const ZOOM_STEPS = [1, 2, 4];
/** How often a spray can keeps spraying while the pointer is still. */
export const SPRAY_TICK_MS = 60;
/** Spray dots are laid down every this many normalized units while the pointer moves. */
export const SPRAY_STEP = 2;
/** A press this close to a polygon's first point, in screen pixels, closes the shape. */
export const CLOSE_REACH_PX = 10;
/** A press that moves less than this, in normalized units, counts as a click. */
export const MOVE_SLOP = 2;
