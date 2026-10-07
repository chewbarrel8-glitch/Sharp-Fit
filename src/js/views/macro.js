// 大周期页面
Views.macro = (() => {
  const state = { viewYM: null };
  // 重挂当前路由视图：总表页与大周期管理页共用本模块的弹窗/工具栏，保存后需重渲染当前所在页面
  const remount = () => {
    const id = location.hash.replace('#/', '') || 'macro';
    (Views[id] && Views[id].mount ? Views[id] : Views.macro).mount($('#view'));
  };

  // ---------- 周期模型库（仅供参考，不自动生成）----------
  // fit：适用对象 · load：负荷特征 · phases：典型阶段（手动划分时参考）
  const MODELS = [
    { id: 'matveyev', name: '马特维耶夫经典周期', desc: '准备期→比赛期→过渡期，负荷量与强度呈此消彼长的波浪式走势，适合年度单/双大周期安排。',
      fit: '训练基础较扎实、赛季目标明确（1-2 个主要比赛）的运动员；年度单周期或双周期安排；团队球类、田径、游泳等传统项目。',
      load: '准备期以高训练量、低强度为主（发展一般与专项能力）；随比赛临近量递减、强度递增；比赛期高强度低量；过渡期主动恢复，量与强度同步下调。',
      phases: [
      { name: '一般准备', w: 0.25, type: '积累' }, { name: '专项准备', w: 0.25, type: '积累' },
      { name: '比赛前期', w: 0.2, type: '最大力量' }, { name: '比赛期', w: 0.2, type: '峰值' }, { name: '过渡期', w: 0.1, type: '恢复' }] },
    { id: 'nsca-linear', name: 'NSCA 线性周期化', desc: '肌肥大→最大力量→爆发力→峰值的阶梯递进，强度逐步上升、量逐步下降。',
      fit: '初、中级运动员与年度大周期基础训练；动作模式已掌握、需要系统打底的人群；健身爱好者与校队运动员。',
      load: '每个阶段只突出一种主导能力，强度阶梯式上升（约 60%→85%+1RM）、次数阶梯式下降（10-12 次→2-4 次）；阶段间安排减量周消除疲劳。',
      phases: [
      { name: '肌肥大期', w: 0.25, type: '积累' }, { name: '最大力量期', w: 0.3, type: '最大力量' },
      { name: '爆发力期', w: 0.25, type: '转化功率' }, { name: '峰值竞赛期', w: 0.2, type: '峰值' }] },
    { id: 'undulating', name: '波动式周期化', desc: '在周内/周间高频波动负荷（重-轻-中），适合赛程密集、需要频繁保持竞技状态的项目。',
      fit: '赛季漫长、每周都有比赛的团队球类（篮球、足球）；需要同时保持多种能力、不能长时间只练单一素质的高水平运动员。',
      load: '同一周内交替安排大强度日（力量/功率）、中强度日（专项技术）与低强度日（恢复/有氧）；总量保持稳定，刺激高频轮换，避免单一能力长期丢失。',
      phases: [
      { name: '基础波动模块', w: 0.3, type: '积累' }, { name: '力量波动模块', w: 0.3, type: '最大力量' },
      { name: '功率波动模块', w: 0.25, type: '转化功率' }, { name: '竞赛微调窗口', w: 0.15, type: '峰值' }] },
    { id: 'block', name: '板块周期化（Issurin）', desc: '集中负荷块→转换块→实现块，每块只发展少数能力，残留效应叠加，适合高水平运动员。',
      fit: '训练年限长、基础能力齐备的高水平/精英运动员；备赛周期较短（8-12 周）、目标比赛集中；需要精准安排峰值出现时机的项目。',
      load: '每个板块 2-4 周高度集中发展 1-2 种能力（大训练量刺激），随后转换到互补能力，利用前一板块的残留效应叠加；最后以实现块（低量高强度）引出峰值。',
      phases: [
      { name: '集中负荷块', w: 0.4, type: '积累' }, { name: '转换块', w: 0.3, type: '转化功率' }, { name: '实现块', w: 0.3, type: '峰值' }] },
    { id: 'conjugate', name: '共轭法（Westside）', desc: '最大力量日与动态用力日交替，配合重复努力辅助训练，多能力并行发展。',
      fit: '力量举、投掷、摔跤等需要极限最大力量与爆发力并重的项目；有丰富训练经验、恢复能力强、能承受高频大负荷的运动员。',
      load: '每周固定安排最大努力日（极限重量低次数，发展绝对力量）与动态努力日（轻重量高速，发展发力率），辅以重复努力法堆容量（8-12 次×多组）；弱点专项辅助贯穿始终。',
      phases: [
      { name: '最大力量模块', w: 0.3, type: '最大力量' }, { name: '动态用力模块', w: 0.25, type: '转化功率' },
      { name: '重复努力模块', w: 0.25, type: '积累' }, { name: '减量竞赛模块', w: 0.2, type: '峰值' }] },
    { id: 'triphasic', name: '三相训练（Triphasic）', desc: '离心相→等长相→向心反应相，分阶段强调动作的不同肌肉工作形式。',
      fit: '需要提升动作控制与爆发力的短跑、跳跃、投掷类运动员；已掌握基础力量、希望优化发力质量的中高级训练者。',
      load: '先以慢速离心训练强化制动与结缔组织，再转入等长支撑发展刚性与稳定性，最后快速向心/超等长收缩引出反应力量；每相约 2 周，强度与速度递进。',
      phases: [
      { name: '离心相', w: 0.33, type: '积累' }, { name: '等长相', w: 0.33, type: '最大力量' }, { name: '向心反应相', w: 0.34, type: '转化功率' }] },
    { id: 'dual-peak', name: '双峰周期（赛程密集型）', desc: '围绕多场比赛设置多个准备-强化-比赛窗口，窗口间插入再生与维持训练。',
      fit: '一个赛季内有多场重要比赛（资格赛、分站赛、决赛）的运动员；球类联赛季后赛、田径钻石联赛等多峰赛程。',
      load: '每个比赛窗口重复「短准备→强化→减量比赛」小循环（4-8 周），窗口之间不安排大积累期，以维持训练+主动再生保持状态，防止过早出峰。',
      phases: [
      { name: '准备窗口', w: 0.3, type: '积累' }, { name: '强化窗口', w: 0.3, type: '最大力量' }, { name: '比赛+再生窗口', w: 0.4, type: '维持' }] }
  ];

  // 周期模型详细介绍弹窗：从工具栏「周期模型参考」下拉选择模型后打开
  function modelDetailDialog(m) {
    const weeks = Store.activeMacro() ? Math.ceil(U.daysBetween(Store.activeMacro().startDate, Store.activeMacro().endDate) / 7) : 52;
    UI.modal({
      title: '周期模型参考 · ' + m.name,
      wide: true,
      body: `
        <p class="hint" style="line-height:1.8;font-size:13px;color:var(--txt)">${U.esc(m.desc)}</p>
        <div style="margin-top:14px">
          <div class="gcat-t">适用对象</div>
          <p style="line-height:1.8;font-size:12.5px;margin:4px 0 0">${U.esc(m.fit)}</p>
        </div>
        <div style="margin-top:12px">
          <div class="gcat-t">负荷特征</div>
          <p style="line-height:1.8;font-size:12.5px;margin:4px 0 0">${U.esc(m.load)}</p>
        </div>
        <div style="margin-top:12px">
          <div class="gcat-t">典型阶段（手动划分中周期时参考 · 按当前计划 ${weeks} 周估算）</div>
          <table class="tbl" style="margin-top:6px"><thead><tr><th>阶段</th><th>类型</th><th>占比</th><th>参考周数</th></tr></thead><tbody>
            ${m.phases.map((p) => `<tr><td><b>${U.esc(p.name)}</b></td><td><span class="chip">${U.esc(p.type)}</span></td><td class="num">${Math.round(p.w * 100)}%</td><td class="num">${Math.max(1, Math.round(weeks * p.w))} 周</td></tr>`).join('')}
          </tbody></table>
        </div>
        <p class="hint" style="margin-top:12px;color:var(--volt)">💡 本系统不会自动生成任何计划，请结合项目特点到周期总表手动拖选划分中周期。</p>`,
      footer: '<button class="btn primary" data-x>我知道了</button>'
    });
  }

  // ---------- 工具栏 ----------
  function renderToolbar(v) {
    const d = Store.data;
    const mac = Store.activeMacro();
    // 顶栏：我的计划下拉（列出全部已保存训练计划，点击切换）+ 新建训练计划
    const macrosAll = d.macros.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    $('#topbarRight').innerHTML = `
      <div style="position:relative;display:inline-block" id="myPlansWrap">
        <button class="btn sm ghost" id="myPlansBtn">我的计划 ▾<span class="chip" style="padding:0 7px;font-size:10px;margin-left:5px">${macrosAll.length}</span></button>
        <div id="myPlansMenu" style="display:none;position:absolute;right:0;top:calc(100% + 6px);min-width:280px;max-height:60vh;overflow-y:auto;background:var(--panel);border:1px solid var(--line2);border-radius:10px;box-shadow:0 12px 32px color-mix(in oklch, var(--color-background) 45%, transparent);z-index:60;padding:6px">
          ${macrosAll.length ? macrosAll.map((m) => `
            <div class="myplan-item ${mac && m.id === mac.id ? 'active' : ''}" data-mpick="${m.id}" title="切换到该训练计划">
              <span class="mp-flag">${mac && m.id === mac.id ? '⚑' : '○'}</span>
              <span class="mp-body"><b>${U.esc(m.name)}</b><small>${U.md(m.startDate)} — ${U.md(m.endDate)} · ${U.esc(m.sport)}</small></span>
            </div>`).join('') : '<p class="hint" style="padding:10px">暂无已保存的训练计划</p>'}
        </div>
      </div>
      <button class="btn sm ghost" id="macNew">＋ 新建训练计划</button>`;
    $('#macNew').onclick = () => macroDialog();
    $('#myPlansBtn').onclick = (e) => {
      e.stopPropagation();
      const menu = $('#myPlansMenu');
      const wrap = $('#myPlansWrap');
      const open = menu.style.display === 'none';
      menu.style.display = open ? 'block' : 'none';
      // 下拉打开时抬高父级堆叠上下文，避免被工具栏下方的 KPI 卡片（view 入场动画创建的堆叠上下文）遮盖
      wrap.style.zIndex = open ? '70' : '';
      wrap.style.position = 'relative';
      if (open) {
        const closer = (ev) => {
          if (!menu.contains(ev.target)) { menu.style.display = 'none'; wrap.style.zIndex = ''; document.removeEventListener('click', closer); }
        };
        document.addEventListener('click', closer);
      }
    };
    $$('[data-mpick]').forEach((it) => {
      it.onclick = (ev) => {
        ev.stopPropagation();
        if (Store.data.settings.activeMacroId === it.dataset.mpick) { $('#myPlansMenu').style.display = 'none'; $('#myPlansWrap').style.zIndex = ''; return; }
        Store.data.settings.activeMacroId = it.dataset.mpick;
        Store.save();
        const menu = $('#myPlansMenu');
        if (menu) menu.style.display = 'none';
        $('#myPlansWrap').style.zIndex = '';
        remount();
        UI.toast('已切换训练计划', 'ok');
      };
    });

    // 主内容工具栏
    const el = v.querySelector('#macToolbar');
    if (!mac) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <div class="row" style="gap:14px;align-items:flex-end">
        <div style="flex:1;min-width:220px">
          <label style="display:block;font-size:11px;color:var(--dim);letter-spacing:1px;margin-bottom:4px">当前训练计划</label>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-size:17px;font-weight:800;color:var(--txt);line-height:1.3">${U.esc(mac.name)}</div>
          </div>
          <div class="hint" style="margin-top:2px">${U.esc(mac.sportCat)} · ${U.esc(mac.sport)} · ${U.md(mac.startDate)} — ${U.md(mac.endDate)} · ${Math.ceil(U.daysBetween(mac.startDate, mac.endDate) / 7)} 周</div>
        </div>
        <div class="field" style="margin-bottom:0;position:relative">
          <label>&nbsp;</label>
          <div class="row" style="gap:6px">
            <button class="btn ghost" id="modelRefBtn" style="position:relative">📖 周期模型参考 ▾</button>
            <button class="btn danger" id="macDelBtn">删除训练计划</button>
          </div>
          <div id="modelRefMenu" style="display:none;position:absolute;right:0;top:calc(100% + 4px);min-width:260px;max-height:56vh;overflow-y:auto;background:var(--panel);border:1px solid var(--line2);border-radius:10px;box-shadow:0 12px 32px color-mix(in oklch, var(--color-background) 45%, transparent);z-index:60;padding:6px">
            ${MODELS.map((m) => `<div class="myplan-item" data-modelref="${m.id}"><span class="mp-body"><b>${U.esc(m.name)}</b><small>${U.esc(m.desc)}</small></span></div>`).join('')}
          </div>
        </div>
      </div>`;

    // 周期模型参考按钮：下拉选择模型 → 详细介绍弹窗
    const refBtn = $('#modelRefBtn'), refMenu = $('#modelRefMenu');
    refBtn.onclick = (e) => {
      e.stopPropagation();
      const open = refMenu.style.display === 'none';
      refMenu.style.display = open ? 'block' : 'none';
      // 下拉打开时抬高父级堆叠上下文，避免被工具栏下方的 KPI 卡片遮盖（同「我的计划」下拉）
      refMenu.parentElement.style.zIndex = open ? '70' : '';
      refMenu.parentElement.style.position = 'relative';
      if (open) {
        const closer = (ev) => { if (!refMenu.contains(ev.target)) { refMenu.style.display = 'none'; refMenu.parentElement.style.zIndex = ''; document.removeEventListener('click', closer); } };
        document.addEventListener('click', closer);
      }
    };
    $$('[data-modelref]', refMenu).forEach((it) => {
      it.onclick = (ev) => {
        ev.stopPropagation();
        refMenu.style.display = 'none';
        refMenu.parentElement.style.zIndex = '';
        modelDetailDialog(MODELS.find((m) => m.id === it.dataset.modelref));
      };
    });
    // 删除当前训练计划（连同该计划添加的运动员及其数据一并删除）
    $('#macDelBtn').onclick = () => {
      const m = Store.activeMacro();
      if (!m) return;
      const athN = Store.data.athletes.filter((a) => a.macroId === m.id).length;
      UI.confirm(`删除训练计划「${U.esc(m.name)}」？其下所有中周期、小周期、日计划、映射训练课，以及该计划的 ${athN} 名运动员（含 1RM、体能测试与负荷记录）将一并删除，且不可恢复。`, () => {
        const d = Store.data;
        const mesoIds = Store.mesosOf(m.id).map((x) => x.id);
        d.micros = d.micros.filter((mc) => !mesoIds.includes(mc.mesoId));
        d.mesos = d.mesos.filter((ms) => ms.macroId !== m.id);
        // 该计划专属运动员及其数据一并删除
        const athIds = d.athletes.filter((a) => a.macroId === m.id).map((a) => a.id);
        const athIdSet = new Set(athIds);
        if (athIds.length) {
          d.loadEntries = d.loadEntries.filter((l) => !athIdSet.has(l.athleteId));
          d.sessions = (d.sessions || []).map((s) => {
            const next = Object.assign({}, s, {
              athletes: (s.athletes || []).filter((id) => !athIdSet.has(id))
            });
            if (next.results && typeof next.results === 'object') {
              for (const id of athIdSet) delete next.results[id];
            }
            if (next.athSrpe && typeof next.athSrpe === 'object') {
              for (const id of athIdSet) delete next.athSrpe[id];
            }
            return next;
          });
          d.tests = (d.tests || []).filter((t) => !athIdSet.has(t.athleteId));
          if (d.profiles) d.profiles = d.profiles.filter((p) => !athIdSet.has(p.athleteId));
          if (d.athleteRm) athIds.forEach((id) => delete d.athleteRm[id]);
          d.athletes = d.athletes.filter((a) => a.macroId !== m.id);
        }
        d.macros = d.macros.filter((x) => x.id !== m.id);
        d.settings.activeMacroId = d.macros[0] ? d.macros[0].id : null;
        Store.save();
        remount();
        UI.toast('训练计划已删除', 'ok');
      });
    };
  }

  // ---------- 大周期新建/编辑 ----------
  // preset：拖选空白周创建新大周期时预填起止日期
  function macroDialog(mac, preset) {
    const cats = Sports.categories.map((c) => `<option>${U.esc(c.name)}</option>`).join('');
    const m = mac || {};
    const pStart = (preset && preset.startDate) || m.startDate || U.weekStart(U.today());
    const pEnd = (preset && preset.endDate) || m.endDate || U.addDays(U.weekStart(U.today()), 20 * 7 - 1);
    UI.modal({
      title: mac ? '编辑训练计划' : '新建训练计划',
      body: `
        <div class="form-grid">
          <div class="field full"><label>计划名称</label><input class="ipt" id="fName" value="${U.esc(m.name || '')}"></div>
          <div class="field"><label>项目分类</label><select class="sel" id="fCat">${cats}</select></div>
          <div class="field"><label>具体项目</label><select class="sel" id="fSport"></select></div>
          <div class="field"><label>开始日期</label><input type="date" class="ipt" id="fStart" value="${pStart}"></div>
          <div class="field"><label>结束日期</label><input type="date" class="ipt" id="fEnd" value="${pEnd}"></div>
          <div class="field full"><label>周期模型参考（供规划时参考，不自动生成）</label>
            <div class="hint" style="max-height:140px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;padding:8px 10px;line-height:1.7">
              ${MODELS.map((x) => `<div style="margin-bottom:4px"><b>${U.esc(x.name)}</b> — ${U.esc(x.desc)}</div>`).join('')}
              <div style="color:var(--volt);margin-top:4px">💡 所有中周期需手动创建：到周期总表拖选空白周，或在中周期页面点击「＋」手动划分。</div>
            </div>
          </div>
        </div>`,
      onMount(ov, close) {
        const catSel = ov.querySelector('#fCat'), spSel = ov.querySelector('#fSport');
        const fillSports = () => {
          const c = Sports.categories.find((x) => x.name === catSel.value);
          spSel.innerHTML = c.sports.map((s) => `<option>${U.esc(s)}</option>`).join('');
        };
        fillSports();
        if (m.sportCat) { catSel.value = m.sportCat; fillSports(); if (m.sport) spSel.value = m.sport; }
        catSel.onchange = fillSports;
        const delBtn = ov.querySelector('[data-del]');
        if (delBtn) delBtn.onclick = () => UI.confirm(`删除训练计划「${U.esc(mac.name)}」？其下中周期与该计划的运动员（含 1RM、体能测试与负荷记录）将一并删除。`, () => {
          const d = Store.data;
          const ids = Store.mesosOf(mac.id).map((m) => m.id);
          d.mesos = d.mesos.filter((m) => !ids.includes(m.id));
          d.micros = d.micros.filter((m) => ids.includes(m.mesoId) ? false : true);
          const athIds = d.athletes.filter((a) => a.macroId === mac.id).map((a) => a.id);
          if (athIds.length) {
            d.loadEntries = d.loadEntries.filter((l) => !athIds.includes(l.athleteId));
            d.sessions.forEach((s) => { s.athletes = (s.athletes || []).filter((id) => !athIds.includes(id)); });
            d.tests = (d.tests || []).filter((t) => !athIds.includes(t.athleteId));
            if (d.profiles) d.profiles = d.profiles.filter((p) => !athIds.includes(p.athleteId));
            if (d.athleteRm) athIds.forEach((id) => delete d.athleteRm[id]);
            d.athletes = d.athletes.filter((a) => a.macroId !== mac.id);
          }
          d.macros = d.macros.filter((m) => m.id !== mac.id);
          d.settings.activeMacroId = d.macros[0] ? d.macros[0].id : null;
          Store.save(); close(); remount();
        });
        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#fName').value.trim();
          if (!name) { UI.toast('请填写计划名称', 'err'); return; }
          const start = ov.querySelector('#fStart').value, end = ov.querySelector('#fEnd').value;
          if (!start || !end) { UI.toast('请填写起止日期', 'err'); return; }
          if (end < start) { UI.toast('结束日期不能早于开始日期', 'err'); return; }
          const obj = mac || { id: U.uid('mac'), compDates: [] };
          Object.assign(obj, {
            name, sportCat: catSel.value, sport: spSel.value,
            model: mac ? (m.model || 'block') : 'block',
            startDate: start, endDate: end
          });
          if (!mac) Store.data.macros.push(obj);
          Store.data.settings.activeMacroId = obj.id;
          Store.save(); close(); remount();
          UI.toast(mac ? '训练计划已更新' : '训练计划已创建', 'ok');
        };
      },
      footer: `${mac ? `<button class="btn danger" data-del>删除</button>` : ''}<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`
    });
  }

  // ---------- 大周期（训练计划内的用户自定义子区间）新建/编辑弹窗 ----------
  function cycleDialog(mac, cyc, preset) {
    const c = cyc || {};
    const pStart = (preset && preset.startDate) || c.startDate || mac.startDate;
    const pEnd = (preset && preset.endDate) || c.endDate || mac.endDate;
    UI.modal({
      title: cyc ? '编辑大周期' : '新建大周期',
      body: `
        <div class="form-grid">
          <div class="field full"><label>大周期名称</label><input class="ipt" id="cName" value="${U.esc(c.name || '')}"></div>
          <div class="field"><label>开始日期</label><input type="date" class="ipt" id="cStart" value="${pStart}"></div>
          <div class="field"><label>结束日期</label><input type="date" class="ipt" id="cEnd" value="${pEnd}"></div>
        </div>`,
      onMount(ov, close) {
        const del = ov.querySelector('[data-del]');
        if (del) del.onclick = () => UI.confirm(`删除大周期「${U.esc(cyc.name)}」？`, () => {
          mac.cycles = (mac.cycles || []).filter((c2) => c2.id !== cyc.id);
          Store.save(); close(); remount(); UI.toast('已删除大周期', 'ok');
        });
        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#cName').value.trim();
          if (!name) { UI.toast('请填写名称', 'err'); return; }
          const start = ov.querySelector('#cStart').value, end = ov.querySelector('#cEnd').value;
          if (!start || !end || end < start) { UI.toast('请检查起止日期', 'err'); return; }
          if (start < U.weekStart(mac.startDate) || end > U.addDays(U.weekStart(mac.endDate), 6)) { UI.toast('大周期日期需在训练计划范围内', 'err'); return; }
          const list = mac.cycles = mac.cycles || [];
          if (cyc) Object.assign(cyc, { name, startDate: start, endDate: end });
          else list.push({ id: U.uid('cy'), name, startDate: start, endDate: end });
          Store.save(); close(); remount(); UI.toast(cyc ? '大周期已更新' : '大周期已创建', 'ok');
        };
      },
      footer: `${cyc ? '<button class="btn danger" data-del>删除</button>' : ''}<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`
    });
  }

  // ---------- KPI ----------
  function renderKPI(v) {
    const mac = Store.activeMacro();
    const box = v.querySelector('#macKpis');
    if (!mac) { box.innerHTML = ''; return; }
    const mesos = Store.mesosOf(mac.id);
    let totalKg = 0;
    for (let dt = mac.startDate; dt <= mac.endDate; dt = U.addDays(dt, 1)) totalKg += Store.sessionTonnage(dt);
    const inRange = (d) => d >= mac.startDate && d <= mac.endDate;
    const compCount = (mac.compDates || []).filter((c) => inRange(c.date)).length;
    box.innerHTML = `
      <div class="kpis">
        <div class="kpi info"><div class="k">周期总长</div><div class="v">${Math.ceil(U.daysBetween(mac.startDate, mac.endDate) / 7)}<small>周</small></div><div class="d">${U.md(mac.startDate)} — ${U.md(mac.endDate)}</div></div>
        <div class="kpi"><div class="k">中周期</div><div class="v">${mesos.length}<small>个</small></div><div class="d">${U.esc(mac.sportCat)} · ${U.esc(mac.sport)}</div></div>
        <div class="kpi bad"><div class="k">比赛日</div><div class="v">${compCount}<small>场</small></div><div class="d">月历中已红色高亮</div></div>
        <div class="kpi info"><div class="k">备赛运动员</div><div class="v">${(mac.athletes || []).length}<small>人</small></div><div class="d"><button class="btn sm" id="macAth" style="padding:2px 10px">${(mac.athletes || []).length ? '调整名单' : '添加运动员'}</button> · 仅限${U.esc(mac.sport || '本项目')}</div></div>
        <div class="kpi ok"><div class="k">累计总吨位</div><div class="v">${U.fmt(totalKg / 1000, 1)}<small>t</small></div><div class="d">已完成训练课累计负荷</div></div>
      </div>`;
    const macAth = box.querySelector('#macAth');
    if (macAth) macAth.onclick = () => UI.athletePicker(mac.athletes || [], (ids) => {
      mac.athletes = ids; Store.save(); renderKpis(v); UI.toast('备赛名单已更新', 'ok');
    }, mac.sport);
  }

  // ---------- 周期总表（模板式网格：列=周，行=周一~周日） ----------
  // 准备水平等级 1-10：由峰值状态曲线（能量储备−疲劳）自动换算，非手动输入
  // 1=恢复中(疲劳主导) → 10=峰值(能量储备远超疲劳)；数值由归一化峰值状态(0-100)÷10 取整得出
  const STATUS_LEVELS = [
    { level: 1,  name: '恢复中',   color: 'color-mix(in oklch, var(--color-info) 20%, transparent)',  text: 'var(--blue)' },
    { level: 2,  name: '疲劳',     color: 'color-mix(in oklch, var(--color-info) 16%, transparent)',  text: 'var(--blue)' },
    { level: 3,  name: '低',       color: 'color-mix(in oklch, var(--color-success) 14%, transparent)',  text: 'var(--green)' },
    { level: 4,  name: '基础',     color: 'color-mix(in oklch, var(--color-success) 18%, transparent)',  text: 'var(--green)' },
    { level: 5,  name: '正常',     color: 'color-mix(in oklch, var(--color-accent) 16%, transparent)',  text: 'var(--volt)' },
    { level: 6,  name: '中上',     color: 'color-mix(in oklch, var(--color-accent) 20%, transparent)',  text: 'var(--volt)' },
    { level: 7,  name: '良好',     color: 'color-mix(in oklch, var(--color-warning) 16%, transparent)',  text: 'var(--amber)' },
    { level: 8,  name: '优秀',     color: 'color-mix(in oklch, var(--color-warning) 20%, transparent)',  text: 'var(--amber)' },
    { level: 9,  name: '接近峰值', color: 'color-mix(in oklch, var(--color-danger) 16%, transparent)',  text: 'var(--red)' },
    { level: 10, name: '峰值',     color: 'color-mix(in oklch, var(--color-danger) 22%, transparent)',  text: 'var(--red)' }
  ];
  const STATUS_MAP = { 'deload': 1, 'base': 4, 'load': 6, 'loadp': 8 };
  const stLevel = (val) => {
    if (val == null || val === '') return null;
    if (typeof val === 'number') return val;
    return STATUS_MAP[val] || Number(val) || null;
  };
  // 与 Excel WEEKNUM(默认类型) 一致：1月1日所在为第1周，每周从周日开始
  function weekNumExcel(str) {
    const d = U.d(str);
    return Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 86400000 / 7) + 1;
  }

  // ---------- 手动定义中周期：自选连续几周组成一个中周期，保存后自动映射到「中周期」模块 ----------
  function mesoDialog(mac, m, defIdx, weekMons, defRange) {
    const nWeeks = weekMons.length;
    const others = Store.mesosOf(mac.id).filter((x) => !m || x.id !== m.id);
    const busy = (i) => others.some((x) => {
      const s = U.weekStart(x.startDate), e = U.weekStart(x.endDate);
      const ws = weekMons[i], we = U.addDays(ws, 6);
      return U.between(ws, s, e) || U.between(we, s, e) || U.between(s, ws, we);
    });
    const weekOpts = (sel) => Array.from({ length: nWeeks }, (_, i) =>
      `<option value="${i}" ${i === sel ? 'selected' : ''} ${busy(i) && i !== sel ? 'disabled' : ''}>第 ${i + 1} 周（${U.md(weekMons[i])} 起）${busy(i) && i !== sel ? ' · 已占用' : ''}</option>`).join('');
    const idxOf = (ds) => weekMons.findIndex((ws) => U.between(U.weekStart(ds), ws, U.addDays(ws, 6)));
    const s0 = m ? Math.max(0, idxOf(m.startDate)) : (defRange ? defRange.s : (defIdx ?? 0));
    const e0 = m ? Math.max(s0, idxOf(m.endDate)) : (defRange ? defRange.e : Math.min(nWeeks - 1, (defIdx ?? 0) + 2));
    UI.modal({
      title: m ? '编辑中周期' : '定义中周期',
      body: `
        <div class="form-grid">
          <div class="field full"><label>名称</label><input class="ipt" id="mName" value="${U.esc(m ? m.name : '')}"></div>
          <div class="field"><label>类型</label><input class="ipt" id="mType" value="${U.esc(m ? m.type : '积累')}"></div>
          <div class="field"><label>所属训练计划</label><input class="ipt" value="${U.esc(mac.name)}" disabled></div>
          <div class="field"><label>起始周</label><select class="sel" id="mS">${weekOpts(s0)}</select></div>
          <div class="field"><label>结束周</label><select class="sel" id="mE">${weekOpts(e0)}</select></div>
          <div class="field full"><span class="hint">选择连续的几周组成一个中周期，保存后自动同步到「中周期」模块；已占用的周不可重复划分</span></div>
        </div>`,
      footer: `${m ? '<button class="btn danger" data-del>删除</button>' : ''}<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#mName').value.trim();
          if (!name) { UI.toast('请填写名称', 'err'); return; }
          const si = +ov.querySelector('#mS').value, ei = +ov.querySelector('#mE').value;
          if (ei < si) { UI.toast('结束周不能早于起始周', 'err'); return; }
          const startDate = weekMons[si], endDate = U.addDays(weekMons[ei], 6);
          const type = ov.querySelector('#mType').value.trim() || '积累';
          if (m) Object.assign(m, { name, type, startDate, endDate });
          else Store.data.mesos.push({ id: U.uid('mes'), macroId: mac.id, name, type, startDate, endDate, days: [] });
          Store.save(); close(); remount(); UI.toast(m ? '中周期已更新' : '中周期已定义，可在「中周期」模块查看', 'ok');
        };
        const del = ov.querySelector('[data-del]');
        if (del) del.onclick = () => UI.confirm(`删除中周期「${U.esc(m.name)}」？其中的日计划将一并删除。`, () => {
          Store.data.mesos = Store.data.mesos.filter((x) => x.id !== m.id);
          Store.save(); close(); remount(); UI.toast('已删除中周期', 'ok');
        });
      }
    });
  }

  // 图表防抖重绘（总表输入联动）
  let _chartTimer = null;
  function debounceCharts(v) {
    clearTimeout(_chartTimer);
    _chartTimer = setTimeout(() => { const box = v.querySelector('#chartBox'); if (box && box.innerHTML) renderCharts(v); }, 250);
  }

  // 标记比赛日 / 测试日弹窗（周期总表日期格与月历共用）
  function markDialog(mac, ds) {
    UI.modal({
      title: `标记日期 · ${U.cn(ds)}`,
      body: `
        <div class="form-grid">
          <div class="field full"><label>类型</label><select class="sel" id="mkType">
            <option value="comp">比赛日</option><option value="test">测试日</option>
          </select></div>
          <div class="field full"><label id="mkNameLb">比赛名称</label><input class="ipt" id="mkName"></div>
          <div class="field full" id="mkPlaceF"><label>比赛地点</label><input class="ipt" id="mkPlace"></div>
        </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>标记</button>`,
      onMount(ov, close) {
        const typeSel = ov.querySelector('#mkType');
        const syncLabels = () => {
          const isTest = typeSel.value === 'test';
          ov.querySelector('#mkNameLb').textContent = isTest ? '测试名称' : '比赛名称';
          ov.querySelector('#mkPlaceF').style.display = isTest ? 'none' : '';
        };
        typeSel.onchange = syncLabels;
        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#mkName').value.trim();
          if (!name) { UI.toast('请填写名称', 'err'); return; }
          if (typeSel.value === 'test') {
            (mac.testDates = mac.testDates || []).push({ date: ds, name });
            mac.testDates.sort((a, b) => a.date.localeCompare(b.date));
            UI.toast('已标记测试日', 'ok');
          } else {
            const place = ov.querySelector('#mkPlace').value.trim();
            (mac.compDates = mac.compDates || []).push({ date: ds, name, place });
            mac.compDates.sort((a, b) => a.date.localeCompare(b.date));
            UI.toast('已标记比赛日', 'ok');
          }
          Store.save(); close(); remount();
        };
      }
    });
  }

  // 日期标记的统一入口：已有比赛日/测试日 → 确认移除；否则打开标记弹窗
  function markEntry(mac, ds) {
    const comp = (mac.compDates || []).find((c) => c.date === ds);
    const test = (mac.testDates || []).find((t) => t.date === ds);
    if (comp) {
      UI.confirm(`移除比赛日「${U.esc(comp.name)}」（${U.md(ds)}）？`, () => {
        mac.compDates = mac.compDates.filter((c) => c.date !== ds);
        Store.save(); remount(); UI.toast('已移除比赛日', 'ok');
      });
    } else if (test) {
      UI.confirm(`移除测试日「${U.esc(test.name)}」（${U.md(ds)}）？`, () => {
        mac.testDates = mac.testDates.filter((t) => t.date !== ds);
        Store.save(); remount(); UI.toast('已移除测试日', 'ok');
      });
    } else {
      markDialog(mac, ds);
    }
  }

  function renderGrid(v) {
    const mac = Store.activeMacro();
    const el = v.querySelector('#gridBox');
    if (!mac) { el.innerHTML = ''; return; }
    mac.weekPlan = mac.weekPlan || {};
    // 网格只覆盖训练计划起止日期所在的周（起始周周一 → 结束周周日），以外的时间不显示
    const gs = U.weekStart(mac.startDate);
    const ge = U.weekStart(mac.endDate);
    let nWeeks = Math.round((U.d(ge) - U.d(gs)) / 86400000 / 7) + 1;
    if (nWeeks < 1) nWeeks = 1;   // 起止日期异常时至少显示 1 周，避免表格塌陷
    const weekMons = Array.from({ length: nWeeks }, (_, i) => U.addDays(gs, i * 7));
    const todayS = U.today();
    const compMap = {};
    for (const c of mac.compDates || []) compMap[c.date] = c;
    const testMap = {};
    for (const t of mac.testDates || []) testMap[t.date] = t;

    // 列结构：C0 单个标签列（各行列头/分类标签，吸附最左）+ N 个周列。
    // 训练目标区：一个分类独占一行（不再两列配对）；周格与上方各行严格同列对齐。

    // 月份合并带
    let monBands = '', m0 = 0;
    for (let i = 1; i <= nWeeks; i++) {
      const mi = U.d(weekMons[i - 1]).getMonth();
      const mj = i < nWeeks ? U.d(weekMons[i]).getMonth() : -1;
      if (mi !== mj) {
        monBands += `<td class="pg-mon" colspan="${i - m0}">${U.d(weekMons[m0]).getFullYear()}年${mi + 1}月</td>`;
        m0 = i;
      }
    }

    // 周一~周日 7 行日期（点击日期格标记/取消比赛日或测试日，支持多日）
    const wdNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    let dayRows = '';
    for (let r = 0; r < 7; r++) {
      let tds = '';
      for (const ws of weekMons) {
        const ds = U.addDays(ws, r);
        const out = ds < mac.startDate || ds > mac.endDate;
        const comp = compMap[ds];
        const test = testMap[ds];
        const tip = comp ? `${U.esc(comp.name)}${comp.place ? '（' + U.esc(comp.place) + '）' : ''}（点击取消）`
          : test ? `${U.esc(test.name)}（测试日 · 点击取消）` : '（点击标记比赛日 / 测试日）';
        tds += `<td class="pg-day ${out ? 'out' : ''} ${comp ? 'comp' : ''} ${test ? 'testday' : ''} ${ds === todayS ? 'tod' : ''}" ${out ? '' : `data-cd="${ds}"`} title="${U.cn(ds)} · ${tip}">
          <span class="n">${U.d(ds).getDate()}</span>${comp ? `<span class="cn">${U.esc(comp.name)}</span>` : test ? `<span class="cn tst">${U.esc(test.name)}</span>` : `<span class="mk">＋标记</span>`}</td>`;
      }
      dayRows += `<tr><td class="pg-lb">${wdNames[r]}</td>${tds}</tr>`;
    }

    const wkRow = `<tr><td class="pg-lb">周数</td>${weekMons.map((ws) => `<td class="pg-wk">${weekNumExcel(ws)}</td>`).join('')}</tr>`;
    const mcRow = `<tr><td class="pg-lb">周序号</td>${weekMons.map((_, i) => `<td class="pg-wk">${i + 1}</td>`).join('')}</tr>`;

    // 中周期合并带（按周覆盖；点击带跳转中周期页规划，带左侧「✎」按钮编辑/删除，空白周点击＋自定义划分）
    const mesos = Store.mesosOf(mac.id);
    let mesoTds = '';
    for (let i = 0; i < nWeeks; i++) {
      const wEnd = U.addDays(weekMons[i], 6);
      const hit = mesos.find((m) => U.between(weekMons[i], m.startDate, m.endDate) || U.between(wEnd, m.startDate, m.endDate));
      if (hit) {
        let span = 1;
        while (i + span < nWeeks) {
          const nEnd = U.addDays(weekMons[i + span], 6);
          const nh = mesos.find((m) => m.id === hit.id && (U.between(weekMons[i + span], m.startDate, m.endDate) || U.between(nEnd, m.startDate, m.endDate)));
          if (!nh) break;
          span++;
        }
        mesoTds += `<td class="pg-meso" colspan="${span}" data-medit="${hit.id}" title="${U.esc(hit.name)}（${U.md(hit.startDate)}—${U.md(hit.endDate)}）· 点击进入中周期规划"><span class="pg-edit-btn" data-med="${hit.id}" title="编辑/删除中周期">✎</span>${U.esc(hit.name)} ›</td>`;
        i += span - 1;
      } else mesoTds += `<td class="pg-wk pg-msdrag" data-msi="${i}" title="点击或按住拖动选择连续几周，定义中周期">＋</td>`;
    }
    const mesoRow = `<tr><td class="pg-lb">中周期</td>${mesoTds}</tr>`;

    // 大周期行（中周期栏上方）：渲染当前训练计划的用户自定义大周期（mac.cycles），
    // 空白周可点击或按住鼠标拖动选择连续 N 周定义新大周期
    const cycles = (mac.cycles || []).slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
    const cycleHitAt = (i) => {
      const wEnd = U.addDays(weekMons[i], 6);
      return cycles.find((c) => U.between(weekMons[i], c.startDate, c.endDate) || U.between(wEnd, c.startDate, c.endDate));
    };
    let macroTds = '';
    for (let i = 0; i < nWeeks; i++) {
      const hit = cycleHitAt(i);
      if (hit) {
        let span = 1;
        while (i + span < nWeeks) {
          const nh = cycleHitAt(i + span);
          if (!nh || nh.id !== hit.id) break;
          span++;
        }
        macroTds += `<td class="pg-macro active" colspan="${span}" data-cyedit="${hit.id}" title="${U.esc(hit.name)}（${U.md(hit.startDate)}—${U.md(hit.endDate)}）· 点击编辑/删除大周期">⚑ <span class="pg-edit-btn" data-cyde="${hit.id}" title="编辑/删除大周期">✎</span>${U.esc(hit.name)}</td>`;
        i += span - 1;
      } else macroTds += `<td class="pg-wk pg-mdrag" data-mi="${i}" title="点击或按住拖动选择连续几周，定义新大周期">＋</td>`;
    }
    const macroRow = `<tr><td class="pg-lb">大周期</td>${macroTds}</tr>`;

    // 测试日行（中周期栏下方，当周内的测试名称）
    const testRow = `<tr><td class="pg-lb">测试</td>${weekMons.map((ws) => {
      const names = (mac.testDates || []).filter((t) => U.between(t.date, ws, U.addDays(ws, 6))).map((t) => U.esc(t.name));
      return `<td class="pg-test" title="${names.join('、')}">${names.join('、')}</td>`;
    }).join('')}</tr>`;

    // 比赛日行（当周内的比赛名称）+ 比赛地点行
    const compRow = `<tr><td class="pg-lb">比赛日</td>${weekMons.map((ws) => {
      const names = (mac.compDates || []).filter((c) => U.between(c.date, ws, U.addDays(ws, 6))).map((c) => U.esc(c.name));
      return `<td class="pg-comp" title="${names.join('、')}">${names.join('、')}</td>`;
    }).join('')}</tr>`;
    const placeRow = `<tr><td class="pg-lb">比赛地点</td>${weekMons.map((ws) => {
      const places = (mac.compDates || []).filter((c) => U.between(c.date, ws, U.addDays(ws, 6))).map((c) => U.esc(c.place || '—'));
      return `<td class="pg-place" title="${places.join('、')}">${places.join('、')}</td>`;
    }).join('')}</tr>`;

    // 训练目标行（比赛地点行下方）：按九大目标分类纵向 9 行布局
    // 左列分类名（带分类色条），右列按周分格显示该周在该分类下的目标 chips（主要实色 / 次要虚线）
    // 每个分类行独立查找该分类的目标块（blockHitAt 按 cat 过滤）；空白周可点击或按住拖动选择连续 N 周设定该分类目标
    const blocks = goalBlocksOf(mac).slice().sort((a, b) => a.start.localeCompare(b.start));
    const blockHitAt = (i, cat) => {
      const wEnd = U.addDays(weekMons[i], 6);
      return blocks.find((b) => {
        if (b.start > wEnd || b.end < weekMons[i]) return false;
        const gs2 = Store.goalsOf(b);
        return gs2.primary.some((g) => g.cat === cat) || gs2.secondary.some((g) => g.cat === cat);
      });
    };
    // 九大分类（保序去重）+ 分类色相（取该类首个目标的 hue）—— 用户自定义分类也显示一行
    const allCats = Store.allGoalCats();
    // 分类顺序与隐藏状态持久化在 macro 上（每个训练计划独立）
    mac.goalCatOrder = Array.isArray(mac.goalCatOrder) ? mac.goalCatOrder : [];
    mac.goalHiddenCats = Array.isArray(mac.goalHiddenCats) ? mac.goalHiddenCats : [];
    const orderedCats = (() => {
      const allNames = allCats.map((c) => c.name);
      const order = mac.goalCatOrder.filter((n) => allNames.includes(n));
      const rest = allNames.filter((n) => !order.includes(n));
      return order.concat(rest);
    })();
    const catHue = {};
    allCats.forEach((c) => { catHue[c.name] = c.hue; });
    // 隐藏的分类整行移除（不渲染占位行），在总表顶部工具条以 chip 形式点击恢复
    const visibleCats = orderedCats.filter((c) => !mac.goalHiddenCats.includes(c));
    // 分类标签（左列=A / 右列=B，右列吸附表格右侧）：拖拽手柄 + 隐藏箭头 + 分类名 + 删除
    const catLabelHtml = (cat) => {
      const hue = catHue[cat] != null ? catHue[cat] : 210;
      const isCustomCat = (Store.data.goalCats || []).some((c) => c.name === cat);
      return `style="--gh:${hue}" data-catrow="${U.esc(cat)}" draggable="true" data-cat="${U.esc(cat)}" title="拖拽可调整分类顺序"><div class="pg-cat-in"><span class="pg-cat-drag" title="拖动排序">⋮⋮</span>
        <span class="pg-cat-dot" style="background:hsl(${hue} 70% 55%)"></span>
        <span class="pg-cat-name">${U.esc(cat)}</span>
        <span class="pg-cat-toggle" data-togcat="${U.esc(cat)}" title="隐藏该分类（在总表顶部恢复）">▾</span>
        ${isCustomCat ? `<span class="pg-cat-del" data-delcat="${U.esc(cat)}" title="删除该自定义分类（分类下的目标及其在周期中的安排将一并删除）">✕</span>` : ''}</div>`;
    };
    // 预计算每个分类在各周的命中块
    const catHits = {};
    visibleCats.forEach((cat) => { catHits[cat] = weekMons.map((_, i) => blockHitAt(i, cat)); });
    // 同一块连续多周 = 一条合并带：记录每个命中周所属连续段 {s,e}，标签只在段的中间周渲染一次
    const catRuns = {};
    visibleCats.forEach((cat) => {
      const arr = catHits[cat], map = {};
      for (let k = 0; k < arr.length; k++) {
        if (!arr[k] || (k > 0 && arr[k - 1] === arr[k])) continue;
        let e2 = k;
        while (e2 + 1 < arr.length && arr[e2 + 1] === arr[k]) e2++;
        for (let j = k; j <= e2; j++) map[j] = { s: k, e: e2 };
      }
      catRuns[cat] = map;
    });
    // 一个分类独占一行；同一目标块连续周渲染为单个 colspan 合并单元格——
    // 一条色带就是一个真实格子，内部不再出现每周纵线（负边距拼接方案会被相邻格背景盖住）。
    const goalCells = (cat) => {
      let out = '';
      for (let i = 0; i < weekMons.length; i++) {
        const hue = catHue[cat] != null ? catHue[cat] : 210;
        const hit = catHits[cat][i];
        if (!hit) {
          out += `<td class="pg-gdrag" style="--gh:${hue}" data-gi="${i}" data-cat="${U.esc(cat)}" title="点击或按住拖动选择连续几周，设定${U.esc(cat)}目标">＋</td>`;
          continue;
        }
        const run = catRuns[cat][i];
        if (i > run.s) continue; // 该周已被合并带覆盖
        const gs2 = Store.goalsOf(hit);
        const chips = `${U.goalChips(gs2.primary.filter((g) => g.cat === cat), 'primary')}${U.goalChips(gs2.secondary.filter((g) => g.cat === cat), 'secondary')}`;
        out += `<td class="pg-goalband" colspan="${run.e - run.s + 1}" style="--gh:${hue}" data-gbedit="${hit.id}" data-cat="${U.esc(cat)}" title="${U.md(hit.start)}—${U.md(hit.end)} · ${U.esc(cat)} · 点击编辑"><div class="pg-goal-in">${chips}</div></td>`;
      }
      return out;
    };
    const goalRows = visibleCats.map((cat) => `<tr><td class="pg-lb pg-cat pg-catL" ${catLabelHtml(cat)}</td>${goalCells(cat)}</tr>`).join('');
    // 已隐藏分类 chip（渲染到总表顶部工具条）
    const hiddenChips = mac.goalHiddenCats.length
      ? mac.goalHiddenCats.map((c) => `<span class="chip sm" data-unhidecat="${U.esc(c)}" style="cursor:pointer" title="点击恢复显示该分类">已隐藏：${U.esc(c)} ▸</span>`).join('')
      : '';

    // 手动输入行：训练量 / 训练负荷 / 状态
    const wpGet = (ws) => (mac.weekPlan[ws] = mac.weekPlan[ws] || {});
    // 带问号说明的标签
    const lbl = (text, tip) => `<span class="pg-lb-inner">${U.esc(text)}<i class="q" title="${U.esc(tip)}">?</i><span class="tip">${U.esc(tip)}</span></span>`;
    const inRow = (key, label, tip) => `<tr><td class="pg-lb">${lbl(label, tip)}</td>${weekMons.map((ws) => `
      <td><input class="pg-inp" type="number" min="1" max="10" data-ws="${ws}" data-key="${key}" value="${wpGet(ws)[key] ?? ''}" placeholder="1-10"></td>`).join('')}</tr>`;
    // 准备水平(1-10)：手动输入，直接驱动峰值状态曲线
    const stRow = `<tr><td class="pg-lb">${lbl('准备水平', '手动设定每周准备水平（1-10）。1=恢复中，3-4=基础，5-6=正常，7-8=良好，9-10=峰值。直接驱动峰值状态曲线走向。')}</td>${weekMons.map((ws) => {
      const lv = stLevel(wpGet(ws).status);
      return `<td><input class="pg-inp ${lv ? 'st-' + lv : ''}" type="number" min="1" max="10" data-ws="${ws}" data-key="status" value="${lv ?? ''}" placeholder="1-10"></td>`;
    }).join('')}</tr>`;

    el.innerHTML = `
      <div class="card-title"><h3>周期总表</h3></div>
      <div class="pg-team">
        <span class="chip volt">TEAM NAME</span>
        <input id="teamName" placeholder="点击输入队伍名称" value="${U.esc(mac.teamName || '')}">
      </div>
      <div class="pg-catbar">
        <button class="btn sm ghost" id="addCatBtn" title="新增训练目标大分类（自动分配不重复颜色）">＋ 新增大分类</button>
        <span class="hint">拖拽分类标签可调整顺序 · 点 ▾ 隐藏整行</span>
        ${hiddenChips}
      </div>
      <div class="pg-wrap"><table class="pg-table">
        <colgroup><col style="width:124px">${weekMons.map(() => '<col style="width:64px">').join('')}</colgroup>
        <tr><td class="pg-lb">月份</td>${monBands}</tr>
        ${dayRows}
        ${wkRow}
        ${mcRow}
        ${macroRow}
        ${mesoRow}
        ${testRow}
        ${compRow}
        ${placeRow}
        ${goalRows}
        ${inRow('volume', '训练量 1-10', '每周训练量等级（1-10）。1=极轻量（恢复/主动休息），5=常规量，10=极大负荷量。反映训练的"多少"，与训练负荷相乘得周负荷。')}
        ${inRow('intensity', '训练负荷 1-10', '每周训练强度等级（1-10）。1=极低强度，5=中等强度，10=极限强度。反映训练的"多累"，与训练量相乘得周负荷。')}
        ${stRow}
      </table></div>
      <div class="cal-legend">
        <span><i style="background:color-mix(in oklch,var(--color-info) 50%,transparent)"></i>1-2 恢复</span>
        <span><i style="background:color-mix(in oklch,var(--color-success) 50%,transparent)"></i>3-4 基础</span>
        <span><i style="background:color-mix(in oklch,var(--color-accent) 50%,transparent)"></i>5-6 正常</span>
        <span><i style="background:color-mix(in oklch,var(--color-warning) 50%,transparent)"></i>7-8 良好</span>
        <span><i style="background:color-mix(in oklch,var(--color-danger) 50%,transparent)"></i>9-10 峰值</span>
      </div>`;

    el.querySelector('#teamName').onchange = (e) => { mac.teamName = e.target.value.trim(); Store.save(); UI.toast('队伍名称已保存', 'ok'); };
    $$('[data-ws]', el).forEach((inp) => {
      if (inp.tagName !== 'INPUT') return;
      const handler = () => {
        const ws = inp.dataset.ws, key = inp.dataset.key;
        const rec = mac.weekPlan[ws] = mac.weekPlan[ws] || {};
        rec[key] = inp.value === '' ? null : Number(inp.value);
        Store.save();
        if (key === 'status') {
          const lv = rec.status;
          inp.className = 'pg-inp ' + (lv ? 'st-' + lv : '');
        }
        debounceCharts(v);   // 输入变化 → 下方图表实时联动
      };
      inp.oninput = handler;
    });
    // 点击日期格标记 / 取消比赛日或测试日（支持多日）
    $$('[data-cd]', el).forEach((td) => {
      td.onclick = () => markEntry(mac, td.dataset.cd);
    });
    // 中周期空白周：点击或按住鼠标拖动选择连续 N 周 → 弹窗定义中周期（预填所选周起止，单周点击同样可创建）
    const msCells = $$('.pg-msdrag', el);
    let msDragStart = null;
    const paintMesoDrag = (a, b) => {
      const s = Math.min(a, b), e2 = Math.max(a, b);
      msCells.forEach((c) => c.classList.toggle('drag-sel', +c.dataset.msi >= s && +c.dataset.msi <= e2));
    };
    msCells.forEach((c) => {
      c.addEventListener('mousedown', (e) => {
        e.preventDefault();
        msDragStart = +c.dataset.msi;
        paintMesoDrag(msDragStart, msDragStart);
        document.addEventListener('mouseup', onMesoDragUp);
      });
      c.addEventListener('mouseenter', () => { if (msDragStart != null) paintMesoDrag(msDragStart, +c.dataset.msi); });
    });
    const onMesoDragUp = () => {
      document.removeEventListener('mouseup', onMesoDragUp);
      if (msDragStart == null) return;
      const idxs = msCells.filter((c) => c.classList.contains('drag-sel')).map((c) => +c.dataset.msi);
      msCells.forEach((c) => c.classList.remove('drag-sel'));
      msDragStart = null;
      if (idxs.length) mesoDialog(mac, null, null, weekMons, { s: Math.min(...idxs), e: Math.max(...idxs) });
    };
    // 中周期带「✎」按钮编辑/删除；点击带本身 → 跳转中周期页规划
    $$('[data-medit]', el).forEach((td) => {
      td.onclick = (e) => {
        // 点击「✎」编辑按钮 → 打开编辑弹窗（不跳转）
        if (e.target.dataset.med) { e.stopPropagation(); mesoDialog(mac, Store.data.mesos.find((x) => x.id === e.target.dataset.med), null, weekMons); return; }
        const m = Store.data.mesos.find((x) => x.id === td.dataset.medit);
        if (m && Views.meso.show) Views.meso.show(m.id);
      };
    });
    // 大周期带：点击带 → 编辑/删除大周期；✎ 按钮同样打开编辑弹窗
    $$('[data-cyedit]', el).forEach((td) => {
      td.onclick = (e) => {
        const cid = e.target.dataset.cyde || td.dataset.cyedit;
        cycleDialog(mac, (mac.cycles || []).find((c) => c.id === cid));
      };
    });
    // 大周期空白周：点击或按住鼠标拖动选择连续 N 周 → 弹窗命名新大周期
    const mCells = $$('.pg-mdrag', el);
    let dragStart = null;
    const paintDrag = (a, b) => {
      const s = Math.min(a, b), e2 = Math.max(a, b);
      mCells.forEach((c) => c.classList.toggle('drag-sel', +c.dataset.mi >= s && +c.dataset.mi <= e2));
    };
    mCells.forEach((c) => {
      c.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragStart = +c.dataset.mi;
        paintDrag(dragStart, dragStart);
        document.addEventListener('mouseup', onDragUp);
      });
      c.addEventListener('mouseenter', () => { if (dragStart != null) paintDrag(dragStart, +c.dataset.mi); });
    });
    const onDragUp = () => {
      document.removeEventListener('mouseup', onDragUp);
      if (dragStart == null) return;
      const idxs = mCells.filter((c) => c.classList.contains('drag-sel')).map((c) => +c.dataset.mi);
      mCells.forEach((c) => c.classList.remove('drag-sel'));
      dragStart = null;
      if (idxs.length) {
        cycleDialog(mac, null, {
          startDate: weekMons[Math.min(...idxs)],
          endDate: U.addDays(weekMons[Math.max(...idxs)], 6)
        });
      }
    };

    // 训练目标行：点击目标带 → 编辑弹窗（按分类隔离，只编辑该分类目标）；空白周点击或拖选连续 N 周 → 新建目标弹窗
    // 拖选按分类行独立高亮（同 data-cat 才联动），避免跨分类行误选
    $$('[data-gbedit]', el).forEach((td) => {
      td.onclick = () => goalBlockDialog(mac, goalBlocksOf(mac).find((b) => b.id === td.dataset.gbedit), 0, 0, weekMons, td.dataset.cat);
    });
    const gCells = $$('.pg-gdrag', el);
    let gDragStart = null, gDragCat = null;
    const paintGoalDrag = (a, b, cat) => {
      const s = Math.min(a, b), e2 = Math.max(a, b);
      gCells.forEach((c) => { if (c.dataset.cat === cat) c.classList.toggle('drag-sel', +c.dataset.gi >= s && +c.dataset.gi <= e2); });
    };
    gCells.forEach((c) => {
      c.addEventListener('mousedown', (e) => {
        e.preventDefault();
        gDragStart = +c.dataset.gi; gDragCat = c.dataset.cat;
        paintGoalDrag(gDragStart, gDragStart, gDragCat);
        document.addEventListener('mouseup', onGoalDragUp);
      });
      c.addEventListener('mouseenter', () => { if (gDragStart != null && c.dataset.cat === gDragCat) paintGoalDrag(gDragStart, +c.dataset.gi, gDragCat); });
    });
    const onGoalDragUp = () => {
      document.removeEventListener('mouseup', onGoalDragUp);
      if (gDragStart == null) return;
      const idxs = gCells.filter((c) => c.classList.contains('drag-sel') && c.dataset.cat === gDragCat).map((c) => +c.dataset.gi);
      gCells.forEach((c) => c.classList.remove('drag-sel'));
      gDragStart = null; const cat = gDragCat; gDragCat = null;
      if (idxs.length) goalBlockDialog(mac, null, Math.min(...idxs), Math.max(...idxs), weekMons, cat);
    };
    // 末尾「新增大分类」行
    $$('[data-addcat]', el).forEach((td) => { td.onclick = () => addCatDialog(); });
    // 新增大分类按钮（目标区标题行）
    const addBtn = el.querySelector('#addCatBtn');
    if (addBtn) addBtn.onclick = () => addCatDialog();
    // 隐藏/展开分类
    $$('[data-togcat]', el).forEach((sp) => {
      sp.onclick = (e) => {
        e.stopPropagation();
        const cat = sp.dataset.togcat;
        mac.goalHiddenCats = mac.goalHiddenCats.includes(cat)
          ? mac.goalHiddenCats.filter((c) => c !== cat)
          : mac.goalHiddenCats.concat(cat);
        Store.save(); remount();
      };
    });
    // 删除自定义大分类（级联清理目标库与各计划目标块）
    $$('[data-delcat]', el).forEach((sp) => {
      sp.onclick = (e) => {
        e.stopPropagation();
        const cat = sp.dataset.delcat;
        UI.confirm(`删除训练目标分类「${U.esc(cat)}」？该分类下的全部目标及其在各周期中的安排将一并删除。`, () => {
          Store.removeGoalCat(cat);
          Store.save(); remount();
          UI.toast(`已删除分类「${cat}」`, 'ok');
        });
      };
    });
    // 分类拖拽排序（拖拽分类标签单元格，仅限训练目标区内部）
    let dragCat = null;
    $$('[data-catrow]', el).forEach((td) => {
      td.addEventListener('dragstart', (e) => {
        dragCat = td.dataset.cat;
        e.dataTransfer.effectAllowed = 'move';
        td.style.opacity = '0.4';
      });
      td.addEventListener('dragend', () => { td.style.opacity = ''; $$('[data-catrow]', el).forEach((x) => x.classList.remove('drag-over')); });
      td.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (dragCat && dragCat !== td.dataset.cat) td.classList.add('drag-over');
      });
      td.addEventListener('dragleave', () => td.classList.remove('drag-over'));
      td.addEventListener('drop', (e) => {
        e.preventDefault();
        td.classList.remove('drag-over');
        const targetCat = td.dataset.cat;
        if (!dragCat || dragCat === targetCat) return;
        const order = orderedCats.filter((c) => c !== dragCat);
        const ti = order.indexOf(targetCat);
        order.splice(ti, 0, dragCat);
        mac.goalCatOrder = order;
        Store.save(); remount();
        UI.toast(`已将「${dragCat}」移到「${targetCat}」上方`, 'ok');
      });
    });
    // 恢复已隐藏的分类（标题行 chip）
    $$('[data-unhidecat]', el).forEach((chip) => {
      chip.onclick = () => {
        mac.goalHiddenCats = mac.goalHiddenCats.filter((c) => c !== chip.dataset.unhidecat);
        Store.save(); remount();
        UI.toast(`已恢复显示「${chip.dataset.unhidecat}」`, 'ok');
      };
    });
  }

  // 新增大分类弹窗：输入名称 → 自动分配不重复 hue → goalCats 入库 → remount 后总表自动新增一行
  function addCatDialog() {
    UI.modal({
      title: '新增训练目标大分类',
      body: `<div class="form-grid">
        <div class="field full"><label>大分类名称</label><input class="ipt" id="acName" autofocus></div>
        <div class="field full"><span class="hint">系统自动分配一个与已有分类不重复的颜色；添加后周期总表训练目标区自动增加一行，之后可在该行点击周区间并向其中添加自定义目标。</span></div>
      </div>`,
      footer: '<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>添加</button>',
      onMount(ov, close) {
        const inp = ov.querySelector('#acName');
        inp.focus();
        inp.onkeydown = (e) => { if (e.key === 'Enter') ov.querySelector('[data-ok]').click(); };
        ov.querySelector('[data-ok]').onclick = () => {
          const name = inp.value.trim();
          if (!name) { UI.toast('请填写大分类名称', 'err'); return; }
          if (Store.allGoalCats().some((c) => c.name === name)) { UI.toast('该大分类已存在', 'err'); return; }
          const hue = Store.allocCatHue();
          Store.data.goalCats = Store.data.goalCats || [];
          Store.data.goalCats.push({ id: U.uid('gc'), name, hue });
          Store.save();
          close(); remount();
          UI.toast(`大分类「${name}」已添加（颜色 hsl ${hue}°）`, 'ok');
        };
      }
    });
  }

  // ---------- 月历 ----------
  function renderCalendar(v) {
    const mac = Store.activeMacro();
    const el = v.querySelector('#calBox');
    if (!mac) { el.innerHTML = ''; return; }
    if (!state.viewYM) state.viewYM = mac.startDate.slice(0, 7);
    const [yy, mm] = state.viewYM.split('-').map(Number);
    const first = new Date(yy, mm - 1, 1);
    const daysInMon = new Date(yy, mm, 0).getDate();
    const lead = first.getDay(); // 周日=0
    const todayS = U.today();

    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="cal-cell other"></div>';
    for (let day = 1; day <= daysInMon; day++) {
      const ds = `${yy}-${U.pad(mm)}-${U.pad(day)}`;
      const comp = (mac.compDates || []).find((c) => c.date === ds);
      const test = (mac.testDates || []).find((t) => t.date === ds);
      const inMac = ds >= mac.startDate && ds <= mac.endDate;
      const ton = inMac ? Store.dayTonnage(ds) : 0;
      const cls = [
        'cal-cell',
        ds === todayS ? 'today' : '',
        comp ? 'comp' : '',
        test ? 'testday' : ''
      ].filter(Boolean).join(' ');
      cells += `
        <div class="${cls}" data-d="${ds}">
          <div class="d"><span>${day}</span><span class="wd">${U.wd(ds).replace('周', '')}</span></div>
          ${comp ? `<span class="badge-comp">赛</span><span class="cname">${U.esc(comp.name)}</span>` : ''}
          ${!comp && test ? `<span class="badge-test">测</span><span class="cname tst">${U.esc(test.name)}</span>` : ''}
          ${!comp && !test && ton > 0 ? `<span class="badge-peak">${U.fmt(ton / 1000, 1)}t</span>` : ''}
          <button class="mark-btn" data-mk="${ds}">${comp ? '取消赛' : test ? '取消测' : '＋标记'}</button>
        </div>`;
    }

    el.innerHTML = `
      <div class="cal-head">
        <div class="row" style="gap:10px">
          <span class="mon">${yy} 年 ${mm} 月</span>
          <span class="hint">悬停标记比赛日 / 测试日</span>
        </div>
        <div class="cal-nav">
          <button id="calPrev">‹</button><button id="calToday" style="width:auto;padding:0 10px;font-size:12px">今天</button><button id="calNext">›</button>
        </div>
      </div>
      <div class="cal-grid">
        ${U.WD.map((w) => `<div class="cal-wd">${w}</div>`).join('')}
        ${cells}
      </div>
      <div class="cal-legend">
        <span><i style="background:color-mix(in oklch,var(--color-danger) 30%,transparent);border:1px solid var(--red)"></i>比赛日</span>
        <span><i style="background:color-mix(in oklch,var(--color-info) 30%,transparent);border:1px solid var(--blue)"></i>测试日</span>
        <span><i style="background:color-mix(in oklch,var(--color-accent) 20%,transparent)"></i>计划负荷日</span>
        <span><i style="border:1px solid var(--blue)"></i>今天</span>
      </div>`;

    $('#calPrev').onclick = () => { shiftMonth(-1); };
    $('#calNext').onclick = () => { shiftMonth(1); };
    $('#calToday').onclick = () => { state.viewYM = todayS.slice(0, 7); remount(); };

    $$('[data-mk]', el).forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        markEntry(mac, btn.dataset.mk);
      };
    });

    function shiftMonth(n) {
      let y = yy, m = mm + n;
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      state.viewYM = `${y}-${U.pad(m)}`;
      renderCalendar(v);
    }
  }

  // ---------- 比赛日列表 ----------
  function renderComps(v) {
    const mac = Store.activeMacro();
    const el = v.querySelector('#compList');
    if (!mac) { el.innerHTML = ''; return; }
    const comps = (mac.compDates || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    el.innerHTML = `
      <div class="card-title"><h3>比赛日历</h3><span class="sub">共 ${comps.length} 场</span></div>
      ${comps.length ? `<table class="tbl"><tbody>${comps.map((c) => `
        <tr><td class="num" style="width:76px">${U.md(c.date)}</td><td style="width:40px">${U.wd(c.date)}</td><td>${U.esc(c.name)}<div class="hint">${U.esc(c.place || '—')}</div></td>
        <td class="r"><button class="btn danger sm" data-del="${c.date}">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="hint">暂无比赛日，在左侧月历中悬停日期点击「＋比赛日」标记。</p>'}`;
    $$('[data-del]', el).forEach((b) => {
      b.onclick = () => UI.confirm('移除该比赛日？', () => {
        mac.compDates = mac.compDates.filter((c) => c.date !== b.dataset.del);
        Store.save(); remount();
      });
    });
  }

  // ---------- 力量训练计划表 ----------
  function renderPlan(v) {
    const mac = Store.activeMacro();
    const el = v.querySelector('#planBox');
    if (!mac) { el.innerHTML = ''; return; }
    const mesos = Store.mesosOf(mac.id);
    el.innerHTML = `
      <div class="card-title"><h3>力量训练计划</h3>
        <div class="row"><span class="sub">中周期阶段划分与负荷安排</span>
        <button class="btn sm" id="goMeso">进入中周期制定 →</button></div>
      </div>
      ${mesos.length ? `
      <div style="overflow-x:auto"><table class="tbl">
        <thead><tr><th>中周期</th><th>类型</th><th>起止</th><th>周数</th><th class="r">计划组数</th><th class="r">计划次数</th><th class="r">平均强度</th><th class="r">预估吨位</th><th class="r">计划距离</th><th class="r">做功时长</th></tr></thead>
        <tbody>${mesos.map((m) => {
          const rows = (m.days || []).flatMap((dd) => Store.dayRows(dd));
          const distM = Calc.rowsDistance(rows), workS = Calc.rowsDuration(rows);
          const teamT = Calc.rowsTeamTonnage(rows, mac.athletes || []);
          return `<tr>
            <td><b>${U.esc(m.name)}</b></td>
            <td><span class="chip ${m.type === '峰值' ? 'red' : m.type === '最大力量' ? 'amber' : m.type === '恢复' ? 'green' : 'volt'}">${U.esc(m.type)}</span></td>
            <td class="num">${U.md(m.startDate)} — ${U.md(m.endDate)}</td>
            <td class="num">${Math.ceil(U.daysBetween(m.startDate, m.endDate) / 7)} 周</td>
            <td class="r num">${U.fmt(Calc.rowsSets(rows))}</td>
            <td class="r num">${U.fmt(Calc.rowsReps(rows))}</td>
            <td class="r num">${Calc.rowsAvgPct(rows) ? Math.round(Calc.rowsAvgPct(rows)) + '%' : '—'}</td>
            <td class="r num" title="按参训运动员 1RM×%1RM 汇总（${teamT.nW}/${teamT.n} 人已设 1RM）">${teamT.kg ? U.fmt(teamT.kg / 1000, 1) + ' t' : '—'}</td>
            <td class="r num">${distM ? U.fmt(Math.round(distM / 100) / 10, 1) + ' km' : '—'}</td>
            <td class="r num">${workS ? U.fmt(Math.round(workS / 6) / 10, 1) + ' min' : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`
      : '<div class="empty"><h4>尚未制定中周期</h4><p>点击上方「按模型生成中周期框架」，或前往中周期页面手动创建</p></div>'}`;
    const g = el.querySelector('#goMeso');
    if (g) g.onclick = () => { location.hash = '#/meso'; };
  }

  // ---------- 图表：负荷与量 / 力量负荷与量 / 峰值状态（随周期总表手动输入实时变化） ----------
  // 周数据：仅取周期总表手动输入（量×负荷 1-10），未填的周为空（不再折算计划吨位；吨位在每次训练课后按实际计算）
  function weekData(mac, weekMons) {
    return weekMons.map((ws) => {
      const wp = (mac.weekPlan || {})[ws] || {};
      const v = wp.volume ?? null;
      const i = wp.intensity ?? null;
      return { ws, v, i, manual: v != null || i != null, load: (v && i) ? v * i : 0 };
    });
  }

  // 推荐走向：按各周所属中周期类型给出训练量/负荷参考（1-10）；比赛周强制减量；
  // 无中周期覆盖的周按距最后比赛日的通用节奏推荐（基础准备→专项转化→赛前峰值→减量→比赛）
  function recommendTrend(mac, weekMons) {
    const mesos = Store.mesosOf(mac.id);
    const comps = (mac.compDates || []).map((c) => c.date).filter((d) => d >= mac.startDate && d <= mac.endDate).sort();
    const lastComp = comps.length ? comps[comps.length - 1] : mac.endDate;
    const TYPE_RV = { '积累': [8, 5], '最大力量': [6, 8], '转化功率': [5, 9], '峰值': [3, 8], '维持': [5, 6], '恢复': [3, 4], '测试': [4, 9] };
    const fallback = (gapW) => {
      if (gapW < 0) return [4, 4];        // 赛后过渡
      if (gapW === 0) return [3, 5];      // 比赛周
      if (gapW === 1) return [4, 6];      // 赛前减量
      if (gapW <= 3) return [5, 8];       // 赛前峰值
      if (gapW <= 7) return [7, 7];       // 专项转化
      return [8, 5];                      // 基础准备
    };
    return weekMons.map((ws) => {
      const wEnd = U.addDays(ws, 6);
      const hasComp = comps.some((d) => U.between(d, ws, wEnd));
      const m = mesos.find((x) => U.between(ws, x.startDate, x.endDate) || U.between(wEnd, x.startDate, x.endDate));
      const vi = hasComp ? [3, 5] : (m ? (TYPE_RV[m.type] || null) : fallback(Math.round(U.daysBetween(ws, lastComp) / 7)));
      return { ws, rv: vi ? vi[0] : null, ri: vi ? vi[1] : null };
    });
  }

  // 峰值状态核心序列（renderCharts 与 Excel 导出共用）
  // 能量储备(Fitness/CTL) = 日负荷的 42 天 EWMA（慢变量）
  // 疲劳(Fatigue/ATL)    = 日负荷的 7 天 EWMA（快变量）
  // 峰值状态(准备水平)   = 手动输入的每周准备水平(1-10) × 10，按周展开到每日
  function peakSeries(mac, start, end) {
    const gs = U.weekStart(start), ge = U.weekStart(end);
    const weekMons = [];
    for (let ws = gs; ws <= ge; ws = U.addDays(ws, 7)) weekMons.push(ws);
    const wks = weekData(mac, weekMons);
    const days = []; let dt = start;
    while (dt <= end) { days.push(dt); dt = U.addDays(dt, 1); }
    const loadMap = {};
    wks.forEach((w) => { loadMap[w.ws] = w.load; });
    const dayLoad = days.map((d) => (loadMap[U.weekStart(d)] || 0) / 7);
    const lf = Math.exp(-1 / 42), la = Math.exp(-1 / 7);
    let f = 0, a = 0; const F = [], A = [];
    dayLoad.forEach((l) => { f = f * lf + l * lf; a = a * la + l * la; F.push(f); A.push(a); });
    // 峰值状态 = 手动准备水平(1-10) × 10，按周展开
    const cForm = days.map((d) => {
      const lv = stLevel((mac.weekPlan[U.weekStart(d)] || {}).status);
      return lv == null ? null : +(lv * 10).toFixed(1);
    });
    const norm = (arr) => {
      const vs = arr.filter((x) => x != null);
      if (!vs.length) return arr.map(() => null);
      const mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
      return arr.map((x) => x == null ? null : +(((x - mn) / rg) * 100).toFixed(1));
    };
    return { days, wks, cForm, fF: norm(F), fA: norm(A) };
  }


  // ---------- 导出 Excel（.xlsx 最小生成器：zip stored + inline string，零依赖） ----------
  function crc32(buf) {
    let t = crc32.T;
    if (!t) {
      t = crc32.T = new Int32Array(256);
      for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
    }
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  }
  function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const [name, content] of files) {
      const nb = enc.encode(name), cb = enc.encode(content);
      const crc = crc32(cb);
      const lh = new Uint8Array(30 + nb.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, cb.length, true); dv.setUint32(22, cb.length, true);
      dv.setUint16(26, nb.length, true);
      lh.set(nb, 30);
      parts.push(lh, cb);   // lh 已含文件名，勿重复写入 nb
      const ch = new Uint8Array(46 + nb.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, cb.length, true); cv.setUint32(24, cb.length, true);
      cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true);
      ch.set(nb, 46);
      central.push(ch);
      offset += lh.length + cb.length;   // lh 已包含文件名
    }
    const centralSize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + centralSize + 22);
    let p = 0;
    for (const b of [...parts, ...central, eocd]) { out.set(b, p); p += b.length; }
    return out;
  }
  const colName = (i) => { let s = '', n = i + 1; while (n) { s = String.fromCharCode(65 + (n - 1) % 26) + s; n = Math.floor((n - 1) / 26); } return s; };
  function sheetXML(rows) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
    rows.forEach((r, ri) => {
      xml += `<row r="${ri + 1}">`;
      r.forEach((c, ci) => {
        if (c == null || c === '') return;
        const ref = colName(ci) + (ri + 1);
        if (typeof c === 'number' && isFinite(c)) xml += `<c r="${ref}"><v>${c}</v></c>`;
        else xml += `<c r="${ref}" t="inlineStr"><is><t>${U.esc(String(c))}</t></is></c>`;
      });
      xml += '</row>';
    });
    return xml + '</sheetData></worksheet>';
  }
  function xlsxWrite(sheets) {
    const files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => `<sheet name="${U.esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>']
    ];
    sheets.forEach((s, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXML(s.rows)]));
    return zipStore(files);
  }
  async function exportPeakExcel(mac) {
    const start = mac.startDate;
    const end = mac.endDate;
    const s = peakSeries(mac, start, end);
    const ST = {}; STATUS_LEVELS.forEach((s) => { ST[s.level] = s.level + ' ' + s.name; });
    const dayRows = [['日期', '能量储备 (0-100)', '疲劳 (0-100)', '峰值状态 = 能量储备 − 疲劳 (0-100)']];
    s.days.forEach((d, i) => dayRows.push([d, s.fF[i], s.fA[i], s.cForm[i]]));
    const wkRows = [['周起始(周一)', '周结束', '训练量 (1-10)', '训练负荷 (1-10)', '状态', '推荐量', '推荐负荷', '数据来源']];
    const rks = recommendTrend(mac, s.wks.map((w) => w.ws));
    s.wks.forEach((w, i) => {
      const wp = (mac.weekPlan || {})[w.ws] || {};
      wkRows.push([w.ws, U.addDays(w.ws, 6), w.v, w.i, stLevel(wp.status) ? ST[stLevel(wp.status)] : '', rks[i].rv, rks[i].ri, w.manual ? '手动输入' : '未填']);
    });
    const buf = xlsxWrite([{ name: '每日状态数据', rows: dayRows }, { name: '周计划输入', rows: wkRows }]);
    const fname = `峰值状态_${mac.name}_${U.today()}.xlsx`.replace(/\s+/g, '');
    if (window.api && window.api.exportFile) {
      const r = await window.api.exportFile(fname, buf);
      UI.toast(r && r.ok ? `已导出到下载目录：${fname}` : '导出失败', r && r.ok ? 'ok' : 'err');
    } else {
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a');
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = fname;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      UI.toast('已导出 Excel（每日状态数据 + 周计划输入）', 'ok');
    }
  }

  function renderCharts(v) {
    const mac = Store.activeMacro();
    const box = v.querySelector('#chartBox');
    if (!mac) { box.innerHTML = ''; return; }
    const start = mac.startDate;
    const end = mac.endDate;
    if (start > end) { box.innerHTML = '<p class="hint">日期范围无效</p>'; return; }
    box.innerHTML = `
      <div class="card-title">
        <h3>负荷与状态</h3>
        <span class="sub">${U.md(start)} — ${U.md(end)}</span>
        <div style="margin-left:auto;display:flex;gap:10px;align-items:center">
          <select id="viewSel" class="pg-sel" style="width:140px">
            <option value="load">负荷与量</option>
            <option value="peak">峰值状态</option>
            <option value="all">全部</option>
          </select>
        </div>
      </div>
      <div class="chart" id="chMain"></div>`;

    // 核心序列（周数据 + 日展开 + Fitness-Fatigue）
    const { days, wks, cForm, fF, fA } = peakSeries(mac, start, end);

    // 状态背景带（按准备水平 1-10 着色，连续同等级周合并）
    const stColor = { 1: UI.tint('var(--color-info)', .14), 2: UI.tint('var(--color-info)', .1), 3: UI.tint('var(--color-success)', .12), 4: UI.tint('var(--color-success)', .1), 5: UI.tint('var(--color-accent)', .1), 6: UI.tint('var(--color-accent)', .12), 7: UI.tint('var(--color-warning)', .12), 8: UI.tint('var(--color-warning)', .14), 9: UI.tint('var(--color-danger)', .12), 10: UI.tint('var(--color-danger)', .14) };
    const bands = []; let b = null;
    for (let i = 0; i < wks.length; i++) {
      const st = stLevel((mac.weekPlan[wks[i].ws] || {}).status);
      if (b && b.st === st) b.end = U.addDays(wks[i].ws, 6);
      else { if (b) bands.push(b); b = st ? { st, start: wks[i].ws, end: U.addDays(wks[i].ws, 6) } : null; }
    }
    if (b) bands.push(b);
    const markAreas = bands.map((x) => [{ xAxis: x.start, itemStyle: { color: stColor[x.st] } }, { xAxis: x.end }]);
    const compIn = (mac.compDates || []).filter((c) => c.date >= start && c.date <= end);

    const cMain = UI.chart(v.querySelector('#chMain'));
    const drawMain = (view) => {
      if (view === 'peak') {
        // 峰值状态：仅曲线，无柱状图
        cMain.setOption({
          grid: { left: 44, right: 20, top: 34, bottom: 30 },
          tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
            formatter: (ps) => {
              if (!ps || !ps.length || !ps[0]) return '';
              return `${U.md(ps[0].axisValue)}<br/>` + ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}：<b>${U.fmt(p.value, 0)}</b>`).join('<br/>');
            }
          }),
          legend: { textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 0, right: 0 },
          xAxis: { type: 'category', data: days, axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, formatter: (x) => U.md(x), interval: Math.max(1, Math.floor(days.length / 12)) } },
          yAxis: Object.assign({ type: 'value', name: '状态指数', max: 110, nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon),
          series: [
            { name: '能量储备 (CTL·42d)', type: 'line', data: fF, smooth: true, showSymbol: false, lineStyle: { color: UI.tint('var(--color-success)', .7), width: 1.8 }, itemStyle: { color: UI.cssVar('var(--color-success)') } },
            { name: '疲劳 (ATL·7d)', type: 'line', data: fA, smooth: true, showSymbol: false, lineStyle: { color: UI.tint('var(--color-warning)', .7), width: 1.8 }, itemStyle: { color: UI.cssVar('var(--color-warning)') } },
            { name: '峰值状态', type: 'line', data: cForm, smooth: true, showSymbol: false,
              lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 3, shadowColor: UI.tint('var(--color-accent)', .5), shadowBlur: 10 }, itemStyle: { color: UI.cssVar('var(--color-accent)') },
              areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-accent)', .18) }, { offset: 1, color: UI.tint('var(--color-accent)', 0) }] } },
              markArea: { silent: true, data: markAreas },
              markLine: { symbol: 'none', silent: true, lineStyle: { color: UI.tint('var(--color-danger)', .35), width: 1, type: 'dashed' }, label: { show: false }, data: compIn.map((c) => ({ xAxis: c.date })) } }
          ]
        }, true);
      } else if (view === 'all') {
        // 全部：训练量/训练负荷（左轴 1-10）+ 能量储备/疲劳/峰值状态（右轴 状态指数）
        // 将周数据展开到每日：每个日期取其所在周的量/负荷值
        const volByDay = [], loadByDay = [];
        for (const d of days) {
          const w = wks.find((wk) => d >= wk.ws && d <= U.addDays(wk.ws, 6));
          volByDay.push(w ? w.v : null);
          loadByDay.push(w ? w.i : null);
        }
        cMain.setOption({
          grid: { left: 50, right: 56, top: 40, bottom: 30 },
          tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
            formatter: (ps) => {
              if (!ps || !ps.length || !ps[0]) return '';
              return `${U.md(ps[0].axisValue)}<br/>` + ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}：<b>${U.fmt(p.value, 0)}</b>`).join('<br/>');
            }
          }),
          legend: { textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 0, left: 0 },
          xAxis: { type: 'category', data: days, axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, formatter: (x) => U.md(x), interval: Math.max(1, Math.floor(days.length / 12)) } },
          yAxis: [
            Object.assign({ type: 'value', name: '1-10', max: 10, nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon),
            Object.assign({ type: 'value', name: '状态指数', max: 110, nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon, { splitLine: { show: false } })
          ],
          series: [
            { name: '训练量（1-10）', type: 'line', data: volByDay, smooth: true, showSymbol: false, lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 2 }, itemStyle: { color: UI.cssVar('var(--color-accent)') } },
            { name: '训练负荷（1-10）', type: 'line', data: loadByDay, smooth: true, showSymbol: false, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2 }, itemStyle: { color: UI.cssVar('var(--color-info)') } },
            { name: '能量储备 (CTL·42d)', type: 'line', yAxisIndex: 1, data: fF, smooth: true, showSymbol: false, lineStyle: { color: UI.tint('var(--color-success)', .7), width: 1.8 }, itemStyle: { color: UI.cssVar('var(--color-success)') } },
            { name: '疲劳 (ATL·7d)', type: 'line', yAxisIndex: 1, data: fA, smooth: true, showSymbol: false, lineStyle: { color: UI.tint('var(--color-warning)', .7), width: 1.8 }, itemStyle: { color: UI.cssVar('var(--color-warning)') } },
            { name: '峰值状态', type: 'line', yAxisIndex: 1, data: cForm, smooth: true, showSymbol: false,
              lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 3, shadowColor: UI.tint('var(--color-accent)', .5), shadowBlur: 10 }, itemStyle: { color: UI.cssVar('var(--color-accent)') },
              areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: UI.tint('var(--color-accent)', .12) }, { offset: 1, color: UI.tint('var(--color-accent)', 0) }] } },
              markArea: { silent: true, data: markAreas } }
          ]
        }, true);
      } else {
        // 负荷与量：仅折线（训练量 + 训练负荷），无柱状图、无推荐曲线
        cMain.setOption({
          grid: { left: 44, right: 20, top: 34, bottom: 30 },
          tooltip: Object.assign({ trigger: 'axis' }, UI.tooltipCommon, {
            formatter: (ps) => {
              if (!ps || !ps.length) return '';
              const w = wks[ps[0].dataIndex];
              if (!w) return '';
              const lines = ps.filter((p) => p.value != null).map((p) => `${p.marker}${p.seriesName}：<b>${p.value}</b>`);
              return `${U.md(w.ws)} 周<br/>` + (lines.join('<br/>') || '未填');
            }
          }),
          legend: { textStyle: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 11 }, top: 0, right: 0 },
          xAxis: { type: 'category', data: wks.map((w) => w.ws), axisLabel: { color: UI.cssVar('var(--color-ink-muted)'), fontSize: 10, formatter: (x) => U.md(x) } },
          yAxis: [Object.assign({ type: 'value', name: '1-10', max: 10, nameTextStyle: { color: UI.cssVar('var(--color-ink-subtle)') } }, UI.axisCommon)],
          series: [
            { name: '训练量（1-10）', type: 'line', data: wks.map((w) => w.v), smooth: true, lineStyle: { color: UI.cssVar('var(--color-accent)'), width: 2.5 }, itemStyle: { color: UI.cssVar('var(--color-accent)') }, symbolSize: 6,
              markArea: { silent: true, data: markAreas } },
            { name: '训练负荷（1-10）', type: 'line', data: wks.map((w) => w.i), smooth: true, lineStyle: { color: UI.cssVar('var(--color-info)'), width: 2.5 }, itemStyle: { color: UI.cssVar('var(--color-info)') }, symbolSize: 6 }
          ]
        }, true);
      }
    };
    drawMain(v.dataset._view || 'load');
    const sel = v.querySelector('#viewSel');
    if (sel) {
      sel.value = v.dataset._view || 'load';
      sel.onchange = () => { v.dataset._view = sel.value; drawMain(sel.value); };
    }
  }

  // ---------- 训练目标块 ----------
  // 大周期总表目标块：[{id, start, end, primary:[goalId], secondary:[goalId]}]
  // 旧数据迁移：原 macro.goals（整周期目标）转为覆盖全周期的单个目标块
  function goalBlocksOf(mac) {
    if (!mac.goalBlocks) {
      const g = mac.goals || {};
      mac.goalBlocks = (g.primary || g.secondary || []).length
        ? [{ id: U.uid('gb'), start: mac.startDate, end: mac.endDate, primary: g.primary || [], secondary: g.secondary || [] }]
        : [];
    }
    return mac.goalBlocks;
  }

  // 目标块新建/编辑弹窗：按分类隔离（cat）——只显示该分类目标，每类主要目标单选（第二个自动降为次要）
  // 保存时合并：保留该块中其他分类的目标，仅替换当前分类的 primary/secondary；新建时若区间已重叠已有块则并入
  function goalBlockDialog(mac, block, sIdx, eIdx, weekMons, cat) {
    const catOf = (id) => { const g = Store.goalById(id); return g && g.cat; };
    const inCat = (arr) => (arr || []).filter((id) => catOf(id) === cat);
    const notCat = (arr) => (arr || []).filter((id) => { const c = catOf(id); return c !== cat; });
    const sel = block
      ? { primary: inCat(block.primary), secondary: inCat(block.secondary) }
      : { primary: [], secondary: [] };
    UI.modal({
      title: `${block ? '编辑' : '设定'}训练目标${cat ? ' · ' + cat : ''}`,
      wide: true,
      body: `
        <div class="form-grid">
          <div class="field"><label>起始（周一）</label><input type="date" class="ipt" id="gbStart" value="${block ? block.start : weekMons[sIdx]}"></div>
          <div class="field"><label>结束（周日）</label><input type="date" class="ipt" id="gbEnd" value="${block ? block.end : U.addDays(weekMons[eIdx], 6)}"></div>
        </div>
        <div class="field full"><label>${U.esc(cat || '')} · 主要目标单选（第二个自动降为次要）· 点击：未选 → 主要 → 次要 → 未选</label><div id="gbChips"></div></div>
        <div class="row" style="gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line);flex-wrap:wrap">
          <input class="ipt" id="gbNewGoal" placeholder="在「${U.esc(cat || '')}」下添加自定义目标名称" style="width:260px">
          <button class="btn sm" id="gbAddGoal">＋ 添加目标</button>
          <span class="hint">新目标归入「${U.esc(cat || '')}」分类，添加后点击即可选择</span>
        </div>`,
      footer: `${block ? '<button class="btn danger" data-del>删除</button>' : ''}<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        const chipsBox = ov.querySelector('#gbChips');
        const renderChips = () => UI.goalCycleChips(chipsBox, sel, null, { cat, singlePrimary: true });
        renderChips();
        // 添加本分类自定义目标（hue 跟随分类，保证同类色系一致）
        ov.querySelector('#gbAddGoal').onclick = () => {
          const inp = ov.querySelector('#gbNewGoal');
          const name = inp.value.trim();
          if (!name) { UI.toast('请填写目标名称', 'err'); return; }
          if (Store.data.goals.some((g) => g.name === name)) { UI.toast('该目标已存在', 'err'); return; }
          const catObj = Store.allGoalCats().find((c) => c.name === cat);
          Store.data.goals.push({ id: U.uid('g'), name, cat, hue: catObj ? catObj.hue : 200 });
          Store.save();
          renderChips();
          inp.value = '';
          UI.toast(`已添加到「${cat}」`, 'ok');
        };
        ov.querySelector('[data-ok]').onclick = () => {
          const start = ov.querySelector('#gbStart').value, end = ov.querySelector('#gbEnd').value;
          if (!start || !end || end < start) { UI.toast('请检查起止日期', 'err'); return; }
          if (!sel.primary.length && !sel.secondary.length) { UI.toast(`请至少选择一个${cat || ''}目标`, 'err'); return; }
          const blocks = goalBlocksOf(mac);
          const merged = (b) => ({ primary: [...notCat(b.primary), ...sel.primary], secondary: [...notCat(b.secondary), ...sel.secondary] });
          if (block) Object.assign(block, { start, end, ...merged(block) });
          else {
            // 新建：若区间已与已有块重叠，并入该块（扩展日期并集 + 合并该分类目标）；否则新建
            const overlap = blocks.find((b) => b.start <= end && b.end >= start);
            if (overlap) Object.assign(overlap, { start: overlap.start < start ? overlap.start : start, end: overlap.end > end ? overlap.end : end, ...merged(overlap) });
            else blocks.push({ id: U.uid('gb'), start, end, primary: [...sel.primary], secondary: [...sel.secondary] });
          }
          Store.save(); close(); remount(); UI.toast('训练目标已更新', 'ok');
        };
        const del = ov.querySelector('[data-del]');
        if (del) del.onclick = () => {
          // 删除仅该分类目标：保留其他分类，若无任何目标则移除整块
          const rp = notCat(block.primary), rs = notCat(block.secondary);
          if (rp.length || rs.length) Object.assign(block, { primary: rp, secondary: rs });
          else mac.goalBlocks = goalBlocksOf(mac).filter((b) => b.id !== block.id);
          Store.save(); close(); remount(); UI.toast(`已删除${cat || ''}目标`, 'ok');
        };
      }
    });
  }

  // ---------- 挂载 ----------
  function mount(v) {
    if (v == null) v = $('#view');
    UI.disposeCharts();
    const mac = Store.activeMacro();
    v.innerHTML = `
      <div class="card" id="macToolbarWrap" style="padding:16px 18px;position:relative;z-index:30"><div id="macToolbar"></div>
        ${!mac ? `<div class="empty" style="margin-top:14px"><h4>开始你的第一个训练计划</h4><p>选择运动项目与起止日期，构建整个赛季的训练蓝图</p><button class="btn primary" id="btnNewMacro">＋ 新建训练计划</button></div>` : ''}
      </div>
      ${mac ? `
      <div style="margin-top:16px" id="macKpis"></div>
      <div class="card" style="margin-top:16px" id="gridBox"></div>
      <div class="grid2" style="margin-top:16px;grid-template-columns:1.55fr 1fr">
        <div class="card" id="calBox"></div>
        <div style="display:flex;flex-direction:column;gap:16px">
          <div class="card" id="compList"></div>
        </div>
      </div>
      <div class="card" style="margin-top:16px" id="chartBox"></div>
      <div class="card" style="margin-top:16px" id="planBox"></div>` : ''}`;

    const nb = v.querySelector('#btnNewMacro');
    if (nb) nb.onclick = () => macroDialog(null);
    renderToolbar(v);
    if (mac) {
      renderKPI(v);
      renderGrid(v);
      renderCalendar(v);
      renderComps(v);
      renderCharts(v);
      renderPlan(v);
    }
  }

  // 大周期新建/编辑弹窗：供本页总表与中周期页共用（保存后按当前路由自动重挂）
  const openCycle = (mac, cyc, preset) => cycleDialog(mac, cyc, preset);

  return { mount, openCycle };
})();
