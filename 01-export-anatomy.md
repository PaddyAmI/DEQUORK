# 1. Anatomy of an Unqork export — and what is missing from it

You will typically be handed a shared-drive folder or a set of zips. This is what is in it,
what it means, and — more importantly — **what is reliably absent**.

First question, before anything else: **which generation of export is this?** The answer
decides how much of section 3 applies to you.

---

## 1. Export generations

| Generation | How to recognise it | Module identity | Completeness signal |
|---|---|---|---|
| **(a) Manual / legacy** | Folders `Frontend Modules`, `Frontend Modules 2..4`, `API Modules`, `Other Data Storage`, CSV `Data Collection`; each file is a **bare JSON array** of components; `*_Error.txt` / `___All_Errors.txt` markers; some files unparseable or truncated | None. Reconstructed from filenames and caller references | None. Count by hand (§3) |
| **(b) Tool-based, v1** | `manifest.json` `{application_id, environment, module_count, failures[], modules[{id,name,title,bytes,quick_link}]}` plus `filename_map.json` (filename → id); lowercase `api/ frontend/ datacollections/`; collections are CSV | Exact (manifest + file contents) | `failures[]`, `module_count` vs files on disk |
| **(c) Tool-based, v2** | `manifest.json` `{application_id, downloaded[{id,name,title,file_name,size,quick_link}], failed, possibly_truncated, data_collections_downloaded, data_collections_failed}`; folders `API Modules`, `Frontend Modules`, `Other Modules`, `Data Collections`; collections are **JSON arrays**, not CSV | Exact | `failed`, `possibly_truncated`, `data_collections_failed` |

Generations (b) and (c) are far better. If you are about to commission an export, ask for a
tool-based one with a manifest. Everything in this pack works on any generation;
`scripts/datacollections.mjs` reads CSV or JSON.

Other contents you may find alongside, whatever the generation:

| Folder | Contents | Format |
|---|---|---|
| `Users and Roles` | Platform user export | CSV |
| `Assets` | Images, icons, logos, webfonts | PNG/SVG/WOFF |
| `styles` | Compiled theme bundles | CSS |
| *(business folder)* | Process diagrams, workshop decks, data dictionaries, blank forms | docx/vsdx/pptm/xlsx/pdf |
| `*.zip` at root | Same content as the sibling folders — ignore | |

In a legacy export the numbered `Frontend Modules` folders are split purely by export batch
limits — the numbering carries **no meaning**, related screens are scattered across all of them.

**Do not skip the business folder.** It often describes *phase-2 functionality that is not in
the app*, which is exactly the material a naïve reader mistakes for a parity requirement. Mark
it explicitly as out of scope, in writing, early.

### Environments and snapshots

An export carries an **environment** (QA, staging, prod). Module ids are **stable across
snapshots of the same environment** but may differ between environments, and between
applications. So:

- Never mix files from two environments in one analysis without labelling them.
- Track change over time by diffing snapshots **by id**: added, removed, renamed, size
  changed, `modified` changed. `node scripts/diff-snapshots.mjs <old> <new>` does this.
- Keep the snapshot date in every artefact's "Source:" line.

---

## 2. Module JSON shape

### 2.1 Module wrapper (generations b and c)

Each module file is an **object**:

```jsonc
{
  "_id": "<moduleId>", "title": "…", "name": "…",
  "type": "ui" | "api" | "resource",     // resource = CSS, schemas, email templates, etc.
  "display": "…", "tags": [], "deleted": false, "owner": "…",
  "components": [ /* the flat component array — see 2.2 */ ],
  "settings": {}, "archive": [], "fields": [], "componentFields": [], "children": [],
  "applications": [], "workspaces": [], "lock": {}, "created": "…", "modified": "…", "__v": 0,
  "elementPermissions": {}, "assumeRoles": [], "assumeGroups": [],
  // sometimes: fieldMappings, promotions, dataModels, description, customAssets
}
```

`_id` is the exact module id used by callers; `type` tells you which folder-independent bucket
the module is in. In a legacy (a) export none of this exists — the file *is* the `components`
array.

### 2.2 Component array

A module's `components` is a **flat-looking array of component objects**, nested via each
component's `components: []`. Skeleton:

```jsonc
[
  {
    "key": "panelInfo",
    "type": "panel",
    "components": [
      { "type": "hidden", "key": "method", "defaultValue": "POST" }
    ],
    "ancestors": ["root"],
    "componentId": "<uuid>",
    "permissions": {}
  }
]
```

Universal fields on nearly every component:

| Field | Meaning | Use it for |
|---|---|---|
| `key` | The component's name **and** its slot in `submission.data` | Everything. This is the identifier. |
| `type` | Component type — see [02](02-component-reference.md) | Classification |
| `label` | Human label (often duplicated from `key`) | Screen documentation |
| `components` | Children | Tree walk |
| `ancestors` | Path from `root` — e.g. `["root","panelRequest"]` | Reconstructing containment without recursion |
| `componentId` | Stable UUID | Deduplication, cross-referencing |
| `permissions` | `{ "<role-id>": "none" \| "readOnly" \| … }` | **The role matrix.** Non-empty means role-gated. |
| `creator`/`modified` | Audit trail | Dating behaviour, spotting dead code |
| `customClass` | CSS class(es) | Recovering active/inactive state, layout intent |
| `trigger`, `watcherList` | Component fired on change; components watching this one | Behaviour chains (see [02](02-component-reference.md#how-field-behaviour-is-actually-driven)) |

`$$hashKey`, `wasDropped`, `parentChanged`, `$activeRuntime`, `react`, `vegaEnabled` are
editor/runtime noise. Strip them before diffing anything.

---

## 3. What is missing — check for each of these on day 1

Structural limitations of Unqork's export tooling. Items marked **(legacy)** mostly disappear
when you have a manifest.

### 3.1 Module metadata (legacy)
A **manual export has no module id, no module title, no module-level permissions, no
workflow definitions**. A file is a bare array. Without a manifest, identity must be
reconstructed:

- from the **filename** (a title, not an id, and frequently misspelled — expect
  `Dashjboard`, `Notificaton`, `Quesitionnaire`), and
- from **module ids referenced by callers** (`/fbu/uapi/modules/{id}/execute`,
  `/fbu/uapi/modules/{id}/components`, and `(role,status)→moduleId` reference tables).

Treat that map as inferred rather than known. With a manifest (b/c) the map is exact; just
build it once into a table.

### 3.2 Truncation and failed modules
**Without a manifest**, exports are frequently *alphabetically truncated*. On one large
migration the `API Modules` folder held exactly 60 files ending alphabetically part-way
through the `G`s while frontend modules referenced ~96 distinct module ids; everything after
that — **the entire write path** — was gone. Count distinct module ids referenced by frontend
integrators, compare against the file count, and raise a re-export request that day.

**With a manifest:**

1. Read the failure fields: `failures[]` (b) or `failed` / `possibly_truncated` /
   `data_collections_failed` (c). Each entry is a re-export request.
2. **Diff manifest against files on disk** — modules listed but missing, files present but not
   listed, byte sizes that disagree.
3. **Resolve every referenced `/fbu/uapi/modules/{id}/…` against the manifest.** The handful
   that do not resolve are normally *dangling references* from deprecated or copy modules, or
   to modules outside this application. They are not truncation. Record them, do not chase them.

`scripts/manifest.mjs` does all three checks.

### 3.3 Silently failed modules (legacy)
Some modules fail to export and leave a marker — typically `__ModuleName.json_Error.txt`
(usually **empty**) plus `___All_Errors.txt`. Always `ls` for `*_Error.txt` before assuming the
module set is complete. Parity for the missing ones has to come from sibling role-variants,
screenshots, or a re-export.

### 3.4 Referenced-but-absent Data Collections
Frontend modules query collection names that are not in the export (error-code tables and
minor translation tables are the usual casualties). Cross-reference every
`/fbu/uapi/query/{name}/all` against the collections folder.

### 3.5 Runtime-built grid columns
`viewgrid` and `inlineGrid` column lists are frequently **empty in the export** (about 44% of
`viewgrid`s in one large app) because they are constructed at runtime by a data workflow.
Recover the columns from the `dataworkflow` that populates the grid, or from a screenshot. Do
not report "the grid has no columns".

### 3.6 No backend source
The domain service is a black box. Every request shape you derive is reconstructed from
integrator input mappings, and every **response** shape is inferred from what the UI consumed.
State it in your OpenAPI file's description: *requests reliable, responses inferred.*

### 3.7 No arrangement, prominence, or per-scope variation
The export tells you a button exists and what it calls. It does not tell you where it sits,
how prominent it is, or that the same grid shows seven columns in one tab and ten in another.

**This is what screenshots are for.** Two screenshots of a running app once produced findings
not derivable from the export at all, including a whole navigation item that appeared in no
module. Ask for one screenshot per role, per major screen. It is the cheapest artefact in the
project.

### 3.8 Junk modules
Exports include modules nobody uses. Tag and exclude them from counts and parity before they
inflate the work. Name markers: `Deprecated`, `To-Be-Deleted`, `Copy`, `Bkp`, or a person's name
as a suffix. Also check `deleted: true` and old `modified` dates. They are the usual source of
the dangling references in §3.2. Keep the list; do not silently delete it.

---

## 4. The intake checklist

Run this before writing a line of anything.

```
[ ] Identify the generation (§1). Manifest present?
[ ] node scripts/manifest.mjs "<export>"   → failures, files-vs-manifest, unresolved module ids
[ ] (no manifest) ls **/*_Error.txt        → note unrecoverable modules
[ ] Unzip; confirm zips duplicate folders and ignore them
[ ] Record application_id, environment and snapshot date
[ ] node scripts/inventory.mjs   → component counts by type, per module
[ ] node scripts/integrators.mjs → API surface + distinct module-id count
[ ] (no manifest) distinct module ids vs API file count → re-export request?
[ ] Tag junk modules (§3.8)
[ ] Cross-reference /query/{name}/all vs the collections folder → missing tables?
[ ] Open every collection; check for mojibake (see 07 §2)
[ ] grep for '<script'  and '<style' inside content components
[ ] grep for 'angular.element' → the escape hatches
[ ] List distinct `service` names on external integrators → request the service registry (§5)
[ ] Request the identity-provider / SSO configuration (§6)
[ ] Identify the (role, status) → moduleId table if one exists
[ ] Identify all `-Disabled` / role-variant module twins
[ ] List distinct role ids seen in `permissions` keys → spelling check (07 §1)
[ ] Mark the business/spec folder as in- or out-of-scope, in writing
[ ] Request: screenshots per role per screen; a re-export if needed; backend contact
```

---

## 5. The service registry (not in the export)

Integrators with `serviceType: "external"` do **not** carry a host. They name a `service`, and
the tenant's **service registry** resolves it at runtime to a base URL and an auth type
(e.g. `oauth2-client-credentials`). What the export holds is only a relative path
(`integratorData.integratorUrl`). So the export alone cannot tell you where the backend is or
how to authenticate to it.

**Request the registry, per environment.** For each entry you want: title, name, auth type,
host, and an in-use flag. Then:

- Reconcile the distinct `service` names found in integrators against the registry. Unused
  entries are not your scope; names in integrators but missing from the registry are a defect
  or a different environment.
- Expect **non-domain services** alongside the domain ones: document generation,
  notifications/email, document stores, address lookup. Each is a separate dependency you must
  replace or re-wire.
- Service names are free text, so they carry typos exactly like role ids (07 §1). Preserve the
  registry's spelling when you refer to a service.
- Hosts differ per environment; the auth type is the item that shapes your backend
  authentication design.

---

## 6. SSO and role derivation (not in the export)

The identity-provider (IdP) configuration is **not in the export**. Request it. What you need:

- **Claim mapping.** Unqork maps OIDC claims to user attributes — typically `userId`, `name`,
  `userType`, `firstName`, `lastName`, `userGroups`, `userRole` — which components read through
  `currentUser`.
- **Role derivation.** The single `userRole` is often *computed*, not asserted by the IdP: a
  Jinja `if / elif` chain over the `groups` claim. Properties to document:
  - it is **priority-ordered, first match wins**;
  - a user in several groups receives **one** role, the highest-priority match;
  - no match falls through to a fallback such as `Unverified`.
- **Spelling.** Component `permissions` keys are *role ids*. The IdP's group names and the
  derived role strings may spell differently from the ids used in `permissions` (07 §1). Build
  a three-column table: IdP group → derived role → role id seen in `permissions`. A mismatch
  there is a user who silently loses all access.
- **Which attributes are propagated downstream** (see [00 §4](00-what-unqork-is.md)): usually
  user id, email, role, name and locale, as headers on integrator calls.

Port the derivation as an explicit, tested function (ordered rules, fallback), not as
scattered `if`s.

---

## 7. What good extraction output looks like

By the end of intake you should be able to hand someone these artefacts. Everything downstream
is built from them.

| Artefact | Form | Source in the export |
|---|---|---|
| **Module map** | table: file ↔ moduleId ↔ screen ↔ visible-to | manifest, or filenames + caller references |
| **API contract** | OpenAPI 3.1 yaml | `integrator` components with a real `serviceType` |
| **Service & auth register** | table: service ↔ host ↔ auth type ↔ purpose | service registry (requested) + integrator `service` names |
| **Capability matrix** | role × status × action, + all component `permissions` | `decision` tables + `permissions` keys + SSO role derivation |
| **Domain model** | status codes, sub-statuses, buckets, state machine | Data Collections + hidden fields |
| **Reference data** | typed config + i18n dictionaries | Data Collections |
| **Form schemas** | field list + types + behaviour (visibility, required, value) | field components + the `decision` outputs and workflow Output nodes that target them |

See [03-extraction-playbook.md](03-extraction-playbook.md) for how to produce each one.
