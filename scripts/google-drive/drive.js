// ═══════════════════════════════════════════════════════════════════
// JARVEX — Módulo de Google Drive (service account)
// Funciones modulares para crear carpetas, subir / borrar / listar archivos
// dentro de una carpeta compartida de Drive. Node-only (NO se importa desde el
// cliente: la clave privada del service account jamás debe llegar al navegador).
//
// Setup (una vez):
//  1) Compartí la carpeta de Drive con el email del service account como Editor:
//       claude-drive-jarvex-proyect@proyecto-guardar-jarvex.iam.gserviceaccount.com
//  2) Copiá el ID de esa carpeta (de la URL .../folders/<ID>) a DRIVE_ROOT_FOLDER_ID
//     (env) o a scripts/google-drive/.drive-config.json { "rootFolderId": "<ID>" }
//  3) credenciales.json debe estar en JARVEX/ (o seteá GOOGLE_CREDENTIALS_PATH).
//
// CAVEAT de service accounts: no tienen cuota de almacenamiento propia en un
// Drive personal. Si subir falla con "storage quota exceeded", la carpeta debe
// vivir en un Shared Drive (Workspace) compartido con el SA, o usar OAuth.
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
// supportsAllDrives/includeItemsFromAllDrives → funciona tanto en Mi unidad como en Unidades compartidas.
const SHARED = { supportsAllDrives: true, includeItemsFromAllDrives: true };

/** Resuelve la ruta del credenciales.json probando ubicaciones comunes. */
export function resolverCredenciales(custom) {
  const candidatos = [
    custom,
    process.env.GOOGLE_CREDENTIALS_PATH,
    path.resolve(__dirname, 'credenciales.json'),
    path.resolve(__dirname, '../../credenciales.json'),      // jarvex-app/credenciales.json
    path.resolve(__dirname, '../../../credenciales.json'),   // JARVEX/credenciales.json (carpeta del programa)
  ].filter(Boolean);
  for (const c of candidatos) { try { if (fs.existsSync(c)) return c; } catch {} }
  throw new Error('No encontré credenciales.json. Seteá GOOGLE_CREDENTIALS_PATH o ponelo en JARVEX/credenciales.json.\nProbé:\n  - ' + candidatos.join('\n  - '));
}

/** Cliente Drive autenticado con el service account. */
export async function getDrive(credPath) {
  const keyFile = resolverCredenciales(credPath);
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
  const client = await auth.getClient();
  return google.drive({ version: 'v3', auth: client });
}

/** Email del service account (para compartirle la carpeta). */
export function emailServiceAccount(credPath) {
  const keyFile = resolverCredenciales(credPath);
  try { return JSON.parse(fs.readFileSync(keyFile, 'utf8')).client_email || null; } catch { return null; }
}

/** Busca una carpeta por nombre (opcionalmente bajo un padre). Devuelve {id,name} o null. */
export async function buscarCarpeta(drive, nombre, parentId) {
  const safe = String(nombre).replace(/'/g, "\\'");
  const q = [`mimeType='${FOLDER_MIME}'`, `name='${safe}'`, 'trashed=false', parentId ? `'${parentId}' in parents` : null].filter(Boolean).join(' and ');
  const res = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 1, ...SHARED });
  return res.data.files?.[0] || null;
}

/** Crea una carpeta (bajo parentId si se da). Devuelve {id,name,webViewLink}. */
export async function crearCarpeta(drive, nombre, parentId) {
  const res = await drive.files.create({
    requestBody: { name: nombre, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) },
    fields: 'id,name,webViewLink', ...SHARED,
  });
  return res.data;
}

/** Busca-o-crea una carpeta (idempotente). */
export async function asegurarCarpeta(drive, nombre, parentId) {
  return (await buscarCarpeta(drive, nombre, parentId)) || (await crearCarpeta(drive, nombre, parentId));
}

/**
 * Sube un archivo. Pasá filePath (ruta local) o buffer (Buffer/Uint8Array).
 * @returns {Promise<{id,name,webViewLink,size}>}
 */
export async function subirArchivo(drive, { filePath, buffer, nombre, mimeType, parentId }) {
  if (!filePath && !buffer) throw new Error('subirArchivo: pasá filePath o buffer');
  const name = nombre || (filePath ? path.basename(filePath) : 'archivo');
  const media = {
    mimeType: mimeType || 'application/octet-stream',
    body: buffer ? Readable.from(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)) : fs.createReadStream(filePath),
  };
  const res = await drive.files.create({
    requestBody: { name, ...(parentId ? { parents: [parentId] } : {}) },
    media, fields: 'id,name,webViewLink,size', ...SHARED,
  });
  return res.data;
}

/** Borra un archivo/carpeta. Por defecto a la papelera; permanente:true lo elimina del todo. */
export async function borrarArchivo(drive, fileId, { permanente = false } = {}) {
  if (permanente) { await drive.files.delete({ fileId, ...SHARED }); return { id: fileId, deleted: true }; }
  const res = await drive.files.update({ fileId, requestBody: { trashed: true }, fields: 'id,name,trashed', ...SHARED });
  return res.data;
}

/** Lista el contenido directo de una carpeta (carpetas primero). */
export async function listar(drive, parentId) {
  const q = [parentId ? `'${parentId}' in parents` : null, 'trashed=false'].filter(Boolean).join(' and ');
  const res = await drive.files.list({
    q: q || 'trashed=false',
    fields: 'files(id,name,mimeType,size,modifiedTime,webViewLink)',
    pageSize: 1000, orderBy: 'folder,name', ...SHARED,
  });
  return res.data.files || [];
}

/** Metadata de un archivo/carpeta por id. */
export async function metadata(drive, fileId) {
  const res = await drive.files.get({ fileId, fields: 'id,name,mimeType,size,parents,webViewLink,modifiedTime', ...SHARED });
  return res.data;
}
