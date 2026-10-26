const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const { execFileSync, spawn } = require("child_process");
const { exiftool } = require("exiftool-vendored");
const { autoUpdater } = require("electron-updater");
const { DEFAULT_PLANS, makeBlankRecord, normalizeRecord, normalizeDateToIso, todayIso } = require("./renderer/application-form.js");
const { generateApplicationPdf } = require("./application-pdf.js");
const { readTrackerWorkbook, writeTrackerWorkbook } = require("./tracker-xlsx.js");

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
  // Coming back to the window is the most likely moment someone just signed
  // in/out of AB Apps -- see refreshAbAppsName.
  mainWindow.on("focus", () => refreshAbAppsName());
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
  // Works even while the file doesn't exist yet (stat just reports zeros),
  // so it also catches a sign-in after launch.
  fs.watchFile(AB_APPS_IDENTITY_FILE, { interval: 2000 }, () => refreshAbAppsName());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  fs.unwatchFile(AB_APPS_IDENTITY_FILE);
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

// --- AB Apps identity --------------------------------------------------------
// AB Apps is the in-house launcher that signs a person in once for every
// AB app. While someone is signed in there, it keeps this file in the
// Windows account's AppData (deleted again on sign-out):
//   { "version": 1, "personId": "…", "name": "Mary Manager", "class": "manager", … }
// Only `name` matters here. When the file is valid (parses, version 1, a
// non-empty name of at most 80 chars once trimmed), that name signs new
// comments (and application-form edits) instead of settings.json's
// per-device commenterName, and the renderer shows it read-only in Options.
// Anything else — missing file, read error, or a half-written file that
// fails to parse — counts as "not signed in" and falls back to
// commenterName exactly as before. The AB Apps name is never written into
// settings.json, so the device's own name is still there if the person
// signs out.
const AB_APPS_IDENTITY_FILE = path.join(app.getPath("appData"), "AB Apps", "identity.json");

function readAbAppsName() {
  try {
    const identity = JSON.parse(fs.readFileSync(AB_APPS_IDENTITY_FILE, "utf8"));
    if (identity?.version !== 1 || typeof identity.name !== "string") return null;
    const name = identity.name.trim();
    return name && name.length <= 80 ? name : null;
  } catch {
    return null;
  }
}

// Last name handed to the renderer, so sign-in/sign-out/rename in AB Apps is
// only pushed ("ab-apps-name") when it actually changed. Re-checked on window
// focus and by a cheap 2s fs.watchFile poll (see app.whenReady), so none of
// those need a restart to show up.
let abAppsName = null;

function refreshAbAppsName() {
  const next = readAbAppsName();
  if (next === abAppsName) return;
  abAppsName = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("ab-apps-name", next);
}

ipcMain.handle("get-ab-apps-name", () => (abAppsName = readAbAppsName()));

ipcMain.handle("get-theme", () => readSettings().theme || null);

ipcMain.handle("set-theme", (event, theme) => {
  const next = writeSettings({ theme });
  // Keep Windows's native titleBarOverlay buttons matching the theme the
  // moment it's changed, not just at next launch -- see resolveTitleBarOverlay.
  if (IS_WINDOWS && mainWindow) mainWindow.setTitleBarOverlay(resolveTitleBarOverlay(theme));
  return next;
});

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
// not a move (the source lives outside anything the app manages, and dropping a file
// shouldn't remove it from wherever the user dragged it from). Rejects
// anything that isn't a catalog-accepted extension up front, and refuses to
// clobber an existing file at the destination.
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
  fileLooseFiles(folder);
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
        appForm: normalizeRecord(readAppForm(full)),
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
    // The file may be transiently locked (antivirus scan, an open preview, a
    // sync client) — report it as a per-file failure instead of throwing, so
    // it doesn't take a whole batch down.
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
  writeJsonRetrying(file, { tags }, { hidden: true });
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

// A small JSON file on the shared OneDrive folder can be briefly locked by
// the sync client (or by another computer's app mid-write) -- same
// transient lock update-file-meta retries around (see META_WRITE_RETRIES).
// These writes are tiny and synchronous, so the short wait between tries
// just blocks in place.
const JSON_WRITE_RETRIES = 3;
const JSON_WRITE_RETRY_DELAY_MS = 300;

function writeJsonRetrying(file, data, { hidden = false } = {}) {
  const text = JSON.stringify(data, null, 2);
  for (let attempt = 0; ; attempt++) {
    try {
      if (hidden) unhideFile(file);
      fs.writeFileSync(file, text, "utf8");
      if (hidden) hideFile(file);
      return;
    } catch (e) {
      if (attempt >= JSON_WRITE_RETRIES || !["EBUSY", "EPERM", "EACCES"].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, JSON_WRITE_RETRY_DELAY_MS);
    }
  }
}

function writeAppForm(absFile, data) {
  writeJsonRetrying(appFormSidecarAbsPath(absFile), data, { hidden: true });
}

// Every edit to a record saves just the fields it changed, merged into
// whatever's on disk *right now* -- not the whole record as this window last
// loaded it. On the shared folder, someone else may have changed another
// field of the same application since; writing the whole stale copy back
// would silently undo their change. Returns the merged record so the
// renderer picks up anyone else's edits along the way.
function mergeRecordPatch(current, patch, editor) {
  const rec = normalizeRecord(current);
  Object.assign(rec, patch);
  rec.meta = { ...rec.meta, updatedAt: new Date().toISOString(), lastEditedBy: editor || "Unknown" };
  return rec;
}

// Application files are filed by status: new ones land in Inbox (see
// import-gf-entries), and setting one's entry date moves it into Entered, so
// the folder tree alone shows what's been fully processed. Clearing the date
// again (or undoing it) sends the file back to Inbox, and a file loose at the
// root goes to whichever one fits (see fileLooseFiles). A same-named file
// already at the destination gets a " (n)" suffix, same as an import does.
const INBOX_DIRNAME = "Inbox";
const ENTERED_DIRNAME = "Entered";

function fileByEntryStatus(folder, relPath, rec) {
  const inEntered = relPath.startsWith(`${ENTERED_DIRNAME}/`);
  const atRoot = !relPath.includes("/");
  let destDir = null;
  if (rec.entryDate && !inEntered) destDir = ENTERED_DIRNAME;
  else if (!rec.entryDate && (inEntered || atRoot)) destDir = INBOX_DIRNAME;
  if (!destDir) return { path: relPath };
  const ext = path.extname(relPath);
  const base = path.basename(relPath, ext);
  let name = `${base}${ext}`;
  for (let n = 1; fs.existsSync(path.join(folder, destDir, name)); n++) name = `${base} (${n})${ext}`;
  const srcFull = path.join(folder, relPath);
  const destFull = path.join(folder, destDir, name);
  try {
    fs.mkdirSync(path.dirname(destFull), { recursive: true });
    fs.renameSync(srcFull, destFull);
  } catch (e) {
    return { path: relPath, moveError: `Saved, but couldn't move "${path.basename(relPath)}" to ${destDir}: ${e.message}` };
  }
  moveSidecarIfExists(srcFull, destFull);
  return { path: `${destDir}/${name}` };
}

// Nothing stays loose at the workspace root: a file dropped there (by a
// scanner, from Explorer, or synced in from another computer) is filed on
// the next scan. One still locked mid-copy just stays put until a later
// scan. Only done in a folder that already has an Inbox or Entered, so
// pointing "Choose folder" at the wrong place never rearranges it.
function fileLooseFiles(folder) {
  const isWorkspace = [INBOX_DIRNAME, ENTERED_DIRNAME].some((d) => fs.existsSync(path.join(folder, d)));
  if (!isWorkspace) return;
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    if (e.name.startsWith(".") || !e.isFile() || !ACCEPTED_EXT.includes(path.extname(e.name).toLowerCase())) continue;
    fileByEntryStatus(folder, e.name, normalizeRecord(readAppForm(path.join(folder, e.name))));
  }
}

ipcMain.handle("patch-app-form", async (event, folder, relPath, patch, editor) => {
  const absFile = path.join(folder, relPath);
  if (!fs.existsSync(absFile)) throw new Error("This application's file was moved or deleted (possibly on another computer). Refresh to see where it went.");
  const rec = mergeRecordPatch(readAppForm(absFile), patch, editor);
  writeAppForm(absFile, rec);
  // Only an edit to the entry date itself refiles — any other field leaves
  // the file wherever it is, even if someone has moved it by hand.
  const filed = "entryDate" in patch ? fileByEntryStatus(folder, relPath, rec) : { path: relPath };
  return { record: rec, ...filed };
});

// ---- Gravity Forms API import ----
//
// The org also collects Member Applications through a Gravity Forms-powered
// web form; this pulls submitted entries in as applications alongside
// scanned ones. Connection details (site URL, consumer key/secret, which
// form, which plan imports are filed under, and which online fields hold the
// name/member ID/start date -- see the renderer's API mapping modal) live
// in a hidden per-folder file, same precedent as
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
  writeJsonRetrying(apiConfigPath(folder), config, { hidden: true });
}

ipcMain.handle("get-api-config", async (event, folder) => {
  return readApiConfig(folder);
});

// The renderer saves its whole copy of the config (a new mapping, say), but
// someone else may have imported entries since that copy was loaded -- their
// import history is merged back in rather than dropped. Switching to a
// different form deliberately starts the history over (see pickApiForm).
ipcMain.handle("save-api-config", async (event, folder, config) => {
  const current = readApiConfig(folder);
  const merged =
    current && current.formId === config.formId
      ? { ...config, importedEntries: { ...(current.importedEntries || {}), ...(config.importedEntries || {}) } }
      : config;
  writeApiConfig(folder, merged);
  return merged;
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

// Every leaf input of the form, as { gfFieldId, label } -- what the mapping
// modal offers for each of the record's mapped fields. A compound field
// (Name, Address, ...) has an `inputs` array and contributes one row per
// sub-input, keyed "parentId.subInputId" (e.g. "1.3") -- confirmed from docs
// as the convention entries use for these -- so e.g. a Name field's First
// and Last can be picked separately. Hidden sub-inputs (an unused middle
// name) are skipped since they'll never carry real data; so are layout-only
// fields.
function flattenGfFields(form) {
  const rows = [];
  for (const field of form.fields || []) {
    if (["page", "html", "section", "captcha"].includes(field.type)) continue;
    if (Array.isArray(field.inputs) && field.inputs.length > 0) {
      for (const input of field.inputs) {
        if (input.isHidden) continue;
        rows.push({
          gfFieldId: String(input.id),
          // A sub-input named the same as its field is just the field.
          label: input.label && input.label !== field.label ? `${field.label} (${input.label})` : field.label || `Field ${input.id}`,
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
// docs alone -- this accepts either a bare array or an {entries,
// total_count} wrapper rather than assuming one, so a real mismatch
// surfaces as "0 entries found" (visible, correctable) instead of a thrown
// error or silently wrong data.
function normalizeEntriesResponse(raw) {
  if (Array.isArray(raw)) return { entries: raw, totalCount: raw.length };
  if (raw && Array.isArray(raw.entries)) {
    return { entries: raw.entries, totalCount: Number(raw.total_count) || raw.entries.length };
  }
  return { entries: [], totalCount: 0 };
}

// The entries endpoint pages its results (10 per page unless asked
// otherwise), so this walks every page rather than seeing only the newest
// few submissions.
const GF_PAGE_SIZE = 100;
const GF_MAX_PAGES = 50;

async function fetchAllGfEntries(config) {
  const all = [];
  let totalCount = 0;
  for (let page = 1; page <= GF_MAX_PAGES; page++) {
    const raw = await gfFetch(
      config.siteUrl,
      config.consumerKey,
      config.consumerSecret,
      `forms/${config.formId}/entries?paging[page_size]=${GF_PAGE_SIZE}&paging[current_page]=${page}`
    );
    const { entries, totalCount: total } = normalizeEntriesResponse(raw);
    totalCount = Math.max(totalCount, total);
    all.push(...entries);
    if (entries.length < GF_PAGE_SIZE || all.length >= totalCount) break;
  }
  return { entries: all, totalCount: Math.max(totalCount, all.length) };
}

// Which online field feeds each mapped record field: { firstName,
// lastName, memberId, startDate }, each a gfFieldId or "". A connection
// saved by version 0.1.x only has the old full-form `fieldMapping` -- its
// primary member's first/last name carry over from that.
function recordMapping(config) {
  if (config.recordMapping) return config.recordMapping;
  const legacy = (target) => ((config.fieldMapping || []).find((m) => m.target === target) || {}).gfFieldId || "";
  return { firstName: legacy("member:primary.firstName"), lastName: legacy("member:primary.lastName"), memberId: "", startDate: "" };
}

// The record fields one entry fills in, per the mapping. Blank answers are
// left out, so a caller merging into an existing record never blanks a value.
function mappedRecordFields(entry, mapping) {
  const get = (id) => (id ? String(entry[id] ?? "").trim() : "");
  const fields = {};
  const name = [get(mapping.firstName), get(mapping.lastName)].filter(Boolean).join(" ");
  if (name) fields.name = name;
  if (get(mapping.memberId)) fields.memberId = get(mapping.memberId);
  const startDate = normalizeDateToIso(get(mapping.startDate));
  if (startDate) fields.startDate = startDate;
  return fields;
}

ipcMain.handle("get-record-mapping", async (event, folder) => {
  const config = readApiConfig(folder);
  return config ? recordMapping(config) : null;
});

// Where each imported entry's file is now, by entry id. The path recorded at
// import time goes stale as soon as the file moves (into Entered, see
// fileByEntryStatus, or by hand), so the files' own sidecars -- which carry
// their gfEntryId wherever they go -- are checked too.
function importedEntryPaths(folder, config) {
  const found = {};
  for (const [id, relPath] of Object.entries(config.importedEntries || {})) {
    if (fs.existsSync(path.join(folder, relPath))) found[id] = relPath;
  }
  for (const { relPath } of walkFiles(folder)) {
    const rec = readAppForm(path.join(folder, relPath));
    const id = rec && rec.meta && rec.meta.gfEntryId;
    if (id) found[String(id)] = relPath;
  }
  return found;
}

ipcMain.handle("list-gf-entries", async (event, folder) => {
  const config = readApiConfig(folder);
  if (!config || !config.formId) throw new Error("No API connection configured for this folder yet.");
  const { entries, totalCount } = await fetchAllGfEntries(config);
  // An entry whose imported file has since been deleted is offered again --
  // that's how an application gets re-imported (e.g. to regenerate its PDF).
  const imported = importedEntryPaths(folder, config);
  const stillImported = (id) => !!imported[id];
  const mapping = recordMapping(config);
  const summarized = entries
    .filter((e) => !stillImported(String(e.id)))
    .map((e) => ({ id: String(e.id), date: e.date_created || "", name: mappedRecordFields(e, mapping).name || null }));
  return { totalFetched: totalCount, entries: summarized };
});

ipcMain.handle("import-gf-entries", async (event, folder, entryIds) => {
  const config = readApiConfig(folder);
  if (!config || !config.formId) throw new Error("No API connection configured for this folder yet.");
  const { entries } = await fetchAllGfEntries(config);
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  // The PDF lists every answer under the form's own labels and sections.
  // Best-effort: if the form can't be fetched, the PDF falls back to
  // numbered fields and the import still goes ahead.
  let fields = [];
  try {
    fields = (await gfFetch(config.siteUrl, config.consumerKey, config.consumerSecret, `forms/${config.formId}`)).fields || [];
  } catch {}
  const mapping = recordMapping(config);
  const inboxDir = path.join(folder, INBOX_DIRNAME);
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
      const record = { ...makeBlankRecord(config.plan || ""), ...mappedRecordFields(entry, mapping) };
      record.meta = { source: "online", gfEntryId: String(id), importedAt: new Date().toISOString() };
      const safeName = (record.name || `Entry ${id}`).replace(/[\\/:*?"<>|]/g, "_");
      let fileName = `Online - ${safeName} - ${id}.pdf`;
      let destFull = path.join(inboxDir, fileName);
      let n = 1;
      while (fs.existsSync(destFull)) {
        fileName = `Online - ${safeName} - ${id} (${n++}).pdf`;
        destFull = path.join(inboxDir, fileName);
      }
      fs.writeFileSync(destFull, await generateApplicationPdf({ entry, fields, plan: record.plan }));
      await writeFileMeta(destFull, ".pdf", ["API"], []);
      writeAppForm(destFull, record);
      const relPath = path.relative(folder, destFull).split(path.sep).join("/");
      importedEntries[String(id)] = relPath;
      imported.push({ id, path: relPath });
    } catch (e) {
      errors.push({ id, error: e.message });
    }
  }
  // Re-read before writing: an import can take a while, and someone else may
  // have saved the config (or imported) in the meantime.
  const latest = readApiConfig(folder) || config;
  writeApiConfig(folder, { ...latest, importedEntries: { ...(latest.importedEntries || {}), ...importedEntries } });
  return { imported, errors };
});

// After the mapping changes (or is set up for the first time on a
// connection that already has imports), fills in already-imported
// applications' name/member ID/start date -- and their plan, if they don't
// have one yet -- from a fresh fetch of their entries. Only ever fills a
// blank field: anything staff already typed in stays as it is.
ipcMain.handle("apply-mapping-to-imported", async (event, folder) => {
  const config = readApiConfig(folder);
  if (!config || !config.formId) return { updated: 0 };
  const importedEntries = importedEntryPaths(folder, config);
  if (Object.keys(importedEntries).length === 0) return { updated: 0 };
  const { entries } = await fetchAllGfEntries(config);
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  const mapping = recordMapping(config);
  let updated = 0;
  for (const [id, relPath] of Object.entries(importedEntries)) {
    const absPath = path.join(folder, relPath);
    const entry = byId.get(id);
    if (!entry || !fs.existsSync(absPath)) continue;
    const record = normalizeRecord(readAppForm(absPath));
    const fill = { ...mappedRecordFields(entry, mapping), ...(config.plan ? { plan: config.plan } : {}) };
    let touched = false;
    for (const [key, value] of Object.entries(fill)) {
      if (record[key]) continue;
      record[key] = value;
      touched = true;
    }
    if (!touched) continue;
    writeAppForm(absPath, record);
    updated++;
  }
  return { updated };
});

// ---- Plans ----
//
// The list of plans (funds) an application can belong to -- MAAP and AMCA
// to start, with room for more. Same hidden per-folder precedent as
// TAG_CONFIG_FILENAME: every computer pointed at the shared folder sees the
// same list. Which plan a given application belongs to is its own record's
// `plan` field (see application-form.js), not this file.
const PLANS_FILENAME = ".plans.json";

// Seeds the defaults only when the file genuinely doesn't exist yet. One
// that exists but can't be read right now (locked, or half-synced by
// OneDrive) falls back to the defaults for display without writing them --
// overwriting it would throw away plans someone else added.
function readPlans(folder) {
  const file = path.join(folder, PLANS_FILENAME);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") writePlans(folder, DEFAULT_PLANS);
    return [...DEFAULT_PLANS];
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.plans)) return parsed.plans;
  } catch {}
  return [...DEFAULT_PLANS];
}

function writePlans(folder, plans) {
  writeJsonRetrying(path.join(folder, PLANS_FILENAME), { plans }, { hidden: true });
}

ipcMain.handle("get-plans", async (event, folder) => readPlans(folder));

ipcMain.handle("save-plans", async (event, folder, plans) => {
  writePlans(folder, plans);
  return plans;
});

// ---- Record-only rows ----
//
// Tracker rows with no application file behind them -- members carried
// over from the old Member Tracker spreadsheet (see import-tracker-xlsx), or
// a row added by hand from the Tracker view. One small JSON file per row in
// a hidden `.records` folder (skipped by walkFiles/walkFolders like any
// dotfolder) rather than one shared file: several people editing different
// rows of one file on a synced OneDrive folder would keep tripping over each
// other's conflict copies, while separate files only ever conflict when two
// people edit the very same row.
const RECORDS_DIRNAME = ".records";

function recordsDir(folder) {
  return path.join(folder, RECORDS_DIRNAME);
}

function recordPath(folder, id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid record id "${id}".`);
  return path.join(recordsDir(folder), `${id}.json`);
}

function writeRecord(folder, id, data) {
  const dir = recordsDir(folder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    hideFile(dir);
  }
  const { id: _omit, ...body } = data;
  writeJsonRetrying(recordPath(folder, id), body);
}

function newRecordId() {
  return `r${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
}

function readRecordsDir(folder) {
  let names = [];
  try {
    names = fs.readdirSync(recordsDir(folder)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    try {
      const rec = normalizeRecord(JSON.parse(fs.readFileSync(path.join(recordsDir(folder), name), "utf8")));
      rec.id = name.slice(0, -".json".length);
      records.push(rec);
    } catch {
      // A half-synced or hand-mangled file -- skip it rather than fail the whole list.
    }
  }
  return records;
}

ipcMain.handle("list-records", async (event, folder) => readRecordsDir(folder));

// Writes a whole record: creating one (`id` null -- returns it with its new
// id), or putting back one Undo is restoring after a delete. Ordinary edits
// go through patch-record instead.
ipcMain.handle("save-record", async (event, folder, id, data) => {
  const recordId = id || newRecordId();
  writeRecord(folder, recordId, data);
  return { ...data, id: recordId };
});

// Same field-by-field merge as patch-app-form. A row someone else has
// deleted stays deleted rather than being quietly recreated by an edit made
// from a screen that hadn't caught up yet.
ipcMain.handle("patch-record", async (event, folder, id, patch, editor) => {
  let current;
  try {
    current = JSON.parse(fs.readFileSync(recordPath(folder, id), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("This row was deleted (possibly on another computer). Refresh to catch up.");
    throw e;
  }
  const rec = mergeRecordPatch(current, patch, editor);
  writeRecord(folder, id, rec);
  return { ...rec, id };
});

ipcMain.handle("delete-record", async (event, folder, id) => {
  try {
    fs.unlinkSync(recordPath(folder, id));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  return true;
});

// ---- Tracker spreadsheet import/export ----

// A one-time carry-over of the old Member Tracker workbook: each "<Plan>
// Members" sheet becomes record-only rows under that plan (added to the
// plan list if it's new). A row already present -- same plan, name, and
// entry date, whether as a record-only row or an application file -- is
// skipped, so importing the same workbook twice doesn't double it up.
//
// The old tracker sometimes has a member's start date typed into the Entry
// Date column, which shows up as an entry date in the future. Those become
// the row's Member Start Date (if it doesn't already have one), and the
// entry date becomes the day of the import. The sheet's original date is
// kept as meta.sourceEntryDate, so a re-import still recognizes the row.
ipcMain.handle("import-tracker-xlsx", async (event, folder) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import tracker spreadsheet",
    properties: ["openFile"],
    filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const sheets = await readTrackerWorkbook(result.filePaths[0]);

  const key = (r) => `${String(r.plan).toLowerCase()}|${String(r.name).trim().toLowerCase()}|${(r.meta && r.meta.sourceEntryDate) || r.entryDate}`;
  const existing = new Set(readRecordsDir(folder).map(key));
  for (const { relPath } of walkFiles(folder)) {
    const rec = readAppForm(path.join(folder, relPath));
    if (rec) existing.add(key(normalizeRecord(rec)));
  }

  const plans = readPlans(folder);
  const today = todayIso();
  const perPlan = [];
  const addedIds = []; // lets the renderer undo the whole import
  let futureDated = 0;
  for (const sheet of sheets) {
    if (sheet.plan && !plans.includes(sheet.plan)) plans.push(sheet.plan);
    let added = 0;
    let duplicates = 0;
    for (const rec of sheet.records) {
      if (existing.has(key(rec))) {
        duplicates++;
        continue;
      }
      existing.add(key(rec));
      if (rec.entryDate > today) {
        rec.meta = { ...rec.meta, sourceEntryDate: rec.entryDate };
        if (!rec.startDate) rec.startDate = rec.entryDate;
        rec.entryDate = today;
        futureDated++;
      }
      const id = newRecordId();
      writeRecord(folder, id, rec);
      addedIds.push(id);
      added++;
    }
    perPlan.push({ plan: sheet.plan, added, duplicates });
  }
  writePlans(folder, plans);
  return { file: path.basename(result.filePaths[0]), perPlan, addedIds, futureDated };
});

// `plans` is [{ name, records }] -- already filtered by the renderer to
// what the Tracker is showing.
ipcMain.handle("export-tracker-xlsx", async (event, plans, year, suggestedName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export tracker to Excel",
    defaultPath: path.join(app.getPath("documents"), suggestedName),
    filters: [{ name: "Excel workbook", extensions: ["xlsx"] }],
  });
  if (result.canceled || !result.filePath) return null;
  await writeTrackerWorkbook(result.filePath, plans, year);
  shell.showItemInFolder(result.filePath);
  return result.filePath;
});
