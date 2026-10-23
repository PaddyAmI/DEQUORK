# 9. Lessons from a large migration

An anonymised case study of the migration this pack was distilled from. It exists so the
numbers elsewhere in the pack have a referent and so you can calibrate your own project against
a real one. No client or domain detail is given on purpose; the shape is what transfers.

---

## 1. The application

A mature line-of-business Unqork portal: a long-lived record moving through a lifecycle of
roughly a dozen statuses, worked by about nine roles (internal staff, external clients, third
parties), in two UI languages. It had role-specific dashboards with buckets and charts, a
multi-step questionnaire of a couple of hundred fields, a large document-management
subsystem, reusable per-customer templates, notifications, audit history, reports, bulk
operations and user administration. Identity was OIDC SSO. A separate domain service held the
persistent business data.

A second, similar application (another region) followed and turned out to share most of its
backend contract; see [12](12-incremental-conversion.md).

## 2. The export, in numbers (one app)

| | |
|---|---|
| Module JSON files | ~150 |
| Components | ~16,700 |
| Frontend modules | 77 |
| Server-side API modules | 60 exported, **96 referenced** |
| Data Collection CSVs | 26 |
| Components carrying role permissions | ~540, across 13 role ids |
| External API calls (the real contract) | 59 integrators, 47 paths, 54 operations |
| Platform hops (deleted in the rewrite) | ~830 |
| Decision tables | ~1,360 |
| Data workflows | ~1,300 |
| Hidden (state) components | ~2,600 |

Component distribution, representative of a mature app: `hidden` and `initializer` first,
then `textfield`, `button`, `decision`, `dataworkflow`, `field-group`, `columns`, `integrator`,
`panel`.

**Export defects found at intake:** three modules failed to export (empty error markers); the
API-module folder was alphabetically truncated, losing essentially the whole write path; two
referenced Data Collections were absent; one module file was a byte-identical duplicate of an
unrelated one; there was no module metadata at all. Later export generations (see
[01](01-export-anatomy.md)) report this up front, which is the best reason to prefer them.

## 3. What it became

| | Legacy | Rebuild |
|---|---|---|
| Screens | 77 frontend modules | 18 routes |
| Backend tiers | Browser, Unqork module, Unqork API module, domain service | Browser, BFF, domain service |
| Record detail | 6 near-identical modules chosen by a `(role, status)` table | 1 route, role/status-driven |
| Dashboards | 8 role-specific grid modules | 1 dashboard, per-role config |
| Read-only screens | `X` and `X - Disabled` twins | `readOnly` prop |
| Shell | Header/footer pasted into every module | 1 `AppShell` |
| Role gating | ~540 per-component permission entries | Named domain predicates + one route table |
| Business logic | ~1,360 decision tables | Typed config and functions |

The stack is described in [05](05-target-architecture.md). A contract-simulating mock backend
implementing every operation was built early and was one of the best decisions of the project.

## 4. Sequencing that worked

1. Extraction documents first (analysis, capability register, API contract, open questions).
2. Foundations and the mock backend.
3. The hardest data path (the main list, one role) before anything else.
4. Remaining roles by configuration, then the detail screen and workflow core, then the
   largest subsystem (documents), then the big form, then admin and the long tail.
5. A dual-catalog parity diff ([06](06-parity-method.md)) before declaring anything done.

## 5. The parity pass: the phase that mattered

Two independent exhaustive catalogs (raw export vs source), diffed by domain:

| Domain | Gaps | P1 |
|---|---:|---:|
| Questionnaire | 28 | 12 |
| Record detail | 26 | 7 |
| Templates and admin | 25 | 5 |
| Documents | 24 | 4 |
| Dashboards | 19 | 2 |
| API and cross-cutting | 19 | 7 |
| **Total** | **141** | **37** |

Legacy API coverage was measured at 39 of 60 operations fully covered, 17 partial, 4 uncovered.

Findings worth remembering because they generalise:

- **Dashboard scoping.** The two highest-volume roles were not assignment-scoped and saw the
  whole book in grid, tab counts and chart. They are three queries; fixing one is not enough.
- **A write to the wrong subject.** An admin screen listed the caller's scope and its remove
  button re-posted that list against the target user's id. A live data-corruption path.
- **Permission tables collapsed into one flag**, wrong in both directions. Restored as three
  predicates with a test walking every role x status pair asserting exact true-cell counts.
- **The form rule engine barely worked.** Roughly one question in eight was never rendered;
  only 18 of 69 visibility rules could ever fire (container keys with no container-to-member
  map, transcription artefacts); `contains` was string equality instead of set membership.
- **Uploads were never classified**, so every upload was invisible to other roles.
- **A misspelt role id** (219 uses vs 14 of the correct spelling) went unhandled, and that
  user silently became a read-only stranger.
- **No 401/403 handling and no inactivity timeout** existed anywhere.
- **Bodies were `JSON.stringify`'d** that the backend expected as objects. The answer came
  from the raw export, not speculation.
- **No route-level role gating**: any role could reach any admin screen by typing its address.

All P1s were closed. Eleven of twelve test files at the end were new: the areas with the worst
defects had had no tests at all, which is not a coincidence.

## 6. What went wrong

- **Identity was raised early, went unanswered, and became the single blocker** to deploying an
  otherwise complete app. See [08](08-open-questions-template.md) Q1.
- **The export was truncated and the write path stayed inferred** for the whole project.
- **The first feature estimate ignored platform-provided behaviour** (SSO, idle timeout, file
  storage, 401 handling, hosting). See [04 §5](04-unqork-to-react-mapping.md).
- **Provisional endpoints accumulated** without a visible count until a status document made
  the number a first-class metric.
- **Lint had never gated anything** because the config file was missing entirely.
- **Data lived in Unqork itself** (submissions used as document and record stores) and was
  discovered late; see [11](11-finding-unqork-data-stores.md).

## 7. What was still blocking at the end

Nine questions, none resolvable by writing more front-end code, in cost-if-late order:
identity (bearer token or BFF); the client-information data contract; the complete API-module
re-export; file upload mechanism; sentinel values for unclassified records; a document element
shape; a user-search projection; the semantics of a derived "ageing" column; and whether a
26-field form section had been deliberately removed. Plus the production blockers beyond
parity: authentication, a reachable backend, hosting.

> The application is functionally close to parity, and it is not deployable. Both statements
> are true and they are about different things: the remaining work is dominated not by missing
> screens but by contract, identity and environment questions that no amount of front-end
> work resolves.

## 8. The lessons

1. **Extract before you build.** The capability register is what made "are we done?"
   answerable at all.
2. **Do the parity diff as two independent catalogs.** The app looked finished and was about
   70% finished.
3. **Never read a long decision table through a summarising layer.** A 25-row truncation
   produced a wrong report in both directions. Raw JSON, row counts recorded, counts asserted.
4. **Ask the identity question in week 1.**
5. **Screenshots beat the export** for arrangement, prominence, per-scope column variation and
   navigation items that appear in no module.
6. **Build the contract-simulating mock early**, with seeded named scenarios and quarantined
   provisional routes.
7. **Inventory Unqork-native persistence on day one**; it is a data migration, not a UI task.
