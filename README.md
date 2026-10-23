# DEQUORK

**An LLM context pack for converting Unqork applications into React.**

Unqork apps are locked inside a low-code platform. Their exports are thousands of lines of JSON
that no one can read, review, or port by hand. DEQUORK teaches an LLM (Claude, or any capable
coding agent) to read that JSON as a specification, extract what the application actually does,
and rebuild it as a typed React + Vite + TypeScript app with a NestJS BFF. It then *proves* the
rebuild is complete.

It is not a one-click transpiler. It is the knowledge, scripts, schemas and gates that make an
LLM-assisted conversion reliable rather than a guess.

### What's inside

- **14 reference docs** covering the platform's execution model, export anatomy, every
  component type with its React equivalent, mapping rules, target architecture, parity method,
  pitfalls, and a phase-by-phase agent workflow.
- **Zero-dependency Node scripts** ([scripts/](scripts/)) that mine an export into inventories,
  API surfaces, permission and decision tables, reference data, and snapshot diffs.
- **JSON Schemas** ([schemas/](schemas/)) for each phase's output, so every step has a
  machine-checkable gate.

### Quick start

1. Get a full Unqork export of your application (with its manifest, if your export tooling
   produces one).
2. Check that it is complete and inventory it (Node 18+, no install needed):

   ```bash
   node scripts/manifest.mjs  ./my-export
   node scripts/inventory.mjs ./my-export > out/inventory.md
   ```

3. Put this folder in your agent's context (for example, clone it next to your project and tell
   Claude Code to read `README.md` and `10-conversion-workflow.md`), then run the four phases
   (**extract → plan → build → verify**) as described in
   [10-conversion-workflow.md](10-conversion-workflow.md). Give each phase only its own inputs.

### Provenance

This pack was distilled from a real, completed migration and then generalised and anonymised.
No client code, data or names are included.

---

## Unqork → React + Vite migration context

A reusable knowledge pack for taking **any** Unqork application and rebuilding it as a modern
**React + Vite + TypeScript** application on a NestJS BFF, in an npm-workspaces monorepo.

It was distilled from a completed large migration (~20,000 Unqork components in ~150 module
JSON files, rebuilt as an 18-screen React app), but everything here is deliberately
generalised and anonymised. Real-project numbers appear only as anonymous evidence. Nothing in
the pack depends on any particular domain.

> **The one-line version.** An Unqork export is not source code you port; it is a *behaviour
> specification encoded as data*. The migration is an extraction problem first (mine the
> export into specs), an architecture problem second (collapse the platform's duplication),
> and a coding problem a distant third. Teams that start by writing React lose months.

---

## Read in this order

| # | Document | What it gives you |
|---|---|---|
| 0 | [00-what-unqork-is.md](00-what-unqork-is.md) | The platform's execution model. Why the export looks the way it does. Read this before anything else or the JSON will make no sense. |
| 1 | [01-export-anatomy.md](01-export-anatomy.md) | What is in an export (covering the three export generations), what is *always* missing from one, and what to demand before you start. |
| 2 | [02-component-reference.md](02-component-reference.md) | Every Unqork component type: its JSON shape, what it actually does, and its React equivalent. The decoder ring. |
| 3 | [03-extraction-playbook.md](03-extraction-playbook.md) | The step-by-step process for turning an export into a specification. Runnable scripts in [scripts/](scripts/). |
| 4 | [04-unqork-to-react-mapping.md](04-unqork-to-react-mapping.md) | Concept-by-concept mapping, the structural collapses available, and — critically — what you must **keep byte-identical**. |
| 5 | [05-target-architecture.md](05-target-architecture.md) | The target stack (React UI, NestJS BFF, Fastify/MongoDB mock, npm workspaces), project structure, and the patterns worth adopting wholesale. |
| 6 | [06-parity-method.md](06-parity-method.md) | How to *prove* the rewrite is complete: the dual-catalog parity diff, gap triage, and verification gates. |
| 7 | [07-pitfalls.md](07-pitfalls.md) | The traps. Every one of these cost real time. Read before slice 1, not after. |
| 8 | [08-open-questions-template.md](08-open-questions-template.md) | The questions *every* Unqork migration hits, including those for apps whose data lives inside Unqork. Ask them in week 1. |
| 9 | [09-lessons-from-a-large-migration.md](09-lessons-from-a-large-migration.md) | An anonymised case study: numbers, sequencing, what went right and what did not. |
| 10 | [10-conversion-workflow.md](10-conversion-workflow.md) | **How to run a conversion with this pack** — the four-phase agent pipeline (extract, plan, build, verify), each with explicit `inputs`, `outputs` and a runnable `gate`. |
| 11 | [11-finding-unqork-data-stores.md](11-finding-unqork-data-stores.md) | Finding the submission modules used as data and document stores, classifying them, and planning migration of Unqork-native persistence. |
| 12 | [12-incremental-conversion.md](12-incremental-conversion.md) | Converting one journey or feature at a time from a fresh export snapshot: fact provenance, construct mapping, diffing snapshots by module id. |
| 13 | [13-document-migration-execution.md](13-document-migration-execution.md) | Copying document bytes out of Unqork into object storage: thin batch job vs staged engine, the per-source lifecycle, the decommission gate, week-1 decisions. |

Plus:

- [scripts/](scripts/) — working Node scripts that mine an export with no dependencies
  (`manifest`, `inventory`, `integrators`, `permissions`, `decisions`, `datacollections`,
  `diff-snapshots`).
- [schemas/](schemas/) — JSON Schemas (draft 2020-12) for the phase outputs:
  `module-map`, `capability-matrix`, `page-api-map`, `parity-catalog`. Phase gates in
  [10](10-conversion-workflow.md) validate against them.

> Running a new conversion? Start with [10-conversion-workflow.md](10-conversion-workflow.md)
> and give each phase's agent this pack plus only that phase's inputs. Documents 00–08 are
> the reference material the phases lean on.

---

## The shape of the work

```
  ┌─ 1. INVENTORY ────────────────────────────────────────────────┐
  │  Run the manifest, then walk every module JSON. Count         │
  │  components by type. Build a module → components → API calls  │
  │  → role rules catalog.                                        │
  └───────────────────────────────────────────────────────────────┘
                              ↓
  ┌─ 2. EXTRACT THE FOUR SPECS ───────────────────────────────────┐
  │  a. API contract      — from `integrator` components          │
  │  b. Capability matrix — from `decision` tables + `permissions` │
  │  c. Domain model      — from Data Collections + hidden fields │
  │  d. Form schemas      — from field components + visibility     │
  └───────────────────────────────────────────────────────────────┘
                              ↓
  ┌─ 3. ARCHITECT ────────────────────────────────────────────────┐
  │  Collapse role/status module variants into config. Delete the │
  │  platform hop. Decide identity and persistence. Choose stack. │
  └───────────────────────────────────────────────────────────────┘
                              ↓
  ┌─ 4. BUILD IN SLICES ──────────────────────────────────────────┐
  │  Shell → hardest data path → workflow core → largest          │
  │  subsystem → the rest. Each slice capability-checked.         │
  └───────────────────────────────────────────────────────────────┘
                              ↓
  ┌─ 5. PARITY DIFF ──────────────────────────────────────────────┐
  │  Re-catalog BOTH sides independently. Diff domain by domain.  │
  │  Triage gaps P1/P2/P3. Close P1s. Publish what is blocked.    │
  └───────────────────────────────────────────────────────────────┘
```

Step 5 is not optional and it is not a formality. On one large migration the parity diff found
**141 gaps, 37 of them P1**, including a live data-corruption path and two of the
highest-volume roles seeing data they should never have seen. A migration that feels done is
roughly 70% done.

---

## Artefacts to request on day one

Beyond the export itself, ask for these; none can be reconstructed from it:

- **The service registry** for each environment (base URLs, auth, aliases of every service
  the integrators call, including non-domain ones such as document generation and
  notifications).
- **The SSO configuration** and the claim-to-role logic (first-match chains, fallback role).
- **Screenshots** of the running app, per role, per major screen.
- A list of Unqork environments and which snapshot is authoritative.
- If a manifest was not produced with the export, a re-export that includes one.

---

## Five things to internalise before you start

1. **The export may be incomplete — check the manifest.** If there is one, read its `failed`
   and `possibly_truncated` lists before anything else. Older manual exports truncate and fail
   silently on some modules and carry no module metadata, so treat every count as a lower
   bound and budget for a re-export request. See [01](01-export-anatomy.md).

2. **The state machine is the product.** In nearly every Unqork line-of-business app, a
   `(role × status)` pair decides which screen opens, which actions show, and what is
   editable. Model it once, explicitly and typed. Do not scatter it into conditionals.

3. **Duplication in the export is a platform artefact, not a requirement.** Six near-identical
   detail modules exist because Unqork could not express conditional layout. In React they
   are one component. Rebuilding the duplication is the single most common failure mode.

4. **Wire strings are load-bearing.** Status codes, action verbs, field names and header
   names go to a backend you are not rewriting. Change none of them, however ugly. Including
   the typos. (What changes is *who sets identity headers*: the BFF, from a verified token.)

5. **Screenshots beat the export.** The export encodes capability and wiring but not
   *arrangement, prominence, or per-scope variation*. Two screenshots of the running app
   answered questions that no amount of JSON reading could. Get them early.
