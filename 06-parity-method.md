# 6. Proving parity — the dual-catalog diff

The app will *feel* finished long before it is. This is the method that closes the gap between
feeling and being, and it is the highest-yield phase of the whole project.

On one large migration it found **141 gaps, 37 of them P1** — in an application that already looked complete
and demoed well. Among them: a live data-corruption path, the two highest-volume roles seeing
data outside their scope, a form rule engine in which only 18 of 69 rules could ever fire, and
zero route-level authorisation.

---

## 1. The method

```
   ┌────────────────────────┐        ┌────────────────────────┐
   │  Catalog A             │        │  Catalog B             │
   │  the Unqork export     │        │  the React source      │
   │  (walk every module)   │        │  (read src/, NOT docs) │
   └───────────┬────────────┘        └───────────┬────────────┘
               └──────────────┬─────────────────┘
                      same shape, both sides:
              pages → features & fields → API calls → role logic
                              │
                     diff, DOMAIN BY DOMAIN
                              │
                  triage P1 / P2 / P3 → fix → verify
```

Three rules make it work:

1. **Both catalogs are built independently and exhaustively.** Not "check the app against the
   spec" — build a fresh catalog of each side and diff the catalogs. Checking against a spec
   finds only what the spec knew about.
2. **The React catalog is built from `src/`, never from your own design docs.** Design docs
   describe intent; the diff must compare *reality* to *reality*. On one migration, features documented
   as complete were partially wired.
3. **Both catalogs have the same shape**, so they diff mechanically:
   `pages/views → features & fields → API calls → conditional & role logic`.

---

## 2. Building the catalogs

**Unqork side** — walk every module's component tree from the raw export:

| Per module | Record |
|---|---|
| Screen | Name, module id, who sees it |
| Features | Every button, column, field, tab, dialog, filter |
| API calls | Every integrator, its URL and mapping |
| Logic | Every decision table keyed on role or status, **with row counts** |

**React side** — from the source:

| Catalog | Record |
|---|---|
| Routes | Path, page, guards |
| Pages | Every button, column, field, dialog, tab; per-page API calls; role logic |
| API layer | Every function: method, path, params, used-by; **flag provisional and unused ones** |
| Cross-cutting | Auth, role gating, i18n, notifications, error handling, state management |

Split large catalogs by folder or domain so no single pass has to truncate. **Truncation is the
enemy of this method**: on one migration a catalog pass cut three permission tables at 25 rows, and the
resulting report was wrong in both directions until the tables were re-read from raw JSON.
Any table over ~20 rows should be read from the export directly and its row count recorded.

Before diffing, write down the caveats that would otherwise become false findings:

- Modules that failed to export (parity must come from siblings or screenshots).
- Byte-identical duplicate files (one real module, two filenames).
- Known role-string quirks.
- **Your deliberate divergences** — otherwise every improvement is filed as a gap.

---

## 3. Diffing and triage

Diff **domain by domain**, not screen by screen — a gap in role scoping shows up across six
screens and should be filed once.

Two directions, both mandatory:

- **Unqork → React**: what does the legacy app do that we do not? (missing capability)
- **React → Unqork**: what do we do that the legacy app does not? (invention, wrong endpoint,
  unused code, provisional guesses that were never confirmed)

Triage:

| | Meaning | Examples |
|---|---|---|
| **P1** | Data loss, data corruption, security/authorisation, or a capability a role cannot work without | Assignment writing to the wrong user; dashboards not scoped to the assignee; no route-level gating; no 401 handling; uploads never classified |
| **P2** | Real capability gap with a workaround | Missing filter, missing column, missing export |
| **P3** | Cosmetic or convenience | Label wording, ordering, spacing |

**Every finding cites `file:line`.** A finding without a citation gets argued about; a finding
with one gets fixed. Verify each against the React source *before* filing — a diff of two
catalogs generates false positives at a steady rate and an unverified list destroys trust in
the whole exercise.

Also measure **API coverage** explicitly: *N of M legacy operations fully covered, K partial,
J uncovered*. It is the single most legible parity number, and the uncovered list is a
to-do list.

---

## 4. What the gap classes usually are

These recur. Look for them specifically rather than waiting for the diff to surface them:

| Class | The specific thing to check |
|---|---|
| **Scoping** | Do "my work" views actually filter by assignee? Check the grid, the tab counts *and* the charts — they are often three separate queries and only one gets fixed. |
| **Writing to the wrong subject** | Admin screens that search for user X but read/write the *caller's* data. Destructive and easy to miss. |
| **Collapsed permission tables** | Any place N legacy tables became one predicate. |
| **Rule engines** | Coverage counts: fields rendered vs extracted, rules capable of firing vs extracted. |
| **Classification on create** | Uploads/records created without the categorisation the legacy flow set, making them invisible to other roles. |
| **Role-string handling** | The misspelt-role id. |
| **Auth edges** | 401, 403, idle timeout, route guards. |
| **Wire-format drift** | Bodies stringified that should be objects (or vice versa), renamed fields, dropped headers. |
| **Terminal/edge statuses** | Behaviour at cancelled/closed/rejected states, which nobody demos. |

> **Settle wire-format questions from the raw export, not by guessing.** One migration shipped record
> create/update broken because bodies were `JSON.stringify`'d. The answer was in the export:
> the integrator's mapping placed the value into the body verbatim, and neither `stringify`
> nor `toString` appeared anywhere in the call path. Ten minutes of reading beat a week of
> speculation.

---

## 5. Fixing, and proving the fix

- **Close all P1s before anything else.** Publish the count and the list.
- **Write a test per fix that would have caught it.** The count-assertion pattern is the most
  effective one available here: a test walking all `role × status` pairs and asserting the
  true-cell counts match the legacy row counts exactly, so silently adding or dropping a role
  fails the build.
- **Gates:** `tsc --noEmit` clean, tests green, production build succeeds, lint actually runs.
  Check that last one — on one migration lint had never gated anything because the config file was
  absent entirely.

---

## 6. Publish what is blocked, and do not guess

Some gaps cannot be closed from the front end. Publish them as a table: *question · what it
blocks · owner · risk if deferred*. Being wrong on a wire format is worse than being absent,
and a documented blocker is a decision someone else can make.

Where you must proceed anyway, **implement tolerantly and say so**: accept either shape, note
what confirming would let you delete. That is a deliberate, reversible position; a guess is
not.

---

## 7. Write the status document

At the end, one document answering *what still stands between this app and replacing the
legacy one?*

| Section | Contents |
|---|---|
| Where it stands | Parity, API coverage, verification, backend, auth, count of blocking questions |
| Blocked on an answer | The table above, ordered by cost-if-answered-late |
| Production blockers beyond parity | Auth, real backend, hosting, CSP — the things Unqork provided |
| Deferred parity | Triaged P2/P3 that are not being done, and why |
| Not yet scoped | Anything discovered but never estimated |

The distinction worth stating plainly, because stakeholders conflate them constantly:

> *The application is functionally close to parity, and it is not deployable.* Both are true
> and they are about different things. The remaining work is dominated not by missing screens
> but by **contract, identity and environment** questions that no amount of front-end work
> resolves.

Say that in month two, not month six.

---

## 8. Machine-readable outputs

Emit the findings as JSON validating against
[schemas/parity-catalog.schema.json](schemas/parity-catalog.schema.json) (`domain`, `item`,
`legacySource`, `rebuildSource`, `status: match|gap|extra`, `priority: P1|P2|P3`). The
Unqork-side catalog is built from the Phase 1 outputs, which validate against
[module-map](schemas/module-map.schema.json),
[capability-matrix](schemas/capability-matrix.schema.json) and
[page-api-map](schemas/page-api-map.schema.json). A diff is then a join on those files, and
"P1 count is zero" becomes a command, not an opinion:

```bash
node -e "const c=require('./DOCS/inventory/parity-catalog.json'); process.exit(c.filter(x => x.status !== 'match' && x.priority === 'P1').length ? 1 : 0)"
```
