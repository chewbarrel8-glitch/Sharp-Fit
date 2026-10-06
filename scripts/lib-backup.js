// db.json 覆盖前自动备份：回归测试 / 恢复演示数据会整库覆盖用户实时数据，
// 覆盖前在此备份；内容与现有备份相同则跳过（演示数据连续回归不堆积），最多保留 10 份不同版本
const fs = require('node:fs');
const path = require('node:path');

function dbPath() {
  // Electron 默认 userData = ~/Library/Application Support/<productName>（macOS）
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  return path.join(process.env.HOME, 'Library', 'Application Support', pkg.productName || pkg.name, 'db.json');
}

function backupDB() {
  const p = dbPath();
  if (!fs.existsSync(p)) return;
  const content = fs.readFileSync(p);
  const dir = path.dirname(p);
  const prefix = 'db.json.bak-auto-';
  const olds = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
  for (const f of olds) {
    try { if (fs.readFileSync(path.join(dir, f)).equals(content)) return; } catch (e) {}
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  fs.writeFileSync(path.join(dir, prefix + ts), content);
  // 演示数据每次构建 uid 不同（内容必不同），20 份约可回溯 10 轮回归
  while (olds.length >= 20) { try { fs.unlinkSync(path.join(dir, olds.shift())); } catch (e) { break; } }
  console.log('BACKUP - 已备份现有 db.json → ' + prefix + ts);
}

function snapshotPath() {
  return path.join(path.dirname(dbPath()), 'db.json.pre-e2e-snapshot');
}

// e2e 开跑前固定快照：无论 auto 备份链如何，本轮结束后无条件恢复它，
// 保证测试夹具（橄榄球计划等）绝不会残留在用户的 db.json 中
function snapshotBefore() {
  const p = dbPath();
  if (!fs.existsSync(p)) return null;
  const snap = snapshotPath();
  fs.copyFileSync(p, snap);
  return snap;
}

function restoreSnapshot() {
  const p = dbPath();
  const snap = snapshotPath();
  if (!fs.existsSync(snap)) return false;
  fs.copyFileSync(snap, p);
  try { fs.unlinkSync(snap); } catch (e) {}
  console.log('RESTORE - 已恢复 e2e 开跑前的 db.json');
  return true;
}

module.exports = { backupDB, dbPath, snapshotBefore, restoreSnapshot };
