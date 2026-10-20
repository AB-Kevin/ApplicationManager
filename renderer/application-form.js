// Application record — the handful of fields ApplicationManager tracks for
// each application while it waits to be entered into the membership
// software, and after: who it is, which plan it's for, when it was entered,
// when membership starts, and whether the member card has gone out. Shared
// by the main process (require'd -- see the module.exports guard at the
// bottom) and the renderer (loaded via a <script> tag before renderer.js,
// see index.html, since this app has no bundler). The render/wire functions
// near the bottom are renderer-only; they're only ever called after
// renderer.js has finished loading, so their forward references to its
// globals (state, render, pushUndo, escapeHtml, escapeAttr, ICONS, ...)
// resolve fine despite the script order.
//
// A record lives in one of two places: an application file's hidden
// `.<filename>.appform.json` sidecar (see main.js's appFormSidecarAbsPath),
// or -- for a row with no file at all, e.g. one carried over from the old
// Member Tracker spreadsheet -- its own JSON file in the workspace's hidden
// `.records` folder (see main.js's RECORDS_DIRNAME). Same shape either way.

// Seeded into a workspace's `.plans.json` the first time it's opened (see
// main.js's readPlans); more can be added from the rail's Plans > Manage.
const DEFAULT_PLANS = ["MAAP", "AMCA"];

const RECORD_VERSION = 2;

// Derived, never stored -- see recordStatus. Labels match the old tracker
// spreadsheet's own wording where it had one ("Complete", "Pending Cards").
const STATUSES = [
  { key: "awaiting", label: "Awaiting entry" },
  { key: "pending", label: "Pending card" },
  { key: "complete", label: "Complete" },
];

function makeBlankRecord(plan) {
  return {
    version: RECORD_VERSION,
    plan: plan || "",
    name: "",
    memberId: "",
    entryDate: "", // "YYYY-MM-DD", or "" while it's still waiting to be entered
    startDate: "",
    cardSent: false,
    cardSentDate: "", // stamped automatically when cardSent is checked (see setCardSent)
    meta: {},
  };
}

// Brings any stored record up to the current shape. A sidecar written by
// version 0.1.x holds the old full paper-form schema (householdMembers,
// health questionnaires, ...) -- its primary member's name carries over,
// and the rest is kept, untouched, under `legacy` rather than thrown away.
function normalizeRecord(raw) {
  const rec = makeBlankRecord();
  if (!raw || typeof raw !== "object") return rec;
  if (!raw.version && Array.isArray(raw.householdMembers)) {
    const primary = raw.householdMembers.find((m) => m && m.role === "primary") || {};
    rec.name = [primary.firstName, primary.lastName].map((s) => String(s || "").trim()).filter(Boolean).join(" ");
    rec.legacy = raw;
    return rec;
  }
  for (const key of Object.keys(rec)) {
    if (raw[key] !== undefined && raw[key] !== null) rec[key] = raw[key];
  }
  rec.cardSent = !!rec.cardSent;
  if (raw.legacy) rec.legacy = raw.legacy;
  if (raw.id) rec.id = raw.id;
  rec.meta = { ...(raw.meta || {}) };
  // Records used to have a free-text Notes field; comments (signed with who
  // wrote them) replaced it. Anything already written there is kept, out of
  // sight, rather than dropped the next time the record is saved.
  if (raw.notes && String(raw.notes).trim() && !rec.meta.notes) rec.meta.notes = String(raw.notes).trim();
  rec.version = RECORD_VERSION;
  return rec;
}

function recordStatus(rec) {
  if (rec.cardSent) return "complete";
  if (rec.entryDate) return "pending";
  return "awaiting";
}

function statusLabel(key) {
  return (STATUSES.find((s) => s.key === key) || STATUSES[0]).label;
}

// ---- Dates ----
// Every stored date is a plain "YYYY-MM-DD" string (what <input type=date>
// reads and writes) -- no time, no time zone, so a date can never drift a
// day across a UTC conversion.

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toIsoDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function todayIso() {
  return toIsoDate(new Date());
}

// Accepts whatever a date arrives as -- an ISO string (with or without a
// time part), US "3/4/2026" or "3/4/26", Gravity Forms' "2026/03/04", or a
// Date (an Excel cell, read at UTC midnight -- see tracker-xlsx.js) -- and
// returns "YYYY-MM-DD", or "" if it isn't recognizably a date.
function normalizeDateToIso(raw) {
  if (raw instanceof Date) {
    if (isNaN(raw)) return "";
    return `${raw.getUTCFullYear()}-${pad2(raw.getUTCMonth() + 1)}-${pad2(raw.getUTCDate())}`;
  }
  const s = String(raw || "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s);
  if (m) {
    let year = Number(m[3]);
    if (m[3].length === 2) year += year > new Date().getFullYear() % 100 ? 1900 : 2000;
    return `${year}-${pad2(m[1])}-${pad2(m[2])}`;
  }
  return "";
}

// "2026-06-19" -> a local-midnight Date (new Date("2026-06-19") would be
// UTC midnight, the previous day anywhere west of Greenwich).
function isoToLocalDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function formatDisplayDate(iso) {
  const d = isoToLocalDate(iso);
  return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}

// The Monday of the week `iso` falls in -- the old spreadsheet's "Week Of"
// column (C - WEEKDAY(C, 2) + 1).
function weekStartIso(iso) {
  const d = isoToLocalDate(iso);
  if (!d) return "";
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toIsoDate(d);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---- Summary ----
// The old spreadsheet's "<Plan> Summary" sheet, computed: per month of
// `year` and per week for the last WEEKS_IN_SUMMARY weeks (ending with the
// week `today` falls in), how many applications were entered and how many
// of those have had their card sent. Like the spreadsheet, a row counts
// toward the period of its Application Entry Date, and "New applications"
// is everything entered in that period (Complete + Pending card). Rows still
// awaiting entry have no entry date, so they only show up in `totals`.
const WEEKS_IN_SUMMARY = 10;

function buildPlanSummary(records, year, today = todayIso()) {
  const totals = { total: records.length, awaiting: 0, pending: 0, complete: 0 };
  records.forEach((r) => totals[recordStatus(r)]++);

  const months = MONTH_NAMES.map((name, i) => ({ key: `${year}-${pad2(i + 1)}`, label: `${name} ${year}`, complete: 0, pending: 0, newApps: 0 }));
  const thisWeek = weekStartIso(today);
  const weeks = [];
  for (let i = WEEKS_IN_SUMMARY - 1; i >= 0; i--) {
    const d = isoToLocalDate(thisWeek);
    d.setDate(d.getDate() - 7 * i);
    const start = toIsoDate(d);
    weeks.push({ key: start, label: formatDisplayDate(start), complete: 0, pending: 0, newApps: 0 });
  }
  const monthByKey = new Map(months.map((m) => [m.key, m]));
  const weekByKey = new Map(weeks.map((w) => [w.key, w]));

  records.forEach((r) => {
    if (!r.entryDate) return;
    const status = recordStatus(r);
    for (const bucket of [monthByKey.get(r.entryDate.slice(0, 7)), weekByKey.get(weekStartIso(r.entryDate))]) {
      if (!bucket) continue;
      bucket[status]++;
      bucket.newApps++;
    }
  });
  const sum = (rows) => rows.reduce((t, r) => ({ complete: t.complete + r.complete, pending: t.pending + r.pending, newApps: t.newApps + r.newApps }), { complete: 0, pending: 0, newApps: 0 });
  return { year, totals, months, monthTotals: sum(months), weeks, weekTotals: sum(weeks) };
}

// Every year any of `records` was entered in, plus the current one, newest
// first -- the Summary view's year picker.
function summaryYears(records) {
  const years = new Set([new Date().getFullYear()]);
  records.forEach((r) => r.entryDate && years.add(Number(r.entryDate.slice(0, 4))));
  return [...years].sort((a, b) => b - a);
}

// ---- Application fields (renderer only) ----
// The record's fields as a small form -- the preview pane's top section for
// a single selected file (see renderer.js's renderPreviewSingle). `row` is
// a tracker row ({ key, record, file }, see renderer.js's rowForFile): the
// same edit path the Tracker view's cells use, so both stay in sync.

function renderApplicationFieldsHtml(row) {
  const rec = row.record;
  const status = recordStatus(rec);
  return `
    <div class="bm-appfields">
      <div class="bm-appfields-head">
        <div class="bm-section-label">Application</div>
        <span class="bm-status bm-status--${status}">${statusLabel(status)}</span>
      </div>
      <div class="bm-appfields-grid">
        <div class="bm-field bm-appfields-wide">
          <label class="bm-field-label" for="app-plan">Plan</label>
          <select class="bm-select" id="app-plan" data-app-field="plan">${planOptionsHtml(rec.plan)}</select>
        </div>
        <div class="bm-field bm-appfields-wide">
          <label class="bm-field-label" for="app-name">Name</label>
          <input class="bm-input" id="app-name" data-app-field="name" data-kind="text" value="${escapeAttr(rec.name)}" />
        </div>
        <div class="bm-field">
          <label class="bm-field-label" for="app-member-id">Member ID</label>
          <input class="bm-input" id="app-member-id" data-app-field="memberId" data-kind="text" value="${escapeAttr(rec.memberId)}" />
        </div>
        <div class="bm-field">
          <label class="bm-field-label" for="app-start-date">Member start date</label>
          <input class="bm-input" id="app-start-date" type="date" data-app-field="startDate" data-kind="date" value="${escapeAttr(rec.startDate)}" />
        </div>
        <div class="bm-field bm-appfields-wide">
          <label class="bm-field-label" for="app-entry-date">Application entry date</label>
          <div class="bm-field-row">
            <input class="bm-input bm-appfields-date" id="app-entry-date" type="date" data-app-field="entryDate" data-kind="date" value="${escapeAttr(rec.entryDate)}" />
            <button class="bm-btn bm-btn-secondary bm-btn-sm" id="app-entry-today" ${rec.entryDate === todayIso() ? "disabled" : ""}>Today</button>
          </div>
        </div>
        <label class="bm-checkbox-label bm-appfields-wide">
          <input type="checkbox" id="app-card-sent" ${rec.cardSent ? "checked" : ""} />
          Member card sent${rec.cardSent && rec.cardSentDate ? `<span class="bm-appfields-caption">on ${formatDisplayDate(rec.cardSentDate)}</span>` : ""}
        </label>
      </div>
    </div>`;
}

function wireApplicationFields(panel, row) {
  panel.querySelectorAll('[data-app-field][data-kind="text"]').forEach((input) => {
    wireRecordTextInput(input, row, input.dataset.appField);
  });
  // A date or a select is one discrete change, not a run of keystrokes --
  // saved (and undoable) right away.
  panel.querySelectorAll('[data-app-field][data-kind="date"], select[data-app-field]').forEach((input) => {
    input.addEventListener("change", () => setRecordFields(row, { [input.dataset.appField]: input.value }));
  });
  panel.querySelector("#app-entry-today").addEventListener("click", () => setRecordFields(row, { entryDate: todayIso() }));
  panel.querySelector("#app-card-sent").addEventListener("change", (e) => setCardSent(row, e.target.checked));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_PLANS,
    STATUSES,
    makeBlankRecord,
    normalizeRecord,
    recordStatus,
    statusLabel,
    todayIso,
    normalizeDateToIso,
    formatDisplayDate,
    weekStartIso,
    buildPlanSummary,
    summaryYears,
  };
}
