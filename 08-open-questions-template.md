# 8. The open-questions template

Every Unqork migration hits most of these. Ask them in **week 1**. None can be resolved by
writing more React, and each one answered late is expensive in a specific, predictable way.

Copy this into your project, fill in the Owner column with names, and keep it in the status
report where stakeholders see it.

**Do not assume the shape of the backend.** Some apps front a domain service; some keep their
data *inside Unqork* (submissions and Data Collections) with no service at all. Some send
identity headers; some do not. Q1 to Q3 establish which world you are in, and the questions
that follow branch on the answer.

---

## The questions

| # | Question | Why it cannot be answered from the export | Blocks | Typical owner | Risk if deferred |
|---|---|---|---|---|---|
| 1 | **Identity and SSO.** How are users authenticated today (the OIDC identity provider, its claims), and what will the rebuild validate: a bearer token at the backend, or a BFF that verifies the token and derives identity? If the legacy integrators send identity headers at all, which ones, and which does the backend actually trust? | The platform's SSO configuration and its server tier are not in the export | Every authenticated call; production deployment | Backend + security | **Highest.** The app cannot ship. A security design decision, not a wiring task: identity headers set from the browser mean the client asserts its own role |
| 2 | **Claim to role mapping.** How do IdP claims become application roles? Typically an if/elif chain in an SSO or initialiser module. Record the order (first match wins?), the fallback role, and what a user with no match sees. | Lives in SSO configuration or a module the export may omit | Every role-gated screen | Platform + security | Users silently land in the wrong role or the fallback; precedence bugs stay invisible until a multi-role user logs in |
| 3 | **Where does persistent data live?** Is there a domain service behind the integrators, or is the data in Unqork submissions / Data Collections ([11](11-finding-unqork-data-stores.md))? If Unqork-native: who holds extraction credentials, what volume, what cutover window, what retention? | The export names store module ids but contains no data | Whether this is a front-end project or also a data migration | Platform + business | A data migration discovered at UAT |
| 4 | **Service registry per environment.** The base URL, auth and alias of every service the integrators call (domain and non-domain), for each environment. | Unqork resolves service aliases through the tenant registry, which is not exported | The API contract, BFF routing, every environment | Platform | Contract built against the wrong host; non-domain services missed |
| 5 | **Environments and promotion.** Which Unqork environments exist (dev / test / staging / prod), how is a change promoted, and **which snapshot is authoritative** for live behaviour? | Exports carry no reliable environment label; environments drift | Which export you mine; later snapshot diffs | Platform | You rebuild a staging variant that production never ran |
| 6 | **Complete API-module re-export.** Frontend modules reference N server-side modules; the export contains fewer (check the manifest's `failed` / `possibly_truncated` lists if there is one). | Export truncation | Save/update semantics across the app | Platform | The write path stays inferred rather than verified |
| 7 | **Non-domain integrations.** Document generation, e-mail / notifications, SFTP or file drops, schedulers and `timer` / scheduled workflows. What does each do, who owns it, what replaces it? | They run server-side or on other platforms | Features that "just happen" in the legacy app | Platform + backend | Notifications and generated documents silently stop at go-live |
| 8 | **File upload mechanism.** Presigned URLs to object storage, or proxy through the BFF / domain service? | The legacy two-step used Unqork submission storage, which will not exist | Every upload surface | Backend | Upload is provisional everywhere; a late change touches every upload screen |
| 9 | **Response schemas.** The reconstructed contract only knows the fields the old UI consumed. | Integrator output mappings are a lower bound | Types, empty states, error handling | Backend | Silent `undefined`s in production |
| 10 | **Role id spelling.** Which spelling does the backend actually send? | Two spellings may exist in the export; only one can match | Everything for that role | Platform | That role silently becomes a stranger with no permissions |
| 11 | **Sentinel values.** Do "unclassified" records use explicit sentinels or an absent field? | The export shows the writer, not the reader | Any list filtered on the sentinel | Backend | Implement tolerantly; confirming lets you delete branches and casts |
| 12 | **Reference-data replacement.** What replaces the Data Collection query endpoints: a config endpoint, or bundled config? Are the Data Collections in the export at all? | The platform served them | i18n and config loading | Backend + product | Labels drift from server-produced strings |
| 13 | **Derived-field semantics.** What does each computed column mean (e.g. an "ageing" figure: days since modification, or months from a milestone)? | The computing module is often in the truncated third | Columns and sorting that users rely on | Backend | The column means something different from the one users know |
| 14 | **Scope of the existing app.** Was section/feature X removed before the export? | Ordering artefacts hint at removals | Feature scope | Business | Fields either built unnecessarily or missing |
| 15 | **Per-scope variation.** Do grids show different columns in different tabs or for different scopes? | Not in the export at all | Table configuration | Business (screenshots) | Users see the wrong columns; cheap to answer with one screenshot |
| 16 | **Unexplained navigation items.** Items present on every legacy screen that appear in no exported module: what do they open? | The module is missing or the link is external | Navigation completeness | Business | A whole capability discovered at UAT |
| 17 | **Deep links.** Are legacy URLs shared externally? Must old module-id links redirect? | Unknowable from the export | Launch plan | Business | Broken bookmarks on day one |
| 18 | **Hosting and deployment.** Where does this run, behind what CSP, with what deploy pipeline and health-probe contract? | Unqork provided all of it | Deployment | Platform | Discovered at the end, as a surprise |
| 19 | **Data migration and cutover.** For Unqork-native data and in-flight records: what moves, when, with what freeze window and what rollback? | Not an export concern | Go-live | Business + platform | An irreversible cutover |
| 20 | **Audit expectations.** Which mutations must write an audit entry, and does the domain service do it or did the platform? | The platform audited module execution | Compliance | Backend + compliance | A compliance gap found in review |

**Branches.** If Q3 says *domain service*: Q4, Q8, Q9 and Q11 are about its contract and the
BFF proxies it. If Q3 says *Unqork-native*: the "backend" is something you must build, Q9
becomes a schema-design task, and Q19 is the critical path. If Q1 shows *no identity headers*,
drop header-related wire-format work and design the BFF's identity contract from scratch.

---

## How to run this list

- **Order by cost-if-answered-late**, not by ease of answering.
- Give every question **one named owner** outside the front-end team.
- Record the **answer and its date** in the same table. Answers get forgotten and re-litigated.
- When you cannot wait: **implement tolerantly and label it**. Accept either shape, note what
  confirming would let you delete. That is a reversible position; a guess is not.
- Track **provisional API functions** as a first-class number in the status report ("9 API
  functions remain provisional"), so the level of guessing is visible rather than implied.

---

## The three requests to make on day one

1. **Identity** (Q1, Q2). It gates the entire app and it is a security decision that goes
   through a review process you do not control. Start it in week 1 even though you will not
   need the answer for a month. Ask for the SSO configuration and the claim-to-role logic.

2. **The service registry and environment list** (Q4, Q5), so you mine the authoritative
   snapshot and build against the real hosts.

3. **Screenshots** — one per role, per major screen, of the running legacy app. The cheapest
   artefact in the project. The export encodes capability and wiring but not arrangement,
   prominence, or per-scope variation. On one migration, two screenshots produced findings,
   including an entire navigation item present in no module, that were not derivable from
   the export at any level of effort.
