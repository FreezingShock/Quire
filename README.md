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

- **Entries:** title, date, kind (journal, poem, blog post, note), and tags. Open entries from the list with search and kind filters.
- **Writing:** Markdown source with headings, quotes, lists, rules, code, bold, and italics. Enter continues lists. Select text and click a color to color it.
- **Read view:** the rendered page, including colored text.
- **Drawing:** pencil, brush, highlighter, eraser, line, rectangle, ellipse, fill, and color picker. Stroke widths 1, 3, and 6. Undo and redo follow whichever surface you touched last. Right-click a swatch to change the page color.
- **Export:** Markdown with front matter (a .zip with the drawing PNG when the entry has ink), drawing as PNG, print or save as PDF, and JSON backup and restore.
- **Look:** serif, sans, or monospace writing font, plus a dark chrome option.

## Design decisions

- **Plain ES modules, no build step.** The app is small, so it runs straight from the browser and deploys to any static host.
- **Drawings are stored as ops, not bitmaps.** Each stroke is a small JSON record in normalized page units, so it survives resizing and undo is a replay. Bitmaps would make undo expensive.
- **Markdown is escaped first.** Only a few tags are rebuilt afterwards, so raw HTML in an entry is shown as text. The one HTML allowed is the color span the editor writes.
- **Storage is behind one small interface** (`src/storage.js`). IndexedDB is the default, with a memory fallback that shows a warning when storage is blocked.

## Known limits

- The writing view shows Markdown source, so color spans appear as tags there. Colors show in Read view and in exports.
- Ink is pinned to the page, not to a line of text. If you edit text above a drawing, the ink does not move with it.
- The print/PDF layout is close to the screen layout but can differ slightly.
- There is no zoom or lasso selection yet.

## Layout

```
index.html          app shell
src/app.js          controller: editor, drawing layer, saving, menus
src/model.js        entry schema and helpers (no DOM)
src/markdown.js     safe Markdown renderer
src/textops.js      pure text edits (lists, headings, color spans)
src/drawing.js      ops, undo stack, flood fill, rendering
src/storage.js      IndexedDB and memory stores behind one interface
src/export.js       Markdown, ZIP, PNG, print, backup
styles/             app chrome and rendered-text styles
tests/              node:test unit tests
scripts/serve.js    dependency-free static server
```

## Path to accounts and sync

Entries already carry `id`, `createdAt`, `updatedAt`, and `version`, which is what a sync layer needs. To add accounts, implement a store with the same `list / get / save / remove` methods that talks to a server, then swap it in `createLocalStore()`. Local-first remains the default, and a sync queue can sit in front of the remote store.
