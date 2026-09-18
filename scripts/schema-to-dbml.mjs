import { readFileSync, writeFileSync } from 'node:fs';
const src = readFileSync(process.argv[2], 'utf8');

const GROUPS = [
  ['Exam Taxonomy', '#B83939', ['Exam', 'ExamStage']],
  ['Base Configs', '#C2703D', ['BaseConfig', 'BaseConfigModule', 'BaseConfigSection']],
  [
    'Question Bank',
    '#B8860B',
    ['Subject', 'Topic', 'Question', 'QuestionVersion', 'SavedQuestion', 'QuestionFlag'],
  ],
  ['Tests & Papers', '#2E7D5B', ['Test', 'PaperQuestion']],
  ['Attempts', '#2563A8', ['Attempt', 'AttemptSheet']],
  ['People & Identity', '#6D4AA8', ['Student', 'StudentProfile', 'Admin', 'StudentConsent']],
  ['Admin Permissions', '#8A4A8F', ['AdminFeaturePermission']],
  [
    'Access: Programs / Branches / Series',
    '#1F7A8C',
    ['Branch', 'TestSeries', 'Program', 'StudentGrant', 'TestProgramUnlock'],
  ],
  [
    'Analytics Rollups',
    '#3F7E44',
    ['StudentStat', 'StudentSubjectStat', 'TestStat', 'TestSectionStat', 'TestQuestionStat'],
  ],
  [
    'Audit, Notifications & Durability',
    '#6B6B6B',
    [
      'ImportLog',
      'RowActionLog',
      'Notification',
      'Announcement',
      'NotificationDelivery',
      'PushSubscription',
      'PushDevice',
      'OutboxEvent',
      'ProcessedRollup',
    ],
  ],
  ['Events', '#A85A2E', ['Event', 'EventCandidate']],
];

const noComments = src
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, '').replace(/\s+$/, ''))
  .join('\n');
const SCALARS = new Set([
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'DateTime',
  'Json',
  'Bytes',
]);
const enums = new Map();
const models = [];
const blockRe = /(model|enum)\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
let m;
while ((m = blockRe.exec(noComments)) !== null) {
  const [, kind, name, body] = m;
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (kind === 'enum')
    enums.set(
      name,
      lines.filter((l) => /^\w+/.test(l)).map((l) => l.split(/\s+/)[0]),
    );
  else models.push({ name, body: lines });
}
const enumNames = new Set(enums.keys());
function balanced(str, open) {
  let d = 0,
    o = '';
  for (let i = open; i < str.length; i++) {
    const c = str[i];
    if (c === '(') {
      d++;
      if (d === 1) continue;
    }
    if (c === ')') {
      d--;
      if (d === 0) return o;
    }
    o += c;
  }
  return o;
}
function attrArgs(a, n) {
  const i = a.indexOf('@' + n + '(');
  if (i === -1) return null;
  return balanced(a, a.indexOf('(', i));
}
function listArg(args, key) {
  const re = new RegExp(key + '\\s*:\\s*\\[([^\\]]*)\\]');
  const mm = args && args.match(re);
  return mm
    ? mm[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null;
}
function mapType(base, dbAttr) {
  if (dbAttr) return dbAttr.replace(/^Var(?=Char)/, 'var').toLowerCase();
  switch (base) {
    case 'String':
      return 'text';
    case 'Boolean':
      return 'boolean';
    case 'Int':
      return 'integer';
    case 'BigInt':
      return 'bigint';
    case 'Float':
      return 'double';
    case 'Decimal':
      return 'decimal';
    case 'DateTime':
      return 'timestamptz';
    case 'Json':
      return 'jsonb';
    case 'Bytes':
      return 'bytea';
    default:
      return base;
  }
}
function fmtDefault(raw) {
  if (raw == null) return null;
  const v = raw.trim();
  if (/^\[.*\]$/.test(v)) return null;
  if (v === 'true' || v === 'false') return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  const dg = v.match(/^dbgenerated\(\s*"(.*)"\s*\)$/);
  if (dg) return '`' + dg[1] + '`';
  if (/\)$/.test(v) && /\(/.test(v)) return '`' + v + '`';
  return "'" + v.replace(/^"|"$/g, '') + "'";
}
const refs = [];
for (const model of models) {
  const cols = [];
  const indexes = [];
  for (const line of model.body) {
    if (line.startsWith('@@')) {
      if (/^@@id\(/.test(line) || /^@@unique\(/.test(line) || /^@@index\(/.test(line)) {
        const args = balanced(line, line.indexOf('('));
        const fm = args.match(/\[([^\]]*)\]/);
        const flds = (fm ? fm[1].split(',').map((s) => s.trim()) : [])
          .filter(Boolean)
          .map((f) => f.replace(/\(.*\)/, ''));
        if (flds.length === 0) continue;
        const setting = /^@@id/.test(line) ? ' [pk]' : /^@@unique/.test(line) ? ' [unique]' : '';
        indexes.push('(' + flds.join(', ') + ')' + setting);
      }
      continue;
    }
    const mm = line.match(/^(\w+)\s+([A-Za-z0-9_]+)(\[\])?(\?)?\s*(.*)$/);
    if (!mm) continue;
    const [, fname, baseType, arr, opt, attrs] = mm;
    const isArray = !!arr;
    const optional = !!opt;
    if (!SCALARS.has(baseType) && !enumNames.has(baseType)) {
      const rel = attrArgs(attrs, 'relation');
      if (rel) {
        const fields = listArg(rel, 'fields');
        const references = listArg(rel, 'references');
        if (fields && references) {
          const od = rel.match(/onDelete:\s*(\w+)/);
          const del = od
            ? {
                Restrict: 'restrict',
                Cascade: 'cascade',
                SetNull: 'set null',
                NoAction: 'no action',
              }[od[1]] || null
            : null;
          const left = fields.length > 1 ? '(' + fields.join(', ') + ')' : fields[0];
          const right = references.length > 1 ? '(' + references.join(', ') + ')' : references[0];
          refs.push(
            'Ref: ' +
              model.name +
              '.' +
              left +
              ' > ' +
              baseType +
              '.' +
              right +
              (del ? ' [delete: ' + del + ']' : ''),
          );
        }
      }
      continue;
    }
    const dbAttr = (attrs.match(/@db\.(\w+(?:\([^)]*\))?)/) || [])[1];
    let type = mapType(baseType, dbAttr);
    const settings = [];
    if (/@id\b/.test(attrs)) settings.push('pk');
    if (/@unique\b/.test(attrs)) settings.push('unique');
    if (!optional && !/@id\b/.test(attrs)) settings.push('not null');
    const def = fmtDefault(attrArgs(attrs, 'default'));
    if (def != null) settings.push('default: ' + def);
    if (isArray) settings.push("note: 'array'");
    const setStr = settings.length ? ' [' + settings.join(', ') + ']' : '';
    cols.push('  ' + fname + ' ' + type + setStr);
  }
  const parts = ['Table ' + model.name + ' {', ...cols];
  if (indexes.length) parts.push('  indexes {', ...indexes.map((i) => '    ' + i), '  }');
  parts.push('}');
  model.dbml = parts.join('\n');
}

const out = [];
out.push('// IACE — generated from prisma/schema.prisma by scripts/schema-to-dbml.mjs');
out.push('// Regenerate: node scripts/schema-to-dbml.mjs prisma/schema.prisma docs/schema.dbml');
out.push(
  "// Arrays are marked note:'array' (DBML has no native array type); native DB types are lifted from @db.*",
);
out.push('');
for (const [name, values] of enums) {
  out.push('Enum ' + name + ' {', ...values.map((v) => '  ' + v), '}', '');
}
for (const model of models) out.push(model.dbml, '');
for (const r of refs) out.push(r);
out.push('');
out.push('// ============================================================================');
out.push('// Table groups. Colors are kept as trailing comments: @dbml/core rejects');
out.push('// `[color: ...]` on a TableGroup (dbdiagram.io-only syntax) and would fail to parse.');
out.push('// ============================================================================');
out.push('');
for (const [title, color, tables] of GROUPS) {
  out.push(
    'TableGroup "' + title + '" { // color: ' + color,
    ...tables.map((t) => '  ' + t),
    '}',
    '',
  );
}
writeFileSync(process.argv[3], out.join('\n'));
const inGroups = new Set(GROUPS.flatMap((g) => g[2]));
const modelNames = new Set(models.map((x) => x.name));
const ungrouped = [...modelNames].filter((n) => !inGroups.has(n));
const stale = [...inGroups].filter((n) => !modelNames.has(n));
console.log(
  'tables=' +
    models.length +
    ' enums=' +
    enums.size +
    ' refs=' +
    refs.length +
    ' groups=' +
    GROUPS.length,
);
if (ungrouped.length) console.log('!! UNGROUPED (add to a group): ' + ungrouped.join(', '));
if (stale.length) console.log('!! STALE (group lists a table not in schema): ' + stale.join(', '));
if (!ungrouped.length && !stale.length)
  console.log('coverage: all ' + models.length + ' tables grouped, no stale entries');
