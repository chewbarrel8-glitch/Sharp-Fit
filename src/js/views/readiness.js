// Readiness page: HRV / sleep / fatigue / soreness / mood / stress / ACWR → overall readiness score
// Per-item metric average algorithm with interpretation and literature references
Views.readiness = (() => {
  const state = { athleteId: null, date: U.today() };

  // Individual HRV baseline: 7-day rolling mean ± SD from days BEFORE the given date (excludes the date itself)
  // Returns { n, mean, sd, streak } — streak = consecutive most-recent days with z < -1
  function hrvBaseline(athId, date) {
    const wells = Store.wellnessOf(athId).filter((x) => x.date < date && x.hrv != null).slice(0, 7);
    const vals = wells.map((x) => x.hrv);
    const n = vals.length;
    if (n < 4) return { n, mean: n ? U.avg(vals) : null, sd: null, streak: 0 };
    const mean = U.avg(vals);
    const sd = Calc.std(vals);
    let streak = 0;
    if (sd > 0) {
      // wellnessOf is date-descending; count consecutive recent days below -1σ
      for (const x of wells) {
        if (((x.hrv - mean) / sd) < -1) streak++; else break;
      }
    }
    return { n, mean, sd, streak };
  }

  // Each dimension score (0-100, higher = better recovery) with literature reference
  // Returns { score, label, value, unit, good, detail, cite }
  function dimScores(w, acwr, hrvBase) {
    if (!w) return {};
    const out = {};

    // HRV (rMSSD, ms) — individual baseline z-score method (research upgrade);
    // falls back to fixed thresholds when history < 4 days
    out.hrv = (() => {
      if (w.hrv == null) return null;
      const v = w.hrv;
      if (hrvBase && hrvBase.n >= 4 && hrvBase.sd > 0) {
        const z = (v - hrvBase.mean) / hrvBase.sd;
        let s;
        if (z >= 0) s = 100;
        else if (z >= -0.5) s = 85;
        else if (z >= -1) s = 70;
        else if (z >= -2) s = 45;
        else s = 20;
        const warn = z < -2 ? 'red' : z < -1 ? 'yellow' : null;
        return {
          score: s, value: v, unit: 'ms',
          label: 'HRV 心率变异性',
          good: z >= -1, warn, z,
          detail: `HRV（rMSSD）= ${v}ms；个人基线 ${hrvBase.mean.toFixed(1)}±${hrvBase.sd.toFixed(1)}ms（近 ${hrvBase.n} 天），z = ${z > 0 ? '+' : ''}${z.toFixed(2)}σ。z ≥ −1 正常波动；z < −1 黄警（建议降低当日强度或增加恢复）；z < −2 红警（建议仅技术/低强度训练）。${hrvBase.streak >= 3 ? `⚠ 已连续 ${hrvBase.streak} 天 z < −1，触发教练审核流程。` : ''}`,
          cite: 'Plews DJ et al. (2013). Sports Med 43(8):697-706；个体化基线法：Buchheit M (2014). Front Physiol 5:73'
        };
      }
      let s;
      if (v >= 70) s = 100;
      else if (v >= 50) s = 80;
      else if (v >= 30) s = 55;
      else s = 25;
      return {
        score: s, value: v, unit: 'ms',
        label: 'HRV 心率变异性',
        good: v >= 50,
        detail: `HRV（rMSSD）= ${v}ms。固定阈值参考：≥70ms 恢复优秀，50-69ms 正常，30-49ms 偏低，<30ms 过度疲劳风险。累计 ≥4 天数据后自动切换为个体基线 z 分数评估（更精准）。`,
        cite: 'Plews DJ et al. (2013). Heart rate variability in athletes. Sports Medicine 43(8):697-706'
      };
    })();

    // Sleep duration + efficiency
    out.sleep = (() => {
      if (w.sleepHours == null) return null;
      const h = w.sleepHours, eff = w.sleepEff;
      let s = 100;
      if (h < 6) s -= 30;
      else if (h < 7) s -= 15;
      else if (h < 8) s -= 5;
      if (eff != null) {
        if (eff < 80) s -= 15;
        else if (eff < 85) s -= 8;
        else if (eff < 90) s -= 3;
      }
      s = Math.max(0, s);
      return {
        score: s, value: h, unit: 'h',
        label: '睡眠时长',
        good: h >= 7,
        detail: `睡眠 ${h}h${eff != null ? ' · 效率 ' + eff + '%' : ''}。运动员推荐 7-9h，效率 ≥85% 为优质睡眠。睡眠不足直接影响力量、爆发力与认知表现。`,
        cite: 'Halson SL (2014). Sleep in elite athletes. Sports Medicine 44(Suppl 2):133-141'
      };
    })();

    // Subjective fatigue (1-10, higher = more fatigued)
    out.fatigue = (() => {
      if (w.fatigue == null) return null;
      const v = w.fatigue;
      const s = Math.round((10 - v) / 7 * 100);
      return {
        score: s, value: v, unit: '/10',
        label: '主观疲劳',
        good: v <= 4,
        detail: `主观疲劳 ${v}/10。≤4 恢复良好，5-6 正常，7-8 偏高，≥9 过度疲劳。该指标与 HRV、CK 等客观指标相关性良好。`,
        cite: 'Foster C et al. (2001). Monitoring training in athletes with reference to the training impulse. Sports Medicine 31(8):581-587'
      };
    })();

    // Muscle soreness (1-10)
    out.soreness = (() => {
      if (w.soreness == null) return null;
      const v = w.soreness;
      const s = Math.round((10 - v) / 7 * 100);
      return {
        score: s, value: v, unit: '/10',
        label: '肌肉酸痛',
        good: v <= 4,
        detail: `肌肉酸痛 ${v}/10。≤4 正常延迟性酸痛，5-6 明显，≥7 可能影响训练质量。持续 ≥72h 的严重酸痛提示训练量过大。`,
        cite: 'Cheung K et al. (2003). Delayed onset muscle soreness. Sports Medicine 33(2):145-164'
      };
    })();

    // Mood (1-10, higher = better)
    out.mood = (() => {
      if (w.mood == null) return null;
      const v = w.mood;
      const s = Math.round(v / 10 * 100);
      return {
        score: s, value: v, unit: '/10',
        label: '情绪状态',
        good: v >= 6,
        detail: `情绪状态 ${v}/10。≥6 良好，4-5 一般，≤3 低落。持续情绪低落是过度训练综合征的早期信号。`,
        cite: 'Kenttä G et al. (2006). Mood disturbance in overtraining syndrome. Journal of Sports Sciences 24(7):691-698'
      };
    })();

    // Stress (1-10, higher = more stressed)
    out.stress = (() => {
      if (w.stress == null) return null;
      const v = w.stress;
      const s = Math.round((10 - v) / 7 * 100);
      return {
        score: s, value: v, unit: '/10',
        label: '心理压力',
        good: v <= 4,
        detail: `心理压力 ${v}/10。≤4 可控，5-6 中等，≥7 高压。慢性压力升高皮质醇，抑制免疫与恢复。`,
        cite: 'Stults-Kolehmainen EM & Sinha R (2014). Psychological stress and cortisol. Advances in Experimental Medicine and Biology 814:69-97'
      };
    })();

    // ACWR (Acute:Chronic Workload Ratio)
    out.acwr = (() => {
      if (acwr == null || !isFinite(acwr)) return null;
      const v = acwr;
      let s;
      if (v >= 0.8 && v <= 1.3) s = 100;
      else if (v < 0.8) s = 60;
      else if (v <= 1.5) s = 50;
      else s = 15;
      return {
        score: s, value: v.toFixed(2), unit: '',
        label: 'ACWR 负荷比',
        good: v >= 0.8 && v <= 1.3,
        detail: `ACWR = ${v.toFixed(2)}（近 7 日负荷 ÷ 近 28 日均值）。0.8–1.3 为安全区；>1.5 非接触软组织损伤风险升高 2–4 倍。基于 Banister 模型：急性负荷=疲劳分量，慢性负荷=体能分量。`,
        cite: 'Gabbett TJ (2016). The training-injury prevention paradox. Br J Sports Med 50(5):273-280'
      };
    })();

    return out;
  }

  // Overall readiness score = arithmetic mean of available dimension scores
  function overallScore(dims) {
    const vals = Object.values(dims).filter((d) => d && d.score != null).map((d) => d.score);
    if (!vals.length) return null;
    return Math.round(U.avg(vals));
  }

  function scoreColor(s) {
    if (s >= 80) return 'var(--color-success)';
    if (s >= 60) return 'var(--color-warning)';
    return 'var(--color-danger)';
  }

  function scoreLabel(s) {
    if (s == null) return '暂无数据';
    if (s >= 80) return '高准备';
    if (s >= 60) return '正常';
    if (s >= 40) return '偏低';
    return '低准备';
  }

  // Dimension card with progress bar + 30-day mini trend chart
  // Mini circular gauge SVG (0-100 score)
  function gaugeSvg(score, color, size = 56) {
    const r = size / 2 - 5;
    const c = 2 * Math.PI * r;
    const dash = (score / 100) * c;
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="flex-shrink:0">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="color-mix(in oklch,var(--color-ink),.1)" stroke-width="5"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size/2} ${size/2})" style="transition:stroke-dasharray .6s ease"/>
      <text x="${size/2}" y="${size/2+4}" text-anchor="middle" font-size="16" font-weight="800" fill="${color}">${Math.round(score)}</text>
    </svg>`;
  }

  function dimCard(key, d) {
    if (!d) return '';
    const col = scoreColor(d.score);
    const statusHtml = d.warn === 'red'
      ? '<span class="rd-dim-status" style="color:var(--color-danger)">🔴 红警 · 仅低强度</span>'
      : d.warn === 'yellow'
        ? '<span class="rd-dim-status" style="color:var(--color-warning)">🟡 黄警 · 建议减量</span>'
        : `<span class="rd-dim-status" style="color:${d.good ? 'var(--color-success)' : 'var(--color-danger)'}">${d.good ? '✓ 达标' : '⚠ 需关注'}</span>`;
    return `<div class="rd-dim">
      <div class="rd-dim-head" style="align-items:center">
        ${gaugeSvg(d.score, col)}
        <div class="rd-dim-meta">
          <span class="rd-dim-name">${d.label}</span>
          <span class="rd-dim-val" style="color:${col}">${d.value}<small>${d.unit}</small></span>
          ${statusHtml}
        </div>
      </div>
      <div class="rd-mini" id="rdMini-${key}"></div>
      <details class="rd-detail">
        <summary>算法与文献</summary>
        <p>${d.detail}</p>
        <p class="rd-cite">📖 ${d.cite}</p>
      </details>
    </div>`;
  }

  // Field help text for the entry dialog
  const FIELD_HELP = {
    sleepHours: { label: '睡眠时长', help: '夜间总睡眠时长（小时）。运动员推荐 7-9h。<br>算法：<7h 扣分，<6h 大幅扣分。' },
    sleepEff: { label: '睡眠效率', help: '实际睡眠时间 ÷ 在床上时间 × 100%。<br>≥85% 优质，<80% 睡眠质量差。' },
    hrv: { label: 'HRV', help: '心率变异性 rMSSD（ms）。晨起静息测量。<br>≥70ms 优秀，<30ms 过度疲劳风险。' },
    rhr: { label: '静息心率', help: '晨起静息心率（bpm）。较基线升高 ≥5bpm 提示恢复不足。' },
    fatigue: { label: '主观疲劳', help: '1-10 分。1=完全恢复，10=极度疲劳。<br>≤4 良好，≥7 偏高。' },
    soreness: { label: '肌肉酸痛', help: '1-10 分。1=无酸痛，10=极度酸痛。<br>持续 ≥72h 提示训练量过大。' },
    mood: { label: '情绪', help: '1-10 分。1=低落，10=愉悦。<br>持续低落是过度训练早期信号。' },
    stress: { label: '压力', help: '1-10 分。1=无压力，10=极大压力。<br>慢性压力抑制恢复。' }
  };

  // Entry dialog for today's wellness data
  function entryDialog(ath) {
    if (!ath) return;
    const w = Store.wellnessAt(ath.id, state.date) || {};
    const fields = ['sleepHours', 'sleepEff', 'hrv', 'rhr', 'fatigue', 'soreness', 'mood', 'stress'];
    const rows = fields.map((k) => {
      const fh = FIELD_HELP[k];
      const val = w[k] ?? '';
      const isSlider = ['fatigue', 'soreness', 'mood', 'stress'].includes(k);
      let input;
      if (isSlider) {
        input = `<input type="range" min="1" max="10" step="1" value="${val || 5}" data-k="${k}" class="rd-slider"><span class="rd-slider-val" data-for="${k}">${val || 5}</span>`;
      } else {
        const ph = { sleepHours: '如 7.5', sleepEff: '如 88', hrv: '如 65', rhr: '如 58' }[k] || '';
        input = `<input type="number" step="0.1" value="${val}" placeholder="${ph}" data-k="${k}" style="width:120px">`;
      }
      return `<div class="rd-field">
        <label>${fh.label} <button type="button" class="rd-help" data-help="${k}">?</button></label>
        ${input}
      </div>`;
    }).join('');
    const html = `<div class="rd-entry">
      <h3>录入准备状态 · ${U.esc(ath.name)} · ${U.md(state.date)}</h3>
      ${rows}
      <div class="rd-field"><label>备注</label><textarea data-k="note" rows="2" placeholder="可选">${w.note || ''}</textarea></div>
      <div class="rd-actions">
        <button class="btn" id="rdSave">保存</button>
        <button class="btn ghost" id="rdCancel">取消</button>
      </div>
    </div>`;
    const closeModal = UI.modal({ title: '准备状态录入', body: html, wide: true, onMount: (ov) => {
      ov.querySelectorAll('.rd-slider').forEach((sl) => {
        sl.oninput = () => { ov.querySelector(`.rd-slider-val[data-for="${sl.dataset.k}"]`).textContent = sl.value; };
      });
      ov.querySelectorAll('.rd-help').forEach((b) => {
        b.onclick = () => {
          const fh = FIELD_HELP[b.dataset.help];
          UI.modal({ title: '说明', body: `<p><b>${fh.label}</b></p><p>${fh.help}</p>` });
        };
      });
      ov.querySelector('#rdCancel').onclick = () => closeModal();
      ov.querySelector('#rdSave').onclick = () => {
        const rec = Object.assign({}, w, { id: w.id || U.uid(), athleteId: ath.id, date: state.date });
        fields.forEach((k) => {
          const el = ov.querySelector(`[data-k="${k}"]`);
          if (el) {
            const v = el.value.trim();
            rec[k] = v === '' ? null : Number(v);
          }
        });
        const noteEl = ov.querySelector('[data-k="note"]');
        rec.note = noteEl ? noteEl.value.trim() : '';
        const idx = Store.data.wellness.findIndex((x) => x.id === rec.id);
        if (idx >= 0) Store.data.wellness[idx] = rec;
        else Store.data.wellness.push(rec);
        Store.save();
        closeModal();
        UI.toast('已保存', 'ok');
        renderBody();
      };
    }});
  }

  // Mini sparkline: 30-day trend of actual metric values
  function initMiniSpark(box, data, color, unit, refLines) {
    if (!box || !data || data.length < 2) { box.innerHTML = '<p style="font-size:10px;color:var(--color-ink-muted);text-align:center;padding-top:28px">数据不足</p>'; return; }
    const c = UI.cssVar(color);
    const vals = data.filter((v) => v != null && !isNaN(v));
    const refVals = (refLines || []).map((r) => r.y);
    const allVals = vals.concat(refVals);
    const min = allVals.length ? Math.min(...allVals) : 0;
    const max = allVals.length ? Math.max(...allVals) : 100;
    const pad = (max - min) * 0.15 || 1;
    const chart = UI.chart(box);
    chart.setOption({
      grid: { left: 4, right: 4, top: 12, bottom: 18 },
      tooltip: Object.assign({}, UI.tooltipCommon, { trigger: 'axis', formatter: (ps) => { const p = Array.isArray(ps) ? ps[0] : ps; return `<b>${p.value}</b> ${unit || ''}`; } }),
      xAxis: { type: 'category', show: false, data: data.map((_, i) => i) },
      yAxis: { type: 'value', show: false, min: min - pad, max: max + pad },
      series: [{
        type: 'line', data, smooth: true, symbol: 'circle', symbolSize: 4, showSymbol: data.length <= 10,
        connectNulls: true,
        lineStyle: { width: 2.5, color: c },
        itemStyle: { color: c },
        areaStyle: { color: UI.tint(c, .2) },
        markLine: (refLines && refLines.length) ? {
          silent: true, symbol: 'none',
          label: { show: true, fontSize: 9, position: 'insideEndTop', formatter: (p) => p.name },
          data: refLines.map((r) => ({ yAxis: r.y, name: r.name || '', lineStyle: { color: r.color, type: r.type || 'dashed', width: 1.2 }, label: { color: r.color } }))
        } : undefined
      }]
    });
  }

  // 14-day readiness trend chart
  function initTrendChart(box, athId) {
    if (!box) return;
    const wells = Store.wellnessOf(athId).slice(0, 14).reverse();
    if (wells.length < 2) { box.innerHTML = '<p class="hint" style="text-align:center;padding:30px">至少需要 2 天数据才能绘制趋势</p>'; return; }
    const days = wells.map((w) => w.date);
    const scores = wells.map((w) => Store.readinessScore(w, null));
    const fatigue = wells.map((w) => w.fatigue);
    const hrv = wells.map((w) => w.hrv);
    const sleep = wells.map((w) => w.sleepHours);
    const cPrimary = UI.cssVar('var(--color-primary)');
    const cDanger = UI.cssVar('var(--color-danger)');
    const cSuccess = UI.cssVar('var(--color-success)');
    const cInfo = UI.cssVar('var(--color-info)');
    const cInk = UI.cssVar('var(--color-ink-muted)');
    const chart = UI.chart(box);
    chart.setOption({
      grid: { left: 52, right: 56, top: 40, bottom: 36 },
      tooltip: Object.assign({ trigger: 'axis', axisPointer: { type: 'cross', lineStyle: { color: UI.tint(cInk, .3) } } }, UI.tooltipCommon),
      legend: { textStyle: { color: cInk, fontSize: 11 }, top: 6, right: 12, itemWidth: 16, itemHeight: 10, itemGap: 16 },
      xAxis: { type: 'category', data: days, boundaryGap: false, axisLabel: Object.assign({ formatter: (v) => U.md(v) }, UI.axisCommon.axisLabel) },
      yAxis: [
        Object.assign({ type: 'value', name: '准备度', min: 0, max: 100, nameTextStyle: { color: cInk, fontSize: 10 }, nameGap: 30 }, UI.axisCommon),
        Object.assign({ type: 'value', name: 'HRV / 疲劳', min: 0, nameTextStyle: { color: cInk, fontSize: 10 }, nameGap: 30 }, UI.axisCommon)
      ],
      series: [
        {
          name: '准备度', type: 'line', data: scores, smooth: true, symbol: 'circle', symbolSize: 6,
          lineStyle: { width: 3, color: cPrimary },
          itemStyle: { color: cPrimary, borderColor: '#fff', borderWidth: 1.5 },
          areaStyle: { color: UI.tint(cPrimary, .18) }
        },
        {
          name: '疲劳', type: 'line', yAxisIndex: 1, data: fatigue, smooth: true, symbol: 'circle', symbolSize: 5,
          lineStyle: { width: 2, color: cDanger, type: 'dashed' },
          itemStyle: { color: cDanger }
        },
        {
          name: 'HRV', type: 'line', yAxisIndex: 1, data: hrv, smooth: true, symbol: 'circle', symbolSize: 5,
          lineStyle: { width: 2, color: cSuccess },
          itemStyle: { color: cSuccess }
        },
        {
          name: '睡眠', type: 'bar', data: sleep, barWidth: '38%',
          itemStyle: { color: UI.tint(cInfo, .85), borderRadius: [3, 3, 0, 0] }
        }
      ]
    });
  }

  function renderBody() {
    const view = document.getElementById('view');
    if (!view) return;
    const body = view.querySelector('#rdBody');
    const aths = Store.data.athletes;
    const ath = aths.find((a) => a.id === state.athleteId);
    if (!ath) { body.innerHTML = '<p class="hint" style="padding:40px;text-align:center">暂无运动员</p>'; return; }
    const w = Store.wellnessAt(ath.id, state.date);
    // ACWR: consistent with Load Management page (112-day window, load != null check)
    let acwr = null;
    try {
      const es = (Store.data.loadEntries || []).filter((e) => e.athleteId === ath.id).map((e) => {
        const load = e.load != null ? Number(e.load) : (Number(e.rpe) || 0) * (Number(e.duration) || 0);
        return Object.assign({}, e, { load: Number.isFinite(load) ? load : 0 });
      }).sort((a, b) => a.date.localeCompare(b.date));
      const s = Calc.dailySeries(es, U.addDays(state.date, -111), state.date);
      if (s.length) acwr = Calc.acwr(s, s.length - 1);
    } catch(e) { acwr = null; }
    const dims = dimScores(w, acwr, hrvBaseline(ath.id, state.date));
    const overall = overallScore(dims);

    // HRV alert banner (research warning rules: z<-1 yellow, z<-2 red, 3-day streak → coach review)
    const hrvD = dims.hrv;
    let hrvAlert = '';
    if (hrvD && hrvD.warn) {
      const isRed = hrvD.warn === 'red';
      const base = hrvBaseline(ath.id, state.date);
      hrvAlert = `<div class="rd-hrv-alert" style="border-left:4px solid ${isRed ? 'var(--color-danger)' : 'var(--color-warning)'};background:${isRed ? 'color-mix(in oklch,var(--color-danger) 8%,transparent)' : 'color-mix(in oklch,var(--color-warning) 8%,transparent)'};padding:12px 16px;border-radius:8px;margin-bottom:14px">
        <b style="color:${isRed ? 'var(--color-danger)' : 'var(--color-warning)'}">${isRed ? '🔴 HRV 红色预警' : '🟡 HRV 黄色预警'}</b>
        <span style="margin-left:10px">今日 HRV ${hrvD.value}ms，低于个人基线 ${base.mean ? base.mean.toFixed(1) : '—'}ms（z = ${hrvD.z > 0 ? '+' : ''}${hrvD.z.toFixed(2)}σ）</span>
        <div class="hint" style="margin-top:4px">${isRed ? '建议：仅进行技术/低强度训练，优先恢复' : '建议：降低当日训练强度或增加恢复'}${base.streak >= 3 ? ` · <b>已连续 ${base.streak} 天低于 −1σ，建议教练审核</b>` : ''}</div>
      </div>`;
    }

    // 30-day history for mini sparklines — track actual metric values, not scores
    const hist = Store.wellnessOf(ath.id).slice(0, 30).reverse();
    const dimHist = (key) => hist.map((hw) => {
      const hd = dimScores(hw, null);
      if (key === 'acwr') {
        let a = null;
        try {
          const aes = (Store.data.loadEntries || []).filter((e) => e.athleteId === ath.id).map((e) => {
            const load = e.load != null ? Number(e.load) : (Number(e.rpe) || 0) * (Number(e.duration) || 0);
            return Object.assign({}, e, { load: Number.isFinite(load) ? load : 0 });
          }).sort((a,b)=>a.date.localeCompare(b.date));
          const ss = Calc.dailySeries(aes, U.addDays(hw.date, -111), hw.date);
          a = ss.length ? Calc.acwr(ss, ss.length - 1) : null;
        } catch(e) { a = null; }
        return a != null ? +a.toFixed(2) : null;
      }
      if (!hd[key]) return null;
      const v = hd[key].value;
      return v != null && v !== '' ? Number(v) : null;
    });

    const dimList = ['hrv', 'sleep', 'fatigue', 'soreness', 'mood', 'stress', 'acwr'];
    const dimCards = dimList.map((k) => dimCard(k, dims[k])).filter(Boolean).join('');

    body.innerHTML = `
      <div class="rd-overall ${overall != null ? (overall >= 80 ? 'good' : overall >= 60 ? 'mid' : 'bad') : 'none'}" style="--sc:${scoreColor(overall)}">
        <svg viewBox="0 0 120 120" class="rd-ring-big">
          <circle cx="60" cy="60" r="50" fill="none" stroke="color-mix(in oklch,var(--color-ink),.1)" stroke-width="10"/>
          ${overall != null ? `<circle cx="60" cy="60" r="50" fill="none" stroke="var(--sc)" stroke-width="10" stroke-linecap="round"
            stroke-dasharray="${(overall / 100 * 314.16).toFixed(1)} 314.16" transform="rotate(-90 60 60)"/>` : ''}
          <text x="60" y="58" text-anchor="middle" font-size="30" font-weight="800" fill="var(--sc)">${overall ?? '—'}</text>
          <text x="60" y="76" text-anchor="middle" font-size="11" fill="var(--color-ink-muted)">${scoreLabel(overall)}</text>
        </svg>
        <div class="rd-overall-info">
          <div class="rd-overall-label">综合准备度评分</div>
          <div class="rd-overall-sub">${U.esc(ath.name)} · ${U.md(state.date)}</div>
          <div class="rd-overall-desc">综合 HRV / 睡眠 / 疲劳 / 酸痛 / 情绪 / 压力 / ACWR 七维度等权平均</div>
        </div>
      </div>

      ${hrvAlert}

      <div class="rd-grid">${dimCards || '<p class="hint" style="grid-column:1/-1;text-align:center;padding:30px">点击右上角「录入」开始记录今日准备状态</p>'}</div>

      <div class="card">
        <div class="chart-cap">14 日准备状态趋势</div>
        <div class="chart" id="rdTrend" style="height:300px"></div>
      </div>

      <div class="card rd-algo">
        <div class="card-title"><h3>评分算法说明</h3></div>
        <p><b>综合准备度评分（0-100）</b> = 各维度（HRV / 睡眠 / 疲劳 / 酸痛 / 情绪 / 压力 / ACWR）单项得分的算术平均值。每个维度独立换算为 0-100 分，缺失维度不参与平均。</p>
        <p><b>等级划分：</b>≥80 高准备（绿）· 60-79 正常（橙）· <60 低准备（红）。建议低准备日降低训练强度或安排主动恢复。</p>
        <p class="rd-cite">综合模型参考：Saunders B et al. (2018). A brief review of subjective wellbeing questionnaires in athletes. Int J Sports Physiol Perform；WHOOP / Oura 商用 Readiness 模型学术验证（Halson SL, 2014）</p>
      </div>
    `;

    UI.disposeCharts();
    dimList.forEach((k) => {
      if (!dims[k]) return;
      const box = body.querySelector(`#rdMini-${k}`);
      if (!box) return;
      // HRV card: overlay individual baseline mean / −1σ / −2σ reference lines
      let refLines = null;
      if (k === 'hrv') {
        const base = hrvBaseline(ath.id, state.date);
        if (base.n >= 4 && base.sd > 0) {
          refLines = [
            { y: +base.mean.toFixed(1), name: '基线', color: UI.cssVar('var(--color-ink-muted)') },
            { y: +(base.mean - base.sd).toFixed(1), name: '−1σ', color: UI.cssVar('var(--color-warning)') },
            { y: +(base.mean - 2 * base.sd).toFixed(1), name: '−2σ', color: UI.cssVar('var(--color-danger)') }
          ];
        }
      }
      initMiniSpark(box, dimHist(k), scoreColor(dims[k].score), dims[k].unit, refLines);
    });
    initTrendChart(body.querySelector('#rdTrend'), ath.id);
  }

  function mount(view) {
    state.athleteId = Store.data.athletes[0]?.id || null;
    const aths = Store.data.athletes;
    view.innerHTML = `
      <div class="rd-wrap">
        <div class="rd-head">
          <div class="row" style="gap:10px;align-items:center">
            <select id="rdAth" class="sel">${aths.map((a) => `<option value="${a.id}" ${a.id === state.athleteId ? 'selected' : ''}>${U.esc(a.name)}</option>`).join('')}</select>
            <input type="date" id="rdDate" value="${state.date}" class="inp">
          </div>
          <div class="row" style="gap:8px">
            <button class="btn" id="rdEntry">录入</button>
            <button class="btn ghost" id="rdHistory">历史</button>
          </div>
        </div>
        <div id="rdBody"></div>
      </div>
    `;

    const rdAth = view.querySelector('#rdAth');
    const rdDate = view.querySelector('#rdDate');
    const rdEntry = view.querySelector('#rdEntry');
    const rdHistory = view.querySelector('#rdHistory');

    rdAth.onchange = (e) => { state.athleteId = e.target.value; renderBody(); };
    rdDate.onchange = (e) => { state.date = e.target.value; renderBody(); };
    rdEntry.onclick = () => entryDialog(aths.find((a) => a.id === state.athleteId));
    rdHistory.onclick = () => { location.hash = '#/profile'; };

    renderBody();
  }

  return { mount };
})();
