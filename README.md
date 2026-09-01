# ROA Rule Engine — Mock

A prototype commission rule engine: an **Attribute catalog** (typed facts
about a transaction, agent, or team) feeds a **Rule catalog** (nested
AND/OR conditions over those Attributes, plus a dollar/percentage amount
and a payee). Built as a client-side app with a minimal local persistence
server — no framework, no build step, no database.

See `CLAUDE.md` for the full domain model, every design decision made
along the way, and what's deliberately still out of scope.

## Run it

```
node server.js
# or: npm start
```

Then open **http://localhost:5050**.

Double-clicking `index.html` directly will render the page, but data
won't load or save — the app talks to the local server over `fetch()` for
persistence. See "How it's built" below for why.

## How it's built

- **HTML / CSS / JavaScript / React** — React and Babel are loaded from a
  CDN; JSX is compiled in-browser by `@babel/standalone`. No `npm install`,
  no bundler.
- **`server.js`** — a zero-dependency Node server (built-in `http`/`fs`/
  `path` only). It does two things: serves the static files, and exposes a
  small `GET`/`PUT` JSON-array API (`/api/attributes`, `/api/rules`) backed
  by two files on disk. This exists because the catalog used to live in
  browser `localStorage`, which doesn't survive across browsers/profiles/
  incognito on the same machine — the server makes the data actually
  shared and durable.
- **Path-based routing, no router library** — `/attributes` and `/rules`
  are real URL paths via the History API, with a matching server-side
  fallback so a refresh or a typed URL lands on the right tab instead of
  always resetting to Attributes.

## Files

```
index.html          HTML shell + inlined React app (JSX, compiled in-browser)
style.css            Styling
attributes.js        Attribute catalog: types, operators, resolver paths, allowed-values sources
rules.js             Rule catalog: nested condition groups, the 7 amount forms, validation
server.js            Static file server + /api/attributes and /api/rules persistence
attributes-data.json Seed/current Attribute catalog data
rules-data.json      Seed/current Rule catalog data
package.json         npm start -> node server.js (no dependencies)
CLAUDE.md            Full project context, domain model, and decision log
```

## What it does

- **Attributes tab** — create/edit/delete typed Attributes (`number` /
  `enum` / `date` / `boolean`). Operators and the value input widget are
  derived from the type, never chosen directly. An Attribute's value is
  resolved from a `transaction`, `agent`, or `team` root plus a field path.
  Enum Attributes take their allowed values either from a fixed list or a
  live reference to another dataset (Teams, Agents). Editing an Attribute
  creates a new version rather than overwriting it; a History view shows
  every past version.
- **Rules tab** — build a Rule as a nested AND/OR tree of conditions over
  the Attribute catalog, plus an amount (flat $, a percentage of a number
  Attribute, `max`/`min` of two amounts, a tiered ladder against a
  tracker, an amount capped by tracker headroom, or a value taken directly
  from an Attribute) and a payee. Rules version the same way Attributes
  do.

## Known gaps (see CLAUDE.md "Open items" for the full list)

- No calculation pipeline yet — this is authoring/storage only, nothing
  evaluates a Rule set against a real transaction.
- No conflict resolution if multiple Rules match the same transaction.
- Trackers (`cap_accumulation`, `tech_fee_bucket`, etc.) are a hardcoded
  name list, not a real catalog with live balances.
