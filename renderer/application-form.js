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
  { value: "none", label: "None" },
  { value: "A", label: "Part A" },
  { value: "B", label: "Part B" },
  { value: "C", label: "Part C" },
  { value: "D", label: "Part D" },
];

// Finds which of `options` (one of the *_OPTIONS/INCOME_TIERS tables above)
// a raw value means -- tolerant of the online form's own spelling ("Male"
// vs "male", "$25,001-50,000" vs "25001-50000", "Part A" vs "A"), since
// those arrive verbatim from Gravity Forms rather than as this schema's own
// option values. Compares with case and punctuation stripped, against both
// each option's value and its label. Returns the option, or null.
function matchChoiceOption(options, raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(raw);
  if (!n) return null;
  const direct = options.find((o) => norm(o.value) === n || norm(o.label) === n);
  if (direct) return direct;
  // "None" in one spelling, a sentence in the other -- the app's own
  // Medicare "none" vs the online form's "I'm not covered by Medicare".
  const NONE_LIKE = /^none$|not covered|not applicable/i;
  if (NONE_LIKE.test(String(raw).trim())) return options.find((o) => NONE_LIKE.test(String(o.label)) || NONE_LIKE.test(String(o.value))) || null;
  return null;
}

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

// The one mapping target that isn't a single field: a Gravity Forms List
// field whose rows are the household's children/dependents (one row per
// person, columns First Name/Middle Name/Last Name/Date of Birth/Last 4 of
// SSN/Gender -- the paper form's own "Children / Dependents" block). Each
// row becomes (or fills in) a real household member via mergeDependentRows
// below, rather than the whole list landing in one text field. Belongs to
// no catalog scope (see rowBelongsToScope), so it only ever appears as a
// mapping-modal row, never as an Application tab input of its own -- the
// members it creates already have their own categories there.
const DEPENDENTS_TARGET = "dependents";
const DEPENDENTS_ROW_LABEL = "Children / Dependents → List (one household member per row)";

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

// Every leaf of a member's Health History Questionnaire (renderHealthQuestionnaireHtml/
// renderConditionCategoryHtml), as one catalog row per storage key -- same
// "one row = one target = one value" shape as MEMBER_SLOT_FIELDS above, just
// generated from CONDITION_CATEGORIES instead of hand-listed, since that's
// already the single source of truth for the condition list. `key` is
// relative to "health." (joined with a member's scope by healthFieldRows
// below to form the real "member:<scope>.health...." target); `label` chains
// through the condition category the same way a fixed-field row's label
// carries its group ("Primary member → First name"), since a bare condition
// name alone doesn't say which of the 12 categories it's under.
const HEALTH_FIELD_DEFS = (() => {
  const defs = [
    { key: "health.height", label: "Height" },
    { key: "health.weight", label: "Weight" },
    { key: "health.tobaccoUse", label: "Vaping or tobacco use?" },
    { key: "health.noPastMedicalHistory", label: "No past medical history" },
  ];
  CONDITION_CATEGORIES.forEach((cat) => {
    cat.conditions.forEach((c) => {
      defs.push({ key: `health.conditions.${cat.key}.${c.key}.present`, label: `${cat.label} → ${c.label} (has this)` });
      defs.push({ key: `health.conditions.${cat.key}.${c.key}.expense5k`, label: `${cat.label} → ${c.label} ($5,000+/yr)` });
    });
    defs.push({ key: `health.conditions.${cat.key}.other`, label: `${cat.label} → Other` });
  });
  defs.push(
    { key: "health.noPastSurgicalHistory", label: "No past surgical history" },
    { key: "health.pastSurgicalHistoryText", label: "Past surgeries" },
    { key: "health.noMedications", label: "No current medications" },
    { key: "health.currentMedicationsText", label: "Current medications" }
  );
  return defs;
})();

// The Manage Form Fields/API mapping section label for a member scope's
// health rows -- kept as its own section rather than folded into that
// member's identity section (see buildManageFieldSections). Named to match
// renderApplicationFormHtml's own review-tab category labels for a
// DEPENDENT ("Member #3 health", "Member #4 health", ...) since the online
// Gravity Forms fields being mapped here are themselves labeled by member
// NUMBER, so a schema-level "slot2 health" name would leave staff unable to
// tell which online field goes where -- slotK is always household member
// K+1 here since ensureSpouseMember/applyGfEntryToAppForm both guarantee
// primary+spouse occupy #1/#2 before any dependent slot exists. Primary and
// Spouse are named after their own fixed, always-named identity slot instead
// ("Primary member health"/"Spouse health") rather than "#1"/"#2", since
// neither one has a "name" field of its own the way a numbered dependent's
// category implicitly does -- there's nothing else to call that slot.
function healthGroupLabel(scope) {
  if (scope === "primary") return "Primary member health";
  if (scope === "spouse") return "Spouse health";
  const m = /^slot(\d+)$/.exec(scope);
  return m ? `Member #${Number(m[1]) + 1} health` : "Health";
}

// A member scope's health rows, ready to push into buildNaturalAppFieldRows'
// flat row list -- id format ("member:<scope>.health....") matches every
// other member-scoped row exactly, so buildAppFieldRows/isFieldRemoved/
// isFieldRequired/resolveAppFormTarget all handle them with no special-casing.
function healthFieldRows(scope) {
  const label = healthGroupLabel(scope);
  return HEALTH_FIELD_DEFS.map((f) => ({ id: `member:${scope}.${f.key}`, label: `${label} → ${f.label}` }));
}

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
  const healthMatch = /^(.+)-health$/.exec(scope);
  if (healthMatch) return healthGroupLabel(healthMatch[1]);
  // A legacy bare "slotN" scope (from before identity/health merged into one
  // section for a dependent -- see newFieldScopeOptions) reports the SAME
  // label as "slotN-health" now, since that's the only section it shows in.
  const m = /^slot(\d+)$/.exec(scope);
  if (m) return healthGroupLabel(scope);
  return "New field";
}

// A "<scope>-health" custom field scope (see newFieldScopeOptions) still
// stores into that member's own regular extraFields bag, same as a plain
// "<scope>"-scoped one -- "-health" only changes which SECTION it's
// categorized/displayed under (see rowBelongsToScope/buildManageFieldSections),
// there's no separate storage bag for "this member's health-categorized
// custom fields" the way Household/Church share one bag but display
// separately. Key collisions across a member's plain vs "-health" custom
// fields can't happen since addManageField/addMappingCustomField already
// enforce key uniqueness across ALL custom fields, not per-scope.
function customFieldTarget(c) {
  const scope = c.scope || "household";
  if (scope === "household" || scope === "church") return `custom:${c.key}`;
  const healthMatch = /^(.+)-health$/.exec(scope);
  return `membercustom:${healthMatch ? healthMatch[1] : scope}.${c.key}`;
}

// Every scope a brand-new custom field can be categorized under, in the
// order the Application tab's own categories appear -- each identity scope
// immediately followed by its health counterpart, so "Primary member health"
// is right there next to "Primary member" rather than buried at the end.
// Shared by the API mapping modal's "add as a new field under: ..." choices
// and Manage Form Fields' add-field scope <select> (see renderer.js), so the
// two screens never drift into offering a different set of scopes.
//
// Primary/Spouse get two separate choices (identity vs health) because
// renderApplicationFormHtml gives them two separate review-tab boxes. A
// dependent slot gets only ONE -- its "Member #N health" box on the review
// tab already holds both identity and health fields together (see
// renderDependentMemberCategoryHtml), so offering a second "Household Member
// N" choice here would just be a place to add a field that could never
// actually match how it renders.
function newFieldScopeOptions(slotCount) {
  const opts = [
    { value: "primary", label: "Primary member" },
    { value: "primary-health", label: healthGroupLabel("primary") },
    { value: "spouse", label: "Spouse" },
    { value: "spouse-health", label: healthGroupLabel("spouse") },
    { value: "household", label: "Household" },
    { value: "church", label: "Church" },
  ];
  for (let slot = 2; slot <= slotCount; slot++) {
    opts.push({ value: `slot${slot}-health`, label: healthGroupLabel(`slot${slot}`) });
  }
  return opts;
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
    if (g.scope === "primary" || g.scope === "spouse") {
      rows.push(...healthFieldRows(g.scope));
      pushCustomsFor(`${g.scope}-health`);
    }
    // Right after Spouse, matching the paper form's own order (Primary,
    // Spouse, Children / Dependents, then Household).
    if (g.scope === "spouse") rows.push({ id: DEPENDENTS_TARGET, label: DEPENDENTS_ROW_LABEL });
  });
  for (let slot = 2; slot <= slotCount; slot++) {
    // Labeled with the SAME group as this slot's health fields below (not
    // "Household Member N") since the two are one merged section/review-tab
    // box for a dependent -- see newFieldScopeOptions above.
    const slotLabel = healthGroupLabel(`slot${slot}`);
    MEMBER_SLOT_FIELDS.forEach((f) => rows.push({ id: `member:slot${slot}.${f.key}`, label: `${slotLabel} → ${f.label}` }));
    pushCustomsFor(`slot${slot}`); // legacy bare-"slotN" custom fields, if any -- see rowBelongsToScope
    rows.push(...healthFieldRows(`slot${slot}`));
    pushCustomsFor(`slot${slot}-health`);
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
// "household." prefix, disambiguated by CHURCH_FIELD_KEYS -- and a member's
// identity fields share their "member:<scope>." prefix with that same
// member's health fields, disambiguated the same way by a "health." check,
// via the virtual "<scope>-health" scope healthFieldRows' rows are meant to
// be pulled out under (see buildManageFieldSections). For a dependent slot
// specifically, "<slot>-health" swallows the WHOLE "member:<slot>." prefix
// (identity included), not just its health rows -- Primary/Spouse keep
// identity and health as two separate scopes/review-tab boxes, but a
// dependent has only one box for both (see newFieldScopeOptions), so there's
// no separate plain "slotN" scope left to split rows into for them.
function rowBelongsToScope(row, scope) {
  if (row.customKey) {
    const customScope = row.customScope || "household";
    if (customScope === scope) return true;
    // A legacy custom field left scoped to bare "slotN" (from before
    // identity/health merged into one section for dependents) still belongs
    // to that slot's merged "-health" section now.
    const slotHealthMatch = /^slot(\d+)-health$/.exec(scope);
    return !!slotHealthMatch && customScope === `slot${slotHealthMatch[1]}`;
  }
  if (scope === "household" || scope === "church") {
    if (!row.id.startsWith("household.")) return false;
    const isChurchField = CHURCH_FIELD_KEYS.has(row.id.slice("household.".length));
    return scope === "church" ? isChurchField : !isChurchField;
  }
  const healthMatch = /^(.+)-health$/.exec(scope);
  if (healthMatch) {
    const baseScope = healthMatch[1];
    if (/^slot\d+$/.test(baseScope)) return row.id.startsWith(`member:${baseScope}.`);
    return row.id.startsWith(`member:${baseScope}.health.`);
  }
  if (row.id.startsWith(`member:${scope}.health.`)) return false;
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
  const scopeSections = [];
  APP_FIELD_FIXED_GROUPS.forEach((g) => {
    scopeSections.push({ group: g.group, scope: g.scope });
    if (g.scope === "primary" || g.scope === "spouse") {
      scopeSections.push({ group: healthGroupLabel(g.scope), scope: `${g.scope}-health` });
    }
  });
  for (let slot = 2; slot <= slotCount; slot++) {
    // One merged section per dependent -- see newFieldScopeOptions/
    // rowBelongsToScope; no separate "Household Member N" identity section.
    scopeSections.push({ group: healthGroupLabel(`slot${slot}`), scope: `slot${slot}-health` });
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
// ever shows a dependent's section if a custom field already put something
// there. Matches "slotN" (a legacy bare-scoped custom field) AND "slotN-health"
// (the normal, merged scope every dependent's custom fields use now -- see
// newFieldScopeOptions) -- missing the latter would make a slot whose ONLY
// custom fields are health-categorized (the common case) invisible here.
function manageFieldsSlotCount(customFields) {
  let max = 1;
  (customFields || []).forEach((c) => {
    const m = /^slot(\d+)(?:-health)?$/.exec(c.scope || "");
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

// ---- Field presentation (matching the online form) ----
// A field connected to an online-form field is shown the way the online form
// asks it -- a Gravity Forms dropdown or radio question becomes a dropdown
// with the online form's own choices, a Date field a date picker, a
// Paragraph field a text box, a Consent/checkbox a checkbox, a List a table
// -- for built-in fields (Gender, Marital status, Medicare, ...) and custom
// ones alike. The online field's type/choices/columns are carried on the
// folder's fieldMapping rows themselves (see gfFieldInfo/enrichFieldMapping,
// refreshed every time the online form's field list is fetched), so the
// Application tab, Manage Form Fields and the generated PDF all read them
// from the one place. A field NOT connected to the online form (a paper-only
// folder, or anything mapped to "ignore") keeps its own built-in
// presentation.
//
// A presentation is { kind, options?, columns?, inputType? } with kind one
// of text, textarea, select, multiselect, checkbox, date, month, number,
// list.

// The online-form facts worth keeping from a flattenGfFields row -- its GF
// type, and its choices (dropdown/radio/multi-select) or columns (List).
function gfFieldInfo(gfField) {
  const info = {};
  if (!gfField) return info;
  if (gfField.gfType) info.gfType = gfField.gfType;
  if (Array.isArray(gfField.choices) && gfField.choices.length) info.choices = gfField.choices;
  if (Array.isArray(gfField.columns) && gfField.columns.length) info.columns = gfField.columns;
  return info;
}

// Copies each online field's current type/choices/columns (from a fresh
// flattenGfFields fetch) onto the matching fieldMapping rows, so a mapping
// saved before this existed -- or a choice list since edited on the online
// form -- stays current without anyone re-mapping by hand. Rows for fields
// the fetch didn't return are left as they were. Returns the new array and
// whether anything changed.
function enrichFieldMapping(fieldMapping, gfFields) {
  const gfById = new Map((gfFields || []).map((f) => [f.gfFieldId, f]));
  let changed = false;
  const result = (fieldMapping || []).map((m) => {
    const gf = gfById.get(m.gfFieldId);
    if (!gf) return m;
    const { gfType, choices, columns, ...rest } = m;
    const next = { ...rest, ...gfFieldInfo(gf) };
    if (JSON.stringify(next) !== JSON.stringify(m)) changed = true;
    return next;
  });
  return { fieldMapping: result, changed };
}

// Gravity Forms field type -> presentation. null for a type with no
// sensible input of its own (html, section, page, ...) or one this app
// doesn't recognize, so the field keeps its built-in presentation.
function presentationFromGfInfo(info) {
  if (!info || !info.gfType) return null;
  const options = (info.choices || []).map((c) => ({ value: c.value, label: c.label }));
  switch (info.gfType) {
    case "select":
    case "radio":
      return options.length ? { kind: "select", options } : null;
    case "multiselect":
      return options.length ? { kind: "multiselect", options } : null;
    case "checkbox":
    case "consent":
      return { kind: "checkbox" };
    case "textarea":
    case "post_content":
      return { kind: "textarea" };
    case "date":
      return { kind: "date" };
    case "number":
      return { kind: "number" };
    case "list":
      return { kind: "list", columns: info.columns || [] };
    case "email":
      return { kind: "text", inputType: "email" };
    case "phone":
      return { kind: "text", inputType: "tel" };
    case "website":
      return { kind: "text", inputType: "url" };
    case "text":
    case "name":
    case "address":
    case "hidden":
    case "time":
      return { kind: "text" };
    default:
      return null;
  }
}

// target -> presentation for one fieldMapping array, built once per array
// (the Application tab asks for dozens of targets per render, against a
// mapping that can run past a thousand rows). The first online field
// connected to a target with a recognizable type wins.
const gfPresentationCache = new WeakMap();
function gfPresentationForTarget(fieldMapping, target) {
  if (!target || !Array.isArray(fieldMapping)) return null;
  let byTarget = gfPresentationCache.get(fieldMapping);
  if (!byTarget) {
    byTarget = new Map();
    fieldMapping.forEach((m) => {
      if (!m.target || m.target === "ignore" || byTarget.has(m.target)) return;
      const p = presentationFromGfInfo(m);
      if (p) byTarget.set(m.target, p);
    });
    gfPresentationCache.set(fieldMapping, byTarget);
  }
  return byTarget.get(target) || null;
}

// The live folder's mapping, for the renderer's own calls above (main.js
// and the PDF pass theirs in explicitly).
function currentFieldMapping() {
  return (typeof state !== "undefined" && state.apiConfig && state.apiConfig.fieldMapping) || [];
}

// How a field is actually shown: the online form's presentation when it's
// connected to one, else `builtin`. Two built-in kinds are kept regardless:
// a checkbox (every built-in checkbox -- "Has this", "No past medical
// history", ... -- drives what else is shown or hidden, which a dropdown of
// the online form's wording couldn't), and a textarea connected to a
// single-line online text field (a length difference, not a different kind
// of question -- medications lists still need the room).
function resolvePresentation(target, builtin, fieldMapping) {
  const gf = gfPresentationForTarget(fieldMapping, target);
  if (!gf) return builtin;
  if (builtin.kind === "checkbox") return builtin;
  if (builtin.kind === "textarea" && gf.kind === "text") return builtin;
  return gf;
}

// A custom field's built-in presentation (when it isn't connected to the
// online form): its type as set in Manage Form Fields, or a List for an
// untyped field that's nonetheless holding an array (an import from before
// types existed), so that never falls back to "[object Object]".
function customFieldBuiltinPresentation(def, value) {
  const type = effectiveCustomFieldType(def, value);
  if (type === "list") return { kind: "list", columns: (def && def.columns) || [] };
  if (type === "checkbox") return { kind: "checkbox" };
  return { kind: "text" };
}

// A custom field's presentation -- the online form's, when connected, wins
// outright (unlike resolvePresentation's built-in-checkbox rule, a custom
// field's own type has no behavior tied to it).
function customFieldPresentation(def, value, fieldMapping) {
  return gfPresentationForTarget(fieldMapping, customFieldTarget(def)) || customFieldBuiltinPresentation(def, value);
}

// A custom field's type as far as rendering is concerned -- its declared
// type, or "list" for an untyped field that's nonetheless holding an array
// (an import from before types existed), so that never falls back to a
// text box showing "[object Object]".
function effectiveCustomFieldType(def, value) {
  if (def && (def.type === "checkbox" || def.type === "list")) return def.type;
  return Array.isArray(value) ? "list" : "text";
}

// A List field's columns: the definition's own, else whatever keys its rows
// actually carry (first-seen order).
function listFieldColumns(def, rows) {
  if (def && Array.isArray(def.columns) && def.columns.length) return def.columns;
  const cols = [];
  (Array.isArray(rows) ? rows : []).forEach((r) => {
    if (r && typeof r === "object") Object.keys(r).forEach((k) => cols.includes(k) || cols.push(k));
  });
  return cols;
}

// ---- Children / Dependents list -> household members ----

// Which member field each dependents-list column fills, matched by the
// column's own label. Order matters: "Last 4 Digits of SSN" has to hit the
// SSN rule before the plain "last" (-> last name) one can claim it.
const DEPENDENT_COLUMN_RULES = [
  { key: "ssnLast4", re: /ssn|social/i },
  { key: "dob", re: /birth|dob/i },
  { key: "initial", re: /middle|initial/i },
  { key: "firstName", re: /first/i },
  { key: "lastName", re: /last/i },
  { key: "gender", re: /gender|sex/i },
];

// True for a List field (a flattenGfFields row) that's evidently the
// household's dependents -- it has both a first-name and a last-name
// column -- so the mapping screen can connect it to DEPENDENTS_TARGET by
// default.
function looksLikeDependentsList(gfField) {
  if (!gfField || gfField.gfType !== "list" || !Array.isArray(gfField.columns)) return false;
  return gfField.columns.some((c) => /first/i.test(c)) && gfField.columns.some((c) => /last/i.test(c) && !/ssn|digit/i.test(c));
}

// The three "No ___" flags on each member's questionnaire (No past medical
// history / surgical history / medications), which the online form may ask
// either as a checkbox of that same name or as a Yes/No question named for
// the history itself ("Past Medical History: No"). Those two read opposite
// ways -- "No" to "Past Medical History" means there IS no history -- so an
// answer is interpreted against how its question is worded: a Yes/No answer
// to a question starting with "No" means what it says, anything else is
// flipped; a checkbox's own text (or any other non-blank answer) means
// checked.
const NO_HISTORY_FLAG_KEYS = ["noPastMedicalHistory", "noPastSurgicalHistory", "noMedications"];
function interpretNoFlagAnswer(value, questionLabel) {
  if (value === true || value === false) return value;
  const s = String(value ?? "").trim();
  if (!s) return false;
  const askedNegatively = /^\s*no\b/i.test(questionLabel || "");
  if (/^(yes|true|1)$/i.test(s)) return askedNegatively;
  if (/^(no|false|0)$/i.test(s)) return !askedNegatively;
  return true;
}

// "03/04/2015" / "3/4/15" -> "2015-03-04", the only format a date <input>
// (see renderMemberFieldsHtml's DOB field) will display. Anything already
// ISO, or not recognizably a date, passes through unchanged.
function normalizeDateToIso(raw) {
  const s = String(raw || "").trim();
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (!m) return s;
  let year = Number(m[3]);
  if (m[3].length === 2) year += year > (new Date().getFullYear() % 100) ? 1900 : 2000;
  return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

// Turns each row of a dependents List field into a household member.
// The online form collects a dependent twice -- once in this list
// (name/DOB/SSN/gender) and again, by name only, in their own Health History
// Questionnaire slot (member:slotN.firstName/lastName) -- so a row whose
// name matches a member already created from one of those slots fills in
// that member's blank fields instead of adding a duplicate person. Never
// overwrites a value that's already there. A row with no name, DOB, or SSN
// is skipped: the online list always submits at least one row, with its
// Gender dropdown's default already chosen, even when nothing was entered.
function mergeDependentRows(appForm, rows) {
  if (!Array.isArray(rows)) return 0;
  const norm = (s) => String(s || "").trim().toLowerCase();
  let merged = 0;
  rows.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const values = {};
    Object.entries(row).forEach(([col, raw]) => {
      const rule = DEPENDENT_COLUMN_RULES.find((r) => r.re.test(col));
      if (rule && values[rule.key] === undefined) values[rule.key] = String(raw ?? "").trim();
    });
    if (!values.firstName && !values.lastName && !values.dob && !values.ssnLast4) return;
    if (values.dob) values.dob = normalizeDateToIso(values.dob);
    if (values.gender) {
      const opt = matchChoiceOption(GENDER_OPTIONS, values.gender);
      if (opt) values.gender = opt.value;
    }
    let member = appForm.householdMembers.find(
      (m) =>
        m.role !== "primary" &&
        m.role !== "spouse" &&
        values.firstName &&
        norm(m.firstName) === norm(values.firstName) &&
        (!m.lastName || !values.lastName || norm(m.lastName) === norm(values.lastName))
    );
    if (!member) {
      member = makeBlankHouseholdMember("child");
      appForm.householdMembers.push(member);
    }
    Object.entries(values).forEach(([key, v]) => {
      if (v && !member[key]) member[key] = v;
    });
    merged++;
  });
  return merged;
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
    // A checkbox counts as filled only when checked, and a List field only
    // once some row has something in it -- String(false) is "false" and
    // String([{}]) is "[object Object]", both non-blank.
    if (v === false) missing++;
    else if (Array.isArray(v)) {
      if (!v.some((row) => row && Object.values(row).some((cell) => String(cell ?? "").trim()))) missing++;
    } else if (v === undefined || v === null || !String(v).trim()) missing++;
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
      <input class="bm-input" id="${id}" type="${type}" ${opts.inputMode ? `inputmode="${opts.inputMode}"` : ""} data-field="${field}" ${memberId ? `data-member="${memberId}"` : ""} data-kind="text" value="${escapeHtml(String(value))}" />
    </div>`;
}

function appTextareaField(form, memberId, field, label, opts = {}) {
  const value = getAppFieldValue(form, memberId, field) ?? "";
  const id = appFieldId(memberId, field);
  return `
    <div class="bm-field${opts.wide ? " bm-appform-wide" : ""}">
      <label class="bm-field-label" for="${id}">${label}${opts.required ? " *" : ""}</label>
      <textarea class="bm-input bm-appform-textarea" id="${id}" data-field="${field}" ${memberId ? `data-member="${memberId}"` : ""} data-kind="text">${escapeHtml(value)}</textarea>
    </div>`;
}

// The option a stored value selects: an exact value match, else the same
// tolerant match the PDF uses (see matchChoiceOption) -- so "Male" from an
// older import still shows under a "male" option, and a paper entry's
// "male" under the online form's "Male". A value matching no option at all
// is kept as an extra option of its own rather than silently shown blank.
function appSelectField(form, memberId, field, label, options, opts = {}) {
  const raw = getAppFieldValue(form, memberId, field) ?? "";
  const value = String(raw);
  const id = appFieldId(memberId, field);
  const kind = opts.kind || "discrete";
  const chosen = options.find((o) => String(o.value) === value) || matchChoiceOption(options, value);
  const extra = value && !chosen ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>` : "";
  return `
    <div class="bm-field${opts.wide ? " bm-appform-wide" : ""}">
      <label class="bm-field-label" for="${id}">${label}${opts.required ? " *" : ""}</label>
      <select class="bm-select" id="${id}" data-field="${field}" ${memberId ? `data-member="${memberId}"` : ""} data-kind="${kind}">
        <option value=""></option>
        ${options.map((o) => `<option value="${escapeHtml(String(o.value))}" ${chosen === o ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
        ${extra}
      </select>
    </div>`;
}

// A Gravity Forms multi-select answer -- arrives as a JSON-encoded array
// string ('["A","B"]'), or is already an array once edited here.
function multiSelectValues(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  const s = String(raw ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

// A multi-select as a group of checkboxes (one per choice), stored as an
// array of the chosen values -- see the data-kind="multi" wiring.
function appMultiSelectField(form, memberId, field, label, options, opts = {}) {
  const selected = multiSelectValues(getAppFieldValue(form, memberId, field));
  const id = appFieldId(memberId, field);
  const known = new Set(options.map((o) => String(o.value)));
  const all = [...options, ...selected.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))];
  return `
    <div class="bm-field${opts.wide ? " bm-appform-wide" : ""}">
      <div class="bm-field-label">${label}${opts.required ? " *" : ""}</div>
      <div class="bm-appform-checkbox-row" id="${id}" data-multi-field="${field}" ${memberId ? `data-member="${memberId}"` : ""}>
        ${all
          .map(
            (o, i) => `<label class="bm-checkbox-label"><input type="checkbox" id="${id}-${i}" data-multi-option="${escapeHtml(String(o.value))}" ${selected.includes(String(o.value)) ? "checked" : ""} /> ${escapeHtml(o.label)}</label>`
          )
          .join("")}
      </div>
    </div>`;
}

// One field in whichever presentation it resolves to (see
// resolvePresentation/customFieldPresentation). `label` is plain text;
// `opts` carries required/wide/kind through to the builder. A date/month
// input can only show an ISO value, so a stored value in any other format
// (e.g. a paper entry typed as "11/2026") falls back to a plain text box
// rather than being displayed blank.
function appPresentedField(form, memberId, field, label, presentation, opts = {}) {
  const p = presentation || { kind: "text" };
  const safeLabel = escapeHtml(label);
  const value = getAppFieldValue(form, memberId, field);
  const str = value === undefined || value === null ? "" : String(value);
  switch (p.kind) {
    case "select":
      return appSelectField(form, memberId, field, safeLabel, p.options || [], opts);
    case "multiselect":
      return appMultiSelectField(form, memberId, field, safeLabel, p.options || [], opts);
    case "checkbox":
      return `<div class="bm-field${opts.wide ? " bm-appform-wide" : ""} bm-appform-custom-checkbox">${appCheckboxField(form, memberId, field, `${safeLabel}${opts.required ? " *" : ""}`, { kind: opts.kind })}</div>`;
    case "textarea":
      return appTextareaField(form, memberId, field, safeLabel, { ...opts, wide: true });
    case "list":
      return appListField(form, memberId, field, label, { columns: p.columns });
    case "date":
      return appTextField(form, memberId, field, safeLabel, { ...opts, type: !str || /^\d{4}-\d{2}-\d{2}$/.test(str) ? "date" : "text" });
    case "month":
      return appTextField(form, memberId, field, safeLabel, { ...opts, type: !str || /^\d{4}-\d{2}$/.test(str) ? "month" : "text" });
    case "number":
      // Deliberately not type="number": the online form's number answers
      // can carry formatting ("$4,800"), which a number input would show
      // as blank.
      return appTextField(form, memberId, field, safeLabel, { ...opts, inputMode: "decimal" });
    default:
      return appTextField(form, memberId, field, safeLabel, { ...opts, type: p.inputType || "text" });
  }
}

// A built-in field, shown per the online form when it's connected to one.
// `target` is its mapping target ("member:primary.gender",
// "household.incomeTier", ...), or null for a member not in the mapping
// catalog (see memberFieldScope) -- which always keeps `builtin`.
function appMappedField(form, memberId, field, label, target, builtin, opts = {}) {
  const presentation = target ? resolvePresentation(target, builtin, currentFieldMapping()) : builtin;
  return appPresentedField(form, memberId, field, label, presentation, opts);
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

// A List custom field as an editable table -- one row per list entry, one
// column per list column. Cells aren't dot-path data-field inputs like every
// other field here (a column name can itself contain a "."), so they carry
// their own data-list-* attributes instead and get their own wiring in
// wireApplicationForm. `field` is the dot-path to the array itself (e.g.
// "extraFields.list").
function appListField(form, memberId, field, label, def) {
  const rows = getAppFieldValue(form, memberId, field);
  const list = Array.isArray(rows) ? rows : [];
  const columns = listFieldColumns(def, list);
  const memberAttr = memberId ? `data-member="${memberId}"` : "";
  const idBase = appFieldId(memberId, field);
  const body = list
    .map(
      (row, r) => `
        <tr>
          ${columns
            .map(
              (col, c) =>
                `<td><input class="bm-input" id="${idBase}-r${r}-c${c}" type="text" data-list-field="${field}" ${memberAttr} data-row="${r}" data-col="${escapeHtml(col)}" aria-label="${escapeHtml(col)}" value="${escapeHtml(String((row && row[col]) ?? ""))}" /></td>`
            )
            .join("")}
          <td class="bm-appform-list-actions"><button class="bm-btn bm-btn-ghost bm-btn-sm" data-action="remove-list-row" data-list-field="${field}" ${memberAttr} data-row="${r}" title="Remove this row">${ICONS.x}</button></td>
        </tr>`
    )
    .join("");
  return `
    <div class="bm-field bm-appform-wide">
      <div class="bm-field-label">${escapeHtml(label)}</div>
      ${
        columns.length
          ? `<div class="bm-appform-list-wrap">
              <table class="bm-appform-list">
                <thead><tr>${columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}<th></th></tr></thead>
                <tbody>${body || `<tr><td class="bm-appform-list-empty" colspan="${columns.length + 1}">No entries</td></tr>`}</tbody>
              </table>
            </div>
            <button class="bm-btn bm-btn-ghost bm-btn-sm" data-action="add-list-row" data-list-field="${field}" ${memberAttr} data-columns="${escapeHtml(JSON.stringify(columns))}">${ICONS.plus} Add row</button>`
          : `<div class="bm-rail-empty">No entries</div>`
      }
    </div>`;
}

// One custom field (a .form-schema.json customFields entry), rendered per
// its presentation (the online form's when connected, else its own type --
// see customFieldPresentation) -- shared by the per-member and household/
// church renderers below so a field looks the same wherever it's scoped.
function appCustomFieldHtml(form, memberId, def) {
  const field = `extraFields.${def.key}`;
  const presentation = customFieldPresentation(def, getAppFieldValue(form, memberId, field), currentFieldMapping());
  const required = isFieldRequired(customFieldTarget(def));
  return appPresentedField(form, memberId, field, def.label, presentation, { wide: true, required });
}

// ---- Rendering ----

// `scope` (from memberFieldScope, null for a hand-added child never tied to
// an import slot) is whether this member participates in the removed/
// required catalog at all -- see healthRemoved below and the identical
// bypass renderMemberFieldsHtml already applies to identity fields for the
// same kind of member.
function renderConditionCategoryHtml(cat, member, file, scope) {
  const catState = member.health.conditions[cat.key];
  const anyPresent = cat.conditions.some((c) => catState[c.key].present) || (catState.other && catState.other.trim());
  const expandKey = `${file.path}:${member.id}:${cat.key}`;
  const open = anyPresent || expandedHealthCategories.has(expandKey);
  const healthRemoved = (key) => !!scope && isFieldRemoved(`member:${scope}.${key}`);
  const rows = cat.conditions
    .map((c) => {
      const presentField = `health.conditions.${cat.key}.${c.key}.present`;
      const expenseField = `health.conditions.${cat.key}.${c.key}.expense5k`;
      const presentRemoved = healthRemoved(presentField);
      const expenseRemoved = healthRemoved(expenseField);
      if (presentRemoved && expenseRemoved) return "";
      const presentId = appFieldId(member.id, presentField);
      const expenseId = appFieldId(member.id, expenseField);
      const present = catState[c.key].present;
      return `
              <div class="bm-appform-condition-row">
                <span class="bm-appform-condition-label">${c.label}</span>
                ${presentRemoved ? "" : `<label class="bm-checkbox-label"><input type="checkbox" id="${presentId}" data-field="${presentField}" data-member="${member.id}" data-kind="discrete" data-toggles-expense="${expenseId}" ${present ? "checked" : ""} /> Has this</label>`}
                ${expenseRemoved ? "" : `<label class="bm-checkbox-label"><input type="checkbox" id="${expenseId}" data-field="${expenseField}" data-member="${member.id}" data-kind="discrete" ${catState[c.key].expense5k ? "checked" : ""} ${present ? "" : "disabled"} /> $5,000+/yr</label>`}
              </div>`;
    })
    .join("");
  const otherField = `health.conditions.${cat.key}.other`;
  const otherHtml = healthRemoved(otherField)
    ? ""
    : `<div class="bm-field">
          <label class="bm-field-label" for="${appFieldId(member.id, otherField)}">Other</label>
          <input class="bm-input" id="${appFieldId(member.id, otherField)}" type="text" data-field="${otherField}" data-member="${member.id}" data-kind="text" value="${escapeHtml(catState.other)}" />
        </div>`;
  return `
    <details class="bm-appform-category" data-expand-key="${expandKey}" ${open ? "open" : ""}>
      <summary>${cat.label}${anyPresent ? " •" : ""}</summary>
      <div class="bm-appform-conditions">
        ${rows}
        ${otherHtml}
      </div>
    </details>`;
}

function renderHealthQuestionnaireHtml(member, file) {
  const form = file.appForm;
  const health = member.health;
  const scope = memberFieldScope(member);
  const healthRemoved = (key) => !!scope && isFieldRemoved(`member:${scope}.${key}`);
  // Shown per the online form where connected -- see appMappedField.
  const mapped = (key, label, builtin) =>
    appMappedField(form, member.id, key, label, scope ? `member:${scope}.${key}` : null, builtin, { required: !!scope && isFieldRequired(`member:${scope}.${key}`) });
  return `
    <div class="bm-appform-health">
      <div class="bm-section-label">Health history</div>
      <div class="bm-appform-grid">
        ${healthRemoved("health.height") ? "" : mapped("health.height", "Height", { kind: "text" })}
        ${healthRemoved("health.weight") ? "" : mapped("health.weight", "Weight", { kind: "text" })}
        ${healthRemoved("health.tobaccoUse") ? "" : mapped("health.tobaccoUse", "Vaping or tobacco use?", { kind: "select", options: YES_NO_OPTIONS })}
      </div>
      ${
        healthRemoved("health.noPastMedicalHistory")
          ? ""
          : `<div class="bm-appform-checkbox-row">
              ${appCheckboxField(form, member.id, "health.noPastMedicalHistory", "No past medical history", { kind: "structural" })}
            </div>`
      }
      ${
        health.noPastMedicalHistory
          ? ""
          : `<div class="bm-appform-categories">
              ${CONDITION_CATEGORIES.map((cat) => renderConditionCategoryHtml(cat, member, file, scope)).join("")}
            </div>`
      }
      ${
        healthRemoved("health.noPastSurgicalHistory")
          ? ""
          : `<div class="bm-appform-checkbox-row">
              ${appCheckboxField(form, member.id, "health.noPastSurgicalHistory", "No past surgical history", { kind: "structural" })}
            </div>`
      }
      ${health.noPastSurgicalHistory || healthRemoved("health.pastSurgicalHistoryText") ? "" : mapped("health.pastSurgicalHistoryText", "Past surgeries", { kind: "textarea" })}
      ${
        healthRemoved("health.noMedications")
          ? ""
          : `<div class="bm-appform-checkbox-row">
              ${appCheckboxField(form, member.id, "health.noMedications", "No current medications", { kind: "structural" })}
            </div>`
      }
      ${health.noMedications || healthRemoved("health.currentMedicationsText") ? "" : mapped("health.currentMedicationsText", "Current medications (dose & frequency)", { kind: "textarea" })}
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
  // Each shown per the online form where connected (e.g. Marital status as
  // the online form's dropdown rather than a text box) -- see
  // appMappedField. A member outside the mapping catalog (scope null)
  // always keeps the built-in presentation.
  const mapped = (key, label, builtin) =>
    appMappedField(form, member.id, key, label, scope ? `member:${scope}.${key}` : null, builtin, { required: !!scope && isFieldRequired(`member:${scope}.${key}`) });
  const TEXT = { kind: "text" };
  const FIELD_RENDERERS = {
    firstName: () => mapped("firstName", "First name", TEXT),
    initial: () => mapped("initial", "MI", TEXT),
    lastName: () => mapped("lastName", "Last name", TEXT),
    dob: () => mapped("dob", "DOB", { kind: "date" }),
    ssnLast4: () => mapped("ssnLast4", "Last 4 of SSN", TEXT),
    gender: () => mapped("gender", "Gender", { kind: "select", options: GENDER_OPTIONS }),
    ssExempt: () => mapped("ssExempt", "Social Security exempt?", { kind: "select", options: YES_NO_OPTIONS }),
    maritalStatus: () => mapped("maritalStatus", "Marital status", TEXT),
    medicarePart: () => mapped("medicarePart", "Medicare", { kind: "select", options: MEDICARE_OPTIONS }),
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
        return def ? appCustomFieldHtml(form, member.id, def) : "";
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
  // Each shown per the online form where connected -- see appMappedField.
  const mapped = (key, label, builtin, opts = {}) =>
    appMappedField(form, null, `household.${key}`, label, `household.${key}`, builtin, { ...opts, required: isFieldRequired(`household.${key}`) });
  const TEXT = { kind: "text" };
  const FIELD_RENDERERS = {
    address: () => mapped("address", "Address", TEXT, { wide: true }),
    city: () => mapped("city", "City", TEXT),
    state: () => mapped("state", "State", TEXT),
    zip: () => mapped("zip", "ZIP", TEXT),
    phone: () => mapped("phone", "Phone", TEXT),
    emailOrFax: () => mapped("emailOrFax", "Email/Fax", TEXT),
    incomeTier: () => mapped("incomeTier", "Household income tier", { kind: "select", options: INCOME_TIERS }, { wide: true }),
    seventyPercentApplying: () => mapped("seventyPercentApplying", "70%+ of church applying?", { kind: "select", options: YES_NO_OPTIONS }),
    effectiveStartDate: () => mapped("effectiveStartDate", "Effective start date", { kind: "month" }),
    previousPlanName: () => mapped("previousPlanName", "Previous medical aid plan (if any)", TEXT),
    previousPlanAnnualCost: () => mapped("previousPlanAnnualCost", "Previous plan annual cost", { kind: "number" }),
    churchName: () => mapped("churchName", "Church name", TEXT, { wide: true }),
    churchContactName: () => mapped("churchContactName", "Church contact", TEXT),
    churchContactPhone: () => mapped("churchContactPhone", "Church contact phone", TEXT),
    churchContactEmailOrFax: () => mapped("churchContactEmailOrFax", "Church contact email/fax", TEXT),
    churchContactAddress: () => mapped("churchContactAddress", "Church contact address", TEXT, { wide: true }),
    churchContactCity: () => mapped("churchContactCity", "Church contact city", TEXT),
    churchContactState: () => mapped("churchContactState", "Church contact state", TEXT),
    churchContactZip: () => mapped("churchContactZip", "Church contact ZIP", TEXT),
  };
  const customFieldDefs = (typeof state !== "undefined" && state.customFieldDefs) || [];
  const slotCount = manageFieldsSlotCount(customFieldDefs);
  const order = currentAppFieldOrder();
  return orderedScopeRows(scope, slotCount, customFieldDefs, order)
    .map((row) => {
      if (row.customKey) {
        const def = customFieldDefs.find((c) => c.key === row.customKey && (c.scope || "household") === scope);
        return def ? appCustomFieldHtml(form, null, def) : "";
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

  // List-field cells (see appListField) -- same debounced-save/undo-on-blur
  // behavior as a plain text field above, just writing into one row/column
  // of the list's array instead of a dot-path.
  const listRows = (el) => {
    const rows = getAppFieldValue(form, el.dataset.member, el.dataset.listField);
    if (Array.isArray(rows)) return rows;
    const fresh = [];
    setAppFieldValue(form, el.dataset.member, el.dataset.listField, fresh);
    return fresh;
  };
  panel.querySelectorAll("input[data-list-field]").forEach((input) => {
    const snapKey = `${input.dataset.listField}:${input.dataset.member || ""}:${input.dataset.row}:${input.dataset.col}`;
    input.addEventListener("focus", () => {
      appFormFieldSnapshot[snapKey] = JSON.stringify(form);
    });
    input.addEventListener("input", () => {
      const rows = listRows(input);
      const r = Number(input.dataset.row);
      if (!rows[r] || typeof rows[r] !== "object") rows[r] = {};
      rows[r][input.dataset.col] = input.value;
      scheduleAppFormSave(file);
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

  panel.querySelectorAll('[data-action="add-list-row"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const rows = listRows(btn);
      let columns = [];
      try {
        columns = JSON.parse(btn.dataset.columns || "[]");
      } catch {}
      const row = {};
      columns.forEach((col) => (row[col] = ""));
      rows.push(row);
      saveAppForm(file);
      render();
    });
  });

  panel.querySelectorAll('[data-action="remove-list-row"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const before = JSON.stringify(form);
      listRows(btn).splice(Number(btn.dataset.row), 1);
      saveAppForm(file);
      pushUndo("Remove list row", () => {
        file.appForm = JSON.parse(before);
        return saveAppForm(file);
      });
      render();
    });
  });

  // Multi-select checkbox groups (see appMultiSelectField) -- saved as an
  // array of the checked choices' values, immediately, like a discrete field.
  panel.querySelectorAll("[data-multi-field]").forEach((group) => {
    group.querySelectorAll("input[data-multi-option]").forEach((box) => {
      box.addEventListener("change", () => {
        const values = [...group.querySelectorAll("input[data-multi-option]:checked")].map((b) => b.dataset.multiOption);
        setAppFieldValue(form, group.dataset.member, group.dataset.multiField, values);
        saveAppForm(file);
        patchRequiredBadge(panel, file);
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
    INCOME_TIERS,
    YES_NO_OPTIONS,
    GENDER_OPTIONS,
    MEDICARE_OPTIONS,
    makeBlankHealthRecord,
    makeBlankHouseholdMember,
    makeBlankAppForm,
    APP_FIELD_FIXED_GROUPS,
    MEMBER_SLOT_FIELDS,
    DEFAULT_REQUIRED_FIELDS,
    DEPENDENTS_TARGET,
    customFieldTarget,
    matchChoiceOption,
    gfFieldInfo,
    enrichFieldMapping,
    gfPresentationForTarget,
    presentationFromGfInfo,
    customFieldPresentation,
    NO_HISTORY_FLAG_KEYS,
    interpretNoFlagAnswer,
    CHURCH_FIELD_KEYS,
    multiSelectValues,
    effectiveCustomFieldType,
    listFieldColumns,
    mergeDependentRows,
    normalizeDateToIso,
  };
}
