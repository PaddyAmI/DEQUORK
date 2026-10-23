# 10. The conversion workflow — phases, agents, and handoffs

How to actually run a conversion using this pack. The model is a **pipeline of focused
agents** (human or AI), each consuming the previous phase's artefacts and producing its own.
No phase starts until the previous phase's outputs exist as files on disk and its `gate:`
passes — the artefacts *are* the handoff, not conversation history or anyone's memory.

```
  Phase 1: EXTRACT          Phase 2: PLAN            Phase 3: BUILD           Phase 4: VERIFY
  ┌────────────────┐        ┌────────────────┐       ┌────────────────┐       ┌────────────────┐
  │ export → DOCS/ │───────▶│ DOCS/ → plan + │──────▶│ plan → apps/   │──────▶│ apps/ vs export│
  │ (specs, not    │        │ contract +     │       │ (slices, mock  │       │ (dual-catalog  │
  │  code)         │        │ open questions │       │  backend first)│       │  parity diff)  │
  └────────────────┘        └────────────────┘       └────────────────┘       └────────────────┘
        ▲                                                    │                        │
        └────────────── gaps found in 3 & 4 route back to the artefacts, ─────────────┘
                        never get fixed "just in code"
```

Why separate agents per phase: each phase needs a different disposition. Extraction rewards
exhaustiveness and distrust of summaries; planning rewards architectural judgment; building
rewards restraint (follow the plan, don't re-derive it); verification rewards adversarial
independence — the verifier must **not** be the builder, or it checks intent against intent.

Conventions used below. `<export>` is the export root; `OUT=DOCS` is the docs folder in the
new repo; `PACK` is this folder. JSON outputs validate against [schemas/](schemas/) with, for
example:

```bash
npx ajv-cli validate --spec=draft2020 -s PACK/schemas/module-map.schema.json -d DOCS/legacy/module-map.json
```

---

## Phase 1 — Extract (export → `DOCS/`)

**Agent brief:** you are producing specification documents, not code. Do not write React.

inputs:
- the raw export at `<export>`; this pack (00–03 first)

steps ([03-extraction-playbook.md](03-extraction-playbook.md)):
1. `node scripts/manifest.mjs <export> --json > DOCS/legacy/manifest.json` — **always first.** It
   gives module id to title and type, and lists `failed` and `possibly_truncated` modules.
   Without a manifest (older export generations, see [01](01-export-anatomy.md)) treat every
   count as a lower bound.
2. Run the other scripts: `inventory.mjs`, `integrators.mjs`, `permissions.mjs`,
   `decisions.mjs`, `datacollections.mjs` (usage in [scripts/README.md](scripts/README.md)).
3. Run the intake checklist ([01 §4](01-export-anatomy.md)); file the day-1 requests
   immediately: re-export if truncated, screenshots per role per screen, SSO configuration,
   the service registry per environment, backend contact.
4. Find Unqork-native data stores ([11](11-finding-unqork-data-stores.md)).
5. Build the module map, the capability matrix and the page-to-API map; mark inferred rows.

outputs (this layout is the handoff contract; later phases navigate by it):
```
DOCS/
  legacy/
    manifest.json               from scripts/manifest.mjs --json
    module-map.json             schema: schemas/module-map.schema.json
    capability-matrix.json      schema: schemas/capability-matrix.schema.json (+ .md view)
    page-api-map.json           schema: schemas/page-api-map.schema.json
    app-analysis.md             full functional + technical spec, screen by screen
    <big-form>-schema.json      field descriptors, types, conditional rules
    data-stores.md              output of 11: store id, class, volume, owner
  api/
    openapi-<service>.yaml      reconstructed contract; state "requests reliable,
                                responses inferred" in its description
  inventory/unqork/…            exhaustive legacy catalog, per module family
  OPEN-QUESTIONS.md             from 08, owners named
```

gate (all must pass):
```bash
npx ajv-cli validate --spec=draft2020 -s PACK/schemas/module-map.schema.json        -d DOCS/legacy/module-map.json
npx ajv-cli validate --spec=draft2020 -s PACK/schemas/capability-matrix.schema.json -d DOCS/legacy/capability-matrix.json
npx ajv-cli validate --spec=draft2020 -s PACK/schemas/page-api-map.schema.json     -d DOCS/legacy/page-api-map.json
test -s DOCS/OPEN-QUESTIONS.md
```
and by inspection: every capability row cites its source module; every decision table over 20
rows was read from raw JSON with its row count recorded (`source.rowCount`); every open
question has a named owner; nothing in `manifest.json`'s `failed` list is unaccounted for.

---

## Phase 2 — Plan (`DOCS/` → engineering plan)

**Agent brief:** decide the architecture and the slice order. Do not build features.

inputs:
- everything in `DOCS/` from Phase 1; [04](04-unqork-to-react-mapping.md) and
  [05](05-target-architecture.md)

steps:
1. Adopt the stack in 05 (deviations need a written reason).
2. List the structural collapses (04 §2) by name: every module family that becomes one
   component.
3. Write the **deliberate divergences** list (04 §4); it stops Phase 4 filing your
   improvements as gaps.
4. Write the **wire-format freeze list** (04 §3): the strings nobody may change.
5. Decide the identity design and the persistence story (08 Q1 to Q3).
6. Sequence the slices by risk (05 §9) and set the per-screen definition of done (05 §8).
7. Specify the mock backend (05 §7); it is built in slice 0/1, not deferred.

outputs:
```
DOCS/target/00-engineering-plan.md      stack, collapses, divergences, freeze list, slices
DOCS/OPEN-QUESTIONS.md                  updated
apps/ui  apps/api  apps/api-mock        scaffolded workspaces, root package-lock.json only
.github/workflows/*                     one workflow per workspace, with paths filters
```

gate:
```bash
npm ci && npm run typecheck && npm run lint && npm test && npm run build
node scripts/check-probe-paths.mjs        # if the repo ships one; see 05 §2.1
```
and by inspection: every open question is answered, has a documented tolerant interim
position, or blocks a clearly-marked slice; the identity question has been *escalated*
whatever its state; the lint config exists and actually runs.

---

## Phase 3 — Build (plan → `apps/`)

**Agent brief:** one slice at a time, in plan order. The plan and `DOCS/` are authoritative —
if reality contradicts them, fix the document in the same change; do not silently diverge.

inputs:
- the plan, `DOCS/`, the mock backend

standing rules:
- **Check config against `DOCS/legacy/`, never generate from it.** Hand-written, readable
  config; the extraction is the reviewer's checklist.
- **Port decision tables as tables** with the row-count-assertion test (02, 03 §3).
- **Wire format is frozen** — codes, verbs, field names, headers, misspellings.
- Identity headers are derived server-side by the BFF from the verified token.
- Provisional endpoints stay flagged in the API layer *and* quarantined in the mock.
- A slice is done per the definition of done, including loading/empty/error/denied states and
  a test per role that behaves differently.

outputs (per slice): working code, tests, and an updated capability-matrix row status
("built / provisional / blocked-on-QN") so Phase 4 has a claimed state to audit.

gate (per slice):
```bash
npm run typecheck && npm run lint && npm test && npm run build
npm run check:contract                    # OpenAPI deck vs mock route table, both directions
```

---

## Phase 4 — Verify (dual-catalog parity diff)

**Agent brief:** [06-parity-method.md](06-parity-method.md), followed exactly. You are
adversarial: catalog both sides fresh, diff domain by domain, verify every finding against
source with a `file:line` citation before filing.

inputs:
- the export and `apps/`. Explicitly **not** input: Phase 2/3's own claims about what was
  built.

steps:
- Triage P1/P2/P3; close all P1s (fixes route back through Phase 3 rules).
- Measure and publish API coverage (N full / K partial / J uncovered).
- Check the recurring gap classes (06 §4) by name.
- If a newer export snapshot exists, `node scripts/diff-snapshots.mjs <old> <new>` and
  re-check changed modules ([12](12-incremental-conversion.md)).
- Write the migration status document (06 §7).

outputs:
```
DOCS/inventory/parity-catalog.json      schema: schemas/parity-catalog.schema.json
DOCS/MIGRATION-STATUS.md                where it stands, blocked on whom, production blockers
```

gate:
```bash
npx ajv-cli validate --spec=draft2020 -s PACK/schemas/parity-catalog.schema.json -d DOCS/inventory/parity-catalog.json
node -e "const c=require('./DOCS/inventory/parity-catalog.json'); process.exit(c.filter(x => x.status !== 'match' && x.priority === 'P1').length ? 1 : 0)"
npm run typecheck && npm run lint && npm test && npm run build
```
The status document, not "the demo works", tells stakeholders whether the app can replace the
legacy one.

---

## Running it with AI agents — practical notes

- **Give each agent this pack plus only its phase's inputs.** An extraction agent with access
  to a half-built `apps/` starts confirming the code instead of the export.
- **Fresh context per phase** (and per catalog side in Phase 4). Independence is the point; a
  verifier that remembers building the feature is not a verifier.
- **Artefacts over conversation.** Anything decided in chat that isn't written into `DOCS/`
  did not happen. The next agent won't see it.
- **Long tables are read from raw JSON, always** — summarising layers (including an AI's own
  earlier pass) truncate. See pitfall [07 §6](07-pitfalls.md).
- **Human touchpoints** are the phase gates and the open-questions table — those decisions
  (identity, upload mechanism, persistence, scope) are owned outside the pipeline and no
  agent may guess them.
