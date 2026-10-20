# ApplicationManager — application holding space and member tracker
Private - Anabaptist Brotherhood internal use only

A Windows and Mac desktop app (built with Electron) that holds Member
Applications — scanned paper ones and ones imported from the online form —
while they wait to be entered into the membership software, and tracks each
one through entry and member-card mailing per plan (MAAP, AMCA, and any
added later). It browses a real folder on your computer, previews
PDFs/JPGs/PNGs, and lets you tag and comment on each file. Tags and comments are written directly into each file's own native
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
- Each application's record — Plan, Name, Member ID, Application Entry
  Date, Member Start Date, and Member Card Sent (the date the card was
  marked sent is recorded automatically) — is edited in the
  preview pane's Application section or straight in the Tracker, and saved
  into a hidden per-file sidecar next to the source file itself, named
  `.<filename>.appform.json` — e.g. `Smith Family Scan.pdf` gets a
  `.Smith Family Scan.pdf.appform.json` alongside it. A sidecar written by
  version 0.1.x (the old full paper-form schema) still opens: its primary
  member's name carries over, and the rest is kept untouched under
  `legacy` in the same file. It's skipped by
  the grid/folder list like any other dotfile, and the app's own moves
  (into Entered or Inbox), deletes, and Undo bring it along automatically. Renaming or
  moving that PDF from outside the app (e.g. Windows Explorer) orphans the
  sidecar — reopen the review folder in place afterward rather than
  drag-copying it elsewhere, since dragging a folder in also leaves any
  sidecars already inside it behind.
- Shared OneDrive folder, several people at once: every edit saves only the
  field(s) it changed, merged into the record as it is on disk at that
  moment (and Undo puts back only those fields), so two people working on
  different applications — or different fields of the same one — never
  overwrite each other, even from a screen that hasn't refreshed yet. The
  app rescans every 5 minutes and whenever its window comes back into focus
  (at most once a minute), so others' changes show up without a manual
  refresh. A write that hits a file OneDrive has momentarily locked is
  retried, and one that still fails says so instead of being lost. An edit
  to a row someone else deleted is refused rather than bringing the row
  back. What's left is two people changing the *same field* of the *same
  application* within the same few seconds: the later save wins, or
  OneDrive keeps both as a conflict copy (a stray copy of a record-only row
  would show up as a duplicate tracker row, which can simply be deleted).
- Plans: which plan an application belongs to is a field on its own record,
  so the rail's Plans list (All plans / each plan / No plan) filters the
  Files, Tracker, and Summary views alike. The list of plans lives in a
  hidden `.plans.json` in the folder (seeded with MAAP and AMCA; "Manage"
  adds more). A freshly scanned file has no plan until someone gives it one
  — the multi-select pane can set the plan on a whole batch at once.
- Tracker: the old Member Tracker spreadsheet, live — one row per
  application in the selected plan, every cell editable in place, sortable,
  filterable by status (Awaiting entry → Pending card → Complete, worked
  out from the entry date and card checkbox). Rows can also exist without
  any file: members carried over from the old spreadsheet (Plans > Manage >
  Import spreadsheet…, a one-time import that skips rows already present)
  or added by hand with "Add row". Those live one per file in a hidden
  `.records` folder, so two people editing different rows on a shared
  OneDrive folder never collide. A spreadsheet's Notes (or Comments) column
  comes in as a comment signed "Imported from <file name>" — the same goes
  for anything typed into the Notes field older versions had.
- Setting an application's entry date (in the preview pane, a Tracker cell,
  or "Entered today" on a batch) moves its file into an `Entered` subfolder
  (created if missing), so the folder tree shows at a glance what's been
  fully processed. Clearing the date — or undoing it — moves the file back
  to `Inbox`. A same-named file already there gets a " (1)" suffix rather
  than being overwritten.
- Summary: per plan, the running totals plus the old spreadsheet's monthly
  (for a chosen year) and weekly (last 10 weeks) tables, counted by
  Application Entry Date. "Export to Excel" (Tracker or Summary) saves a
  workbook with a Members sheet and a Summary sheet per plan in scope; the
  Members sheet's Comments column holds each row's comments, and imports
  back in as separate comments.
- The rail's "Online Applications" section connects the folder to a Gravity
  Forms-powered web form (via its REST API, using a consumer key/secret
  entered once through "Connect") so submissions can be imported alongside
  scanned ones. The connection, form choice, mapping, and import history are
  saved into another hidden per-folder file, `.api-config.json` — same
  reasoning as `.catalog-tags.json`: every computer pointed at the shared
  folder picks up the same connection automatically. Only three things are
  mapped ("Mapping"): which online answers hold the name, the member ID,
  and the member start date — plus which plan imports are filed under.
  "Import" drops each new submission into an `Inbox` subfolder (created if
  missing) as a PDF listing every answered field under the online form's own
  labels and sections, plus its `.appform.json` record, and tags it `API` so
  it's easy to tell apart from a scanned application at a glance. Saving a
  changed mapping fills in any already-imported application missing one of
  those values, without overwriting anything already entered.
- Deleting a file (with a confirmation prompt first), setting its entry
  date (and the move that goes with it), editing its tags/comments, or renaming/deleting a predefined tag in the tag manager
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
- "All files" browses the chosen folder and every subfolder recursively.
  Underneath it the sidebar always lists `Inbox` and `Entered` (plus any
  other top-level folder that holds files) — click one to narrow the grid
  down to it; click "All files" again to clear the filter. Folders and files
  starting with a dot (e.g. `.git`) are skipped.
- Nothing stays loose at the top of the workspace: a file dragged into the
  app goes to `Inbox`, and one dropped at the root from outside (a scanner,
  Explorer, another computer's sync) is moved on the next scan — to `Inbox`,
  or straight to `Entered` if it already has an entry date. This only
  happens in a folder that already has an `Inbox` or `Entered`, so opening
  some other folder by mistake never rearranges it.
