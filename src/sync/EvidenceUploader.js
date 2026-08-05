import { db, UPLOAD_STATUS } from '../db/jarvex.db';
import { supabase } from '../lib/supabase';
import { optimizarImagenEvidencia } from '../lib/optimizar-imagen';
import { captureException } from '../instrument.js';

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
    const alcanzoTope = retries >= MAX_RETRIES;
    await db.evidencias.update(evidenciaId, {
      upload_retries: retries,
      sync_status: alcanzoTope ? UPLOAD_STATUS.FAILED : UPLOAD_STATUS.PENDING,
      _last_error: `Subida de archivo al Storage falló: ${error.message || error}`,
    });
    if (alcanzoTope) { try { captureException(error, { tags:{ area:'evidencias-storage' }, extra:{ id: evidenciaId, tipo: evidencia.tipo_evidencia } }); } catch {} }
    return;
  }

  const { data: { publicUrl } } = supabase.storage
    .from('evidencias')
    .getPublicUrl(storagePath);

  // Sincronizar metadata al servidor. CRÍTICO: si esto falla NO borramos el blob
  // (si no, la evidencia se pierde: estaría en Storage pero ningún device la vería
  // — exactamente el bug que dejó la metadata fuera del server). Reintentamos.
  const metaRes = await upsertMetadataEvidencia(evidencia, publicUrl);
  if (!metaRes.ok) {
    const retries = (evidencia.upload_retries ?? 0) + 1;
    const alcanzoTope = retries >= MAX_RETRIES;
    await db.evidencias.update(evidenciaId, {
      url_archivo: publicUrl, // el blob ya está en Storage
      upload_retries: retries,
      sync_status: alcanzoTope ? UPLOAD_STATUS.FAILED : UPLOAD_STATUS.PENDING,
      // Motivo VISIBLE (antes era un console.warn silencioso). El fallo típico es
      // RLS de la tabla evidencias o el CHECK de tipo_evidencia (mig 080) → la
      // usuaria/el admin necesitan saberlo para corregir, no que se pierda callado.
      _last_error: `Metadata no entró al servidor: ${metaRes.error}`,
      _last_error_is_rls: /row-level security|violates row-level security|42501/i.test(metaRes.error || ''),
    });
    return;
  }
  // Éxito: limpiar cualquier error previo.
  if (evidencia._last_error) { try { await db.evidencias.update(evidenciaId, { _last_error: null, _last_error_is_rls: false }); } catch {} }

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
    return { ok: false, error: error.message || String(error) };
  }
  return { ok: true, error: null };
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
      .filter(e => !!e.url_archivo && e.demo !== true)
      .toArray();
    for (const ev of subidas) {
      const res = await upsertMetadataEvidencia(ev, ev.url_archivo);
      // Si una evidencia 'uploaded' resulta que su metadata NO estaba en el server
      // y ahora tampoco entra (RLS/CHECK), dejamos rastro visible del motivo.
      if (res && res.ok === false) {
        try { await db.evidencias.update(ev.id, { _last_error: `Metadata no entró al servidor: ${res.error}` }); } catch {}
      }
    }
  } catch (e) {
    console.warn('[EvidenceUploader] recuperación metadata:', e?.message || e);
  }
}

// Reactiva (una vez por sesión) las evidencias 'failed' cuyo blob aún existe en
// IndexedDB → las vuelve 'pending' con retries=0 para que se reintenten. Sin blob
// no hay nada que recuperar (se quedan 'failed'). Recupera fotos perdidas por la
// RLS de Storage que bloqueaba a los ingenieros (ver mig 104).
let _reactivacionFallidasHecha = false;
async function reactivarFallidasConBlob() {
  if (_reactivacionFallidasHecha) return;
  _reactivacionFallidasHecha = true;
  try {
    const fallidas = await db.evidencias
      .where('sync_status').equals(UPLOAD_STATUS.FAILED)
      .toArray();
    for (const ev of fallidas) {
      const blobEntry = await db.evidencias_blobs.get(ev.blob_ref || ev.id);
      if (blobEntry?.blob) {
        await db.evidencias.update(ev.id, { sync_status: UPLOAD_STATUS.PENDING, upload_retries: 0 });
      }
    }
  } catch (e) {
    console.warn('[EvidenceUploader] reactivar fallidas:', e?.message || e);
  }
}

// ── Upload de todas las evidencias pendientes ─────────────────────────

// Guard anti-concurrencia: esta función ahora se dispara desde varios lados
// (montar, login, tras guardar una evidencia, cada 45s, al reconectar). Sin el
// guard, dos corridas simultáneas procesarían el mismo PENDING → doble compresión
// y doble subida (egress desperdiciado, carreras al borrar el blob).
let _uploadingPending = false;

export async function uploadPendingEvidencias() {
  if (!navigator.onLine) return;
  if (_uploadingPending) return;
  _uploadingPending = true;
  try {
    // Recuperar evidencias que quedaron 'failed' pero cuyo blob SIGUE en IndexedDB
    // (el blob solo se borra tras subir blob+metadata OK). Caso real: los ingenieros
    // no podían subir a Storage por la RLS (mig 104) → sus fotos de avance quedaron
    // 'failed' localmente. Tras el fix, reactivarlas para que se suban al fin.
    await reactivarFallidasConBlob();

    const pending = await db.evidencias
      .where('sync_status').equals(UPLOAD_STATUS.PENDING)
      .toArray();

    let subidas = 0;
    for (const ev of pending) {
      await uploadEvidencia(ev.id);
      try {
        const post = await db.evidencias.get(ev.id);
        if (post?.sync_status === UPLOAD_STATUS.UPLOADED) subidas++;
      } catch {}
    }
    // Avisar a los visores abiertos (source propio para que el trigger de main.jsx
    // no re-dispare en bucle). Sin esto, tras subir en segundo plano la foto seguía
    // mostrándose como "subiendo" hasta recargar.
    if (subidas > 0) {
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias', source: 'evidence-upload' } })); } catch {}
    }

    // Recuperar la metadata de evidencias ya subidas que el bug del CHECK dejó
    // fuera del server (una sola vez por sesión).
    await recuperarMetadataSubidas();
  } finally {
    _uploadingPending = false;
  }
}

// ── Guardar evidencia localmente (con blob) ───────────────────────────

export async function saveEvidenciaLocal({ id, obra_id, tipo_evidencia, modulo_relacionado, registro_relacionado_id, nombre_archivo, mime_type, blob, observaciones, fecha, created_by, demo }) {
  // Optimizar ANTES de guardar: HEIC de iPhone → JPEG (si no, nadie lo ve en
  // desktop), reescala a 1920px y comprime (~20× menos storage/egress), y
  // corrige el MIME real (los File de iOS llegan con type vacío y se
  // etiquetaban 'image/jpeg' aunque fueran HEIC → imagen rota en los visores).
  try {
    const opt = await optimizarImagenEvidencia(blob, nombre_archivo || '');
    if (opt?.blob) {
      blob = opt.blob;
      mime_type = opt.mime || mime_type;
      if (opt.convertida && opt.nombre) nombre_archivo = opt.nombre;
    }
  } catch { /* si la optimización falla, se guarda el original tal cual */ }
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
    // Modo PRUEBA (demo:true): la evidencia queda SOLO local — no debe subir
    // al Storage/BD reales apuntando a un registro demo (fuga demo→real).
    // sync 'uploaded' la saca del pipeline de subida; el visor la sirve del
    // blob local (que no se borra porque nunca hay upload OK).
    ...(demo === true
      ? { demo: true, sync_status: UPLOAD_STATUS.UPLOADED }
      : { sync_status: UPLOAD_STATUS.PENDING }),
    upload_retries: 0,
    created_by,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await db.evidencias_blobs.put({ id, blob });
}
