const fs = require('node:fs');
const path = require('node:path');

function backupCorruptDb(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const dir = path.dirname(filePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(dir, `${base}.corrupt-${timestamp}${ext}`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

function safeReadJson(filePath) {
  if (!filePath) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw || !raw.trim()) return null;
    return JSON.parse(raw);
  } catch (err) {
    backupCorruptDb(filePath);
    console.error('Failed to read DB file, backup created:', filePath, err.message);
    return null;
  }
}

function writeJsonFileAtomic(filePath, data) {
  if (!filePath) throw new Error('filePath is required');
  const targetDir = path.dirname(filePath);
  fs.mkdirSync(targetDir, { recursive: true });
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempFile, filePath);
  return filePath;
}

module.exports = {
  backupCorruptDb,
  safeReadJson,
  writeJsonFileAtomic,
};
