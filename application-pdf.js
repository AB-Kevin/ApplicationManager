// The PDF generated for each application imported from the online form (see
// main.js's import-gf-entries) -- laid out like the org's paper Member
// Application (3rd edition of the Complete Guidelines) so an online
// submission and a scanned paper one read the same way side by side: the
// same green title and logo, the same three numbered sections in the same
// order (1. Household Demographics, 2. Health History Questionnaire -- one
// page per member -- and 3. Acknowledgments and Authorization), the same
// field order within each, choices circled the way the paper form asks.
//
// Drawn from the imported appForm (so it follows the schema, not the online
// form's own field order), plus: every custom field, placed in the section
// it's categorized under, and a closing "Other answers" section listing any
// submitted answer that isn't mapped onto the application at all -- so
// nothing that was submitted is ever silently missing from the record.
//
// pdf-lib's built-in Helvetica only (no font embedding step, no native
// build step), which limits text to the WinAnsi character set -- see
// makeSanitizer.

const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const {
  CONDITION_CATEGORIES,
  INCOME_TIERS,
  YES_NO_OPTIONS,
  GENDER_OPTIONS,
  MEDICARE_OPTIONS,
  matchChoiceOption,
  customFieldPresentation,
  presentationFromGfInfo,
  multiSelectValues,
  listFieldColumns,
  customFieldTarget,
  mergeDependentRows,
  interpretNoFlagAnswer,
  DEPENDENTS_TARGET,
  CHURCH_FIELD_KEYS,
} = require("./renderer/application-form.js");

const LOGO_PATH = path.join(__dirname, "assets", "logo-primary-lockup.jpg");

// Brand & Design Manual v1.1 colors (see renderer/styles.css's tokens).
const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const COLORS = {
  green: hex("#006D46"),
  mint: hex("#E8F1EC"),
  charcoal: hex("#231F20"),
  gray: hex("#58595B"),
  rule: hex("#A7A9AC"),
  white: rgb(1, 1, 1),
};

// US Letter, with the paper form's own narrow side margins.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN_X = 40;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const CONTENT_TOP = PAGE_H - 100;
const CONTENT_BOTTOM = 56;
const CELL_GAP = 10;

const FOOTER_TEXT = "PO Box 144, Guys Mills, PA 16327 • info@AnabaptistBrotherhood.org • AnabaptistBrotherhood.org";

// Page 3 of the paper form, verbatim.
const ACKNOWLEDGMENT_PARAGRAPHS = [
  "I agree to comply with the Medical Aid & Alms Plan Complete Guidelines. I acknowledge that I have an adequate understanding of the Plan and its limitations, and that my participation is strictly voluntary. I understand that the plan will be active on the effective date listed in my application confirmation letter.",
  "I certify that the information provided in this application is true, accurate, and complete to the best of my knowledge.",
  "I understand that Anabaptist Brotherhood Medical Aid & Alms Plan is not insurance and should never be construed as a contract for health insurance. I hold ultimate responsibility and am legally liable for the payment of my own medical bills. Brotherhood offers no legal guarantee and shall not be legally liable for the payment of my medical bills. Further, I understand that no Member shall be forced or compelled to make sharing contributions. Contributions from Members are voluntary gifts and are non-refundable. If sharing occurs, the shared medical expenses are paid solely from voluntary contributions of Members. Brotherhood serves to facilitate this mutual sharing by managing the Members’ pooled funds for those who have eligible expenses.",
  "I authorize Anabaptist Brotherhood to use and disclose my medical information for purposes of cost sharing, case management, and general organizational use. I grant permission to negotiate and pay bills on my behalf. I authorize Brotherhood to discuss any medical bills with my church’s contact person. Any information shared will be limited to what’s necessary to support the coordination of my medical care and the sharing of eligible expenses within the ministry.",
];

// The paper form's own spelling of each income tier, index-aligned with
// INCOME_TIERS.
const INCOME_TIER_PAPER_LABELS = ["$1-25,000", "$25,001-50,000", "$50,001-75,000", "$75,001-100,000", "$100,001-150,000", "$150,001-200,000", "$200,001 & above"];

const PREGNANT_OPTIONS = [...YES_NO_OPTIONS, { value: "na", label: "N/A" }];

// The online form answers "which Medicare part?" with a sentence when the
// answer is none ("I'm not covered by Medicare"); the paper form just
// leaves every part uncircled.
const PDF_MEDICARE_OPTIONS = MEDICARE_OPTIONS.filter((o) => o.value !== "none").map((o) => ({ ...o, label: `Part ${o.value}` }));
function matchMedicare(raw) {
  if (raw && /not covered|^none$|^no$/i.test(String(raw).trim())) return { value: "none" };
  return matchChoiceOption(MEDICARE_OPTIONS, raw);
}

// ---- Value formatting ----

// Any submitted answer as one line of readable text -- a List answer (an
// array of row objects) as "First Name: Ann, Last Name: Lee; ...", skipping
// blank cells and blank rows, rather than "[object Object]".
function formatAnswerText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    return value
      .map((item) => formatAnswerText(item))
      .filter((s) => s.trim())
      .join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, v]) => String(v ?? "").trim())
      .map(([k, v]) => `${k}: ${formatAnswerText(v)}`)
      .join(", ");
  }
  return String(value);
}

// A checkbox-ish answer: true, or any non-blank text other than an explicit
// no (a Gravity Forms checkbox submits its choice's own text when checked,
// a Consent field "1").
function isChecked(v) {
  if (v === true) return true;
  if (typeof v === "number") return v !== 0;
  if (typeof v !== "string") return false;
  const s = v.trim();
  return !!s && !/^(no|false|0|off)$/i.test(s);
}

// "2015-03-04" -> "03/04/2015" (the paper form's MM/DD/YYYY), "2026-01" ->
// "01/2026"; anything else as-is.
function formatDate(raw) {
  const s = String(raw || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) return `${m[2]}/${m[1]}`;
  return s;
}

function fullName(member) {
  return [member.firstName, member.initial, member.lastName].map((s) => String(s || "").trim()).filter(Boolean).join(" ");
}

function memberHasAnyData(member) {
  if (fullName(member)) return true;
  const h = member.health || {};
  if (h.height || h.weight || h.pastSurgicalHistoryText || h.currentMedicationsText) return true;
  return CONDITION_CATEGORIES.some((cat) => {
    const c = (h.conditions || {})[cat.key] || {};
    return (c.other && String(c.other).trim()) || cat.conditions.some((cond) => c[cond.key] && c[cond.key].present);
  });
}

// ---- Drawing ----

// Helvetica (a standard, non-embedded font) can only draw WinAnsi
// characters -- anything else would make pdf-lib throw mid-document, so
// every string is mapped through this first: a few common look-alikes get a
// close substitute, anything else becomes "?".
function makeSanitizer(font) {
  const supported = new Set(font.getCharacterSet());
  const SUBSTITUTES = { "→": "->", "←": "<-", "✓": "x", "✔": "x", "‐": "-", "‑": "-", "−": "-", " ": " " };
  return (text) =>
    Array.from(String(text ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, " "))
      .map((ch) => (ch === "\n" || supported.has(ch.codePointAt(0)) ? ch : SUBSTITUTES[ch] ?? "?"))
      .join("");
}

class ApplicationPdfWriter {
  constructor(pdf, fonts, logo, metaLine, fieldMapping) {
    this.fieldMapping = fieldMapping || [];
    this.pdf = pdf;
    this.fonts = fonts;
    this.logo = logo;
    this.metaLine = metaLine;
    this.clean = makeSanitizer(fonts.regular);
    this.page = null;
    this.y = 0;
  }

  // -- primitives --

  width(text, size, font = this.fonts.regular) {
    return font.widthOfTextAtSize(this.clean(text), size);
  }

  text(str, x, y, { size = 9, font = this.fonts.regular, color = COLORS.charcoal } = {}) {
    const s = this.clean(str).replace(/\n/g, " ");
    if (s) this.page.drawText(s, { x, y, size, font, color });
  }

  // Shrinks `str` (down to 6.5pt) to fit `maxW`, then truncates with an
  // ellipsis if it still doesn't -- for single-line value slots.
  fit(str, maxW, size, font) {
    let s = this.clean(str).replace(/\n/g, " ");
    let sz = size;
    while (sz > 6.5 && font.widthOfTextAtSize(s, sz) > maxW) sz -= 0.5;
    if (font.widthOfTextAtSize(s, sz) > maxW) {
      while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, sz) > maxW) s = s.slice(0, -1);
      s = `${s}…`;
    }
    return { text: s, size: sz };
  }

  wrap(str, maxW, size, font = this.fonts.regular) {
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

  hline(x1, x2, y, color = COLORS.rule, thickness = 0.6) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }

  // The paper form's hollow circle: filled green when checked.
  marker(x, yCenter, checked) {
    this.page.drawCircle({ x, y: yCenter, size: 3.2, borderColor: checked ? COLORS.green : COLORS.gray, borderWidth: 0.7, color: checked ? COLORS.green : undefined });
  }

  // "Circle one" -- an ellipse around a chosen word.
  circle(x, baseline, w, size) {
    this.page.drawEllipse({ x: x + w / 2, y: baseline + size * 0.32, xScale: w / 2 + 4, yScale: size * 0.78, borderColor: COLORS.green, borderWidth: 0.9 });
  }

  // -- pages --

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.page.drawText("Member Application", { x: MARGIN_X, y: PAGE_H - 62, size: 24, font: this.fonts.regular, color: COLORS.green });
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

  // -- headers --

  // The paper form's solid green numbered section header.
  sectionBar(title, subtitle, rightText) {
    const h = subtitle ? 30 : 22;
    this.ensure(h + 60); // never strand a header at the bottom of a page
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN_X, y: top - h, width: CONTENT_W, height: h, color: COLORS.green });
    this.text(title, MARGIN_X + 9, top - 14.5, { size: 10.5, font: this.fonts.bold, color: COLORS.white });
    if (subtitle) {
      const sub = this.fit(subtitle, CONTENT_W - 18 - (rightText ? 90 : 0), 7.5, this.fonts.oblique);
      this.text(sub.text, MARGIN_X + 18, top - 24.5, { size: sub.size, font: this.fonts.oblique, color: COLORS.white });
    }
    if (rightText) {
      const w = this.width(rightText, 8.5, this.fonts.bold);
      this.text(rightText, MARGIN_X + CONTENT_W - 9 - w, top - 14.5, { size: 8.5, font: this.fonts.bold, color: COLORS.white });
    }
    this.y = top - h - 8;
  }

  // The paper form's pale-mint subsection header: a bold green title, an
  // optional italic note (after the title, or below it if it won't fit), and
  // an optional right-aligned "No ___" checkbox.
  subBar(title, { note, right } = {}) {
    const titleSize = 10;
    const titleW = this.width(title, titleSize, this.fonts.bold);
    const rightW = right ? this.width(right.label, 9.5, this.fonts.bold) + 14 : 0;
    const inlineRoom = CONTENT_W - 18 - titleW - 12 - rightW;
    const noteInline = note && this.width(note, 7.5, this.fonts.oblique) <= inlineRoom;
    const noteLines = note && !noteInline ? this.wrap(note, CONTENT_W - 18, 7.5, this.fonts.oblique) : [];
    const h = 20 + noteLines.length * 9;
    this.ensure(h + 40);
    const top = this.y;
    this.page.drawRectangle({ x: MARGIN_X, y: top - h, width: CONTENT_W, height: h, color: COLORS.mint });
    this.text(title, MARGIN_X + 9, top - 13.5, { size: titleSize, font: this.fonts.bold, color: COLORS.green });
    if (noteInline) this.text(note, MARGIN_X + 9 + titleW + 12, top - 13.5, { size: 7.5, font: this.fonts.oblique, color: COLORS.green });
    noteLines.forEach((line, i) => this.text(line, MARGIN_X + 9, top - 23 - i * 9, { size: 7.5, font: this.fonts.oblique, color: COLORS.green }));
    if (right) {
      const x = MARGIN_X + CONTENT_W - 9 - rightW;
      this.marker(x + 3.5, top - 10.5, right.checked);
      this.text(right.label, x + 11, top - 13.5, { size: 9.5, font: this.fonts.bold, color: COLORS.green });
    }
    this.y = top - h - 5;
  }

  // -- rows --

  // One line of the form, split into cells by width fraction -- each cell a
  // "Label: ____value____" field, a "Label  Opt  Opt" circle-one choice, or
  // a checkbox.
  row(cells, height = 19) {
    this.ensure(height);
    const baseline = this.y - 13;
    let x = MARGIN_X;
    cells.forEach((cell) => {
      const w = cell.w * CONTENT_W - CELL_GAP;
      if (cell.kind === "choice") this.drawChoice(cell, x, baseline, w);
      else if (cell.kind === "check") this.drawCheck(cell, x, baseline);
      else this.drawField(cell, x, baseline, w);
      x += cell.w * CONTENT_W;
    });
    this.y -= height;
  }

  drawField(cell, x, baseline, w) {
    const labelW = cell.label ? this.width(cell.label, 9) + 5 : 0;
    if (cell.label) this.text(cell.label, x, baseline);
    const valueX = x + labelW;
    this.hline(valueX, x + w, baseline - 3);
    const v = this.fit(cell.value || "", w - labelW - 4, 9, this.fonts.bold);
    this.text(v.text, valueX + 2, baseline, { size: v.size, font: this.fonts.bold });
  }

  drawChoice(cell, x, baseline, w) {
    const size = cell.size || 9;
    let cx = x;
    if (cell.label) {
      this.text(cell.label, cx, baseline, { size });
      cx += this.width(cell.label, size) + 9;
    }
    cell.options.forEach((opt, i) => {
      if (i > 0 && cell.separator) {
        this.text(cell.separator, cx, baseline, { size, color: COLORS.gray });
        cx += this.width(cell.separator, size) + 6;
      }
      const ow = this.width(opt.label, size, this.fonts.oblique);
      this.text(opt.label, cx, baseline, { size, font: this.fonts.oblique, color: opt.selected ? COLORS.green : COLORS.charcoal });
      if (opt.selected) this.circle(cx, baseline, ow, size);
      cx += ow + (cell.separator ? 6 : 12);
    });
    // An answer that isn't one of the printed choices is still shown.
    if (cell.extra) {
      const v = this.fit(cell.extra, Math.max(20, x + w - cx), size, this.fonts.bold);
      this.text(v.text, cx, baseline, { size: v.size, font: this.fonts.bold });
    }
  }

  drawCheck(cell, x, baseline) {
    this.marker(x + 3.5, baseline + 3, cell.checked);
    this.text(cell.label, x + 11, baseline, { size: 9, font: cell.checked ? this.fonts.bold : this.fonts.regular });
    if (cell.note) {
      this.text(cell.note, x + 11 + this.width(cell.label, 9, cell.checked ? this.fonts.bold : this.fonts.regular) + 8, baseline, {
        size: 8,
        font: this.fonts.oblique,
        color: COLORS.gray,
      });
    }
  }

  // The paper form's member line: values over a rule, captions in small
  // italics underneath ("First Name", "Initial", ...).
  captionRow(cells) {
    const height = 29;
    this.ensure(height);
    const baseline = this.y - 15;
    let x = MARGIN_X;
    cells.forEach((cell) => {
      const w = cell.w * CONTENT_W - CELL_GAP;
      if (cell.kind === "choice") {
        this.drawChoice({ ...cell, label: "" }, x, baseline, w);
      } else {
        this.hline(x, x + w, baseline - 3);
        const v = this.fit(cell.value || "", w - 4, 9.5, this.fonts.bold);
        this.text(v.text, x + 2, baseline, { size: v.size, font: this.fonts.bold });
      }
      this.text(cell.caption, x, baseline - 12, { size: 7, font: this.fonts.oblique, color: COLORS.gray });
      x += cell.w * CONTENT_W;
    });
    this.y -= height;
  }

  // A labeled answer too long for one line: the label, then the answer
  // wrapped over as many ruled lines as it needs (at least `minLines`).
  linedText(value, minLines = 1, label) {
    if (label) {
      this.ensure(30);
      this.text(label, MARGIN_X, this.y - 11, { size: 9 });
      this.y -= 14;
    }
    const lines = String(value || "").trim() ? this.wrap(value, CONTENT_W - 8, 9) : [];
    const count = Math.max(minLines, lines.length);
    for (let i = 0; i < count; i++) {
      this.ensure(15);
      this.text(lines[i] || "", MARGIN_X + 4, this.y - 11, { size: 9, font: this.fonts.bold });
      this.hline(MARGIN_X, MARGIN_X + CONTENT_W, this.y - 14);
      this.y -= 15;
    }
  }

  paragraph(str, { size = 9.5, lineHeight = 13, indent = 0, bullet = false } = {}) {
    const x = MARGIN_X + indent;
    const lines = this.wrap(str, CONTENT_W - indent - (bullet ? 12 : 0), size);
    lines.forEach((line, i) => {
      this.ensure(lineHeight);
      if (bullet && i === 0) this.text("•", x, this.y - size, { size });
      this.text(line, x + (bullet ? 12 : 0), this.y - size, { size });
      this.y -= lineHeight;
    });
  }

  // A List answer as a small table: mint header row of column names, one
  // ruled row per entry (entirely blank entries skipped).
  table(columns, rows) {
    const filled = rows.filter((r) => r && columns.some((c) => String(r[c] ?? "").trim()));
    if (!columns.length) return;
    const colW = CONTENT_W / columns.length;
    this.ensure(30);
    this.page.drawRectangle({ x: MARGIN_X, y: this.y - 14, width: CONTENT_W, height: 14, color: COLORS.mint });
    columns.forEach((c, i) => {
      const t = this.fit(c, colW - 8, 7.5, this.fonts.bold);
      this.text(t.text, MARGIN_X + i * colW + 4, this.y - 10, { size: t.size, font: this.fonts.bold, color: COLORS.green });
    });
    this.y -= 14;
    (filled.length ? filled : [{}]).forEach((r) => {
      this.ensure(15);
      columns.forEach((c, i) => {
        const t = this.fit(formatAnswerText(r[c]), colW - 8, 8.5, this.fonts.regular);
        this.text(t.text, MARGIN_X + i * colW + 4, this.y - 10.5, { size: t.size });
      });
      this.hline(MARGIN_X, MARGIN_X + CONTENT_W, this.y - 14);
      this.y -= 15;
    });
    this.y -= 4;
  }

  // Extra answers (custom fields and unmapped online answers -- see
  // buildExtras below), each per its presentation: the same one the
  // Application tab gives it, the online form's when connected. A dropdown
  // answer prints its choice's text rather than its stored value.
  extras(items) {
    items.forEach(({ label, value, presentation }) => {
      const p = presentation || { kind: "text" };
      if (p.kind === "checkbox") {
        this.row([{ kind: "check", w: 1, label, checked: isChecked(value) }], 17);
      } else if (p.kind === "list") {
        this.ensure(60); // label + header row + first row stay together
        this.text(label, MARGIN_X, this.y - 11, { size: 9 });
        this.y -= 15;
        this.table(listFieldColumns({ columns: p.columns }, value), Array.isArray(value) ? value : []);
      } else {
        const choiceLabel = (v) => {
          const opt = (p.options || []).find((o) => String(o.value) === String(v)) || matchChoiceOption(p.options || [], v);
          return opt ? opt.label : String(v);
        };
        const text =
          p.kind === "select" ? choiceLabel(value) : p.kind === "multiselect" ? multiSelectValues(value).map(choiceLabel).join(", ") : formatAnswerText(value);
        const labelW = this.width(label, 9) + 5;
        if (labelW + this.width(text, 9, this.fonts.bold) + 8 <= CONTENT_W) this.row([{ w: 1, label, value: text }], 17);
        else this.linedText(text, 1, label);
      }
    });
  }
}

// ---- Extra answers: custom fields and unmapped online answers ----
//
// Everything the paper form has no printed spot for -- custom fields, and
// online answers that aren't mapped onto the application at all (mapped to
// "ignore", or a hidden sub-input like an address's Country) -- is placed
// where it sits on the ONLINE form: right after the built-in field it
// follows there (its "anchor"), within the same section of this PDF (its
// "home"). E.g. the address's Country lands right under the address line,
// and "Do you need to fill out a Health History Questionnaire for another
// person?" at the end of that member's own questionnaire. Anything whose
// anchor isn't drawn falls back to the end of its home section, and only
// an answer with no home at all goes in the closing "Other answers".
//
// Homes: "household", "church", "dependents", "<memberId>:identity",
// "<memberId>:health".

const BUILTIN_PREFIXES = ["household.", "member:"];

// The member a mapping scope ("primary", "spouse", "slotN") refers to --
// same matching as main.js's resolveOrCreateMemberForSlot, read-only.
function memberForScope(form, scope) {
  return (
    form.householdMembers.find((m) => m.importSlot === scope) ||
    (scope === "primary" ? form.householdMembers.find((m) => m.role === "primary") : null) ||
    (scope === "spouse" ? form.householdMembers.find((m) => m.role === "spouse") : null) ||
    null
  );
}

function memberScope(member) {
  if (member.role === "primary") return "primary";
  if (member.role === "spouse") return "spouse";
  return member.importSlot || null;
}

// Where a custom field's definition says it belongs (see
// customFieldScopeLabel in application-form.js): a dependent slot's
// fields, and any "-health" scope, are part of that member's questionnaire.
function homeForCustomScope(form, scope) {
  if (!scope || scope === "household") return "household";
  if (scope === "church") return "church";
  const health = /-health$/.test(scope) || /^slot\d+$/.test(scope);
  const member = memberForScope(form, scope.replace(/-health$/, ""));
  return member ? `${member.id}:${health ? "health" : "identity"}` : null;
}

// The home of a built-in mapping target. A dependent slot's identity
// fields (its questionnaire's own Name line) count as that member's
// questionnaire, where the online form asks them.
function homeForTarget(form, target, defsByKey) {
  if (!target) return null;
  if (target === DEPENDENTS_TARGET) return "dependents";
  if (target.startsWith("household.")) return CHURCH_FIELD_KEYS.has(target.slice("household.".length)) ? "church" : "household";
  if (target.startsWith("member:")) {
    const rest = target.slice("member:".length);
    const scope = rest.slice(0, rest.indexOf("."));
    const member = memberForScope(form, scope);
    if (!member) return null;
    const health = rest.slice(scope.length + 1).startsWith("health.") || /^slot\d+$/.test(scope);
    return `${member.id}:${health ? "health" : "identity"}`;
  }
  if (target.startsWith("custom:") || target.startsWith("membercustom:")) {
    const key = target.startsWith("custom:") ? target.slice("custom:".length) : target.slice(target.indexOf(".") + 1);
    const def = defsByKey.get(key);
    return homeForCustomScope(form, def ? def.scope : target.startsWith("custom:") ? "household" : target.slice("membercustom:".length).split(".")[0]);
  }
  return null;
}

// Every submitted answer's row, in the online form's own order: the
// mapping (one row per offered field, Section fields included), plus any
// answered field it doesn't have -- a hidden sub-input, slotted in right
// after its visible siblings -- labeled from the form's hidden-input list
// when available.
function orderedAnswerRows(entry, fieldMapping, hiddenInputs) {
  const rows = [...(fieldMapping || [])];
  const known = new Set(rows.map((r) => r.gfFieldId));
  const hiddenById = new Map((hiddenInputs || []).map((h) => [h.gfFieldId, h]));
  Object.keys(entry)
    .filter((k) => /^\d+(\.\d+)?$/.test(k) && !known.has(k))
    .sort((a, b) => parseFloat(a) - parseFloat(b))
    .forEach((key) => {
      const parent = key.split(".")[0];
      let at = -1;
      rows.forEach((r, i) => {
        if (r.gfFieldId === parent || r.gfFieldId.startsWith(`${parent}.`)) at = i;
      });
      const hidden = hiddenById.get(key);
      const sibling = at >= 0 ? rows[at] : null;
      const siblingBase = sibling ? String(sibling.label || "").replace(/\s*\([^)]*\)\s*$/, "") : "";
      const row = { gfFieldId: key, label: hidden ? hidden.label : siblingBase ? `${siblingBase} (${ADDRESS_SUBINPUTS[key.split(".")[1]] || `Field ${key}`})` : `Field ${key}`, target: null, gfType: hidden ? hidden.gfType : sibling && sibling.gfType };
      rows.splice(at >= 0 ? at + 1 : rows.length, 0, row);
    });
  return rows;
}

// Gravity Forms' fixed Address sub-input numbering, for labeling a hidden
// one when the form's own field list couldn't be fetched.
const ADDRESS_SUBINPUTS = { 1: "Street Address", 2: "Address Line 2", 3: "City", 4: "State / Province", 5: "ZIP / Postal Code", 6: "Country" };

// For each row, the built-in field it follows on the online form: the
// nearest built-in row before it -- unless a Section header comes between
// the two, in which case it opens that new section and is anchored to the
// next built-in row instead (e.g. a questionnaire's unmapped Name line goes
// with that questionnaire, not the end of the section above it).
function anchorsFor(rows, removedFields) {
  const isBuiltin = (r) => r.target && r.target !== "ignore" && !(removedFields || []).includes(r.target) && (r.target === DEPENDENTS_TARGET || BUILTIN_PREFIXES.some((p) => r.target.startsWith(p)));
  const anchors = new Array(rows.length).fill(null);
  let prev = null;
  let sectionSincePrev = false;
  const pending = [];
  rows.forEach((r, i) => {
    if (r.gfType === "section") {
      sectionSincePrev = true;
      return;
    }
    if (isBuiltin(r)) {
      pending.forEach((j) => (anchors[j] = r.target));
      pending.length = 0;
      prev = r.target;
      sectionSincePrev = false;
      return;
    }
    if (prev && !sectionSincePrev) anchors[i] = prev;
    else pending.push(i);
  });
  pending.forEach((j) => (anchors[j] = prev)); // nothing built-in after it -- stay with the last one
  return anchors;
}

// Builds the pool of extra answers (see the section comment above) plus
// the consent answers, which the acknowledgments page shows on its own.
function buildExtras({ form, entry, fieldMapping, hiddenInputs, customFields, removedFields }) {
  const defsByKey = new Map((customFields || []).map((c) => [c.key, c]));
  const hasValue = (v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== false && String(v).trim() !== "");
  const rows = orderedAnswerRows(entry, fieldMapping, hiddenInputs);
  const anchors = anchorsFor(rows, removedFields);
  const anchorByTarget = new Map();
  rows.forEach((r, i) => {
    if (r.target && !anchorByTarget.has(r.target)) anchorByTarget.set(r.target, anchors[i]);
  });
  const gfTypeByTarget = new Map();
  rows.forEach((r) => r.target && r.gfType && !gfTypeByTarget.has(r.target) && gfTypeByTarget.set(r.target, r.gfType));
  const isConsent = (def) =>
    gfTypeByTarget.get(customFieldTarget(def)) === "consent" || (def.type === "checkbox" && /consent|authori[sz]|agree/i.test(def.label || ""));

  const items = [];
  const consent = [];
  const addCustom = (key, value, bagHome) => {
    const def = defsByKey.get(key) || { key, label: key };
    if (isConsent(def)) {
      consent.push({ label: def.label, value });
      return;
    }
    if (!hasValue(value)) return;
    const home = (def.scope ? homeForCustomScope(form, def.scope) : null) || bagHome;
    const anchor = anchorByTarget.get(customFieldTarget(def)) || null;
    // The online form's position only counts within the section the field
    // is categorized under -- a field filed under Church stays in Church
    // even if the online form asks it elsewhere.
    const anchorOk = anchor && homeForTarget(form, anchor, defsByKey) === home;
    items.push({ label: def.label, value, presentation: customFieldPresentation(def, value, fieldMapping), home, anchor: anchorOk ? anchor : null });
  };
  Object.entries(form.extraFields || {}).forEach(([key, value]) => addCustom(key, value, "household"));
  form.householdMembers.forEach((m) =>
    Object.entries(m.extraFields || {}).forEach(([key, value]) => {
      const def = defsByKey.get(key);
      const scope = def && def.scope;
      addCustom(key, value, `${m.id}:${scope && (/-health$/.test(scope) || /^slot\d+$/.test(scope)) ? "health" : "identity"}`);
    })
  );

  // Unmapped online answers. A questionnaire's own Name line, typically
  // left unmapped since the member section already has it, is skipped when
  // it just repeats a name that's already on the application.
  const knownNames = new Set();
  form.householdMembers.forEach((m) => [m.firstName, m.lastName, fullName(m)].forEach((n) => n && knownNames.add(String(n).trim().toLowerCase())));
  rows.forEach((r, i) => {
    const unmapped = !r.target || r.target === "ignore" || (removedFields || []).includes(r.target);
    if (!unmapped) return;
    const value = entry[r.gfFieldId];
    const text = formatAnswerText(value);
    if (!text.trim() || knownNames.has(text.trim().toLowerCase())) return;
    const anchor = anchors[i];
    const presentation = presentationFromGfInfo(r) || (Array.isArray(value) ? { kind: "list", columns: [] } : { kind: "text" });
    items.push({ label: r.label || `Field ${r.gfFieldId}`, value, presentation, home: homeForTarget(form, anchor, defsByKey), anchor, unmapped: true });
  });
  return { pool: new ExtrasPool(items), consent };
}

class ExtrasPool {
  constructor(items) {
    this.items = items;
  }
  // Removes and returns every item matching `pred`.
  take(pred) {
    const taken = this.items.filter(pred);
    this.items = this.items.filter((it) => !taken.includes(it));
    return taken;
  }
  // The first item in `home` whose label matches `re` -- for an online
  // question the paper form has a printed spot for but the schema doesn't
  // (e.g. "Pregnant?", a spouse's "Last 4 Digits of SSN"), so it's drawn in
  // that spot instead of as an extra line.
  takeOne(home, re) {
    const it = this.items.find((x) => x.home === home && re.test(x.label || ""));
    if (it) this.items = this.items.filter((x) => x !== it);
    return it || null;
  }
  anchoredTo(targets) {
    const set = new Set(targets);
    return this.take((it) => it.anchor && set.has(it.anchor));
  }
  home(home) {
    return this.take((it) => it.home === home);
  }
}

// ---- Sections ----

const memberTargets = (scope, keys) => (scope ? keys.map((k) => `member:${scope}.${k}`) : []);
const IDENTITY_KEYS = ["firstName", "initial", "lastName", "dob", "ssnLast4", "gender"];

function drawIdentityRow(w, member, pool, home) {
  let ssn = member.ssnLast4;
  if (!ssn && home) {
    const c = pool.takeOne(home, /ssn|social security number/i);
    if (c) ssn = formatAnswerText(c.value);
  }
  const gender = matchChoiceOption(GENDER_OPTIONS, member.gender);
  w.captionRow([
    { w: 0.25, caption: "First Name", value: member.firstName },
    { w: 0.08, caption: "Initial", value: member.initial },
    { w: 0.25, caption: "Last Name", value: member.lastName },
    { w: 0.14, caption: "DOB (MM/DD/YYYY)", value: formatDate(member.dob) },
    { w: 0.13, caption: "Last 4 Digits of SSN", value: ssn },
    {
      w: 0.15,
      kind: "choice",
      caption: "Gender",
      options: GENDER_OPTIONS.map((o) => ({ label: o.label, selected: gender === o })),
      extra: member.gender && !gender ? member.gender : null,
    },
  ]);
}

function choiceCell(label, options, raw, w, match = matchChoiceOption) {
  const chosen = match(options, raw);
  return {
    kind: "choice",
    w,
    label,
    options: options.map((o) => ({ label: o.label, selected: !!chosen && chosen.value === o.value })),
    extra: raw && !chosen ? formatAnswerText(raw) : null,
  };
}

function drawMedicareRow(w, member) {
  const raw = member.medicarePart;
  const chosen = matchMedicare(raw);
  const cell = choiceCell("If you are covered by Medicare, please indicate:", PDF_MEDICARE_OPTIONS, raw, 1, () => chosen);
  if (chosen && chosen.value === "none") cell.extra = "Not covered by Medicare";
  w.row([cell]);
}

// Primary or Spouse, with each extra answer drawn right after the row
// holding the field it follows online.
function drawAdultMember(w, member, scope, pool, withMaritalStatus) {
  const home = member.id ? `${member.id}:identity` : null;
  drawIdentityRow(w, member, pool, home);
  w.extras(pool.anchoredTo(memberTargets(scope, IDENTITY_KEYS)));
  w.row([
    choiceCell("Are you Social Security exempt?", YES_NO_OPTIONS, member.ssExempt, 0.5),
    ...(withMaritalStatus ? [{ w: 0.5, label: "Marital status:", value: member.maritalStatus }] : []),
  ]);
  w.extras(pool.anchoredTo(memberTargets(scope, ["ssExempt", "maritalStatus"])));
  if (!member.medicarePart && home) {
    const c = pool.takeOne(home, /medicare/i);
    if (c) member.medicarePart = formatAnswerText(c.value);
  }
  drawMedicareRow(w, member);
  w.extras(pool.anchoredTo(memberTargets(scope, ["medicarePart"])));
  if (home) w.extras(pool.home(home));
}

function drawHouseholdDemographics(w, form, pool) {
  const primary = form.householdMembers.find((m) => m.role === "primary") || form.householdMembers[0];
  const spouse = form.householdMembers.find((m) => m.role === "spouse");
  const dependents = form.householdMembers.filter((m) => m !== primary && m !== spouse);
  const h = form.household || {};
  const hh = (...keys) => keys.map((k) => `household.${k}`);

  w.sectionBar("1. Household Demographics");

  w.subBar("Primary Household Member");
  drawAdultMember(w, primary, "primary", pool, true);

  w.subBar("Spouse");
  drawAdultMember(w, spouse || { firstName: "", initial: "", lastName: "", dob: "", ssnLast4: "", gender: "", ssExempt: "", medicarePart: "" }, spouse ? "spouse" : null, pool, false);

  w.subBar("Children / Dependents", { note: "List children under age 19. Use a separate application for children 19 or older" });
  if (dependents.length === 0) drawIdentityRow(w, { firstName: "", initial: "", lastName: "", dob: "", ssnLast4: "", gender: "" }, pool, null);
  const dependentExtras = [];
  dependents.forEach((m) => {
    drawIdentityRow(w, m, pool, `${m.id}:identity`);
    pool.home(`${m.id}:identity`).forEach((it) => dependentExtras.push({ ...it, label: `${fullName(m) || "Dependent"} — ${it.label}` }));
  });
  w.extras([...dependentExtras, ...pool.anchoredTo([DEPENDENTS_TARGET]), ...pool.home("dependents")]);

  // The paper form's thin mint band closing off the member list.
  w.ensure(14);
  w.page.drawRectangle({ x: MARGIN_X, y: w.y - 4, width: CONTENT_W, height: 4, color: COLORS.mint });
  w.y -= 12;

  w.row([
    { w: 0.44, label: "Household Address:", value: h.address },
    { w: 0.2, label: "City", value: h.city },
    { w: 0.2, label: "State", value: h.state },
    { w: 0.16, label: "ZIP", value: h.zip },
  ]);
  w.extras(pool.anchoredTo(hh("address", "city", "state", "zip")));
  w.row([
    { w: 0.45, label: "Phone:", value: h.phone },
    { w: 0.55, label: "Email/Fax", value: h.emailOrFax },
  ]);
  w.extras(pool.anchoredTo(hh("phone", "emailOrFax")));
  w.ensure(34);
  w.text("Household Income Tier: (See section III.B. of the Complete Guidelines.)", MARGIN_X, w.y - 13, { size: 9 });
  w.y -= 16;
  const tier = matchChoiceOption(INCOME_TIERS, h.incomeTier);
  w.row(
    [
      {
        kind: "choice",
        w: 1,
        size: 8.5,
        separator: "•",
        options: INCOME_TIERS.map((o, i) => ({ label: INCOME_TIER_PAPER_LABELS[i], selected: tier === o })),
        extra: h.incomeTier && !tier ? h.incomeTier : null,
      },
    ],
    18
  );
  w.extras(pool.anchoredTo(hh("incomeTier")));
  w.row([{ w: 1, label: "Church Name:", value: h.churchName }]);
  w.extras(pool.anchoredTo(hh("churchName")));
  w.row([{ w: 1, label: "Church Contact:", value: h.churchContactName }]);
  w.extras(pool.anchoredTo(hh("churchContactName")));
  w.row([
    { w: 0.45, label: "Phone:", value: h.churchContactPhone },
    { w: 0.55, label: "Email/Fax", value: h.churchContactEmailOrFax },
  ]);
  w.extras(pool.anchoredTo(hh("churchContactPhone", "churchContactEmailOrFax")));
  w.row([
    { w: 0.44, label: "Contact Address:", value: h.churchContactAddress },
    { w: 0.2, label: "City", value: h.churchContactCity },
    { w: 0.2, label: "State", value: h.churchContactState },
    { w: 0.16, label: "ZIP", value: h.churchContactZip },
  ]);
  w.extras(pool.anchoredTo(hh("churchContactAddress", "churchContactCity", "churchContactState", "churchContactZip")));
  // Not on the paper form, but part of the application schema.
  w.row([choiceCell("Are 70% or more of your church's members applying?", YES_NO_OPTIONS, h.seventyPercentApplying, 1)]);
  w.extras(pool.anchoredTo(hh("seventyPercentApplying")));
  w.row([{ w: 1, label: "Effective start date — Indicates the 1st day of the month you wish to join:", value: formatDate(h.effectiveStartDate) }]);
  w.extras(pool.anchoredTo(hh("effectiveStartDate")));
  w.row([
    { w: 0.68, label: "Name of previous medical aid plan (if any):", value: h.previousPlanName },
    { w: 0.32, label: "Annual cost: $", value: String(h.previousPlanAnnualCost || "").replace(/^\s*\$\s*/, "") },
  ]);
  w.extras(pool.anchoredTo(hh("previousPlanName", "previousPlanAnnualCost")));

  // Household/Church extras whose online position isn't next to anything
  // drawn above (e.g. a paper-only custom field).
  const leftover = [...pool.home("household"), ...pool.home("church")];
  if (leftover.length) {
    w.y -= 4;
    w.subBar("Additional Information");
    w.extras(leftover);
  }
}

// One condition category's grid: four columns of circles, "other:" taking
// whatever's left of the last row (or a row of its own), extra conditions
// the online form asks about (e.g. "Endocrine/Metabolic: (hyperthyroid)")
// slotted in before "other".
function drawConditionCategory(w, cat, catState, extras, otherChecked) {
  const items = cat.conditions.map((c) => ({ label: c.label, checked: !!(catState[c.key] && catState[c.key].present), expense: !!(catState[c.key] && catState[c.key].expense5k) }));
  extras.forEach((e) => items.push({ label: e.name, checked: isChecked(e.value) }));
  const COLS = 4;
  const colW = CONTENT_W / COLS;
  const otherSpan = COLS - (items.length % COLS) || COLS;
  const rowCount = Math.ceil(items.length / COLS) + (items.length % COLS === 0 ? 1 : 0);
  const rowH = 11;
  w.ensure(11 + rowCount * rowH);
  w.text(`${cat.label}:`, MARGIN_X + 4, w.y - 9, { size: 8.5, font: w.fonts.bold });
  w.y -= 11;
  items.forEach((it, i) => {
    const col = i % COLS;
    const r = Math.floor(i / COLS);
    const x = MARGIN_X + 4 + col * colW;
    const baseline = w.y - r * rowH - 8.5;
    w.marker(x + 3, baseline + 2.8, it.checked);
    const t = w.fit(it.label, colW - 16, 8.5, it.checked ? w.fonts.bold : w.fonts.regular);
    w.text(t.text, x + 9, baseline, { size: t.size, font: it.checked ? w.fonts.bold : w.fonts.regular, color: it.checked ? COLORS.green : COLORS.charcoal });
    if (it.expense) w.circle(x + 9, baseline, w.width(t.text, t.size, it.checked ? w.fonts.bold : w.fonts.regular), t.size);
  });
  const otherIdx = items.length;
  const col = otherIdx % COLS;
  const r = Math.floor(otherIdx / COLS);
  const x = MARGIN_X + 4 + col * colW;
  const baseline = w.y - r * rowH - 8.5;
  const other = String(catState.other || "").trim();
  w.marker(x + 3, baseline + 2.8, !!other || otherChecked);
  w.text("other:", x + 9, baseline, { size: 8.5 });
  const lineStart = x + 9 + w.width("other:", 8.5) + 3;
  const lineEnd = x + otherSpan * colW - 12;
  w.hline(lineStart, lineEnd, baseline - 2);
  if (other) {
    const t = w.fit(other, lineEnd - lineStart - 2, 8.5, w.fonts.bold);
    w.text(t.text, lineStart + 1, baseline, { size: t.size, font: w.fonts.bold, color: COLORS.green });
  }
  w.y -= rowCount * rowH + 2;
}

// The online form's own Yes/No questions for the three "No ___" boxes
// ("Past Medical History: No") -- see interpretNoFlagAnswer.
const NO_FLAG_QUESTIONS = [
  { key: "noPastMedicalHistory", re: /^past medical history\??$/i },
  { key: "noPastSurgicalHistory", re: /^past surgical history\??$/i },
  { key: "noMedications", re: /^(current )?medications:?\??$/i },
];

function drawHealthQuestionnaire(w, member, index, total, pool) {
  const h = member.health || {};
  const home = `${member.id}:health`;
  const scope = memberScope(member);
  const t = (...keys) => memberTargets(scope, keys);
  // An unmapped Yes/No answer to one of the "No ___" questions fills that
  // box (unless the mapped field already did) rather than printing as a
  // separate line.
  NO_FLAG_QUESTIONS.forEach(({ key, re }) => {
    const it = pool.takeOne(home, re);
    if (it && !isChecked(h[key])) h[key] = interpretNoFlagAnswer(it.value, it.label);
  });
  w.newPage();
  w.sectionBar(
    "2. Health History Questionnaire",
    "Complete a questionnaire for each individual (including children under 19 years of age) applying for membership in this application.",
    `Member ${index} of ${total}`
  );
  w.row([
    { w: 0.55, label: "Name:", value: fullName(member) },
    { w: 0.225, label: "Height:", value: h.height },
    { w: 0.225, label: "Weight:", value: h.weight },
  ]);
  const pregnant = pool.takeOne(home, /pregnan/i);
  w.extras(pool.anchoredTo(t("firstName", "initial", "lastName", "health.height", "health.weight")));
  w.row([
    choiceCell("Pregnant?", PREGNANT_OPTIONS, pregnant ? formatAnswerText(pregnant.value) : "", 0.5),
    choiceCell("Vaping or any tobacco use?", YES_NO_OPTIONS, h.tobaccoUse, 0.5),
  ]);
  w.extras(pool.anchoredTo(t("health.tobaccoUse")));
  w.y -= 2;
  w.subBar("Past Medical History", {
    note: "A filled circle marks a past or current condition. A circled condition has a historical or anticipated annual expense of $5,000 or more.",
    right: { label: "No Past Medical History", checked: isChecked(h.noPastMedicalHistory) },
  });
  CONDITION_CATEGORIES.forEach((cat) => {
    // Extra conditions the online form asks about -- custom or unmapped
    // checkboxes labeled "<Category>: (<name>)" -- join the category's own
    // grid; its "(other)" checkbox just marks the grid's "other" circle.
    const lower = cat.label.toLowerCase();
    const inCat = pool.take((it) => it.home === home && /\(([^)]+)\)\s*$/.test(it.label || "") && it.label.toLowerCase().includes(lower));
    const otherChecked = inCat.some((it) => /\(other\)\s*$/i.test(it.label) && isChecked(it.value));
    const catExtras = inCat.filter((it) => !/\(other\)\s*$/i.test(it.label)).map((it) => ({ name: /\(([^)]+)\)\s*$/.exec(it.label)[1], value: it.value }));
    drawConditionCategory(w, cat, (h.conditions || {})[cat.key] || {}, catExtras, otherChecked);
    const condTargets = cat.conditions.flatMap((c) => t(`health.conditions.${cat.key}.${c.key}.present`, `health.conditions.${cat.key}.${c.key}.expense5k`));
    w.extras(pool.anchoredTo([...condTargets, ...t(`health.conditions.${cat.key}.other`)]));
  });
  w.extras(pool.anchoredTo(t("health.noPastMedicalHistory")));
  w.y -= 4;
  w.subBar("Past Surgical History", { note: "List any previous surgeries.", right: { label: "No Past Surgical History", checked: isChecked(h.noPastSurgicalHistory) } });
  w.linedText(h.pastSurgicalHistoryText, 2);
  w.extras(pool.anchoredTo(t("health.noPastSurgicalHistory", "health.pastSurgicalHistoryText")));
  w.y -= 6;
  w.subBar("Current Medications:", {
    note: "List all current prescription and over-the-counter medications including dose and frequency.",
    right: { label: "No Medications", checked: isChecked(h.noMedications) },
  });
  w.linedText(h.currentMedicationsText, 3);
  w.extras(pool.anchoredTo(t("health.noMedications", "health.currentMedicationsText")));
  const leftover = pool.home(home);
  if (leftover.length) {
    w.y -= 4;
    w.subBar("Additional Health Questions");
    w.extras(leftover);
  }
}

function drawAcknowledgments(w, form, consentItems, submittedDate) {
  w.newPage();
  w.sectionBar("3. Acknowledgments and Authorization", "Adults 18 years and older must sign and complete this form.");
  w.y -= 2;
  ACKNOWLEDGMENT_PARAGRAPHS.forEach((p) => {
    w.paragraph(p, { indent: 8, bullet: true });
    w.y -= 5;
  });
  const consented = consentItems.some((c) => isChecked(c.value));
  if (consentItems.length) {
    w.y -= 6;
    w.subBar("Online Consent");
    // "Consent (Consent)" -- Gravity Forms' field-plus-sub-input label, both
    // halves the same -- reads as just "Consent".
    const cleanLabel = (label) => String(label || "Consent").replace(/^(.+?)\s*\(\1\)$/i, "$1");
    consentItems.forEach((c) =>
      w.row([{ kind: "check", w: 1, label: cleanLabel(c.label), checked: isChecked(c.value), note: isChecked(c.value) ? `Agreed on the online form${submittedDate ? `, ${submittedDate}` : ""}` : "Not agreed" }])
    );
  }
  const primary = form.householdMembers.find((m) => m.role === "primary") || form.householdMembers[0];
  const printedName = (form.acknowledgment && form.acknowledgment.printedNameHeadOfHousehold) || fullName(primary);
  const sigLine = (x, width, caption, value, valueFont) => {
    w.hline(x, x + width, w.y - 30, COLORS.charcoal, 0.6);
    if (value) w.text(value, x + 2, w.y - 26, { size: 9, font: valueFont || w.fonts.bold, color: valueFont ? COLORS.gray : COLORS.charcoal });
    w.text(caption, x, w.y - 40, { size: 7.5, font: w.fonts.oblique, color: COLORS.gray });
  };
  const half = (CONTENT_W - 40) / 2;
  w.y -= 18;
  w.ensure(50);
  sigLine(MARGIN_X, half, "Signature of Head of Household", consented ? "Consented online" : "", w.fonts.oblique);
  sigLine(MARGIN_X + half + 40, half, "Signature of Spouse");
  w.y -= 52;
  w.ensure(50);
  sigLine(MARGIN_X, half, "Signature of Adults 18 years and older");
  sigLine(MARGIN_X + half + 40, half, "Signature of Adults 18 years and older");
  w.y -= 52;
  w.ensure(50);
  sigLine(MARGIN_X, half, "Printed Name of Head of Household", printedName);
  w.y -= 52;
}

// Whatever's left once every section has taken its own: answers with no
// home in this PDF at all (e.g. one for a household member the application
// doesn't have). Normally empty, in which case nothing is drawn.
function drawOtherAnswers(w, items) {
  if (!items.length) return;
  w.y -= 10;
  w.sectionBar("Other Answers from the Online Form", "Submitted answers that don't belong to any section above.");
  w.extras(items);
}

// ---- Entry point ----

// `appForm` is the application as imported (see applyGfEntryToAppForm);
// `entry` the raw Gravity Forms entry; `fieldMapping` the folder's mapping,
// carrying each online field's type/choices (see enrichFieldMapping) in the
// online form's own order; `hiddenInputs` the form's hidden sub-inputs
// (main.js's hiddenGfInputs -- may be empty if the form couldn't be
// fetched); `customFields`/`removedFields` from .form-schema.json.
async function generateApplicationPdf({ appForm, entry, fieldMapping, hiddenInputs, customFields, removedFields }) {
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

  // Drawing reads from a copy, since a few paper-form spots are filled in
  // from other answers (see ExtrasPool.takeOne) and the real appForm is
  // saved as-is.
  const form = JSON.parse(JSON.stringify(appForm));
  // A dependents list still mapped to a plain custom field (from before the
  // Children / Dependents target existed) fills the dependents' rows here
  // the same way it would once remapped, instead of printing as a separate
  // table under the household.
  Object.entries(form.extraFields || {}).forEach(([key, value]) => {
    const looksLikeDependents =
      Array.isArray(value) && value.some((r) => r && typeof r === "object" && Object.keys(r).some((k) => /first/i.test(k)) && Object.keys(r).some((k) => /last/i.test(k) && !/ssn|digit/i.test(k)));
    if (!looksLikeDependents) return;
    mergeDependentRows(form, value);
    delete form.extraFields[key];
  });

  const { pool, consent } = buildExtras({ form, entry, fieldMapping, hiddenInputs, customFields, removedFields });
  const w = new ApplicationPdfWriter(pdf, fonts, logo, `Submitted online${submitted ? ` ${submitted}` : ""} · Entry #${entry.id}`, fieldMapping);
  drawHouseholdDemographics(w, form, pool);

  const primary = form.householdMembers.find((m) => m.role === "primary") || form.householdMembers[0];
  const questionnaireMembers = [
    primary,
    ...form.householdMembers.filter((m) => m !== primary && (m.role !== "spouse" || memberHasAnyData(m) || pool.items.some((it) => it.home === `${m.id}:health`))),
  ];
  questionnaireMembers.forEach((m, i) => drawHealthQuestionnaire(w, m, i + 1, questionnaireMembers.length, pool));

  drawAcknowledgments(w, form, consent, submitted);
  drawOtherAnswers(w, pool.items);
  w.footers(entry.id);
  return pdf.save();
}

module.exports = { generateApplicationPdf, formatAnswerText };
