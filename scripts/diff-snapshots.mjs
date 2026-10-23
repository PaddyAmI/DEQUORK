#!/usr/bin/env node
/**
 * diff-snapshots.mjs — what changed between two exports of the same application?
 *
 * Modules are matched by id, so it works across scripted generations (b ↔ c). Legacy manual
 * exports carry no ids; if either side lacks them the match falls back to the bare filename
 * (folder-agnostic) with a warning.
 *
 *   added    id only in the new export
 *   removed  id only in the old export
 *   renamed  same id, different name or title
 *   changed  same id, different `modified` timestamp, else different components (hash of the
 *            parsed tree, so serialisation differences between generations do not count)
 *
 *   node diff-snapshots.mjs "<old-export>" "<new-export>" [--json]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readExport, hasFlag, positional } from './lib.mjs';

const [oldRoot, newRoot] = positional();
if (!oldRoot || !newRoot || !fs.existsSync(oldRoot) || !fs.existsSync(newRoot)) {
  process.stderr.write('usage: node diff-snapshots.mjs <old-export> <new-export> [--json]\n');
  process.exit(1);
}

const A = readExport(oldRoot, { quiet: true });
const B = readExport(newRoot, { quiet: true });
const byId = A.modules.every((m) => m.id) && B.modules.every((m) => m.id);
if (!byId) {
  process.stderr.write('! one export has modules without ids (legacy manual); matching by filename instead\n');
}
const keyOf = (m) => (byId ? m.id : path.posix.basename(m.rel).toLowerCase());
const index = (mods) => new Map(mods.map((m) => [keyOf(m), m]));
const a = index(A.modules);
const b = index(B.modules);

const hash = (m) => crypto.createHash('sha1').update(JSON.stringify(m.components)).digest('hex');
/** `modified` timestamp from the module object, if it has one. */
const modified = (m) => {
  try {
    const o = JSON.parse(fs.readFileSync(m.file, 'utf8'));
    return o && !Array.isArray(o) ? (o.modified ?? null) : null;
  } catch {
    return null;
  }
};
const label = (m) => m.name ?? m.rel;

const added = [];
const removed = [];
const renamed = [];
const changed = [];
for (const [k, m] of b) if (!a.has(k)) added.push({ id: m.id, name: label(m), type: m.kind });
for (const [k, m] of a) if (!b.has(k)) removed.push({ id: m.id, name: label(m), type: m.kind });
for (const [k, n] of b) {
  const o = a.get(k);
  if (!o) continue;
  if (o.name !== n.name || o.title !== n.title) {
    renamed.push({ id: n.id, from: `${o.name} / ${o.title}`, to: `${n.name} / ${n.title}` });
  }
  // Raw file size is not comparable across generations (one pretty-prints, one minifies), so
  // size is not used. `modified` is the cheap check; the hash is over the parsed components,
  // so it is whitespace-insensitive and decides everything else.
  const mo = modified(o);
  const mn = modified(n);
  let why = null;
  if (mo && mn && mo !== mn) why = `modified ${mo}->${mn}`;
  else if (hash(o) !== hash(n)) why = 'content hash';
  if (why) changed.push({ id: n.id, name: label(n), why });
}

const result = { old: oldRoot, new: newRoot, matchedBy: byId ? 'id' : 'filename', added, removed, renamed, changed };
if (hasFlag('--json')) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}
const o = [];
o.push(`old: ${A.modules.length} modules   new: ${B.modules.length} modules   matched by ${result.matchedBy}`);
o.push(`+${added.length} added  -${removed.length} removed  ~${renamed.length} renamed  *${changed.length} changed`);
for (const x of added) o.push(`+ [${x.type}] ${x.name}  ${x.id ?? ''}`);
for (const x of removed) o.push(`- [${x.type}] ${x.name}  ${x.id ?? ''}`);
for (const x of renamed) o.push(`~ ${x.id}  ${x.from}  =>  ${x.to}`);
for (const x of changed) o.push(`* ${x.name}  (${x.why})`);
process.stdout.write(o.join('\n') + '\n');
