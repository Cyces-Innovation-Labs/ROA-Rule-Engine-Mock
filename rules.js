// ROA Rule Engine — Rule catalog: data model, derivation rules, persistence.
// Mirrors attributes.js's structure and versioning approach (see
// CLAUDE.md). Persisted to rules-data.json via server.js's /api/rules
// endpoint — same GET/PUT pattern as /api/attributes.

// --- Conditions: nested AND/OR groups ---------------------------------
//
// Rule "scope" (global/plan/overlay/team/agent in the real spec) collapses
// into ordinary conditions here — see CLAUDE.md "Domain model — Rules".
// A Rule's `conditions` field is always a ConditionGroup; the root group
// with zero children matches every transaction (the empty-state convention
// carried over from Attributes).
//
// ConditionGroup: { kind: 'group', op: 'AND' | 'OR', children: (ConditionGroup | Condition)[] }
// Condition:      { kind: 'condition', attributeId, operator, value }
//   `value` shape follows the operator: single -> primitive, list -> array,
//   range -> {min, max}, none -> undefined (see CLAUDE.md "Condition value shape").

const CONDITION_VALUE_SHAPE_BY_OPERATOR = {
  eq: 'single', neq: 'single', gt: 'single', lt: 'single', gte: 'single', lte: 'single',
  between: 'range',
  in: 'list', not_in: 'list',
  is_empty: 'none', is_not_empty: 'none',
};

function conditionValueShape(operator) {
  return CONDITION_VALUE_SHAPE_BY_OPERATOR[operator] || 'single';
}

function emptyConditionGroup() {
  return { kind: 'group', op: 'AND', children: [] };
}

function emptyCondition() {
  return { kind: 'condition', attributeId: '', operator: '', value: undefined };
}

// --- Amount — the effect a matched Rule produces -----------------------
//
// Modeled on the Economic Model spec's seven amount forms (see
// economic-model-rule-definition memory / CLAUDE.md). Deliberate
// simplifications for this prototype: percentages are plain numbers (15
// means 15%), not the spec's integer-hundredths-of-a-percent storage;
// money is integer CENTS (matching the spec's "money is always integer
// cents" rule), with the UI taking a dollar-formatted input and converting.

const AMOUNT_FORMS = ['flat', 'rate', 'max', 'min', 'ladder', 'capped_by', 'from_facts'];

const AMOUNT_FORM_LABELS = {
  flat: 'Flat amount',
  rate: 'Percentage of an Attribute',
  max: 'Greater of two amounts',
  min: 'Lesser of two amounts',
  ladder: 'Ladder (tiered by a tracker)',
  capped_by: 'Capped by tracker headroom',
  from_facts: 'Directly from an Attribute',
};

// Trackers — hardcoded names, NOT a real catalog. The Economic Model spec
// treats Trackers as their own Progress layer (Cap Accumulation, Tech Fee
// Bucket, etc.), genuinely separate from Attributes (transaction/agent/team
// facts). Building a full Tracker catalog (CRUD, versioning, live
// balances) is out of scope for "implement Rules with what we have till
// now" — these are just selectable labels for `ladder`/`capped_by` to
// reference, with no real balance behind them yet.
const TRACKER_OPTIONS = [
  'cap_accumulation',
  'tech_fee_bucket',
  'post_cap_bucket',
  'production',
  'deal_counts_graduation',
  'deal_counts_personal',
];

const TRACKER_LABELS = {
  cap_accumulation: 'Cap Accumulation',
  tech_fee_bucket: 'Tech Fee Bucket',
  post_cap_bucket: 'Post-Cap Fee Bucket',
  production: 'Production',
  deal_counts_graduation: 'Deal Counts — Graduation',
  deal_counts_personal: 'Deal Counts — Personal',
};

// 'statutory'/'mentor'/'referring_agent'/'external_brokerage' are the same
// flat-label simplification as 'team' — this app has no real Party model
// (see CLAUDE.md), so a rule that in the real spec pays a specific person/
// entity just names the ROLE here, not an actual party record.
const PAYEE_OPTIONS = ['roa', 'agent', 'team', 'statutory', 'mentor', 'referring_agent', 'external_brokerage'];
const PAYEE_LABELS = {
  roa: 'ROA',
  agent: 'Agent',
  team: 'Team Account',
  statutory: 'Statutory (state/government)',
  mentor: 'Assigned Mentor',
  referring_agent: 'Referring Agent (ROA)',
  external_brokerage: 'External Brokerage',
};

function emptyAmount(form) {
  switch (form) {
    case 'flat':
      return { form: 'flat', cents: 0 };
    case 'rate':
      return { form: 'rate', pct: 0, baseAttributeId: '' };
    case 'max':
      return { form: 'max', a: emptyAmount('flat'), b: emptyAmount('flat') };
    case 'min':
      return { form: 'min', a: emptyAmount('flat'), b: emptyAmount('flat') };
    case 'ladder':
      return { form: 'ladder', tracker: TRACKER_OPTIONS[0], rateType: 'percent', baseAttributeId: '', rows: [{ upTo: null, value: 0 }] };
    case 'capped_by':
      return { form: 'capped_by', amount: emptyAmount('flat'), tracker: TRACKER_OPTIONS[0] };
    case 'from_facts':
      return { form: 'from_facts', attributeId: '' };
    default:
      return { form: 'flat', cents: 0 };
  }
}

// --- Branches — ordered (condition, amount) pairs on one Rule -----------
//
// Resolved (this session's design discussion — see CLAUDE.md/memory once
// written up): a Rule's payout is computed by its `branches` list, evaluated
// top-to-bottom, first matching branch wins. This replaces a single
// `amount` field and is how this app expresses "one Rule per fee_type,
// internally variant by scenario" (e.g. Company Dollar's floor differs by
// lease vs sale vs no-floor) WITHOUT the Economic Model spec's separate
// `kind: create/adjust` rules or a formula/branching language inside one
// amount expression — each branch's `when` is an ordinary ConditionGroup,
// each branch's `amount` is an ordinary AmountExpression. The last branch
// should normally have an empty `when` (matches everything) as a catch-all,
// so no transaction silently falls through with no computed amount — the
// UI doesn't enforce this structurally, it's an authoring convention.
//
// `kind` (create/adjust/produce/mark) was deliberately NOT added to this
// schema: every Rule currently needed by this app fires as an independent,
// self-contained line. Cross-rule sequencing/dependency (e.g. a rule that
// needs to run only after another rule's line has been computed) was
// briefly modeled as an `order` field and has been removed again pending
// further discussion — see CLAUDE.md/memory once written up.

function emptyBranch() {
  return { when: emptyConditionGroup(), amount: emptyAmount('flat') };
}

function validateBranches(branches, attributesById) {
  if (!Array.isArray(branches) || branches.length === 0) return 'Add at least one branch.';
  for (const branch of branches) {
    const whenError = validateConditionGroup(branch.when, attributesById);
    if (whenError) return whenError;
    const amountError = validateAmount(branch.amount, attributesById);
    if (amountError) return amountError;
  }
  return null;
}

function dollarsToCents(dollarsStr) {
  const n = parseFloat(dollarsStr);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function centsToDollars(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function buildRule(input) {
  return {
    id: input.id,
    label: input.label,
    waivable: !!input.waivable,
    conditions: input.conditions,
    branches: input.branches,
    payee: input.payee,
  };
}

function validateConditionGroup(group, attributesById) {
  if (!group || group.kind !== 'group') return 'Invalid condition group.';
  for (const child of group.children) {
    const err = child.kind === 'group'
      ? validateConditionGroup(child, attributesById)
      : validateCondition(child, attributesById);
    if (err) return err;
  }
  return null;
}

function validateCondition(condition, attributesById) {
  if (!condition.attributeId || !attributesById[condition.attributeId]) return 'Choose an Attribute for every condition.';
  if (!condition.operator) return 'Choose a Test for every condition.';
  const shape = conditionValueShape(condition.operator);
  if (shape === 'none') return null;
  if (shape === 'range') {
    const v = condition.value || {};
    if (v.min === undefined || v.min === '' || v.max === undefined || v.max === '') return 'Enter both a min and max value.';
    return null;
  }
  if (shape === 'list') {
    if (!Array.isArray(condition.value) || condition.value.length === 0) return 'Add at least one value.';
    return null;
  }
  if (condition.value === undefined || condition.value === '') return 'Enter a value for every condition.';
  return null;
}

function validateAmount(amount, attributesById) {
  if (!amount || !AMOUNT_FORMS.includes(amount.form)) return 'Choose an amount form.';
  switch (amount.form) {
    case 'flat':
      return Number.isFinite(amount.cents) ? null : 'Enter a flat amount.';
    case 'rate': {
      if (!Number.isFinite(amount.pct)) return 'Enter a percentage.';
      const base = attributesById[amount.baseAttributeId];
      if (!base || base.type !== 'number') return 'Choose a number Attribute as the base.';
      return null;
    }
    case 'max':
    case 'min':
      return validateAmount(amount.a, attributesById) || validateAmount(amount.b, attributesById);
    case 'ladder': {
      if (!TRACKER_OPTIONS.includes(amount.tracker)) return 'Choose a tracker.';
      if (!Array.isArray(amount.rows) || amount.rows.length === 0) return 'Add at least one ladder row.';
      if (amount.rateType === 'percent') {
        const base = attributesById[amount.baseAttributeId];
        if (!base || base.type !== 'number') return 'Choose a number Attribute as the ladder base.';
      }
      return null;
    }
    case 'capped_by': {
      if (!TRACKER_OPTIONS.includes(amount.tracker)) return 'Choose a tracker.';
      return validateAmount(amount.amount, attributesById);
    }
    case 'from_facts':
      return (amount.attributeId && attributesById[amount.attributeId]) ? null : 'Choose an Attribute.';
    default:
      return 'Unknown amount form.';
  }
}

function validateRule(input, existingRules, editingId, attributesById) {
  const errors = {};

  if (!input.label || !input.label.trim()) errors.label = 'Label is required.';

  if (!input.id || !input.id.trim()) {
    errors.id = 'Key is required.';
  } else if (!/^[a-z][a-z0-9_]*$/.test(input.id)) {
    errors.id = 'Key must be lowercase letters, numbers, underscores, starting with a letter.';
  } else {
    const clash = existingRules.find((r) => r.id === input.id && r.id !== editingId);
    if (clash) errors.id = `Key "${input.id}" is already used by another Rule.`;
  }

  const conditionsError = validateConditionGroup(input.conditions, attributesById);
  if (conditionsError) errors.conditions = conditionsError;

  const branchesError = validateBranches(input.branches, attributesById);
  if (branchesError) errors.branches = branchesError;

  if (!PAYEE_OPTIONS.includes(input.payee)) errors.payee = 'Choose a payee.';

  return errors;
}

async function loadRules() {
  try {
    const res = await fetch('/api/rules');
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const parsed = await res.json();
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to load rule catalog from the server', e);
    return [];
  }
}

async function saveRules(rules) {
  const res = await fetch('/api/rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rules),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server responded ${res.status}`);
  }
}

// Versioning — identical approach to attributes.js's currentAttributes()/
// versionsForId()/nextVersionNumber() (see CLAUDE.md). Duplicated here
// (small, ~10 lines) rather than shared, to keep rules.js and
// attributes.js independent scripts.
function currentRules(allVersions) {
  const latestById = new Map();
  for (const r of allVersions) {
    const existing = latestById.get(r.id);
    if (!existing || r.version > existing.version) latestById.set(r.id, r);
  }
  return Array.from(latestById.values());
}

function ruleVersionsForId(allVersions, id) {
  return allVersions.filter((r) => r.id === id).sort((a, b) => b.version - a.version);
}

function nextRuleVersionNumber(allVersions, id) {
  const versions = ruleVersionsForId(allVersions, id);
  return versions.length > 0 ? versions[0].version + 1 : 1;
}
