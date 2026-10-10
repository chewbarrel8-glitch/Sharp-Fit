const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { safeReadJson, writeJsonFileAtomic } = require('./db-guard');

function dbPath() {
  return path.join(app.getPath('userData'), 'db.json');
}

ipcMain.handle('db:load', () => safeReadJson(dbPath()));

ipcMain.handle('db:save', (e, data) => {
  try {
    writeJsonFileAtomic(dbPath(), data);
    return true;
  } catch (err) {
    console.error('save db failed', err);
    return false;
  }
});

// 导出文件：主进程直写下载目录（避免渲染进程 blob 下载受浏览器策略影响）
ipcMain.handle('export:file', (e, { name, data }) => {
  try {
    const p = path.join(app.getPath('downloads'), name);
    fs.writeFileSync(p, Buffer.from(data));
    return { ok: true, path: p };
  } catch (err) {
    console.error('export file failed', err);
    return { ok: false };
  }
});

// 导出文件（另存为）：弹出系统「存储为」对话框，由用户选择保存位置与文件名
ipcMain.handle('export:saveAs', async (e, { name, data, filters }) => {
  try {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: filters || [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, Buffer.from(data));
    return { ok: true, path: r.filePath };
  } catch (err) {
    console.error('export saveAs failed', err);
    return { ok: false, msg: err.message };
  }
});

// 应用信息：版本号 / 数据目录 / 下载目录（设置页展示）
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  userData: app.getPath('userData'),
  downloads: app.getPath('downloads')
}));

// 在系统文件管理器中打开目录（设置页「打开数据文件夹」）
ipcMain.handle('shell:openPath', (e, p) => shell.openPath(p || app.getPath('userData')));

// 自动备份：把当前 db.json 复制到 userData/backups/db-YYYYMMDD.json，每天最多一份，保留最近 7 份
ipcMain.handle('db:backup', () => {
  try {
    const src = dbPath();
    if (!fs.existsSync(src)) return { ok: false, msg: '数据文件不存在' };
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const dest = path.join(dir, 'db-' + stamp + '.json');
    fs.copyFileSync(src, dest);
    // 仅保留最近 7 份
    const olds = fs.readdirSync(dir).filter((f) => /^db-\d{8}\.json$/.test(f)).sort().reverse();
    olds.slice(7).forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* 忽略 */ } });
    return { ok: true, path: dest, dir };
  } catch (err) {
    console.error('backup failed', err);
    return { ok: false, msg: err.message };
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1200,
    minHeight: 780,
    title: 'Sharp Fit',
    backgroundColor: '#0B0E13',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  if (process.argv.includes('--devtools')) win.webContents.openDevTools();
}

app.whenReady().then(() => {
  const template = [
    { label: 'Sharp Fit', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
