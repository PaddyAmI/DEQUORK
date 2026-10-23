# 13. Executing a document migration out of Unqork

**Scope:** generic. [11](11-finding-unqork-data-stores.md) finds the stores that hold documents
and sketches a plan for them. This document covers the next step: the **machinery that copies the
bytes** from Unqork into object storage (S3 or similar), relinks each record, and proves the
legacy store can be switched off. It compares the two designs seen on one large migration: a
thin admin batch job that was built first, and a staged extraction engine that was designed after
it. It ends with the decisions every future migration has to make.

---

## 1. The shape of the problem

- **Unqork has no bulk export of binaries.** The platform's bulk data export carries submission
  field data, not attachments. Every file is read one at a time, through an authenticated call.
- **Signed file URLs expire** (24 hours on the platform this was measured on). That limit applies
  per document. It only matters if listing and fetching are far apart in time.
- **The record and the bytes live in different places.** Typically a domain service owns the
  document *record* (name, type, size, owner) and holds an Unqork submission id as its only link
  to the bytes. The migration moves the bytes and writes a new link onto that record. It never
  creates the record.
- **The read rate limit per account is undocumented.** Measure it. Do not assume it.
- **Uploads keep arriving** for as long as the legacy UI is live. A migration that only ever
  copies a fixed backlog never reaches zero.

## 2. Two designs that were actually tried

### 2.1 Design A: thin admin batch job (built first)

An admin opens a migration screen and starts a job. The API lists pending documents for that
admin's market, then for each one: reads the record, reads the bytes from Unqork with a service
account, writes them to S3 under a deterministic key, and PATCHes the record with the key and the
provider (`objectStorageKey`, `storageProvider: "S3"`). Job state (counts, cursor, status) is a
JSON object in S3, so the job outlives a browser close or a pod restart. Outcomes are
`MIGRATED`, `ALREADY_MIGRATED` and `FAILED`. One bad file does not stop the batch.

**What it gets right, and what you should keep:**

| Property | Why it matters |
|---|---|
| Deterministic key per document (`{service}/documents/{id}`) | A re-run overwrites the same object rather than leaving orphans |
| Bytes first, pointer second | A crash between the two leaves an unreferenced object, which is harmless. The other order leaves a record pointing at nothing |
| Skip anything already linked | Re-runs are idempotent |
| Admin-only, enforced in the API and not only in the nav | It is a bulk read of every document |
| The Unqork submission id is kept on the record | Traceability, and the reconciliation join |
| Origin check on the returned file URL, and redirects refused | The fetch follows a URL Unqork hands back, which is an SSRF surface |
| Cursor-paged listing | Resumes without starting over |
| Reject empty files; record oversize files as failures | A cheap first integrity check |
| State that survives a restart | The run does not depend on a tab being open |

**Where it falls short at scale:**

| Gap | Consequence |
|---|---|
| The API holds an Unqork credential | A second copy of a high-value secret, in the tier that faces users. It also has to be revoked separately at decommission |
| Scoped to one market | When one Unqork app serves several markets, that store's gate cannot be judged from any single market admin's view |
| One record type (site documents) | Contract, subscription and news documents, which can sit in other Unqork modules, are left behind |
| Job state is one S3 JSON object | Last write wins. Two pods, or a pod and a stuck retry, can lose counts. There is no per-item history |
| An unconditional PATCH | A batch worker and an on-read copy racing on one document can both write. A "linked to a different key" check catches the symptom, not the race |
| Integrity check is only "non-empty" | Unqork can return an HTML error page with a `200`. That passes the check and gets stored as the document |
| Size limit means the file is buffered | Large files fail rather than stream through |
| Retries are not capped, and there is no automatic halt | One systemic fault (an expired credential, a wrong module id) fails the whole estate overnight |
| No inflow stop, no reconciliation, no decommission gate | Nothing says when the legacy store can be switched off |
| A fourth outcome is implied but never named | "Linked to a different key" is a conflict, not a plain failure, and it needs a person to decide |

### 2.2 Design B: staged extraction engine (designed after A)

The same core loop, wrapped in a lifecycle and a ledger:

- **One unit of work (`copyOne`)** is shared by the backfill, a just-in-time copy on first read,
  and a verify pass. One algorithm means one set of bugs.
- **The proxy never calls Unqork.** Each domain service already holds its own Unqork credential
  and module ids, so it exposes one **binary stream** endpoint. The proxy pipes that stream into a
  multipart S3 upload: memory per file is one part, not the whole file.
- **A conditional pointer write** (`409` if one is already set) makes concurrent copiers safe by
  construction.
- **The pointer is a sub-document, not a flag:** `contentStore: {location, key, sha256, sizeBytes,
  migratedAt}`. If it is absent, the bytes are still in Unqork. Its presence *is* the migration
  state. Pick a name that is not already in use: an existing `isMigrated` with another meaning,
  one join away, will make a reconciliation query quietly answer the wrong question.
- **The ledger is a small database** (runs, items, events), not a blob. Items are claimed with
  leases, so every replica can work and a dead pod's items come back. Every operator action is
  recorded with who did it.
- **Throttles per source.** Each Unqork app has its own concurrency budget, which halves
  automatically on a `429`. A run halts itself when more than 5% of the last 200 items fail.
- **Failure classes, not one `FAILED`:** `transient-upstream`, `throttled`, `not-found`,
  `integrity`, `transient-s3`, `pointer-conflict` (treated as success). Attempts are capped.
  Permanent failures need a recorded disposition (`retry` or `accepted-loss`, with a note).
- **Verification levels.** L1 size matches the record and is > 0. L2 the S3 checksum is verified
  on upload. L3 re-read both sides and compare hashes (on a sample, then the full population
  before decommission). L4 the magic bytes match the declared MIME type, which catches the HTML
  error page.
- **Run types:** Inventory (dry run, writes nothing), Pilot (a stratified sample), Backfill (and
  the same run again later as the catch-up), Verify, and Retry-failed.
- **A decommission gate**, per source: coverage (nothing pending), existence (S3 Inventory joined
  to the pointers), integrity (L3, zero mismatches), and failures (every one dispositioned, with
  accepted losses signed off by the business).

### 2.3 Side by side

| Concern | A · thin batch | B · staged engine |
|---|---|---|
| Who reads Unqork | API, with its own service account | The domain service, with the credential it already has |
| Transfer | Buffered, with a size limit | Streamed multipart |
| Key | `{service}/documents/{id}` | `{service}/{recordType}/{id}` |
| Pointer | `objectStorageKey` + `storageProvider` | `contentStore {location, key, sha256, sizeBytes, migratedAt}` |
| Pointer write | PATCH | Conditional PUT, `409` if already set |
| Job state | One S3 JSON object | Ledger DB: runs, items, events, leases |
| Scope | One market, one record type | One **source** (one Unqork app), every record type, filterable by market |
| Statuses | queued, running, stopping, stopped | planning, running, paused, halted, completed, cancelled |
| Outcomes | 3 | 6 failure classes plus a disposition |
| Integrity | Non-empty | L1–L4 |
| Safety stop | Manual stop | Automatic halt on failure rate, and a backoff on `429` |
| On-read copy | None | Just-in-time, through the same `copyOne` |
| End state | Undefined | Inflow stop, reconciliation, per-source decommission |

**Recommendation:** start from A's loop, because it is right, and add B's pieces in this order of
value: conditional pointer write → L4 magic-byte check → capped retries and an automatic halt →
credential kept in the domain service → streaming → per-item ledger → reconciliation gate. A is
the right **pilot**. B is what a decommission needs.

## 3. The lifecycle, per source

A **source** is one Unqork application paired with the service that holds its credential. If you
have two Unqork apps, you have two migrations: one engine, but separate credentials, rate limits,
gates and decommission dates. **A run never spans two sources.**

| Stage | What happens | Exit criterion |
|---|---|---|
| 0 · Inventory | Count per record type × market. Dry-run a sample: resolve, fetch, hash, write nothing | Counts signed off; read rate measured; orphan and ZIP policy decided |
| 1 · Pilot | About 1,000 documents, stratified by record type × market × module × MIME × age | 100% pass L1–L4 |
| 2 · Stop the inflow | Per market, at cutover: the new UI takes uploads and the legacy UI stops | Zero new Unqork-shaped pointers for 7 days, for every market of the source |
| 3 · Backfill | Starts long before Stage 2 (it is idempotent), then one catch-up run after it | Pending = 0 |
| 4 · Reconcile | The four gate checks | All pass |
| 5 · Decommission | Disable the source in the engine, revoke its credential, delete the stream endpoint, turn the on-read copy into an explicit `410` with an alert | — |

**The parallel run is asymmetric.** While both UIs are live, a document uploaded in the new UI
(S3, new id) cannot be opened by the legacy UI, which resolves every pointer through Unqork. Pin
uploads to the legacy UI for each market until its cutover, and make "upload on" a per-market
capability flag rather than a branch. The alternative, writing to both stores, is a dual-write
built only to be thrown away.

## 4. Decisions to make in week 1

| # | Decision | Default |
|---|---|---|
| 1 | Who holds the Unqork credential for extraction | The service that already has it. Never the tier that faces users |
| 2 | Pointer model | A sub-document whose presence is the state. Keep the Unqork id unchanged; a new name nobody else uses |
| 3 | Key scheme | `{service}/{recordType}/{id}`. No filename, owner or market in the key (those change; keys must not) |
| 4 | Ledger store | A small DB with per-item rows, disposable after decommission. Not a blob in object storage |
| 5 | Where the workers run | In the existing API pods at low concurrency; a separate worker deployment if Stage 0 shows the backfill runs for weeks |
| 6 | Which UI takes uploads during each parallel run | The legacy UI, until that market's cutover |
| 7 | Files no record references; generated ZIPs | One raw export to a restricted prefix, then accept; let ZIPs expire |
| 8 | Bucket protection | Versioning on from day one (after decommission it is the only copy). Object Lock only once a retention period is confirmed, because it cannot be turned off |
| 9 | L3 coverage | A sample during the backfill, the full population before decommission if the rate allows |
| 10 | Does the domain service already have a generic migration API | Ask. A leftover `/migration/{collection}/…` controller can remove a backend release, but only if it is gated to a service identity and switched on just for the window |

## 5. Pitfalls

- **Checking only for "non-empty".** Unqork error pages come back as `200 text/html`. Check the
  magic bytes against the declared MIME type.
- **An unconditional pointer write.** It is safe only until the first just-in-time copy races a
  backfill worker.
- **Uncapped retries.** One poisoned document keeps "pending" above zero for a reason nobody is
  looking at.
- **Scoping by market when the store is per application.** Gates and credentials are per Unqork
  app. Market is a filter, not a scope.
- **Base64-in-JSON read endpoints.** They are fine for a pilot (about 33% more bytes, and the whole
  file in memory on both sides), but not for a backfill.
- **Forgetting the other modules.** Site documents are the obvious store. Contract, subscription,
  news and generated documents are often in different modules (see
  [11](11-finding-unqork-data-stores.md) §2, step C).
- **A date instead of a gate.** Decommission when reconciliation passes, and not before. After
  decommission a miss cannot be recovered, so alert on every `410`.

## 6. Testing it before the backend exists

Give the mock backend the migration endpoints (pending, counts, the binary stream, the
conditional pointer write) and a local S3 (MinIO). Seed fixture bytes that include deliberately
broken ones: a `404`, an HTML body, and a size mismatch. With two sources, seed them with
different estates and make one answer `429`s, so that independence and backoff are tested locally
rather than found in production.
