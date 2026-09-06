// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL COSTO DE UNA OBRA BAJO EL MODELO B (tanda 7, entrega 6).
//
// LA DECISIÓN QUE MANDA (Gabriel, 6-sep-2026): «nosotros registramos y
// vinculamos algunas compras con la empresa; eso no quiere decir que
// directamente se le cargue a la obra. Para que pase eso tiene que haber una
// venta de la empresa que compra hacia el Consorcio.»
//
// O sea: el `obra_id` de una compra es TRAZABILIDAD, no imputación de costo.
// El costo entra a la obra recién cuando la empresa del grupo le FACTURA a la
// ejecutora.
//
// ── LO QUE ESTABA MAL, MEDIDO ─────────────────────────────────────
// Plan Miraflores, contra producción el 6-sep-2026:
//
//   jx-kpis-obra mostraba «ejecutado»      S/ 2.255.308,67   (415 movs)
//   …pero compró la ejecutora (EL INCA)    S/   227.805,65   (113)
//   …y el resto es aporte del grupo        S/ 2.027.503,02   (302)
//
// El KPI estaba inflado 9,9×. No era un bug de suma: sumaba bien una cosa que
// no era costo. La regla para separarlo YA EXISTÍA y está en producción desde
// la tanda 5 (`libros-de-obra.js`, los dos libros de la obra) — lo que faltaba
// era que los KPIs y los reportes la usaran en vez de sumar por `obra_id` a
// secas.
//
// ── POR QUÉ EL COSTO ES «company_id === titular» Y NO EL LIBRO ────
// `librosDeObra()` manda al libro del consorcio DOS cosas: los comprobantes
// propios del titular y los que el grupo le EMITIÓ a él. Para decidir en qué
// columna se pinta una fila eso está perfecto. Para SUMAR COSTO no:
//
//   · La venta de JARVEX a EL INCA vive en el libro de JARVEX como `venta`
//     (type income). Contarla como costo de la obra la sumaría una vez ahí…
//   · …y otra vez cuando EL INCA registre su compra espejo (el ⇄ de la tanda 3).
//
// Por eso el costo son SOLO las compras cargadas en el libro del titular. Lo
// que el grupo le facturó entra por el espejo, que es donde tiene que entrar.
//
// ── LA TERCERA CIFRA: EL ESPEJO QUE FALTA ─────────────────────────
// Si una venta del grupo al titular NO tiene su compra espejo, ese costo es
// real y todavía no está en ningún libro — se pierde. Medido en Miraflores:
// 9 ventas al titular por S/ 59.684,12, de las que 7 ya están espejadas y
// 2 de JARVEX por S/ 31.948,68 no (es exactamente lo que la mig 176 dejó
// pendiente de correr). Por eso `porEspejar` es una salida más y no un
// detalle: es dinero que la obra ya debe y que ningún total muestra hoy.
//
// ── LOS DOS TOTALES NO SE SUMAN ───────────────────────────────────
// Misma regla que `libros-de-obra.js`, y por el mismo motivo: sumar el costo
// del titular con el aporte del grupo contaría dos veces cada factura que el
// grupo termine trasladándole a la ejecutora. Esta librería NO expone ningún
// total general que invite a sumarlos.
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════

import { indiceEmpresas, rucLimpio } from './documento-dos-lados.js';
import { titularContableDeObra } from './consorcio.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

/** Un comprobante anulado no es costo ni aporte de nadie. */
const anulado = (m) => m?.payment_status === 'cancelled';

/**
 * ¿Este movimiento es una COMPRA? Mismo criterio que el resto de la app:
 * manda `clase`, y si no está se cae al `type` contable.
 */
export function esCompraMov(m) {
  if (!m) return false;
  if (m.clase) return m.clase === 'compra';
  return m.type === 'cost' || m.type === 'expense';
}

/** ¿Es una VENTA? El espejo de la de arriba. */
export function esVentaMov(m) {
  if (!m) return false;
  if (m.clase) return m.clase === 'venta';
  return m.type === 'income';
}

/**
 * ¿Este comprobante ya tiene su espejo del otro lado?
 *
 * Se busca una compra del titular, del mismo importe y con el RUC del
 * vendedor. No se exige el número de documento porque el espejo se carga a
 * mano y la serie a veces se tipea distinta; el par (RUC + importe) es lo que
 * la contadora reconoce como "es la misma factura".
 */
function tieneEspejo(venta, comprasTitularPorClave) {
  const ruc = rucLimpio(venta?.vendedor_ruc);
  if (!ruc) return false;
  const clave = `${ruc}|${r2(venta.amount)}`;
  const n = comprasTitularPorClave.get(clave) || 0;
  return n > 0;
}

/**
 * El costo de una obra, partido en las cifras que SÍ significan algo.
 *
 * @param {Object}  o
 * @param {Array}   o.movs        comprobantes YA acotados a la obra.
 * @param {Object}  [o.obra]      la obra (para resolver su titular contable).
 * @param {Array}   [o.consorcios] tabla `consorcios`.
 * @param {Array}   [o.companies]  catálogo de empresas.
 * @param {string}  [o.titularId] atajo: si ya lo tenés resuelto, evita el lookup.
 *
 * @returns {{
 *   titularId: string|null,
 *   hayTitular: boolean,
 *   costo:      {n:number, monto:number, ids:Set<string>},
 *   aporte:     {n:number, monto:number, ids:Set<string>, porEmpresa:Array},
 *   porEspejar: {n:number, monto:number, ids:Set<string>},
 *   anulados:   number
 * }}
 *
 * `costo`      — compras cargadas en el libro del titular. ES el costo de la obra.
 * `aporte`     — compras de las demás empresas imputadas a la obra. Todavía NO
 *                es costo: lo será cuando el grupo le facture a la ejecutora.
 * `porEspejar` — ventas del grupo AL titular sin su compra espejo. Costo real
 *                que hoy no está en ningún libro.
 *
 * NO devuelve un total sumado: `costo` y `aporte` no se suman.
 */
export function costoDeObra({ movs = [], obra = null, consorcios = [], companies = [], titularId = null } = {}) {
  const titular = titularId || titularContableDeObra(obra, consorcios) || null;
  const idx = indiceEmpresas(companies);
  const filas = vivos(movs);

  const costo = { n: 0, monto: 0, ids: new Set() };
  const aporte = { n: 0, monto: 0, ids: new Set(), porEmpresa: [] };
  const porEspejar = { n: 0, monto: 0, ids: new Set() };
  let anulados = 0;

  // Índice de las compras del titular, para saber después qué venta del grupo
  // ya tiene su espejo cargado. Se arma en la misma pasada que todo lo demás.
  const comprasTitularPorClave = new Map();
  const ventasAlTitular = [];
  const porEmpresa = new Map();

  for (const m of filas) {
    if (anulado(m)) { anulados++; continue; }

    const esDelTitular = !!titular && m.company_id === titular;

    if (esCompraMov(m)) {
      if (esDelTitular) {
        costo.n++; costo.monto += num(m.amount); costo.ids.add(m.id);
        const ruc = rucLimpio(m.third_party_ruc);
        if (ruc) {
          const k = `${ruc}|${r2(m.amount)}`;
          comprasTitularPorClave.set(k, (comprasTitularPorClave.get(k) || 0) + 1);
        }
      } else {
        // Sin titular resuelto no hay dos cosas que separar: todo es aporte y
        // el costo queda en cero, que es lo honesto (no sabemos quién ejecuta).
        aporte.n++; aporte.monto += num(m.amount); aporte.ids.add(m.id);
        const e = porEmpresa.get(m.company_id) || { company_id: m.company_id, n: 0, monto: 0 };
        e.n++; e.monto += num(m.amount);
        porEmpresa.set(m.company_id, e);
      }
      continue;
    }

    // Una VENTA cuya contraparte es el titular es costo de la obra… del otro
    // lado. Se guarda para revisar el espejo cuando estén todas las compras.
    if (esVentaMov(m) && titular && !esDelTitular) {
      const rel = m.related_company_id;
      const ruc = rucLimpio(m.third_party_ruc);
      const contraparteEsTitular = (rel && rel === titular)
        || (!!ruc && idx.porRuc.get(ruc)?.id === titular);
      if (contraparteEsTitular) {
        const emisora = idx.porId.get(m.company_id) || null;
        ventasAlTitular.push({ ...m, vendedor_ruc: emisora?.ruc || null });
      }
    }
  }

  for (const v of ventasAlTitular) {
    if (tieneEspejo(v, comprasTitularPorClave)) continue;
    porEspejar.n++; porEspejar.monto += num(v.amount); porEspejar.ids.add(v.id);
  }

  const nombreDe = (id) => idx.porId.get(id)?.name || idx.porId.get(id)?.legal_name || '(sin empresa)';
  aporte.porEmpresa = [...porEmpresa.values()]
    .map(e => ({ ...e, monto: r2(e.monto), nombre: nombreDe(e.company_id) }))
    .sort((a, b) => b.monto - a.monto);

  return {
    titularId: titular,
    hayTitular: !!titular,
    costo: { ...costo, monto: r2(costo.monto) },
    aporte: { ...aporte, monto: r2(aporte.monto) },
    porEspejar: { ...porEspejar, monto: r2(porEspejar.monto) },
    anulados,
  };
}

/**
 * La frase que acompaña a las dos cifras en pantalla. Vive aquí y no en el JSX
 * para que sea la MISMA en los KPIs y en los reportes: si cada pantalla
 * inventa su explicación, dos usuarios entienden dos cosas distintas del mismo
 * número. Mismo motivo por el que `libros-de-obra` no expone un total general.
 */
export const NOTA_NO_SE_SUMAN =
  'No se suman: el aporte del grupo recién es costo de la obra cuando la empresa le factura a la ejecutora.';

/**
 * El «consumo por obra» de los reportes contables, ya partido por modelo B.
 * Devuelve una fila por obra con las dos cifras separadas, nunca una sola.
 */
export function consumoPorObraModeloB({ movs = [], obras = [], consorcios = [], companies = [] } = {}) {
  const porObra = new Map();
  for (const m of vivos(movs)) {
    if (!m.obra_id) continue;
    const arr = porObra.get(m.obra_id) || [];
    arr.push(m);
    porObra.set(m.obra_id, arr);
  }
  const obrasById = new Map(vivos(obras).map(o => [o.id, o]));
  const filas = [];
  for (const [obraId, movsObra] of porObra) {
    const obra = obrasById.get(obraId) || null;
    const c = costoDeObra({ movs: movsObra, obra, consorcios, companies });
    filas.push({
      obra_id: obraId,
      nombre: obra?.nombre_obra || obra?.nombre || '(sin obra)',
      costo: c.costo.monto,
      nCosto: c.costo.n,
      aporte: c.aporte.monto,
      nAporte: c.aporte.n,
      porEspejar: c.porEspejar.monto,
      hayTitular: c.hayTitular,
    });
  }
  return filas.sort((a, b) => (b.costo + b.aporte) - (a.costo + a.aporte));
}
