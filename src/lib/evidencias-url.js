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

// Devuelve { url, isBlob } mostrable, o null si no hay nada que mostrar.
// Si isBlob, el caller debería revokeObjectURL(url) al desmontar.
// expiresIn 24h: los visores cachean la URL firmada en mapas que solo se
// reconstruyen ante cambios de datos; con 1h se rompían las miniaturas en
// pestañas abiertas mucho tiempo.
export async function getEvidenciaSrc(ev, expiresIn = 86400) {
  if (!ev) return null;
  // 1) Blob local (recién capturada, aún no subida — o no se borró todavía).
  try {
    const blobId = ev.blob_ref || ev.id;
    const entry = await db.evidencias_blobs.get(blobId);
    if (entry?.blob) return { url: URL.createObjectURL(entry.blob), isBlob: true };
  } catch {}
  // 2) Remoto: firmar el path del bucket privado.
  const path = pathDeEvidencia(ev.url_archivo);
  if (path) {
    try {
      const { data } = await supabase.storage.from('evidencias').createSignedUrl(path, expiresIn);
      if (data?.signedUrl) return { url: data.signedUrl, isBlob: false };
    } catch {}
  }
  // 3) Último recurso: la url guardada tal cual (sirve solo si el bucket fuera público).
  return ev.url_archivo ? { url: ev.url_archivo, isBlob: false } : null;
}
