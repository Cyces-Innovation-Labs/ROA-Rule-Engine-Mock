# Rule catalog (14 rules, `rules-data.json`)

Source of truth for the business rules is the Notion page **"Economic Model
Team Specification"** (search Notion by that title; it has a 21-rule catalog,
tracker cards, 12-stage evaluation semantics, test vectors V1–V20, and
F-numbered open findings). This prototype implements 14 of those rules in
simplified form. Figures below are what the prototype encodes — re-check the
spec before treating them as policy.

To regenerate a readable dump of the live catalog, use the summary script
pattern in SKILL.md (load JSON, take latest version per id, print conditions/
branches).

| Rule | Applies / split | Payee | What it encodes |
|---|---|---|---|
| `company_dollar` | per_agent_side / none | roa | 15% of `commission_amount` while `cap_accumulation` < cap ($14,000 Standard, $7,000 Half Cap), with a minimum (MCD floor) of $125 lease / $500 sale. Sale branches also require pre-cap, not REO/short-sale/BPO, personal allowance not active. B4 = `$0` catch-all (capped agents, anything else). Gate excludes Referral/Other deal types and personal deals. Contributes to `cap_accumulation`. |
| `technology_fee` | per_distinct_agent / none | roa | $250 per deal ($125 if GCI < $1,000), `capped_by` the $750 `tech_fee_bucket` (only the remaining room is collected). Waivable. |
| `capped_status_fee` | per_distinct_agent / by_percent(side_percentage) | roa | Capped agents only. Flat tiers off `post_cap_bucket`: <$5k → $250, <$10k → $125, else $75. Lease/inbound-referral/builder-flat-fee deals take min(15% of commission, tier). |
| `personal_deal_fee` | per_transaction / none | roa | $850 when `personal_deal` and the agent's `personal_deal_count` < 2. |
| `mentor_fee` | per_agent_side / none | mentor | 15% of commission, Standard plan, not graduated. |
| `mentorship_program_fee` | per_agent_side / none | roa | 10% of commission, same gate as mentor fee. |
| `roa_leads_program` | per_transaction / none | roa | 30% of GCI when `source = roa_leads`. |
| `kairos_program` | per_transaction / none | roa | 18% of GCI when `program = kairos`. |
| `wa_workers_comp` | per_distinct_agent / none | statutory | WA-licensed agents. **$0 placeholder** — real rate is set annually from the WA L&I rate notice. |
| `risk_fee` | per_side / by_percent(side_percentage) | roa | $50 per side, scaled by each eligible split's own side %. Excludes referral splits, pass-through portions, LFRO plan. |
| `il_admin_fee` | per_agent_side / by_percent | statutory | $495 on IL listing sides. |
| `delinquency_fee` | per_agent_side / by_percent | roa | $150 when `decision = late_submission_recorded`. |
| `inbound_referral_fee` | per_transaction / none | external_brokerage | `from_facts(referral_agreement)` when source is inbound referral. |
| `outbound_referral_passthrough` | per_transaction / none | referring_agent | `from_facts(referral_agreement)` for outbound Referral deals. |

## Deliberate deviations from the spec

- **Scope → conditions.** No `scope` field; plan/team/agent narrowing is a condition.
- **One rule per fee, scenarios as branches** (instead of the spec's separate
  create/adjust rules). `kind` (create/adjust/produce/mark) is not modeled.
- **Only Standard and Half Cap plans** in Company Dollar. The user's
  instruction: note LFRO and Domestic Team and remove them from rules for
  now. Marketing Collective isn't modeled either.
- **Payee is a role label** (`roa`, `agent`, `team`, `statutory`, `mentor`,
  `referring_agent`, `external_brokerage`), not a real Party record;
  `economic_role`/`balance_role` are not modeled.
- **`referral_agreement` is a transaction-level fact**, not derived from a
  split — this removed the ambiguity of which split's value a
  per_transaction referral rule should read.
- **Risk Fee split** went through several rounds (per_agent_side →
  per_side; a 100%-across-all-splits percentage → per-side percentage).
  The current behavior in `engine.md` is the confirmed one.
- **No conflict groups/ranks.** Every matching rule fires.

## Adding or changing a rule safely

1. Prefer the UI (it versions for you). If scripting, append a new version
   (`version+1`, new `updatedAt`), never edit in place.
2. End `branches` with an empty-`when` catch-all unless "no match" should be
   an error.
3. Any `flat` amount needs a number `baseAttributeId` and a `ladder` needs one
   even for flat tiers (validation requires it).
4. Validate all latest rules: `validateRule(rule, latestRules, rule.id, attributesById)` must return `{}`.
5. Re-run the four sample transactions and compare against the worked
   examples in `engine.md`.
