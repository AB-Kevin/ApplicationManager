"use strict";

// The application record, its dates, and the tracker summary
// (renderer/application-form.js, shared by the main process and the window).

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  makeBlankRecord,
  normalizeRecord,
  recordStatus,
  statusLabel,
  normalizeDateToIso,
  weekStartIso,
  buildPlanSummary,
  summaryYears,
} = require("../renderer/application-form.js");

test("a record is brought up to the current shape, keeping what it had", () => {
  const rec = normalizeRecord({ plan: "MAAP", name: "Amos Beiler", memberId: "BEILA123", cardSent: 1, id: "r1", meta: { source: "online" } });
  assert.equal(rec.version, 2);
  assert.equal(rec.name, "Amos Beiler");
  assert.equal(rec.cardSent, true);
  assert.equal(rec.id, "r1");
  assert.deepEqual(rec.meta, { source: "online" });
  assert.deepEqual(normalizeRecord(null), makeBlankRecord());
});

test("a version 0.1 sidecar keeps its primary member's name, and the rest under legacy", () => {
  const old = { householdMembers: [{ role: "spouse", firstName: "Ruth" }, { role: "primary", firstName: " Amos ", lastName: "Beiler" }], health: { q1: "no" } };
  const rec = normalizeRecord(old);
  assert.equal(rec.name, "Amos Beiler");
  assert.deepEqual(rec.legacy, old);
});

test("old notes become a comment signed with where they came from", () => {
  const rec = normalizeRecord({ name: "Mary Esh", notes: "Called about the card", meta: { importedFrom: "Tracker.xlsx" } });
  assert.deepEqual(rec.comments, ["Called about the card\n— Imported from Tracker.xlsx"]);
  assert.equal(rec.meta.notes, undefined);
});

test("status follows the entry date and the card", () => {
  assert.equal(recordStatus({ entryDate: "", cardSent: false }), "awaiting");
  assert.equal(recordStatus({ entryDate: "2026-03-04", cardSent: false }), "pending");
  assert.equal(recordStatus({ entryDate: "", cardSent: true }), "complete");
  assert.equal(statusLabel("pending"), "Pending card");
  assert.equal(statusLabel("nonsense"), "Awaiting entry");
});

test("dates arrive in any of their usual forms and are stored as YYYY-MM-DD", () => {
  assert.equal(normalizeDateToIso("2026-03-04T10:00:00Z"), "2026-03-04");
  assert.equal(normalizeDateToIso("2026/3/4"), "2026-03-04");
  assert.equal(normalizeDateToIso("3/4/2026"), "2026-03-04");
  assert.equal(normalizeDateToIso("3/4/26"), "2026-03-04");
  assert.equal(normalizeDateToIso(new Date(Date.UTC(2026, 2, 4))), "2026-03-04", "an Excel cell, read at UTC midnight");
  assert.equal(normalizeDateToIso("not a date"), "");
  assert.equal(normalizeDateToIso(new Date("x")), "");
});

test("a week starts on Monday", () => {
  assert.equal(weekStartIso("2026-10-27"), "2026-10-26"); // a Tuesday
  assert.equal(weekStartIso("2026-10-26"), "2026-10-26");
  assert.equal(weekStartIso("2026-11-01"), "2026-10-26"); // a Sunday
  assert.equal(weekStartIso(""), "");
});

test("the summary counts each application in the month and week it was entered", () => {
  const records = [
    { entryDate: "2026-10-20", cardSent: true },
    { entryDate: "2026-10-27", cardSent: false },
    { entryDate: "2026-03-02", cardSent: true },
    { entryDate: "", cardSent: false },
    { entryDate: "2025-12-31", cardSent: true },
  ];
  const s = buildPlanSummary(records, 2026, "2026-10-28");
  assert.deepEqual(s.totals, { total: 5, awaiting: 1, pending: 1, complete: 3 });
  const october = s.months.find((m) => m.key === "2026-10");
  assert.deepEqual([october.complete, october.pending, october.newApps], [1, 1, 2]);
  assert.deepEqual(s.monthTotals, { complete: 2, pending: 1, newApps: 3 }, "last year's isn't in this year's months");
  assert.equal(s.weeks.length, 10);
  assert.equal(s.weeks.at(-1).key, "2026-10-26");
  assert.deepEqual([s.weeks.at(-1).newApps, s.weeks.at(-2).newApps], [1, 1]);
  const years = summaryYears(records);
  assert.ok(years.includes(new Date().getFullYear()) && years.includes(2025), "every year entered in, and this one");
  assert.deepEqual(years, [...years].sort((a, b) => b - a), "newest first");
});
