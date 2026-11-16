// The daily import of online applications. One computer -- whichever one has
// "Run the daily import on this computer" ticked in Online Applications >
// Settings -- checks the website once a day while ApplicationManager is open
// there, and imports every new submission. Every other computer shows a
// banner when no check has succeeded in two days, or when no computer is set
// to run it.
//
// What it knows lives in the folder's .api-config.json as `dailyImport` (see
// main.js), so every computer pointed at the folder reads the same thing:
//   computer        -- os.hostname() of the computer that runs it, or null
//   person          -- whose name was signed in there when it was ticked
//   assignedAt      -- when it was ticked there
//   since           -- only submissions from this moment on are imported by
//                      it; older ones are left to the manual import, so
//                      turning it on doesn't pull in the whole backlog
//   lastAutoCheckAt -- the daily import's last successful check
//   lastCheckAt     -- the last successful check by anyone, daily or manual
//   lastCheckOn     -- the computer that made it
//   lastImported    -- how many the last daily check imported
//   lastError       -- { at, message } from the last failed daily check, or null
//
// Shared by the main process (require'd -- see the module.exports guard at
// the bottom) and the renderer (a <script> tag before renderer.js, see
// index.html), like application-form.js.

const DAILY_IMPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Other computers warn once nothing has been checked for this long.
const DAILY_IMPORT_LATE_MS = 48 * 60 * 60 * 1000;
// A failed check is tried again after this long, not on every refresh.
const DAILY_IMPORT_RETRY_MS = 60 * 60 * 1000;

const timeOf = (iso) => {
  const t = Date.parse(iso || "");
  return Number.isNaN(t) ? null : t;
};

// Gravity Forms gives date_created as "YYYY-MM-DD HH:MM:SS" in UTC.
function gfEntryTime(entry) {
  const raw = String(entry?.date_created || "").trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return Date.parse(`${raw.replace(" ", "T")}Z`);
  return timeOf(raw);
}

// The ids the daily import takes: submissions it has never imported before
// (`alreadyImported` -- the import history plus whatever files carry an entry
// id), from `since` on, and not marked spam or trash on the website. An
// entry in the history whose file has since been deleted stays deleted: that
// was someone's choice, and the manual import still offers it. An entry with
// a date that can't be read is taken rather than skipped, so a format change
// shows up as extra imports instead of applications silently never arriving.
function entriesForDailyImport(entries, { alreadyImported, since }) {
  const from = timeOf(since) ?? 0;
  return entries
    .filter((e) => {
      if (alreadyImported.has(String(e.id))) return false;
      if (e.status && e.status !== "active") return false;
      const t = gfEntryTime(e);
      return t === null || t >= from;
    })
    .map((e) => String(e.id));
}

// Whether `computer` should check now.
function dailyImportDue(daily, computer, now) {
  if (!daily || !computer || daily.computer !== computer) return false;
  const lastError = timeOf(daily.lastError?.at);
  if (lastError !== null && now - lastError < DAILY_IMPORT_RETRY_MS) return false;
  const last = timeOf(daily.lastAutoCheckAt);
  return last === null || now - last >= DAILY_IMPORT_INTERVAL_MS;
}

// What `computer` should warn about, or null:
//   { kind: "unassigned" }                    no computer runs the daily import
//   { kind: "failing", message, at }          this is that computer, and its last check failed
//   { kind: "late", lastCheckAt, computer, person, message }
//                                             another computer runs it, and nothing
//                                             has been checked for two days
function dailyImportWarning(daily, computer, now) {
  if (!daily?.computer) return { kind: "unassigned" };
  if (daily.computer === computer) {
    return daily.lastError ? { kind: "failing", message: daily.lastError.message, at: daily.lastError.at } : null;
  }
  // Counted from when it was set up, so a computer that's just been ticked
  // gets its two days too.
  const times = [daily.lastCheckAt, daily.assignedAt].map(timeOf).filter((t) => t !== null);
  const last = times.length ? Math.max(...times) : null;
  if (last !== null && now - last <= DAILY_IMPORT_LATE_MS) return null;
  return {
    kind: "late",
    lastCheckAt: daily.lastCheckAt || null,
    computer: daily.computer,
    person: daily.person || null,
    message: daily.lastError?.message || null,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DAILY_IMPORT_INTERVAL_MS,
    DAILY_IMPORT_LATE_MS,
    DAILY_IMPORT_RETRY_MS,
    gfEntryTime,
    entriesForDailyImport,
    dailyImportDue,
    dailyImportWarning,
  };
}
