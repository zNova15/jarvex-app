// ═══════════════════════════════════════════════════════════════════
// JARVEX — Adaptador de Cloudflare R2 para las fotos de evidencias.
//
// Las fotos se mudan de Supabase Storage a R2 ($0 egress para siempre). Este
// módulo concentra TODA la lógica nueva; los call-sites (EvidenceUploader,
// evidencias-url) solo lo llaman, para tocar lo mínimo de esos archivos.
//
// El bucket R2 es privado. Un endpoint en Vercel (`/api/r2`) valida la sesión
// de Supabase y devuelve una URL prefirmada (GET para ver, PUT para subir). Los
// bytes viajan navegador ↔ R2 directo; nada pasa por Vercel ni Supabase.
//
// Rollout por flag `VITE_R2_EVIDENCIAS` (build-time):
//   - 'off'  (default): todo sigue en Supabase. Desplegar no cambia nada.
//   - 'read': se LEE de R2 con fallback a Supabase. La subida sigue en Supabase.
//   - 'on'   : se lee Y se sube a R2.
// El fallback en lectura hace que la fase 'read' sea segura aunque una foto no
// esté aún migrada (R2 falla → se firma en Supabase).
// ═══════════════════════════════════════════════════════════════════
import { supabase } from './supabase';

const MODE = (import.meta.env?.VITE_R2_EVIDENCIAS || 'off').toLowerCase();

export function r2ReadEnabled() { return MODE === 'read' || MODE === 'on'; }
export function r2WriteEnabled() { return MODE === 'on'; }

async function accessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch { return null; }
}

// Pide al endpoint una URL prefirmada. Devuelve { url } o { url:null, status,
// error } si algo falla (para que el caller decida el fallback). Nunca tira.
// Un 404 significa "el objeto no está en R2" (evidencia aún no migrada) → null
// → el caller cae a Supabase. 503 = R2 no configurado. 401 = sesión, 403 =
// permiso. En todos los casos el caller decide, acá nunca se rompe.
// El status viaja (tanda E): el subidor distingue una sesión vencida o un
// corte de la red de un rechazo de verdad, y solo este último cuenta.
async function firmarDetalle(action, path, extra) {
  const token = await accessToken();
  if (!token) return { url: null, status: 401, error: 'sin sesión' };
  try {
    const resp = await fetch('/api/r2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, path, ...(extra || {}) }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) return { url: null, status: resp.status, error: data?.error || `HTTP ${resp.status}` };
    return { url: data?.url || null, status: resp.status, error: data?.url ? null : 'respuesta sin url' };
  } catch (e) {
    return { url: null, status: 0, error: `error de red: ${e?.message || e}` };
  }
}

async function firmar(action, path, extra) {
  return (await firmarDetalle(action, path, extra)).url;
}

// URL prefirmada de LECTURA (7 días) para un path del bucket, o null si falla.
export async function getR2SignedGetUrl(path) {
  if (!r2ReadEnabled() || !path) return null;
  return firmar('sign_get', path);
}

// Sube un blob a R2 en `path`. Devuelve { ok } o { ok:false, error, status, etapa }.
// Pide una URL prefirmada de PUT y hace el PUT directo al bucket.
// Manda tipo y tamaño al firmar para que el servidor los valide (sin eso se
// podía dejar cualquier objeto de hasta 5 GB en el bucket).
export async function uploadToR2(path, blob, contentType) {
  const firma = await firmarDetalle('sign_put', path, { contentType, size: blob?.size });
  const url = firma.url;
  if (!url) {
    return { ok: false, etapa: 'firma', status: firma.status, error: `No se pudo firmar la subida a R2 (${firma.error})` };
  }
  try {
    const resp = await fetch(url, {
      method: 'PUT',
      body: blob,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        // 30 días: la evidencia es INMUTABLE (el path embebe su id). R2 guarda
        // este header como metadata y lo devuelve en cada GET. Sin él el
        // navegador usa frescura heurística y revalida casi en cada carga
        // (era justo lo que `cacheControl: '2592000'` evitaba en Supabase).
        'Cache-Control': 'public, max-age=2592000, immutable',
      },
    });
    if (!resp.ok) return { ok: false, etapa: 'put', status: resp.status, error: `PUT a R2 falló: HTTP ${resp.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, etapa: 'put', status: 0, error: `PUT a R2 error de red: ${e?.message || e}` };
  }
}
