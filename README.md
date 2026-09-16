# ApplicationManager — desktop file manager
Private - Anabaptist Brotherhood internal use only

A Windows and Mac desktop app (built with Electron) that browses a real folder on your
computer, previews PDFs/JPGs/PNGs, and lets you tag and comment on each
file. Tags and comments are written directly into each file's own native
metadata (PDF Info dictionary Keywords/Subject; JPG/PNG Keywords/Comment) via
[ExifTool](https://exiftool.org), so nothing extra is created in the folder
and the tags/comments travel with the file itself. A file can hold multiple
comments — they're stored together in the same metadata field, separated
internally so they round-trip cleanly.

## Prerequisites

- [Node.js](https://nodejs.org) (LTS version). This includes `npm`, which
  you'll use to install dependencies and build the app.

## 1. Run it in development mode

Open a terminal (Command Prompt or PowerShell) in this folder and run:

```
npm install
npm start
```

This installs Electron and launches the app in a window. Use "Choose folder"
to pick a directory containing PDFs, JPGs, or PNGs.

## 2. Build a standalone Windows app (.exe installer)

Once you're happy with it, build an installer:

```
npm run dist
```

This uses `electron-builder` to produce a Windows installer (NSIS `.exe`) in
the `dist/` folder. The first run needs an internet connection, since
electron-builder downloads a small packaging tool. Double-click the generated
installer to install ApplicationManager like any other Windows app — it'll show up in
your Start Menu and can be uninstalled from Windows Settings normally.

## 3. Build a standalone Mac app (.dmg/.zip)

Mac installers must be built on a Mac (electron-builder can't cross-build them
from Windows). On a Mac, run:

```
npm run dist:mac
```

This produces a `.dmg` and `.zip` in the `dist/` folder. The build isn't
signed with a paid Apple Developer ID, so on first launch macOS Gatekeeper
will warn that the app is from an unidentified developer. To open it anyway:

- Right-click (or Control-click) the app → **Open** → confirm in the dialog
  that appears, **or**
- **System Settings → Privacy & Security** → scroll down → **Open Anyway**.

This is only needed once per machine, on the very first launch.

Because the build isn't signed with a paid Developer ID, in-app auto-update
also can't silently install a new version on Mac (that part of
electron-updater requires real signing). Mac's "Update" button still detects
when a new version is out, but clicking it just opens the GitHub release page
so the new `.dmg` can be downloaded and installed the normal way — the same
Gatekeeper "Open Anyway" step applies again on that reinstall. Windows is
unaffected and keeps installing updates in-app.

## Releasing (both platforms, from either OS)

Releases are automated via [.github/workflows/release.yml](.github/workflows/release.yml).
Bump `"version"` in `package.json`, commit, then push a matching tag:

```
git tag v1.2.2
git push origin v1.2.2
```

GitHub Actions then builds the Windows `.exe` (on a Windows runner) and the
Mac `.dmg`/`.zip` (on a macOS runner) and publishes both to the GitHub Release
for that tag — no local Mac needed. `electron-updater` picks the right asset
per platform automatically, so this can be run entirely from Windows.

## Notes

- Tags and comments are written into each file's native metadata, so they
  move, copy, and rename with the file automatically — even outside the app.
  Files already tagged elsewhere (Windows Explorer's "Tags" field, Adobe
  apps, etc.) will show those tags in ApplicationManager too.
- Editing metadata rewrites the file in place. `-overwrite_original` is used
  so ExifTool doesn't leave a `_original` backup copy behind.
- The predefined-tag vocabulary (names, colors, keyboard shortcuts — managed
  via "Manage" in the sidebar) is stored in a hidden `.catalog-tags.json` file
  written into the chosen folder itself, so it travels with the folder rather
  than staying tied to one machine's install of the app. It's skipped by the
  file grid and folder tree like any other dotfile.
- Review mode's "Application" tab (the Member Application data-entry form)
  saves its answers into a hidden per-file sidecar next to the source file
  itself, named `.<filename>.appform.json` — e.g. `Smith Family Scan.pdf`
  gets a `.Smith Family Scan.pdf.appform.json` alongside it. It's skipped by
  the grid/folder tree like any other dotfile, and moves/renames/deletes
  (and Undo) of the source file bring it along automatically. Renaming or
  moving that PDF from outside the app (e.g. Windows Explorer) orphans the
  sidecar — reopen the review folder in place afterward rather than
  drag-copying it elsewhere, since dragging a folder in also leaves any
  sidecars already inside it behind. This sidecar-per-file approach has no
  real-time conflict resolution: two people editing the same application at
  the same moment on a shared OneDrive folder will get whatever OneDrive's
  own conflict-copy behavior produces, same as already applies to
  `.catalog-tags.json` above.
- The rail's "Online Applications" section connects the folder to a Gravity
  Forms-powered web form (via its REST API, using a consumer key/secret
  entered once through "Connect") so submissions can be imported alongside
  scanned ones. The connection, form choice, and field mapping are saved into
  another hidden per-folder file, `.api-config.json` — same reasoning as
  `.catalog-tags.json`: every computer pointed at the shared folder picks up
  the same connection automatically. Mapping a field to "Add as new field"
  adds it to every application's form (scanned or online) under "Additional
  Fields", not just imported ones — that's what keeps this one shared form
  rather than two separate ones. "Import" drops each new submission into an
  `Inbox` subfolder (created if missing) as an auto-generated summary PDF
  plus its own `.appform.json` sidecar, pre-filled per the mapping, and tags
  it `API` so it's easy to tell apart from a scanned application at a glance.
- Deleting a file (with a confirmation prompt first), moving a file, editing
  its tags/comments, or renaming/deleting a predefined tag in the tag manager
  can all be undone with the "Undo" button in the top bar (or Ctrl+Z), one step
  at a time. A deleted file is only gone for good once the app is closed and
  reopened — until then it's held out of sight so Undo can bring it back.
  Checkbox-select several files to move or delete them as one batch (and undo
  the whole batch as one step) from the bulk-actions bar above the grid.
- "About" in the sidebar (below the version number) shows the app version,
  update status, a short description, credits, and a link to this repo.
- The app icon (window/taskbar icon, and the packaged Windows/Mac
  installer's icon) is a single `build/icon.png`. `npm start`'s
  `BrowserWindow` points at it directly; `npm run dist`/`dist:mac` convert
  it into the platform-specific `.ico`/`.icns` automatically since
  `package.json`'s `build.win`/`build.mac` don't override `icon`.
- Only `.pdf`, `.jpg`, `.jpeg`, and `.png` files are shown.
- "All files" browses the chosen folder and every subfolder recursively. The
  sidebar lists the subfolder tree underneath it — click a subfolder to
  narrow the grid down to it (and its own subfolders); click "All files"
  again to clear the filter. Folders and files starting with a dot (e.g.
  `.git`) are skipped.
