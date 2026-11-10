# Quire

A local-first journal and drawing page. Write entries in Markdown, sketch on the page with paint-style tools, and export when you're ready. Everything lives in your browser (IndexedDB), with no account and no upload.

## Branches

`release` is the branch to pull from. Feature work goes on its own branch and opens a PR into `release`.

## Run it

Requires Node 18.17 or newer. No dependencies to install.

```sh
npm start          # serves the app at http://localhost:4173
npm test           # unit tests for the model, Markdown, text edits, drawing ops, and zip
```

You can also open `index.html` through any static server.

## What it does

- **Entries:** title, date, kind (journal, poem, blog post, note), mood, weather, and tags. Open entries from the list with search and filters for kind, tag, mood, and weather.
- **Prompts and reflection:** the top of the entries list shows a writing prompt for today. Write to it, or click Another for the next one. Its text starts a new journal as a quote. The On this day card lists entries from this date in earlier years. Both can be hidden in Options, on the Home tab.
- **Mood chart:** the chart button in the view bar plots each day's mood for 30 days, 90 days, a year, or all time (weekly averages for the longer ranges), with the average and how often each mood came up.
- **Dashboard:** the home page opens on a dashboard with a greeting, the streak, this month's entries and words, today's prompt, recent entries, a mini calendar, and the last seven days. Click a day on any of them to open it in the calendar. The Dashboard button in the view bar shows it, and the other views still show the full list.
- **First run:** a new library starts with one sample entry, "Welcome to Quire", and a Getting started card with four short tips. Click Got it to hide the tips. Options (Home tab) brings them back. The sample is written once, so deleting it keeps it gone, and it does not count toward your streak.
- **Calendar and streaks:** a month view shows how many entries each day has and its mood. The toolbar counts days in a row with at least one entry. Today's entry (Alt+T) opens today's journal, or starts one.
- **Writing:** a live preview. Headings, quotes, lists, checklists, rules, code, bold, italics, links, and colors render as you type, and the Markdown markup shows only on the line you are editing. Enter continues lists. Select text and click a color to color it.
- **Checklists:** type `- [ ] item` or use the checklist button. Click a box to check it off. Enter on a checked item starts a new unchecked one.
- **Pictures:** paste or drop an image file into the text, or use Insert > Image. Large photos are scaled to 1600 px. The picture sits on its own line, and its file is kept with the entry in a separate media store.
- **Inline sketches:** Insert > Sketch between paragraphs puts a small drawing pad in the text. It has its own pencil, brush, highlighter, eraser, undo and clear, and uses the current ink color.
- **Word count:** the status bar shows words and reading time (about 238 words a minute). Pictures, sketches and checkboxes do not count as words.
- **Source mode:** View > Source mode shows every Markdown marker. Formatting still applies right away.
- **Drawing:** pencil, brush, highlighter, eraser, line, rectangle, ellipse, fill, and color picker. Stroke widths 1, 3, and 6. Undo and redo follow whichever surface you touched last. Right-click a swatch to change the page color. Without a mouse, Tab to the drawing layer (or an inline sketch) once a drawing tool is picked: the arrow keys move a crosshair, Space or Enter puts the pen down and lifts it, and Escape lifts it.
- **Export:** Markdown with front matter (a .zip with the drawing PNG when the entry has ink), drawing as PNG, print or save as PDF, and JSON backup and restore. Backups include version history.
- **Version history:** Quire keeps a version every five minutes while you edit, when you leave an entry, and before a restore. Open File > Version history to preview a version's text, drawing and sketches, restore it, or delete it. Save version now keeps one by hand. The newest 30 versions are kept per entry. Pictures are kept with the entry until it is deleted, so every version can show its pictures.
- **Save status:** the dot in the title bar shows whether changes are pending, saving, saved, or failed to save.
- **Look:** the Skin menu picks Aero (the default), Aero dark, Aero Basic, XP Luna, or Classic 98. View > Options (Ctrl+,) holds the rest in one tabbed dialog: the writing font, a custom accent color (which recolors the selection and the title bar), Window animations, the Aero wallpaper, grid and snap, sound effects, the startup splash, and the Home cards. Format holds the color swap and resets. Keyboard shortcuts (F1) lists every key.

## Design decisions

- **Plain ES modules, no build step.** The app is small, so it runs straight from the browser and deploys to any static host.
- **Drawings are stored as ops, not bitmaps.** Each stroke is a small JSON record in normalized page units, so it survives resizing and undo is a replay. Bitmaps would make undo expensive.
- **Markdown is escaped first.** Only a few tags are rebuilt afterwards, so raw HTML in an entry is shown as text. The one HTML allowed is the color span the editor writes.
- **Storage is behind one small interface** (`src/storage.js`). IndexedDB is the default, with a memory fallback that shows a warning when storage is blocked. Entry rows hold text and metadata only. Pictures and sketches are in their own `media` store, so the entries list reads small rows and never loads image bytes.

## Known limits

- In Source mode, color spans appear as tags. Colors show in the live preview and in exports.
- A picture line can be removed from the text, but its file stays with the entry until the entry is deleted, so any version can bring it back. Pictures are never cleaned up on their own.
- Restoring a version puts back its sketch strokes, but a sketch that was added after that version is kept as it is.
- The live editor is a contenteditable that re-renders from the Markdown source on every change. Very long entries (tens of thousands of lines) may type more slowly.
- Ink is pinned to the page, not to a line of text. If you edit text above a drawing, the ink does not move with it.
- The print/PDF layout is close to the screen layout but can differ slightly.
- There is no zoom or lasso selection yet.
- Each version keeps a full copy of the text, ink and sketch strokes, so a long entry with many versions takes more browser storage. Pictures are not copied into versions.

## Layout

```
index.html          app shell
src/app.js          controller: editor, drawing layer, saving, menus
src/livetext.js     live-preview editor (contenteditable over the Markdown source)
src/livemarkup.js   pure line and inline model for the live view
src/media.js        pictures and sketches on an entry: image preparation, export bytes (no DOM for the helpers)
src/sketch.js       inline sketch pad: its toolbar and strokes
src/model.js        entry schema and helpers (no DOM)
src/markdown.js     safe Markdown renderer
src/prompts.js      daily writing prompts (pure, no DOM)
src/textops.js      pure text edits (lists, headings, color spans)
src/drawing.js      ops, undo stack, flood fill, rendering
src/keypen.js       keyboard pen: sends pointer events from arrow keys and Space to a drawing canvas
src/storage.js      IndexedDB and memory stores behind one interface (entries, media, and versions)
src/export.js       Markdown, ZIP, PNG, print, backup
src/versions.js     version rules: when a copy is kept and what it holds (no DOM)
src/history.js      version history dialog
src/skins.js        skin list, skin choice from saved prefs, and accent colors (no DOM)
src/options.js      Options dialog: the tabbed settings that the View and Skin menus used to hold
styles/             app chrome, live editor, rendered-text styles, Vista extras, and skins
tests/              node:test unit tests
scripts/serve.js    dependency-free static server
```

## Path to accounts and sync

Entries already carry `id`, `createdAt`, `updatedAt`, and `version`, which is what a sync layer needs. To add accounts, implement a store with the same `list / get / save / remove` methods that talks to a server, then swap it in `createLocalStore()`. Local-first remains the default, and a sync queue can sit in front of the remote store.
