# Birdflop Server Manager

A cross-platform desktop app for creating and managing local Minecraft test servers. Built with Electron + React + TypeScript + Vite + Tailwind v4.

## Development

```bash
npm install          # also runs electron's postinstall to fetch its binary
npm run dev          # launch with HMR
npm run typecheck    # tsc for main/preload + renderer
npm run build        # bundle main/preload/renderer into out/
```

If `node_modules` is wiped and the Electron binary doesn't download, run `node node_modules/electron/install.js` (or `npm rebuild electron`).

## Packaging

```bash
npm run dist         # current platform installer
npm run dist:win     # NSIS installer (Windows)
npm run dist:mac     # dmg (macOS)
npm run dist:linux   # AppImage + deb (Linux)
npx electron-builder --dir   # unpacked app only (fast config check)
```

### macOS (unsigned builds)

Release builds aren't signed with an Apple Developer ID or notarized, so macOS
Gatekeeper flags them. To avoid the misleading "app is damaged" error on Apple
Silicon, `build/afterPack.js` **ad-hoc signs** the `.app` (via `codesign --sign -`)
during the macOS build. Users then open it once with **right-click → Open** (or
System Settings → Privacy & Security → "Open Anyway").

If a build still won't open (e.g. it lost its signature in transit), clear the
download quarantine flag:

```bash
xattr -dr com.apple.quarantine "/Applications/Birdflop Server Manager.app"
```

For a warning-free experience, set `CSC_LINK` / `CSC_KEY_PASSWORD` (Developer ID
cert) plus Apple notarization secrets — electron-builder then signs + notarizes
automatically and the ad-hoc step is skipped.


## Dev / test environment flags (main process)

These are gated behind env vars and never run in normal use:

- `BSM_ROOT=<dir>` — override the data root without touching real config.
- `BSM_THEME=light|dark` — force a theme.
- `BSM_SCREENSHOT=<png>` `BSM_DRIVE=<js>` — render the UI (optionally running a JS snippet) and capture a screenshot, then exit.
- `BSM_ICON=<png>` — regenerate the brand app icon.
- `BSM_SELFTEST=1` — run provider/Java integration checks. Combine with `BSM_TESTJAVA=<major>`, `BSM_TESTCREATE=1`, `BSM_TESTRUN=1`, `BSM_TESTMODRINTH=1`.
