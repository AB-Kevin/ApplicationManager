const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  listFiles: (folder) => ipcRenderer.invoke("list-files", folder),
  // A dropped browser File object carries no filesystem path of its own
  // (Electron removed the old File.path shortcut) — webUtils.getPathForFile
  // is the sanctioned replacement, only callable from the preload/main side.
  getPathForFile: (file) => webUtils.getPathForFile(file),
  importFiles: (folder, absPaths, destDir) => ipcRenderer.invoke("import-files", folder, absPaths, destDir),
  updateFileMeta: (folder, filename, patch) =>
    ipcRenderer.invoke("update-file-meta", folder, filename, patch),
  deleteFile: (folder, filename) => ipcRenderer.invoke("delete-file", folder, filename),
  deleteFiles: (folder, relPaths) => ipcRenderer.invoke("delete-files-batch", folder, relPaths),
  restoreFile: (trashPath, folder, filename) => ipcRenderer.invoke("restore-file", trashPath, folder, filename),
  listFolders: (folder) => ipcRenderer.invoke("list-folders", folder),
  nudgeWindowFocus: () => ipcRenderer.invoke("nudge-window-focus"),
  openFile: (folder, filename) => ipcRenderer.invoke("open-file", folder, filename),
  getTagConfig: (folder) => ipcRenderer.invoke("get-tag-config", folder),
  saveTagConfig: (folder, tags) => ipcRenderer.invoke("save-tag-config", folder, tags),
  patchAppForm: (folder, filename, patch, editor) => ipcRenderer.invoke("patch-app-form", folder, filename, patch, editor),
  getApiConfig: (folder) => ipcRenderer.invoke("get-api-config", folder),
  saveApiConfig: (folder, config) => ipcRenderer.invoke("save-api-config", folder, config),
  getPlans: (folder) => ipcRenderer.invoke("get-plans", folder),
  savePlans: (folder, plans) => ipcRenderer.invoke("save-plans", folder, plans),
  listRecords: (folder) => ipcRenderer.invoke("list-records", folder),
  saveRecord: (folder, id, data) => ipcRenderer.invoke("save-record", folder, id, data),
  patchRecord: (folder, id, patch, editor) => ipcRenderer.invoke("patch-record", folder, id, patch, editor),
  deleteRecord: (folder, id) => ipcRenderer.invoke("delete-record", folder, id),
  importTrackerXlsx: (folder) => ipcRenderer.invoke("import-tracker-xlsx", folder),
  exportTrackerXlsx: (plans, year, suggestedName) => ipcRenderer.invoke("export-tracker-xlsx", plans, year, suggestedName),
  testGfConnection: (siteUrl, consumerKey, consumerSecret) =>
    ipcRenderer.invoke("test-gf-connection", siteUrl, consumerKey, consumerSecret),
  getGfFormFields: (siteUrl, consumerKey, consumerSecret, formId) =>
    ipcRenderer.invoke("get-gf-form-fields", siteUrl, consumerKey, consumerSecret, formId),
  listGfEntries: (folder) => ipcRenderer.invoke("list-gf-entries", folder),
  importGfEntries: (folder, entryIds) => ipcRenderer.invoke("import-gf-entries", folder, entryIds),
  getRecordMapping: (folder) => ipcRenderer.invoke("get-record-mapping", folder),
  applyMappingToImported: (folder) => ipcRenderer.invoke("apply-mapping-to-imported", folder),
  getLastFolder: () => ipcRenderer.invoke("get-last-folder"),
  setLastFolder: (folder) => ipcRenderer.invoke("set-last-folder", folder),
  getCommenterName: () => ipcRenderer.invoke("get-commenter-name"),
  setCommenterName: (name) => ipcRenderer.invoke("set-commenter-name", name),
  getAbAppsName: () => ipcRenderer.invoke("get-ab-apps-name"),
  onAbAppsName: (callback) => {
    const listener = (event, name) => callback(name);
    ipcRenderer.on("ab-apps-name", listener);
    return () => ipcRenderer.removeListener("ab-apps-name", listener);
  },
  getTheme: () => ipcRenderer.invoke("get-theme"),
  setTheme: (theme) => ipcRenderer.invoke("set-theme", theme),
  setRotation: (folder, filename, degrees) => ipcRenderer.invoke("set-rotation", folder, filename, degrees),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  quitAndInstall: () => ipcRenderer.invoke("quit-and-install"),
  openReleasesPage: () => ipcRenderer.invoke("open-releases-page"),
  onUpdateStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
  openRepo: () => ipcRenderer.invoke("open-repo-page"),
  rollbackToPreviousVersion: () => ipcRenderer.invoke("rollback-to-previous-version"),
  onRollbackStatus: (callback) => {
    const listener = (event, status) => callback(status);
    ipcRenderer.on("rollback-status", listener);
    return () => ipcRenderer.removeListener("rollback-status", listener);
  },
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximizeToggle: () => ipcRenderer.invoke("window-maximize-toggle"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  onWindowState: (callback) => {
    const listener = (event, state) => callback(state);
    ipcRenderer.on("window-state", listener);
    return () => ipcRenderer.removeListener("window-state", listener);
  },
});
