// E2E：启动 Electron(真实 Chromium) + CDP 远程调试，验证周期总表并截图
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const WebSocket = require('ws');
const { backupDB, snapshotBefore, restoreSnapshot } = require('./lib-backup');

const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'scripts', 'shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const SLOW = 1.6;   // 全局慢放系数：吸收机器负载导致的渲染时序抖动（只放慢固定等待，不影响断言逻辑）
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SLOW)));

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9223/json', (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

// 统一收尾：关闭调试连接 → 杀掉本轮 Electron → 恢复开跑前快照 → 退出
// 必须等 Electron 进程真正退出后再恢复，否则其退出时的落盘可能再次覆盖 db.json
let proc = null, ws = null;
async function finalize(code) {
  try { ws && ws.close(); } catch (e) {}
  if (proc && proc.exitCode === null && !proc.killed) {
    await new Promise((res) => {
      const t = setTimeout(res, 3000);
      proc.once('exit', () => { clearTimeout(t); res(); });
      proc.kill();
    });
  }
  await sleep(600);
  restoreSnapshot();
  process.exit(code);
}

(async () => {
  backupDB();   // 回归会整库覆盖 db.json（注入 src/js/demo.js 示例夹具造数），先备份可能含用户实时数据的当前库
  snapshotBefore();   // 固定快照：无论测试成功/失败/崩溃，退出前都恢复它，夹具（篮球示例计划等）不残留
  // 清理上一次运行可能残留的调试实例，避免测试连接到旧页面（旧代码/旧数据）
  try { execSync('pkill -f "remote-debugging-port=9223"'); await sleep(800); } catch (e) {}
  const electron = path.join(ROOT, 'node_modules', '.bin', 'electron');
  proc = spawn(electron, ['.', '--remote-debugging-port=9223'], { cwd: ROOT, stdio: 'ignore' });

  // 等待 CDP 端口就绪
  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try { targets = await getTargets(); if (targets.length) break; } catch (e) {}
  }
  if (!targets) { console.log('FAIL - CDP 连接失败'); await finalize(2); }
  const page = targets.find((t) => t.type === 'page' && /index\.html/.test(t.url));
  if (!page) { console.log('FAIL - 未找到页面 target', targets.map((t) => t.url)); await finalize(2); }

  ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((r) => ws.on('open', r));

  let mid = 0;
  const pending = {};
  const consoleErrors = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.exception && msg.params.exceptionDetails.exception.description || msg.params.exceptionDetails.text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++mid;
    pending[id] = resolve;
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  await send('Page.enable');
  // 把测试窗口拉到前台：窗口被遮挡/失焦时渲染时序不稳定（历史上一度成批失败的主因）
  try { await send('Page.bringToFront'); } catch (e) {}
  await send('Runtime.enable');
  await sleep(1000);

  const results = [];
  const assert = (ok, name) => { results.push([ok, name]); console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name); };
  // 轮询等待页面异步渲染完成（图表初始化/mount 重绘），避免固定 sleep 偶发不足
  const evalWait = async (expr, ok, timeout = 8000) => {
    const t0 = Date.now();
    let v;
    while (Date.now() - t0 < timeout) {
      v = await evaluate(expr);
      if (ok(v)) return v;
      await sleep(250);
    }
    return v;
  };

  // 0. 清空数据并重载
  await evaluate('localStorage.clear(); "ok"');
  await send('Page.enable');
  await send('Page.reload');
  await sleep(2500);   // Electron 启动后 Store.init 异步加载 db.json，需等待初始化完成

  // 1. 注入应用内置示例夹具（src/js/demo.js：XX篮球队备战计划，与「载入示例」按钮同源）
  const seedSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'demo.js'), 'utf8');
  await evaluate(seedSource + '; window.seedDemo = window.seedDemo; "fixture-ok"');
  const seedErr = await evaluate(`(() => { try { Store.data = Store.defaultDB(); Store.data.categories1 = Store.seedCategories(); Store.data.exercises = Store.seedExercises(); Store.data.goals = Store.defaultGoals(); window.seedDemo(); Store.save(); return 'ok:' + Store.data.athletes.length + ':' + Store.data.macros.length; } catch (e) { return 'ERR: ' + e.message; } })()`);
  assert(/^ok:15:1$/.test(String(seedErr)), `seedDemo 夹具造数成功 (实际 ${seedErr})`);
  await sleep(300);   // 确保 Store.save() 同步写入完成后页面状态稳定
  await evaluate('location.hash = "#/macro"; "ok"');
  await evaluate('window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(900);

  // 2. 周期训练计划网格（从当前大周期起始周铺到结束年年终，不显示起始前时间；尾部留白周可拖选）
  const gridInfo = await evaluate(`(() => {
    const g = document.querySelector('#gridBox');
    if (!g) return null;
    const mac = Store.activeMacro();
    const weeks = Math.round((U.d(U.weekStart(mac.endDate)) - U.d(U.weekStart(mac.startDate))) / 86400000 / 7) + 1;
    return {
      weeks,
      teamName: !!g.querySelector('#teamName'),
      monBands: g.querySelectorAll('.pg-mon').length,
      dayCells: g.querySelectorAll('.pg-day').length,
      compCells: g.querySelectorAll('.pg-day.comp').length,
      mesoBands: g.querySelectorAll('.pg-meso').length,
      macroBand: g.querySelectorAll('.pg-macro').length,
      dragCells: g.querySelectorAll('.pg-mdrag').length,
      compRow: g.querySelectorAll('.pg-comp').length,
      inputs: g.querySelectorAll('.pg-inp').length,
      stCells: g.querySelectorAll('.pg-inp[data-key="status"]').length,
      firstMeso: (g.querySelector('.pg-meso') || {}).textContent || '',
      macroText: (g.querySelector('.pg-macro.active') || {}).textContent || ''
    };
  })()`);
  assert(!!gridInfo, '周期训练计划渲染');
  if (gridInfo) {
    assert(gridInfo.teamName, 'TEAM NAME 输入框存在');
    assert(gridInfo.monBands >= 2, `月份合并带 (${gridInfo.monBands})`);
    assert(gridInfo.dayCells === 7 * gridInfo.weeks, `日期格 = 7×${gridInfo.weeks} 周 (实际 ${gridInfo.dayCells})`);
    assert(gridInfo.compCells >= 2, `红色比赛日格 (${gridInfo.compCells})`);
    assert(gridInfo.macroBand >= 1 && gridInfo.macroText, `大周期栏显示当前训练计划的大周期带 (${gridInfo.macroText})`);
    assert(gridInfo.dragCells > 0, `大周期空白周可拖选定义新大周期 (${gridInfo.dragCells} 格)`);
    assert(gridInfo.mesoBands >= 3, `中周期合并带 (${gridInfo.mesoBands}) 首格:${gridInfo.firstMeso}`);
    assert(gridInfo.inputs === 3 * gridInfo.weeks, `训练量/负荷/准备水平输入 ${3 * gridInfo.weeks} 格 (实际 ${gridInfo.inputs})`);
    assert(gridInfo.stCells === gridInfo.weeks, `准备水平手动输入格 ${gridInfo.weeks} 格 (实际 ${gridInfo.stCells})`);
  }

  // 3. 手动输入训练量/负荷/准备水平 + 队伍名称
  const setInput = await evaluate(`(() => {
    const mac = Store.activeMacro();
    const ws = U.weekStart(mac.startDate);
    const set = (key, val) => {
      const inp = document.querySelector('#gridBox [data-ws="' + ws + '"][data-key="' + key + '"]');
      inp.value = val;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('volume', '8'); set('intensity', '6'); set('status', '8');
    const tn = document.querySelector('#teamName');
    tn.value = '国家集训队'; tn.dispatchEvent(new Event('change', { bubbles: true }));
    const cell = document.querySelector('#gridBox [data-ws="' + ws + '"][data-key="status"]');
    return { wp: mac.weekPlan[ws], team: mac.teamName, stCls: cell ? cell.className : '', stVal: cell ? cell.value : '' };
  })()`);
  assert(setInput && setInput.wp && setInput.wp.volume === 8 && setInput.wp.intensity === 6, '训练量/负荷写入 weekPlan');
  assert(setInput && setInput.wp.status === 8, '准备水平(1-10)手动输入写入 weekPlan');
  assert(setInput && setInput.stCls.includes('st-8') && setInput.stVal === '8', '准备水平输入值 + 高亮 class 生效');
  assert(setInput && setInput.team === '国家集训队', '队伍名称保存');

  // 4. 持久化 + 重载回填（Electron 走 IPC 文件存储，浏览器回退 localStorage）
  const saved = await evaluate(`(async () => {
    if (window.api) {
      const d = await window.api.loadDB();
      const m = d && d.macros[0];
      return (m && m.weekPlan && Object.keys(m.weekPlan).length > 0) ? 'saved-file' : 'none-file';
    }
    const m = JSON.parse(localStorage.getItem('tpdb')).macros[0];
    return (m && m.weekPlan && Object.keys(m.weekPlan).length > 0) ? 'saved-ls' : 'none-ls';
  })()`);
  assert(saved && saved.startsWith('saved'), 'weekPlan 已持久化 (' + saved + ')');
  await send('Page.reload');
  await sleep(1500);
  const back = await evalWait(`(() => {
    try {
      const mac = Store.activeMacro();
      const ws = U.weekStart(mac.startDate);
      return {
        team: mac.teamName,
        vol: mac.weekPlan[ws] && mac.weekPlan[ws].volume,
        inpVal: document.querySelector('#gridBox [data-ws="' + ws + '"][data-key="volume"]') ? document.querySelector('#gridBox [data-ws="' + ws + '"][data-key="volume"]').value : null,
        tnVal: document.querySelector('#teamName') ? document.querySelector('#teamName').value : null
      };
    } catch (e) { return null; }
  })()`, (v) => v && v.vol === 8 && v.inpVal === '8' && v.tnVal === '国家集训队', 15000);
  assert(back && back.vol === 8 && back.inpVal === '8' && back.tnVal === '国家集训队', `重载后输入回填（${back ? JSON.stringify(back) : 'null'}）`);

  // 5. 图表：weekPlan 驱动 + 状态背景带 + 峰值状态 = 手动准备水平
  await evaluate('location.hash = "#/macro"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(1100);
  // 切到峰值状态视图
  await evaluate(`(() => { const s = document.querySelector('#viewSel'); s.value = 'peak'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
  await sleep(400);
  const chartInfo = await evaluate(`(() => {
    const peak = echarts.getInstanceByDom(document.querySelector('#chMain'));
    if (!peak) return null;
    const op = peak.getOption();
    const fit = op.series.find((s) => s.name && s.name.startsWith('能量储备'));
    const fat = op.series.find((s) => s.name && s.name.startsWith('疲劳'));
    const form = op.series.find((s) => s.name && s.name.startsWith('峰值状态'));
    return {
      names: op.series.map((s) => s.name),
      hasFit: !!fit, hasFat: !!fat, hasForm: !!form,
      fitLen: fit ? fit.data.length : 0, fatLen: fat ? fat.data.length : 0, formLen: form ? form.data.length : 0,
      noIdeal: !op.series.some((s) => s.name && s.name.includes('理想')),
      markLines: form && form.markLine ? form.markLine.data.length : 0,
      markAreas: form && form.markArea ? form.markArea.data.length : 0
    };
  })()`);
  assert(!!chartInfo, '峰值状态图表实例化');
  if (chartInfo) {
    assert(chartInfo.noIdeal, '已移除理想峰值参考曲线');
    assert(chartInfo.hasFit && chartInfo.hasFat && chartInfo.hasForm, '能量储备/疲劳/峰值状态三曲线存在');
    assert(chartInfo.fitLen === chartInfo.formLen && chartInfo.fatLen === chartInfo.formLen, '三曲线长度一致');
    assert(chartInfo.markLines >= 4, `比赛日标线 ${chartInfo.markLines} 条`);
    assert(chartInfo.markAreas >= 3, `状态背景带 ${chartInfo.markAreas} 段`);
  }

  // 5b. 负荷与量：仅折线（训练量 + 训练负荷），无柱状图、无推荐曲线
  await evaluate(`(() => { const s = document.querySelector('#viewSel'); s.value = 'load'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
  await sleep(400);
  const trendInfo = await evaluate(`(() => {
    const vol = echarts.getInstanceByDom(document.querySelector('#chMain'));
    if (!vol) return null;
    const vo = vol.getOption();
    const hasBar = vo.series.some((s) => s.type === 'bar');
    const hasRecV = vo.series.some((s) => s.name === '推荐量');
    const hasRecI = vo.series.some((s) => s.name === '推荐负荷');
    const volLine = vo.series.find((s) => s.name && s.name.startsWith('训练量'));
    const loadLine = vo.series.find((s) => s.name && s.name.startsWith('训练负荷'));
    return {
      volNames: vo.series.map((s) => s.name),
      volAxis: vo.yAxis.length,
      hasBar, hasRecV, hasRecI,
      hasVolLine: !!volLine && volLine.type === 'line',
      hasLoadLine: !!loadLine && loadLine.type === 'line'
    };
  })()`);
  assert(trendInfo && !trendInfo.volNames.some((n) => /吨位/.test(n)) && trendInfo.volAxis === 1, `负荷与量已移除吨位 (${trendInfo && trendInfo.volNames.join('/')})`);
  assert(trendInfo && !trendInfo.hasBar, '负荷与量视图无柱状图，仅折线');
  assert(trendInfo && !trendInfo.hasRecV && !trendInfo.hasRecI, '已移除推荐量/推荐负荷曲线');
  assert(trendInfo && trendInfo.hasVolLine && trendInfo.hasLoadLine, '训练量/训练负荷折线存在');
  await evaluate(`(() => {
    const mac = Store.activeMacro();
    const ws = U.weekStart(mac.startDate);
    const inp = document.querySelector('#gridBox [data-ws="' + ws + '"][data-key="volume"]');
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(600);
  const volNull = await evaluate(`echarts.getInstanceByDom(document.querySelector('#chMain')).getOption().series[0].data[0]`);
  assert(volNull === null || volNull === undefined, `未填周不再折算计划吨位 (实际 ${JSON.stringify(volNull)})`);
  await evaluate(`(() => {
    const mac = Store.activeMacro();
    const ws = U.weekStart(mac.startDate);
    const inp = document.querySelector('#gridBox [data-ws="' + ws + '"][data-key="volume"]');
    inp.value = '8';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(500);

  // 6. 总表准备水平输入实时联动峰值状态图表
  await evaluate(`(() => { const s = document.querySelector('#viewSel'); s.value = 'peak'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
  await sleep(400);
  const formBefore = await evaluate(`JSON.stringify(echarts.getInstanceByDom(document.querySelector('#chMain')).getOption().series.find((s) => s.name && s.name.startsWith('峰值状态')).data)`);
  await evaluate(`(() => {
    const mac = Store.activeMacro();
    const ws = U.weekStart(mac.startDate);
    const inp = document.querySelector('#gridBox [data-ws="' + ws + '"][data-key="status"]');
    inp.value = '2';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(600);
  const formAfter = await evaluate(`JSON.stringify(echarts.getInstanceByDom(document.querySelector('#chMain')).getOption().series.find((s) => s.name && s.name.startsWith('峰值状态')).data)`);
  assert(formBefore !== formAfter, '准备水平输入实时联动峰值状态图表');
  await evaluate(`(() => {
    const mac = Store.activeMacro();
    const ws = U.weekStart(mac.startDate);
    const inp = document.querySelector('#gridBox [data-ws="' + ws + '"][data-key="volume"]');
    inp.value = '8';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(500);

  // 7. 中周期带：点击「✎」编辑按钮打开弹窗；点击带名跳转中周期页规划；页内编辑/删除；空白周＋自定义划分映射中周期模块
  // 7a. 大周期带点击 → 打开大周期编辑弹窗
  await evaluate(`document.querySelector('#gridBox [data-cyedit]').click(); "ok"`);
  await sleep(400);
  const macEdit = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    return { ok: !!ov && !!ov.querySelector('#cName'), name: ov ? ov.querySelector('#cName').value : '', hasDel: !!ov && !!ov.querySelector('[data-del]') };
  })()`);
  assert(macEdit && macEdit.ok, `大周期带点击打开大周期编辑弹窗（${macEdit && macEdit.name}）`);
  assert(macEdit && macEdit.hasDel, '编辑弹窗内含删除按钮');
  await evaluate(`(() => { const ovs = [...document.querySelectorAll('.overlay')]; ovs[ovs.length - 1].querySelector('[data-x]').click(); return 'ok'; })()`);
  await sleep(200);

  // 7a3. 取消弹窗后可再次拖选（mouseup 监听随按下重挂；种子网格从 2026-01-01 铺起，大周期区间 1-11 月，尾部 12 月有空白周）
  const dragCancel = await evaluate(`(() => {
    [...document.querySelectorAll('.overlay .modal-x')].forEach((b) => b.click());
    const cells = document.querySelectorAll('#gridBox .pg-mdrag');
    if (cells.length < 2) return { ok: false, n: cells.length };
    const a = cells[0], b = cells[1];
    const drag = () => {
      a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    };
    drag();
    let ov = [...document.querySelectorAll('.overlay')].pop();
    const opened1 = !!(ov && ov.querySelector('#cName'));
    if (opened1) ov.querySelector('[data-x]').click();
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    ov = [...document.querySelectorAll('.overlay')].pop();
    const opened2 = !!(ov && ov.querySelector('#cName'));
    if (opened2) ov.querySelector('[data-x]').click();
    return { ok: true, opened1, opened2, left: document.querySelectorAll('.overlay').length, totalCells: cells.length };
  })()`);
  assert(dragCancel && dragCancel.ok && dragCancel.opened1 && dragCancel.opened2, `取消弹窗后可再次拖选进入编辑（cells=${dragCancel && dragCancel.totalCells}）`);
  assert(dragCancel && dragCancel.left === 0, '弹窗全部关闭无残留');

  // 7a2. 大周期空白周拖选尾部 2 个空白周 → 命名创建新大周期（在当前训练计划内，追加 cycles）
  const dragNew = await evaluate(`(() => {
    [...document.querySelectorAll('.overlay .modal-x')].forEach((b) => b.click());
    const cells = document.querySelectorAll('#gridBox .pg-mdrag');
    if (cells.length < 2) return { ok: false };
    const gs = U.weekStart(Store.activeMacro().startDate);
    const a = cells[0], b = cells[1];
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const sel = document.querySelectorAll('#gridBox .pg-mdrag.drag-sel').length;
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    if (!ov || !ov.querySelector('#cName')) return { ok: false, sel };
    return { ok: true, sel, start: ov.querySelector('#cStart').value, end: ov.querySelector('#cEnd').value,
      expectS: U.addDays(gs, +a.dataset.mi * 7), expectE: U.addDays(U.addDays(gs, +b.dataset.mi * 7), 6) };
  })()`);
  assert(dragNew && dragNew.ok && dragNew.sel === 2, `拖选 2 周高亮并弹出新建大周期弹窗 (${dragNew && dragNew.sel} 格)`);
  assert(dragNew && dragNew.start === dragNew.expectS && dragNew.end === dragNew.expectE, `拖选日期预填正确（${dragNew && dragNew.start} → ${dragNew && dragNew.end}）`);
  await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    ov.querySelector('#cName').value = '年度第三周期';
    ov.querySelector('[data-ok]').click();
    return 'ok';
  })()`);
  await sleep(600);
  const twoMacros = await evaluate(`(() => {
    const d = Store.data;
    const mac = Store.activeMacro();
    return {
      n: d.macros.length,
      cycN: (mac.cycles || []).length,
      bands: document.querySelectorAll('#gridBox .pg-macro').length,
      dragCells: document.querySelectorAll('#gridBox .pg-mdrag').length,
      maxCycles: 0
    };
  })()`);
  assert(twoMacros && twoMacros.cycN === 3, `训练计划内大周期已创建 3 个（原 2 + 新拖选）(${twoMacros && twoMacros.cycN})`);
  assert(twoMacros && twoMacros.bands >= 2, `大周期带渲染 ≥ 2 个（当前训练计划内）(${twoMacros && twoMacros.bands} 带)`);

  // 7a4. 顶部工具栏结构 + 总表渲染当前训练计划的 cycles + 大周期管理页验证
  const topInfo = await evaluate(`(() => ({
    hasMyPlans: !!document.querySelector('#myPlansBtn'),
    hasNew: !!document.querySelector('#macNew'),
    hasSel: !!document.querySelector('#macSel'),
    hasSwitcher: !!document.querySelector('#macPrev') || !!document.querySelector('#macNext')
  }))()`);
  assert(topInfo && topInfo.hasMyPlans && topInfo.hasNew, '顶部工具栏有我的计划下拉 + 新建训练计划');
  assert(topInfo && !topInfo.hasSel && !topInfo.hasSwitcher, '顶部无旧 ‹ › 切换按钮');
  // 验证训练计划名称（层级 1：训练计划）
  const planInfo = await evaluate(`(() => {
    const mac = Store.activeMacro();
    return { name: mac.name, start: mac.startDate, end: mac.endDate, cycN: (mac.cycles || []).length, bands: document.querySelectorAll('#gridBox .pg-macro').length };
  })()`);
  assert(planInfo && planInfo.name === 'XX篮球队备战计划', `训练计划名称正确（${planInfo && planInfo.name}）`);
  assert(planInfo && planInfo.cycN === 3, `训练计划内含 3 个大周期（原 2 + 新拖选）(${planInfo && planInfo.cycN})`);
  assert(planInfo && planInfo.bands >= 2, `总表大周期带 ≥ 2 个（渲染 mac.cycles）(${planInfo && planInfo.bands})`);
  // 大周期管理已并入中周期页（导航 02）：大周期筛选条 + 新建/编辑，点击大周期只显示其内中周期
  await evaluate(`location.hash = '#/meso'; window.dispatchEvent(new Event('hashchange')); 'ok'`);
  await sleep(700);
  const cycPanel = await evaluate(`(() => {
    const mac = Store.activeMacro();
    const cycles = (mac.cycles || []).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    const c0 = cycles[0];
    return {
      hash: location.hash,
      chipN: document.querySelectorAll('#mesoList .cyc-strip .cyc-chip').length,
      cycN: cycles.length,
      mesoAll: document.querySelectorAll('#mesoList .top-list .top-item').length,
      mesoTotal: Store.mesosOf(mac.id).length,
      hasAddCyc: !!document.querySelector('#cycAdd'),
      hasAddMeso: !!document.querySelector('#mesoAdd'),
      oldPageGone: !document.querySelector('#mcList') && !document.querySelector('#mcMesos'),
      navNoMc: ![...document.querySelectorAll('.nav-item')].some((n) => n.dataset.id === 'macroc'),
      firstCyc: c0 ? c0.id : null,
      firstN: c0 ? Store.mesosOf(mac.id).filter((m) => U.between(m.startDate, c0.startDate, c0.endDate)).length : 0
    };
  })()`);
  assert(cycPanel && cycPanel.hash === '#/meso' && cycPanel.oldPageGone && cycPanel.navNoMc, '独立大周期页已移除，管理入口并入中周期面板');
  assert(cycPanel && cycPanel.chipN === cycPanel.cycN + 1, `大周期筛选条含「全部」+ ${cycPanel && cycPanel.cycN} 个大周期（${cycPanel && cycPanel.chipN} 张卡）`);
  assert(cycPanel && cycPanel.mesoAll === 6 && cycPanel.mesoTotal === 6 && cycPanel.hasAddCyc && cycPanel.hasAddMeso, `全部下列出 ${cycPanel && cycPanel.mesoAll} 个中周期，含新建大周期/新建中周期按钮`);
  await evaluate(`document.querySelector('#mesoList .cyc-chip[data-cyc="${cycPanel.firstCyc}"]').click(); 'ok'`);
  await sleep(500);
  const cycFilter = await evaluate(`(() => ({
    activeCyc: document.querySelector('#mesoList .cyc-chip.active') ? document.querySelector('#mesoList .cyc-chip.active').dataset.cyc : null,
    n: document.querySelectorAll('#mesoList .top-list .top-item').length
  }))()`);
  assert(cycFilter && cycFilter.activeCyc === cycPanel.firstCyc && cycFilter.n === cycPanel.firstN, `点击大周期 → 只显示规划进该大周期的中周期（${cycFilter && cycFilter.n}/${cycPanel.firstN}）`);
  // ✎ 编辑大周期弹窗仍可用
  const cycEdit = await evaluate(`(() => {
    document.querySelector('#mesoList .cyc-chip.active .cyc-edit').click();
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    return { open: !!ov && !!ov.querySelector('#cName') };
  })()`);
  assert(cycEdit && cycEdit.open, '中周期页 ✎ 可编辑/删除大周期');
  await evaluate(`(() => { const ovs = [...document.querySelectorAll('.overlay')]; const x = ovs[ovs.length - 1].querySelector('[data-x]'); if (x) x.click(); return 'ok'; })()`);
  await sleep(300);
  await evaluate(`document.querySelector('#mesoList .cyc-chip[data-cyc="all"]').click(); 'ok'`);
  await sleep(300);
  // 回总表页继续后续断言
  await evaluate(`location.hash = '#/macro'; window.dispatchEvent(new Event('hashchange')); 'ok'`);
  await sleep(700);

  // 7a5. 训练目标行：七大训练模块分类纵向 7 行 + 总表拖选/点击设定目标块 + 弹窗循环选择 + 大/中/小周期映射
  const goalRow0 = await evaluate(`(() => {
    const goals = [...document.querySelectorAll('#gridBox [data-gbedit]')];
    return {
      cats: document.querySelectorAll('#gridBox .pg-cat').length,
      bands: new Set(goals.map((e) => e.dataset.gbedit + '|' + e.dataset.cat)).size,
      hasJH: goals.some((e) => e.textContent.includes('肌肥大')),
      hasLsd: goals.some((td) => td.textContent.includes('有氧耐力（LSD）')),
      cells: document.querySelectorAll('#gridBox .pg-gdrag').length,
      merged: (() => { const bands = [...document.querySelectorAll('#gridBox .pg-goalband')]; return { n: bands.length, multi: bands.filter((b) => Number(b.getAttribute('colspan')) > 1).length }; })()
    };
  })()`);
  assert(goalRow0 && goalRow0.cats === 7, `训练目标按七大模块逐行展开 7 个分类 (${goalRow0 && goalRow0.cats} 个)`);
  assert(goalRow0 && goalRow0.bands === 12, `种子目标块按七大模块展开 12 带 (${goalRow0 && goalRow0.bands})`);
  assert(goalRow0 && goalRow0.hasJH && goalRow0.hasLsd, '目标带含 肌肥大（力量行）/ 有氧耐力（LSD）（代谢行）');
  assert(goalRow0 && goalRow0.merged.n > 0 && goalRow0.merged.multi > 0, `同一目标块连续周合并为一条色带（共 ${goalRow0 && goalRow0.merged.n} 条 / 跨周 ${goalRow0 && goalRow0.merged.multi} 条）`);
  assert(goalRow0 && goalRow0.cells > 0, `空白周可拖选设定目标 (${goalRow0 && goalRow0.cells} 格)`);
  // 拖选同分类行连续两个空白周 → 新建目标块弹窗（只显示该分类目标）→ 单主要选择验证 → 保存
  const gDragOpen = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('#gridBox .pg-gdrag')];
    // 找「多方向速度」分类连续两格（倒数优先），验证分类隔离弹窗
    const mds = cells.filter((c) => c.dataset.cat === '多方向速度');
    let a = null, b = null;
    for (let i = mds.length - 1; i >= 1; i--) {
      if (+mds[i].dataset.gi === +mds[i - 1].dataset.gi + 1) { a = mds[i - 1]; b = mds[i]; break; }
    }
    if (!a) { a = mds[mds.length - 2]; b = mds[mds.length - 1]; }
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const ov = [...document.querySelectorAll('.overlay')].pop();
    return { opened: !!(ov && ov.querySelector('#gbStart')), title: ov && ov.querySelector('h3') ? ov.querySelector('h3').textContent : '', onlyCat: ov ? ov.querySelectorAll('#gbChips .gcat').length : 0, catName: ov && ov.querySelector('#gbChips .gcat-t') ? ov.querySelector('#gbChips .gcat-t').textContent : '' };
  })()`);
  assert(gDragOpen && gDragOpen.opened, `拖选弹出设定训练目标弹窗（${gDragOpen && gDragOpen.title}）`);
  assert(gDragOpen && gDragOpen.onlyCat === 1 && gDragOpen.catName === '多方向速度', `弹窗按分类隔离只显示 1 个分类（多方向速度）(${gDragOpen && gDragOpen.onlyCat}/${gDragOpen && gDragOpen.catName})`);
  // 单主要逻辑：灵敏→主要，再点启动速度→次要（证明每类主要只能一个，第二个降为次要）
  const gCyc = await evaluate(`(() => {
    const find = (n) => [...document.querySelectorAll('.overlay #gbChips .gchip')].find((c) => c.textContent.indexOf(n) === 0);
    const st = (c) => c ? (c.classList.contains('p') ? 'p' : c.classList.contains('s') ? 's' : 'off') : 'none';
    const r = { initL: st(find('灵敏')), initQ: st(find('启动速度')) };
    find('灵敏').click(); r.l1 = st(find('灵敏'));          // 灵敏 → 主要
    find('启动速度').click(); r.q1 = st(find('启动速度'));  // 启动速度 → 次要（单主要约束）
    return r;
  })()`);
  assert(gCyc && gCyc.initL === 'off' && gCyc.initQ === 'off', '弹窗初始灵敏/启动速度均未选');
  assert(gCyc && gCyc.l1 === 'p', '灵敏点击 → 主要');
  assert(gCyc && gCyc.q1 === 's', '启动速度点击 → 次要（灵敏已是主要，单主要约束生效）');
  await evaluate(`document.querySelector('.overlay [data-ok]').click(); 'ok'`);
  await sleep(600);
  const gSaved = await evaluate(`(() => {
    const mac = Store.activeMacro();
    const gl = Store.data.goals.find((x) => x.name === '灵敏');
    const gq = Store.data.goals.find((x) => x.name === '启动速度');
    const nb = mac.goalBlocks[mac.goalBlocks.length - 1];
    const bands = new Set([...document.querySelectorAll('#gridBox [data-gbedit]')].map((e) => e.dataset.gbedit + '|' + e.dataset.cat)).size;
    return { n: mac.goalBlocks.length, bands, inPrimary: (nb.primary || []).includes(gl.id), inSecondary: (nb.secondary || []).includes(gq.id) };
  })()`);
  assert(gSaved && gSaved.bands === 13 && gSaved.n >= 6, `拖选保存后 多方向速度 +1 带 = 13（拖选周与已有块重叠时并入，块数 ${gSaved && gSaved.n}）`);
  assert(gSaved && gSaved.inPrimary && gSaved.inSecondary, '新目标块：灵敏=主要、启动速度=次要');
  // 点击目标带 → 编辑弹窗（含删除按钮）→ 取消关闭
  const gEdit = await evaluate(`(() => {
    document.querySelector('#gridBox .pg-goalband').click();
    const ov = [...document.querySelectorAll('.overlay')].pop();
    const r = { title: ov && ov.querySelector('h3') ? ov.querySelector('h3').textContent : '', hasDel: !!(ov && ov.querySelector('[data-del]')) };
    if (ov && ov.querySelector('.modal-x')) ov.querySelector('.modal-x').click();
    return r;
  })()`);
  assert(gEdit && gEdit.title && gEdit.title.indexOf('编辑训练目标') === 0 && gEdit.hasDel, '点击目标带打开编辑弹窗（含删除）');
  // 工具栏显示当前训练计划名称 + 周期模型参考按钮下拉 + 详细介绍
  const tbInfo = await evaluate(`(() => {
    const txt = document.querySelector('#macToolbar') ? document.querySelector('#macToolbar').textContent : '';
    return { hasName: txt.includes('XX篮球队备战计划'), hasBtn: !!document.querySelector('#modelRefBtn') };
  })()`);
  assert(tbInfo && tbInfo.hasName, '工具栏显示当前训练计划名称');
  assert(tbInfo && tbInfo.hasBtn, '工具栏有「周期模型参考」按钮');
  const modelRef = await evaluate(`(() => {
    document.querySelector('#modelRefBtn').click();
    const items = document.querySelectorAll('#modelRefMenu [data-modelref]');
    document.querySelector('#modelRefMenu [data-modelref="block"]').click();
    const ov = [...document.querySelectorAll('.overlay')].pop();
    const body = ov ? ov.textContent : '';
    const r = { items: items.length, hasFit: body.includes('适用对象'), hasLoad: body.includes('负荷特征'), hasPhase: body.includes('典型阶段'), hasManual: body.includes('不会自动生成') };
    if (ov && ov.querySelector('[data-x]')) ov.querySelector('[data-x]').click();
    return r;
  })()`);
  assert(modelRef && modelRef.items === 7, `模型下拉列出 7 种模型 (${modelRef && modelRef.items})`);
  assert(modelRef && modelRef.hasFit && modelRef.hasLoad && modelRef.hasPhase, '模型详细介绍含 适用对象/负荷特征/典型阶段');
  assert(modelRef && modelRef.hasManual, '模型介绍明确提示不自动生成、需手动划分');
  // 总表末尾「新增大分类」行：点击 → 弹窗 → 添加后分类行数 +1 且颜色不重复
  const addCat1 = await evaluate(`(() => {
    const before = document.querySelectorAll('#gridBox .pg-cat').length;
    const huesBefore = Store.allGoalCats().map((c) => c.hue);
    document.querySelector('#gridBox #addCatBtn').click();
    const ov = [...document.querySelectorAll('.overlay')].pop();
    ov.querySelector('#acName').value = '康复体能';
    ov.querySelector('[data-ok]').click();
    return { before, huesBefore };
  })()`);
  await sleep(500);
  const addCat2 = await evaluate(`(() => {
    const after = document.querySelectorAll('#gridBox .pg-cat').length;
    const nc = Store.allGoalCats().find((c) => c.name === '康复体能');
    return { after, hue: nc ? nc.hue : null, catN: Store.allGoalCats().length, rowTxt: [...document.querySelectorAll('#gridBox .pg-cat')].some((td) => td.textContent.includes('康复体能')) };
  })()`);
  assert(addCat2 && addCat2.after === addCat1.before + 1, `新增大分类后总表行数 +1 (${addCat1.before}→${addCat2 && addCat2.after})`);
  assert(addCat2 && addCat2.hue != null && !addCat1.huesBefore.includes(addCat2.hue), `新分类颜色 hue=${addCat2 && addCat2.hue} 不重复`);
  assert(addCat2 && addCat2.rowTxt, '总表新增「康复体能」分类行');
  // 新分类空白周弹窗内「添加目标」：自定义目标归入该分类、hue 跟随分类
  const addGoal = await evaluate(`(() => {
    const cells = [...document.querySelectorAll('#gridBox .pg-gdrag')].filter((c) => c.dataset.cat === '康复体能');
    cells[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const ov = [...document.querySelectorAll('.overlay')].pop();
    ov.querySelector('#gbNewGoal').value = '赛期控重';
    ov.querySelector('#gbAddGoal').click();
    const g = Store.data.goals.find((x) => x.name === '赛期控重');
    const catHue = Store.allGoalCats().find((c) => c.name === '康复体能').hue;
    const shown = [...ov.querySelectorAll('#gbChips .gchip')].some((c) => c.textContent.indexOf('赛期控重') === 0);
    if (ov && ov.querySelector('[data-x]')) ov.querySelector('[data-x]').click();
    return { ok: !!g, cat: g ? g.cat : '', hue: g ? g.hue : null, catHue, shown };
  })()`);
  assert(addGoal && addGoal.ok && addGoal.cat === '康复体能' && addGoal.shown, '分类弹窗内可添加自定义目标并归入该分类');
  assert(addGoal && addGoal.hue === addGoal.catHue, '自定义目标颜色跟随分类');
  // 大周期独立页移除后：训练目标块统一在周期总表「训练目标」行展示
  const macroGoals = await evaluate(`(() => {
    const box = document.querySelector('#gridBox');
    return {
      bands: box ? box.querySelectorAll('.pg-goalband').length : 0,
      chips: box ? box.querySelectorAll('.goal-chip').length : 0,
      txt: box ? box.textContent : '',
      oldBoxGone: !document.querySelector('#goalBox')
    };
  })()`);
  assert(macroGoals && macroGoals.oldBoxGone && macroGoals.bands >= 11 && macroGoals.chips >= 12 && macroGoals.txt.includes('肌肥大'), `训练目标块统一在周期总表展示（${macroGoals && macroGoals.bands} 带 / ${macroGoals && macroGoals.chips} chips）`);
  // 中周期页目标只读「当前训练目标」：本中周期目标+总表目标块合并展示，无编辑入口、无来源标注
  await evaluate(`(() => {
    const m1 = Store.data.mesos.find((x) => x.name.indexOf('M1') === 0);
    Views.meso.state.mesoId = m1.id;
    location.hash = '#/meso'; window.dispatchEvent(new Event('hashchange')); return 'ok';
  })()`);
  await sleep(800);
  const mesoGoals = await evaluate(`(() => {
    const box = document.querySelector('#mesoDetail');
    const m1 = Store.data.mesos.find((x) => x.name.indexOf('M1') === 0);
    const mac = Store.data.macros.find((x) => x.id === m1.macroId);
    const mg = Store.goalsOf(m1);
    const mgm = Store.goalBlocksIn(mac.id, m1.startDate, m1.endDate);
    const expect = new Set([...(mg.primary || []), ...(mg.secondary || []), ...(mgm.primary || []), ...(mgm.secondary || [])]).size;
    return {
      expect,
      chips: box.querySelectorAll('.goal-chip:not(.inh)').length,
      inh: box.querySelectorAll('.goal-chip.inh').length,
      hasEdit: !!document.querySelector('#mesoGoalEdit'),
      hasTag: box.textContent.includes('当前训练目标'),
      noFrom: !box.textContent.includes('来自大周期'),
      noMajorTag: !box.textContent.includes('中周期主要')
    };
  })()`);
  assert(mesoGoals && mesoGoals.chips === mesoGoals.expect && mesoGoals.expect >= 2, `中周期页只读当前训练目标=本周期+大周期合并 (${mesoGoals && mesoGoals.chips}/${mesoGoals && mesoGoals.expect})`);
  assert(mesoGoals && mesoGoals.inh === 0 && !mesoGoals.hasEdit && mesoGoals.hasTag && mesoGoals.noFrom && mesoGoals.noMajorTag, '中周期页无编辑入口、无来源标注与主要标签');
  // 小周期页映射：M2 第一周 自身目标（主要2+次要1）；中周期/大周期映射行已按用户要求移除（目标三周期一致）
  await evaluate(`(() => {
    const m2 = Store.data.mesos.find((x) => x.name.indexOf('M2') === 0);
    Views.micro.state.mesoId = m2.id;
    Views.micro.state.microId = Store.microsOf(m2.id)[0].id;
    location.hash = '#/micro'; window.dispatchEvent(new Event('hashchange')); return 'ok';
  })()`);
  await sleep(800);
  const microGoals = await evaluate(`(() => ({
    own: document.querySelectorAll('#microDetail .goal-chip:not(.inh)').length,
    inh: document.querySelectorAll('#microDetail .goal-chip.inh').length,
    hasEdit: !!document.querySelector('#micGoalEdit'),
    noFrom: !document.querySelector('#microDetail').textContent.includes('来自中周期') && !document.querySelector('#microDetail').textContent.includes('来自大周期')
  }))()`);
  assert(microGoals && microGoals.own === 3, `小周期页显示本周期目标 (${microGoals && microGoals.own})`);
  assert(microGoals && microGoals.inh === 0 && microGoals.hasEdit && microGoals.noFrom, '小周期页只显示训练目标，无「来自中周期/大周期」映射行');
  // 小周期「编辑目标」弹窗（goalPicker 现仅保留于小周期页）：自定义大分类 + 自定义目标 + 循环选择保存
  await evaluate(`document.querySelector('#micGoalEdit').click(); 'ok'`);
  await sleep(400);
  const ownBefore = await evaluate(`document.querySelectorAll('#microDetail .goal-chip:not(.inh)').length`);
  // 自定义大分类：输入名称 → 分配不重复 hue
  const customCat = await evaluate(`(() => {
    const before = Store.allGoalCats().length;
    const beforeHues = Store.allGoalCats().map((c) => c.hue);
    document.querySelector('.overlay #gpCatNew').value = '专项体能';
    document.querySelector('.overlay #gpCatAdd').click();
    const after = Store.allGoalCats().length;
    const newCat = Store.allGoalCats().find((c) => c.name === '专项体能');
    const dup = newCat ? beforeHues.includes(newCat.hue) : true;
    return { before, after, hue: newCat ? newCat.hue : null, dup };
  })()`);
  assert(customCat && customCat.after === customCat.before + 1, `添加自定义大分类后分类数 +1 (${customCat && customCat.before}→${customCat && customCat.after})`);
  assert(customCat && !customCat.dup && customCat.hue != null, `新分类 hue=${customCat && customCat.hue} 不与已有重复`);
  // 在自定义分类下添加目标
  const customGoal = await evaluate(`(() => {
    document.querySelector('.overlay #gpCat').value = '专项体能';
    document.querySelector('.overlay #gpNew').value = '专项耐力';
    document.querySelector('.overlay #gpAdd').click();
    const g = Store.data.goals.find((x) => x.name === '专项耐力');
    return { ok: !!g, cat: g ? g.cat : '', hue: g ? g.hue : null };
  })()`);
  assert(customGoal && customGoal.ok && customGoal.cat === '专项体能', '在自定义分类下添加目标成功');
  assert(customGoal && customGoal.hue === customCat.hue, '自定义目标 hue = 分类 hue（类内色相统一）');
  // 新目标循环点击两次 → 次要 → 保存写入 micro.goals
  await evaluate(`(() => { const c = [...document.querySelectorAll('.overlay #gpBody .gchip')].find((x) => x.textContent.indexOf('专项耐力') === 0); c.click(); c.click(); return 'ok'; })()`);
  await evaluate(`document.querySelector('.overlay [data-ok]').click(); 'ok'`);
  await sleep(600);
  const micSaved = await evaluate(`(() => {
    const mic = Store.data.micros.find((m) => m.id === Views.micro.state.microId);
    const g = Store.data.goals.find((x) => x.name === '专项耐力');
    return { inSecondary: (mic.goals.secondary || []).includes(g.id), own: document.querySelectorAll('#microDetail .goal-chip:not(.inh)').length };
  })()`);
  assert(micSaved && micSaved.inSecondary && micSaved.own === ownBefore + 1, `小周期编辑目标保存（专项耐力 → 次要）且 chips +1（${ownBefore} → ${micSaved && micSaved.own}）`);
  // 回总表页继续后续断言
  await evaluate(`location.hash = '#/macro'; window.dispatchEvent(new Event('hashchange')); 'ok'`);
  await sleep(700);

  // 7a6. 我的计划下拉：列出全部已保存训练计划（种子仅 1 个）
  const mp = await evaluate(`(() => {
    document.querySelector('#myPlansBtn').click();
    const menu = document.querySelector('#myPlansMenu');
    const items = [...menu.querySelectorAll('[data-mpick]')];
    return { open: menu.style.display !== 'none', n: items.length, activeFirst: items[0] ? items[0].classList.contains('active') : false };
  })()`);
  assert(mp && mp.open && mp.n === 1, `我的计划下拉展开并列出 1 个计划 (${mp && mp.n})`);
  assert(mp && mp.activeFirst, '当前计划在菜单中高亮（⚑）');
  // 点击当前项（已激活），菜单应收起
  await evaluate(`(() => { const items = [...document.querySelectorAll('#myPlansMenu [data-mpick]')]; items[0].click(); return 'ok'; })()`);
  const mpClosed = await evalWait(`(() => ({ closed: document.querySelector('#myPlansMenu').style.display === 'none', name: Store.activeMacro().name, bands: new Set([...document.querySelectorAll('#gridBox [data-gbedit]')].map((e) => e.dataset.gbedit + '|' + e.dataset.cat)).size }))()`, (v) => v && v.closed && v.bands === 13);
  assert(mpClosed && mpClosed.closed && mpClosed.name === 'XX篮球队备战计划', '点击当前项后菜单收起且计划不变');
  assert(mpClosed && mpClosed.bands === 13, `目标块 13 仍在（含 7a5 拖选新建的）(${mpClosed && mpClosed.bands})`);

  // 7a6b. 自定义大分类删除：新增 → 行内 ✕ → 确认 → 分类行与目标库一并清理（内置分类无删除按钮）
  const catDel = await evaluate(`(() => {
    const before = Store.allGoalCats().length;
    document.querySelector('#gridBox #addCatBtn').click();
    return { before };
  })()`);
  await sleep(400);
  await evaluate(`(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    ov.querySelector('#acName').value = '临时删除测试分类';
    ov.querySelector('[data-ok]').click();
    return 'ok';
  })()`);
  await sleep(700);
  const catAdded = await evaluate(`(() => ({
    total: Store.allGoalCats().length,
    row: !!document.querySelector('#gridBox [data-catrow="临时删除测试分类"]'),
    delBtn: !!document.querySelector('#gridBox [data-delcat="临时删除测试分类"]'),
    delOnBuiltin: !!document.querySelector('#gridBox [data-delcat="力量训练"]')
  }))()`);
  assert(catAdded && catAdded.total === catDel.before + 1 && catAdded.row && catAdded.delBtn, '新增自定义大分类出现删除按钮（✕）');
  assert(catAdded && !catAdded.delOnBuiltin, '内置分类无删除按钮（仅隐藏）');
  await evaluate(`(() => { document.querySelector('#gridBox [data-delcat="临时删除测试分类"]').click(); return 'ok'; })()`);
  await sleep(400);
  await evaluate(`(() => { const ov = [...document.querySelectorAll('.overlay')].pop(); const ok = ov && ov.querySelector('[data-ok]'); if (ok) ok.click(); return 'ok'; })()`);
  await sleep(700);
  const catGone = await evalWait(`(() => ({
    total: Store.allGoalCats().length,
    row: !!document.querySelector('#gridBox [data-catrow="临时删除测试分类"]'),
    goals: Store.data.goals.filter((g) => g.cat === '临时删除测试分类').length
  }))()`, (v) => !!v);
  assert(catGone && catGone.total === catDel.before && !catGone.row && catGone.goals === 0, '删除自定义分类：分类行移除、目标库级联清理、计数还原');

  // 7b. 中周期带「✎」编辑按钮 → 打开编辑弹窗（含删除按钮）
  await evaluate(`document.querySelector('#gridBox [data-med]').click(); "ok"`);
  await sleep(400);
  const mesoEdit = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    return { ok: !!ov && !!ov.querySelector('#mName'), name: ov ? ov.querySelector('#mName').value : '', hasDel: !!ov && !!ov.querySelector('[data-del]') };
  })()`);
  assert(mesoEdit && mesoEdit.ok && mesoEdit.hasDel, `中周期「✎」编辑按钮打开弹窗（${mesoEdit && mesoEdit.name}）含删除`);
  await evaluate(`(() => { const ovs = [...document.querySelectorAll('.overlay')]; ovs[ovs.length - 1].querySelector('[data-x]').click(); return 'ok'; })()`);
  await sleep(200);

  // 7c. 点击中周期带名（非✎按钮）→ 跳转中周期页规划
  await evaluate(`(() => { const td = document.querySelector('#gridBox [data-medit]'); const evt = new Event('click', { bubbles: true }); td.dispatchEvent(evt); return 'ok'; })()`);
  await sleep(800);
  const jump = await evaluate(`(() => {
    const m = Store.data.mesos.find((x) => x.id === Views.meso.state.mesoId);
    return {
      hash: location.hash,
      name: m ? m.name : '',
      hasMicroBox: !!document.querySelector('#microBox'),
      planMode: !document.querySelector('#mesoDetail [data-f="actual"]')
    };
  })()`);
  assert(jump && jump.hash === '#/meso' && jump.name, `点击中周期带跳转中周期页（${jump && jump.name}）`);
  assert(jump && jump.hasMicroBox, '中周期页含小周期划分');
  assert(jump && jump.planMode, '中周期动作表为计划模式（不含实际完成/RIR）');

  // 页内编辑弹窗（含删除按钮）删除当前中周期
  await evaluate(`(() => { const b = document.querySelector('#mesoEdit'); if (b) b.click(); return 'ok'; })()`);
  await sleep(400);
  const delFlow = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    if (!ov || !ov.querySelector('#fName')) return { modal: false };
    const name = ov.querySelector('#fName').value;
    ov.querySelector('[data-del]').click();
    return { modal: true, name };
  })()`);
  await sleep(300);
  await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    ovs[ovs.length - 1].querySelector('[data-ok]').click();
    return 'ok';
  })()`);
  await sleep(600);
  const afterDel = await evaluate(`Store.mesosOf(Store.activeMacro().id).length`);
  assert(delFlow && delFlow.modal, '中周期页编辑弹窗（' + (delFlow && delFlow.name || '') + '）含删除按钮');
  assert(afterDel === 5, `删除后中周期减为 5 个 (实际 ${afterDel})`);
  await evaluate('location.hash = "#/macro"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(900);
  // 中周期空白周拖选：相邻两个空白周拖选 → 高亮并弹出定义弹窗（预填起始/结束周，单周点击同样可创建）
  const mesoDragNew = await evalWait(`(() => {
    const cells = [...document.querySelectorAll('#gridBox .pg-msdrag')];
    let a = null, b = null;
    for (let k = 0; k + 1 < cells.length; k++) { if (+cells[k + 1].dataset.msi === +cells[k].dataset.msi + 1) { a = cells[k]; b = cells[k + 1]; break; } }
    if (!a) return { ok: false, n: cells.length };
    a.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    const sel = document.querySelectorAll('#gridBox .pg-msdrag.drag-sel').length;
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    if (!ov || !ov.querySelector('#mName')) return { ok: false, sel };
    return { ok: true, sel, sVal: +ov.querySelector('#mS').value, eVal: +ov.querySelector('#mE').value, si: +a.dataset.msi, ei: +b.dataset.msi };
  })()`, (v) => v && v.ok, 8000);
  assert(mesoDragNew && mesoDragNew.ok && mesoDragNew.sel === 2, `中周期空白周拖选 2 周高亮并弹出定义弹窗 (${mesoDragNew && mesoDragNew.sel} 格)`);
  assert(mesoDragNew && mesoDragNew.sVal === mesoDragNew.si && mesoDragNew.eVal === mesoDragNew.ei, `拖选预填起始/结束周（第 ${mesoDragNew && mesoDragNew.si + 1} — 第 ${mesoDragNew && mesoDragNew.ei + 1} 周）`);
  await sleep(300);
  const newMeso = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    if (!ov || !ov.querySelector('#mName')) return { ok: false };
    ov.querySelector('#mName').value = '自定义测试块';
    const s = ov.querySelector('#mS');
    const busyOpts = [...s.options].filter((o) => o.disabled).length;
    ov.querySelector('[data-ok]').click();
    const mes = Store.data.mesos.find((m) => m.name === '自定义测试块');
    return { ok: true, busyOpts, days: mes ? U.daysBetween(mes.startDate, mes.endDate) : null };
  })()`);
  await sleep(500);
  await evaluate('location.hash = "#/meso"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(900);
  const mesoVisible = await evaluate(`(() => !![...document.querySelectorAll('.day-chip .d2')].find((x) => x.textContent === '自定义测试块'))()`);
  assert(newMeso && newMeso.ok, '拖选中周期弹窗命名并保存');
  assert(newMeso && newMeso.days === 14, `拖选 2 周创建的中周期跨度 14 天 (实际 ${newMeso && newMeso.days})`);
  assert(newMeso && newMeso.busyOpts > 0, `已占用周在下拉中禁用 (${newMeso && newMeso.busyOpts} 个)`);
  assert(mesoVisible, '自定义中周期映射到「中周期」模块列表');

  // 7b. 中周期页：自定义天数小周期 + 休息日标记 + 点击小周期进入小周期页
  await evaluate(`(() => { const b = document.querySelector('#mesoMicAdd'); if (b) b.click(); return 'ok'; })()`);
  await sleep(300);
  const micNew = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    if (!ov || !ov.querySelector('#miName')) return { ok: false };
    ov.querySelector('#miName').value = '五天冲击段';
    ov.querySelector('#miDays').value = '5';
    ov.querySelector('[data-ok]').click();
    return { ok: true };
  })()`);
  await sleep(500);
  const micCheck = await evaluate(`(() => {
    const mic = Store.data.micros.find((m) => m.name === '五天冲击段');
    return mic ? { days: U.daysBetween(mic.startDate, mic.endDate) } : null;
  })()`);
  assert(micNew && micNew.ok, '中周期页新建小周期弹窗');
  assert(micCheck && micCheck.days === 5, `小周期天数自定义生效 (${micCheck && micCheck.days} 天)`);
  await evaluate(`(() => { const c = document.querySelector('#microBox [data-mic]'); if (c) c.click(); return 'ok'; })()`);
  await sleep(700);
  const micJump = await evaluate(`(() => ({ hash: location.hash, has: !!Views.micro.state.microId }))()`);
  assert(micJump && micJump.hash === '#/micro' && micJump.has, '点击小周期进入小周期页面');

  // 7c. 小周期页重构：小周期列表置顶横排，强度调整条移至中周期页；其余功能（类型/备注/目标/图表/KPI）保留
  const micLayout = await evaluate(`(() => {
    const el = document.querySelector('#microDetail');
    const side = document.querySelector('#microSide');
    const html = el.innerHTML;
    const ch = echarts.getInstanceByDom(el.querySelector('#chMicro'));
    const names = ch ? ch.getOption().series.map((s) => s.name) : [];
    const mic = Store.data.micros.find((m) => m.id === Views.micro.state.microId);
    return {
      topList: !!side.querySelector('.top-list'),
      itemN: side.querySelectorAll('.top-list .top-item').length,
      micN: Store.data.micros.filter((m) => m.mesoId === mic.mesoId).length,
      hasTypeCol: el.querySelector('thead').textContent.includes('训练类型'),
      hasPlanCol: el.querySelector('thead').textContent.includes('当日训练计划'),
      noIntensityCol: !el.querySelector('thead').textContent.includes('强度'),
      noSlider: !el.querySelector('input[type="range"]'),
      noTarget: !html.includes('周计划负荷'),
      kpiHi: html.includes('≥80%'), kpiMid: html.includes('50-79%'), kpiLow: el.textContent.includes('<50%'),
      names
    };
  })()`);
  assert(micLayout && micLayout.topList && micLayout.itemN === micLayout.micN, `小周期列表置顶横排（${micLayout && micLayout.itemN} 个）`);
  assert(micLayout && micLayout.hasTypeCol && micLayout.hasPlanCol && micLayout.noIntensityCol && micLayout.noSlider, '小周期页移除强度列与滑杆（训练类型/当日计划等其余功能保留）');
  assert(micLayout && micLayout.kpiHi && micLayout.kpiMid && micLayout.kpiLow && micLayout.noTarget, `强度区间卡片保留且已删除周计划负荷 (实际 ${JSON.stringify(micLayout && { hi: micLayout.kpiHi, mid: micLayout.kpiMid, low: micLayout.kpiLow, noT: micLayout.noTarget })})`);
  assert(micLayout && micLayout.names.includes('训练量（AU）') && micLayout.names.includes('疲劳（AU）'), '每日强度节奏含训练量与疲劳曲线');

  // 7c-2. 中周期页：日条与每日 1RM% 负荷滑杆已合并为同一张日卡片（拖动写入小周期当日强度 + 同步课程动作 %1RM）
  await evaluate('location.hash = "#/meso"; window.dispatchEvent(new Event("hashchange")); "ok"');
  const loadBar = await evalWait(`(() => {
    const list = document.querySelector('#mesoList');
    const strip = document.querySelector('#mesoDetail .daystrip.merged');
    const oldBar = document.querySelector('#mesoDetail #mesoLoadBar');
    if (!list || !strip || oldBar) return null;
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const expectDays = Math.round((new Date(meso.endDate) - new Date(meso.startDate)) / 86400000) + 1;
    const cards = strip.querySelectorAll('.day-chip');
    const rgs = strip.querySelectorAll('input[type="range"]');
    const enabled = [...rgs].find((r) => !r.disabled);
    return {
      topList: !!list.querySelector('.top-list'),
      itemN: list.querySelectorAll('.top-list .top-item').length,
      mesoN: Store.mesosOf(Store.activeMacro().id).length,
      n: rgs.length, cardN: cards.length, expectDays,
      sliderInCard: enabled ? !!enabled.closest('.day-chip[data-day]') : false,
      max: enabled ? Number(enabled.max) : 0,
      valPct: enabled && enabled.closest('.day-chip').querySelector('.val') ? enabled.closest('.day-chip').querySelector('.val').textContent.includes('%') : false,
      firstDay: enabled ? enabled.dataset.lday : null
    };
  })()`, (v) => !!v && v.n > 0);
  assert(loadBar && loadBar.topList && loadBar.itemN === loadBar.mesoN, `中周期列表置顶横排（${loadBar && loadBar.itemN}/${loadBar && loadBar.mesoN} 个）`);
  assert(loadBar && loadBar.n === loadBar.expectDays && loadBar.cardN === loadBar.expectDays && loadBar.sliderInCard && loadBar.max === 100 && loadBar.valPct, `日条与负荷滑杆已合并为日卡片（${loadBar && loadBar.n}/${loadBar && loadBar.expectDays} 天，每卡含 0-100% 滑杆）`);
  // 点击日卡片（非滑杆区域）定位该日
  await evaluate(`(() => {
    const card = document.querySelector('#mesoDetail .daystrip.merged .day-chip[data-day="${loadBar.firstDay}"] .d2');
    if (card) card.click();
    return 'ok';
  })()`);
  await sleep(400);
  const sliderSet = await evaluate(`(() => {
    const day = Views.meso.state.day;
    const rg = document.querySelector('#mesoDetail .daystrip.merged input[data-lday="' + day + '"]');
    if (!rg || rg.disabled) return { ok: false };
    rg.value = 85;
    rg.dispatchEvent(new Event('input', { bubbles: true }));
    rg.dispatchEvent(new Event('change', { bubbles: true }));
    const mic = Store.data.micros.find((m) => m.mesoId === Views.meso.state.mesoId && U.between(day, m.startDate, m.endDate));
    const rec = mic ? (mic.days || []).find((x) => x.date === day) : null;
    const chip = document.querySelector('#micDayChip');
    const rg2 = document.querySelector('#mesoDetail .daystrip.merged input[data-lday="' + day + '"]');
    const valEl = rg2 ? rg2.closest('.day-chip').querySelector('.val') : null;
    return { ok: true, day, intensity: rec ? rec.intensity : null, chip: chip ? chip.textContent : '', val: valEl ? valEl.textContent : '' };
  })()`);
  assert(sliderSet && sliderSet.ok && sliderSet.intensity === 85 && sliderSet.val === '85%' && sliderSet.chip.includes('85%'), '拖动日卡片滑杆→保存到所属小周期当日强度并同步显示');

  // 滑杆同步课程动作 %1RM：找一个已安排动作且映射训练课尚无实际数据的日期，拖动后当日全部课程行 pct 与映射训练课 rows pct 同步
  const pctSync = await evaluate(`(() => {
    const meso0 = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const hasActual = (s) => Store.sessionHasActual(s);
    const keyOf = (c, d) => meso0.id + ':' + d + (c.id ? ':' + c.id : '');
    const target = (meso0.days || []).find((x) => !x.rest && Store.dayCourses(x).some((c) => {
      if (!(c.rows || []).some((r) => r.exId)) return false;
      const s = Store.data.sessions.find((z) => z.planKey === keyOf(c, x.date));
      return !s || !hasActual(s);
    }));
    if (!target) return { ok: false, reason: 'no-day-with-rows' };
    const meso = Store.data.mesos.find((m) => m.id === meso0.id);
    Views.meso.state.day = target.date; Views.meso.state.weekIdx = null; Views.meso.mount();
    const before = Store.dayRows(Store.data.mesos.find((m) => m.id === meso.id).days.find((x) => x.date === target.date)).map((r) => r.pct);
    const rg = document.querySelector('#mesoDetail .daystrip.merged input[data-lday="' + target.date + '"]');
    rg.value = 70;
    rg.dispatchEvent(new Event('input', { bubbles: true }));
    rg.dispatchEvent(new Event('change', { bubbles: true }));
    const fresh = Store.data.mesos.find((m) => m.id === meso.id);
    const dayRec = fresh.days.find((x) => x.date === target.date);
    const courses = Store.dayCourses(dayRec);
    const afterRows = Store.dayRows(dayRec);
    const allPct = afterRows.filter((r) => r.exId).every((r) => r.pct === 70);
    const keys = courses.map((c) => keyOf(c, target.date));
    const sesRows = Store.data.sessions.filter((s) => keys.includes(s.planKey) && !hasActual(s)).flatMap((s) => s.rows || []).filter((r) => r.exId);
    const sesOk = sesRows.length > 0 && sesRows.every((r) => r.pct === 70);
    // 手动改单个动作 %1RM 不被阻止
    const cr = Store.dayCourses(Store.data.mesos.find((m) => m.id === meso.id).days.find((x) => x.date === target.date))[0];
    if (cr && cr.rows[0]) { cr.rows[0].pct = 55; Store.save(); }
    return { ok: true, before, allPct, sesOk, sesN: sesRows.length, manual: cr && cr.rows[0] ? cr.rows[0].pct : null };
  })()`);
  assert(pctSync && pctSync.ok && pctSync.allPct, `拖动滑杆→当日课程动作 %1RM 全部同步为该强度（${pctSync && JSON.stringify(pctSync.before)} → 70）`);
  assert(pctSync && pctSync.sesOk, `同步映射到当日训练课动作 %1RM（${pctSync && pctSync.sesN} 行均为 70）`);
  assert(pctSync && pctSync.manual === 55, '课程动作内仍可手动修改 %1RM');

  // 动作 %1RM 手动调到负荷条之上 → 负荷条自动上调到最高动作百分比（只升不降）
  const barFollow = await evaluate(`(() => {
    const day = Views.meso.state.day;
    Views.meso.state.weekIdx = null; Views.meso.mount();
    // 先把负荷条拉到 50（当日动作行全部同步 50）
    const rg0 = document.querySelector('#mesoDetail .daystrip.merged input[data-lday="' + day + '"]');
    rg0.value = 50; rg0.dispatchEvent(new Event('input', { bubbles: true })); rg0.dispatchEvent(new Event('change', { bubbles: true }));
    const setPct = (v) => {
      const inp = document.querySelector('#mesoDetail #dayTable .ex-pct');
      if (!inp) return false;
      inp.value = v; inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const read = () => {
      const mic = Store.data.micros.find((m) => m.mesoId === Views.meso.state.mesoId && U.between(day, m.startDate, m.endDate));
      const rec = mic ? (mic.days || []).find((x) => x.date === day) : null;
      const rg = document.querySelector('#mesoDetail .daystrip.merged input[data-lday="' + day + '"]');
      const valEl = rg ? rg.closest('.day-chip').querySelector('.val') : null;
      return { intensity: rec ? rec.intensity : null, slider: rg ? rg.value : null, val: valEl ? valEl.textContent : '' };
    };
    const upOk = setPct(60);
    const afterUp = read();
    const downOk = setPct(40);
    const afterDown = read();
    return { upOk, downOk, afterUp, afterDown };
  })()`);
  assert(barFollow && barFollow.upOk && barFollow.afterUp.intensity === 60 && barFollow.afterUp.slider === '60' && barFollow.afterUp.val === '60%', '动作调到 60% 超过负荷条 50% → 负荷条自动上调为 60%');
  assert(barFollow && barFollow.downOk && barFollow.afterDown.intensity === 60 && barFollow.afterDown.slider === '60', '动作调低不回拉负荷条（仅自动上调），仍为 60%');

  // 无动作的日期：先设负荷条，再添加动作 → 新动作 %1RM 自动按负荷条百分比带入
  const newRowPct = await evaluate(`(() => {
    const meso0 = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const mics = Store.microsOf(meso0.id);
    let target = null;
    outer: for (const mi of mics) {
      for (let d = mi.startDate; d <= mi.endDate; d = U.addDays(d, 1)) {
        if (d < meso0.startDate || d > meso0.endDate) continue;
        const dys = (meso0.days || []).filter((x) => x.date === d);
        if (dys.some((x) => x.rest)) continue;
        if (!dys.some((x) => Store.dayRows(x).length)) { target = d; break outer; }
      }
    }
    if (!target) return { ok: false, reason: 'no-empty-day' };
    Views.meso.state.day = target; Views.meso.state.weekIdx = null; Views.meso.mount();
    // 设定当日负荷条 65%
    const rg = document.querySelector('#mesoDetail .daystrip.merged input[data-lday="' + target + '"]');
    if (!rg || rg.disabled) return { ok: false, reason: 'no-slider' };
    rg.value = 65; rg.dispatchEvent(new Event('input', { bubbles: true })); rg.dispatchEvent(new Event('change', { bubbles: true }));
    // 添加动作行（未选动作时 %1RM 已预填 65）
    document.querySelector('#mesoDetail #dayTable .ex-add').click();
    const prefilled = document.querySelector('#mesoDetail #dayTable .ex-pct') ? document.querySelector('#mesoDetail #dayTable .ex-pct').value : null;
    // 选择第一个动作
    const sel = document.querySelector('#mesoDetail #dayTable .ex-sel');
    const opt = [...sel.options].find((o) => o.value);
    sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const meso = Store.data.mesos.find((m) => m.id === meso0.id);
    const dr = meso.days.find((x) => x.date === target);
    const course = Store.dayCourses(dr)[0];
    const inpVal = document.querySelector('#mesoDetail #dayTable .ex-pct') ? document.querySelector('#mesoDetail #dayTable .ex-pct').value : null;
    return { ok: true, prefilled, rowPct: course.rows[0] ? course.rows[0].pct : null, inpVal, exId: course.rows[0] ? course.rows[0].exId : null };
  })()`);
  assert(newRowPct && newRowPct.ok && newRowPct.prefilled === '65' && newRowPct.rowPct === 65 && newRowPct.inpVal === '65' && !!newRowPct.exId, `负荷条 65% 时添加动作，%1RM 自动带入 65%（${newRowPct && JSON.stringify({ pre: newRowPct.prefilled, row: newRowPct.rowPct, inp: newRowPct.inpVal })}）`);

  // 日期显示必须带年份（U.md 全局格式 + 日卡片 DOM）；等待日条渲染完成
  const dateYr = await evalWait(`(() => ({
    fmt: U.md('2026-03-05'),
    chip: document.querySelector('#mesoDetail .daystrip .day-chip .d1') ? document.querySelector('#mesoDetail .daystrip .day-chip .d1').textContent : ''
  }))()`, (v) => v && /^20\d{2}\//.test(v.chip));
  assert(dateYr && dateYr.fmt === '2026/3/5' && /^20\d{2}\//.test(dateYr.chip), `日期显示含年份（${dateYr && dateYr.fmt} / ${dateYr && dateYr.chip}）`);

  // 7d. 中周期页：KPI 保留计划总次数 + 训练课类别次数；图表含 负荷/实际量/疲劳/峰值状态；
  //     实际负荷统计图无下拉且每个小周期一根柱；课程设计不显示 kg（重量只取已完成训练课实际值）
  await evaluate('location.hash = "#/meso"; window.dispatchEvent(new Event("hashchange")); "ok"');
  // 先打开一个已安排动作的日期（轮询外只做一次，避免反复重绘）
  await evaluate(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const rec = (meso.days || []).find((x) => Store.dayCourses(x).some((c) => c.rows.length));
    if (rec) { Views.meso.state.day = rec.date; Views.meso.mount(); }
    return 'ok';
  })()`);
  await sleep(500);
  const mesoCurves = await evalWait(`(() => {
    const el = document.querySelector('#mesoDetail');
    if (!el) return null;
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const dayT = el.querySelector('#dayTable');
    const ch = echarts.getInstanceByDom(el.querySelector('#chMesoDay'));
    const names = ch ? ch.getOption().series.map((s) => s.name) : [];
    const ach = echarts.getInstanceByDom(el.querySelector('#chMesoActual'));
    const aOpt = ach ? ach.getOption() : null;
    return {
      hasReps: el.innerHTML.includes('计划总次数'),
      noOld: !el.innerHTML.includes('中周期总吨位') && !el.innerHTML.includes('力量训练日') && !el.innerHTML.includes('平均强度'),
      names,
      noMicFilter: !el.querySelector('#mesoMicFilter'),
      actualBars: aOpt ? aOpt.xAxis[0].data.length : 0,
      nW: Math.max(1, Math.ceil(U.daysBetween(meso.startDate, meso.endDate) / 7)),
      microN: Store.data.micros.filter((mi) => mi.mesoId === meso.id).length,
      courseKg: dayT ? [...dayT.querySelectorAll('.hint')].some((h) => /\\d+(\\.\\d+)?\\s*kg/.test(h.textContent)) : null,
      courseHint: dayT ? [...dayT.querySelectorAll('.hint')].some((h) => h.textContent.includes('个动作')) : null
    };
  })()`, (v) => !!v && v.hasReps && v.names.length > 0);
  assert(mesoCurves && mesoCurves.hasReps && mesoCurves.noOld, '中周期 KPI 保留计划总次数并显示训练课类别次数');
  assert(mesoCurves && ['负荷（AU）', '量（kg，实际）', '疲劳（AU）', '峰值状态（AU）'].every((n) => mesoCurves.names.includes(n)), '中周期曲线含 负荷-实际量-疲劳-峰值状态');
  assert(mesoCurves && mesoCurves.noMicFilter && mesoCurves.actualBars === mesoCurves.nW, `实际负荷统计图无下拉且与周标签同口径逐周出柱（${mesoCurves && mesoCurves.actualBars}/${mesoCurves && mesoCurves.nW} 周）`);
  assert(mesoCurves && mesoCurves.courseKg === false && mesoCurves.courseHint, '课程设计不显示重量 kg，显示动作数量');

  // 7e-2. 周期周数标签：点击第 N 周 → 日条只显示该周每一天；「全部」恢复
  const wkTabs = await evalWait(`(() => {
    const tabs = document.querySelectorAll('#mesoDetail #mesoWeekTabs [data-wk]');
    if (!tabs.length) return { ok: false };
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const nW = Math.max(1, Math.ceil(U.daysBetween(meso.startDate, meso.endDate) / 7));
    return { ok: true, n: tabs.length, nW, labels: [...tabs].map((t) => t.textContent.trim().split(/\\s+/)[0]) };
  })()`, (v) => !!v && v.ok);
  assert(wkTabs && wkTabs.n === wkTabs.nW + 1, `周期周数标签：全部 + ${wkTabs && wkTabs.nW} 周 (${wkTabs && wkTabs.n} 个)`);
  assert(wkTabs && wkTabs.labels[1] === '第一周' && wkTabs.labels[2] === '第二周', '周标签为 第一周/第二周…');
  await evaluate(`document.querySelector('#mesoDetail #mesoWeekTabs [data-wk="1"]').click(); 'ok'`);
  await sleep(500);
  const wk2 = await evalWait(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const chips = document.querySelectorAll('#mesoDetail .daystrip .day-chip');
    const active = document.querySelector('#mesoDetail #mesoWeekTabs [data-wk="1"]');
    return { n: chips.length, day: Views.meso.state.day, w2s: U.addDays(meso.startDate, 7), firstExp: U.md(U.addDays(meso.startDate, 7)), activeVolt: active.classList.contains('volt'), first: chips[0] ? chips[0].querySelector('.d1').textContent : '' };
  })()`, (v) => !!v && v.n > 0);
  assert(wk2 && wk2.n === 7, `点击第二周 → 日条显示该周 7 天 (${wk2 && wk2.n})`);
  assert(wk2 && wk2.day === wk2.w2s && wk2.activeVolt, '定位到第二周首日且标签高亮');
  assert(wk2 && wk2.first === wk2.firstExp, `日条首日为第二周首日 (${wk2 && wk2.first})`);
  // 第N周：实际负荷看板与百分比负荷看板都按该周 7 天逐日显示
  const wkCharts = await evaluate(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const micros = Store.microsOf(meso.id);
    const ws = U.addDays(meso.startDate, 7), we = U.addDays(ws, 6);
    const days = []; for (let d = ws; d <= we; d = U.addDays(d, 1)) days.push(d);
    // 当日最高 %1RM：课程动作行 pct 与小周期当日强度取大值
    const dayMax = (date) => {
      let v = 0;
      for (const dy of (meso.days || []).filter((x) => x.date === date && !x.rest))
        for (const c of Store.dayCourses(dy)) for (const r of (c.rows || [])) if (r.exId) v = Math.max(v, Number(r.pct) || 0);
      const mi = micros.find((x) => U.between(date, x.startDate, x.endDate));
      const rec = mi && (mi.days || []).find((x) => x.date === date);
      if (rec && rec.intensity != null) v = Math.max(v, Number(rec.intensity) || 0);
      return v;
    };
    const act = echarts.getInstanceByDom(document.querySelector('#chMesoActual')).getOption();
    const pct = echarts.getInstanceByDom(document.querySelector('#chMesoPct')).getOption();
    const dch = echarts.getInstanceByDom(document.querySelector('#chMesoDay')).getOption();
    const sesDaily = days.map((d) => Store.data.sessions.filter((s) => s.date === d).length);
    const pctExpect = days.map(dayMax);
    return {
      actN: act.xAxis[0].data.length,
      actSeries: act.series.map((s) => s.name),
      sesVals: act.series[1] ? act.series[1].data : null,
      actHint: document.querySelector('#chMesoActualHint').textContent,
      pctN: pct.xAxis[0].data.length,
      pctVals: pct.series[0].data.map((d) => d.value),
      pctExpect,
      pctMax: pct.yAxis[0].max,
      pctHint: document.querySelector('#chMesoPctHint').textContent,
      dayN: dch.xAxis[0].data.length,
      dayNames: dch.series.map((s) => s.name),
      dayHint: document.querySelector('#chMesoDayHint').textContent,
      sesDaily
    };
  })()`);
  assert(wkCharts && wkCharts.actN === 7 && wkCharts.actSeries.includes('全队负荷（AU）') && wkCharts.actSeries.includes('训练课次') && wkCharts.actHint.includes('按日'), `第N周实际负荷看板按该周 7 天逐日显示（${wkCharts && wkCharts.actN} 天）`);
  assert(wkCharts && wkCharts.dayN === 7 && wkCharts.dayHint.includes('按日') && ['负荷（AU）', '量（kg，实际）', '疲劳（AU）', '峰值状态（AU）'].every((n) => wkCharts.dayNames.includes(n)), `第N周负荷·量·疲劳·峰值看板按该周 7 天逐日显示（${wkCharts && wkCharts.dayN} 天）`);
  assert(wkCharts && JSON.stringify(wkCharts.sesVals) === JSON.stringify(wkCharts.sesDaily), '第N周课次曲线为每日训练课数');
  assert(wkCharts && wkCharts.pctN === 7 && wkCharts.pctMax === 100 && JSON.stringify(wkCharts.pctVals) === JSON.stringify(wkCharts.pctExpect) && wkCharts.pctHint.includes('当天最高'), `第N周百分比负荷看板逐日显示当天最高 1RM%（${wkCharts && JSON.stringify(wkCharts.pctVals)}）`);
  await evaluate(`document.querySelector('#mesoDetail #mesoWeekTabs [data-wk="all"]').click(); 'ok'`);
  const wkAll = await evalWait(`(() => ({ idx: Views.meso.state.weekIdx, n: document.querySelectorAll('#mesoDetail .daystrip .day-chip').length }))()`, (v) => v && v.idx === null && v.n > 0);
  await sleep(400);
  assert(wkAll && wkAll.idx === null && wkAll.n > 0, '点「全部」恢复整段/小周期视图');
  // 全部：三个看板均与周标签同口径逐周出柱（第N周）；百分比柱 = 该周内最高当日 1RM%
  const pctAll = await evaluate(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const micros = Store.microsOf(meso.id);
    const nW = Math.max(1, Math.ceil(U.daysBetween(meso.startDate, meso.endDate) / 7));
    const weeks = Array.from({ length: nW }, (_, i) => {
      const s = U.addDays(meso.startDate, i * 7);
      return { s, e: U.addDays(s, 6) < meso.endDate ? U.addDays(s, 6) : meso.endDate };
    });
    const dayMax = (date) => {
      let v = 0;
      for (const dy of (meso.days || []).filter((x) => x.date === date && !x.rest))
        for (const c of Store.dayCourses(dy)) for (const r of (c.rows || [])) if (r.exId) v = Math.max(v, Number(r.pct) || 0);
      const mi = micros.find((x) => U.between(date, x.startDate, x.endDate));
      const rec = mi && (mi.days || []).find((x) => x.date === date);
      if (rec && rec.intensity != null) v = Math.max(v, Number(rec.intensity) || 0);
      return v;
    };
    const expect = weeks.map((w) => {
      let mx = 0;
      for (let d = w.s; d <= w.e; d = U.addDays(d, 1)) mx = Math.max(mx, dayMax(d));
      return mx;
    });
    const pct = echarts.getInstanceByDom(document.querySelector('#chMesoPct')).getOption();
    const act = echarts.getInstanceByDom(document.querySelector('#chMesoActual')).getOption();
    const dch = echarts.getInstanceByDom(document.querySelector('#chMesoDay')).getOption();
    return {
      n: pct.xAxis[0].data.length, nW,
      labels: pct.xAxis[0].data,
      vals: pct.series[0].data.map((d) => d.value), expect,
      actN: act.xAxis[0].data.length, actLabels: act.xAxis[0].data,
      dayN: dch.xAxis[0].data.length,
      dayNames: dch.series.map((s) => s.name),
      dayHint: document.querySelector('#chMesoDayHint').textContent,
      actHint: document.querySelector('#chMesoActualHint').textContent,
      hint: document.querySelector('#chMesoPctHint').textContent
    };
  })()`);
  assert(pctAll && pctAll.n === pctAll.nW && pctAll.actN === pctAll.nW && pctAll.labels[0] === '第一周' && pctAll.actLabels[0] === '第一周', `全部视图两个看板与周标签同口径逐周出柱（${pctAll && pctAll.n}/${pctAll && pctAll.nW} 周，首柱「${pctAll && pctAll.labels[0]}」）`);
  assert(pctAll && pctAll.dayN === pctAll.nW && pctAll.dayHint.includes('按周') && pctAll.actHint.includes('按周') && ['负荷（AU）', '量（kg，实际）', '疲劳（AU）', '峰值状态（AU）'].every((n) => pctAll.dayNames.includes(n)), `全部视图负荷·量·疲劳·峰值看板逐周汇总（${pctAll && pctAll.dayN}/${pctAll && pctAll.nW}）`);
  assert(pctAll && JSON.stringify(pctAll.vals) === JSON.stringify(pctAll.expect) && pctAll.hint.includes('每周内最高'), `百分比柱=各周内最高当日 1RM%（${pctAll && JSON.stringify(pctAll.vals)}）`);

  // 7e-3. 小周期映射：中周期 → 小周期页 → 训练课 双向跳转
  const micJumpM = await evaluate(`(() => {
    const card = document.querySelector('#mesoDetail [data-mic]');
    if (!card) return { ok: false };
    card.click();
    return { ok: true, micId: card.dataset.mic };
  })()`);
  await sleep(700);
  const micPageM = await evalWait(`(() => ({
    hash: location.hash,
    active: document.querySelector('#microSide .day-chip.active') ? document.querySelector('#microSide .day-chip.active').dataset.id : null
  }))()`, (v) => !!v && v.hash === '#/micro');
  assert(micJumpM && micJumpM.ok && micPageM && micPageM.active === micJumpM.micId, '点击中周期小周期卡 → 跳转小周期页并定位该小周期');
  const planCellM = await evalWait(`(() => ({
    gses: [...document.querySelectorAll('#microDetail .plan-line[data-gses]')].map((c) => c.dataset.gses),
    tblHasCol: document.querySelector('#microDetail thead').textContent.includes('当日训练计划'),
    noTypeSel: !document.querySelector('#microDetail tbody select[data-f="type"]')
  }))()`, (v) => !!v && v.tblHasCol);
  assert(planCellM && planCellM.gses.length > 0 && planCellM.noTypeSel, `小周期每日行只读显示课程类型与具体课程计划（${planCellM && planCellM.gses.length} 条课程计划入口）`);

  // 一天多节课：类型列按节显示「第一节：类型 / 第二节：类型」，计划列每节课一行显示动作
  const multiCourse = await evaluate(`(() => {
    const micro = Store.data.micros.find((m) => m.id === Views.micro.state.microId);
    const d = micro.days[0].date;
    const meso = Store.data.mesos.find((x) => x.id === micro.mesoId);
    let dy = meso.days.find((x) => x.date === d);
    if (!dy) { dy = { date: d, note: '', rows: [], courses: [] }; meso.days.push(dy); }
    dy.rest = false;
    dy.courses = [
      { id: U.uid('cs'), name: '力量课', type: '力量', rows: [{ exId: Store.data.exercises[0].id, pct: 75, sets: 4, reps: 6 }] },
      { id: U.uid('cs'), name: '体能课', type: '体能', rows: [{ exId: Store.data.exercises[1].id, pct: 60, sets: 3, reps: 12 }] }
    ];
    Store.save(); Views.micro.mount();
    const tr = document.querySelector('#microDetail tbody tr[data-i="0"]');
    const typeTd = tr.children[1], planTd = tr.children[2];
    return {
      d,
      t1: typeTd.textContent.includes('第一节：力量'), t2: typeTd.textContent.includes('第二节：体能'),
      lineN: planTd.querySelectorAll('.plan-line').length,
      hasEx: planTd.textContent.includes(Store.exercise(Store.data.exercises[0].id).name)
    };
  })()`);
  assert(multiCourse && multiCourse.t1 && multiCourse.t2, '一天多节课类型列按节显示（第一节：力量 / 第二节：体能）');
  assert(multiCourse && multiCourse.lineN === 2 && multiCourse.hasEx, '当日计划列逐节显示具体课程动作（2 节课 = 2 条计划）');
  await evaluate(`document.querySelector('#microDetail .plan-line[data-gses="${multiCourse.d}"]').click(); 'ok'`);
  await sleep(700);
  const toSessionM = await evalWait(`(() => ({ hash: location.hash, date: Views.session.state.date }))()`, (v) => !!v && v.hash === '#/session');
  assert(toSessionM && toSessionM.date === multiCourse.d, '点击当日课程计划 → 进入当天训练课页并定位到该日');
  const sesSeedM = await evaluate(`(() => {
    const mesoMic = Store.microsOf(Views.meso.state.mesoId)[0];
    const before = Store.data.sessions.filter((s) => s.date === mesoMic.startDate).length;
    Store.data.sessions.push({ id: U.uid('ses'), date: mesoMic.startDate, name: '映射测试课', type: '力量', time: '10:00', duration: 90, srpe: 7, athletes: [], rows: [], mesoId: Views.meso.state.mesoId, microId: mesoMic.id });
    Store.save();
    return { d: mesoMic.startDate, micName: mesoMic.name, micId: mesoMic.id, before };
  })()`);
  await evaluate(`location.hash = "#/session"; window.dispatchEvent(new Event("hashchange")); "ok"`);
  await sleep(700);
  await evaluate(`(() => {
    Views.session.state.date = ${JSON.stringify(sesSeedM.d)};
    Views.session.mount();
    return 'ok';
  })()`);
  await sleep(400);
  const tipInfoM = await evalWait(`(() => {
    const tip = document.querySelector('[data-micro-tip]');
    return { has: !!tip, txt: tip ? tip.textContent : '', hasMesoJump: !!document.querySelector('[data-meso-jump]') };
  })()`, (v) => !!v && v.has);
  assert(tipInfoM && tipInfoM.txt.includes('来自小周期') && tipInfoM.txt.includes(sesSeedM.micName), `训练课卡显示来自小周期映射 (${sesSeedM.micName})`);
  assert(tipInfoM && tipInfoM.txt.includes('中周期计划') && tipInfoM.hasMesoJump, '训练课卡同时映射中周期当日力量计划（可跳转）');
  // 训练课 → 中周期：点击「查看中周期」定位当日，且当日行显示小周期安排 + 训练课数（三角闭环）
  await evaluate(`document.querySelector('[data-meso-jump]').click(); 'ok'`);
  await sleep(700);
  const mesoDayRow = await evalWait(`(() => {
    const row = document.querySelector('#mesoDetail .row .chip[data-sesjump]');
    const chips = [...document.querySelectorAll('#mesoDetail .row .chip')].map((c) => c.textContent);
    return { hash: location.hash, day: Views.meso.state.day, hasSesChip: !!row, sesTxt: row ? row.textContent : '', hasMicChip: chips.some((t) => t.indexOf('小周期：') === 0) };
  })()`, (v) => !!v && v.hash === '#/meso');
  assert(mesoDayRow && mesoDayRow.day === sesSeedM.d, '训练课「查看中周期」→ 跳转中周期页定位到当日');
  assert(mesoDayRow && mesoDayRow.hasSesChip && mesoDayRow.sesTxt.includes((sesSeedM.before + 1) + ' 节训练课'), `中周期当日行显示训练课数 (${mesoDayRow && mesoDayRow.sesTxt})`);
  assert(mesoDayRow && mesoDayRow.hasMicChip, '中周期当日行显示小周期当日安排（类型/强度）');
  // 中周期 → 训练课：点击训练课数 chip 定位该日
  await evaluate(`document.querySelector('#mesoDetail [data-sesjump]').click(); 'ok'`);
  await sleep(700);
  const sesBackM = await evalWait(`(() => ({ hash: location.hash, date: Views.session.state.date }))()`, (v) => !!v && v.hash === '#/session');
  assert(sesBackM && sesBackM.date === sesSeedM.d, '中周期「N 节训练课」chip → 跳转训练课页定位该日');
  await evaluate(`document.querySelector('[data-mic-jump]').click(); 'ok'`);
  await sleep(700);
  const backMicM = await evalWait(`(() => ({ hash: location.hash, micId: Views.micro.state.microId }))()`, (v) => !!v && v.hash === '#/micro');
  assert(backMicM && backMicM.micId === sesSeedM.micId, '训练课「进入小周期」→ 跳转小周期页定位该小周期');
  // 恢复训练课页日期为今天，避免影响后续课程断言
  await evaluate(`(() => { Views.session.state.date = U.today(); return 'ok'; })()`);

  // 7.5 训练课与中周期/小周期映射：所有 session 必须有 mesoId 和 microId（demo.js 示例生成时写入）
  const sesMapped = await evaluate(`(() => {
    const ss = Store.data.sessions;
    const all = ss.every((s) => s.mesoId && s.microId);
    const match = ss.every((s) => {
      const m = Store.data.mesos.find((x) => x.id === s.mesoId);
      return m && s.date >= m.startDate && s.date <= m.endDate;
    });
    const micMatch = ss.every((s) => {
      const mi = Store.data.micros.find((x) => x.id === s.microId);
      return mi && s.date >= mi.startDate && s.date <= mi.endDate;
    });
    return { total: ss.length, all, match, micMatch };
  })()`);
  assert(sesMapped && sesMapped.all, `训练课全部含 mesoId/microId 字段（${sesMapped && sesMapped.total} 节）`);
  assert(sesMapped && sesMapped.match, '训练课 mesoId 与日期范围一致（meso.startDate ≤ session.date ≤ meso.endDate）');
  assert(sesMapped && sesMapped.micMatch, '训练课 microId 与日期范围一致（micro.startDate ≤ session.date ≤ micro.endDate）');

  // 7.6 中周期每日计划自动映射：多课程自动同步训练课 + 复制训练计划 + 力量看板（手动映射/参训名单按钮已移除）
  await evaluate('location.hash = "#/meso"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(900);
  const mapPick = await evalWait(`(() => {
    // 在所有中周期中查找一个带 planKey 会话且当日有计划动作的日期
    let found = null;
    for (const meso of Store.data.mesos) {
      const ses0 = Store.data.sessions.find((s) => s.planKey && s.mesoId === meso.id && s.date >= meso.startDate && s.date <= meso.endDate);
      if (!ses0) continue;
      const rec = (meso.days || []).find((x) => x.date === ses0.date);
      if (!rec || !Store.dayRows(rec).length) continue;
      found = { meso, ses0, rec };
      break;
    }
    if (!found) return null;
    Views.meso.state.mesoId = found.meso.id;
    Views.meso.state.microId = null; Views.meso.state.weekIdx = null;
    Views.meso.state.day = found.ses0.date;
    Views.meso.mount();
    return { date: found.ses0.date, rows: Store.dayRows(found.rec).length, ex0: (Store.exercise(Store.dayRows(found.rec)[0].exId) || {}).name || '' };
  })()`, (v) => !!v);
  assert(mapPick && mapPick.rows > 0, `中周期存在带自动映射的日期（${mapPick && mapPick.date} · ${mapPick && mapPick.rows} 动作）`);
  await sleep(500);
  const autoChk = await evaluate(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const pre = meso.id + ':' + Views.meso.state.day;
    const list = Store.data.sessions.filter((s) => s.planKey && s.planKey.indexOf(pre) === 0);
    return {
      n: list.length, ses: list[0] || null,
      noDayMap: !document.querySelector('#mesoDetail #dayMap'),
      noMapAll: !document.querySelector('#mesoDetail #mesoMapAll'),
      noDayAth: !document.querySelector('#mesoDetail #dayAth')
    };
  })()`);
  assert(autoChk && autoChk.n >= 1 && autoChk.ses && autoChk.ses.mesoId && autoChk.ses.microId, `当日计划已自动映射为训练课（${autoChk && autoChk.n} 节，含 mesoId/microId）`);
  assert(autoChk && autoChk.noDayMap && autoChk.noMapAll && autoChk.noDayAth, '已移除「映射当日训练课 / 全部映射 / 添加参训运动员」手动按钮');
  // 添加训练课：一天多课 → 新课程自动映射为训练课（planKey = mesoId:date:courseId）
  await evaluate(`(() => { const b = document.querySelector('#mesoDetail #courseAdd'); b.click(); return 'ok'; })()`);
  await sleep(600);
  const fillChk = await evaluate(`(() => {
    const blocks = document.querySelectorAll('#dayTable .course-block');
    const block = blocks[blocks.length - 1];
    if (!block || blocks.length < 2) return { ok: false, blocks: blocks.length };
    const tp = block.querySelector('[data-ctype]');
    tp.value = '技术';
    tp.dispatchEvent(new Event('change'));
    return { ok: true, blocks: blocks.length, hasDel: !!block.querySelector('[data-cdel]'), hasDayCopy: !!document.querySelector('#mesoDetail #dayCopy') };
  })()`);
  await sleep(600);
  await evaluate(`(() => {
    const blocks = document.querySelectorAll('#dayTable .course-block');
    const add = blocks[blocks.length - 1].querySelector('.ex-add');
    if (add) add.click();
    return 'ok';
  })()`);
  await sleep(500);
  await evaluate(`(() => {
    const blocks = document.querySelectorAll('#dayTable .course-block');
    const sel = blocks[blocks.length - 1].querySelector('.ex-sel');
    sel.value = Store.data.exercises[0].id;
    sel.dispatchEvent(new Event('change'));
    return 'ok';
  })()`);
  await sleep(600);
  const addSesChk = await evalWait(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const pre = meso.id + ':' + Views.meso.state.day;
    const list = Store.data.sessions.filter((s) => s.planKey && s.planKey.indexOf(pre) === 0);
    return { n: list.length, newSes: list.find((s) => s.planKey.indexOf(':mcs') > 0) || null };
  })()`, (v) => !!v && v.n >= 2);
  assert(fillChk && fillChk.ok && fillChk.blocks >= 2 && fillChk.hasDel && fillChk.hasDayCopy, `「＋ 添加训练课」新增课程块（${fillChk && fillChk.blocks} 节课）并出现「删除本课」，「复制训练计划」在日头部`);
  assert(addSesChk && addSesChk.newSes && addSesChk.newSes.name === '技术' && addSesChk.newSes.rows.length === 1, '新课程自动映射为训练课（名称/动作同步，planKey 含课程 id）');
  assert(addSesChk && addSesChk.newSes && addSesChk.newSes.fromMeso === true, '自动映射课程标注 fromMeso，备注「来自中周期」');
  // 删除课程 → 对应自动映射训练课一并移除（无实际数据）
  const delBefore = await evaluate(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const day = Views.meso.state.day;
    return { n: Store.data.sessions.filter((s) => s.planKey && s.planKey.indexOf(meso.id + ':' + day) === 0).length, courses: Store.dayCourses((meso.days || []).find((x) => x.date === day)).length };
  })()`);
  await evaluate(`(() => { const blocks = document.querySelectorAll('#dayTable .course-block'); blocks[blocks.length - 1].querySelector('[data-cdel]').click(); return 'ok'; })()`);
  await sleep(400);
  await evaluate(`(() => { const ovs = [...document.querySelectorAll('.overlay')]; const ok = ovs[ovs.length - 1] && ovs[ovs.length - 1].querySelector('[data-ok]'); if (ok) ok.click(); return 'ok'; })()`);
  await sleep(700);
  const delAfter = await evalWait(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const day = Views.meso.state.day;
    return { n: Store.data.sessions.filter((s) => s.planKey && s.planKey.indexOf(meso.id + ':' + day) === 0).length, courses: Store.dayCourses((meso.days || []).find((x) => x.date === day)).length };
  })()`, (v) => !!v);
  assert(delAfter && delAfter.courses === delBefore.courses - 1 && delAfter.n === delBefore.n - 1, `删除课程后自动映射的训练课一并移除（${delBefore && delBefore.n} → ${delAfter && delAfter.n} 节）`);
  // 复制训练计划（覆盖当日）：①选来源日期 → ②多课逐节勾选（默认全选）→ ③全部复制（含负荷%）/ 只复制计划（不含负荷%）
  const dayCopyBtn = await evaluate(`(() => ({ has: !!document.querySelector('#mesoDetail #dayCopy'), noCcopy: !document.querySelector('#dayTable [data-ccopy]') }))()`);
  assert(dayCopyBtn && dayCopyBtn.has && dayCopyBtn.noCcopy, '「复制训练计划」按钮位于日头部（课程块内旧按钮已移除）');
  // 全部复制（含负荷%）：优先选动作含 %1RM 的来源日
  const cpFullPick = await evaluate(`(() => {
    document.querySelector('#mesoDetail #dayCopy').click();
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    const sel = ov.querySelector('#cpSrc');
    if (!sel) return null;
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    let pick = null;
    for (const opt of sel.querySelectorAll('option')) {
      const rec = (meso.days || []).find((x) => x.date === opt.value);
      const rows = rec ? Store.dayRows(rec) : [];
      if (rows.some((r) => r.pct != null)) { pick = opt.value; break; }
    }
    if (!pick) pick = sel.querySelectorAll('option')[0].value;
    sel.value = pick;
    sel.dispatchEvent(new Event('change'));
    const srcRec = (meso.days || []).find((x) => x.date === pick);
    return { title: (ov.querySelector('.modal-head h3') || {}).textContent || '', src: pick, n: sel.querySelectorAll('option').length,
      srcCourses: Store.dayCourses(srcRec).length, hasCk: ov.querySelectorAll('.cpCk').length,
      srcRows: Store.dayRows(srcRec).length, srcPct: Store.dayRows(srcRec).filter((r) => r.pct != null).length };
  })()`);
  await sleep(200);
  assert(cpFullPick && cpFullPick.title === '复制训练计划（覆盖当日）' && cpFullPick.n >= 1, `复制弹窗列出本中周期可复制的日期（${cpFullPick && cpFullPick.n} 天）`);
  assert(cpFullPick && (cpFullPick.srcCourses <= 1 || cpFullPick.hasCk === cpFullPick.srcCourses), `来源日 ${cpFullPick && cpFullPick.srcCourses} 节课${cpFullPick && cpFullPick.srcCourses > 1 ? '，逐节勾选（默认全选）' : '（单节课自动跳过选择）'}`);
  await evaluate(`(() => { const ovs = [...document.querySelectorAll('.overlay')]; ovs[ovs.length - 1].querySelector('[data-cpfull]').click(); return 'ok'; })()`);
  await sleep(700);
  const cpFullChk = await evalWait(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const dayRec = (meso.days || []).find((x) => x.date === Views.meso.state.day);
    const srcRec = (meso.days || []).find((x) => x.date === ${JSON.stringify((cpFullPick && cpFullPick.src) || '')});
    return {
      n: dayRec ? Store.dayCourses(dayRec).length : -1,
      srcN: srcRec ? Store.dayCourses(srcRec).length : -1,
      rows: dayRec ? Store.dayRows(dayRec).length : -1,
      srcRows: srcRec ? Store.dayRows(srcRec).length : -1,
      pct: dayRec ? Store.dayRows(dayRec).filter((r) => r.pct != null).length : -1,
      srcPct: srcRec ? Store.dayRows(srcRec).filter((r) => r.pct != null).length : -1
    };
  })()`, (v) => !!v && v.n >= 1);
  assert(cpFullChk && cpFullChk.n === cpFullChk.srcN && cpFullChk.rows === cpFullChk.srcRows, `「全部复制（含负荷%）」来源日课程整体覆盖当日（${cpFullChk && cpFullChk.n} 节 · ${cpFullChk && cpFullChk.rows} 动作）`);
  assert(cpFullChk && cpFullChk.pct === cpFullChk.srcPct, `负荷百分比一并复制（${cpFullChk && cpFullChk.pct} 行含 %1RM）`);
  // 只复制计划（不含负荷%）：仅勾选其中一节课程
  await evaluate(`(() => { document.querySelector('#mesoDetail #dayCopy').click(); return 'ok'; })()`);
  await sleep(500);
  await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    const sel = ov.querySelector('#cpSrc');
    sel.value = ${JSON.stringify((cpFullPick && cpFullPick.src) || '')};
    sel.dispatchEvent(new Event('change'));
    ov.querySelector('#cpNone').click();
    const ck = ov.querySelectorAll('.cpCk')[0];
    if (ck) ck.checked = true;
    return 'ok';
  })()`);
  await evaluate(`(() => { const ovs = [...document.querySelectorAll('.overlay')]; ovs[ovs.length - 1].querySelector('[data-cpplan]').click(); return 'ok'; })()`);
  await sleep(700);
  const cpPlanChk = await evalWait(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const dayRec = (meso.days || []).find((x) => x.date === Views.meso.state.day);
    const srcRec = (meso.days || []).find((x) => x.date === ${JSON.stringify((cpFullPick && cpFullPick.src) || '')});
    const srcFirst = srcRec ? Store.dayCourses(srcRec)[0] : null;
    return {
      n: dayRec ? Store.dayCourses(dayRec).length : -1,
      rows: dayRec ? Store.dayRows(dayRec).length : -1,
      srcFirstRows: srcFirst ? srcFirst.rows.length : -1,
      pct: dayRec ? Store.dayRows(dayRec).filter((r) => r.pct != null).length : -1
    };
  })()`, (v) => !!v && v.n >= 1);
  assert(cpPlanChk && cpPlanChk.n === 1, `勾选其中一节复制（来源 ${cpFullPick && cpFullPick.srcCourses} 节 → 当日 ${cpPlanChk && cpPlanChk.n} 节）`);
  assert(cpPlanChk && cpPlanChk.pct === 0 && cpPlanChk.rows === cpPlanChk.srcFirstRows, '「只复制计划（不含负荷%）」动作清单保留，%1RM 全部清空');
  await evaluate(`location.hash = "#/session"; window.dispatchEvent(new Event("hashchange")); "ok"`);
  await sleep(700);
  const sesMapChk = await evalWait(`(() => {
    Views.session.state.date = ${JSON.stringify(mapPick.date)};
    Views.session.mount();
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const ses = Store.data.sessions.find((s) => s.date === ${JSON.stringify(mapPick.date)} && s.planKey && s.planKey.indexOf(meso.id + ':') === 0 && (s.note || '').indexOf('来自中周期') >= 0);
    const card = ses ? document.querySelector('[data-ses="' + ses.id + '"]') : null;
    const note = card ? card.querySelector('[data-f="note"]') : null;
    return { has: !!card, inNote: note ? note.value.indexOf('来自中周期') >= 0 : false };
  })()`, (v) => !!v && v.has);
  assert(sesMapChk && sesMapChk.inNote, '训练课页出现自动映射课程，备注标注「来自中周期」');
  // 恢复训练课页日期为今天，避免影响后续课程断言
  await evaluate(`(() => { Views.session.state.date = U.today(); return 'ok'; })()`);
  await evaluate(`location.hash = "#/micro"; window.dispatchEvent(new Event("hashchange")); "ok"`);
  await sleep(800);
  await evalWait(`(() => {
    const meso = Store.data.mesos.find((m) => m.id === Views.meso.state.mesoId);
    const mic = Store.data.micros.find((m) => m.mesoId === meso.id && U.between(${JSON.stringify(mapPick.date)}, m.startDate, m.endDate));
    if (!mic) return null;
    Views.micro.show(mic.id);
    return { ok: true };
  })()`, (v) => !!v);
  await sleep(700);
  const micNameChk = await evalWait(`(() => {
    const cell = document.querySelector('#microDetail .plan-line[data-gses="${mapPick.date}"]');
    if (!cell) return { ok: false };
    const td = cell.closest('td');
    return { ok: true, txt: td ? td.textContent : '' };
  })()`, (v) => !!v && v.ok);
  assert(micNameChk && mapPick && micNameChk.txt.indexOf(mapPick.ex0) >= 0, `小周期当日计划列显示映射的动作名称（${mapPick && mapPick.ex0}）`);
  const micStrChk = await evaluate(`(() => ({ has: !!document.querySelector('#microDetail #chMicroActual canvas') }))()`);
  assert(micStrChk && micStrChk.has, '小周期页显示「实际训练负荷与课次」看板（本小周期 · 按日）');
  await evaluate(`location.hash = "#/meso"; window.dispatchEvent(new Event("hashchange")); "ok"`);
  await sleep(800);
  const mesoStrChk = await evaluate(`(() => ({ has: !!document.querySelector('#mesoDetail #chMesoActual canvas') }))()`);
  assert(mesoStrChk && mesoStrChk.has, '中周期页显示「实际训练负荷与课次」看板（本中周期 · 按周）');
  await evaluate('location.hash = "#/macro"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(900);
  const macEditChk = await evaluate(`(() => ({ noEdit: !document.querySelector('#macEdit'), hasName: (document.querySelector('#macToolbar') || {}).textContent.indexOf('当前训练计划') >= 0 }))()`);
  assert(macEditChk && macEditChk.noEdit && macEditChk.hasName, '大周期页训练计划名称旁的 ✎ 编辑按钮已移除');

  // 8. 日期格点击标记/取消比赛日（支持多日）；新增测试日标记
  await evaluate('location.hash = "#/macro"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(1000);
  const compAdd = await evaluate(`(() => {
    const td = document.querySelector('#gridBox .pg-day:not(.out):not(.comp):not(.testday)[data-cd]');
    td.click();
    return { ds: td.dataset.cd };
  })()`);
  await sleep(300);
  await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    ov.querySelector('#mkType').value = 'comp';
    ov.querySelector('#mkName').value = '测试友谊赛';
    ov.querySelector('#mkPlace').value = '北京 · 国家体育馆';
    ov.querySelector('[data-ok]').click();
    return 'ok';
  })()`);
  await sleep(500);
  const compCheck = await evaluate(`(() => {
    const mac = Store.activeMacro();
    return {
      n: (mac.compDates || []).filter((c) => c.name === '测试友谊赛').length,
      place: ((mac.compDates.find((c) => c.name === '测试友谊赛') || {}).place) || '',
      total: (mac.compDates || []).length,
      redCells: document.querySelectorAll('#gridBox .pg-day.comp').length,
      placeRow: document.querySelector('#gridBox .pg-place') ? document.querySelector('#gridBox .pg-place').textContent : null,
      placeCells: [...document.querySelectorAll('#gridBox .pg-place')].length,
      placeHit: [...document.querySelectorAll('#gridBox .pg-place')].some((td) => td.textContent.includes('国家体育馆'))
    };
  })()`);
  assert(compAdd && compCheck.n === 1 && compCheck.place === '北京 · 国家体育馆', `比赛日弹窗含地点输入 (${compCheck.place})`);
  assert(compCheck.placeHit, '总表比赛地点行显示地点');
  assert(compCheck.total >= 5 && compCheck.redCells >= 5, `多日比赛日同时标亮 (${compCheck.total} 场 / ${compCheck.redCells} 红格)`);
  await evaluate(`(() => {
    const mac = Store.activeMacro();
    const ds = mac.compDates.find((c) => c.name === '测试友谊赛').date;
    document.querySelector('#gridBox .pg-day.comp[data-cd="' + ds + '"]').click();
    return 'ok';
  })()`);
  await sleep(300);
  await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    ovs[ovs.length - 1].querySelector('[data-ok]').click();
    return 'ok';
  })()`);
  await sleep(500);
  const compRemoved = await evaluate(`Store.activeMacro().compDates.filter((c) => c.name === '测试友谊赛').length`);
  assert(compRemoved === 0, '再次点击取消比赛日');

  // 8a. 测试日标记：弹窗类型选测试日 → 总表「测试」行 + 蓝色格 + 月历徽标；再点击移除
  const testAdd = await evaluate(`(() => {
    const td = document.querySelector('#gridBox .pg-day:not(.out):not(.comp):not(.testday)[data-cd]');
    td.click();
    return { ds: td.dataset.cd };
  })()`);
  await sleep(300);
  const testModal = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    if (!ov || !ov.querySelector('#mkType')) return { ok: false };
    const sel = ov.querySelector('#mkType');
    sel.value = 'test';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const placeHidden = ov.querySelector('#mkPlaceF').style.display === 'none';
    ov.querySelector('#mkName').value = '全队 1RM 测试';
    ov.querySelector('[data-ok]').click();
    return { ok: true, placeHidden };
  })()`);
  await sleep(500);
  // 月历视图切到测试日所在月并刷新渲染
  await evaluate(`(() => {
    const mac = Store.activeMacro();
    const t = (mac.testDates || [])[0];
    if (t) Views.macro.state.viewYM = t.date.slice(0, 7);
    return 'ok';
  })()`);
  await evaluate('location.hash = "#/session"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(500);
  await evaluate('location.hash = "#/macro"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);
  const testCheck = await evaluate(`(() => {
    const mac = Store.activeMacro();
    const t = (mac.testDates || []).find((x) => x.name === '全队 1RM 测试');
    const testRow = [...document.querySelectorAll('#gridBox .pg-lb')].some((x) => x.textContent === '测试');
    const rowHit = testRow && [...document.querySelectorAll('#gridBox .pg-test')].some((td) => td.textContent.includes('全队 1RM 测试'));
    const cell = t ? document.querySelector('#gridBox .pg-day.testday[data-cd="' + t.date + '"]') : null;
    return {
      n: (mac.testDates || []).length, rowHit,
      cellCls: !!cell,
      calBadge: !!document.querySelector('.cal-cell.testday .badge-test'),
      calBtn: [...document.querySelectorAll('.mark-btn')].some((b) => b.textContent === '取消测')
    };
  })()`);
  assert(testAdd && testModal && testModal.ok && testModal.placeHidden, '标记弹窗类型含测试日且测试日隐藏地点输入');
  assert(testCheck.n >= 1 && testCheck.rowHit, '总表新增「测试」行并显示测试名称');
  assert(testCheck.cellCls, '测试日日期格蓝色标亮');
  assert(testCheck.calBadge && testCheck.calBtn, '月历显示测试日徽标与「取消测」按钮');
  await evaluate(`(() => {
    const mac = Store.activeMacro();
    const t = mac.testDates.find((x) => x.name === '全队 1RM 测试');
    document.querySelector('#gridBox .pg-day.testday[data-cd="' + t.date + '"]').click();
    return 'ok';
  })()`);
  await sleep(300);
  await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    ovs[ovs.length - 1].querySelector('[data-ok]').click();
    return 'ok';
  })()`);
  await sleep(500);
  const testRemoved = await evaluate(`Store.activeMacro().testDates.filter((t) => t.name === '全队 1RM 测试').length`);
  assert(testRemoved === 0, '再次点击取消测试日');

  // 8b. 负荷与状态下拉含「全部」选项，可同时显示所有曲线
  await evaluate(`(() => { const s = document.querySelector('#viewSel'); s.value = 'all'; s.dispatchEvent(new Event('change')); return 'ok'; })()`);
  await sleep(500);
  const allView = await evaluate(`(() => {
    const ch = echarts.getInstanceByDom(document.querySelector('#chMain'));
    if (!ch) return null;
    const o = ch.getOption();
    const names = o.series.map((s) => s.name);
    const hasVol = names.some((n) => /训练量/.test(n));
    const hasLoad = names.some((n) => /训练负荷/.test(n));
    const hasF = names.some((n) => /能量储备/.test(n));
    const hasA = names.some((n) => /疲劳/.test(n));
    const hasForm = names.some((n) => /峰值状态/.test(n));
    const noExp = !document.querySelector('#expPeak');
    return { n: o.series.length, hasVol, hasLoad, hasF, hasA, hasForm, noExp, yAxisN: o.yAxis.length };
  })()`);
  assert(allView && allView.n === 5 && allView.hasVol && allView.hasLoad && allView.hasF && allView.hasA && allView.hasForm, '「全部」视图同时显示 5 条曲线（训练量/训练负荷/能量储备/疲劳/峰值状态）');
  assert(allView && allView.noExp, '已移除「导出 Excel」按钮');
  assert(allView && allView.yAxisN === 2, '「全部」视图使用双 Y 轴（1-10 + 状态指数）');

  // 9. 截图（周期总表区域滚动到顶部）
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'macro-grid.png'), Buffer.from(shot.result.data, 'base64'));
  await evaluate(`document.querySelector('#chartBox').scrollIntoView({ block: 'start' }); "ok"`);
  await sleep(500);
  const shotC = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'macro-charts.png'), Buffer.from(shotC.result.data, 'base64'));

  // 9b. 负荷管理：运动员姓名下拉菜单
  await evaluate('location.hash = "#/load"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(1000);
  const athInfo = await evaluate(`(() => {
    const sel = document.querySelector('#athSel');
    if (!sel) return null;
    const target = sel.options[1] ? sel.options[1].value : null;
    sel.value = target;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { count: sel.options.length, target };
  })()`);
  await sleep(700);
  const athCur = await evalWait(`(() => {
    const sel = document.querySelector('#athSel');
    if (!sel) return null;
    const a = Store.data.athletes.find((x) => x.id === sel.value);
    return { cur: sel.value, name: a ? a.name : null, kpiLen: document.querySelector('#view').innerHTML.length };
  })()`, (v) => v && v.cur === athInfo.target);
  assert(athInfo && athInfo.count >= 3, `运动员姓名下拉含 ${athInfo && athInfo.count} 名运动员`);
  assert(athCur && athCur.cur === athInfo.target && athCur.name, '切换下拉后看板跟随所选运动员');

  // 9c. 动作库 1RM 按人设定：数据层优先级 + 弹窗 + 列表标记 + 搜索 + 排课自动换算
  const rmSetup = await evaluate(`(() => {
    const ath = Store.data.athletes[0];
    const ex = Store.data.exercises.find((e) => e.name === '颈后深蹲');
    if (!ath || !ex) return null;
    Store.data.athleteRm = Store.data.athleteRm || {};
    Store.updateAthRm(ath.id, ex.id, 160, '2026-09-01', '测试录入', 'test');
    Store.save();
    return {
      per: Store.athRm(ath.id, ex.id).value,
      other: Store.athRm(Store.data.athletes[1].id, ex.id).value,
      count: Store.athRmCount(ex.id)
    };
  })()`);
  assert(rmSetup && rmSetup.per === 160 && rmSetup.other === 105, `athRm 仅取运动员专属值 (${rmSetup && rmSetup.per}/${rmSetup && rmSetup.other})`);
  assert(rmSetup && rmSetup.count === 2, `athRmCount 专属计数 (${rmSetup && rmSetup.count})`);

  await evaluate('location.hash = "#/profile"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);
  await evaluate(`(() => {
    const btn = document.querySelector('#profRmEdit');
    if (btn) btn.click();
    return 'ok';
  })()`);
  await sleep(400);
  const dlgInfo = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    if (!ov || !ov.querySelector('#rRmRows')) return null;
    const ex = Store.data.exercises.find((e) => e.name === '颈后深蹲');
    const inp = ov.querySelector('#rRmRows [data-ex="' + ex.id + '"]');
    const filled = inp ? inp.value : '';
    inp.value = '165';
    return { filled, noDefault: !ov.textContent.includes('全队默认'), hasDate: !!ov.querySelector('#rDate') };
  })()`);
  await evaluate(`(() => { const ovs = [...document.querySelectorAll('.overlay')]; ovs[ovs.length - 1].querySelector('[data-ok]').click(); return 'ok'; })()`);
  await sleep(500);
  const perAfter = await evaluate(`(() => {
    const ath = Store.data.athletes[0];
    const ex = Store.data.exercises.find((e) => e.name === '颈后深蹲');
    const per = Store.data.athleteRm[ath.id][ex.id];
    const hist = per.history[per.history.length - 1];
    return { value: per.value, date: per.date, today: U.today(), method: hist.method, mark: [...document.querySelectorAll('#profAthSel option')].some((o) => o.textContent.includes('1RM × 3')) };
  })()`);
  assert(dlgInfo && dlgInfo.noDefault && dlgInfo.hasDate && dlgInfo.filled === '160', `「记录 1RM」弹窗按动作回填专属 1RM（无全队默认，日期必选）(${dlgInfo && dlgInfo.filled})`);
  assert(perAfter && perAfter.value === 165 && perAfter.date === perAfter.today, '保存写入运动员专属 1RM（值 165，挂所选日期）');
  assert(perAfter && perAfter.mark, '运动员下拉选项显示「1RM × N」专属计数');

  await evaluate('location.hash = "#/exercises"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);

  // 一级分类可折叠：点击已选中分类收起子级（c1=null 不被自动回选），再点展开
  const fold = await evaluate(`(() => {
    const c1 = Store.data.categories1[0];
    const head = document.querySelector('[data-c1="' + c1.id + '"]');
    const expandedBefore = !!document.querySelector('[data-c2-all]');
    head.click();
    const collapsed = !document.querySelector('[data-c2-all]') && !!document.querySelector('[data-c1="' + c1.id + '"]');
    const head2 = document.querySelector('[data-c1="' + c1.id + '"]');
    head2.click();
    const expanded = !!document.querySelector('[data-c2-all]');
    return { expandedBefore, collapsed, expanded };
  })()`);
  assert(fold && fold.expandedBefore && fold.collapsed && fold.expanded, '动作库一级分类点击可折叠/展开（收起后不被自动回选）');

  const q0 = await evaluate(`document.querySelectorAll('#exList tbody tr').length`);
  await evaluate(`(() => {
    const q = document.querySelector('#exQ');
    q.value = '深蹲';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(500);
  const q1 = await evaluate(`(() => ({
    n: document.querySelectorAll('#exList tbody tr').length,
    focused: document.activeElement === document.querySelector('#exQ'),
    first: (document.querySelector('#exList tbody tr td b') || {}).textContent || ''
  }))()`);
  assert(q1 && q1.n > 0 && q1.n < q0, `搜索过滤动作列表 (${q0} → ${q1 && q1.n}，首条 ${q1 && q1.first})`);
  assert(q1 && q1.focused, '搜索后焦点保持在输入框');
  await evaluate(`(() => { const q = document.querySelector('#exQ'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()`);
  await sleep(400);

  await evaluate(`(() => {
    const ath = Store.data.athletes[0];
    const ex = Store.data.exercises.find((e) => e.name === '颈后深蹲');
    Store.data.sessions.push({
      id: U.uid('ses'), date: U.today(), name: '1RM 换算测试课', type: '力量', time: '09:00',
      duration: 90, srpe: null, athletes: [ath.id], rows: [{ exId: ex.id, pct: null, weight: null, sets: 3, reps: 8, actual: null }], note: '',
      mesoId: (Store.data.mesos.find((x) => U.today() >= x.startDate && U.today() <= x.endDate) || {}).id || null,
      microId: (Store.data.micros.find((x) => U.today() >= x.startDate && U.today() <= x.endDate) || {}).id || null
    });
    Store.save(); return 'ok';
  })()`);
  await evaluate('location.hash = "#/session"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(900);
  const calc = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card')];
    const card = cards.find((c) => c.querySelector('[data-f="name"]') && c.querySelector('[data-f="name"]').value === '1RM 换算测试课');
    if (!card) return null;
    const ext = card.querySelector('.extable');
    const tr = ext.querySelector('tbody tr');
    const hint = ext.querySelector('.tot-line .hint').textContent;
    const pct = tr.querySelector('[data-f="pct"]');
    pct.value = '50';
    pct.dispatchEvent(new Event('change', { bubbles: true }));
    return { hint };
  })()`);
  await sleep(300);
  const wVal = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card')];
    const card = cards.find((c) => c.querySelector('[data-f="name"]') && c.querySelector('[data-f="name"]').value === '1RM 换算测试课');
    const ses = Store.data.sessions.find((s) => s.id === card.dataset.ses);
    const tr = card.querySelector('.extable tbody tr');
    return { noWInput: !tr.querySelector('[data-f="weight"]'), internalW: ses.rows[0].weight, load: tr.querySelector('.ex-load').textContent.trim() };
  })()`);
  assert(calc && /1RM 内部换算/.test(calc.hint), `单人课程提示计划重量按每人 1RM 内部换算 (${calc && calc.hint})`);
  assert(wVal && wVal.noWInput && Math.abs(Number(wVal.internalW) - 82.5) < 0.001, `50% × 专属 1RM 165 内部换算 82.5kg（顶部只显示 %1RM 不显示重量）(实际 ${wVal && wVal.internalW}，负荷 ${wVal && wVal.load})`);

  // 训练课 → 中周期双向映射：训练课页面新建课程并填动作，中周期页面当日应同步显示该课程与动作
  const mesoDate = await evaluate(`(() => { const m = Store.data.mesos.find((x) => x.macroId === Store.activeMacro().id); return m ? m.startDate : null; })()`);
  if (mesoDate) {
    await evaluate(`Views.session.state.date = "${mesoDate}"; location.hash = "#/session"; window.dispatchEvent(new Event("hashchange")); "ok"`);
    await sleep(600);
    await evaluate(`(() => { document.querySelector('#sesAdd').click(); return 'ok'; })()`);
    await sleep(400);
    await evaluate(`(() => {
      const card = [...document.querySelectorAll('#sesList .card')].pop();
      if (!card) return 'no-card';
      const exAdd = card.querySelector('.ex-add');
      if (exAdd) exAdd.click();
      const sel = card.querySelector('.ex-sel');
      if (sel) {
        const opts = [...sel.options];
        const o = opts.find((x) => x.value && x.value !== '');
        if (o) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      return 'ok';
    })()`);
    await sleep(400);
    const mapCheck = await evaluate(`(() => {
      const ses = Store.data.sessions.find((s) => s.date === "${mesoDate}" && s.name === '新训练课');
      if (!ses) return { noSes: true };
      const meso = Store.data.mesos.find((m) => m.macroId === Store.activeMacro().id);
      const dayRec = (meso.days || []).find((x) => x.date === "${mesoDate}");
      const courses = Store.dayCourses(dayRec);
      const matched = courses.some((c) => (c.rows || []).length > 0);
      return {
        hasPlanKey: !!ses.planKey,
        planKeyFmt: /^[^:]+:[^:]+:[^:]+$/.test(ses.planKey || ''),
        hasMesoCourse: !!dayRec && courses.length > 0,
        rowsSynced: matched,
        rowN: matched ? courses.find((c) => c.rows.length).rows.length : 0
      };
    })()`);
    assert(mapCheck && mapCheck.hasPlanKey && mapCheck.planKeyFmt, `训练课新建即生成 planKey（${mapCheck && mapCheck.planKeyFmt}）`);
    assert(mapCheck && mapCheck.hasMesoCourse && mapCheck.rowsSynced, `训练课动作双向映射到中周期当日课程（${mapCheck && mapCheck.rowN} 动作）`);
  }

  // 9d. 运动员档案：导航入口 + 计划隔离（无项目/周期选择，名单归属当前训练计划）
  const navAth = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.id === 'profile');
    return item ? item.textContent : '';
  })()`);
  assert(/运动员档案/.test(navAth), '导航栏含「运动员档案」入口');

  await evaluate('location.hash = "#/profile"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);
  const rosterCnt = () => evaluate(`document.querySelectorAll('#profAthSel option').length`);
  const planScope = await evaluate(`(() => ({
    noSportSel: !document.querySelector('#profSport'),
    noMacroSel: !document.querySelector('#profMacro'),
    planName: !!document.querySelector('#view') && document.querySelector('#view').textContent.includes('当前训练计划')
  }))()`);
  assert(planScope && planScope.noSportSel && planScope.noMacroSel && planScope.planName, '档案页无项目/周期选择，跟随当前训练计划');
  const n1 = await rosterCnt();
  assert(n1 === 15, `当前训练计划名单 ${n1} 人（其他计划运动员不共享）`);

  // 添加运动员：无需选所属周期/项目，自动归入当前训练计划
  await evaluate(`(() => { const b = document.querySelector('#profAthAdd'); if (b) b.click(); return 'ok'; })()`);
  await sleep(400);
  const dlgAth = await evaluate(`(async () => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    const info = {
      ok: !!ov.querySelector('[data-ok]'),
      noMacroSel: !ov.querySelector('#fMacro'),
      noSportField: !ov.querySelector('input[disabled]'),
      hintPlan: true,   // 提示文字已按用户要求删除，不再断言
      hasUploader: !!ov.querySelector('#auFile') && !!ov.querySelector('#auPick') && !!ov.querySelector('#auRemove')
    };
    ov.querySelector('#fName').value = '周跳跳';
    // 注入一张 200×240 测试图片（验证自动居中裁剪压缩为正方形 dataURL）
    const blob = await new Promise((res) => {
      const c = document.createElement('canvas'); c.width = 200; c.height = 240;
      const x = c.getContext('2d'); x.fillStyle = '#3ddc97'; x.fillRect(0, 0, 200, 240);
      x.fillStyle = '#fff'; x.fillRect(60, 60, 80, 120);
      c.toBlob((b) => res(b), 'image/png');
    });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'face.png', { type: 'image/png' }));
    const inp = ov.querySelector('#auFile');
    inp.files = dt.files;
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    const preview = ov.querySelector('#auAvatar img');
    info.preview = !!(preview && /^data:image\\/jpeg/.test(preview.src));
    ov.querySelector('[data-ok]').click();
    return info;
  })()`);
  await sleep(500);
  const newAth = await evaluate(`(() => {
    const mac = Store.activeMacro();
    const a = Store.data.athletes.find((x) => x.name === '周跳跳');
    return a ? { bound: a.macroId === mac.id, sport: a.sport, avatar: a.avatar || '', barImg: !!document.querySelector('#profAthBar .avatar.has-img img') } : null;
  })()`);
  const n3 = await rosterCnt();
  assert(dlgAth && dlgAth.ok && dlgAth.noMacroSel && dlgAth.noSportField && dlgAth.hintPlan, '添加弹窗无所属周期/项目选择（自动归入当前计划）');
  assert(dlgAth && dlgAth.hasUploader && dlgAth.preview, '添加弹窗支持头像上传，选图后弹窗内即时预览（自动裁剪压缩为 JPEG）');
  assert(newAth && newAth.bound && newAth.sport === '篮球', `新运动员自动绑定当前训练计划 (${newAth && newAth.sport})`);
  assert(newAth && /^data:image\/jpeg/.test(newAth.avatar) && newAth.avatar.length < 12000 && newAth.barImg, `头像已落库（小体积 JPEG dataURL ${newAth ? newAth.avatar.length : 0} 字符）并在顶部运动员栏显示照片`);
  assert(n3 === 16, `新运动员出现在当前计划名单（${n3} 人）`);

  // 编辑弹窗：回显现有头像 → 移除 → 保存后回退姓名首字
  await evaluate(`(() => { document.querySelector('#profAthEdit').click(); return 'ok'; })()`);
  await sleep(400);
  const editAvatar = await evaluate(`(async () => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    const echo = !!ov.querySelector('#auAvatar img');
    ov.querySelector('#auRemove').click();
    await new Promise((r) => setTimeout(r, 100));
    const removedPreview = !ov.querySelector('#auAvatar img');
    ov.querySelector('[data-ok]').click();
    return { echo, removedPreview };
  })()`);
  await sleep(500);
  const afterRemove = await evaluate(`(() => {
    const a = Store.data.athletes.find((x) => x.name === '周跳跳');
    return { avatar: a ? a.avatar : null, barImg: !!document.querySelector('#profAthBar .avatar.has-img img'), initial: document.querySelector('#profAthBar .avatar').textContent.trim() };
  })()`);
  assert(editAvatar && editAvatar.echo && editAvatar.removedPreview, '编辑弹窗回显已上传头像，点移除后预览清空');
  assert(afterRemove && !afterRemove.avatar && !afterRemove.barImg && afterRemove.initial === '周', `保存后头像移除、顶部栏回退姓名首字（${afterRemove && afterRemove.initial}）`);

  await evaluate('location.hash = "#/macro"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(900);
  const kpiAth = await evaluate(`(() => {
    const html = document.querySelector('#view').innerHTML;
    return { has: html.includes('备赛运动员'), only: html.includes('仅限篮球') };
  })()`);
  assert(kpiAth && kpiAth.has && kpiAth.only, '大周期 KPI 显示备赛运动员（仅限本项目）');
  await evaluate(`(() => { const b = document.querySelector('#macAth'); if (b) b.click(); return 'ok'; })()`);
  await sleep(400);
  const macroPick = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    return {
      title: (ov.querySelector('.modal-head h3') || {}).textContent || '',
      boxes: ov.querySelectorAll('input[type=checkbox]').length,
      sports: [...new Set([...ov.querySelectorAll('.chip')].map((c) => c.textContent))]
    };
  })()`);
  assert(macroPick && /篮球/.test(macroPick.title), `参训名单弹窗标题标注项目 (${macroPick && macroPick.title})`);
  assert(macroPick && macroPick.boxes === 16 && macroPick.sports.length === 1 && macroPick.sports[0] === '篮球', `参训名单只显示当前计划运动员 (${macroPick && macroPick.boxes} 人)`);
  await evaluate(`(() => { const ovs = [...document.querySelectorAll('.overlay')]; ovs[ovs.length - 1].querySelector('.modal-x').click(); return 'ok'; })()`);

  // 中周期「添加参训运动员」按钮已移除：参训运动员改为课后在训练课页按节课选择（见训练课页参训断言）

  await evaluate('location.hash = "#/exercises"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);
  const noRm = await evaluate(`(() => ({ rm: document.querySelectorAll('#exList [data-rm]').length }))()`);
  assert(noRm && noRm.rm === 0, '动作库不再提供 1RM 设定入口（移至运动员管理）');
  await evaluate(`(() => {
    const ex = Store.data.exercises.find((e) => e.name === '颈后深蹲');
    const btn = document.querySelector('[data-edit="' + ex.id + '"]');
    if (btn) btn.click();
    return 'ok';
  })()`);
  await sleep(400);
  const exDlg = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    return { hasRm: !!ov.querySelector('#fRm'), hint: ov.textContent.includes('运动员档案') };
  })()`);
  assert(exDlg && !exDlg.hasRm && exDlg.hint, '动作编辑弹窗已移除全队默认 1RM（提示指向运动员档案）');
  await evaluate(`(() => { const ovs = [...document.querySelectorAll('.overlay')]; ovs[ovs.length - 1].querySelector('.modal-x').click(); return 'ok'; })()`);

  // 10. 导航收缩：测试管理已移除（档案页为统一体能数据源入口）
  const navTest = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.id === 'tests');
    const prof = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.id === 'profile');
    return { gone: !item, profNo: prof && prof.querySelector('.no') ? prof.querySelector('.no').textContent : '', profLbl: prof ? prof.textContent : '' };
  })()`);
  assert(navTest && navTest.gone, '导航栏已移除「测试管理」入口');
  assert(navTest && navTest.profNo === '07' && /运动员档案/.test(navTest.profLbl), '运动员档案为导航 07（统一体能数据源）');

  const seedTests = await evaluate(`(() => ({
    count: (Store.data.tests || []).length,
    hasEst: (Store.data.tests || []).some((t) => t.estimated1RM > 0),
    sources: [...new Set((Store.data.tests || []).map((t) => t.source))]
  }))()`);
  assert(seedTests && seedTests.count >= 4, `seed 含 ${seedTests && seedTests.count} 条测试记录`);
  assert(seedTests && seedTests.hasEst, '测试记录含估算 1RM 值');
  assert(seedTests && seedTests.sources.includes('test'), '测试记录 source=test');

  // 验证 Calc.estimate1RM 公式（统一弹窗与训练课共用）：100kg × 5次 × RIR=2 → 123kg
  const estCheck = await evaluate(`Calc.estimate1RM(100, 5, 2)`);
  assert(estCheck === 123, `RIR 估算公式 e1RM = 100×(1+(5+2)/30) = 123 (实际 ${estCheck})`);

  // 验证运动员专属 1RM 有 testDate 和 history
  const rmStruct = await evaluate(`(() => {
    const a = Store.data.athletes.find((x) => x.name === '陈浩');
    if (!a) return null;
    const rm = (Store.data.athleteRm || {})[a.id];
    if (!rm) return null;
    const sq = Object.keys(rm)[0];
    const rec = rm[sq];
    return { hasHistory: rec && rec.history && rec.history.length > 0, hasTestDate: rec && !!rec.testDate, value: rec ? rec.value : null };
  })()`);
  assert(rmStruct && rmStruct.hasHistory, '运动员 1RM 含历史记录');
  assert(rmStruct && rmStruct.hasTestDate, '运动员 1RM 含测试日期 testDate');

  // 11. 负荷管理页：ACWR 仪表盘 + 个人/团队切换
  await evaluate('location.hash = "#/load"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);
  const loadPage = await evaluate(`(() => {
    const html = document.querySelector('#view').innerHTML;
    return {
      hasGauge: html.includes('loadAcwrGauge') && html.includes('loadTsbGauge'),
      hasToggle: html.includes('modePersonal') && html.includes('modeTeam'),
      hasKpi: html.includes('kpis')
    };
  })()`);
  assert(loadPage && loadPage.hasGauge, '负荷管理页含 ACWR 仪表盘 gauge');
  assert(loadPage && loadPage.hasToggle, '负荷管理页含个人/团队切换按钮');

  // 切换到团队模式
  await evaluate(`(() => { const b = document.querySelector('#modeTeam'); if (b) b.click(); return 'ok'; })()`);
  await sleep(800);
  const teamPage = await evaluate(`(() => {
    const html = document.querySelector('#view').innerHTML;
    return {
      hasTeamTitle: html.includes('团队'),
      noAthSel: !document.querySelector('#athSel'),
      hint: html.includes('汇总全队'),
      metrics: document.querySelectorAll('#loadDashboard .load-metric').length,
      charts: document.querySelectorAll('#loadDashboard .chart').length
    };
  })()`);
  assert(teamPage && teamPage.hasTeamTitle, '团队模式显示团队负荷标题');
  assert(teamPage && teamPage.noAthSel && teamPage.hint, '团队模式隐藏个人下拉并显示全队汇总提示');
  assert(teamPage && teamPage.metrics === 8 && teamPage.charts === 10, `团队模式保留 8 指标 + 10 图看板（指标 ${teamPage && teamPage.metrics} / 图 ${teamPage && teamPage.charts}）`);

  // 团队课型分布饼图数据 = 筛选范围内全队已完课训练课
  const teamPie = await evaluate(`(() => {
    const chEl = document.getElementById('loadTypeChart');
    const inst = chEl ? echarts.getInstanceByDom(chEl) : null;
    const opt = inst ? inst.getOption() : null;
    const main = opt ? opt.series.find((s) => s.type === 'pie') : null;
    const today = U.today();
    const from = U.addDays(today, -41);
    const mac = Store.activeMacro();
    const ids = new Set(Store.data.athletes.filter((a) => mac && a.macroId === mac.id).map((a) => a.id));
    const n = Store.data.sessions.filter((s) => s.date >= from && s.date <= today && Store.hasCompletedLoad(s) && (s.athletes || []).some((id) => ids.has(id))).length;
    const sum = main ? main.data.reduce((t, d) => t + d.value, 0) : 0;
    return { hasChart: !!main, sum, n };
  })()`);
  assert(teamPie && teamPie.hasChart && teamPie.sum === teamPie.n && teamPie.n > 0, `团队课型饼图 = 筛选范围内全队训练课（${teamPie && teamPie.sum}/${teamPie && teamPie.n} 节）`);

  // 切回个人模式：运动员下拉恢复
  await evaluate(`(() => { const b = document.querySelector('#modePersonal'); if (b) b.click(); return 'ok'; })()`);
  await sleep(700);
  const perPage = await evaluate(`(() => {
    const sel = document.querySelector('#athSel');
    return { has: !!sel, opts: sel ? sel.options.length : 0 };
  })()`);
  assert(perPage && perPage.has && perPage.opts >= 16, `切回个人模式显示运动员下拉（${perPage && perPage.opts} 人）`);

  // 实时捕捉：停留负荷页新增今日负荷（+777 AU），看板无需切页立即重算；删除后恢复
  const live = await evaluate(`(() => {
    const read = () => {
      const v = document.querySelector('#loadDashboard .load-metric:nth-child(1) .v').textContent.replace(/[^0-9]/g, '');
      const g = echarts.getInstanceByDom(document.getElementById('loadTsbGauge'));
      const s = g.getOption().series[0];
      return { au: parseInt(v, 10), tsb: s.data[0].value, min: s.min, max: s.max };
    };
    const before = read();
    const aid = document.querySelector('#athSel').value;
    Store.data.loadEntries = Store.data.loadEntries.filter((e) => e.sessionId !== 'e2e_live_le_1');
    Store.data.loadEntries.push({ id: U.uid('le'), athleteId: aid, date: U.today(), rpe: 7, duration: 111, load: 777, source: 'session', sessionId: 'e2e_live_le_1', note: 'e2e实时' });
    Store.save();
    const after = read();
    return { before, after };
  })()`);
  assert(live && live.after.au - live.before.au === 777, `负荷页实时捕捉新增数据（AU ${live && live.before.au} → ${live && live.after.au}，差值=777，无需切页）`);
  assert(live && live.after.tsb !== live.before.tsb && live.after.min <= live.after.tsb && live.after.tsb <= live.after.max,
    `TSB 仪表盘实时联动且值落在动态量程内（TSB ${live && live.before.tsb} → ${live && live.after.tsb}，量程 ${live && live.after.min}～${live && live.after.max}）`);
  await evaluate(`(() => { Store.data.loadEntries = Store.data.loadEntries.filter((e) => e.sessionId !== 'e2e_live_le_1'); Store.save(); return 'ok'; })()`);
  const liveClean = await evaluate(`(() => parseInt(document.querySelector('#loadDashboard .load-metric:nth-child(1) .v').textContent.replace(/[^0-9]/g, ''), 10))()`);
  assert(liveClean === live.before.au, `删除实时数据后负荷看板自动恢复（AU 回到 ${liveClean}）`);

  // 周期筛选联动：选择中周期 → 日期范围联动到该中周期起止
  const cycFil = await evaluate(`(() => {
    const sel = document.querySelector('#loadMesoFilter');
    if (!sel || sel.options.length < 2) return null;
    sel.value = sel.options[1].value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const meso = Store.data.mesos.find((m) => m.id === sel.value);
    return { from: document.querySelector('#loadDateFrom').value, to: document.querySelector('#loadDateTo').value, s: meso ? meso.startDate : null, e: meso ? meso.endDate : null };
  })()`);
  await sleep(500);
  assert(cycFil && cycFil.from === cycFil.s && cycFil.to === cycFil.e, '负荷看板选择中周期联动日期范围');
  await evaluate(`(() => { const f = document.querySelector('#loadDateFrom'), t = document.querySelector('#loadDateTo'); if (f && t) { f.value = U.addDays(U.today(), -41); t.value = U.today(); f.dispatchEvent(new Event('change', { bubbles: true })); } return 'ok'; })()`);
  await sleep(500);

  // 下拉切换后保持页面滚动位置（不再跳回顶部）
  const scrollKeep = await evaluate(`(() => {
    const box = document.querySelector('#view');
    box.scrollTop = 600;
    const y0 = box.scrollTop;
    const sel = document.querySelector('#loadMesoFilter');
    if (sel) { sel.value = sel.options.length > 1 ? sel.options[1].value : 'all'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    return { y0, changed: !!sel };
  })()`);
  await sleep(400);
  const scrollAfter = await evaluate(`document.querySelector('#view').scrollTop`);
  assert(scrollKeep && scrollKeep.changed && scrollKeep.y0 > 500 && scrollAfter > 500, `下拉切换后页面保持滚动位置（${scrollKeep && scrollKeep.y0} → ${scrollAfter}）`);
  await evaluate(`(() => { const f = document.querySelector('#loadDateFrom'), t = document.querySelector('#loadDateTo'); if (f && t) { f.value = U.addDays(U.today(), -41); t.dispatchEvent(new Event('change', { bubbles: true })); } return 'ok'; })()`);
  await sleep(400);

  // 所有数据图悬停可显示该点数据：页面内每个图表都配置了 tooltip 与 trigger（直角轴=axis，仪表/饼/雷达/热力=item）
  const tipAll = await evaluate(`(() => {
    const bad = [];
    UI.charts.forEach((c) => {
      try {
        const t = c.getOption().tooltip;
        const tt = Array.isArray(t) ? t[0] : t;
        if (!tt || !tt.trigger) bad.push('missing-trigger');
      } catch (e) { bad.push('err'); }
    });
    return { n: UI.charts.length, bad: bad.slice(0, 5) };
  })()`);
  assert(tipAll && tipAll.n >= 4 && (!tipAll.bad || !tipAll.bad.length), `全部数据图悬停显示数据（${tipAll && tipAll.n} 个图表均配置 tooltip trigger，异常 ${tipAll && JSON.stringify(tipAll.bad)}）`);

  // 指标问号：点击弹出指标说明与计算方法弹窗，可关闭
  const qmCheck = await evaluate(`(() => {
    const qs = [...document.querySelectorAll('#view .qmark')];
    const q = qs.find((x) => (x.dataset.tip || '').includes('计算')) || qs[0];
    if (!q) return null;
    q.click();
    const ov = [...document.querySelectorAll('.overlay')].pop();
    const shown = !!ov && ov.textContent.includes('指标说明') && ov.textContent.includes('计算');
    const x = ov && ov.querySelector('[data-x]');
    if (x) x.click();
    return { shown, gone: !document.querySelector('.overlay') };
  })()`);
  assert(qmCheck && qmCheck.shown && qmCheck.gone, '负荷指标问号点击弹出说明与计算方法弹窗（可关闭）');

  // 指针看板配置：刻度数字外移（axisLabel distance 为正）+ 半径 72%
  const gaugeCfg = await evaluate(`(() => {
    const ac = document.querySelector('#loadAcwrGauge'), tb = document.querySelector('#loadTsbGauge');
    if (!ac || !tb) return null;
    const sa = echarts.getInstanceByDom(ac).getOption().series[0];
    const st = echarts.getInstanceByDom(tb).getOption().series[0];
    return { distA: sa.axisLabel.distance, radA: String(sa.radius), distT: st.axisLabel.distance, radT: String(st.radius) };
  })()`);
  assert(gaugeCfg && gaugeCfg.distA > 0 && gaugeCfg.distT > 0, `gauge 刻度数字在色带外（axisLabel distance ${gaugeCfg && gaugeCfg.distA}，正值=向外）`);
  assert(gaugeCfg && gaugeCfg.radA === '72%' && gaugeCfg.radT === '72%', 'ACWR / TSB 指针看板半径 72%');

  // Calc.ewma 稳态回归：恒定负荷 600 × 121 天 → CTL/ATL 末值 ≈ 600（旧错误实现会放大约 40 倍致 TSB 失真）
  const ewmaSteady = await evaluate(`(() => {
    const t = U.today();
    const series = [];
    for (let i = 120; i >= 0; i--) series.push({ date: U.addDays(t, -i), load: 600 });
    const ctl = Calc.ewma(series, 42), atl = Calc.ewma(series, 7);
    return { ctl: ctl[ctl.length - 1].value, atl: atl[atl.length - 1].value };
  })()`);
  assert(ewmaSteady && Math.abs(ewmaSteady.ctl - 600) <= 30 && Math.abs(ewmaSteady.atl - 600) <= 30, `EWMA 稳态收敛于输入负荷（CTL ${ewmaSteady && Math.round(ewmaSteady.ctl)} / ATL ${ewmaSteady && Math.round(ewmaSteady.atl)} ≈ 600，TSB 不再失真）`);

  // 11.5 嵌入式页面：KPI 页「自定义 KPI 分析」工作台（Views.kpiLab）
  // 11.5a 自定义 KPI 分析工作台：筛选（姓名/项目/日期/方法）→ 多选方法逐个生成看板（图型选择+推荐）→ 解读/算法/数据表 → 追加/移除/切图
  await evaluate('location.hash = "#/kpi"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);
  const labBtn = await evaluate(`(() => {
    const btn = document.querySelector('#kpiReport');
    if (!btn) return { hasBtn: false };
    return { hasBtn: true, text: btn.textContent.trim() };
  })()`);
  assert(labBtn && labBtn.hasBtn, 'KPI 页含「自定义 KPI 分析」按钮');
  assert(labBtn && labBtn.text === '自定义 KPI 分析', '按钮文案为「自定义 KPI 分析」');

  // 打开工作台：筛选区默认值
  await evaluate(`document.querySelector('#kpiReport').click(); 'ok'`);
  await sleep(600);
  const labOpen = await evaluate(`(() => {
    const w = document.querySelector('#kpiLabWrap');
    if (!w) return { open: false };
    return {
      open: true,
      title: w.querySelector('.kl-top b').textContent.includes('自定义 KPI 分析'),
      aths: w.querySelectorAll('#klAths .chip').length,
      athOn: w.querySelectorAll('#klAths .chip.on').length,
      mets: w.querySelectorAll('#klMetrics [data-met]').length,
      metOn: w.querySelectorAll('#klMetrics [data-met].on').length,
      methods: w.querySelectorAll('#klMethods [data-mth]').length,
      dates: !!w.querySelector('#klFrom') && !!w.querySelector('#klTo'),
      quick: w.querySelectorAll('#klQuick [data-q]').length,
      gen: !!w.querySelector('#klGen'),
      athList: [...w.querySelectorAll('#klAths .chip')].slice(0, 12).map((c) => c.textContent + (c.classList.contains('on') ? ':1' : ':0')),
      saved: (Store.data.settings || {}).kpiLabPanels ? Store.data.settings.kpiLabPanels.length : 0
    };
  })()`);
  assert(labOpen && labOpen.open && labOpen.title, '点击按钮打开自定义 KPI 分析工作台（全屏浮层 + 标题）');
  assert(labOpen && labOpen.aths >= 1 && labOpen.athOn === labOpen.aths, '姓名筛选 chips 默认全选');
  assert(labOpen && labOpen.mets >= 3 && labOpen.metOn >= 1, '测试项目 chips 分组展示且默认预选力量指标');
  assert(labOpen && labOpen.methods === 14, '分析方法库共 14 种方法');
  assert(labOpen && labOpen.dates && labOpen.quick === 4, '日期范围筛选含起止日期 + 全部/近90/近28/近7 快捷');
  assert(labOpen && labOpen.gen, '含「生成看板」按钮');

  // 方法 ⓘ → 算法说明弹窗（含公式）并可关闭
  const algoM = await evaluate(`(() => {
    const w = document.querySelector('#kpiLabWrap');
    w.querySelector('#klMethods [data-minfo]').click();
    const ov = [...document.querySelectorAll('.overlay')].pop();
    const ok = !!ov && ov.querySelector('.modal-head h3').textContent.includes('算法说明') && ov.querySelector('.modal-body').textContent.includes('基线值');
    if (ov) ov.querySelector('[data-x]').click();
    return ok;
  })()`);
  await sleep(300);
  assert(algoM, '方法 ⓘ 弹出算法说明弹窗（含计算公式）并可关闭');

  // 选 2 种方法（基线对比 + 综合排名）→ 补选体能指标 CMJ（seed 的 1RM 多负荷测试同日，需多日期指标才能算基线）→ 生成 → 图型选择弹窗（推荐置顶）
  const pick1 = await evaluate(`(() => {
    window.__klT = [];
    if (!window.__klTWatch) {
      window.__klTWatch = true;
      new MutationObserver((ms) => ms.forEach((m) => [...m.addedNodes].forEach((n) => { if (n.nodeType === 1 && n.classList && n.classList.contains('toast')) window.__klT.push(n.textContent); }))).observe(document.body, { childList: true, subtree: true });
    }
    const w = document.querySelector('#kpiLabWrap');
    w.querySelector('#klMetrics [data-met="cmj"]').click();
    w.querySelector('#klMethods [data-mth="delta"]').click();
    w.querySelector('#klMethods [data-mth="rank"]').click();
    w.querySelector('#klGen').click();
    const ov = [...document.querySelectorAll('.overlay')].pop();
    return ov ? { dialog: ov.querySelector('.modal-head h3').textContent.includes('选择图型'), cts: ov.querySelectorAll('.kl-ct').length, rec: ov.querySelectorAll('.kl-ct.rec').length, recFirst: ov.querySelector('.kl-ct') && ov.querySelector('.kl-ct').classList.contains('rec') } : { dialog: false };
  })()`);
  await sleep(400);
  assert(pick1 && pick1.dialog, '生成看板弹出「选择图型」对话框（逐方法选择）');
  assert(pick1 && pick1.cts >= 3 && pick1.rec === 1 && pick1.recFirst, '图型候选含★系统推荐且推荐项置顶');

  // 依次选推荐图型（方法 1 → 方法 2）：点卡片选中 + 点确认
  await evaluate(`(() => { const ov = [...document.querySelectorAll('.overlay')].pop(); (ov.querySelector('.kl-ct.rec') || ov.querySelector('.kl-ct')).click(); ov.querySelector('[data-ok]').click(); return 'ok'; })()`);
  await sleep(500);
  const pick2 = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    const r = { ovs: ovs.length, titles: ovs.map((o) => { const h = o.querySelector('.modal-head h3'); return h ? h.textContent : '?'; }), toasts: (window.__klT || []).slice(-4) };
    if (!ov || !ov.querySelector('.kl-ct')) { r.dialog = false; return r; }
    (ov.querySelector('.kl-ct.rec') || ov.querySelector('.kl-ct')).click();
    ov.querySelector('[data-ok]').click();
    r.dialog = true;
    return r;
  })()`);
  await sleep(700);
  assert(pick2 && pick2.dialog, '多方法时逐个弹出图型选择（第 2/2）' + JSON.stringify(pick2 || {}));

  const panel1 = await evaluate(`(() => {
    const w = document.querySelector('#kpiLabWrap');
    const panels = w.querySelectorAll('.kl-panel');
    return {
      n: panels.length,
      pms: [...panels].map((p) => { const b = p.querySelector('.kl-phead b'); return b ? b.textContent : '?'; }),
      toasts: (window.__klT || []).slice(-6),
      canvas1: !!panels[0] && !!panels[0].querySelector('.kl-canvas canvas'),
      insight: !!panels[0] && panels[0].querySelector('.kl-insight div').textContent.length > 10,
      algo: !!panels[0] && panels[0].querySelector('.kl-algo pre').textContent.includes('Δ%'),
      tbl: !!panels[0] && panels[0].querySelectorAll('.kl-tbl td').length > 0,
      ctsel: !!panels[0] && !!panels[0].querySelector('[data-kpct]'),
      del: !!panels[0] && !!panels[0].querySelector('[data-kpdel]')
    };
  })()`);
  assert(panel1 && panel1.n === 2, '两个方法各生成一个看板（共 2 个）');
  assert(panel1 && panel1.canvas1, '看板含 ECharts canvas');
  assert(panel1 && panel1.insight, '看板含「结果解读」动态分析文本');
  assert(panel1 && panel1.algo, '看板含「算法与标注解释」（含 Δ% 公式）');
  assert(panel1 && panel1.tbl, '看板含数据表');
  assert(panel1 && panel1.ctsel && panel1.del, '看板头部含图型切换下拉与 ✕ 移除按钮');

  // 切换第一个面板图型 → 重绘
  await evaluate(`(() => {
    const sel = document.querySelector('#klPanels [data-kpct]');
    const opt = [...sel.options].find((o) => o.value !== sel.value);
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change'));
    return 'ok';
  })()`);
  await sleep(700);
  const sw2 = await evaluate(`(() => {
    const p = document.querySelector('#klPanels .kl-panel');
    return { still: !!p && !!p.querySelector('.kl-canvas canvas'), val: p.querySelector('[data-kpct]').value };
  })()`);
  assert(sw2 && sw2.still && sw2.val !== 'bar', '切换图型后看板重绘正常');

  // 生成看板后可继续追加新方法（Z 分数）→ 共 3 个
  await evaluate(`(() => { const w = document.querySelector('#kpiLabWrap'); w.querySelector('#klMethods [data-mth="zscore"]').click(); w.querySelector('#klGen').click(); return 'ok'; })()`);
  await sleep(400);
  const pick3 = await evaluate(`(() => { const ov = [...document.querySelectorAll('.overlay')].pop(); if (!ov || !ov.querySelector('.kl-ct')) return { d: false }; (ov.querySelector('.kl-ct.rec') || ov.querySelector('.kl-ct')).click(); ov.querySelector('[data-ok]').click(); return { d: true }; })()`);
  await sleep(700);
  assert(pick3 && pick3.d, '已生成看板后可继续追加新方法（图型弹窗 1/1）');
  const panelN = await evaluate(`({ n: document.querySelectorAll('#klPanels .kl-panel').length, toasts: (window.__klT || []).slice(-8) })`);
  assert(panelN === 3 || (panelN && panelN.n === 3), '追加后共 3 个看板' + JSON.stringify(panelN || {}));

  // 移除一个面板
  await evaluate(`document.querySelector('#klPanels [data-kpdel]').click(); 'ok'`);
  await sleep(400);
  const afterKpDel = await evaluate(`document.querySelectorAll('#klPanels .kl-panel').length`);
  assert(afterKpDel === 2, '移除看板后剩余 2 个');

  // 工作台「返回」：无浮层残留、KPI 页图表重挂载
  await evaluate(`document.querySelector('#klClose').click(); 'ok'`);
  await sleep(800);
  const backKpi = await evaluate(`location.hash === '#/kpi' && !document.querySelector('#kpiLabWrap') && !document.querySelector('.overlay') && !!document.querySelector('#kpiReport') && !!document.querySelector('#view canvas')`);
  assert(backKpi, '工作台「返回」正常回到 KPI 页（无残留 + 图表重挂载）');

  // 12. 运动员档案：跟随当前训练计划（无所属周期筛选，名单自动按计划隔离）
  await evaluate('location.hash = "#/profile"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);
  const macroFilter = await evaluate(`(() => ({
    gone: !document.querySelector('#profMacro'),
    planCard: document.querySelector('#view') ? document.querySelector('#view').textContent.includes('当前训练计划') : false
  }))()`);
  assert(macroFilter && macroFilter.gone && macroFilter.planCard, '档案页已移除所属周期筛选，名单自动跟随当前训练计划');

  const athMacroField = await evaluate(`(() => {
    const a = Store.data.athletes.find((x) => x.name === '陈浩');
    return a ? { hasMacro: !!a.macroId, macroId: a.macroId } : null;
  })()`);
  assert(athMacroField && athMacroField.hasMacro, 'seed 运动员含 macroId 所属周期字段');

  // 13. 训练课：每人结果表含 实际重量/实际完成/RIR；sRPE 按人；自动估算 1RM
  await evaluate('location.hash = "#/session"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);
  // 跳转到含 3 人力量课的日期（seed 力量课含每人结果演示数据）
  const dForce = await evaluate(`(() => {
    const s = Store.data.sessions.find((x) => (x.athletes || []).length >= 3 && (x.rows || []).some((r) => r.pct));
    if (!s) return null;
    const pick = document.querySelector('#dPick');
    pick.value = s.date;
    pick.dispatchEvent(new Event('change', { bubbles: true }));
    return s.date;
  })()`);
  await sleep(800);
  const resTbl = await evalWait(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    const card = cards.find((c) => c.querySelectorAll('[data-srpe]').length >= 3 && c.querySelector('[data-ra]') && c.querySelector('[data-table] .ex-pct'));
    if (!card) {
      const dPick = document.querySelector('#dPick');
      return { _diag: { nCards: cards.length, pick: dPick && dPick.value,
        cards: cards.map((c) => ({ srpe: c.querySelectorAll('[data-srpe]').length, ra: c.querySelectorAll('[data-ra]').length, rs: c.querySelectorAll('[data-rs]').length, name: (c.querySelector('[data-f="name"]') || {}).value })) } };
    }
    const html = card.innerHTML;
    return {
      hasW: html.includes('实际重量'), hasA: html.includes('单组量'), hasSets: html.includes('组数'), hasR: html.includes('RIR'),
      srpeSliders: card.querySelectorAll('[data-srpe]').length,
      resInputs: card.querySelectorAll('[data-ra]').length,
      setInputs: card.querySelectorAll('[data-rs]').length,
      planNoActual: !card.querySelector('[data-table] [data-f="actual"]'),
      planNoWeight: !card.querySelector('[data-table] [data-f="weight"]') && !!card.querySelector('[data-table] .ex-pct'),
      hasUpBtn: !!card.querySelector('[data-uprm]')
    };
  })()`, (v) => v && !v._diag, 8000);
  assert(resTbl && !resTbl._diag, '团队力量课卡片渲染（诊断：' + (resTbl && resTbl._diag ? JSON.stringify(resTbl._diag) : 'null') + '）');
  assert(resTbl && resTbl.hasW && resTbl.hasA && resTbl.hasSets && resTbl.hasR, '训练课每人动作含 实际重量/组数/单组量/RIR');
  assert(resTbl && resTbl.planNoActual, '训练课计划表为计划模式（实际数据移至每人结果表）');
  assert(resTbl && resTbl.planNoWeight, '训练课顶部计划表只显示 %1RM 不显示重量（重量按每人 1RM 内部换算）');
  assert(resTbl && resTbl.srpeSliders >= 3 && resTbl.resInputs >= 3 && resTbl.setInputs >= 3, `sRPE 按人设定（${resTbl && resTbl.srpeSliders} 个滑杆 · ${resTbl && resTbl.resInputs} 行单组量 · ${resTbl && resTbl.setInputs} 行组数）`);

  const sesCheck = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    const card = cards.find((c) => c.querySelectorAll('[data-srpe]').length >= 3 && c.querySelector('[data-ra]') && c.querySelector('[data-table] .ex-pct'));
    if (!card) return null;
    const ses = Store.data.sessions.find((s) => s.id === card.dataset.ses);
    if (!ses || !(ses.athletes || []).length || !ses.rows.length) return null;
    const aid = ses.athletes[0];
    const row = ses.rows[0];
    const before = (Store.athRm(aid, row.exId) || {}).value || null;
    // sRPE 按人：滑杆 → 8 → loadEntries 同步
    const slider = card.querySelector('[data-srpe="' + aid + '"]');
    slider.value = '8';
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    const entry = Store.data.loadEntries.find((e) => e.sessionId === ses.id && e.athleteId === aid);
    const srpeOk = (ses.athSrpe || {})[aid] === 8 && entry && entry.rpe === 8 && entry.load === Math.round(8 * ses.duration);
    // 每人结果：实际重量 100 × 实际 4 组 × 单组 3 次 × RIR 1 → 估算 1RM 按单组次数 = 100×(1+4/30)
    const tr = card.querySelector('[data-ra]').closest('tr');
    const rw = tr.querySelector('[data-rw]'), rs2 = tr.querySelector('[data-rs]'), ra = tr.querySelector('[data-ra]'), rr = tr.querySelector('[data-rr]');
    rw.value = '100'; rw.dispatchEvent(new Event('change', { bubbles: true }));
    rs2.value = '4'; rs2.dispatchEvent(new Event('change', { bubbles: true }));
    ra.value = '3'; ra.dispatchEvent(new Event('change', { bubbles: true }));
    rr.value = '1'; rr.dispatchEvent(new Event('change', { bubbles: true }));
    const after = (Store.athRm(aid, row.exId) || {}).value;
    const recA = Store.data.athleteRm[aid] && Store.data.athleteRm[aid][row.exId];
    const last = recA && recA.history && recA.history.length ? recA.history[recA.history.length - 1] : null;
    const dose0 = (() => { const rr0 = (ses.results[aid] || [])[0] || {}; const d = Calc.actualRowDose(row, rr0); const w0 = rr0.w; return { reps: d.total, kg: (Number(w0) || 0) * d.total }; })();
    return { srpeOk, before, after, expect: Calc.estimate1RM(100, 3, 1),
      keepBase: before == null ? (after === Calc.estimate1RM(100, 3, 1)) : (after === before),
      lastIsEst: !!last && last.value === Calc.estimate1RM(100, 3, 1) && last.source === 'session',
      hasHist: !!(recA && recA.history && recA.history.length),
      rowReps: dose0.reps, rowKg: dose0.kg, doseOk: dose0.reps === 12 && dose0.kg === 1200 };
  })()`);
  assert(sesCheck && sesCheck.srpeOk, 'sRPE 按运动员写入并同步负荷记录');
  assert(sesCheck && sesCheck.doseOk, `实际总剂量 = 实际组数 × 单组量（4 组 × 3 次 = 12 次，吨位 100×12 = 1,200 kg；实际 ${sesCheck && sesCheck.rowReps} 次 / ${sesCheck && sesCheck.rowKg} kg）`);
  assert(sesCheck && sesCheck.keepBase && sesCheck.lastIsEst && sesCheck.hasHist, `自动估算 1RM 按单组次数追加为最新记录、不覆盖基准（基准 ${sesCheck && sesCheck.before == null ? '新建' : sesCheck && sesCheck.before}kg，最新记录 ${sesCheck && sesCheck.expect}kg 来源=训练课）`);

  // 「更新1RM」按钮：显式点击把本次估算提升为生效 1RM（下次训练按此值计划重量），同时追加为最新历史记录；同课同动作测试记录去重
  const uprmCheck = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    const card = cards.find((c) => c.querySelectorAll('[data-srpe]').length >= 3 && c.querySelector('[data-ra]') && c.querySelector('[data-table] .ex-pct'));
    if (!card) return null;
    const btn = card.querySelector('[data-uprm]');
    if (!btn) return { hasBtn: false };
    const ses = Store.data.sessions.find((s) => s.id === card.dataset.ses);
    const [aid, idxStr] = btn.dataset.uprm.split(':');
    const i = Number(idxStr);
    const row = ses.rows[i];
    const rs = (ses.results[aid] || [])[i] || {};
    const expect = Calc.estimate1RM(rs.w, rs.actual, rs.rir != null ? rs.rir : 0);
    const recB = ((Store.data.athleteRm || {})[aid] || {})[row.exId];
    const beforeV = recB ? recB.value : null;
    const histLenB = recB && recB.history ? recB.history.length : 0;
    const cnt = (t) => (Store.data.tests || []).filter((x) => x.source === 'session' && x.athleteId === aid && x.exerciseId === row.exId && (x.sessionId ? x.sessionId === ses.id : x.date === ses.date)).length;
    const testsBefore = cnt();
    btn.click();
    const rec = Store.data.athleteRm[aid][row.exId];
    const last = rec.history && rec.history.length ? rec.history[rec.history.length - 1] : null;
    const liveRm = Store.athRm(aid, row.exId);
    return {
      hasBtn: true, expect, beforeV, testsBefore, testsAfter: cnt(),
      promoted: rec.value === expect && rec.date === ses.date && liveRm.value === expect,
      accum: !!last && last.value === expect && last.source === 'session',
      noDupHist: rec.history.length === histLenB + (histLenB && recB.history[histLenB - 1].value === expect && recB.history[histLenB - 1].source === 'session' ? 0 : 1),
      hasHistory: !!(rec && rec.history && rec.history.length)
    };
  })()`);
  assert(uprmCheck && uprmCheck.hasBtn, '每人结果表估算 1RM 后含「更新1RM」按钮');
  assert(uprmCheck && uprmCheck.promoted && uprmCheck.accum && uprmCheck.noDupHist, `点击「更新1RM」后估算提升为生效 1RM（${uprmCheck && uprmCheck.beforeV}kg → ${uprmCheck && uprmCheck.expect}kg，下次训练按新值计划重量），历史不重复追加`);
  assert(uprmCheck && uprmCheck.testsAfter <= uprmCheck.testsBefore && uprmCheck.hasHistory, '更新 1RM 保留历史记录且同课同动作测试记录去重');

  // 估算1RM：仅完成实际训练的行才显示「估算值+更新1RM」组合框；填写后实时刷新（每次修改会重渲染，需重新查询节点）
  const estLiveChk = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    const card = cards.find((c) => c.querySelectorAll('[data-srpe]').length >= 3 && c.querySelector('[data-ra]') && c.querySelector('[data-table] .ex-pct'));
    if (!card) return null;
    const sesId = card.dataset.ses;
    const key = card.querySelector('[data-ra]').dataset.ra;    // "aid:i"
    const q = () => {
      const c = document.querySelector('.card[data-ses="' + sesId + '"]');
      const t = c && c.querySelector('[data-ra="' + key + '"]');
      const cell = c && c.querySelector('[data-est="' + key + '"]');
      return { c, tr: t && t.closest('tr'), span: cell && cell.querySelector('[data-estv]'), box: cell && cell.querySelector('.est-box'), btn: cell && cell.querySelector('[data-uprm]') };
    };
    // 未完成行不显示组合框：另找一行该运动员未录入任何真实数据的（距离/时间行，或无实际重量也无计划重量的 kg 行）
    const ses0 = Store.data.sessions.find((s) => s.id === sesId);
    const aid0 = key.split(':')[0];
    const res0 = ses0.results[aid0] || [];
    const noActualIdx = ses0.rows.findIndex((r, i2) => {
      const x = res0[i2] || {};
      if (x.actualOwn || x.setsOwn || x.w != null || x.rir != null) return false;
      if (Calc.metricOf(r) !== 'reps') return true;
      const rm = Store.athRm(aid0, r.exId);
      const pw = rm && r.pct ? Calc.weightFromPct(rm.value, r.pct) : r.weight;
      return !pw;
    });
    const cell0 = noActualIdx >= 0 ? q().c.querySelector('[data-est="' + aid0 + ':' + noActualIdx + '"]') : null;
    const hiddenOk = noActualIdx < 0 || (cell0 && !cell0.querySelector('[data-uprm]') && !cell0.querySelector('[data-estv]'));
    let cur = q();
    const v1 = cur.span ? cur.span.textContent : null;      // 已填 100kg × 3 次 × RIR1 → 113
    const e1 = U.fmt(Calc.estimate1RM(100, 3, 1)) + ' kg';
    cur.tr.querySelector('[data-rr]').value = '3';
    cur.tr.querySelector('[data-rr]').dispatchEvent(new Event('change', { bubbles: true }));
    cur = q();
    const v2 = cur.span ? cur.span.textContent : null;      // 100×(1+6/30) → 120
    const e2 = U.fmt(Calc.estimate1RM(100, 3, 3)) + ' kg';
    cur.tr.querySelector('[data-rw]').value = '80';
    cur.tr.querySelector('[data-rw]').dispatchEvent(new Event('change', { bubbles: true }));
    cur = q();
    const v3 = cur.span ? cur.span.textContent : null;      // 80×(1+6/30) → 96
    const e3 = U.fmt(Calc.estimate1RM(80, 3, 3)) + ' kg';
    return { v1, e1, v2, e2, v3, e3, hiddenOk, boxed: !!(cur.box && cur.btn && cur.box.contains(cur.span) && cur.box.contains(cur.btn)) };
  })()`);
  assert(estLiveChk && estLiveChk.v1 === estLiveChk.e1 && estLiveChk.v2 === estLiveChk.e2 && estLiveChk.v3 === estLiveChk.e3, `估算1RM 随输入实时刷新（${estLiveChk && estLiveChk.v1} → 改RIR ${estLiveChk && estLiveChk.v2} → 改重量 ${estLiveChk && estLiveChk.v3}）`);
  assert(estLiveChk && estLiveChk.hiddenOk, '未填单组量的行不显示估算1RM与更新按钮');
  assert(estLiveChk && estLiveChk.boxed, '估算1RM 与「更新1RM」按钮合并在同一组合框内');

  // 1RM 公式适用范围：单组次数+RIR > 12（如把多组总次数 34 填进单组量）不给出估算与更新按钮，提示重测
  const rmRange = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    const card = cards.find((c) => c.querySelectorAll('[data-srpe]').length >= 3 && c.querySelector('[data-ra]') && c.querySelector('[data-table] .ex-pct'));
    if (!card) return null;
    const ses = Store.data.sessions.find((s) => s.id === card.dataset.ses);
    const key = card.querySelector('[data-ra]').dataset.ra;
    const [aid, idx] = key.split(':');
    const setRa = (v) => {
      const inp = document.querySelector('.card[data-ses="' + ses.id + '"] [data-ra="' + key + '"]');
      inp.value = String(v); inp.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setRa(15);
    let c = document.querySelector('.card[data-ses="' + ses.id + '"]');
    const cell = c.querySelector('[data-est="' + key + '"]');
    const over = { noBtn: !cell.querySelector('[data-uprm]'), noVal: !cell.querySelector('[data-estv]'), hint: cell.textContent.includes('单组次数过高') };
    const saved = Store.data.tests.filter((t) => t.source === 'session' && t.sessionId === ses.id && t.athleteId === aid && t.reps === 15).length;
    setRa(3);   // 恢复单组 3 次
    c = document.querySelector('.card[data-ses="' + ses.id + '"]');
    const back = !!c.querySelector('[data-uprm]') && c.querySelector('[data-estv]').textContent === U.fmt(Calc.estimate1RM(80, 3, 3)) + ' kg';
    // 计划表团队吨位：参训者有 1RM 的 kg 行按 %1RM 汇总（不再用次数冒充负荷）
    const tot = c.querySelector('[data-table] .tot-line').textContent;
    return { over, noTestSaved: saved === 0, back, tot, teamTon: /计划吨位/.test(tot) && /人有1RM/.test(tot) };
  })()`);
  assert(rmRange && rmRange.over.noBtn && rmRange.over.noVal && rmRange.over.hint, '单组次数+RIR > 12 超出 Epley 公式适用范围：不显示估算值/更新按钮并提示重测（防止总次数误填导致高估）');
  assert(rmRange && rmRange.noTestSaved, '超范围单组次数不写入测试记录与 1RM 历史');
  assert(rmRange && rmRange.back, '改回 ≤12 次单组量后估算与更新按钮恢复');
  assert(rmRange && rmRange.teamTon, `计划表按团队 1RM 汇总吨位（${(rmRange && rmRange.tot.match(/计划吨位[^，。]*/) || [''])[0]}）`);

  // 同课反复修改只留一条历史；负重量被拒、负 RIR 按 0 处理（手输可绕过输入框 min）
  const rmHarden = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    const card = cards.find((c) => c.querySelectorAll('[data-srpe]').length >= 3 && c.querySelector('[data-ra]') && c.querySelector('[data-table] .ex-pct'));
    if (!card) return null;
    const ses = Store.data.sessions.find((s) => s.id === card.dataset.ses);
    const key = card.querySelector('[data-ra]').dataset.ra;
    const [aid, idxStr] = key.split(':');
    const exId = ses.rows[Number(idxStr)].exId;
    const setF = (attr, v) => { const inp = document.querySelector('.card[data-ses="' + ses.id + '"] [' + attr + '="' + key + '"]'); inp.value = String(v); inp.dispatchEvent(new Event('change', { bubbles: true })); };
    setF('data-rr', 0); setF('data-rw', 80); setF('data-ra', 3);
    const countSid = () => Store.athRmHistory(aid, exId).filter((h) => h.sid === ses.id).length;
    const n1 = countSid();
    setF('data-ra', 5); setF('data-rw', 85); setF('data-rr', 1);
    const n2 = countSid();
    const last = Store.athRmHistory(aid, exId).slice(-1)[0];
    setF('data-rr', -9);
    const cell = document.querySelector('.card[data-ses="' + ses.id + '"] [data-est="' + key + '"]');
    const negRirText = cell.querySelector('[data-estv]') ? cell.querySelector('[data-estv]').textContent : null;
    setF('data-rr', 1);
    return { n1, n2, lastVal: last && last.value, expect: Calc.estimate1RM(85, 5, 1),
      negW: Calc.estimate1RM(-50, 5), negR: Calc.estimate1RM(100, -3),
      negRirText, expectNeg: U.fmt(Calc.estimate1RM(85, 5, 0)) + ' kg' };
  })()`);
  assert(rmHarden && rmHarden.n1 === 1 && rmHarden.n2 === 1 && rmHarden.lastVal === rmHarden.expect,
    `同一节课同一动作的 1RM 历史只保留最新一条（连改 3 次仍为 1 条，值=${rmHarden && rmHarden.lastVal}）`);
  assert(rmHarden && rmHarden.negW === null && rmHarden.negR === null, '负重量/负次数不产生 1RM 估算值');
  assert(rmHarden && rmHarden.negRirText === rmHarden.expectNeg, `负 RIR 按 0 处理而非拉低估算（${rmHarden && rmHarden.negRirText}）`);

  // 「更新1RM」→ 1RM 力量档案可见：档案含该动作该日期的训练课来源记录
  const archFlow = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    const card = cards.find((c) => c.querySelectorAll('[data-srpe]').length >= 3 && c.querySelector('[data-ra]') && c.querySelector('[data-table] .ex-pct'));
    if (!card) return null;
    const ses = Store.data.sessions.find((s) => s.id === card.dataset.ses);
    const btn = card.querySelector('[data-uprm]');
    const [aid, idxStr] = btn.dataset.uprm.split(':');
    const exId = ses.rows[Number(idxStr)].exId;
    const hist = Store.athRmHistory(aid, exId);
    const last = hist.length ? hist[hist.length - 1] : null;
    // 切到档案页选中该运动员
    location.hash = '#/profile';
    window.dispatchEvent(new Event('hashchange'));
    const sel = document.querySelector('#profAthSel');
    if (!sel || ![...sel.options].some((o) => o.value === aid)) return { noRoster: true };
    sel.value = aid; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const arch = document.querySelector('#profRmCard');
    const rows = arch ? [...arch.querySelectorAll('tbody tr')] : [];
    const hit = rows.find((tr) => tr.cells[2] && tr.cells[2].textContent.trim() === U.md(last.date) && tr.cells[1].textContent.includes(String(last.value)));
    const dateOpts = [...document.querySelectorAll('#rmDateSel option')].map((o) => o.value);
    // 返回训练课页，恢复上下文
    location.hash = '#/session';
    window.dispatchEvent(new Event('hashchange'));
    return { hasArch: !!arch, hit: !!hit, lastDate: last && last.date, lastVal: last && last.value, dateInOpts: dateOpts.includes(last && last.date) };
  })()`);
  await sleep(700);
  assert(archFlow && archFlow.hasArch && archFlow.hit && archFlow.dateInOpts, `「更新1RM」后 1RM 力量档案可见该记录（${archFlow && archFlow.lastDate} · ${archFlow && archFlow.lastVal}kg，日期下拉含该日期）`);

  // 13b. 折叠 / 每人总负荷 / 开始-结束训练
  // 折叠：同日多课时默认首课展开、其余折叠；点折叠/展开可切换（视图态）
  const foldCheck = await evaluate(`(() => {
    let cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    if (cards.length < 2) {
      const ses = Store.data.sessions.find((s) => s.id === cards[0].dataset.ses);
      const cp = U.deepClone(ses); cp.id = U.uid('ses'); cp.name = ses.name + '（副本）'; cp.sStatus = null;
      Store.data.sessions.push(cp); Store.save();
      Views.session.mount();
    }
    cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    const first = cards[0], second = cards[1];
    const hidden = (c) => { const b = c.querySelector('[data-body]'); return b && getComputedStyle(b).display === 'none'; };
    const r = { n: cards.length, firstOpen: !hidden(first), secondFolded: hidden(second) };
    first.querySelector('[data-act="fold"]').click();
    r.afterFold = hidden(first);
    first.querySelector('[data-act="fold"]').click();
    r.afterUnfold = !hidden(first);
    return r;
  })()`);
  assert(foldCheck && foldCheck.n >= 2 && foldCheck.firstOpen && foldCheck.secondFolded, `同日多课默认折叠非首课（当日 ${foldCheck && foldCheck.n} 节：首卡展开、次卡折叠）`);
  assert(foldCheck && foldCheck.afterFold && foldCheck.afterUnfold, '课程卡折叠/展开切换生效');

  // 开始训练 → sStatus=live + 训练中chip + 自动计时器 + 自动展开；时段/时长手动输入已取消，开始时间自动记录
  const liveStart = await evaluate(`(() => {
    let card = [...document.querySelectorAll('#sesList .card[data-ses]')].find((c) => c.querySelector('[data-act="toggle-live"]') && c.querySelector('[data-ra]'));
    if (!card) return null;
    const ses = Store.data.sessions.find((s) => s.id === card.dataset.ses);
    card.querySelector('[data-act="toggle-live"]').click();
    card = document.querySelector('#sesList .card[data-ses="' + ses.id + '"]');
    const r = { liveChip: card.innerHTML.includes('训练中'), stLive: ses.sStatus === 'live' };
    r.hasTimer = !!card.querySelector('[data-timer="' + ses.id + '"]');
    r.timerFmt = /^\\d{2}:\\d{2}:\\d{2}$/.test((card.querySelector('[data-timer]') || {}).textContent || '');
    r.stamped = !!ses.sStartDate && !!ses.time;
    r.noManual = !card.querySelector('[data-f="time"]') && !card.querySelector('[data-f="duration"]');
    const b = card.querySelector('[data-body]');
    r.bodyOpen = b && getComputedStyle(b).display !== 'none';
    const aid = ses.athletes[0];
    const srpe = card.querySelector('[data-srpe="' + aid + '"]');
    srpe.value = '7'; srpe.dispatchEvent(new Event('change', { bubbles: true }));
    const ra = card.querySelector('[data-ra]');
    ra.value = '5'; ra.dispatchEvent(new Event('change', { bubbles: true }));
    const [laid, lidx] = ra.dataset.ra.split(':');
    r.saved = ((ses.results[laid] || [])[Number(lidx)] || {}).actual === 5;
    r.rpeSaved = (ses.athSrpe || {})[aid] === 7;
    return r;
  })()`);
  assert(liveStart && liveStart.liveChip && liveStart.stLive && liveStart.bodyOpen, '开始训练：课程标记训练中并自动展开');
  assert(liveStart && liveStart.hasTimer && liveStart.timerFmt, '开始训练：卡片出现自动计时器（HH:MM:SS）');
  assert(liveStart && liveStart.stamped && liveStart.noManual, '已取消时段/时长手动输入，开始时间自动记录');
  assert(liveStart && liveStart.saved && liveStart.rpeSaved, '训练中填写结果与 sRPE 自动保存入库');
  await sleep(1300);
  // 自动计时器每秒走时：等待 1.3s 后读数应离开 00:00:00
  const tickCheck = await evaluate(`(() => {
    const el = document.querySelector('#sesList [data-timer]');
    return { txt: el ? el.textContent : null, ok: !!el && el.textContent !== '00:00:00' && /^\\d{2}:\\d{2}:\\d{2}$/.test(el.textContent) };
  })()`);
  assert(tickCheck && tickCheck.ok, `自动计时器每秒走时（当前读数 ${tickCheck && tickCheck.txt}）`);
  // 结束训练 → 弹窗询问是否保存 → 保存后按自动计时写入实际时长，负荷重算入库
  const liveEnd = await evaluate(`(() => {
    const ses = Store.data.sessions.find((s) => (s.sStatus === 'live' || s.sStatus === 'paused') && s.athletes && s.athletes.some((a) => (s.athSrpe || {})[a] === 7 && ((s.results[a] || [])[0] || {}).actual === 5));
    if (!ses) return null;
    const aid = ses.athletes[0];
    const card = document.querySelector('#sesList .card[data-ses="' + ses.id + '"]');
    card.querySelector('[data-act="toggle-live"]').click();
    const ov = [...document.querySelectorAll('.overlay')].pop();
    ov.querySelector('[data-save]').click();
    const fresh = document.querySelector('#sesList .card[data-ses="' + ses.id + '"]');
    const r = { doneChip: fresh.innerHTML.includes('已完课'), stDone: ses.sStatus === 'done' };
    r.dur = ses.duration;
    r.doneTxt = fresh.innerHTML.includes('实际 ' + ses.duration + ' 分钟');
    r.sEnd = !!ses.sEnd;
    const entry = Store.data.loadEntries.find((e) => e.sessionId === ses.id && e.athleteId === aid);
    r.entryOk = !!entry && entry.duration === ses.duration && entry.load === Math.round((ses.athSrpe[aid] || 0) * ses.duration);
    r.noTimer = !fresh.querySelector('[data-timer]');
    return r;
  })()`);
  assert(liveEnd && liveEnd.doneChip && liveEnd.stDone, '结束训练：完课状态保存，可下次打开查看或修改');
  assert(liveEnd && liveEnd.dur >= 1 && liveEnd.doneTxt && liveEnd.sEnd, `结束训练按自动计时写入实际时长（实际 ${liveEnd && liveEnd.dur} 分钟，含起止时间）`);
  assert(liveEnd && liveEnd.entryOk, '结束训练按实际时长重算负荷并同步负荷记录（sRPE×时长）');
  assert(liveEnd && liveEnd.noTimer, '已完课卡片收起计时器，保留实际时长展示');

  // 每人外部负荷（实际完成口径）：吨位 chip 随填写刷新（旧单一「总负荷 kg」chip 已升级为 吨位/距离/做功 三族）
  const tonCheck = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#sesList .card[data-ses]')];
    const card = cards.find((c) => c.querySelector('[data-ra]'));
    if (!card) return null;
    const ses = Store.data.sessions.find((s) => s.id === card.dataset.ses);
    const aid = ses.athletes[0];
    const d = Store.sessionActualDose(ses, aid, { actualOnly: true });
    const expect = '吨位 ' + U.fmt(d.kg) + ' kg';
    return { kg: d.kg, expect, txt: card.textContent,
      hasCol: card.textContent.includes('吨位') || card.textContent.includes('实际外部负荷未填'),
      ok: d.kg > 0 ? card.textContent.includes(expect) : card.textContent.includes('实际外部负荷未填') };
  })()`);
  assert(tonCheck && tonCheck.hasCol, '每人结果卡含三族外部负荷区（吨位/距离/做功 chip）');
  assert(tonCheck && tonCheck.ok, `每人实际吨位自动计算正确（期望含 ${tonCheck && tonCheck.expect}）`);

  // 日期条左右滑动切日：触控板横向滚轮（累计阈值/纵向放行）、键盘 ←→（输入框聚焦时不触发）、触屏左右滑
  const swipeChk = await evaluate(`(() => {
    const strip = document.querySelector('.daystrip');
    const d = () => document.querySelector('#dPick').value;
    const wheel = (dx, dy) => strip.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy || 0, bubbles: true, cancelable: true }));
    const d0 = d();
    wheel(20);                                   // 未到阈值
    const smallOk = d() === d0;
    wheel(30);                                   // 累计 50 → 后一天
    const nextOk = d() === U.addDays(d0, 1);
    wheel(0, 120);                               // 纵向滚轮不翻日
    const vertOk = d() === U.addDays(d0, 1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    const keyOk = d() === d0;
    const inp = document.querySelector('#dPick'); inp.focus();
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable:true }));
    const inputOk = d() === d0;
    inp.blur();
    // 触屏手势（Chromium 支持 Touch 构造）
    let touchOk = null;
    if (typeof TouchEvent !== 'undefined') {
      const touch = (type, x, y) => { const t = new Touch({ identifier: 1, target: strip, clientX: x, clientY: y });
        strip.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true })); };
      touch('touchstart', 300, 100); touch('touchmove', 235, 100); touch('touchend', 235, 100);  // 左滑 → 后一天
      touchOk = d() === U.addDays(d0, 1);
    }
    const activeIdx = [...document.querySelectorAll('.day-chip')].findIndex((c) => c.classList.contains('active'));
    return { cls: strip.classList.contains('days-swipe'), smallOk, nextOk, vertOk, keyOk, inputOk, touchOk, activeIdx };
  })()`);
  assert(swipeChk && swipeChk.cls, '日期条启用左右滑动手势（days-swipe）');
  assert(swipeChk && swipeChk.smallOk && swipeChk.nextOk, '触控板横向滑动累计到阈值后切换到后一天（小幅误触不翻页）');
  assert(swipeChk && swipeChk.vertOk, '在日期条上纵向双指滚动仍滚动页面、不切换日期');
  assert(swipeChk && swipeChk.keyOk, '键盘 ← / → 切换训练日期');
  assert(swipeChk && swipeChk.inputOk, '焦点在日期/输入控件时方向键不切换日期');
  assert(swipeChk && swipeChk.touchOk !== false, '触屏左右滑动切换日期');
  assert(swipeChk && swipeChk.activeIdx === 3, '切换后选中日重新居中于日期条');

  // 13c. 三量纲外部负荷：距离/时间动作行走 UI 录入（km、min 换算）→ 计划汇总/速度带 → 每人按显示单位填实际完成 → sessionActualDose 分族正确
  // 课日期落在某个小周期内，保证负荷页按小周期聚合的图表能统计到
  const sesDate = await evaluate(`(() => {
    const mac = Store.activeMacro();
    const mesoIds = new Set(Store.data.mesos.filter((m) => !mac || m.macroId === mac.id).map((m) => m.id));
    const mi = Store.data.micros.find((m) => mesoIds.has(m.mesoId));
    return mi ? mi.startDate : U.today();
  })()`);
  await evaluate(`(() => {
    const mac = Store.activeMacro();
    const aths = Store.data.athletes.filter((a) => !mac || a.macroId === mac.id).slice(0, 3).map((a) => a.id);
    const ses = { id: U.uid('ses'), date: '${sesDate}', name: '三量纲测试课', type: '体能', time: null,
      duration: 60, srpe: null, athSrpe: {}, athletes: aths, rows: [], results: {}, note: '' };
    Store.data.sessions.push(ses); Store.save();
    Views.session.state.date = ses.date; Views.session.mount();
    return ses.id;
  })()`);
  await sleep(700);
  const dosePlan = await evaluate(`(() => {
    const card = [...document.querySelectorAll('#sesList .card[data-ses]')].find((c) => (c.querySelector('[data-f="name"]') || {}).value === '三量纲测试课');
    if (!card) return { noCard: true };
    const ses = Store.data.sessions.find((s) => s.name === '三量纲测试课' && s.date === '${sesDate}');
    const addRow = (nm) => {
      card.querySelector('.ex-add').click();
      const tr = card.querySelector('.extable tbody tr:last-child');
      const sel = tr.querySelector('.ex-sel');
      const o = [...sel.options].find((x) => x.textContent.includes(nm));
      if (!o) return;
      sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setF = (idx, f, val) => {
      const tr = card.querySelectorAll('.extable tbody tr')[idx];
      const inp = tr.querySelector('[data-f="' + f + '"]');
      inp.value = String(val); inp.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // 行0：400米间歇跑 6 组 × 400m（间歇类→高速跑带）
    addRow('400米间歇跑');
    setF(0, 'dist', 400); setF(0, 'sets', 6);
    // 行1：20m冲刺 8 组 × 20m（冲刺类→冲刺带）
    addRow('20m冲刺');
    setF(1, 'dist', 20); setF(1, 'sets', 8);
    // 行2：平板支撑 3 组 × 120s（时间量纲）
    addRow('平板支撑');
    setF(2, 'dur', 120); setF(2, 'sets', 3);
    // UI 断言：计划表汇总与速度带标签；距离/时间行无 %1RM/重量列；每行有单位选择且自动带出
    const tot = card.querySelector('.extable .tot-line').textContent;
    const trs = [...card.querySelectorAll('.extable tbody tr')];
    const r = {
      rowsN: ses.rows.length,
      metric: ses.rows.map((x) => Calc.metricOf(x)),
      units: ses.rows.map((x) => x.unit),
      footerDist: tot,
      hasNoResCols: trs.every((t) => !t.querySelector('.ex-pct') && !t.querySelector('[data-f="weight"]')),
      hasUnitSel: trs.every((t) => t.querySelector('[data-f="unit"]')),
      band0: trs[0].querySelector('.ex-load').textContent,
      band1: trs[1].querySelector('.ex-load').textContent,
      band2: trs[2].querySelector('.ex-load').textContent,
      doseRows: ses.rows.map((x) => Calc.planRowDose(x)),
      bands: Calc.rowsDistanceBands(ses.rows)
    };
    r.footOk = /距离\\s*2,560\\s*m/.test(tot) && /高速\\s*2,400/.test(tot) && /冲刺\\s*160/.test(tot) && /做功/.test(tot) && /6\\s*min/.test(tot);
    r.bandOk = r.bands.sprint === 160 && r.bands.hsr === 2400 && r.bands.moderate === 0 && r.bands.aerobic === 0;
    r.loadOk = r.band0.includes('高速带') && r.band1.includes('冲刺带') && /360\\s*s/.test(r.band2);
    return r;
  })()`);
  assert(dosePlan && !dosePlan.noCard && dosePlan.rowsN === 3, `三量纲课：新增 3 个动作行（实际 ${dosePlan && dosePlan.rowsN}）`);
  assert(dosePlan && JSON.stringify(dosePlan.metric) === JSON.stringify(['distance', 'distance', 'duration']), `动作行量纲随动作自动切换（实际 ${dosePlan && dosePlan.metric}）`);
  assert(dosePlan && JSON.stringify(dosePlan.units) === JSON.stringify(['m', 'm', 's']) && dosePlan.hasUnitSel, `选动作自动带出单位（距离→m、时间→s），每行可手改（实际 ${dosePlan && JSON.stringify(dosePlan.units)}）`);
  assert(dosePlan && dosePlan.hasNoResCols, '距离/时间行不显示 %1RM 与重量列');
  assert(dosePlan && dosePlan.footOk, `表底三族汇总正确：2,560m（高速2,400/冲刺160）+ 做功6min（${dosePlan && dosePlan.footerDist}）`);
  assert(dosePlan && dosePlan.bandOk && dosePlan.loadOk, `速度带按动作类型归类正确（400米间歇=高速、20m冲刺=冲刺；时间行 360s 显示）`);

  // 每人实际完成按行显示单位录入（km/min 自动换算），非抗阻行无实际重量/RIR/估算1RM
  const doseActual = await evaluate(`(() => {
    const card = [...document.querySelectorAll('#sesList .card[data-ses]')].find((c) => (c.querySelector('[data-f="name"]') || {}).value === '三量纲测试课');
    if (!card) return { noCard: true };
    const ses = Store.data.sessions.find((s) => s.name === '三量纲测试课' && s.date === '${sesDate}');
    const aid = ses.athletes[0];
    const fill = (idx, sets, perSet) => {
      const sInp = card.querySelector('[data-rs="' + aid + ':' + idx + '"]');
      sInp.value = String(sets); sInp.dispatchEvent(new Event('change', { bubbles: true }));   // 触发运动员区重渲染
      const inp = document.querySelector('.card[data-ses="' + ses.id + '"] [data-ra="' + aid + ':' + idx + '"]');
      inp.value = String(perSet); inp.dispatchEvent(new Event('change', { bubbles: true }));
    };
    // 行0：6 组 × 单组 400m = 2400m；行1：8 组 × 20m = 160m；行2：3 组 × 120s = 360s
    fill(0, 6, 400); fill(1, 8, 20); fill(2, 3, 120);
    const fresh = document.querySelector('#sesList .card[data-ses="' + ses.id + '"]');
    const d1 = Store.sessionActualDose(ses, aid, { actualOnly: true });
    // 其余 2 人未填 → 全队口径回退计划剂量（每人 2,560m / 360s）
    const dAll = Store.sessionActualDose(ses, null);
    return {
      d1, dAll,
      cardTxt: fresh.textContent,
      noResInputs: fresh.querySelectorAll('[data-rw]').length === 0 && fresh.querySelectorAll('[data-rr]').length === 0,
      unitLabels: [0, 1, 2].map((i) => { const t = fresh.querySelector('[data-ra="' + aid + ':' + i + '"]').parentElement.textContent; return t; }),
      noEstTests: !(Store.data.tests || []).some((t) => t.sessionId === ses.id)
    };
  })()`);
  assert(doseActual && !doseActual.noCard && doseActual.noResInputs, '非抗阻行动动员区无实际重量/RIR 输入');
  assert(doseActual && doseActual.noEstTests, '距离/时间行不触发估算 1RM 与测试记录');
  assert(doseActual && doseActual.d1 && doseActual.d1.m === 2560 && doseActual.d1.s === 360 && doseActual.d1.kg === 0,
    `单人实际外部负荷：2,560m + 360s + 0kg（实际 m=${doseActual && doseActual.d1 && doseActual.d1.m} s=${doseActual && doseActual.d1 && doseActual.d1.s} kg=${doseActual && doseActual.d1 && doseActual.d1.kg}）`);
  assert(doseActual && doseActual.d1 && doseActual.d1.bands.sprint === 160 && doseActual.d1.bands.hsr === 2400,
    `单人实际距离速度带：冲刺160/高速2400（实际 ${doseActual && doseActual.d1 && JSON.stringify(doseActual.d1.bands)}）`);
  assert(doseActual && doseActual.dAll && doseActual.dAll.m === 7680 && doseActual.dAll.s === 1080,
    `全队口径：1 人填实际 + 2 人回退计划 = 7,680m / 1,080s（实际 m=${doseActual && doseActual.dAll && doseActual.dAll.m} s=${doseActual && doseActual.dAll && doseActual.dAll.s}）`);
  assert(doseActual && doseActual.unitLabels && doseActual.unitLabels.every((t, i) => [/m/, /m/, /s/][i].test(t)),
    `每人实际完成输入随行显示单位（m / m / s，实际 ${doseActual && JSON.stringify(doseActual.unitLabels)}）`);
  assert(doseActual && doseActual.cardTxt && doseActual.cardTxt.includes('距离 2,560 m') && doseActual.cardTxt.includes('做功 6 min'),
    '每人三族负荷 chip 随实际完成刷新（2,560 m / 6 min）');

  // 负荷管理页：8 指标卡 + 10 图（个人模式切到已填实际的运动员；外部负荷按 距离/做功时间 指标卡呈现）
  await evaluate('location.hash = "#/load"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(900);
  await evaluate(`(() => {
    const ses = Store.data.sessions.find((s) => s.name === '三量纲测试课');
    const sel = document.querySelector('#athSel');
    sel.value = ses.athletes[0]; sel.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(500);
  const extLoad = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('.load-metric')];
    const titles = cards.map((c) => c.querySelector('.k').textContent.trim());
    const chartIds = ['loadDailyChart', 'loadRiskChart', 'loadAcwrGauge', 'loadTsbGauge', 'loadTonnageChart', 'loadSessionChart', 'loadTypeChart', 'loadTypeTimeChart', 'loadDistanceChart', 'loadWorkTimeChart'];
    const chartsOk = chartIds.every((id) => { const el = document.getElementById(id); return el && el.innerHTML.trim().length > 0; });
    const distCard = cards.find((c) => c.querySelector('.k').textContent.includes('训练距离'));
    const workCard = cards.find((c) => c.querySelector('.k').textContent.includes('动作做功时间'));
    const from = document.querySelector('#loadDateFrom').value, to = document.querySelector('#loadDateTo').value;
    const aid = document.querySelector('#athSel').value;
    const dose = Store.rangeActualDose(from, to, aid);
    const distOk = distCard ? distCard.textContent.replace(/\\s+/g, ' ').includes(U.fmt(Math.round(dose.m)) + ' m') : false;
    const workOk = workCard ? workCard.textContent.replace(/\\s+/g, ' ').includes(U.fmt(Math.round(dose.s)) + ' s') : false;
    return { n: cards.length, titles, chartsOk, distOk, workOk, distTxt: distCard ? distCard.textContent.replace(/\\s+/g, ' ').slice(0, 80) : '' };
  })()`);
  assert(extLoad && extLoad.n === 8, `负荷页 8 指标卡（实际 ${extLoad && extLoad.n}）`);
  assert(extLoad && ['训练距离', '动作做功时间', '训练吨位', 'AU · 内部负荷总量'].every((t) => extLoad.titles.some((x) => x.indexOf(t) === 0)), `负荷页指标卡含外部负荷三量纲（${extLoad && extLoad.titles.join('/')}）`);
  assert(extLoad && extLoad.chartsOk, '负荷页 10 张图表全部渲染');
  assert(extLoad && extLoad.distOk, `训练距离卡与 rangeActualDose 一致（实际 ${extLoad && extLoad.distTxt}）`);
  assert(extLoad && extLoad.workOk, '动作做功时间卡与 rangeActualDose 一致');
  await evaluate('location.hash = "#/session"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(600);

  // 14. 训练课：每运动员训练计划视图
  await evaluate('location.hash = "#/session"; window.dispatchEvent(new Event("hashchange")); "ok"');
  await sleep(800);
  const athPlan = await evaluate(`(() => {
    const html = document.querySelector('#view').innerHTML;
    return {
      hasSection: html.includes('运动员训练计划'),
      hasRemove: html.includes('data-rm-ath')
    };
  })()`);
  assert(athPlan && athPlan.hasSection, '训练课含运动员训练计划 section');
  assert(athPlan && athPlan.hasRemove, '运动员计划含移除按钮');

  // 15. 运动员档案页：基本信息 + 统一体能数据源（分析区块全部迁至 09 KPI 分析页）
  const navProf = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.id === 'profile');
    return item ? item.textContent : '';
  })()`);
  assert(/运动员档案/.test(navProf), '导航栏含「运动员档案」入口');
  const navKpi = await evaluate(`(() => {
    const item = [...document.querySelectorAll('.nav-item')].find((n) => n.dataset.id === 'kpi');
    return item ? item.textContent : '';
  })()`);
  assert(/KPI 分析/.test(navKpi), '导航栏含「KPI 分析」入口');

  await evaluate('location.hash = "#/profile"; window.dispatchEvent(new Event("hashchange")); "ok"');
  // 9d 新建的周跳跳被自动选中（无测试数据）——轮询切回陈浩验证档案数据源
  await evalWait(`(() => {
    const sel = document.querySelector('#profAthSel');
    const optTxt = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
    if (!sel || !optTxt.includes('陈浩')) {
      const wang = Store.data.athletes.find((x) => x.name === '陈浩');
      if (wang && sel) { sel.value = wang.id; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      return false;
    }
    return true;
  })()`, (v) => v === true);
  await sleep(500);
  const profPage = await evaluate(`(() => {
    const html = document.querySelector('#view').innerHTML;
    return {
      hasHead: !!document.querySelector('#profAthSel'),
      hasAvatar: !!document.querySelector('#profAthBar .avatar'),
      hasAdd: !!document.querySelector('#pAdd'),
      hasKpiBtn: !!document.querySelector('#profKpiBtn'),
      merged: !!document.querySelector('#profAthBar #pAdd') && !!document.querySelector('#profAthBar #profAthEdit'),
      noEditBtn: !document.querySelector('#profEditBtn'),
      hasSrcCard: html.includes('体能数据源记录'),
      noRadar: !html.includes('综合能力雷达图'),
      noKPI: !html.includes('KPI 分析看板'),
      noTrend: !html.includes('纵向追踪趋势'),
      noTeam: !html.includes('团队综合评分排名'),
      noFmsCard: !html.includes('FMS 功能性动作筛查')
    };
  })()`);
  assert(profPage && profPage.hasHead && profPage.hasAvatar && profPage.merged && profPage.hasAdd && profPage.hasKpiBtn, '运动员栏与信息头合并（头像+下拉+编辑/删除+添加体能数据+KPI 入口同一卡）');
  assert(profPage && profPage.noEditBtn, '头部「编辑」按钮已删除（与名单行 ✎ 不再重复）');
  assert(profPage && profPage.hasSrcCard, '体能数据源记录卡：按日期展示每次录入明细');
  assert(profPage && profPage.noRadar && profPage.noKPI && profPage.noTrend && profPage.noTeam && profPage.noFmsCard, '档案页不再渲染分析区块（雷达/KPI/趋势/排名/FMS 迁至 KPI 分析页）');

  // 1RM 力量档案数据源卡（分析解读在 KPI 分析页）：列出当前运动员全部测试/估算记录，次数不设上限
  const rmCard = await evaluate(`(() => {
    const html = document.querySelector('#view').innerHTML;
    const card = document.querySelector('#profRmCard');
    const rows = card ? card.querySelectorAll('tbody tr').length : 0;
    const athId = document.querySelector('#profAthSel').value;
    const rm = (Store.data.athleteRm || {})[athId] || {};
    // 期望行数 = 该运动员全部动作的历史记录条数（无 history 但有 value 的按 1 条计）
    const expect = Object.keys(rm).reduce((n, exId) => {
      const r = rm[exId] || {};
      const h = (r.history || []).filter((x) => x && x.value).length;
      return n + (h || (r.value ? 1 : 0));
    }, 0);
    return {
      hasCard: !!card, rows, expect,
      hasVs: html.includes('vs 上次'),
      noOldHint: card ? !card.innerHTML.includes('不设上限') && !card.innerHTML.includes('vs 团队') : false,
      // 验证每条记录的涨跌幅 = 相对该运动员上一次同动作记录
      // 方法：从渲染表格按动作分组（表格全局按日期倒序），反转得升序后逐条验证相邻差值
      diffOk: card ? (() => {
        const trs = [...card.querySelectorAll('tbody tr')];
        const byEx = {};
        trs.forEach((tr) => {
          const name = tr.cells[0].querySelector('b').textContent;
          const val = Number(tr.cells[1].textContent.replace(/[^0-9.]/g, ''));
          const dateTxt = tr.cells[2].textContent.trim();
          const cell = tr.cells[4].textContent.trim();
          (byEx[name] = byEx[name] || []).push({ val, dateTxt, cell });
        });
        const bad = [];
        const dVal = (md) => { const p = md.split('/'); return Number(p[0]) * 10000 + Number(p[1]) * 100 + Number(p[2]); };
        Object.keys(byEx).forEach((name) => {
          // 按日期升序稳定排序：同日期保持表格内相对顺序（与应用内升序列表一致）
          const rows = byEx[name].slice().sort((a, b) => dVal(a.dateTxt) - dVal(b.dateTxt));
          rows.forEach((r, i) => {
            let expCell;
            if (i === 0) expCell = '—';
            else {
              const prev = rows[i - 1].val;
              const exp = (r.val - prev) / prev * 100;
              expCell = (exp > 0 ? '+' : '') + exp.toFixed(0) + '%';
            }
            if (r.cell !== expCell) bad.push({ name, i, val: r.val, dateTxt: r.dateTxt, cell: r.cell, expCell });
          });
        });
        window.__rmDiffBad = bad;
        return bad.length === 0;
      })() : false,
      hasTestChip: card ? card.innerHTML.includes('测试') : false
    };
  })()`);
  assert(rmCard && rmCard.hasCard && rmCard.rows >= 2 && rmCard.rows === rmCard.expect, `1RM 力量档案列出当前运动员全部记录（${rmCard && rmCard.rows}/${rmCard && rmCard.expect} 条，次数不设上限）`);
  assert(rmCard && rmCard.hasVs && rmCard.diffOk, '1RM 档案偏差改为「vs 上次」：相对该运动员上一次同动作记录的涨跌幅');
  if (rmCard && !rmCard.diffOk) console.log('  [debug] diff mismatches:', JSON.stringify(await evaluate('window.__rmDiffBad'), null, 1));
  assert(rmCard && rmCard.noOldHint && rmCard.hasTestChip, '1RM 档案底部说明文案已删除，来源标记保留');

  // 1RM 档案：显示最近记录日期 + 分类/日期下拉筛选
  const rmHist = await evaluate(`(() => {
    const card = document.querySelector('#profRmCard');
    const html = document.querySelector('#view').innerHTML;
    if (!card) return null;
    const r = { hasLatestChip: card.innerHTML.includes('最新记录'), noSub: !html.includes('时点取用') };
    return r;
  })()`);
  assert(rmHist && rmHist.noSub, '体能数据源卡移除「测试日/次录入/时点取用」统计文案');
  assert(rmHist && rmHist.hasLatestChip, '1RM 档案显示最近记录日期');

  // 1RM 力量档案：分类下拉 + 日期下拉筛选
  const rmFilter = await evaluate(`(() => {
    const card = document.querySelector('#profRmCard');
    if (!card) return null;
    const catSel = card.querySelector('#rmCatSel'), dateSel = card.querySelector('#rmDateSel');
    if (!catSel || !dateSel) return { hasSels: false };
    const total = card.querySelectorAll('tbody tr').length;
    // 日期筛选：选第一个具体日期
    const dates = [...dateSel.options].map((o) => o.value).filter(Boolean);
    if (!dates.length) return { hasSels: true, noDates: true };
    const d0 = dates[0];
    dateSel.value = d0; dateSel.dispatchEvent(new Event('change', { bubbles: true }));
    const card2 = document.querySelector('#profRmCard');
    const rows2 = card2.querySelectorAll('tbody tr').length;
    const allDate = [...card2.querySelectorAll('tbody tr')].every((tr) => tr.cells[2].textContent.trim() === U.md(d0));
    // 恢复全部日期后按分类筛选
    const ds = document.querySelector('#rmDateSel'); ds.value = ''; ds.dispatchEvent(new Event('change', { bubbles: true }));
    const cats = [...document.querySelector('#rmCatSel').options].map((o) => o.value).filter(Boolean);
    const c0 = cats[0] || null;
    let rows3 = null, expectCat = null;
    if (c0) {
      const cs = document.querySelector('#rmCatSel'); cs.value = c0; cs.dispatchEvent(new Event('change', { bubbles: true }));
      rows3 = document.querySelector('#profRmCard').querySelectorAll('tbody tr').length;
      const athId = document.querySelector('#profAthSel').value;
      const rm = (Store.data.athleteRm || {})[athId] || {};
      expectCat = 0;
      Object.keys(rm).forEach((exId) => {
        const ex = Store.exercise(exId);
        if (!ex || (ex.cat1 || '未分类') !== c0) return;
        const r = rm[exId] || {};
        const h = (r.history || []).filter((x) => x && x.value).length;
        expectCat += h || (r.value ? 1 : 0);
      });
      const cs2 = document.querySelector('#rmCatSel'); cs2.value = ''; cs2.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const rowsAll = document.querySelector('#profRmCard').querySelectorAll('tbody tr').length;
    return { hasSels: true, total, d0, rows2, allDate, c0, rows3, expectCat, rowsAll };
  })()`);
  assert(rmFilter && rmFilter.hasSels, '1RM 力量档案含分类与日期下拉菜单');
  assert(rmFilter && !rmFilter.noDates && rmFilter.allDate && rmFilter.rows2 >= 1 && rmFilter.rows2 <= rmFilter.total, `1RM 档案按日期筛选（${rmFilter && rmFilter.d0}：${rmFilter && rmFilter.rows2}/${rmFilter && rmFilter.total} 条均为该日）`);
  assert(rmFilter && rmFilter.c0 && rmFilter.rows3 === rmFilter.expectCat, `1RM 档案按分类筛选（「${rmFilter && rmFilter.c0}」${rmFilter && rmFilter.rows3}/${rmFilter && rmFilter.expectCat} 条）`);
  assert(rmFilter && rmFilter.rowsAll === rmFilter.total, '1RM 档案筛选恢复全部');

  // 1RM 记录删除：操作列 ✕ → 确认 → athleteRm history 移除且基准回退为剩余最新一条
  const rmDel = await evaluate(`(() => {
    const card = document.querySelector('#profRmCard');
    if (!card) return null;
    const btns = [...card.querySelectorAll('[data-rmdel]')];
    if (!btns.length) return { hasBtns: false };
    const athId = document.querySelector('#profAthSel').value;
    const rm = Store.data.athleteRm[athId] || {};
    const exId = Object.keys(rm).find((k) => rm[k] && rm[k].history && rm[k].history.length >= 2);
    if (!exId) return { hasBtns: true, noMulti: true };
    const before = rm[exId].history.length;
    const btn = card.querySelector('[data-rmdel="' + exId + '"]');
    const hi = Number(btn.dataset.hi);
    window.__rmDelExp = { exId, after: before - 1, newValue: hi === before - 1 ? rm[exId].history[before - 2].value : rm[exId].history[before - 1].value, rowsBefore: card.querySelectorAll('tbody tr').length };
    btn.click();
    return { hasBtns: true, exId, before, totalBtns: btns.length };
  })()`);
  assert(rmDel && rmDel.hasBtns, `1RM 档案每条记录带删除按钮（共 ${rmDel && rmDel.totalBtns} 个）`);
  if (rmDel && rmDel.exId) {
    await sleep(400);
    await evaluate(`(() => { const ov = [...document.querySelectorAll('.overlay')].pop(); const ok = ov && ov.querySelector('[data-ok]'); if (ok) ok.click(); return 'ok'; })()`);
    await sleep(700);
    const rmDelChk = await evalWait(`(() => {
      const athId = document.querySelector('#profAthSel').value;
      const rec = ((Store.data.athleteRm || {})[athId] || {})[window.__rmDelExp.exId];
      const card = document.querySelector('#profRmCard');
      return {
        hist: rec && rec.history ? rec.history.length : 0,
        value: rec ? rec.value : null,
        exp: window.__rmDelExp,
        rows: card ? card.querySelectorAll('tbody tr').length : -1
      };
    })()`, (v) => !!v);
    assert(rmDelChk && rmDelChk.hist === rmDelChk.exp.after && rmDelChk.value === rmDelChk.exp.newValue, `删除 1RM 记录：history -1，基准回退为剩余最新一条（${rmDelChk && rmDelChk.exp.newValue}kg）`);
    assert(rmDelChk && rmDelChk.rows === rmDelChk.exp.rowsBefore - 1, '删除后 1RM 表格行数 -1');
  }

  // 体能数据源：临时日期新建 → ✎ 修改（预填+锁定+覆盖保存）→ ✕ 删除
  await evaluate(`(() => { document.querySelector('#pAdd').click(); return 'ok'; })()`);
  await sleep(400);
  await evaluate(`(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    ov.querySelector('#pDate').value = '2020-01-01';
    ov.querySelector('#pW').value = '88';
    ov.querySelector('[data-ok]').click();
    return 'ok';
  })()`);
  await sleep(700);
  const srcTmp = await evalWait(`(() => {
    const athId = document.querySelector('#profAthSel').value;
    const recs = Store.data.profiles.filter((p) => p.athleteId === athId && p.date === '2020-01-01');
    return { n: recs.length, w: recs[0] ? recs[0].weight : null,
      hasBtn: !!document.querySelector('#profSrcCard [data-srcedit="2020-01-01"]'),
      delBtn: !!document.querySelector('#profSrcCard [data-srcdel="2020-01-01"]') };
  })()`, (v) => !!v && v.n >= 1);
  assert(srcTmp && srcTmp.n === 1 && srcTmp.w === 88 && srcTmp.hasBtn && srcTmp.delBtn, '临时体能数据源已创建，该日期带 ✎ 修改 / ✕ 删除按钮');
  await evaluate(`(() => { document.querySelector('#profSrcCard [data-srcedit="2020-01-01"]').click(); return 'ok'; })()`);
  await sleep(400);
  const srcEditDlg = await evaluate(`(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    const w = ov.querySelector('#pW');
    const locked = ov.querySelector('#pDate').disabled && ov.querySelector('#pAth').disabled;
    const prefilled = !!w && Number(w.value) === 88;
    if (w) w.value = '77.7';
    return { locked, prefilled };
  })()`);
  await evaluate(`(() => { const ov = [...document.querySelectorAll('.overlay')].pop(); ov.querySelector('[data-ok]').click(); return 'ok'; })()`);
  await sleep(700);
  const srcEditChk = await evalWait(`(() => {
    const athId = document.querySelector('#profAthSel').value;
    const recs = Store.data.profiles.filter((p) => p.athleteId === athId && p.date === '2020-01-01');
    return { n: recs.length, w: recs[0] ? recs[0].weight : null };
  })()`, (v) => !!v);
  assert(srcEditDlg && srcEditDlg.locked && srcEditDlg.prefilled, '编辑弹窗预填该日合并值且运动员/日期锁定');
  assert(srcEditChk && srcEditChk.n === 1 && srcEditChk.w === 77.7, `修改保存后该日覆盖为一条记录（体重 88 → 77.7kg）`);
  await evaluate(`(() => { document.querySelector('#profSrcCard [data-srcdel="2020-01-01"]').click(); return 'ok'; })()`);
  await sleep(400);
  await evaluate(`(() => { const ov = [...document.querySelectorAll('.overlay')].pop(); const ok = ov && ov.querySelector('[data-ok]'); if (ok) ok.click(); return 'ok'; })()`);
  await sleep(700);
  const srcDelChk = await evalWait(`(() => {
    const athId = document.querySelector('#profAthSel').value;
    return { n: Store.data.profiles.filter((p) => p.athleteId === athId && p.date === '2020-01-01').length,
      btn: !!document.querySelector('#profSrcCard [data-srcdel="2020-01-01"]') };
  })()`, (v) => !!v);
  assert(srcDelChk && srcDelChk.n === 0 && !srcDelChk.btn, '删除该日体能数据源：记录移除、操作按钮消失');

  // 「记录 1RM」入口打开独立 1RM 录入弹窗且回填已测值
  await evaluate(`(() => { document.querySelector('#profRmEdit').click(); return 'ok'; })()`);
  await sleep(400);
  const rmEditDlg = await evaluate(`(() => {
    const ovs = [...document.querySelectorAll('.overlay')];
    const ov = ovs[ovs.length - 1];
    const filled = [...ov.querySelectorAll('#rRmRows [data-ex]')].filter((i) => i.value !== '').length;
    const isRm = ov.textContent.includes('记录 1RM') && !ov.textContent.includes('添加体能数据');
    ov.querySelector('[data-x]').click();
    return { filled, isRm };
  })()`);
  assert(rmEditDlg && rmEditDlg.isRm && rmEditDlg.filled >= 2, `「记录 1RM」打开独立弹窗且回填已测动作（${rmEditDlg && rmEditDlg.filled} 项）`);
  await sleep(300);

  // 建档弹窗：先通过「体能测试项目库」添加自定义项目，再录入 FMS + 自定义项
  await evaluate(`(() => { document.querySelector('#profTestLib').click(); return 'ok'; })()`);
  await sleep(400);
  const libDlg = await evaluate(`(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    return {
      title: ov.querySelector('h3') ? ov.querySelector('h3').textContent : '',
      hasFmsYbt: !!ov.querySelector('.tlSpecial[value="fms"]') && !!ov.querySelector('.tlSpecial[value="ybt"]'),
      hasSysChecks: ov.querySelectorAll('.tlSys').length > 50,
      hasCustomInput: !!ov.querySelector('#tlNewName')
    };
  })()`);
  assert(libDlg && libDlg.hasFmsYbt && libDlg.hasSysChecks && libDlg.hasCustomInput, '测试项目库弹窗：含 FMS/YBT 复合项 + 系统库多选 + 自定义添加');
  // 添加自定义项目「握力」
  await evaluate(`(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    ov.querySelector('#tlNewName').value = '握力';
    ov.querySelector('#tlNewUnit').value = 'kg';
    ov.querySelector('#tlNewUnit').dispatchEvent(new Event('input'));
    ov.querySelector('#tlAddCustom').click();
    return 'ok';
  })()`);
  await sleep(200);
  // 跑动计时类自定义项：单位 s 自动判为「越小越好」，并校验保存结果
  const dirAuto = await evaluate(`(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    ov.querySelector('#tlNewName').value = '30m冲刺';
    const u = ov.querySelector('#tlNewUnit');
    u.value = 's'; u.dispatchEvent(new Event('input'));
    ov.querySelector('#tlAddCustom').click();
    const rows = ov.querySelectorAll('#tlCustomList .tlCustomRow');
    const last = rows[rows.length - 1];
    return { noTopDir: !ov.querySelector('#tlNewDir'), rows: rows.length, lastDir: last.querySelector('.tlCDir').value, lastName: last.querySelector('.tlCN').value };
  })()`);
  assert(dirAuto && dirAuto.noTopDir, '测试项目库弹窗添加行已移除方向下拉');
  assert(dirAuto && dirAuto.lastDir === 'down', `计时类自定义项目单位 s 自动判为「越小越好」（${dirAuto && dirAuto.lastDir}）`);
  await evaluate(`(() => { const ov = [...document.querySelectorAll('.overlay')].pop(); ov.querySelector('[data-ok]').click(); return 'ok'; })()`);
  await sleep(500);
  const dirSaved = await evaluate(`(() => {
    const items = (Store.data.settings.testItems || []);
    const sprint = items.find((t) => t.name === '30m冲刺');
    const grip = items.find((t) => t.name === '握力');
    return { sprintInvert: sprint && sprint.invert, gripInvert: grip && grip.invert };
  })()`);
  assert(dirSaved && dirSaved.sprintInvert === true && dirSaved.gripInvert === false, '自定义项目方向已保存：30m冲刺 invert=true、握力 invert=false');
  // 打开建档弹窗，确认自定义项目已出现在输入区
  await evaluate(`(() => { document.querySelector('#pAdd').click(); return 'ok'; })()`);
  await sleep(400);
  const dlgHasCustom = await evaluate(`(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    return !!ov.querySelector('.pTestVal[data-name="握力"]');
  })()`);
  assert(dlgHasCustom, '「添加体能数据」弹窗直接显示自定义项目「握力」输入框');
  const fmsVals = { squat: 3, hurdle: 2, lunge: 2, shoulder: 3, aslr: 2, tspu: 2, rotary: 2 };
  await evaluate(`(() => {
    const vals = ${JSON.stringify(fmsVals)};
    Object.entries(vals).forEach(([k, v]) => {
      const sel = document.querySelector('.overlay .fmsSel[data-fms="' + k + '"]');
      sel.value = String(v); sel.dispatchEvent(new Event('change'));
    });
    const cb = document.querySelector('.overlay .fmsAsymm[value="shoulder"]');
    if (cb) cb.checked = true;
    return document.querySelector('.overlay #pFmsTotal').textContent;
  })()`);
  const fmsPrev = await evaluate(`document.querySelector('.overlay #pFmsTotal').textContent`);
  assert(fmsPrev === '总分 16/21', `FMS 弹窗实时总分预览 (${fmsPrev})`);
  // 填入自定义项目值
  await evaluate(`(() => {
    const inp = document.querySelector('.overlay .pTestVal[data-name="握力"]');
    inp.value = '52'; inp.dispatchEvent(new Event('input'));
    return 'ok';
  })()`);
  await evaluate(`(() => { document.querySelector('.overlay:last-child [data-ok]').click(); return 'ok'; })()`);
  await sleep(500);
  const customCheck = await evaluate(`(() => {
    const recs = (Store.data.profiles || []).filter((p) => Array.isArray(p.custom) && p.custom.length);
    const html = document.querySelector('#view').innerHTML;
    const srcCard = document.querySelector('#profSrcCard');
    return {
      saved: recs.length > 0 && recs[recs.length - 1].custom[0].name === '握力' && recs[recs.length - 1].custom[0].value === 52,
      headNoChips: !html.includes('自定义项目'),
      srcShown: !!srcCard && srcCard.textContent.includes('握力'),
      srcTable: !!srcCard && !!srcCard.querySelector('table') && !!srcCard.querySelector('td[rowspan]'),
      srcNoChip: !!srcCard && !srcCard.innerHTML.includes('chip volt')
    };
  })()`);
  assert(customCheck && customCheck.saved, '建档弹窗支持录入自定义测试项目（已保存）');
  assert(customCheck && customCheck.headNoChips, '头部卡不再回显体能数据/自定义项目 chips');
  assert(customCheck && customCheck.srcShown && customCheck.srcTable, '自定义项目在数据源卡表格中展示（日期 rowspan 合并）');
  assert(customCheck && customCheck.srcNoChip, '数据源卡项目列为纯文本（FMS/自定义项不再套 volt chip 方框）');

  // FMS：保存校验（筛查卡与雷达图断言在 KPI 分析页）
  const fmsCheck = await evaluate(`(() => {
    const recs = (Store.data.profiles || []).filter((p) => p.fms);
    const last = recs[recs.length - 1];
    return {
      total: last ? Object.values(last.fms).reduce((s, v) => s + v, 0) : 0,
      asymm: last ? last.fmsAsymm || [] : []
    };
  })()`);
  assert(fmsCheck && fmsCheck.total === 16, `FMS 七项录入保存，总分 ${fmsCheck && fmsCheck.total}/21`);
  assert(fmsCheck && fmsCheck.asymm.length === 1 && fmsCheck.asymm[0] === 'shoulder', 'FMS 不对称标记已保存（肩部灵活性）');

  // 统计函数验证
  const statsCheck = await evaluate(`(() => ({
    std: Calc.std([2, 4, 4, 4, 5, 5, 7, 9]),
    z: Calc.zScore(7, [2, 4, 4, 4, 5, 5, 7, 9]),
    pct: Calc.percentile(7, [2, 4, 4, 4, 5, 5, 7, 9])
  }))()`);
  assert(statsCheck && statsCheck.std > 2 && statsCheck.std < 3, `Calc.std 正确 (${statsCheck && statsCheck.std.toFixed(2)})`);
  assert(statsCheck && statsCheck.z > 0.8 && statsCheck.z < 1.2, `Calc.zScore 正确 (${statsCheck && statsCheck.z.toFixed(2)})`);
  assert(statsCheck && statsCheck.pct === 75, `Calc.percentile 正确 (${statsCheck && statsCheck.pct})`);

  // seed profiles 数据验证
  const seedProf = await evaluate(`(() => ({
    count: (Store.data.profiles || []).length,
    hasJump: (Store.data.profiles || []).some((p) => p.verticalJump > 0),
    hasSprint: (Store.data.profiles || []).some((p) => p.sprint20m > 0)
  }))()`);
  assert(seedProf && seedProf.count >= 5, `seed 含 ${seedProf && seedProf.count} 条体能测试记录`);
  assert(seedProf && seedProf.hasJump && seedProf.hasSprint, 'seed 体能测试含纵跳与冲刺数据');

  // seed FMS 数据验证：多条筛查记录 + 含 ≤14 风险示例与不对称标记
  const fmsSeed = await evaluate(`(() => {
    const recs = (Store.data.profiles || []).filter((p) => p.fms);
    const totals = recs.map((p) => Object.values(p.fms).reduce((s, v) => s + v, 0));
    return { n: recs.length, min: Math.min(...totals), withAsymm: recs.filter((p) => p.fmsAsymm && p.fmsAsymm.length).length };
  })()`);
  assert(fmsSeed && fmsSeed.n >= 5, `seed 含 ${fmsSeed && fmsSeed.n} 条 FMS 筛查记录`);
  assert(fmsSeed && fmsSeed.min <= 14 && fmsSeed.withAsymm >= 1, 'seed FMS 含风险示例（≤14）与不对称标记');

  // 统一数据源弹窗：日期必选字段；1RM 录入已独立到「记录 1RM」弹窗
  await evaluate(`(() => { document.querySelector('#pAdd').click(); return 'ok'; })()`);
  await sleep(400);
  const uniDlg = await evaluate(`(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    return {
      unified: ov.textContent.includes('添加体能数据'),
      hasDate: !!ov.querySelector('#pDate'),
      noRmRows: !ov.querySelector('#pRmRows'),
      noEst: !ov.querySelector('#pRmEx')
    };
  })()`);
  assert(uniDlg && uniDlg.unified && uniDlg.hasDate && uniDlg.noRmRows && uniDlg.noEst, '添加体能数据弹窗：日期必选，不含 1RM 录入（已独立）');
  await evaluate(`(() => { [...document.querySelectorAll('.overlay')].pop().querySelector('[data-x]').click(); return 'ok'; })()`);
  await sleep(300);

  // 「记录 1RM」独立弹窗：测试估算（重量×次数×RIR→填入未测动作行）
  await evaluate(`(() => { document.querySelector('#profRmEdit').click(); return 'ok'; })()`);
  await sleep(400);
  const estFill = await evaluate(`(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    const wang = Store.data.athletes.find((x) => x.name === '陈浩');
    const tested = (Store.data.athleteRm || {})[wang.id] || {};
    const ex = Store.data.exercises.find((e) => !tested[e.id] || !tested[e.id].value);
    if (!ex) return null;
    ov.querySelector('#rRmEx').value = ex.id;
    const setV = (id, v) => { const el = ov.querySelector('#' + id); el.value = v; el.dispatchEvent(new Event('input')); };
    setV('rRmW', '100'); setV('rRmR', '5'); setV('rRmRir', '2');
    const est = ov.querySelector('#rRmEst').textContent;
    ov.querySelector('#rRmFill').click();
    const inp = ov.querySelector('[data-ex="' + ex.id + '"]');
    const out = { est, filled: inp ? inp.value : null, name: ex.name };
    ov.querySelector('[data-x]').click();
    return out;
  })()`);
  assert(estFill && estFill.est.includes('123') && estFill.filled === '123', `「记录 1RM」测试估算 e1RM=123 实时预览并填入未测动作「${estFill && estFill.name}」行`);
  await sleep(300);

  // 15b. KPI 分析页：全部体能分析（看板/雷达/Z/FMS/趋势/团队排名）+ 姓名/时期筛选条
  await evaluate('location.hash = "#/kpi"; window.dispatchEvent(new Event("hashchange")); "ok"');
  // 默认继承档案页当前选中（陈浩）
  const kpiPage = await evalWait(`(() => {
    const head = document.querySelector('#kpiHeadName');
    if (!head || head.textContent !== '陈浩') return null;
    const html = document.querySelector('#view').innerHTML;
    const board = document.querySelector('#kpiBoard');
    return {
      hasKPI: html.includes('KPI 分析看板') && !!board,
      boardRows: board ? board.querySelectorAll('tbody tr').length : 0,
      hasRadar: html.includes('综合能力雷达图') && !!document.querySelector('#chRadar'),
      hasZ: html.includes('Z 分数偏差图') && !!document.querySelector('#chZBar'),
      hasFms: html.includes('FMS 功能性动作筛查') && !!document.querySelector('#chFms'),
      hasTrend: html.includes('纵向追踪趋势') && !!document.querySelector('#chTrend'),
      hasTeam: html.includes('团队综合评分排名')
    };
  })()`, (v) => v && v.hasKPI && v.hasRadar && v.hasFms && v.hasTrend && v.hasTeam);
  assert(kpiPage && kpiPage.hasKPI, 'KPI 分析页含 KPI 分析看板');
  assert(kpiPage && kpiPage.hasRadar, 'KPI 分析页含综合能力雷达图');
  assert(kpiPage && kpiPage.hasZ, 'KPI 分析页含 Z 分数偏差图');
  assert(kpiPage && kpiPage.hasFms, 'KPI 分析页含 FMS 筛查卡（档案页数据源 → 分析解读）');
  assert(kpiPage && kpiPage.hasTrend, 'KPI 分析页含纵向追踪趋势');
  assert(kpiPage && kpiPage.hasTeam, 'KPI 分析页含团队综合评分排名');

  // KPI 看板图形化：动态指标总表（1RM+体能+身体成分+自定义去重）+ 变化正负横条图 + FMS 雷达 7 轴
  const kpiRm = await evaluate(`(() => {
    const inst = echarts.getInstanceByDom(document.querySelector('#chKpiPct'));
    const y = inst ? inst.getOption().yAxis[0].data : [];
    const dInst = echarts.getInstanceByDom(document.querySelector('#chKpiDelta'));
    const fmsInst = echarts.getInstanceByDom(document.querySelector('#chFms'));
    return { hasSq: y.includes('颈后深蹲'), hasBody: y.includes('身高') && y.includes('体重') && y.includes('体脂率'),
      dupFree: new Set(y).size === y.length, n: y.length, delta: !!dInst, fmsOpt: fmsInst ? fmsInst.getOption().radar[0].indicator.length : 0 };
  })()`);
  assert(kpiRm && kpiRm.hasSq && kpiRm.dupFree && kpiRm.n >= 5, `KPI 看板图形化：${kpiRm && kpiRm.n} 项动态指标去重无重复（含 1RM 颈后深蹲，不再出现「深蹲1RM」重复行）`);
  assert(kpiRm && kpiRm.hasBody, 'KPI 看板纳入身体成分/平衡指标（身高/体重/体脂率随档案数据自动分析）');
  assert(kpiRm && kpiRm.delta, 'KPI 看板含基线→当前变化正负横条图（增长/下降）');

  // KPI 百分位图均值线标签置顶内侧（修复与横轴刻度重叠）
  const pctMarkPos = await evaluate(`(() => {
    const o = echarts.getInstanceByDom(document.querySelector('#chKpiPct')).getOption();
    return o.series[0].markLine.label.position;
  })()`);
  assert(pctMarkPos === 'insideEndTop', 'KPI 百分位图「均值 50」虚线标签置顶内侧，不再与横轴刻度重叠');

  // 1RM 力量变化看板：动作/时间下拉筛选 + 数据与档案一致
  const rmBoard = await evaluate(`(() => { try {
    const card = document.querySelector('#kpiRmBoard');
    if (!card) return null;
    const exSel = card.querySelector('#rmChartEx'), rgSel = card.querySelector('#rmChartRange');
    const inst = echarts.getInstanceByDom(card.querySelector('#chRmTrend'));
    if (!exSel || !rgSel || !inst) return null;
    const aid = document.querySelector('#kpiAth').value;
    const rm = (Store.data.athleteRm || {})[aid] || {};
    const histOf = (exId) => (((rm[exId] || {}).history || []).filter((h) => h && h.value && h.date));
    const n0 = inst.getOption().series[0].data.length;
    const expect0 = histOf(exSel.value).length;
    const optsN = exSel.options.length;
    // 切换动作 → 图表数据随之变化
    const other = [...exSel.options].map((x) => x.value).find((v) => v !== exSel.value);
    exSel.value = other; exSel.dispatchEvent(new Event('change', { bubbles: true }));
    const inst2 = echarts.getInstanceByDom(document.querySelector('#chRmTrend'));
    const o2 = inst2.getOption();
    const ex2 = Store.exercise(other);
    // 时间范围：近 4 周
    const rg2 = document.querySelector('#rmChartRange');
    rg2.value = '4'; rg2.dispatchEvent(new Event('change', { bubbles: true }));
    const cutoff = U.addDays(U.today(), -28);
    const expect3 = histOf(other).filter((h) => h.date >= cutoff).length;
    const card3 = document.querySelector('#kpiRmBoard');
    const chEl3 = card3.querySelector('#chRmTrend');
    const inst3 = chEl3 ? echarts.getInstanceByDom(chEl3) : null;
    const n3 = inst3 ? inst3.getOption().series[0].data.length : 0;
    const emptyMsg = card3.innerHTML.includes('该时间范围内暂无');
    // 恢复全部时间
    const rg3 = document.querySelector('#rmChartRange'); rg3.value = ''; rg3.dispatchEvent(new Event('change', { bubbles: true }));
    return { n0, expect0, optsN, name1: o2.series[0].name, ex2name: ex2 ? ex2.name : '', n1: o2.series[0].data.length, expect2: histOf(other).length, n3, expect3, emptyMsg };
  } catch (e) { return { err: e.message + ' | ' + (e.stack || '').split('\\n')[1] }; } })()`);
  assert(rmBoard && !rmBoard.err, `1RM 看板断言脚本无异常（${rmBoard && rmBoard.err}）`);
  assert(rmBoard && rmBoard.optsN >= 2 && rmBoard.n0 === rmBoard.expect0, `KPI 页 1RM 力量变化看板（${rmBoard && rmBoard.optsN} 个动作可选，当前 ${rmBoard && rmBoard.n0} 点与档案一致）`);
  assert(rmBoard && rmBoard.name1.includes(rmBoard.ex2name) && rmBoard.n1 === rmBoard.expect2, `1RM 看板动作下拉切换（→ ${rmBoard && rmBoard.name1}，${rmBoard && rmBoard.n1} 点）`);
  assert(rmBoard && (rmBoard.expect3 === 0 ? rmBoard.emptyMsg : rmBoard.n3 === rmBoard.expect3), `1RM 看板时间范围筛选（近4周 ${rmBoard && rmBoard.expect3} 点${rmBoard && rmBoard.expect3 === 0 ? ' → 显示空态提示' : ''}）`);

  // Z 分数偏差图：伪 3D 柱（custom series 三面）+ 数值标柱末端外；趋势图 x 轴日期唯一（同日多次录入合并）
  const z3d = await evaluate(`(() => {
    const zInst = echarts.getInstanceByDom(document.querySelector('#chZBar'));
    const tInst = echarts.getInstanceByDom(document.querySelector('#chTrend'));
    if (!zInst) return null;
    const zOpt = zInst.getOption();
    const tOpt = tInst ? tInst.getOption() : null;
    const tDates = tOpt ? tOpt.xAxis[0].data : [];
    const uniq = new Set(tDates);
    return { custom: zOpt.series[0].type === 'custom', zData: zOpt.series[0].data.length,
      tDates: tDates.length, tUniq: uniq.size, tDupFree: tDates.length === uniq.size };
  })()`);
  assert(z3d && z3d.custom && z3d.zData >= 5, `Z 分数偏差图改为伪 3D 柱状图（custom 三面渲染，${z3d && z3d.zData} 项指标）`);
  assert(z3d && z3d.tDupFree, `趋势图 x 轴日期唯一无重复（${z3d && z3d.tDates} 个趋势点，同日多次录入已合并）`);
  // Z 分数图 x 轴：项目名全部显示且倾斜（interval=0 + rotate，axisCommon 覆盖 bug 已修），底部留白加大
  const zAx = await evaluate(`(() => {
    const inst = echarts.getInstanceByDom(document.querySelector('#chZBar'));
    if (!inst) return null;
    const o = inst.getOption();
    return { n: o.xAxis[0].data.length, interval: o.xAxis[0].axisLabel.interval, rotate: o.xAxis[0].axisLabel.rotate, bottom: o.grid[0].bottom };
  })()`);
  assert(zAx && zAx.interval === 0 && zAx.rotate >= 30 && zAx.bottom >= 85, `Z 分数图项目名全部倾斜显示不覆盖（${zAx && zAx.n} 项 rotate ${zAx && zAx.rotate}°，底部留白 ${zAx && zAx.bottom}px）`);
  assert(kpiRm && kpiRm.fmsOpt === 7, `FMS 个人雷达图渲染，7 轴指标 (${kpiRm && kpiRm.fmsOpt})`);

  // FMS 分数表：雷达图旁以表格展示七项得分（最新 + 基线列，≤1 分标红）
  const fmsTbl = await evaluate(`(() => {
    const read = () => {
      const c = document.querySelector('#kpiFms');
      const tbl = c ? c.querySelector('table.tbl') : null;
      if (!tbl) return { hasTbl: false };
      const rows = [...tbl.querySelectorAll('tbody tr')];
      const ths = [...tbl.querySelectorAll('thead th')].map((t) => t.textContent.trim());
      const probe = document.createElement('span'); probe.style.color = 'var(--color-danger)'; document.body.appendChild(probe);
      const dangerCss = getComputedStyle(probe).color;
      return { hasTbl: true, ths, n: rows.length, hasBase: ths.includes('基线'),
        lowRed: rows.some((tr) => { const td = tr.children[1]; return td && getComputedStyle(td).color === dangerCss; }) };
    };
    const r = read();
    // 切到刘致远 + 最早时期（基线 12 分含 hurdle/tspu 1 分）验证弱项标红，随后恢复陈浩·最新
    const d = document.querySelector('#kpiDate'), a = document.querySelector('#kpiAth');
    const li = a ? [...a.options].find((o) => o.textContent === '刘致远') : null;
    if (!(r.hasTbl && li && d && d.options.length >= 2)) return Object.assign(r, { lowLowRed: null });
    a.value = li.value; a.dispatchEvent(new Event('change', { bubbles: true }));
    d.selectedIndex = 1; d.dispatchEvent(new Event('change', { bubbles: true }));
    const low = read();
    d.value = ''; d.dispatchEvent(new Event('change', { bubbles: true }));
    const wang = Store.data.athletes.find((x) => x.name === '陈浩');
    a.value = wang.id; a.dispatchEvent(new Event('change', { bubbles: true }));
    return Object.assign(r, { lowLowRed: low.hasTbl ? low.lowRed : null });
  })()`);
  assert(fmsTbl && fmsTbl.hasTbl && fmsTbl.n === 7 && fmsTbl.ths[0] === '动作模式' && fmsTbl.ths[1] === '最新得分', `FMS 分数以表格展示在雷达图旁（${fmsTbl && fmsTbl.n} 行：动作模式/最新得分）`);
  assert(fmsTbl && fmsTbl.hasBase, 'FMS 表格含基线对照列（最新 vs 基线）');
  assert(fmsTbl && fmsTbl.lowLowRed === true, 'FMS 表格 ≤1 分弱项标红（刘致远基线 12 分）');

  // 纵向追踪趋势测试项目下拉：全部指标 / 体能指标 / 1RM 动作，切换单项目视图后恢复
  const trendSel = await evaluate(`(() => {
    const sel = document.querySelector('#trendSel');
    const box = document.querySelector('#chTrend');
    if (!(sel && box)) return null;
    const cnt = (b) => echarts.getInstanceByDom(b).getOption().series.filter((s) => s.data && s.data.length).length;
    const n0 = cnt(box);
    const opt1rm = [...sel.options].find((o) => o.value.startsWith('r:'));
    if (!opt1rm) return { opts: sel.options.length, n0, hasR: false };
    sel.value = opt1rm.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const box2 = document.querySelector('#chTrend');
    const o = echarts.getInstanceByDom(box2).getOption();
    const single = { yAxis: o.yAxis[0].name, one: o.series.filter((s) => s.data && s.data.length).length,
      dashed: !!(o.series[0].lineStyle && o.series[0].lineStyle.type === 'dashed'), kgVals: o.series[0].data.filter((v) => v != null).length };
    sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true }));
    const back = cnt(document.querySelector('#chTrend'));
    return { opts: sel.options.length, n0, hasR: true, label: opt1rm.textContent, single, back };
  })()`);
  assert(trendSel && trendSel.opts >= 3 && trendSel.n0 >= 2, `纵向追踪趋势含测试项目下拉（${trendSel && trendSel.opts} 个选项，默认多指标组合）`);
  assert(trendSel && trendSel.hasR && trendSel.single.yAxis === 'kg' && trendSel.single.one === 1 && trendSel.single.dashed && trendSel.single.kgVals >= 2, `下拉切换单项目视图：${trendSel && trendSel.label}（kg 实际测定值单线）`);
  assert(trendSel && trendSel.back >= 2, '下拉切回全部指标恢复多线组合视图');

  // 纵向追踪趋势改版：指标小卡移到图表左侧并显示全部指标；点击小卡切换单指标；「全部指标」显示全部体能+1RM 系列且图例完整
  const trendLayout = await evaluate(`(() => { try {
    const box = document.querySelector('#chTrend');
    const card = box ? box.closest('.card') : null;
    const sel = document.querySelector('#trendSel');
    if (!card || !sel) return null;
    const chips = [...card.querySelectorAll('[data-trend-metric]')];
    const pOpts = [...sel.options].filter((o) => o.value.startsWith('p:')).length;
    const rOpts = [...sel.options].filter((o) => o.value.startsWith('r:')).length;
    const hasRmCard = chips.some((c) => c.dataset.trendMetric.startsWith('r:'));
    const o0 = echarts.getInstanceByDom(box).getOption();
    const allN = o0.series.filter((s) => s.data && s.data.length).length;
    const legendType = (o0.legend && o0.legend[0] && o0.legend[0].type) || 'plain';
    let leftOk = false;
    if (chips.length) {
      const c0 = chips[0].getBoundingClientRect();
      leftOk = c0.right <= box.getBoundingClientRect().left + 20;
    }
    // 点击第一个小卡 → 切换到该指标单视图
    let clicked = null;
    if (chips.length) {
      const key = chips[0].dataset.trendMetric;
      chips[0].click();
      const s1 = document.querySelector('#trendSel');
      clicked = { key, val: s1 ? s1.value : null };
    }
    // 切回全部指标
    const s2 = document.querySelector('#trendSel'); s2.value = ''; s2.dispatchEvent(new Event('change', { bubbles: true }));
    return { n: chips.length, pOpts, rOpts, hasRmCard, allN, legendType, leftOk, clicked };
  } catch (e) { return { err: e.message }; } })()`);
  assert(trendLayout && !trendLayout.err && trendLayout.leftOk && trendLayout.n >= 5 && trendLayout.n === trendLayout.pOpts + trendLayout.rOpts, `趋势指标小卡移到图表左侧且显示全部指标（${trendLayout && trendLayout.n} 张 = 体能/自定义 ${trendLayout && trendLayout.pOpts} + 1RM ${trendLayout && trendLayout.rOpts}，与下拉数量一致）`);
  assert(trendLayout && trendLayout.hasRmCard, '纵向追踪左侧含 1RM 指标小卡（kg 基线→当前）');
  assert(trendLayout && trendLayout.clicked && trendLayout.clicked.key === trendLayout.clicked.val, '点击左侧指标小卡即切换图表到该指标');
  assert(trendLayout && trendLayout.allN >= trendLayout.pOpts, `「全部指标」视图显示全部系列（${trendLayout && trendLayout.allN} 条 ≥ 体能指标 ${trendLayout && trendLayout.pOpts} 条，图例 ${trendLayout && trendLayout.legendType}）`);

  // KPI 数据更新自动重算：Store.save() 后 rev 自增且看板自动重挂载（新增 1RM/体能数据无需手动刷新）
  const autoRe = await evaluate(`(() => {
    const r0 = Store.rev;
    const b0 = document.querySelector('#kpiBody');
    if (!b0) return null;
    b0.dataset.stamp = 'pre';
    Store.save();
    const b1 = document.querySelector('#kpiBody');
    return { inc: Store.rev === r0 + 1, stampGone: !!b1 && !b1.dataset.stamp, chartBack: !!document.querySelector('#chKpiPct') };
  })()`);
  assert(autoRe && autoRe.inc && autoRe.stampGone && autoRe.chartBack, 'KPI 页数据更新自动重算（Store.save() 后 rev 自增、看板自动重挂载）');

  // 筛选条：时期切换 → 看板按该时点重算（头部 chip 随时期变化）；姓名切换 → 看板换人
  const filt0 = await evaluate(`(() => {
    const d = document.querySelector('#kpiDate'), a = document.querySelector('#kpiAth');
    const chips = [...document.querySelectorAll('#view .chip')].map((c) => c.textContent.trim());
    return { hasDate: !!d, hasAth: !!a, opts: d ? d.querySelectorAll('option').length : 0,
      arch: chips.find((t) => t.startsWith('档案')) || '', rm: chips.find((t) => t.startsWith('1RM')) || '' };
  })()`);
  assert(filt0 && filt0.hasDate && filt0.hasAth && filt0.opts >= 3, `筛选条含姓名+时期下拉（${filt0 && filt0.opts} 个时期选项）`);

  // 姓名下拉只含有测试数据的运动员（9d 新建的周跳跳无测试数据，不出现）
  const kpiOnly = await evaluate(`(() => {
    const names = [...document.querySelector('#kpiAth').options].map((o) => o.textContent);
    return { n: names.length, hasZhou: names.includes('周跳跳'), noAddHint: !document.querySelector('#view').innerHTML.includes('暂无运动员') };
  })()`);
  assert(kpiOnly && kpiOnly.n >= 2 && !kpiOnly.hasZhou && kpiOnly.noAddHint, `KPI 面板不添加运动员：仅列出有测试数据的 ${kpiOnly && kpiOnly.n} 人（周跳跳不出现）`);

  await evaluate(`(() => {
    const d = document.querySelector('#kpiDate');
    d.selectedIndex = 1;   // 最早数据时点
    d.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(800);
  const filt1 = await evaluate(`(() => {
    const chips = [...document.querySelectorAll('#view .chip')].map((c) => c.textContent.trim());
    return { date: document.querySelector('#kpiDate').value,
      arch: chips.find((t) => t.startsWith('档案')) || '', rm: chips.find((t) => t.startsWith('1RM')) || '' };
  })()`);
  assert(filt1 && filt1.date && (filt1.arch !== filt0.arch || filt1.rm !== filt0.rm), `时期筛选联动：最新「${filt0.arch} · ${filt0.rm}」→ ${filt1.date}「${filt1.arch} · ${filt1.rm}」`);

  await evaluate(`(() => {
    const a = document.querySelector('#kpiAth');
    const other = [...a.options].find((o) => o.textContent !== '陈浩');
    a.value = other.value; a.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(800);
  const filt2 = await evaluate(`(() => ({
    head: document.querySelector('#kpiHeadName') ? document.querySelector('#kpiHeadName').textContent : '',
    sel: document.querySelector('#kpiAth') ? document.querySelector('#kpiAth').selectedOptions[0].textContent : ''
  }))()`);
  assert(filt2 && filt2.head === filt2.sel && filt2.head !== '陈浩', `姓名筛选联动：看板切换到「${filt2 && filt2.head}」`);

  // 1RM 力量变化看板跟随顶部运动员下拉：动作选项与当前运动员的 1RM 档案一致
  const rmFollow = await evaluate(`(() => {
    const card = document.querySelector('#kpiRmBoard');
    if (!card) return { has: false };
    const aid = document.querySelector('#kpiAth').value;
    const rm = (Store.data.athleteRm || {})[aid] || {};
    const withHist = Object.keys(rm).filter((k) => ((rm[k].history || []).filter((h) => h && h.value && h.date)).length > 0).sort();
    const opts = [...card.querySelectorAll('#rmChartEx option')].map((o) => o.value).sort();
    return { has: true, ok: JSON.stringify(opts) === JSON.stringify(withHist), n: opts.length };
  })()`);
  assert(rmFollow && rmFollow.has && rmFollow.ok, `1RM 看板跟随运动员下拉切换（当前运动员 ${rmFollow && rmFollow.n} 个动作可选）`);

  // 回到陈浩（最新数据）：纵向趋势明确显示 增长/下降 方向
  await evaluate(`(() => {
    const d = document.querySelector('#kpiDate');
    if (d) { d.value = ''; d.dispatchEvent(new Event('change', { bubbles: true })); }
    return 'ok';
  })()`);
  await sleep(600);
  await evaluate(`(() => {
    const wang = Store.data.athletes.find((x) => x.name === '陈浩');
    const a = document.querySelector('#kpiAth');
    a.value = wang.id; a.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(800);
  const trendWord = await evaluate(`(() => {
    const html = document.querySelector('#view').innerHTML;
    return { hasTrend: html.includes('纵向追踪趋势'), hasWord: html.includes('增长') || html.includes('下降'), hasArrow: html.includes('↑') || html.includes('↓') };
  })()`);
  assert(trendWord && trendWord.hasTrend && trendWord.hasWord && trendWord.hasArrow, '纵向追踪趋势明确标注 增长/下降（↑↓ + 方向文字）');

  // 6. 负荷看板：个人/团队模式 + 日期/中周期/小周期筛选 + 8 指标 + 10 图
  await evaluate(`location.hash = "#/load"; window.dispatchEvent(new Event("hashchange")); "ok"`);
  await sleep(800);
  const ld = await evaluate(`(() => {
    const metrics = [...document.querySelectorAll('.load-metric')].map((c) => c.querySelector('.k').textContent.trim());
    const chartIds = ['loadDailyChart', 'loadRiskChart', 'loadAcwrGauge', 'loadTsbGauge', 'loadTonnageChart', 'loadSessionChart', 'loadTypeChart', 'loadTypeTimeChart', 'loadDistanceChart', 'loadWorkTimeChart'];
    const chartsOk = chartIds.every((id) => { const el = document.getElementById(id); return el && el.innerHTML.trim().length > 0; });
    return {
      n: metrics.length, metrics, chartsOk,
      hasMode: !!document.querySelector('#modePersonal') && !!document.querySelector('#modeTeam'),
      hasDate: !!document.querySelector('#loadDateFrom') && !!document.querySelector('#loadDateTo'),
      hasMesoFilter: !!document.querySelector('#loadMesoFilter'),
      hasMicroFilter: !!document.querySelector('#loadMicroFilter'),
      personalActive: document.querySelector('#modePersonal').classList.contains('primary')
    };
  })()`);
  assert(ld && ld.n === 8 && ld.hasMode && ld.hasDate && ld.hasMesoFilter && ld.hasMicroFilter && ld.personalActive,
    `负荷看板：8 指标 + 个人/团队模式 + 日期/中周期/小周期筛选（指标 ${ld && ld.n} 个）`);
  assert(ld && ld.chartsOk, '负荷看板 10 图全部渲染');
  // 七大训练模块：目标库分类 + 课型模块
  const mods = await evaluate(`(() => {
    const cats = Store.allGoalCats().map(c => c.name).slice(0, 7);
    const expect = ['力量训练', '代谢训练', '技/战术', '多方向速度', '恢复与再生', '心理与认知', '营养管理'];
    const nutGoal = Store.data.goals.find(g => g.name === '水化管理');
    return { cats, expect, allSeven: expect.every(n => cats.includes(n)), nutGoal: !!nutGoal, modTypes: Store.TRAIN_MODULES.length === 8 && Store.moduleOfType('有氧耐力') === '代谢训练' };
  })()`);
  assert(mods && mods.allSeven && mods.nutGoal && mods.modTypes, '训练目标重构为七大模块（含水化管理等营养目标），课型按模块归类');
  // 团队模式：汇总全队并隐藏运动员下拉
  await evaluate(`document.querySelector('#modeTeam').click(); 'ok'`);
  await sleep(700);
  const teamView = await evaluate(`(() => ({
    teamActive: document.querySelector('#modeTeam').classList.contains('primary'),
    noAthSel: !document.querySelector('#athSel'),
    scope: (document.querySelector('.load-filter-context') || {}).textContent || ''
  }))()`);
  assert(teamView && teamView.teamActive && teamView.noAthSel && teamView.scope.includes('全队'), '团队负荷模式汇总全队并隐藏运动员下拉');
  // 中周期筛选 → 日期范围联动；小周期筛选 → 中周期+日期联动
  const linkChk = await evaluate(`(() => {
    const mesoSel = document.querySelector('#loadMesoFilter');
    const meso = Store.data.mesos.find((m) => m.macroId === Store.activeMacro().id && Store.microsOf(m.id).length);
    mesoSel.value = meso.id; mesoSel.dispatchEvent(new Event('change', { bubbles: true }));
    const afterMeso = { from: document.querySelector('#loadDateFrom').value, to: document.querySelector('#loadDateTo').value };
    const microSel = document.querySelector('#loadMicroFilter');
    const mic = Store.microsOf(meso.id)[0];
    microSel.value = mic.id; microSel.dispatchEvent(new Event('change', { bubbles: true }));
    const afterMicro = { from: document.querySelector('#loadDateFrom').value, to: document.querySelector('#loadDateTo').value, mesoVal: document.querySelector('#loadMesoFilter').value };
    return { mesoOk: afterMeso.from === meso.startDate && afterMeso.to === meso.endDate,
      microOk: afterMicro.from === mic.startDate && afterMicro.to === mic.endDate && afterMicro.mesoVal === meso.id };
  })()`);
  await sleep(500);
  assert(linkChk && linkChk.mesoOk, '中周期筛选联动日期范围');
  assert(linkChk && linkChk.microOk, '小周期筛选联动中周期与日期范围');

  // session 页：组块 + 逐组展开（跳到含 %1RM 力量课的日期，确保存在 .ex-expand 入口）
  await evaluate(`location.hash = "#/session"; window.dispatchEvent(new Event("hashchange")); "ok"`);
  await sleep(800);
  await evaluate(`(() => {
    const pick = document.querySelector('#dPick');
    pick.value = '${dForce}'; pick.dispatchEvent(new Event('change', { bubbles: true }));
    return 'ok';
  })()`);
  await sleep(800);
  // 确保有课程卡
  const hasSesCard = await evaluate(`document.querySelectorAll('[data-ses]').length > 0`);
  if (!hasSesCard) {
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('添加本日课程'))?.click()`);
    await sleep(800);
  }
  // 确保有 2 个动作行
  await evaluate(`(() => {
    const add = document.querySelector('.ex-add');
    if (add) { add.click(); add.click(); }
    return document.querySelectorAll('.extable tbody tr[data-i]').length;
  })()`);
  await sleep(800);
  const blockRes = await evaluate(`(() => {
    const picks = document.querySelectorAll('.ex-pick');
    picks.forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    const mk = document.querySelector('.ex-mk-blk');
    if (mk) mk.click();
    return { blkHead: !!document.querySelector('.blk-head'), badges: document.querySelectorAll('.blk-badge').length };
  })()`);
  await sleep(600);
  assert(blockRes.blkHead && blockRes.badges >= 2, '训练课：勾选多动作组成超级组（块头条+角标）');

  const expandRes = await evaluate(`(() => {
    const btn = document.querySelector('[data-ath-expand]');
    if (btn) btn.click();
    return {
      sdRow: !!document.querySelector('.sd-log-row'),
      kinds: Array.from(document.querySelectorAll('.sd-kind')).map(e => e.textContent.trim()),
      hasAddWarm: !!document.querySelector('.ex-ath-add-warm'),
      hasAddWork: !!document.querySelector('.ex-ath-add-work')
    };
  })()`);
  await sleep(500);
  assert(expandRes.sdRow && expandRes.kinds.length >= 1 && expandRes.hasAddWarm && expandRes.hasAddWork,
    '训练课：逐组展开（热身/正式组 + 添加组按钮）');

  // 7. 其余页面快速冒烟
  for (const r of ['meso', 'micro', 'session', 'load', 'exercises', 'profile', 'kpi']) {
    await evaluate(`location.hash = "#/${r}"; window.dispatchEvent(new Event("hashchange")); "ok"`);
    await sleep(700);
    const ok = await evaluate(`document.querySelector('#view').innerHTML.length > 500`);
    assert(ok, '页面挂载 ' + r);
  }
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOT_DIR, 'last-page.png'), Buffer.from(shot2.result.data, 'base64'));

  const appErrors = consoleErrors.filter((e) => e && !/favicon|ERR_CONNECTION|Autofill/.test(e));
  assert(appErrors.length === 0, '无应用级 console 错误' + (appErrors.length ? '：' + appErrors[0] : ''));

  const fails = results.filter((r) => !r[0]).length;
  console.log(fails ? `\n== ${fails} 项失败 ==` : '\n== 全部通过 ==');
  await finalize(fails ? 1 : 0);
})().catch(async (e) => { console.error('E2E CRASH:', e.message); await finalize(2); });
