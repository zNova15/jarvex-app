// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL PLAN CONTABLE GENERAL EMPRESARIAL, COMO LEY.
//
// ── QUÉ CAMBIÓ Y POR QUÉ ──────────────────────────────────────────
// Hasta el 17-set-2026 esta app tenía 52 cuentas escritas a mano en
// `pcge-default.js`, guardadas en localStorage, con un botón para vaciarlas y
// otro para inventar cuentas nuevas. O sea: cada PC podía tener un plan de
// cuentas distinto, y ninguno era el del Estado peruano.
//
// Ahora el plan es EL PDF del MEF (`VERSION_MODIFICADA_PCG_EMPRESARIAL.pdf`,
// Plan Contable General Empresarial, versión modificada, Consejo Normativo de
// Contabilidad), entero: 1.792 códigos con sus descripciones, su dinámica
// debe/haber y sus comentarios. No se edita, no se vacía, no se le agregan
// cuentas. Es la ley y es igual en las dos PCs de Gabriel.
//
// ── LA MISMA ARQUITECTURA DE DOS CAPAS DEL IUPC ───────────────────
// La base oficial viaja en el BUNDLE (`pcge-catalogo.js`, generado del PDF).
// No va a tablas sincronizadas: son 1.792 filas que no cambian nunca y
// meterlas en Supabase sería tráfico permanente para guardar algo fijo —
// exactamente la lección del corte por egress del 9-set. Ver la regla 8 del
// CLAUDE.md y el encabezado de la migración 205.
//
// ── EL NIVEL DE TRABAJO (decisión de Gabriel, 17-set) ─────────────
// Se trabaja a DOS dígitos —la cuenta: «63 Gastos de servicios prestados por
// terceros», que es como hablan las contadoras— con la subcuenta de TRES a
// mano («631 Transporte, correos y gastos de viaje») y la posibilidad de
// ahondar hasta CINCO cuando el caso lo pide («63111 De carga»). Por eso
// `NIVEL_CUENTA`, `NIVEL_SUBCUENTA` y `NIVEL_MAXIMO` están nombrados: el
// número suelto en el código no dice cuál de los tres es.
//
// Funciones puras. Testeadas en __tests__/pcge.test.js.
// ═══════════════════════════════════════════════════════════════════

import { PCGE_FILAS, PCGE_ELEMENTOS } from './pcge-catalogo.js';

/** Largo del código según el nivel del plan. */
export const NIVEL_CUENTA = 2;      // 63      — con esto trabaja la contadora
export const NIVEL_SUBCUENTA = 3;   // 631     — el detalle habitual
export const NIVEL_MAXIMO = 5;      // 63111   — hasta donde llega el PDF

/**
 * A qué lado del balance pertenece cada elemento. Es el vocabulario que ya
 * usaban el Balance General y el Estado de Resultados, así que se conserva.
 *
 * El elemento 8 (saldos intermediarios) y el 0 (cuentas de orden) no son
 * ninguno de los cinco: son cuentas de cierre y de control. Se marcan aparte
 * en vez de forzarlas a «activo», que sería mentira.
 */
export const TIPO_POR_ELEMENTO = {
  '1': 'activo',
  '2': 'activo',
  '3': 'activo',
  '4': 'pasivo',
  '5': 'patrimonio',
  '6': 'gasto',
  '7': 'ingreso',
  '8': 'resultado',
  '9': 'analitica',
  '0': 'orden',
};

export const PCGE_TIPO_LABEL = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio',
  ingreso: 'Ingreso',
  gasto: 'Gasto',
  resultado: 'Resultado del ejercicio',
  analitica: 'Costos por función',
  orden: 'Cuenta de orden',
};

export const PCGE_TIPO_BADGE = {
  activo: 'b-green',
  pasivo: 'b-red',
  patrimonio: 'b-blue',
  ingreso: 'b-green',
  gasto: 'b-amber',
  resultado: 'b-blue',
  analitica: 'b-gray',
  orden: 'b-gray',
};

/** El elemento de un código. Las cuentas de orden empiezan con 0. */
export const elementoDe = (codigo) => String(codigo ?? '').trim()[0] || '';

/** El código del padre: el mismo sin su último dígito. `10` no tiene padre. */
export function padreDe(codigo) {
  const c = String(codigo ?? '').trim();
  return c.length > NIVEL_CUENTA ? c.slice(0, -1) : null;
}

// ── El catálogo, ya en objetos ────────────────────────────────────
/**
 * Las 1.792 cuentas del PDF. El orden es el del propio plan (elemento por
 * elemento, cuenta por cuenta), que es como la contadora espera leerlo.
 */
export const PCGE_CUENTAS = PCGE_FILAS.map(([codigo, nombre]) => {
  const elemento = elementoDe(codigo);
  return {
    codigo,
    nombre,
    nivel: codigo.length,
    elemento,
    elementoNombre: PCGE_ELEMENTOS[elemento] || '',
    tipo: TIPO_POR_ELEMENTO[elemento] || 'orden',
    padre: padreDe(codigo),
  };
});

const POR_CODIGO = new Map(PCGE_CUENTAS.map(c => [c.codigo, c]));

const HIJOS = (() => {
  const m = new Map();
  for (const c of PCGE_CUENTAS) {
    if (!c.padre) continue;
    if (!m.has(c.padre)) m.set(c.padre, []);
    m.get(c.padre).push(c);
  }
  return m;
})();

/** Las 83 cuentas de dos dígitos, que es el nivel con el que se trabaja. */
export const PCGE_NIVEL_CUENTA = PCGE_CUENTAS.filter(c => c.nivel === NIVEL_CUENTA);

/** @returns {object|null} la cuenta exacta, o null si el código no existe. */
export const cuenta = (codigo) => POR_CODIGO.get(String(codigo ?? '').trim()) || null;

/** ¿Es un código del plan oficial? */
export const esCuentaValida = (codigo) => POR_CODIGO.has(String(codigo ?? '').trim());

/** Los hijos directos de una cuenta, en el orden del PDF. */
export const hijosDe = (codigo) => HIJOS.get(String(codigo ?? '').trim()) || [];

/** ¿Tiene desglose por debajo? Sirve para saber si la fila se puede abrir. */
export const tieneHijos = (codigo) => HIJOS.has(String(codigo ?? '').trim());

/**
 * El nombre de una cuenta. Si el código no está en el plan —una cuenta vieja,
 * un dato importado— SUBE hasta el ancestro que sí exista, para no dejar la
 * columna en blanco. Devuelve '' solo si ni la cuenta de dos dígitos existe.
 */
export function nombreDeCuenta(codigo) {
  let c = String(codigo ?? '').trim();
  while (c.length >= NIVEL_CUENTA) {
    const hit = POR_CODIGO.get(c);
    if (hit) return hit.nombre;
    c = c.slice(0, -1);
  }
  return '';
}

/**
 * La cadena de ancestros de un código, de la cuenta hacia abajo:
 * `63111` → [63, 631, 6311, 63111]. Es lo que se muestra como miga de pan en
 * el detalle, y lo que explica de dónde sale una cuenta larga.
 */
export function rutaDe(codigo) {
  const c = String(codigo ?? '').trim();
  const out = [];
  for (let n = NIVEL_CUENTA; n <= c.length; n++) {
    const hit = POR_CODIGO.get(c.slice(0, n));
    if (hit) out.push(hit);
  }
  return out;
}

/** La cuenta de dos dígitos a la que pertenece un código. */
export const cuentaMadreDe = (codigo) => cuenta(String(codigo ?? '').trim().slice(0, NIVEL_CUENTA));

// ── Búsqueda ──────────────────────────────────────────────────────
const sinTildes = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const NORM = new Map(PCGE_CUENTAS.map(c => [c.codigo, sinTildes(c.nombre)]));

/**
 * Busca por código o por texto, sin tildes ni mayúsculas.
 *
 * Un número se trata como PREFIJO de código («63» trae 63 y todo su árbol),
 * que es como busca alguien que ya sabe la cuenta. El texto busca en el nombre
 * y ordena por código, para que la respuesta salga en el orden del plan y no
 * en un ranking que nadie pidió.
 *
 * @param {string} q       lo tipeado
 * @param {object} [opts]  { nivelMax } para no devolver los cinco niveles
 * @returns {Array}
 */
export function buscarCuentas(q, { nivelMax = NIVEL_MAXIMO } = {}) {
  const t = sinTildes(q);
  const base = PCGE_CUENTAS.filter(c => c.nivel <= nivelMax);
  if (!t) return base;
  if (/^\d+$/.test(t)) return base.filter(c => c.codigo.startsWith(t));
  const palabras = t.split(/\s+/).filter(Boolean);
  return base.filter(c => {
    const n = NORM.get(c.codigo);
    return palabras.every(p => n.includes(p));
  });
}

/** Los elementos del plan, en orden, con el 0 al final (así lo imprime el PDF). */
export const PCGE_ELEMENTOS_ORDENADOS = Object.entries(PCGE_ELEMENTOS)
  .map(([codigo, nombre]) => ({ codigo, nombre, tipo: TIPO_POR_ELEMENTO[codigo] || 'orden' }))
  .sort((a, b) => (a.codigo === '0' ? 1 : b.codigo === '0' ? -1 : a.codigo.localeCompare(b.codigo)));

export default {
  PCGE_CUENTAS, PCGE_NIVEL_CUENTA, PCGE_ELEMENTOS, PCGE_ELEMENTOS_ORDENADOS,
  PCGE_TIPO_LABEL, PCGE_TIPO_BADGE, TIPO_POR_ELEMENTO,
  NIVEL_CUENTA, NIVEL_SUBCUENTA, NIVEL_MAXIMO,
  cuenta, esCuentaValida, hijosDe, tieneHijos, nombreDeCuenta, rutaDe,
  cuentaMadreDe, padreDe, elementoDe, buscarCuentas,
};
