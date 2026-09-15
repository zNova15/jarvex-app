// ═══════════════════════════════════════════════════════════════════
// JARVEX — LO QUE VINO EN LA MISMA FACTURA (tanda 9, 15-set-2026).
//
// ── EL PEDIDO, Y LOS DOS CASOS QUE LO ORIGINARON ──────────────────
// Gabriel tuvo que buscar dos descripciones en Google Imágenes porque ni el
// motor local ni la IA sabían qué eran:
//
//   «PASTA FINA CPP»                       → la IA dijo NO SÉ
//   «SUPER. TR4 0.25 X 1.05 X 6MTS ALZN»   → la IA dijo [65] tubería de acero
//
// Las dos se contestan solas SIN SALIR DE LA BASE, mirando qué más traía el
// comprobante (medido el 15-set contra las facturas reales):
//
//   PASTA FINA CPP (E001-85, CASAS LLICO) vino con: PINTURA LAVABLE PATO,
//   PINTURA LAVABLE CREMA PATO, BROCHA TUMI 2"/3"/4", RODILLO 9"/12",
//   BANDEJA PARA PINTAR, LIJA, TRAPO INDUSTRIAL. Es una factura de pintura de
//   pared completa: la pasta es el empaste que se aplica antes de pintar.
//
//   SUPER. TR4 … ALZN (E001-73, M & G) vino con: PL. GALV. 0.80 X 1200 X 2400,
//   PL. GALV. 0.90, y cinco tubos galvanizados. Es una factura de estructura
//   metálica y cobertura: «TR4» es el perfil de la calamina y «ALZN» el
//   aluzinc. No es tubería, y con el vecindario a la vista no hay forma de
//   confundirla con una.
//
// ── POR QUÉ ESTO ANTES QUE UNA BÚSQUEDA WEB ───────────────────────
// Es gratis, ya está guardado y no sale de la empresa. Una búsqueda web
// costaría por consulta, tardaría, mandaría las descripciones de las compras a
// un buscador y aun así no sabría que el proveedor es una ferretería de
// acabados. Cobertura medida: 2.153 de 2.702 descripciones distintas (80%)
// tienen al menos un vecino en su factura; el promedio es 6,5 ítems por
// comprobante.
//
// ── DE QUÉ FACTURA SE TOMAN LOS VECINOS ───────────────────────────
// Una descripción puede aparecer en decenas de comprobantes. Se elige UNO: el
// que más plata movió de esa descripción. No el más reciente —una compra chica
// de ayer dice menos que la grande del mes pasado— y no todos juntos, que
// serían cientos de nombres y un prompt que cuesta más de lo que aclara.
//
// 🔴 ES CONTEXTO, NO NORMA, y el prompt lo dice así. Una ferretería vende de
// todo: que algo venga junto a pintura INCLINA, no demuestra. La evidencia del
// Anexo 2 le sigue ganando cuando se contradicen.
// ═══════════════════════════════════════════════════════════════════
import { normMapeo } from './mapeo-insumos.js';

/** Cuántos vecinos entran en el prompt. Más no aclara y sí cuesta. */
const MAX_VECINOS = 8;

const claveMapeo = (s) => normMapeo(String(s || '').trim());

/**
 * Para cada descripción, el comprobante donde más pesó y qué más traía.
 *
 * @param compras  las líneas de `lineasDeCompra()` — necesitan `movId`,
 *                 `nombre`, `cantidad`, `precio` y `proveedorNombre`.
 * @returns Map norm → { proveedor, doc, vecinos: [{nombre, unidad}] }
 */
export function vecindarioDeFactura(compras, { maxVecinos = MAX_VECINOS } = {}) {
  // 1. Las líneas de cada comprobante, juntas.
  const porMov = new Map();
  for (const c of (compras || [])) {
    if (!c?.movId || !c?.nombre) continue;
    if (c.clase && c.clase !== 'compra') continue;
    if (!porMov.has(c.movId)) porMov.set(c.movId, []);
    porMov.get(c.movId).push(c);
  }

  // 2. Para cada descripción, con qué comprobante se queda.
  const mejor = new Map();   // norm → { peso, movId }
  for (const [movId, lineas] of porMov.entries()) {
    for (const c of lineas) {
      const norm = claveMapeo(c.nombre);
      if (!norm) continue;
      const peso = (Number(c.cantidad) || 0) * (Number(c.precio) || 0);
      const prev = mejor.get(norm);
      // `>=` y no `>`: con todo en cero (una factura de anticipo, por ejemplo)
      // igual queda uno elegido en vez de ninguno.
      if (!prev || peso >= prev.peso) mejor.set(norm, { peso, movId });
    }
  }

  // 3. El vecindario propiamente dicho.
  const salida = new Map();
  for (const [norm, { movId }] of mejor.entries()) {
    const lineas = porMov.get(movId) || [];
    const vecinos = [];
    const vistos = new Set([norm]);
    for (const c of lineas) {
      const n = claveMapeo(c.nombre);
      // Ni ella misma, ni dos veces la misma cosa escrita igual.
      if (!n || vistos.has(n)) continue;
      vistos.add(n);
      vecinos.push({ nombre: String(c.nombre).trim(), unidad: c.unidad || '' });
      if (vecinos.length >= maxVecinos) break;
    }
    const cab = lineas[0] || {};
    salida.set(norm, {
      proveedor: cab.proveedorNombre || '',
      doc: cab.doc || '',
      vecinos,
    });
  }
  return salida;
}

/**
 * El vecindario de UNA fila de la bandeja, listo para mandar.
 *
 * Una fila puede ser un GRUPO de variantes correlacionadas (tanda 4): se mira
 * la de mayor importe, que es la que da el nombre a la fila. Devuelve null
 * cuando no hay nada que contar — así el prompt no paga un encabezado vacío.
 */
export function vecindarioDeFila(fila, mapa) {
  if (!fila || !mapa) return null;
  const candidatas = fila.variantes?.length
    ? [...fila.variantes].sort((a, b) => (b.importe || 0) - (a.importe || 0)).map(v => v.norm)
    : [fila.norm];
  for (const norm of candidatas) {
    const v = mapa.get(norm);
    if (v?.vecinos?.length) return v;
  }
  return null;
}
