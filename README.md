# Quire

A local-first journal and drawing page. Write entries in Markdown, sketch on the page with paint-style tools, and export when you're ready. Everything lives in your browser (IndexedDB), with no account and no upload.

## Branches

`release` is the branch to pull from. Feature work goes on its own branch and opens a PR into `release`.

## Run it

Requires Node 18.17 or newer. No dependencies to install.

```sh
npm start          # serves the app at http://localhost:4173
npm test           # unit tests for the model, Markdown, text edits, drawing ops, and zip
npm run test:e2e   # browser tests for the main flows (run `npm install` and `npx playwright install chromium` first)
```

You can also open `index.html` through any static server.

## What it does

- **Entries:** title, date, kind (journal, poem, blog post, note), mood, weather, and tags. Open entries from the list with search and filters for kind, tag, mood, and weather.
- **Prompts and reflection:** the top of the entries list shows a writing prompt for today. Write to it, or click Another for the next one. Its text starts a new journal as a quote. The On this day card lists entries from this date in earlier years. Both can be hidden in Options, on the Home tab.
- **Mood chart:** the chart button in the view bar plots each day's mood for 30 days, 90 days, a year, or all time (weekly averages for the longer ranges), with the average and how often each mood came up.
- **Year in pixels:** the grid button in the view bar draws the whole calendar year, one square per day. Months run down and days run across, and each square takes the mood logged that day. The arrows move between years, a square opens that day in the calendar, and Save poster PNG writes a Vista-style poster of the year.
- **Dashboard:** the home page opens on a dashboard with a greeting, the streak, this month's entries and words, today's prompt, recent entries, a mini calendar, and the last seven days. Click a day on any of them to open it in the calendar. The Dashboard button in the view bar shows it, and the other views still show the full list.
- **Sidebar gadgets:** a column beside the dashboard holds small panels: a clock, a streak meter, a mood gauge, a word of the day, a sticky note, and a slideshow of your drawings. Add a calendar from Add gadget. Drag a gadget by its title bar to reorder it, or use Alt with the up and down arrows. The × removes one. The sticky note is saved on this device and sealed by the passcode lock like the rest of the store. Options (Home tab) turns the column off.
- **First run:** a new library starts with one sample entry, "Welcome to Quire", and a Getting started card with four short tips. Click Got it to hide the tips. Options (Home tab) brings them back. The sample is written once, so deleting it keeps it gone, and it does not count toward your streak.
- **Calendar and streaks:** a month view shows how many entries each day has and its mood. The toolbar counts days in a row with at least one entry. Today's entry (Alt+T) opens today's journal, or starts one.
- **Writing:** a live preview. Headings, quotes, lists, checklists, rules, code, bold, italics, links, and colors render as you type, and the Markdown markup shows only on the line you are editing. Enter continues lists. Select text and click a color to color it.
- **Checklists:** type `- [ ] item` or use the checklist button. Click a box to check it off. Enter on a checked item starts a new unchecked one.
- **Pictures:** paste or drop an image file into the text, or use Insert > Image. Large photos are scaled to 1600 px. The picture sits on its own line, and its file is kept with the entry in a separate media store.
- **Mixtape:** Insert > Song for the mixtape… (or the Add song button above the page) takes a Spotify or YouTube link. Each entry can hold up to 12 songs, shown as a cassette with a track list. Play opens the service's own player, and Stop closes it. The title and artist are saved with the entry, so the cassette still shows with no connection.
- **Inline sketches:** Insert > Sketch between paragraphs puts a small drawing pad in the text. It has its own pencil, brush, highlighter, eraser, undo and clear, and uses the current ink color.
- **Stickers:** Insert > Sticker… opens the sticker sheet. Preset holds twelve stickers drawn for Quire. My stickers holds pictures added from disk and ink saved from the page (select some ink, then Make from selected ink). Pick a sticker, then click the page to stamp it. Drag a sticker to move it, a corner to resize it, or the round handle above it to turn it. From the keyboard, Enter stamps the sticker in the middle, + and - resize the selected sticker, and [ and ] turn it. Each sticker keeps its own copy of its picture, so removing one from My stickers leaves the pages as they are. The library is sealed by the passcode lock and included in backups.
- **Word count:** the status bar shows words and reading time (about 238 words a minute). Pictures, sketches and checkboxes do not count as words.
- **Focus mode:** F11 (or View > Focus mode) hides the menus, ribbon, and status bar, so only the page is left. A bar at the bottom shows the word count and save state. Esc or F11 leaves it. Options has three focus settings: typewriter scrolling (Writing tab) keeps the line you are typing at the middle of the window; a session word goal (Writing tab) fills a progress bar as you write; and ambient sounds (General tab) play rain, a café murmur, or a CRT hum while you write. The ambient sounds are synthesized in the browser, play only in focus mode, and need Sound effects on. A session starts when you open an entry or turn on focus mode.
- **Source mode:** View > Source mode shows every Markdown marker. Formatting still applies right away.
- **Drawing:** pencil, brush, highlighter, eraser, line, rectangle, ellipse, fill, and color picker. Stroke widths 1, 3, and 6. Undo and redo follow whichever surface you touched last. Right-click a swatch to change the page color. Without a mouse, Tab to the drawing layer (or an inline sketch) once a drawing tool is picked: the arrow keys move a crosshair, Space or Enter puts the pen down and lifts it, and Escape lifts it.
- **Saved searches:** type a search or pick a filter, then Save this search… in the sidebar. Saved searches keep the text and the one filter (a tag, notebook, kind, mood, or weather), and clicking one brings it back. Up to 12 are kept in this browser, and × removes one.
- **Random memory:** File > Random memory opens one past entry at random. Sealed time capsules, the first-run sample, and blank entries are left out, and today's entries come up only when nothing older exists.
- **Import:** File > Import entries… reads Day One's Journal.json (unzip the Day One export first) and Markdown files, including Quire's own Markdown export. Day One entries keep their date in the time zone they were written in, their tags, and their star. Importing the same file again adds nothing. Pictures and other media in an import are not brought in.
- **Links between entries:** type `[[Entry title]]` in an entry's text. The title is matched without regard to case, and a link follows the entry's title (or its first heading). Ctrl+click the link to open that entry, or start a new one with that title if none exists. A strip above the page reads Linked from, listing the entries that link to the open one; it refreshes when an entry opens. Sealed time capsules are never link targets or sources.
- **Export:** Markdown with front matter (a .zip with the drawing PNG when the entry has ink), drawing as PNG, print or save as PDF, and JSON backup and restore. Backups include version history.
- **Postcards:** File > Postcard… sets an entry on a stamped postcard. The front shows your drawing, else the first picture, else a plain scene, with the title and the start of the text on the back. Pick Stamped, Airmail, or Aero, then save the PNG or share it where the browser allows.
- **Version history:** Quire keeps a version every five minutes while you edit, when you leave an entry, and before a restore. Open File > Version history to preview a version's text, drawing and sketches, restore it, or delete it. Save version now keeps one by hand. The newest 30 versions are kept per entry. Pictures are kept with the entry until it is deleted, so every version can show its pictures.
- **Save status:** the dot in the title bar shows whether changes are pending, saving, saved, or failed to save.
- **Time capsules:** File > Seal as time capsule… seals the open entry until a day you pick: any day from tomorrow up to fifty years out, with quick picks for one month, six months, one year, and five years. A sealed letter shows on the list, tiles, calendar, and dashboard as a closed envelope with a countdown, and its text is not shown anywhere until then. When the day comes, the envelope reads Ready to open. Opening it plays a short unsealing, and the letter is an ordinary entry after that. With reminders on and notifications allowed, Quire sends one notice when a capsule is ready, while Quire is open. A sealed letter can be moved to a later day, or opened early after a confirm, from its notice. Sealing clears the editor. Version history for a letter is available once it is opened.
- **Passcode lock:** File > Passcode lock turns on a passcode. While it is on, entries, their versions and their pictures are encrypted in the browser, and Quire asks for the passcode each time it opens. Change the passcode or turn the lock off from the same menu, and File > Lock Quire now locks it again. There is no way to recover a forgotten passcode. Forgot it? on the lock screen erases every entry.
- **Look:** the Skin menu picks Aero (the default), Aero Basic, XP Luna, or Classic 98, and a Dark switch under it turns on the dark version of whichever skin is chosen. View > Options (Ctrl+,) holds the rest in one tabbed dialog: the writing font, a custom accent color (which recolors the selection and the title bar), Window animations, the Aero wallpaper, grid and snap, sound effects, the startup splash, and the Home cards. Format holds the color swap and resets. Keyboard shortcuts (F1) lists every key.

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
- A time capsule is sealed by Quire, not by encryption. Until it opens, the lists and editor never show its text, but the text is still in the browser's storage. Turn on the passcode lock to encrypt it as well. Arrival notices only go out while Quire is open, since nothing runs in the background.
- The passcode lock covers what Quire stores in the browser. Backup files and Markdown or PNG exports are not encrypted, and the lock does not lock itself after a period of inactivity; use Lock Quire now.
- The lock uses WebCrypto: PBKDF2-SHA-256 with 600,000 rounds to derive a key, and AES-GCM for each entry, picture, sketch, and version. Entry ids and version times stay readable so the store can index them.
- The Linked from strip is refreshed when you open an entry, not while you type, so a new link shows the next time you open its target.
- Import does not bring in pictures or drawings. Day One's photos live in its export zip, and a Quire Markdown export's drawing and picture files are not read back. Restore from backup brings those back.
- The print/PDF layout is close to the screen layout but can differ slightly.
- There is no zoom or lasso selection yet.
- Mixtapes are not in version history, Markdown export, or print. The JSON backup includes them.
- The player is the service's own embed, so Quire cannot pause or seek it. Next and Prev switch the song, and the cassette reels turn while a player is open.
- Each version keeps a full copy of the text, ink and sketch strokes, so a long entry with many versions takes more browser storage. Pictures are not copied into versions.

## Layout

```
index.html          app shell
src/app.js          controller: editor, drawing layer, saving, menus
src/livetext.js     live-preview editor (contenteditable over the Markdown source)
src/livemarkup.js   pure line and inline model for the live view
src/mixtape.js     song links for the mixtape: parsing, embed and lookup addresses, list rules (no DOM)
src/mixtape-view.js the cassette strip, its track list, the player, and the add-a-song dialog
src/media.js        pictures and sketches on an entry: image preparation, export bytes (no DOM for the helpers)
src/sketch.js       inline sketch pad: its toolbar and strokes
src/model.js        entry schema and helpers (no DOM)
src/markdown.js     safe Markdown renderer
src/prompts.js      daily writing prompts (pure, no DOM)
src/textops.js      pure text edits (lists, headings, color spans)
src/focus.js        focus mode rules: session word count, goal progress, typewriter offset (no DOM)
src/ambient.js      focus mode ambient sounds (rain, café, CRT hum), synthesized with Web Audio
src/drawing.js      ops, undo stack, flood fill, rendering
src/keypen.js       keyboard pen: sends pointer events from arrow keys and Space to a drawing canvas
src/storage.js      IndexedDB and memory stores behind one interface (entries, media, versions, and the lock record); seals rows when a vault is set
src/vault.js        passcode encryption: wrapped data key, AES-GCM rows, no DOM
src/lock.js         passcode dialogs: unlock screen, turn on, change, turn off, lock now, erase
src/capsule.js      time capsules: when an entry is closed, what a closed entry shows, and date rules (no DOM)
src/capsule-ui.js   seal dialog, sealed notice, unsealing animation, and envelope drawings
src/export.js       Markdown, ZIP, PNG, print, backup
src/postcard.js     postcards: three templates drawn on a canvas, and the postcard dialog
src/yearpixels.js   year in pixels: the day grid (no DOM) and the poster drawn to a canvas
src/versions.js     version rules: when a copy is kept and what it holds (no DOM)
src/history.js      version history dialog
src/skins.js        skin list, skin choice from saved prefs, and accent colors (no DOM)
src/options.js      Options dialog: the tabbed settings that the View and Skin menus used to hold
src/gadgets.js      sidebar gadgets: the catalog, saved order, clock hands, mood gauge, streak goal, word of the day (no DOM)
src/gadget-views.js sidebar gadgets: their panels, drag to reorder, the Add menu, and the slideshow
src/stickers.js     stickers: preset art, the sticker's geometry (turn, mirror, size), and picture loading
src/sticker-view.js the sticker sheet: presets, My stickers, and the picture and ink actions
styles/             app chrome, live editor, rendered-text styles, Vista extras, skins, the sidebar gadgets, the lock dialogs, and focus mode (loaded last)
tests/              node:test unit tests (including the passcode vault and the sealed store)
scripts/serve.js    dependency-free static server
```

## Path to accounts and sync

Entries already carry `id`, `createdAt`, `updatedAt`, and `version`, which is what a sync layer needs. To add accounts, implement a store with the same `list / get / save / remove` methods that talks to a server, then swap it in `createLocalStore()`. Local-first remains the default, and a sync queue can sit in front of the remote store.
