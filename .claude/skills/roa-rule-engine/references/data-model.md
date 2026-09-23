# Data model

## Attribute (`attributes-data.json`, 44 current)

`{ id, label, type, operators, valueWidget, valueLabel, resolver: {kind:'path', path}, allowedValuesSource, note, version, updatedAt }`

- `type`: `number | enum | date | boolean | text`. Operators and value widget
  are **derived from type** (`OPERATORS_BY_TYPE`), never chosen. `text` exists
  for GUIDs/names/addresses and has only `eq neq is_empty is_not_empty`.
- `allowedValuesSource` (enum only): `{type:'static', values:[...]}` (plain
  strings, label == value) or `{type:'table_ref', table:'teams'|'agents', valueField:'id', labelField:'name'}`.
- `note`: free-text caveat shown in the UI, e.g. "not confirmed SkySlope
  populates this". Never read by logic.

The catalog was **rebuilt from scratch** against a real SkySlope-style
transaction payload (which has a `commission_splits[]` array). Grouped by root:

- **transaction**: `sale_guid`, `listing_price`, `sale_price`,
  `property_address`, `deal_type` (the 9 real SkySlope values: Lease Landlord,
  Both Lease Tenant & Landlord, Both Purchase & Listing, BPO, Other, Listing,
  Referral, Lease Tenant, Purchase), `overall_gci`, `personal_deal`, `source`
  (incl. `SOI`, `Personal Referral`), `portion` (`standard`, `pass_through`),
  `deal_subtype`, `state`, `program`, `decision`, `direction`,
  `referral_agreement`, `listing_commission_percent`, `sale_commission_percent`.
- **commission_split**: `participant_type`, `is_internal`, `brokerage`,
  `is_referral`, `split_guid`, `split_name`, `split_email`, `side`
  (`listing`/`sale`), `commission_percent`, `commission_amount`,
  `side_percentage`.
- **agent**: `cap_position`, `commission_plan` (standard, half_cap,
  domestic_team, lfro, marketing_collective), progress fields
  (`commission_progress`→`cap_accumulation`, `tech_fee_progress`→`tech_fee_bucket`,
  `capped_fee_progress`→`post_cap_bucket`, `production_progress`→`production`),
  graduation counts, `personal_deal_count`, `risk_fee_progress`,
  `personal_allowance`, `graduation_status`, `primary_license_state`
  (WA, AZ, NV, GA), `agent_team`→`team_id` (table_ref teams).
- **team**: `team`, `team_commission_progress` — no team data exists; the
  engine never populates the team root.

Note the **id ≠ field** cases above (arrow = Attribute id → record field).
Seed records must use the field name.

### Unverified / stale Attribute metadata

- `deal_subtype`, `program`, `decision`, `direction` carry notes: not
  confirmed SkySlope populates them. Rules depending on them (IL admin,
  delinquency, Kairos, outbound referral) only fire if someone fills the data.
- `sale_commission_percent`: sample payload spelled it
  `sale_commission_perent` (typo) — verify the real field name.
- `side_percentage` is **not in SkySlope's payload as far as we know**; it's
  entered by hand. Its note describes an old "sums to 100% across the whole
  transaction" meaning; current data and engine treat it as **per side**
  (sums to 100% within a side).

## Transaction (`transactions-data.json`, not versioned)

Transaction-rooted fields at top level, `commission_splits: [...]` with
split-rooted fields, plus `id` (= `sale_guid`) and `calculationResults`
(null until run). Forms are generated from the Attribute catalog, so a new
transaction/split Attribute automatically gets an input.

Sample transactions (all real-shaped):
1. **2015 S 46 Dr, Yuma AZ** — Both Purchase & Listing, dual agency (Rose on
   both sides) plus Anakaren as a referral split on listing. Rich test case.
2. **9080 Shifting Skye St, Las Vegas NV** — Richard Pobre, capped, team member.
3. **4154 Holstein Hl, Columbus GA** — Jonita Floyd, pre-cap, fresh cap year.
4. **8910 Felker St, Las Vegas NV** — Louise Trujillo, personal deal.

Several null fields in #1 were filled with the catalog's "normal" value so
rules could evaluate: `portion: standard`, `deal_subtype: none`,
`side_percentage`, agents' `personal_allowance: not_active`. This is the
pattern for data gaps (see null semantics in SKILL.md).

## Agent (`agents-data.json`, not versioned)

`{ id (=guid), guid, name, ...agent-rooted fields by field name }`. Linked
to splits by `guid`. `name` is display only, not an Attribute. Five agents:
Rose Melinda Munoz (capped), Anakaren Moore (pre-cap), Richard Pobre (capped,
team `rich_group`), Jonita Floyd (pre-cap), Louise Trujillo (pre-cap, team
`the_movement_team`). Values came from real agent profile screens the user
supplied; nulls mean the profile showed "None".

## Rule (`rules-data.json`)

`{ id, label, waivable, conditions: ConditionGroup, branches: [{when, amount}], payee, applies, split, splitAttributeId, contributesToTracker, version, updatedAt }`

- `ConditionGroup = {kind:'group', op:'AND'|'OR', children:[group|condition]}`,
  `Condition = {kind:'condition', attributeId, operator, value}`. Value shape
  follows the operator: single / list (`in`,`not_in`) / range `{min,max}` /
  none. Empty group = matches everything.
- `split` ∈ `none | by_percent_attribute | divide_by_percent_attribute`;
  allowed for all four applies values (`APPLIES_ALLOWING_SPLIT`).
- `contributesToTracker` ∈ `none` + `TRACKER_OPTIONS`; declarative only.
