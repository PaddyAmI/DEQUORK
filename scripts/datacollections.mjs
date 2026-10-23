#!/usr/bin/env node
/**
 * datacollections.mjs — audit the Data Collections (CSV or JSON) and convert them.
 *
 * Reports each collection's shape and row count, flags mojibake (UTF-8 read as Latin-1,
 * which Unqork exports do constantly), flags multi-value cells (comma-joined lists with a
 * trailing comma), and — with `--emit <dir>` — writes each collection out as JSON plus, for
 * `value,locale,label` translation tables, per-locale i18n dictionaries.
 *
 *   node datacollections.mjs "<export-root | data-collections-dir>" [--emit ./out]
 */
import fs from 'node:fs';
import path from 'node:path';
import { mdTable, exportRoot, findDataCollectionsDir } from './lib.mjs';

const root = exportRoot('datacollections.mjs <export-root | data-collections-dir> [--emit <dir>]');
const emitAt = process.argv.includes('--emit')
  ? process.argv[process.argv.indexOf('--emit') + 1]
  : null;

/** Minimal RFC4180 parser — quoted fields, embedded commas, doubled quotes, CRLF. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/**
 * Mojibake signature: UTF-8 bytes decoded as Latin-1 leave `Ã©`, `Ã¨`, `â€™` and friends.
 * Detecting it here is cheap; discovering it in production accented labels is not.
 */
const MOJIBAKE = /Ã.|â€|Â[^\s]/;

const report = [];
// Accept the export root or the collections folder itself, in any of the three layouts
// (`Data Collection`, `Data Collections`, `datacollections`).
const dir = findDataCollectionsDir(root);
if (!dir) {
  process.stderr.write(`no Data Collections folder under ${root}\n`);
  process.exit(1);
}
const collections = fs
  .readdirSync(dir)
  .filter((f) => /\.(csv|json)$/i.test(f))
  .sort();

if (emitAt) fs.mkdirSync(emitAt, { recursive: true });

for (const file of collections) {
  const text = fs.readFileSync(path.join(dir, file), 'utf8');
  const isJson = /.json$/i.test(file);
  let headers;
  let objects;
  if (isJson) {
    // Newer exports: a JSON array of row objects. `_id` is Unqork's row key, not data.
    try {
      const parsed = JSON.parse(text);
      objects = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      process.stderr.write(`! unparseable: ${file} — ${e.message}\n`);
      objects = [];
    }
    headers = [...new Set(objects.flatMap((o) => Object.keys(o)))].filter((k) => k !== '_id');
  } else {
    const rows = parseCsv(text);
    headers = rows[0] ?? [];
    objects = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
  }
  const cells = (o) => headers.map((h) => o[h]).filter((v) => typeof v === 'string');

  const mojibake = objects.reduce((n, o) => n + (cells(o).some((c) => MOJIBAKE.test(c)) ? 1 : 0), 0);
  const multiValue = headers.filter((h) => objects.some((o) => typeof o[h] === 'string' && /,/.test(o[h])));

  const lower = headers.map((h) => h.toLowerCase());
  const isTranslation =
    lower.includes('locale') && lower.includes('label') && lower.includes('value');

  report.push({
    file,
    rows: objects.length,
    headers,
    mojibake,
    multiValue,
    kind: isTranslation ? 'translation' : 'mapping/config',
  });

  if (!emitAt) continue;

  const base = file.replace(/\.(csv|json)$/i, '');
  fs.writeFileSync(path.join(emitAt, `${base}.json`), JSON.stringify(objects, null, 2));

  if (isTranslation) {
    // value/locale/label triples fold into one dictionary per locale — which is exactly the
    // shape i18next wants, so this output drops straight into src/i18n/locales/.
    const byLocale = {};
    for (const o of objects) {
      const locale = o.locale || o.Locale;
      const dict = (byLocale[locale] ??= {});
      dict[o.value ?? o.Value] = o.label ?? o.Label;
    }
    for (const [locale, dict] of Object.entries(byLocale)) {
      fs.writeFileSync(
        path.join(emitAt, `${base}.${locale}.json`),
        JSON.stringify(dict, null, 2),
      );
    }
  }
}

const out = [];
out.push(`# Data Collections — \`${root}\``);
out.push('');
out.push(`**${collections.length}** collections.`);
if (emitAt) out.push(`JSON + per-locale dictionaries written to \`${emitAt}\`.`);
out.push('');
out.push(
  mdTable(
    ['Collection', 'Rows', 'Kind', 'Columns', 'Mojibake rows', 'Multi-value columns'],
    report.map((r) => [
      `\`${r.file}\``,
      r.rows,
      r.kind,
      r.headers.join(', '),
      r.mojibake ? `**${r.mojibake}**` : '—',
      r.multiValue.join(', ') || '—',
    ]),
  ),
);
out.push('');
out.push('## Reading this');
out.push('');
out.push('- **Mojibake rows** — UTF-8 read as Latin-1 (`Ã©` for `é`). Fix at import, once, or');
out.push('  it reaches production labels. See 07-pitfalls.md §2.');
out.push('- **Multi-value columns** — Unqork stores lists as comma-joined strings, usually with');
out.push('  a trailing comma (`"role-a,role-b,"`). Split and trim; never compare whole.');
out.push('- **translation** collections become i18n dictionaries. **mapping/config**');
out.push('  collections become typed config in `src/config/` — these carry the business rules.');

process.stdout.write(out.join('\n') + '\n');
