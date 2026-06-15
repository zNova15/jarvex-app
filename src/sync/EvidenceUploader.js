import { db, UPLOAD_STATUS } from '../db/jarvex.db';
import { supabase } from '../lib/supabase';

const MAX_RETRIES = 5;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
const TARGET_PHOTO_BYTES = 2 * 1024 * 1024; // comprimir a 2 MB

// ── Comprimir imagen antes de subir ──────────────────────────────────

async function compressImage(blob) {
  if (blob.size <= TARGET_PHOTO_BYTES) return blob;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    let settled = false;
    // Resuelve UNA sola vez y libera el objectURL en TODOS los caminos. Si algo
    // sale mal devolvemos el blob original sin comprimir (mejor sin comprimir que
    // colgar el await → todo el pipeline de subida + la recuperación se frenarían).
    const done = (out) => { if (settled) return; settled = true; try { URL.revokeObjectURL(url); } catch {} resolve(out || blob); };
    // Imagen corrupta/truncada/formato no decodificable → onerror (sin esto el
    // Promise nunca resolvía y el for-await secuencial quedaba colgado).
    img.onerror = () => done(blob);
    const t = setTimeout(() => done(blob), 15000); // red de seguridad
    img.onload = () => {
      clearTimeout(t);
      try {
        const canvas = document.createElement('canvas');
        const scale = Math.sqrt(TARGET_PHOTO_BYTES / blob.size);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((compressed) => done(compressed), 'image/jpeg', 0.85);
      } catch { done(blob); }
    };
    img.src = url;
  });
}

// ── Upload de una evidencia al Storage de Supabase ────────────────────

export async function uploadEvidencia(evidenciaId) {
  const evidencia = await db.evidencias.get(evidenciaId);
  if (!evidencia) return;

  const blobEntry = await db.evidencias_blobs.get(evidenciaId);
  if (!blobEntry?.blob) {
    await db.evidencias.update(evidenciaId, { sync_status: UPLOAD_STATUS.FAILED });
    return;
  }

  let fileBlob = blobEntry.blob;

  if (fileBlob.type?.startsWith('image/')) {
    fileBlob = await compressImage(fileBlob);
  }

  const ext = evidencia.nombre_archivo.split('.').pop() ?? 'bin';
  const yyyy_mm = new Date().toISOString().slice(0, 7);
  const storagePath = `${evidencia.obra_id}/${yyyy_mm}/${evidenciaId}.${ext}`;

  // upsert:true → re-subir el mismo path es idempotente (no 409 en reintentos).
  const { error } = await supabase.storage
    .from('evidencias')
    .upload(storagePath, fileBlob, {
      contentType: fileBlob.type ?? 'application/octet-stream',
      upsert: true,
    });

  if (error) {
    const retries = (evidencia.upload_retries ?? 0) + 1;
    await db.evidencias.update(evidenciaId, {
      upload_retries: retries,
      sync_status: retries >= MAX_RETRIES ? UPLOAD_STATUS.FAILED : UPLOAD_STATUS.PENDING,
    });
    return;
  }

  const { data: { publicUrl } } = supabase.storage
    .from('evidencias')
    .getPublicUrl(storagePath);

  // Sincronizar metadata al servidor. CRÍTICO: si esto falla NO borramos el blob
  // (si no, la evidencia se pierde: estaría en Storage pero ningún device la vería
  // — exactamente el bug que dejó la metadata fuera del server). Reintentamos.
  const okMeta = await upsertMetadataEvidencia(evidencia, publicUrl);
  if (!okMeta) {
    const retries = (evidencia.upload_retries ?? 0) + 1;
    await db.evidencias.update(evidenciaId, {
      url_archivo: publicUrl, // el blob ya está en Storage
      upload_retries: retries,
      sync_status: retries >= MAX_RETRIES ? UPLOAD_STATUS.FAILED : UPLOAD_STATUS.PENDING,
    });
    return;
  }

  // Actualizar local
  await db.evidencias.update(evidenciaId, {
    url_archivo: publicUrl,
    local_path_temporal: null,
    sync_status: UPLOAD_STATUS.UPLOADED,
  });

  // Liberar blob del IndexedDB (solo tras subir blob Y metadata OK).
  await db.evidencias_blobs.delete(evidenciaId);
}

// Columnas REALES de public.evidencias (allowlist). Usamos allowlist en vez de
// "todo menos los locales" porque algunos creadores (ej. restore-backup) meten
// version/idempotency_key que NO existen en esta tabla → PGRST204 y la evidencia
// quedaba atascada. Con allowlist solo mandamos lo que el server tiene.
const EVIDENCIA_COLS = [
  'id', 'obra_id', 'tipo_evidencia', 'modulo_relacionado', 'registro_relacionado_id',
  'nombre_archivo', 'url_archivo', 'local_path_temporal', 'mime_type', 'tamano_bytes',
  'subido_por', 'fecha', 'observaciones', 'sync_status', 'upload_retries',
  'created_at', 'updated_at', 'created_by', 'blob_ref',
];

// Upsert de la metadata de una evidencia al server. Devuelve true/false (chequea
// el error, que antes se ignoraba → fallos silenciosos).
async function upsertMetadataEvidencia(evidencia, url) {
  const serverRecord = {};
  for (const k of EVIDENCIA_COLS) {
    if (k in evidencia) serverRecord[k] = evidencia[k];
  }
  serverRecord.url_archivo = url ?? evidencia.url_archivo ?? null;
  serverRecord.local_path_temporal = null;
  serverRecord.sync_status = 'uploaded';
  const { error } = await supabase.from('evidencias').upsert(serverRecord);
  if (error) {
    console.warn('[EvidenceUploader] upsert metadata falló:', error.message || error);
    return false;
  }
  return true;
}

// Recuperación (una vez por sesión): evidencias marcadas 'uploaded' localmente
// cuyo blob ya está en Storage pero cuya METADATA nunca entró al server (bug del
// CHECK de tipo_evidencia, mig 080). Re-upserteamos su metadata (idempotente)
// para que otros dispositivos al fin las vean.
let _recuperacionMetadataHecha = false;
async function recuperarMetadataSubidas() {
  if (_recuperacionMetadataHecha) return;
  _recuperacionMetadataHecha = true;
  try {
    const subidas = await db.evidencias
      .where('sync_status').equals(UPLOAD_STATUS.UPLOADED)
      .filter(e => !!e.url_archivo)
      .toArray();
    for (const ev of subidas) {
      await upsertMetadataEvidencia(ev, ev.url_archivo);
    }
  } catch (e) {
    console.warn('[EvidenceUploader] recuperación metadata:', e?.message || e);
  }
}

// ── Upload de todas las evidencias pendientes ─────────────────────────

export async function uploadPendingEvidencias() {
  if (!navigator.onLine) return;

  const pending = await db.evidencias
    .where('sync_status').equals(UPLOAD_STATUS.PENDING)
    .toArray();

  for (const ev of pending) {
    await uploadEvidencia(ev.id);
  }

  // Recuperar la metadata de evidencias ya subidas que el bug del CHECK dejó
  // fuera del server (una sola vez por sesión).
  await recuperarMetadataSubidas();
}

// ── Guardar evidencia localmente (con blob) ───────────────────────────

export async function saveEvidenciaLocal({ id, obra_id, tipo_evidencia, modulo_relacionado, registro_relacionado_id, nombre_archivo, mime_type, blob, observaciones, fecha, created_by }) {
  if (blob.size > MAX_PHOTO_BYTES) {
    throw new Error(`Archivo muy grande (${(blob.size / 1024 / 1024).toFixed(1)} MB). Máximo 8 MB.`);
  }

  await db.evidencias.put({
    id,
    obra_id,
    tipo_evidencia,
    modulo_relacionado,
    registro_relacionado_id,
    nombre_archivo,
    mime_type,
    tamano_bytes: blob.size,
    url_archivo: null,
    local_path_temporal: `idb://evidencias_blobs/${id}`,
    subido_por: created_by,
    fecha: fecha ?? new Date().toISOString().slice(0, 10),
    observaciones,
    sync_status: UPLOAD_STATUS.PENDING,
    upload_retries: 0,
    created_by,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await db.evidencias_blobs.put({ id, blob });
}
