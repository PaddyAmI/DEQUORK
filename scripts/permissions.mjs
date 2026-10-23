#!/usr/bin/env node
/**
 * permissions.mjs — the component-level role matrix.
 *
 * Every component carrying a non-empty `permissions` map, grouped by module. This is the
 * raw material for a real permission policy: read it, then express it in DOMAIN terms
 * ("a policy handler may reassign an open project") rather than porting hundreds of
 * per-component hide flags.
 *
 * It also prints a role-id frequency table, which is how you catch the misspelt-role bug
 * described in 07-pitfalls.md §1.
 *
 *   node permissions.mjs "<export-root>" [> permissions.md]
 */
import { readModules, walkComponents, tally, bump, mdTable, exportRoot } from './lib.mjs';

const root = exportRoot('permissions.mjs');
const modules = readModules(root);

const roleCounts = new Map();
const levels = new Map();
const entries = [];

for (const mod of modules) {
  walkComponents(mod.components, (c, ancestors) => {
    const perms = c.permissions;
    if (!perms || !Object.keys(perms).length) return;
    for (const [role, level] of Object.entries(perms)) {
      bump(roleCounts, role);
      bump(levels, String(level));
    }
    entries.push({
      module: mod.rel,
      key: c.key,
      type: c.type,
      path: ancestors.join(' › '),
      perms,
    });
  });
}

const roles = [...roleCounts.keys()].sort();

const out = [];
out.push(`# Component permission matrix — \`${root}\``);
out.push('');
out.push(`**${entries.length}** permissioned components across **${roles.length}** role ids.`);
out.push('');

out.push('## Role ids — check for near-duplicate spellings');
out.push('');
out.push(
  mdTable(
    ['Role id', 'Components'],
    tally(roleCounts).map(([r, n]) => [`\`${r}\``, n]),
  ),
);
out.push('');
out.push('> Two role ids differing by one character are almost never two roles. The more');
out.push('> frequent spelling is what the components actually gate on; the rarer one may be');
out.push('> what the backend sends. Reconcile at the boundary and normalise inbound — never');
out.push('> pick one and hope. See 07-pitfalls.md §1.');
out.push('');

out.push('## Permission levels in use');
out.push('');
out.push(mdTable(['Level', 'Count'], tally(levels)));
out.push('');

out.push('## Every permissioned component');
out.push('');
out.push(
  mdTable(
    ['Module', 'Component', 'Type', 'Path', ...roles],
    entries.map((e) => [
      `\`${e.module}\``,
      `\`${e.key}\``,
      e.type,
      e.path,
      ...roles.map((r) => e.perms[r] ?? ''),
    ]),
  ),
);

process.stdout.write(out.join('\n') + '\n');
