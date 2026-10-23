# 3. The extraction playbook

How to turn an export into a specification. This is the phase that decides whether the
migration succeeds; teams that skip it discover the business rules one production incident at
a time.

> **Principle: extract to documents, build from documents.** The legacy extraction is a
> *reference*, not a build input. Nothing in `src/` should require knowing what Unqork was.
> Generated config imported directly from the export locks you to the platform's shape
> forever; hand-written config *checked against* the extraction stays readable and reviewable.

---

## Step 0 — Intake (half a day)

Run [the intake checklist](01-export-anatomy.md#4-the-intake-checklist), **starting with the
manifest** if the export has one. The outputs that matter on day 1, because each one triggers a
request to someone outside the team:

1. **Manifest checks** (`failures` / `failed` / `possibly_truncated`, files vs manifest,
   unresolved referenced module ids) → re-export request for real gaps; dangling references from
   deprecated or copy modules are recorded, not chased.
2. **No manifest?** Distinct server-side module ids vs API-module file count, and `*_Error.txt`
   markers → re-export request and list of unrecoverable modules.
3. **Role ids from `permissions`** → the spelling reconciliation question.
4. **Service registry and SSO configuration** → requests to the platform owner (Steps 2b, 3b).
5. **Junk-module triage**: tag modules named `Deprecated`, `To-Be-Deleted`, `Copy`, `Bkp` or
   carrying a person's name, and `deleted: true` ones. Exclude from counts and parity.

**Snapshots.** If you receive a second export of the same environment, do not re-run everything
blind: `node scripts/diff-snapshots.mjs <old> <new>` reports modules added, removed, renamed,
resized or modified by id, so you only re-read what changed. Never mix environments (QA /
staging / prod) in one analysis; ids may differ.

```bash
node scripts/manifest.mjs     "<export>"            # manifest checks, files vs manifest, unresolved ids
node scripts/inventory.mjs    "<export>" > out/inventory.md
node scripts/integrators.mjs  "<export>" > out/api-surface.md
node scripts/permissions.mjs  "<export>" > out/permissions.md
node scripts/decisions.mjs    "<export>" > out/decisions.md
node scripts/datacollections.mjs "<export>/<collections folder>" --emit out/reference > out/reference.md   # CSV or JSON
```

---

## Step 1 — The module map

Build one table: **file ↔ module id ↔ screen name ↔ visible to ↔ notes**.

Sources, in order of reliability:
0. **`manifest.json`** (tool-based exports) — exact id, name and title for every module.
   With it, the sources below only tell you *which screen is which*, not which file is which.
1. `(role, status) → moduleId` reference tables — authoritative for detail screens.
2. Navigation `infotable`s and nav decision tables — authoritative for top-level pages.
3. `/modules/{id}/components` calls — the dynamically-loaded children (tab contents).
4. Filenames (legacy exports without a manifest) — a hint only, frequently misspelled.

Without a manifest, mark every inferred row as inferred: you will not be able to fully
resolve the map, and saying so is more useful than a confident wrong table.

**While you are here, identify the duplication families**, because they determine the target
architecture more than anything else:

| Family | How to spot it | Collapses to |
|---|---|---|
| Role-variant screens | Same screen name with a role suffix (`… Agent`, `… Customer`, `… Partner`) | One component + role config |
| Read-only twins | `X` and `X - Disabled` | One component + `readOnly` prop |
| Per-role grids | N modules referenced by a `role → moduleId` decision | One table + per-role column config |
| Copy-pasted shell | Header/footer trees repeated in every module | One `AppShell` |

---

## Step 2 — The API contract

From `scripts/integrators.mjs`, split into external and platform calls, then write an
**OpenAPI 3.1** document covering only the external service.

Method:

1. **Paths and verbs** — from `integratorData.integratorUrl` + `requestType`. Placeholders
   appear as `{{data.someKey}}`; normalise them to `{param}`.
2. **Request bodies and params** — from `dataInputObject`. This is *reliable*: it is literally
   what the live UI sends. Note that identity headers (`x-user-*`) usually appear here as
   pseudo-fields; lift them into a shared header component.
3. **Responses** — from the `postTrigger` data workflow's `Get` paths (`data.resolved.foo`)
   and from `dataOutputObject`. This is a **lower bound**, not the contract.
4. **State the confidence in the document itself**, e.g.
   *"47 paths / 54 operations, reconstructed from integrator mappings. Requests reliable;
   responses and types inferred and pending backend confirmation."*
5. Generate types: `openapi-typescript contract.yaml -o src/api/schema.d.ts`.

Also extract, once:

- The **error decision table** (`ruleHTTPresponses` or equivalent): HTTP status → user
  message. Put it in your API client, centrally, so no call site has to inspect `.status`.
- The **service names** each external integrator uses (see Step 2b).
- The **async job patterns**. Unqork apps commonly have three (document generation, ZIP
  archive, report generation) all following *submit → poll status → download*. One polling
  abstraction serves all of them.

---

## Step 2b — Service registry and SSO

Two facts the export cannot give you, both needed before any authenticated call works:

1. **Service registry.** Each `serviceType: "external"` integrator names a `service`;
   the tenant's registry resolves it to a base URL and auth type. Collect the distinct names
   (`scripts/integrators.mjs`), then request the registry per environment: title, name, auth
   type (e.g. OAuth2 client credentials), host, in-use flag. Expect non-domain services
   (document generation, notifications, document stores) as well as domain ones. Output: a
   service & auth register. See [01 §5](01-export-anatomy.md).
2. **SSO and role derivation.** Request the IdP configuration. Record the claim → attribute
   mapping and, if the role is computed by a Jinja `if/elif` chain over groups, transcribe it
   as an ordered rule list (first match wins, one role per user, fallback such as
   `Unverified`). Reconcile IdP group names, derived roles and the role ids in `permissions`
   keys. See [01 §6](01-export-anatomy.md).

---

## Step 3 — The capability matrix

This is the highest-value artefact after the API contract. It answers: **for a given role and
status, what opens, what is visible, and what is editable?**

Assemble from three sources:

| Source | Gives you |
|---|---|
| `(role, status) → moduleId` reference table | Which screen opens |
| `decision` tables keyed on role/status | Which actions and panels show |
| Component `permissions` maps | Field- and button-level gating |

Record it as **role × status × action**, and record the **row count of every decision table**
alongside it. Produce both a Markdown version (for humans) and a JSON twin (for tests).

Then — and this is the part that pays off — **express it in domain terms** rather than porting
hundreds of per-component flags:

```ts
// Not: 537 component hide-flags.
// Instead: named predicates, each traceable to a legacy table and its row count.
canEditBilling(role, status)   // ← ruleEditBillingBtnDisplay, 45 rows
canAssignAgent(role, status)   // ← ruleAgentAssignBtnDisplay, 36 rows
canAssignReviewer(role, status) // ← ruleReviewerAssignBtnDisplay, 27 rows
```

Do **not** collapse them into one predicate because they look similar. On one migration three
such tables were genuinely asymmetric — a manager role could assign an agent but not a
reviewer — and a single `isInternalRole && !isReadOnly` flag was wrong in both directions at
once, granting a role an edit it never had and granting everyone a button on two statuses where
no one had it.

Also check the `decisionType` of each table: `first` is a switch, `merge` is a set of
independent rules whose matching rows all apply ([02](02-component-reference.md)).

**Verification technique that works:** a test that walks every `role × status` pair and
asserts the count of `true` cells equals the legacy row count exactly. Adding or dropping a
role then fails the build instead of shipping silently.

---

## Step 4 — The domain model and state machine

From Data Collections plus hidden fields, write down:

- Every **status code**, its label per locale, and its meaning.
- Every **sub-status** and how it relates to the main status.
- The **buckets** (dashboard groupings) and the `bucket → [(status, subStatus)]` expansion.
  Buckets are *not* statuses; keep the mapping as data.
- Any **independent secondary status** (attachment status, document status, contract status…) —
  these are separate axes and get conflated constantly.
- The **transition table**: which action verb moves which status to which, and who may do it.

> **Keep the action verb strings byte-identical.** In most Unqork apps the backend derives the
> status transition from a `userAction` string the client sends (`Review`, `Accept`,
> `Start_Assessment`, `Save_sectionDetails`…). These are wire format. Renaming one to something
> tidier breaks the workflow silently.

---

## Step 5 — Form schemas

For each significant form, extract field key, label (per locale), type, options, validation,
and **behaviour** (visible, required, disabled, derived value, clearing, navigation); emit a
Zod schema plus step metadata.

**Where the behaviour is.** Not on the fields. In the observed exports `conditional`,
`customConditional`, `logic` and `calculateValue` appeared on zero components. Behaviour
comes from:

1. **`decision` outputs** — column headers `<targetKey>_<suffix>` with suffixes `visible`,
   `hidden`, `required`, `requiredAndVisible`, `disabled`, `value`, `clear`, `min`, `max`,
   `popError`, `customClass`, `readOnlyView`, `trigger`, `page`, `pageOpen`
   ([02](02-component-reference.md#how-field-behaviour-is-actually-driven)). For each target
   key, list every table and column that writes to it.
2. **`dataworkflow` Output nodes** with an `action` (same vocabulary) — read the
   `goDiagram` graph, not `dataOperationObject`.
3. **Trigger and watcher chains** — a field's `trigger` / `watcherList` / `refreshOn`, and
   `initializer` outputs, say *when* the tables above are evaluated. A rule that is never
   triggered never fires; a rule triggered by a field the user cannot change is a one-time
   default.

(If your app does use `conditional`/`logic`, extract those too — check by grep first.)

Emit the result as declarative rules over form state, evaluated on change.

The traps:

- **Container-targeted rules.** A rule often targets a *container* key (panel, field-group,
  columns), not the fields inside it. Without a container→members map, those rules silently
  affect nothing. On one migration, 43 of 69 rules targeted containers.
- **`merge` vs `first`.** A `merge` decision applies every matching row; porting it as
  first-match drops outputs.
- **Multi-select conditions are set membership**, not equality (07 §11).
- **Conditional requiredness.** A field can be required only when visible
  (`requiredAndVisible`). Model it, or forms become unsubmittable.
- **`clearOnHide` / `clear`.** Where a field sets `clearOnHide: true`, or a rule emits
  `_clear`, a hidden answer must be stripped from the payload. Verify where it is actually set
  rather than assuming; ignoring it where it is set sends contradictory data.
- **Transcription artifacts.** If you build the rule set via an intermediate document, rule
  values pick up stray whitespace, case changes and truncation that match nothing at runtime.
  Generate from the raw JSON, and assert coverage: *N fields rendered of N extracted*,
  *M rules firing of M extracted*.

Assert both counts in a test. "31 of 266 questions were never rendered, and only 18 of 69
rules could ever fire" is the kind of defect that no amount of manual clicking finds.

---

## Step 6 — Reference data and i18n

`scripts/datacollections.mjs --emit` gives you JSON per collection plus per-locale
dictionaries. Then:

- **Translation tables** → i18n resource files.
- **Mapping tables** → typed config in `src/config/`, hand-written and readable, checked
  against the extraction in review.
- **Fix encoding at import**, once. Never at render time.
- **Split multi-value cells** (`"role-a,role-b,"` → `['role-a','role-b']`).
- **Chase absent collections** — anything queried at runtime but missing from the export.

> **Locale is part of the request, not just the render.** If the legacy app sends `x-locale`
> (or equivalent), the API returns localised strings. A client-only i18n implementation will
> diverge from server-produced text — you get an English label next to a translated one on the
> same row. Send the locale header from the start.

---

## Step 7 — The escape hatches and the non-functional inventory

Sweep for the things that are requirements but appear in no functional spec:

```bash
grep -rl 'angular.element'  "<export>"    # scope hacks — read what they do
grep -rlo '<script'         "<export>"    # injected JS
grep -rlo '<style'          "<export>"    # injected CSS — the real page styling
grep -rli 'osano\|onetrust\|gtag\|analytics\|maps.googleapis' "<export>"
```

Each hit is a line item: cookie consent, analytics, address autocomplete, PDF/Excel export,
polling timers, session timeout, print styles. Add them to the plan now; they are the classic
source of "the app is done except for eleven small things" at the end.

---

## Step 8 — Write the four documents, then start building

| Document | Purpose |
|---|---|
| **Legacy analysis** | What the old app does — functional + technical, per screen |
| **Capability register** | Every page, every capability, and the exact API each calls. *The parity contract.* |
| **Engineering plan** | Stack, structure, deliberate divergences, slice roadmap, open questions |
| **Open questions** | What you cannot answer from the export, who owns each, what it blocks |

The capability register is the one that earns its keep: it is what you diff against in
[phase 6](06-parity-method.md), and it is what makes "are we done?" answerable.
