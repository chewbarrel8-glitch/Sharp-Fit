const ws = require('ws');
const fs = require('fs');
const http = require('http');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const res = await new Promise((r, j) => http.get('http://127.0.0.1:9223/json/list', (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => r(d)); }).on('error', j));
  const page = JSON.parse(res).find(t => t.type === 'page' && t.url.includes('index.html'));
  const sock = new ws(page.webSocketDebuggerUrl);
  await new Promise((r) => sock.on('open', r));
  let msgId = 0;
  const pending = {};
  sock.on('message', (raw) => { const d = JSON.parse(raw); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } });
  const ev = (code) => new Promise((r) => { const id = ++msgId; pending[id] = (d) => r(d.result && d.result.result && d.result.result.value !== undefined ? d.result.result.value : JSON.stringify(d.result)); sock.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: code, awaitPromise: true } })); });

  const seed = fs.readFileSync('src/js/demo.js', 'utf8');
  console.log(await ev(seed + '; window.seedDemo(); Store.save(); "seed-ok"'));
  await delay(800);
  console.log(await ev('location.hash="#/profile"; window.dispatchEvent(new Event("hashchange")); "nav"'));
  await delay(800);

  const html = await ev(`(function(){
    const card = document.querySelector('#profRmCard');
    if(!card) return 'no card';
    const trs = card.querySelectorAll('tbody tr');
    return [...trs].slice(0,8).map(tr => [...tr.cells].map(c=>c.textContent.trim().replace(/\\s+/g,' ')).join(' | ')).join('\\n');
  })()`);
  console.log(html);

  process.exit(0);
})();
