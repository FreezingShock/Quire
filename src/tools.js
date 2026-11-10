/** Tool, palette and format definitions shared by the UI. */

export const TOOLS = [
  { id: 'write', label: 'Write', key: 'T', icon: 'write', hint: 'Write: type Markdown. # for headings, > for quotes, - for lists. Select text and click a color to color it.' },
  { id: 'pick', label: 'Pick color', key: 'I', icon: 'pick', hint: 'Pick color: click drawn ink or blank page to make that color the ink.' },
  { id: 'fill', label: 'Fill', key: 'G', icon: 'fill', hint: 'Fill: click inside an area of ink or blank page to fill it.' },
  { id: 'pencil', label: 'Pencil', key: 'P', icon: 'pencil', hint: 'Pencil: drag to draw a thin line in the ink color.' },
  { id: 'brush', label: 'Brush', key: 'B', icon: 'brush', hint: 'Brush: drag to paint. Choose a width under the tools.' },
  { id: 'marker', label: 'Highlighter', key: 'H', icon: 'marker', hint: 'Highlighter: drag for a see-through stroke. Overlaps stay translucent.' },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: 'eraser', hint: 'Eraser: drag to rub out ink on the current layer. Markdown text is not affected.' },
  { id: 'spray', label: 'Spray can', key: 'K', icon: 'spray', hint: 'Spray can: drag, or hold still to build up a spot. The width under the tools sets the spread.' },
  { id: 'line', label: 'Line', key: 'L', icon: 'line', hint: 'Line: drag to draw a straight line. Hold Shift for 45° steps.' },
  { id: 'curve', label: 'Curve', key: 'C', icon: 'curve', hint: 'Curve: drag a line, then drag to bend it. Drag again for the other half. Enter finishes.' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: 'rect', hint: 'Rectangle: drag from one corner to the other. Hold Shift for a square.' },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: 'ellipse', hint: 'Ellipse: drag to set the size of the oval. Hold Shift for a circle.' },
  { id: 'polygon', label: 'Polygon', key: 'N', icon: 'polygon', hint: 'Polygon: drag out each side. Click the first point to close, or double-click to finish.' },
  { id: 'stamp', label: 'Stamps', key: 'J', icon: 'stamp', hint: 'Stamps: pick a shape, then click to place it in the ink color.' },
  { id: 'select', label: 'Select', key: 'S', icon: 'select', hint: 'Select: drag a box around ink or text. Flip, turn or resize with the row under the tools.' },
  { id: 'text', label: 'Text box', key: 'A', icon: 'textbox', hint: 'Text box: drag to set the width, then type. Click existing text to edit it. Escape finishes.' },
  { id: 'magnifier', label: 'Magnifier', key: 'M', icon: 'magnifier', hint: 'Magnifier: click to zoom in on a spot. Shift-click zooms back out.' },
];

export const POINTER_TOOLS = new Set([
  'pick', 'fill', 'pencil', 'brush', 'marker', 'eraser', 'spray', 'line', 'curve', 'rect', 'ellipse',
  'polygon', 'stamp', 'select', 'text', 'magnifier',
]);
export const SHAPE_TOOLS = new Set(['line', 'curve', 'rect', 'ellipse']);
export const TOOL_BY_KEY = Object.fromEntries(TOOLS.map((tool) => [tool.key.toLowerCase(), tool.id]));
export const STROKE_SIZES = [1, 3, 6];

export const FORMAT_BUTTONS = [
  { id: 'h1', label: 'Heading 1', text: 'H1' },
  { id: 'h2', label: 'Heading 2', text: 'H2' },
  { id: 'h3', label: 'Heading 3', text: 'H3' },
  { id: 'quote', label: 'Quote', text: '“' },
  { id: 'ul', label: 'Bulleted list', text: '•' },
  { id: 'ol', label: 'Numbered list', text: '1.' },
  { id: 'task', label: 'Checklist', text: '☐' },
  { id: 'bold', label: 'Bold (Ctrl+B)', text: 'B', cls: 'is-bold' },
  { id: 'italic', label: 'Italic (Ctrl+I)', text: 'I', cls: 'is-italic' },
  { id: 'divider', label: 'Divider', text: '—' },
];

/** 28 colors in two rows, starting with the default ink. */
export const PALETTE = [
  '#1d1b19', '#4a4640', '#7d7568', '#7a1f2b', '#c0392b', '#e0672a', '#e9a520',
  '#f3d54a', '#9bc53d', '#3a9b5c', '#2a9d9a', '#2f6fb3', '#2d3f8f', '#6b3fa0',
  '#ffffff', '#b9b4aa', '#e4dccd', '#f6d3c7', '#fbe2a4', '#e3f0b5', '#c0e8d0',
  '#c3e6ec', '#c9dcf3', '#cfc8f0', '#ecc7e8', '#f2b6c4', '#8c5e3c', '#3b2f25',
];
