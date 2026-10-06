// 一次性迁移：同项目两个训练计划（准备期/竞赛期大周期）合并为一个年度计划
// 合并后：一个 macro + 两个大周期 cycles；mesos/athletes 的 macroId 重定向；
// compDates/testDates/athletes/goalBlocks/weekPlan 并集去重；db.json 先备份。
// 运行前须关闭应用（node scripts/migrate-merge-macros.js）
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function findDb() {
  const cands = ['训练计划管理平台', 'training-plan-platform', 'Electron'];
  for (const name of cands) {
    const p = path.join(os.homedir(), 'Library', 'Application Support', name, 'db.json');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const dbFile = findDb();
if (!dbFile) { console.log('FAIL - 未找到 db.json'); process.exit(2); }
const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const macros = (raw.macros || []).slice().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));

if (macros.length !== 2) { console.log('SKIP - 训练计划数量为 ' + macros.length + '（非 2 个，无需合并）'); process.exit(0); }
const [base, other] = macros;
if (base.sport !== other.sport) { console.log('SKIP - 两个计划项目不同（' + base.sport + ' / ' + other.sport + '），不自动合并'); process.exit(0); }

// 备份
const bak = dbFile + '.bak-merge-' + new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(bak, JSON.stringify(raw));
console.log('BACKUP - ' + bak);

const uid = (p) => p + Math.random().toString(36).slice(2, 10);
const cycleName = (n) => { const i = String(n).lastIndexOf('·'); return i >= 0 ? n.slice(i + 1).trim() : n; };

const merged = JSON.parse(JSON.stringify(base));
merged.name = base.name.replace(/·.*$/, '').trim().replace(/大周期|准备期$/, '') + '训练计划';
merged.startDate = base.startDate <= other.startDate ? base.startDate : other.startDate;
merged.endDate = base.endDate >= other.endDate ? base.endDate : other.endDate;
merged.cycles = [
  { id: uid('cyc'), name: cycleName(base.name), startDate: base.startDate, endDate: base.endDate },
  { id: uid('cyc'), name: cycleName(other.name), startDate: other.startDate, endDate: other.endDate }
];
// 计划内数组并集去重（compDates/testDates 按日期）
const byKey = (arr, k) => { const seen = new Set(); return (arr || []).filter((x) => !seen.has(x[k]) && seen.add(x[k])); };
merged.compDates = byKey((base.compDates || []).concat(other.compDates || []), 'date');
merged.testDates = byKey((base.testDates || []).concat(other.testDates || []), 'date');
merged.athletes = Array.from(new Set((base.athletes || []).concat(other.athletes || [])));
merged.goalBlocks = (base.goalBlocks || []).concat(other.goalBlocks || []);
merged.weekPlan = Object.assign({}, base.weekPlan || {}, other.weekPlan || {});
merged.note = [base.note, other.note].filter(Boolean).filter((n, i, a) => a.indexOf(n) === i).join('；');

// 重定向 mesos / athletes 的 macroId
const oldIds = new Set([base.id, other.id]);
let mesoN = 0, athN = 0;
for (const m of raw.mesos || []) if (oldIds.has(m.macroId)) { m.macroId = merged.id; mesoN++; }
for (const a of raw.athletes || []) if (oldIds.has(a.macroId)) { a.macroId = merged.id; athN++; }

raw.macros = [merged];
raw.settings = raw.settings || {};
raw.settings.activeMacroId = merged.id;

const tmp = dbFile + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(raw));
fs.renameSync(tmp, dbFile);

console.log('PASS - 已合并为 1 个训练计划: ' + merged.name + '（' + merged.startDate + ' → ' + merged.endDate + '）');
console.log('  大周期: ' + merged.cycles.map((c) => c.name + ' ' + c.startDate + '~' + c.endDate).join(' | '));
console.log('  中周期重定向 ' + mesoN + ' 个 / 运动员重定向 ' + athN + ' 人 / 比赛日 ' + merged.compDates.length + ' / 测试日 ' + merged.testDates.length + ' / 目标块 ' + merged.goalBlocks.length);
