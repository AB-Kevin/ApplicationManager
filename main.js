const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const { execFileSync, spawn } = require("child_process");
const { exiftool } = require("exiftool-vendored");
const { autoUpdater } = require("electron-updater");
const { PDFDocument, StandardFonts, degrees } = require("pdf-lib");
const { makeBlankAppForm, makeBlankHouseholdMember, DEFAULT_REQUIRED_FIELDS } = require("./renderer/application-form.js");

const ACCEPTED_EXT = [".pdf", ".jpg", ".jpeg", ".png"];

let mainWindow;

// Matches styles.css's --surface-page/--text-body for each theme (see
// [data-theme="dark"]/[data-theme="midnight"]) -- used for the BrowserWindow's
// own backgroundColor (painted before any HTML/CSS loads, so a dark/midnight
// user gets that color from the very first frame instead of a flash of white
// while renderer.js's init() reads settings and calls applyTheme()) and, on
// Windows, the native titleBarOverlay's button colors -- see resolveTitleBarOverlay.
const THEME_BACKGROUNDS = { light: "#FFFFFF", dark: "#1b1c1e", midnight: "#232527" };
const THEME_OVERLAY_SYMBOLS = { light: "#231f20", dark: "#ececec", midnight: "#e7e9e8" };

// "system" (the default -- see get-theme's own null fallback and the
// renderer's init()) has no CSS/background of its own; it resolves to plain
// light or dark by way of the OS's own preference, mirrored one-to-one
// (never midnight, which is only ever reached by an explicit choice -- see
// renderer.js's own resolveTheme()). nativeTheme.shouldUseDarkColors is
// Electron's synchronous read of that OS preference, usable here in the
// main process before any window/renderer exists yet, unlike the
// renderer's window.matchMedia equivalent. readSettings() is defined
// further down this file but usable here regardless -- function
// declarations hoist.
function resolveThemeName(pref) {
  return pref === "system" || !pref ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : pref;
}

function resolveThemeBackground(pref) {
  return THEME_BACKGROUNDS[resolveThemeName(pref)] || THEME_BACKGROUNDS.light;
}

// Windows only -- see createWindow()'s IS_WINDOWS branch. height:44 matches
// the custom titlebar's own height (styles.css's .bm-titlebar) so the native
// buttons sit centered in it rather than a mismatched OS-default size.
function resolveTitleBarOverlay(pref) {
  const theme = resolveThemeName(pref);
  return { color: THEME_BACKGROUNDS[theme] || THEME_BACKGROUNDS.light, symbolColor: THEME_OVERLAY_SYMBOLS[theme] || THEME_OVERLAY_SYMBOLS.light, height: 44 };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: resolveThemeBackground(readSettings().theme),
    autoHideMenuBar: true,
    // A plain PNG works fine here (Electron's nativeImage decodes it
    // directly) -- an .ico is only needed for the packaged Windows
    // installer/exe resource, which electron-builder generates on its own
    // from this same build/icon.png at package time (see the "build" block
    // in package.json -- no win.icon/mac.icon override needed).
    icon: path.join(__dirname, "build", "icon.png"),
    // Native OS window controls inset into our own custom title bar, on
    // whichever platform offers a way to do that -- everything else about
    // the custom bar (the drag region, the title text) is unchanged and
    // still ours; only the three buttons themselves become the OS's, and
    // renderTitlebar()'s IS_MAC/IS_WINDOWS checks skip drawing its own
    // redundant ones wherever this applies. macOS: real traffic lights via
    // hiddenInset. Windows: titleBarOverlay -- real Fluent caption buttons
    // (Snap Layouts included) themed to match the current app theme, kept
    // in sync on theme changes by the set-theme handler and the
    // nativeTheme "updated" listener below. Anywhere else (Linux), neither
    // API exists, so frame:false + our own drawn buttons stays exactly as
    // it was before any of this.
    ...(IS_MAC
      ? { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 16, y: 14 } }
      : IS_WINDOWS
        ? { titleBarStyle: "hidden", titleBarOverlay: resolveTitleBarOverlay(readSettings().theme) }
        : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // The renderer draws its own title bar (see the design refresh) since the
  // window is frameless; mirror maximize/unmaximize back to it so the
  // restore/maximize glyph can reflect the real window state.
  mainWindow.on("maximize", () => sendWindowState());
  mainWindow.on("unmaximize", () => sendWindowState());
}

// Keeps Windows's native titleBarOverlay in sync with OS-level dark/light
// changes while the app is running (e.g. Windows switching modes at
// sunset), mirroring the renderer's own matchMedia listener -- but only
// when the stored preference is "system" (or unset); an explicit
// Light/Dark/Midnight choice must never be overridden by this.
nativeTheme.on("updated", () => {
  if (!IS_WINDOWS || !mainWindow) return;
  const pref = readSettings().theme;
  if (pref === "system" || !pref) mainWindow.setTitleBarOverlay(resolveTitleBarOverlay(pref));
});

function sendWindowState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("window-state", { maximized: mainWindow.isMaximized() });
  }
}

ipcMain.handle("window-minimize", () => {
  mainWindow?.minimize();
});
ipcMain.handle("window-maximize-toggle", () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.handle("window-close", () => {
  mainWindow?.close();
});
ipcMain.handle("window-is-maximized", () => !!mainWindow?.isMaximized());

// Deleted files land here instead of being unlinked outright, so the renderer's
// Undo stack can restore one. The stack only lives in memory, so anything still
// sitting here is unreachable the moment the app restarts — safe to purge for
// good on every launch, before any new deletes have a chance to land in it.
const TRASH_DIR = path.join(app.getPath("userData"), "trash");

app.whenReady().then(() => {
  try {
    fs.rmSync(TRASH_DIR, { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  exiftool.end();
});

// --- Auto-update -----------------------------------------------------------
// Driven entirely from the renderer's "Check for Updates" button — we never
// check or download silently in the background, so nothing happens on the
// user's bandwidth/disk without them asking for it first.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;
// Lets "Check for Updates" actually hit GitHub when running unpacked (npm
// start), reading dev-app-update.yml instead of silently no-op'ing. Has no
// effect on a packaged build — those always use the real app-update.yml
// electron-builder generates, regardless of this flag.
autoUpdater.forceDevUpdateConfig = true;

// Mac builds are only ad-hoc signed (no paid Apple Developer ID), which is
// enough for the app to launch but not enough for Squirrel.Mac — the
// mechanism electron-updater uses under the hood on macOS — to silently
// install an update; it requires a real Developer ID signature to do that.
// So on Mac, "checking for updates" still works (it just reads the version
// info electron-builder publishes), but instead of downloading/installing
// in-app, we hand the user off to the GitHub release page to grab the new
// .dmg themselves.
const IS_MAC = process.platform === "darwin";
const IS_WINDOWS = process.platform === "win32";
const REPO_OWNER = "AB-Kevin";
const REPO_NAME = "ApplicationManager";
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const RELEASES_URL = `${REPO_URL}/releases/latest`;

function sendUpdateStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update-status", status);
  }
}

autoUpdater.on("checking-for-update", () => {
  sendUpdateStatus({ state: "checking" });
});
autoUpdater.on("update-available", (info) => {
  if (IS_MAC) {
    sendUpdateStatus({ state: "available-manual", version: info.version });
  } else {
    sendUpdateStatus({ state: "available", version: info.version });
  }
});
autoUpdater.on("update-not-available", () => {
  sendUpdateStatus({ state: "not-available" });
});
autoUpdater.on("download-progress", (progress) => {
  sendUpdateStatus({ state: "downloading", percent: Math.round(progress.percent) });
});
autoUpdater.on("update-downloaded", (info) => {
  sendUpdateStatus({ state: "downloaded", version: info.version });
});
autoUpdater.on("error", (err) => {
  sendUpdateStatus({ state: "error", message: err?.message || String(err) });
});

ipcMain.handle("check-for-updates", async () => {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    sendUpdateStatus({ state: "error", message: err?.message || String(err) });
  }
});

ipcMain.handle("download-update", async () => {
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    sendUpdateStatus({ state: "error", message: err?.message || String(err) });
  }
});

ipcMain.handle("quit-and-install", () => {
  autoUpdater.quitAndInstall();
});

ipcMain.handle("open-releases-page", () => {
  shell.openExternal(RELEASES_URL);
});

ipcMain.handle("open-repo-page", () => {
  shell.openExternal(REPO_URL);
});

ipcMain.handle("get-app-version", () => app.getVersion());

// --- Roll back to previous version ------------------------------------------
// electron-updater only knows how to move forward to the newest release on the
// feed, so "roll back" is done by hand against the GitHub Releases API:
// find whichever release GitHub currently marks "latest", take the one
// published right before it, then (Windows) download and launch its
// installer, or (Mac, same ad-hoc-signing limitation as the normal update
// path above) hand the user that release's page to install by hand.
function sendRollbackStatus(status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("rollback-status", status);
  }
}

async function fetchGithubJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ApplicationManager" },
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status} for ${url}`);
  return res.json();
}

async function findPreviousRelease() {
  const latest = await fetchGithubJson(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`);
  const all = await fetchGithubJson(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases`);
  const idx = all.findIndex((r) => r.id === latest.id);
  if (idx === -1 || idx + 1 >= all.length) {
    throw new Error("Couldn't find a release before the current latest version.");
  }
  return all[idx + 1];
}

async function downloadToFile(url, destPath, onProgress) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;
  const out = fs.createWriteStream(destPath);
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out.write(value);
      received += value.length;
      if (total) onProgress?.(Math.round((received / total) * 100));
    }
  } finally {
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  }
}

ipcMain.handle("rollback-to-previous-version", async () => {
  try {
    sendRollbackStatus({ state: "checking" });
    const previous = await findPreviousRelease();
    const version = previous.tag_name.replace(/^v/, "");

    if (IS_MAC) {
      shell.openExternal(previous.html_url);
      sendRollbackStatus({ state: "manual", version });
      return;
    }

    const asset = previous.assets.find(
      (a) => a.name.toLowerCase().endsWith(".exe") && !a.name.toLowerCase().endsWith(".blockmap")
    );
    if (!asset) throw new Error(`No Windows installer found on release ${previous.tag_name}.`);

    sendRollbackStatus({ state: "downloading", version, percent: 0 });
    const destDir = path.join(app.getPath("temp"), "applicationmanager-rollback");
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(destDir, asset.name);
    await downloadToFile(asset.browser_download_url, destPath, (percent) => {
      sendRollbackStatus({ state: "downloading", version, percent });
    });

    sendRollbackStatus({ state: "installing", version });
    // Same handoff as autoUpdater.quitAndInstall() above: launch the (older)
    // installer detached, then quit so it's free to replace files this
    // process is currently holding open.
    spawn(destPath, [], { detached: true, stdio: "ignore" }).unref();
    app.quit();
  } catch (err) {
    sendRollbackStatus({ state: "error", message: err?.message || String(err) });
  }
});

// Tags and comments are stored as native file metadata (no sidecar file):
//   - PDFs: the document's own Info dictionary (Keywords / Subject).
//   - JPG/PNG: embedded Keywords for tags, the Comment tag (JPEG COM segment /
//     PNG "Comment" text chunk) for comments.
function toStringArray(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value.map((v) => String(v)) : [String(value)];
  return arr.map((v) => v.trim()).filter(Boolean);
}

// None of these underlying fields natively support multiple values, so a file's
// comments are stored as a single string joined with a distinctive separator and
// split back apart on read. The separator is chosen to still read reasonably if
// the file is inspected with another metadata tool.
const COMMENT_SEP = "\n\n----------\n\n";

function serializeComments(comments) {
  return (comments || [])
    .map((c) => (c || "").trim())
    .filter(Boolean)
    .join(COMMENT_SEP);
}

function parseComments(raw) {
  if (!raw) return [];
  return String(raw)
    .split(COMMENT_SEP)
    .map((c) => c.trim())
    .filter(Boolean);
}

async function readFileMeta(full, ext) {
  try {
    if (ext === ".pdf") {
      // Some PDFs (notably ones that have been through a scan/print-to-PDF
      // driver, e.g. Foxit's PDF printer) carry an embedded XMP metadata
      // stream alongside the Info dictionary — often with an empty
      // dc:subject/dc:description left behind by that driver. exiftool's
      // default read pulls in every tag group, and when an unqualified
      // "Keywords"/"Subject" name exists in more than one group, it can
      // resolve to that other (empty) group's value instead of PDF's, even
      // though we explicitly asked for "-PDF:Keywords"/"-PDF:Subject". The
      // write always lands correctly in the Info dictionary, so this only
      // shows up on the read: the tag/comment looks like it was never saved
      // the next time the folder is refreshed, even though it's still on
      // disk. "-G" makes exiftool return fully group-qualified keys (e.g.
      // "PDF:Keywords") so the lookup below can never be shadowed by another
      // group's same-named tag.
      const tags = await exiftool.read(full, ["-G", "-PDF:Keywords", "-PDF:Subject"]);
      return { tags: toStringArray(tags["PDF:Keywords"]), comments: parseComments(tags["PDF:Subject"]) };
    }
    const tags = await exiftool.read(full);
    return { tags: toStringArray(tags.Keywords), comments: parseComments(tags.Comment) };
  } catch {
    return { tags: [], comments: [] };
  }
}

async function writeFileMeta(full, ext, tags, comments) {
  const serialized = serializeComments(comments);
  if (ext === ".pdf") {
    // PDF:Keywords/PDF:Subject are plain string fields in the Info dictionary
    // (not exiftool List-type tags), so keywords are joined into one string
    // ourselves rather than handed over as an array, same as before. The
    // important change is passing values through exiftool-vendored's
    // object-based write API instead of building raw `-Tag=value` strings into
    // writeArgs by hand: exiftool runs with `-stay_open True -@ -`, meaning
    // arguments are sent to it one per line, and a hand-built writeArgs string
    // goes in completely unescaped. COMMENT_SEP embeds literal newlines, and so
    // does any comment the user typed across multiple lines, so an argument
    // like `-PDF:Subject=first\n\nsecond` would silently split into several
    // arguments and corrupt (in practice: reject) the write. The object API
    // HTML-encodes values like these before building its own arguments, which
    // is exactly what already made this safe for the JPG/PNG branch below.
    await exiftool.write(
      full,
      { "PDF:Keywords": tags.join(", "), "PDF:Subject": serialized },
      { writeArgs: ["-overwrite_original"] }
    );
    return;
  }
  await exiftool.write(full, { Keywords: tags, Comment: serialized }, { writeArgs: ["-overwrite_original"] });
}

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Remembers the last folder opened so the app can reopen it automatically on
// next launch. Lives in the app's own userData directory, not the catalog folder.
const LAST_FOLDER_FILE = path.join(app.getPath("userData"), "last-folder.json");

ipcMain.handle("get-last-folder", async () => {
  try {
    const { folder } = JSON.parse(fs.readFileSync(LAST_FOLDER_FILE, "utf8"));
    // Confirm it's still there — a removable drive or deleted folder should fall
    // back to the normal "no folder open" state rather than error on launch.
    if (folder && fs.statSync(folder).isDirectory()) return folder;
  } catch {}
  return null;
});

ipcMain.handle("set-last-folder", async (event, folder) => {
  fs.mkdirSync(path.dirname(LAST_FOLDER_FILE), { recursive: true });
  fs.writeFileSync(LAST_FOLDER_FILE, JSON.stringify({ folder }), "utf8");
  return true;
});

// Small per-device settings that aren't tied to any one catalog folder — the
// name signed onto new comments (see commentAttributionLine in the renderer)
// and the chosen theme (light/dark/midnight — see applyTheme). Kept in its
// own file rather than folded into LAST_FOLDER_FILE above since that one is
// conceptually unrelated.
const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const settings = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings), "utf8");
  return true;
}

ipcMain.handle("get-commenter-name", () => readSettings().commenterName || null);

ipcMain.handle("set-commenter-name", (event, name) => writeSettings({ commenterName: name }));

ipcMain.handle("get-theme", () => readSettings().theme || null);

ipcMain.handle("set-theme", (event, theme) => {
  const next = writeSettings({ theme });
  // Keep Windows's native titleBarOverlay buttons matching the theme the
  // moment it's changed, not just at next launch -- see resolveTitleBarOverlay.
  if (IS_WINDOWS && mainWindow) mainWindow.setTitleBarOverlay(resolveTitleBarOverlay(theme));
  return next;
});

// Per-device destination for the Autoexport button (see autoexportOneFile
// below) — an absolute folder outside the catalog, chosen once via the native
// folder picker the first time Autoexport is used and remembered from then
// on. Also changeable any time from the Options dialog. Falls back to the
// old "autosaveFolder" settings key so upgrading doesn't silently forget a
// folder someone already picked before the feature was renamed.
ipcMain.handle("get-autoexport-folder", () => {
  const settings = readSettings();
  return settings.autoexportFolder || settings.autosaveFolder || null;
});

ipcMain.handle("set-autoexport-folder", (event, folder) => writeSettings({ autoexportFolder: folder }));

// Per-file rotation, for review mode's "fix a sideways/upside-down scan"
// button (see the renderer's rotateFile). This is a view-only fix — there's
// no safe, dependency-free way to physically re-encode a rotated JPG/PNG or
// rewrite a PDF page's /Rotate entry, and this app would rather never risk
// corrupting a bill's actual bytes than "really" fix the file — so it's kept
// as a small side table instead of embedded metadata like tags/comments
// (see readFileMeta/writeFileMeta above). Keyed by absolute path since it's
// not part of the catalog folder at all; moving or renaming a file loses its
// rotation as a result, since nothing ties the old and new absolute paths
// together — an accepted, minor limitation of a purely cosmetic fix.
const ROTATIONS_FILE = path.join(app.getPath("userData"), "rotations.json");

function readRotations() {
  try {
    return JSON.parse(fs.readFileSync(ROTATIONS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeRotation(full, degrees) {
  const rotations = readRotations();
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized === 0) delete rotations[full];
  else rotations[full] = normalized;
  fs.mkdirSync(path.dirname(ROTATIONS_FILE), { recursive: true });
  fs.writeFileSync(ROTATIONS_FILE, JSON.stringify(rotations), "utf8");
}

ipcMain.handle("set-rotation", async (event, folder, relPath, degrees) => {
  writeRotation(path.join(folder, relPath), degrees);
  return true;
});

// Recursively collects accepted files under `root`, descending into subfolders.
// Dotfiles/dotfolders (e.g. a leftover legacy ".catalog-tags.json", ".git") are
// skipped. Each result's `dir` is the relative path (using "/" separators) of its
// parent folder, "" at the root.
function walkFiles(root, dir = "") {
  const abs = path.join(root, dir);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  let results = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const relPath = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      results = results.concat(walkFiles(root, relPath));
    } else if (e.isFile() && ACCEPTED_EXT.includes(path.extname(e.name).toLowerCase())) {
      results.push({ relPath, dir });
    }
  }
  return results;
}

// Recursively collects all subfolders under `root` (dotfolders skipped), as
// relative paths using "/" separators. Includes folders even if they (or their
// descendants) hold no accepted files, so a subfolder created outside the app
// still shows up as a move destination.
function walkFolders(root, dir = "") {
  const abs = path.join(root, dir);
  let results = [];
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) {
      const relPath = dir ? `${dir}/${e.name}` : e.name;
      results.push(relPath);
      results = results.concat(walkFolders(root, relPath));
    }
  }
  return results;
}

ipcMain.handle("list-folders", async (event, folder) => {
  return walkFolders(folder).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
});

// fs.renameSync fails with EXDEV when `src` and `dest` are on different drives —
// which the trash dir (always under the app's userData, typically the system
// drive) and a catalog folder (could be anywhere, including a removable or
// network drive) routinely are. Falls back to a copy-then-delete in that case.
function moveFileSafe(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

// A file's application-review data (see readAppForm/writeAppForm, defined near
// the tag-config helpers below) is a hidden per-file sidecar named after the
// file itself, unlike tags/comments which live inside the file's own bytes —
// so unlike those, it has to be explicitly carried along whenever a file
// moves, renames, is trashed, or is restored, or it'd silently orphan (real
// data loss, not the cosmetic-only limitation accepted for ROTATIONS_FILE
// above). Best-effort: a locked/missing sidecar must never block the actual
// file's own move.
function appFormSidecarAbsPath(absFile) {
  return path.join(path.dirname(absFile), `.${path.basename(absFile)}.appform.json`);
}

function moveSidecarIfExists(srcAbsFile, destAbsFile) {
  const oldSidecar = appFormSidecarAbsPath(srcAbsFile);
  if (!fs.existsSync(oldSidecar)) return;
  const newSidecar = appFormSidecarAbsPath(destAbsFile);
  try {
    unhideFile(oldSidecar);
    fs.mkdirSync(path.dirname(newSidecar), { recursive: true });
    moveFileSafe(oldSidecar, newSidecar);
    hideFile(newSidecar);
  } catch {
    // best-effort, see comment above
  }
}

// Moves a file into `destDir` (a relative subfolder path, or "" for the catalog
// root). Refuses to clobber an existing file of the same name at the destination
// rather than overwriting it silently.
function moveOneFile(folder, relPath, destDir) {
  const name = path.basename(relPath);
  const newRelPath = destDir ? `${destDir}/${name}` : name;
  const srcFull = path.join(folder, relPath);
  const destFull = path.join(folder, newRelPath);
  if (srcFull === destFull) return { path: relPath };
  if (fs.existsSync(destFull)) {
    return { error: `"${name}" already exists in that folder.` };
  }
  try {
    fs.mkdirSync(path.dirname(destFull), { recursive: true });
    fs.renameSync(srcFull, destFull);
  } catch (e) {
    // The file may be transiently locked (antivirus scan, an open preview, a
    // sync client) — report it as a per-file failure instead of throwing.
    // Letting this throw would reject the whole IPC call (fatal for a batch:
    // it aborts every other file still queued behind it, and leaves the
    // renderer's own post-move cleanup/refresh never running).
    return { error: `Couldn't move "${name}": ${e.message}` };
  }
  moveSidecarIfExists(srcFull, destFull);
  return { path: newRelPath };
}

ipcMain.handle("move-file", async (event, folder, relPath, destDir) => {
  return moveOneFile(folder, relPath, destDir);
});

// ---- Importing files dragged in from the OS file explorer ----

// Expands one dropped OS path into a flat list of { srcAbs, relDest } pairs
// ready to import. A plain file imports under just its own name; a dropped
// directory recurses, preserving its internal structure under a folder named
// after the directory itself (dotfiles/dotfolders skipped, same convention
// walkFiles/walkFolders use for the catalog's own tree) — dragging a folder
// of scanned bills in behaves the same way it would in a real file manager.
function expandDroppedPath(absPath, relDest) {
  const stat = fs.statSync(absPath);
  if (stat.isFile()) return [{ srcAbs: absPath, relDest: relDest || path.basename(absPath) }];
  if (!stat.isDirectory()) return [];
  const base = relDest || path.basename(absPath);
  let results = [];
  for (const e of fs.readdirSync(absPath, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const childAbs = path.join(absPath, e.name);
    const childRel = `${base}/${e.name}`;
    if (e.isDirectory()) results = results.concat(expandDroppedPath(childAbs, childRel));
    else if (e.isFile()) results.push({ srcAbs: childAbs, relDest: childRel });
  }
  return results;
}

// Copies one external file into `destDir` under the catalog folder — a COPY,
// not a move (moveOneFile's move-within-the-catalog semantics don't apply;
// the source lives outside anything the app manages, and dropping a file
// shouldn't remove it from wherever the user dragged it from). Rejects
// anything that isn't a catalog-accepted extension up front, and refuses to
// clobber an existing file at the destination, same policy as moveOneFile.
function importOneFile(folder, srcAbs, relDest, destDir) {
  const name = path.basename(relDest);
  const ext = path.extname(name).toLowerCase();
  if (!ACCEPTED_EXT.includes(ext)) {
    return { error: `"${name}" isn't a PDF, JPG, or PNG — skipped.` };
  }
  const newRelPath = destDir ? `${destDir}/${relDest}` : relDest;
  const destFull = path.join(folder, newRelPath);
  if (path.resolve(srcAbs) === path.resolve(destFull)) {
    return { error: `"${name}" is already in that folder.` };
  }
  if (fs.existsSync(destFull)) {
    return { error: `"${name}" already exists in that folder.` };
  }
  try {
    fs.mkdirSync(path.dirname(destFull), { recursive: true });
    fs.copyFileSync(srcAbs, destFull);
  } catch (e) {
    return { error: `Couldn't import "${name}": ${e.message}` };
  }
  return { path: newRelPath };
}

// `absPaths` are the dropped items' own absolute OS paths (files or
// directories) — resolved renderer-side via webUtils.getPathForFile, since a
// browser File object never carries one. Each is attempted independently, per
// the collision/failure policy above, so one bad file never blocks the rest.
ipcMain.handle("import-files", async (event, folder, absPaths, destDir) => {
  let entries = [];
  for (const p of absPaths) {
    try {
      entries = entries.concat(expandDroppedPath(p, null));
    } catch (e) {
      entries.push({ srcAbs: p, relDest: path.basename(p), statError: e.message });
    }
  }
  const imported = [];
  const errors = [];
  for (const { srcAbs, relDest, statError } of entries) {
    if (statError) {
      errors.push({ path: srcAbs, error: `Couldn't read "${path.basename(srcAbs)}": ${statError}` });
      continue;
    }
    const result = importOneFile(folder, srcAbs, relDest, destDir);
    if (result.error) errors.push({ path: srcAbs, error: result.error });
    else imported.push(result.path);
  }
  return { imported, errors };
});

// Moves many files into `destDir` in one call — e.g. a "move every file with
// this tag" bulk action. Each file is attempted independently, so one name
// collision doesn't block the rest; per-file failures are reported back for
// the renderer to surface instead of aborting the whole batch.
// `moved` reports each file's before/after path (rather than just the after
// path) so the renderer's Undo stack can move every successfully-moved file
// back to exactly where it came from, without guessing at index alignment
// against `relPaths` once some entries have dropped out to `errors`.
ipcMain.handle("move-files-batch", async (event, folder, relPaths, destDir) => {
  const moved = [];
  const errors = [];
  for (const relPath of relPaths) {
    const result = moveOneFile(folder, relPath, destDir);
    if (result.error) errors.push({ path: relPath, error: result.error });
    else moved.push({ from: relPath, to: result.path });
  }
  return { moved, errors };
});

// Renames a file within its current folder to `newName`. Used both directly
// (autorename) and to undo an autorename (renaming back to the original name).
// Refuses to clobber an existing file at that name, same as moveOneFile.
function renameOneFile(folder, relPath, newName) {
  const dir = path.dirname(relPath);
  const destDirRel = dir === "." ? "" : dir;
  const newRelPath = destDirRel ? `${destDirRel}/${newName}` : newName;
  const srcFull = path.join(folder, relPath);
  const destFull = path.join(folder, newRelPath);
  if (srcFull === destFull) return { path: relPath };
  if (fs.existsSync(destFull)) {
    return { error: `"${newName}" already exists in that folder.` };
  }
  try {
    fs.renameSync(srcFull, destFull);
  } catch (e) {
    return { error: `Couldn't rename "${path.basename(relPath)}": ${e.message}` };
  }
  moveSidecarIfExists(srcFull, destFull);
  return { path: newRelPath };
}

ipcMain.handle("rename-file", async (event, folder, relPath, newName) => {
  return renameOneFile(folder, relPath, newName);
});

// Renames a file in place to a yyyyMMdd_HHmmss timestamp (preserving its
// extension) — lets a name collision at a move destination be resolved
// in-app instead of requiring a trip to file explorer to rename it by hand.
// Falls back to a numeric suffix in the unlikely case two files land on the
// same second.
function autorenameOneFile(folder, relPath) {
  const ext = path.extname(relPath);
  const dir = path.dirname(relPath);
  const destDirRel = dir === "." ? "" : dir;
  const destDirFull = path.join(folder, destDirRel);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  let name = `${stamp}${ext}`;
  let n = 1;
  while (fs.existsSync(path.join(destDirFull, name))) {
    name = `${stamp}_${n}${ext}`;
    n++;
  }

  return renameOneFile(folder, relPath, name);
}

ipcMain.handle("autorename-file", async (event, folder, relPath) => {
  return autorenameOneFile(folder, relPath);
});

// Autorenames many files in one action — e.g. a multi-select move that hit
// collisions at the destination. All files share the same yyyyMMdd_HHmmss
// stamp (they're being renamed in the same instant), so each gets a " (n)"
// suffix — 1-indexed in selection order — to keep them from all colliding
// with each other. Each file is attempted independently, mirroring
// move-files-batch, so one locked/in-use file doesn't block the rest.
function autorenameFilesBatch(folder, relPaths) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const moved = [];
  const errors = [];
  relPaths.forEach((relPath, i) => {
    const ext = path.extname(relPath);
    const dir = path.dirname(relPath);
    const destDirRel = dir === "." ? "" : dir;
    const destDirFull = path.join(folder, destDirRel);

    let name = `${stamp} (${i + 1})${ext}`;
    let n = 1;
    while (fs.existsSync(path.join(destDirFull, name))) {
      name = `${stamp} (${i + 1})_${n}${ext}`;
      n++;
    }

    const result = renameOneFile(folder, relPath, name);
    if (result.error) errors.push({ path: relPath, error: result.error });
    else moved.push({ from: relPath, to: result.path });
  });
  return { moved, errors };
}

ipcMain.handle("autorename-files-batch", async (event, folder, relPaths) => {
  return autorenameFilesBatch(folder, relPaths);
});

// Maps the EXIF Orientation tag (1-8) to the clockwise degrees a viewer must
// rotate the raw, as-stored pixel data by to display it upright — the exact
// same "clockwise degrees to rotate for display" meaning as a PDF page's own
// /Rotate entry (see PDFPage.setRotation below), so the values carry over
// directly. A phone photo shot in portrait is very often stored "sideways"
// at the sensor level (Orientation 6 or 8) with this tag recording the fix;
// values 2/4/5/7 additionally mirror the image, which a plain page rotation
// can't express — real cameras essentially never produce those, so they're
// handled here as their rotation component only, dropping the mirror.
const EXIF_ORIENTATION_TO_ROTATION = { 1: 0, 2: 0, 3: 180, 4: 180, 5: 270, 6: 90, 7: 90, 8: 270 };

// JPEG's raw pixel data (what pdf-lib's embedJpg reads) is oriented however
// the camera sensor captured it — completely ignoring the EXIF Orientation
// tag that photo viewers (including this app's own <img>-based previews,
// which Chromium auto-rotates per EXIF by default) use to display it upright.
// Without correcting for that, an autoexported portrait photo stored sideways
// at the sensor level would land in the PDF still sideways. PNG carries no
// such tag in practice, so this is JPEG-only.
async function readJpegRotation(srcFull) {
  try {
    const tags = await exiftool.read(srcFull);
    return EXIF_ORIENTATION_TO_ROTATION[tags.Orientation] || 0;
  } catch {
    return 0; // no/unreadable EXIF — assume the pixel data is already upright
  }
}

// Autoexport always hands back a PDF, regardless of what kind of file went
// in: a source PDF is copied through untouched, but a JPG/PNG is wrapped
// into a fresh single-page PDF — one page, sized to the image itself, with
// the image drawn to fill it — via pdf-lib, which needs no native build step
// (matters for electron-builder). A JPEG's EXIF orientation (see
// readJpegRotation above) is carried over as the page's own rotation, so it
// still displays upright; beyond that, no rotation/rescaling: this is a
// format conversion, not an edit.
async function writeAutoexportCopy(srcFull, destFull, ext) {
  if (ext === ".pdf") {
    fs.copyFileSync(srcFull, destFull);
    return;
  }
  const bytes = fs.readFileSync(srcFull);
  const pdfDoc = await PDFDocument.create();
  const image = ext === ".png" ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  if (ext !== ".png") {
    const rotation = await readJpegRotation(srcFull);
    if (rotation) page.setRotation(degrees(rotation));
  }
  fs.writeFileSync(destFull, await pdfDoc.save());
}

// The Autoexport button is a "Save As": it writes a file under a fresh
// yyyyMMdd_HHmmss timestamp name — same naming scheme as autorenameOneFile —
// into `destFolder`, the per-device autoexport folder (see
// get/set-autoexport-folder above), and leaves the original completely
// untouched in the catalog. The output is always named with a .pdf extension
// — see writeAutoexportCopy above for how a non-PDF source gets there.
// Collisions are checked against destFolder, not the file's own folder,
// since that's where the new name actually has to be unique. Returns
// destFull — the copy's new absolute path — so the renderer can undo by
// deleting just that copy (see undo-autoexport below).
async function autoexportOneFile(folder, relPath, destFolder) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  let name = `${stamp}.pdf`;
  let n = 1;
  while (fs.existsSync(path.join(destFolder, name))) {
    name = `${stamp}_${n}.pdf`;
    n++;
  }

  const srcFull = path.join(folder, relPath);
  const destFull = path.join(destFolder, name);
  try {
    fs.mkdirSync(destFolder, { recursive: true });
    await writeAutoexportCopy(srcFull, destFull, path.extname(relPath).toLowerCase());
    // A plain copy carries over the source's own last-modified time (same as
    // an Explorer copy-paste), which would leave the copy showing the
    // original bill's old date despite its new timestamped filename. Stamp
    // it to the moment of the autoexport instead, so the two agree.
    fs.utimesSync(destFull, now, now);
  } catch (e) {
    return { error: `Couldn't autoexport "${path.basename(relPath)}": ${e.message}` };
  }
  return { destFull, name };
}

ipcMain.handle("autoexport-file", async (event, folder, relPath, destFolder) => {
  return autoexportOneFile(folder, relPath, destFolder);
});

// Autoexports many files in one action, mirroring autorenameFilesBatch: all
// copies share the same stamp, so each gets a " (n)" suffix (1-indexed in
// selection order) to keep them from colliding with each other at the
// destination. Each file is attempted independently (sequentially, since
// image-to-PDF conversion is async), so one locked/in-use/corrupt file
// doesn't block the rest.
async function autoexportFilesBatch(folder, relPaths, destFolder) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const saved = [];
  const errors = [];
  try {
    fs.mkdirSync(destFolder, { recursive: true });
  } catch (e) {
    return { saved, errors: relPaths.map((p) => ({ path: p, error: `Couldn't reach the autoexport folder: ${e.message}` })) };
  }
  for (let i = 0; i < relPaths.length; i++) {
    const relPath = relPaths[i];
    let name = `${stamp} (${i + 1}).pdf`;
    let n = 1;
    while (fs.existsSync(path.join(destFolder, name))) {
      name = `${stamp} (${i + 1})_${n}.pdf`;
      n++;
    }

    const srcFull = path.join(folder, relPath);
    const destFull = path.join(destFolder, name);
    try {
      await writeAutoexportCopy(srcFull, destFull, path.extname(relPath).toLowerCase());
      // See the matching comment in autoexportOneFile above.
      fs.utimesSync(destFull, now, now);
      saved.push({ source: relPath, destFull, name });
    } catch (e) {
      errors.push({ path: relPath, error: `Couldn't autoexport "${path.basename(relPath)}": ${e.message}` });
    }
  }
  return { saved, errors };
}

ipcMain.handle("autoexport-files-batch", async (event, folder, relPaths, destFolder) => {
  return autoexportFilesBatch(folder, relPaths, destFolder);
});

// Undoes an Autoexport. Since autoexportOneFile/autoexportFilesBatch only
// ever create a new copy — the original file in the catalog is never
// touched — undoing means deleting that copy outright, not restoring
// anything.
ipcMain.handle("undo-autoexport", async (event, destFull) => {
  try {
    fs.unlinkSync(destFull);
  } catch (e) {
    return { error: `Couldn't undo autoexport: ${e.message}` };
  }
  return true;
});

// Windows/Chromium quirk: after the DOM subtree holding a native <select> is torn
// down and rebuilt (as happens on every full re-render following a file move),
// Chromium can leave that select's popup-menu tracking orphaned, and clicking any
// <select> in the window stops opening the dropdown at all until the window loses
// and regains OS focus. Alt-tabbing away and back "fixes" it for exactly that
// reason. This replicates that fix in code so the user doesn't have to do it by
// hand. Guarded on isFocused() so it never steals focus from another app — it
// only runs right after a user-initiated action in this window, so it should
// already be focused; if it somehow isn't, skip rather than risk stealing focus.
ipcMain.handle("nudge-window-focus", async () => {
  if (!mainWindow || !mainWindow.isFocused()) return;
  mainWindow.blur();
  mainWindow.focus();
});

ipcMain.handle("list-files", async (event, folder) => {
  const found = walkFiles(folder);
  const rotations = readRotations();
  return Promise.all(
    found.map(async ({ relPath, dir }) => {
      const full = path.join(folder, relPath);
      const name = path.basename(relPath);
      const ext = path.extname(name).toLowerCase();
      const stat = fs.statSync(full);
      const meta = await readFileMeta(full, ext);
      return {
        path: relPath,
        name,
        dir,
        ext,
        url: pathToFileURL(full).href,
        size: stat.size,
        mtime: stat.mtimeMs,
        created: stat.birthtimeMs || stat.ctimeMs,
        tags: meta.tags,
        comments: meta.comments,
        rotation: rotations[full] || 0,
        appForm: readAppForm(full),
      };
    })
  );
});

// A metadata write (writeFileMeta below) ends with exiftool renaming a temp file
// over the original, which fails with "Error renaming temporary file to <path>"
// if something else — a preview pane, another app, or (most commonly) a cloud
// sync client like OneDrive/SharePoint/Google Drive briefly checksumming/
// uploading the file — has it locked at that exact instant. The lock is
// transient, so a couple of automatic retries with a short delay clears most
// occurrences before the user ever sees an error.
const META_WRITE_RETRIES = 2;
const META_WRITE_RETRY_DELAY_MS = 750;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

ipcMain.handle("update-file-meta", async (event, folder, relPath, patch) => {
  const full = path.join(folder, relPath);
  const ext = path.extname(relPath).toLowerCase();
  const current = await readFileMeta(full, ext);
  const merged = { ...current, ...patch };
  let lastErr;
  for (let attempt = 0; attempt <= META_WRITE_RETRIES; attempt++) {
    try {
      await writeFileMeta(full, ext, merged.tags || [], merged.comments || []);
      return merged;
    } catch (err) {
      lastErr = err;
      if (attempt < META_WRITE_RETRIES) await delay(META_WRITE_RETRY_DELAY_MS);
    }
  }
  throw lastErr;
});

// Rather than unlinking outright, moves the file into TRASH_DIR under a random
// name and hands the renderer that path back. This is what makes Undo possible
// for a delete: the bytes (and the tags/comments embedded in them) are still on
// disk, just not where the catalog can see them. They're only gone for good once
// the app restarts and TRASH_DIR gets purged (see app.whenReady above).
function trashOneFile(folder, relPath) {
  const full = path.join(folder, relPath);
  const ext = path.extname(relPath).toLowerCase();
  const trashPath = path.join(TRASH_DIR, `${crypto.randomUUID()}${ext}`);
  try {
    moveFileSafe(full, trashPath);
  } catch (e) {
    // Same reasoning as moveOneFile's catch: a transiently locked file becomes a
    // per-file failure instead of throwing, so it doesn't take a whole batch down.
    return { error: `Couldn't delete "${path.basename(relPath)}": ${e.message}` };
  }
  moveSidecarIfExists(full, trashPath);
  return { trashPath };
}

ipcMain.handle("delete-file", async (event, folder, relPath) => {
  return trashOneFile(folder, relPath);
});

// Deletes many files in one call — e.g. "delete every checked file" from the
// bulk-actions bar. Each file is trashed independently, so one locked/in-use
// file doesn't block the rest; per-file failures are reported back for the
// renderer to surface instead of aborting the whole batch.
ipcMain.handle("delete-files-batch", async (event, folder, relPaths) => {
  const deleted = [];
  const errors = [];
  for (const relPath of relPaths) {
    const result = trashOneFile(folder, relPath);
    if (result.error) errors.push({ path: relPath, error: result.error });
    else deleted.push({ path: relPath, trashPath: result.trashPath });
  }
  return { deleted, errors };
});

// Undoes a delete: moves a trashed file back to its original relative path.
// Refuses to clobber a file that has since reappeared at that path, same as a
// regular move.
ipcMain.handle("restore-file", async (event, trashPath, folder, relPath) => {
  const destFull = path.join(folder, relPath);
  if (fs.existsSync(destFull)) {
    return { error: `Can't undo — "${path.basename(relPath)}" already exists at that location.` };
  }
  try {
    fs.mkdirSync(path.dirname(destFull), { recursive: true });
    moveFileSafe(trashPath, destFull);
  } catch (e) {
    return { error: `Couldn't restore "${path.basename(relPath)}": ${e.message}` };
  }
  moveSidecarIfExists(trashPath, destFull);
  return { path: relPath };
});

ipcMain.handle("open-file", async (event, folder, relPath) => {
  // shell.openPath resolves to "" on success, or an error string on failure —
  // it never rejects, so the renderer can just check the returned string.
  const result = await shell.openPath(path.join(folder, relPath));
  return result || null;
});

// Predefined tags (name + keyboard shortcut + color) are catalog-specific
// content, so they live as a hidden JSON file inside the target folder itself
// rather than in the app's own userData directory — that way the vocabulary
// travels with the folder (a different machine, a reinstalled app, a synced
// drive all see the same tags). walkFiles/walkFolders already skip dotfiles,
// so this never shows up in the grid or the folder tree.
const TAG_CONFIG_FILENAME = ".catalog-tags.json";

function tagConfigPath(folder) {
  return path.join(folder, TAG_CONFIG_FILENAME);
}

// The leading dot only hides the file from walkFiles/walkFolders (and from
// Explorer on macOS/Linux); Windows has its own separate hidden-attribute
// bit that ignores filename entirely, so the file still shows up in Explorer
// there unless we set it explicitly. No-op, and never throws, elsewhere.
function hideFile(file) {
  if (process.platform !== "win32") return;
  try {
    execFileSync("attrib", ["+h", file]);
  } catch {}
}

// Windows won't let Node truncate-write a file that already has the hidden
// attribute set — fs.writeFileSync fails with EPERM — so a plain
// write-then-hideFile only works the first time. Every subsequent save has
// to clear the attribute first, write, then re-hide.
function unhideFile(file) {
  if (process.platform !== "win32") return;
  try {
    execFileSync("attrib", ["-h", file]);
  } catch {}
}

function writeTagsFile(file, tags) {
  unhideFile(file);
  fs.writeFileSync(file, JSON.stringify({ tags }, null, 2), "utf8");
  hideFile(file);
}

// Where predefined tags were stored by a previous version of the app: one file
// per folder, keyed by a hash of its path, inside the app's own userData
// directory. Kept only so an existing catalog migrates forward automatically
// the first time it's opened after this change — see get-tag-config below.
const OLD_TAG_CONFIG_DIR = path.join(app.getPath("userData"), "tag-configs");

function oldTagConfigPath(folder) {
  const hash = crypto.createHash("sha256").update(path.resolve(folder)).digest("hex");
  return path.join(OLD_TAG_CONFIG_DIR, `${hash}.json`);
}

function readTagsFile(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.tags)) return parsed.tags;
  } catch {}
  return null;
}

ipcMain.handle("get-tag-config", async (event, folder) => {
  const current = readTagsFile(tagConfigPath(folder));
  if (current) {
    // Backfills the hidden attribute for files that already existed before
    // this was added (e.g. created by an older build of the app).
    hideFile(tagConfigPath(folder));
    return current;
  }
  // One-time migration for catalogs whose predefined tags were saved by an
  // older version of the app into its own userData directory instead of
  // alongside the folder.
  const old = readTagsFile(oldTagConfigPath(folder));
  if (old) {
    writeTagsFile(tagConfigPath(folder), old);
    return old;
  }
  return [];
});

ipcMain.handle("save-tag-config", async (event, folder, tags) => {
  writeTagsFile(tagConfigPath(folder), tags);
  return tags;
});

// A file's application-review data (see appFormSidecarAbsPath/moveSidecarIfExists
// above), read as part of list-files below and written back on every save from
// the review screen's Application tab. Same hide/unhide dance as the tag config
// file above, just keyed per-file instead of per-folder.
function readAppForm(absFile) {
  try {
    return JSON.parse(fs.readFileSync(appFormSidecarAbsPath(absFile), "utf8"));
  } catch {
    return null;
  }
}

function writeAppForm(absFile, data) {
  const file = appFormSidecarAbsPath(absFile);
  unhideFile(file);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  hideFile(file);
}

ipcMain.handle("save-app-form", async (event, folder, relPath, data) => {
  writeAppForm(path.join(folder, relPath), data);
  return data;
});

// ---- Gravity Forms API import ----
//
// The org also collects Member Applications through a Gravity Forms-powered
// web form; this pulls submitted entries in as applications alongside
// scanned ones. Connection details (site URL, consumer key/secret, which
// form, and the field mapping worked out once via the renderer's field-
// mapping screen) live in a hidden per-folder file, same precedent as
// TAG_CONFIG_FILENAME above: pointing the app at the shared workspace folder
// picks the API connection up automatically, no per-device setup.
const API_CONFIG_FILENAME = ".api-config.json";

function apiConfigPath(folder) {
  return path.join(folder, API_CONFIG_FILENAME);
}

function readApiConfig(folder) {
  try {
    return JSON.parse(fs.readFileSync(apiConfigPath(folder), "utf8"));
  } catch {
    return null;
  }
}

function writeApiConfig(folder, config) {
  const file = apiConfigPath(folder);
  unhideFile(file);
  fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
  hideFile(file);
}

ipcMain.handle("get-api-config", async (event, folder) => {
  return readApiConfig(folder);
});

ipcMain.handle("save-api-config", async (event, folder, config) => {
  writeApiConfig(folder, config);
  return config;
});

// ---- Form schema (required/removable fields + custom field definitions) ----
//
// The paper form isn't static -- the org has already changed it once and
// will again -- so which fields are required, which have been deleted (see
// the renderer's Manage Form Fields screen), the custom field definitions
// themselves, and the fields' display order all live in their own hidden
// per-folder file, same precedent as TAG_CONFIG_FILENAME/API_CONFIG_FILENAME
// above. customFields/appFieldOrder used to live inside .api-config.json,
// but that only exists for a folder that's connected to an API -- a
// paper-only folder still needs to be able to add/require/delete/reorder
// fields, so both moved here.
const FORM_SCHEMA_FILENAME = ".form-schema.json";

function formSchemaPath(folder) {
  return path.join(folder, FORM_SCHEMA_FILENAME);
}

function readFormSchemaFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeFormSchema(folder, schema) {
  const file = formSchemaPath(folder);
  unhideFile(file);
  fs.writeFileSync(file, JSON.stringify(schema, null, 2), "utf8");
  hideFile(file);
}

// One-time migration, same precedent as get-tag-config's oldTagConfigPath
// migration above: a folder whose custom fields/display order were defined
// via the old API-mapping screen (stored in .api-config.json's
// "customFields"/"appFieldOrder") gets a fresh .form-schema.json seeded
// from them, plus the fields that were hardcoded-required before this
// screen existed.
function readFormSchema(folder) {
  const current = readFormSchemaFile(formSchemaPath(folder));
  if (current) {
    hideFile(formSchemaPath(folder));
    return {
      removedFields: current.removedFields || [],
      requiredFields: current.requiredFields || DEFAULT_REQUIRED_FIELDS,
      customFields: current.customFields || [],
      appFieldOrder: current.appFieldOrder || [],
    };
  }
  const apiConfig = readApiConfig(folder);
  const schema = {
    removedFields: [],
    requiredFields: DEFAULT_REQUIRED_FIELDS,
    customFields: (apiConfig && apiConfig.customFields) || [],
    appFieldOrder: (apiConfig && apiConfig.appFieldOrder) || [],
  };
  writeFormSchema(folder, schema);
  return schema;
}

ipcMain.handle("get-form-schema", async (event, folder) => {
  return readFormSchema(folder);
});

ipcMain.handle("save-form-schema", async (event, folder, schema) => {
  writeFormSchema(folder, schema);
  return schema;
});

// Gravity Forms REST API v2 supports HTTP Basic Auth over HTTPS as an
// alternative to full OAuth1 request signing (consumer key as username,
// consumer secret as password) -- see docs.gravityforms.com. Basic Auth is
// enough here since this app only ever talks to sites the org configures
// itself, and avoids implementing OAuth1 signing for no real benefit.
async function gfFetch(siteUrl, consumerKey, consumerSecret, endpoint) {
  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64");
  const base = siteUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/wp-json/gf/v2/${endpoint}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Gravity Forms API error ${res.status} for ${endpoint} -- check the site URL and key/secret.`);
  }
  return res.json();
}

ipcMain.handle("test-gf-connection", async (event, siteUrl, consumerKey, consumerSecret) => {
  const forms = await gfFetch(siteUrl, consumerKey, consumerSecret, "forms");
  // Confirmed from docs: GET /forms returns an array of form summaries. Some
  // GF sites/versions are known to return an id-keyed object instead for
  // other list endpoints, so this tolerates either shape defensively.
  const list = Array.isArray(forms) ? forms : Object.values(forms || {});
  return list.map((f) => ({ id: String(f.id), title: f.title || `Form ${f.id}` }));
});

// Flattens one Gravity Forms field into one mappable row per leaf input: a
// plain field (text, select, ...) is already a leaf; a compound field (Name,
// Address, ...) has an `inputs` array and expands into one row per sub-input,
// keyed "parentId.subInputId" (e.g. "1.3") -- confirmed from docs as the
// convention entries use for these. Hidden sub-inputs (e.g. an unused Name
// middle-name field) are skipped since they'll never carry real data.
function flattenGfFields(form) {
  const rows = [];
  for (const field of form.fields || []) {
    if (Array.isArray(field.inputs) && field.inputs.length > 0) {
      for (const input of field.inputs) {
        if (input.isHidden) continue;
        rows.push({
          gfFieldId: String(input.id),
          label: input.label ? `${field.label} (${input.label})` : field.label || `Field ${input.id}`,
        });
      }
    } else {
      rows.push({ gfFieldId: String(field.id), label: field.label || `Field ${field.id}` });
    }
  }
  return rows;
}

ipcMain.handle("get-gf-form-fields", async (event, siteUrl, consumerKey, consumerSecret, formId) => {
  const form = await gfFetch(siteUrl, consumerKey, consumerSecret, `forms/${formId}`);
  return flattenGfFields(form);
});

// The exact list-entries response envelope couldn't be fully confirmed from
// docs alone (see the project plan) -- this accepts either a bare array or
// an {entries, total_count} wrapper rather than assuming one, so a real
// mismatch surfaces as "0 entries found" (visible, correctable) instead of a
// thrown error or silently wrong data.
function normalizeEntriesResponse(raw) {
  if (Array.isArray(raw)) return { entries: raw, totalCount: raw.length };
  if (raw && Array.isArray(raw.entries)) {
    return { entries: raw.entries, totalCount: Number(raw.total_count) || raw.entries.length };
  }
  return { entries: [], totalCount: 0 };
}

ipcMain.handle("list-gf-entries", async (event, folder) => {
  const config = readApiConfig(folder);
  if (!config || !config.formId) throw new Error("No API connection configured for this folder yet.");
  const raw = await gfFetch(config.siteUrl, config.consumerKey, config.consumerSecret, `forms/${config.formId}/entries`);
  const { entries, totalCount } = normalizeEntriesResponse(raw);
  const imported = config.importedEntries || {};
  const notImported = entries.filter((e) => !imported[String(e.id)]);
  const firstNameMap = (config.fieldMapping || []).find((m) => m.target === "member:primary.firstName");
  const lastNameMap = (config.fieldMapping || []).find((m) => m.target === "member:primary.lastName");
  const summarized = notImported.map((e) => {
    const name = [firstNameMap && e[firstNameMap.gfFieldId], lastNameMap && e[lastNameMap.gfFieldId]]
      .filter(Boolean)
      .join(" ");
    return { id: String(e.id), date: e.date_created || "", name: name || null };
  });
  return { totalFetched: totalCount, entries: summarized };
});

// Resolves one fieldMapping target (see .api-config.json's shape) against a
// specific appForm object into { obj, key, isExtra } -- read via obj[key],
// written via obj[key] = value -- or null for "ignore"/an unrecognized
// target. Shared by applyGfEntryToAppForm (fresh import) and
// remap-imported-entries (fixing an existing one) below, so "how a target
// maps onto the schema" is defined exactly once.
//
// A member:<slot>.<key> target is found by matching a household member's
// importSlot tag -- a non-schema provenance property set below (and never
// touched by the renderer) recording which import slot ("primary",
// "spouse", "slot2", "slot3", ...) a member came from, since the persisted
// schema otherwise has no way to tell "the household member from slot 3"
// apart from one a person added by hand in the review screen. If no
// matching member exists yet, one is created (falling back to matching by
// role for "primary"/"spouse" first, since a member created before this
// tagging existed -- or entered on paper -- won't carry the tag).
// Finds the household member for a given import slot ("primary", "spouse",
// "slot2", ...), matched first by its importSlot tag and, for primary/
// spouse only, falling back to role (a member entered on paper, or created
// before this tagging existed, won't carry the tag but is still THE
// primary/spouse). Creates one if none exists yet. Shared by the member:
// and membercustom: branches of resolveAppFormTarget below.
function resolveOrCreateMemberForSlot(appForm, slot) {
  let member = appForm.householdMembers.find((m) => m.importSlot === slot);
  if (!member && slot === "primary") member = appForm.householdMembers.find((m) => m.role === "primary");
  if (!member && slot === "spouse") member = appForm.householdMembers.find((m) => m.role === "spouse");
  if (!member) {
    const role = slot === "primary" ? "primary" : slot === "spouse" ? "spouse" : "child";
    member = makeBlankHouseholdMember(role);
    member.importSlot = slot;
    appForm.householdMembers.push(member);
  }
  return member;
}

function resolveAppFormTarget(appForm, target, removedFields) {
  if (!target || target === "ignore") return null;
  if (removedFields && removedFields.includes(target)) return null; // treated like "ignore" -- see .form-schema.json
  if (target.startsWith("household.")) {
    return { obj: appForm.household, key: target.slice("household.".length), isExtra: false };
  }
  if (target.startsWith("member:")) {
    const rest = target.slice("member:".length);
    const dot = rest.indexOf(".");
    if (dot === -1) return null;
    const slot = rest.slice(0, dot);
    // The remainder can itself be a nested path (e.g. "health.height" for a
    // member:primary.health.height target, not just a flat "firstName"), so
    // it's walked the same way appFieldTarget in application-form.js walks
    // any other dotted path -- one level of nesting isn't enough here.
    const path = rest.slice(dot + 1).split(".");
    const member = resolveOrCreateMemberForSlot(appForm, slot);
    let obj = member;
    for (let i = 0; i < path.length - 1; i++) {
      obj = obj[path[i]];
      if (obj == null) return null;
    }
    return { obj, key: path[path.length - 1], isExtra: false };
  }
  // A custom field explicitly categorized under one member (see the API
  // mapping screen's "add as a new field under: Primary member/Spouse/
  // Household Member N" choices) rather than the household-level catch-all
  // below -- lands in that member's OWN extraFields bag (see
  // makeBlankHouseholdMember), not appForm's, so e.g. two different
  // household members can each have their own value for a same-named field.
  if (target.startsWith("membercustom:")) {
    const rest = target.slice("membercustom:".length);
    const dot = rest.indexOf(".");
    if (dot === -1) return null;
    const slot = rest.slice(0, dot);
    const key = rest.slice(dot + 1);
    const member = resolveOrCreateMemberForSlot(appForm, slot);
    if (!member.extraFields) member.extraFields = {};
    return { obj: member.extraFields, key, isExtra: true };
  }
  if (target.startsWith("custom:")) {
    return { obj: appForm.extraFields, key: target.slice("custom:".length), isExtra: true };
  }
  return null;
}

// Builds one appForm object (same shape the renderer's Application tab
// reads/writes -- see makeBlankAppForm/makeBlankHouseholdMember, shared via
// application-form.js's module.exports guard) from one raw Gravity Forms
// entry, per the folder's configured fieldMapping. ignore/unmapped fields
// are simply not carried over (they're still visible in the generated
// summary PDF, which lists every submitted answer regardless of mapping).
function applyGfEntryToAppForm(entry, fieldMapping, removedFields) {
  const appForm = makeBlankAppForm();
  appForm.householdMembers[0].importSlot = "primary";
  for (const map of fieldMapping || []) {
    const value = entry[map.gfFieldId];
    if (value === undefined || value === "") continue;
    const resolved = resolveAppFormTarget(appForm, map.target, removedFields);
    if (resolved) resolved.obj[resolved.key] = value;
  }
  return appForm;
}

// One-page-per-overflow plain-text PDF listing every answer the entry
// actually carries (labeled via fieldMapping, which has one row per
// discovered form field regardless of how -- or whether -- it was mapped),
// so nothing submitted is silently missing from the visual record even if a
// field wasn't mapped onto the schema. This app's only prior pdf-lib usage
// (writeAutoexportCopy above) just embeds an existing image; this draws
// text, still with no native build step.
async function generateGfSummaryPdf(entry, fieldMapping) {
  const PAGE_WIDTH = 612;
  const PAGE_HEIGHT = 792;
  const MARGIN = 54;
  const WRAP_CHARS = 95;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const drawLine = (text, { bold = false, size = 11, gapAfter = 5 } = {}) => {
    if (y < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
    page.drawText(text, { x: MARGIN, y, size, font: bold ? boldFont : font });
    y -= size + gapAfter;
  };
  drawLine(`Online Member Application -- Entry #${entry.id}`, { bold: true, size: 14, gapAfter: 8 });
  drawLine(`Submitted: ${entry.date_created || "unknown"}`, { size: 10, gapAfter: 14 });
  for (const map of fieldMapping || []) {
    const value = entry[map.gfFieldId];
    if (value === undefined || value === "") continue;
    drawLine(map.label || map.gfFieldId, { bold: true, gapAfter: 2 });
    const text = String(value);
    for (let i = 0; i < text.length; i += WRAP_CHARS) drawLine(text.slice(i, i + WRAP_CHARS));
    y -= 6;
  }
  return pdfDoc.save();
}

ipcMain.handle("import-gf-entries", async (event, folder, entryIds) => {
  const config = readApiConfig(folder);
  if (!config || !config.formId) throw new Error("No API connection configured for this folder yet.");
  const raw = await gfFetch(config.siteUrl, config.consumerKey, config.consumerSecret, `forms/${config.formId}/entries`);
  const { entries } = normalizeEntriesResponse(raw);
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  const fieldMapping = config.fieldMapping || [];
  const removedFields = readFormSchema(folder).removedFields;
  const inboxDir = path.join(folder, "Inbox");
  fs.mkdirSync(inboxDir, { recursive: true });
  const imported = [];
  const errors = [];
  const importedEntries = { ...(config.importedEntries || {}) };
  for (const id of entryIds) {
    const entry = byId.get(String(id));
    if (!entry) {
      errors.push({ id, error: "Entry not found (may have been deleted on the server)." });
      continue;
    }
    try {
      const appForm = applyGfEntryToAppForm(entry, fieldMapping, removedFields);
      const primary = appForm.householdMembers.find((m) => m.role === "primary");
      const displayName = [primary?.firstName, primary?.lastName].filter(Boolean).join(" ") || `Entry ${id}`;
      const safeName = displayName.replace(/[\\/:*?"<>|]/g, "_");
      let fileName = `Online - ${safeName} - ${id}.pdf`;
      let destFull = path.join(inboxDir, fileName);
      let n = 1;
      while (fs.existsSync(destFull)) {
        fileName = `Online - ${safeName} - ${id} (${n++}).pdf`;
        destFull = path.join(inboxDir, fileName);
      }
      const pdfBytes = await generateGfSummaryPdf(entry, fieldMapping);
      fs.writeFileSync(destFull, pdfBytes);
      await writeFileMeta(destFull, ".pdf", ["API"], []);
      writeAppForm(destFull, appForm);
      const relPath = path.relative(folder, destFull).split(path.sep).join("/");
      importedEntries[String(id)] = relPath;
      imported.push({ id, path: relPath });
    } catch (e) {
      errors.push({ id, error: e.message });
    }
  }
  writeApiConfig(folder, { ...config, importedEntries });
  return { imported, errors };
});

// Re-derives already-imported applications' data after the folder's field
// mapping changes -- e.g. a field that was mistakenly left as an unattached
// custom field now correctly targets a household-member slot. Reads each
// entry's CURRENT sidecar (not a fresh API fetch), so this always carries
// forward whatever's on disk right now, including any edit staff already
// made since the original import -- and never overwrites a destination that
// already has a value, the one real safety rule here.
ipcMain.handle("remap-imported-entries", async (event, folder, oldFieldMapping, newFieldMapping) => {
  const config = readApiConfig(folder);
  if (!config) throw new Error("No API connection configured for this folder yet.");
  const removedFields = readFormSchema(folder).removedFields;
  const oldByGfId = new Map((oldFieldMapping || []).map((m) => [m.gfFieldId, m]));
  const changed = (newFieldMapping || []).filter((m) => {
    const old = oldByGfId.get(m.gfFieldId);
    return old && old.target !== m.target;
  });
  const migrated = [];
  const skipped = [];
  const importedEntries = config.importedEntries || {};
  for (const [, relPath] of Object.entries(importedEntries)) {
    const absPath = path.join(folder, relPath);
    const appForm = readAppForm(absPath);
    if (!appForm) continue;
    let touched = false;
    for (const map of changed) {
      const old = oldByGfId.get(map.gfFieldId);
      const oldResolved = resolveAppFormTarget(appForm, old.target, removedFields);
      if (!oldResolved) continue;
      const oldValue = oldResolved.obj[oldResolved.key];
      if (oldValue === undefined || oldValue === "") continue;
      const newResolved = resolveAppFormTarget(appForm, map.target, removedFields);
      if (!newResolved) continue; // e.g. retargeted to "ignore" -- nothing sensible to move to, leave the old value in place
      const newValue = newResolved.obj[newResolved.key];
      if (newValue !== undefined && newValue !== "") {
        skipped.push({ path: relPath, field: map.label, reason: "destination already has a value" });
        continue;
      }
      newResolved.obj[newResolved.key] = oldValue;
      if (oldResolved.isExtra) delete oldResolved.obj[oldResolved.key];
      else oldResolved.obj[oldResolved.key] = "";
      migrated.push({ path: relPath, field: map.label, from: old.target, to: map.target });
      touched = true;
    }
    if (touched) writeAppForm(absPath, appForm);
  }
  return { migrated, skipped };
});
