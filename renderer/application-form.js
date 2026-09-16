// Member Application review form — schema + rendering + wiring for review
// mode's "Application" tab (see renderer.js's renderPreviewSingle/
// renderReviewTabStripHtml). Plain global-scope functions and data, loaded
// via a <script> tag before renderer.js (see index.html) since this app has
// no bundler; the functions below are only ever called after renderer.js has
// finished loading too, so the forward references to its globals (state,
// render, pushUndo, saveAppForm, scheduleAppFormSave, escapeHtml, ICONS, el)
// resolve fine despite the script order.

// One entry per category on the paper form's Health History Questionnaire
// (page 2). This table is the single source of truth for that section — the
// blank-record factory and every render function below derive the full
// condition list from it, so there's nowhere else a condition needs to be
// added by hand.
const CONDITION_CATEGORIES = [
  {
    key: "cardiovascular",
    label: "Cardiovascular & Circulation",
    conditions: [
      { key: "highBloodPressure", label: "High blood pressure" },
      { key: "heartFailure", label: "Heart failure" },
      { key: "heartAttack", label: "Heart attack" },
      { key: "atrialFibFlutter", label: "Atrial fibrillation/flutter" },
      { key: "peripheralVascularDisease", label: "Peripheral vascular disease" },
      { key: "bloodClots", label: "Blood clots" },
      { key: "heartValveDisease", label: "Heart valve disease" },
      { key: "highCholesterol", label: "High cholesterol" },
    ],
  },
  {
    key: "respiratory",
    label: "Respiratory",
    conditions: [
      { key: "asthma", label: "Asthma" },
      { key: "copd", label: "Chronic obstructive pulmonary disease" },
      { key: "sleepApnea", label: "Sleep apnea" },
      { key: "pulmonaryEmbolus", label: "Pulmonary embolus" },
    ],
  },
  {
    key: "neurological",
    label: "Neurological",
    conditions: [
      { key: "dementia", label: "Dementia" },
      { key: "parkinsons", label: "Parkinson's disease" },
      { key: "seizureDisorder", label: "Seizure disorder" },
      { key: "strokeMiniStroke", label: "Stroke/mini stroke" },
    ],
  },
  {
    key: "musculoskeletal",
    label: "Musculoskeletal",
    conditions: [
      { key: "arthritis", label: "Arthritis" },
      { key: "osteoporosis", label: "Osteoporosis" },
    ],
  },
  {
    key: "endocrineMetabolic",
    label: "Endocrine/Metabolic",
    conditions: [
      { key: "diabetesType1", label: "Diabetes type 1" },
      { key: "diabetesType2", label: "Diabetes type 2" },
      { key: "hypothyroid", label: "Hypothyroid" },
    ],
  },
  {
    key: "gastrointestinal",
    label: "Gastrointestinal",
    conditions: [
      { key: "crohnsDisease", label: "Crohn's disease" },
      { key: "acidReflux", label: "Acid reflux" },
      { key: "ulcerativeColitis", label: "Ulcerative colitis" },
      { key: "liverDisease", label: "Liver disease" },
    ],
  },
  {
    key: "eyeEar",
    label: "Eye/Ear",
    conditions: [
      { key: "cataracts", label: "Cataracts" },
      { key: "glaucoma", label: "Glaucoma" },
      { key: "macularDegeneration", label: "Macular degeneration" },
    ],
  },
  {
    key: "urinaryKidney",
    label: "Urinary/Kidney",
    conditions: [
      { key: "kidneyFailure", label: "Kidney failure" },
      { key: "dialysis", label: "Dialysis" },
      { key: "kidneyStones", label: "Kidney stones" },
    ],
  },
  {
    key: "cancers",
    label: "Cancers",
    conditions: [
      { key: "leukemia", label: "Leukemia" },
      { key: "melanoma", label: "Melanoma" },
      { key: "lymphoma", label: "Lymphoma" },
    ],
  },
  {
    key: "blood",
    label: "Blood",
    conditions: [
      { key: "anemia", label: "Anemia" },
      { key: "hemophilia", label: "Hemophilia" },
      { key: "sickleCell", label: "Sickle cell" },
    ],
  },
  {
    key: "mentalHealth",
    label: "Mental Health",
    conditions: [
      { key: "bipolar", label: "Bipolar" },
      { key: "depression", label: "Depression" },
      { key: "anxiety", label: "Anxiety" },
    ],
  },
  {
    key: "autoimmune",
    label: "Autoimmune",
    conditions: [{ key: "lupus", label: "Lupus" }],
  },
];

const INCOME_TIERS = [
  { value: "1-25000", label: "$1 – $25,000" },
  { value: "25001-50000", label: "$25,001 – $50,000" },
  { value: "50001-75000", label: "$50,001 – $75,000" },
  { value: "75001-100000", label: "$75,001 – $100,000" },
  { value: "100001-150000", label: "$100,001 – $150,000" },
  { value: "150001-200000", label: "$150,001 – $200,000" },
  { value: "200001-plus", label: "$200,001 & above" },
];

const YES_NO_OPTIONS = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

// One choice, not four checkboxes -- matches the online form's own single
// dropdown for which Medicare part (if any) a primary/spouse member has.
const MEDICARE_OPTIONS = [
  { value: "A", label: "Part A" },
  { value: "B", label: "Part B" },
  { value: "C", label: "Part C" },
  { value: "D", label: "Part D" },
];

function appUid() {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function makeBlankHealthRecord() {
  const conditions = {};
  CONDITION_CATEGORIES.forEach((cat) => {
    const entry = { other: "" };
    cat.conditions.forEach((c) => {
      entry[c.key] = { present: false, expense5k: false };
    });
    conditions[cat.key] = entry;
  });
  return {
    height: "",
    weight: "",
    tobaccoUse: "",
    noPastMedicalHistory: false,
    conditions,
    noPastSurgicalHistory: false,
    pastSurgicalHistoryText: "",
    noMedications: false,
    currentMedicationsText: "",
  };
}

function makeBlankHouseholdMember(role) {
  return {
    id: appUid(),
    role,
    firstName: "",
    initial: "",
    lastName: "",
    dob: "",
    ssnLast4: "",
    gender: "",
    ssExempt: "",
    maritalStatus: "",
    // A single choice ("A"/"B"/"C"/"D"/none), matching the online form's own
    // dropdown -- see migrateMedicarePart for members read from a sidecar
    // saved before this was collapsed from four separate checkboxes.
    medicarePart: "",
    isAdult18Plus: false,
    signedOnPaper: false,
    health: makeBlankHealthRecord(),
    // Flat key->value bag for fields mapped from an external source and
    // categorized under THIS member specifically (e.g. a Gravity Forms
    // field the office wants filed under "Primary member" or "Household
    // Member 2" rather than the household-level catch-all) -- see
    // .form-schema.json's "customFields" (each carries a "scope" naming
    // which member it belongs to) and renderMemberFieldsHtml. Always
    // present, same reasoning as appForm's own extraFields.
    extraFields: {},
  };
}

function makeBlankAppForm() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    household: {
      address: "",
      city: "",
      state: "",
      zip: "",
      phone: "",
      emailOrFax: "",
      incomeTier: "",
      churchName: "",
      churchContactName: "",
      churchContactPhone: "",
      churchContactEmailOrFax: "",
      churchContactAddress: "",
      churchContactCity: "",
      churchContactState: "",
      churchContactZip: "",
      seventyPercentApplying: "",
      effectiveStartDate: "",
      previousPlanName: "",
      previousPlanAnnualCost: "",
    },
    // A spouse slot always exists from the start, even blank -- the Spouse
    // category is always shown (see renderApplicationFormHtml), and typing
    // a name into it is what makes them "Member #2" for the health
    // categories below, rather than a separate explicit "add spouse" step.
    householdMembers: [makeBlankHouseholdMember("primary"), makeBlankHouseholdMember("spouse")],
    acknowledgment: { printedNameHeadOfHousehold: "" },
    // Flat key->value bag for fields mapped from an external source (e.g. the
    // Gravity Forms API import) that don't correspond to any of the fields
    // above — see .form-schema.json's "customFields" and
    // renderApplicationFormHtml. Always present (even for a paper-only
    // application that will never use it) so every appForm object has the
    // same shape regardless of how it was created.
    extraFields: {},
    meta: { createdAt: now, updatedAt: now, lastEditedBy: "" },
  };
}

// One-time, in-memory normalization for a file saved before every appForm
// always got a spouse slot from the start (see makeBlankAppForm above) --
// synthesizes a blank one so the Spouse category always has something to
// render into, exactly like a brand-new application already would. Never
// written back to disk on its own; it's carried forward the same way any
// other in-memory-only default is, and persists for real the next time the
// user actually edits something (saveAppForm always serializes the whole
// appForm object).
function ensureSpouseMember(form) {
  if (form.householdMembers.some((m) => m.role === "spouse")) return;
  const primaryIdx = form.householdMembers.findIndex((m) => m.role === "primary");
  form.householdMembers.splice(primaryIdx + 1, 0, makeBlankHouseholdMember("spouse"));
}

// The catalog of identity-level fields a Gravity Forms field can connect to
// (see the API mapping modal) AND that Manage Form Fields lets staff mark
// required/removed -- fixed household/primary/spouse fields, plus one group
// of the same identity fields per household-member "slot" in use (for a web
// form collecting more than a primary+spouse). Deliberately scoped to
// identity-level fields, not every leaf of the schema (individual
// medical-condition checkboxes aren't mappable/removable/required here).
//
// This is the single canonical list -- it used to live duplicated (and
// out of sync: 6 real household fields were missing from it) in renderer.js;
// now application-form.js's own render calls below and renderer.js's mapping
// modal and Manage Form Fields screen all read the same one.
// Order and grouping mirror the Application tab's own category order
// exactly (see renderApplicationFormHtml) -- Primary member, Spouse,
// Household, Church -- so a folder that's never touched the reorder
// controls sees the same default sequence everywhere. Household and
// Church are two separate catalog scopes here even though both store into
// the same `form.household` object (prefix "household." for both) --
// CHURCH_FIELD_KEYS is what actually tells a church field's target apart
// from a household one, since the prefix alone can't.
const APP_FIELD_FIXED_GROUPS = [
  {
    group: "Primary member",
    scope: "primary",
    prefix: "member:primary.",
    fields: [
      { key: "firstName", label: "First name" },
      { key: "initial", label: "Middle initial" },
      { key: "lastName", label: "Last name" },
      { key: "dob", label: "Date of birth" },
      { key: "ssnLast4", label: "Last 4 of SSN" },
      { key: "gender", label: "Gender" },
      { key: "ssExempt", label: "Social Security exempt?" },
      { key: "maritalStatus", label: "Marital status" },
      { key: "medicarePart", label: "Medicare" },
    ],
  },
  {
    group: "Spouse",
    scope: "spouse",
    prefix: "member:spouse.",
    fields: [
      { key: "firstName", label: "First name" },
      { key: "initial", label: "Middle initial" },
      { key: "lastName", label: "Last name" },
      { key: "dob", label: "Date of birth" },
      { key: "gender", label: "Gender" },
      { key: "ssExempt", label: "Social Security exempt?" },
      { key: "maritalStatus", label: "Marital status" },
      { key: "medicarePart", label: "Medicare" },
    ],
  },
  {
    group: "Household",
    scope: "household",
    prefix: "household.",
    fields: [
      { key: "address", label: "Address" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "zip", label: "ZIP" },
      { key: "phone", label: "Phone" },
      { key: "emailOrFax", label: "Email/Fax" },
      { key: "incomeTier", label: "Household income tier" },
      { key: "seventyPercentApplying", label: "70%+ of church applying?" },
      { key: "effectiveStartDate", label: "Effective start date" },
      { key: "previousPlanName", label: "Previous medical aid plan" },
      { key: "previousPlanAnnualCost", label: "Previous plan annual cost" },
    ],
  },
  {
    group: "Church",
    scope: "church",
    prefix: "household.",
    fields: [
      { key: "churchName", label: "Church name" },
      { key: "churchContactName", label: "Church contact" },
      { key: "churchContactPhone", label: "Church contact phone" },
      { key: "churchContactEmailOrFax", label: "Church contact email/fax" },
      { key: "churchContactAddress", label: "Church contact address" },
      { key: "churchContactCity", label: "Church contact city" },
      { key: "churchContactState", label: "Church contact state" },
      { key: "churchContactZip", label: "Church contact ZIP" },
    ],
  },
];

// Which of household's fixed fields are "Church" fields -- the only way to
// tell a Church-scoped fixed field's target apart from a Household one,
// since both groups above share the same "household." prefix (they're
// still the same underlying form.household object; Church is a purely
// organizational split of it, not a separate storage location). Also used
// to disambiguate a CUSTOM field's target, which is identical either way
// ("custom:<key>") -- see the customScope tag buildNaturalAppFieldRows
// attaches to each custom row instead.
const CHURCH_FIELD_KEYS = new Set([
  "churchName",
  "churchContactName",
  "churchContactPhone",
  "churchContactEmailOrFax",
  "churchContactAddress",
  "churchContactCity",
  "churchContactState",
  "churchContactZip",
]);

// Same identity-field set as Primary/Spouse above, reused for every
// household-member slot beyond those two.
const MEMBER_SLOT_FIELDS = [
  { key: "firstName", label: "First name" },
  { key: "initial", label: "Middle initial" },
  { key: "lastName", label: "Last name" },
  { key: "dob", label: "Date of birth" },
  { key: "ssnLast4", label: "Last 4 of SSN" },
  { key: "gender", label: "Gender" },
];

// A custom field's scope (see the mapping/Manage Form Fields "add as a new
// field under: ..." choices) says which section it's categorized in and,
// via customFieldTarget, which target string reaches its data: "household"
// (or no scope at all, for a field created before per-member categorization
// existed) AND "church" both land in appForm's own flat extraFields bag --
// there's no separate storage for a "church custom field", it's the exact
// same bag as a household one, just labeled/grouped differently, the same
// relationship Household/Church's fixed fields already have. "primary"/
// "spouse"/"slotN" is that specific member's own extraFields bag instead
// (see main.js's resolveAppFormTarget/resolveOrCreateMemberForSlot) --
// letting e.g. two different household members each have their own value
// for a same-named field, rather than sharing one household-wide slot.
function customFieldScopeLabel(scope) {
  if (!scope || scope === "household") return "Household";
  if (scope === "church") return "Church";
  if (scope === "primary") return "Primary member";
  if (scope === "spouse") return "Spouse";
  const m = /^slot(\d+)$/.exec(scope);
  if (m) return `Household Member ${m[1]}`;
  return "New field";
}

function customFieldTarget(c) {
  const scope = c.scope || "household";
  return scope === "household" || scope === "church" ? `custom:${c.key}` : `membercustom:${scope}.${c.key}`;
}

// The "natural" App-side row order before any manual reordering is applied:
// fixed groups, each immediately followed by any custom fields scoped to
// that same group, then one group per member slot 2..slotCount (ditto for
// slot-scoped customs). This is what a brand-new field (or a freshly added
// slot) falls back to being positioned near -- see buildAppFieldRows below
// -- rather than always the very end of the list.
function buildNaturalAppFieldRows(slotCount, customFields) {
  const rows = [];
  const customsByScope = new Map();
  (customFields || []).forEach((c) => {
    const scope = c.scope || "household";
    if (!customsByScope.has(scope)) customsByScope.set(scope, []);
    customsByScope.get(scope).push(c);
  });
  const pushCustomsFor = (scope) => {
    (customsByScope.get(scope) || []).forEach((c) =>
      rows.push({ id: customFieldTarget(c), label: `${customFieldScopeLabel(c.scope)} → ${c.label}`, customKey: c.key, customScope: scope })
    );
    customsByScope.delete(scope);
  };
  APP_FIELD_FIXED_GROUPS.forEach((g) => {
    g.fields.forEach((f) => rows.push({ id: `${g.prefix}${f.key}`, label: `${g.group} → ${f.label}` }));
    pushCustomsFor(g.scope);
  });
  for (let slot = 2; slot <= slotCount; slot++) {
    MEMBER_SLOT_FIELDS.forEach((f) => rows.push({ id: `member:slot${slot}.${f.key}`, label: `Household Member ${slot} → ${f.label}` }));
    pushCustomsFor(`slot${slot}`);
  }
  // Anything left (a custom field whose scope's slot doesn't currently
  // exist) still needs to show up somewhere rather than vanish.
  customsByScope.forEach((_, scope) => pushCustomsFor(scope));
  return rows;
}

// Every connectable App-side row, in final display order: starts from the
// natural grouping above (with a deleted field filtered out -- see
// isFieldRemoved -- since it's no longer a valid target anywhere), then
// re-sorts whatever's already in `order` (a saved/dragged/reordered
// sequence of row ids) among itself -- but a row NOT yet in `order` (a
// field or slot added since the last save) is anchored right after
// wherever its natural predecessor landed, rather than sorted past every
// explicitly-ordered row to the very end.
//
// `removedFieldsOverride` lets a caller that's mid-edit of removedFields
// itself (Manage Form Fields, via buildManageFieldSections below) filter
// against its own in-progress draft instead of the last-saved
// state.formSchema.removedFields isFieldRemoved would otherwise read --
// without it, a field you just deleted in that screen wouldn't disappear
// from its own list until after Save. Every other caller (the real
// Application tab, the API mapping modal) omits it and gets the saved
// schema, which is what they should always reflect.
function buildAppFieldRows(slotCount, customFields, order, removedFieldsOverride) {
  const natural = buildNaturalAppFieldRows(slotCount, customFields).filter((row) =>
    removedFieldsOverride ? !removedFieldsOverride.includes(row.id) : !isFieldRemoved(row.id)
  );
  const orderIndex = new Map((order || []).map((id, i) => [id, i]));
  let lastKnownPos = -1;
  let unorderedRun = 0;
  const withPos = natural.map((row) => {
    if (orderIndex.has(row.id)) {
      lastKnownPos = orderIndex.get(row.id);
      unorderedRun = 0;
      return { row, pos: lastKnownPos };
    }
    unorderedRun += 1;
    return { row, pos: lastKnownPos + unorderedRun / (natural.length + 1) };
  });
  return withPos.sort((a, b) => a.pos - b.pos).map((x) => x.row);
}

// The live cross-field display order (state.formSchema.appFieldOrder) --
// set either by dragging/reordering in the API mapping modal or by the Up/
// Down buttons in Manage Form Fields, both of which write to the same
// list, so reordering in either screen reorders what a reviewer sees
// everywhere. Empty for a folder that's never reordered anything;
// buildAppFieldRows already falls back to natural order in that case.
function currentAppFieldOrder() {
  return (typeof state !== "undefined" && state.formSchema && state.formSchema.appFieldOrder) || [];
}

// True if `row` (a row object from buildAppFieldRows/buildNaturalAppFieldRows)
// belongs to the given catalog scope ("household", "church", "primary",
// "spouse", "slotN") -- lets a render function pull just its own slice of
// the one global cross-field order back out, already in the correct
// relative sequence since buildAppFieldRows resolves the full order in one
// pass. A custom row's target ("custom:<key>") is identical whether it's
// household- or church-scoped, so those go by the customScope tag
// buildNaturalAppFieldRows attached instead of the id string; a fixed
// row's id is unambiguous EXCEPT that Household and Church share the same
// "household." prefix, disambiguated by CHURCH_FIELD_KEYS.
function rowBelongsToScope(row, scope) {
  if (row.customKey) return (row.customScope || "household") === scope;
  if (scope === "household" || scope === "church") {
    if (!row.id.startsWith("household.")) return false;
    const isChurchField = CHURCH_FIELD_KEYS.has(row.id.slice("household.".length));
    return scope === "church" ? isChurchField : !isChurchField;
  }
  return row.id.startsWith(`member:${scope}.`) || row.id.startsWith(`membercustom:${scope}.`);
}

// One scope's fields (fixed + its own custom fields, interleaved), in the
// current live display order -- what renderMemberFieldsHtml/
// renderHouseholdFieldsHtml/Manage Form Fields render from below, instead
// of each hardcoding its own fixed sequence the way they used to.
function orderedScopeRows(scope, slotCount, customFields, order, removedFieldsOverride) {
  return buildAppFieldRows(slotCount, customFields, order, removedFieldsOverride).filter((row) => rowBelongsToScope(row, scope));
}

// Same grouping as buildNaturalAppFieldRows, but keeping each group's rows
// together (with a group header) instead of flattening into one list --
// what the Manage Form Fields screen needs, since it's grouped by
// household/primary/spouse/slot rather than one cross-group sequence. Each
// section's own rows come straight from orderedScopeRows, so reordering
// fields in the API mapping modal reorders this list too, not just that
// one screen -- and each row's label already carries its group ("Primary
// member → First name", from buildNaturalAppFieldRows), since Primary and
// Spouse (and every Household Member N slot) share several identical field
// labels that the section header alone doesn't disambiguate once you're
// looking at just one row. The SECTIONS themselves are also sorted by the
// live order (where each scope's first field falls in the one global
// sequence), not just the rows within them -- moving every Primary/Spouse
// field above Household's in the mapping modal moves those whole sections
// above Household here too, rather than leaving Household pinned at the
// top regardless of how everything inside it got reordered.
function buildManageFieldSections(slotCount, customFields, order, removedFields) {
  const scopeSections = APP_FIELD_FIXED_GROUPS.map((g) => ({ group: g.group, scope: g.scope }));
  for (let slot = 2; slot <= slotCount; slot++) {
    scopeSections.push({ group: `Household Member ${slot}`, scope: `slot${slot}` });
  }
  // A custom field whose scope has no matching fixed group (e.g. a slot
  // nothing else references any more) still needs its own section.
  const knownScopes = new Set(scopeSections.map((s) => s.scope));
  (customFields || []).forEach((c) => {
    const scope = c.scope || "household";
    if (!knownScopes.has(scope)) {
      knownScopes.add(scope);
      scopeSections.push({ group: customFieldScopeLabel(scope), scope });
    }
  });

  const fullRows = buildAppFieldRows(slotCount, customFields, order, removedFields);
  const scopeSortKey = (scope) => {
    const idx = fullRows.findIndex((row) => rowBelongsToScope(row, scope));
    return idx === -1 ? Infinity : idx; // a scope with no fields left sinks to the end rather than staying pinned by declaration order
  };

  const sections = scopeSections.map((s) => ({
    group: s.group,
    scope: s.scope,
    rows: orderedScopeRows(s.scope, slotCount, customFields, order, removedFields).map((row) => ({ ...row, isCustom: !!row.customKey })),
  }));
  sections.sort((a, b) => scopeSortKey(a.scope) - scopeSortKey(b.scope));
  return sections;
}

// The highest household-member slot any custom field is currently scoped
// to -- Manage Form Fields has no "add a slot" action of its own (that's an
// API-mapping-specific concept, tied to a numbered import slot), so it only
// ever shows a Household Member N section if a custom field already put
// something there.
function manageFieldsSlotCount(customFields) {
  let max = 1;
  (customFields || []).forEach((c) => {
    const m = /^slot(\d+)$/.exec(c.scope || "");
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max;
}

// Turns a field label into a unique extraFields/customFields key -- "T-Shirt
// Size" -> "t_shirt_size", disambiguated with a numeric suffix if two fields
// slugify to the same thing.
function slugifyFieldKey(label, used) {
  const base = (label || "field").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}_${n++}`;
  used.add(key);
  return key;
}

// Whether `target` (an APP_FIELD_FIXED_GROUPS/MEMBER_SLOT_FIELDS id, e.g.
// "member:spouse.maritalStatus") has been removed via Manage Form Fields --
// checked at render time to skip that field's input entirely. Data already
// stored under a since-removed field's key is never touched, just no longer
// shown -- same "orphaned data sits harmlessly" precedent as an unused
// custom field. Falls back to nothing-removed if the schema hasn't loaded.
function isFieldRemoved(target) {
  const removed = (typeof state !== "undefined" && state.formSchema && state.formSchema.removedFields) || [];
  return removed.includes(target);
}

// The 7 fields required before this session's Manage Form Fields screen
// existed -- the default requiredFields a folder starts with (see main.js's
// readFormSchema) and the fallback here if the schema hasn't loaded yet.
const DEFAULT_REQUIRED_FIELDS = [
  "member:primary.firstName",
  "member:primary.lastName",
  "member:primary.dob",
  "household.address",
  "household.city",
  "household.state",
  "household.zip",
];

function isFieldRequired(target) {
  const required = (typeof state !== "undefined" && state.formSchema && state.formSchema.requiredFields) || DEFAULT_REQUIRED_FIELDS;
  return required.includes(target);
}

// A member's own position in the removable/required catalog above --
// "primary"/"spouse" by role (whether they arrived on paper or via API
// import, since the field really means "the schema's Primary-member field"),
// or their importSlot tag for a numbered API-import slot. A plain
// hand-added child has neither, so isFieldRemoved/isFieldRequired (and
// renderMemberFieldsHtml's own custom-field matching) simply never apply to
// it, since a generic child was never offered as a mapping target either.
function memberFieldScope(member) {
  if (member.role === "primary") return "primary";
  if (member.role === "spouse") return "spouse";
  if (member.importSlot && /^slot\d+$/.test(member.importSlot)) return member.importSlot;
  return null;
}

// findMemberForSlot/resolveRequiredFieldValue are the read-only counterparts
// to main.js's resolveOrCreateMemberForSlot/resolveAppFormTarget -- this one
// never creates a member as a side effect of just checking whether a
// required field is filled in. Resolves a target the same way that pair
// does: "household.<key>" against the root, "member:<scope>.<key>" against
// that member (the <key> can itself be dotted, for a nested field),
// "membercustom:<scope>.<key>" against that member's own extraFields, or
// "custom:<key>" against the household-level extraFields bag.
function findMemberForSlot(form, slot) {
  let member = form.householdMembers.find((m) => m.importSlot === slot);
  if (!member && slot === "primary") member = form.householdMembers.find((m) => m.role === "primary");
  if (!member && slot === "spouse") member = form.householdMembers.find((m) => m.role === "spouse");
  return member || null;
}

function resolveRequiredFieldValue(form, target) {
  if (target.startsWith("household.")) return getAppFieldValue(form, null, target);
  if (target.startsWith("member:")) {
    const rest = target.slice("member:".length);
    const dot = rest.indexOf(".");
    if (dot === -1) return undefined;
    const member = findMemberForSlot(form, rest.slice(0, dot));
    return member ? getAppFieldValue(form, member.id, rest.slice(dot + 1)) : undefined;
  }
  if (target.startsWith("membercustom:")) {
    const rest = target.slice("membercustom:".length);
    const dot = rest.indexOf(".");
    if (dot === -1) return undefined;
    const member = findMemberForSlot(form, rest.slice(0, dot));
    return member ? getAppFieldValue(form, member.id, `extraFields.${rest.slice(dot + 1)}`) : undefined;
  }
  if (target.startsWith("custom:")) return getAppFieldValue(form, null, `extraFields.${target.slice("custom:".length)}`);
  return undefined;
}

// Resolves a dot-path field name against either the form root (memberId
// null) or one household member (memberId set) — e.g. "household.address"
// against the root, or "health.conditions.cardiovascular.highBloodPressure.present"
// against a member. Returns the containing object + final key so callers can
// both read and write through it.
function appFieldTarget(form, memberId, field) {
  let obj = memberId ? form.householdMembers.find((m) => m.id === memberId) : form;
  if (!obj) return null;
  const parts = field.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    obj = obj ? obj[parts[i]] : undefined;
    if (obj == null) return null;
  }
  return { obj, key: parts[parts.length - 1] };
}

function getAppFieldValue(form, memberId, field) {
  const t = appFieldTarget(form, memberId, field);
  return t ? t.obj[t.key] : undefined;
}

function setAppFieldValue(form, memberId, field, value) {
  const t = appFieldTarget(form, memberId, field);
  if (t) t.obj[t.key] = value;
}

// Schema-driven: iterates whichever fields Manage Form Fields currently has
// marked required (state.formSchema.requiredFields, falling back to
// DEFAULT_REQUIRED_FIELDS before the schema's loaded) rather than checking
// a hardcoded set of 7 field names -- a newly-required custom field counts
// here automatically, with no code change needed.
function countMissingRequiredFields(file) {
  const required = (typeof state !== "undefined" && state.formSchema && state.formSchema.requiredFields) || DEFAULT_REQUIRED_FIELDS;
  const form = file.appForm;
  if (!form) return required.length;
  let missing = 0;
  required.forEach((target) => {
    const v = resolveRequiredFieldValue(form, target);
    if (v === undefined || v === null || !String(v).trim()) missing++;
  });
  return missing;
}

// ---- Field builders ----
// Every input/select/checkbox carries data-field (a dot-path, see
// appFieldTarget above), data-member (the household member id, omitted for
// root-level fields), and data-kind — which autosave tier wireApplicationForm
// wires it into: "text" (debounced, no render — free-text typing),
// "discrete" (immediate save, no render — a single checkbox/select click),
// or "structural" (immediate save + render() — changes what else on screen
// is visible, e.g. role or a "No ___ History" toggle).

function appFieldId(memberId, field) {
  return `af-${memberId || "h"}-${field}`;
}

function appTextField(form, memberId, field, label, opts = {}) {
  const value = getAppFieldValue(form, memberId, field) ?? "";
  const id = appFieldId(memberId, field);
  const type = opts.type || "text";
  return `
    <div class="bm-field${opts.wide ? " bm-appform-wide" : ""}">
      <label class="bm-field-label" for="${id}">${label}${opts.required ? " *" : ""}</label>
      <input class="bm-input" id="${id}" type="${type}" data-field="${field}" ${memberId ? `data-member="${memberId}"` : ""} data-kind="text" value="${escapeHtml(String(value))}" />
    </div>`;
}

function appTextareaField(form, memberId, field, label) {
  const value = getAppFieldValue(form, memberId, field) ?? "";
  const id = appFieldId(memberId, field);
  return `
    <div class="bm-field">
      <label class="bm-field-label" for="${id}">${label}</label>
      <textarea class="bm-input bm-appform-textarea" id="${id}" data-field="${field}" ${memberId ? `data-member="${memberId}"` : ""} data-kind="text">${escapeHtml(value)}</textarea>
    </div>`;
}

function appSelectField(form, memberId, field, label, options, opts = {}) {
  const value = getAppFieldValue(form, memberId, field) ?? "";
  const id = appFieldId(memberId, field);
  const kind = opts.kind || "discrete";
  return `
    <div class="bm-field${opts.wide ? " bm-appform-wide" : ""}">
      <label class="bm-field-label" for="${id}">${label}</label>
      <select class="bm-select" id="${id}" data-field="${field}" ${memberId ? `data-member="${memberId}"` : ""} data-kind="${kind}">
        <option value=""></option>
        ${options.map((o) => `<option value="${o.value}" ${value === o.value ? "selected" : ""}>${o.label}</option>`).join("")}
      </select>
    </div>`;
}

function appCheckboxField(form, memberId, field, label, opts = {}) {
  const value = !!getAppFieldValue(form, memberId, field);
  const kind = opts.kind || "discrete";
  const id = appFieldId(memberId, field);
  return `
    <label class="bm-checkbox-label">
      <input type="checkbox" id="${id}" data-field="${field}" ${memberId ? `data-member="${memberId}"` : ""} data-kind="${kind}" ${opts.togglesExpense ? `data-toggles-expense="${opts.togglesExpense}"` : ""} ${value ? "checked" : ""} ${opts.disabled ? "disabled" : ""} />
      ${label}
    </label>`;
}

// ---- Rendering ----

function renderConditionCategoryHtml(cat, member, file) {
  const catState = member.health.conditions[cat.key];
  const anyPresent = cat.conditions.some((c) => catState[c.key].present) || (catState.other && catState.other.trim());
  const expandKey = `${file.path}:${member.id}:${cat.key}`;
  const open = anyPresent || expandedHealthCategories.has(expandKey);
  return `
    <details class="bm-appform-category" data-expand-key="${expandKey}" ${open ? "open" : ""}>
      <summary>${cat.label}${anyPresent ? " •" : ""}</summary>
      <div class="bm-appform-conditions">
        ${cat.conditions
          .map((c) => {
            const presentField = `health.conditions.${cat.key}.${c.key}.present`;
            const expenseField = `health.conditions.${cat.key}.${c.key}.expense5k`;
            const presentId = appFieldId(member.id, presentField);
            const expenseId = appFieldId(member.id, expenseField);
            const present = catState[c.key].present;
            return `
              <div class="bm-appform-condition-row">
                <span class="bm-appform-condition-label">${c.label}</span>
                <label class="bm-checkbox-label"><input type="checkbox" id="${presentId}" data-field="${presentField}" data-member="${member.id}" data-kind="discrete" data-toggles-expense="${expenseId}" ${present ? "checked" : ""} /> Has this</label>
                <label class="bm-checkbox-label"><input type="checkbox" id="${expenseId}" data-field="${expenseField}" data-member="${member.id}" data-kind="discrete" ${catState[c.key].expense5k ? "checked" : ""} ${present ? "" : "disabled"} /> $5,000+/yr</label>
              </div>`;
          })
          .join("")}
        <div class="bm-field">
          <label class="bm-field-label" for="${appFieldId(member.id, `health.conditions.${cat.key}.other`)}">Other</label>
          <input class="bm-input" id="${appFieldId(member.id, `health.conditions.${cat.key}.other`)}" type="text" data-field="health.conditions.${cat.key}.other" data-member="${member.id}" data-kind="text" value="${escapeHtml(catState.other)}" />
        </div>
      </div>
    </details>`;
}

function renderHealthQuestionnaireHtml(member, file) {
  const form = file.appForm;
  const health = member.health;
  return `
    <div class="bm-appform-health">
      <div class="bm-section-label">Health history</div>
      <div class="bm-appform-grid">
        ${appTextField(form, member.id, "health.height", "Height")}
        ${appTextField(form, member.id, "health.weight", "Weight")}
        ${appSelectField(form, member.id, "health.tobaccoUse", "Vaping or tobacco use?", YES_NO_OPTIONS)}
      </div>
      <div class="bm-appform-checkbox-row">
        ${appCheckboxField(form, member.id, "health.noPastMedicalHistory", "No past medical history", { kind: "structural" })}
      </div>
      ${
        health.noPastMedicalHistory
          ? ""
          : `<div class="bm-appform-categories">
              ${CONDITION_CATEGORIES.map((cat) => renderConditionCategoryHtml(cat, member, file)).join("")}
            </div>`
      }
      <div class="bm-appform-checkbox-row">
        ${appCheckboxField(form, member.id, "health.noPastSurgicalHistory", "No past surgical history", { kind: "structural" })}
      </div>
      ${health.noPastSurgicalHistory ? "" : appTextareaField(form, member.id, "health.pastSurgicalHistoryText", "Past surgeries")}
      <div class="bm-appform-checkbox-row">
        ${appCheckboxField(form, member.id, "health.noMedications", "No current medications", { kind: "structural" })}
      </div>
      ${health.noMedications ? "" : appTextareaField(form, member.id, "health.currentMedicationsText", "Current medications (dose & frequency)")}
    </div>`;
}

// One-time, in-memory migration for a member saved before Medicare was
// collapsed from four independent checkboxes into one dropdown (see
// MEDICARE_OPTIONS/makeBlankHouseholdMember) -- picks whichever part was
// checked (first one wins in the unlikely case more than one was) so a
// scan already entered under the old shape doesn't just go blank. Only
// runs once per member: `medicarePart` being present at all (even "") means
// either a fresh member or one already migrated, so a deliberate later
// choice of "none" is never overwritten back from stale legacy data. The
// old medicareParts object itself is left alone on disk either way --
// same "orphaned data sits harmlessly" precedent as any other removed
// field.
function migrateMedicarePart(member) {
  if (member.medicarePart !== undefined) return;
  const mp = member.medicareParts;
  member.medicarePart = mp && mp.a ? "A" : mp && mp.b ? "B" : mp && mp.c ? "C" : mp && mp.d ? "D" : "";
}

// Every schema-addressable field for one member -- identity fields,
// Social Security/marital status/Medicare (primary & spouse only), and any
// custom fields scoped to them -- rendered as ONE grid in the current live
// display order (orderedScopeRows/currentAppFieldOrder), so reordering in
// the API mapping modal or removing/requiring a field in Manage Form Fields
// changes what a reviewer actually sees here too, not just those screens. A
// plain hand-added child (scope null, see memberFieldScope) was never
// offered as a reorder/remove/require target, so it keeps the fixed
// identity-only set it always had.
function renderMemberFieldsHtml(member, file) {
  const form = file.appForm;
  const scope = memberFieldScope(member);
  migrateMedicarePart(member);
  const FIELD_RENDERERS = {
    firstName: () => appTextField(form, member.id, "firstName", "First name", { required: !!scope && isFieldRequired(`member:${scope}.firstName`) }),
    initial: () => appTextField(form, member.id, "initial", "MI"),
    lastName: () => appTextField(form, member.id, "lastName", "Last name", { required: !!scope && isFieldRequired(`member:${scope}.lastName`) }),
    dob: () => appTextField(form, member.id, "dob", "DOB", { type: "date", required: !!scope && isFieldRequired(`member:${scope}.dob`) }),
    ssnLast4: () => appTextField(form, member.id, "ssnLast4", "Last 4 of SSN"),
    gender: () => appSelectField(form, member.id, "gender", "Gender", GENDER_OPTIONS),
    ssExempt: () => appSelectField(form, member.id, "ssExempt", "Social Security exempt?", YES_NO_OPTIONS),
    maritalStatus: () => appTextField(form, member.id, "maritalStatus", "Marital status", { required: !!scope && isFieldRequired(`member:${scope}.maritalStatus`) }),
    medicarePart: () => appSelectField(form, member.id, "medicarePart", "Medicare", MEDICARE_OPTIONS),
  };
  if (!scope) {
    return ["firstName", "initial", "lastName", "dob", "ssnLast4", "gender"].map((k) => FIELD_RENDERERS[k]()).join("");
  }
  const customFieldDefs = (typeof state !== "undefined" && state.customFieldDefs) || [];
  const slotCount = manageFieldsSlotCount(customFieldDefs);
  const order = currentAppFieldOrder();
  const prefix = `member:${scope}.`;
  return orderedScopeRows(scope, slotCount, customFieldDefs, order)
    .map((row) => {
      if (row.customKey) {
        const def = customFieldDefs.find((c) => c.key === row.customKey && c.scope === scope);
        return def ? appTextField(form, member.id, `extraFields.${def.key}`, def.label, { wide: true }) : "";
      }
      const renderer = FIELD_RENDERERS[row.id.slice(prefix.length)];
      return renderer ? renderer() : "";
    })
    .join("");
}

// Primary/Spouse are always-present fixed slots (see ensureSpouseMember),
// each its own top-level category -- just their identity/SS/marital/
// Medicare fields (renderMemberFieldsHtml) plus "Signed on paper form"
// (both are always adults by definition, so there's no 18+ checkbox and,
// unlike a dependent, no Remove button -- clearing the Spouse category's
// fields back to blank is how you "remove" a spouse, since a spouse with
// no name isn't counted as Member #2 -- see renderApplicationFormHtml).
function renderPrimaryOrSpouseCategoryHtml(member, file) {
  const form = file.appForm;
  return `
    <div class="bm-appform-grid">
      ${renderMemberFieldsHtml(member, file)}
    </div>
    <div class="bm-appform-checkbox-row">
      ${appCheckboxField(form, member.id, "signedOnPaper", "Signed on paper form")}
    </div>`;
}

// Member #3+ (anyone beyond primary/spouse, added via "Add household
// member") don't get their own always-present identity category the way
// Primary/Spouse do -- their identity fields (renderMemberFieldsHtml, scope
// null so no SS/marital/Medicare) are bundled directly into their own
// "Member #N health" category instead, alongside the Remove button, the
// 18+/signed-on-paper checkboxes, and the health questionnaire itself.
function renderDependentMemberCategoryHtml(member, file) {
  const form = file.appForm;
  const isAdult = !!member.isAdult18Plus;
  return `
    <div class="bm-appform-member-header">
      <div class="bm-appform-grid bm-appform-member-identity">
        ${renderMemberFieldsHtml(member, file)}
      </div>
      <button class="bm-btn bm-btn-ghost bm-btn-sm" data-action="remove-member" data-member="${member.id}" title="Remove this household member">${ICONS.x} Remove</button>
    </div>
    <div class="bm-appform-checkbox-row">
      ${appCheckboxField(form, member.id, "isAdult18Plus", "18 years or older", { kind: "structural" })}
    </div>
    ${
      isAdult
        ? `<div class="bm-appform-checkbox-row">${appCheckboxField(form, member.id, "signedOnPaper", "Signed on paper form")}</div>`
        : ""
    }
    ${renderHealthQuestionnaireHtml(member, file)}`;
}

// Household and Church fields, in the current live display order --
// `scope` is "household" or "church" (see APP_FIELD_FIXED_GROUPS/
// CHURCH_FIELD_KEYS above; both are real catalog scopes now, not just a
// presentational split, so reordering/removing/requiring/adding a custom
// field under one is independent of the other everywhere -- Manage Form
// Fields, the API mapping modal, and here). See renderMemberFieldsHtml for
// the per-member equivalent.
function renderHouseholdFieldsHtml(form, scope = "household") {
  const reqH = (key) => isFieldRequired(`household.${key}`);
  const FIELD_RENDERERS = {
    address: () => appTextField(form, null, "household.address", "Address", { required: reqH("address"), wide: true }),
    city: () => appTextField(form, null, "household.city", "City", { required: reqH("city") }),
    state: () => appTextField(form, null, "household.state", "State", { required: reqH("state") }),
    zip: () => appTextField(form, null, "household.zip", "ZIP", { required: reqH("zip") }),
    phone: () => appTextField(form, null, "household.phone", "Phone", { required: reqH("phone") }),
    emailOrFax: () => appTextField(form, null, "household.emailOrFax", "Email/Fax", { required: reqH("emailOrFax") }),
    incomeTier: () => appSelectField(form, null, "household.incomeTier", "Household income tier", INCOME_TIERS, { wide: true }),
    seventyPercentApplying: () => appSelectField(form, null, "household.seventyPercentApplying", "70%+ of church applying?", YES_NO_OPTIONS),
    effectiveStartDate: () => appTextField(form, null, "household.effectiveStartDate", "Effective start date", { type: "month", required: reqH("effectiveStartDate") }),
    previousPlanName: () => appTextField(form, null, "household.previousPlanName", "Previous medical aid plan (if any)"),
    previousPlanAnnualCost: () => appTextField(form, null, "household.previousPlanAnnualCost", "Previous plan annual cost", { type: "number" }),
    churchName: () => appTextField(form, null, "household.churchName", "Church name", { required: reqH("churchName"), wide: true }),
    churchContactName: () => appTextField(form, null, "household.churchContactName", "Church contact"),
    churchContactPhone: () => appTextField(form, null, "household.churchContactPhone", "Church contact phone"),
    churchContactEmailOrFax: () => appTextField(form, null, "household.churchContactEmailOrFax", "Church contact email/fax"),
    churchContactAddress: () => appTextField(form, null, "household.churchContactAddress", "Church contact address", { wide: true }),
    churchContactCity: () => appTextField(form, null, "household.churchContactCity", "Church contact city"),
    churchContactState: () => appTextField(form, null, "household.churchContactState", "Church contact state"),
    churchContactZip: () => appTextField(form, null, "household.churchContactZip", "Church contact ZIP"),
  };
  const customFieldDefs = (typeof state !== "undefined" && state.customFieldDefs) || [];
  const slotCount = manageFieldsSlotCount(customFieldDefs);
  const order = currentAppFieldOrder();
  return orderedScopeRows(scope, slotCount, customFieldDefs, order)
    .map((row) => {
      if (row.customKey) {
        const def = customFieldDefs.find((c) => c.key === row.customKey && (c.scope || "household") === scope);
        return def ? appTextField(form, null, `extraFields.${def.key}`, def.label, { wide: true }) : "";
      }
      const renderer = FIELD_RENDERERS[row.id.slice("household.".length)];
      return renderer ? renderer() : "";
    })
    .join("");
}

// True if `member` has anything flagged in their health questionnaire (a
// condition marked present, or free-text surgical history/medications) --
// the default-open heuristic for a health category below: nothing to
// review yet, stay collapsed; something's there, or a name hasn't even
// been entered yet for a new dependent, open up so it's not missed.
function memberHasHealthData(member) {
  const h = member.health;
  if (!h) return false;
  const anyConditionPresent = CONDITION_CATEGORIES.some((cat) => {
    const catState = h.conditions[cat.key];
    if (!catState) return false;
    return cat.conditions.some((c) => catState[c.key] && catState[c.key].present) || (catState.other && catState.other.trim());
  });
  return (
    anyConditionPresent ||
    !!(h.pastSurgicalHistoryText && h.pastSurgicalHistoryText.trim()) ||
    !!(h.currentMedicationsText && h.currentMedicationsText.trim())
  );
}

function memberHasName(member) {
  return !!((member.firstName || "").trim() || (member.lastName || "").trim());
}

// Explicit open/closed overrides for the Application tab's own top-level
// categories (Primary member, Spouse, Household, Church, and each member's
// health) once a reviewer has manually toggled one -- separate from
// expandedHealthCategories below (the health questionnaire's own nested
// condition sub-categories), since these categories default OPEN while the
// health ones default CLOSED-unless-there's-something-to-review, two
// different default polarities one Set of "has been expanded" can't
// express. Not part of the saved schema, same reasoning as
// expandedHealthCategories.
const categoryOpenOverrides = new Map();

function renderAppCategoryHtml(file, key, label, innerHtml, defaultOpen) {
  const expandKey = `${file.path}:category:${key}`;
  const open = categoryOpenOverrides.has(expandKey) ? categoryOpenOverrides.get(expandKey) : defaultOpen;
  return `
    <details class="bm-appform-toplevel-category" data-expand-key="${expandKey}" ${open ? "open" : ""}>
      <summary>${escapeHtml(label)}</summary>
      <div class="bm-appform-category-body">${innerHtml}</div>
    </details>`;
}

// The org's own paper-form category order: Primary member, Spouse,
// Household, Church, then Primary member health, followed by one
// collapsible health category per additional member -- Member #2 is the
// spouse (only once they actually have a name; an untouched blank spouse
// slot isn't "a member" yet), Member #3+ are whoever's in the household
// members list beyond primary/spouse, in that list's order, bundling each
// one's identity fields together with their health questionnaire (see
// renderDependentMemberCategoryHtml) since they don't get a separate
// always-present identity category the way primary/spouse do.
function renderApplicationFormHtml(file) {
  const form = file.appForm || (file.appForm = makeBlankAppForm());
  ensureSpouseMember(form);
  const missing = countMissingRequiredFields(file);
  const primary = form.householdMembers.find((m) => m.role === "primary");
  const spouse = form.householdMembers.find((m) => m.role === "spouse");
  const others = form.householdMembers.filter((m) => m.role !== "primary" && m.role !== "spouse");

  const categories = [
    renderAppCategoryHtml(file, "primary", "Primary member", renderPrimaryOrSpouseCategoryHtml(primary, file), true),
    renderAppCategoryHtml(file, "spouse", "Spouse", renderPrimaryOrSpouseCategoryHtml(spouse, file), true),
    renderAppCategoryHtml(file, "household", "Household", `<div class="bm-appform-grid">${renderHouseholdFieldsHtml(form, "household")}</div>`, true),
    renderAppCategoryHtml(file, "church", "Church", `<div class="bm-appform-grid">${renderHouseholdFieldsHtml(form, "church")}</div>`, true),
    renderAppCategoryHtml(file, "primary-health", "Primary member health", renderHealthQuestionnaireHtml(primary, file), memberHasHealthData(primary)),
  ];
  if (memberHasName(spouse)) {
    categories.push(
      renderAppCategoryHtml(file, "member-2-health", "Member #2 health", renderHealthQuestionnaireHtml(spouse, file), memberHasHealthData(spouse))
    );
  }
  others.forEach((m, i) => {
    const num = i + 3;
    categories.push(
      renderAppCategoryHtml(
        file,
        `member-${num}-health`,
        `Member #${num} health`,
        renderDependentMemberCategoryHtml(m, file),
        !memberHasName(m) || memberHasHealthData(m)
      )
    );
  });

  return `
    <div class="bm-appform-badge${missing === 0 ? " bm-appform-badge--ok" : ""}">
      ${missing === 0 ? "All required fields complete" : `${missing} required field${missing === 1 ? "" : "s"} missing`}
    </div>
    ${categories.join("")}
    <button class="bm-btn bm-btn-ghost bm-btn-sm" data-action="add-member">${ICONS.plus} Add household member</button>
    <div>
      <div class="bm-section-label">Acknowledgments</div>
      <div class="bm-appform-grid">
        ${appTextField(form, null, "acknowledgment.printedNameHeadOfHousehold", "Printed name of head of household", { wide: true })}
      </div>
    </div>`;
}

// ---- Transient, non-persisted UI state ----
// Which health-history <details> categories are expanded — not part of the
// saved schema (a structural render, e.g. toggling "No Past Medical
// History", would otherwise reset every category back to collapsed since
// render() rebuilds the DOM from scratch). Keyed by file+member+category so
// it stays correct across Prev/Next in review mode.
const expandedHealthCategories = new Set();

// Keyed by `${field}:${memberId||""}`, holding a JSON snapshot of the whole
// form as it was when a text field gained focus — the undo boundary for that
// field, same idea as renderer.js's commentEditSnapshot but over the whole
// form object at once, since app-form fields don't have their own array
// slots to snapshot individually.
const appFormFieldSnapshot = {};

function patchRequiredBadge(panel, file) {
  const badge = panel.querySelector(".bm-appform-badge");
  if (!badge) return;
  const missing = countMissingRequiredFields(file);
  badge.textContent = missing === 0 ? "All required fields complete" : `${missing} required field${missing === 1 ? "" : "s"} missing`;
  badge.classList.toggle("bm-appform-badge--ok", missing === 0);
}

function wireApplicationForm(panel, file) {
  const form = file.appForm;

  panel.querySelectorAll('[data-field][data-kind="text"]').forEach((input) => {
    const snapKey = `${input.dataset.field}:${input.dataset.member || ""}`;
    input.addEventListener("focus", () => {
      appFormFieldSnapshot[snapKey] = JSON.stringify(form);
    });
    input.addEventListener("input", () => {
      setAppFieldValue(form, input.dataset.member, input.dataset.field, input.value);
      scheduleAppFormSave(file);
      // Always repatch rather than hand-picking "is this field one of the
      // required ones" -- required fields are now schema-configurable (see
      // Manage Form Fields), so a fixed relevance check could never have
      // known about a newly-required custom field. Cheap: just a handful
      // of required targets to check.
      patchRequiredBadge(panel, file);
    });
    input.addEventListener("blur", () => {
      const before = appFormFieldSnapshot[snapKey];
      delete appFormFieldSnapshot[snapKey];
      if (before == null || before === JSON.stringify(form)) return;
      pushUndo("Edit application field", () => {
        file.appForm = JSON.parse(before);
        return saveAppForm(file);
      });
    });
  });

  panel.querySelectorAll('[data-field][data-kind="discrete"]').forEach((input) => {
    input.addEventListener("change", () => {
      const value = input.type === "checkbox" ? input.checked : input.value;
      setAppFieldValue(form, input.dataset.member, input.dataset.field, value);
      saveAppForm(file);
      patchRequiredBadge(panel, file); // a discrete field (select/checkbox) can be marked required too
      if (input.dataset.togglesExpense) {
        const sibling = document.getElementById(input.dataset.togglesExpense);
        if (sibling) {
          sibling.disabled = !input.checked;
          if (!input.checked && sibling.checked) {
            sibling.checked = false;
            setAppFieldValue(form, sibling.dataset.member, sibling.dataset.field, false);
          }
        }
      }
    });
  });

  panel.querySelectorAll('[data-field][data-kind="structural"]').forEach((input) => {
    input.addEventListener("change", () => {
      const value = input.type === "checkbox" ? input.checked : input.value;
      setAppFieldValue(form, input.dataset.member, input.dataset.field, value);
      saveAppForm(file);
      render();
    });
  });

  panel.querySelectorAll('[data-action="add-member"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      form.householdMembers.push(makeBlankHouseholdMember("child"));
      saveAppForm(file);
      render();
    });
  });

  panel.querySelectorAll('[data-action="remove-member"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      if (form.householdMembers.length <= 1) return; // keep at least one member on the form
      if (!confirm("Remove this household member? Their health history will be lost.")) return;
      form.householdMembers = form.householdMembers.filter((m) => m.id !== btn.dataset.member);
      saveAppForm(file);
      render();
    });
  });

  panel.querySelectorAll(".bm-appform-category").forEach((details) => {
    details.addEventListener("toggle", () => {
      const key = details.dataset.expandKey;
      if (details.open) expandedHealthCategories.add(key);
      else expandedHealthCategories.delete(key);
    });
  });

  panel.querySelectorAll(".bm-appform-toplevel-category").forEach((details) => {
    details.addEventListener("toggle", () => {
      categoryOpenOverrides.set(details.dataset.expandKey, details.open);
    });
  });
}

// The pure schema/factory pieces above (CONDITION_CATEGORIES and the three
// makeBlank* functions) have no DOM/browser dependency, so main.js's
// Gravity Forms import path requires this same file under Node to build an
// appForm with exactly the shape the renderer expects — one schema, defined
// once, instead of drifting copies. `module` doesn't exist in this file's
// normal life as a plain <script> tag (see the file-top comment), so this
// only ever runs under `require()`.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CONDITION_CATEGORIES,
    makeBlankHealthRecord,
    makeBlankHouseholdMember,
    makeBlankAppForm,
    APP_FIELD_FIXED_GROUPS,
    MEMBER_SLOT_FIELDS,
    DEFAULT_REQUIRED_FIELDS,
  };
}
