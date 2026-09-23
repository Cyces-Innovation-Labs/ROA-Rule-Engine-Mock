# Mock calculation engine (`calculation.js`)

Entry point: `runMockCalculation({ transaction, agents, rules, attributesById })`
→ `{ calculatedAt, lineItems[], totalsByPayee, grandTotal, skipped[], errors[] }`.
Result is stored on the transaction as `calculationResults` and shown in the
Transactions tab (auto-expands after "Run Mock Calculation") and the
Calculations tab. `attributesById` must be built from `currentAttributes()`
(latest versions); the engine itself calls `currentRules(rules)`.

It is a MOCK: no conflict/rank resolution (every matching rule fires
independently), no rounding-remainder distribution, no tracker updates
(`contributesToTracker` is metadata only), `waivable` is metadata only,
`team` root always resolves to null.

## Per rule, per firing

1. `buildFirings(rule)` — enumerates firings from `rule.applies` over
   `transaction.commission_splits` (agents linked by `split.guid` ↔ `agent.guid`/`id`).
2. Gate on `rule.conditions`.
3. First matching branch → `rawAmount` via `evaluateAmount`.
4. Apply `rule.split` → one or more line items.

Outcomes: fired → `lineItems`; gate failed for every firing → `skipped`
(silent, normal); matched but no branch / amount null / split fact null →
`errors` (visible, means a rule or data gap).

## `applies` (firing subject)

| applies | Firings | ctx |
|---|---|---|
| `per_transaction` | 1 | all splits, no single agent/split |
| `per_side` | 1 per distinct `side` value | that side's splits |
| `per_agent_side` | 1 per split (dual agency = 2) | that split + its agent |
| `per_distinct_agent` | 1 per distinct guid (dual agency = 1) | that agent + their own splits |

**`is_referral` splits are NOT excluded by the engine.** (An early version
excluded them; the user corrected it: "referral split is different" but still
gets fees.) Rules that should skip referral splits say so in their own
conditions — e.g. Risk Fee has `is_referral eq false`.

## Per-bearer condition filtering

For `per_transaction`, `per_side`, and `per_distinct_agent`, the gate is
evaluated **once per split, against that split's own agent + split** (the
spec: "a condition that varies by participant evaluates per bearer"). Splits
that fail are dropped from the group; the rest continue. If none pass, the
firing doesn't happen. Without this, an agent-rooted condition on a
per_transaction rule (e.g. Personal-Deal Fee's `personal_deal_count lt 2`)
could never be true, and a boolean split fact under per_distinct_agent
(`is_referral eq false`) would resolve to null for dual-agency agents.
`per_agent_side` just evaluates its single ctx.

Branch `when` clauses and amounts still evaluate against the (filtered)
group ctx, not per bearer.

## Fact resolution with no single split

When ctx has no single `commissionSplit` (per_transaction/per_side/
per_distinct_agent), a **number** `commission_split.*` Attribute resolves to
the **sum** across the group's splits (e.g. a dual-agency agent's total
`commission_amount`). Non-number split facts resolve to null there.

## Amount forms

- `flat` → `cents` (dollars). `baseAttributeId` is declarative only ("what
  this deducts from"), not read.
- `rate` → base × pct/100.
- `max`/`min` → recursive; a null side yields the other side.
- `ladder` → picks the first row where **tracker progress** `< upTo`
  (`upTo: null` = rest). Convention: the tracker name is also the linked
  agent's field name (`cap_accumulation`, `post_cap_bucket`,
  `tech_fee_bucket`, `production`). Needs `ctx.agent`. `rateType: percent` →
  base × row.value/100; `flat` → row.value.
- `capped_by` → `min(inner, target − progress)`, floored at 0. Uses explicit
  `progressAttributeId` (an Attribute id) + `target` on the amount — this is
  the "only collect the remaining $50 when progress is $700 of $750" rule.
- `from_facts` → the Attribute's number value.

## `split` — three mechanics (most-debated part of the project)

Dispatch is by `split` value, then (for `by_percent_attribute`) by applies:

1. **`none`** — one line with rawAmount as-is.
2. **`by_percent_attribute`** — absolute scaling, never renormalized:
   - per_side / per_transaction / per_agent_side → `scaleEachSplitByOwnPercent`:
     each split gets `rawAmount × its own pct`. A $50 side shared 70/30 by two
     different agents pays $35/$15. A lone participant at 50% pays $25, **not**
     the full $50 (confirmed 2026-09-15).
   - per_distinct_agent → `scalePerDistinctAgentAmount`: rawAmount is a
     **per-agent ceiling**; divide evenly by the agent's own number of sides
     first, then scale each share by that side's pct. User's words: "if the
     agent representing both sides then the 250 split to 125 125 each then
     applies based on side percentage." Guarantees total ≤ rawAmount
     (fixed 2026-09-16; before, an agent could be charged $375 against a
     $250 tier).
3. **`divide_by_percent_attribute`** → `splitSharedAmount`: renormalizes the
   group's percentages to sum to 100%, so lines always total exactly
   rawAmount. Available but no current rule uses it.

A null percentage on any split in the group voids the whole group (one
error, no partial lines).

`side_percentage` today is **per side**: splits on the same side sum to 100%
(sample: listing Rose 50 / Anakaren 50, sale Rose 100). Its Attribute `note`
still describes an older "whole-transaction pool, sums to 100% across all
splits" meaning — that note is stale.

## Worked examples (current sample data)

**2015 S 46 Dr, Yuma** — Both Purchase & Listing, GCI $12,900 → **$1,093**
- Company Dollar (per_agent_side): Rose capped → B4 $0 on both sides;
  Anakaren pre-cap, cap_acc 1,799 < 14,000 → max(15% × 3,870, $500) = **$580.50**.
- Tech Fee (per_distinct_agent, capped_by): Anakaren progress 500 → min(250,
  750−500) = **$250**; Rose at 750 fails `tech_fee_progress lt 750`.
- Capped-Status Fee (per_distinct_agent, by_pct): Rose post-cap 1,750 < 5,000
  → tier $250 → ÷2 sides = 125 → listing ×50% = **$62.50**, sale ×100% = **$125**.
- Risk Fee (per_side, by_pct): listing side keeps Rose only (Anakaren
  `is_referral` fails) → 50 × 50% = **$25**; sale side → **$50**.

**9080 Shifting Skye, Las Vegas** (Richard, capped) → **$300**: Company
Dollar $0, Capped-Status $250, Risk $50. Tech Fee skipped (progress 1,625).

**4154 Holstein Hl, Columbus** (Jonita, pre-cap, cap_acc 0) → **$2,610**:
Company Dollar 15% × 15,400 = $2,310, Tech Fee $250, Risk $50.

**8910 Felker St, Las Vegas** (Louise, personal deal) → **$900**:
Personal-Deal Fee $850 (per_transaction, fires via per-bearer filtering on
`personal_deal_count 0 < 2`), Risk $50. Company Dollar skipped
(`personal_deal eq false`), Tech Fee skipped (already at 750).

Re-run these after any engine or rule change; unexplained drift means a
regression.
