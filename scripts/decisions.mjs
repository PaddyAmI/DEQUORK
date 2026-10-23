#!/usr/bin/env node
/**
 * decisions.mjs — dump every `decision` table, in full.
 *
 * Decision tables ARE the business rules, and the two ways teams get them wrong are
 * (a) reading them from a summarising catalog that silently truncated long tables, and
 * (b) losing the row count, which is the only cheap check that nothing was dropped.
 * So this prints complete tables and states each row count up front.
 *
 *   node decisions.mjs "<export-root>" [filter-substring] [> decisions.md]
 *
 * The optional filter matches the decision key or module path, e.g.
 *   node decisions.mjs "<root>" Permission
 */
import { readModules, walkComponents, mdTable, exportRoot } from './lib.mjs';

const root = exportRoot('decisions.mjs [filter]');
const filter = (process.argv[3] ?? '').toLowerCase();
const modules = readModules(root);

const tables = [];
for (const mod of modules) {
  walkComponents(mod.components, (c) => {
    if (c.type !== 'decision') return;
    const rows = c.decisionData?.dataObject ?? [];
    if (filter && !`${c.key} ${mod.rel}`.toLowerCase().includes(filter)) return;
    tables.push({
      module: mod.rel,
      key: c.key,
      rows,
      inputs: (c.linked?.inputs ?? []).filter(Boolean),
      outputs: (c.linked?.outputs ?? []).filter(Boolean),
    });
  });
}

const out = [];
out.push(`# Decision tables — \`${root}\`${filter ? ` (filter: \`${filter}\`)` : ''}`);
out.push('');
out.push(`**${tables.length}** tables, **${tables.reduce((n, t) => n + t.rows.length, 0)}** rows total.`);
out.push('');
out.push('## Index');
out.push('');
out.push(
  mdTable(
    ['Key', 'Rows', 'Inputs', 'Outputs', 'Module'],
    tables
      .sort((a, b) => b.rows.length - a.rows.length)
      .map((t) => [
        `\`${t.key}\``,
        t.rows.length,
        t.inputs.join(', '),
        t.outputs.slice(0, 6).join(', ') + (t.outputs.length > 6 ? ` +${t.outputs.length - 6}` : ''),
        `\`${t.module}\``,
      ]),
  ),
);
out.push('');
out.push('---');
out.push('');

for (const t of tables) {
  // Union of keys across rows: Unqork omits a cell entirely when it is empty, so the first
  // row is not a reliable header.
  const cols = [...new Set(t.rows.flatMap((r) => Object.keys(r ?? {})))];
  out.push(`## \`${t.key}\` — ${t.rows.length} rows`);
  out.push('');
  out.push(`Module: \`${t.module}\``);
  out.push('');
  if (!cols.length) {
    out.push('*Empty table — rules are supplied at runtime.*');
  } else {
    out.push(mdTable(cols, t.rows.map((r) => cols.map((c) => r?.[c]))));
  }
  out.push('');
  out.push(
    `> Port with a test asserting exactly **${t.rows.length}** matching cases. What is *absent* ` +
      'from this table is as load-bearing as what is present.',
  );
  out.push('');
}

process.stdout.write(out.join('\n') + '\n');
