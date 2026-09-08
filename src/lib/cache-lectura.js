// ═══════════════════════════════════════════════════════════════════
// JARVEX — LO QUE YA SE PAGÓ NO SE VUELVE A PAGAR (tanda 15, entrega 5).
//
// Gabriel, 8-set-2026, después de que una lectura de bases fallara a mitad de
// camino: «acabo de gastar USD 0,030 para hacer el escaneo en esta prueba y no
// me gustaría perder eso. Mistral hizo su trabajo, tocaría reintentar con el
// de las otras».
//
// Tenía razón y el problema era real. El OCR es el 90% del costo y lo único
// que se paga de verdad; las pasadas de IA van a un gratuito. Pero cuando la
// extracción fallaba, el markdown ya leído vivía SOLO en el estado del modal:
// al cerrar la ventana se perdía, y reintentar significaba volver a pagar.
//
// Peor todavía en un .docx: `ocrDeBloques` suelta las imágenes al terminar
// cada tanda (para no tener 94 JPEG en memoria), así que un segundo intento
// sobre los mismos bloques no encontraba nada que mandar y devolvía un
// análisis SILENCIOSAMENTE PEOR, sin el texto de las páginas escaneadas.
//
// Esto guarda el resultado del OCR indexado por la HUELLA del archivo. Volver
// a subir el mismo documento cuesta USD 0.
//
// POR QUÉ UNA BASE PROPIA Y NO LA DE DEXIE. La base de la app tiene un
// esquema versionado que sincroniza con Supabase; meterle un almacén de caché
// obligaría a subir su versión y a migrar la base de todos los equipos por
// algo que es descartable por definición. Esto es IndexedDB pelado, con su
// propia base, que se puede borrar entera sin consecuencias.
// ═══════════════════════════════════════════════════════════════════

const DB = 'jarvex_lecturas';
const STORE = 'documentos';
const VERSION = 1;
/** Un mes. Unas bases integradas no cambian; y si cambian, cambia la huella. */
export const TTL_MS = 30 * 24 * 60 * 60 * 1000;

function abrir() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('sin IndexedDB'));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'huella' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('no se pudo abrir la caché'));
  });
}

/**
 * La huella del archivo: SHA-256 de su contenido.
 *
 * Del CONTENIDO y no del nombre: el mismo PDF renombrado no se vuelve a
 * pagar, y un archivo distinto con el mismo nombre no devuelve la lectura
 * equivocada. `crypto.subtle` existe en todo navegador sobre HTTPS.
 */
export async function huellaDe(file) {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Lo guardado para este archivo, o null. Lo vencido se borra al pasar. */
export async function leerCache(huella) {
  try {
    const db = await abrir();
    const fila = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(huella);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!fila) return null;
    if (Date.now() - (fila.guardadoEn || 0) > TTL_MS) { borrarCache(huella).catch(() => {}); return null; }
    return fila;
  } catch { return null; }        // sin caché se sigue igual: se paga y listo
}

/**
 * Guarda el texto ya leído. Solo se llama cuando el OCR costó algo: cachear
 * un documento nativo no ahorra nada y ocupa espacio.
 */
export async function guardarCache(huella, datos) {
  try {
    const db = await abrir();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ huella, guardadoEn: Date.now(), ...datos });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch { return false; }
}

export async function borrarCache(huella) {
  try {
    const db = await abrir();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(huella);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
    db.close();
  } catch { /* nada que borrar */ }
}

/** Cuánto hay guardado y cuánto se ahorró: para poder mostrarlo. */
export async function resumenCache() {
  try {
    const db = await abrir();
    const filas = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    const vivas = filas.filter(f => Date.now() - (f.guardadoEn || 0) <= TTL_MS);
    return {
      documentos: vivas.length,
      paginas: vivas.reduce((t, f) => t + (Number(f.paginasOcr) || 0), 0),
      usdAhorrado: vivas.reduce((t, f) => t + (Number(f.costoOcr) || 0), 0),
    };
  } catch { return { documentos: 0, paginas: 0, usdAhorrado: 0 }; }
}

export default { huellaDe, leerCache, guardarCache, borrarCache, resumenCache, TTL_MS };
