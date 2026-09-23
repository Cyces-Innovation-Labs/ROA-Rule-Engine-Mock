# Decision history and open items

Chronological, so you know what was already tried. Dates are 2026.

## Timeline

- **Early Sep** — Attribute catalog first, then Rules. localStorage → tiny
  Node server (`server.js`) because localStorage didn't survive across
  browsers. Netlify deploy via Functions + Blobs (401 "Login Redirect" was
  Netlify Visitor Access; `MissingBlobsEnvironmentError` fixed with
  `BLOBS_SITE_ID`/`BLOBS_TOKEN` env vars — see CLAUDE.md Deployment).
- Rule schema grew: nested AND/OR conditions → 7 amount forms → `branches`
  (replaced a single `amount` and a briefly-modeled `kind`/`order`) →
  `applies`/`split`/`contributesToTracker`/`waivable`, and more payee roles.
- **~Sep 9–10** — "Clean everything": catalog wiped and rebuilt against a
  real SkySlope payload; added `commission_split` root and `text` type.
  All 14 rules built one by one from the spec's catalog, flagging gaps.
- Bugs fixed along the way:
  - **Cents vs dollars**: payload is dollars → all money became dollars.
  - `per_agent_side` was missing from `APPLIES_ALLOWING_SPLIT`, silently
    hiding and wiping Risk Fee's split on edit.
  - Agent seed data keyed by Attribute id instead of field name → values
    showed "None".
  - 0-byte data files after a manual wipe crashed `require()` in Netlify
    Functions — empty catalogs must be `[]`.
- Tech Fee: first a simple `tech_fee_progress lt 750` gate, then `capped_by`
  gained `progressAttributeId` + `target` so a $700-progress agent pays $50,
  not $250.
- **Trackers tab** (definitions + balances, resets on anniversary) was
  scoped, built, and then **reverted** by the user: "we will clearly
  implement later". Real design needs target-by-plan, Domestic Team owner
  exceptions, career vs anniversary periods.
- **Mock calculation** built (`calculation.js`), results stored on the
  transaction, new Calculations tab + per-row Run button. User decisions:
  results in a dedicated tab; null fails conditions; iterate
  `commission_splits`.
- Corrections after first run: referral splits are *not* excluded; filled
  null sample fields; Company Dollar got a `$0` catch-all branch; results
  auto-expand after running.
- Netlify Functions for transactions/agents added (had been missed).
- **~Sep 15–16** (commit `7bfd046`) — split mechanics reworked: Risk Fee to
  per_side with independent per-split scaling; Capped-Status Fee per-agent
  ceiling divided across own sides; `divide_by_percent_attribute` added;
  per-bearer condition filtering; three more sample transactions/agents;
  NV/GA states, "Personal Referral" source, listing/sale commission percent.
- Commit `ee8dffa` — layout overflow fix (tables scroll, `.app` 1400px), ⋮
  `ActionsMenu` per row, "?" help for Applies with dollar examples, tab nav
  as real links.
- **Sep 23** — handover: this skill written from the session knowledge and
  current code; CLAUDE.md rewritten to match the code.

## Open items / not decided

- **Trackers as a real catalog** with live per-agent balances, targets per
  plan, resets, and rules posting to them (`contributesToTracker` currently
  does nothing).
- **Conflict resolution** between rules matching the same transaction
  (spec has conflict groups/ranks); rule `kind` (create/adjust/produce/mark).
- **Real evaluation pipeline** (spec's 12 stages: produce/mark before
  financial rules, pass-through marking of `portion`, rounding, corrections).
  Today `portion` is a static input, not something a rule marks.
- **Plans not modeled** in Company Dollar: LFRO, Domestic Team, Marketing
  Collective.
- **WA workers' comp** rate is a $0 placeholder.
- **Team root**: no team data/records; `table_ref` tables have no backing list.
- **Unverified SkySlope fields** (see data-model.md) and the stale
  `side_percentage` note.
- `contexts` on Attributes (filter by transaction type) deferred.
