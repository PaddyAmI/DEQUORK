# 7. Pitfalls

Every item here cost real time on a real migration. Read before slice 1.

---

## 1. The misspelt role id

Unqork role ids are free-text strings typed into hundreds of component permission maps. One
of them will be misspelt, and it will be the *frequent* spelling.

On one migration, `app-claim-hander` (no `d`) appeared **219** times in component permissions;
`app-claim-handler` appeared **14** times, in the routing table. One of the two never matches
at runtime — meaning that user silently became a read-only stranger with no error anywhere.

**Detect:** `scripts/permissions.mjs` prints the role-id frequency table; scan for
near-duplicates.
**Fix:** do not pick one. Normalise inbound to a canonical id, preserve the server's spelling
outbound (`normaliseRole` / `wireRole`), and test both. Ask the platform team which the
backend actually sends — and expect that nobody knows.

The same trap applies to service names and sentinel values. That migration had a production
service whose registered name contained a typo (`Acme-Notificaton-Service`
shape). You must spell it wrong too. Also reconcile the IdP's group names and the role derived
by the SSO rule chain against the `permissions` spellings
([01 §6](01-export-anatomy.md)); a mismatch is a user who silently loses all access.

---

## 2. Encoding

Unqork exports move through several systems — export tooling, zips, OneDrive/SharePoint, a
colleague's spreadsheet — and can arrive as UTF-8 decoded as Latin-1:
`CafÃ©` instead of `Café`. Whether *your* copy is damaged
depends on how it was transferred, so check rather than assume in either direction. One
migration's first copy of the data was damaged and a later copy of the same data was clean.

**Detect:** `scripts/datacollections.mjs` flags rows matching the mojibake signature, per
collection. Run it on the copy you were actually given, not on one someone re-saved.
**Fix:** at import, once, into clean UTF-8 resource files. Never at render time, and never by
hand-editing individual labels — you will miss some, and the ones you miss will be in the
language you do not read.

---

## 3. Buckets are not statuses

Dashboards group records into **buckets** with live counts. A bucket expands to a *set* of
`(status, subStatus)` pairs via a mapping table. Treating a bucket code as a status filter
gives silently wrong counts — the tab says 12, the grid shows 5, and nobody notices for weeks
because both look plausible.

Keep `bucket → [(status, subStatus)]` as data. Build every filter through it.

---

## 4. Sub-status is a second axis

Most Unqork workflow apps have a main status *and* a sub-status (often a suffixed variant
meaning "same status, other side of the workflow"). Independent secondary statuses (attachment
status, document status, contract status) are further axes again. Conflating any two of them
produces bugs that only appear for one role at one point in the lifecycle.

Model them as separate fields. Write the state machine down.

---

## 5. Decision tables: what is absent is load-bearing

A role or status appearing in **no row** gets nothing. It is very tempting to look at a table
where five roles all have the same nine statuses and write
`isInternalRole(role) && !isReadOnly(status)`.

That is wrong twice over: it grants the role that appears in *none* of the rows, and it grants
every role at the statuses the table never enumerates. On one migration that single simplification
covered three genuinely asymmetric tables (45 / 36 / 27 rows) whose whole point was that a
manager role may assign an agent but not a reviewer. Also check `decisionType`: a `merge`
table applies every matching row, a `first` table only the first ([02](02-component-reference.md)).

**Port tables as tables. Assert the row counts in a test.**

---

## 6. Truncation in your own tooling

Long decision tables get cut — by viewers, by intermediate catalog passes, by any
summarising step. The cut-off seen was **25 rows**, which is a **viewer/tooling limit, not the
export**: the raw JSON is complete (tables of up to 82 rows have been seen). On one migration
three permission tables were truncated this way, producing a report that was wrong in both
directions until re-read from raw JSON.

Anything over ~20 rows: read from the raw export, record the row count, and note in the
document that the count was verified.

---

## 7. Grid columns are often missing from the export

`viewgrid` column lists are frequently empty because they are built at runtime. Recover them
from the populating data workflow, or from a screenshot. And note that the same grid may show
different columns per scope or tab — variation that is not in the export at all.

---

## 8. Async jobs are everywhere and need one abstraction

Document generation, ZIP archives, report generation — all follow *submit → poll status →
download*, all with different endpoints. Build one polling abstraction early. Retrofitting
three of them separately is a fortnight.

---

## 9. Money and currency

Amounts frequently exist in a base currency **and** a local currency with a separate ISO code
per amount, plus excl./incl. tax variants. Do not collapse to a single money type; you cannot
recover the distinction afterwards.

---

## 10. `clearOnHide` / `clear` and hidden answers

Where a field sets `clearOnHide: true` (common on some types, absent on others), or a decision
emits a `<field>_clear` output (1,267 such columns in one large app), a hidden field's answer
must be **stripped from the payload**. Verify where it is actually set rather than assuming it
is universal; where it is set, ignoring it sends the backend an answer to a question that was
never asked, contradicting the visible answers.

---

## 11. `contains` is set membership

Multi-select conditions (a `selectboxes` value holds several options) are set membership,
whether they appear as a `contains` operator in a conditional or as a decision-table input
matched against a multi-value. Implementing it as string equality means the rule
works with one option ticked and silently stops working when a second is ticked — dependent
fields vanish. This is exactly the sort of bug that survives manual testing.

---

## 12. Rules that target containers

Visibility rules (decision `_visible` / `_hidden` outputs) often name a *container* key rather
than the fields inside it. Without a container→members expansion, those rules do nothing at all. Assert rule coverage numerically:
*M of M rules capable of firing*.

---

## 13. Scoping — check all three queries

"My items" views must filter by assignee. The grid, the tab counts and the charts are
usually three separate queries. Fixing one and shipping is the norm; a role then sees its own
five items in the grid and the whole team's four hundred in the donut.

---

## 14. Admin screens that write to the wrong subject

The pattern: search for user X, display *the caller's* data, and have the save button write
the displayed list against X's id. It reads fine, demos fine, and corrupts data. Audit every
screen that operates on a *searched* subject rather than the current user.

---

## 15. Route-level authorisation does not exist until you build it

Hiding a nav item is not authorisation. The route tree, the nav bar and the page guards must
share one table. Test by typing an admin URL as a non-admin.

---

## 16. 401, 403 and the idle timeout

The platform handled all three. Your app does not, and nobody notices because the mock never
returns them. Handle 401 centrally (end session, return to login with a reason and a route
back), make 403 say "not permitted" rather than showing a status code and URL, and restore the
idle logout the platform used to provide.

---

## 17. Locale is part of the request

If the legacy app sends a locale header, the API returns localised strings. Client-only i18n
diverges from server text — a translated label next to an English one, in the same row. Send the
header from day one.

---

## 18. Deep links may be public

Legacy URLs (`#/display/{moduleId}?subid=…`) are in emails, bookmarks and other systems.
Decide whether to support redirects from old ids to new paths **before** launch, not after the
first support ticket.

---

## 19. The business-spec folder describes the future

Exports often ship with workshop decks and process diagrams describing phase-2 functionality
that is **not in the app**. Mark them out of scope in writing, early, or they leak into the
parity register and you build features the legacy app never had.

---

## 20. "Feature complete" is roughly 70% done

The remainder is not screens. It is identity, the real backend contract, file storage,
hosting, CSP, accessibility and the long tail of things the platform provided. Plan for it
from the start, and separate the two claims in every status report: *close to parity* and
*not deployable* are both true simultaneously for a long time.
