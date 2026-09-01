# ROA Rule Engine

Prototype rule engine that calculates commissions. Build order: **Attributes**
→ **Rules** (both now implemented), with conditions built *inside* Rules on
top of the Attribute catalog (not a separate phase before it). This file
captures decisions so sessions don't re-derive them.

## Stack

HTML, CSS, JavaScript, React (buildless — CDN + in-browser Babel, no npm
install). **Now has a minimal local server** (`server.js`, zero
dependencies, plain Node `http`/`fs`) — this reverses the earlier "no
backend" decision. Why: the Attribute catalog was in `localStorage`, which
is scoped per-browser — opening the app in a different browser (or
profile, or incognito) showed an empty catalog even though it's the same
file on disk. Client-side-only storage can't survive that; a `file://`
page also can't write to disk itself (no server-write API in a browser).
The server exists to persist JSON-array catalogs to disk — now two of
them: `attributes-data.json` via `/api/attributes`, and (deliberately, a
second instance of the same pattern — see `RESOURCES` in `server.js`)
`rules-data.json` via `/api/rules`. Both are the same generic GET/PUT
handler over a data file; it is still not a general backend/API layer, and
nothing else should be added without a similarly deliberate decision.
**Restart the server after pulling `server.js` changes** — Node doesn't
hot-reload, so a running instance keeps serving with the old route table
until restarted (hit this exact issue getting `/api/rules` live).

**Run with `node server.js` (or `npm start`), then open
`http://localhost:5050`** — double-clicking `index.html` directly no longer
persists (the page's `fetch()` calls fail with no server to answer them;
loading falls back to an empty catalog, and saving shows an alert telling
the user to start the server).

(An earlier, unrelated Node.js/Express/TypeScript backend prototype was
explored and abandoned before this one; ignore it if referenced anywhere in
history — it's a different thing from `server.js`.)

## Status

Earlier conditions-builder scaffold (`catalog.js` + `conditions.js`) was
deleted intentionally to restart clean — build order is now Attributes
first, standalone. No git repo (prototype only, deletions aren't recoverable
via version control).

Current files: `index.html` + `style.css` + `attributes.js` + `rules.js` +
`server.js` + `package.json`. JSX still compiles in-browser via Babel CDN
(no build step) — only the persistence layer needs the server now, not
React/Babel itself. `index.html` is a two-tab single-page app (`App` holds
a `tab` state of `'attributes' | 'rules'`); `AttributesScreen` is the
former `App` body unchanged, `RulesScreen` is new — see "Domain model —
Rules" below for what it builds.

**Path-based routing, no router library.** `/attributes` and `/rules` are
real URL paths (`App`'s tab state initializes from
`window.location.pathname` via `tabFromLocation()`; switching tabs calls
`window.history.pushState()`, and a `popstate` listener handles back/
forward). This is why a refresh on either tab now stays put instead of
resetting to Attributes. Requires a **matching server-side fallback** —
`server.js`'s `APP_ROUTES` (`/`, `/attributes`, `/rules`) — because the
browser can request either path directly (refresh, typed URL, bookmark)
and the server must answer with `index.html` instead of 404ing (the
standard SPA-fallback pattern), while still 404ing genuinely missing
assets. Kept as an explicit small route list rather than a catch-all
specifically so that distinction holds.

**Important — app JSX must stay inlined in `index.html`, not a separate
`app.js`.** Babel Standalone fetches `<script type="text/babel" src="...">`
via XHR to get the raw source to transpile, and Chrome blocks that XHR
under `file://` (CORS) — an external app script leaves the page silently
blank when opened by double-click. `attributes.js` is fine as a separate
file because it's a plain (non-Babel) `<script src>`, loaded natively by
the browser, not fetched via XHR. Hit this exact bug once already — don't
reintroduce a `src`-loaded Babel script. (This still matters even though
double-click-to-open no longer persists data — the app should still at
least *render* if someone opens it that way.)

Implements the **Attribute catalog management screen**: create/edit/delete
Attributes (Label, Key, Type, Value label, Resolver path, and — for `enum`
only — Allowed values source). Operators and Value widget are derived
read-only from Type, never entered directly. Catalog persists to a JSON
file on disk (`attributes-data.json`) via `server.js`'s `/api/attributes`
endpoint — see Stack section above for why this replaced localStorage.
`loadAttributes()`/`saveAttributes()` in `attributes.js` are now async
(fetch-based); `App`'s `persist()` in `index.html` updates state optimistically
and rolls back with an alert if the server call fails.

`enum` static allowed values are stored as **plain strings** (label ==
value) for now — confirmed as good enough for the prototype; revisit before
assuming a separate `{label, value}` pair shape anywhere downstream.

**Resolver field is suggestion-assisted free text, not a strict dropdown.**
(See the resolver-root paragraph below for the root/field split — this note
is about the field half specifically.) Uses an HTML `<datalist>`, scoped per
selected root (`attributes.js`: `RESOLVER_FIELD_SUGGESTIONS_BY_ROOT`), so
options appear while typing, but any value can still be typed — there's no
fixed schema yet to validate against. Kept **deliberately minimal** per
root (2-3 examples each) — an earlier attempt hardcoded ~30 suggestions
deep-derived from roa-backend + the Economic Model spec, but the user
called that out as inaccurate/presumptuous about a schema this app hasn't
actually defined. Expand later once real schemas exist, not by mining
adjacent systems again.

**Contexts field removed for now.** The domain model below still describes
`contexts` (optional, filters which transaction types an Attribute applies
to) as part of the target Attribute shape, but it's not implemented in the
UI or `buildAttribute()` currently — deferred until this app has real
transaction types to filter against, rather than free-text guesses.

**Table reference (`table_ref`) is back, designed properly this time.**
Enum Attributes now offer a real choice: **Category** (the existing static
values list) or **Reference** (`table_ref` — values come from a live,
growing dataset instead of a hardcoded list, e.g. "every Team" or "every
Agent"). Shape: `{ type: 'table_ref', table: 'teams' | 'agents', valueField:
'id', labelField: 'name' }`. Only two tables for now — the only real
entities this app knows about — with a **fixed** value/label field
convention (`id`/`name`), not user-configurable, since there's no real
backing dataset yet to validate arbitrary field names against.
`attributes.js`: `TABLE_REF_TABLES`, `TABLE_REF_TABLE_KEYS`.

**Rule "scope" collapses into ordinary conditions — no separate `scope`
field on Rules.** The real Economic Model spec gives every rule a `scope`
(global/plan/overlay/team/agent) as a structural attachment point, resolved
before condition evaluation. This app **deliberately simplifies that away**:
every rule is effectively global, and plan/overlay/team/agent narrowing is
expressed as ordinary Attribute conditions instead (one mechanism, not two).
This is *why* `table_ref` needed designing now — team/agent-scoped rules
become conditions on `team`/`agent` Attributes, which need a live reference
to actual team/agent instances, not a small static enum.

**Resolver root is now `transaction` | `agent` | `team` — peers, not
nested.** Previously agent-derived facts were modeled as
`transaction.agent.X` (nested). Corrected to a flat peer convention
(`agent.X`, `team.X`, `transaction.X`) because the real evaluation contract
(`calculate(facts, progress_snapshot, ..., policy_binding)`) receives
transaction facts and agent/team enrollment data as **separate inputs** —
nesting agent under transaction didn't match that. The Attribute form now
has a root `<select>` (Transaction/Agent/Team) + a field text input
(`attributes.js`: `RESOLVER_ROOTS`, `RESOLVER_ROOT_LABELS`,
`RESOLVER_FIELD_SUGGESTIONS_BY_ROOT`, `splitResolverPath()` for
edit-time round-tripping) instead of one free-text path. Stored shape is
still a single `resolver.path` string (e.g. `"agent.plan"`) — the UI
splits/joins it, no data-shape change beyond the convention itself.
Corrected the 6 Attributes that used the old nested convention
(`cap_position`, `plan`, `personal_allowance`, `milestone`,
`primary_license_state`, `personal_deals_this_year`) to the new root/field
path. Also added two new `table_ref` example Attributes: `team` (`team.id`,
references `teams`) and `agent` (`agent.id`, references `agents`) —
concrete proof this all works together.

**Version history was cleared once, deliberately** — all 21 Attributes
were reset to a fresh `version: 1` in one pass (the resolver-path migration
above and two enum-value fixes below were folded into that same reset,
rather than left as visible history entries). This was a one-time seed-data
cleanup, not a new standing behavior — edits made through the UI from here
on still version normally (see below).

**Two enum value gaps fixed:** `plan` was missing `marketing_collective`
(the spec has 5 plans: Standard, Half Cap, Domestic Team, LFRO, Marketing
Collective) and `program` was missing `mentorship` (a real overlay per the
spec, just not a `source` value) — both flagged earlier, now corrected.

**Editing an Attribute creates a new version — it never mutates the
previous one in place.** Confirmed choice, mirroring the Economic Model
spec's own policy-object philosophy ("a change is a new version, never an
edit"). Every version ever saved lives flat in `attributes-data.json`,
keyed by `id` + `version` (`attributes.js`: `currentAttributes()`,
`versionsForId()`, `nextVersionNumber()`) — the catalog table only shows
each id's latest version; a "History" button per row expands a read-only
table of all past versions for that id. Kept deliberately minimal per the
confirmed scope: version number + `updatedAt` timestamp only (no author/
change-note field — no user accounts exist yet to attribute an edit to).
**Delete is NOT versioned** — it removes every version of that id outright;
only edits are versioned. Creating a new Attribute always starts at
version 1.

Rules phase is now implemented too — see "Domain model — Rules" below for
what's built and Open items for what's genuinely still missing (evaluation,
`kind`/`applies`/`split`, conflict resolution, a real Tracker catalog).

## Terminology

Use **Attribute**, never "Dimension" — Dimension is OLAP/BI terminology and
doesn't fit this domain.

## Domain model — Attributes & conditions (conditions live inside Rules)

### Attribute (catalog entry)

- `type`: `number` | `enum` | `date` | `boolean`
- `operators`: allowed operator set, driven by `type` (see below) — never
  show an operator that doesn't apply to the attribute's type
- `valueWidget`: input the UI renders for this attribute (number input,
  single/multi select, date picker)
- `valueLabel`: per-attribute label for the value field (e.g. "Count", not a
  generic "Value")
- `resolver`: how to pull this attribute's value — `{ kind: 'path', path:
  '...' }`, a dot-path rooted at one of three **peers**: `transaction` |
  `agent` | `team` (not nested — see Status above for why). `computed`
  (derived via a function) and `external` (lookup from another service) are
  out of scope unless a specific rule needs one.
- `allowedValuesSource` (enum types only): `static` list (small, closed,
  rarely-changing categories) or `table_ref` to a live dataset (`teams` |
  `agents` — instance/PK-level values that grow over time, e.g. every Team).
  See Status above for the exact shape. **Enum values only, never free
  text** — hard rule for the whole catalog either way.
- `contexts` (optional, **not yet implemented** — see Status above): which
  transaction types the attribute applies to; omitted = all contexts. Same
  field doubles as the "dynamic catalog" filter (e.g. only show relevant
  attributes for a given transaction type).

### Operators by type

- number: `eq neq gt lt gte lte between in not_in is_empty is_not_empty`
- enum: `eq neq in not_in is_empty is_not_empty`
- date: `eq gt lt gte lte between in is_empty is_not_empty`
- boolean: `eq` only

### Condition value shape

Shape follows the **operator**, not just the attribute type:

- `single` — eq, neq, gt, lt, gte, lte
- `list` — in, not_in
- `range` — between (min/max)
- `none` — is_empty, is_not_empty

### Condition combination

**Resolved: nested AND/OR groups**, not flat-AND-only — decided when the
Rules phase started, since Rules is where conditions actually get combined
in this app (they don't live at the Attribute-catalog level at all). See
"Domain model — Rules" below for the `ConditionGroup` shape and the
implementation.

### Empty state

Zero conditions = matches everything ("Every transaction — no
conditions"), not an error or incomplete state. Carry this convention into
rules too.

## Domain model — Rules (implemented)

The real Economic Model spec gives every rule a `scope`
(global/plan/overlay/team/agent) — a structural attachment point resolved
*before* condition evaluation, separate from the rule's `when` conditions.

**This app collapses scope into conditions.** Every Rule here is
effectively global; plan/overlay/team/agent narrowing is just an ordinary
condition on the `plan`/`program`/`team`/`agent` Attributes (one mechanism
— Attribute + operator + value — instead of two). This is why `table_ref`
needed a proper design earlier: team/agent-scoped rules become conditions
against live `team`/`agent` instances, not a small static enum.

### Rule (catalog entry)

`{ id, label, conditions: ConditionGroup, amount: AmountExpression, payee,
version, updatedAt }`. Same versioning approach as Attributes (fresh v1,
edits append a new version, delete removes all versions) — `rules.js`:
`currentRules()`, `ruleVersionsForId()`, `nextRuleVersionNumber()`
(duplicated from `attributes.js`'s equivalents rather than shared, to keep
the two scripts independent).

### Conditions — nested AND/OR (resolved; this app does NOT stay flat-AND-only)

Unlike the flat `Condition[]` used elsewhere in this app's own Attribute-
condition docs below, a Rule's conditions are a **tree**:
```
ConditionGroup: { kind: 'group', op: 'AND' | 'OR', children: (ConditionGroup | Condition)[] }
Condition:      { kind: 'condition', attributeId, operator, value }
```
`value`'s shape still follows the operator (single/list/range/none, see
"Condition value shape" below) — that part didn't change. An empty root
group (`{op:'AND', children:[]}`) matches every transaction — same empty-
state convention as Attributes. `rules.js`: `emptyConditionGroup()`,
`emptyCondition()`, `conditionValueShape()`. UI: `ConditionGroupEditor`
(recursive, +Condition/+Group buttons, AND/OR radio per group) +
`ConditionRow` + `ConditionValueInput` (attribute-and-operator-aware — for
`in`/`not_in` on a `static` enum it renders toggle-chips of the allowed
values; for everything else in list-shape, or a `table_ref` enum with no
real backing list, it falls back to free-text chips).

### Amount — all 7 forms from the spec (resolved; full richness, not the minimal flat-$-or-% option)

```
{ form: 'flat', cents }
{ form: 'rate', pct, baseAttributeId }              // baseAttributeId must be a number Attribute
{ form: 'max' | 'min', a: AmountExpression, b: AmountExpression }   // recursive
{ form: 'ladder', tracker, rateType: 'percent'|'flat', baseAttributeId, rows: [{ upTo: cents|null, value }] }
{ form: 'capped_by', amount: AmountExpression, tracker }
{ form: 'from_facts', attributeId }
```
Deliberate simplifications vs. the spec: percentages are plain numbers (15
means 15%), not integer-hundredths-of-a-percent; `ladder`'s `baseAttributeId`
is only required/used when `rateType: 'percent'` (a flat-tier ladder, like
the real capped-fee rule, needs no base — it's just a dollar amount per
tier). Money is integer **cents** internally either way (matching the
spec's "money is always integer cents"); the UI (`dollarsToCents()`/
`centsToDollars()` in `rules.js`) takes dollar-formatted input and converts.
`payee` is just `'roa' | 'agent'` — the spec's richer Party/`economic_role`/
`balance_role` machinery is not modeled.

**Trackers are hardcoded names, not a real catalog** (`rules.js`:
`TRACKER_OPTIONS` — `cap_accumulation`, `tech_fee_bucket`,
`post_cap_bucket`, `production`, `deal_counts_graduation`,
`deal_counts_personal`, matching the spec's six cards). `ladder`/
`capped_by` just reference a tracker by name for the UI/data shape — there
is no live tracker balance behind them. Building a real Tracker catalog
(its own CRUD, versioning, live per-owner balances — the spec's genuinely
separate "Progress" layer) was explicitly out of scope for "implement
Rules with what we have till now"; revisit if/when Trackers become their
own catalog, the same way Attributes did.

Seed examples in `rules-data.json` (both pass `validateRule()`): `risk_fee`
(flat $50, AND of three `neq` conditions — demonstrates the simple path)
and `company_dollar_standard` (a `ladder` on `cap_accumulation`, `rateType:
percent`, base `gci` — demonstrates the richer path and is the concrete
answer to the plan-ladder-duplication tension discussed earlier: one Rule
per plan variant, condition `plan == standard`, each with its own
target/ladder — not one shared rule with a scope attachment).

### Still not decided

The rest of the real Rule field schema not covered above: `kind`
(create/adjust/produce/mark), `applies`/`split` (how a rule fires and
divides among people on a shared side), conflict groups/ranks (what
happens when two Rules could both match the same transaction — nothing
in this app resolves that yet, every matching Rule just independently
fires). See Open items.

## UI reference

Condition builder is attribute-driven: selecting an Attribute determines
the Test (operator) dropdown options and the Value input widget — not fixed
per row. Reference screenshot showed: Attribute dropdown (labeled
"Dimension" there — rename to "Attribute"), a Test/operator dropdown, and a
value field with a per-attribute label (e.g. "Count"), plus Add/Cancel
actions.

## Open items

- Rule `kind` (create/adjust/produce/mark), `applies`/`split` (how a rule
  fires and divides among people on a shared side), conflict groups/ranks
  (what happens when two Rules both match one transaction — currently every
  matching Rule just fires independently, no resolution) — not decided
- A real Tracker catalog (currently `rules.js`'s `TRACKER_OPTIONS` is a
  hardcoded name list with no live balances behind it) — not started
- Actually evaluating a Rule set against a transaction (the calculation
  pipeline itself) — not started; what exists is authoring/storage only
