// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA NATURALEZA DE UN INSUMO (tanda 4 del destino, 21-set-2026).
//
// ── LA PREGUNTA QUE FALTABA ───────────────────────────────────────
// `pcge-puente.js` contesta «¿QUÉ ES esto?» mirando la familia: una tubería de
// PVC es la familia 66 y va a la 602. Pero el PCGE no elige la cuenta de
// compra por lo que la cosa ES: la elige por lo que la empresa VA A HACER con
// ella. Las tres primeras subcuentas de la 60 son literalmente eso:
//
//   · 601 Mercaderías     «bienes adquiridos […] para ser vendidos sin
//                          someterlos a transformación» (PCGE p. 155)
//   · 602 Materias primas «bienes que luego de un proceso de transformación
//                          se convierten en productos terminados»
//   · 603 Materiales aux. lo que se consume produciendo, sin incorporarse.
//
// La MISMA tubería de PVC es 602 si se instala en la obra, 601 si la ferretería
// del grupo la revende tal cual, y 33x si la empresa la usa como parte de un
// equipo propio. La familia no puede distinguirlas —las tres dicen «tubería de
// PVC»— y ninguna IA tampoco: el dato no está en el comprobante, está en la
// política de la empresa sobre ese insumo. Es el mismo callejón del diesel de
// la tanda 1, y se resuelve igual: preguntándolo UNA vez.
//
// ── UNA VEZ POR INSUMO, NO POR FACTURA ────────────────────────────
// Y esa pregunta YA ESTÁ HECHA. La tanda 6 del inventario (15-set) creó el
// cajón «qué va a pasar con este insumo» con estos cuatro valores exactos, por
// NOMBRE del insumo y no por línea de factura, guardado en `cotejo_decisiones`
// con ámbito 'destino_inv'. Lo dice su propio encabezado: «"Los taladros son
// para uso de la empresa" es una política sobre el insumo, y escribirla 40
// veces —una por cada factura de taladros— sería pedirle a la contadora que
// conteste 40 veces la misma pregunta».
//
// Así que esta tanda NO agrega una migración ni una pregunta nueva. Agrega el
// PUENTE entre una decisión que ya se toma y la cuenta que el libro diario ya
// escribe. Crear un campo `naturaleza` en `catalogo_insumos` habría sido pedir
// por segunda vez, con otras palabras, algo que la contadora ya contestó — y
// garantizar que los dos campos se contradigan el día que alguien cambie uno.
//
// ── EL HECHO LE GANA A LA POLÍTICA ────────────────────────────────
// Misma regla que la tanda 6, y por el mismo motivo. La política dice qué pasa
// con los taladros EN GENERAL; el hecho dice qué pasó con ESTA línea:
//
//   · La línea está cargada en `activos_fijos` (mig 180/182, con
//     `accounting_movement_id` + `accounting_item_idx`) → es un activo, y la
//     cuenta es la que el propio registro 7.1 le puso. No es una opinión.
//   · El ítem tiene `venta_status` 'vendido' o 'para_venta' (`insumos-venta.js`,
//     ago-2026) → se revendió o está separado para revenderse. Tampoco es una
//     opinión: hay una factura de venta del otro lado.
//
// Los dos hechos viajan en datos que la app ya tiene, así que dan cobertura sin
// que nadie conteste nada.
//
// ── LO QUE NO SE HACE: ACTIVAR POR DECRETO ────────────────────────
// 🔴 «Uso de la empresa» NO manda la línea a la 33. Parece la traducción obvia
// y es la trampa. Dos motivos, los dos medidos antes en este repo:
//
//   1. El cajón dice «la empresa lo usa y dura más de un ejercicio». Eso es
//      verdad de un taladro de S/ 150, y un taladro de S/ 150 no se activa: el
//      Reglamento de la LIR deja mandarlo a gasto por debajo de 1/4 de UIT.
//   2. Y al revés: el umbral tampoco decide. `recomendador-activos.js` lo dejó
//      escrito después de mirar las compras reales — «de las 27 líneas que
//      pasan el umbral once no son bienes […] y en cambio los generadores
//      KAILI quedan por debajo».
//
// O sea que ni la política ni el monto alcanzan para afirmar un activo. Lo
// único que lo afirma es que alguien lo haya cargado en el registro 7.1. Así
// que cuando la política dice «uso de la empresa» y no hay activo cargado, la
// cuenta NO se toca y la línea sale marcada para revisar, con el motivo dicho.
// Es la regla 8 del CLAUDE.md aplicada a la contabilidad: una fila que dice
// «faltaría verificar esto» se filtra y se resuelve; una mandada a la 33 por
// decreto se pierde entre las buenas y desaparece del resultado del ejercicio.
//
// ── 🔴 LA POLÍTICA ES DEL GRUPO, NO DE LA EMPRESA ─────────────────
// Verificado en `decidirCotejo` (`cotejo-sunat-db.js`): resuelve por
// `[ambito + llave]` y da de baja las demás — «una sola respuesta viva por
// pregunta». El `company_id` que se guarda dice QUIÉN la tomó, no para quién
// vale. Así que si la ferretería del grupo marca «TUBERIA PVC» como reventa,
// la constructora que la instala también la va a asentar en la 601.
//
// Se deja así a propósito en esta tanda: arreglarlo es cambiar la escritura de
// la tanda 6 y migrar las decisiones que ya existan, y eso es una decisión de
// Gabriel, no un efecto colateral de conectar el libro diario. Lo que sí se
// hace es no esconderlo — cada línea viaja con su `porque` y su `motivo`, la
// ventana de consecuencias dice a cuántas facturas alcanza, y la cuenta a mano
// (mig 220) le sigue ganando a todo esto. Los dos HECHOS, en cambio, son por
// línea y no tienen este problema.
//
// ── SIN MEDICIÓN DE PRODUCCIÓN (21-set) ───────────────────────────
// Las tandas 1 a 3 traen cuántos movimientos toca cada regla. Ésta no: la
// sesión no tuvo el MCP de Supabase autorizado y no se pudo contar cuántas
// filas 'destino_inv' hay hoy ni cuántos ítems traen `venta_status`. Se sabe
// que hubo CERO hasta el 16-set —la tanda 6 tenía un bug que mataba el handler
// antes de escribir, arreglado ese día—, así que la cobertura de la parte de
// política es baja y crece a medida que se usa la pantalla de inventario. La
// de los dos HECHOS es la que haya en los datos. Queda por confirmar contra
// producción antes de promover.
//
// Funciones puras, sin Dexie ni React. Testeadas en
// __tests__/naturaleza-insumo.test.js.
// ═══════════════════════════════════════════════════════════════════

import { normInsumo } from './insumo-correlacion.js';

// ── ESPEJO DE `destino-inventario.js`, VERIFICADO POR TEST ─────────
// 🔴 Los cuatro valores están duplicados a propósito y hay un test que falla si
// dejan de coincidir con los de allá. Es el mismo patrón —y por el mismo
// motivo— que usa `destino-inventario.js` contra `recomendador-activos.js`:
// importarlos arrastraría esa lib (y con ella el inventario por empresa) al
// chunk del Libro Diario, que es justo lo que la regla 1 del CLAUDE.md manda
// mirar después de cada build. Se duplica el dato, se prohíbe que diverja.
export const NATURALEZA = {
  GASTO: 'gasto',
  ACTIVO: 'activo_uso',
  REVENTA: 'reventa',
  TRANSFORMA: 'transforma',
};

/** La llave con la que se guardó la decisión. Espejo de `llaveDestino`. */
export const llaveNaturaleza = (nombre) => normInsumo(nombre);

/** Las dos subcuentas que el PCGE define por el DESTINO del bien, no por lo que es. */
export const CUENTA_MERCADERIA = '601';
export const CUENTA_MATERIA_PRIMA = '602';

/**
 * ¿La cuenta que propuso la familia es la de un BIEN comprado?
 *
 * Solo sobre ésas tiene sentido preguntarse si se revende o se transforma. Un
 * alquiler (635), una capacitación (624) o un pasaje (631) no entran a ningún
 * inventario: marcar «para revender» un servicio no lo convierte en mercadería,
 * y moverlo a la 601 sería asentar un bien que no existe. La 656 entra porque
 * es un bien —herramienta, EPP, suministro— que el PCGE manda directo al
 * gasto: si resulta que se compró para revender, la 601 le corresponde igual.
 */
export function esCuentaDeBien(cuenta) {
  const c = String(cuenta ?? '').trim();
  return c.startsWith('60') || c.startsWith('656');
}

/** Los `venta_status` que son un HECHO de reventa (ver `insumos-venta.js`). */
const VENTA_ES_HECHO = new Set(['para_venta', 'vendido']);

/** ¿Este ítem de la factura ya se separó para vender, o ya se vendió? */
export function itemSeRevende(item) {
  return VENTA_ES_HECHO.has(String(item?.venta_status || '').trim());
}

/**
 * La cuenta por naturaleza de una línea, corregida por lo que la empresa hace
 * con ese insumo.
 *
 * @param {string} cuentaFamilia  la que propuso `cuentaDeFamilia` (602, 656, 631…)
 * @param {string|null} politica  el destino de inventario del insumo, por nombre
 * @param {object} [opts]
 *   activo      la fila de `activos_fijos` de ESTA línea, si la hay (el hecho)
 *   seRevende   true si el ítem tiene `venta_status` (el otro hecho)
 * @returns {{cuenta, porque, revisar, cambiada, motivo}|null}
 *          null = no hay nada que decir; manda la familia.
 */
export function cuentaPorNaturaleza(cuentaFamilia, politica, { activo = null, seRevende = false } = {}) {
  const base = String(cuentaFamilia ?? '').trim();

  // ── HECHO 1: la línea ya está cargada en el registro 7.1 ──
  // Gana sobre todo, incluso sobre un servicio: si alguien la activó, es un
  // activo, y la cuenta correcta es la que ESE registro le puso (33411 para
  // una camioneta, 33611 para una laptop). Deducirla de nuevo acá sería tener
  // el mismo número en dos lugares y que un día no coincidan.
  if (activo) {
    const c = String(activo.cuenta_contable || '').trim();
    if (c.startsWith('3')) {
      return {
        cuenta: c,
        cambiada: c !== base,
        revisar: false,
        motivo: 'activo_cargado',
        porque: `Esta línea está cargada en el registro de activos fijos (7.1) con la cuenta ${c}: `
          + 'no es un gasto del ejercicio, es un bien que se deprecia.',
      };
    }
    // Un activo sin cuenta del elemento 3 es una fila a medio llenar
    // (`validarActivo` ya la reclama). No se le inventa una: se avisa.
    return {
      cuenta: base,
      cambiada: false,
      revisar: true,
      motivo: 'activo_sin_cuenta',
      porque: 'Esta línea figura en el registro de activos fijos pero ahí no tiene cuenta del PCGE. '
        + `Mientras tanto se asienta en la ${base}. Completá la cuenta en el registro 7.1.`,
    };
  }

  // De acá para abajo solo se habla de bienes comprados.
  if (!esCuentaDeBien(base)) return null;

  // ── HECHO 2: el ítem se separó para vender, o ya se vendió ──
  // No es una opinión sobre el insumo: es esta compra puntual, con su factura
  // de venta del otro lado (`insumos-venta.js`). Por eso le gana a la política.
  if (seRevende) {
    return {
      cuenta: CUENTA_MERCADERIA,
      cambiada: CUENTA_MERCADERIA !== base,
      revisar: false,
      motivo: 'venta_registrada',
      porque: 'Este ítem está separado para venta o ya se vendió: el PCGE llama a eso mercadería '
        + '(601), «bienes adquiridos para ser vendidos sin someterlos a transformación».',
    };
  }

  // ── LA POLÍTICA: lo que se decidió una vez para este insumo ──
  const p = String(politica || '').trim();

  if (p === NATURALEZA.REVENTA) {
    return {
      cuenta: CUENTA_MERCADERIA,
      cambiada: CUENTA_MERCADERIA !== base,
      revisar: false,
      motivo: 'politica_reventa',
      porque: 'Este insumo está marcado «Para revender» en el inventario de la empresa: se compra para '
        + 'volver a venderlo tal cual, que es la definición de la 601 Mercaderías.',
    };
  }

  if (p === NATURALEZA.TRANSFORMA) {
    return {
      cuenta: CUENTA_MATERIA_PRIMA,
      cambiada: CUENTA_MATERIA_PRIMA !== base,
      revisar: false,
      motivo: 'politica_transforma',
      porque: 'Este insumo está marcado «Se transforma»: entra de una forma y sale de otra, que es la '
        + 'definición de la 602 Materias primas.',
    };
  }

  if (p === NATURALEZA.ACTIVO) {
    // 🔴 NO se activa por decreto. Ver el encabezado: ni la política ni el
    // monto alcanzan para afirmar un activo — solo el registro 7.1.
    return {
      cuenta: base,
      cambiada: false,
      revisar: true,
      motivo: 'activo_sin_registrar',
      porque: 'Este insumo está marcado «Uso de la empresa», pero esta línea no está cargada en el '
        + `registro de activos fijos (7.1). Por eso se asienta en la ${base} y no en la 33: activar `
        + 'una compra que nadie registró sería sacarla del resultado del ejercicio sin respaldo. '
        + 'Si corresponde activarla, cargala en el 7.1 y la cuenta cambia sola.',
    };
  }

  // «Se consume» es la política por defecto —la pantalla misma dice que «no
  // hace falta marcarlo»— y significa exactamente lo que la familia ya
  // propuso. Sin decisión, lo mismo: no hay nada que corregir.
  return null;
}

// ── EL HECHO, LISTO PARA CONSULTAR ────────────────────────────────
/**
 * Las filas de `activos_fijos` indexadas por la línea de factura que activaron.
 *
 * `destino-inventario.js` tiene un `activosPorLinea` que devuelve un Set —a esa
 * pantalla le alcanza con saber SI la línea está activada—. Acá hace falta la
 * FILA, porque lo que se necesita es su `cuenta_contable`: es el número que la
 * contadora escribió en el registro 7.1 y el asiento tiene que llevar ése, no
 * uno deducido de nuevo del texto.
 *
 * @param activos  filas de `activos_fijos`
 * @returns Map('movId::idx' → fila)
 */
export function activoPorLinea(activos) {
  const m = new Map();
  for (const a of (activos || [])) {
    if (!a || a.deleted_at) continue;
    if (!a.accounting_movement_id) continue;
    // `accounting_item_idx` puede ser 0, que es un índice válido: comparar
    // contra null/undefined y no con un `!idx`, que descartaría justo la
    // primera línea de cada factura (el mismo cuidado que en la tanda 6).
    const idx = a.accounting_item_idx;
    if (idx === null || idx === undefined) continue;
    m.set(`${a.accounting_movement_id}::${Number(idx)}`, a);
  }
  return m;
}

/** Lo que `cuentasDeComprobante` espera en `opts.activoDeLinea`. */
export const activoDeLineaDe = (mapa) => (movId, idx) =>
  (mapa instanceof Map && movId != null ? mapa.get(`${movId}::${Number(idx)}`) || null : null);

export default {
  NATURALEZA, CUENTA_MERCADERIA, CUENTA_MATERIA_PRIMA,
  llaveNaturaleza, esCuentaDeBien, itemSeRevende, cuentaPorNaturaleza,
  activoPorLinea, activoDeLineaDe,
};
