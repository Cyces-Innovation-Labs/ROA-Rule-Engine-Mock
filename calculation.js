// ROA Rule Engine — Mock calculation engine.
//
// Evaluates the current Rule catalog against one Transaction (and its
// linked Agents) and produces a line-item breakdown. This is a MOCK
// calculation, not the real evaluation pipeline (see the Economic Model
// spec's 12-stage evaluation semantics) — it exists to sanity-check the
// authored Rules/Attributes against a real sample payload, nothing more.
// No corrections, no conflict-rank resolution, no rounding-remainder
// distribution, no live Tracker balances (Trackers were tried and
// reverted this session — see server.js/CLAUDE.md).
//
// Plain global-scope script (same convention as attributes.js/rules.js —
// loaded via a native <script src>, not Babel, so its functions are
// available as globals to index.html's JSX).

// --- Fact resolution -----------------------------------------------------
//
// `ctx` is per-firing: { transaction, agent, commissionSplit, commissionSplits }.
// `agent` and `commissionSplit` are the SINGLE linked record for firings
// that have exactly one (per_agent_side); `commissionSplits` is always the
// array relevant to this firing (all of a transaction's splits for
// per_transaction/per_side, or one agent's own splits for
// per_distinct_agent) — used to resolve a commission_split-rooted
// Attribute when there's no single split to read from (see below).
// `team` is never populated — not modeled in this prototype (every
// agent's team_id is currently None), so a team-rooted condition simply
// resolves to null and fails like any other missing fact.

function valueOrNull(v) {
  return v === undefined ? null : v;
}

function resolveAttributeValue(attribute, ctx) {
  const { root, field } = splitResolverPath(attribute.resolver.path);
  if (root === 'transaction') {
    return ctx.transaction ? valueOrNull(ctx.transaction[field]) : null;
  }
  if (root === 'agent') {
    return ctx.agent ? valueOrNull(ctx.agent[field]) : null;
  }
  if (root === 'commission_split') {
    if (ctx.commissionSplit) return valueOrNull(ctx.commissionSplit[field]);
    // No single split in context (per_transaction/per_distinct_agent firing).
    // Only well-defined for a number Attribute, by summing across the
    // relevant splits (e.g. a dual-agency agent's total commission_amount
    // across both their sides) — any other type has no single coherent
    // value to return, so it stays unresolved (null) rather than guessed.
    if (Array.isArray(ctx.commissionSplits) && ctx.commissionSplits.length && attribute.type === 'number') {
      return ctx.commissionSplits.reduce((sum, s) => sum + (Number(s[field]) || 0), 0);
    }
    return null;
  }
  return null; // 'team' root — not modeled
}

function readNumberFact(attributeId, attributesById, ctx) {
  const attribute = attributesById[attributeId];
  if (!attribute) return null;
  const v = resolveAttributeValue(attribute, ctx);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// --- Condition evaluation -------------------------------------------------
//
// Per this session's decision: a null/undefined fact fails every operator
// except is_empty/is_not_empty (which are defined precisely to test for
// that). This means a Rule whose condition targets an Attribute with no
// value for this firing is simply skipped, never a thrown error.

function evaluateOperator(operator, factValue, value) {
  if (operator === 'is_empty') return factValue === null || factValue === undefined || factValue === '';
  if (operator === 'is_not_empty') return !(factValue === null || factValue === undefined || factValue === '');
  if (factValue === null || factValue === undefined) return false;
  switch (operator) {
    case 'eq': return factValue === value;
    case 'neq': return factValue !== value;
    case 'gt': return factValue > value;
    case 'lt': return factValue < value;
    case 'gte': return factValue >= value;
    case 'lte': return factValue <= value;
    case 'between': return value && factValue >= value.min && factValue <= value.max;
    case 'in': return Array.isArray(value) && value.includes(factValue);
    case 'not_in': return Array.isArray(value) && !value.includes(factValue);
    default: return false;
  }
}

function evaluateCondition(condition, attributesById, ctx) {
  const attribute = attributesById[condition.attributeId];
  if (!attribute) return false;
  const factValue = resolveAttributeValue(attribute, ctx);
  return evaluateOperator(condition.operator, factValue, condition.value);
}

function evaluateConditionGroup(group, attributesById, ctx) {
  if (!group || !Array.isArray(group.children) || group.children.length === 0) return true;
  const results = group.children.map((child) => (
    child.kind === 'group'
      ? evaluateConditionGroup(child, attributesById, ctx)
      : evaluateCondition(child, attributesById, ctx)
  ));
  return group.op === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

// --- Amount evaluation -----------------------------------------------------

function evaluateAmount(amount, attributesById, ctx) {
  switch (amount.form) {
    case 'flat':
      // baseAttributeId is declarative only here (see rules.js emptyAmount) —
      // not read for the computation itself.
      return Number.isFinite(amount.cents) ? amount.cents : null;

    case 'rate': {
      const base = readNumberFact(amount.baseAttributeId, attributesById, ctx);
      return base == null ? null : base * (amount.pct / 100);
    }

    case 'max': {
      const a = evaluateAmount(amount.a, attributesById, ctx);
      const b = evaluateAmount(amount.b, attributesById, ctx);
      if (a == null) return b;
      if (b == null) return a;
      return Math.max(a, b);
    }

    case 'min': {
      const a = evaluateAmount(amount.a, attributesById, ctx);
      const b = evaluateAmount(amount.b, attributesById, ctx);
      if (a == null) return b;
      if (b == null) return a;
      return Math.min(a, b);
    }

    case 'ladder': {
      // Tier boundaries are read against the named tracker's CURRENT
      // PROGRESS. There is no live Tracker catalog (deferred this
      // session), so by convention the tracker id doubles as the linked
      // Agent record's own field name for that progress — true today for
      // every tracker a ladder actually uses (cap_accumulation,
      // post_cap_bucket match real agent Attribute resolver fields
      // 1:1). Only meaningful with a single agent in context.
      if (!ctx.agent) return null;
      const progress = ctx.agent[amount.tracker];
      if (typeof progress !== 'number') return null;
      const rows = Array.isArray(amount.rows) ? amount.rows : [];
      const row = rows.find((r) => r.upTo == null || progress < r.upTo);
      if (!row) return null;
      if (amount.rateType === 'flat') return Number.isFinite(row.value) ? row.value : null;
      const base = readNumberFact(amount.baseAttributeId, attributesById, ctx);
      return base == null ? null : base * (row.value / 100);
    }

    case 'capped_by': {
      const progress = readNumberFact(amount.progressAttributeId, attributesById, ctx);
      const inner = evaluateAmount(amount.amount, attributesById, ctx);
      if (progress == null || inner == null) return null;
      const remaining = amount.target - progress;
      if (remaining <= 0) return 0;
      return Math.min(inner, remaining);
    }

    case 'from_facts':
      return readNumberFact(amount.attributeId, attributesById, ctx);

    default:
      return null;
  }
}

function resolveBranchAmount(branches, attributesById, ctx) {
  for (let i = 0; i < branches.length; i++) {
    if (evaluateConditionGroup(branches[i].when, attributesById, ctx)) {
      return { branchIndex: i, rawAmount: evaluateAmount(branches[i].amount, attributesById, ctx) };
    }
  }
  return { branchIndex: -1, rawAmount: null };
}

// per_transaction/per_side: split slices a SHARED total (computed once,
// then scaled per participant — see buildFirings, which already produces
// one firing per participant in that case). per_agent_side: split scales
// THIS firing's own independently-computed amount by THIS firing's own
// percentage fact. Both reduce to the same formula here because
// buildFirings has already put the right single split into `ctx` either
// way — see rules.js's APPLIES_ALLOWING_SPLIT comment for the underlying
// design distinction.
function applySplit(rule, rawAmount, attributesById, ctx) {
  if (rule.split !== 'by_percent_attribute' || rawAmount == null) return rawAmount;
  const pct = readNumberFact(rule.splitAttributeId, attributesById, ctx);
  if (pct == null) return null;
  return rawAmount * (pct / 100);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// --- Firing enumeration ("applies") ----------------------------------------
//
// A commission_splits[] entry with is_referral:true still gets ordinary
// per_agent_side/per_distinct_agent fees (Company Dollar, Risk Fee, Tech
// Fee, etc.) like any other split on the transaction — is_referral just
// describes what KIND of split it is (a referring participant, not
// necessarily excluded from fees), it doesn't opt the split out of them.
// (Corrected 2026-09-10 — an earlier version of this engine excluded
// is_referral splits from these two applies types; that was wrong.) The
// two dedicated referral Rules (inbound_referral_fee,
// outbound_referral_passthrough) are separate, per_transaction rules off
// the transaction-level referral_agreement Attribute — unrelated to this
// flag.

function findAgentByGuid(agents, guid) {
  return agents.find((a) => a.guid === guid || a.id === guid) || null;
}

function buildFirings(rule, transaction, agents) {
  const splits = transaction.commission_splits || [];

  switch (rule.applies) {
    case 'per_transaction':
      return [{
        ctx: { transaction, agent: null, commissionSplit: null, commissionSplits: splits },
        participant: null,
      }];

    case 'per_side': {
      const sides = Array.from(new Set(splits.map((s) => s.side).filter((v) => v != null)));
      return sides.map((side) => ({
        ctx: { transaction, agent: null, commissionSplit: null, commissionSplits: splits.filter((s) => s.side === side) },
        participant: { side },
      }));
    }

    case 'per_agent_side':
      return splits.map((split) => {
        const agent = findAgentByGuid(agents, split.guid);
        return {
          ctx: { transaction, agent, commissionSplit: split, commissionSplits: [split] },
          participant: { guid: split.guid, name: split.name, side: split.side },
          agentMissing: !agent,
        };
      });

    case 'per_distinct_agent': {
      const byGuid = new Map();
      for (const split of splits) {
        if (!byGuid.has(split.guid)) byGuid.set(split.guid, []);
        byGuid.get(split.guid).push(split);
      }
      return Array.from(byGuid.entries()).map(([guid, ownSplits]) => {
        const agent = findAgentByGuid(agents, guid);
        return {
          ctx: { transaction, agent, commissionSplit: null, commissionSplits: ownSplits },
          participant: { guid, name: ownSplits[0].name },
          agentMissing: !agent,
        };
      });
    }

    default:
      return [];
  }
}

// --- Per-rule, then whole-transaction evaluation ----------------------------

function evaluateRule(rule, transaction, agents, attributesById) {
  const lineItems = [];
  const errors = [];
  const firings = buildFirings(rule, transaction, agents);

  for (const firing of firings) {
    if (firing.agentMissing) {
      errors.push({
        ruleId: rule.id, ruleLabel: rule.label, participant: firing.participant,
        message: "No Agent record found for this split's guid — agent-rooted facts resolved to None for this firing.",
      });
    }

    if (!evaluateConditionGroup(rule.conditions, attributesById, firing.ctx)) continue; // gate failed — not an error, just doesn't fire

    const { branchIndex, rawAmount } = resolveBranchAmount(rule.branches, attributesById, firing.ctx);
    if (branchIndex === -1) {
      errors.push({ ruleId: rule.id, ruleLabel: rule.label, participant: firing.participant, message: "Matched the Rule's conditions but no branch matched (missing a catch-all branch?)." });
      continue;
    }
    if (rawAmount == null) {
      errors.push({ ruleId: rule.id, ruleLabel: rule.label, participant: firing.participant, message: 'Matched, but the amount could not be computed — a fact it depends on is None.' });
      continue;
    }

    const finalAmount = applySplit(rule, rawAmount, attributesById, firing.ctx);
    if (finalAmount == null) {
      errors.push({ ruleId: rule.id, ruleLabel: rule.label, participant: firing.participant, message: 'Amount computed, but the split percentage fact is None.' });
      continue;
    }

    lineItems.push({
      ruleId: rule.id,
      ruleLabel: rule.label,
      applies: rule.applies,
      payee: rule.payee,
      split: rule.split,
      contributesToTracker: rule.contributesToTracker,
      waivable: rule.waivable,
      participant: firing.participant,
      branchIndex,
      rawAmount: round2(rawAmount),
      amount: round2(finalAmount),
    });
  }

  return { lineItems, errors };
}

function runMockCalculation({ transaction, agents, rules, attributesById }) {
  const latestRules = currentRules(rules);
  const lineItems = [];
  const errors = [];
  const skipped = [];

  for (const rule of latestRules) {
    const { lineItems: ruleLines, errors: ruleErrors } = evaluateRule(rule, transaction, agents, attributesById);
    lineItems.push(...ruleLines);
    errors.push(...ruleErrors);
    if (ruleLines.length === 0 && ruleErrors.length === 0) {
      skipped.push({ ruleId: rule.id, ruleLabel: rule.label });
    }
  }

  const totalsByPayee = {};
  for (const li of lineItems) {
    totalsByPayee[li.payee] = round2((totalsByPayee[li.payee] || 0) + li.amount);
  }
  const grandTotal = round2(lineItems.reduce((sum, li) => sum + li.amount, 0));

  return { calculatedAt: new Date().toISOString(), lineItems, totalsByPayee, grandTotal, skipped, errors };
}
