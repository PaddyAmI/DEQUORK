# 11. Finding Unqork data stores — and migrating Unqork-native persistence

**Scope:** generic. Many Unqork apps use *Unqork itself* as a data layer: submission modules
hold uploaded files, document pointers, and sometimes whole business records, with no domain
service in front. The rebuild replaces Unqork, so everything stored there is a migration
workload. The export shows *which* module ids are used as stores; it never contains the stored
*data*. This document is the method for finding the stores, classifying them and planning
their migration.

---

## 1. Why it matters

On one large migration, every document byte lived in Unqork submission storage and nowhere
else, spread over many collections (about 16 holding documents among 21 stores found) across
two Unqork environments. A plan that assumed "one document store" would have migrated a small
fraction of the files. Stores are also invisible in the UI: some are dedicated holder modules
with no screens; others are ordinary page modules whose own submission collection is used.

## 2. The three-step discovery method

Prefer the manifest: `node scripts/manifest.mjs <export>` produces `manifest.json`, which
resolves module ids to titles and types, so a 24-hex id in a URL becomes a named module (and
tells you whether it is a page, a holder or an API module). Then scan mechanically, never by
sampling.

```bash
# A. Attachment stores: where file bytes land (multipart upload endpoint)
grep -rho '/fbu/uapi/modules/[0-9a-f]\{24\}/submissions/attachments' <export> | sort | uniq -c | sort -rn

# B. Submission stores: create / read by id
grep -rho '/fbu/uapi/modules/[0-9a-f]\{24\}/submissions[^"]*' <export> | sort -u

# C. Read-side stores: getSubmissions takes the module id as a DATA INPUT, not in the URL
grep -rl 'system/getSubmissions' <export>
#   then per file read integratorData.dataInputObject[] for {"mapping": "moduleId"}
```

Step C is the one people skip: a URL-only grep never sees a store that is only ever read.
Also check **schema modules** (a module whose only purpose is to define a submission shape
used as a lookup table) and **transformer hosts** (ids passed as `moduleId` to a transformer
call are hosts for PDF/report generation, not stores).

Where a parser trips on a file (empty file, leading junk, two concatenated JSON documents),
fall back to the text scan for that file and record the exception.

Record every hit, with the call count and the source module, in a table; resolve each id via
`manifest.json`; note which environment (tenant) it belongs to. **Ids differ per environment
and per tenant** unless a shared module was deliberately reused: do not assume that two apps
share none, and do not assume they share any. Check both ways (on one migration the only
shared store was a utility base64-to-URL holder, contradicting an earlier "all ids differ"
statement).

## 3. Classify each store

| Class | Test | Migration implication |
|---|---|---|
| **Document store** | Holds `attachments` URLs, file names, or a `documentUrl`-style field | Bytes must be fetched and re-stored; pointers rewritten |
| **Pointer store** | Holds a record whose id is passed into a domain API as the only reference to a file | Keep the id mapping old-id to new-id for every referencing row in the domain service |
| **Record store** | Holds business data (users, hierarchies, lookups, dashboards) with no domain service | Full data migration: schema design, load, validation |
| **Transient store** | Interim holder for report or generation output | Usually do not migrate; confirm nothing reads it later |
| **Read-only / shared** | Only read, or shared across apps | Migrate once; check consumers in every app |

Some upload surfaces post into the page module's own submission collection rather than a
dedicated holder. They are not named like stores and are easy to miss.

## 4. Planning the migration

For each store that must move:

1. **Extraction.** Use Unqork's submissions API (list and fetch by module id) with credentials
   from a platform admin, or a platform-side bulk export. Paginate; record counts per store
   and per environment up front so completeness is checkable. Signed file URLs expire: fetch
   bytes in the same run as the listing, or re-sign.
2. **Mapping.** Define a target (object storage keys, or database tables) per store class.
   Preserve the old submission id as an alias column. Build the old-to-new id map and apply
   it to every foreign reference held in the domain service. Preserve file names, MIME types
   and any categorisation the legacy flow assigned at upload.
3. **Verification.** Counts per store, checksums per file where available, and a sample
   re-open through the new UI under each role.
4. **Cutover.** Decide freeze vs dual-write. The simple pattern is freeze writes in Unqork,
   run a final delta extraction, switch the rebuild on, keep Unqork read-only for a defined
   period. Uploads made during the window are the usual loss; schedule it for a quiet period
   and communicate it.
5. **Rollback.** Keep the Unqork stores untouched (read-only) until the new system has passed
   acceptance and a retention period; keep the id map so references can be reversed; keep the
   extraction output immutable. A rollback is only possible if nothing was deleted at source.
6. **Compliance.** Confirm retention, residency and access-log requirements for migrated
   documents before moving them to a new bucket or region.

Raise the discovery results in [08](08-open-questions-template.md) on day one: who owns
extraction credentials, what volume is expected, and whether the cutover window is acceptable.
