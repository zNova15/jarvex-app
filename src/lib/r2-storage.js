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

// Pide al endpoint una URL prefirmada. Devuelve la URL (string) o null si algo
// falla (para que el caller decida el fallback). Nunca tira.
// Un 404 significa "el objeto no está en R2" (evidencia aún no migrada) → null
// → el caller cae a Supabase. 503 = R2 no configurado. 401/403 = sesión o
// permiso. En todos los casos el caller decide, acá nunca se rompe.
async function firmar(action, path, extra) {
  const token = await accessToken();
  if (!token) return null;
  try {
    const resp = await fetch('/api/r2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, path, ...(extra || {}) }),
    });
    if (!resp.ok) return null;
    const data = await resp.json().catch(() => null);
    return data?.url || null;
  } catch { return null; }
}

// URL prefirmada de LECTURA (7 días) para un path del bucket, o null si falla.
export async function getR2SignedGetUrl(path) {
  if (!r2ReadEnabled() || !path) return null;
  return firmar('sign_get', path);
}

// Sube un blob a R2 en `path`. Devuelve { ok } o { ok:false, error }.
// Pide una URL prefirmada de PUT y hace el PUT directo al bucket.
// Manda tipo y tamaño al firmar para que el servidor los valide (sin eso se
// podía dejar cualquier objeto de hasta 5 GB en el bucket).
export async function uploadToR2(path, blob, contentType) {
  const url = await firmar('sign_put', path, { contentType, size: blob?.size });
  if (!url) return { ok: false, error: 'No se pudo firmar la subida a R2' };
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
    if (!resp.ok) return { ok: false, error: `PUT a R2 falló: HTTP ${resp.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `PUT a R2 error de red: ${e?.message || e}` };
  }
}
