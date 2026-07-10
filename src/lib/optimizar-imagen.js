// ═══════════════════════════════════════════════════════════════════
// JARVEX — Optimización de imágenes de evidencia ANTES de guardar/subir
//
// Por qué existe:
//  · Los iPhone suben .heic (~3.7 MB c/u) que NINGÚN navegador de escritorio
//    renderiza (Chrome/Edge/Firefox) → evidencias "invisibles". Peor: el
//    File.type llega vacío y se etiquetaba mime_type='image/jpeg' (mentira).
//  · El egress de Supabase Free (5 GB/mes) se agotó re-descargando fotos
//    gigantes: una foto de obra a 1920px JPEG ~200 KB dice lo mismo que la
//    original de 4 MB (20× menos egress y storage).
//
// Estrategia (sin dependencias nuevas):
//  · Se convierte en el DISPOSITIVO QUE CAPTURA: el Safari del iPhone (origen
//    de los HEIC) SÍ decodifica HEIC nativamente → canvas → JPEG. En desktop
//    los archivos elegidos ya son jpg/png/pdf.
//  · JPEG/WebP/HEIC → decodificar → reescalar a máx 1920px → JPEG q=0.82.
//  · PNG chico (≤300 KB, firmas/canvas) se respeta tal cual (nitidez de trazo).
//  · PDF y no-imágenes pasan intactos.
//  · Si el navegador NO puede decodificar (HEIC en Chrome viejo), se sube el
//    original PERO con el mime real (image/heic) — nunca más etiquetas falsas;
//    los visores muestran "descargar" en vez de una imagen rota.
// ═══════════════════════════════════════════════════════════════════

const MAX_DIM = 1920;        // suficiente para leer un metrado o un cartel de obra
const JPEG_QUALITY = 0.82;
const PNG_KEEP_BYTES = 300 * 1024;   // firmas y capturas chicas: no tocar

// ¿Los bytes son HEIC/HEIF? (los File de iOS suelen venir con type vacío).
// El contenedor ISO-BMFF lleva 'ftyp' en el offset 4 y la marca de formato en 8-12.
async function esHeicBytes(blob) {
  try {
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const ascii = (a, b) => String.fromCharCode(...head.slice(a, b));
    if (ascii(4, 8) !== 'ftyp') return false;
    const brand = ascii(8, 12).toLowerCase();
    return ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(brand);
  } catch { return false; }
}

const extDe = (nombre) => {
  const m = /\.([a-z0-9]+)$/i.exec(String(nombre || ''));
  return m ? m[1].toLowerCase() : '';
};

async function decodificar(blob) {
  // createImageBitmap es lo más rápido y no toca el DOM.
  try { return { bmp: await createImageBitmap(blob) }; } catch {}
  // Fallback <img>: Safari decodifica HEIC por acá aunque createImageBitmap falle.
  // Con TIMEOUT: un decoder colgado sin onload/onerror dejaría la promesa
  // eterna y saveEvidenciaLocal nunca guardaría (ya pasó en este repo con
  // compressImage). 15s y se rinde → el caller sube el original.
  try {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = 'async';
      const ok = await new Promise((res) => {
        const t = setTimeout(() => res(false), 15000);
        img.onload = () => { clearTimeout(t); res(true); };
        img.onerror = () => { clearTimeout(t); res(false); };
        img.src = url;
      });
      if (ok && img.naturalWidth > 0) return { img };
      return null;
    } finally { URL.revokeObjectURL(url); }
  } catch { return null; }
}

/**
 * Optimiza una imagen de evidencia. Devuelve SIEMPRE algo utilizable:
 *   { blob, mime, nombre, convertida }
 * - convertida=true → blob nuevo JPEG (nombre re-extensionado a .jpg)
 * - convertida=false → blob original con el MIME REAL detectado
 */
export async function optimizarImagenEvidencia(blob, nombre = '') {
  const ext = extDe(nombre);
  const tipo = (blob?.type || '').toLowerCase();

  // No-imágenes: PDF y demás pasan intactos.
  const pareceImagen = tipo.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp'].includes(ext) || tipo === '';
  if (!pareceImagen || tipo === 'application/pdf' || ext === 'pdf') {
    return { blob, mime: tipo || 'application/octet-stream', nombre, convertida: false };
  }

  const heic = tipo.includes('hei') || ['heic', 'heif'].includes(ext) || await esHeicBytes(blob);

  // PNG chico (firmas): respetar tal cual.
  if (!heic && (tipo === 'image/png' || ext === 'png') && blob.size <= PNG_KEEP_BYTES) {
    return { blob, mime: 'image/png', nombre, convertida: false };
  }

  const dec = await decodificar(blob);
  if (!dec) {
    // No se pudo decodificar acá (p.ej. HEIC en Chrome): subir el original con
    // su MIME VERDADERO para que los visores no intenten pintarlo como JPEG.
    const mimeReal = heic ? 'image/heic' : (tipo || 'application/octet-stream');
    return { blob, mime: mimeReal, nombre, convertida: false };
  }

  try {
    const w = dec.bmp ? dec.bmp.width : dec.img.naturalWidth;
    const h = dec.bmp ? dec.bmp.height : dec.img.naturalHeight;
    const escala = Math.min(1, MAX_DIM / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * escala));
    const ch = Math.max(1, Math.round(h * escala));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    // Fondo blanco: JPEG no tiene alfa (un PNG transparente quedaría negro).
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(dec.bmp || dec.img, 0, 0, cw, ch);
    if (dec.bmp?.close) { try { dec.bmp.close(); } catch {} }
    const jpeg = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!jpeg) throw new Error('toBlob null');
    // Usar la versión convertida si es HEIC (obligatorio: si no, no se ve) o si
    // realmente achica el archivo; si no, dejar el original.
    if (heic || jpeg.size < blob.size) {
      const nombreJpg = nombre ? nombre.replace(/\.[a-z0-9]+$/i, '') + '.jpg' : 'foto.jpg';
      return { blob: jpeg, mime: 'image/jpeg', nombre: nombreJpg, convertida: true };
    }
    return { blob, mime: tipo || 'image/jpeg', nombre, convertida: false };
  } catch {
    const mimeReal = heic ? 'image/heic' : (tipo || 'application/octet-stream');
    return { blob, mime: mimeReal, nombre, convertida: false };
  }
}
