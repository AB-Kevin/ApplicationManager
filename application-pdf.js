// The PDF generated for each application imported from the online form (see
// main.js's import-gf-entries) -- the copy staff work from while entering
// the application into the membership software. Every answered field of the
// online form, in the form's own order and under its own labels and section
// headings, straight from the Gravity Forms field list: nothing has to be
// mapped for an answer to show up here (only the record's name, member ID,
// and start date are mapped -- see the renderer's API mapping modal).
//
// pdf-lib's built-in Helvetica only (no font embedding step, no native
// build step), which limits text to the WinAnsi character set -- see
// makeSanitizer.

const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const LOGO_PATH = path.join(__dirname, "assets", "logo-primary-lockup.jpg");

// Brand & Design Manual v1.1 colors (see renderer/styles.css's tokens).
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const COLORS = {
  green: hex("#006D46"),
  mint: hex("#E8F1EC"),
  charcoal: hex("#231F20"),
  gray: hex("#58595B"),
  rule: hex("#D5D6D7"),
  white: rgb(1, 1, 1),
};

// US Letter.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 40;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_TOP = PAGE_H - 100;
const CONTENT_BOTTOM = 56;
const LABEL_W = 190;
const VALUE_X = MARGIN_X + LABEL_W + 12;
const VALUE_W = CONTENT_W - LABEL_W - 12;
const LINE_H = 11.5;

const FOOTER_TEXT = "PO Box 144, Guys Mills, PA 16327 • info@AnabaptistBrotherhood.org • AnabaptistBrotherhood.org";

// Field types that never carry an answer of their own.
const NON_ANSWER_TYPES = new Set(["page", "html", "captcha", "section"]);

// ---- Answers ----

// "2015-03-04" -> "03/04/2015"; anything else as-is.
function formatDate(raw) {
  const s = String(raw || "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : s;
}

// A value Gravity Forms stores as a JSON-encoded array (multi-select, a
// multi-file upload) arrives as a string; anything else comes back as-is.
function maybeJsonArray(value) {
  if (typeof value !== "string" || !value.trim().startsWith("[")) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

// A choice field stores its choice's value, which is its label unless the
// form has "show values" turned on -- show the label either way.
function choiceLabel(field, value) {
  const choice = (field.choices || []).find((c) => String(c.value) === String(value));
  return choice && choice.text ? String(choice.text) : String(value);
}

function isBlank(v) {
  return v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && v.length === 0);
}

// One field's answer as a list of display lines (most are one line; a List
// field gets a line per row), or [] if it wasn't answered.
function answerLines(field, entry) {
  const type = field.inputType || field.type;
  const id = String(field.id);
  if (Array.isArray(field.inputs) && field.inputs.length > 0) {
    if (type === "consent") return entry[`${id}.1`] ? ["Agreed"] : [];
    const parts = field.inputs.map((input) => entry[String(input.id)]).filter((v) => !isBlank(v)).map(String);
    if (parts.length === 0) return [];
    if (type === "name") return [parts.join(" ")];
    if (type === "checkbox") return [parts.map((v) => choiceLabel(field, v)).join(", ")];
    return [parts.join(", ")];
  }
  const value = maybeJsonArray(entry[id]);
  if (isBlank(value)) return [];
  if (Array.isArray(value)) {
    if (type === "list") {
      return value
        .map((row) =>
          row && typeof row === "object"
            ? Object.entries(row).filter(([, v]) => !isBlank(v)).map(([k, v]) => `${k}: ${v}`).join(", ")
            : String(row ?? "")
        )
        .filter((s) => s.trim());
    }
    return [value.map((v) => choiceLabel(field, v)).join(", ")];
  }
  if (type === "date") return [formatDate(value)];
  if (field.choices) return [choiceLabel(field, value)];
  return [String(value)];
}

// The form's fields in order, as { kind: "section", title } and
// { kind: "answer", label, lines } items -- unanswered fields dropped, and
// a section heading only kept if something under it was answered. If the
// form's field list couldn't be fetched (`fields` empty), falls back to the
// entry's own numbered keys, labeled by number.
function buildItems(fields, entry) {
  if (!fields || fields.length === 0) {
    return Object.keys(entry)
      .filter((k) => /^\d+(\.\d+)?$/.test(k) && !isBlank(entry[k]))
      .sort((a, b) => parseFloat(a) - parseFloat(b))
      .map((k) => ({ kind: "answer", label: `Field ${k}`, lines: [String(entry[k])] }));
  }
  const items = [];
  let pendingSection = null;
  fields.forEach((field) => {
    if (field.type === "section") {
      pendingSection = { kind: "section", title: field.label || "" };
      return;
    }
    if (NON_ANSWER_TYPES.has(field.type)) return;
    const lines = answerLines(field, entry);
    if (lines.length === 0) return;
    if (pendingSection) {
      items.push(pendingSection);
      pendingSection = null;
    }
    items.push({ kind: "answer", label: field.label || field.adminLabel || `Field ${field.id}`, lines });
  });
  return items;
}

// ---- Drawing ----

// Helvetica (a standard, non-embedded font) can only draw WinAnsi
// characters -- anything else would make pdf-lib throw mid-document, so
// every string is mapped through this first: a few common look-alikes get a
// close substitute, anything else becomes "?".
function makeSanitizer(font) {
  const supported = new Set(font.getCharacterSet());
  const SUBSTITUTES = { "→": "->", "←": "<-", "✓": "x", "✔": "x", "‐": "-", "‑": "-", "−": "-", " ": " " };
  return (text) =>
    Array.from(String(text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, " "))
      .map((ch) => (ch === "\n" || supported.has(ch.codePointAt(0)) ? ch : SUBSTITUTES[ch] ?? "?"))
      .join("");
}

class AnswerSheetWriter {
  constructor(pdf, fonts, logo, title, metaLine) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.logo = logo;
    this.title = title;
    this.metaLine = metaLine;
    this.clean = makeSanitizer(fonts.regular);
    this.page = null;
    this.y = 0;
  }

  text(str, x, y, { size = 9, font = this.fonts.regular, color = COLORS.charcoal } = {}) {
    const s = this.clean(str).replace(/\n/g, " ");
    if (s) this.page.drawText(s, { x, y, size, font, color });
  }

  wrap(str, maxW, size, font) {
    const lines = [];
    this.clean(str)
      .split("\n")
      .forEach((para) => {
        let line = "";
        para.split(/\s+/).filter(Boolean).forEach((word) => {
          const candidate = line ? `${line} ${word}` : word;
          if (font.widthOfTextAtSize(candidate, size) <= maxW) {
            line = candidate;
            return;
          }
          if (line) lines.push(line);
          // A single word wider than the whole line gets broken by character.
          line = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(line + ch, size) > maxW && line) {
              lines.push(line);
              line = "";
            }
            line += ch;
          }
        });
        lines.push(line);
      });
    return lines;
  }

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.page.drawText(this.clean(this.title), { x: MARGIN_X, y: PAGE_H - 62, size: 24, font: this.fonts.regular, color: COLORS.green });
    this.text(this.metaLine, MARGIN_X, PAGE_H - 80, { size: 8, font: this.fonts.oblique, color: COLORS.gray });
    if (this.logo) {
      const w = 150;
      const h = (w * this.logo.height) / this.logo.width;
      this.page.drawImage(this.logo, { x: PAGE_W - MARGIN_X - w, y: PAGE_H - 28 - h, width: w, height: h });
    }
    this.y = CONTENT_TOP;
  }

  ensure(h) {
    if (!this.page || this.y - h < CONTENT_BOTTOM) this.newPage();
  }

  section(title) {
    this.ensure(22 + 30); // never strand a heading at the bottom of a page
    const top = this.y - 6;
    this.page.drawRectangle({ x: MARGIN_X, y: top - 20, width: CONTENT_W, height: 20, color: COLORS.mint });
    this.text(title, MARGIN_X + 8, top - 13.5, { size: 10, font: this.fonts.bold, color: COLORS.green });
    this.y = top - 26;
  }

  // A label in the left column, its answer (wrapped, one or more lines)
  // in the right, and a hairline under the pair.
  answer(label, lines) {
    const labelLines = this.wrap(label, LABEL_W, 8.5, this.fonts.regular);
    const valueLines = lines.flatMap((l) => this.wrap(l, VALUE_W, 9, this.fonts.bold));
    const rows = Math.max(labelLines.length, valueLines.length);
    // Long answers may span pages; short ones never split.
    if (rows * LINE_H + 8 <= CONTENT_TOP - CONTENT_BOTTOM) this.ensure(rows * LINE_H + 8);
    for (let i = 0; i < rows; i++) {
      this.ensure(LINE_H + 8);
      const baseline = this.y - 10;
      if (labelLines[i]) this.text(labelLines[i], MARGIN_X, baseline, { size: 8.5, color: COLORS.gray });
      if (valueLines[i]) this.text(valueLines[i], VALUE_X, baseline, { size: 9, font: this.fonts.bold });
      this.y -= LINE_H;
    }
    this.y -= 4;
    this.page.drawLine({ start: { x: MARGIN_X, y: this.y }, end: { x: MARGIN_X + CONTENT_W, y: this.y }, thickness: 0.5, color: COLORS.rule });
    this.y -= 2;
  }

  footers(entryId) {
    const pages = this.pdf.getPages();
    pages.forEach((page, i) => {
      page.drawLine({ start: { x: 150, y: 44 }, end: { x: PAGE_W - 150, y: 44 }, thickness: 1, color: COLORS.green });
      const size = 7.5;
      const footer = this.clean(FOOTER_TEXT);
      page.drawText(footer, { x: (PAGE_W - this.fonts.regular.widthOfTextAtSize(footer, size)) / 2, y: 31, size, font: this.fonts.regular, color: COLORS.gray });
      page.drawText(this.clean(`Online entry #${entryId}`), { x: MARGIN_X, y: 31, size: 7, font: this.fonts.regular, color: COLORS.gray });
      const pageLabel = `Page ${i + 1} of ${pages.length}`;
      page.drawText(pageLabel, { x: PAGE_W - MARGIN_X - this.fonts.regular.widthOfTextAtSize(pageLabel, 7), y: 31, size: 7, font: this.fonts.regular, color: COLORS.green });
    });
  }
}

// ---- Entry point ----

// `entry` is the raw Gravity Forms entry; `fields` the form's own field
// list (GET forms/<id>'s `fields` -- may be empty if it couldn't be
// fetched); `plan` the plan the application is being filed under.
async function generateApplicationPdf({ entry, fields, plan }) {
  const pdf = await PDFDocument.create();
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    oblique: await pdf.embedFont(StandardFonts.HelveticaOblique),
  };
  let logo = null;
  try {
    logo = await pdf.embedJpg(fs.readFileSync(LOGO_PATH));
  } catch {
    // A missing logo just leaves the header's right side blank.
  }
  const submitted = formatDate(entry.date_created);
  pdf.setTitle(`Member Application - Online entry #${entry.id}`);
  pdf.setAuthor("Anabaptist Brotherhood");
  pdf.setCreator("ApplicationManager");

  const meta = [`Submitted online${submitted ? ` ${submitted}` : ""}`, `Entry #${entry.id}`, plan ? `Plan: ${plan}` : null].filter(Boolean).join(" · ");
  const w = new AnswerSheetWriter(pdf, fonts, logo, "Member Application", meta);
  w.newPage();
  const items = buildItems(fields, entry);
  if (items.length === 0) w.text("This submission has no answers.", MARGIN_X, w.y - 12, { size: 9, font: fonts.oblique, color: COLORS.gray });
  items.forEach((item) => (item.kind === "section" ? w.section(item.title) : w.answer(item.label, item.lines)));
  w.footers(entry.id);
  return pdf.save();
}

module.exports = { generateApplicationPdf };
