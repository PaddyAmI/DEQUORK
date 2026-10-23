# 5. Target architecture — the React + NestJS stack

The stack and structure this pack targets, with the reasoning. Unqork apps have a
characteristic shape — filter-heavy, deeply role-conditional, table-dominated,
form-dominated — and that shape drives most of these choices. The *reasoning* is the
transferable part; swap pieces only with a written reason.

The deliverable is an **npm-workspaces monorepo** of three apps:

```
apps/ui        React single-page app
apps/api       NestJS BFF / API proxy fronting the domain services      (deployed)
apps/api-mock  Fastify + MongoDB contract simulator for local and CI    (never deployed)
package.json   workspaces: ["apps/*"]; ONE root package-lock.json
dist/apps/<module>/   build output of each deployable module
```

Install from the root only; per-workspace lockfiles are stale by definition, delete them if
they appear. Build output goes to `dist/apps/<module>/` at the repo root so a deploy pipeline
can find it by convention. The mock must be absent from the deploy configuration; its absence
is the enforcement.

---

## 1. The stack

### 1.1 UI (`apps/ui`)

| Concern | Choice | Why, for an Unqork replacement specifically |
|---|---|---|
| Build | **Vite** + React + **TypeScript (strict)** | |
| Routing | **TanStack Router** | Typed routes *and* typed **search params**. Legacy dashboards are filter-heavy and every screen is deep-linkable. Filters belong in the URL; this is the main reason over React Router. |
| Server state | **TanStack Query** | Caching, background refetch, pagination, and polling for the async-job pattern (generate, poll, download) that every Unqork app has. |
| Tables | **TanStack Table** | Dozens of server-paginated grids. Headless, so it wears your design system. |
| Client state | **Redux Toolkit** + `react-redux` | Session/role, locale, shell state, cross-screen workflow state, bulk-selection buffers. |
| Styling | **Tailwind CSS v4** via `@tailwindcss/vite` | Tokens defined once, consumed by the component library. |
| Primitives | **Radix UI** | Accessible unstyled behaviour for dialog/select/checkbox/tabs/popover. Legacy modals are numerous and their accessibility is usually poor. |
| Variants | **class-variance-authority** + `clsx` + `tailwind-merge` | One place per component defining variants; safe class merging. |
| i18n | **i18next** + `react-i18next` | |
| Icons | **lucide-react** | Replaces the legacy icon font. |
| Charts | **Recharts** | |
| Toasts | **sonner** | |
| Export | `jspdf` + `jspdf-autotable`, `write-excel-file` | Legacy apps always have PDF/Excel export. Budget for it. |
| Unit / component tests | **Vitest** (node environment by default; `jsdom` opted into per file) + **Testing Library** | A project-wide jsdom default was measured at ~40s vs ~1s for the same suite. |
| End-to-end | **Playwright** | |
| Lint / format | **ESLint** with `typescript-eslint` (type-aware, via project service) + **Prettier** | The lint config must exist and actually run; see [06 §5](06-parity-method.md). |

**Deliberately not in the stack: react-hook-form, Zod (in the UI), date-fns.** Forms here are
descriptor-driven: a typed field descriptor (key, type, options, visibility rule, required
rule) is extracted from the export and rendered by one controlled-component form engine that
implements the legacy rule operators. A form library would sit *beside* that engine, not
under it, and a second schema language (Zod) would duplicate the descriptor. Dates are
handled with the platform `Intl` APIs and small helpers. Validate at the boundary with the
generated wire types and the descriptor, not with a parallel runtime schema.

### 1.2 BFF / API (`apps/api`)

A **NestJS** (express platform) service that fronts the domain services. It exists to give
identity, routing and error contracts a home that Unqork's server tier used to provide.

| Concern | Choice |
|---|---|
| Framework | NestJS on express |
| Config | `@nestjs/config`, validated at start with **zod** (fail fast; no defaults for upstream URLs, because a pod that falls back to localhost starts, passes liveness and fails every real request) |
| Upstream calls | `@nestjs/axios` / `axios`, and `http-proxy-middleware` for passthrough routes |
| Authentication | **jose** — verifies the OIDC provider's JWT (issuer, audience, signature via JWKS); identity headers for the domain service are derived from the *verified* token |
| Routing | A route table mapping path prefixes to upstream services; global prefix (e.g. `api/v1`) set once in `main.ts` |
| Health | A health endpoint under the global prefix, served **unauthenticated** for liveness and readiness probes |
| Tests | Vitest — routing table and probe-path properties |

While the BFF is a passthrough it adds a hop and buys little, so day-to-day UI work can run
straight against the mock; run the BFF itself only when working on it, with its upstreams
pointed at the mock.

### 1.3 Local backend stand-in (`apps/api-mock`)

**Fastify** + **MongoDB**, contract-simulating, never deployed. `zod` for request validation,
`@fastify/multipart` for uploads, **faker** for seeding, `mongodb-memory-server` so tests need
no Docker. See §7.

---

## 2. Project structure (UI)

Feature-first. A feature owns its routes, components, queries, types and config.

```
src/
  app/          router, providers, store, error boundaries, api wiring
  api/
    generated/  wire DTOs generated from the backend OpenAPI — never hand-edited
    dialect/    the ONLY place allowed to import both generated and domain types
    client.ts   the one shared fetch client
  components/
    ui/         primitives: Button, Input, Checkbox, Select, Dialog…
    data/       DataTable, Pagination, FilterPanel, EmptyState
    layout/     AppShell, Header, SubMenu, Footer, PageHeader
  features/     dashboard/, cases/, documents/, tasks/, forms/, admin/, auth/ …
  config/       hand-owned domain config: statuses, buckets, navigation, tenant data
  forms/        field descriptors and per-tenant overrides
  i18n/         locales/ (chrome) and content/ (domain content)
  lib/          formatting, permissions helpers, utils
  shared/       hand-written domain types
  styles/       tailwind entry + design tokens
```

**On `config/`:** short, readable, hand-written files — status codes, buckets, nav items.
They are *checked against* the legacy extraction during review, **not generated from it**.
Nothing in `src/` should require knowing what Unqork was.

### 2.1 Patterns worth adopting wholesale

- **Generated wire DTOs, never hand-edited.** Generate types from the backend's OpenAPI deck
  (`gen:dto`), with a `gen:dto:check` that fails CI if they are stale. They carry the
  backend's own spellings, including its typos, as contract.
- **A single dialect layer.** `api/dialect/` is the only code permitted to import both the
  generated wire types and the hand-written domain types, mapping wire to domain. A mapping
  that stops compiling against a regenerated DTO is the drift detector, running on every build.
  The boundary is **lint-enforced** (and re-checked by a source-scan test): `features/**` and
  `components/**` may not import `api/generated/**` or `api/dialect/**`.
- **One shared fetch client** that every API call funnels through (§4), so tests can stub one
  function and exercise the real hooks, cache keys and error mapping.
- **A contract check.** A script diffs the OpenAPI deck(s) against the mock's route table in
  both directions and fails CI on drift (§7).
- **Variation as data on typed axes.** If the app serves several tenants, markets or
  languages, every difference is *data*, never a branch in a screen. Five mechanisms in order
  of increasing power; use the weakest that works:

  | Rung | Mechanism | Use when |
  |---|---|---|
  | 1 | Tenant data | A *value* differs |
  | 2 | Capability flag + `useFeature()` | A surface is on or off |
  | 3 | Form descriptor override | A shared screen asks different questions |
  | 4 | API overlay | An operation is served differently for one tenant |
  | 5 | Component slot | UI the shared screen has no place for |

  Lint-forbid comparing a tenant id to a literal inside screens. Tenant and language are
  independent axes: never assume a 1:1 mapping. Resolve the tenant per request from a token
  claim, not a build flag.
- **Two i18n bundle families with different bars.** Chrome strings (nav, buttons, statuses,
  errors) must be complete in every language, enforced by a key-parity test. Domain content
  (long questionnaires) is held to coverage, not parity: a fabricated translation of legal
  text is worse than a visible gap.
- **Runtime config substitution in the UI container.** Vite inlines `VITE_*` at build time,
  but a deploy platform promotes one image by digest across environments. Build once with
  placeholders and rewrite them in the container entrypoint at start.
- **Health-probe path agreement, checked in CI.** The probe path is spelled in the app, the
  deploy config, the chart and the web-server config; if any disagree the pod is killed with
  no application error. A script asserts they match. For the SPA, serve probes from an
  explicit `location = /healthz`, never the catch-all `try_files … /index.html` (which
  returns 200 for any path, passing with a broken bundle).

---

## 3. The state boundary — get this right on day one

The most common architectural failure in these rewrites is putting API responses in Redux.

| TanStack Query | Redux | URL (search params) |
|---|---|---|
| Anything the server owns: records, documents, reference data | Session: user, role, permissions, allowed scope | Filters |
| Pagination/sort **results** | Locale | Page, page size |
| Async job polling | Shell UI: menus, modal stack | Sort field + direction |
| Anything with loading/error/stale states | Cross-screen workflow state | Active tab / bucket |
| | Bulk-selection buffers before submit | Selected record id |
| | Draft form state not yet persisted | |

**Rule of thumb:** if a page refresh should re-fetch it, it belongs to Query. If a refresh
should lose it, it belongs to Redux. If it should survive a refresh *and* be shareable, it
belongs in the URL. Filters in component state produce an app whose back button does nothing.

---

## 4. The API client

Thin, and it owns exactly four things no call site should repeat:

1. **Base URL and credentials** — the bearer token (or session) attached in one place, behind
   a seam so the transport module does not depend on the React graph. Identity headers are
   *not* set here: the BFF derives them from the verified token.
2. **Error translation.** Port the legacy HTTP-status decision table here. Otherwise a refused
   write reaches the user as `403 /api/v1/user`, which names neither what was refused nor why.
   Override `toString()` on your error class so every `toast.error(String(e))` call site is
   fixed at once.
3. **401 / 403 semantics.** 401 ends the session and returns to login *with a reason and a
   route back*. 403 says "not permitted" — retrying and re-authenticating change nothing, so
   it must not look like a transient failure.
4. **Paging.** Fold the total-count header into a `Paged<T>` so no feature parses headers.

It should **not** transform payloads; mapping belongs in the dialect layer, in one place.

---

## 5. Permissions

Three layers, sharing **one table**:

```
  config/navigation.ts  ─┐
  route guards          ─┼── one role table
  page-level checks     ─┘
```

If they diverge, hiding a nav item becomes the only protection and typing the URL defeats it.
The BFF enforces the same table server-side; the UI table is for experience, not security.

Express permissions as **named domain predicates** derived from the legacy decision tables
(see [03 §3](03-extraction-playbook.md)), each carrying its legacy row count in a comment and
asserted by a test.

---

## 6. Forms

For a large conditional form, a descriptor-driven engine beats hand-written JSX per field:

- A typed field descriptor per field, extracted from the export (key kept byte-exact).
- A rule engine implementing the legacy operators — including `contains` as **set
  membership** and container→members expansion.
- Conditional requiredness, and `clearOnHide` honoured so hidden answers never reach the
  payload.
- Controlled components with form state held in the engine; the **step ↔ field map**
  preserved so a validation error routes to the right step.
- Coverage tests: *N of N fields rendered*, *M of M rules capable of firing*.

---

## 7. The mock backend — build it

If the real service is unreachable (it usually is, for months), build a **contract simulator**
rather than relying on in-browser request mocking. It costs a few days and it changes the
project.

Shape: **Fastify + MongoDB + seed scripts**, implementing every operation in your
reconstructed contract with correct paths, shapes and paging, and business rules only where
the UI depends on them. If there are several real domain services with near-identical APIs,
serve them as façades over one route table (resolve the service from the URL prefix, keep it
in `AsyncLocalStorage`, one database each) and stamp every response with an
`x-mock-service` header so a UI pointed at the wrong backend is diagnosable from the network
tab.

Properties that make it worth the effort:

1. **Seeded, named scenarios** — one record per interesting state, with fixed ids, so a
   reviewer can open a deep link and see the awkward case immediately.
2. **Quarantined provisional routes.** Endpoints you inferred but the backend has not
   confirmed get a marker (an `x-mock-provisional` response header) and are listed
   separately.
3. **A contract check** — a script asserting every operation in the OpenAPI document has a
   route and vice versa. It catches drift for free.
4. **Shared domain types.** The mock re-exports the UI's domain types, so if the seeder
   compiles, the contract matches what the UI expects by design.
5. **No Docker for tests:** `mongodb-memory-server` plus `fastify.inject()`.

CI order for the mock: bring up databases, seed, test, contract check. Give each workspace
its own workflow with `paths` filters (shared inputs such as the OpenAPI specs trigger both
sides), not one workflow with three jobs, or every suite runs on every change.

---

## 8. Definition of done, per screen

A screen is done when:

1. Every capability in the register for that screen works.
2. It uses only design-system components.
3. Role behaviour matches the capability matrix, with a test per role that differs.
4. Loading, empty, error and permission-denied states all exist.
5. Keyboard navigable; no accessibility violations; focus is visible.
6. Every supported locale renders without truncation or clipping.
7. Server-paginated lists never fetch unbounded data.
8. Text comes from i18n, not hardcoded strings.

---

## 9. Delivery sequence

Order by risk, not by ease. Each slice ends with something demonstrable and
capability-checked.

| # | Slice | Proves |
|---|---|---|
| 0 | Foundations — tooling, tokens, component library, AppShell, auth, API client, permissions, mock | The system is real |
| 1 | The main list/dashboard, **one role** — filters, sort, server pagination, export | The hardest data path, end to end |
| 2 | The same for all remaining roles, config-driven | The config approach holds |
| 3 | The detail screen — shell, tabs, status actions, assignment | The workflow core |
| 4 | The largest subsystem (usually documents) | The bulk of the value |
| 5 | The money screens (pricing, templates, contracts) | |
| 6 | The big form | Highest field count |
| 7 | Admin and the long tail | Parity |
| 8 | Hardening — a11y, perf, security, i18n sweep | Ship |

Slice 1 deliberately front-loads the hardest data path. If server pagination, URL-driven
filters, role scoping and export do not work together, you want to know in week 3.
