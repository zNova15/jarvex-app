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
//  · JPEG/WebP/HEIC → decodificar → reescalar → JPEG con OBJETIVO DE TAMAÑO.
//  · PNG chico (≤300 KB, firmas/canvas) se respeta tal cual (nitidez de trazo).
//  · PDF y no-imágenes pasan intactos.
//  · Si el navegador NO puede decodificar (HEIC en Chrome viejo), se sube el
//    original PERO con el mime real (image/heic) — nunca más etiquetas falsas;
//    los visores muestran "descargar" en vez de una imagen rota.
//
// ── POR QUÉ OBJETIVO DE TAMAÑO Y NO CALIDAD FIJA (4-sep-2026) ─────
// Hasta hoy: 1920 px a calidad fija 0.82. Medido contra producción, eso
// NO acota nada: las facturas del portal de campo salían a **900 KB de
// promedio** (18 fotos en 4 días) y las fotos de avance a **1.211 KB**.
// El motivo es que una calidad fija no produce un tamaño fijo: la foto de
// un documento es casi toda texto y bordes —entropía altísima— y a 0.82
// pesa el triple que un paisaje del mismo tamaño. Justo el caso que más
// se usa era el que peor comprimía.
//
// Ahora se apunta a un TAMAÑO y se baja la calidad hasta alcanzarlo, como
// hace cualquier optimizador serio: la foto simple conserva nitidez de
// sobra y la cargada de texto se aprieta lo necesario. El resultado deja
// de depender del contenido.
//
// Los escalones están elegidos para que el texto de una factura siga
// siendo legible en el último: 1600 px es ~200 DPI sobre A4 y a q=0.56 el
// JPEG todavía resuelve dígitos de 2 mm. Debajo de eso NO se baja: se
// prefiere un archivo grande a una evidencia que no se puede leer.
// ═══════════════════════════════════════════════════════════════════

const MAX_DIM = 1600;        // ~200 DPI sobre A4: se lee un RUC y un importe
const PNG_KEEP_BYTES = 300 * 1024;   // firmas y capturas chicas: no tocar
const TARGET_BYTES = 400 * 1024;     // techo al que se apunta por foto

// Escalones de reintento, en orden. Se corta en el PRIMERO que baje del
// objetivo; si ninguno lo logra, vale el último (nunca se degrada más).
// `dim` null = usar el lienzo ya dibujado (no hay que redibujar).
export const ESCALONES = [
  { dim: null, q: 0.78 },   // la mayoría de las fotos cierra acá
  { dim: null, q: 0.62 },   // documentos con mucho texto
  { dim: 1280, q: 0.62 },   // último recurso: bajar resolución, no calidad
];

/**
 * Elige el escalón: encoda por orden y devuelve el primero bajo el objetivo.
 * Extraído para poder testearlo sin canvas ni navegador — `encode(dim, q)`
 * devuelve un blob (o algo con `.size`).
 */
export async function encodarHastaObjetivo(encode, objetivo = TARGET_BYTES, escalones = ESCALONES) {
  let ultimo = null;
  for (const paso of escalones) {
    const out = await encode(paso.dim, paso.q);
    if (!out) continue;                 // un escalón que falla no aborta la cadena
    ultimo = out;
    if (out.size <= objetivo) return out;
  }
  return ultimo;
}

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

/**
 * ¿Son TODOS los píxeles el mismo color? (RGBA plano, como lo devuelve
 * getImageData). Es la firma de un lienzo que quedó en blanco: la foto de un
 * comprobante jamás es un color plano.
 *
 * 🔴 POR QUÉ EXISTE (17-set-2026). Dos facturas del portal de campo se
 * guardaron como un JPEG BLANCO de 720×1600 y 7.508 bytes — las dos idénticas
 * byte a byte, porque un blanco liso del mismo tamaño siempre comprime igual.
 * Mistral OCR devolvió 1 carácter y la lectura moría con «la IA devolvió un
 * JSON inválido», un mensaje que mandaba a mirar la IA cuando lo que se había
 * subido no tenía nada adentro. La foto original se perdió: el blob local se
 * borra tras subir.
 */
export function pixelesUniformes(data, tolerancia = 2) {
  if (!data || data.length < 8) return false;
  const [r0, g0, b0] = [data[0], data[1], data[2]];
  for (let i = 4; i < data.length; i += 4) {
    if (Math.abs(data[i] - r0) > tolerancia
      || Math.abs(data[i + 1] - g0) > tolerancia
      || Math.abs(data[i + 2] - b0) > tolerancia) return false;
  }
  return true;
}

// Muestrea el lienzo en 8×8 (256 bytes, nada de leer 4 MB de píxeles) y dice si
// quedó de un solo color. Ante cualquier error devuelve false: la duda NUNCA
// puede descartar una conversión buena.
const TAM_MUESTRA = 8;
function lienzoEnBlanco(canvas) {
  try {
    const m = document.createElement('canvas');
    m.width = TAM_MUESTRA; m.height = TAM_MUESTRA;
    const ctx = m.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, TAM_MUESTRA, TAM_MUESTRA);
    return pixelesUniformes(ctx.getImageData(0, 0, TAM_MUESTRA, TAM_MUESTRA).data);
  } catch { return false; }
}

async function decodificar(blob) {
  // createImageBitmap es lo más rápido y no toca el DOM.
  try { return { bmp: await createImageBitmap(blob) }; } catch {}
  // Fallback <img>: Safari decodifica HEIC por acá aunque createImageBitmap falle,
  // y los WebView embebidos (abrir el portal desde WhatsApp) a veces no traen
  // createImageBitmap. Con TIMEOUT: un decoder colgado sin onload/onerror dejaría
  // la promesa eterna y saveEvidenciaLocal nunca guardaría (ya pasó en este repo
  // con compressImage). 15s y se rinde → el caller sube el original.
  let url = null;
  try {
    url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    const ok = await new Promise((res) => {
      const t = setTimeout(() => res(false), 15000);
      img.onload = () => { clearTimeout(t); res(true); };
      img.onerror = () => { clearTimeout(t); res(false); };
      img.src = url;
    });
    if (!ok || !(img.naturalWidth > 0)) {
      URL.revokeObjectURL(url);
      return null;
    }
    // 🔴 `onload` NO garantiza que la imagen esté DECODIFICADA: con
    // decoding='async' el navegador puede diferir el decode, y si para entonces
    // la object URL ya se revocó, `drawImage` no pinta nada y el lienzo sale en
    // blanco. Por eso acá se espera el decode Y se revoca recién cuando el
    // caller terminó de dibujar (`liberar`), no en un finally que corre antes.
    try { if (img.decode) await img.decode(); } catch {}
    const liberar = () => { try { URL.revokeObjectURL(url); } catch {} };
    return { img, liberar };
  } catch {
    if (url) { try { URL.revokeObjectURL(url); } catch {} }
    return null;
  }
}

/**
 * Optimiza una imagen de evidencia. Devuelve SIEMPRE algo utilizable:
 *   { blob, mime, nombre, convertida, medida }
 * - convertida=true → blob nuevo JPEG (nombre re-extensionado a .jpg)
 * - convertida=false → blob original con el MIME REAL detectado
 * - medida = { bytes, ancho, alto } del blob QUE SE DEVUELVE, o null si no se
 *   pudo medir (un PDF, un HEIC que este navegador no decodifica). Lo consume
 *   `evaluarCalidadComprobante` para decidir si la foto sirve — y tiene que
 *   describir el archivo FINAL, porque el blanco del 16-set-2026 lo produjo la
 *   optimización, no el original.
 */
export async function optimizarImagenEvidencia(blob, nombre = '') {
  const ext = extDe(nombre);
  const tipo = (blob?.type || '').toLowerCase();

  // No-imágenes: PDF y demás pasan intactos.
  const pareceImagen = tipo.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp'].includes(ext) || tipo === '';
  if (!pareceImagen || tipo === 'application/pdf' || ext === 'pdf') {
    return { blob, mime: tipo || 'application/octet-stream', nombre, convertida: false, medida: null };
  }

  const heic = tipo.includes('hei') || ['heic', 'heif'].includes(ext) || await esHeicBytes(blob);

  // PNG chico (firmas): respetar tal cual.
  if (!heic && (tipo === 'image/png' || ext === 'png') && blob.size <= PNG_KEEP_BYTES) {
    return { blob, mime: 'image/png', nombre, convertida: false, medida: null };
  }

  const dec = await decodificar(blob);
  if (!dec) {
    // No se pudo decodificar acá (p.ej. HEIC en Chrome): subir el original con
    // su MIME VERDADERO para que los visores no intenten pintarlo como JPEG.
    // Sin dimensiones no hay `medida`: lo que no se pudo mirar no se juzga.
    const mimeReal = heic ? 'image/heic' : (tipo || 'application/octet-stream');
    return { blob, mime: mimeReal, nombre, convertida: false, medida: null };
  }

  try {
    const w = dec.bmp ? dec.bmp.width : dec.img.naturalWidth;
    const h = dec.bmp ? dec.bmp.height : dec.img.naturalHeight;
    const fuente = dec.bmp || dec.img;
    const canvas = document.createElement('canvas');

    // Dibuja la fuente al lado mayor pedido. Se separa del encode porque los
    // dos primeros escalones REUSAN el mismo lienzo: redibujar en cada intento
    // triplicaría el trabajo de la CPU en un celular de obra.
    const dibujar = (ladoMayor) => {
      const escala = Math.min(1, ladoMayor / Math.max(w, h));
      canvas.width = Math.max(1, Math.round(w * escala));
      canvas.height = Math.max(1, Math.round(h * escala));
      const ctx = canvas.getContext('2d');
      // Fondo blanco: JPEG no tiene alfa (un PNG transparente quedaría negro).
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height);
    };
    dibujar(MAX_DIM);

    // El decoder dijo que sí, pero al lienzo no llegó nada: subir el ORIGINAL.
    // Guardar un rectángulo blanco es perder la evidencia en silencio, y la
    // pérdida es definitiva porque el blob local se borra tras subir.
    if (lienzoEnBlanco(canvas)) throw new Error('lienzo-en-blanco');

    const jpeg = await encodarHastaObjetivo(async (dim, q) => {
      if (dim) dibujar(dim);
      return new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));
    });
    if (dec.bmp?.close) { try { dec.bmp.close(); } catch {} }
    dec.liberar?.();
    if (!jpeg) throw new Error('toBlob null');
    // Usar la versión convertida si es HEIC (obligatorio: si no, no se ve) o si
    // realmente achica el archivo; si no, dejar el original.
    if (heic || jpeg.size < blob.size) {
      const nombreJpg = nombre ? nombre.replace(/\.[a-z0-9]+$/i, '') + '.jpg' : 'foto.jpg';
      return {
        blob: jpeg, mime: 'image/jpeg', nombre: nombreJpg, convertida: true,
        medida: { bytes: jpeg.size, ancho: canvas.width, alto: canvas.height },
      };
    }
    // Se queda el original: la medida es la SUYA (sus dimensiones, su peso).
    return { blob, mime: tipo || 'image/jpeg', nombre, convertida: false, medida: { bytes: blob.size, ancho: w, alto: h } };
  } catch (e) {
    if (dec.bmp?.close) { try { dec.bmp.close(); } catch {} }
    dec.liberar?.();
    if (e?.message === 'lienzo-en-blanco') {
      console.warn('[optimizar-imagen] el lienzo salió de un solo color — se sube el archivo ORIGINAL sin optimizar');
    }
    const mimeReal = heic ? 'image/heic' : (tipo || 'application/octet-stream');
    return { blob, mime: mimeReal, nombre, convertida: false, medida: null };
  }
}
