---
name: roa-rule-engine
description: Full handover knowledge for the ROA Rule Engine Mock prototype (this repo) — a buildless React app for authoring commission Attributes/Rules and running a mock calculation against real SkySlope-style transactions. Use for ANY work in this repo: adding/editing Attributes or Rules, changing calculation.js, touching sample transactions/agents data, the Transactions/Agents/Calculations tabs, server.js or Netlify deploy, or answering "why is it built this way" / "why did this rule (not) fire" questions. Also use when discussing ROA commission rules (Company Dollar, Tech Fee, Risk Fee, Capped-Status Fee, applies/split semantics) in the context of this prototype.
---

# ROA Rule Engine Mock — handover

Prototype commission rule engine for ROA (Realty of America). Repo:
`Cyces-Innovation-Labs/ROA-Rule-Engine-Mock`. Live: `https://sunny-muffin-2de3b8.netlify.app`.

Five tabs: **Attributes** (typed fact catalog) → **Rules** (conditions + amounts
built on Attributes) → **Transactions** / **Agents** (real fact data, forms
generated from the Attribute catalog) → **Calculations** (mock engine output).

> `CLAUDE.md` holds the short version of these decisions; this skill holds
> the detail. If they ever disagree, **trust the code**, then fix whichever
> doc is wrong.

## Run it

```bash
node server.js        # or npm start → http://localhost:5050
```

- **Restart the server after any `server.js` change** — no hot reload. Static
  files (`index.html`, `*.js`, `*.json` data) are read fresh per request, so
  those need no restart, only a browser refresh.
- If you edit a `*-data.json` file directly (outside the UI), an already-open
  page holds stale React state — refresh it.
- Quick headless check of the engine (no browser needed):
  ```bash
  node -e "const fs=require('fs'),vm=require('vm');for(const f of ['attributes.js','rules.js','calculation.js'])vm.runInThisContext(fs.readFileSync(f,'utf8'));const a=currentAttributes(JSON.parse(fs.readFileSync('attributes-data.json','utf8')));const r=runMockCalculation({transaction:JSON.parse(fs.readFileSync('transactions-data.json','utf8'))[0],agents:JSON.parse(fs.readFileSync('agents-data.json','utf8')),rules:JSON.parse(fs.readFileSync('rules-data.json','utf8')),attributesById:Object.fromEntries(a.map(x=>[x.id,x]))});console.log(JSON.stringify(r,null,1))"
  ```
  The `.js` files are plain browser globals (no `module.exports`) — load them
  with `vm.runInThisContext`, not `require`. `validateRule()` returns an
  **errors object** (`{}` = valid), not a string/null.

## File map

| File | Role |
|---|---|
| `index.html` | Whole React app, JSX **inlined** (never move to `src="app.js"` — Babel's XHR fetch breaks under `file://`). All screens: `AttributesScreen`, `RulesScreen`, `TransactionsScreen`, `AgentsScreen`, `CalculationsScreen`, shared `ActionsMenu` (⋮), `AttributeSelect`, `AttributeValueInput`, `CalculationResultsPanel`. Routing via `ROUTE_FOR_TAB`/`TAB_FOR_ROUTE` + History API; tab nav is real `<a href>`. |
| `attributes.js` | Attribute types, operators-by-type, resolver roots, versioning helpers, load/save. |
| `rules.js` | Rule schema: condition groups, 7 amount forms, `APPLIES_*`, `SPLIT_*`, `PAYEE_*`, `TRACKER_OPTIONS`, `validateRule`, versioning helpers. |
| `calculation.js` | Mock engine: `runMockCalculation({transaction, agents, rules, attributesById})`. See `references/engine.md`. |
| `server.js` | Zero-dep Node server. `RESOURCES` = GET/PUT JSON-array endpoints (`/api/attributes`, `/rules`, `/transactions`, `/agents`); `APP_ROUTES` = SPA fallback list. |
| `*-data.json` | The data. Attributes/Rules are **versioned** (flat list of every version); Transactions/Agents are **not**. |
| `netlify/functions/*.js` + `_lib/jsonStore.js` | Netlify mirror of `RESOURCES` using Netlify Blobs; each seeds from its `*-data.json` on first GET. |
| `netlify.toml` | `/api/*` → Functions, tab paths → `/index.html`. |

**Adding a new persisted resource/tab = 4 places:** `server.js` `RESOURCES`
(+ `APP_ROUTES` for a tab path), a `netlify/functions/<name>.js`, two
`netlify.toml` redirects, and `ROUTE_FOR_TAB`/`TAB_FOR_ROUTE` + nav link in
`index.html`. Forgetting the Netlify side silently 404s in production (this
happened once — Transactions/Agents shipped without Functions).

## Core conventions (decided — don't re-litigate without the user)

- Say **Attribute**, never "Dimension".
- **Money is plain dollars** everywhere. The amount field is still *named*
  `cents` (rename avoided) but holds dollars; `dollarsToCents`/`centsToDollars`
  are pass-throughs. Real payload fields (`commission_amount`, `overall_gci`)
  are dollars, so everything compared against them must be too.
- **Percentages are plain numbers** (15 = 15%).
- **Editing an Attribute or Rule appends a new version**; never mutate in
  place. Delete removes all versions. When scripting data changes, push a new
  version object with `version+1` and a fresh `updatedAt`.
- **Resolver roots are peers**: `transaction.X`, `agent.X`, `team.X`,
  `commission_split.X`. `agent` = the agent's own profile/enrollment facts
  (plan, cap position, tracker progress); `commission_split` = facts about one
  `commission_splits[]` entry on this transaction (side, amount, percentage,
  is_referral). Conflating these was corrected once — keep them separate.
- Data records are keyed by the resolver **field name**, not the Attribute
  id (e.g. Attribute `tech_fee_progress` → agent field `tech_fee_bucket`). Use
  `fieldFromPath(attr.resolver.path)`.
- Missing data is explicit `null` ("None"), never a guessed default.
- **Null fails every operator except `is_empty`/`is_not_empty`** — including
  `neq`/`not_in`. So a rule with `portion neq pass_through` will NOT fire while
  `portion` is null. Fill data gaps with the enum's real "normal" value
  (e.g. `portion: "standard"`, `deal_subtype: "none"`,
  `personal_allowance: "not_active"`) rather than changing engine semantics.
- Rule **scope** (plan/team/agent) is just ordinary conditions — no `scope` field.
- Rule payout = ordered `branches` (`{when, amount}`), first match wins; the
  last branch should be an empty-`when` catch-all (Company Dollar's `$0` B4
  exists because capped agents otherwise errored with "no branch matched").
- Trackers are **hardcoded names** (`TRACKER_OPTIONS`), not a catalog. A full
  Trackers tab (definitions + per-agent balances, resets) was built and
  **reverted** on purpose — "we will clearly implement later". Don't rebuild
  it unasked.

## How the user likes to work

- Flag genuine structural gaps and ask, rather than guessing a design. Use
  multiple-choice questions for real forks (the user answers quickly).
- Don't invent schemas by mining adjacent systems (roa-backend, spec) —
  keep suggestion lists minimal until real schemas exist.
- Explain *why* a rule did/didn't fire in terms of the actual data values.
- Verify changes: `node --check` the JS, re-run `validateRule` across all
  latest rules, run the engine headlessly, then check the page.
- Commit/push only when asked; commit messages explain the why.

## Deeper references (read as needed)

- `references/engine.md` — calculation semantics: applies, per-bearer
  filtering, the three split mechanics, ladder/capped_by, worked examples.
  **Read before touching `calculation.js` or any rule's applies/split.**
- `references/rule-catalog.md` — the 14 rules, what each does, and where
  they deliberately deviate from the Economic Model spec.
- `references/data-model.md` — Attribute catalog, sample transactions/
  agents, known data gaps and unverified SkySlope fields.
- `references/history-and-open-items.md` — decision log, things tried and
  reverted, and the open backlog.
