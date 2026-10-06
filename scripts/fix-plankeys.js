const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(process.env.HOME, 'Library/Application Support/训练计划管理平台');
const DB_PATH = path.join(DB_DIR, 'db.json');

function uid(prefix) { return prefix + Math.random().toString(36).slice(2, 9); }
function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
const sessions = raw.sessions || [];
const mesos = raw.mesos || [];

let fixed = 0, skipped = 0;

for (const ses of sessions) {
  if (!ses.mesoId || ses.planKey) { skipped++; continue; }
  const meso = mesos.find(m => m.id === ses.mesoId);
  if (!meso) { skipped++; console.log('skip no meso', ses.mesoId); continue; }
  if (!meso.days) meso.days = [];
  let dayRec = meso.days.find(d => d.date === ses.date);
  if (!dayRec) {
    dayRec = { date: ses.date, note: '', courses: [] };
    meso.days.push(dayRec);
  }
  // 旧结构兼容
  if (!Array.isArray(dayRec.courses)) {
    dayRec.courses = [{ name: dayRec.note || '', type: dayRec.type || '', rows: dayRec.rows || [] }];
    delete dayRec.rows; delete dayRec.note; delete dayRec.type;
  }
  const course = { id: uid('mcs'), name: ses.name || '训练课', type: ses.type || '', rows: deepClone(ses.rows || []) };
  dayRec.courses.push(course);
  ses.planKey = meso.id + ':' + ses.date + ':' + course.id;
  ses.fromMeso = true;
  fixed++;
}

fs.writeFileSync(DB_PATH, JSON.stringify(raw, null, 2), 'utf8');
console.log({ fixed, skipped, total: sessions.length });
