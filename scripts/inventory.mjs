#!/usr/bin/env node
/**
 * inventory.mjs — first pass over an Unqork export.
 *
 * Prints: total component counts by type, per-module counts, export health signals
 * (manifest failures, or `*_Error.txt` markers + unparseable files for manual exports), and the distinct role ids found in
 * component `permissions` maps.
 *
 *   node inventory.mjs "<export-root>" [--json] [> inventory.md]
 */
import { readExport, walkComponents, tally, bump, mdTable, exportRoot, hasFlag } from './lib.mjs';

const root = exportRoot('inventory.mjs');
const { manifest, modules, unparseable, errorMarkers, aggregateMarkers } = readExport(root);
const byModType = new Map();
for (const m of modules) bump(byModType, m.kind);

const byType = new Map();
const perModule = [];
const roles = new Map();
let permissioned = 0;
let total = 0;

for (const mod of modules) {
  const local = new Map();
  let count = 0;
  walkComponents(mod.components, (c) => {
    count += 1;
    bump(byType, c.type);
    bump(local, c.type);
    if (c.permissions && Object.keys(c.permissions).length) {
      permissioned += 1;
      for (const role of Object.keys(c.permissions)) bump(roles, role);
    }
  });
  total += count;
  perModule.push({ rel: mod.rel, type: mod.kind, count, local });
}


if (hasFlag('--json')) {
  process.stdout.write(
    JSON.stringify({
      modules: modules.length,
      byModuleType: Object.fromEntries(byModType),
      components: total,
      permissioned,
      componentsByType: Object.fromEntries(tally(byType)),
      roles: Object.fromEntries(tally(roles)),
      manifest: manifest && {
        generation: manifest.generation,
        failures: manifest.failures,
        possiblyTruncated: manifest.possiblyTruncated,
      },
      errorMarkers,
      aggregateMarkers,
      unparseable,
    }) + '\n',
  );
  process.exit(0);
}

const out = [];
out.push(`# Export inventory — \`${root}\``);
out.push('');
out.push(`- **${modules.length}** module JSON files (manifest, filename map and Data Collections excluded)`);
out.push(
  `- by module type: ${tally(byModType).map(([t, n]) => `${t}:${n}`).join(', ')}`,
);
out.push(`- **${total.toLocaleString()}** components`);
out.push(`- **${permissioned.toLocaleString()}** components carry a non-empty \`permissions\` map`);
if (manifest) {
  out.push(
    `- manifest (generation ${manifest.generation}): **${manifest.failures.length}** failed, possibly_truncated: **${manifest.possiblyTruncated ?? 'n/a'}**`,
  );
} else {
  out.push(`- **${errorMarkers.length}** failed-module markers (no manifest — legacy manual export), plus ${aggregateMarkers.length} aggregate summary file(s)`);
}
out.push(`- **${unparseable.length}** unparseable files`);
out.push('');

out.push('## Components by type');
out.push('');
out.push(mdTable(['Type', 'Count'], tally(byType).map(([t, n]) => [t, n.toLocaleString()])));
out.push('');

out.push('## Role ids seen in component `permissions`');
out.push('');
out.push('Check this list for near-duplicate spellings — a misspelt role id that appears');
out.push('hundreds of times is a real, silent authorisation bug. See 07-pitfalls.md §1.');
out.push('');
out.push(mdTable(['Role id', 'Components'], tally(roles).map(([r, n]) => [`\`${r}\``, n])));
out.push('');

if (manifest?.failures.length) {
  out.push('## Export failures (manifest)');
  out.push('');
  out.push(manifest.failures.map((f) => `- ${typeof f === 'string' ? f : JSON.stringify(f)}`).join('\n'));
  out.push('');
}

if (errorMarkers.length) {
  out.push('## Export failures — these modules are unrecoverable from this export');
  out.push('');
  out.push(
    mdTable(
      ['Marker file', 'Bytes'],
      errorMarkers.map((m) => [`\`${m.rel}\``, m.size + (m.size === 0 ? ' *(empty)*' : '')]),
    ),
  );
  out.push('');
}

out.push('## Per module');
out.push('');
out.push(
  mdTable(
    ['Module', 'Type', 'Components', 'Top types'],
    perModule
      .sort((a, b) => b.count - a.count)
      .map((m) => [
        `\`${m.rel}\``,
        m.type,
        m.count,
        tally(m.local)
          .slice(0, 5)
          .map(([t, n]) => `${t}:${n}`)
          .join(', '),
      ]),
  ),
);

process.stdout.write(out.join('\n') + '\n');
