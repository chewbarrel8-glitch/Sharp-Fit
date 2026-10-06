// 将 echarts 发行版复制到 src/vendor，保证应用完全离线可用
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'node_modules', 'echarts', 'dist', 'echarts.min.js');
const destDir = path.join(__dirname, '..', 'src', 'vendor');
const dest = path.join(destDir, 'echarts.min.js');

try {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[postinstall] echarts.min.js ->', dest);
} catch (e) {
  console.warn('[postinstall] 复制 echarts 失败（可忽略，稍后重试 npm install）:', e.message);
}
