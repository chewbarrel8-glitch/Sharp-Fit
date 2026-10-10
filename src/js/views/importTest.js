// Excel 测试数据导入向导：兼容格式不统一的 .xlsx/.xls/.csv
// 流程：选文件/sheet/表头行 → 宽表或长表列映射 → 姓名对碰档案 → 预览校验 → 入库（可整批撤销、映射可存模板）
// 写入体能档案 profiles（自定义项目进 custom）与 athleteRm（1RM），KPI 实验室 14 种分析直接可用；全程规则映射，无 AI
Views.importTest = (() => {
  const P = Views.profile;
  const xlsxF = () => (typeof window !== 'undefined' && window.XLSX) ? window.XLSX : globalThis.XLSX;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];

  // ---------------- 纯函数：清洗与解析（冒烟测试直接调用） ----------------

  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtYMD = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

  // 日期识别：Date / Excel 序列号 / 2026-10-8 / 2026/10/8 / 2026年10月8日 / 10月8日（补默认年份）/ 20261008
  function parseDate(v, defaultYear) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return fmtYMD(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' && isFinite(v)) {
      try {
        const dc = xlsxF() && xlsxF().SSF ? xlsxF().SSF.parse_date_code(v) : null;
        if (dc && dc.y) return fmtYMD(dc.y, dc.m, dc.d);
      } catch (e) { /* fall through */ }
      return null;
    }
    const s = String(v).trim();
    if (!s) return null;
    let m = s.match(/(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/);
    if (m) return fmtYMD(+m[1], +m[2], +m[3]);
    m = s.match(/(20\d{2})(\d{2})(\d{2})/);
    if (m) return fmtYMD(+m[1], +m[2], +m[3]);
    m = s.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
    if (m) return fmtYMD(defaultYear, +m[1], +m[2]);
    m = s.match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})$/);
    if (m) return fmtYMD(defaultYear, +m[1], +m[2]);
    return null;
  }

  const EMPTY_TOKENS = new Set(['', '-', '—', '--', '/', '.', '无', '未测', '缺', '缺席', '免测', 'n/a', 'na', 'null', 'x', '×']);
  // 数值识别：剥离常见单位/前后缀，提取首个数字；空/未测类记号返回 empty（跳过不计错）
  function parseNum(v) {
    if (v == null) return { empty: true };
    if (typeof v === 'number') return isFinite(v) ? { value: v } : { bad: String(v) };
    const s = String(v).trim();
    if (!s || EMPTY_TOKENS.has(s.toLowerCase())) return { empty: true };
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return { bad: s };
    const n = parseFloat(m[0]);
    return isFinite(n) ? { value: n } : { bad: s };
  }

  // 表头行自动识别：前 12 行中非空单元格最多（文字单元格加权）的一行
  function detectHeaderRow(matrix) {
    let best = 0, bestScore = -1;
    for (let i = 0; i < Math.min(12, matrix.length); i++) {
      const row = matrix[i] || [];
      const non = row.filter((c) => c != null && String(c).trim() !== '').length;
      if (!non) continue;
      const txt = row.filter((c) => typeof c === 'string' && c.trim()).length;
      const score = non + Math.min(txt, non) * 0.5;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function cellText(c) {
    if (c == null) return '';
    if (c instanceof Date && !isNaN(c)) return fmtYMD(c.getFullYear(), c.getMonth() + 1, c.getDate());
    return String(c).trim();
  }

  const norm = (s) => String(s == null ? '' : s).trim().toLowerCase()
    .replace(/[\s　()（）\[\]【】{}:：;；,，.。/／\\|·\-—_*#]/g, '');

  // 常见表头别名 → 系统项目名（其余按文字包含自动匹配）
  const ALIAS = {
    '30米': '30m冲刺', '30米跑': '30m冲刺', '30m': '30m冲刺', '30m跑': '30m冲刺',
    '20米': '20m冲刺', '20米跑': '20m冲刺', '20m': '20m冲刺',
    '10米': '10m冲刺', '10米跑': '10m冲刺', '5米': '5m冲刺',
    '纵跳摸高': '纵跳', '摸高': '纵跳', 'cmj': '反向纵跳CMJ', '深蹲': '深蹲1RM',
    '卧推': '卧推1RM', '硬拉': '硬拉1RM', '深蹲最大力量': '深蹲1RM'
  };

  // 可映射目标：系统体能库/固定字段/1RM + 用户已建自定义项目
  function listTargets() {
    const out = [];
    const seen = new Set();
    const push = (t) => { if (!seen.has(t.key)) { seen.add(t.key); out.push(t); } };
    P.METRICS.filter((m) => m.source === '1rm').forEach((m) =>
      push({ key: 'r::' + m.exName, mode: 'rm1', name: m.label, exName: m.exName, unit: 'kg', invert: false, cat: '力量1RM' }));
    const fieldSeen = new Set();
    const pushField = (name, field, unit, invert, cat) => {
      if (fieldSeen.has(field)) return;
      fieldSeen.add(field);
      push({ key: 'f::' + field, mode: 'field', name, field, unit: unit || '', invert: !!invert, cat: cat || '体能' });
    };
    P.METRICS.filter((m) => m.source === 'profile').forEach((m) => pushField(m.label, m.field, m.unit, m.invert, m.cat));
    P.bodyMetrics().forEach((m) => pushField(m.label, m.field, m.unit, m.invert, m.cat));
    P.testLibrary().forEach((t) => {
      if (t.field) pushField(t.name, t.field, t.unit, t.invert, t.cat);
      else push({ key: 'n::' + t.name, mode: 'named', name: t.name, unit: t.unit || '', invert: !!t.invert, cat: t.cat || '体能' });
    });
    (P.testItems() || []).forEach((t) => {
      if (!t || t.special) return;
      if (!out.some((x) => (x.mode === 'named' || x.mode === 'field') && x.name === t.name))
        push({ key: 'n::' + t.name, mode: 'named', name: t.name, unit: t.unit || '', invert: !!t.invert, cat: '自定义' });
    });
    return out;
  }

  // 宽表表头 → 推荐目标（无推荐返回 null = 新建自定义）
  function suggestTarget(header, targets) {
    const hRaw = String(header || '').trim();
    const h = norm(hRaw);
    if (!h) return null;
    // 去掉表头末尾的单位后缀（如「纵跳(cm)」归一化后为「纵跳cm」），避免误含到「反向纵跳cmj」
    const h2 = h.replace(/(厘米|毫米|公斤|千克|公里|km\/h|cm|mm|kg|sec|min|bpm|秒|米|斤|次|个|名|分|度|%|m|s|h)$/g, '');
    if (ALIAS[h] || (h2 && ALIAS[h2])) {
      const t = targets.find((x) => norm(x.name) === norm(ALIAS[h] || ALIAS[h2]));
      if (t) return t;
    }
    let best = null, bestLen = Infinity;
    for (const t of targets) {
      const tn = norm(t.name);
      if (!tn) continue;
      if (tn === h || (h2 && tn === h2)) return t;
    }
    for (const t of targets) {
      const tn = norm(t.name);
      if ((tn.includes(h) && h.length >= 2) || (h.includes(tn) && tn.length >= 3)
        || (h2 && tn.includes(h2) && h2.length >= 2) || (h2 && h2.includes(tn) && tn.length >= 3)) {
        if (tn.length < bestLen) { bestLen = tn.length; best = t; }
      }
    }
    return best;
  }

  const UNIT_CN = { '秒': 's', '毫秒': 'ms', '分钟': 'min', '分': 'min', '千克': 'kg', '公斤': 'kg', '厘米': 'cm', '米': 'm', '次': '次', '个': '次' };
  function normUnit(u) {
    const s = String(u == null ? '' : u).trim().toLowerCase().replace(/\s/g, '');
    if (!s) return '';
    return UNIT_CN[s] || s;
  }
  const guessInvert = (unit) => ['s', 'ms', 'min'].includes(String(unit || '').toLowerCase());

  // 探查既有数据（预览冲突用）
  function probeCurrent(athId, date, it) {
    const d = Store.data;
    if (it.mode === 'rm1') {
      const ex = d.exercises.find((e) => e.name === it.exName);
      if (!ex) return { found: false, missingEx: true };
      const rec = (d.athleteRm || {})[athId] && (d.athleteRm || {})[athId][ex.id];
      const h = (rec && rec.history || []).find((x) => x.date === date);
      return h ? { found: true, value: h.value } : { found: false };
    }
    const pf = (d.profiles || []).find((p) => p.athleteId === athId && p.date === date);
    if (!pf) return { found: false };
    if (it.field) return pf[it.field] != null ? { found: true, value: pf[it.field] } : { found: false };
    const c = (pf.custom || []).find((x) => x.name === it.name);
    return c && c.value != null ? { found: true, value: c.value } : { found: false };
  }

  // 核心：按映射配置把二维数据清洗为记录（纯数据，不写库）
  // spec.cols（宽表）：[{ci, mode:'field'|'named'|'rm1'|'new'|'ignore', key, name, unit, invert}]
  // spec.actions：Map(表中姓名 → {t:'match',id} | {t:'new'} | {t:'skip'})
  function buildRecords(spec) {
    const { dataRows, format, ciName, ciName2, ciDate, ciPos, fixedDate, year, cols, ciItem, ciValue, ciUnit, targets, actions, dup } = spec;
    const byName = new Map(targets.map((t) => [norm(t.name), t]));
    const records = [], errors = [];
    let validItems = 0, conflictN = 0;

    const pushConflict = (rec, it) => {
      const probe = probeCurrent(rec.action.id, rec.date, it);
      if (probe.missingEx) { errors.push({ rno: rec.rno, name: rec.rawName, item: it.name, msg: '系统动作库中找不到「' + it.exName + '」，该 1RM 未导入' }); return false; }
      if (probe.found && probe.value !== it.value) { it.conflict = true; conflictN++; return dup !== 'skip'; }
      return true;
    };

    dataRows.forEach((cells, i) => {
      const rno = spec.rnoBase + i;   // Excel 实际行号
      const parts = [cells[ciName], ciName2 >= 0 ? cells[ciName2] : null]
        .filter((x) => x != null && String(x).trim() !== '').map((x) => String(x).trim());
      const rawName = parts.join('');
      const rowHasData = cells.some((c, idx) => idx !== ciName && idx !== ciName2 && c != null && String(c).trim() !== '');
      if (!rawName) { if (rowHasData) errors.push({ rno, msg: '该行有数据但姓名为空，已跳过' }); return; }
      const act = actions.get(rawName) || { t: 'new' };
      if (act.t === 'skip') return;
      const date = ciDate === -2 ? (fixedDate || null) : parseDate(cells[ciDate], year);
      if (!date) {
        errors.push({ rno, name: rawName, msg: '日期无法识别：' + (ciDate >= 0 ? '「' + cellText(cells[ciDate]).slice(0, 15) + '」' : '未设置统一日期') });
        return;
      }
      const rec = { rno, rawName, action: act, date, items: [], position: ciPos >= 0 ? cellText(cells[ciPos]).trim() : '' };

      if (format === 'wide') {
        for (const c of cols) {
          if (!c || c.mode === 'ignore') continue;
          const pn = parseNum(cells[c.ci]);
          if (pn.empty) continue;
          if (pn.bad != null) { errors.push({ rno, name: rawName, item: c.name, msg: '数值无法识别：「' + pn.bad + '」' }); continue; }
          let it;
          if (c.mode === 'new') it = { mode: 'new', name: c.name, unit: c.unit || '', invert: !!c.invert, value: pn.value };
          else {
            const t = targets.find((x) => x.key === c.key);
            if (!t) continue;
            it = { mode: t.mode, name: t.name, field: t.field, exName: t.exName, unit: t.unit, invert: !!t.invert, value: pn.value };
          }
          if (act.t === 'match' && !pushConflict(rec, it)) continue;
          rec.items.push(it); validItems++;
        }
      } else {
        const itemName = cellText(cells[ciItem]);
        if (!itemName) return;
        const pn = parseNum(cells[ciValue]);
        if (pn.empty) return;
        if (pn.bad != null) { errors.push({ rno, name: rawName, item: itemName, msg: '数值无法识别：「' + pn.bad + '」' }); return; }
        const t = byName.get(norm(itemName));
        const unitRaw = ciUnit >= 0 ? normUnit(cells[ciUnit]) : '';
        const it = t
          ? { mode: t.mode, name: t.name, field: t.field, exName: t.exName, unit: t.unit, invert: !!t.invert, value: pn.value }
          : { mode: 'new', name: itemName, unit: unitRaw, invert: guessInvert(unitRaw), value: pn.value };
        if (act.t === 'match' && !pushConflict(rec, it)) return;
        rec.items.push(it); validItems++;
      }
      if (rec.items.length) records.push(rec);
    });

    const newAths = [...new Set(records.filter((r) => r.action.t === 'new').map((r) => r.rawName))];
    const newItems = [...new Set(records.flatMap((r) => r.items).filter((it) => it.mode === 'new').map((it) => it.name))];
    return { records, errors, validItems, conflictN, newAths, newItems };
  }

  // 姓名归一化匹配（精确 → 包含）
  // 姓名对碰仅限当前训练计划名单：其他计划的同名者不能匹配，否则导入数据会写到用户在当前页面看不到的人身上
  // （并在重新导入时不断把数据堆到其他计划的同名运动员）；无活动计划时回退为全局匹配
  function matchAthlete(raw) {
    const mac = Store.activeMacro ? Store.activeMacro() : null;
    let aths = Store.data.athletes || [];
    if (mac) aths = aths.filter((a) => a.macroId === mac.id);
    const h = norm(raw);
    if (!h) return null;
    return aths.find((a) => norm(a.name) === h)
      || aths.find((a) => { const n = norm(a.name); return n.length >= 2 && n.includes(h); })
      || aths.find((a) => { const n = norm(a.name); return n.length >= 2 && h.includes(n); })
      || null;
  }

  // ---------------- 导入向导 UI ----------------
  const STEP_NAMES = ['选择文件', '列映射', '姓名对碰', '预览导入'];
  let S = null;
  let ovEl = null;
  let optsCb = null;

  function freshState() {
    return {
      step: 0, fileName: '', sheets: [], sheetIdx: 0, headerRow: 0,
      format: 'wide', ciName: 0, ciName2: -1, ciDate: -1, ciPos: -1, fixedDate: '', year: new Date().getFullYear(),
      ciItem: -1, ciValue: -1, ciUnit: -1, cols: [],
      nameActions: new Map(), dup: 'skip', saveTpl: false, tplName: '', tplId: null,
      result: null, appliedTplId: null
    };
  }

  // 默认入口：极简全自动——用户只需选文件，系统自动识别排版/列/日期/姓名并直接导入，全程无需点击与选择
  function open(opts) {
    if (document.getElementById('impAutoWrap') || document.getElementById('impWrap')) return;
    optsCb = (opts && opts.onImported) || null;
    UI.modal({
      title: '导入体能测试数据',
      body: `
        <div id="impAutoBox">
          <p class="hint" style="font-size:12.5px;margin:0 0 14px;line-height:1.9">
            选择 Excel 文件后，系统会<b>自动识别排版</b>（宽表/长表、表头行、姓名列、日期列、测试项目）并<b>直接整理导入</b>，无需任何设置。<br>
            可按住 <b>Ctrl / ⌘</b> 一次选择多个文件，或选择含多个工作表的文件。
          </p>
          <input type="file" id="impAutoFile" accept=".xlsx,.xls,.csv" multiple
            style="width:100%;font-size:13px;padding:10px;border:1px dashed var(--line);border-radius:10px;background:color-mix(in oklch,var(--muted) 6%,transparent)">
          <p id="impAutoMsg" class="hint" style="font-size:12px;margin:12px 0 0;min-height:18px"></p>
        </div>`,
      footer: `<button class="btn ghost" type="button" data-imp-manual title="自动识别结果不对时，可手动指定工作表、表头行与列映射">识别结果不对？手动调整</button><button class="btn ghost" data-x>取消</button>`,
      onMount(ov, close) {
        ov.closest('.overlay').id = 'impAutoWrap';
        const msg = ov.querySelector('#impAutoMsg');
        ov.querySelector('[data-imp-manual]').onclick = () => { close(); openManual(opts); };
        ov.querySelector('#impAutoFile').onchange = async (e) => {
          const picked = e.target.files ? [...e.target.files] : [];
          if (!picked.length) return;
          msg.textContent = '正在识别 ' + picked.length + ' 个文件…';
          let analyzed;
          try {
            analyzed = await autoAnalyze(picked);
          } catch (err) {
            msg.innerHTML = '<span style="color:var(--color-danger)">文件解析失败：' + U.esc(err.message) + '</span>';
            return;
          }
          const totalItems = analyzed.reduce((n, f) => n + f.sheets.reduce((m, s) => m + (s.ok ? s.stats.items : 0), 0), 0);
          if (!totalItems) {
            const skipped = analyzed.flatMap((f) => f.sheets.filter((s) => !s.ok).map((s) => f.file + '：' + s.reason));
            msg.innerHTML = '<span style="color:var(--color-danger)">未识别到可导入的数据' + (skipped.length ? '（' + U.esc(skipped.join('；')) + '）' : '') + '，可点左下角「手动调整」</span>';
            e.target.value = '';
            return;
          }
          close();
          executeAutoImport(analyzed);
        };
      }
    });
  }

  // 高级入口：四步手动向导（自动识别结果不对时兜底）
  function openManual(opts) {
    if (document.getElementById('impWrap')) return;
    optsCb = (opts && opts.onImported) || null;
    S = freshState();
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'impWrap';
    ov.innerHTML = `
      <style>
        #impWrap{z-index:95;padding:18px;overflow:auto}
        #impWrap .imp-modal{max-width:1080px;margin:0 auto;background:var(--color-surface);border:1px solid var(--line);border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.35)}
        #impWrap .imp-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line)}
        #impWrap .imp-steps{display:flex;gap:6px;font-size:12px;color:var(--muted)}
        #impWrap .imp-steps b{padding:2px 9px;border-radius:10px;background:color-mix(in oklch,var(--muted) 12%,transparent)}
        #impWrap .imp-steps b.cur{background:var(--color-info);color:#fff}
        #impWrap .imp-body{padding:16px 18px;max-height:66vh;overflow:auto}
        #impWrap .imp-foot{display:flex;gap:8px;justify-content:flex-end;padding:12px 18px;border-top:1px solid var(--line)}
        #impWrap table.imp-grid{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}
        #impWrap table.imp-grid th,#impWrap table.imp-grid td{border:1px solid var(--line);padding:4px 7px;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis}
        #impWrap table.imp-grid th{background:color-mix(in oklch,var(--muted) 8%,transparent);color:var(--muted);font-weight:600}
        #impWrap .imp-card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:12px}
        #impWrap .imp-card h4{margin:0 0 10px;font-size:13px}
        #impWrap .imp-sum{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
        #impWrap .imp-sum span{font-size:12px;padding:4px 12px;border-radius:14px;background:color-mix(in oklch,var(--color-info) 10%,transparent);border:1px solid color-mix(in oklch,var(--color-info) 25%,transparent)}
        #impWrap .imp-sum span.bad{background:color-mix(in oklch,var(--color-danger) 12%,transparent);border-color:color-mix(in oklch,var(--color-danger) 30%,transparent)}
        #impWrap .imp-sum span.warn{background:color-mix(in oklch,var(--color-warning) 14%,transparent);border-color:color-mix(in oklch,var(--color-warning) 35%,transparent)}
        #impWrap .imp-sum span.ok{background:color-mix(in oklch,var(--color-success) 12%,transparent);border-color:color-mix(in oklch,var(--color-success) 30%,transparent)}
        #impWrap .imp-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}
        #impWrap .imp-row label{font-size:12px;color:var(--muted);min-width:64px}
        #impWrap .imp-prev{max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-top:10px}
        #impWrap .imp-err td{color:var(--color-danger)}
        #impWrap .imp-hint{font-size:11px;color:var(--muted);line-height:1.8}
      </style>
      <div class="imp-modal" role="dialog" aria-modal="true">
        <div class="imp-head">
          <button class="btn ghost sm imp-x" type="button">✕</button>
          <b style="font-size:15px">导入 Excel 测试数据</b>
          <div class="imp-steps" style="margin-left:auto">
            ${STEP_NAMES.map((n, i) => `<b data-step="${i}">${i + 1} ${n}</b>`).join('')}
          </div>
        </div>
        <div class="imp-body" id="impBody"></div>
        <div class="imp-foot" id="impFoot"></div>
      </div>`;
    document.body.appendChild(ov);
    ovEl = ov;
    ov.querySelector('.imp-x').onclick = close;
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
    render();
  }

  function close() { if (ovEl) { ovEl.remove(); ovEl = null; } }

  function curSheet() { return S.sheets[S.sheetIdx] || { name: '', matrix: [] }; }
  function headers() {
    const row = curSheet().matrix[S.headerRow] || [];
    const used = {};
    return row.map((c) => {
      let t = cellText(c);
      if (t && used[t] != null) { used[t] += 1; t = t + '(' + used[t] + ')'; }
      else if (t) used[t] = 1;
      return t;
    });
  }

  function render() {
    if (!ovEl) return;
    $$('.imp-steps b', ovEl).forEach((b) => b.classList.toggle('cur', +b.dataset.step === S.step));
    const body = $('#impBody', ovEl), foot = $('#impFoot', ovEl);
    if (S.result) { renderResult(body, foot); return; }
    if (S.step === 0) renderStep1(body, foot);
    else if (S.step === 1) renderStep2(body, foot);
    else if (S.step === 2) renderStep3(body, foot);
    else renderStep4(body, foot);
  }

  // ---- 步骤 1：文件 / sheet / 表头行 ----
  function renderStep1(body, foot) {
    const tpls = Store.data.settings.importTemplates || [];
    body.innerHTML = `
      <div class="imp-card">
        <div class="imp-row">
          <label>测试文件</label>
          <input type="file" id="impFile" accept=".xlsx,.xls,.csv" multiple class="ipt" style="flex:1;min-width:260px">
        </div>
        <div class="imp-row">
          <label>导入模板</label>
          <select id="impTpl" class="sel" style="min-width:240px">
            <option value="">不使用模板（手动映射，完成后可另存）</option>
            ${tpls.map((t) => `<option value="${t.id}">${U.esc(t.name)}（sheet：${U.esc(t.tpl.sheetName || '任意')}）</option>`).join('')}
          </select>
          <button class="btn sm ghost" id="impTplDel" type="button" style="display:none">删除该模板</button>
          <span class="imp-hint">相同排版的文件存过模板后，选择模板可自动完成列映射</span>
        </div>
        ${S.sheets.length ? `
        <div class="imp-row">
          <label>工作表</label>
          <select id="impSheet" class="sel" style="min-width:200px">
            ${S.sheets.map((s, i) => `<option value="${i}" ${i === S.sheetIdx ? 'selected' : ''}>${U.esc(s.name)}（${s.matrix.length} 行）</option>`).join('')}
          </select>
          <label style="min-width:auto">表头行</label>
          <select id="impHeader" class="sel">
            ${Array.from({ length: Math.min(12, curSheet().matrix.length) }, (_, i) => i).map((i) => `<option value="${i}" ${i === S.headerRow ? 'selected' : ''}>第 ${i + 1} 行</option>`).join('')}
          </select>
          <button class="btn sm ghost" id="impAutoAll" type="button" title="自动识别所有工作表的排版并直接整理导入（多 sheet / 每 sheet 一个日期的文件）">⚡ 自动识别全部 Sheet 并导入</button>
          <span class="imp-hint">标题行/单位行在表头之上时，在此指定真正的列名行</span>
        </div>
        <div class="imp-prev">${previewTable()}</div>` : `
        <p class="imp-hint" style="margin:6px 0 0">支持 .xlsx / .xls / .csv，可按住 Ctrl 一次选择多个文件自动识别整理；多级合并表头、一行多个日期等极端排版请先在 Excel 中稍作整理。</p>`}
      </div>`;
    foot.innerHTML = `<button class="btn ghost imp-cancel" type="button">取消</button>
      <button class="btn primary" id="impNext1" type="button" ${S.sheets.length ? '' : 'disabled'}>下一步：列映射</button>`;

    $('#impFile', body).onchange = async (e) => {
      const picked = e.target.files ? [...e.target.files] : [];
      if (!picked.length) return;
      // 一次选了多个文件 → 直接走自动识别管线（单文件保持原向导流程不变）
      if (picked.length > 1) { e.target.value = ''; runAutoImport(await autoAnalyze(picked)); return; }
      const f = picked[0];
      try {
        const buf = await f.arrayBuffer();
        const wb = xlsxF().read(new Uint8Array(buf), { type: 'array', cellDates: true });
        S.fileName = f.name;
        S.sheets = wb.SheetNames.map((name) => ({
          name, matrix: xlsxF().utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false })
        })).filter((s) => s.matrix.length);
        if (!S.sheets) throw new Error('文件中没有可用工作表');
        S.sheetIdx = 0; S.headerRow = detectHeaderRow(curSheet().matrix);
        const tplId = $('#impTpl', body).value;
        if (tplId) applyTemplate(tplId, true);
        render();
      } catch (err) {
        UI.toast('文件解析失败：' + err.message, 'err');
      }
    };
    $('#impTpl', body).onchange = (e) => {
      $('#impTplDel', body).style.display = e.target.value ? 'inline-flex' : 'none';
      if (e.target.value && S.sheets.length) applyTemplate(e.target.value, true);
    };
    $('#impTplDel', body).onclick = () => {
      const id = $('#impTpl', body).value;
      UI.confirm('删除该导入模板？不影响已导入的数据。', () => {
        Store.data.settings.importTemplates = (Store.data.settings.importTemplates || []).filter((t) => t.id !== id);
        Store.save(); UI.toast('模板已删除', 'ok'); render();
      });
    };
    if (S.sheets.length) {
      $('#impSheet', body).onchange = (e) => { S.sheetIdx = +e.target.value; S.headerRow = detectHeaderRow(curSheet().matrix); S.appliedTplId = null; render(); };
      $('#impHeader', body).onchange = (e) => { S.headerRow = +e.target.value; S.appliedTplId = null; render(); };
      $('#impAutoAll', body).onclick = () => runAutoAllSheets();
    }
    $('.imp-cancel', foot).onclick = close;
    $('#impNext1', foot).onclick = () => { if (!S.appliedTplId) initMapping(); S.step = 1; render(); };
  }

  function previewTable() {
    const m = curSheet().matrix;
    const rows = m.slice(S.headerRow, S.headerRow + 8);
    const cols = Math.max(...rows.map((r) => r.length), 0);
    if (!rows.length) return '<p class="imp-hint" style="padding:10px">该工作表为空</p>';
    let html = '<table class="imp-grid"><tr><th></th>' + Array.from({ length: cols }, (_, i) => `<th>${i + 1}</th>`).join('') + '</tr>';
    rows.forEach((r, i) => {
      html += `<tr><th>${S.headerRow + i + 1}</th>`;
      for (let c = 0; c < cols; c++) html += `<td${i === 0 ? ' style="background:color-mix(in oklch,var(--color-info) 10%,transparent);font-weight:600"' : ''}>${U.esc(cellText(r[c]))}</td>`;
      html += '</tr>';
    });
    return html + '</table>';
  }

  // ---- 步骤 2：结构与列映射 ----
  // 共享：自动定位表格结构与逐列映射（向导 initMapping 与自动识别管线 autoAnalyzeSheet 共用）
  // hs：表头行文本数组；matrix：整表二维矩阵；headerRow：表头行下标（宽表逐列的数值/文字启发式抽样用）
  function autoLocate(hs, matrix, headerRow) {
    const findH = (reg) => hs.findIndex((h) => h && reg.test(h));
    const loc = {
      ciName: Math.max(findH(/姓名|名字|名称|运动员|name/i), 0),
      ciName2: -1,
      ciDate: findH(/日期|时间|测试时间|测试日期|date/i),
      ciPos: findH(/场上位置|^位置$|位置|position/i),
      fixedDate: '',
      year: new Date().getFullYear(),
      ciItem: findH(/项目|科目|指标|测试内容|内容/),
      ciValue: findH(/成绩|数值|结果|得分|分数|value|score/i),
      ciUnit: findH(/单位|unit/i),
      cols: []
    };
    loc.format = (loc.ciItem >= 0 && loc.ciValue >= 0) ? 'long' : 'wide';
    if (loc.format === 'wide') {
      const targets = listTargets();
      const IGNORE_HEAD = /^(序号|编号|号码|队号|组别|组別|班级|职务|角色|备注|评语|说明|note|remark|id)$/i;
      loc.cols = hs.map((h, ci) => ({ ci, header: h, mode: 'ignore', key: '', name: h, unit: '', invert: false }));
      loc.cols.forEach((c) => {
        if (c.ci === loc.ciName || c.ci === loc.ciName2 || c.ci === loc.ciDate || c.ci === loc.ciPos) { c.skipped = true; return; }
        if (!c.header) return;
        if (IGNORE_HEAD.test(c.header.trim())) return;
        // 内容启发式：抽样数据行，非空单元格中数值占比不足一半 → 判定为文字列（备注/评语）默认忽略
        const sample = matrix.slice(headerRow + 1, headerRow + 21).map((r) => r[c.ci]);
        const nonEmpty = sample.filter((v) => v != null && String(v).trim() !== '' && !EMPTY_TOKENS.has(String(v).trim().toLowerCase()));
        if (nonEmpty.length) {
          const numericN = nonEmpty.filter((v) => !parseNum(v).bad).length;
          if (numericN / nonEmpty.length < 0.5) return;
        }
        const t = suggestTarget(c.header, targets);
        if (t) { c.mode = t.mode === 'new' ? 'new' : t.mode; c.key = t.key; c.name = t.name; c.unit = t.unit; c.invert = t.invert; }
        else { c.mode = 'new'; c.invert = /秒|时间|用时/.test(c.header); }
      });
    }
    return loc;
  }

  function initMapping() {
    const loc = autoLocate(headers(), curSheet().matrix, S.headerRow);
    // year 沿用状态值（freshState 已默认当前年份、步骤2界面可改），不做覆盖
    const { year, ...rest } = loc;
    Object.assign(S, rest);
  }

  function roleOptions(sel, skipIdxs) {
    const hs = headers();
    return `<option value="-1"${sel === -1 ? ' selected' : ''}>— 不使用 —</option>` +
      hs.map((h, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>第 ${i + 1} 列：${U.esc(h || '(空)')}</option>`).join('');
  }

  function renderStep2(body, foot) {
    const hs = headers();
    const targets = listTargets();
    const targetOptions = (c) =>
      `<option value="ignore"${c.mode === 'ignore' ? ' selected' : ''}>忽略此列</option>` +
      `<option value="new"${c.mode === 'new' ? ' selected' : ''}>✚ 新建自定义项目：${U.esc(c.header)}</option>` +
      targets.map((t) => `<option value="${t.key}"${c.mode !== 'new' && c.mode !== 'ignore' && c.key === t.key ? ' selected' : ''}>${U.esc(t.name)}${t.unit ? '（' + U.esc(t.unit) + '）' : ''}</option>`).join('');

    const activeCols = S.cols.filter((c) => c.header && c.ci !== S.ciName && c.ci !== S.ciName2 && c.ci !== S.ciDate);
    body.innerHTML = `
      <div class="imp-card">
        <h4>表格结构</h4>
        <div class="imp-row">
          <label>排版</label>
          <label style="min-width:auto;font-weight:400"><input type="radio" name="impFmt" value="wide" ${S.format === 'wide' ? 'checked' : ''}> 宽表（每个测试项目各占一列，最常见）</label>
          <label style="min-width:auto;font-weight:400"><input type="radio" name="impFmt" value="long" ${S.format === 'long' ? 'checked' : ''}> 长表（一列写项目名、一列写成绩）</label>
        </div>
        <div class="imp-row">
          <label>姓名列</label>
          <select id="impName" class="sel">${roleOptions(S.ciName)}</select>
          <span class="imp-hint">第二姓名列（选填，如姓/名分两列）</span>
          <select id="impName2" class="sel">
            <option value="-1"${S.ciName2 === -1 ? ' selected' : ''}>— 无 —</option>
            ${hs.map((h, i) => `<option value="${i}"${S.ciName2 === i ? ' selected' : ''}>第 ${i + 1} 列：${U.esc(h || '(空)')}</option>`).join('')}
          </select>
        </div>
        <div class="imp-row">
          <label>日期</label>
          <select id="impDate" class="sel">
            <option value="-1"${S.ciDate === -1 ? ' selected' : ''}>— 不使用 —</option>
            <option value="-2"${S.ciDate === -2 ? ' selected' : ''}>全表统一一个日期（在右侧指定）</option>
            ${hs.map((h, i) => `<option value="${i}"${S.ciDate >= 0 && S.ciDate === i ? ' selected' : ''}>第 ${i + 1} 列：${U.esc(h || '(空)')}</option>`).join('')}
          </select>
          <input type="date" id="impFixedDate" class="ipt" style="width:150px" value="${S.fixedDate}" ${S.ciDate === -2 ? '' : 'disabled'}>
          <span class="imp-hint">只有「月/日」缺年份时按</span>
          <input type="number" id="impYear" class="ipt" style="width:90px" value="${S.year}" min="2000" max="2100">
          <span class="imp-hint">年补齐</span>
        </div>
      </div>

      <div class="imp-card">
        ${S.format === 'wide' ? `
        <h4>项目列映射（共 ${activeCols.length} 列）</h4>
        <p class="imp-hint" style="margin:-4px 0 8px">系统项目按项目名自动对应；表里叫法不同的列可手动改选，或按列名新建自定义项目（单位/方向可编辑，计时类默认越小越好）。</p>
        <div style="max-height:34vh;overflow:auto">
        <table class="imp-grid">
          <tr><th>Excel 列名</th><th style="min-width:300px">对应到</th><th>单位</th><th>越小越好</th></tr>
          ${activeCols.map((c) => `
            <tr data-ci="${c.ci}">
              <td title="${U.esc(c.header)}">${U.esc(c.header)}</td>
              <td><select class="sel imp-colmap" style="min-width:280px;max-width:340px">${targetOptions(c)}</select></td>
              <td><input class="ipt imp-colunit" style="width:80px" value="${U.esc(c.unit || '')}" ${c.mode === 'new' ? '' : 'disabled'} placeholder="如 s/cm"></td>
              <td style="text-align:center"><input type="checkbox" class="imp-colinvert" ${c.invert ? 'checked' : ''} ${c.mode === 'new' ? '' : 'disabled'}></td>
            </tr>`).join('')}
        </table></div>` : `
        <h4>长表列映射</h4>
        <div class="imp-row"><label>项目名列</label><select id="impItem" class="sel">${roleOptions(S.ciItem)}</select></div>
        <div class="imp-row"><label>成绩列</label><select id="impValue" class="sel">${roleOptions(S.ciValue)}</select></div>
        <div class="imp-row"><label>单位列（选填）</label><select id="impUnit" class="sel">
          <option value="-1"${S.ciUnit === -1 ? ' selected' : ''}>— 无 —</option>
          ${hs.map((h, i) => `<option value="${i}"${S.ciUnit === i ? ' selected' : ''}>第 ${i + 1} 列：${U.esc(h || '(空)')}</option>`).join('')}
        </select>
        <span class="imp-hint">项目名与系统项目库精确匹配；匹配不上的自动按原名建为自定义项目。</span></div>`}
      </div>`;
    foot.innerHTML = `<button class="btn ghost" id="impBack2" type="button">上一步</button>
      <button class="btn primary" id="impNext2" type="button">下一步：姓名对碰</button>`;

    $$('input[name="impFmt"]', body).forEach((r) => r.onchange = () => {
      S.format = r.value;
      if (S.format === 'long') {
        const hs2 = headers();
        if (S.ciItem < 0) S.ciItem = hs2.findIndex((h, i) => i !== S.ciName && /项目|指标|内容/.test(h || ''));
        if (S.ciValue < 0) S.ciValue = hs2.findIndex((h, i) => i !== S.ciName && i !== S.ciItem && /成绩|数值|结果|得分/.test(h || ''));
      }
      render();
    });
    $('#impName', body).onchange = (e) => { S.ciName = +e.target.value; syncColSkip(); render(); };
    $('#impName2', body).onchange = (e) => { S.ciName2 = +e.target.value; syncColSkip(); render(); };
    $('#impDate', body).onchange = (e) => { S.ciDate = +e.target.value; syncColSkip(); render(); };
    $('#impFixedDate', body).onchange = (e) => { S.fixedDate = e.target.value; };
    $('#impYear', body).onchange = (e) => { S.year = +e.target.value || new Date().getFullYear(); };
    if (S.format === 'wide') {
      $$('.imp-colmap', body).forEach((sel) => {
        sel.onchange = () => {
          const tr = sel.closest('tr');
          const c = S.cols.find((x) => x.ci === +tr.dataset.ci);
          const v = sel.value;
          if (v === 'ignore') { c.mode = 'ignore'; c.key = ''; }
          else if (v === 'new') { c.mode = 'new'; c.key = ''; c.name = c.header; const t2 = suggestTarget(c.header, targets); c.unit = t2 ? t2.unit : ''; c.invert = t2 ? t2.invert : /秒|时间|用时/.test(c.header); }
          else {
            const t = targets.find((x) => x.key === v);
            c.mode = t.mode; c.key = t.key; c.name = t.name; c.unit = t.unit; c.invert = t.invert;
          }
          render();
        };
      });
      $$('tr[data-ci]', body).forEach((tr) => {
        const c = S.cols.find((x) => x.ci === +tr.dataset.ci);
        $('.imp-colunit', tr).oninput = (e) => { c.unit = normUnit(e.target.value); if (guessInvert(c.unit)) c.invert = true; };
        $('.imp-colinvert', tr).onchange = (e) => { c.invert = e.target.checked; };
      });
    } else {
      $('#impItem', body).onchange = (e) => { S.ciItem = +e.target.value; };
      $('#impValue', body).onchange = (e) => { S.ciValue = +e.target.value; };
      $('#impUnit', body).onchange = (e) => { S.ciUnit = +e.target.value; };
    }
    $('#impBack2', foot).onclick = () => { S.step = 0; render(); };
    $('#impNext2', foot).onclick = () => {
      if (S.ciName < 0) { UI.toast('请指定姓名列', 'err'); return; }
      if (S.format === 'long' && (S.ciItem < 0 || S.ciValue < 0)) { UI.toast('长表需要指定项目名列与成绩列', 'err'); return; }
      if (S.ciDate === -2 && !S.fixedDate) { UI.toast('请指定统一测试日期', 'err'); return; }
      initNameActions();
      S.step = 2; render();
    };
  }

  function syncColSkip() {
    S.cols.forEach((c) => { c.skipped = c.ci === S.ciName || c.ci === S.ciName2 || c.ci === S.ciDate || c.ci === S.ciPos; });
  }

  function dataRows() { return curSheet().matrix.slice(S.headerRow + 1); }

  // ---- 步骤 3：姓名对碰 ----
  function initNameActions() {
    const m = curSheet().matrix;
    const names = [];
    const seen = new Set();
    m.slice(S.headerRow + 1).forEach((cells) => {
      const parts = [cells[S.ciName], S.ciName2 >= 0 ? cells[S.ciName2] : null]
        .filter((x) => x != null && String(x).trim() !== '').map((x) => String(x).trim());
      const nm = parts.join('');
      if (nm && !seen.has(nm)) { seen.add(nm); names.push(nm); }
    });
    S.nameActions = new Map(names.map((nm) => {
      const ex = matchAthlete(nm);
      return [nm, ex ? { t: 'match', id: ex.id } : { t: 'new' }];
    }));
    S._names = names;
  }

  function renderStep3(body, foot) {
    const aths = Store.data.athletes || [];
    const names = S._names || [];
    body.innerHTML = `
      <div class="imp-card">
        <h4>姓名对碰（共 ${names.length} 人）</h4>
        <p class="imp-hint" style="margin:-4px 0 8px">已按姓名自动匹配档案；匹配不到的默认新建运动员（归属当前训练计划），也可手动指定已有运动员或整行忽略。</p>
        <div style="max-height:46vh;overflow:auto">
        <table class="imp-grid">
          <tr><th>表中姓名</th><th style="min-width:360px">处理方式</th><th>状态</th></tr>
          ${names.map((nm) => {
            const act = S.nameActions.get(nm) || { t: 'new' };
            return `<tr data-nm="${U.esc(nm)}">
              <td>${U.esc(nm)}</td>
              <td><select class="sel imp-nmatch" style="min-width:340px">
                <option value="new"${act.t === 'new' ? ' selected' : ''}>✚ 新建运动员：${U.esc(nm)}</option>
                <option value="skip"${act.t === 'skip' ? ' selected' : ''}>忽略此人的全部行</option>
                <optgroup label="匹配到已有运动员">
                ${aths.map((a) => `<option value="m:${a.id}"${act.t === 'match' && act.id === a.id ? ' selected' : ''}>${U.esc(a.name)}</option>`).join('')}
                </optgroup>
              </select></td>
              <td class="imp-nstat"></td></tr>`;
          }).join('')}
        </table></div>
      </div>`;
    $$('tr[data-nm]', body).forEach((tr) => {
      const nm = tr.dataset.nm;
      const refreshStat = () => {
        const act = S.nameActions.get(nm);
        const el = $('.imp-nstat', tr);
        if (act.t === 'skip') { el.textContent = '将忽略'; el.style.color = 'var(--muted)'; }
        else if (act.t === 'new') { el.textContent = '将新建'; el.style.color = 'var(--color-warning)'; }
        else { const a = aths.find((x) => x.id === act.id); el.textContent = '→ ' + (a ? a.name : ''); el.style.color = 'var(--color-success)'; }
      };
      $('.imp-nmatch', tr).onchange = (e) => {
        const v = e.target.value;
        S.nameActions.set(nm, v === 'new' ? { t: 'new' } : v === 'skip' ? { t: 'skip' } : { t: 'match', id: v.slice(2) });
        refreshStat();
      };
      refreshStat();
    });
    foot.innerHTML = `<button class="btn ghost" id="impBack3" type="button">上一步</button>
      <button class="btn primary" id="impNext3" type="button">下一步：预览</button>`;
    $('#impBack3', foot).onclick = () => { S.step = 1; render(); };
    $('#impNext3', foot).onclick = () => { S.step = 3; render(); };
  }

  // ---- 步骤 4：预览 / 冲突策略 / 模板 ----
  function currentSpec() {
    return {
      dataRows: dataRows(), rnoBase: S.headerRow + 2, format: S.format,
      ciName: S.ciName, ciName2: S.ciName2, ciDate: S.ciDate, ciPos: S.ciPos == null ? -1 : S.ciPos, fixedDate: S.fixedDate, year: S.year,
      cols: S.cols.filter((c) => c.mode && c.mode !== 'ignore'),
      ciItem: S.ciItem, ciValue: S.ciValue, ciUnit: S.ciUnit,
      targets: listTargets(), actions: S.nameActions, dup: S.dup
    };
  }

  function renderStep4(body, foot) {
    const sum = buildRecords(currentSpec());
    S._sum = sum;
    const flat = [];
    sum.records.forEach((r) => r.items.forEach((it) => flat.push({ rno: r.rno, name: r.rawName, date: r.date, item: it.name, value: it.value, unit: it.unit, conflict: !!it.conflict })));
    body.innerHTML = `
      <div class="imp-card">
        <h4>导入预览</h4>
        <div class="imp-sum">
          <span class="ok">有效数据点 ${sum.validItems}</span>
          <span>涉及记录 ${sum.records.length} 行</span>
          <span class="warn">新建运动员 ${sum.newAths.length} 人${sum.newAths.length ? '：' + U.esc(sum.newAths.slice(0, 6).join('、')) + (sum.newAths.length > 6 ? ' 等' : '') : ''}</span>
          <span class="warn">新建自定义项目 ${sum.newItems.length} 项${sum.newItems.length ? '：' + U.esc(sum.newItems.slice(0, 6).join('、')) + (sum.newItems.length > 6 ? ' 等' : '') : ''}</span>
          <span class="${sum.conflictN ? 'warn' : ''}">同人同日同项目冲突 ${sum.conflictN} 处</span>
          <span class="${sum.errors.length ? 'bad' : 'ok'}">问题行 ${sum.errors.length}</span>
        </div>
        <div class="imp-row">
          <label>冲突处理</label>
          <label style="min-width:auto;font-weight:400"><input type="radio" name="impDup" value="skip" ${S.dup === 'skip' ? 'checked' : ''}> 跳过保留原值（推荐，只补填空缺）</label>
          <label style="min-width:auto;font-weight:400"><input type="radio" name="impDup" value="overwrite" ${S.dup === 'overwrite' ? 'checked' : ''}> 覆盖为最新值</label>
        </div>
        <div style="max-height:200px;overflow:auto;margin-top:8px">
          <table class="imp-grid">
            <tr><th>行</th><th>姓名</th><th>日期</th><th>项目</th><th>数值</th><th>单位</th><th></th></tr>
            ${flat.slice(0, 30).map((x) => `<tr${x.conflict ? ' style="background:color-mix(in oklch,var(--color-warning) 10%,transparent)"' : ''}>
              <td>${x.rno}</td><td>${U.esc(x.name)}</td><td>${x.date}</td><td>${U.esc(x.item)}</td><td>${x.value}</td><td>${U.esc(x.unit)}</td><td>${x.conflict ? '冲突' : ''}</td></tr>`).join('')}
          </table>
          ${flat.length > 30 ? `<p class="imp-hint" style="padding:6px 4px">仅显示前 30 条，共 ${flat.length} 条</p>` : ''}
        </div>
      </div>
      ${sum.errors.length ? `
      <div class="imp-card">
        <h4 style="color:var(--color-danger)">问题行（不影响其他数据，这些单元格/行将跳过）</h4>
        <div style="max-height:160px;overflow:auto"><table class="imp-grid imp-err">
          <tr><th>Excel 行</th><th>姓名</th><th>项目</th><th>问题</th></tr>
          ${sum.errors.slice(0, 50).map((e) => `<tr><td>${e.rno}</td><td>${U.esc(e.name || '')}</td><td>${U.esc(e.item || '')}</td><td>${U.esc(e.msg)}</td></tr>`).join('')}
        </table>${sum.errors.length > 50 ? `<p class="imp-hint" style="padding:6px 4px">仅显示前 50 条，共 ${sum.errors.length} 条</p>` : ''}</div>
      </div>` : ''}
      <div class="imp-card">
        <h4>保存映射模板</h4>
        <div class="imp-row">
          <label style="min-width:auto"><input type="checkbox" id="impSaveTpl" ${S.saveTpl ? 'checked' : ''}> 把本次列映射存为模板，下次同类文件一键导入</label>
        </div>
        <div class="imp-row" id="impTplNameRow" style="${S.saveTpl ? '' : 'display:none'}">
          <label>模板名称</label>
          <input class="ipt" id="impTplName" style="min-width:300px" value="${U.esc(S.tplName || S.fileName.replace(/\.(xlsx|xls|csv)$/i, ''))}" placeholder="如：省队月度体测表">
        </div>
      </div>`;
    foot.innerHTML = `<button class="btn ghost" id="impBack4" type="button">上一步</button>
      <button class="btn primary" id="impDo" type="button" ${sum.validItems ? '' : 'disabled'}>确认导入 ${sum.validItems} 条数据</button>`;
    $$('input[name="impDup"]', body).forEach((r) => r.onchange = () => { S.dup = r.value; render(); });
    $('#impSaveTpl', body).onchange = (e) => { S.saveTpl = e.target.checked; $('#impTplNameRow', body).style.display = S.saveTpl ? 'flex' : 'none'; };
    $('#impTplName', body) && ($('#impTplName', body).oninput = (e) => { S.tplName = e.target.value; });
    $('#impBack4', foot).onclick = () => { S.step = 2; render(); };
    $('#impDo', foot).onclick = () => doImport();
  }

  // ---------------- 写入 / 撤销 / 模板 ----------------

  // 统一入库：把 buildRecords 的产出写入 profiles / athleteRm / 自定义项目库，并登记一条 importBatch 台账
  // （单文件向导 doImport 与自动识别管线共用；调用方负责 Store.save()、模板保存与结果展示）
  function applyRecords(sum, fileName, dup) {
    const d = Store.data;
    d.profiles = d.profiles || [];
    d.athleteRm = d.athleteRm || {};
    const mac = Store.activeMacro ? Store.activeMacro() : null;
    const batch = { id: U.uid('imp'), ts: Date.now(), fileName, changes: [], createdAths: [], n: 0, dupSkip: 0, rmMissing: 0 };
    const athCache = new Map();

    const ensureAthlete = (rec) => {
      if (rec.action.t === 'match') return rec.action.id;
      if (athCache.has(rec.rawName)) return athCache.get(rec.rawName);
      const a = { id: U.uid('ath'), name: rec.rawName, macroId: mac ? mac.id : null, sport: mac ? mac.sport : '', gender: '', birth: '', position: '', note: 'Excel 导入新建', avatar: '' };
      d.athletes.push(a);
      batch.createdAths.push(a.id);
      athCache.set(rec.rawName, a.id);
      return a.id;
    };

    // 位置列：规整到本项目位置库（精确/包含匹配），库外值按自定义原文保留；只补空、不覆盖已有位置
    const normalizePos = (raw) => {
      raw = (raw || '').trim();
      if (!raw) return '';
      const lib = mac ? Sports.positionsOf(mac.sport) : null;
      if (!lib) return raw;
      if (lib.includes(raw)) return raw;
      const hit = lib.find((p) => p.includes(raw) || raw.includes(p));
      return hit || raw;
    };
    const fillPosition = (athId, rec) => {
      if (!rec.position) return;
      const a = d.athletes.find((x) => x.id === athId);
      if (!a || a.position) return;
      const pos = normalizePos(rec.position);
      if (!pos) return;
      a.position = pos;
      batch.changes.push({ k: 'athPos', id: athId, old: '' });
    };

    const writeProfile = (athId, rec, it) => {
      let pf = d.profiles.find((p) => p.athleteId === athId && p.date === rec.date);
      const created = !pf;
      if (!pf) { pf = { id: U.uid('pf'), athleteId: athId, date: rec.date }; d.profiles.push(pf); batch.changes.push({ k: 'pfdel', id: pf.id }); }
      if (it.field) {
        if (pf[it.field] != null) { if (dup === 'skip') { batch.dupSkip++; return; } batch.changes.push({ k: 'pf', id: pf.id, f: it.field, old: pf[it.field] }); }
        else batch.changes.push({ k: 'pf', id: pf.id, f: it.field, old: null });
        pf[it.field] = it.value;
      } else {
        pf.custom = pf.custom || [];
        let c = pf.custom.find((x) => x.name === it.name);
        if (c && c.value != null) { if (dup === 'skip') { batch.dupSkip++; return; } batch.changes.push({ k: 'pc', id: pf.id, n: it.name, old: c.value }); }
        else { if (!c) { c = { name: it.name, unit: it.unit || '', value: 0 }; pf.custom.push(c); } batch.changes.push({ k: 'pc', id: pf.id, n: it.name, old: null }); }
        c.value = it.value;
        c.unit = it.unit || c.unit || '';
      }
      batch.n++;
    };

    const writeRm = (athId, rec, it) => {
      const ex = d.exercises.find((e) => e.name === it.exName);
      if (!ex) { batch.rmMissing++; return; }
      const per = d.athleteRm[athId] || (d.athleteRm[athId] = {});
      const cur = per[ex.id] || (per[ex.id] = { value: null, date: '', testDate: '', history: [] });
      cur.history = cur.history || [];
      const exist = cur.history.find((h) => h.date === rec.date);
      if (exist && exist.value !== it.value) { if (dup === 'skip') { batch.dupSkip++; return; } batch.changes.push({ k: 'rh', ath: athId, ex: ex.id, date: rec.date, old: { value: exist.value, method: exist.method, source: exist.source } }); exist.value = it.value; exist.method = 'Excel导入'; }
      else if (!exist) {
        cur.history.push({ value: it.value, date: rec.date, method: 'Excel导入', source: 'test' });
        cur.history.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        batch.changes.push({ k: 'rhadd', ath: athId, ex: ex.id, date: rec.date });
      }
      const latest = cur.history[cur.history.length - 1];
      batch.changes.push({ k: 'rbase', ath: athId, ex: ex.id, old: { value: cur.value, date: cur.date, testDate: cur.testDate } });
      if (latest && (!cur.date || latest.date >= cur.date)) { cur.value = latest.value; cur.date = latest.date; cur.testDate = latest.date; }
      batch.n++;
    };

    sum.records.forEach((rec) => {
      const athId = ensureAthlete(rec);
      fillPosition(athId, rec);
      rec.items.forEach((it) => { if (it.mode === 'rm1') writeRm(athId, rec, it); else writeProfile(athId, rec, it); });
    });

    // 新自定义项目登记进用户测试项目库（档案录入弹窗/KPI 指标总表自动出现）
    const items = Store.data.settings.testItems || [];
    const unitByName = new Map();
    sum.records.forEach((r) => r.items.forEach((it) => { if (it.mode === 'new') unitByName.set(it.name, { unit: it.unit || '', invert: !!it.invert }); }));
    let itemsAdded = 0;
    unitByName.forEach((v, name) => {
      if (items.some((t) => t && t.name === name) || (P.testLibrary().some((t) => t.name === name))) return;
      items.push({ name, unit: v.unit, invert: v.invert, field: null, special: null });
      itemsAdded++;
    });
    Store.data.settings.testItems = items;

    d.importBatches = d.importBatches || [];
    d.importBatches.unshift(batch);
    if (d.importBatches.length > 20) d.importBatches.length = 20;
    return { batch, itemsAdded };
  }

  function doImport() {
    const sum = S._sum || buildRecords(currentSpec());
    if (!sum.validItems) { UI.toast('没有可导入的数据', 'err'); return; }
    const { batch, itemsAdded } = applyRecords(sum, S.fileName, S.dup);
    if (S.saveTpl) saveCurrentTemplate();
    Store.save();
    S.result = { batch, newAths: sum.newAths.length, newItems: sum.newItems.length, errors: sum.errors.length, itemsAdded };
    render();
  }

  function undoBatch(batchId) {
    const d = Store.data;
    const batch = (d.importBatches || []).find((b) => b.id === batchId);
    if (!batch) return;
    // 逆序回滚
    for (let i = batch.changes.length - 1; i >= 0; i--) {
      const c = batch.changes[i];
      if (c.k === 'pfdel') {
        d.profiles = d.profiles.filter((p) => p.id !== c.id);
      } else if (c.k === 'pf') {
        const pf = d.profiles.find((p) => p.id === c.id);
        if (!pf) continue;
        if (c.old == null) delete pf[c.f]; else pf[c.f] = c.old;
      } else if (c.k === 'pc') {
        const pf = d.profiles.find((p) => p.id === c.id);
        if (!pf) continue;
        pf.custom = (pf.custom || []).filter((x) => !(x.name === c.n && c.old == null));
        const x = (pf.custom || []).find((z) => z.name === c.n);
        if (x && c.old != null) x.value = c.old;
      } else if (c.k === 'rh' || c.k === 'rhadd') {
        const per = (d.athleteRm || {})[c.ath] || {};
        const rec = per[c.ex];
        if (!rec) continue;
        if (c.k === 'rhadd') rec.history = (rec.history || []).filter((h) => !(h.date === c.date && h.method === 'Excel导入'));
        else { const h = (rec.history || []).find((x) => x.date === c.date); if (h && c.old) { h.value = c.old.value; h.method = c.old.method; h.source = c.old.source; } }
      } else if (c.k === 'rbase') {
        const per = (d.athleteRm || {})[c.ath] || {};
        const rec = per[c.ex];
        if (rec) { rec.value = c.old.value; rec.date = c.old.date; rec.testDate = c.old.testDate; }
      } else if (c.k === 'athPos') {
        const a = d.athletes.find((x) => x.id === c.id);
        if (a) a.position = c.old || '';
      }
    }
    // 删除本批新建且已无关联数据的运动员（只查本人档案与本人 1RM）
    batch.createdAths.forEach((aid) => {
      const hasPf = (d.profiles || []).some((p) => p.athleteId === aid);
      const per = (d.athleteRm || {})[aid];
      const hasRm = per && Object.values(per).some((rec) => (rec && rec.history || []).length);
      if (!hasPf && !hasRm) {
        d.athletes = d.athletes.filter((a) => a.id !== aid);
        delete d.athleteRm[aid];
      }
    });
    d.importBatches = (d.importBatches || []).filter((b) => b.id !== batchId);
    Store.save();
    UI.toast('已撤销本批导入（恢复原值/删除新增记录）', 'ok');
  }

  function renderResult(body, foot) {
    const r = S.result;
    const b = r.batch;
    body.innerHTML = `
      <div class="imp-card" style="text-align:center;padding:26px">
        <div style="font-size:30px;margin-bottom:8px">✅</div>
        <b style="font-size:16px">导入完成</b>
        <p class="imp-hint" style="margin:8px 0 0;line-height:2.1">
          文件：${U.esc(b.fileName)}<br>
          写入测试数据 <b style="color:var(--color-success)">${b.n}</b> 条 · 新建运动员 ${r.newAths} 人 · 新建自定义项目 ${r.newItems} 项（${r.itemsAdded} 项已加入项目库）<br>
          ${b.dupSkip ? `按策略跳过冲突 ${b.dupSkip} 处<br>` : ''}
          ${b.rmMissing ? `${b.rmMissing} 条 1RM 因动作库中无对应动作未导入<br>` : ''}
          ${r.errors ? `问题行 ${r.errors} 条已跳过（见上一步预览）` : ''}
        </p>
        <p class="imp-hint" style="margin-top:10px">数据已进入「运动员档案」与「自定义 KPI 分析」，可直接用 14 种分析方法生成看板。</p>
      </div>
      <div class="imp-card">
        <h4>导错了？</h4>
        <p class="imp-hint" style="margin:0 0 8px">本批所有写入均有台账，可整批撤销（恢复原值、删除新增档案/运动员；模板与项目库条目保留，不影响其他使用）。</p>
        <button class="btn danger sm" id="impUndo" type="button">↩ 撤销本批导入</button>
      </div>`;
    foot.innerHTML = `<button class="btn ghost" id="impMore" type="button">再导一个文件</button>
      <button class="btn primary" id="impFinish" type="button">完成</button>`;
    $('#impUndo', body).onclick = () => UI.confirm('确认撤销本批导入？', () => {
      undoBatch(b.id);
      if (optsCb) optsCb();
      close();
    });
    $('#impMore', foot).onclick = () => { S = freshState(); render(); };
    $('#impFinish', foot).onclick = () => { if (optsCb) optsCb(); close(); };
  }

  // ---------------- 模板 ----------------

  function saveCurrentTemplate() {
    const tpl = {
      v: 1, sheetName: curSheet().name, headerRow: S.headerRow, format: S.format,
      ciName: S.ciName, ciName2: S.ciName2, ciDate: S.ciDate, fixedDate: S.fixedDate,
      ciItem: S.ciItem, ciValue: S.ciValue, ciUnit: S.ciUnit,
      maps: S.cols.filter((c) => c.mode && c.mode !== 'ignore').map((c) => ({ header: c.header, mode: c.mode, key: c.key, name: c.name, unit: c.unit, invert: c.invert }))
    };
    const list = Store.data.settings.importTemplates = Store.data.settings.importTemplates || [];
    const name = (S.tplName || S.fileName || '导入模板').trim();
    if (S.tplId) {
      const ex = list.find((t) => t.id === S.tplId);
      if (ex) { ex.name = name; ex.tpl = tpl; Store.save(); return; }
    }
    list.push({ id: U.uid('tpl'), name, tpl });
  }

  function applyTemplate(id, silent) {
    const t = (Store.data.settings.importTemplates || []).find((x) => x.id === id);
    if (!t) return;
    const tpl = t.tpl;
    S.tplId = id; S.tplName = t.name; S.saveTpl = true;
    // sheet 同名优先，否则留当前 sheet
    const si = S.sheets.findIndex((s) => s.name === tpl.sheetName);
    if (si >= 0) S.sheetIdx = si;
    S.headerRow = Math.min(tpl.headerRow || 0, curSheet().matrix.length - 1);
    S.format = tpl.format || 'wide';
    const hs = headers();
    const byHeader = new Map(hs.map((h, i) => [h, i]));
    S.ciName = tpl.ciName >= 0 && hs[tpl.ciName] != null ? tpl.ciName : 0;
    S.ciName2 = tpl.ciName2 >= 0 && hs[tpl.ciName2] != null ? tpl.ciName2 : -1;
    S.ciDate = (tpl.ciDate === -2) ? -2 : (tpl.ciDate >= 0 && hs[tpl.ciDate] != null ? tpl.ciDate : -1);
    S.fixedDate = tpl.fixedDate || '';
    S.ciItem = tpl.ciItem >= 0 && hs[tpl.ciItem] != null ? tpl.ciItem : -1;
    S.ciValue = tpl.ciValue >= 0 && hs[tpl.ciValue] != null ? tpl.ciValue : -1;
    S.ciUnit = tpl.ciUnit >= 0 && hs[tpl.ciUnit] != null ? tpl.ciUnit : -1;
    if (S.format === 'wide') {
      const targets = listTargets();
      S.cols = hs.map((h, ci) => ({ ci, header: h, mode: 'ignore', key: '', name: h, unit: '', invert: false }));
      let matched = 0;
      (tpl.maps || []).forEach((m) => {
        const ci = byHeader.get(m.header);
        if (ci == null || ci === S.ciName || ci === S.ciName2 || ci === S.ciDate) return;
        const c = S.cols[ci];
        if (m.mode === 'new') { c.mode = 'new'; c.name = m.name || m.header; c.unit = m.unit || ''; c.invert = !!m.invert; }
        else {
          const tgt = targets.find((x) => x.key === m.key);
          if (!tgt) return;
          c.mode = tgt.mode; c.key = tgt.key; c.name = tgt.name; c.unit = tgt.unit; c.invert = tgt.invert;
        }
        matched++;
      });
      if (!silent) UI.toast(`已应用模板「${t.name}」，匹配 ${matched} 个项目列`, 'ok');
    }
  }

  // ---------------- 自动识别管线（多文件导入 / 全部 Sheet 导入） ----------------
  // 触发入口1：步骤1 文件选择框一次选了 ≥2 个文件；入口2：步骤1「⚡ 自动识别全部 Sheet 并导入」按钮。
  // 流程：逐 sheet 识别 → 确认弹窗 → 按文件批量入库（每文件一条 importBatch 台账，可整批撤销）；不写映射模板。

  // 无日期列时的兜底：从 sheet 名与表头上方标题区推断整表统一日期（如每个 sheet 一个日期的排版）
  function guessFixedDate(sheetName, matrix, headerRow, year) {
    const fromName = parseDate(sheetName, year);
    if (fromName) return fromName;
    for (let i = 0; i < headerRow; i++) {
      const row = matrix[i] || [];
      for (const c of row) { const d = parseDate(cellText(c), year); if (d) return d; }
    }
    return null;
  }

  // 纯函数：单个 sheet 的自动识别 —— 表头行 → 结构/列映射定位 → buildRecords 统一记录 → matchAthlete 对碰 → 统计
  function autoAnalyzeSheet(fileName, sheetName, matrix, targets) {
    const base = { file: fileName, sheet: sheetName };
    if (!matrix || !matrix.length) return { ...base, ok: false, reason: '空工作表' };
    const headerRow = detectHeaderRow(matrix);
    const hs = (matrix[headerRow] || []).map((c) => cellText(c));
    if (!hs.some((h) => h)) return { ...base, ok: false, reason: '未识别到表头行' };
    const loc = autoLocate(hs, matrix, headerRow);
    if (loc.format === 'long' && (loc.ciItem < 0 || loc.ciValue < 0)) return { ...base, ok: false, reason: '识别为长表，但缺少项目列或成绩列' };
    // 日期兜底：无日期列时尝试 sheet 名 / 标题区（否则每行都会因日期缺失被跳过）
    if (loc.ciDate === -1) {
      const fd = guessFixedDate(sheetName, matrix, headerRow, loc.year);
      if (!fd) return { ...base, ok: false, reason: '未找到日期列，sheet 名与标题区也无日期' };
      loc.ciDate = -2; loc.fixedDate = fd;
    }
    // 护栏：姓名列抽样几乎全是数字时视为识别不可信，不自动导入
    const nameSample = matrix.slice(headerRow + 1, headerRow + 31).map((r) => cellText(r[loc.ciName])).filter(Boolean);
    if (nameSample.length >= 3 && nameSample.filter((v) => /^-?\d+(\.\d+)?$/.test(v)).length / nameSample.length > 0.6) {
      return { ...base, ok: false, reason: '姓名列内容异常（几乎全为数字），不敢自动导入' };
    }
    // 姓名对碰：匹配到档案 → match；匹配不到 → 自动新建
    const names = new Set();
    matrix.slice(headerRow + 1).forEach((cells) => { const nm = cellText(cells[loc.ciName]); if (nm) names.add(nm); });
    const actions = new Map([...names].map((nm) => {
      const ex = matchAthlete(nm);
      return [nm, ex ? { t: 'match', id: ex.id } : { t: 'new' }];
    }));
    const sum = buildRecords({
      dataRows: matrix.slice(headerRow + 1), rnoBase: headerRow + 2, format: loc.format,
      ciName: loc.ciName, ciName2: -1, ciDate: loc.ciDate, fixedDate: loc.fixedDate, year: loc.year,
      cols: (loc.cols || []).filter((c) => c.mode && c.mode !== 'ignore'),
      ciItem: loc.ciItem, ciValue: loc.ciValue, ciUnit: loc.ciUnit,
      targets, actions, dup: 'overwrite'
    });
    if (!sum.records.length) return { ...base, ok: false, reason: '表头下没有可导入的数据行' };
    // 映射摘要：宽表逐列；长表从记录反提项目清单；忽略列单独列出
    const maps = [], ignored = [];
    if (loc.format === 'wide') {
      loc.cols.forEach((c) => {
        if (!c.header || c.skipped) return;
        if (c.mode === 'ignore') { ignored.push(c.header); return; }
        maps.push({ header: c.header, kind: c.mode === 'new' ? 'new' : 'sys', name: c.name });
      });
    } else {
      const sysSet = new Set(), newSet = new Set();
      sum.records.forEach((r) => r.items.forEach((it) => (it.mode === 'new' ? newSet : sysSet).add(it.name)));
      sysSet.forEach((n) => maps.push({ header: n, kind: 'sys', name: n }));
      newSet.forEach((n) => maps.push({ header: n, kind: 'new', name: n }));
      hs.forEach((h, i) => { if (h && i !== loc.ciName && i !== loc.ciDate && i !== loc.ciItem && i !== loc.ciValue && i !== loc.ciUnit) ignored.push(h); });
    }
    const ds = [...new Set(sum.records.map((r) => r.date))].sort();
    return {
      ...base, ok: true, format: loc.format, headerRow,
      records: sum.records, errors: sum.errors, newAths: sum.newAths, newItems: sum.newItems,
      maps, ignored,
      stats: {
        items: sum.validItems, rows: sum.records.length,
        dateFrom: ds[0], dateTo: ds[ds.length - 1],
        athMatch: new Set(sum.records.filter((r) => r.action.t === 'match').map((r) => r.rawName)).size,
        athNew: sum.newAths.length,
        errN: sum.errors.length
      }
    };
  }

  // 纯函数：一个文件内全部 sheet 逐个自动识别（冒烟测试直接构造 sheets 调用）
  function analyzeSheets(fileName, sheets, targets) {
    const tg = targets || listTargets();
    return sheets.map((sh) => autoAnalyzeSheet(fileName, sh.name, sh.matrix, tg));
  }

  // 入口1：多文件。逐个解析工作簿后按 sheet 识别；解析失败的文件记为跳过原因，不中断其余文件
  async function autoAnalyze(files) {
    const out = [];
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        const wb = xlsxF().read(new Uint8Array(buf), { type: 'array', cellDates: true });
        const sheets = wb.SheetNames.map((name) => ({
          name,
          matrix: xlsxF().utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false })
        })).filter((s) => s.matrix.length);
        out.push({ file: f.name, sheets: sheets.length ? analyzeSheets(f.name, sheets, listTargets()) : [{ file: f.name, sheet: '（无数据）', ok: false, reason: '文件中没有可用工作表' }] });
      } catch (err) {
        out.push({ file: f.name, sheets: [{ file: f.name, sheet: '（整文件）', ok: false, reason: '文件解析失败：' + err.message }] });
      }
    }
    return out;
  }

  // 入库前按当前档案重新对碰姓名（前一文件可能已新建同名运动员，避免重复建档）
  function remapActions(records) {
    const cache = new Map();
    records.forEach((r) => {
      if (cache.has(r.rawName)) { r.action = cache.get(r.rawName); return; }
      const ex = matchAthlete(r.rawName);
      const act = ex ? { t: 'match', id: ex.id } : { t: 'new' };
      cache.set(r.rawName, act);
      r.action = act;
    });
  }

  // 统一格式确认弹窗（按 文件·sheet 逐行列出统计与映射摘要）→ 确认后批量入库
  function runAutoImport(analyzedFiles) {
    const ok = [], skipped = [];
    analyzedFiles.forEach((f) => f.sheets.forEach((s) => (s.ok ? ok : skipped).push(s)));
    const totalItems = ok.reduce((n, s) => n + s.stats.items, 0);
    if (!totalItems) {
      UI.toast('自动识别未找到可导入的数据' + (skipped.length ? '（' + skipped.map((x) => x.sheet + '：' + x.reason).join('；') + '）' : ''), 'err');
      return;
    }
    const newAthsAll = [...new Set(ok.flatMap((s) => s.newAths))];
    const chip = (txt, warn) => `<span style="font-size:11px;padding:2px 8px;border-radius:10px;white-space:nowrap;border:1px solid ${warn ? 'color-mix(in oklch,var(--color-warning) 40%,transparent)' : 'color-mix(in oklch,var(--color-info) 30%,transparent)'};background:${warn ? 'color-mix(in oklch,var(--color-warning) 12%,transparent)' : 'color-mix(in oklch,var(--color-info) 10%,transparent)'}">${U.esc(txt)}</span>`;
    const sheetRow = (s) => `
      <div style="padding:9px 0;border-bottom:1px dashed var(--line)">
        <div style="font-size:13px;font-weight:600">📄 ${U.esc(s.file)} · ${U.esc(s.sheet)}
          <span style="font-size:11px;font-weight:400;padding:1px 8px;border-radius:9px;margin-left:6px;background:color-mix(in oklch,var(--muted) 14%,transparent)">${s.format === 'wide' ? '宽表' : '长表'} · 表头第 ${s.headerRow + 1} 行</span></div>
        <div style="font-size:11px;color:var(--muted);margin:4px 0">数据点 <b style="color:var(--color-success)">${s.stats.items}</b> · 记录行 ${s.stats.rows} · 日期 ${s.stats.dateFrom}${s.stats.dateTo !== s.stats.dateFrom ? ' ~ ' + s.stats.dateTo : ''} · 运动员 匹配 ${s.stats.athMatch} / 新建 ${s.stats.athNew} · 问题行 <span style="color:${s.stats.errN ? 'var(--color-danger)' : 'inherit'}">${s.stats.errN}</span></div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${s.maps.filter((m) => m.kind === 'sys').map((m) => chip(m.name)).join('')}
          ${s.maps.filter((m) => m.kind === 'new').map((m) => chip('✚ ' + m.name, true)).join('')}
          ${s.ignored.length ? `<span style="font-size:11px;color:var(--muted)">忽略列：${U.esc(s.ignored.join('、'))}</span>` : ''}
        </div>
      </div>`;
    UI.modal({
      title: `⚡ 自动识别完成：${ok.length} 个工作表可导入（${totalItems} 个数据点）`,
      wide: true,
      body: `
        <div style="max-height:48vh;overflow:auto">${ok.map(sheetRow).join('')}
          ${skipped.map((s) => `<div style="font-size:11px;color:var(--muted);padding:6px 0">⚠ ${U.esc(s.file)} · ${U.esc(s.sheet)}：${U.esc(s.reason)}（已跳过）</div>`).join('')}
        </div>
        ${newAthsAll.length ? `<p style="font-size:12px;margin:10px 0 0;color:var(--color-warning)">将自动新建运动员 ${newAthsAll.length} 人：${U.esc(newAthsAll.slice(0, 12).join('、'))}${newAthsAll.length > 12 ? ' 等' : ''}</p>` : ''}
        <p style="font-size:11px;color:var(--color-muted);margin:8px 0 0;line-height:1.7">已有运动员按姓名识别，<b>只补填空缺成绩，同日同项目已有值保留不覆盖</b>；每个文件生成一条导入台账，可按文件整批撤销。</p>`,
      footer: `<button class="btn ghost" data-acancel>取消，回手动向导</button><button class="btn primary" data-astart>开始导入 ${totalItems} 条数据</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-acancel]').onclick = () => close();
        ov.querySelector('[data-astart]').onclick = () => { close(); executeAutoImport(analyzedFiles); };
      }
    });
  }

  // 直接入库（无确认步骤）：按文件逐个应用 + 保存，然后弹出结果摘要
  // 策略=skip：同名运动员按名字自动识别后，只补填其空缺成绩；同日同项目已有值一律保留不覆盖；新日期建档、新人自动新建
  function executeAutoImport(analyzedFiles) {
    let fileN = 0, sheetN = 0, writes = 0, kept = 0;
    const newAthNames = new Set();
    const batchIds = [];
    analyzedFiles.forEach((f) => {
      const records = [];
      f.sheets.forEach((s) => { if (s.ok && s.records.length) records.push(...s.records); });
      if (!records.length) return;
      remapActions(records);
      // 以最终 action 为准统计实际新建人数（前一文件可能已新建同名运动员）
      records.forEach((r) => { if (r.action.t === 'new') newAthNames.add(r.rawName); });
      const { batch } = applyRecords({ records }, f.file, 'skip');
      batchIds.push(batch.id);
      writes += batch.n;
      kept += batch.dupSkip || 0;
      sheetN += f.sheets.filter((s) => s.ok && s.records.length).length;
      fileN++;
    });
    Store.save();
    if (optsCb) optsCb();
    const newN = newAthNames.size;
    UI.modal({
      title: '✅ 自动导入完成',
      body: `
        <p style="font-size:13px;line-height:1.9;margin:0">
          共导入 <b>${fileN}</b> 个文件 / <b>${sheetN}</b> 个工作表 / 新补 <b>${writes}</b> 个数据点${newN ? `，自动新建运动员 <b>${newN}</b> 人` : ''}${kept ? `，<b style="color:var(--color-warning)">保留原有成绩 ${kept} 项未覆盖</b>` : ''}。<br>
          已有运动员按姓名自动识别，只补填空缺；新测试日期自动建档。
        </p>
        <p class="hint" style="font-size:11.5px;margin:12px 0 0;line-height:1.7">
          · <b>运动员档案</b>：左侧选择运动员，可逐日期查看原始成绩与 1RM 记录<br>
          · <b>KPI 分析</b>：顶部选运动员/时期，自动生成百分位看板、雷达图、Z 分数、纵向趋势与团队排名（3 个测试日期即生成进步趋势线）
        </p>`,
      footer: `<button class="btn ghost" data-adundo type="button" style="color:var(--color-danger)" title="回滚本次自动导入写入的全部数据与新建运动员">↩ 撤销本次导入</button><button class="btn ghost" data-adone>完成</button><button class="btn" data-adprofile>去运动员档案</button><button class="btn primary" data-adkpi>去 KPI 分析</button>`,
      onMount(ov2, close2) {
        ov2.closest('.overlay').id = 'impAutoDone';
        ov2.querySelector('[data-adone]').onclick = () => close2();
        ov2.querySelector('[data-adundo]').onclick = () => UI.confirm('确认撤销本次导入？写入的成绩、1RM 与新建运动员将全部回滚。', () => {
          batchIds.forEach((id) => undoBatch(id));
          Store.save();
          if (optsCb) optsCb();
          close2();
          UI.toast('已撤销本次导入', 'ok');
        });
        ov2.querySelector('[data-adprofile]').onclick = () => { close2(); location.hash = '#/profile'; };
        ov2.querySelector('[data-adkpi]').onclick = () => { close2(); location.hash = '#/kpi'; };
      }
    });
  }

  // 入口2：对当前已解析文件的全部 sheet 走自动识别（复用步骤1已读入的矩阵，覆盖一个文件多个 sheet 的排版）
  function runAutoAllSheets() {
    if (!S.sheets.length) return;
    runAutoImport([{ file: S.fileName, sheets: analyzeSheets(S.fileName, S.sheets, listTargets()) }]);
  }

  return { open, openManual, _test: { parseDate, parseNum, detectHeaderRow, buildRecords, listTargets, suggestTarget, norm, matchAthlete, autoLocate, guessFixedDate, autoAnalyzeSheet, analyzeSheets, autoAnalyze } };
})();
