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

// --- Contributes — which tracker (if any) a Rule's own payment posts to --
//
// Separate, general, RULE-level field — independent of amount form. Until
// now, a tracker only ever showed up as a side effect of `ladder`/
// `capped_by` needing one to compute the amount (reads a tier/headroom).
// That's a computation input, not a declaration of effect — a rule using
// `flat`/`rate`/`max`/`min`/`from_facts` had no way to say "I still affect
// tracker X" even though it might (or, just as validly, might not — this
// is optional, most rules contribute to nothing). Matches the real spec's
// `contributes` field, kept separate from `reads_tracker`/the ladder's own
// tracker for the same reason: reading and posting are different concerns
// that happen to coincide for this app's current rules, but shouldn't be
// conflated into one field going forward.
const CONTRIBUTES_TO_TRACKER_OPTIONS = ['none', ...TRACKER_OPTIONS];
const CONTRIBUTES_TO_TRACKER_LABELS = { none: 'None', ...TRACKER_LABELS };

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

// --- Applies / Split — how a Rule fires and divides among participants --
//
// The Economic Model spec's `applies` field, all four values (see
// economic-model-rule-definition memory) — this is the "firing subject":
// how many times a Rule fires and whose facts/trackers each firing reads.
// Two genuinely different mechanisms, easy to conflate (a mistake made
// once already this session — see CLAUDE.md/memory once written up):
//
//   - per_transaction / per_side: the Rule's amount is computed ONCE (for
//     the whole deal, or once per side), then that ONE result is optionally
//     divided among people who share it — that's what `split` is for.
//     Real spec example: Risk Fee is per-side ($50/side), and split by-side-%
//     divides one side's $50 among its own co-agents if there's more than
//     one (e.g. a 70/30 team side -> $35/$15). `split` is only meaningful
//     for these two `applies` values.
//   - per_agent_side / per_distinct_agent: the Rule's ENTIRE amount formula
//     runs independently, once per firing — there is no shared total to
//     divide, because there was never one number to begin with. Each
//     firing resolves its own agent-scoped base (e.g. `agent_gci_share`),
//     so `split` doesn't apply here at all. The two values differ in what
//     counts as "once": per_agent_side fires once per (agent, side) pair —
//     a dual-agency agent (both sides of one deal) gets TWO independent
//     firings/amounts. per_distinct_agent fires once per PERSON regardless
//     of how many sides they're on — dual agency gets ONE firing. Real
//     spec example: Technology Fee is per-distinct-agent (dual agency pays
//     one installment, not two) — Company Dollar is per-agent-side (each
//     side's own share runs its own ladder).
//
// NOTE: this describes intent only. There is no evaluation engine yet
// (see CLAUDE.md Open items) — nothing actually fires a rule multiple
// times, enumerates a transaction's sides/participants, or reads a split
// Attribute per firing. These fields are stored on the Rule so that intent
// isn't lost, but nothing computes it yet.
const APPLIES_OPTIONS = ['per_transaction', 'per_side', 'per_agent_side', 'per_distinct_agent'];
const APPLIES_LABELS = {
  per_transaction: 'Once per transaction',
  per_side: 'Once per side',
  per_agent_side: 'Once per agent per side (dual agency = 2 firings)',
  per_distinct_agent: 'Once per distinct agent (dual agency = 1 firing)',
};

// Only meaningful when applies is 'per_transaction' or 'per_side' — see
// note above. Ignored/cleared for 'per_agent_side'/'per_distinct_agent'.
const SPLIT_OPTIONS = ['none', 'by_percent_attribute'];
const SPLIT_LABELS = {
  none: 'No split',
  by_percent_attribute: 'Divide by a percentage Attribute',
};

const APPLIES_ALLOWING_SPLIT = ['per_transaction', 'per_side'];

function emptyAmount(form) {
  switch (form) {
    case 'flat':
      // baseAttributeId here isn't a computation input (cents is fixed) —
      // it declares which balance this flat amount deducts from, same
      // field/meaning as rate's/ladder's base. Without it, a flat fee had
      // no way to say what it comes out of (spotted as a real gap this
      // session — payee only says where money goes, never where it's
      // drawn from).
      return { form: 'flat', cents: 0, baseAttributeId: '' };
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
    applies: input.applies,
    split: APPLIES_ALLOWING_SPLIT.includes(input.applies) ? input.split : 'none',
    splitAttributeId: APPLIES_ALLOWING_SPLIT.includes(input.applies) && input.split === 'by_percent_attribute' ? input.splitAttributeId : '',
    contributesToTracker: input.contributesToTracker || 'none',
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
    case 'flat': {
      if (!Number.isFinite(amount.cents)) return 'Enter a flat amount.';
      const deductsFrom = attributesById[amount.baseAttributeId];
      if (!deductsFrom || deductsFrom.type !== 'number') return 'Choose a number Attribute this amount deducts from.';
      return null;
    }
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
      // baseAttributeId is required either way now: for a percent ladder
      // it's the multiplier base, for a flat-tier ladder (dollar amounts
      // per row) it declares what balance those tier amounts deduct from —
      // same dual meaning as the flat amount form (see emptyAmount('flat')).
      const base = attributesById[amount.baseAttributeId];
      if (!base || base.type !== 'number') {
        return amount.rateType === 'percent'
          ? 'Choose a number Attribute as the ladder base.'
          : 'Choose a number Attribute this ladder deducts from.';
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

  if (!APPLIES_OPTIONS.includes(input.applies)) errors.applies = 'Choose how this Rule applies.';

  if (APPLIES_ALLOWING_SPLIT.includes(input.applies)) {
    if (!SPLIT_OPTIONS.includes(input.split)) errors.split = 'Choose a split.';
    if (input.split === 'by_percent_attribute') {
      const splitAttribute = attributesById[input.splitAttributeId];
      if (!splitAttribute || splitAttribute.type !== 'number') errors.splitAttributeId = 'Choose a number Attribute for the split percentage.';
    }
  }

  // Optional — 'none' is always valid. Only reject a value that isn't a
  // real tracker at all.
  if (!CONTRIBUTES_TO_TRACKER_OPTIONS.includes(input.contributesToTracker)) {
    errors.contributesToTracker = 'Choose a tracker, or None.';
  }

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
