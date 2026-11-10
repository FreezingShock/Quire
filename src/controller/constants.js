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
export const INCREMENTAL_OPS = new Set(['stroke', 'line', 'rect', 'ellipse', 'fill', 'text', 'clear']);
