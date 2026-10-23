# 12. Converting one journey at a time from a fresh export

**Scope:** generic. The usual shape of a long migration is not one big conversion but a first
rebuild followed by further journeys (a second workflow, a second market, a new feature set)
converted later from a *fresh export snapshot*. This document records the method and the
lessons from doing that.

---

## 1. Start from the new snapshot, not the old notes

A fresh export is evidence of the live system *now*. Re-derive facts about the journey from it
rather than trusting earlier analysis, and record which snapshot each fact came from.

## 2. Sort the export first

If the export is one flat folder, sort modules by each JSON's own `type` before reading:

- `type: "api"` goes to `api/`; `type: "ui"` goes to `frontend/`;
- `type: "resource"` is split by content (integrators and workflows to `api/`, screens to
  `frontend/`).

Newer exports are already organised and carry a `manifest.json`; use
`node scripts/manifest.mjs <export>` to get the same view. The two halves are read for
different things: API modules answer "what does it call", UI modules answer "what does it
show, and when". Mixed together they hide both.

## 3. Fact provenance: record how you know

Every fact in the plan carries a reliability tag:

| Tag | Meaning | Example sources |
|---|---|---|
| **transcribed** | Copied mechanically from a machine-readable artefact | integrator components, decision tables, OpenAPI DTOs, button and tab tables |
| **byte-exact** | Taken from the live DOM or module JSON where the exact string matters | component keys, dropdown option values |
| **visual** | Read from a screenshot | layout, column sets, labels |
| **inferred** | Reconstructed because the evidence was not exported | bucket-to-status mappings held in an unexported Data Collection, action verbs set in unexported initialiser inputs, a missing transition |

Mark inferences *in code where they live* and list them in the open-questions table with an
owner. An inference that is written down is a reversible position; one that is not becomes a
production bug.

## 4. Map legacy constructs to rebuild constructs

Produce a two-column table (legacy construct, rebuilt as) before building. Patterns that
recur:

| Legacy construct | Rebuilt as |
|---|---|
| Two cockpits in one app, switched by a header button | One shell; the cockpit derived from a URL prefix, never from state |
| Country- or tenant-specific module set | A capability flag gating routes, nav and operations together |
| Per-role dashboard modules | One dashboard page; role picks the bucket strip, bucket picks extra columns |
| `Thing-View-<Role>` modules chosen by role | One detail page; role and status decide actions and tabs |
| A decision table mapping status to N booleans | A typed table, status to verbs, plus what each verb collects (comment, file, confirm) |
| Implicit status transitions spread across workflows | A single transitions table in shared types, read by both the UI action bar and the mock |
| Panels of hundreds of form components | A schema rendered by one form component; component keys kept byte-exact |
| Modules re-pointed at different endpoints | The existing screen with one injection point (`onSave`, a `family` table) |

## 5. Verify against a later snapshot

When a newer export arrives, diff it against the one you built from, by **module id** (stable
across exports), not by name or path:

```bash
node scripts/diff-snapshots.mjs <old-export> <new-export>
```

The output lists added, removed and changed modules. Re-read only the changed modules that
touch journeys already converted, update the affected facts and their provenance tags, and
re-run the parity diff ([06](06-parity-method.md)) for those domains.

## 6. A worked correction: stored values vs displayed labels

A first pass seeded a dropdown with invented codes and labels because the screenshot only
showed the selected label. The legacy markup, supplied from the live DOM, showed the stored
values were short codes (rendered by the old framework as `string:CODE`, where the prefix is
the framework's rendering of a string model value, not part of the stored value), with a
specific order. The fix was to use the real codes, keep the legacy order from the data source
(not sort by code), keep the labels the legacy dropdown actually shows, and pin codes, labels
and order with a test.

## 7. Lessons

- **Decision tables are the specification.** Button-visibility and tab-visibility tables give
  the whole action bar and tab strip; transcribe them as data, not `if` chains.
- **Put the state machine in shared types** when a mock exists. One table read by the screen
  and the mock turns "the button 409s" into a test failure instead of a demo surprise.
- **Reuse by seam, not by copy.**
- **A screenshot shows labels, not values.** Anything stored (dropdown codes, radio values)
  needs the DOM or module JSON. Ask early.
- **Data Collections are not always exported.** Anything a module reads from one has to be
  inferred or requested; list them as open questions on day one
  ([08](08-open-questions-template.md)).
- **Do not invent translations for reference data.** A label that matches legacy is better
  than a translation nobody confirmed.
- **Check capture folders.** Screenshot folders can be mislabelled (a folder for one journey
  containing screens of the other); verify before building from them.
- **Gate the new journey with a negative contract test** where a capability is off for some
  tenant: it must fail if the feature leaks.
- **Scope explicitly.** Write down what is out of scope for this increment.
