// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR, TANDA 4: A QUIÉN SE LE PIDE (§6 del plan).
//
// El §6 dice: «cruzar la clasificación del insumo contra el `rubro` de las
// empresas candidatas, y dentro de eso priorizar por historial real de
// precios». Las dos mitades de esa frase se midieron el 22-set-2026 y las dos
// resultaron ser otra cosa. Esto es lo que quedó en pie.
//
// ── MITAD 1: EL RUBRO NO EXISTE PARA CASI NADIE ───────────────────
// `companies.rubro` existe y lo traen las 28 empresas del grupo. Los 549
// proveedores del catálogo NO: `proveedores` no tiene esa columna. Ordenar
// por rubro habría funcionado para 28 de 577 candidatos y se habría leído
// como una recomendación para los otros 549.
//
// Agregarle la columna tampoco sirve: nacería vacía en las 549 filas y
// alguien tendría que llenarla a mano. Lo que SÍ existe es qué vendió cada
// uno: 1.814 líneas de factura con ítems, TODAS con proveedor identificado
// (344 proveedores distintos; 119 con 5 líneas o más). El «rubro» que usa
// este archivo se deduce de ahí — de lo que el proveedor facturó de verdad,
// no de una etiqueta que nadie mantiene.
//
// ── MITAD 2: EL HISTORIAL SIRVE PARA EL QUIÉN, NO PARA EL CUÁNTO ──
// Esta es la corrección importante, y es la razón por la que acá NO se
// devuelve ningún precio.
//
// Para cruzar el presupuesto con las facturas hay que emparejar textos, y no
// hay llave: de los 427 insumos comprables distintos de Miraflores, **12**
// (el 2,8%) coinciden exacto con alguna descripción de factura; `insumo_mapeo`
// —la tabla que haría ese puente— tiene 3 filas en total. Bajando a
// «comparten 2 palabras de 4 letras o más» el alcance sube a **174 de 419
// (42%)**, que ya es un número útil. Pero mirando los pares que produce:
//
//   VALVULA COMPUERTA DE BRONCE DE 2"  ↔  VALVULA ESFERICA DE 4" BRONCE
//                                          S/ 338,98  (otra válvula, 6× el precio)
//   TAPON HEMBRA PVC SP DE 1"          ↔  TAPON 2" HEMBRA
//   BALDE HERMÉTICO PARA AGUA 10L      ↔  ALQUILER DE CAMIONETA … AGUA POTABLE …
//                                          S/ 10.423,73
//
// El PROVEEDOR de esos pares es correcto en todos los casos: quien vende
// válvulas vende válvulas, y quien vende ropa de trabajo vende ropa de
// trabajo. El PRECIO no: es de otro diámetro, de otro producto, o de una
// camioneta. Poner «último precio pagado: S/ 10.423,73» al lado de un balde
// de S/ 25 no es un dato flojo — es un número que alguien copia.
//
// Por eso este módulo sugiere **a quién**, con la evidencia a la vista («te
// vendió 14 de estas 167 líneas, por ejemplo TAPON 2" HEMBRA»), y el precio
// sigue siendo el del expediente, como manda el §6 en su última frase. El
// precio real solo puede venir de un emparejamiento que alguien confirmó, y
// hoy esa tabla (`insumo_mapeo`) está vacía.
//
// Puro: sin React, sin Dexie. Testeado en __tests__/simulador-proveedor.test.js
// ═══════════════════════════════════════════════════════════════════

import { extraerComprasDeFacturas } from './analisis-insumos.js';

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Cuántas letras tiene que tener una palabra para contar como señal. */
export const LARGO_TOKEN_MINIMO = 4;
/** Cuántas palabras en común hacen un match. Con 1 matchea casi todo (92%). */
export const TOKENS_EN_COMUN_MINIMO = 2;

/**
 * Palabras que aparecen en todo y no dicen nada del insumo. Sin esta lista,
 * «PARA» y «CON» emparejan un balde con un alquiler de camioneta — que es
 * literalmente uno de los pares que produjo la medición.
 */
const VACIAS = new Set([
  'para', 'con', 'sin', 'del', 'los', 'las', 'una', 'unos', 'unas', 'por',
  'segun', 'sobre', 'entre', 'desde', 'hasta', 'tipo', 'marca', 'modelo',
  'color', 'unidad', 'unidades', 'servicio', 'obra', 'trabajo', 'general',
  'otros', 'varios', 'nuevo', 'nueva', 'grande', 'chico', 'mediano',
]);

const SIN_TILDES = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ü: 'u', ñ: 'n', à: 'a', è: 'e', ì: 'i', ò: 'o', ù: 'u', â: 'a', ê: 'e', î: 'i', ô: 'o', û: 'u', ä: 'a', ë: 'e', ï: 'i', ö: 'o' };

/** Las palabras con señal de un texto, en minúscula y sin tildes. */
export function tokensDe(texto) {
  const limpio = String(texto || '')
    .toLowerCase()
    .replace(/[áéíóúüñàèìòùâêîôûäëïö]/g, c => SIN_TILDES[c] || c)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!limpio) return [];
  const out = new Set();
  for (const w of limpio.split(' ')) {
    if (w.length < LARGO_TOKEN_MINIMO) continue;
    if (VACIAS.has(w)) continue;
    out.add(w);
  }
  return [...out];
}

// ═══════════════════════════════════════════════════════════════════
// EL PERFIL DE CADA PROVEEDOR: qué vendió de verdad
// ═══════════════════════════════════════════════════════════════════

/**
 * Qué vendió cada proveedor, deducido de las facturas de compra del grupo.
 *
 * Usa `extraerComprasDeFacturas()`, que ya deja afuera las ventas, las notas
 * de crédito, las anuladas y las canceladas — una compra que se deshizo no
 * dice nada de lo que ese proveedor sabe vender.
 *
 * @param {Array} movimientos  `accounting_movements` (con `notas` crudas).
 * @param {Object} [opts.nombrePorId]  id → razón social, para el que cambió
 *                 de nombre en el catálogo después de facturar.
 *
 * @returns {Map<string, Object>} clave de proveedor → perfil.
 */
export function perfilarProveedores(movimientos = [], { nombrePorId = null, opts = {} } = {}) {
  const compras = extraerComprasDeFacturas(movimientos || [], opts);
  const perfiles = new Map();

  for (const c of compras) {
    // Sin proveedor identificado no hay a quién sugerir. Se cae al nombre del
    // tercero, que en la medición está en 1.813 de 1.814 líneas.
    const clave = c.proveedorId || (c.proveedorNombre ? `~${String(c.proveedorNombre).trim().toLowerCase()}` : null);
    if (!clave) continue;
    let p = perfiles.get(clave);
    if (!p) {
      p = {
        clave,
        proveedorId: c.proveedorId || null,
        nombre: (nombrePorId && c.proveedorId && nombrePorId[c.proveedorId]) || c.proveedorNombre || '(sin nombre)',
        lineas: 0,
        facturas: new Set(),
        monto: 0,
        ultimaFecha: '',
        tokens: new Map(),        // token → en cuántas líneas apareció
        ejemplosPorToken: new Map(), // token → una descripción de muestra
        tipos: new Map(),         // tipo_insumo → líneas
      };
      perfiles.set(clave, p);
    }
    p.lineas += 1;
    p.facturas.add(c.movId);
    p.monto += num(c.precio) * num(c.cantidad);
    if (c.fecha && c.fecha > p.ultimaFecha) p.ultimaFecha = c.fecha;
    if (c.tipoInsumo) p.tipos.set(c.tipoInsumo, (p.tipos.get(c.tipoInsumo) || 0) + 1);
    for (const t of tokensDe(c.nombre)) {
      p.tokens.set(t, (p.tokens.get(t) || 0) + 1);
      if (!p.ejemplosPorToken.has(t)) p.ejemplosPorToken.set(t, c.nombre);
    }
  }

  for (const p of perfiles.values()) {
    p.facturas = p.facturas.size;
    p.monto = Math.round((p.monto + Number.EPSILON) * 100) / 100;
    // Lo que más vendió, que es lo más cerca de un «rubro» que hay en los
    // datos. Se dice de dónde sale para que nadie lo confunda con
    // `companies.rubro`, que es una etiqueta declarada.
    p.tipoPrincipal = [...p.tipos].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    p.fuenteRubro = 'facturas';
  }
  return perfiles;
}

// ═══════════════════════════════════════════════════════════════════
// LA SUGERENCIA: a quién se le pide ESTA orden
// ═══════════════════════════════════════════════════════════════════

/**
 * A quién le conviene pedirle una propuesta del simulador.
 *
 * Es UNA sugerencia POR ORDEN y no por línea, igual que la elección de
 * proveedor de la tanda 3: una orden se le emite a un proveedor. Se puntúa
 * por cuántas líneas DISTINTAS de la orden ese proveedor ya facturó alguna
 * vez, no por cuántas facturas tiene en total — el que vendió cemento 200
 * veces no es candidato para una orden de válvulas.
 *
 * NUNCA devuelve un precio. Ver el encabezado del archivo: el emparejamiento
 * por palabras acierta el proveedor y erra el precio por órdenes de magnitud.
 *
 * @param {Array}  lineas    las de la propuesta: `{nombre, insumo_codigo}`.
 * @param {Map}    perfiles  lo que devuelve `perfilarProveedores()`.
 * @param {number} [opts.max=5]
 * @param {number} [opts.minimoComun=TOKENS_EN_COMUN_MINIMO]
 *
 * @returns {{candidatos:Array, alcance:{lineas:number, conCandidato:number}}}
 */
export function sugerirProveedores(lineas = [], perfiles = new Map(), { max = 5, minimoComun = TOKENS_EN_COMUN_MINIMO } = {}) {
  const filas = (lineas || []).filter(l => String(l?.nombre || '').trim());
  if (!filas.length || !perfiles?.size) {
    return { candidatos: [], alcance: { lineas: filas.length, conCandidato: 0 } };
  }

  // Índice invertido token → proveedores. Sin esto son 167 líneas × 344
  // proveedores × sus tokens en cada apertura de tarjeta.
  const porToken = new Map();
  for (const p of perfiles.values()) {
    for (const t of p.tokens.keys()) {
      const arr = porToken.get(t) || [];
      arr.push(p);
      porToken.set(t, arr);
    }
  }

  const acum = new Map();   // clave de proveedor → { perfil, lineas:Set, ejemplos:[] }
  let conCandidato = 0;

  for (const l of filas) {
    const tks = tokensDe(l.nombre);
    if (tks.length < minimoComun) continue;
    const cuenta = new Map();   // proveedor → cuántos tokens de ESTA línea comparte
    for (const t of tks) {
      for (const p of (porToken.get(t) || [])) {
        cuenta.set(p, (cuenta.get(p) || 0) + 1);
      }
    }
    let alguno = false;
    for (const [p, comunes] of cuenta) {
      if (comunes < minimoComun) continue;
      alguno = true;
      let a = acum.get(p.clave);
      if (!a) { a = { perfil: p, lineas: new Set(), ejemplos: [] }; acum.set(p.clave, a); }
      a.lineas.add(l.clave || l.insumo_codigo || l.nombre);
      if (a.ejemplos.length < 3) {
        // La evidencia es el par: qué pedimos y qué nos vendió. Mostrar solo
        // el nombre del proveedor obliga a creerle a una caja negra.
        const token = tks.find(t => p.ejemplosPorToken.has(t));
        a.ejemplos.push({ pedido: l.nombre, vendio: token ? p.ejemplosPorToken.get(token) : null });
      }
    }
    if (alguno) conCandidato += 1;
  }

  const candidatos = [...acum.values()]
    .map(a => ({
      proveedorId: a.perfil.proveedorId,
      clave: a.perfil.clave,
      nombre: a.perfil.nombre,
      lineasCubiertas: a.lineas.size,
      cobertura: filas.length ? a.lineas.size / filas.length : 0,
      facturas: a.perfil.facturas,
      lineasHistoricas: a.perfil.lineas,
      ultimaFecha: a.perfil.ultimaFecha || null,
      tipoPrincipal: a.perfil.tipoPrincipal,
      ejemplos: a.ejemplos,
      // Se dice en la misma fila de dónde sale, para que nadie lo lea como
      // una cotización. La pantalla lo repite.
      base: 'facturas_anteriores',
      precioSugerido: null,
    }))
    .sort((a, b) =>
      b.lineasCubiertas - a.lineasCubiertas
      || b.facturas - a.facturas
      || String(b.ultimaFecha || '').localeCompare(String(a.ultimaFecha || ''))
      || String(a.nombre).localeCompare(String(b.nombre), 'es'))
    .slice(0, Math.max(1, max));

  return { candidatos, alcance: { lineas: filas.length, conCandidato } };
}

/**
 * Por qué se sugiere a alguien, en una frase para la pantalla.
 * Habla siempre de LÍNEAS, nunca de plata: el monto de esas facturas es de
 * otros productos y compararlo contra esta orden no significa nada.
 */
export function porQueEsteProveedor(c) {
  if (!c) return '';
  const partes = [`ya facturó ${c.lineasCubiertas} de estas líneas`];
  if (c.facturas) partes.push(`${c.facturas} factura(s) en total`);
  if (c.ultimaFecha) partes.push(`la última el ${c.ultimaFecha}`);
  return `Sugerido porque ${partes.join(' · ')}.`;
}
