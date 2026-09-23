# ROA Rule Engine

Prototype commission rule engine for ROA. Five tabs, in dependency order:
**Attributes** (typed fact catalog) → **Rules** (conditions + amounts built on
Attributes) → **Transactions** / **Agents** (real fact data; forms are
generated from the Attribute catalog) → **Calculations** (mock engine output).
This file captures decisions so sessions don't re-derive them.

**Full handover detail lives in the project skill
`.claude/skills/roa-rule-engine/`** — engine semantics and worked examples,
the 14-rule catalog, data model, decision history, and open items. Read it
before non-trivial work. Keep this file and the skill in sync when a
decision changes.

## Stack

HTML, CSS, JavaScript, React — buildless (CDN React + in-browser Babel, no
bundler). A minimal zero-dependency Node server (`server.js`, plain
`http`/`fs`) persists JSON-array data files. It exists because the catalog
used to live in `localStorage`, which is per-browser, and a `file://` page
can't write to disk.

`server.js` `RESOURCES` maps four generic GET/PUT endpoints to files:
`/api/attributes` → `attributes-data.json`, `/api/rules` → `rules-data.json`,
`/api/transactions` → `transactions-data.json`, `/api/agents` →
`agents-data.json`. It is not a general API layer; add a resource only
deliberately. `APP_ROUTES` (`/`, `/attributes`, `/rules`, `/transactions`,
`/agents`, `/calculations`) is an explicit SPA fallback list (not a
catch-all, so missing assets still 404).

**Run with `node server.js` (or `npm start`), then open
`http://localhost:5050`.** Restart the server after any `server.js` change
(no hot reload). Static files and data files are read per request — a
browser refresh is enough for those. Double-clicking `index.html` renders
but can't load or save data.

**App JSX must stay inlined in `index.html`, never a `src`-loaded Babel
script** — Babel fetches external JSX via XHR, which Chrome blocks under
`file://`, leaving a blank page. `attributes.js`, `rules.js`, and
`calculation.js` are fine as separate files because they're plain
(non-Babel) scripts; their functions are browser globals (no
`module.exports` — load them in Node with `vm.runInThisContext`).

Adding a persisted resource or tab touches four places: `server.js`
(`RESOURCES`/`APP_ROUTES`), a `netlify/functions/<name>.js`, `netlify.toml`
redirects, and `ROUTE_FOR_TAB`/`TAB_FOR_ROUTE` + nav link in `index.html`.

### Deployment (Netlify)

Live at `https://sunny-muffin-2de3b8.netlify.app`. Netlify has no
long-running process or writable disk, so each `RESOURCES` entry is mirrored
by a Netlify Function (`netlify/functions/attributes.js`, `rules.js`,
`transactions.js`, `agents.js`) sharing one GET/PUT handler
(`netlify/functions/_lib/jsonStore.js`) backed by **Netlify Blobs** instead
of the filesystem. Each Function bundles its `*-data.json` as a seed: an
empty store (fresh deploy) is initialized from it on first GET.
`netlify.toml` rewrites `/api/*` to the Functions and each tab path to
`/index.html`; static files deploy unchanged (`publish = "."`, no build).

`@netlify/blobs` (`^11.0.2`) is the only dependency and is deploy-only;
local dev needs nothing installed. 11.x wants Node ≥22.12 (a non-fatal
engine warning on older local Node) — chosen over 9.x, which carries a
transitive high-severity `image-size` advisory.

Two real-deploy issues, both fixed:

- **Whole site 401 "Login Redirect"** — Netlify's Visitor Access setting.
  Dashboard: Site configuration → General → Visitor access → off.
- **`MissingBlobsEnvironmentError`** — Netlify's automatic Blobs context
  injection doesn't always happen. `resolveStore()` in `jsonStore.js` uses
  explicit config when env vars `BLOBS_SITE_ID` (Site configuration →
  General → Site details) and `BLOBS_TOKEN` (User settings → Applications →
  personal access token) are set, scoped to Functions; redeploy after
  setting them. Custom names avoid Netlify's reserved `NETLIFY_*` vars.

See README.md's "Deploying to Netlify" for commands.

## Terminology

Use **Attribute**, never "Dimension".

## Core decisions

- **Money is plain dollars** everywhere (real payload fields like
  `commission_amount`, `overall_gci` are dollars). The flat amount field is
  still *named* `cents` but holds dollars; `dollarsToCents`/`centsToDollars`
  in `rules.js` are pass-throughs. Percentages are plain numbers (15 = 15%).
- **Attributes and Rules are versioned**: an edit appends a new version (flat
  list keyed by `id` + `version`; `currentAttributes()`/`currentRules()` take
  the latest). Delete removes every version. Transactions and Agents are not
  versioned.
- **Resolver roots are peers**: `transaction.X`, `agent.X`, `team.X`,
  `commission_split.X`. `agent` = the agent's own profile/enrollment facts;
  `commission_split` = facts about one `commission_splits[]` entry on a
  transaction (side, amount, side percentage, is_referral). Records are keyed
  by the resolver **field name**, not the Attribute id.
- **Enum values only, never free text** for enum Attributes. Static values
  are plain strings (label == value); `table_ref` points at `teams`/`agents`
  with fixed `id`/`name` fields. Resolver field suggestions stay deliberately
  minimal — don't mine roa-backend or the spec for schemas.
- **Rule scope collapses into conditions** — no `scope` field; plan/team/
  agent narrowing is an ordinary condition.
- **Rules**: nested AND/OR `conditions` gate, then ordered `branches`
  (`{when, amount}`, first match wins, end with an empty-`when` catch-all),
  7 amount forms (`flat`, `rate`, `max`, `min`, `ladder`, `capped_by`,
  `from_facts`), `payee` role label, `applies`
  (`per_transaction | per_side | per_agent_side | per_distinct_agent`),
  `split` (`none | by_percent_attribute | divide_by_percent_attribute`),
  `waivable`, `contributesToTracker`.
- **Missing data is explicit `null`**, and in the engine **null fails every
  operator except `is_empty`/`is_not_empty`** (including `neq`/`not_in`).
  Fill data gaps with the enum's real "normal" value rather than changing
  engine semantics.
- **Trackers are hardcoded names** (`TRACKER_OPTIONS`), not a catalog. A
  Trackers tab was built and reverted on purpose — don't rebuild it unasked.
  `ladder` reads tracker progress from the agent field of the same name;
  `capped_by` uses explicit `progressAttributeId` + `target`.
- **Mock calculation** (`calculation.js`, `runMockCalculation`) stores
  results on the transaction's `calculationResults`. Referral splits are not
  excluded by the engine; rules exclude them via conditions. Split semantics
  are subtle — see the skill's `references/engine.md` before changing them.

## Open items

- Real Tracker catalog with live balances, targets per plan, resets.
- Conflict resolution between rules; rule `kind`; the spec's 12-stage
  pipeline (e.g. `portion` is a static input, not marked by a rule).
- Company Dollar models only Standard and Half Cap (LFRO, Domestic Team,
  Marketing Collective deferred); WA workers' comp rate is a $0 placeholder.
- No team data; unverified SkySlope fields (`deal_subtype`, `program`,
  `decision`, `direction`, `sale_commission_percent` spelling).
- `side_percentage` Attribute note is stale — data and engine treat it as
  per side (sums to 100% within a side).
- Attribute `contexts` (filter by transaction type) deferred.
