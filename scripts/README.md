# Export mining scripts

Zero-dependency Node scripts (Node 20+, ESM) that turn an Unqork export into readable Markdown.
Each writes to stdout; redirect to a file. `manifest.mjs`, `diff-snapshots.mjs`,
`integrators.mjs` and `inventory.mjs` also take `--json`.

```bash
EXPORT="/path/to/export/root"        # the folder holding the module folders (and manifest.json, if any)
mkdir -p out

node manifest.mjs        "$EXPORT"                    # start here: is the export complete?
node inventory.mjs       "$EXPORT"                    > out/inventory.md
node integrators.mjs     "$EXPORT" [--services registry.md]  > out/api-surface.md
node permissions.mjs     "$EXPORT"                    > out/permissions.md
node decisions.mjs       "$EXPORT" [filter]           > out/decisions.md
node datacollections.mjs "$EXPORT" --emit out/reference > out/reference.md
node diff-snapshots.mjs  "$OLD_EXPORT" "$NEW_EXPORT"
```

| Script | Produces | Read it for |
|---|---|---|
| `manifest.mjs` | Generation, application id, environment, module counts by type, failures / `possibly_truncated`, Data Collection counts, manifest-vs-disk mismatches, unresolved module-id references, junk candidates | **Completeness** of the export |
| `inventory.mjs` | Component counts by type, per module; role ids; manifest failures (or `*_Error.txt` markers) | Scale, shape, and whether the export is intact |
| `integrators.mjs` | External calls (the real contract) vs platform hops; Data Collections queried; module ids resolved against what was exported | **The API contract**, and truncation detection |
| `permissions.mjs` | Every component with a non-empty `permissions` map + role frequency table | The role matrix, and the misspelt-role bug |
| `decisions.mjs` | Every decision table in full, with row counts. Optional filter substring. | The business rules |
| `datacollections.mjs` | Audit of CSV *or* JSON Data Collections (shape, rows, mojibake, multi-value columns); with `--emit`, JSON + per-locale i18n dictionaries | Reference data and i18n |
| `diff-snapshots.mjs` | Modules added / removed / renamed / changed between two exports | What moved since the last pull |

## Export generations

The scripts detect the layout; you do not pass it. `lib.mjs` `readExport()` is the single reader.

| | Layout | Module file | Metadata |
|---|---|---|---|
| **a** legacy manual | `Frontend Modules`, `Frontend Modules2..n`, `API Modules`, `Other Data Storage`, `Data Collection` (CSV) | bare JSON array of components | none: no ids, no types (type is guessed from the folder name); failures are `*_Error.txt` markers and unparseable files |
| **b** scripted | `manifest.json` `{application_id, environment, module_count, failures[], modules[]}`, `filename_map.json`, folders `api/` `frontend/` `datacollections/` (CSV) | object `{_id, name, title, type, deleted, components, …}` | manifest + filename map (id → file) |
| **c** scripted | `manifest.json` `{application_id, downloaded[], failed, possibly_truncated, data_collections_downloaded, data_collections_failed}`, folders `API Modules` `Frontend Modules` `Other Modules` `Data Collections` (JSON row arrays) | same object shape as b | manifest `file_name` per module |

`type` is `ui`, `api` or `resource` in b/c. `manifest.json`, `filename_map.json` and everything under a
Data Collections folder (any casing) are never treated as modules. Data Collections are read by
`datacollections.mjs`, which accepts either the export root or the collections folder itself.

## Flags

- `--json` — machine-readable output (`manifest`, `diff-snapshots`, `integrators`, `inventory`).
- `integrators.mjs --services <file>` — a markdown or CSV table of the tenant's service registry
  (columns `title`, `name`, `auth`, `host`). Adds a host column to the named-services table and lists
  services referenced but not registered, and registered but never referenced.
- `datacollections.mjs --emit <dir>` — write each collection as JSON, plus one dictionary per locale
  for `value`/`locale`/`label` tables.
- `decisions.mjs <filter>` — only tables whose component key or module path contains the substring.

`diff-snapshots.mjs` matches modules by id, so it works across b and c. If either side is a legacy
export (no ids) it matches by bare filename and warns on stderr. "Changed" means a different
`modified` timestamp, else different parsed components (raw byte size is not comparable across
generations, which serialise differently).

`lib.mjs` holds the shared reader and tree walker. Note `COMPONENT_CONTAINERS` there: components are
only recursed through `components` / `columns` / `rows` / `panels` / `tabs`. Walking every object that
happens to carry a `type` also picks up every data-workflow *operator* (`Get`, `Set`, `Output`,
`Formula Value`, …) and inflates the component count by roughly 80%.

## Things to check the moment you have the output

1. **Truncated export** — run `manifest.mjs`. With a manifest, look at `failures`,
   `possibly_truncated`, "in manifest, no file" and "unresolved module-id references": module ids the
   frontend calls that were never exported (the referencing module is named). Without a manifest
   (generation a), compare `integrators.mjs`'s distinct-id count with the number of API module files.
   Unresolved references that point only at junk candidates (deprecated / copy / backup modules) are
   usually harmless; anything else is a re-export request to raise today.

2. **Misspelt role ids** — `inventory.mjs` and `permissions.mjs` both print the role frequency table.
   Two ids differing by one character are one role (e.g. `role-handler` ×219 vs `role-hander` ×14).

3. **Export failures** — `manifest.mjs` / `inventory.mjs` list manifest failures, or for a legacy
   export the `*_Error.txt` markers and unparseable files. Those modules are unrecoverable from this
   export; parity must come from sibling variants, screenshots or a re-export.

## Extending

The walker gives you `(component, ancestorKeys)` for every component in the export, so one-off
questions are usually a ten-line script. Each module is
`{ file, rel, id, name, title, type, kind, deleted, size, components }` (`kind` = `type`, else guessed
from the folder).

```js
import { readModules, walkComponents, exportRoot } from './lib.mjs';

const root = exportRoot('mine.mjs');
for (const mod of readModules(root)) {
  walkComponents(mod.components, (c, path) => {
    if (c.type === 'content' && /<script|angular\.element/.test(JSON.stringify(c.html ?? ''))) {
      console.log(`${mod.name ?? mod.rel} › ${path.join(' › ')} › ${c.key}`);
    }
  });
}
```
