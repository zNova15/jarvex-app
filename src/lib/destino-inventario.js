// ═══════════════════════════════════════════════════════════════════
// JARVEX — QUÉ VA A PASAR CON ESTE INSUMO (tanda 6, 15-set-2026). Lib PURA.
//
// ── EL PEDIDO ──────────────────────────────────────────────────────
// Gabriel, 15-set-2026: «¿qué pasa con los insumos que en algún momento se
// los considera activos fijos? […] es importante ya que con eso también se
// sabe qué insumo se utilizarán dentro de la empresa y no se venderán, para
// que se muestre de esta manera en nuestro inventario».
//
// Hoy el inventario por empresa contesta UNA pregunta —qué compró y qué
// vendió— y trata todo como mercadería. Una retroexcavadora y una bolsa de
// cemento salen en la misma tabla, con la misma columna «Saldo», como si las
// dos estuvieran esperando a un comprador. No lo están: una se usa hasta que
// se deprecia y la otra se consume en la obra.
//
// ── DOS COSAS DISTINTAS, Y NO SE MEZCLAN ──────────────────────────
//
//  1. EL HECHO — «esta línea YA es un activo fijo cargado». No es una
//     opinión: `activos_fijos` tiene `accounting_movement_id` y
//     `accounting_item_idx`, y los 12 activos que existen en producción están
//     los 12 vinculados a su línea de factura. El dato estaba; lo que faltaba
//     era que el inventario lo LEYERA. Sale de `activosPorLinea()`.
//
//  2. LA DECISIÓN — «qué va a pasar con este insumo»: se consume, se usa y
//     dura, se revende, o entra de una forma y sale de otra. Eso lo decide
//     una persona y se guarda. Sale de `destinoPorNombre()`.
//
// Confundirlas sería el error de siempre: un hecho que se puede consultar no
// se le pregunta a nadie, y una decisión que nadie tomó no se inventa.
//
// ── EL VOCABULARIO NO ES NUEVO ────────────────────────────────────
// Los cuatro cajones son los de `recomendador-activos.js` (tanda 7, 6-set),
// que Gabriel definió con estas mismas palabras: «podría o bien revenderse o
// ser parte de uso de la empresa para transformarla en otro insumo (planchas
// metálicas por ejemplo a láminas más pequeñas)». Acá se declaran como ESPEJO
// —con un test que falla si divergen— y no por import: ver la nota más abajo,
// que explica qué pasó en el build cuando se importaban.
//
// ── DÓNDE VIVE LA DECISIÓN ────────────────────────────────────────
// En `cotejo_decisiones` (mig 196) con ámbito 'destino_inv'. Sin migración:
// es la tabla genérica de «esto ya lo contestó una persona», tiene índice
// [ambito+llave], sincroniza sola y sabe deshacer. Es la misma decisión que
// se tomó en la tanda 3 para «no va al inventario», y por el mismo motivo.
//
// 🔴 LA DECISIÓN VA POR NOMBRE, EL HECHO POR LÍNEA. No es una inconsistencia:
// «esta compra de S/ 70.002,85 es el remolcador Kenworth del registro 7.1» es
// una línea concreta de una factura concreta. «Los taladros son para uso de
// la empresa» es una política sobre el insumo, y escribirla 40 veces —una por
// cada factura de taladros— sería pedirle a la contadora que conteste 40
// veces la misma pregunta. Cuando una compra puntual se aparta de la política
// de su insumo, lo que la distingue es el HECHO: se carga al 7.1 y esa línea
// queda marcada por el join, sin depender de la decisión.
// ═══════════════════════════════════════════════════════════════════
import { normInsumo } from './insumo-correlacion.js';

// ── ESPEJO DE `recomendador-activos.js`, VERIFICADO POR TEST ────────
// 🔴 Estos tres valores están DUPLICADOS a propósito, y hay un test que falla
// si dejan de coincidir con los del recomendador (`destino-inventario.test.js`).
//
// Importarlos de allá era lo primero que hice, y el build lo delató: el
// recomendador arrastra `catalogo-subfamilias` → `mapeo-insumos`, y esta lib
// la termina necesitando el inventario por empresa. Ese peso aparecía en el
// reparto de chunks de dist/assets — justo lo que la regla 1 del CLAUDE.md
// manda mirar después de cada build.
//
// La alternativa —un archivo nuevo de diez líneas solo para tres constantes—
// era peor: una lib más que mantener para que nadie la lea nunca. El espejo
// con test es el mismo patrón que ya usa `cuentaPropuestaPorTexto` contra
// CUENTAS_ACTIVO_FIJO, y que la visibilidad de evidencias contra su RLS: se
// duplica el dato, se prohíbe que diverja.
const CAJON = {
  ACTIVO: 'activo_uso',
  REVENTA: 'reventa',
  TRANSFORMA: 'transforma',
  GASTO: 'gasto',
};
/** La llave de una línea de factura. Espejo de `claveLinea` del recomendador. */
const claveLinea = (movimientoId, idx) => `${movimientoId}::${idx}`;

export const AMBITO_DESTINO = 'destino_inv';

/** Los destinos que una persona puede elegir (sin_propuesta no es elegible). */
export const DESTINOS = [CAJON.GASTO, CAJON.ACTIVO, CAJON.REVENTA, CAJON.TRANSFORMA];

/**
 * Cómo se llama cada uno en pantalla, y qué significa para el inventario.
 *
 * `contable` es lo que esta decisión le hace al LIBRO DIARIO desde la tanda 4
 * del destino (21-set). Antes esto solo pintaba el saldo de esta pantalla;
 * ahora elige entre las tres primeras subcuentas de la 60, que es como el PCGE
 * distingue lo que se revende de lo que se transforma de lo que se consume. Se
 * dice acá, donde se decide: una decisión que mueve la contabilidad y no avisa
 * es la que nadie revisa. Ver `naturaleza-insumo.js`.
 */
export const DESTINO_INFO = {
  [CAJON.GASTO]: {
    label: 'Se consume',
    ayuda: 'Se incorpora a la obra o se gasta: cemento, combustible, papelería. Es lo normal y no hace falta marcarlo.',
    contable: 'En el libro diario queda con la cuenta que le da su clasificación (602 materias primas, 603 auxiliares, 656 suministros).',
    badge: 'b-gray', icono: '🧱',
  },
  [CAJON.ACTIVO]: {
    label: 'Uso de la empresa',
    ayuda: 'La empresa lo usa y dura más de un ejercicio. NO está para vender: no debería contarse como mercadería disponible.',
    contable: 'En el libro diario NO lo manda solo a la cuenta 33: un bien se activa cuando se carga en el registro de activos fijos (7.1), no por marcarlo acá. Hasta entonces sale marcado para revisar.',
    badge: 'b-blue', icono: '🏗',
  },
  [CAJON.REVENTA]: {
    label: 'Para revender',
    ayuda: 'Se compró para volver a venderlo. Acá el saldo comprado − vendido sí es lo que queda por colocar.',
    contable: 'En el libro diario sus compras pasan a la 601 Mercaderías: «bienes adquiridos para ser vendidos sin someterlos a transformación».',
    badge: 'b-green', icono: '🏷',
  },
  [CAJON.TRANSFORMA]: {
    label: 'Se transforma',
    ayuda: 'Entra de una forma y sale de otra (planchas metálicas a láminas). Su saldo no cierra solo hasta que exista el movimiento de transformación.',
    contable: 'En el libro diario sus compras pasan a la 602 Materias primas: «bienes que luego de un proceso de transformación se convierten en productos terminados».',
    badge: 'b-amber', icono: '🔁',
  },
};

/** La ayuda completa de un cajón: qué significa y qué le hace a la contabilidad. */
export const ayudaDestino = (d) => {
  const i = DESTINO_INFO[d];
  return i ? [i.ayuda, i.contable].filter(Boolean).join(' ') : '';
};

export const labelDestino = (d) => DESTINO_INFO[d]?.label || d || '';

// ── 1. EL HECHO: qué líneas ya son un activo fijo ──────────────────
/**
 * Las líneas de factura que YA tienen un activo fijo cargado encima.
 * @param activos  filas de `activos_fijos` (las del hook, ya por empresa)
 * @returns Set('movId::idx') — la misma llave que usa el recomendador.
 */
export function activosPorLinea(activos) {
  const s = new Set();
  for (const a of (activos || [])) {
    if (!a || a.deleted_at) continue;
    if (!a.accounting_movement_id) continue;
    // `accounting_item_idx` puede ser 0, que es un índice válido: comparar
    // contra null/undefined y no con un `!a.accounting_item_idx`, que
    // descartaría justo la primera línea de cada factura.
    const idx = a.accounting_item_idx;
    if (idx === null || idx === undefined) continue;
    s.add(claveLinea(a.accounting_movement_id, Number(idx)));
  }
  return s;
}

/** ¿Esta línea de factura ya está cargada como activo fijo? */
export const lineaEsActivo = (l, setLineas) =>
  !!(setLineas && l && l.movId != null && setLineas.has(claveLinea(l.movId, Number(l.itemIdx))));

// ── 2. LA DECISIÓN: qué va a pasar con este insumo ─────────────────
/**
 * El destino elegido para cada descripción.
 * @param filas  `cotejo_decisiones` tal como las entrega el hook
 * @returns Map(nombreNorm → destino)
 */
export function destinoPorNombre(filas) {
  const m = new Map();
  const at = new Map();
  for (const f of (filas || [])) {
    if (!f || f.deleted_at) continue;
    if (f.ambito !== AMBITO_DESTINO) continue;
    if (!f.llave || !DESTINOS.includes(f.decision)) continue;
    // Las dos PCs pueden haber contestado distinto: gana la más reciente,
    // igual que en el resto del repo.
    const cuando = String(f.updated_at || f.created_at || '');
    if (m.has(f.llave) && cuando < (at.get(f.llave) || '')) continue;
    m.set(String(f.llave), f.decision);
    at.set(String(f.llave), cuando);
  }
  return m;
}

/** La llave con la que se guarda el destino de una descripción. */
export const llaveDestino = (nombre) => normInsumo(nombre);

/**
 * Lo que `inventarioDeEmpresa` espera en `opts.destinoDe`: el destino de cada
 * descripción con su consecuencia ya resuelta.
 * → Map(nombreNorm → { destino, saldoVendible })
 *
 * 🔴 Se arma ACÁ y no allá porque `inventario-empresa.js` es la lib BASE —la
 * importan muchas pantallas, hasta `bandas-correlacion`— y no puede depender
 * de esta capa. Ver la nota de sus imports: la primera versión lo hacía al
 * revés y el build lo delató moviendo el reparto de chunks.
 */
export function destinoParaInventario(filas) {
  const out = new Map();
  for (const [llave, destino] of destinoPorNombre(filas)) {
    out.set(llave, { destino, saldoVendible: saldoEsVendible(destino) });
  }
  return out;
}

/**
 * Lo que `inventarioDeEmpresa` espera en `opts.esActivo`: una función que dice
 * si una línea de factura ya está cargada en el registro 7.1.
 */
export const esActivoDe = (setLineas) => (l) => lineaEsActivo(l, setLineas);

/**
 * ¿El saldo «comprado − vendido» de este insumo significa algo?
 *
 * Solo para lo que se revende. Para un activo de uso el saldo es la cantidad
 * que la empresa tiene y usa —no «lo que queda por colocar»—, y para lo que se
 * transforma el saldo no cierra hasta que exista el movimiento que lo
 * convierte. Mostrar los tres con la misma columna y el mismo rojo es lo que
 * hace que nadie confíe en ninguno.
 */
export const saldoEsVendible = (destino) => destino === CAJON.REVENTA || !destino;

/** Cuántos insumos hay en cada destino, para los contadores de la pantalla. */
export function contarDestinos(insumos) {
  const out = { sin_decidir: 0, activos_cargados: 0 };
  for (const d of DESTINOS) out[d] = 0;
  for (const ins of (insumos || [])) {
    if (ins?.destino && out[ins.destino] != null) out[ins.destino]++;
    else out.sin_decidir++;
    if ((ins?.activosCargados || 0) > 0) out.activos_cargados++;
  }
  return out;
}
