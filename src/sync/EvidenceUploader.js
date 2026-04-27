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
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.sqrt(TARGET_PHOTO_BYTES / blob.size);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (compressed) => {
          URL.revokeObjectURL(url);
          resolve(compressed ?? blob);
        },
        'image/jpeg',
        0.85
      );
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

  const { error } = await supabase.storage
    .from('evidencias')
    .upload(storagePath, fileBlob, {
      contentType: fileBlob.type ?? 'application/octet-stream',
      upsert: false,
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

  // Sincronizar metadata al servidor
  const { sync_status, local_path_temporal, ...serverRecord } = evidencia;
  await supabase.from('evidencias').upsert({
    ...serverRecord,
    url_archivo: publicUrl,
    local_path_temporal: null,
    sync_status: 'uploaded',
  });

  // Actualizar local
  await db.evidencias.update(evidenciaId, {
    url_archivo: publicUrl,
    local_path_temporal: null,
    sync_status: UPLOAD_STATUS.UPLOADED,
  });

  // Liberar blob del IndexedDB
  await db.evidencias_blobs.delete(evidenciaId);
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
