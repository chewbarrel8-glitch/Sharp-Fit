// jsdom 冒烟测试：大周期页「周期总表」渲染与保存
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only' });
const { window } = dom;

window.__chartOptions = [];
window.echarts = { init: () => ({ setOption(option) { window.__chartOptions.push(option); }, resize() {}, dispose() {} }) };
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));

// 造数夹具复用应用内示例（src/js/demo.js：XX篮球队备战计划），保证冒烟测试与「载入示例」同源
// 不引入 app.js：jsdom 会异步触发 DOMContentLoaded，app 启动引导会抢先挂载 macro 到静态 #view，
// 与下方手动挂载的 section 产生重复 ID，触发 jsdom(nwsapi) 重复 ID 下作用域 querySelector 失效
const files = ['vendor/xlsx.full.min.js', 'js/util.js', 'js/sports.js', 'js/store.js', 'js/ui.js',
  'js/views/macro.js', 'js/views/meso.js', 'js/views/micro.js', 'js/views/session.js',
  'js/views/load.js', 'js/views/exercises.js', 'js/views/profile.js', 'js/views/kpi.js',
  'js/views/kpiLab.js', 'js/views/importTest.js'];
const seedSource = fs.readFileSync(path.join(root, 'src', 'js', 'demo.js'), 'utf8');
// 拼接为单个脚本执行，保证跨文件顶层 const 共享（与浏览器多 <script> 行为一致）
window.eval(files.map((f) => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n;\n')
  + '\n;\n' + seedSource
  + '\n;window.__T = { Store, Calc, U, UI, Views, seedDemo };');
const T = window.__T;

const errors = [];
window.addEventListener('error', (e) => errors.push(e.message));

(async () => {
  const $ = (s) => window.document.querySelector(s);
  const $$ = (s) => [...window.document.querySelectorAll(s)];
  await T.Store.init();
  T.seedDemo();

  // 挂载大周期页
  const view = window.document.createElement('section');
  window.document.body.appendChild(view);
  T.Views.macro.mount(view);

  const grid = $('#gridBox', view) || view.querySelector('#gridBox');
  const assert = (cond, name) => console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name) || (cond || errors.push(name));

  assert(!!grid.querySelector('#teamName'), 'TEAM NAME 输入框存在');
  assert(grid.querySelectorAll('.pg-mon').length >= 2, '月份合并带 >= 2（跨月）');
  // 期望周数与大周期总表渲染同口径：起始周周一铺到结束周周一
  const mac0 = T.Store.activeMacro();
  const expWeeks = Math.round((T.U.d(T.U.weekStart(mac0.endDate)) - T.U.d(T.U.weekStart(mac0.startDate))) / 86400000 / 7) + 1;
  assert(grid.querySelectorAll('.pg-day').length / 7 === expWeeks, '日期格数 = 周数×7（' + expWeeks + ' 周）');
  assert(grid.querySelector('.pg-day.comp'), '存在红色比赛日格');
  assert(grid.querySelectorAll('.pg-meso').length >= 3, '中周期合并带 >= 3');
  assert(grid.querySelector('.pg-comp').textContent !== '' || grid.querySelectorAll('.pg-comp').length > 0, '比赛日行渲染');
  assert(grid.querySelectorAll('.pg-inp').length >= 14, '训练量/负荷输入格齐全');

  // 模拟输入：第一周训练量 8 / 训练负荷 6 / 准备水平 8（状态行现为 1-10 数字输入）
  const mac = T.Store.activeMacro();
  const ws = T.U.weekStart(mac.startDate);
  const setVal = (key, val) => {
    const inp = grid.querySelector(`[data-ws="${ws}"][data-key="${key}"]`);
    inp.value = val;
    inp.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  setVal('volume', '8'); setVal('intensity', '6'); setVal('status', '8');
  assert(mac.weekPlan[ws] && mac.weekPlan[ws].volume === 8 && mac.weekPlan[ws].intensity === 6 && mac.weekPlan[ws].status === 8, '手动输入已写入 weekPlan');
  const sel = grid.querySelector(`[data-ws="${ws}"][data-key="status"]`);
  assert(sel.className.includes('st-8'), '准备水平高亮 class 生效');

  // 持久化
  const saved = JSON.parse(window.localStorage.getItem('tpdb'));
  assert(saved.macros[0].weekPlan[ws].volume === 8 && saved.macros[0].weekPlan[ws].status === 8, 'weekPlan 已持久化到 localStorage');

  // 队伍名称
  const tn = grid.querySelector('#teamName');
  tn.value = '国家集训队';
  tn.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(T.Store.activeMacro().teamName === '国家集训队', '队伍名称已保存');

  // 重新挂载后回填
  T.Views.macro.mount(view);
  const g2 = view.querySelector('#gridBox');
  assert(g2.querySelector('#teamName').value === '国家集训队', '重挂载后队伍名称回填');
  assert(g2.querySelector(`[data-ws="${ws}"][data-key="volume"]`).value === '8', '重挂载后训练量回填');
  assert(g2.querySelector(`[data-ws="${ws}"][data-key="status"]`).className.includes('st-8'), '重挂载后准备水平高亮回填');

  // 其它页面挂载无异常
  for (const r of ['meso', 'micro', 'session', 'load', 'exercises']) {
    try { window.Views[r].mount(view); console.log('PASS - 页面挂载 ' + r); } catch (e) { console.log('FAIL - 页面挂载 ' + r + ': ' + e.message); errors.push(r); }
  }

  // 负荷管理：日期/周期筛选驱动全可视化看板
  const loadView = $('#view');
  const chartOptionStart = window.__chartOptions.length;
  T.Views.load.mount(loadView);
  const dashboard = loadView.querySelector('#loadDashboard');
  assert(!!loadView.querySelector('#loadDateFrom') && !!loadView.querySelector('#loadDateTo'), '自定义起止日期筛选存在');
  assert(!!loadView.querySelector('#loadMesoFilter') && !!loadView.querySelector('#loadMicroFilter'), '中周期与小周期筛选存在');
  assert(dashboard.querySelectorAll('table').length === 0, '负荷看板不使用数据表格');
  assert(dashboard.querySelectorAll('.load-metric').length === 8, 'AU、ACWR、TSB、吨位、课次、训练时长、距离、做功时间指标齐全');
  assert(dashboard.querySelectorAll('.chart[role="img"]').length === 10, '负荷看板包含十个可视化图表');
  assert(dashboard.querySelectorAll('.load-metric .qmark').length === 8 && dashboard.querySelectorAll('.card-title .qmark').length === 10, '每张指标卡和图表均有算法说明入口');
  const dashboardChartOptions = window.__chartOptions.slice(chartOptionStart);
  assert(dashboardChartOptions.filter((option) => (option.series || []).some((series) => series.type === 'gauge')).length === 2, 'ACWR 与 TSB 均以指针仪表绘制');
  const dateAxisOptions = dashboardChartOptions.filter((option) => option.xAxis && !Array.isArray(option.xAxis) && Array.isArray(option.xAxis.data));
  assert(dateAxisOptions.length > 0 && dateAxisOptions.every((option) => option.xAxis.data.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)) && !option.xAxis.axisLabel.formatter('2026-01-01').includes('NaN')), '每日图表使用 ISO 日期并且轴标签不产生 NaN');
  const fromInput = loadView.querySelector('#loadDateFrom');
  const toInput = loadView.querySelector('#loadDateTo');
  fromInput.value = '2026-09-15';
  toInput.value = '2026-09-30';
  fromInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(loadView.querySelector('#loadDateFrom').value === '2026-09-15' && loadView.querySelector('#loadDateTo').value === '2026-09-30', '自定义日期范围可应用到看板');
  assert(loadView.querySelector('#loadMesoFilter').value === 'all' && loadView.querySelector('#loadMicroFilter').value === 'all', '手动选择日期会清除周期筛选');
  const mesoFilter = loadView.querySelector('#loadMesoFilter');
  const firstMesoId = mesoFilter.options[1] && mesoFilter.options[1].value;
  if (firstMesoId) {
    const firstMeso = T.Store.data.mesos.find((m) => m.id === firstMesoId);
    assert(mesoFilter.options[1].textContent.includes(T.U.md(firstMeso.startDate)) && mesoFilter.options[1].textContent.includes(T.U.md(firstMeso.endDate)), '中周期选项显示起止日期');
    mesoFilter.value = firstMesoId;
    mesoFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
    const selectedMeso = T.Store.data.mesos.find((m) => m.id === firstMesoId);
    assert(loadView.querySelector('#loadDateFrom').value === selectedMeso.startDate && loadView.querySelector('#loadDateTo').value === selectedMeso.endDate, '选择中周期会联动日期范围');
    const microFilter = loadView.querySelector('#loadMicroFilter');
    const firstMicroId = microFilter.options[1] && microFilter.options[1].value;
    if (firstMicroId) {
      const firstMicro = T.Store.data.micros.find((mi) => mi.id === firstMicroId);
      assert(microFilter.options[1].textContent.includes(T.U.md(firstMicro.startDate)) && microFilter.options[1].textContent.includes(T.U.md(firstMicro.endDate)), '小周期选项显示起止日期');
      microFilter.value = firstMicroId;
      microFilter.dispatchEvent(new window.Event('change', { bubbles: true }));
      const selectedMicro = T.Store.data.micros.find((mi) => mi.id === firstMicroId);
      assert(loadView.querySelector('#loadDateFrom').value === selectedMicro.startDate && loadView.querySelector('#loadDateTo').value === selectedMicro.endDate, '选择小周期会联动日期范围');
    }
  }
  const macroB = T.U.uid('mac');
  const mesoB = T.U.uid('mes');
  const microB = T.U.uid('mic');
  const athleteB = T.U.uid('ath');
  const athleteC = T.U.uid('ath');
  T.Store.data.macros.push({ id: macroB, name: '第二计划', startDate: '2026-01-01', endDate: '2026-12-31' });
  T.Store.data.mesos.push({ id: mesoB, macroId: macroB, name: '第二计划中周期', startDate: '2026-01-01', endDate: '2026-12-31' });
  T.Store.data.micros.push({ id: microB, mesoId: mesoB, name: '第二计划小周期', startDate: '2026-01-01', endDate: '2026-01-07' });
  T.Store.data.athletes.push({ id: athleteB, macroId: macroB, name: '第二计划运动员' });
  T.Store.data.athletes.push({ id: athleteC, macroId: macroB, name: '第二计划运动员二' });
  T.Store.data.settings.activeMacroId = macroB;
  T.Views.load.mount(loadView);
  assert(loadView.querySelector('#loadMesoFilter').value === 'all' && loadView.querySelector('#loadMicroFilter').value === 'all', '切换计划后周期筛选重置到新计划');
  const futureFrom = T.U.addDays(T.U.today(), 14);
  const futureTo = T.U.addDays(T.U.today(), 21);
  loadView.querySelector('#loadDateFrom').value = futureFrom;
  loadView.querySelector('#loadDateTo').value = futureTo;
  loadView.querySelector('#loadDateFrom').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(loadView.querySelector('.load-metric-grid .load-metric:nth-child(5) .v').textContent.startsWith('0') && loadView.querySelector('.load-metric-grid .load-metric:nth-child(2) .v').textContent.includes('基线积累中'), '纯未来日期范围不冒充今天的训练数据');

  const today = T.U.today();
  const finiteChartOptions = (value, seen = new Set()) => {
    if (typeof value === 'number') return Number.isFinite(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return true;
    seen.add(value);
    return Object.values(value).every((child) => finiteChartOptions(child, seen));
  };
  const noLoadChartStart = window.__chartOptions.length;
  loadView.querySelector('#loadDateFrom').value = today;
  loadView.querySelector('#loadDateTo').value = today;
  loadView.querySelector('#loadDateFrom').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(!loadView.textContent.includes('NaN'), '当天无负荷时界面不显示 NaN');
  assert(window.__chartOptions.slice(noLoadChartStart).every((option) => finiteChartOptions(option)), '当天无负荷时图表配置不包含非有限数');
  T.Store.data.loadEntries.push({ id: T.U.uid('badle'), athleteId: athleteB, date: today, load: 'NaN', duration: 'NaN', sessionId: 'invalid-entry' });
  const invalidChartStart = window.__chartOptions.length;
  T.Views.load.mount(loadView);
  assert(!loadView.textContent.includes('NaN'), '异常历史负荷不会污染指标或图表文字');
  assert(window.__chartOptions.slice(invalidChartStart).every((option) => finiteChartOptions(option)), '异常历史负荷不会传入非有限图表数据');
  T.Store.data.loadEntries = T.Store.data.loadEntries.filter((entry) => entry.sessionId !== 'invalid-entry');

  const completedId = T.U.uid('ses');
  const resistanceExercise = T.Store.data.exercises.find((exercise) => T.Calc.metricOf({ exId: exercise.id }) === 'reps' && T.Calc.loadTypeOf({ exId: exercise.id }) === 'resistance');
  assert(!!resistanceExercise, '存在抗阻动作供逐组与 1RM 测试');
  const complexBlockId = T.U.uid('blk');
  const complexRows = [0, 1].map(() => ({ rid: T.U.uid('row'), exId: resistanceExercise.id, unit: 'kg', sets: 5, reps: 3, weight: 80, pct: null, blkId: complexBlockId }));
  const complexBlock = { id: complexBlockId, label: 'A', sets: 5 };
  const mesoCourse = { name: '复杂训练计划课', rows: T.U.deepClone(complexRows), blocks: [T.U.deepClone(complexBlock)] };
  const completedSession = {
    id: completedId, date: today, name: '即时统计回归课', type: '力量', duration: null,
    time: '09:00', sStatus: 'paused', sElapsed: 60000, sStartDate: null,
    athletes: [athleteB, athleteC], athSrpe: { [athleteC]: 8 },
    rows: T.U.deepClone(mesoCourse.rows), blocks: T.U.deepClone(mesoCourse.blocks),
    results: {}, note: ''
  };
  T.Store.data.sessions.push(completedSession);
  T.Store.alignSessionResults(completedSession);
  const mesoPlanTable = window.document.createElement('div');
  const mesoPlan = T.Store.data.mesos.find((item) => item.id === mesoB);
  mesoPlan.days = [{ date: today, courses: [mesoCourse] }];
  mesoPlanTable.appendChild(T.UI.exerciseTable({ rows: mesoCourse.rows, container: mesoCourse, planMode: true, setEditor: false }));
  assert(!mesoPlanTable.querySelector('.ex-expand') && !mesoPlanTable.querySelector('.ex-add-warm') && !mesoPlanTable.querySelector('.ex-add-work'), '中周期计划不提供逐组编辑入口');
  assert(mesoPlanTable.querySelector('.blk-head')?.textContent.includes('复杂训练 A') && !mesoPlanTable.textContent.includes('超级组'), '中周期组块显示为复杂训练');
  let loadPresentAtSaveNotification = false;
  T.Store.subscribe(() => {
    if (completedSession.sStatus === 'done') {
      loadPresentAtSaveNotification = T.Store.data.loadEntries.some((entry) => entry.sessionId === completedId && entry.athleteId === athleteB);
    }
  });
  T.Views.session.state.date = today;
  T.Views.session.mount(loadView);
  const sessionCard = loadView.querySelector(`[data-ses="${completedId}"]`);
  assert(!sessionCard.querySelector('[data-table] .ex-expand') && !sessionCard.querySelector('[data-table] .ex-add-warm'), '训练课公共计划表不提供逐组编辑入口');
  assert(sessionCard.querySelector('[data-table] .blk-head')?.textContent.includes('复杂训练 A'), '中周期映射后的课程保留复杂训练组块');
  assert(sessionCard.querySelector('.ath-complex-head')?.textContent.includes('复杂训练 A') && sessionCard.querySelector('.ath-complex-head')?.textContent.includes('2 个动作'), '复杂训练分组映射到个人训练计划');
  assert(!sessionCard.textContent.includes('按计划重量') && !sessionCard.textContent.includes('填实际值可记录'), '个人训练计划不显示计划值提示文案');
  assert(!!sessionCard.querySelector('.athlete-plan-table .athlete-action-col') && !!sessionCard.querySelector('.athlete-plan-table .athlete-action-cell'), '动作名称列使用固定宽度横排样式');
  const athleteExpand = sessionCard.querySelector(`[data-ath-expand="${athleteB}:0"]`);
  assert(!!athleteExpand, '逐组展开入口位于个人训练计划');
  athleteExpand.click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 5, '展开时正式组数量默认继承中周期的 5 组');
  const existingSetId = completedSession.results[athleteB][0].setLogs[4].sid;
  completedSession.results[athleteB][0].setLogs[4].w = 79;
  completedSession.results[athleteB][0].setLogs[4].actual = 2;
  completedSession.results[athleteB][0].setLogs[4].own = true;
  sessionCard.querySelector(`[data-ath-id="${athleteB}"].ex-ath-add-warm`).click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 6 && !!sessionCard.querySelector(`[data-ath-id="${athleteB}"].ex-ath-add-work`), '添加热身组后面板保持展开且正式组可继续添加');
  assert(completedSession.results[athleteB][0].setLogs.find((log) => log.sid === existingSetId).w === 79, '在前面插入热身组不串移已有实际重量');
  sessionCard.querySelector(`[data-ath-id="${athleteB}"].ex-ath-add-work`).click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 7, '添加正式组后面板保持展开并保留全部组');
  sessionCard.querySelector(`[data-ath-set-delete="${athleteB}:0:0"]`).click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 6, '删除热身组后其余正式组保留');
  sessionCard.querySelector(`[data-ath-set-delete="${athleteB}:0:5"]`).click();
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 5, '删除单个正式组后其余组保留');
  assert(completedSession.results[athleteB][0].setLogs.find((log) => log.sid === existingSetId).w === 79, '删除其他组后已有完成记录仍与原组对应');
  let currentSetDefs = completedSession.results[athleteB][0].setDefs;
  for (let index = currentSetDefs.length - 1; index >= 0; index--) {
    if (currentSetDefs[index].sid === existingSetId) continue;
    sessionCard.querySelector(`[data-ath-set-delete="${athleteB}:0:${index}"]`).click();
    currentSetDefs = completedSession.results[athleteB][0].setDefs;
  }
  assert(sessionCard.querySelectorAll('.sd-log-row').length === 1 && sessionCard.querySelector('.ath-set-delete').disabled, '保留最后一组正式组且禁用其删除按钮');
  const survivingSetIndex = completedSession.results[athleteB][0].setDefs.findIndex((set) => set.sid === existingSetId);
  let logWeight = sessionCard.querySelector(`[data-sl="${athleteB}:0:${survivingSetIndex}"][data-slf="w"]`);
  logWeight.value = '82'; logWeight.dispatchEvent(new window.Event('change', { bubbles: true }));
  let logActual = sessionCard.querySelector(`[data-sl="${athleteB}:0:${survivingSetIndex}"][data-slf="actual"]`);
  logActual.value = '3'; logActual.dispatchEvent(new window.Event('change', { bubbles: true }));
  const updateRm = sessionCard.querySelector(`[data-uprm="${athleteB}:0"]`);
  assert(!!updateRm, '完成正式组实际数据后出现更新1RM按钮');
  updateRm.click();
  assert(!!T.Store.athRm(athleteB, resistanceExercise.id), '更新1RM按钮写入该运动员的专属1RM');
  sessionCard.querySelector('[data-act="toggle-live"]').click();
  const saveCompletion = window.document.querySelector('.overlay [data-save]');
  assert(!!saveCompletion, '完课确认弹窗打开');
  saveCompletion.click();
  const savedLoad = T.Store.data.loadEntries.find((entry) => entry.sessionId === completedId && entry.athleteId === athleteB);
  const explicitSavedLoad = T.Store.data.loadEntries.find((entry) => entry.sessionId === completedId && entry.athleteId === athleteC);
  assert(completedSession.sStatus === 'done' && !!savedLoad && savedLoad.load === 6 && !!explicitSavedLoad && explicitSavedLoad.load === 8, '完课后立即为每名参训者生成 AU 负荷（默认与个人 sRPE）');
  assert(loadPresentAtSaveNotification, '负荷记录先于 Store 保存通知写入');
  const persistedDB = JSON.parse(window.localStorage.getItem('tpdb'));
  assert(persistedDB.loadEntries.some((entry) => entry.sessionId === completedId && entry.load === 6) && persistedDB.loadEntries.some((entry) => entry.sessionId === completedId && entry.load === 8), '全体参训者负荷记录与训练课状态同次持久化');
  T.Views.load.mount(loadView);
  loadView.querySelector('#loadDateFrom').value = today;
  loadView.querySelector('#loadDateTo').value = today;
  loadView.querySelector('#loadDateFrom').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert(loadView.querySelector('.load-metric-grid .load-metric:first-child .v').textContent.startsWith('6'), '完课后进入负荷看板立即看到当日 AU');
  assert(loadView.querySelector('.load-metric-grid .load-metric:nth-child(5) .v').textContent.startsWith('1'), '完课后立即计入当日训练课次');
  loadView.querySelector('#modeTeam').click();
  assert(loadView.querySelector('.load-metric-grid .load-metric:first-child .v').textContent.startsWith('14'), '团队模式汇总所有当前计划参训者 AU');

  // 退出示例：空白库载入 → 退出 → 回到空白库
  T.Store.data = T.Store.defaultDB();
  T.Store.data.categories1 = T.Store.seedCategories();
  T.Store.data.exercises = T.Store.seedExercises();
  T.Store.data.goals = T.Store.defaultGoals();
  T.seedDemo();
  assert(!!T.Store.data.settings.demo && T.Store.data.settings.demo.athleteIds.length === 15, '载入示例后记录示例清单（15 名运动员）');
  window.exitDemo();
  const dd = T.Store.data;
  assert(dd.macros.length === 0 && dd.mesos.length === 0 && dd.micros.length === 0, '退出示例后计划/中周期/小周期清空');
  assert(dd.sessions.length === 0 && dd.loadEntries.length === 0, '退出示例后训练课与负荷记录清空');
  assert(dd.profiles.length === 0 && dd.tests.length === 0 && dd.athletes.length === 0, '退出示例后测试档案与示例运动员清空');
  assert(Object.keys(dd.athleteRm).length === 0, '退出示例后示例运动员 1RM 清空');
  assert(!dd.exercises.some((e) => e.cat1 === '篮球专项') && !dd.categories1.some((c) => c.name === '篮球专项'), '退出示例后篮球专项动作与分类移除');
  assert(!dd.settings.demo && dd.settings.activeMacroId === null, '退出示例后清除示例标记并复位当前计划');

  // 合并式载入：用户先有自己的计划 → 载入示例不覆盖 → 退出示例后用户数据完整保留并切回
  dd.macros.push({ id: 'mac_u', name: '用户自建计划', sportCat: '球类·小球', sport: '羽毛球', startDate: '2026-09-01', endDate: '2027-06-30', cycles: [], compDates: [], testDates: [], weekPlan: {}, goalBlocks: [], athletes: [] });
  dd.mesos.push({ id: 'mes_u', macroId: 'mac_u', name: '用户中周期', type: '积累', startDate: '2026-09-07', endDate: '2026-10-04', goals: { primary: [], secondary: [] }, days: [] });
  dd.athletes.push({ id: 'ath_u', macroId: 'mac_u', name: '张三', sport: '羽毛球', gender: '男', birth: '2000-01-01', note: '' });
  dd.settings.activeMacroId = 'mac_u';
  T.seedDemo();
  assert(dd.macros.length === 2 && dd.macros.some((m) => m.id === 'mac_u') && dd.settings.activeMacroId === dd.settings.demo.macroId, '载入示例不覆盖用户计划，且切到示例计划');
  assert(dd.athletes.some((a) => a.id === 'ath_u') && dd.mesos.some((m) => m.id === 'mes_u'), '载入示例保留用户运动员与中周期');
  assert(T.seedDemo() === false, '示例已载入时重复载入不生效');
  window.exitDemo();
  assert(dd.macros.length === 1 && dd.macros[0].id === 'mac_u' && dd.mesos.length === 1 && dd.athletes.length === 1, '退出示例后用户计划/中周期/运动员完整保留');
  assert(dd.settings.activeMacroId === 'mac_u' && !dd.settings.demo, '退出示例后切回用户载入前的计划');

  // ---------- Excel 测试导入：纯函数清洗与宽表构建记录 ----------
  const IT = T.Views.importTest._test;
  assert(typeof window.XLSX === 'object' && !!window.XLSX.read, 'SheetJS 已加载');
  assert(IT.parseDate('2026/10/8', 2026) === '2026-10-08', '日期解析 2026/10/8');
  assert(IT.parseDate('2026年10月8日', 2026) === '2026-10-08', '日期解析中文');
  assert(IT.parseDate('10月8日', 2026) === '2026-10-08', '日期解析月日补年');
  assert(IT.parseDate(45292, 2026) === '2024-01-01', '日期解析 Excel 序列号');
  assert(IT.parseNum('12.5s').value === 12.5 && IT.parseNum('≥50').value === 50, '数值解析剥离单位/符号');
  assert(IT.parseNum('-').empty === true && IT.parseNum('未测').empty === true, '空记号（-/未测）跳过不计错');
  assert(IT.parseNum('abc').bad === 'abc', '非数字标记为错误');
  const tgts = IT.listTargets();
  assert(tgts.some((t) => t.name === '30m冲刺' && t.mode === 'named'), '目标库含 30m冲刺');
  assert(IT.suggestTarget('30米', tgts) && IT.suggestTarget('30米', tgts).name === '30m冲刺', '别名 30米 → 30m冲刺');
  const impMatrix = [
    ['XX 篮球队体测表', null, null, null],
    ['姓名', '30米', '纵跳', '备注'],
    ['张三', '4.2', '60', '正常'],
    ['李四', '4.5', '未测', ''],
    [null, 'x', 'x', '有数据但无名']
  ];
  assert(IT.detectHeaderRow(impMatrix) === 1, '表头行自动识别为第 2 行');
  const t30 = tgts.find((t) => t.name === '30m冲刺');
  const tVJ = tgts.find((t) => t.name === '纵跳');
  const impActions = new Map([['张三', { t: 'match', id: 'ath_u' }], ['李四', { t: 'new' }]]);
  const built = IT.buildRecords({
    dataRows: impMatrix.slice(2), rnoBase: 3, format: 'wide',
    ciName: 0, ciName2: -1, ciDate: -2, fixedDate: '2026-10-01', year: 2026,
    cols: [
      { ci: 1, mode: t30.mode, key: t30.key, name: t30.name, unit: t30.unit, invert: true },
      { ci: 2, mode: tVJ.mode, key: tVJ.key, name: tVJ.name, unit: tVJ.unit, invert: false }
    ],
    targets: tgts, actions: impActions, dup: 'overwrite'
  });
  assert(built.validItems === 3, '宽表构建 3 个有效数据点（未测/空单元格跳过）');
  assert(built.records.length === 2 && built.newAths.length === 1 && built.newAths[0] === '李四', '记录 2 行，李四识别为新建运动员');
  assert(built.errors.length === 1 && /姓名为空/.test(built.errors[0].msg), '有数据无名的行报错并跳过');
  // 冲突探查：给张三写入一条同日 30m 成绩后再构建 → 1 处冲突
  dd.profiles.push({ id: 'pf_t', athleteId: 'ath_u', date: '2026-10-01', custom: [{ name: '30m冲刺', value: 4.4, unit: 's' }] });
  const built2 = IT.buildRecords({
    dataRows: impMatrix.slice(2, 3), rnoBase: 3, format: 'wide',
    ciName: 0, ciName2: -1, ciDate: -2, fixedDate: '2026-10-01', year: 2026,
    cols: [{ ci: 1, mode: t30.mode, key: t30.key, name: t30.name, unit: 's', invert: true }],
    targets: tgts, actions: new Map([['张三', { t: 'match', id: 'ath_u' }]]), dup: 'overwrite'
  });
  assert(built2.conflictN === 1 && built2.records[0].items[0].conflict === true, '同人同日同项目识别为冲突');

  // 长表（项目名列 + 成绩列 + 单位列）：系统项目精确匹配，陌生项目自动建自定义，坏值报错
  const longMatrix = [
    ['张三', '30m冲刺', '4.3', '秒'],
    ['李四', '陌生专项项目', '12', '个'],
    ['张三', '纵跳', 'abc', 'cm']
  ];
  const builtLong = IT.buildRecords({
    dataRows: longMatrix, rnoBase: 2, format: 'long',
    ciName: 0, ciName2: -1, ciDate: -2, fixedDate: '2026-10-01', year: 2026,
    ciItem: 1, ciValue: 2, ciUnit: 3,
    targets: tgts, actions: new Map([['张三', { t: 'match', id: 'ath_u' }], ['李四', { t: 'new' }]]), dup: 'overwrite'
  });
  assert(builtLong.validItems === 2 && builtLong.records.length === 2, '长表构建 2 个有效数据点');
  const li30 = builtLong.records[0].items[0];
  assert(li30.name === '30m冲刺' && li30.unit === 's' && li30.invert === true, '长表系统项目匹配并携带单位/方向（秒→越小越好）');
  assert(builtLong.newItems.includes('陌生专项项目'), '长表陌生项目自动列为自定义');
  assert(builtLong.errors.length === 1 && /abc/.test(builtLong.errors[0].msg), '长表坏值单元格报错');

  // ---------- 自动识别管线：A 宽表+标题行+日期列 / B 长表五列 / C 表头第3行+sheet名日期 ----------
  assert(typeof IT.autoAnalyze === 'function' && typeof IT.autoAnalyzeSheet === 'function' && typeof IT.autoLocate === 'function', '自动识别管线已导出');
  // A 类：宽表 + 标题行 + 日期列 + 备注列（列名用别名：30米 / 纵跳摸高）
  const wsA = [
    ['Sharp Fit 队 2026年6月 体测', null, null, null, null],
    ['姓名', '测试日期', '30米', '纵跳摸高', '备注'],
    ['张三', '2026/6/1', '4.4', '58', '状态好'],
    ['赵六', '2026/6/1', '4.6', '未测', ''],
    ['张三', '2026/6/8', '4.3', '59', '']
  ];
  const aA = IT.autoAnalyzeSheet('A宽表.xlsx', '6月体测', wsA, tgts);
  assert(aA.ok && aA.format === 'wide' && aA.headerRow === 1, 'A：宽表识别（标题行下方为表头）');
  assert(aA.stats.items === 5 && aA.stats.rows === 3 && aA.stats.errN === 0, 'A：统计 5 数据点/3 记录行/0 问题行 实际 ' + JSON.stringify(aA.stats));
  assert(aA.stats.athMatch === 1 && aA.stats.athNew === 1 && aA.newAths[0] === '赵六', 'A：张三匹配档案、赵六标记新建');
  assert(aA.stats.dateFrom === '2026-06-01' && aA.stats.dateTo === '2026-06-08', 'A：日期范围 2026-06-01 ~ 2026-06-08');
  const aA30 = aA.records[0].items.find((it) => it.name === '30m冲刺');
  const aAVj = aA.records[0].items.find((it) => it.field === 'verticalJump');
  assert(aA30 && aA30.value === 4.4 && aA30.unit === 's' && aA30.invert === true, 'A：30米 别名命中 30m冲刺（单位/方向随目标）');
  assert(aAVj && aAVj.value === 58, 'A：纵跳摸高 别名命中纵跳固定字段');
  assert(aA.maps.some((m) => m.kind === 'sys' && m.name === '30m冲刺') && aA.ignored.join() === '备注', 'A：映射摘要含系统项目、备注列忽略');
  // B 类：长表（运动员/测试日期/测试项目/成绩/单位 五列明细）
  const wsB = [
    ['运动员', '测试日期', '测试项目', '成绩', '单位'],
    ['王五', '2026-06-01', '30m冲刺', '4.5', '秒'],
    ['王五', '2026-06-01', '深蹲1RM', '100', 'kg'],
    ['赵六', '2026-06-02', '卧推1RM', '80', '公斤'],
    ['赵六', '2026-06-02', '纵跳', '55', 'cm'],
    ['王五', '2026-06-03', '陌生项目Z', '12', 'cm']
  ];
  const aB = IT.autoAnalyzeSheet('B长表.xlsx', '明细', wsB, tgts);
  assert(aB.ok && aB.format === 'long' && aB.headerRow === 0, 'B：长表识别（五列角色定位）');
  assert(aB.stats.items === 5 && aB.stats.rows === 5 && aB.stats.dateFrom === '2026-06-01' && aB.stats.dateTo === '2026-06-03', 'B：统计与日期范围 实际 ' + JSON.stringify(aB.stats));
  const bItems = aB.records.flatMap((r) => r.items);
  assert(bItems.some((it) => it.name === '深蹲1RM' && it.mode === 'rm1'), 'B：深蹲1RM 识别为 1RM 目标');
  assert(bItems.some((it) => it.name === '30m冲刺' && it.unit === 's' && it.invert === true), 'B：系统项目携带单位/方向');
  assert(aB.newItems.includes('陌生项目Z') && aB.maps.some((m) => m.kind === 'new' && m.name === '陌生项目Z'), 'B：陌生项目列为新建自定义项目');
  assert(aB.stats.athMatch === 0 && aB.stats.athNew === 2, 'B：王五/赵六 均为新建');
  // C 类：列顺序打乱、表头在第 3 行、无日期列（日期从 sheet 名兜底）
  const wsC = [
    ['6月15日 场地测试', null, null, null],
    [null, null, null, null],
    ['纵跳摸高', '30米', '姓名', '备注'],
    ['63', '4.7', '钱七', ''],
    ['70', '4.9', '孙八', '补测']
  ];
  const Y = new Date().getFullYear();
  assert(IT.guessFixedDate('6月15日', wsC, 2, Y) === `${Y}-06-15`, 'C：sheet 名推断整表统一日期');
  const aC = IT.autoAnalyzeSheet('C多sheet.xlsx', '6月15日', wsC, tgts);
  assert(aC.ok && aC.format === 'wide' && aC.headerRow === 2, 'C：第 3 行表头识别');
  assert(aC.stats.items === 4 && aC.stats.rows === 2 && aC.stats.dateFrom === `${Y}-06-15` && aC.stats.dateTo === `${Y}-06-15`, 'C：4 数据点/2 行/统一日期 实际 ' + JSON.stringify(aC.stats));
  assert(aC.records[0].rawName === '钱七' && aC.records[0].items.length === 2, 'C：姓名列在打乱后的第 3 列，每人 2 个数据点');
  assert(aC.ignored.join() === '备注', 'C：备注列忽略');
  // 多 sheet 文件整体识别 + 真实工作簿（autoAnalyze）与跳过原因记录
  const mix = IT.analyzeSheets('混合.xlsx', [{ name: 'A', matrix: wsA }, { name: 'B', matrix: wsB }, { name: '6月15日', matrix: wsC }], tgts);
  assert(mix.length === 3 && mix.every((s) => s.ok) && mix.map((s) => s.format).join() === 'wide,long,wide', '混合文件三个 sheet 全部识别为对应排版');
  const wbAuto = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wbAuto, window.XLSX.utils.aoa_to_sheet(wsC), '6月15日');
  window.XLSX.utils.book_append_sheet(wbAuto, window.XLSX.utils.aoa_to_sheet([['姓名', '体重'], ['王五', '']]), '无日期');
  const abAuto = window.XLSX.write(wbAuto, { bookType: 'xlsx', type: 'array' });
  const resAuto = await IT.autoAnalyze([
    { name: '多sheet.xlsx', arrayBuffer: async () => abAuto },
    { name: '坏文件.xlsx', arrayBuffer: async () => new ArrayBuffer(4) }
  ]);
  assert(resAuto.length === 2 && resAuto[0].sheets.length === 2, 'autoAnalyze：两个文件、第一个文件两个 sheet');
  const rAuto0 = resAuto[0].sheets[0];
  assert(rAuto0.ok && rAuto0.stats.items === 4 && rAuto0.format === 'wide', 'autoAnalyze：真实 xlsx 的 sheet 识别出统一记录');
  assert(!resAuto[0].sheets[1].ok && /日期/.test(resAuto[0].sheets[1].reason), 'autoAnalyze：无日期 sheet 跳过并记录原因：' + resAuto[0].sheets[1].reason);
  assert(resAuto[1].sheets.length === 1 && !resAuto[1].sheets[0].ok, 'autoAnalyze：坏文件记为跳过，不中断其余文件');

  console.log(errors.length ? '\n== 有失败项 ==' : '\n== 全部通过 ==');
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(2); });
