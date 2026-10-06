const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
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
