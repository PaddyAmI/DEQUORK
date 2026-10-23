#!/usr/bin/env node
/**
 * integrators.mjs — extract the API surface from an Unqork export.
 *
 * Separates the two worlds that matter:
 *   - EXTERNAL calls  → the real backend contract you must reproduce
 *   - PLATFORM calls  → `/fbu/uapi/...` hops that exist only because Unqork exists
 *
 * Also resolves every referenced server-side module id against the ids actually exported
 * (manifest entries plus the `_id` of each module file), which is how you detect a truncated
 * export (see 01-export-anatomy.md §3.2). Legacy manual exports carry no ids, so there the
 * only check is the distinct-id count against the number of API module files.
 *
 *   node integrators.mjs "<export-root>" [--services <registry.md|csv>] [--json] [> api-surface.md]
 *
 * --services  a markdown or CSV table of the tenant's service registry (columns: title, name,
 *             auth, host — header names matched case-insensitively). Joins each integrator's
 *             `service` to a host and lists services referenced-but-unregistered and vice versa.
 * --json      machine-readable summary instead of Markdown.
 */
import fs from 'node:fs';
import { readExport, walkComponents, tally, bump, mdTable, exportRoot, hasFlag, flagValue } from './lib.mjs';

const root = exportRoot('integrators.mjs');
const { manifest, modules } = readExport(root);
const modName = (m) => m.name ?? m.rel;

const knownIds = new Map(); // exported module id → display name
for (const e of manifest?.entries ?? []) knownIds.set(e.id, e.name ?? e.title ?? e.id);
for (const m of modules) if (m.id) knownIds.set(m.id, modName(m));
const haveIds = knownIds.size > 0;

const kinds = new Map(); // module type → count
for (const m of modules) bump(kinds, m.kind);

/** Parse a markdown or CSV table into [{header: cell}] with lower-cased headers. */
function parseTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !/^\s*\|?\s*:?-{3,}/.test(l));
  const split = (l) =>
    l.includes('|')
      ? l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      : l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0] ?? '').map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((c, i) => [head[i], c])));
}
const registryFile = flagValue('--services');
const registry = registryFile ? parseTable(fs.readFileSync(registryFile, 'utf8')) : null;

const external = []; // real backend calls
const platform = new Map(); // `/fbu/uapi/...` pattern → count
const moduleIds = new Map(); // referenced server-side module id → caller module names
const dataCollections = new Map(); // Data Collection name → count
const services = new Map();

/** `/fbu/uapi/modules/{24-hex}/execute` → `/fbu/uapi/modules/{moduleId}/execute` */
function generalise(url) {
  return url
    .replace(/[0-9a-f]{24}/gi, '{moduleId}')
    .replace(/\/query\/[^/]+\//, '/query/{table}/')
    .replace(/\/workflow-execute\/[^/]+\//, '/workflow-execute/{workflow}/');
}

for (const mod of modules) {
  walkComponents(mod.components, (c) => {
    if (c.type !== 'integrator') return;
    const url = c.integratorData?.integratorUrl ?? c.unqorkApi ?? '';
    const verb = String(c.requestType ?? '').toUpperCase();
    const isPlatform = c.serviceType === 'unqork' || url.startsWith('/fbu/uapi/');

    if (isPlatform) {
      bump(platform, `${verb} ${generalise(url)}`);
      const id = url.match(/\/modules\/([0-9a-f]{24})\//i)?.[1];
      if (id) {
        if (!moduleIds.has(id)) moduleIds.set(id, new Set());
        moduleIds.get(id).add(modName(mod));
      }
      const table = url.match(/\/query\/([^/]+)\//)?.[1];
      if (table) bump(dataCollections, decodeURIComponent(table));
      return;
    }

    if (c.service) bump(services, c.service);
    external.push({
      module: modName(mod),
      key: c.key,
      verb,
      url,
      service: c.service ?? '',
      // The request mapping is reliable; the output mapping only tells you which response
      // fields the UI happened to consume — a lower bound, never the contract.
      inputs: (c.integratorData?.dataInputObject ?? [])
        .map((i) => i?.mapping ?? i?.id)
        .filter(Boolean),
      postTrigger: c.postTrigger ?? '',
    });
  });
}

const unresolved = haveIds ? [...moduleIds].filter(([id]) => !knownIds.has(id)) : [];
const hostOf = new Map((registry ?? []).flatMap((r) => [[r.name, r.host], [r.title, r.host]]));
const regNames = new Set((registry ?? []).flatMap((r) => [r.name, r.title]).filter(Boolean));
const notRegistered = registry ? [...services.keys()].filter((n) => !regNames.has(n)) : [];
const registeredUnused = registry
  ? registry.filter((r) => !services.has(r.name) && !services.has(r.title)).map((r) => r.name || r.title)
  : [];
const callers = (set) => [...set].slice(0, 4).join(', ') + (set.size > 4 ? ` +${set.size - 4} more` : '');

if (hasFlag('--json')) {
  process.stdout.write(
    JSON.stringify({
      externalCalls: external.length,
      platformCalls: [...platform.values()].reduce((a, b) => a + b, 0),
      moduleTypes: Object.fromEntries(kinds),
      idsAvailable: haveIds,
      referencedModuleIds: moduleIds.size,
      unresolvedModuleIds: unresolved.map(([id, c]) => ({ id, from: [...c] })),
      dataCollections: Object.fromEntries(dataCollections),
      services: Object.fromEntries(services),
      servicesNotInRegistry: notRegistered,
      registryNotReferenced: registeredUnused,
      external,
    }) + '\n',
  );
  process.exit(0);
}

const out = [];
out.push(`# API surface — \`${root}\``);
out.push('');
out.push(`- **${external.length}** external integrator calls (the real backend contract)`);
out.push(`- **${[...platform.values()].reduce((a, b) => a + b, 0)}** platform calls — deleted in the rewrite`);
out.push(`- **${moduleIds.size}** distinct server-side module ids referenced`);
out.push(`- **${dataCollections.size}** distinct Data Collections queried`);
out.push(`- module types exported: ${tally(kinds).map(([t, n]) => `${t}:${n}`).join(', ')}`);
out.push('');
if (haveIds) {
  out.push(
    `> **${unresolved.length}** of ${moduleIds.size} referenced module ids are not in the export` +
      (manifest ? ' (checked against the manifest and module files).' : ' (checked against module files).'),
  );
} else {
  out.push('> Legacy export: no module ids to resolve. If the module-id count above exceeds the');
  out.push(`> ${kinds.get('api') ?? 0} API module files present, the export is truncated — see 01-export-anatomy.md §3.2.`);
}
out.push('');

if (unresolved.length) {
  out.push('## Unresolved module ids — referenced, not exported');
  out.push('');
  out.push(mdTable(['Module id', 'Referenced by'], unresolved.map(([id, c]) => [`\`${id}\``, callers(c)])));
  out.push('');
}

out.push('## External calls — reproduce these');
out.push('');
out.push(
  mdTable(
    ['Verb', 'URL', 'Service', 'Component', 'Module', 'Request fields', 'postTrigger'],
    external
      .sort((a, b) => (a.url + a.verb).localeCompare(b.url + b.verb))
      .map((e) => [
        e.verb,
        `\`${e.url}\``,
        e.service,
        `\`${e.key}\``,
        `\`${e.module}\``,
        e.inputs.join(', '),
        e.postTrigger && `\`${e.postTrigger}\``,
      ]),
  ),
);
out.push('');

if (services.size) {
  out.push('## Named external services');
  out.push('');
  out.push(
    mdTable(
      registry ? ['Service', 'Calls', 'Host'] : ['Service', 'Calls'],
      tally(services).map(([n, c]) => (registry ? [n, c, hostOf.get(n) ?? '*(not in registry)*'] : [n, c])),
    ),
  );
  out.push('');
}
if (registry) {
  out.push(`## Service registry cross-check (${registry.length} registry rows)`);
  out.push('');
  out.push(`- referenced but not in registry: ${notRegistered.join(', ') || '—'}`);
  out.push(`- in registry but never referenced: ${registeredUnused.join(', ') || '—'}`);
  out.push('');
}

out.push('## Platform calls — delete these');
out.push('');
out.push(mdTable(['Pattern', 'Count'], tally(platform)));
out.push('');

out.push('## Data Collections queried at runtime');
out.push('');
out.push('Cross-check against the exported Data Collections — anything queried but not exported');
out.push('is a missing artefact you must chase.');
out.push('');
out.push(mdTable(['Collection', 'Queried by'], tally(dataCollections)));
out.push('');

out.push('## Server-side module ids referenced by the frontend');
out.push('');
out.push(
  mdTable(
    haveIds ? ['Module id', 'Name', 'Called from'] : ['Module id', 'Called from'],
    [...moduleIds.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .map(([id, c]) => [
        `\`${id}\``,
        ...(haveIds ? [knownIds.get(id) ?? '**unresolved**'] : []),
        callers(c),
      ]),
  ),
);

process.stdout.write(out.join('\n') + '\n');
