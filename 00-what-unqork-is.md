# 0. What Unqork is, and why the export looks like that

Read this first. Without the execution model, the export JSON is unreadable noise.

---

## 1. The model in one paragraph

Unqork is a no-code platform. An application is a set of **modules**. A module is a **flat
JSON array of components**. Some components render UI (fields, buttons, panels, grids); most
do not — they are *behaviour* components (initializers, decision tables, data workflows,
integrators) that sit invisibly in the same array. There is no code, no router, no
components-with-props, and no imports. Everything is one namespace of `key`s inside one
module, and everything communicates by reading and writing those keys on a single mutable
object called the **submission data**.

```
  ┌──────────────── one Unqork module ─────────────────┐
  │                                                     │
  │  submission.data  ← one flat mutable bag of keys    │
  │        ▲   ▲   ▲                                    │
  │        │   │   └── hidden components (the "store")  │
  │        │   └────── field components (the UI)        │
  │        │                                            │
  │   ┌────┴──────────────────────────────────────┐     │
  │   │ initializer → decision → dataworkflow →   │     │
  │   │              integrator → postTrigger →   │     │
  │   │              dataworkflow → sets keys     │     │
  │   └───────────────────────────────────────────┘     │
  │           the event bus: "on X, do Y"               │
  └─────────────────────────────────────────────────────┘
```

Everything else follows from that.

---

## 2. The four consequences that shape your migration

### 2.1 There is no router — a module *is* a page

Navigation is a URL like `/app/{appname}#/display/{moduleId}`, and "navigating" is a decision
table writing a value to a magic `page` output key. So:

- **Module ids are your route table.** They appear as opaque 24-hex-character strings
  (`<moduleId>`) in caller components. Recovering `moduleId → file → screen` is one of the
  first extraction jobs. A tool-based export with a `manifest.json` hands you the map; an older
  manual export does not (see [01 §1](01-export-anatomy.md)).
- **Every page re-embeds the header and footer.** Not by reference — the component trees are
  literally copy-pasted into every module's JSON. Expect thousands of duplicate components.
  On one large migration the header/footer accounted for a large share of a ~20,000-component total.

### 2.2 There is no conditional layout — so screens are duplicated

Unqork cannot easily say "render this differently for this role". It can only say "open a
different module". The idiom that falls out of this, present in essentially every mature
Unqork app:

- **`(role, status) → moduleId` lookup tables** stored as reference data, deciding which of
  N near-identical screens opens.
- **`X` and `X - Disabled` twins** — a read-only clone of a screen for terminal states.
- **Per-role grid modules** — one dashboard module per role, differing only in columns.

All three collapse to a single React component plus config. This is the largest single
simplification available and it is discussed in [04](04-unqork-to-react-mapping.md).

### 2.3 There is no function call — behaviour is tables and pipelines

Three component types carry all the logic, and none of them is code:

| Component | What it really is | Reads like |
|---|---|---|
| `decision` | A lookup table: input columns → output columns, first match wins | `switch` / `Record<K,V>` |
| `dataworkflow` | A visual dataflow graph (a GoJS diagram): operator nodes (Input, Create Value, Filter, Rename Field, Aggregate By, Decision, Output...) wired by links | A chain of `map`/`filter`/`reduce` |
| `initializer` | "When event E happens (or this module opens), trigger components [A, B, C]" | An event handler |

Field behaviour (show/hide, required, disabled, derived values) is **not** on the fields
themselves: it is written *onto* them by `decision` tables and `dataworkflow` Output nodes.
See [02](02-component-reference.md#how-field-behaviour-is-actually-driven).

These are *enormously* verbose as JSON and trivially small as TypeScript. A 45-row decision
table becomes six lines. Do not be intimidated by component counts.

### 2.4 There is no HTTP client — there is the `integrator`, and it has two modes

This is the single most important distinction in the whole export:

| `serviceType` | Meaning | Fate in the rewrite |
|---|---|---|
| `unqork` | Calls a *platform* endpoint — usually `PUT /fbu/uapi/modules/{id}/execute`, i.e. "run another Unqork module server-side" | **Deleted.** These exist only because Unqork exists. |
| anything else (a named service) | Calls a real external HTTP service | **Kept.** This is your actual backend contract. |

The consequence: an Unqork frontend almost never talks to the real backend directly. It calls
a server-side *API module*, which calls the backend. Every request makes two network hops.
Removing that tier is usually the biggest performance win in the migration — on one large
migration it deleted ~780 hops across ~96 server-side modules.

```
  LEGACY:  browser ──▶ Unqork frontend module
                        │  PUT /fbu/uapi/modules/{id}/execute      (hop 1)
                        ▼
                       Unqork API module
                        │  GET https://domain-service/v1/case/...  (hop 2)
                        ▼
                       Domain service

  REWRITE: browser ──▶ Domain service                              (one hop)
```

---

## 3. The escape hatches — and why they matter to you

Mature Unqork apps always leak outside the platform. Look for these; each one is a hidden
requirement:

- **Injected `<script>` in `content` components**, typically reaching into Angular scope:
  ```js
  var data = angular.element('.unqorkio-form').scope().submission.data;
  ```
  Used for things the platform cannot do — translating tab titles, localising date pickers,
  spinner control, injecting CSS. All of it disappears in React, but *read it first*: it is
  where the undocumented UX behaviour hides.

- **Injected CSS in `content` components.** Page styling is often not in the theme bundle at
  all but in a `content` component holding a `<style>` block. Grep for `<style` before you
  conclude the design system is complete.

- **`transformer` components** — server-side JS/JSONata. These are real code and often carry
  business rules (e.g. email payload building, base64 conversion). Read every one.

- **Third-party SDK injection** — cookie consent, analytics, address autocomplete. These are
  production requirements that appear nowhere in a functional spec.

---

## 4. Identity and auth, the Unqork way

Two patterns you will almost certainly meet:

1. **OIDC SSO handled by the platform.** The app itself never sees a token; Unqork does the
   dance, maps identity-provider claims to user attributes, and hands the module a populated
   user object. The identity provider's configuration is **not in the export**: request it. Your
   React app has no equivalent — this is always a real, unbudgeted workstream. See
   [01 §6](01-export-anatomy.md) and [08](08-open-questions-template.md) Q1.

2. **Identity propagated as plain headers** to the domain service:
   `x-user-id`, `x-user-email`, `x-user-role`, `x-user-name`, `x-locale` (names vary).

   > **This cannot be ported as-is and it is a security decision, not a wiring task.** In
   > Unqork those headers are attached server-side, by the platform, in a tier the browser
   > cannot reach. If your React app attaches them from the browser, **the client is
   > asserting its own role** and any user can become an admin with devtools. The two valid
   > answers are (a) the backend validates a bearer token and derives identity itself, or
   > (b) a BFF sits in front and re-attaches the headers server-side. Get this decided in
   > week 1; it blocks every authenticated call and it is the thing most likely to stop a
   > finished app from shipping.

---

## 5. Reference data: "Data Collections"

Unqork stores lookup tables as **Data Collections**, read at runtime via
`GET /fbu/uapi/query/{name}/all`, and exported as CSV or JSON depending on the export tool.
Two flavours, both important:

| Flavour | Typical shape | Becomes in React |
|---|---|---|
| **Translations** | `value, locale, label` | i18n dictionary (`en`/`fr` JSON) |
| **Mappings / config** | e.g. `bucketCode, statusCode, subStatus` or `userRole, caseStatus, moduleId` | Typed config module in `src/config/` |

The mapping collections are gold: they are the app's business rules written down as data,
already normalised. The `(role, status) → module` table in particular is usually *the* most
valuable artefact in the entire export.

Watch for **multi-value cells** — Unqork stores lists as comma-joined strings with a trailing
comma, e.g. `"app-agent,app-manager,"`. Split and trim; do not treat as a single value.

---

## 6. What Unqork gave the app for free (and you must now build)

Keep this list visible. It is the systematic source of "we thought we were done" surprises:

| Provided by the platform | Now your problem |
|---|---|
| OIDC SSO, session, logout | An auth provider implementation |
| Role-based component hiding | A permission policy in domain terms |
| Server-side execution tier | Direct API calls + a real error contract |
| File storage (submission storage) | Object storage / presigned URLs |
| Session timeout | An idle-logout implementation |
| Hosting, CSP, deploy pipeline | All of it |
| A theme and component set | A design system |
| Audit of module execution | Nothing — but check what the *domain service* audits |
| Runtime log search (Settings → UDLC Toolkit → Build and Test → Service Logs) | A log aggregation and search platform (e.g. Datadog) |

See [05 §7](05-target-architecture.md) and [08](08-open-questions-template.md).
