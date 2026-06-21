// Config local del módulo Drive (NO se commitea — ver .gitignore).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.resolve(__dirname, '.drive-config.json');

/** ID de la carpeta compartida raíz (env DRIVE_ROOT_FOLDER_ID o .drive-config.json). */
export function getRootFolderId() {
  if (process.env.DRIVE_ROOT_FOLDER_ID) return process.env.DRIVE_ROOT_FOLDER_ID;
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).rootFolderId || null; } catch { return null; }
}

export function setRootFolderId(id) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  cfg.rootFolderId = id;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return id;
}
