// ROA Rule Engine — Attribute catalog: data model, derivation rules, persistence.
// Persisted to a JSON file on disk via the local server (server.js) —
// see CLAUDE.md for why this isn't localStorage.

// Operators allowed per Attribute type. Never show an operator outside this set
// for a given type (see CLAUDE.md "Operators by type").
const OPERATORS_BY_TYPE = {
  number: ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  enum: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  date: ['eq', 'gt', 'lt', 'gte', 'lte', 'between', 'in', 'is_empty', 'is_not_empty'],
  boolean: ['eq'],
};

// Human-readable operator labels (shared with the future condition builder).
const OPERATOR_LABELS = {
  eq: 'is',
  neq: 'is not',
  gt: 'greater than',
  lt: 'less than',
  gte: 'greater than or equal to',
  lte: 'less than or equal to',
  between: 'between',
  in: 'is any of',
  not_in: 'is none of',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
};

// Which value input the UI renders, driven by the Attribute's type.
const VALUE_WIDGET_BY_TYPE = {
  number: 'number_input',
  enum: 'select',
  date: 'date_picker',
  boolean: 'toggle',
};

const VALUE_WIDGET_LABELS = {
  number_input: 'Number input',
  select: 'Select (single/multi decided by operator)',
  date_picker: 'Date picker',
  toggle: 'Boolean toggle',
};

const ATTRIBUTE_TYPES = ['number', 'enum', 'date', 'boolean'];

// Resolver root — WHERE a value is read from. Peers, not nested: the real
// evaluation contract (calculate(facts, progress_snapshot, ..., policy_binding))
// receives transaction facts and agent/team enrollment data as SEPARATE
// inputs, so `agent`/`team` are not sub-paths of `transaction` here either.
// This is also how Rule "scope" (global/plan/overlay/team/agent) collapses
// into ordinary conditions: an agent- or team-rooted Attribute IS the old
// scope, expressed as a condition instead of a separate rule property.
const RESOLVER_ROOTS = ['transaction', 'agent', 'team'];

const RESOLVER_ROOT_LABELS = {
  transaction: 'Transaction',
  agent: 'Agent',
  team: 'Team',
};

// Minimal, deliberately small hardcoded suggestions per root — a few safe,
// generic examples, not a deep dump from project memory (that was tried
// once and was inaccurate/presumptuous about a schema this app hasn't
// actually defined yet). Revisit once real schemas exist. Still accepts
// free text; see the <datalist> in index.html.
const RESOLVER_FIELD_SUGGESTIONS_BY_ROOT = {
  transaction: ['amount', 'type', 'date'],
  agent: ['plan', 'status'],
  team: ['id', 'name'],
};

// Splits a stored resolver path like "agent.plan" back into
// { root: 'agent', field: 'plan' } for editing. Falls back to the
// 'transaction' root for anything not matching a known root (e.g. legacy
// paths), rather than failing — this is display/edit convenience, not
// validation.
function splitResolverPath(path) {
  const str = path || '';
  const dotIndex = str.indexOf('.');
  if (dotIndex === -1) return { root: 'transaction', field: str };
  const root = str.slice(0, dotIndex);
  const field = str.slice(dotIndex + 1);
  return RESOLVER_ROOTS.includes(root) ? { root, field } : { root: 'transaction', field: str };
}

// table_ref — allowed values sourced from another (live, growing) dataset
// instead of a small fixed list, e.g. "every Team" or "every Agent" rather
// than a closed category set like `plan`/`program`. Only two tables for
// now — the only real entities this app knows about — with a fixed
// value/label field convention rather than letting the user configure
// arbitrary field names, since there's no real backing dataset yet to
// validate those against.
const TABLE_REF_TABLES = {
  teams: { label: 'Teams', valueField: 'id', labelField: 'name' },
  agents: { label: 'Agents', valueField: 'id', labelField: 'name' },
};

const TABLE_REF_TABLE_KEYS = Object.keys(TABLE_REF_TABLES);

function slugify(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function operatorsForType(type) {
  return OPERATORS_BY_TYPE[type] || [];
}

function valueWidgetForType(type) {
  return VALUE_WIDGET_BY_TYPE[type] || 'text_input';
}

// Versioning — editing an Attribute creates a new version rather than
// mutating the previous one in place, mirroring the Economic Model spec's
// own policy-object philosophy ("a change is a new version, never an
// edit" — see CLAUDE.md / economic-model-spec-overview memory). The stored
// file is a flat list of every version ever saved, keyed by id + version;
// these helpers derive the "current" (latest-version) view from it.

function currentAttributes(allVersions) {
  const latestById = new Map();
  for (const a of allVersions) {
    const existing = latestById.get(a.id);
    if (!existing || a.version > existing.version) {
      latestById.set(a.id, a);
    }
  }
  return Array.from(latestById.values());
}

function versionsForId(allVersions, id) {
  return allVersions.filter((a) => a.id === id).sort((a, b) => b.version - a.version);
}

function nextVersionNumber(allVersions, id) {
  const versions = versionsForId(allVersions, id);
  return versions.length > 0 ? versions[0].version + 1 : 1;
}

// Build a fresh Attribute object from form input, deriving operators/valueWidget
// from type rather than trusting caller-supplied values for those fields.
function buildAttribute(input) {
  const type = input.type;
  const attribute = {
    id: input.id,
    label: input.label,
    type,
    operators: operatorsForType(type),
    valueWidget: valueWidgetForType(type),
    valueLabel: input.valueLabel || input.label,
    resolver: { kind: 'path', path: `${input.resolverRoot}.${input.resolverField}` },
    allowedValuesSource: null,
  };

  if (type === 'enum') {
    if (input.allowedValuesKind === 'table_ref') {
      const table = TABLE_REF_TABLES[input.tableRefTable] ? input.tableRefTable : TABLE_REF_TABLE_KEYS[0];
      const meta = TABLE_REF_TABLES[table];
      attribute.allowedValuesSource = { type: 'table_ref', table, valueField: meta.valueField, labelField: meta.labelField };
    } else {
      attribute.allowedValuesSource = { type: 'static', values: input.staticValues || [] };
    }
  }

  return attribute;
}

function validateAttribute(input, existingAttributes, editingId) {
  const errors = {};

  if (!input.label || !input.label.trim()) {
    errors.label = 'Label is required.';
  }

  if (!input.id || !input.id.trim()) {
    errors.id = 'Key is required.';
  } else if (!/^[a-z][a-z0-9_]*$/.test(input.id)) {
    errors.id = 'Key must be lowercase letters, numbers, underscores, starting with a letter.';
  } else {
    const clash = existingAttributes.find((a) => a.id === input.id && a.id !== editingId);
    if (clash) errors.id = `Key "${input.id}" is already used by another Attribute.`;
  }

  if (!ATTRIBUTE_TYPES.includes(input.type)) {
    errors.type = 'Select a valid type.';
  }

  if (!RESOLVER_ROOTS.includes(input.resolverRoot)) {
    errors.resolverRoot = 'Choose where this value comes from.';
  }
  if (!input.resolverField || !input.resolverField.trim()) {
    errors.resolverField = 'Field is required (e.g. amount, plan, id).';
  }

  if (input.type === 'enum') {
    if (input.allowedValuesKind === 'table_ref') {
      if (!TABLE_REF_TABLES[input.tableRefTable]) {
        errors.tableRefTable = 'Choose a table.';
      }
    } else if (!input.staticValues || input.staticValues.length === 0) {
      errors.staticValues = 'Add at least one allowed value.';
    }
  }

  return errors;
}

async function loadAttributes() {
  try {
    const res = await fetch('/api/attributes');
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const parsed = await res.json();
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error('Failed to load attribute catalog from the server', e);
    return [];
  }
}

async function saveAttributes(attributes) {
  const res = await fetch('/api/attributes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(attributes),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Server responded ${res.status}`);
  }
}
