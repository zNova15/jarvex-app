// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA VENTANA DE CONSECUENCIAS (tanda 3 del destino, 18-set-2026).
//
// ── LO QUE PIDIÓ GABRIEL ──────────────────────────────────────────
// «Cuando ellas lo corrijan, corrijan las decisiones anteriormente tomadas,
// emergiendo una ventana que mencione los cambios que ocasionaría en el
// sistema al cambiar tal vez el tipo de cuenta. Porque muchas veces se
// consideran gastos o consumos a cosas que realmente no lo son y por este tipo
// de fallos terminamos pagando más impuestos de los que debemos.»
//
// ── EL PROBLEMA, DICHO EN UNA LÍNEA ───────────────────────────────
// La cuenta del Libro Diario es el ÚLTIMO eslabón de una cadena:
//
//     ítem de la factura → familia (catálogo o clasificador) → cuenta 6x
//     vinculación (obra / gastos generales) → costo o gasto → destino 9x
//
// Hasta la tanda 2, corregir la cuenta escribía solo `cuenta_pcge`, que es un
// parche sobre el último eslabón. La familia del insumo seguía mal, así que la
// próxima factura con el mismo ítem volvía a salir mal; y el `type` seguía
// diciendo «costo» aunque el destino elegido fuera de gasto, así que el Estado
// de Resultados no se enteraba. Se corregía el síntoma y la causa quedaba.
//
// ── LOS TRES BLOQUES ──────────────────────────────────────────────
//   A · QUÉ CAMBIA en este comprobante: las líneas del asiento antes y
//       después, si pasa de costo a gasto, y lo que la cuenta nueva significa
//       para la renta (un activo no es gasto del año; una existencia tampoco).
//   B · DE DÓNDE SALIÓ la cuenta, ítem por ítem, con la opción de corregir la
//       CAUSA: la familia del insumo. Y si el destino no coincide con el tipo
//       del comprobante, la opción de corregir el tipo.
//   C · A QUÉ MÁS SE APLICA: los otros comprobantes que se mueven solos por la
//       corrección de B, cuántos son de meses ya presentados, cuántos de otras
//       empresas, cuántos tienen una cuenta puesta a mano (esos no se tocan).
//
// ── SE SIMULA, NO SE ADIVINA ──────────────────────────────────────
// Todo lo que la ventana dice sale de correr el MISMO generador de asientos con
// la corrección aplicada en memoria (`resolvedorCorregido`). Si dice «la 602
// pasa a la 656», es porque el asiento, generado de nuevo, dice eso. Una
// ventana de consecuencias que calculara aparte lo que cree que va a pasar
// sería una segunda fuente de verdad, y tarde o temprano mentiría.
//
// ── SOLO APARECE CUANDO HAY ALGO QUE DECIR ────────────────────────
// Una ventana que sale siempre se cierra sin leer (la misma lección que el
// «marcar todas» que Gabriel rechazó). Cambiar solo la contrapartida, o volver
// a automático, se guarda directo.
//
// Funciones puras, sin React ni Dexie. Testeadas en
// __tests__/consecuencias-correccion.test.js.
// ═══════════════════════════════════════════════════════════════════

import { cuentasDeComprobante, itemsDe } from './cuenta-de-comprobante.js';
import { CUENTA_POR_FAMILIA, cuentaDeFamilia } from './pcge-puente.js';
import { claveMapeo } from './mapeo-insumos.js';
import { etiquetaCategoria } from './indices-unificados-iupc.js';
import { generarAsiento } from './asientos.js';
import { derivarTypeContable } from './clasificacion-contable.js';
import { movEnPeriodoCerrado, CERRADO_HASTA_DEFAULT } from './periodo-contable.js';
import { nombreDeCuenta } from './pcge.js';
import { nombreDestino, seTraslada } from './destino-asiento.js';
import { esVentaMov } from './costo-obra.js';

const txt = (v) => String(v ?? '').trim();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * ¿Dos cuentas dicen lo mismo a distinto nivel de detalle? 602 y 6021 sí (una
 * es la madre de la otra); 602 y 603 no. Es lo que decide si una corrección
 * contradice lo que dedujo la app o solo lo afina.
 */
export function cuentasCompatibles(a, b) {
  const x = txt(a); const y = txt(b);
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/** Nombre de cualquier cuenta que pueda aparecer en un asiento (incluido el elemento 9). */
export function nombreDeLinea(codigo) {
  const c = txt(codigo);
  if (!c) return '';
  if (c[0] === '9') return nombreDestino(c) || nombreDeCuenta(c) || '';
  return nombreDeCuenta(c) || '';
}

// ═══════════════════════════════════════════════════════════════════
// B · DE DÓNDE SALIÓ LA CUENTA
// ═══════════════════════════════════════════════════════════════════

/**
 * Las familias que llevan a una cuenta: el puente leído al revés.
 *
 * Es la lista que se le ofrece a la contadora para corregir la causa. Si elige
 * la 656 para un comprobante que salió en la 602, las únicas familias que
 * tiene sentido proponerle son las que el puente manda a la 656 — ofrecerle
 * las 95 sería hacerla buscar, y ofrecerle una que lleva a otra cuenta sería
 * dejarla corregir la causa hacia un lugar que no es el que eligió.
 *
 * La compatibilidad es en los dos sentidos: si eligió la 63 (a dos cifras),
 * sirven todas las familias que caen en alguna 63x.
 */
export function familiasDeCuenta(cuenta, { esVenta = false } = {}) {
  const c = txt(cuenta);
  if (!c) return [];
  const out = [];
  for (const f of Object.keys(CUENTA_POR_FAMILIA)) {
    const r = cuentaDeFamilia(f, { esVenta });
    if (r && cuentasCompatibles(r.cuenta, c)) {
      out.push({ codigo: f, nombre: etiquetaCategoria(f), cuenta: r.cuenta });
    }
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

/**
 * Dónde se escribe la corrección de UNA descripción. Es la decisión más
 * delicada de la tanda, porque de ella depende cuánto se mueve:
 *
 *   'insumo'      la descripción ES un insumo del catálogo (mismo nombre), o
 *                 la decisión la apunta a un insumo que se llama igual. Lo que
 *                 está mal es la familia de ese insumo: se corrige ahí, y se
 *                 mueven todas las descripciones que apuntan a él.
 *   'descripcion' la descripción apunta a un insumo con OTRO nombre, o nadie
 *                 la decidió (la dedujo el clasificador). Se la da de alta como
 *                 insumo propio con la familia elegida. No se mueve nadie más.
 *
 * El caso del medio es el que justifica esto: si «AMOLADORA BOSCH» quedó
 * apuntada al insumo «ACERO CORRUGADO 1/2», cambiarle la familia al acero para
 * arreglar la amoladora rompería todas las facturas de acero. Ante la duda, se
 * elige lo que menos mueve, y la ventana dice qué quedó sin tocar.
 */
export function alcanceDeCorreccion(item) {
  const it = item || {};
  if (it.catalogoId && it.via === 'nombre') return 'insumo';
  if (it.catalogoId && it.via === 'alias' && it.catalogoNorm && it.catalogoNorm === it.norm) return 'insumo';
  return 'descripcion';
}

/**
 * Por qué el comprobante salió en la cuenta que salió, una fila por
 * descripción distinta, y qué familia lo llevaría a la cuenta nueva.
 *
 * Solo aparecen las descripciones que la cuenta nueva CONTRADICE: si el
 * comprobante está repartido entre 602 y 656 y la contadora elige la 656, las
 * herramientas ya iban ahí y no hay causa que corregir en ellas.
 *
 * @param {object} mov
 * @param {object} opts { reparto: el de `cuentasDeComprobante`, cuentaNueva }
 * @returns {{causas: Array, sinCausa: string|null, partido: boolean}}
 */
/**
 * Cuando la cuenta no la puso la clasificación sino la NATURALEZA del insumo
 * (tanda 4), dónde se corrige de verdad.
 *
 * Sin esto la ventana mentiría: ofrecería «corregí la familia» para una cuenta
 * que la familia no decidió, la contadora la corregiría, y la cuenta no se
 * movería — porque la política y los hechos le ganan al clasificador. Peor
 * todavía en la 601, a la que NINGUNA familia lleva: la ventana diría que no
 * hay causa que corregir cuando la causa está a un clic, en otra pantalla.
 *
 * Solo están los motivos que CAMBIAN la cuenta. «Marcado uso de la empresa pero
 * sin cargar en el 7.1» no cambia nada, así que no bloquea nada.
 */
export const CORRIGE_NATURALEZA = {
  politica_reventa: 'Este insumo está marcado «Para revender» en el inventario de la empresa, y por eso '
    + 'se asienta como mercadería. Mientras siga así, reclasificarlo no va a mover la cuenta: la '
    + 'decisión se cambia en el panel de la empresa → Inventario.',
  politica_transforma: 'Este insumo está marcado «Se transforma» en el inventario de la empresa, y por eso '
    + 'se asienta como materia prima. Mientras siga así, reclasificarlo no va a mover la cuenta: la '
    + 'decisión se cambia en el panel de la empresa → Inventario.',
  activo_cargado: 'Esta línea está cargada en el registro de activos fijos (7.1) y la cuenta sale de ahí. '
    + 'No se corrige reclasificando el insumo: se corrige en el propio registro.',
  venta_registrada: 'Este ítem está separado para venta o ya se vendió, así que se asienta como mercadería. '
    + 'No se corrige reclasificando el insumo: se le quita la separación de venta en el comprobante.',
};

export function causasDeCuenta(mov, { reparto = null, cuentaNueva = null } = {}) {
  const c = txt(cuentaNueva);
  const partido = (reparto?.lineas?.length || 0) > 1;
  if (!c || !reparto) return { causas: [], sinCausa: null, partido };

  const items = reparto.items || [];
  if (!items.length) {
    return {
      causas: [], partido,
      sinCausa: 'El comprobante no trae el detalle de sus ítems: no hay una clasificación que '
        + `corregir. La ${c} queda puesta a mano en este comprobante.`,
    };
  }

  const esVenta = esVentaMov(mov);
  const posibles = familiasDeCuenta(c, { esVenta });

  const porNorm = new Map();
  for (const it of items) {
    if (!it?.norm) continue;
    const prev = porNorm.get(it.norm);
    if (prev) { prev.importe += Number(it.importe) || 0; continue; }
    porNorm.set(it.norm, { ...it, importe: Number(it.importe) || 0 });
  }

  const causas = [];
  for (const it of porNorm.values()) {
    if (it.cuenta && cuentasCompatibles(it.cuenta, c)) continue;
    const familiasPosibles = posibles.filter(p => p.codigo !== it.familia);
    // Si la cuenta la puso la naturaleza del insumo, la familia no es la causa
    // y corregirla no serviría de nada: se dice dónde está la causa de verdad.
    const porNaturaleza = CORRIGE_NATURALEZA[it.naturaleza] || null;
    causas.push({
      ...it,
      familiaNombre: it.familia ? etiquetaCategoria(it.familia) : null,
      alcance: alcanceDeCorreccion(it),
      familiasPosibles,
      porNaturaleza,
      corregible: !porNaturaleza && familiasPosibles.length > 0,
      // Solo se pre-elige cuando hay UNA familia posible: con varias, elegir
      // por ella sería inventar la respuesta que la regla 8 prohíbe inventar.
      sugerida: (!porNaturaleza && familiasPosibles.length === 1) ? familiasPosibles[0].codigo : null,
    });
  }
  causas.sort((a, b) => b.importe - a.importe);

  let sinCausa = null;
  // «Ninguna clasificación lleva a esta cuenta» es cierto para la 601 —ninguna
  // familia va ahí— pero decirlo solo, cuando cada causa ya explica que la
  // llevó la naturaleza del insumo, haría creer que no hay nada que hacer.
  const todasPorNaturaleza = causas.length > 0 && causas.every(x => x.porNaturaleza);
  if (causas.length && !posibles.length && !todasPorNaturaleza) {
    sinCausa = `Ninguna clasificación de insumo lleva a la ${c}: la corrección vale solo para `
      + 'este comprobante (y los que se marquen abajo). La próxima factura con los mismos '
      + 'ítems va a volver a salir en la cuenta de antes.';
  }
  return { causas, sinCausa, partido };
}

/**
 * Qué se pre-marca en el bloque B.
 *
 * Una corrección se ofrece marcada solo si el comprobante NO está repartido y
 * hay una única familia posible. En un comprobante partido, elegir una cuenta
 * lo manda entero ahí — pero reclasificar el cemento como herramienta porque la
 * factura de ferretería traía una amoladora sería el peor efecto posible de
 * esta ventana. Ahí se marca a mano, ítem por ítem.
 */
export function seleccionInicial({ causas = [], partido = false } = {}) {
  const correcciones = {};
  for (const c of causas) {
    correcciones[c.norm] = (!partido && c.corregible && c.sugerida) ? c.sugerida : '';
  }
  return { correcciones, corregirTipo: true, aceptaCerrados: false };
}

/** Las correcciones que efectivamente se van a escribir, según lo marcado. */
export function correccionesElegidas(causas = [], seleccion = {}) {
  const elegidas = seleccion?.correcciones || {};
  const out = [];
  for (const c of causas) {
    const f = txt(elegidas[c.norm]);
    if (!f || !c.familiasPosibles.some(p => p.codigo === f)) continue;
    out.push({
      norm: c.norm,
      descripcion: c.descripcion,
      unidad: c.unidad || null,
      familia: f,
      familiaAntes: c.familia || null,
      alcance: c.alcance,
      catalogoId: c.catalogoId || null,
      catalogoNombre: c.catalogoNombre || null,
      catalogoGlobal: c.catalogoGlobal === true,
    });
  }
  return out;
}

/**
 * El resolvedor de familias con las correcciones aplicadas EN MEMORIA.
 *
 * Es lo que permite mostrar las consecuencias antes de escribirlas: se le pasa
 * al mismo `cuentasDeComprobante` que usa el Libro Diario, así que lo que la
 * ventana dice que va a pasar es lo que va a pasar.
 *
 *   · alcance 'insumo'      → toda descripción que resuelva a ese insumo
 *                             cambia de familia (así es como se comportará).
 *   · alcance 'descripcion' → solo esa descripción.
 */
export function resolvedorCorregido(familiaDe, correcciones = []) {
  if (typeof familiaDe !== 'function') return familiaDe;
  if (!correcciones.length) return familiaDe;
  const porNorm = new Map();
  const porCatalogo = new Map();
  for (const c of correcciones) {
    if (c.alcance === 'insumo' && c.catalogoId) porCatalogo.set(c.catalogoId, c.familia);
    else if (c.norm) porNorm.set(c.norm, c.familia);
  }
  const cache = new Map();
  return (descripcion) => {
    const t = txt(descripcion);
    if (cache.has(t)) return cache.get(t);
    const base = familiaDe(descripcion);
    let out = base;
    const n = claveMapeo(t);
    if (n && porNorm.has(n)) {
      out = { ...base, familia: porNorm.get(n), origen: 'catalogo', score: 1, via: 'correccion' };
    } else if (base?.catalogoId && porCatalogo.has(base.catalogoId)) {
      out = { ...base, familia: porCatalogo.get(base.catalogoId), origen: 'catalogo', score: 1 };
    }
    cache.set(t, out);
    return out;
  };
}

// ═══════════════════════════════════════════════════════════════════
// B · EL TIPO (COSTO O GASTO), QUE ES LO QUE LEE EL ESTADO DE RESULTADOS
// ═══════════════════════════════════════════════════════════════════

/** Costo o gasto según el destino por función. Existencias y vacío: sin opinión. */
export function tipoPorDestino(destino) {
  const d = txt(destino).slice(0, 2);
  if (['90', '91', '92', '93'].includes(d)) return 'cost';
  if (['94', '95', '97'].includes(d)) return 'expense';
  return null;
}

const TIPO_TXT = { cost: 'Costo', expense: 'Gasto', income: 'Ingreso' };

/**
 * ¿El destino que queda contradice el tipo del comprobante?
 *
 * El Estado de Resultados de JARVEX suma por `type`, no por cuenta. Si la
 * contadora pone el destino 94 (administración) a una compra que la
 * vinculación dejó como costo de obra, el asiento dice «gasto» y el Estado de
 * Resultados sigue diciendo «costo». La corrección de la causa es
 * `clasificacion_manual` (mig 163), que existe justo para eso: marcar costo o
 * gasto SIN desvincular la obra.
 *
 * @returns {null | {actual, nuevo, escribir, porque, bloqueado?}}
 *   `escribir` es lo que va a `clasificacion_manual`: null cuando el tipo
 *   nuevo ya es el que diría la vinculación sola (no hace falta forzarlo).
 */
export function correccionDeTipo(mov, destinoCuenta) {
  const m = mov || {};
  if (esVentaMov(m) || (m.type || '') === 'income') return null;
  const objetivo = tipoPorDestino(destinoCuenta);
  if (!objetivo) return null;
  const actual = m.type || derivarTypeContable(m);
  if (actual === objetivo) return null;

  if (m.is_intercompany === true) {
    return {
      actual, nuevo: actual, escribir: null, bloqueado: true,
      porque: `El destino ${txt(destinoCuenta)} es de ${TIPO_TXT[objetivo].toLowerCase()}, pero es una operación `
        + 'entre empresas del grupo: esas son siempre COSTO, porque el Consolidado las elimina de a pares. '
        + 'El tipo no se toca.',
    };
  }
  const auto = derivarTypeContable({ ...m, clasificacion_manual: null });
  return {
    actual, nuevo: objetivo,
    escribir: objetivo === auto ? null : objetivo,
    porque: `El destino ${txt(destinoCuenta)} (${nombreDestino(destinoCuenta)}) es de `
      + `${objetivo === 'cost' ? 'COSTO' : 'GASTO'}, y el comprobante figura como `
      + `${actual === 'cost' ? 'COSTO' : 'GASTO'}. El Estado de Resultados lee el tipo, no la cuenta.`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// A · QUÉ CAMBIA
// ═══════════════════════════════════════════════════════════════════

/**
 * Las líneas que cambian entre dos asientos, por cuenta.
 *
 * Se compara el NETO de cada cuenta (debe − haber), no línea por línea: si la
 * 602 pasa a la 656 por el mismo importe, lo que la contadora tiene que ver es
 * «sale la 602, entra la 656», no cuatro filas con la glosa repetida.
 */
export function diffAsientos(antes, despues) {
  const neto = (a) => {
    const m = new Map();
    for (const p of a?.partidas || []) {
      m.set(p.cuenta, r2((m.get(p.cuenta) || 0) + (Number(p.debe) || 0) - (Number(p.haber) || 0)));
    }
    return m;
  };
  const na = neto(antes); const nd = neto(despues);
  const cuentas = [...new Set([...na.keys(), ...nd.keys()])];
  const out = [];
  for (const c of cuentas) {
    const x = na.get(c) || 0; const y = nd.get(c) || 0;
    if (Math.abs(x - y) < 0.01) continue;
    out.push({ cuenta: c, nombre: nombreDeLinea(c), antes: x, despues: y });
  }
  // Primero lo que sale, después lo que entra: se lee como una frase.
  return out.sort((a, b) => (Math.abs(b.antes) > 0.005) - (Math.abs(a.antes) > 0.005) || a.cuenta.localeCompare(b.cuenta));
}

/**
 * Lo que significa para la renta pasar de una cuenta a otra. Es la parte del
 * pedido que cuesta plata: «se consideran gastos o consumos a cosas que
 * realmente no lo son, y terminamos pagando más impuestos».
 *
 * Solo mira el ELEMENTO (el primer dígito), que es lo que cambia el efecto
 * tributario. Pasar de 602 a 603 no le cambia la renta a nadie.
 */
export function avisosDeCuenta(cuentaAntes, cuentaDespues, { esVenta = false } = {}) {
  const a = txt(cuentaAntes); const d = txt(cuentaDespues);
  if (esVenta || !a || !d || a[0] === d[0]) return [];
  const out = [];
  const nom = nombreDeLinea(d);
  if (a[0] === '6' && d[0] !== '6') {
    const madre = d.slice(0, 2);
    if (['32', '33', '34', '35'].includes(madre)) {
      out.push({
        nivel: 'ambar',
        texto: `La ${d} (${nom}) es un ACTIVO: deja de ser gasto de este período. Baja la renta de a `
          + 'poco, por la depreciación (68) de cada año, en vez de toda junta ahora.',
      });
    } else if (madre === '18') {
      out.push({
        nivel: 'ambar',
        texto: `La ${d} es un pago por adelantado: se vuelve gasto recién en el período que cubre.`,
      });
    } else {
      out.push({
        nivel: 'ambar',
        texto: `La ${d} (${nom}) no es una cuenta de gasto: el comprobante deja de bajar el resultado del período.`,
      });
    }
    out.push({
      nivel: 'info',
      texto: 'El asiento de destino desaparece: la 79 solo traslada gastos del elemento 6.',
    });
    out.push({
      nivel: 'info',
      texto: 'El Estado de Resultados de JARVEX se arma con el tipo del comprobante (costo o gasto), '
        + 'no con la cuenta: este comprobante sigue sumando ahí hasta que se le cambie el tipo en Movimientos.',
    });
  } else if (a[0] !== '6' && d[0] === '6') {
    out.push({
      nivel: 'ambar',
      texto: `La ${d} (${nom}) es un gasto del período: baja la renta de este año y lleva asiento de destino.`,
    });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// C · A QUÉ MÁS SE APLICA
// ═══════════════════════════════════════════════════════════════════

/** Una firma del reparto para saber si cambió: cuentas y porciones. */
export function firmaReparto(reparto) {
  if (!reparto) return '';
  const ls = (reparto.lineas || []).map(l => `${l.cuenta}:${(Number(l.porcion) || 0).toFixed(4)}`);
  return `${reparto.provisional ? 'P|' : ''}${ls.join('|')}`;
}

const cuentasDe = (reparto) => (reparto?.lineas || []).map(l => l.cuenta);

/**
 * Los OTROS comprobantes que se mueven solos si se corrige la clasificación.
 *
 * Lo más importante que dice esta función es cuántos son de meses YA
 * PRESENTADOS. Medido el 18-set-2026: 1.697 de los 1.806 comprobantes vivos
 * (el 94 %) son de julio o antes. Corregir la familia de un insumo que se
 * compra seguido casi siempre toca meses cerrados, y eso no puede pasar sin
 * que la contadora lo lea.
 *
 * Los que tienen una cuenta puesta a mano NO cambian —la decisión humana le
 * gana a la clasificación—, y se cuentan aparte para que se sepa por qué.
 *
 * @returns {{cambian:Array, conManual:number, cerrados:number,
 *            otrasEmpresas:number, porMoneda:Object, ejemplos:Array}}
 */
export function alcanceDeCorrecciones({
  movs = [], familiaDe, familiaDeCorregida, correcciones = [],
  excluirId = null, companyId = null, cerradoHasta = CERRADO_HASTA_DEFAULT,
} = {}) {
  const vacio = { cambian: [], conManual: 0, cerrados: 0, otrasEmpresas: 0, porMoneda: {}, ejemplos: [] };
  if (!correcciones.length || typeof familiaDe !== 'function') return vacio;

  const norms = new Set(correcciones.filter(c => c.alcance !== 'insumo' || !c.catalogoId).map(c => c.norm));
  const catalogos = new Set(correcciones.filter(c => c.alcance === 'insumo' && c.catalogoId).map(c => c.catalogoId));
  const toca = (desc) => {
    const n = claveMapeo(desc);
    if (n && norms.has(n)) return true;
    const cat = catalogos.size ? familiaDe(desc)?.catalogoId : null;
    return !!cat && catalogos.has(cat);
  };

  const out = { ...vacio, porMoneda: {} };
  for (const m of movs) {
    if (!m || m.deleted_at || m.payment_status === 'cancelled' || m.id === excluirId) continue;
    const items = itemsDe(m);
    if (!items.some(it => toca(it?.descripcion))) continue;
    if (txt(m.cuenta_pcge)) { out.conManual++; continue; }
    const antes = cuentasDeComprobante(m, { familiaDe });
    const despues = cuentasDeComprobante(m, { familiaDe: familiaDeCorregida });
    if (firmaReparto(antes) === firmaReparto(despues)) continue;
    const cerrado = movEnPeriodoCerrado(m, cerradoHasta);
    const otraEmpresa = !!companyId && !!m.company_id && m.company_id !== companyId;
    if (cerrado) out.cerrados++;
    if (otraEmpresa) out.otrasEmpresas++;
    // Cada moneda por separado: nunca se suman soles con dólares (regla 11).
    const cur = m.currency || 'PEN';
    out.porMoneda[cur] = r2((out.porMoneda[cur] || 0) + Math.abs(Number(m.amount) || 0));
    out.cambian.push({
      id: m.id, documento: m.document_number || '', fecha: txt(m.date).slice(0, 10),
      proveedor: m.third_party_name || '', moneda: cur, importe: Math.abs(Number(m.amount) || 0),
      antes: cuentasDe(antes), despues: cuentasDe(despues), cerrado, otraEmpresa,
    });
  }
  out.ejemplos = [...out.cambian].sort((a, b) => b.importe - a.importe).slice(0, 6);
  return out;
}

/**
 * Los otros comprobantes del mismo proveedor, repartidos según qué les pasa.
 *
 *   · cerrados       — de meses ya presentados: NO se tocan. Antes de esta
 *                      tanda el escape del candado que se pedía para UN
 *                      comprobante se pasaba a todo el lote; ahora no.
 *   · seArreglanSolos — la corrección de la clasificación ya los deja en la
 *                      cuenta elegida: no hace falta ponérsela a mano.
 *   · planes          — los que reciben la corrección a mano, cada uno con su
 *                      propio ajuste de tipo si el destino lo pide.
 */
export function planDeHermanos(hermanos = [], {
  cambios = {}, familiaDeCorregida = null, hayCorrecciones = false, cerradoHasta = CERRADO_HASTA_DEFAULT,
} = {}) {
  const out = { planes: [], cerrados: [], seArreglanSolos: [] };
  for (const h of hermanos) {
    if (!h) continue;
    if (movEnPeriodoCerrado(h, cerradoHasta)) { out.cerrados.push(h); continue; }
    const cuenta = cambios.cuenta || null;
    if (cuenta && hayCorrecciones && typeof familiaDeCorregida === 'function') {
      const r = cuentasDeComprobante(h, { familiaDe: familiaDeCorregida });
      if (!r.provisional && r.lineas.length === 1 && r.lineas[0].cuenta === cuenta) {
        // La cuenta sale sola; si además había contrapartida o destino que
        // aplicar, eso sí se escribe, pero sin fijar la cuenta a mano.
        if (!cambios.contrapartida && !cambios.destino) { out.seArreglanSolos.push(h); continue; }
        out.planes.push({ id: h.id, cambios: planPara(h, { ...cambios, cuenta: null }) });
        continue;
      }
    }
    out.planes.push({ id: h.id, cambios: planPara(h, cambios) });
  }
  return out;
}

function planPara(mov, cambios) {
  const plan = {};
  if ('cuenta' in cambios) plan.cuenta = cambios.cuenta || null;
  if ('contrapartida' in cambios) plan.contrapartida = cambios.contrapartida || null;
  if ('destino' in cambios) plan.destino = cambios.destino || null;
  const t = cambios.destino ? correccionDeTipo(mov, cambios.destino) : null;
  if (t && !t.bloqueado) plan.tipo = t.escribir;
  return plan;
}

// ═══════════════════════════════════════════════════════════════════
// TODO JUNTO
// ═══════════════════════════════════════════════════════════════════

/**
 * La ventana entera: lo que se muestra y lo que se escribe.
 *
 * @param {object} p
 *   mov            el movimiento que se corrige
 *   cambios        { cuenta, contrapartida, destino } como quedaron en el
 *                  formulario (null = automático)
 *   familiaDe      el resolvedor del Libro Diario (`crearResolvedorDeFamilia`)
 *   bancarizadoIds para que la contrapartida del asiento simulado sea la real
 *   movs           todos los movimientos (para el bloque C)
 *   hermanos       los del mismo proveedor, si se marcó aplicarles la corrección
 *   seleccion      { correcciones: {norm: familia}, corregirTipo, aceptaCerrados }
 *                  — null en la primera pasada: se usa `seleccionInicial`
 *   cerradoHasta
 *   puedeReclasificar  si el rol escribe el catálogo (admin, gerente, contador)
 */
export function armarConsecuencias({
  mov, cambios = {}, familiaDe = null, bancarizadoIds = null, movs = [], hermanos = [],
  seleccion = null, cerradoHasta = CERRADO_HASTA_DEFAULT, puedeReclasificar = true,
} = {}) {
  const m = mov || {};
  const esVenta = esVentaMov(m);
  const resolver = typeof familiaDe === 'function' ? familiaDe : null;
  const repartoDe = (fam) => (fam ? (x) => cuentasDeComprobante(x, { familiaDe: fam }) : null);

  const cuentaElegida = txt(cambios.cuenta) || null;
  const cuentaCambia = !!cuentaElegida && cuentaElegida !== (txt(m.cuenta_pcge) || null);
  const repartoActual = resolver ? cuentasDeComprobante(m, { familiaDe: resolver }) : null;

  // ── B: las causas ──
  const deCausas = cuentaCambia
    ? causasDeCuenta(m, { reparto: repartoActual, cuentaNueva: cuentaElegida })
    : { causas: [], sinCausa: null, partido: false };
  const { sinCausa, partido } = deCausas;
  // Espejo de la RLS de `catalogo_insumos` e `insumo_categoria`: solo admin,
  // gerente y contador escriben ahí. Si otro rol pudiera marcar la corrección,
  // la fila se guardaría en su PC y rebotaría en cada push. La causa se
  // muestra igual —saber de dónde salió la cuenta sirve a cualquiera—, pero
  // sin la opción de corregirla.
  const causas = puedeReclasificar
    ? deCausas.causas
    : deCausas.causas.map(c => ({ ...c, corregible: false, sugerida: null }));
  const reclasificarVedado = !puedeReclasificar && deCausas.causas.some(c => c.corregible);
  const sel = seleccion || seleccionInicial({ causas, partido });
  const correcciones = correccionesElegidas(causas, sel);
  const familiaDeCorregida = resolver ? resolvedorCorregido(resolver, correcciones) : null;
  const repartoDespues = familiaDeCorregida ? cuentasDeComprobante(m, { familiaDe: familiaDeCorregida }) : null;

  // ¿Sigue haciendo falta la cuenta a mano? No, si con la clasificación
  // corregida el comprobante ya sale EXACTAMENTE en la cuenta elegida: eso es
  // enseñarle al sistema en vez de parchar la fila. Con cualquier diferencia
  // —otra cantidad de dígitos, un reparto— la decisión de la contadora se
  // guarda tal cual.
  const salesola = !!cuentaElegida && correcciones.length > 0 && repartoDespues
    && !repartoDespues.provisional && repartoDespues.lineas.length === 1
    && repartoDespues.lineas[0].cuenta === cuentaElegida;
  const cuentaFinal = cuentaElegida && !salesola ? cuentaElegida : null;

  // ── A: el asiento antes y después ──
  const opts = (fam) => ({ repartoDe: repartoDe(fam), bancarizadoIds });
  const asientoAntes = generarAsiento(m, opts(resolver));

  let movDespues = {
    ...m,
    cuenta_pcge: cuentaFinal,
    cuenta_pcge_contrapartida: txt(cambios.contrapartida) || null,
    cuenta_pcge_destino: txt(cambios.destino) || null,
  };
  let asientoDespues = generarAsiento(movDespues, opts(familiaDeCorregida));
  const avisos = [];

  // Un destino elegido para una cuenta que ya no es gasto no significa nada:
  // se borra y se dice. Dejarlo guardado sería una decisión fantasma que
  // reaparece el día que alguien vuelva la cuenta al elemento 6.
  const cuentaDespues = asientoDespues.cuentas?.detalle?.[0]?.cuenta || '';
  let destinoFinal = movDespues.cuenta_pcge_destino;
  if (destinoFinal && !seTraslada(cuentaDespues)) {
    avisos.push({
      nivel: 'info',
      texto: `El destino ${destinoFinal} que tenía elegido se borra: la ${cuentaDespues} no se traslada a un destino.`,
    });
    destinoFinal = null;
    movDespues = { ...movDespues, cuenta_pcge_destino: null };
    asientoDespues = generarAsiento(movDespues, opts(familiaDeCorregida));
  }

  // ── B: el tipo ──
  const destinoDespues = asientoDespues.cuentas?.destino?.cuenta || null;
  const tipo = correccionDeTipo(m, destinoDespues);
  const aplicaTipo = !!tipo && !tipo.bloqueado && sel.corregirTipo !== false;
  if (aplicaTipo) movDespues = { ...movDespues, type: tipo.nuevo, clasificacion_manual: tipo.escribir };

  const cuentaAntes = asientoAntes.cuentas?.detalle?.[0]?.cuenta || '';
  avisos.push(...avisosDeCuenta(cuentaAntes, cuentaDespues, { esVenta }));
  if (destinoFinal && destinoFinal[0] === '2') {
    avisos.push({
      nivel: 'ambar',
      texto: 'Mandarlo a una existencia (20, 24, 25 o 26) lo deja en el inventario: no baja el resultado '
        + 'del período. Si el material ya se consumió, la empresa termina pagando más renta de la que debe.',
    });
  }

  // ── C ──
  const alcance = alcanceDeCorrecciones({
    movs, familiaDe: resolver, familiaDeCorregida, correcciones,
    excluirId: m.id, companyId: m.company_id || null, cerradoHasta,
  });
  const hermanosPlan = hermanos.length
    ? planDeHermanos(hermanos, {
      cambios: { cuenta: cuentaElegida, contrapartida: txt(cambios.contrapartida) || null, destino: txt(cambios.destino) || null },
      familiaDeCorregida, hayCorrecciones: correcciones.length > 0, cerradoHasta,
    })
    : { planes: [], cerrados: [], seArreglanSolos: [] };

  // ── Lo que se escribe en el comprobante ──
  const escribir = {
    cuenta: cuentaFinal,
    contrapartida: txt(cambios.contrapartida) || null,
    destino: destinoFinal,
  };
  if (aplicaTipo) escribir.tipo = tipo.escribir;

  const cuentaTocada = cuentaCambia || (txt(m.cuenta_pcge) && !cuentaElegida);
  const hayQueDecir = causas.length > 0
    || (!!sinCausa && cuentaTocada)
    || !!tipo
    || avisos.some(a => a.nivel !== 'info')
    || hermanosPlan.planes.length > 0
    || hermanosPlan.cerrados.length > 0;

  return {
    // B
    causas, sinCausa, partido, correcciones, seleccion: sel, tipo, aplicaTipo, salesola, reclasificarVedado,
    // A
    asientoAntes, asientoDespues, diff: diffAsientos(asientoAntes, asientoDespues), avisos,
    cambioDeTipo: aplicaTipo ? {
      de: tipo.actual, a: tipo.nuevo, importe: Math.abs(Number(m.amount) || 0), moneda: m.currency || 'PEN',
    } : null,
    // C
    alcance, hermanos: hermanosPlan,
    requiereAceptarCerrados: alcance.cerrados > 0,
    // lo que se guarda
    escribir,
    hayQueDecir,
  };
}

export default {
  cuentasCompatibles, nombreDeLinea, familiasDeCuenta, alcanceDeCorreccion, causasDeCuenta,
  seleccionInicial, correccionesElegidas, resolvedorCorregido, tipoPorDestino, correccionDeTipo,
  diffAsientos, avisosDeCuenta, firmaReparto, alcanceDeCorrecciones, planDeHermanos, armarConsecuencias,
};
