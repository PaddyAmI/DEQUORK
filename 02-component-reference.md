# 2. Unqork component reference — the decoder ring

Every component type you will meet, its JSON shape, what it actually does, and what it becomes
in React. Keep this open while reading an export.

The counts below come from **one large line-of-business app (~590 modules)** — useful for
calibrating expectations, not a rule. Types marked *not observed*
are documented in Unqork material but never appeared in that app; they may exist in yours.

| Type | Count | It is really… | React equivalent |
|---|---:|---|---|
| `hidden` | 7,210 | The app's state store | Component state / query cache / URL |
| `initializer` | 3,742 | The event bus | Event handlers, `useEffect` |
| `dataworkflow` | 3,294 | Dataflow pipelines | Selector / mapper function |
| `textfield` | 3,269 | Text input | Design-system input |
| `decision` | 2,761 | Lookup tables — and the **driver of field behaviour** | `Record<K,V>` / pure function |
| `columns` | 2,676 | Layout grid | CSS grid / flex |
| `button` | 2,536 | Fires an event | Button + handler |
| `panel` | 2,522 | Container; ~41% are modals | `<Dialog>` or `<section>` |
| `field-group` | 2,356 | Layout container | `<div>` / fieldset |
| `integrator` | 2,140 | HTTP call | API client method (or **deleted**) |
| `htmlelement` | 1,559 | Static markup / injected HTML | JSX |
| `number` | 1,104 | Numeric input; currency = `currencyCode` on `number` | Number / money input |
| `content` | 772 | HTML, and the escape hatches | JSX (read first!) |
| `infotable` | 605 | Inline static lookup table | Config constant |
| `inlineGrid` | 480 | Repeating editable rows | `useFieldArray` |
| `transformer` | 476 | Server-side JS/JSONata | Real code — read every one |
| `basicDropdown` | 475 | Dropdown (static or data-driven options) | Select |
| `dateinput` | 336 | Date picker | Date input |
| `radio` | 294 | Radio group | Radio group |
| `select` | 249 | Select | Select |
| `checkboxv2` | 199 | Checkbox | Checkbox |
| `viewgrid` | 190 | Server-paginated table | TanStack Table + Query |
| `textarea` | 181 | Multiline text | Textarea |
| `selectboxes` | 127 | Multi-check group | Checkbox group |
| `email` | 46 | Email input | Input + validation |
| `file` | 44 | File upload | Upload component |
| `navigation` | 32 | Tab/wizard container | Tabs or a step wizard |
| `phonenumber-v2` | 32 | Phone input | Phone input |
| `chart` | 27 | Pie/column charts | Recharts |
| `table` | 26 | Static/read-only table | `<table>` |
| `timer` | 14 | Polling / delayed trigger | `refetchInterval` |
| `freeFormGrid` | 10 | Free-positioned layout grid | CSS grid |
| `filestorage` | 1 | SFTP/FTP client (list / get / put) | Backend job |
| `richtexteditorv2` | 1 | Rich text input | Rich text editor |
| *not observed:* `currency`, `signature`, `address`, `datetime`, `checkbox`, `phoneNumber` | — | Older/other type names | Design-system equivalents |

Note the real spellings: `dateinput`, `checkboxv2`, `phonenumber-v2`. Older docs and other
tenants use the *not observed* names; check which your app uses before writing a mapper.

---

## How field behaviour is actually driven

The most common wrong assumption: "visibility, required and derived values live on each field
as `conditional` / `logic` / `calculateValue`". **In the observed exports those properties
appeared on zero components.** (They are the Form.io-style mechanism and may appear in other
apps — grep for them, do not assume.)

Behaviour is *pushed onto* fields from outside:

1. A field changes, or a button fires, or a module opens.
2. The component's `trigger` property names a component to fire on change (an `initializer`,
   `decision`, `dataworkflow` or `integrator`). `watcherList` lists the components watching it;
   `refreshOn` re-evaluates on named keys.
3. A `decision` table or a `dataworkflow` Output node writes **properties** onto target
   components. For a decision, the output column header is `<targetKey>_<suffix>`.

Output suffix census (decision-table output columns, one large app):

| Suffix | Count | Sets this property on `<targetKey>` to the cell value |
|---|---:|---|
| `trigger` | 1,948 | Fire the component (cell is `GO`) — chains behaviour |
| `clear` | 1,267 | Clear its value (yes/no) |
| `visible` | 1,186 | Visibility (yes/no — "no" hides) |
| `hidden` | 762 | Hidden (yes/no) |
| `value` | 680 | Its value (the cell content — a derived field) |
| `disabled` | 458 | Disabled (yes/no) |
| `required` | 366 | Required (yes/no) |
| `customClass` | 360 | CSS classes (active tab, emphasis) |
| `page` | 270 | Navigate to the page/module in the cell |
| `readOnlyView` | 255 | Read-only rendering (yes/no) |
| `pageOpen` | 227 | Open the page/module in the cell (variant of `page`) |
| `requiredAndVisible` | 71 | Required and visible together (yes/no) |
| `min` / `max` | 51 / 51 | Numeric/date bound |
| `popError` | 20 | Raise the error message in the cell |
| `prefix` / `message` / `label` | — | Field prefix text / message text / label text (cell is the string) |

**The suffix names the property; the cell value decides it.** `<key>_visible` with cell `no`
hides the field; with `yes` shows it. A row that does not match writes nothing. The target and
the property are recorded in the table's `decisionData.dataOutputObject[].type`.

Other field properties that carry behaviour: `persistent` (whether the value is stored in the
submission), `dataSource` and `data.dataReferenceKey` (where options come from), and
`clearOnHide` (common on some types — worth honouring where `true`, but verify it is actually set
on the fields you port rather than assuming it).

**Porting rule:** to build a form's behaviour, enumerate the decision tables and workflow
Output nodes that name each field, not the field's own properties. Model the result as
declarative rules over a form state (visible / required / disabled / value / error) and
re-evaluate on change. See [03 Step 5](03-extraction-playbook.md#step-5--form-schemas).

---

## Behaviour components

### `integrator` — the API surface

The most valuable component type in the export. **Extract these first.**

```jsonc
{
  "key": "pluginGetCaseList",
  "type": "integrator",
  "serviceType": "unqork",                    // ← unqork = internal hop; else = real service
  "requestType": "put",
  "service": null,                            // ← the named external service, when not unqork
  "unqorkApi": "/modules/{moduleId}/execute:put",
  "integratorData": {
    "integratorUrl": "/fbu/uapi/modules/<moduleId>/execute",
    "dataInputObject": [ /* request field mapping */ ],
    "dataOutputObject": [ /* response field mapping */ ]
  },
  "triggerType": "manual",
  "postTrigger": "dwfCaseList",               // ← what runs on success
  "urlPlaceholders": false,
  "preRequestTransform": null
}
```

Reading it:

| Field | What you learn |
|---|---|
| `serviceType` | `unqork` (~89% of integrators in one app) → **delete in the rewrite**. `external` → real backend call, keep. |
| `service` | Name of an entry in the tenant's **service registry**; the host and auth are *not* in the export (see [01 §5](01-export-anatomy.md)). |
| `integratorData.integratorUrl` | The path. Contains `{placeholders}` when `urlPlaceholders: true`. For external services it is relative to the registry host. |
| `requestType` | HTTP verb. |
| `dataInputObject` | **The request body/params** — reliable. Each entry maps a submission key to a request field, sometimes with `"mapping"` naming the target. Entries with `header: true` become request headers (see below). |
| `dataOutputObject` | Which response fields the UI consumed — a *lower bound* on the response shape, never the full contract. |
| `triggerType` | `manual` / `new` / `watch` (see `initializer`). |
| `postTrigger` | What runs on success (present on ~81%). Usually a data workflow that maps the response; read it to learn the real response structure. |
| `errorHandler` | Present on only ~12% — most calls have **no** explicit error path. Where present: usually an initializer → shared HTTP-status `decision` → error modal. |
| flags | `doNotLookForDataKeyInResponse`, `allowSingleRecordArray`, `topLevelArray`, `arrayKeyPromote`, `assignEmptyValues` — shape how the response is unwrapped. Read them: they tell you whether the body is an array, a single record, or keyed. |

**Header injection.** `dataInputObject` entries with `header: true` are sent as HTTP headers.
Typical set, fed from `currentUser`: `x-user-id`, `x-user-email`, `x-user-role`, `x-user-name`,
and `x-locale`. Lift them out of the per-call mappings into one shared header definition — and
see the security warning in [00 §4](00-what-unqork-is.md).

**HTTP-status routing.** A shared decision (commonly named like `ruleHTTPresponses`) keyed on
the response code (e.g. `sse['httpResponseCode']`) is the common pattern. It is your **HTTP
status → message contract**; port it into the API client once, centrally. Since only ~12% of
integrators wire an `errorHandler`, also decide what the *other* 88% do on failure — it is
usually "nothing", and the rewrite should not copy that.

Internal-hop (`serviceType: unqork`) URL patterns and what they mean:

| Pattern | Meaning | Fate |
|---|---|---|
| `PUT /fbu/uapi/modules/{id}/execute` (most) | Run a server-side API module | Deleted — call the service directly |
| `GET /fbu/uapi/query/{Collection}/all` | Read a Data Collection | Becomes a config constant or i18n dictionary |
| `GET /fbu/uapi/modules/{id}/components` | Fetch another module's UI to inject | Deleted — becomes a lazy route |
| `POST /fbu/uapi/transformer` | Server-side transform | Port the transform into TS |
| `GET /fbu/uapi/system/getSubmissions` | Query Unqork submission storage | Needs a real data home |
| `POST /fbu/uapi/submissions/attachments` | Write file records | Needs real object storage |
| `POST /fbu/uapi/modules/{id}/submissions` | Write a submission | Needs real object storage / DB |
| `POST /fbu/uapi/workflow-execute/{name}/start` | Kick an Unqork workflow | Usually error handling; re-implement or drop |

> **File uploads.** The near-universal Unqork idiom is two-step: upload to submission storage
> (a module holding a document URL), then register the resulting submission id with the
> domain service. There is no equivalent in a React app. This is always an open question —
> presigned URLs or proxy through the service? See [08](08-open-questions-template.md) Q4.

### `decision` — the business rules (and the field-behaviour driver)

```jsonc
{
  "key": "ruleNavigation",
  "type": "decision",
  "linked": {
    "inputs":  ["currentPage", null],
    "outputs": ["btnDashboard", "btnReports", null]
  },
  "decisionData": {
    "decisionType": "first",
    "dataHeader": [ /* column headers */ ],
    "dataInputObject": [ /* input column definitions */ ],
    "dataOutputObject": [ /* output column definitions */ ],
    "dataObject": [
      { "currentPage": "dashboard", "btnDashboard_customClass": "nav-btn active-button" },
      { "currentPage": "reports",   "btnReports_customClass":   "nav-btn active-button" }
    ]
  }
}
```

- `linked.inputs` are the columns matched on; `linked.outputs` are the components written to.
- Output column names are `{componentKey}_{suffix}` — see the suffix census above.
- **`decisionType`**: `"first"` = rows are matched top-down and the **first match wins**;
  `"merge"` = **every matching row** contributes and their outputs are merged (later rows
  overwrite earlier on the same column). A `merge` table is a set of independent rules, not a
  `switch`; porting it as first-match drops outputs. Check `decisionType` on every table.
- The table is exhaustive enumeration, not expressions.

**Reading rule: what is absent is load-bearing.** A role or status that appears in *no row*
gets nothing. On one migration three header-permission tables enumerated only nine of fourteen
statuses, so five statuses granted no one the button — a fact that a naïve
`isInternalRole && !isReadOnly` predicate got wrong in both directions at once. Always record
the **row count** of each table, and assert it in a test after you port it:

```ts
// 5 roles × 9 statuses = 45 rows, exactly as in the legacy table.
// A test walks all role×status pairs and asserts the true-cell counts are 45 / 36 / 27,
// so silently adding or dropping a role fails the build.
```

That single technique caught more regressions than any other.

**Long tables.** Raw JSON tables reach 82 rows (and more) with no truncation. If a table
appears cut at ~25 rows, that is a viewer or catalog-tool limit, not the export — re-read from
the raw JSON (07 §6).

### `dataworkflow` — the data pipelines

The graph lives in a **GoJS diagram**, not in a flat operation list:

```jsonc
{
  "key": "dwfCaseList",
  "type": "dataworkflow",
  "triggerType": "manual",
  "dataworkflowData": {
    "dataInputObject": [{ "id": "pluginGetCaseList", "inputLabel": "…" }],
    "dataOperationObject": [ { "dataOperation": "Filter", "key": "…", "label": "…" } ],
    "goDiagram": {
      "model": {
        "nodeDataArray": [ /* operator nodes: category/type, text, config */ ],
        "linkDataArray": [ { "from": 1, "to": 2, "frompid": "O1", "topid": "I1" } ]
      }
    }
  }
}
```

- **Nodes** are in `goDiagram.model.nodeDataArray`; **wires** are `linkDataArray` entries
  `{from, to, frompid, topid}` where `frompid` is an output port (`"O1"`) and `topid` an input
  port (`"I1"`). Rebuild the graph from nodes and links; do not read `dataOperationObject` for
  the topology.
- `dataOperationObject` entries only carry `dataOperation`, `key`, `label` — they are an
  index, **not** `input1/output1/option1` triples.
- **Output nodes carry an `action`**: `value`, `trigger`, `visible`, `hidden`, `customClass`,
  `page`, `clear`, `disabled`, `popError`, `pageOpen`, `readOnlyView`, `content`. Same vocabulary as the decision-suffix
  table: a workflow Output node with `action: visible` is a computed show/hide, so workflows
  drive field behaviour too.

44 operator types exist. Node counts across one large app (most common first) and what they
mean:

| Operator | Nodes | Meaning | TS equivalent |
|---|---:|---|---|
| Output | 8,073 | Emit a value, or apply an `action` to a target component | return value / state setter |
| Input | 6,115 | Read a key, an integrator result, or a trigger input | function parameter |
| Create Value | 3,352 | Literal or template constant (Jinja-style text) | `const` / template string |
| Decision | 1,974 | A lookup table evaluated inside the workflow | `Record` lookup / `switch` |
| Size | 925 | Length of an array/string | `.length` |
| Filter | 925 | Keep array items matching a condition | `.filter` |
| Set Outputs | 750 | Assign several output keys at once | object spread / multiple setters |
| Clean Keys | 639 | Fill a default into missing/empty values (`Keys`, `Fill if: Missing or Empty`, `Fill with`, e.g. `-`) | `obj.k ?? '-'` (plus empty-string check) |
| Console | 559 | Debug logging | `console.log` (drop) |
| Get | 1,416 | Read a value at a `Path` (e.g. `[0]`, `data.resolved.items`) | `obj.path` / `lodash.get` |
| Set | 725 | Write a `Value` at a `Path` | immutable set / spread |
| Formula | 444 | "Create Field": `name=expression` in spreadsheet-style syntax (IF, CONCATENATE…) | computed property |
| Merge | 387 | Join two datasets (`Merge Type` e.g. Inner, `Merge Key` `a=b`, `Rows to Keep`) | join / `Map` lookup |
| Omit | 379 | Drop the listed `Omit Keys` | `omit` |
| Formula Value | 362 | Single expression over an input (`=LEN(A)`) | inline expression |
| Map Keys | 301 | Translate values through a lookup (`Source Column` → `Target Column`) | `Record` lookup |
| Pick | 280 | Keep only the listed `Pick Keys` | `pick` |
| Rename Field | 483 | Map one field name to another | mapper |
| Col2Array | 247 | Collect a column into an array | `.map(r => r.col)` |
| HTML Table | 214 | Render data as an HTML table string | JSX table |
| Aggregate By | 181 | Group and aggregate (sum, count…) | `reduce` / group-by |
| JSON Parse | 168 | Parse a JSON string | `JSON.parse` |
| Group Input | 150 | Bundle several inputs into one | object literal |
| Branch Start / End | 128 each | Open/close a conditional branch | `if` block |
| Input Switch | 110 | Pick one of several inputs | ternary / `??` |
| Gate | 41 | Pass data through only when a condition holds | guard clause |
| Group Of Operations | 21 | A collapsed sub-graph | helper function |
| Unwind | 19 | Flatten an array field into rows | `.flatMap` |
| Create Table / Object2Table / Table2Object | — | Table ⇄ object conversions | `Object.entries` / `Object.fromEntries` |

The remaining types are lower-volume (and any not listed here may still matter); list them with `scripts/inventory.mjs` and read each
instance. (Meanings above are inferred from node behaviour; confirm against a live example.)
Operator `Aggregate By` is the real name — older notes say "Aggregate".

Two reasons to read workflows carefully:

1. **`Input` / "Get"-style paths reveal the real response shape**
   (`data.resolved.nestedItems`) — often the only evidence you have for an API response.
2. **`Rename Field` reveals field renaming** between the wire format and what the UI displays —
   an easy source of silent mismatches if missed.

### `initializer` — the event bus

```jsonc
{
  "key": "initOnLoad",
  "type": "initializer",
  "triggerType": "new",                      // "manual" | "new" | "watch"
  "initializerData": {
    "dataOutputObject": [ { "id": "dwfLoadCaseList", "type": "trigger", "value": "GO" } ]
  }
}
```

`triggerType` (also present on `dataworkflow`, `decision`, `integrator` and `transformer`):
`new` ≈ fires when the module opens (mount effect), `watch` ≈ a reactive dependency, `manual`
≈ called by something else. Do not look for `new-submission`; the value is `new`.

Wiring: `initializerData.dataOutputObject` lists targets, each `{id, type: "trigger", value:
"GO"}`. Follow the chains to reconstruct a screen's lifecycle: *on load → set defaults → call
these integrators → run these workflows → reveal these panels.*

### `transformer` — real code

Server-side JS or JSONata. Low count, high value: these carry logic no other component type
can express (payload building, base64, complex derivation). **Read all of them.** They
port to TypeScript almost directly.

### `timer`

Polling or delayed trigger. May have `duration: null` and only a `trigger` — then it is a
one-shot "fire X after the module settles", not a poll. Check the period and what it calls
(usually an unread-count or async-job-status endpoint); port polls as `refetchInterval`.

### `filestorage`

SFTP/FTP client with `list`, `get` and `put` methods. Rare (1 in 590 modules) but a backend
job, not a UI concern; find the host in the service registry and move it server-side.

---

## Data & display components

### `hidden` — the store

The largest count and the least interesting individually. `hidden` fields hold everything the
screen needs and are the reason a module has one flat namespace. Treat them as evidence of
*state*, not of features. In React they scatter into component state, query cache, URL search
params and Redux — see [05 §3](05-target-architecture.md).

The exception: `hidden` components inside API-module `panelRequest` / `panelResponse` panels
**are the request/response schema** of that server-side module — the cleanest API
documentation in the export:

```jsonc
{ "key": "panelRequest",  "type": "panel", "components": [
  { "type": "hidden", "key": "caseId",       "tags": ["type:string"] },
  { "type": "hidden", "key": "documentType", "tags": ["type:string"] }
]}
```

Note `tags: ["type:string", …]` — often *all* type tags are present (the author never narrowed
them), so treat types as unverified unless exactly one is listed.

### `viewgrid` — server-paginated table

Columns live in `dataDisplayObject`, and are **empty in ~44%** of grids (built at runtime by a
workflow). `hasServerSidePagination` is true on ~77%. Other keys: `pageSize`,
`paginatorSource`, `selectRow`, `selectRowIDProperty`, `event` (the event fired on row
action). Never assume a client-side table.

### `inlineGrid` — repeating rows

A repeating editable row set; children are the row's components (often nested `columns`).
Maps to `useFieldArray`. The workhorse for every "add another contact / item" list.

### `infotable` — inline static lookup

A small table embedded in the module: navigation definitions, field-rename maps, option lists.
Becomes a plain constant. Cheap and high value to extract — these define nav structure.

### `table`, `freeFormGrid`, `htmlelement`

`table` is a read-only display table. `freeFormGrid` is a free-positioned layout grid (rare).
`htmlelement` is static or templated markup (1,559 in one app) — often headings and
paragraphs, but grep it for `<script` / `<style` like `content`.

### `panel` — container, often a modal

`modalType: "modal"` on about 41% of panels (not "most"). `title`, `outsideDismiss` and the
child components give you the dialog spec directly; the non-modal panels are plain sections.

### `navigation` — tabs and wizards

```jsonc
{
  "type": "navigation",
  "navigationData": { /* tab definitions */ },
  "showAsTabs": true, "verticalDisplay": false,
  "validateOnNavigation": true, "preventNavigationClick": false, "staggerLoad": false,
  "nextButton": …, "previousButton": …, "saveDraftButton": …, "submitButton": …,
  "autoSave": …, "autoValidate": …, "alwaysValidateAllFields": …, "allowNavigation": …
}
```

Two idioms:
- **Tabs whose content is another module** — the tab loads `/modules/{id}/components` and
  injects it. In React: lazy-loaded child routes. `staggerLoad` defers rendering of inactive
  tabs.
- **Wizard steps** — `autoValidate` / `alwaysValidateAllFields` / `validateOnNavigation` and
  the tab↔field mapping table define which step an error routes to. **Preserve that
  mapping**; losing it means validation errors that point nowhere. `preventNavigationClick`
  forces strict Next/Previous order.

### `content` — HTML, and the escape hatches

Static HTML, but also where injected `<script>` and `<style>` live. Always inspect:
`grep -l 'angular.element'` and `grep -l '<style'`.

### `chart`

`chart` → Recharts. Check the series source (usually a workflow output) and any filter that
scopes it (see 07 §13).

---

## Field components

Observed: `textfield`, `textarea`, `number`, `basicDropdown`, `select`, `radio`, `checkboxv2`,
`selectboxes`, `dateinput`, `file`, `phonenumber-v2`, `email`, `richtexteditorv2`, `button`.
*Not observed (may exist elsewhere):* `currency`, `signature`, `address`, `datetime`,
`checkbox`, `phoneNumber`. Currency in the observed app is `number` with a `currencyCode`.

The fields you care about carry:

| Field property | Meaning |
|---|---|
| `validate` | `{ required, minLength, maxLength, pattern, custom }` → Zod schema. Note `required` is also driven by decision outputs (`_required`, `_requiredAndVisible`) |
| `trigger` | Component fired when this field changes |
| `watcherList` | Components watching this field |
| `refreshOn` | Keys whose change re-evaluates this field |
| `persistent` | Whether the value is stored in the submission |
| `data.values` / `data.url` / `dataSource` / `data.dataReferenceKey` | Options — inline list, or a Data Collection query |
| `clearOnHide` | Common on some types. Where `true`, a hidden answer is stripped from the payload; honour it where it is set |
| `defaultValue` | Initial value |
| `permissions` | Role gating on this specific field |
| `customClass` | Layout/emphasis hints — also rewritten by decisions (`_customClass`) |
| `conditional` / `logic` / `calculateValue` | Form.io-style show/hide and derived values. **Zero occurrences in the observed app**; check yours before relying on them |

`button` components: `action` is `event` (most), `validate` or `save`. With `event`, the button
fires a named event and an `initializer` listening for that event does the work. To find out
what a button does, search the module for its event name, not for its key.
