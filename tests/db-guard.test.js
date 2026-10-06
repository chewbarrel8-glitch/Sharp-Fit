const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { safeReadJson, writeJsonFileAtomic } = require('../db-guard');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharp-fit-db-'));
const filePath = path.join(tempDir, 'db.json');

try {
  writeJsonFileAtomic(filePath, { ok: true, value: 42 });
  const data = safeReadJson(filePath);
  assert.deepStrictEqual(data, { ok: true, value: 42 });

  fs.writeFileSync(filePath, '{broken json', 'utf8');
  const recovered = safeReadJson(filePath);
  assert.strictEqual(recovered, null);
  const badBackup = fs.readdirSync(tempDir).find((name) => name.includes('.corrupt-'));
  assert.ok(badBackup, 'corrupt backup should be created');

  const d = {
    macros: [{ id: 'm1', name: 'Plan 1' }, { id: 'm2', name: 'Plan 2' }],
    athletes: [{ id: 'a1', macroId: 'm1' }, { id: 'a2', macroId: 'm2' }],
    loadEntries: [{ athleteId: 'a1', id: 'l1' }],
    sessions: [{ id: 's1', athletes: ['a1', 'a2'], results: { a1: [{ w: 10 }], a2: [{ w: 20 }] }, athSrpe: { a1: 8, a2: 7 } }],
    tests: [{ athleteId: 'a1', id: 't1' }],
    profiles: [{ athleteId: 'a1', id: 'p1' }],
    athleteRm: { a1: { ex1: { value: 100 } } },
    mesos: [{ id: 'mes1', macroId: 'm1', days: [{ athletes: ['a1', 'a2'] }] }],
    micros: [{ id: 'micro1', mesoId: 'mes1' }],
    settings: { activeMacroId: 'm1' }
  };

  const aid = 'a1';
  const aidSet = new Set([aid]);
  d.loadEntries = d.loadEntries.filter((l) => l.athleteId !== aid);
  d.sessions = (d.sessions || []).map((s) => {
    const next = Object.assign({}, s, { athletes: (s.athletes || []).filter((id) => !aidSet.has(id)) });
    if (next.results && typeof next.results === 'object') delete next.results[aid];
    if (next.athSrpe && typeof next.athSrpe === 'object') delete next.athSrpe[aid];
    return next;
  });
  d.tests = (d.tests || []).filter((t) => t.athleteId !== aid);
  d.profiles = (d.profiles || []).filter((p) => p.athleteId !== aid);
  if (d.athleteRm) delete d.athleteRm[aid];
  d.athletes = d.athletes.filter((x) => x.id !== aid);
  d.mesos.forEach((m) => (m.days || []).forEach((dd) => { dd.athletes = (dd.athletes || []).filter((id) => id !== aid); }));

  assert.deepStrictEqual(d.sessions[0].athletes, ['a2']);
  assert.deepStrictEqual(Object.keys(d.sessions[0].results), ['a2']);
  assert.deepStrictEqual(Object.keys(d.sessions[0].athSrpe), ['a2']);
  assert.deepStrictEqual(d.profiles, []);
  assert.deepStrictEqual(Object.keys(d.athleteRm), []);

  const activeMacroId = 'm1';
  const allAthletes = [
    { id: 'a1', macroId: 'm1' },
    { id: 'a2', macroId: 'm2' },
    { id: 'a3', macroId: 'm1' }
  ];
  const session = {
    date: '2024-05-10',
    athletes: ['a1', 'a2', 'a3'],
    results: {
      a1: [{ w: 100, actual: 10, rir: 2 }],
      a2: [{ w: 120, actual: 8, rir: 1 }],
      a3: [{ w: 80, actual: 6, rir: 3 }]
    }
  };
  const activeSet = new Set(allAthletes.filter((a) => a.macroId === activeMacroId).map((a) => a.id));
  const filtered = (session.athletes || []).filter((id) => activeSet.has(id));
  assert.deepStrictEqual(filtered, ['a1', 'a3']);
  assert.deepStrictEqual(Object.keys(session.results).filter((id) => activeSet.has(id)), ['a1', 'a3']);

  const teamDose = { kg: 0, reps: 0 };
  filtered.forEach((id) => {
    const r = session.results[id][0];
    teamDose.kg += Number(r.w) * Number(r.actual);
    teamDose.reps += Number(r.actual);
  });
  assert.equal(teamDose.kg, 1480, 'team dose must sum only current macro athletes');
  assert.equal(teamDose.reps, 16, 'team reps must sum only current macro athletes');

  console.log('db-guard test passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
