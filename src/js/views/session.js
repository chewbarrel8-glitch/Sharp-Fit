// 训练课页面：一天可排多节课；课后按运动员填写实际重量/实际完成/RIR，sRPE 按人记录
Views.session = (() => {
  const state = { date: U.today(), folded: {}, expandedAthSetRows: new Set() };   // folded: 课程卡折叠视图态；expandedAthSetRows: athleteId:rowId

  // 完课负荷摘要弹窗：每人 sRPE/时长/AU/吨位/次数/距离/做功 + 团队合计行
  // onSave(true)=保存并纳入统计；onSave(false)=不保存
  function showLoadSummaryModal(ses, mins, onSave) {
    const athIds = ses.athletes || [];
    let tKg = 0, tReps = 0, tM = 0, tS = 0, tAu = 0;
    const rowsHtml = athIds.map((aid) => {
      const a = Store.data.athletes.find((x) => x.id === aid);
      const d = Store.sessionActualDose(ses, aid);
      const rpe = (ses.athSrpe || {})[aid] != null ? ses.athSrpe[aid] : (ses.srpe ?? 6);
      const au = Math.round((rpe || 0) * mins);
      tKg += d.kg; tReps += d.reps; tM += d.m; tS += d.s; tAu += au;
      return `<tr>
        <td>${U.esc(a ? a.name : aid)}</td>
        <td class="r num">${rpe ?? '—'}</td>
        <td class="r num">${mins}</td>
        <td class="r num"><b>${U.fmt(au)}</b></td>
        <td class="r num">${d.kg ? U.fmt(Math.round(d.kg)) : '—'}</td>
        <td class="r num">${d.reps ? U.fmt(d.reps) : '—'}</td>
        <td class="r num">${d.m ? U.fmt(d.m) : '—'}</td>
        <td class="r num">${d.s ? U.fmt(Math.round(d.s)) : '—'}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="hint" style="text-align:center">尚未选择参训运动员</td></tr>';
    UI.modal({
      title: `结束训练 · ${U.esc(ses.name)} · 本节课负荷`,
      wide: true,
      body: `<p class="hint" style="margin:0 0 10px">时长 <b>${mins}</b> 分钟 · 内部负荷 = sRPE × 时长 · 外部负荷含热身组+正式组全部完成量</p>
        <div class="tbl-wrap"><table class="tbl" style="font-size:12px">
          <thead><tr><th>运动员</th><th class="r">sRPE</th><th class="r">时长(min)</th><th class="r">负荷(AU)</th><th class="r">吨位(kg)</th><th class="r">次数</th><th class="r">距离(m)</th><th class="r">做功(s)</th></tr></thead>
          <tbody>${rowsHtml}
            <tr style="font-weight:700;background:color-mix(in oklch,var(--color-accent) 8%,transparent)">
              <td>团队合计</td><td></td><td class="r num">${athIds.length ? mins : '—'}</td>
              <td class="r num">${U.fmt(tAu)}</td>
              <td class="r num">${tKg ? U.fmt(Math.round(tKg)) : '—'}</td>
              <td class="r num">${tReps ? U.fmt(tReps) : '—'}</td>
              <td class="r num">${tM ? U.fmt(tM) : '—'}</td>
              <td class="r num">${tS ? U.fmt(Math.round(tS)) : '—'}</td>
            </tr>
          </tbody>
        </table></div>`,
      footer: `<button class="btn ghost" data-discard>不保存</button><button class="btn primary" data-save>保存并纳入统计</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-save]').onclick = () => { close(); onSave(true); };
        ov.querySelector('[data-discard]').onclick = () => { close(); onSave(false); };
      }
    });
  }

  // 自动计时：训练中课程卡上的 [data-timer] 每秒刷新（模块级单例，仅更新仍存在的节点）
  let liveTick = null;
  // 计算本节课累计训练时长（秒）：已累计段 + 当前 live 段；暂停时冻结
  const sesElapsedMs = (s) => {
    let t = Number(s.sElapsed) || 0;
    if (s.sStatus === 'live' && s.sStartDate) t += Date.now() - new Date(s.sStartDate).getTime();
    return Math.max(0, t);
  };
  const fmtElapsed = (s) => {
    const t = Math.floor(sesElapsedMs(s) / 1000);
    const p = (n) => String(n).padStart(2, '0');
    return p(Math.floor(t / 3600)) + ':' + p(Math.floor(t % 3600 / 60)) + ':' + p(t % 60);
  };
  function ensureTicker() {
    if (liveTick) return;
    liveTick = setInterval(() => {
      $$('[data-timer]').forEach((el) => {
        const s = (Store.data.sessions || []).find((x) => x.id === el.dataset.timer);
        if (s && (s.sStatus === 'live' || s.sStatus === 'paused') && (s.sStartDate || s.sElapsed)) el.textContent = fmtElapsed(s);
      });
    }, 1000);
  }

  // 为训练课建立与中周期当日计划的双向映射：在 meso.days 中创建对应课程，生成 planKey
  // （mesoId:date:courseId），使中周期页面与训练课页面的动作表双向同步。已建立映射的不重复处理。
  function ensureMesoMapping(ses) {
    if (!ses || !ses.mesoId || ses.planKey) return;
    const meso = Store.data.mesos.find((m) => m.id === ses.mesoId);
    if (!meso) return;
    if (!meso.days) meso.days = [];
    let dayRec = meso.days.find((x) => x.date === ses.date);
    if (!dayRec) {
      dayRec = { date: ses.date, note: '', courses: [] };
      meso.days.push(dayRec);
    }
    if (!Array.isArray(dayRec.courses)) {
      dayRec.courses = [{ name: dayRec.note || '', type: dayRec.type || '', rows: dayRec.rows || [] }];
      delete dayRec.rows; delete dayRec.note; delete dayRec.type;
    }
    const course = { id: U.uid('mcs'), name: ses.name || '训练课', type: ses.type || '', rows: U.deepClone(ses.rows || []), blocks: U.deepClone(ses.blocks || []) };
    dayRec.courses.push(course);
    ses.planKey = meso.id + ':' + ses.date + ':' + course.id;
    ses.fromMeso = true;
  }

  // 反向同步：带 planKey 的训练课（来自中周期计划）变更后，把动作/名称/类型写回中周期当日对应课程
  function syncToMeso(ses) {
    if (!ses || !ses.mesoId) return;
    // 兜底：历史/新建时未建立映射的，先补建 planKey 与中周期课程
    if (!ses.planKey) ensureMesoMapping(ses);
    if (!ses.planKey) return;
    const parts = ses.planKey.split(':');
    const mesoId = parts[0], date = parts[1], courseId = parts[2] || null;
    const meso = Store.data.mesos.find((m) => m.id === mesoId);
    if (!meso) return;
    const dayRec = (meso.days || []).find((x) => x.date === date);
    if (!dayRec) return;
    if (!Array.isArray(dayRec.courses)) {
      dayRec.courses = [{ name: dayRec.note || '', type: dayRec.type || '', rows: dayRec.rows || [] }];
      delete dayRec.rows; delete dayRec.note; delete dayRec.type;
    }
    let course = courseId ? dayRec.courses.find((c) => c.id === courseId) : dayRec.courses[0];
    // 中周期侧课程可能已被删除：重建课程并刷新 planKey，保持双向映射不断裂
    if (!course) {
      course = { id: U.uid('mcs'), name: ses.name || '训练课', type: ses.type || '', rows: [], blocks: [] };
      dayRec.courses.push(course);
      ses.planKey = meso.id + ':' + date + ':' + course.id;
    }
    course.rows = U.deepClone(ses.rows || []);
    course.blocks = U.deepClone(ses.blocks || []);
    if (ses.name) course.name = ses.name;
    if (ses.type) course.type = ses.type;
  }

  // 每人结果数组与计划行对齐：results[athId] 按下标对应 ses.rows；
  // 计划 组数/单组量 自动带入（Own=false，随计划更新），w=实际重量/rir 由每人单独填写
  function ensureResults(ses) {
    ses.results = ses.results || {};
    ses.athSrpe = ses.athSrpe || {};
    Store.alignSessionResults(ses);
  }

  // 从逐组记录中取「最后一个 own 正式组」（热身不参与 1RM 估算）
  // 返回 {w, actual, rir, own}；无 own 正式组返回 null
  function lastOwnWorkSet(r, rs) {
    const defs = Array.isArray(rs.setDefs) && rs.setDefs.length ? rs.setDefs
      : Array.isArray(r.setDefs) && r.setDefs.length ? r.setDefs : null;
    const logs = defs && Array.isArray(rs.setLogs) ? rs.setLogs : null;
    if (!defs || !logs) return null;
    let last = null;
    logs.forEach((lg, k) => {
      if (!lg || lg.kind === 'warm' || lg.done === false) return;
      if (lg.own) last = { lg, def: defs[k] };
    });
    if (!last) return null;
    const { lg, def } = last;
    const rm = Store.athRm(rs._aid, r.exId);
    let w = lg.w != null ? Number(lg.w) : Calc.setDefWeight(def, rm ? rm.value : null);
    let actual = lg.actual != null ? Number(lg.actual) : Calc.setDefDose(r, def);
    return { w: w || 0, actual: actual || 0, rir: lg.rir != null ? lg.rir : 0, own: true };
  }

  // 单人单动作课后估算 1RM 的输入：重量（实际重量优先，回退计划重量）× 单组完成次数 × RIR
  // 逐组记录时取「最后一个 own 正式组」（热身不参与）
  // 返回 {est, warn, over, w, actual, rir}；距离/时间行或未填重量/单组量时返回 null（界面上显示「—」）
  function estInput(ses, aid, i) {
    const r = (ses.rows || [])[i];
    if (!r || !r.exId) return null;
    if (Calc.metricOf(r) !== 'reps') return null;   // 距离/时间行不估算 1RM；任何 kg 行动作都可估算
    const rs = ((ses.results || {})[aid] || [])[i];
    if (!rs) return null;
    // 逐组记录路径：取最后一个 own 正式组
    const s = lastOwnWorkSet(r, Object.assign({}, rs, { _aid: aid }));
    if (s) {
      if (!s.w || !s.actual) return null;
      const info = Calc.estimate1RMInfo(s.w, s.actual, s.rir);
      if (!info) return null;
      return { est: info.est, warn: info.warn, over: info.over, planned: false, planReps: false, w: s.w, actual: s.actual, rir: s.rir };
    }
    const rm = Store.athRm(aid, r.exId);
    const pw = rm && r.pct ? Calc.weightFromPct(rm.value, r.pct) : r.weight;
    const planned = rs.w == null;
    const planReps = !rs.actualOwn;
    const w = planned ? pw : rs.w;
    if (!w || !rs.actual) return null;
    const rir = rs.rir != null ? rs.rir : 0;
    const info = Calc.estimate1RMInfo(w, rs.actual, rir);   // 按「单组次数」评估；>12 次超出公式范围
    if (!info) return null;
    return { est: info.est, warn: info.warn, over: info.over, planned, planReps, w, actual: rs.actual, rir };
  }

  // 保存课后估算：force=true（「更新1RM」按钮）把估算提升为该运动员该动作的生效 1RM（下次训练按此值计划重量）；
  // 否则（填写时自动保存）仅追加档案历史，已有测定基准时不覆盖基准。
  // 同课同日同动作的相同估算值去重——无论手动还是自动都不产生重复记录。
  // 返回估算值（无法估算返回 null）
  function saveEst(ses, aid, i, force) {
    const r = (ses.rows || [])[i];
    if (!r || !r.exId) return null;
    const e = estInput(ses, aid, i);
    if (!e || !e.est) return null;   // 距离/时间行、缺重量、或单组次数超 12 次（公式不适用）时不写入
    if (e.planned || e.planReps) return null;      // 重量或次数仍按计划回退（未填该运动员实际值）只作界面预览，不写入 1RM 历史/测试记录/生效值
    const hist = Store.athRmHistory(aid, r.exId);
    const last = hist.length ? hist[hist.length - 1] : null;
    const dup = !!(last && last.source === 'session' && last.value === e.est && last.date === ses.date && (!last.sid || last.sid === ses.id));
    const ath = Store.data.athletes.find((a) => a.id === aid);
    if (!dup) {
      Store.updateAthRm(aid, r.exId, e.est, ses.date, (ath ? ath.name : '') + ' 训练课估算', 'session', !!force, ses.id);
      // 同一课同一动作只保留一条课后估算测试记录（重复填写/手动更新时覆盖；sessionId 必须写入，否则去重失效；兼容早期无 sessionId 的旧记录）
      Store.data.tests = (Store.data.tests || []).filter((t) => {
        if (!(t.source === 'session' && t.athleteId === aid && t.exerciseId === r.exId)) return true;
        return t.sessionId ? t.sessionId !== ses.id : t.date !== ses.date;
      });
      Store.data.tests.push({
        id: U.uid('tst'), sessionId: ses.id, athleteId: aid, exerciseId: r.exId,
        weight: e.w, reps: e.actual, rir: e.rir,
        estimated1RM: e.est, date: ses.date, source: 'session', note: ses.name
      });
    } else if (force) {
      // 相同估算记录已存在：显式点击仍要把它提升为生效 1RM，但不重复追加历史/测试记录
      Store.promoteAthRm(aid, r.exId, e.est, ses.date);
    }
    return e.est;
  }

  // 同步运动员负荷记录（按人 sRPE × 时长）
  function syncEntries(ses) {
    Store.data.loadEntries = Store.data.loadEntries.filter((e) => e.sessionId !== ses.id);
    const duration = Number(ses.duration);
    if (!(ses.athletes || []).length || !Number.isFinite(duration) || duration <= 0) return;
    for (const aid of ses.athletes) {
      const rawRpe = (ses.athSrpe || {})[aid] != null ? ses.athSrpe[aid] : ses.srpe;
      const parsedRpe = rawRpe == null ? 6 : Number(rawRpe);
      const rpe = Number.isFinite(parsedRpe) ? parsedRpe : 6;
      Store.data.loadEntries.push({
        id: U.uid('le'), athleteId: aid, date: ses.date,
        rpe, duration,
        load: Math.round(rpe * duration),
        source: 'session', sessionId: ses.id, note: ses.name
      });
    }
  }

  function sessionCard(v, ses) {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.marginTop = '14px';
    card.dataset.ses = ses.id;
    const render = () => {
      const folded = !!state.folded[ses.id];
      const live = ses.sStatus === 'live';
      const paused = ses.sStatus === 'paused';
      const done = ses.sStatus === 'done';
      if (live || paused) ensureTicker();
      const ctrlBtn = live
        ? `<button class="btn sm warn" data-act="pause" title="暂停计时（数据继续自动保存）">⏸ 暂停</button>
           <button class="btn sm danger" data-act="toggle-live" title="结束训练：询问是否保存并计算负荷">■ 结束训练</button>`
        : paused
          ? `<button class="btn sm primary" data-act="resume" title="继续计时">▶ 继续</button>
             <button class="btn sm danger" data-act="toggle-live" title="结束训练：询问是否保存并计算负荷">■ 结束训练</button>`
          : `<button class="btn sm primary" data-act="toggle-live" title="${done ? '重新开始本课训练（重新计时）' : '开始本课训练：填写过程自动保存，结束时询问是否保存并计算负荷'}">${done ? '▶ 再次开始训练' : '▶ 开始训练'}</button>
             ${done ? `<button class="btn sm" data-act="load-summary" title="查看本节课个人与团队负荷摘要">📊 本课负荷</button>` : ''}`;
      const statusChip = live ? '<span class="chip red">训练中 · 自动保存</span>' : paused ? '<span class="chip" style="background:color-mix(in oklch,var(--color-warning) 18%,transparent);color:var(--color-warning)">已暂停</span>' : done ? '<span class="chip volt">已完课</span>' : '';
      card.innerHTML = `
        <div class="card-title">
          <h3 style="flex:1"><input class="ipt" data-f="name" value="${U.esc(ses.name)}" style="font-weight:700;font-size:15px;min-width:200px">
          <select class="sel" data-f="type" style="width:120px;margin-left:8px" title="按七大训练模块分组的课型">${Store.TRAIN_MODULES.map((m) => `<optgroup label="${m.name}">${m.types.map((t) => `<option ${ses.type === t ? 'selected' : ''}>${t}</option>`).join('')}</optgroup>`).join('')}${ses.type && !Store.moduleOfType(ses.type) ? `<option selected>${U.esc(ses.type)}</option>` : ''}</select></h3>
          <div class="row">
            <span class="hint" data-sum style="${folded ? '' : 'display:none'}">${ses.time || ''} · ${live ? '计时中' : paused ? '已暂停' : (ses.duration != null ? ses.duration + 'min' : '未计时')} · ${(ses.athletes || []).length}人</span>
            ${ctrlBtn}
            ${statusChip}
            <button class="btn sm ghost" data-act="fold" title="折叠/展开本课详情（同日多课时折叠省空间）">${folded ? '展开 ▸' : '折叠 ▾'}</button>
            <button class="btn sm" data-act="dup">复制课程</button>
            <button class="btn sm danger" data-act="del">删除</button>
          </div>
        </div>
        <div data-body style="${folded ? 'display:none' : ''}">
        <div class="row" style="gap:16px;margin-bottom:14px">
          <div class="field"><label>训练时长</label>
            ${(live || paused) ? `<div class="row" style="gap:8px"><span class="chip ${paused ? '' : 'red'}" style="font-size:13px">⏱ <span data-timer="${ses.id}">${fmtElapsed(ses)}</span></span>${ses.time ? `<span class="hint">${ses.time} 开始${paused ? ' · 已暂停' : ''}</span>` : ''}</div>`
              : done ? `<div class="row" style="gap:8px"><span class="chip volt" style="margin-top:4px">实际 ${ses.duration ?? 0} 分钟</span>${ses.time ? `<span class="hint">${ses.time}–${ses.sEnd || ''}</span>` : ''}</div>`
                : ''}
          </div>
          <div class="field"><label>备赛运动员</label>
            <button class="btn sm" data-act="ath">${(ses.athletes || []).length ? `已选 ${(ses.athletes || []).length} 人` : '选择运动员'}</button></div>
        </div>
        <div class="hint" data-micro-tip style="margin:-6px 0 10px"></div>
        <div data-table></div>
        <div data-ath-plans></div>
        <div class="field" style="margin-top:12px"><label>课程备注</label><input class="ipt" data-f="note" value="${U.esc(ses.note || '')}"></div>
        </div>`;

      // 来自小周期/中周期映射：小周期当日安排（类型/强度/主题）+ 中周期当日力量计划摘要，均可点击跳转
      const mic = Store.data.micros.find((m) => ses.date >= m.startDate && ses.date <= m.endDate);
      const micDay = mic ? (mic.days || []).find((x) => x.date === ses.date) : null;
      const tip = card.querySelector('[data-micro-tip]');
      if (mic && tip) {
        const seg = [];
        if (micDay && micDay.type) seg.push(`类型 ${U.esc(micDay.type)}`);
        if (micDay && micDay.intensity != null) seg.push(`强度 ${micDay.intensity}%`);
        if (micDay && micDay.note) seg.push(U.esc(micDay.note));
        // 来自中周期：当日计划摘要（动作数 / 吨位·距离·做功 三族外部负荷）
        const meso = Store.data.mesos.find((x) => x.id === mic.mesoId);
        const mday = meso ? (meso.days || []).find((x) => x.date === ses.date) : null;
        const mrows = Store.dayRows(mday);
        if (mrows.length) {
          const md = [
            Calc.rowsTonnage(mrows) ? U.fmt(Calc.rowsTonnage(mrows)) + ' kg' : '',
            Calc.rowsDistance(mrows) ? U.fmt(Calc.rowsDistance(mrows)) + ' m' : '',
            Calc.rowsDuration(mrows) ? U.fmt(Math.round(Calc.rowsDuration(mrows) / 6) / 10) + ' min' : ''
          ].filter(Boolean).join(' · ');
          seg.push(`中周期计划 ${mrows.length} 动作${md ? ' · ' + md : ''}<span data-meso-jump style="cursor:pointer;color:var(--volt);margin-left:6px">› 查看中周期</span>`);
        }
        tip.innerHTML = `📋 来自小周期「${U.esc(mic.name)}」${seg.length ? ' · ' + seg.join(' · ') : '（当日安排未设定）'}<span data-mic-jump style="cursor:pointer;color:var(--volt);margin-left:8px">› 进入小周期</span>`;
        const jump = tip.querySelector('[data-mic-jump]');
        if (jump) jump.onclick = () => Views.micro.show(mic.id);
        const mj = tip.querySelector('[data-meso-jump]');
        if (mj) mj.onclick = () => {
          if (Views.meso && Views.meso.state) {
            Views.meso.state.mesoId = mic.mesoId;
            Views.meso.state.day = ses.date;
            Views.meso.state.microId = null; Views.meso.state.weekIdx = null;
          }
          location.hash = '#/meso';
        };
      }

      // 动作计划表（pctOnly：只显示 %1RM 不显示重量——同一 % 各人对应重量不同；
      // 计划重量仍按每人 1RM 内部换算供总负荷/吨位统计，实际数据在下方每名运动员处填写）
      const tbl = UI.exerciseTable({
        rows: ses.rows,
        container: ses,
        pctOnly: true,
        setEditor: false,
        athleteId: (ses.athletes && ses.athletes.length === 1) ? ses.athletes[0] : null,
        planAthIds: (ses.athletes || []).slice(),
        onChanged: () => {
          ensureResults(ses);
          syncToMeso(ses);
          Store.save();
          renderDayBar(v);
          renderAthPlans();
        }
      });
      card.querySelector('[data-table]').appendChild(tbl);

      // 每运动员训练计划与完成情况：计划重量（按其 1RM）+ 实际重量/实际完成/RIR + 按人 sRPE
      function renderAthPlans() {
        const box = card.querySelector('[data-ath-plans]');
        const athIds = ses.athletes || [];
        if (!athIds.length) { box.innerHTML = ''; return; }
        ensureResults(ses);
        const planW = (aid, r) => { const rm = Store.athRm(aid, r.exId); return rm && r.pct ? Calc.weightFromPct(rm.value, r.pct) : r.weight; };
        // 每人实际完成的单位/占位（随行动量纲：次 / m / s，距离统一米、做功统一秒；无负荷行同样计次）
        const actualUnit = (r) => {
          const m = Calc.metricOf(r);
          return m === 'reps' ? '次' : m === 'distance' ? 'm' : m === 'duration' ? 's' : '';
        };
        box.innerHTML = `
          <div class="card-title" style="margin-top:14px"><h3 style="font-size:13px">运动员训练计划与完成情况</h3></div>
          <div style="display:grid;grid-template-columns:1fr;gap:10px">
            ${athIds.map((aid) => {
              const a = Store.data.athletes.find((x) => x.id === aid);
              if (!a) return '';
              const rmCount = (() => { const rec = (Store.data.athleteRm || {})[aid]; return rec ? Object.keys(rec).filter((k) => rec[k] && rec[k].value).length : 0; })();
              const rows = ses.rows || [];
              const res = ses.results[aid] || [];
              const srpe = (ses.athSrpe || {})[aid];
              const au = srpe != null ? Math.round(srpe * (Number(ses.duration) || 0)) : null;
              const dose = Store.sessionActualDose(ses, aid, { actualOnly: true });
              const doseChips = [
                dose.kg ? `吨位 ${U.fmt(dose.kg)} kg` : '',
                dose.reps ? `次数 ${U.fmt(dose.reps)} 次` : '',
                dose.m ? `距离 ${U.fmt(dose.m)} m` : '',
                dose.s ? `做功 ${U.fmt(Math.round(dose.s / 6) / 10)} min` : ''
              ].filter(Boolean);
              return `<div class="card" style="padding:10px;background:var(--bg2);margin:0">
                <div class="row" style="justify-content:space-between;margin-bottom:6px;gap:6px;flex-wrap:wrap">
                  <div class="row" style="gap:8px">${U.avatar(a, 'width:28px;height:28px;font-size:13px')}<div><b>${U.esc(a.name)}</b><div class="hint">${rmCount ? rmCount + ' 项专属1RM' : '无专属1RM'}</div></div></div>
                  <div class="row" style="gap:6px;flex-wrap:wrap">
                    ${doseChips.length ? doseChips.map((t) => `<span class="chip volt">${t}</span>`).join('') : '<span class="chip">实际外部负荷未填</span>'}
                    <span class="chip ${au ? 'volt' : ''}" data-au="${aid}">${au != null ? '负荷 ' + U.fmt(au) + ' AU' : '未填'}</span>
                    <button class="btn danger sm" data-rm-ath="${aid}" title="移除该运动员的本课计划">移除</button>
                  </div>
                </div>
                <div class="row" style="gap:10px;margin-bottom:8px;align-items:center">
                  <span class="hint" style="white-space:nowrap">完课 sRPE</span>
                  <input type="range" min="0" max="10" step="0.5" value="${srpe ?? 6}" data-srpe="${aid}" style="flex:1">
                  <span class="val" style="min-width:28px;text-align:right">${srpe ?? 6}</span>
                </div>
                ${rows.length ? `<div class="tbl-wrap athlete-plan-wrap" style="overflow-x:auto"><table class="tbl athlete-plan-table" style="font-size:11px">
                  <thead><tr><th class="athlete-action-col">动作 / 组</th><th class="r">计划%</th><th class="r">计划量</th><th class="r">实际重量</th><th class="r">实际完成</th><th class="r">RIR</th><th class="r">完成</th><th class="r">估算1RM</th></tr></thead>
                  <tbody>${rows.map((r, i) => {
                    const ex = Store.exercise(r.exId);
                    const isKg = Calc.rowUnit(r) === 'kg';
                    const lt = Calc.loadTypeOf(r);
                    const pw = planW(aid, r);
                    const rs = res[i] || {};
                    const rowKey = `${aid}:${r.rid || i}`;
                    const athleteExpanded = state.expandedAthSetRows.has(rowKey);
                    const complexBlock = r.blkId ? (ses.blocks || []).find((block) => block.id === r.blkId) : null;
                    const complexStart = complexBlock && (!rows[i - 1] || rows[i - 1].blkId !== r.blkId);
                    const complexHeader = complexStart
                      ? `<tr class="ath-complex-head"><td colspan="8"><div class="row" style="gap:8px;align-items:center"><b>复杂训练 ${U.esc(complexBlock.label || '')}</b><span class="hint">${rows.filter((row) => row.blkId === r.blkId).length} 个动作 · 正式组共享 ${Number(complexBlock.sets) || Number(r.sets) || 0} 组</span></div></td></tr>`
                      : '';
                    const complexPosition = complexBlock ? `${U.esc(complexBlock.label || '')}${Store.blockPos(rows, r)}` : '';
                    const e0 = isKg ? estInput(ses, aid, i) : null;
                    const unit = actualUnit(r);
                    const estCell = !isKg ? '<span class="hint" style="font-size:10px">—</span>'
                      : e0 && e0.over
                        ? '<span class="hint" style="font-size:10px;color:var(--color-warning)">单组次数过高<br>请用≤10次组重测</span>'
                        : e0
                          ? `<span class="est-box" style="display:inline-flex;align-items:center;gap:6px;padding:2px 6px 2px 10px;border:1px solid ${e0.warn ? UI.cssVar('var(--color-warning)') : 'var(--line2)'};border-radius:8px;background:var(--panel2)"><b data-estv style="font-size:12px">${U.fmt(e0.est)} kg</b>${e0.warn ? '<small style="color:var(--color-warning);font-size:9px">偏高</small>' : ''}${(e0.planned || e0.planReps)
                            ? ''
                            : `<button class="btn sm primary" data-uprm="${aid}:${i}" style="padding:2px 8px;font-size:10px">更新1RM</button>`}</span>`
                          : '<span class="hint" style="font-size:10px">—</span>';
                    // 逐组记录模式（计划已展开 setDefs）
                    const rowLabel = `<span class="row" style="gap:5px;flex-wrap:nowrap"><button class="btn sm ghost" data-ath-expand="${aid}:${i}" title="展开此运动员的逐组计划与完成记录">${athleteExpanded ? '▾' : '▸'}</button>${complexPosition ? `<span class="blk-badge" title="复杂训练 ${complexPosition}">${complexPosition}</span>` : ''}<span>${U.esc(ex ? ex.name : '—')}</span></span><div class="hint" style="font-size:10px">${({ kg: '次', bw: '次', m: '距离', s: '时间', none: '无负荷' })[Calc.rowUnit(r)] || '次'}${lt === 'resistance' ? ' · 抗阻' : lt === 'bodyweight' ? ' · 自重' : lt === 'none' ? ' · 无负荷' : ''}</div>`;
                    const personalDefs = Array.isArray(rs.setDefs) && rs.setDefs.length ? rs.setDefs : r.setDefs;
                    if (athleteExpanded && Array.isArray(personalDefs) && personalDefs.length && Array.isArray(rs.setLogs) && rs.setLogs.length) {
                      const defs = personalDefs, logs = rs.setLogs;
                      const formalCount = defs.filter((d) => d.kind !== 'warm').length;
                      const doneFormal = logs.filter((lg, k) => lg && lg.done !== false && defs[k] && defs[k].kind !== 'warm').length;
                      const subRows = defs.map((d, k) => {
                        const lg = logs[k] || {};
                        const planWd = Calc.setDefWeight(d, (Store.athRm(aid, r.exId) || {}).value || null);
                        const planDose = Calc.setDefDose(r, d);
                        const kind = d.kind === 'warm' ? '热身' : '正式';
                        return `<tr class="sd-log-row ${d.kind === 'warm' ? 'warm' : 'work'}">
                          <td class="athlete-action-cell"><span class="sd-kind ${d.kind === 'warm' ? 'warm' : 'work'}">${kind} ${k + 1}</span></td>
                          <td class="r num">${isKg ? (d.pct ?? '—') : '—'}</td>
                          <td class="r num">${planWd && isKg ? U.fmt(planWd) + 'kg' : (planDose ? planDose + unit : '—')}</td>
                          <td class="r">${isKg ? `<input class="ipt" type="number" step="0.5" min="0" style="width:68px;text-align:right" value="${lg.w ?? ''}" data-sl="${aid}:${i}:${k}" data-slf="w" title="该组实际重量">` : '—'}</td>
                          <td class="r">${`<input class="ipt${lg.own ? '' : ' auto-val'}" type="number" step="any" min="0" style="width:60px;text-align:right" value="${lg.actual ?? ''}" data-sl="${aid}:${i}:${k}" data-slf="actual" title="该组实际完成量（次/m/s）"><small class="hint">${unit}</small>`}</td>
                          <td class="r">${isKg ? `<input class="ipt" type="number" min="0" max="10" style="width:46px;text-align:right" value="${lg.rir ?? ''}" data-sl="${aid}:${i}:${k}" data-slf="rir">` : '—'}</td>
                          <td class="c"><input type="checkbox" ${lg.done === false ? '' : 'checked'} data-sl="${aid}:${i}:${k}" data-slf="done" title="该组是否完成"></td>
                          <td class="c"><button class="btn sm ghost ath-set-delete" data-ath-set-delete="${aid}:${i}:${k}" ${d.kind !== 'warm' && formalCount <= 1 ? 'disabled' : ''} title="删除此${kind}组" aria-label="删除此${kind}组">×</button></td>
                        </tr>`;
                      }).join('');
                        return `${complexHeader}<tr>
                          <td class="athlete-action-cell">${rowLabel}</td>
                          <td class="r num">${isKg ? (r.pct ?? '—') : '—'}</td>
                          <td class="r num">${pw && isKg ? U.fmt(pw) : U.fmt(Calc.planRowDose(r))}</td>
                          <td colspan="3" class="hint" style="font-size:10px">逐组记录（热身组不计入 1RM 估算）</td>
                          <td class="r num${doneFormal < formalCount ? ' volt' : ''}">${doneFormal}/${formalCount}</td>
                          <td class="r num" data-est="${aid}:${i}">${estCell}</td>
                        </tr>${subRows}<tr class="ath-set-actions"><td colspan="8"><div class="row" style="gap:6px;padding:4px 0"><button class="btn sm ex-ath-add-warm" data-ath-row="${i}" data-ath-id="${aid}">＋ 热身组</button><button class="btn sm primary ex-ath-add-work" data-ath-row="${i}" data-ath-id="${aid}">＋ 正式组</button><span class="hint">正式组数量从中周期组数带入</span></div></td></tr>`;
                    }
                    // 扁平模式
                    const planDoseTxt = isKg
                      ? (pw ? U.fmt(pw) + 'kg' : '—')
                      : (Calc.planRowDose(r) ? U.fmt(Calc.planRowDose(r)) + unit : '—');
                    // 完成组数：有逐组记录则自动汇总已勾选正式组，否则带入计划组数
                    const flatDoneSets = (Array.isArray(rs.setLogs) && rs.setLogs.length && Array.isArray(personalDefs) && personalDefs.length)
                      ? rs.setLogs.filter((lg, k) => lg && lg.done !== false && personalDefs[k] && personalDefs[k].kind !== 'warm').length
                      : null;
                    const setsDisplay = flatDoneSets != null ? flatDoneSets : (Number(r.sets) || 0);
                    const setsAuto = flatDoneSets == null;
                    return `${complexHeader}<tr>
                      <td class="athlete-action-cell">${rowLabel}</td>
                      <td class="r num">${isKg ? (r.pct ?? '—') : '—'}</td>
                      <td class="r num">${planDoseTxt}</td>
                      <td class="r">${isKg ? `<input class="ipt" type="number" step="0.5" min="0" style="width:68px;text-align:right" value="${rs.w ?? ''}" data-rw="${aid}:${i}" title="实际负重">` : '—'}</td>
                      <td class="r">${`<div class="row" style="gap:3px;flex-wrap:nowrap;justify-content:flex-end"><input class="ipt${rs.actualOwn ? '' : ' auto-val'}" type="number" step="any" min="0" style="width:60px;text-align:right" value="${rs.actual ?? ''}" data-ra="${aid}:${i}" title="单组完成量"><small class="hint">${unit}</small></div>`}</td>
                      <td class="r">${isKg ? `<input class="ipt" type="number" min="0" max="10" style="width:46px;text-align:right" value="${rs.rir ?? ''}" data-rr="${aid}:${i}" title="RIR">` : '—'}</td>
                      <td class="r num${setsAuto ? ' auto-val' : ''}">${setsDisplay}</td>
                      <td class="r num" data-est="${aid}:${i}">${estCell}</td>
                    </tr>`;
                  }).join('')}</tbody>
                </table></div>` : '<p class="hint" style="padding:4px 0">无计划行</p>'}
              </div>`;
            }).join('')}
          </div>`;

                  const athleteRowKey = (aid, rowIndex) => {
                    const row = (ses.rows || [])[rowIndex];
                    return `${aid}:${row && row.rid || rowIndex}`;
                  };
                  const athleteRow = (button) => {
                    const key = button.dataset.athExpand || button.dataset.athSet || button.dataset.athSetAdd;
                    const aid = button.dataset.athId || key.split(':')[0];
                    const rowIndex = Number(button.dataset.athRow ?? key.split(':')[1]);
                    return { aid, rowIndex, rs: ((ses.results || {})[aid] || [])[rowIndex] };
                  };
                  const makePersonalSetDefs = (row) => {
                    const count = Math.max(1, Number(row.sets) || 1);
                    return Array.from({ length: count }, () => ({
                      sid: U.uid('set'), kind: 'work', pct: row.pct ?? null, weight: row.weight ?? null,
                      reps: Calc.metricOf(row) === 'reps' ? row.reps ?? null : null,
                      dist: Calc.metricOf(row) === 'distance' ? row.dist ?? null : null,
                      distUnit: row.distUnit || 'm',
                      dur: Calc.metricOf(row) === 'duration' ? row.dur ?? null : null,
                      durUnit: row.durUnit || 's'
                    }));
                  };
                  $$('[data-ath-expand]', box).forEach((button) => {
                    button.onclick = () => {
                      const { aid, rowIndex, rs } = athleteRow(button);
                      if (!rs || !ses.rows[rowIndex]) return;
                      const key = athleteRowKey(aid, rowIndex);
                      if (state.expandedAthSetRows.has(key)) {
                        state.expandedAthSetRows.delete(key);
                      } else {
                        state.expandedAthSetRows.add(key);
                        if (!Array.isArray(rs.setDefs) || !rs.setDefs.length) rs.setDefs = makePersonalSetDefs(ses.rows[rowIndex]);
                        Store.alignSessionResults(ses);
                      }
                      renderAthPlans();
                    };
                  });
                  const addAthleteSet = (button, kind) => {
                    const { aid, rowIndex, rs } = athleteRow(button);
                    if (!rs || !ses.rows[rowIndex]) return;
                    if (!Array.isArray(rs.setDefs) || !rs.setDefs.length) rs.setDefs = makePersonalSetDefs(ses.rows[rowIndex]);
                    const row = ses.rows[rowIndex];
                    const definition = {
                      sid: U.uid('set'), kind, pct: row.pct ?? null, weight: row.weight ?? null,
                      reps: Calc.metricOf(row) === 'reps' ? row.reps ?? null : null,
                      dist: Calc.metricOf(row) === 'distance' ? row.dist ?? null : null,
                      distUnit: row.distUnit || 'm',
                      dur: Calc.metricOf(row) === 'duration' ? row.dur ?? null : null,
                      durUnit: row.durUnit || 's'
                    };
                    if (kind === 'warm') rs.setDefs.unshift(definition);
                    else rs.setDefs.push(definition);
                    state.expandedAthSetRows.add(athleteRowKey(aid, rowIndex));
                    Store.alignSessionResults(ses);
                    saveEst(ses, aid, rowIndex);
                    Store.save();
                    renderAthPlans();
                  };
                  $$('.ex-ath-add-warm', box).forEach((button) => { button.onclick = () => addAthleteSet(button, 'warm'); });
                  $$('.ex-ath-add-work', box).forEach((button) => { button.onclick = () => addAthleteSet(button, 'work'); });
                  $$('.ath-set-delete', box).forEach((button) => {
                    button.onclick = () => {
                      const [aid, rowIndex, setIndex] = button.dataset.athSetDelete.split(':');
                      const ri = Number(rowIndex), si = Number(setIndex);
                      const rs = ((ses.results || {})[aid] || [])[ri];
                      if (!rs || !Array.isArray(rs.setDefs)) return;
                      const definition = rs.setDefs[si];
                      if (!definition) return;
                      if (definition.kind !== 'warm' && rs.setDefs.filter((d) => d.kind !== 'warm').length <= 1) {
                        UI.toast('每个动作至少保留一组正式组', 'err');
                        return;
                      }
                      rs.setDefs.splice(si, 1);
                      state.expandedAthSetRows.add(athleteRowKey(aid, ri));
                      Store.alignSessionResults(ses);
                      saveEst(ses, aid, ri);
                      Store.save();
                      renderAthPlans();
                    };
                  });

        // 移除运动员：清除本课计划 + 负荷记录 + 按人数据
        $$('[data-rm-ath]', box).forEach((b) => {
          b.onclick = () => UI.confirm(`移除「${U.esc(Store.data.athletes.find((x) => x.id === b.dataset.rmAth)?.name || '运动员')}」的本课计划？`, () => {
            const aid = b.dataset.rmAth;
            ses.athletes = (ses.athletes || []).filter((id) => id !== aid);
            if (ses.results) delete ses.results[aid];
            if (ses.athSrpe) delete ses.athSrpe[aid];
            Store.data.loadEntries = Store.data.loadEntries.filter((e) => e.athleteId !== aid || e.sessionId !== ses.id);
            Store.save(); syncEntries(ses); mount(); UI.toast('已移除该运动员', 'ok');
          });
        });
        // 按人 sRPE
        $$('[data-srpe]', box).forEach((inp) => {
          const aid = inp.dataset.srpe;
          inp.oninput = () => { inp.parentElement.querySelector('.val').textContent = inp.value; };
          inp.onchange = () => {
            ses.athSrpe = ses.athSrpe || {};
            if (inp.value === '') delete ses.athSrpe[aid]; else ses.athSrpe[aid] = Number(inp.value);
            Store.save(); syncEntries(ses);
            const au = ses.athSrpe[aid];
            const chip = box.querySelector(`[data-au="${aid}"]`);
            if (chip) {
              chip.className = 'chip ' + (au != null ? 'volt' : '');
              chip.textContent = au != null ? `负荷 ${U.fmt(Math.round(au * (Number(ses.duration) || 0)))} AU` : '未填';
            }
          };
        });
        // 每人每动作：实际重量 / 单组量 / RIR（完成组数由逐组勾选自动汇总，无需手动输入）
        const bindRes = (inp, field) => {
          const key = inp.dataset.rw ?? inp.dataset.ra ?? inp.dataset.rr;
          const [aid, idx] = key.split(':');
          const i = Number(idx);
          inp.onchange = () => {
            ensureResults(ses);
            const rs = ses.results[aid][i];
            const v = inp.value === '' || isNaN(Number(inp.value)) ? null : Number(inp.value);
            rs[field] = v;
            // 单组量：非空=该运动员单独修改（不再跟随计划）；清空=恢复跟随计划（下次渲染自动带回计划值）
            if (field === 'actual') {
              rs.actualOwn = v != null;
              // 填了单组量时自动带入计划组数（完成列改为自动汇总，不再手动输入组数）
              if (v != null && !rs.setsOwn) { rs.sets = Number(ses.rows[i].sets) || 0; rs.setsOwn = true; }
            }
            saveEst(ses, aid, i);
            Store.save();
            // 重新渲染运动员区：填写单组量后该行才出现「估算1RM + 更新1RM」组合框，清空则隐藏/恢复计划带入
            renderAthPlans();
          };
        };
        $$('[data-rw]', box).forEach((inp) => bindRes(inp, 'w'));
        $$('[data-ra]', box).forEach((inp) => bindRes(inp, 'actual'));
        $$('[data-rr]', box).forEach((inp) => bindRes(inp, 'rir'));
        // 逐组记录：data-sl="aid:rowIdx:setIdx" data-slf="w|actual|rir|done"
        $$('[data-sl]', box).forEach((inp) => {
          const [aid, ri, si] = inp.dataset.sl.split(':').map((x, j) => j === 0 ? x : Number(x));
          const f = inp.dataset.slf;
          const apply = () => {
            ensureResults(ses);
            const rs = (ses.results[aid] || [])[ri]; if (!rs || !rs.setLogs) return;
            const lg = rs.setLogs[si]; if (!lg) return;
            if (f === 'done') { lg.done = !!inp.checked; }
            else {
              const v = inp.value === '' || isNaN(Number(inp.value)) ? null : Number(inp.value);
              lg[f] = v;
              // 非空=该运动员此组单独修改（own=true）；清空=恢复跟随计划
              if (v == null) { lg.own = false; lg.w = null; lg.actual = null; }
              else lg.own = true;
            }
            saveEst(ses, aid, ri);
            Store.save();
            renderAthPlans();
          };
          if (f === 'done') inp.onchange = apply; else inp.onchange = apply;
        });
        // 「更新1RM」：把本次课后估算值无条件写入该运动员该动作的 1RM 数据源，下次训练按最新值计算计划重量
        $$('[data-uprm]', box).forEach((b) => {
          b.onclick = () => {
            const [aid, idx] = b.dataset.uprm.split(':');
            const est = saveEst(ses, aid, Number(idx), true);
            if (est == null) { UI.toast('请先填写实际重量与单组次数（单组 ≤12 次，建议 3-10 次）', 'err'); return; }
            Store.save();
            const span = box.querySelector(`[data-est="${aid}:${idx}"] [data-estv]`);
            if (span) span.textContent = U.fmt(est) + ' kg';
            // toast 带上运动员/动作/记录日期（=训练课日期），明确告知这条记录归到谁、去哪一天的档案里找
            const ath2 = Store.data.athletes.find((x) => x.id === aid);
            const ex2 = Store.exercise((ses.rows || [])[Number(idx)] && ses.rows[Number(idx)].exId);
            UI.toast(`已更新：${ath2 ? ath2.name : ''} · ${ex2 ? ex2.name : ''} ${U.fmt(est)} kg，记录日期 ${U.md(ses.date)}（档案页按训练课日期归档）`, 'ok');
          };
        });
      }
      renderAthPlans();

      // 绑定课程字段（跳过动作表内部输入——其事件由 exerciseTable 自行管理）
      $$('[data-f]', card).forEach((inp) => {
        if (inp.closest('[data-table]')) return;
        const f = inp.dataset.f;
        inp.onchange = () => {
          if (f === 'duration') {
            ses.duration = Number(inp.value) || 0;
            syncEntries(ses);   // 时长变化 → 按人 AU 负荷同步更新
          }
          else if (f === 'name') ses.name = inp.value.trim() || '未命名课程';
          else ses[f] = inp.value;
          syncToMeso(ses);
          Store.save(); syncEntries(ses); renderDayBar(v); renderAthPlans();
        };
      });
      card.querySelector('[data-act="ath"]').onclick = () => UI.athletePicker(ses.athletes || [], (ids) => {
        ses.athletes = ids; Store.save(); syncEntries(ses); mount();
      }, (Store.activeMacro() || {}).sport);
      card.querySelector('[data-act="dup"]').onclick = () => {
        const cp = U.deepClone(ses);
        cp.id = U.uid('ses'); cp.name = ses.name + '（副本）';
        delete cp.planKey; delete cp.fromMeso;   // 副本脱离中周期映射（planKey 唯一对应一节课）
        // 重新生成组块 id，避免与原课共享同一组块标识导致跨课污染
        (cp.blocks || []).forEach((b) => { const oldId = b.id; b.id = U.uid('blk'); (cp.rows || []).forEach((r) => { if (r.blkId === oldId) r.blkId = b.id; }); });
        cp.results = {};   // 课后记录不复制，避免重复计入负荷
        Store.data.sessions.push(cp); Store.save(); mount(); UI.toast('已复制课程', 'ok');
      };
      card.querySelector('[data-act="del"]').onclick = () => UI.confirm(`删除课程「${U.esc(ses.name)}」？关联的负荷记录将一并删除。`, () => {
        Store.data.sessions = Store.data.sessions.filter((s) => s.id !== ses.id);
        Store.data.loadEntries = Store.data.loadEntries.filter((e) => e.sessionId !== ses.id);
        Store.save(); mount(); UI.toast('已删除', 'ok');
      });
      // 折叠/展开本课（视图态，不影响数据；同日多课时默认只展开首课）
      card.querySelector('[data-act="fold"]').onclick = () => { state.folded[ses.id] = !state.folded[ses.id]; render(); };
      // 暂停：把当前 live 段累加到 sElapsed，状态置 paused（计时冻结，数据仍自动保存）
      if (card.querySelector('[data-act="pause"]')) {
        card.querySelector('[data-act="pause"]').onclick = () => {
          if (ses.sStatus !== 'live' || !ses.sStartDate) return;
          ses.sElapsed = (Number(ses.sElapsed) || 0) + (Date.now() - new Date(ses.sStartDate).getTime());
          ses.sStartDate = null;
          ses.sStatus = 'paused';
          Store.save(); render();
          UI.toast('已暂停：计时冻结，可随时继续', 'ok');
        };
      }
      // 继续：重新开始一段 live 计时（sElapsed 保留）
      if (card.querySelector('[data-act="resume"]')) {
        card.querySelector('[data-act="resume"]').onclick = () => {
          ses.sStatus = 'live';
          ses.sStartDate = new Date().toISOString();
          Store.save(); ensureTicker(); render();
          UI.toast('继续训练：计时恢复', 'ok');
        };
      }
      // 开始/结束训练：sStatus 持久化（live/paused/done）；填写过程 onchange 已自动 Store.save
      card.querySelector('[data-act="toggle-live"]').onclick = () => {
        if (ses.sStatus === 'live' || ses.sStatus === 'paused') {
          // 结束训练：弹窗先展示本课负荷摘要（个人+团队合计），确认后保存并纳入统计
          const totalMs = sesElapsedMs(ses);
          const mins = Math.max(1, Math.round(totalMs / 60000));
          ses.duration = mins;   // 预览用：先把时长写入以便 loadEntries 计算（保存时再正式 syncEntries）
          showLoadSummaryModal(ses, mins, (save) => {
            if (save) {
              ses.duration = mins;
              ses.sEnd = new Date().toTimeString().slice(0, 5);
              ses.sStatus = 'done';
              ses.sElapsed = totalMs; ses.sStartDate = null;
              syncEntries(ses); Store.save(); mount();
              UI.toast(`已完课：${mins} 分钟，负荷已计算并纳入周期统计`, 'ok');
            } else {
              Store.data.loadEntries = (Store.data.loadEntries || []).filter((e) => e.sessionId !== ses.id);
              ses.sStatus = null; ses.sStartDate = null; ses.sElapsed = 0; ses.sStart = null; ses.sEnd = null; ses.duration = null;
              Store.save(); mount();
              UI.toast('已取消完课：数据保留，未纳入负荷统计', 'ok');
            }
          });
        } else {
          // 开始训练：自动计时开始（取消手动时间段填写）
          ses.sStatus = 'live';
          ses.sStartDate = new Date().toISOString();
          ses.sElapsed = ses.sElapsed || 0;
          ses.sStart = ses.time = new Date().toTimeString().slice(0, 5);
          state.folded[ses.id] = false;
          Store.save(); ensureTicker(); mount();
          UI.toast('训练开始：计时中，填写数据将自动保存', 'ok');
        }
      };
      const sumBtn = card.querySelector('[data-act="load-summary"]');
      if (sumBtn) sumBtn.onclick = () => showLoadSummaryModal(ses, Number(ses.duration) || 0, (save) => {
        if (save) { syncEntries(ses); Store.save(); mount(); UI.toast('负荷已更新并纳入统计', 'ok'); }
      });
    };
    render();
    return card;
  }

  // 日期条左右滑动切换：触控板横向双指滑动（wheel deltaX，纵向滚动透传不拦截）+ 触屏左右滑
  // 跨重渲染共享冷却时间，避免一次惯性滑动连跳多天
  let daySwipeLastAt = 0;
  function bindDaySwipe(strip) {
    if (!strip) return;
    // 触控板：横向滚动量累计到阈值才翻一天；纵向（|deltaY| 占优）完全放行
    let acc = 0;
    strip.addEventListener('wheel', (e) => {
      if (!e.deltaX || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      const now = Date.now();
      if (now - daySwipeLastAt < 350) { e.preventDefault(); return; }
      acc += e.deltaX;
      if (Math.abs(acc) >= 45) {
        e.preventDefault();
        const dir = acc > 0 ? 1 : -1;
        daySwipeLastAt = now; acc = 0;
        state.date = U.addDays(state.date, dir);
        mount();
      }
    }, { passive: false });
    // 触屏：水平方向起手后锁定并阻止日期条自身滚动，抬手越过阈值才翻页；轻点仍可点选日期
    let sx = 0, sy = 0, lock = null, dx = 0;
    strip.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; lock = null; dx = 0;
    }, { passive: true });
    strip.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (lock === null && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) lock = Math.abs(dx) > Math.abs(dy);
      if (lock) e.preventDefault();   // 锁定为横滑：抑制日期条原生横向滚动
    }, { passive: false });
    strip.addEventListener('touchend', () => {
      if (lock && Math.abs(dx) >= 50) {
        state.date = U.addDays(state.date, dx < 0 ? 1 : -1);
        mount();
      }
      lock = null;
    });
  }

  // 键盘 ← → 翻日（仅训练课页、焦点不在表单控件时）；模块级只绑定一次
  let dayKeyBound = false;
  function bindDayKeys() {
    if (dayKeyBound) return;
    dayKeyBound = true;
    document.addEventListener('keydown', (e) => {
      if (location.hash !== '#/session') return;
      const t = e.target;
      if (!t || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      state.date = U.addDays(state.date, e.key === 'ArrowRight' ? 1 : -1);
      mount();
    });
  }

  function renderDayBar(v) {
    const el = v.querySelector('#sesDays');
    const start = U.addDays(state.date, -3);
    const days = [];
    for (let i = 0; i < 10; i++) days.push(U.addDays(start, i));
    el.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:12px">
        <div class="row" style="gap:10px">
          <button class="btn sm ghost" id="dPrev">‹ 前一天</button>
          <input type="date" class="ipt" id="dPick" value="${state.date}" style="width:150px">
          <button class="btn sm ghost" id="dNext">后一天 ›</button>
          <b style="font-size:16px;letter-spacing:1px">${U.cn(state.date)} ${U.wd(state.date)}</b>
          ${Store.compOn(state.date) ? '<span class="chip red">比赛日</span>' : ''}
        </div>
        <button class="btn primary" id="sesAdd">＋ 添加本日课程</button>
      </div>
      <div class="daystrip days-swipe" title="在日期条上左右滑动切换日期（也可用键盘 ← →）">
        ${days.map((d) => {
          const list = Store.sessionsOn(d);
          const dose = Store.dailyDoseSeries(d, d)[0];
          const ton = dose.kg, m = dose.m, sec = dose.s;
          const sub = list.length ? `${list.length} 节` + (ton ? ` · ${U.fmt(ton / 1000, 1)}t` : m ? ` · ${U.fmt(m / 1000, 1)}km` : sec ? ` · ${U.fmt(Math.round(sec / 6) / 10, 1)}min` : '') : '无课程';
          // 条强度综合量纲：吨位 2t / 距离 6km / 做功 60min 等价满格，取最大
          const pct = Math.max(U.clamp(ton / 2000, 0, 100), U.clamp(m / 6000, 0, 100), U.clamp(sec / 3600, 0, 100));
          return `<div class="day-chip ${d === state.date ? 'active' : ''}" data-d="${d}">
            ${list.length ? '<span class="dot"></span>' : ''}
            <span class="d1">${U.md(d)}</span><span class="d2">${U.wd(d)}</span>
            <span class="d1">${sub}</span>
            <div class="bar"><i style="width:${pct}%"></i></div>
          </div>`;
        }).join('')}
      </div>`;
    el.querySelector('#dPrev').onclick = () => { state.date = U.addDays(state.date, -1); mount(); };
    el.querySelector('#dNext').onclick = () => { state.date = U.addDays(state.date, 1); mount(); };
    el.querySelector('#dPick').onchange = (e) => { if (e.target.value) { state.date = e.target.value; mount(); } };
    bindDaySwipe(el.querySelector('.daystrip'));
    $$('[data-d]', el).forEach((c) => { c.onclick = () => { state.date = c.dataset.d; mount(); }; });
    el.querySelector('#sesAdd').onclick = () => {
      const ns = {
        id: U.uid('ses'), date: state.date, name: '新训练课', type: '力量', time: null,
        duration: null, srpe: null, athSrpe: {}, athletes: [], rows: [], results: {}, note: '',
        mesoId: (() => { const m = Store.data.mesos.find((x) => state.date >= x.startDate && state.date <= x.endDate); return m ? m.id : null; })(),
        microId: (() => { const m = Store.data.micros.find((x) => state.date >= x.startDate && state.date <= x.endDate); return m ? m.id : null; })()
      };
      Store.data.sessions.push(ns);
      ensureMesoMapping(ns);   // 立即与中周期当日计划建立双向映射，保证两边动作表同步
      Store.save(); mount();
    };
  }

  function mount(v) {
    if (v == null) v = $('#view');
    bindDayKeys();
    UI.disposeCharts();
    v.innerHTML = `
      <div class="card" id="sesDays"></div>
      <div id="sesList"></div>`;
    renderDayBar(v);
    const list = v.querySelector('#sesList');
    const sessions = Store.sessionsOn(state.date).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (!sessions.length) {
      list.innerHTML = `<div class="empty" style="margin-top:14px"><h4>当日暂无课程</h4><p>点击「添加本日课程」排课，一天可安排多节不同类型的训练课</p></div>`;
    } else {
      // 同日多课时默认折叠非首课（训练中的课程始终展开）；用户手动折叠状态本页会话内保留
      sessions.forEach((s, i) => { if (state.folded[s.id] === undefined) state.folded[s.id] = sessions.length > 1 && i > 0 && s.sStatus !== 'live'; });
      sessions.forEach((s) => list.appendChild(sessionCard(v, s)));
    }
  }

  return { mount, state };
})();
