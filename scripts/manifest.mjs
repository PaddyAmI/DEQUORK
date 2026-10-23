#!/usr/bin/env node
/**
 * manifest.mjs — is this export complete, and what is in it?
 *
 * Detects the export generation, then reconciles the manifest (when there is one) against
 * the files on disk and against the module ids the code actually references:
 *
 *   a  legacy manual export — no manifest, no ids; only error markers and unparseable files
 *   b  scripted export      — manifest.json {modules[]} + filename_map.json, api/ frontend/ folders
 *   c  scripted export      — manifest.json {downloaded[], failed, possibly_truncated, …}
 *
 *   node manifest.mjs "<export-root>" [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { readExport, walkComponents, findDataCollectionsDir, tally, bump, exportRoot, hasFlag } from './lib.mjs';

const root = exportRoot('manifest.mjs');
const { manifest, modules, unparseable, errorMarkers, aggregateMarkers } = readExport(root, { quiet: true });
const generation = manifest?.generation ?? 'a';
const name = (m) => m.name ?? m.rel;

const byType = new Map();
for (const m of modules) bump(byType, m.kind);

// Manifest vs disk, by module id.
const diskIds = new Set(modules.map((m) => m.id).filter(Boolean));
const manifestIds = new Set((manifest?.entries ?? []).map((e) => e.id));
const notInManifest = manifest ? modules.filter((m) => !m.id || !manifestIds.has(m.id)).map(name) : [];
const noFile = manifest ? manifest.entries.filter((e) => !diskIds.has(e.id)).map((e) => e.name ?? e.id) : [];

// Module ids the code references vs the ids we hold.
const known = new Set([...diskIds, ...manifestIds]);
const refs = new Map(); // id → referencing module names
for (const mod of modules) {
  walkComponents(mod.components, (c) => {
    if (c.type !== 'integrator') return;
    const url = c.integratorData?.integratorUrl ?? c.unqorkApi ?? '';
    const id = url.match(/\/modules\/([0-9a-f]{24})\//i)?.[1];
    if (!id) return;
    if (!refs.has(id)) refs.set(id, new Set());
    refs.get(id).add(name(mod));
  });
}
const unresolved = known.size ? [...refs].filter(([id]) => !known.has(id)) : [];

const JUNK = /deprecated|to-be-deleted|copy|bkp|backup|\btest\b|[-_ ]test\b/i;
const junk = modules
  .filter((m) => JUNK.test(m.name ?? '') || JUNK.test(m.title ?? '') || JUNK.test(path.posix.basename(m.rel)))
  .map((m) => ({ name: name(m), type: m.kind, rel: m.rel }));

const dcDir = findDataCollectionsDir(root);
const dcOnDisk = dcDir ? fs.readdirSync(dcDir).filter((f) => /\.(csv|json)$/i.test(f)).length : 0;

const report = {
  generation,
  applicationId: manifest?.applicationId ?? null,
  environment: manifest?.environment ?? null,
  modulesOnDisk: modules.length,
  modulesDeclared: manifest ? (manifest.declaredCount ?? manifest.entries.length) : null,
  modulesByType: Object.fromEntries(tally(byType)),
  failures: manifest ? manifest.failures : errorMarkers.map((m) => m.rel),
  possiblyTruncated: manifest?.possiblyTruncated ?? null,
  aggregateMarkers: aggregateMarkers.map((a) => a.rel),
  unparseable,
  dataCollections: {
    onDisk: dcOnDisk,
    downloaded: manifest ? manifest.collectionsDownloaded.length : null,
    failed: manifest ? manifest.collectionsFailed : null,
  },
  onDiskNotInManifest: notInManifest,
  manifestWithoutFile: noFile,
  referencedModuleIds: refs.size,
  unresolvedModuleIds: unresolved.map(([id, c]) => ({ id, from: [...c] })),
  junkCandidates: junk,
};

if (hasFlag('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(0);
}

const list = (a, n = 8) => a.slice(0, n).join('; ') + (a.length > n ? `; … +${a.length - n} more` : '');
const o = [];
o.push(`generation: ${generation}${manifest ? '' : ' (legacy manual — no manifest)'}`);
o.push(`application_id: ${report.applicationId ?? 'n/a'}   environment: ${report.environment ?? 'n/a'}`);
o.push(`modules: ${modules.length} on disk` + (manifest ? `, ${report.modulesDeclared} in manifest` : ''));
o.push(`by type: ${tally(byType).map(([t, n]) => `${t}:${n}`).join(' ')}`);
o.push(
  `failures: ${report.failures.length}` +
    (report.failures.length ? ` — ${list(report.failures.map((f) => (typeof f === 'string' ? f : JSON.stringify(f))))}` : ''),
);
if (aggregateMarkers.length) o.push(`aggregate error summaries (not counted as failures): ${aggregateMarkers.length}`);
o.push(`possibly_truncated: ${report.possiblyTruncated ?? 'n/a'}`);
o.push(`unparseable: ${unparseable.length}` + (unparseable.length ? ` — ${list(unparseable.map((u) => u.rel))}` : ''));
const dc = report.dataCollections;
o.push(
  `data collections: ${dc.onDisk} on disk` +
    (manifest && dc.downloaded ? `, ${dc.downloaded} downloaded, ${dc.failed.length} failed` : ''),
);
if (manifest) {
  o.push(`on disk, not in manifest: ${notInManifest.length}` + (notInManifest.length ? ` — ${list(notInManifest)}` : ''));
  o.push(`in manifest, no file: ${noFile.length}` + (noFile.length ? ` — ${list(noFile)}` : ''));
}
o.push(
  known.size
    ? `unresolved module-id references: ${unresolved.length} of ${refs.size}` +
        unresolved.map(([id, c]) => `\n  ${id} <- ${list([...c], 3)}`).join('')
    : `module-id references: ${refs.size} distinct (no ids in a legacy export, cannot resolve)`,
);
o.push(`junk candidates: ${junk.length}` + junk.map((j) => `\n  [${j.type}] ${j.name}`).join(''));
process.stdout.write(o.join('\n') + '\n');
