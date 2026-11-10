/** Inline 16px stroke icons for tool buttons. */

const PATHS = {
  write: '<path d="M4 3.5h8M8 3.5v9M5.5 12.5h5"/>',
  pick: '<path d="M10.8 2.2l3 3-1.7 1.7-3-3z"/><path d="M9 4l-5.2 5.2L3 13l3.8-.8L12 7"/>',
  fill: '<path d="M4.2 7.4L8 3.6l3.8 3.8-3.8 3.8z"/><path d="M12.9 9.6c.6.9.9 1.5.9 1.9a.9.9 0 0 1-1.8 0c0-.4.3-1 .9-1.9z"/>',
  pencil: '<path d="M3.2 12.8l.7-2.6 6.6-6.6 1.9 1.9-6.6 6.6z"/><path d="M9.6 4.4l1.9 1.9"/>',
  brush: '<path d="M13.3 2.7L8.2 7.8l.9.9 5.2-5.2z"/><path d="M7.4 8.6c-1.9 0-2.6 1.2-2.6 2.4 0 1-.8 1.5-2 1.5 1.3 1.4 5.1 1.2 5.1-2.4"/>',
  marker: '<path d="M4.6 10.4l5.4-6.2 2.6 2.3-5.4 6.2z"/><path d="M2.5 14h11"/>',
  eraser: '<path d="M6 13.2L2.8 10l6-6.2 4.4 4.3-3.4 5.1z"/><path d="M6.2 13.2h7.3"/>',
  line: '<path d="M3 13L13 3"/>',
  rect: '<rect x="2.8" y="4" width="10.4" height="8" rx=".5"/>',
  ellipse: '<ellipse cx="8" cy="8" rx="5.6" ry="4.4"/>',
};

export function icon(name) {
  return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] ?? ''}</svg>`;
}
