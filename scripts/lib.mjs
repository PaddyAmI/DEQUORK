// Shared helpers for the Unqork export mining scripts.
// No dependencies — Node 20+ only.

import fs from 'node:fs';
import path from 'node:path';

/** Editor/runtime noise that carries no meaning. Strip before diffing or printing. */
export const NOISE_KEYS = new Set([
  '$$hashKey',
  '$activeRuntime',
  'wasDropped',
  'parentChanged',
  'react',
  'vegaEnabled',
  'breadcrumb',
  'tableView',
  'protected',
  'unique',
  'frozen',
  'watcherList',
]);

const DC_DIR = /^data[ _-]?collections?$/i;
const norm = (p) => String(p ?? '').replace(/\\/g, '/');

/** True when any path segment is a Data Collections folder (`Data Collection(s)`, `datacollections`). */
export function isDataCollectionPath(rel) {
  return norm(rel).split('/').some((seg) => DC_DIR.test(seg));
}

/** The Data Collections folder: `root` itself, or a direct child of it. Null if absent. */
export function findDataCollectionsDir(root) {
  if (DC_DIR.test(path.basename(path.resolve(root)))) return root;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (e.isDirectory() && DC_DIR.test(e.name)) return path.join(root, e.name);
  }
  return null;
}

/**
 * Read `manifest.json` (+ `filename_map.json`) if present and normalise both known shapes.
 * Returns null for a legacy manual export, which has neither.
 *
 *   generation 'b' — `modules[]` with `bytes`; file names live in `filename_map.json`
 *   generation 'c' — `downloaded[]` with `file_name` and `size`, plus `failed` / `possibly_truncated`
 *
 * `entries` is `[{ id, name, title, size, file, quick_link }]`; `file` is null when unknown.
 */
export function loadManifest(root) {
  const mp = path.join(root, 'manifest.json');
  if (!fs.existsSync(mp)) return null;
  let m;
  try {
    m = JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch (e) {
    process.stderr.write(`! unparseable: ${mp} — ${e.message}\n`);
    return null;
  }
  let renames = [];
  const fp = path.join(root, 'filename_map.json');
  if (fs.existsSync(fp)) {
    try {
      renames = JSON.parse(fs.readFileSync(fp, 'utf8')).renames ?? [];
    } catch {
      /* optional file */
    }
  }
  const fileById = new Map(renames.map((r) => [r.id, r.file]));
  const entries = (m.downloaded ?? m.modules ?? []).map((e) => ({
    id: e.id,
    name: e.name ?? null,
    title: e.title ?? null,
    size: e.size ?? e.bytes ?? null,
    file: norm(e.file_name ?? fileById.get(e.id) ?? '') || null,
    quick_link: e.quick_link ?? null,
  }));
  return {
    generation: Array.isArray(m.downloaded) ? 'c' : 'b',
    applicationId: m.application_id ?? null,
    environment: m.environment ?? null,
    entries,
    failures: m.failures ?? m.failed ?? [],
    possiblyTruncated: m.possibly_truncated ?? null,
    declaredCount: m.module_count ?? null,
    collectionsDownloaded: m.data_collections_downloaded ?? [],
    collectionsFailed: m.data_collections_failed ?? [],
  };
}

/**
 * Scan an export. Returns { manifest, modules, unparseable, errorMarkers, aggregateMarkers }.
 *
 * Each module is { file, rel, id, name, title, type, kind, deleted, size, components };
 * `kind` is `type`, else guessed from the folder name. Metadata
 * comes from the module object itself (generations b/c wrap components in an object); for a
 * bare component array (legacy manual export) it comes from the manifest, matched by
 * `file_name` or bare filename, else null. Skipped: manifest.json, filename_map.json and
 * everything under a Data Collections folder (rows, not components).
 * Unparseable files go to stderr and the `unparseable` list, never thrown — exports
 * routinely contain a handful of broken files and one must not stop a whole-export pass.
 */
export function readExport(root, { quiet = false } = {}) {
  const manifest = loadManifest(root);
  const byRel = new Map();
  const byBase = new Map();
  for (const e of manifest?.entries ?? []) {
    if (!e.file) continue;
    byRel.set(e.file.toLowerCase(), e);
    byBase.set(path.posix.basename(e.file).toLowerCase(), e);
  }
  const modules = [];
  const unparseable = [];
  const errorMarkers = []; // per-module `*_Error.txt` — one failed module each
  const aggregateMarkers = []; // `*_All_Errors.txt` — summaries, not extra failures
  for (const file of walkFiles(root)) {
    const rel = norm(path.relative(root, file));
    if (/_All_Errors\.txt$/i.test(rel)) {
      aggregateMarkers.push({ rel, size: fs.statSync(file).size });
      continue;
    }
    if (/_Error\.txt$/i.test(rel)) {
      errorMarkers.push({ rel, size: fs.statSync(file).size });
      continue;
    }
    if (!file.endsWith('.json') || isDataCollectionPath(rel)) continue;
    if (/^(manifest|filename_map)\.json$/i.test(rel)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      const meta = byRel.get(rel.toLowerCase()) ?? byBase.get(path.posix.basename(rel).toLowerCase());
      modules.push({
        file,
        rel,
        id: obj?._id ?? meta?.id ?? null,
        name: obj?.name ?? meta?.name ?? null,
        title: obj?.title ?? meta?.title ?? null,
        type: obj?.type ?? null,
        // Folder-name guess for bare-array exports, which carry no `type`.
        kind: obj?.type ?? (/(^|\/)api/i.test(path.posix.dirname(rel)) ? 'api' : /frontend/i.test(path.posix.dirname(rel)) ? 'ui' : 'unknown'),
        deleted: obj?.deleted ?? null,
        size: fs.statSync(file).size,
        components: Array.isArray(parsed) ? parsed : Array.isArray(obj?.components) ? obj.components : [],
      });
    } catch (e) {
      unparseable.push({ rel, message: e.message });
      if (!quiet) process.stderr.write(`! unparseable: ${file} — ${e.message}\n`);
    }
  }
  return { manifest, modules, unparseable, errorMarkers, aggregateMarkers };
}

/** Just the modules — see `readExport` for the rest. */
export function readModules(root) {
  return readExport(root).modules;
}

/** Positional args: everything that is not a `--flag` or a listed flag's value. */
export function positional(valueFlags = ['--emit', '--services']) {
  const a = process.argv.slice(2);
  const out = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith('--')) {
      if (valueFlags.includes(a[i])) i += 1;
    } else out.push(a[i]);
  }
  return out;
}

export const hasFlag = (f) => process.argv.includes(f);
export const flagValue = (f) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : null;
};

function* walkFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      yield* walkFiles(full);
    } else {
      yield full;
    }
  }
}

/**
 * Properties that hold *child components*. Unqork buries components in `columns[].components`
 * and `rows[][].components` as well as the obvious `components`, so a `components`-only
 * recursion misses whole subtrees.
 *
 * This is an allowlist rather than "recurse into everything with a `type`" because the
 * configuration payloads (`dataworkflowData`, `decisionData`, `viewgridData`, …) are full of
 * objects that also carry `type`/`key` — every data-workflow operator is one. Walking those
 * inflates a 20k-component app to 30k and fills the type tally with `Get`, `Set`, `Output`
 * and `Formula Value`, which are operators, not components.
 */
const COMPONENT_CONTAINERS = new Set(['components', 'columns', 'rows', 'panels', 'tabs']);

/**
 * Depth-first walk of a component tree. Calls `visit(component, ancestorKeys)` for every
 * component, parents before children. Cycles are impossible in exported JSON.
 */
export function walkComponents(node, visit, ancestors = []) {
  if (Array.isArray(node)) {
    for (const child of node) walkComponents(child, visit, ancestors);
    return;
  }
  if (!node || typeof node !== 'object') return;

  const isComponent = typeof node.type === 'string' && 'key' in node;
  if (isComponent) visit(node, ancestors);
  const nextAncestors = isComponent ? [...ancestors, node.key] : ancestors;

  for (const container of COMPONENT_CONTAINERS) {
    const v = node[container];
    if (v && typeof v === 'object') walkComponents(v, visit, nextAncestors);
  }
}

/** Sorted `[key, count]` pairs, descending by count. */
export function tally(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function bump(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

/** Markdown table from a header row and rows of cells. */
export function mdTable(headers, rows) {
  const esc = (c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}

/** Resolve the export root from argv[2], with a usage error if absent. */
export function exportRoot(usage) {
  const root = positional()[0];
  if (!root || !fs.existsSync(root)) {
    process.stderr.write(`usage: node ${usage} <path-to-export-root>\n`);
    process.exit(1);
  }
  return root;
}
