# Quire desktop app

The desktop app is the same web app in a native window. Tauri v2 hosts the
bundled files (`dist-desktop/`) in the system WebView (WebView2 on Windows,
WebKit on macOS and Linux). There is no Chromium or Node runtime in the
installer, so it stays small. Entries stay in the WebView's IndexedDB, the same
store the browser uses, so the passcode lock and offline use work unchanged.

## Layout

| Path | What it is |
| --- | --- |
| `src-tauri/src/lib.rs` | Window setup, the desktop flag, plugin registration |
| `src-tauri/src/main.rs` | Entry point, calls `quire_lib::run()` |
| `src-tauri/tauri.conf.json` | App identity, bundle targets, installer settings |
| `src-tauri/capabilities/` | Permissions granted to the window, one file per feature |
| `src-tauri/icons/`, `src-tauri/installer/` | App icons, NSIS header and sidebar art |
| `scripts/build-desktop.js` | Copies the page files into `dist-desktop/` (`npm run desktop:web`) |
| `src/desktop.js` | Detection helpers for page code |

The web app has no npm runtime dependencies. `@tauri-apps/cli` is a dev-only
tool, pinned to an exact version.

## Detecting the desktop shell (page code)

The shell injects `window.__QUIRE_DESKTOP__` before any page script runs:

```js
Object.freeze({ shell: 'tauri', version: '0.1.0', platform: 'windows' }) // or 'macos', 'linux'
```

In the browser and the installed PWA the flag is absent.

```js
import { isDesktop, desktopShell, desktopInvoke } from './desktop.js';

if (isDesktop()) { /* desktop only */ }
const shell = desktopShell(); // { shell, version, platform } or null
await desktopInvoke('plugin:opener|open_url', { url }); // rejects outside the shell
```

`markDesktopShell()` (called at startup) also sets `data-shell="desktop"` on
`<html>`, so CSS can adapt with `:root[data-shell="desktop"]`.

Do not depend on `window.Quire`. Use `__QUIRE_DESKTOP__` or `src/desktop.js`.

## Adding native features (one feature, one set of files)

Each feature is a Tauri plugin defined in this crate. Give it a name, such as
`fonts`, and use that name everywhere below. Plugin names use lowercase letters
and digits only, with no hyphens or underscores (`quireintents`, not
`quire-intents`). The Rust module, the file names and the plugin name must all match,
and a Rust module name cannot contain a hyphen. Commands called from page code
need a permission, which build.rs generates from a small list. Commands that only
Rust calls need no list.

1. **Rust plugin:** `src-tauri/src/<name>.rs` exports
   `pub fn init<R: Runtime>() -> TauriPlugin<R>`, built with
   `tauri::plugin::Builder::new("<name>").invoke_handler(tauri::generate_handler![...])`.
   See `src-tauri/src/app.rs` for a working example.
2. **Command list:** `src-tauri/features/<name>.commands`, one command name per
   line in snake_case (`#` starts a comment). build.rs reads every file in
   `features/` and generates `<name>:allow-<command>` and `<name>:default` for it.
   Do not edit build.rs.
3. **Registration:** in `src-tauri/src/lib.rs`, add `mod <name>;` and
   `.plugin(<name>::init())`.
4. **Capability:** `src-tauri/capabilities/<name>.json` grants the feature to the
   `main` window, for example `"permissions": ["<name>:default"]`. Window
   permissions for the chrome (for example `core:window:allow-start-dragging`) go
   in their own capability file, one per feature.
5. **Page code:** `src/<name>.js` calls `desktopInvoke('plugin:<name>|<command>', args)`,
   after an `isDesktop()` check.

Each thread touches only its own files, plus one `mod` line and one `.plugin` line
in lib.rs. The web app is not changed for a native-only feature.

## Window behavior

- External links (any `http(s)` URL that is not Quire's own) open in the default
  browser through `tauri-plugin-opener`. The Quire window stays on the app.
- The service worker is not registered in the desktop shell. The bundle is
  already on the device.

## Building

Requirements: Node 22 and Rust stable (1.77.2 or newer). Windows and macOS are
the release targets. Linux is not packaged.

```sh
npm install           # installs @tauri-apps/cli (dev only)
npm run desktop:dev   # opens the app against npm start on port 4173
npm run desktop:web   # copies the page files into dist-desktop/
npm run desktop:build # installer for this OS (NSIS on Windows)
```

Build outputs are in `src-tauri/target/release/bundle/`. On Windows the
installer is `nsis/Quire_<version>_x64-setup.exe`. It installs for the current
user only, so there is no administrator prompt. It downloads WebView2 only when
the computer does not have it.

## Releases

Push a version tag (`v0.1.0`) to run `.github/workflows/desktop-release.yml`. It
builds the Windows installer and two macOS disk images, one per architecture,
and attaches them to a GitHub Release. Asset names follow Tauri's defaults and
carry the architecture:

- `Quire_<version>_x64-setup.exe` (Windows, current user install)
- `Quire_<version>_aarch64.dmg` (macOS, Apple silicon)
- `Quire_<version>_x64.dmg` (macOS, Intel)

Each release also gets `latest.json` and signed update archives. The in-app
updater reads `https://github.com/FreezingShock/Quire/releases/latest/download/latest.json`.

### Updater key (one time, optional)

The in-app updater checks that each update was signed with a Tauri updater key.
This is separate from OS code signing. Until the key is set up, releases build
normally and publish installers only, with no `latest.json`. Setting it up turns
on the updater with no workflow change. Create the key once, and keep the private key safe:

1. On any computer with Node 22, run `npx @tauri-apps/cli@2.12.4 signer generate -w quire-updater.key`
   and choose a password. It writes `quire-updater.key` (private) and
   `quire-updater.key.pub` (public).
2. In GitHub, open the repository, then Settings, Secrets and variables, Actions, and add two
   repository secrets: `TAURI_SIGNING_PRIVATE_KEY` (the whole contents of `quire-updater.key`)
   and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (the password).
3. Put the contents of `quire-updater.key.pub` into `plugins.updater.pubkey` in
   `src-tauri/tauri.conf.json` (it is empty until then). The public key is not secret.
   The workflow turns updater signing on automatically when the secret exists.
4. Delete the local private key once the secrets are set. If the private key or its
   password is lost, installed copies can no longer receive updates, and the key
   must be replaced in a manual install.

Builds are **not code-signed by the OS** yet. Windows will show a SmartScreen warning ("More info",
then "Run anyway"). On macOS, Gatekeeper blocks the first launch with a message
that Quire cannot be opened. Since macOS 15 the right-click Open shortcut no
longer bypasses this, so the user opens System Settings, Privacy & Security,
scrolls to the Quire message, and chooses Open Anyway. The updater key does not
change either of these. Signing needs:

- Windows: an OV or EV code-signing certificate (EV builds avoid the warning
  sooner), used through `signCommand` or a signing service.
- macOS: an Apple Developer Program membership ($99 a year), a Developer ID
  Application certificate, and notarization (Tauri runs it when the Apple ID,
  app-specific password and team ID are set as secrets). Notarized builds open
  with no warning.

## Data location

Data lives under the identifier `com.quire.desktop`. Changing the identifier,
or the `http://tauri.localhost` origin on Windows, moves where IndexedDB lives,
so the entries would look empty. Do not change either without a migration.
