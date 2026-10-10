// 运动员档案 · 教练工作台：左侧名单选择，右侧=基本信息 + 统一体能数据源（体能分析全部在 KPI 分析页 Views.kpi）
// 1RM 一律按运动员测定（测试估算 / 手动录入），不设全队默认
// 分析框架参考：《NSCA-CPSS 美国国家体能协会运动表现与科学训练师认证指南》第5章 KPI · 第6章 建档与基准测试
Views.profile = (() => {
  const state = { athleteId: null, srcDate: null, rmCat: null, rmDate: null };

  // ---------- 基础数据（运动员归属训练计划：档案只显示当前计划名单，不与其他计划共享） ----------
  function curMacro() { return Store.activeMacro(); }
  function planAths() {
    const mac = curMacro();
    return mac ? Store.data.athletes.filter((a) => a.macroId === mac.id) : [];
  }
  function rmCount(aid) {
    const rec = (Store.data.athleteRm || {})[aid];
    return rec ? Object.keys(rec).filter((k) => rec[k] && rec[k].value).length : 0;
  }

  // ---------- 添加/编辑运动员（归属当前训练计划：无需选项目/周期，自动绑定） ----------
  function athleteDialog(ath) {
    const mac = curMacro();
    // 团队球类项目：位置使用下拉枚举（+自定义兜底）；个人项目不显示位置字段
    const positions = mac ? Sports.positionsOf(mac.sport) : null;
    const curPos = (ath && ath.position) || '';
    const posCustom = positions && curPos && !positions.includes(curPos) ? curPos : '';
    UI.modal({
      title: ath ? '编辑运动员' : '添加运动员',
      body: `
        <div class="form-grid">
          <div class="field full">
            <label>头像</label>
            <div class="avatar-uploader">
              <span class="avatar" id="auAvatar" title="点击上传头像"></span>
              <div class="au-meta">
                <div class="au-actions">
                  <button class="btn sm ghost" id="auPick" type="button">上传头像</button>
                  <button class="btn sm ghost" id="auRemove" type="button">移除</button>
                </div>
                <span class="hint au-tip">支持 JPG / PNG，将自动裁剪为正方形小图，仅保存在本机数据中</span>
              </div>
              <input type="file" id="auFile" accept="image/*" style="display:none">
            </div>
          </div>
          <div class="field full"><label>姓名 *</label><input class="ipt" id="fName" value="${U.esc(ath ? ath.name : '')}" placeholder="请输入姓名"></div>
          <div class="field"><label>性别</label><select class="sel" id="fGender"><option ${ath && ath.gender === '男' ? 'selected' : ''}>男</option><option ${ath && ath.gender === '女' ? 'selected' : ''}>女</option></select></div>
          <div class="field"><label>出生日期</label><input type="date" class="ipt" id="fBirth" value="${ath && ath.birth ? ath.birth : ''}"></div>
          ${positions ? `
          <div class="field"><label>位置</label>
            <select class="sel" id="fPos">
              <option value="">— 请选择 —</option>
              ${positions.map((p) => `<option ${curPos === p && !posCustom ? 'selected' : ''}>${U.esc(p)}</option>`).join('')}
              <option value="__custom__" ${posCustom ? 'selected' : ''}>自定义…</option>
            </select>
          </div>
          <div class="field" id="fPosCustomWrap" style="${posCustom ? '' : 'display:none'}"><label>自定义位置</label><input class="ipt" id="fPosCustom" value="${U.esc(posCustom)}" placeholder="如：第六人 / 双能卫"></div>` : ''}
          <div class="field full"><label>备注</label><input class="ipt" id="fNote" value="${U.esc(ath ? ath.note : '')}"></div>
        </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        // 团队项目：「自定义…」位置展开自由输入框
        const posSel = ov.querySelector('#fPos');
        const posWrap = ov.querySelector('#fPosCustomWrap');
        if (posSel) posSel.onchange = () => { posWrap.style.display = posSel.value === '__custom__' ? '' : 'none'; };
        // 头像草稿：初始为现有头像；选图→压缩 dataURL；移除→null（保存时落库）
        let avatarDraft = ath && ath.avatar ? ath.avatar : null;
        const fileInp = ov.querySelector('#auFile');
        const pick = () => fileInp.click();
        // 占位 #auAvatar 常驻文档，paint 只刷新 class/内容（避免 outerHTML 替换后节点游离）
        const paint = () => {
          const b = ov.querySelector('#auAvatar');
          const nm = ov.querySelector('#fName').value.trim() || '运动员';
          b.className = 'avatar' + (avatarDraft ? ' has-img' : '');
          b.innerHTML = (avatarDraft ? `<img src="${avatarDraft}" alt="">` : U.esc(nm[0])) + '<span class="cam">更换</span>';
          b.onclick = pick;
          ov.querySelector('#auRemove').style.visibility = avatarDraft ? 'visible' : 'hidden';
        };
        const onFile = () => {
          const f = fileInp.files && fileInp.files[0];
          if (!f) return;
          U.readAvatar(f).then((url) => { avatarDraft = url; paint(); })
            .catch((e) => UI.toast(e.message || '头像处理失败', 'err'));
          fileInp.value = '';
        };
        fileInp.onchange = onFile;
        ov.querySelector('#auPick').onclick = pick;
        ov.querySelector('#auRemove').onclick = () => { avatarDraft = null; paint(); };
        paint();

        ov.querySelector('[data-ok]').onclick = () => {
          const name = ov.querySelector('#fName').value.trim();
          if (!name) { UI.toast('请填写姓名', 'err'); return; }
          // 位置：标准枚举直取；自定义取输入框；个人项目（无下拉）保留原值
          let position = ath ? (ath.position || '') : '';
          if (posSel) {
            position = posSel.value === '__custom__' ? ov.querySelector('#fPosCustom').value.trim() : posSel.value;
          }
          const base = {
            name, gender: ov.querySelector('#fGender').value,
            birth: ov.querySelector('#fBirth').value,
            position,
            note: ov.querySelector('#fNote').value.trim(),
            avatar: avatarDraft || ''
          };
          if (ath) Object.assign(ath, base);
          else {
            const obj = Object.assign({ id: U.uid('ath'), macroId: mac.id, sport: mac.sport, position: '', note: '', avatar: '' }, base);
            Store.data.athletes.push(obj);
            state.athleteId = obj.id;   // 新建后自动选中，便于紧接着录入 1RM / 体能测试
          }
          Store.save(); close(); mount(); UI.toast('已保存', 'ok');
        };
      }
    });
  }

  function delAthlete(a) {
    UI.confirm(`删除运动员「${U.esc(a.name)}」？其负荷记录、参训记录、1RM、测试记录和体能档案将一并清除。`, () => {
      const aid = a.id;
      const aidSet = new Set([aid]);
      Store.data.loadEntries = Store.data.loadEntries.filter((l) => l.athleteId !== aid);
      Store.data.sessions = (Store.data.sessions || []).map((s) => {
        const next = Object.assign({}, s, {
          athletes: (s.athletes || []).filter((id) => !aidSet.has(id))
        });
        if (next.results && typeof next.results === 'object') delete next.results[aid];
        if (next.athSrpe && typeof next.athSrpe === 'object') delete next.athSrpe[aid];
        return next;
      });
      Store.data.macros.forEach((m) => { m.athletes = (m.athletes || []).filter((id) => id !== aid); });
      Store.data.mesos.forEach((m) => (m.days || []).forEach((dd) => { dd.athletes = (dd.athletes || []).filter((id) => id !== aid); }));
      Store.data.tests = (Store.data.tests || []).filter((t) => t.athleteId !== aid);
      Store.data.profiles = (Store.data.profiles || []).filter((p) => p.athleteId !== aid);
      if (Store.data.athleteRm) delete Store.data.athleteRm[aid];
      Store.data.athletes = Store.data.athletes.filter((x) => x.id !== aid);
      if (state.athleteId === aid) state.athleteId = null;
      Store.save(); mount(); UI.toast('已删除', 'ok');
    });
  }

  // ---------- FMS 功能性动作筛查（Cook 2010）：7 项动作模式，每项 0-3 分，总分 /21 ----------
  const FMS_TESTS = [
    { key: 'squat', label: '深蹲' },
    { key: 'hurdle', label: '跨栏步', asymm: true },
    { key: 'lunge', label: '直线弓箭步', asymm: true },
    { key: 'shoulder', label: '肩部灵活性', asymm: true },
    { key: 'aslr', label: '主动直腿抬高' },
    { key: 'tspu', label: '躯干稳定俯卧撑' },
    { key: 'rotary', label: '旋转稳定性', asymm: true }
  ];
  function fmsTotal(f) { return f ? FMS_TESTS.reduce((s, t) => s + (f[t.key] || 0), 0) : 0; }
  function fmsRecs(athId, refDate) {
    let list = getProfiles(athId).filter((p) => p.fms && FMS_TESTS.some((t) => p.fms[t.key] != null));
    return refDate ? list.filter((p) => p.date <= refDate) : list;
  }

  // ---------- NSCA 指标定义 ----------
  const METRICS = [
    { key: 'sq', label: '深蹲1RM', unit: 'kg', invert: false, source: '1rm', exName: '颈后深蹲', cat: '力量' },
    { key: 'bp', label: '卧推1RM', unit: 'kg', invert: false, source: '1rm', exName: '平板卧推', cat: '力量' },
    { key: 'dl', label: '硬拉1RM', unit: 'kg', invert: false, source: '1rm', exName: '传统硬拉', cat: '力量' },
    { key: 'cmj', label: '反向纵跳CMJ', unit: 'cm', invert: false, source: 'profile', field: 'cmjHeight', cat: '爆发力' },
    { key: 'imtp', label: 'IMTP峰值', unit: 'N', invert: false, source: 'profile', field: 'imtpPeak', cat: '爆发力' },
    { key: 'sp', label: '20m冲刺', unit: 's', invert: true, source: 'profile', field: 'sprint20m', cat: '速度' },
    { key: 'bj', label: '立定跳远', unit: 'cm', invert: false, source: 'profile', field: 'broadJump', cat: '速度' },
    { key: 'la', label: 'Lane敏捷', unit: 's', invert: true, source: 'profile', field: 'laneAgility', cat: '敏捷' },
    { key: 'rt', label: '反应时', unit: 'ms', invert: true, source: 'profile', field: 'reactionTime', cat: '敏捷' },
    { key: 'pu', label: '引体向上', unit: '次', invert: false, source: 'profile', field: 'pullUpReps', cat: '耐力' },
    { key: 'vj', label: '纵跳', unit: 'cm', invert: false, source: 'profile', field: 'verticalJump', cat: '爆发力' }
  ];

  // 身体成分与平衡稳定指标（档案页录入后自动纳入各数据看板）
  const BODY_METRICS = [
    { key: 'height', label: '身高', unit: 'cm', invert: false, source: 'profile', field: 'height', cat: '身体成分' },
    { key: 'weight', label: '体重', unit: 'kg', invert: false, source: 'profile', field: 'weight', cat: '身体成分' },
    { key: 'bodyFat', label: '体脂率', unit: '%', invert: false, source: 'profile', field: 'bodyFat', cat: '身体成分' },
    { key: 'ybtL', label: 'YBT左腿', unit: '%', invert: false, source: 'profile', field: 'ybtLeft', cat: '平衡稳定' },
    { key: 'ybtR', label: 'YBT右腿', unit: '%', invert: false, source: 'profile', field: 'ybtRight', cat: '平衡稳定' }
  ];

  // 常规体能测试项目库（NSCA/ACSM 体系 + 现代设备化测试）——「添加体能数据」弹窗下拉选择
  // field 存在 = 写入档案固定字段（兼容旧数据与既有指标口径）；无 field = 写入 custom（库名称匹配即自动带上单位/方向/分类，纳入全部分析看板）
  const TEST_LIBRARY = [
    // 爆发力·跳跃
    { name: '反向纵跳CMJ', unit: 'cm', cat: '爆发力', field: 'cmjHeight' },
    { name: '纵跳', unit: 'cm', cat: '爆发力', field: 'verticalJump' },
    { name: '立定跳远', unit: 'cm', cat: '爆发力', field: 'broadJump' },
    { name: '蹲跳 SJ', unit: 'cm', cat: '爆发力' },
    { name: '跳深 DJ（40cm箱）', unit: 'cm', cat: '爆发力' },
    { name: '触地时间', unit: 'ms', invert: true, cat: '爆发力' },
    { name: '反应力量指数 RSI', unit: 'mm/ms', cat: '爆发力' },
    { name: '修正反应力量指数 RSI-mod', unit: 'mm/ms', cat: '爆发力' },
    { name: '立定三级跳', unit: 'm', cat: '爆发力' },
    { name: '单脚跳远·左', unit: 'cm', cat: '爆发力' },
    { name: '单脚跳远·右', unit: 'cm', cat: '爆发力' },
    { name: '连续5次跳', unit: 'm', cat: '爆发力' },
    { name: '药球胸前前抛', unit: 'm', cat: '爆发力' },
    { name: '药球过头后抛', unit: 'm', cat: '爆发力' },
    { name: '药球旋转侧抛·左', unit: 'm', cat: '爆发力' },
    { name: '药球旋转侧抛·右', unit: 'm', cat: '爆发力' },
    { name: '卧推抛掷功率', unit: 'W', cat: '爆发力' },
    // 速度·冲刺
    { name: '20m冲刺', unit: 's', invert: true, cat: '速度', field: 'sprint20m' },
    { name: '5m冲刺', unit: 's', invert: true, cat: '速度' },
    { name: '10m冲刺', unit: 's', invert: true, cat: '速度' },
    { name: '30m冲刺', unit: 's', invert: true, cat: '速度' },
    { name: '40码冲刺', unit: 's', invert: true, cat: '速度' },
    { name: '60m冲刺', unit: 's', invert: true, cat: '速度' },
    { name: '100m冲刺', unit: 's', invert: true, cat: '速度' },
    { name: '最大速度（飞行30m）', unit: 'm/s', cat: '速度' },
    { name: '冲刺衰减率', unit: '%', invert: true, cat: '速度' },
    // 敏捷·变向
    { name: 'Lane敏捷', unit: 's', invert: true, cat: '敏捷', field: 'laneAgility' },
    { name: '505变向·左', unit: 's', invert: true, cat: '敏捷' },
    { name: '505变向·右', unit: 's', invert: true, cat: '敏捷' },
    { name: 'T测试', unit: 's', invert: true, cat: '敏捷' },
    { name: 'Pro敏捷（5-10-5）', unit: 's', invert: true, cat: '敏捷' },
    { name: 'Illinois敏捷测试', unit: 's', invert: true, cat: '敏捷' },
    { name: 'L跑（三锥）', unit: 's', invert: true, cat: '敏捷' },
    { name: '变向损失 COD Deficit', unit: 's', invert: true, cat: '敏捷' },
    { name: '六边形跳', unit: 's', invert: true, cat: '敏捷' },
    // 力量·等长
    { name: 'IMTP峰值力', unit: 'N', cat: '力量测试', field: 'imtpPeak' },
    { name: 'IMTP相对峰值力', unit: 'N/kg', cat: '力量测试' },
    { name: '等长深蹲峰值力', unit: 'N', cat: '力量测试' },
    { name: '握力·左', unit: 'kg', cat: '力量测试' },
    { name: '握力·右', unit: 'kg', cat: '力量测试' },
    { name: '背力', unit: 'kg', cat: '力量测试' },
    { name: 'Nordic腘绳肌离心力量·左', unit: 'N', cat: '力量测试' },
    { name: 'Nordic腘绳肌离心力量·右', unit: 'N', cat: '力量测试' },
    { name: '哥本哈根内收等长力量', unit: 'N', cat: '力量测试' },
    { name: '髋外展等长力量', unit: 'N', cat: '力量测试' },
    { name: '动态力量指数 DSI（SJ/IMTP）', unit: '', cat: '力量测试' },
    { name: 'Keiser 功率', unit: 'W', cat: '力量测试' },
    { name: 'GymAware 平均速度', unit: 'm/s', cat: '力量测试' },
    // 力量耐力
    { name: '引体向上', unit: '次', cat: '力量耐力', field: 'pullUpReps' },
    { name: '俯卧撑（1分钟）', unit: '次', cat: '力量耐力' },
    { name: '仰卧起坐（1分钟）', unit: '次', cat: '力量耐力' },
    { name: '70%1RM 深蹲最大次数', unit: '次', cat: '力量耐力' },
    { name: '卧推最大次数（80kg/225lb）', unit: '次', cat: '力量耐力' },
    { name: '靠墙静蹲', unit: 's', cat: '力量耐力' },
    // 有氧·间歇能力
    { name: 'Yo-Yo 间歇恢复 IR1', unit: 'm', cat: '有氧耐力' },
    { name: 'Yo-Yo 间歇恢复 IR2', unit: 'm', cat: '有氧耐力' },
    { name: '30-15 间歇体能测试 VIFT', unit: 'km/h', cat: '有氧耐力' },
    { name: '20m 折返跑（Beep）', unit: '级', cat: '有氧耐力' },
    { name: '12分钟跑（Cooper）', unit: 'm', cat: '有氧耐力' },
    { name: '最大摄氧量 VO₂max', unit: 'mL/kg/min', cat: '有氧耐力' },
    { name: '最大有氧速度 MAS', unit: 'km/h', cat: '有氧耐力' },
    { name: '3000m跑', unit: 's', invert: true, cat: '有氧耐力' },
    { name: '2km划船', unit: 's', invert: true, cat: '有氧耐力' },
    { name: '乳酸阈速度', unit: 'km/h', cat: '有氧耐力' },
    { name: '血乳酸（峰值）', unit: 'mmol/L', invert: true, cat: '有氧耐力' },
    { name: '1分钟心率恢复', unit: 'bpm', cat: '有氧耐力' },
    // 无氧功率
    { name: 'Wingate 峰值功率', unit: 'W', cat: '无氧功率' },
    { name: 'Wingate 相对峰值功率', unit: 'W/kg', cat: '无氧功率' },
    { name: 'Wingate 平均功率', unit: 'W', cat: '无氧功率' },
    { name: 'Wingate 疲劳指数', unit: '%', invert: true, cat: '无氧功率' },
    { name: 'RAST 重复冲刺总时间', unit: 's', invert: true, cat: '无氧功率' },
    { name: 'RSA（6×30m）平均时间', unit: 's', invert: true, cat: '无氧功率' },
    { name: 'RSA 疲劳递减率', unit: '%', invert: true, cat: '无氧功率' },
    { name: '300m跑', unit: 's', invert: true, cat: '无氧功率' },
    { name: '自行车功体比', unit: 'W/kg', cat: '无氧功率' },
    // 柔韧·灵活
    { name: '坐位体前屈', unit: 'cm', cat: '柔韧' },
    { name: '被动直腿抬高', unit: '°', cat: '柔韧' },
    { name: '踝关节背屈（膝触墙）', unit: 'cm', cat: '柔韧' },
    { name: '肩关节灵活性（Apley）', unit: 'cm', cat: '柔韧' },
    { name: '托马斯测试（髋屈肌）', unit: '°', cat: '柔韧' },
    // 平衡·稳定
    { name: '单腿闭眼站立·左', unit: 's', cat: '平衡稳定' },
    { name: '单腿闭眼站立·右', unit: 's', cat: '平衡稳定' },
    { name: '星形偏移平衡 SEBT', unit: 'cm', cat: '平衡稳定' },
    { name: '平板支撑', unit: 's', cat: '平衡稳定' },
    { name: '侧桥·左', unit: 's', cat: '平衡稳定' },
    { name: '侧桥·右', unit: 's', cat: '平衡稳定' },
    // 反应·神经
    { name: '反应时', unit: 'ms', invert: true, cat: '反应神经', field: 'reactionTime' },
    { name: '选择反应时', unit: 'ms', invert: true, cat: '反应神经' },
    { name: '视觉反应时（BlazePod/FitLight）', unit: 'ms', invert: true, cat: '反应神经' },
    // 身体成分·附加
    { name: '皮褶厚度（7点法）', unit: 'mm', invert: true, cat: '身体成分' },
    { name: '去脂体重', unit: 'kg', cat: '身体成分' },
    { name: '骨骼肌量', unit: 'kg', cat: '身体成分' },
    { name: '上臂围', unit: 'cm', cat: '身体成分' },
    { name: '大腿围', unit: 'cm', cat: '身体成分' },
    // 伤病风险
    { name: 'LESS 落地错误评分', unit: '分', invert: true, cat: '伤病风险' },
    { name: 'NordBord 腘绳肌不对称率', unit: '%', invert: true, cat: '伤病风险' },
    { name: 'GroinBar 内收不对称率', unit: '%', invert: true, cat: '伤病风险' },
    { name: '单腿跳不对称指数', unit: '%', invert: true, cat: '伤病风险' },
    { name: '跳跃落地不对称率', unit: '%', invert: true, cat: '伤病风险' }
  ];
  const libTest = (name) => TEST_LIBRARY.find((t) => t.name === name);

  // ---------- 用户测试项目库：只含用户主动添加的项目（项目库弹窗勾选/自定义、KPI 添加、Excel 导入自动加入） ----------
  // 存于 settings.testItems：[{name, unit, invert, field, special('ybt'|'fms')|null}]——special 标记复合控件（YBT 双腿%、FMS 7 项评分）
  // 不再默认灌入系统内置库：有测试数据的项目由 KPI 实验室按数据自动呈现，空项目不再占位
  function testItems() {
    const s = Store.data.settings;
    if (!Array.isArray(s.testItems)) {
      s.testItems = [];
      Store.persist();
    } else if (!s.testItemsV2) {
      // 一次性迁移：旧版首次访问会把系统库全量灌入（含旧「冠军模型」一键补库的空项目），
      // 只保留其中确有测试数据的项目；用户自创但尚无数据的项目需重新添加
      const dataFields = new Set();
      const dataCustom = new Set();
      let hasFms = false, hasYbt = false;
      const profileFields = new Set([...METRICS, ...BODY_METRICS].filter((m) => m.source === 'profile').map((m) => m.field));
      (Store.data.profiles || []).forEach((p) => {
        if (!p) return;
        profileFields.forEach((f) => { if (p[f] != null && p[f] !== '') dataFields.add(f); });
        (p.custom || []).forEach((c) => { if (c && c.name && c.value != null && c.value !== '') dataCustom.add(c.name); });
        if (p.fms && FMS_TESTS.some((t) => p.fms[t.key] != null)) hasFms = true;
        if (p.ybtLeft != null || p.ybtRight != null) hasYbt = true;
      });
      s.testItems = s.testItems.filter((t) => {
        if (t.special === 'fms') return hasFms;
        if (t.special === 'ybt') return hasYbt;
        if (t.field) return dataFields.has(t.field);
        return dataCustom.has(t.name);
      });
      s.testItemsV2 = true;
      Store.persist();
    }
    return s.testItems;
  }
  function saveTestItems(list) {
    Store.data.settings.testItems = list;
    Store.save();
  }

  // 从单条档案取指标值（profile=固定字段；custom=自定义测试项目按名匹配）
  function profileVal(p, m) {
    if (!p) return null;
    if (m.source === 'custom') {
      const c = (p.custom || []).find((c) => c && c.name === m.field);
      return c && c.value != null ? c.value : null;
    }
    return p[m.field] != null ? p[m.field] : null;
  }

  // 动态指标总表：固定体能指标 + 身体成分/平衡 + 自定义测试项目 + 任意已测动作 1RM（按动作名去重）
  // KPI 看板 / 雷达 / Z 分数 / 纵向追踪 / 团队排名 / 报告统一取本表——设置了任意动作 1RM 或新增体能/自定义数据即自动纳入分析
  function allMetrics() {
    const out = [];
    // 1RM：固定三动作 + athleteRm ∪ tests 中出现过的全部动作，label=动作名（与档案页 1RM 档一致，天然去重）
    const exIds = new Set();
    const rm = Store.data.athleteRm || {};
    Object.keys(rm).forEach((aid) => Object.keys(rm[aid] || {}).forEach((exId) => { if (rm[aid][exId] && rm[aid][exId].value) exIds.add(exId); }));
    (Store.data.tests || []).forEach((t) => { if (t.exerciseId) exIds.add(t.exerciseId); });
    const seen = new Set();
    const pushRm = (exId) => {
      const ex = Store.exercise(exId);
      if (!ex || seen.has(ex.name)) return;
      seen.add(ex.name);
      out.push({ key: 'rm:' + exId, label: ex.name, unit: 'kg', invert: false, source: '1rm', exName: ex.name, cat: '力量（1RM）' });
    };
    METRICS.filter((m) => m.source === '1rm').forEach((m) => {
      const ex = Store.data.exercises.find((e) => e.name === m.exName);
      if (ex) pushRm(ex.id);
    });
    exIds.forEach(pushRm);
    // 体能指标 + 身体成分/平衡稳定
    METRICS.filter((m) => m.source === 'profile').forEach((m) => out.push(m));
    BODY_METRICS.forEach((m) => out.push(m));
    // 自定义测试项目（全部档案中出现过的项目名去重；匹配系统库或用户项目库的自动带上单位/方向/分类）
    const userItems = testItems();
    const cSeen = new Set();
    (Store.data.profiles || []).forEach((p) => (p.custom || []).forEach((c) => {
      if (c && c.name && !cSeen.has(c.name)) {
        cSeen.add(c.name);
        const lib = libTest(c.name);
        const ui = userItems.find((t) => t.name === c.name);
        out.push({ key: 'cu:' + c.name, label: c.name, unit: c.unit || (lib && lib.unit) || (ui && ui.unit) || '', invert: !!(lib ? lib.invert : (ui ? ui.invert : false)), source: 'custom', field: c.name, cat: (lib && lib.cat) || '自定义' });
      }
    }));
    return out;
  }

  // KPI 实验室（自定义分析）专用指标表 = 用户项目库 ∪ 全部档案中实际出现过测试数据的项目：
  // ① 用户库已登记的项目（即使尚无人测过，选中后由算法给出空态提示）；
  // ② 档案里录过值的固定体能/身体成分指标、自定义项目（Excel 导入/手动录入后自动出现，不写死）；
  // ③ 1RM 类按「队里确有有效测定数据」数据驱动出现（有数据才显示）
  function labMetrics() {
    const items = testItems().filter((t) => !t.special);
    const fieldSet = new Set(items.filter((t) => t.field).map((t) => t.field));
    const nameSet = new Set(items.map((t) => t.name));
    // 数据驱动：扫描全部体能档案，收集实际录过值的固定字段与自定义项目名
    const dataFields = new Set();
    const dataCustom = new Set();
    const profileFields = new Set([...METRICS, ...BODY_METRICS].filter((m) => m.source === 'profile').map((m) => m.field));
    (Store.data.profiles || []).forEach((p) => {
      if (!p) return;
      profileFields.forEach((f) => { if (p[f] != null && p[f] !== '') dataFields.add(f); });
      (p.custom || []).forEach((c) => { if (c && c.name && c.value != null && c.value !== '') dataCustom.add(c.name); });
    });
    const rmWithData = new Set();
    const rm = Store.data.athleteRm || {};
    Object.keys(rm).forEach((aid) => Object.keys(rm[aid] || {}).forEach((exId) => {
      if (rm[aid][exId] && rm[aid][exId].value != null) rmWithData.add(exId);
    }));
    const out = allMetrics().filter((m) => {
      if (m.source === '1rm') return rmWithData.has(m.key.slice(3));
      if (m.source === 'profile') return fieldSet.has(m.field) || nameSet.has(m.label) || dataFields.has(m.field);
      if (m.source === 'custom') return nameSet.has(m.label) || dataCustom.has(m.label);
      return false;
    });
    // 补入「库中已登记但尚无任何测试数据」的自定义项目
    const haveCustom = new Set(out.filter((m) => m.source === 'custom').map((m) => m.label));
    items.forEach((t) => {
      if (t.field || haveCustom.has(t.name)) return;
      const lib = libTest(t.name);
      out.push({ key: 'cu:' + t.name, label: t.name, unit: t.unit || (lib && lib.unit) || '', invert: !!(lib ? lib.invert : t.invert), source: 'custom', field: t.name, cat: (lib && lib.cat) || '自定义' });
    });
    return out;
  }

  // 计时类单位（秒/分/毫秒）自动按「越小越好」，其余按「越大越好」——项目库与 KPI 添加项目共用，无需用户选择
  function autoInvert(unit) { return /^(s|sec|secs|second|seconds|min|mins|minute|minutes|ms|秒|分|分钟|毫秒)$/i.test((unit || '').trim()); }

  // 用户手动添加测试项目（KPI 实验室 / 档案页共用）：命中系统库则自动带上库定义（单位/方向/固定字段），否则记为自定义项目（方向按单位自动判定）
  function addTestItem(rawName, rawUnit, invert) {
    const name = String(rawName || '').trim();
    if (!name) return { ok: false, msg: '请填写项目名称' };
    const items = testItems();
    if (items.some((t) => t.name === name)) return { ok: false, msg: '项目库中已存在「' + name + '」' };
    const lib = libTest(name);
    const item = lib
      ? { name, unit: lib.unit || '', invert: !!lib.invert, field: lib.field || null, special: null }
      : { name, unit: String(rawUnit || '').trim(), invert: invert == null ? autoInvert(rawUnit) : !!invert, field: null, special: null };
    items.push(item);
    saveTestItems(items);
    return { ok: true, item };
  }

  // refDate：分析看板所选时期——取该日期前（含）最近一次记录，实现"不同时期"对比
  function getMetric(athId, m, refDate) {
    if (m.source === '1rm') {
      const ex = Store.data.exercises.find((e) => e.name === m.exName);
      if (!ex) return null;
      const rm = Store.athRm(athId, ex.id);
      if (!rm) return null;
      if (refDate) {
        const past = (rm.history || []).filter((h) => (h.date || '') <= refDate);
        return past.length ? past[past.length - 1].value : null;   // 该时点尚未测定
      }
      // 无时期筛选=最新记录：训练课估算等追加记录优先（基准值不被覆盖，但最新记录参与分析）
      const h = rm.history || [];
      return h.length ? h[h.length - 1].value : rm.value;
    }
    let recs = (Store.data.profiles || []).filter((p) => p.athleteId === athId).sort((a, b) => b.date.localeCompare(a.date));
    if (refDate) recs = recs.filter((p) => p.date <= refDate);
    const rec = recs.find((p) => profileVal(p, m) != null);   // 最近一次含该指标的记录（profile/custom 通用）
    return rec ? profileVal(rec, m) : null;
  }
  function teamValues(aths, m, refDate) { return aths.map((a) => getMetric(a.id, m, refDate)).filter((v) => v != null); }
  function metricZ(athId, aths, m, refDate) {
    const val = getMetric(athId, m, refDate); const arr = teamValues(aths, m, refDate);
    if (val == null || arr.length < 2) return 0;
    let z = Calc.zScore(val, arr); return m.invert ? -z : z;
  }
  function metricPct(athId, aths, m, refDate) {
    const val = getMetric(athId, m, refDate); const arr = teamValues(aths, m, refDate);
    if (val == null || !arr.length) return 50;
    const below = m.invert ? arr.filter((x) => x > val).length : arr.filter((x) => x < val).length;
    return Math.round((below / arr.length) * 100);
  }
  function getProfiles(athId, refDate) {
    let list = (Store.data.profiles || []).filter((p) => p.athleteId === athId).sort((a, b) => a.date.localeCompare(b.date));
    return refDate ? list.filter((p) => p.date <= refDate) : list;
  }
  // 运动员全部数据时点（体能档案日期 ∪ 1RM 历史日期），供分析看板时期筛选
  function dataDates(athId) {
    const set = new Set();
    getProfiles(athId).forEach((p) => set.add(p.date));
    const rm = (Store.data.athleteRm || {})[athId] || {};
    Object.keys(rm).forEach((exId) => ((rm[exId] && rm[exId].history) || []).forEach((h) => { if (h.date) set.add(h.date); }));
    return [...set].sort();
  }
  // 1RM 在 refDate 时点的快照（按 history 过滤；refDate 为空=最新）——分析看板按时期取值
  function rmAsOf(athId, refDate) {
    const rec = (Store.data.athleteRm || {})[athId] || {};
    const out = {};
    Object.keys(rec).forEach((exId) => {
      const r = rec[exId];
      if (!r || !r.value) return;
      if (!refDate) { out[exId] = r; return; }
      const past = (r.history || []).filter((h) => (h.date || '') <= refDate);
      if (past.length) {
        const last = past[past.length - 1];
        out[exId] = { value: last.value, date: last.date, testDate: last.date, history: past };
      }
    });
    return out;
  }

  // ---------- 体能测试项目库配置：多选系统库项目 + 添加自定义项目 ----------
  function testLibDialog() {
    const items = testItems();
    const customItems = items.filter((t) => !t.special && !libTest(t.name));
    const sysSelected = new Set(items.filter((t) => t.special || libTest(t.name)).map((t) => t.special ? t.special : t.name));
    UI.modal({
      title: '体能测试项目库',
      body: `
        <div class="hint" style="margin-bottom:10px">勾选下方测试项目，「添加体能数据」弹窗中将直接显示这些输入项；库中未涵盖的可自行添加自定义项目。FMS / YBT 为复合评分项目，勾选后显示专用评分控件。</div>
        <div style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:10px">
          ${(() => {
            const groups = {};
            TEST_LIBRARY.forEach((t) => { (groups[t.cat] = groups[t.cat] || []).push(t); });
            return Object.entries(groups).map(([cat, arr]) => `
              <div style="margin:8px 0 4px;font-size:12px;color:var(--muted);font-weight:600">${U.esc(cat)}</div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px 12px">
                ${arr.map((t) => `<label style="display:flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer;padding:2px 0"><input type="checkbox" class="tlSys" value="${U.esc(t.name)}" ${sysSelected.has(t.name) ? 'checked' : ''} style="margin:0">${U.esc(t.name)}<span class="hint" style="font-size:11px">${U.esc(t.unit)}</span></label>`).join('')}
              </div>`).join('');
          })()}
          <div style="margin:10px 0 4px;font-size:12px;color:var(--muted);font-weight:600">复合评分项目</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px 12px">
            <label style="display:flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer;padding:2px 0"><input type="checkbox" class="tlSpecial" value="fms" ${sysSelected.has('fms') ? 'checked' : ''} style="margin:0">FMS 功能性动作筛查<span class="hint" style="font-size:11px">7 项 0-3 分</span></label>
            <label style="display:flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer;padding:2px 0"><input type="checkbox" class="tlSpecial" value="ybt" ${sysSelected.has('ybt') ? 'checked' : ''} style="margin:0">YBT 下肢动态平衡<span class="hint" style="font-size:11px">双腿 %</span></label>
          </div>
        </div>
        <div class="row" style="gap:6px;margin-bottom:8px">
          <input class="ipt" id="tlNewName" placeholder="自定义项目名称" style="flex:2;min-width:0">
          <input class="ipt" id="tlNewUnit" placeholder="单位" style="flex:1;min-width:0" title="单位（秒/分/毫秒等计时单位自动按「越小越好」统计，其余按「越大越好」）">
          <button class="btn sm ghost" id="tlAddCustom" type="button">＋ 添加自定义</button>
        </div>
        <p class="hint" style="font-size:11px;margin:0 0 6px;line-height:1.6">数值方向由系统按单位自动判定：计时类（秒/分/分钟/毫秒）→ 越小越好，其余 → 越大越好。</p>
        <div id="tlCustomList" style="display:flex;flex-direction:column;gap:4px">
          ${customItems.map((t) => `<div class="row tlCustomRow" data-name="${U.esc(t.name)}" style="gap:6px;align-items:center"><input class="ipt" style="flex:1.5;min-width:0" value="${U.esc(t.name)}" readonly><input class="ipt tlCU" style="flex:.6;min-width:0" value="${U.esc(t.unit)}" placeholder="单位"><span class="hint tlCDirTag" style="flex:.9;min-width:0;font-size:11.5px">${autoInvert(t.unit) ? '越小越好' : '越大越好'}</span><button class="btn danger sm tlCDel" type="button" title="删除">✕</button></div>`).join('')}
        </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存</button>`,
      onMount(ov, close) {
        const cList = ov.querySelector('#tlCustomList');
        const dirTag = (unit) => (autoInvert(unit) ? '越小越好' : '越大越好');
        const addCustomRow = (name = '', unit = '') => {
          const row = document.createElement('div');
          row.className = 'row tlCustomRow';
          row.style.cssText = 'gap:6px;align-items:center';
          row.innerHTML = `<input class="ipt tlCN" placeholder="项目名称" style="flex:1.5;min-width:0" value="${U.esc(name)}"><input class="ipt tlCU" placeholder="单位" style="flex:.6;min-width:0" value="${U.esc(unit)}"><span class="hint tlCDirTag" style="flex:.9;min-width:0;font-size:11.5px">${dirTag(unit)}</span><button class="btn danger sm tlCDel" type="button" title="删除">✕</button>`;
          row.querySelector('.tlCDel').onclick = () => row.remove();
          cList.appendChild(row);
        };
        // 单位输入变化时实时刷新自动判定的方向标签
        cList.addEventListener('input', (e) => {
          if (!e.target.classList || !e.target.classList.contains('tlCU')) return;
          const tag = e.target.closest('.tlCustomRow').querySelector('.tlCDirTag');
          if (tag) tag.textContent = dirTag(e.target.value);
        });
        // 添加自定义项目：方向按单位自动判定（计时单位→越小越好，其余→越大越好）
        ov.querySelector('#tlAddCustom').onclick = () => {
          const name = ov.querySelector('#tlNewName').value.trim();
          const unit = ov.querySelector('#tlNewUnit').value.trim();
          if (!name) { UI.toast('请填写项目名称', 'err'); return; }
          addCustomRow(name, unit);
          ov.querySelector('#tlNewName').value = ''; ov.querySelector('#tlNewUnit').value = '';
        };
        cList.querySelectorAll('.tlCDel').forEach((b) => { b.onclick = () => b.closest('.tlCustomRow').remove(); });
        ov.querySelector('[data-ok]').onclick = () => {
          const next = [];
          // 系统库勾选项
          ov.querySelectorAll('.tlSys:checked').forEach((c) => {
            const t = libTest(c.value);
            if (t) next.push({ name: t.name, unit: t.unit, invert: !!t.invert, field: t.field || null, special: null });
          });
          // 复合项目
          ov.querySelectorAll('.tlSpecial:checked').forEach((c) => {
            if (c.value === 'fms') next.push({ name: 'FMS 功能性动作筛查', unit: '分', invert: false, field: null, special: 'fms' });
            if (c.value === 'ybt') next.push({ name: 'YBT 下肢动态平衡', unit: '%', invert: false, field: null, special: 'ybt' });
          });
          // 自定义项目（保留已有 + 新增）：方向按单位自动判定
          ov.querySelectorAll('.tlCustomRow').forEach((row) => {
            const nameInp = row.querySelector('.tlCN') || row.querySelector('input[readonly]');
            const name = nameInp ? nameInp.value.trim() : '';
            const unit = row.querySelector('.tlCU').value.trim();
            if (name) next.push({ name, unit, invert: autoInvert(unit), field: null, special: null });
          });
          saveTestItems(next);
          close(); mount();
          UI.toast('测试项目库已更新', 'ok');
        };
      }
    });
  }

  // ---------- 统一数据源：添加体能数据（日期必选 + 身体成分 + 体能指标 + FMS + 1RM + 自定义） ----------
  // 1RM 与体能测试合并录入：每次添加必须选择日期，1RM 按动作手动输入或 重量×次数×RIR 估算（与原测试管理同公式）
  // edit = { date, group } → 编辑模式：预填该日合并值，运动员/日期锁定，保存后覆盖该日全部记录
  function profileDialog(edit) {
    const aths = planAths();
    if (!aths.length) { UI.toast('当前训练计划暂无运动员，请先添加', 'err'); return; }
    const g = edit && edit.group;
    const items = testItems();
    const simpleItems = items.filter((t) => !t.special);
    const hasFms = items.some((t) => t.special === 'fms');
    const hasYbt = items.some((t) => t.special === 'ybt');
    UI.modal({
      title: edit ? `编辑体能数据（${U.cn(edit.date)}）` : '添加体能数据（建档 / 更新）',
      body: `
        <div class="form-grid">
          <div class="field"><label>运动员 *</label>
            <select class="sel" id="pAth" style="width:100%" ${edit ? 'disabled' : ''}>${aths.map((a) => `<option value="${a.id}" ${a.id === state.athleteId ? 'selected' : ''}>${U.esc(a.name)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>测试日期 *</label><input type="date" class="ipt" id="pDate" value="${edit ? edit.date : U.today()}" style="width:100%" ${edit ? 'disabled' : ''}></div>
          <div class="field" style="grid-column:1 / 3"><hr style="border-color:var(--border)"></div>
          <div class="field"><label>身高 cm</label><input type="number" class="ipt" id="pH" step="0.1" style="width:100%"></div>
          <div class="field"><label>体重 kg</label><input type="number" class="ipt" id="pW" step="0.1" style="width:100%"></div>
          <div class="field"><label>体脂率 %</label><input type="number" class="ipt" id="pBF" step="0.1" style="width:100%"></div>
          ${simpleItems.length ? `<div class="field full"><hr style="border-color:var(--border)"></div>
          ${simpleItems.map((t) => `<div class="field"><label>${U.esc(t.name)}${t.unit ? ' ' + U.esc(t.unit) : ''}</label><input type="number" class="ipt pTestVal" data-name="${U.esc(t.name)}" data-field="${U.esc(t.field || '')}" step="any" style="width:100%"></div>`).join('')}` : '<div class="field full"><hr style="border-color:var(--border)"><div class="hint" style="font-size:12px;line-height:1.7">尚未添加体能测试项目：请先在运动员档案页点「体能测试项目库」勾选或自定义项目；Excel 导入时出现的新项目也会自动加入项目库。</div></div>'}
          ${hasYbt ? `<div class="field full"><hr style="border-color:var(--border)"></div>
          <div class="field"><label>YBT左腿 %</label><input type="number" class="ipt" id="pYBTL" step="0.1" style="width:100%"></div>
          <div class="field"><label>YBT右腿 %</label><input type="number" class="ipt" id="pYBTR" step="0.1" style="width:100%"></div>` : ''}
          ${hasFms ? `<div class="field full"><hr style="border-color:var(--border)"></div>
          <div class="field full">
            <div class="row" style="justify-content:space-between;margin-bottom:6px">
              <label style="margin:0">FMS 功能性动作筛查（每项 0–3 分）</label>
              <span class="chip" id="pFmsTotal" style="border-color:var(--accent)">总分 0/21</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px 18px">
              ${FMS_TESTS.map((t) => `
                <div class="row" style="gap:6px;align-items:center">
                  <span style="flex:1;font-size:12.5px">${t.label}</span>
                  ${t.asymm ? `<label class="hint" style="margin:0;font-size:11px;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" class="fmsAsymm" value="${t.key}" style="margin:0">不对称</label>` : ''}
                  <select class="sel fmsSel" data-fms="${t.key}" style="width:62px">
                    <option value="">—</option><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>
                  </select>
                </div>`).join('')}
            </div>
            <div class="hint" style="margin-top:6px">3=标准完成 · 2=完成有代偿 · 1=无法完成 · 0=疼痛；总分 ≤14 提示损伤风险升高（Cook 2010）</div>
          </div>` : ''}
          <div class="field full"><label>备注</label><input class="ipt" id="pNote" style="width:100%"></div>
        </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存档案</button>`,
      onMount(ov, close) {
        // FMS 总分实时预览
        const fmsPrev = ov.querySelector('#pFmsTotal');
        const updateFmsPrev = fmsPrev ? () => {
          let t = 0;
          $$('.fmsSel', ov).forEach((s) => { if (s.value !== '') t += +s.value; });
          fmsPrev.textContent = `总分 ${t}/21`;
          fmsPrev.style.color = t > 14 ? UI.cssVar('var(--color-success)') : t === 14 ? UI.cssVar('var(--color-warning)') : t > 0 ? UI.cssVar('var(--color-danger)') : 'inherit';
          fmsPrev.style.borderColor = t > 0 ? (t > 14 ? UI.cssVar('var(--color-success)') : t === 14 ? UI.cssVar('var(--color-warning)') : UI.cssVar('var(--color-danger)')) : 'var(--accent)';
        } : () => {};
        $$('.fmsSel', ov).forEach((s) => { s.onchange = updateFmsPrev; });
        // 编辑模式：预填该日合并值（身体成分/体能指标/FMS/不对称/备注）
        if (g) {
          // 身体成分固定字段
          [['height', 'pH'], ['weight', 'pW'], ['bodyFat', 'pBF']].forEach(([k, id]) => {
            const inp = ov.querySelector('#' + id);
            if (inp && g.vals && g.vals[k] != null) inp.value = g.vals[k];
          });
          // 体能测试项：按 testItems 顺序回填（field 存固定字段，无 field 存 custom）
          ov.querySelectorAll('.pTestVal').forEach((inp) => {
            const name = inp.dataset.name, field = inp.dataset.field;
            if (field && g.vals && g.vals[field] != null) inp.value = g.vals[field];
            else if (!field && g.custom) {
              const c = g.custom.find((x) => x.name === name);
              if (c && c.value != null) inp.value = c.value;
            }
          });
          // YBT 双腿（仅当库中包含 YBT 时渲染，故直接读固定字段）
          if (hasYbt && g.vals) {
            const l = ov.querySelector('#pYBTL'), r = ov.querySelector('#pYBTR');
            if (l && g.vals.ybtLeft != null) l.value = g.vals.ybtLeft;
            if (r && g.vals.ybtRight != null) r.value = g.vals.ybtRight;
          }
          ov.querySelector('#pNote').value = g.note || '';
          if (g.fms) Object.entries(g.fms).forEach(([k, v]) => {
            const s = ov.querySelector(`.fmsSel[data-fms="${k}"]`);
            if (s) s.value = String(v);
          });
          (g.fmsAsymm || []).forEach((k) => {
            const c = ov.querySelector(`.fmsAsymm[value="${k}"]`);
            if (c) c.checked = true;
          });
          updateFmsPrev();
        }
        ov.querySelector('[data-ok]').onclick = () => {
          const d = Store.data;
          const data = {
            id: U.uid('pf'), athleteId: ov.querySelector('#pAth').value,
            date: ov.querySelector('#pDate').value,
            height: +ov.querySelector('#pH').value || null,
            weight: +ov.querySelector('#pW').value || null,
            bodyFat: +ov.querySelector('#pBF').value || null,
            note: ov.querySelector('#pNote').value.trim()
          };
          // 体能测试项：field 存在存固定字段，否则存 custom
          const customMap = new Map();
          ov.querySelectorAll('.pTestVal').forEach((inp) => {
            const val = inp.value;
            if (val === '') return;
            const field = inp.dataset.field, name = inp.dataset.name;
            if (field) data[field] = +val;
            else {
              const lib = libTest(name);
              customMap.set(name, { name, value: +val, unit: (lib && lib.unit) || '' });
            }
          });
          data.custom = [...customMap.values()];
          if (!data.custom.length) delete data.custom;
          // YBT 双腿
          if (hasYbt) {
            data.ybtLeft = +ov.querySelector('#pYBTL').value || null;
            data.ybtRight = +ov.querySelector('#pYBTR').value || null;
            if (data.ybtLeft && data.ybtRight) {
              const max = Math.max(data.ybtLeft, data.ybtRight);
              const min = Math.min(data.ybtLeft, data.ybtRight);
              data.asymm = max > 0 ? +((max - min) / max * 100).toFixed(1) : null;
            }
          }
          // FMS：7 项 0-3 分 + 不对称标记（全部未填则不存）
          if (hasFms) {
            const fmsSel = {};
            $$('.fmsSel', ov).forEach((s) => { if (s.value !== '') fmsSel[s.dataset.fms] = +s.value; });
            if (Object.keys(fmsSel).length) {
              data.fms = fmsSel;
              const asymm = $$('.fmsAsymm:checked', ov).map((c) => c.value);
              if (asymm.length) data.fmsAsymm = asymm;
            }
          }
          if (!data.athleteId || !data.date) { UI.toast('请选择运动员和日期（每次添加体能数据必须选择日期）', 'err'); return; }
          // 编辑模式：运动员/日期锁定为本运动员与所选日期，保存后覆盖该日全部记录（全空 = 清空该日）
          if (edit) {
            data.athleteId = state.athleteId;
            data.date = edit.date;
            d.profiles = (d.profiles || []).filter((p) => !(p.athleteId === data.athleteId && p.date === data.date));
          }
          // 全空档案不入库（只更新 1RM 的场景不产生空 profile 记录）
          const hasCore = ['height', 'weight', 'bodyFat', 'cmjHeight', 'imtpPeak', 'broadJump', 'sprint20m', 'laneAgility', 'reactionTime', 'pullUpReps', 'verticalJump', 'ybtLeft', 'ybtRight'].some((k) => data[k] != null);
          const pushed = hasCore || (data.fms && Object.keys(data.fms).length) || (data.custom && data.custom.length) || !!data.note;
          if (pushed) { d.profiles = d.profiles || []; d.profiles.push(data); }
          state.athleteId = data.athleteId;
          Store.save(); close(); mount();
          UI.toast(edit ? (pushed ? '已更新该日体能数据' : '已清空该日体能数据') : (pushed ? '已保存体能数据' : '未填写任何数据'), pushed ? 'ok' : 'err');
        };
      }
    });
  }

  // ---------- 1RM 力量录入（独立对话框：按动作手动录入 / 重量×次数×RIR 估算） ----------
  function rmDialog() {
    const aths = planAths();
    if (!aths.length) { UI.toast('当前训练计划暂无运动员，请先添加', 'err'); return; }
    UI.modal({
      title: '记录 1RM',
      body: `
        <div class="form-grid">
          <div class="field"><label>运动员 *</label>
            <select class="sel" id="rAth" style="width:100%">${aths.map((a) => `<option value="${a.id}" ${a.id === state.athleteId ? 'selected' : ''}>${U.esc(a.name)}</option>`).join('')}</select>
          </div>
          <div class="field"><label>记录日期 *</label><input type="date" class="ipt" id="rDate" value="${U.today()}" style="width:100%"></div>
          <div class="field full"><hr style="border-color:var(--border)"></div>
          <div class="field full">
            <div class="row" style="justify-content:space-between;margin-bottom:6px">
              <label style="margin:0">1RM 力量数据（按动作录入，kg）</label>
              <input class="ipt" id="rRmQ" placeholder="搜索动作后可为任意动作录入…" style="width:220px">
            </div>
            <div id="rRmRows" style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;padding:4px 10px"></div>
            <div style="background:var(--bg2);border-radius:8px;padding:8px 10px;margin-top:6px">
              <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
                <span class="hint" style="margin:0">测试估算：</span>
                <select class="sel" id="rRmEx" style="max-width:170px">
                  ${Store.data.exercises.map((e) => `<option value="${e.id}">${U.esc(e.name)}</option>`).join('')}
                </select>
                <input type="number" class="ipt" id="rRmW" placeholder="重量 kg" style="width:86px">
                <input type="number" class="ipt" id="rRmR" placeholder="次数" style="width:64px">
                <input type="number" class="ipt" id="rRmRir" placeholder="RIR" value="0" style="width:64px">
                <span class="chip volt" id="rRmEst" style="display:none"></span>
                <button class="btn sm ghost" id="rRmFill" type="button" style="display:none">填入 ↑</button>
              </div>
              <div class="hint" style="margin-top:4px">e1RM = 重量 × (1 + (次数 + RIR) / 30)；RIR=还能再做几次（0=力竭）</div>
            </div>
          </div>
        </div>`,
      footer: `<button class="btn ghost" data-x>取消</button><button class="btn primary" data-ok>保存 1RM</button>`,
      onMount(ov, close) {
        const rmBox = ov.querySelector('#rRmRows');
        let rmQ = '';
        const renderRmRows = () => {
          const cur = Store.data.athleteRm[ov.querySelector('#rAth').value] || {};
          let list = Store.data.exercises;
          if (rmQ) list = list.filter((e) => (e.name || '').includes(rmQ) || (e.cat1 || '').includes(rmQ) || (e.cat2 || '').includes(rmQ) || (e.equip || '').includes(rmQ));
          else list = list.filter((e) => cur[e.id] && cur[e.id].value);
          rmBox.innerHTML = list.map((e) => {
            const per = cur[e.id];
            const mark = per && per.value ? (per.history && /测试/.test(per.history[per.history.length - 1].method || '') ? '<span class="chip volt" style="font-size:10px">测试</span>' : '<span class="chip" style="font-size:10px">手动</span>') : '';
            return `<div class="row" data-srcrow style="gap:6px;align-items:center;padding:3px 0">
              <span style="flex:1;font-size:12.5px">${U.esc(e.name)} <span class="hint">${U.esc(e.cat2 || '')}</span></span>
              ${mark}
              <input type="number" class="ipt" data-ex="${e.id}" value="${per && per.value ? per.value : ''}" placeholder="kg" style="width:84px">
            </div>`;
          }).join('') || '<p class="hint" style="padding:6px 2px">该运动员暂无 1RM 记录——搜索动作名称后录入，或使用下方测试估算。</p>';
        };
        renderRmRows();
        ov.querySelector('#rAth').onchange = renderRmRows;
        ov.querySelector('#rRmQ').oninput = (e) => { rmQ = e.target.value.trim(); renderRmRows(); };
        const estBox = ov.querySelector('#rRmEst');
        const fillBtn = ov.querySelector('#rRmFill');
        const calcEst = () => {
          const w = Number(ov.querySelector('#rRmW').value);
          const r = Number(ov.querySelector('#rRmR').value);
          const ri = Number(ov.querySelector('#rRmRir').value);
          const info = Calc.estimate1RMInfo(w, r, isNaN(ri) ? 0 : ri);
          if (info && info.est) {
            estBox.style.display = '';
            estBox.innerHTML = info.over
              ? `<span style="color:var(--color-danger)">单组 ${info.n} 次超出公式适用范围（≤12 次，建议 3-10 次），无法可靠估算</span>`
              : `e1RM ${info.est} kg${info.warn ? '<span class="hint" style="color:var(--color-warning);margin-left:6px">11-12 次，可能偏高</span>' : ''}`;
            fillBtn.style.display = info.over ? 'none' : '';
          }
          else { estBox.style.display = 'none'; fillBtn.style.display = 'none'; }
          return info && info.est;
        };
        ['rRmW', 'rRmR', 'rRmRir'].forEach((id) => { ov.querySelector('#' + id).oninput = calcEst; });
        fillBtn.onclick = () => {
          const est = calcEst();
          const exId = ov.querySelector('#rRmEx').value;
          if (!est || !exId) return;
          if (!ov.querySelector('[data-ex="' + exId + '"]')) {
            const ex = Store.exercise(exId);
            rmQ = ex ? ex.name : '';
            ov.querySelector('#rRmQ').value = rmQ;
            renderRmRows();
          }
          const inp = ov.querySelector('[data-ex="' + exId + '"]');
          inp.value = est;
          inp.closest('[data-srcrow]').dataset.src = 'test';
          UI.toast(`已填入 ${Store.exercise(exId).name} e1RM ${est} kg（保存后生效）`, 'ok');
        };
        ov.querySelector('[data-ok]').onclick = () => {
          const d = Store.data;
          const athleteId = ov.querySelector('#rAth').value;
          const date = ov.querySelector('#rDate').value;
          if (!athleteId || !date) { UI.toast('请选择运动员和日期', 'err'); return; }
          const athObj = Store.data.athletes.find((x) => x.id === athleteId);
          let rmN = 0;
          $$('#rRmRows [data-ex]', ov).forEach((inp) => {
            const exId = inp.dataset.ex;
            const v = Number(inp.value);
            const src = inp.closest('[data-srcrow]') && inp.closest('[data-srcrow]').dataset.src === 'test' ? 'test' : 'manual';
            const rec0 = ((d.athleteRm || {})[athleteId] || {})[exId];
            if (v > 0) {
              if (!rec0 || rec0.value !== v) {
                Store.updateAthRm(athleteId, exId, v, date, (athObj ? athObj.name + ' ' : '') + (src === 'test' ? '测试估算' : '手动录入'), src);
                rmN++;
              }
            } else if (rec0) {
              delete d.athleteRm[athleteId][exId]; rmN++;
            }
          });
          state.athleteId = athleteId;
          Store.save(); close(); mount();
          UI.toast(rmN ? `已保存 ${rmN} 项 1RM` : '未填写任何 1RM 数据', rmN ? 'ok' : 'err');
        };
      }
    });
  }

  // ---------- 顶部运动员栏（与计划卡合并：头像 + 下拉切换 + 信息 + chips + 全部操作） ----------
  function renderAthBar(v) {
    const el = v.querySelector('#profAthBar');
    const aths = planAths();
    const mac = curMacro();
    const cur = aths.find((a) => a.id === state.athleteId);
    // 下拉选项后随该运动员数据情况：1RM × N · 已建档
    const tag = (a) => {
      const n = rmCount(a.id);
      const filed = (Store.data.profiles || []).some((p) => p.athleteId === a.id);
      const bits = [];
      if (a.position) bits.push(a.position);
      if (n) bits.push('1RM × ' + n);
      if (filed) bits.push('已建档');
      return bits.length ? '（' + bits.join(' · ') + '）' : '';
    };
    if (!cur) {
      el.innerHTML = `
        <div class="field" style="margin:0;min-width:240px">
          <label>运动员</label>
          <select class="sel" id="profAthSel" style="width:100%"><option value="">— 暂无运动员 —</option></select>
        </div>
        <span class="hint" style="align-self:flex-end">名单 ${aths.length} 人 · 请先点击右上角「＋ 添加运动员」</span>`;
      el.querySelector('#profAthSel').onchange = () => {};
      return;
    }
    const profN = getProfiles(cur.id).length;
    const rmN = Object.keys(rmAsOf(cur.id)).length;
    const age = cur.birth ? Math.floor((Date.now() - new Date(cur.birth).getTime()) / (365.25 * 24 * 3600 * 1000)) : null;
    el.innerHTML = `
      <div class="row" style="gap:12px;align-items:center;flex-wrap:wrap;flex:1;min-width:0">
        ${U.avatar(cur, 'width:44px;height:44px;font-size:20px;flex:none', true)}
        <div class="field" style="margin:0;min-width:200px">
          <label>运动员</label>
          <select class="sel" id="profAthSel" style="width:100%">
            ${aths.map((a) => `<option value="${a.id}" ${a.id === cur.id ? 'selected' : ''}>${U.esc(a.name)}${tag(a)}</option>`).join('')}
          </select>
        </div>
        <span class="hint" style="font-size:12px;white-space:nowrap">${U.esc(cur.sport)} · ${cur.gender || '—'} · ${age != null ? age + '岁' : '—'}${mac ? ' · ' + U.esc(mac.name) : ''}</span>
        ${cur.position ? `<span class="chip volt">${U.esc(cur.position)}</span>` : ''}
        <span class="chip">档案 ${profN}</span>
        <span class="chip ${rmN ? 'volt' : ''}">1RM × ${rmN}</span>
        <span class="hint">名单 ${aths.length} 人</span>
      </div>
      <div class="row" style="gap:6px;align-items:center">
        <button class="btn sm ghost" id="profAthEdit">✎ 编辑</button>
        <button class="btn sm danger" id="profAthDel">✕ 删除</button>
        <button class="btn sm primary" id="pAdd">＋ 添加体能数据</button>
        <button class="btn sm ghost" id="profKpiBtn" title="查看该运动员的体能分析">KPI 分析 ›</button>
      </div>`;
    el.querySelector('#profAthSel').onchange = (e) => { state.athleteId = e.target.value || null; state.rmCat = null; state.rmDate = null; mount(); };
    el.querySelector('#profAthEdit').onclick = () => athleteDialog(cur);
    el.querySelector('#profAthDel').onclick = () => delAthlete(cur);
    el.querySelector('#pAdd').onclick = () => profileDialog();
    el.querySelector('#profKpiBtn').onclick = () => { location.hash = '#/kpi'; };
  }

  // ---------- 右侧详情：头部 + 各分析区（无数据不渲染空框） ----------
  function renderDetail(v) {
    const el = v.querySelector('#profDetail');
    const ath = Store.data.athletes.find((a) => a.id === state.athleteId);
    if (!ath) {
      el.innerHTML = `<p class="hint" style="padding:26px;text-align:center">请在顶部下拉选择运动员；没有名单时点击右上角「＋ 添加运动员」</p>`;
      return;
    }
    const aths = planAths();
    const profiles = getProfiles(ath.id);
    const rmA = rmAsOf(ath.id);
    const rc = Object.keys(rmA).length;
    const hasAnyData = profiles.length > 0 || rc > 0;

    const parts = [];

    // ① 无数据提示（头部信息/操作按钮已合并进顶部运动员栏）
    if (!hasAnyData) {
      parts.push(`<p class="hint" style="margin:0 0 12px">暂无体能数据——点击顶部「＋ 添加体能数据」录入身体成分、体能指标与 FMS（每次需选择日期）；1RM 请点击「记录 1RM」。</p>`);
    }

    // ④ 1RM 力量档案（当前运动员的全部测试/估算记录，按日期倒序、次数不设上限；分析解读见 KPI 分析页）
    const rmDts = dataDates(ath.id).slice().reverse();
    const rmView = rmAsOf(ath.id, null);
    // 展开该运动员全部 1RM 历史记录：每个动作每次测试/估算各占一行（仅当前运动员，不混入他人）
    const rmRecords = [];
    Object.keys(rmView).forEach((exId) => {
      const ex = Store.exercise(exId);
      if (!ex) return;
      const rec = rmView[exId];
      const hasHist = !!(rec.history && rec.history.length);
      const hist = hasHist ? rec.history : (rec.value ? [{ value: rec.value, date: rec.date || rec.testDate || '', method: '', source: '' }] : []);
      hist.forEach((h, hi) => { if (h && h.value) rmRecords.push({ ex, value: h.value, date: h.date || rec.testDate || rec.date || '', method: h.method || '', source: h.source || '', _hi: hasHist ? hi : null }); });
    });
    // 每条记录相对该运动员上一次同动作记录的涨跌幅（按日期升序逐条比较；手动录入/测试/课后更新只要有新记录即自动计算）
    const rmByEx = {};
    rmRecords.forEach((r) => { (rmByEx[r.ex.id] = rmByEx[r.ex.id] || []).push(r); });
    Object.values(rmByEx).forEach((list) => {
      list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      list.forEach((r, i) => { r.prevDiff = i > 0 && list[i - 1].value ? (r.value - list[i - 1].value) / list[i - 1].value * 100 : null; });
    });
    rmRecords.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    // 1RM 分类 / 日期 下拉筛选（分类取动作大类 cat1；日期为全部有记录日期，倒序）
    const rmCats = [...new Set(rmRecords.map((r) => r.ex.cat1 || '未分类'))].sort();
    const rmDates = [...new Set(rmRecords.map((r) => r.date).filter(Boolean))].sort().reverse();
    if (state.rmCat && !rmCats.includes(state.rmCat)) state.rmCat = null;
    if (state.rmDate && !rmDates.includes(state.rmDate)) state.rmDate = null;
    const rmFiltered = rmRecords.filter((r) => (!state.rmCat || (r.ex.cat1 || '未分类') === state.rmCat) && (!state.rmDate || r.date === state.rmDate));
    if (Object.keys(rmA).length) {
      parts.push(`
        <div class="card" id="profRmCard" style="margin-bottom:12px">
          <div class="card-title"><h3>1RM 力量档案</h3>
            <div class="row" style="gap:8px;flex-wrap:wrap">
              <select class="sel" id="rmCatSel" style="font-size:11px" title="按动作分类筛选"><option value="">全部分类</option>${rmCats.map((c) => `<option value="${U.esc(c)}" ${state.rmCat === c ? 'selected' : ''}>${U.esc(c)}</option>`).join('')}</select>
              <select class="sel" id="rmDateSel" style="font-size:11px" title="按记录日期筛选"><option value="">全部日期</option>${rmDates.map((d) => `<option value="${d}" ${state.rmDate === d ? 'selected' : ''}>${U.md(d)}</option>`).join('')}</select>
              <span class="chip" title="最近一次 1RM 记录日期">最新记录：${rmDts.length ? U.md(rmDts[0]) : '—'}</span>
              <button class="btn sm primary" id="profRmEdit">记录 1RM</button>
            </div>
          </div>
          ${rmFiltered.length ? `<div style="overflow:auto;max-height:320px"><table class="tbl">
            <thead><tr><th>动作</th><th class="r">1RM</th><th class="r">记录日期</th><th>来源</th><th class="r" title="相对上一次同动作 1RM 记录的涨跌幅（新记录产生时自动计算）">vs 上次</th><th class="r" style="width:56px">操作</th></tr></thead>
            <tbody>${rmFiltered.map(({ ex, value, date, method, source, prevDiff, _hi }) => {
              const isSession = source === 'session';
              const isTest = /测试/.test(method);
              return `<tr>
                <td><b>${U.esc(ex.name)}</b><div class="hint">${U.esc(ex.cat2 || '')}${ex.equip ? ' · ' + U.esc(ex.equip) : ''}</div></td>
                <td class="r num"><b>${value}</b> kg</td>
                <td class="r num hint">${date ? U.md(date) : '—'}</td>
                <td><span class="chip ${isTest ? 'volt' : ''}">${isSession ? '训练课' : isTest ? '测试' : '手动'}</span></td>
                <td class="r num" style="color:${prevDiff == null ? UI.cssVar('var(--color-ink-muted)') : prevDiff > 0 ? UI.cssVar('var(--color-success)') : prevDiff < 0 ? UI.cssVar('var(--color-danger)') : UI.cssVar('var(--color-ink-muted)')}">${prevDiff == null ? '—' : (prevDiff > 0 ? '+' : '') + prevDiff.toFixed(0) + '%'}</td>
                <td class="r"><button class="btn sm danger" data-rmdel="${ex.id}" data-hi="${_hi == null ? 'null' : _hi}" title="删除该条 1RM 记录">✕</button></td>
              </tr>`;
            }).join('')}</tbody>
          </table></div>`
            : `<p class="hint" style="padding:8px 2px">${rmRecords.length ? '当前筛选条件下暂无记录——调整分类或日期筛选。' : '暂无 1RM 记录——点击「记录 1RM」录入。'}</p>`}
        </div>`);
    }

    // ⑤ 体能数据源记录（每次「添加体能数据」生成一条带日期的档案；同一天多次录入合并到同一日期下，组内同字段取最后一次录入的非空值）
    const SRC_FIELDS = [
      { key: 'height', label: '身高', unit: 'cm' }, { key: 'weight', label: '体重', unit: 'kg' }, { key: 'bodyFat', label: '体脂', unit: '%' },
      ...METRICS.filter((m) => m.source === 'profile').map((m) => ({ key: m.field, label: m.label, unit: m.unit })),
      { key: 'ybtLeft', label: 'YBT左', unit: '%' }, { key: 'ybtRight', label: 'YBT右', unit: '%' }
    ];
    const srcByDate = {};
    if (profiles.length) {
      profiles.forEach((p) => {
        const g = srcByDate[p.date] || (srcByDate[p.date] = { note: '', fms: null, fmsAsymm: null, custom: [], vals: {} });
        if (p.note) g.note = p.note;
        SRC_FIELDS.forEach((f) => { if (p[f.key] != null) g.vals[f.key] = p[f.key]; });
        if (p.fms && FMS_TESTS.some((t) => p.fms[t.key] != null)) { g.fms = p.fms; g.fmsAsymm = p.fmsAsymm || null; }
        if (Array.isArray(p.custom)) g.custom = g.custom.concat(p.custom);
      });
      const dates = Object.keys(srcByDate).sort((a, b) => b.localeCompare(a));
      const showDates = state.srcDate ? dates.filter((d) => d === state.srcDate) : dates;
      parts.push(`
        <div class="card" id="profSrcCard" style="margin-bottom:12px">
          <div class="card-title"><h3>体能数据源记录</h3>
            <select class="sel" id="srcDateSel" style="width:180px" title="按日期筛选">
              <option value="">全部日期</option>
              ${dates.map((d) => `<option value="${d}" ${state.srcDate === d ? 'selected' : ''}>${U.cn(d)}</option>`).join('')}
            </select>
          </div>
          <div style="overflow-x:auto"><table class="tbl">
            <thead><tr><th style="width:110px">日期</th><th>项目</th><th class="r" style="width:150px">数值</th><th class="r" style="width:76px">操作</th></tr></thead>
            <tbody>${showDates.map((d) => {
              const g = srcByDate[d];
              const rows = SRC_FIELDS.filter((f) => g.vals[f.key] != null)
                .map((f) => ({ label: U.esc(f.label), value: `<b>${g.vals[f.key]}</b>${f.unit ? ' ' + f.unit : ''}` }));
              if (g.fms) rows.push({ label: 'FMS 筛查', value: `<b>${fmsTotal(g.fms)}</b>/21${g.fmsAsymm && g.fmsAsymm.length ? ` <span class="hint">不对称 ${g.fmsAsymm.length} 项</span>` : ''}` });
              (g.custom || []).forEach((c) => rows.push({ label: U.esc(c.name), value: `<b>${c.value}</b>${c.unit ? ' ' + U.esc(c.unit) : ''}` }));
              if (!rows.length) rows.push({ label: '<span class="hint">该日未录入具体数值</span>', value: '—' });
              const ops = `<td class="r" rowspan="${rows.length}"><div class="row" style="gap:4px;justify-content:flex-end">
                <button class="btn sm" data-srcedit="${d}" title="修改该日体能数据">✎</button>
                <button class="btn sm danger" data-srcdel="${d}" title="删除该日全部体能数据">✕</button>
              </div></td>`;
              return rows.map((r, i) => `
                <tr>${i === 0 ? `<td class="num" rowspan="${rows.length}"><b>${U.md(d)}</b>${g.note ? `<div class="hint">${U.esc(g.note)}</div>` : ''}</td>` : ''}
                <td>${r.label}</td>
                <td class="r num">${r.value}</td>
                ${i === 0 ? ops : ''}</tr>`).join('');
            }).join('')}</tbody>
          </table></div>
        </div>`);
    }

    // ⑤⑥⑦ KPI 看板 / 纵向趋势 / 团队排名 → 已迁至 KPI 分析页（Views.kpi）

    el.innerHTML = parts.join('');

    // 1RM 数据源卡录入入口
    const rmEditBtn = el.querySelector('#profRmEdit');
    if (rmEditBtn) rmEditBtn.onclick = () => rmDialog();
    // 1RM 力量档案：分类 / 日期筛选
    const rmCatSel = el.querySelector('#rmCatSel');
    if (rmCatSel) rmCatSel.onchange = (e) => { state.rmCat = e.target.value || null; mount(); };
    const rmDateSel = el.querySelector('#rmDateSel');
    if (rmDateSel) rmDateSel.onchange = (e) => { state.rmDate = e.target.value || null; mount(); };
    // 体能数据源日期筛选
    const srcDateSel = el.querySelector('#srcDateSel');
    if (srcDateSel) srcDateSel.onchange = (e) => { state.srcDate = e.target.value || null; mount(); };
    // 1RM 记录删除：history 索引定位，基准值回退为剩余记录最新一条；无剩余则移除该动作记录
    $$('[data-rmdel]', el).forEach((b) => {
      b.onclick = () => {
        const exId = b.dataset.rmdel;
        const hi = b.dataset.hi === 'null' ? null : Number(b.dataset.hi);
        UI.confirm('删除该条 1RM 记录？基准值将回退为剩余记录中的最新一条，涨跌幅按剩余记录重新计算。', () => {
          const rmMap = (Store.data.athleteRm || {})[ath.id];
          const rec = rmMap && rmMap[exId];
          if (!rec) { mount(); return; }
          if (hi != null && Array.isArray(rec.history) && rec.history[hi]) {
            rec.history.splice(hi, 1);
            if (rec.history.length) {
              const last = rec.history[rec.history.length - 1];
              rec.value = last.value;
              rec.date = last.date;
            } else delete rmMap[exId];
          } else delete rmMap[exId];
          Store.save(); mount();
          UI.toast('已删除 1RM 记录', 'ok');
        });
      };
    });
    // 体能数据源：按日期修改（预填编辑弹窗）/ 删除（移除该日全部记录）
    $$('[data-srcedit]', el).forEach((b) => {
      b.onclick = () => {
        const d = b.dataset.srcedit;
        if (srcByDate[d]) profileDialog({ date: d, group: srcByDate[d] });
      };
    });
    $$('[data-srcdel]', el).forEach((b) => {
      b.onclick = () => {
        const d = b.dataset.srcdel;
        UI.confirm(`删除 ${U.cn(d)} 的体能数据源记录？该日的身体成分、体能指标、FMS 与自定义项目将一并删除。`, () => {
          Store.data.profiles = (Store.data.profiles || []).filter((p) => !(p.athleteId === ath.id && p.date === d));
          Store.save(); mount();
          UI.toast('已删除该日体能数据源', 'ok');
        });
      };
    });
  }

  function mount(v) {
    if (v == null) v = $('#view');
    UI.disposeCharts();
    const mac = curMacro();
    if (!mac) {
      v.innerHTML = `<div class="empty"><h4>暂无训练计划</h4><p>请先在「周期训练计划」中新建训练计划，再添加该计划的运动员档案</p></div>`;
      return;
    }
    const aths = planAths();
    if (!state.athleteId || !aths.find((a) => a.id === state.athleteId)) state.athleteId = aths[0] ? aths[0].id : null;

    v.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div>
            <div class="hint" style="font-size:11px;letter-spacing:1px;margin-bottom:2px">当前训练计划</div>
            <div class="row" style="gap:8px;align-items:baseline">
              <b style="font-size:16px">${U.esc(mac.name)}</b>
              <span class="hint">${U.esc(mac.sportCat)} · ${U.esc(mac.sport)} · ${U.md(mac.startDate)} — ${U.md(mac.endDate)}</span>
            </div>
          </div>
          <button class="btn sm ghost" id="profTestLib" title="配置「添加体能数据」弹窗中显示的测试项目">⚙ 体能测试项目库</button>
          <button class="btn sm ghost" id="profImport" title="从 Excel 批量导入测试成绩（支持排版不统一的表格，带列映射向导）">⇪ 导入 Excel 测试表</button>
          <button class="btn sm primary" id="profAthAdd">＋ 添加运动员</button>
        </div>
        <div class="row" id="profAthBar" style="gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)"></div>
      </div>
      <div id="profDetail"></div>`;

    $('#profAthAdd').onclick = () => athleteDialog(null);
    $('#profTestLib').onclick = () => testLibDialog();
    $('#profImport').onclick = () => Views.importTest.open({ onImported: () => mount() });

    renderAthBar(v);
    renderDetail(v);
  }

  // 导出数据层供 KPI 分析页（Views.kpi）复用，避免复制约 150 行辅助函数
  return {
    mount, state,
    curMacro, planAths, METRICS, allMetrics, labMetrics, addTestItem, autoInvert, profileVal, FMS_TESTS, fmsTotal, fmsRecs, testItems, testLibDialog,
    getMetric, teamValues, metricZ, metricPct, getProfiles, dataDates, rmAsOf,
    testLibrary: () => TEST_LIBRARY, bodyMetrics: () => BODY_METRICS
  };
})();
