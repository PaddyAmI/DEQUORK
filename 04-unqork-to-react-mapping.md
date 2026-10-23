# 4. Unqork → React: the mapping

Three sections: what maps cleanly, what you should **delete**, and what you must **not
change**. The third is the shortest and the most expensive to get wrong.

Examples use a neutral case-management domain (Case, Task, Document; roles `app-agent`,
`app-manager`, `app-client`).

---

## 1. Concept mapping

| Unqork | React | Notes |
|---|---|---|
| Module = page | Route + page component | Module ids become readable paths |
| Module id in a URL (`#/display/<module-id>`) | Typed route + search params | Deep links must keep working — map old ids to new paths if links are shared externally |
| `panel` with `modalType: modal` | `<Dialog>` | The majority of panels |
| `viewgrid` | Server-paginated table (TanStack Table + Query) | Keep server-side paging |
| `inlineGrid` | Controlled array-of-rows editor (add / remove / edit row) | |
| `infotable` | Config constant | |
| Data Collection (translation) | i18n dictionary | |
| Data Collection (mapping) | Typed config module | These are business rules |
| `decision` table | `Record<K,V>` or a pure predicate | Preserve and assert row counts |
| `dataworkflow` | Selector / mapper function | |
| `transformer` | TypeScript function | Port directly |
| `integrator` (external) | API client method | |
| `integrator` (`serviceType: unqork`) | **Deleted** | Call the domain service directly (via the BFF) |
| `initializer` chain | Event handlers + effects | |
| `hidden` field | Component state / query cache / URL param | Decide per case — see [05 §3](05-target-architecture.md) |
| `timer` | `refetchInterval` on a query | |
| `chart` | Recharts | |
| `navigation` (tabs) | Tabs or child routes | |
| `navigation` (wizard) | Step wizard + per-step field descriptor | Preserve the step↔field map |
| `content` with `<script>` | Normal React | |
| `content` with `<style>` | Design tokens + component styles | Read it first — it holds real layout |
| Component `permissions` map | A permission policy in domain terms | Not a per-component flag |
| Two-step submission-storage upload | Object storage / presigned URL | An open question, always |

---

## 2. What to delete — the structural collapses

These are where the rewrite gets *smaller* than the original. On one large migration, 77
frontend modules and ~96 server modules became 18 screens.

### 2.1 Collapse the role/status screen variants
Replace the `(role, status) → moduleId` table plus its N near-identical module trees with
**one route** whose tabs and actions are driven by role and status.

```
  BEFORE                                   AFTER
  Case View Agent          ┐               /cases/$caseId
  Case View Disabled Agent │ chosen by      ├─ tabs      ← from (role, status)
  Case View Draft          ├ a lookup       ├─ actions   ← from (role, status)
  Case View – Client       │ table          └─ readOnly  ← from status
  Case View Partner        │
  Case View Auditor        ┘
```

### 2.2 Collapse the per-role grids
One dashboard, per-role bucket and column config. The config table *is* the legacy behaviour,
written down once instead of eight times.

### 2.3 Delete every `-Disabled` twin
One component, `readOnly` prop.

### 2.4 Delete the dynamic module loading
`GET /modules/{id}/components` + DOM injection → lazy-loaded route children.

### 2.5 Delete the platform hop
Every `PUT /fbu/uapi/modules/{id}/execute` disappears. The browser calls the BFF, which calls
the domain service. This is usually the biggest single win — in one app the export contained
roughly 1,200 `execute` hops, all of which vanish.

> **Caveat, and it matters:** the server-side module was doing *something* between the two
> hops — field renaming, defaulting, aggregating two calls into one, attaching identity
> headers. Read each one before deleting it. Anything genuinely server-side (identity in
> particular) needs a home: the backend, or a BFF. Deleting the tier without asking what it
> did is how you lose behaviour silently.

### 2.6 Deduplicate the shell
One `AppShell` with header, role-filtered nav, footer.

### 2.7 Replace scope hacks and injected CSS
Normal state, normal i18n, normal styles.

---

## 3. What must not change — the wire format

Everything in this section goes to a backend you are **not** rewriting. Changing any of it
breaks the app in ways that pass typecheck and fail in production.

1. **Action verb strings.** `Review`, `Accept`, `Start_Work`, `Save_sectionDetails`… The
   backend derives status transitions from these.
2. **Status, sub-status, bucket and document codes.** Short, opaque, load-bearing.
3. **Request and response field names**, exactly as the legacy integrators send them —
   including inconsistent casing and abbreviations.
4. **Header names.** The legacy integrators inject identity headers built from `currentUser`:
   `x-user-id`, `x-user-email`, `x-user-role`, `x-user-name` and `x-locale`, plus whatever the
   total-count response header is called. Keep the names for the backend. **But the source of
   their values changes:** in the rebuild the BFF derives them server-side from the verified
   token, and never trusts the browser to supply them. A browser that sends its own
   `x-user-role` is asserting its own authority.
5. **Misspellings.** Service names, role ids, sentinel values. If the backend sends it
   misspelt, you must accept it misspelt.
6. **Business validation rules and conditional form logic**, including the cases that look
   like bugs. Confirm before "fixing" any of them.

**Pattern for the misspelling problem** — normalise inbound, preserve outbound:

```ts
// The legacy data spells this role 'app-case-hander' (missing the 'd') 219 times against
// 14 uses of the correct spelling, so the components gate on the misspelling while the
// routing table uses the correct one. Normalise at the boundary so every internal check
// sees one id, and send back whatever the server sent us so its own gates still match.
normaliseRole(serverRole)  // → the canonical id, used everywhere internally
wireRole(canonicalRole)    // → the spelling this server actually uses, on the way out
```

### 3.1 Services that are not your domain service

Not every `integrator` with `serviceType: "external"` talks to the domain service. Expect
**non-domain external services**: document generation, notification/e-mail, document stores,
address or reference lookups. Unqork resolves their base URLs and credentials through the
tenant **service registry**, so the export names a service alias, not a host. Ask for the
registry per environment ([08](08-open-questions-template.md)), list each non-domain service
separately in your contract, and decide for each whether the BFF proxies it, the domain
service absorbs it, or it is replaced.

---

## 4. Deliberate divergences — and how to record them

You will improve on the legacy app in places. That is fine, and it is *only* fine if it is
written down, because otherwise the parity diff reports your improvements as gaps.

Keep a short "deliberate divergences" list in the engineering plan. Examples:

| Legacy | New | Why |
|---|---|---|
| Free-text filter fields | Filter chips | Same query, better affordance |
| Non-blocking date validation | Blocking validation | The backend rejects it anyway |
| Separate dialogs for two teams | One merged dialog | Identical fields |

Rule of thumb: diverge on **presentation** freely, on **workflow** only with the business
owner, and on **wire format** never.

---

## 5. Behaviour that Unqork gave you for free

Each of these is a work item that appears in no capability register. Put them in the plan at
the start.

| Was free | Now needs building | Typical size |
|---|---|---|
| OIDC SSO + session | Auth in the BFF against the chosen identity provider; claim→role mapping | Large, and blocked on a decision |
| Session/idle timeout | An idle-logout hook | Small |
| Role-based component hiding | Permission policy + route guards | Medium |
| Server execution tier | Direct calls + a real error contract | Medium |
| File storage | Object storage integration | Medium, blocked on a decision |
| Submission storage as a database | A data migration, see [11](11-finding-unqork-data-stores.md) | Large, often discovered late |
| Timers and scheduled workflows | A scheduler in the backend | Medium |
| 401/403 handling | Central handling in the API client | Small, and always forgotten |
| Theme + components | A design system | Large |
| Hosting, CSP, deploy | Infrastructure | Medium |

> **Route-level gating is the one people miss.** Hiding a nav item is not authorisation. If
> the route table, the nav bar and the page guards do not share one table, any role can reach
> any admin screen by typing its address. On one migration this existed for exactly zero
> routes until the parity pass found it.
