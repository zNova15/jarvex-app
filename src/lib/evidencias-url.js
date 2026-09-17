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
// v2 (14-set-2026): al terminar la migración a R2 (docs/migracion-r2.md,
// Paso 5) se cambia la clave a propósito. Antes de vaciar Supabase Storage,
// esto invalida DE UNA todas las URLs de Supabase que los dispositivos ya
// tenían cacheadas hasta 7 días — sin el bump, un equipo con caché tibia
// vería la foto rota hasta que esa URL vieja expirara sola.
const _SIGNED_LS_KEY = 'jx_signed_urls_v2';
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

// ─── Firmas EN VUELO: una sola petición por path ────────────────────
// «Cuando entro en diferentes PC, los ojos para ver facturas no se muestran, o
// tardan mucho en aparecer» (Gabriel, 7-sep-2026).
//
// La causa: el caché de URLs firmadas vive en el localStorage de CADA equipo.
// En una PC donde nunca se abrió esa pantalla está vacío, así que cada ojo
// tiene que firmar su archivo de cero — y firmar cuesta dos viajes (el POST a
// /api/r2 y, si el objeto todavía no migró, el createSignedUrl de Supabase).
// Con una tabla de 20 comprobantes eso son hasta 40 llamadas disparadas a la
// vez, y la primera carga se arrastra.
//
// Lo que arregla este mapa: la MISMA factura suele pedirse varias veces a la
// vez (la miniatura de la fila, el visor, el modal), y antes cada pedido
// firmaba por su cuenta. Ahora el primero firma y los demás esperan esa misma
// promesa. Menos viajes, menos cold starts del endpoint y menos cuota.
const _enVuelo = new Map();   // path → Promise<string|null>

function _firmarPath(path, expiresIn, { saltarR2 = false } = {}) {
  const cache = _loadSigned();
  const now = Date.now();
  const hit = cache[path];
  // margen de 5 min para no devolver una URL a punto de expirar.
  // Si la entrada es de R2 pero el flag ya no lo permite (rollback a 'off'
  // porque R2 fallaba), la ignoramos y re-firmamos en Supabase: si no, cada
  // dispositivo seguiría sirviendo URLs rotas hasta 7 días y el rollback no
  // arreglaba nada. `saltarR2` hace lo mismo a pedido, para el reintento de
  // `descargarEvidencia` cuando la URL de R2 resultó apuntar a la nada.
  if (hit && hit.url && hit.exp - 300000 > now && (hit.src !== 'r2' || r2ReadEnabled())
    && !(saltarR2 && hit.src === 'r2')) {
    return Promise.resolve(hit.url);
  }
  // La clave de "en vuelo" distingue los dos modos: si no, el reintento sin R2
  // se colgaría de la misma promesa que ya devolvió la URL rota.
  const clave = saltarR2 ? `sb:${path}` : path;
  const yaPedida = _enVuelo.get(clave);
  if (yaPedida) return yaPedida;

  const p = (async () => {
    // R2 primero (si VITE_R2_EVIDENCIAS está activo): URL prefirmada de 7 días,
    // cacheada IGUAL que la de Supabase (misma clave por path → el navegador y el
    // Service Worker cachean la imagen). El endpoint verifica que el objeto EXISTA
    // en R2 y devuelve 404 si no (evidencia aún no migrada) → acá llega null y
    // caemos al camino Supabase de abajo: la vista nunca se rompe.
    //
    // 🔴 Ese chequeo se puede APAGAR con R2_SKIP_HEAD=1 en Vercel (Paso 8 del
    // runbook de migración). Si se apaga ANTES de terminar la mudanza, el
    // endpoint firma alegremente objetos que solo existen en Supabase y el
    // navegador se come un 404 — que es exactamente lo que pasó el 17-set-2026.
    // Por eso el fallback ya no vive solo acá: ver `descargarEvidencia`.
    if (!saltarR2) {
      try {
        const r2url = await getR2SignedGetUrl(path);
        if (r2url) {
          const c = _loadSigned();
          c[path] = { url: r2url, exp: Date.now() + expiresIn * 1000, src: 'r2' };
          _saveSigned();
          return r2url;
        }
      } catch {}
    }
    try {
      const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, expiresIn);
      if (data?.signedUrl) {
        const c = _loadSigned();
        c[path] = { url: data.signedUrl, exp: Date.now() + expiresIn * 1000, src: 'sb' };
        _saveSigned();
        return data.signedUrl;
      }
    } catch {}
    return null;
  })().finally(() => { _enVuelo.delete(clave); });

  _enVuelo.set(clave, p);
  return p;
}

// Calienta la URL firmada de una evidencia sin devolver nada y —sobre todo—
// SIN crear objectURLs (los de un blob local no tendría quién revocarlos).
// Se llama al pasar el mouse por encima del 👁: cuando el usuario hace clic, la
// firma ya está en el caché y el comprobante abre de una. Si nunca hace clic,
// lo único que se gastó es una firma, que además queda cacheada 7 días.
export function precargarEvidencia(ev) {
  try {
    const path = pathDeEvidencia(ev?.url_archivo);
    if (path) _firmarPath(path, _SIGNED_TTL);   // fire-and-forget; nunca tira
  } catch {}
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
    const url = await _firmarPath(path, expiresIn);
    if (url) return { url, isBlob: false };
  }
  // 3) Último recurso: la url guardada tal cual (sirve solo si el bucket fuera
  // público). Se exige que sea ABSOLUTA: desde el 15-set-2026 las evidencias
  // nuevas guardan `url_archivo` como ruta RELATIVA ('/evidencias/…'), y
  // devolver eso hacía que el navegador se la pidiera al propio dominio de la
  // app → 404 seguro, con un mensaje que hablaba del archivo cuando lo que
  // había fallado era la firma.
  return /^https?:\/\//i.test(ev.url_archivo || '') ? { url: ev.url_archivo, isBlob: false } : null;
}

/**
 * Descarga el ARCHIVO de una evidencia, degradando sola si hace falta.
 *
 * 🔴 POR QUÉ NO ALCANZA CON `getEvidenciaSrc` + fetch (17-set-2026).
 * La firma y la descarga son dos pasos distintos, y el primero puede salir
 * "bien" con una URL que el segundo no puede bajar: `/api/r2` con
 * R2_SKIP_HEAD=1 firma cualquier path, exista o no el objeto. Ese día Captura
 * Mágica falló con «descarga falló (404)» en TODA foto anterior al 15-set —
 * las que siguen viviendo solo en Supabase Storage— aunque el archivo estaba
 * perfectamente guardado y a un fallback de distancia.
 *
 * Acá el fallback se decide con la única prueba que no miente: que la descarga
 * ANDE. Si la URL firmada no sirve, se tira la que estaba cacheada (si no,
 * quedaría rota hasta 7 días) y se vuelve a firmar saltando R2.
 */
export async function descargarEvidencia(ev) {
  const src = await getEvidenciaSrc(ev);
  if (!src?.url) throw new Error('sin-archivo');
  try {
    const resp = await fetch(src.url);
    if (resp.ok) return await resp.blob();
    // Un blob local no tiene contra qué degradar: si falló, falló.
    const path = src.isBlob ? null : pathDeEvidencia(ev.url_archivo);
    if (!path) throw new Error(`descarga falló (${resp.status})`);
    invalidarSignedUrl(path);
    const urlSb = await _firmarPath(path, _SIGNED_TTL, { saltarR2: true });
    if (!urlSb || urlSb === src.url) throw new Error(`descarga falló (${resp.status})`);
    const resp2 = await fetch(urlSb);
    if (!resp2.ok) throw new Error(`descarga falló (${resp2.status})`);
    return await resp2.blob();
  } finally {
    if (src.isBlob) { try { URL.revokeObjectURL(src.url); } catch {} }
  }
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
