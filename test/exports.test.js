"use strict";

// The tracker spreadsheet (tracker-xlsx.js) and the PDF an online
// application is filed as (application-pdf.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const { readTrackerWorkbook, writeTrackerWorkbook } = require("../tracker-xlsx.js");
const { generateApplicationPdf } = require("../application-pdf.js");
const { makeBlankRecord } = require("../renderer/application-form.js");

const record = (fields) => ({ ...makeBlankRecord("MAAP"), ...fields });

test("an exported tracker reads back in as the same records", async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "appmanager-tracker-")), "Tracker.xlsx");
  const records = [
    record({ name: "Amos Beiler", memberId: "BEILA123", entryDate: "2026-03-04", startDate: "2026-04-01", cardSent: true, cardSentDate: "2026-03-20", comments: ["Called about the card\n— Kevin, Mar 5, 2026"] }),
    record({ name: "Mary Esh", memberId: "ESHM045", entryDate: "2026-10-20" }),
    record({ name: "Daniel Fisher" }),
  ];
  await writeTrackerWorkbook(file, [{ name: "MAAP", records }], 2026);

  const sheets = await readTrackerWorkbook(file);
  assert.deepEqual(sheets.map((s) => s.plan), ["MAAP"], "the Summary sheet has no Name column and is skipped");
  const byName = new Map(sheets[0].records.map((r) => [r.name, r]));
  assert.equal(byName.size, 3);
  const amos = byName.get("Amos Beiler");
  assert.deepEqual(
    [amos.memberId, amos.entryDate, amos.startDate, amos.cardSent, amos.cardSentDate, amos.plan],
    ["BEILA123", "2026-03-04", "2026-04-01", true, "2026-03-20", "MAAP"]
  );
  assert.deepEqual(amos.comments, ["Called about the card\n— Kevin, Mar 5, 2026"], "signed comments come back as they were");
  assert.equal(byName.get("Mary Esh").cardSent, false);
  assert.equal(byName.get("Daniel Fisher").entryDate, "");
});

test("an online application becomes a PDF of its answers under the form's own labels", async () => {
  const fields = [
    { id: 1, type: "section", label: "About you" },
    { id: 2, type: "name", label: "Name", inputs: [{ id: "2.3", label: "First" }, { id: "2.6", label: "Last" }] },
    { id: 3, type: "email", label: "Email" },
    { id: 4, type: "textarea", label: "Anything else?" },
  ];
  const entry = { id: "57", date_created: "2026-10-20 14:05:00", "2.3": "Amos", "2.6": "Beiler", 3: "amos@example.org", 4: "Line one\nLine two" };
  const bytes = await generateApplicationPdf({ entry, fields, plan: "MAAP" });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getTitle(), "Member Application - Online entry #57");
  assert.equal(pdf.getAuthor(), "Anabaptist Brotherhood");

  const empty = await PDFDocument.load(await generateApplicationPdf({ entry: { id: "58" }, fields: [], plan: "" }));
  assert.equal(empty.getPageCount(), 1, "a submission with no answers still makes a page");
});
