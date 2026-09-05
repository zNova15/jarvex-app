// ═══════════════════════════════════════════════════════════════════
// JARVEX — URL mostrable de una evidencia (foto/PDF)
//
// El bucket de Storage 'evidencias' es PRIVADO. El uploader guarda en
// `url_archivo` un getPublicUrl que por sí solo NO sirve en un bucket
// privado (devuelve 400/403). Además, tras subir, el blob LOCAL se borra
// (EvidenceUploader). Por eso, para ver una evidencia (en el mismo equipo
// tras subirla, o en OTRO equipo que la pulleó) hay que:
//   1) usar el blob local si todavía está, o
//   2) FIRMAR el path del Storage (createSignedUrl).
// Antes, varios visores usaban `url_archivo` crudo → imagen rota salvo en
// la pantalla de Evidencias (que sí firmaba). Este helper unifica eso.
// ═══════════════════════════════════════════════════════════════════
import { db } from '../db/jarvex.db';
import { supabase } from './supabase';
import { getR2SignedGetUrl, r2ReadEnabled } from './r2-storage';

// Saca el path dentro del bucket de una url_archivo de evidencia
// (.../object/(public|sign)/evidencias/<obra>/<aaaa-mm>/<id>.<ext>?token=…).
export function pathDeEvidencia(url) {
  if (!url) return null;
  const marca = '/evidencias/';
  const i = String(url).indexOf(marca);
  if (i === -1) return null;
  let p = String(url).slice(i + marca.length);
  const q = p.indexOf('?');
  if (q !== -1) p = p.slice(0, q);
  return p || null;
}

// ─── Caché PERSISTENTE de signed URLs (anti-egress) ──────────────────
// El bucket es privado, así que cada visualización firma el path. Si se firma
// con un token NUEVO en cada render, la URL cambia siempre y el navegador (y el
// CDN de Storage) NUNCA cachean la imagen → la re-descargan completa una y otra
// vez = EGRESS disparado (el exceso del plan venía de acá). Para evitarlo,
// reusamos la MISMA signed URL por path mientras siga válida: URL estable → el
// navegador cachea la imagen entre renders y recargas → egress mínimo.
// 7 días (antes 24h): la URL firmada se cachea en localStorage y se REUTILIZA
// hasta su exp — mientras no cambie, el cache del Service Worker (que indexa
// por URL completa) sirve el archivo sin volver a descargarlo de Supabase.
// Con 24h, cada día se firmaba una URL nueva → cache miss → re-descarga del
// PDF entero en cada dispositivo. Egress puro desperdiciado.
const _SIGNED_TTL = 7 * 86400;
const _SIGNED_LS_KEY = 'jx_signed_urls';
let _signedCache = null;
function _loadSigned() {
  if (_signedCache) return _signedCache;
  try { _signedCache = JSON.parse(localStorage.getItem(_SIGNED_LS_KEY) || '{}'); }
  catch { _signedCache = {}; }
  // purgar entradas expiradas para que el localStorage no crezca sin control
  const now = Date.now();
  let changed = false;
  for (const k in _signedCache) {
    if (!_signedCache[k] || _signedCache[k].exp <= now) { delete _signedCache[k]; changed = true; }
  }
  if (changed) _saveSigned();
  return _signedCache;
}
function _saveSigned() {
  try { localStorage.setItem(_SIGNED_LS_KEY, JSON.stringify(_signedCache || {})); } catch {}
}

// Descarta la URL firmada cacheada de un path para que el próximo render la
// vuelva a firmar. Úsalo desde el onError de un visor: sin esto, una URL que
// quedó muerta (objeto borrado, credenciales rotadas) sigue cacheada hasta 7
// días y la imagen se ve rota todo ese tiempo sin recuperarse sola.
export function invalidarSignedUrl(urlOPath) {
  const path = urlOPath && urlOPath.includes('/evidencias/') ? pathDeEvidencia(urlOPath) : urlOPath;
  if (!path) return;
  const cache = _loadSigned();
  if (cache[path]) { delete cache[path]; _saveSigned(); }
}

// Devuelve { url, isBlob } mostrable, o null si no hay nada que mostrar.
// Si isBlob, el caller debería revokeObjectURL(url) al desmontar.
// expiresIn 24h: los visores cachean la URL firmada en mapas que solo se
// reconstruyen ante cambios de datos; con 1h se rompían las miniaturas en
// pestañas abiertas mucho tiempo.
export async function getEvidenciaSrc(ev, expiresIn = _SIGNED_TTL) {
  if (!ev) return null;
  // 1) Blob local (recién capturada, aún no subida — o no se borró todavía).
  try {
    const blobId = ev.blob_ref || ev.id;
    const entry = await db.evidencias_blobs.get(blobId);
    if (entry?.blob) return { url: URL.createObjectURL(entry.blob), isBlob: true };
  } catch {}
  // 2) Remoto: firmar el path del bucket privado, REUSANDO la signed URL
  // cacheada mientras siga válida (URL estable = el navegador cachea la imagen).
  const path = pathDeEvidencia(ev.url_archivo);
  if (path) {
    const cache = _loadSigned();
    const now = Date.now();
    const hit = cache[path];
    // margen de 5 min para no devolver una URL a punto de expirar.
    // Si la entrada es de R2 pero el flag ya no lo permite (rollback a 'off'
    // porque R2 fallaba), la ignoramos y re-firmamos en Supabase: si no, cada
    // dispositivo seguiría sirviendo URLs rotas hasta 7 días y el rollback no
    // arreglaba nada.
    if (hit && hit.url && hit.exp - 300000 > now && (hit.src !== 'r2' || r2ReadEnabled())) {
      return { url: hit.url, isBlob: false };
    }
    // R2 primero (si VITE_R2_EVIDENCIAS está activo): URL prefirmada de 7 días,
    // cacheada IGUAL que la de Supabase (misma clave por path → el navegador y el
    // Service Worker cachean la imagen). El endpoint verifica que el objeto EXISTA
    // en R2 y devuelve 404 si no (evidencia aún no migrada) → acá llega null y
    // caemos al camino Supabase de abajo: la vista nunca se rompe.
    try {
      const r2url = await getR2SignedGetUrl(path);
      if (r2url) {
        cache[path] = { url: r2url, exp: now + expiresIn * 1000, src: 'r2' };
        _saveSigned();
        return { url: r2url, isBlob: false };
      }
    } catch {}
    try {
      const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, expiresIn);
      if (data?.signedUrl) {
        cache[path] = { url: data.signedUrl, exp: now + expiresIn * 1000, src: 'sb' };
        _saveSigned();
        return { url: data.signedUrl, isBlob: false };
      }
    } catch {}
  }
  // 3) Último recurso: la url guardada tal cual (sirve solo si el bucket fuera público).
  return ev.url_archivo ? { url: ev.url_archivo, isBlob: false } : null;
}

// Abre el archivo de una evidencia en pestaña nueva SIN esquivar el Service
// Worker: una navegación directa a *.supabase.co no pasa por el SW (otro
// origen/scope) y re-descargaba el archivo entero en CADA click. fetch() desde
// la página sí es interceptado (cache de 30 días) → abrimos el blob resultante.
export async function abrirUrlEvidencia(url) {
  if (!url) return;
  if (url.startsWith('blob:')) { window.open(url, '_blank'); return; }
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(String(resp.status));
    window.open(URL.createObjectURL(await resp.blob()), '_blank');
  } catch {
    window.open(url, '_blank');   // fallback: al menos que abra
  }
}
