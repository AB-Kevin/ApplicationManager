// Excel in and out for the Tracker: reading the old Member Tracker
// spreadsheet in as record-only rows (a one-time carry-over, see main.js's
// import-tracker-xlsx), and writing a plan's tracker + summary back out as a
// report (export-tracker-xlsx). Kept out of main.js so it has no Electron
// dependency of its own.

const ExcelJS = require("exceljs");
const path = require("path");
const { makeBlankRecord, normalizeDateToIso, recordStatus, statusLabel, buildPlanSummary, formatDisplayDate } = require("./renderer/application-form.js");

// ---- Import ----

// A cell's plain value, whatever exceljs hands back: a formula's cached
// result, a rich-text run's joined text, a hyperlink's text, or the value
// itself (string/number/boolean/Date).
function cellValue(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if ("result" in v) return v.result ?? null;
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("text" in v) return v.text;
    return null;
  }
  return v;
}

// Header text -> record field. Matched case-insensitively against the
// header row; covers the old tracker's own headings plus this app's export
// (see writeTrackerWorkbook), so an exported file reads back in too.
const HEADER_FIELDS = [
  [/^(household|member)\s*id$/i, "memberId"],
  [/^(full\s*)?name$/i, "name"],
  [/^(application\s*)?entry\s*date$/i, "entryDate"],
  [/^(member\s*)?start\s*date$/i, "startDate"],
  [/^card\s*sent\s*date$/i, "cardSentDate"],
  [/^card\s*sent$/i, "cardSent"],
  [/^status$/i, "status"],
  [/^notes?$/i, "notes"],
];

function fieldForHeader(text) {
  const s = String(text || "").trim();
  const hit = HEADER_FIELDS.find(([re]) => re.test(s));
  return hit ? hit[1] : null;
}

// "MAAP Members" -> "MAAP" -- the old tracker kept one sheet per plan.
function planFromSheetName(name) {
  return String(name || "").replace(/\s+(members?|member list)$/i, "").trim();
}

// Reads every sheet that has a recognizable header row (one with a Name
// column, within its first 10 rows) -- the old tracker's "<Plan> Members"
// sheets; its "<Plan> Summary" sheets have none and are skipped. Returns
// [{ plan, records }], each record a fresh blank record (see
// makeBlankRecord) filled from one row.
async function readTrackerWorkbook(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheets = [];
  wb.eachSheet((ws) => {
    let headerRow = null;
    let columns = null;
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const cols = {};
      ws.getRow(r).eachCell((cell, col) => {
        const field = fieldForHeader(cellValue(cell));
        if (field && !(field in cols)) cols[field] = col;
      });
      if ("name" in cols) {
        headerRow = r;
        columns = cols;
        break;
      }
    }
    if (!headerRow) return;
    const plan = planFromSheetName(ws.name);
    const records = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (field) => (field in columns ? cellValue(row.getCell(columns[field])) : null);
      const name = String(get("name") ?? "").trim();
      const memberId = String(get("memberId") ?? "").trim();
      if (!name && !memberId) continue;
      const rec = makeBlankRecord(plan);
      rec.name = name;
      rec.memberId = memberId;
      rec.entryDate = normalizeDateToIso(get("entryDate"));
      rec.startDate = normalizeDateToIso(get("startDate"));
      rec.cardSentDate = normalizeDateToIso(get("cardSentDate"));
      const cardSentCell = get("cardSent");
      const status = String(get("status") ?? "").trim();
      // The old tracker had no checkbox: a row was "Complete" once its card
      // went out, and plenty of Complete rows never got a Card Sent Date.
      rec.cardSent = cardSentCell != null ? /^(yes|true|x|1)$/i.test(String(cardSentCell).trim()) || cardSentCell === true : /^complete$/i.test(status) || !!rec.cardSentDate;
      rec.meta = { source: "spreadsheet", importedFrom: path.basename(filePath) };
      // No Notes field on a record any more (see normalizeRecord) -- an old
      // spreadsheet's notes are kept out of sight with the import details.
      const notes = String(get("notes") ?? "").trim();
      if (notes) rec.meta.notes = notes;
      records.push(rec);
    }
    sheets.push({ plan, records });
  });
  return sheets;
}

// ---- Export ----

const GREEN = "FF006D46";
const MINT = "FFE8F1EC";

// "2026-06-19" -> a UTC-midnight Date, which exceljs writes as that exact
// day's Excel serial (it converts via getTime(), i.e. UTC).
function excelDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { vertical: "middle" };
  });
}

function styleTitle(cell) {
  cell.font = { bold: true, size: 14, color: { argb: GREEN } };
}

// One "<Plan> Members" sheet: every row, sorted by entry date (rows still
// awaiting entry last), with the same running totals the old tracker kept
// above its table.
function addMembersSheet(wb, plan, records) {
  const ws = wb.addWorksheet(`${plan} Members`.slice(0, 31), { views: [{ state: "frozen", ySplit: 4 }] });
  ws.getCell("A1").value = `${plan} Plan — Member List`;
  styleTitle(ws.getCell("A1"));
  const totals = buildPlanSummary(records, new Date().getFullYear()).totals;
  ws.getRow(2).values = [totals.total, "Total members", totals.complete, "Complete", totals.pending, "Pending card", totals.awaiting, "Awaiting entry"];
  [1, 3, 5, 7].forEach((c) => (ws.getRow(2).getCell(c).font = { bold: true }));

  const columns = [
    { header: "Member ID", key: "memberId", width: 14 },
    { header: "Name", key: "name", width: 28 },
    { header: "Application Entry Date", key: "entryDate", width: 22, date: true },
    { header: "Member Start Date", key: "startDate", width: 19, date: true },
    { header: "Card Sent", key: "cardSent", width: 11 },
    { header: "Card Sent Date", key: "cardSentDate", width: 16, date: true },
    { header: "Status", key: "status", width: 16 },
    { header: "File", key: "file", width: 40 },
  ];
  columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));
  ws.getRow(4).values = columns.map((c) => c.header);
  styleHeader(ws.getRow(4));

  const sorted = [...records].sort((a, b) => {
    if (!a.entryDate !== !b.entryDate) return a.entryDate ? -1 : 1;
    return (a.entryDate || "").localeCompare(b.entryDate || "") || (a.name || "").localeCompare(b.name || "");
  });
  sorted.forEach((r, i) => {
    const row = ws.getRow(5 + i);
    row.values = columns.map((c) => {
      if (c.date) return excelDate(r[c.key]);
      if (c.key === "cardSent") return r.cardSent ? "Yes" : "No";
      if (c.key === "status") return statusLabel(recordStatus(r));
      return r[c.key] || null;
    });
    columns.forEach((c, ci) => c.date && (row.getCell(ci + 1).numFmt = "d-mmm-yyyy"));
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + sorted.length, column: columns.length } };
}

// One "<Plan> Summary" sheet: the Summary view's monthly and weekly tables
// (see buildPlanSummary), as plain values.
function addSummarySheet(wb, plan, records, year) {
  const ws = wb.addWorksheet(`${plan} Summary`.slice(0, 31));
  const s = buildPlanSummary(records, year);
  ws.getColumn(1).width = 18;
  [2, 3, 4].forEach((c) => (ws.getColumn(c).width = 18));
  ws.getCell("A1").value = `${plan} Plan — Monthly & Weekly Summary (${year})`;
  styleTitle(ws.getCell("A1"));
  ws.getCell("A2").value = `Exported ${formatDisplayDate(new Date().toISOString().slice(0, 10))} · ${s.totals.total} total · ${s.totals.awaiting} awaiting entry · ${s.totals.pending} pending card · ${s.totals.complete} complete`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF58595B" } };

  const table = (startRow, title, firstHeader, rows, totals) => {
    ws.getCell(`A${startRow}`).value = title;
    ws.getCell(`A${startRow}`).font = { bold: true, color: { argb: GREEN } };
    ws.getRow(startRow + 1).values = [firstHeader, "Complete", "Pending card", "New applications"];
    styleHeader(ws.getRow(startRow + 1));
    rows.forEach((r, i) => (ws.getRow(startRow + 2 + i).values = [r.label, r.complete, r.pending, r.newApps]));
    const totalRow = ws.getRow(startRow + 2 + rows.length);
    totalRow.values = ["Total", totals.complete, totals.pending, totals.newApps];
    totalRow.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: MINT } };
    });
    return startRow + 3 + rows.length;
  };
  const next = table(4, "Monthly", "Month", s.months, s.monthTotals);
  table(next + 1, `Weekly (last ${s.weeks.length} weeks)`, "Week of", s.weeks, s.weekTotals);
}

// `plans` is [{ name, records }] -- one Members + one Summary sheet per
// plan, in that order, matching the old tracker's layout.
async function writeTrackerWorkbook(filePath, plans, year) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ApplicationManager";
  wb.created = new Date();
  plans.forEach((p) => addMembersSheet(wb, p.name, p.records));
  plans.forEach((p) => addSummarySheet(wb, p.name, p.records, year));
  await wb.xlsx.writeFile(filePath);
}

module.exports = { readTrackerWorkbook, writeTrackerWorkbook };
