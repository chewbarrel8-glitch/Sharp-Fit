// 工具与日期
// 视图注册表（须在所有视图脚本之前定义）
window.Views = {};

const U = {
  uid: (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  WD: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  pad: (n) => String(n).padStart(2, '0'),
  // 均使用本地时区安全构造
  d(str) { const [y, m, dd] = str.split('-').map(Number); return new Date(y, m - 1, dd); },
  str(date) { return `${date.getFullYear()}-${U.pad(date.getMonth() + 1)}-${U.pad(date.getDate())}`; },
  today() { return U.str(new Date()); },
  addDays(str, n) { const d = U.d(str); d.setDate(d.getDate() + n); return U.str(d); },
  wd(str) { return U.WD[U.d(str).getDay()]; },
  md(str) { const [y, m, dd] = str.split('-'); return `${y}/${Number(m)}/${Number(dd)}`; },
  cn(str) { const [y, m, dd] = str.split('-'); return `${y}年${Number(m)}月${Number(dd)}日`; },
  between(str, a, b) { return str >= a && str <= b; },
  // 含头含尾
  daysBetween(a, b) { return Math.round((U.d(b) - U.d(a)) / 86400000) + 1; },
  // 本周周一
  weekStart(str) { const d = U.d(str); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return U.str(d); },
  fmt(n, digits = 0) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: digits });
  },
  clamp(v, a, b) { return Math.max(a, Math.min(b, v)); },
  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  // 按周一分组
  weekKey(str) { return U.weekStart(str); },
  round25(v) { return Math.round(v / 2.5) * 2.5; },
  deepClone: (o) => JSON.parse(JSON.stringify(o)),
  sum(arr, f) { return arr.reduce((s, x) => s + (f ? Number(f(x)) || 0 : Number(x) || 0), 0); },
  avg(arr, f) { return arr.length ? U.sum(arr, f) / arr.length : 0; },
  // 训练目标彩色标记 chips：level='primary'|'secondary'，inh=true 继承自上级周期（弱化显示）
  // list 为空时返回空字符串（不显示「未设定」占位，避免只选一个目标时出现多余提示）
  goalChips(list, level, inh) {
    return (list && list.length)
      ? list.map((g) => `<span class="goal-chip ${level}${inh ? ' inh' : ''}" style="--gh:${g.hue != null ? g.hue : 200}" title="${level === 'primary' ? '主要目标' : '次要目标'}${inh ? ' · 来自上级周期' : ''}">${U.esc(g.name)}</span>`).join('')
      : '';
  },
  // 运动员头像：上传过照片(a.avatar 为 dataURL)时渲染 img，否则回退姓名首字
  // style 为内联尺寸/字号覆盖（各使用点大小不一）；gradient=true 时首字底用品牌渐变
  avatar(a, style = '', gradient = false) {
    const inline = (gradient ? 'background:linear-gradient(135deg,var(--accent),var(--accent2));' : '') + style;
    const st = inline ? ` style="${inline}"` : '';
    if (a && a.avatar) return `<span class="avatar has-img"${st}><img src="${a.avatar}" alt="${U.esc(a.name || '')}"></span>`;
    return `<span class="avatar"${st}>${U.esc(((a && a.name) || '?')[0])}</span>`;
  },
  // 读取本地图片 → 居中裁剪正方形 → 压缩为 160px JPEG dataURL（直接存入 db.json，无需文件服务）
  readAvatar(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('请选择图片文件')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片解析失败'));
        img.onload = () => {
          const S = 160;
          const side = Math.min(img.width, img.height);
          const canvas = document.createElement('canvas');
          canvas.width = S; canvas.height = S;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, S, S);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
};

// $ 系列快捷选择器
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
