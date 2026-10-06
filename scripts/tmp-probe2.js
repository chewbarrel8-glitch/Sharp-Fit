const http = require('node:http');
const WebSocket = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9226/json', (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}
(async () => {
  let targets = null;
  for (let i = 0; i < 20; i++) { try { targets = await getTargets(); if (targets.length) break; } catch (e) {} await sleep(500); }
  if (!targets || !targets.length) { console.log('no targets'); process.exit(1); }
  const page = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.on('open', r));
  let mid = 0; const pending = {};
  ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } });
  const send = (mth, p = {}) => new Promise((res) => { const id = ++mid; pending[id] = res; ws.send(JSON.stringify({ id, method: mth, params: p })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails).slice(0, 400);
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  console.log(await ev(`(() => {
    const out = Store.data.mesos.map((m) => {
      const mics = Store.microsOf(m.id).map((x) => x.name + ' [' + x.startDate + '..' + x.endDate + ']');
      return m.name + ' [' + m.startDate + '..' + m.endDate + '] -> micros=' + mics.length + ': ' + mics.join(' | ');
    });
    return out.join('\\n');
  })()`));
  process.exit(0);
})();
