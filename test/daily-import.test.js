"use strict";

// The daily import of online applications (renderer/daily-import.js, shared
// by the main process and the window): which submissions it takes, when it
// checks, and when the other computers warn.

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DAILY_IMPORT_INTERVAL_MS,
  DAILY_IMPORT_LATE_MS,
  DAILY_IMPORT_RETRY_MS,
  gfEntryTime,
  entriesForDailyImport,
  dailyImportDue,
  dailyImportWarning,
} = require("../renderer/daily-import.js");

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-16T15:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

test("a Gravity Forms date is read as UTC", () => {
  assert.equal(gfEntryTime({ date_created: "2026-11-16 14:30:00" }), Date.parse("2026-11-16T14:30:00Z"));
  assert.equal(gfEntryTime({ date_created: "" }), null);
});

test("it takes only new submissions from its start on", () => {
  const entries = [
    { id: 1, date_created: "2026-11-01 09:00:00" }, // before it was turned on
    { id: 2, date_created: "2026-11-10 09:00:00" }, // already imported
    { id: 3, date_created: "2026-11-12 09:00:00" },
    { id: 4, date_created: "2026-11-13 09:00:00", status: "spam" },
    { id: 5, date_created: "2026-11-14 09:00:00", status: "active" },
    { id: 6, date_created: "not a date" }, // taken rather than lost
  ];
  const ids = entriesForDailyImport(entries, { alreadyImported: new Set(["2"]), since: "2026-11-05T00:00:00Z" });
  assert.deepEqual(ids, ["3", "5", "6"]);
});

test("an imported application that was deleted isn't brought back", () => {
  // Its id stays in the import history after its file is deleted.
  const ids = entriesForDailyImport([{ id: 7, date_created: "2026-11-15 09:00:00" }], {
    alreadyImported: new Set(["7"]),
    since: "2026-11-01T00:00:00Z",
  });
  assert.deepEqual(ids, []);
});

test("it checks once a day, only on its own computer", () => {
  const daily = { computer: "OFFICE-PC", lastAutoCheckAt: ago(DAILY_IMPORT_INTERVAL_MS - HOUR) };
  assert.equal(dailyImportDue(daily, "OFFICE-PC", NOW), false);
  assert.equal(dailyImportDue({ ...daily, lastAutoCheckAt: ago(DAILY_IMPORT_INTERVAL_MS) }, "OFFICE-PC", NOW), true);
  assert.equal(dailyImportDue({ computer: "OFFICE-PC" }, "OFFICE-PC", NOW), true); // never checked
  assert.equal(dailyImportDue({ computer: "OFFICE-PC" }, "LAPTOP", NOW), false);
  assert.equal(dailyImportDue(undefined, "OFFICE-PC", NOW), false);
});

test("a failed check is tried again an hour later, not on every refresh", () => {
  const daily = { computer: "OFFICE-PC", lastError: { at: ago(HOUR / 2), message: "500" } };
  assert.equal(dailyImportDue(daily, "OFFICE-PC", NOW), false);
  assert.equal(dailyImportDue({ ...daily, lastError: { at: ago(DAILY_IMPORT_RETRY_MS) } }, "OFFICE-PC", NOW), true);
});

test("every computer warns when no computer runs it", () => {
  assert.deepEqual(dailyImportWarning(undefined, "LAPTOP", NOW), { kind: "unassigned" });
  assert.deepEqual(dailyImportWarning({ computer: null, lastCheckAt: ago(HOUR) }, "LAPTOP", NOW), { kind: "unassigned" });
});

test("other computers warn after two days without a check", () => {
  const daily = { computer: "OFFICE-PC", person: "Mary Martin", assignedAt: ago(10 * 24 * HOUR), lastCheckAt: ago(DAILY_IMPORT_LATE_MS - HOUR) };
  assert.equal(dailyImportWarning(daily, "LAPTOP", NOW), null);
  const late = { ...daily, lastCheckAt: ago(DAILY_IMPORT_LATE_MS + HOUR), lastError: { at: ago(HOUR), message: "403" } };
  assert.deepEqual(dailyImportWarning(late, "LAPTOP", NOW), {
    kind: "late",
    lastCheckAt: late.lastCheckAt,
    computer: "OFFICE-PC",
    person: "Mary Martin",
    message: "403",
  });
});

test("a computer that's just been set up gets its two days", () => {
  assert.equal(dailyImportWarning({ computer: "OFFICE-PC", assignedAt: ago(HOUR) }, "LAPTOP", NOW), null);
  assert.equal(dailyImportWarning({ computer: "OFFICE-PC", assignedAt: ago(DAILY_IMPORT_LATE_MS + HOUR) }, "LAPTOP", NOW).kind, "late");
});

test("the computer that runs it warns only about its own failures", () => {
  const daily = { computer: "OFFICE-PC", assignedAt: ago(10 * 24 * HOUR), lastCheckAt: ago(5 * 24 * HOUR) };
  assert.equal(dailyImportWarning(daily, "OFFICE-PC", NOW), null);
  const failing = { ...daily, lastError: { at: ago(HOUR), message: "Gravity Forms API error 401" } };
  assert.deepEqual(dailyImportWarning(failing, "OFFICE-PC", NOW), { kind: "failing", message: "Gravity Forms API error 401", at: failing.lastError.at });
});
