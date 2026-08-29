// ═══════════════════════════════════════════════════════════════════
// JARVEX — Fase 3 del plan de consumo: migrar evidencias HEIC antiguas.
//
// Diagnóstico (29-ago-2026, medido en storage.objects): 29 fotos .heic de
// iPhone subidas ANTES de que existiera optimizarImagenEvidencia (26-jun y
// 9-jul) pesan 106 MB = 19% del bucket, y encima NO se ven en Chrome/desktop
// (ningún navegador no-Apple decodifica HEIC). Las imágenes nuevas ya salen
// convertidas y comprimidas desde la captura — esto limpia el legado.
//
// Qué hace por cada evidencia .heic del SERVER:
//   1. Descarga el archivo (bucket privado → storage.download autenticado).
//   2. Lo convierte con optimizarImagenEvidencia (JPEG 1920px q0.82 — el
//      MISMO estándar que la captura actual). Requiere un navegador que
//      decodifique HEIC: Safari (Mac/iPhone). En Chrome no rompe nada:
//      cuenta la foto como "no decodificada" y sigue.
//   3. Sube el .jpg al MISMO folder (cacheControl 30 días).
//   4. Actualiza la fila de `evidencias` en el server (url/mime/nombre/tamaño).
//      Si el update falla → borra el .jpg recién subido (rollback) y NO toca
//      el original.
//   5. Recién con 3 y 4 OK, borra el .heic original del Storage.
//
// La foto nunca se pierde: o queda el original intacto, o queda su JPEG con
// la fila apuntándole. Idempotente: re-correr solo procesa lo que siga .heic.
// ═══════════════════════════════════════════════════════════════════

// ¿La fila de evidencias apunta a un archivo HEIC/HEIF?
export function esEvidenciaHeic(ev) {
  const url = String(ev?.url_archivo || '');
  return /\.hei[cf](\?.*)?$/i.test(url);
}

// Extrae el path DENTRO del bucket 'evidencias' desde la URL pública guardada
// en url_archivo (…/storage/v1/object/public/evidencias/<obra>/<mes>/<id>.heic).
// Devuelve null si la URL no tiene esa forma (no adivinamos).
export function storagePathDeUrl(url) {
  const m = /\/storage\/v1\/object\/(?:public\/)?evidencias\/(.+?)(?:\?.*)?$/.exec(String(url || ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

// <path>.heic → <path>.jpg (conserva folder y el id del archivo).
export function pathJpgDe(path) {
  return String(path || '').replace(/\.hei[cf]$/i, '.jpg');
}

export function nombreJpgDe(nombre) {
  const n = String(nombre || '');
  if (!n) return 'foto.jpg';
  return /\.[a-z0-9]+$/i.test(n) ? n.replace(/\.[a-z0-9]+$/i, '.jpg') : `${n}.jpg`;
}

// Corre la migración completa. Dependencias inyectadas para poder testear la
// lógica sin red: { supabase, db, optimizar, onProgress }.
// Devuelve { total, convertidas, noDecodificadas, errores, sinBorrarOriginal, mbAhorrados }.
export async function migrarEvidenciasHeic({ supabase, db, optimizar, onProgress }) {
  const res = { total: 0, convertidas: 0, noDecodificadas: 0, errores: 0, sinBorrarOriginal: 0, mbAhorrados: 0 };
  const avisar = (msg) => { try { onProgress && onProgress(msg, { ...res }); } catch {} };

  // Candidatas desde el SERVER (fuente de verdad; la galería local puede estar
  // filtrada por rol). Solo admin llega acá — la RLS igual manda.
  const { data: filas, error } = await supabase
    .from('evidencias')
    .select('id, obra_id, nombre_archivo, url_archivo, mime_type')
    .or('url_archivo.ilike.%.heic,url_archivo.ilike.%.heif');
  if (error) throw new Error(`No se pudo listar las evidencias HEIC: ${error.message || error}`);

  const candidatas = (filas || []).filter(esEvidenciaHeic);
  res.total = candidatas.length;
  avisar(`${res.total} fotos HEIC encontradas`);

  for (let i = 0; i < candidatas.length; i++) {
    const ev = candidatas[i];
    avisar(`Convirtiendo ${i + 1}/${res.total}…`);
    try {
      const path = storagePathDeUrl(ev.url_archivo);
      if (!path) { res.errores++; continue; }

      // 1) Descargar el original.
      const { data: blob, error: eDown } = await supabase.storage.from('evidencias').download(path);
      if (eDown || !blob) { res.errores++; continue; }

      // 2) Convertir con el MISMO pipeline de la captura actual.
      const opt = await optimizar(blob, ev.nombre_archivo || 'foto.heic');
      if (!opt?.convertida || !opt.blob) { res.noDecodificadas++; continue; }

      // 3) Subir el JPEG.
      const nuevoPath = pathJpgDe(path);
      if (nuevoPath === path) { res.errores++; continue; }
      const { error: eUp } = await supabase.storage.from('evidencias').upload(nuevoPath, opt.blob, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '2592000',
      });
      if (eUp) { res.errores++; continue; }

      // 4) Apuntar la fila del server al JPEG. Si falla → rollback del JPEG y
      // el original queda intacto.
      const { data: pub } = supabase.storage.from('evidencias').getPublicUrl(nuevoPath);
      const nuevaUrl = pub?.publicUrl;
      const patch = {
        url_archivo: nuevaUrl,
        mime_type: 'image/jpeg',
        nombre_archivo: nombreJpgDe(ev.nombre_archivo),
        tamano_bytes: opt.blob.size,
      };
      const { error: eRow } = await supabase.from('evidencias').update(patch).eq('id', ev.id);
      if (eRow || !nuevaUrl) {
        try { await supabase.storage.from('evidencias').remove([nuevoPath]); } catch {}
        res.errores++;
        continue;
      }

      // Espejo local inmediato (si la fila existe en este dispositivo).
      try { if (db?.evidencias) await db.evidencias.update(ev.id, patch); } catch {}

      // 5) Recién ahora, borrar el original.
      const { error: eDel } = await supabase.storage.from('evidencias').remove([path]);
      if (eDel) res.sinBorrarOriginal++;

      res.convertidas++;
      res.mbAhorrados += Math.max(0, (blob.size - opt.blob.size) / 1048576);
    } catch {
      res.errores++;
    }
  }

  res.mbAhorrados = Math.round(res.mbAhorrados * 10) / 10;
  avisar('Listo');
  return res;
}
