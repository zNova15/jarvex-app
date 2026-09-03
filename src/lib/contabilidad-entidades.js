// ═══════════════════════════════════════════════════════════════════
// JARVEX — Contabilidad POR ENTIDAD (tanda 2D).
//
// El modelo que fijó Gabriel (3-sep-2026), y que esta librería hace explícito:
//
//   · Cada ENTIDAD lleva su propia contabilidad. Y hay dos clases de entidad:
//       – las EMPRESAS del grupo (tipo_entidad='propia'), y
//       – los TRABAJOS (obras, supervisiones y bienes/servicios).
//   · Los CONSORCIOS no son una entidad de este listado: su contabilidad es la
//     del trabajo que ejecutan, y ahí se mira (entrega 2B). Aparecen como
//     titular contable de su obra, no como una empresa suelta.
//   · A los TERCEROS no se les lleva contabilidad: son proveedores y clientes.
//   · El bloque "Contabilidad" de la pantalla principal es el RESUMEN de todas
//     esas contabilidades, con el vínculo para entrar a cada una.
//
// ⚠ LO QUE ESTA LIBRERÍA NO HACE, Y POR QUÉ IMPORTA: los dos cortes NO se
// suman. Un mismo comprobante tiene company_id (su titular legal) y puede
// tener obra_id/trabajo_id (a qué trabajo se imputa): aparece en su empresa Y
// en su trabajo. Son dos miradas de la misma plata, no dos gastos. Sumar los
// totales de las dos listas daría el doble de lo que el grupo movió, así que
// esta librería devuelve los totales SEPARADOS y la pantalla lo dice con
// todas las letras. Eliminar de verdad lo que se repite entre entidades del
// grupo es otro corte, y vive en `consolidado.js` (tanda 3): la pantalla
// muestra los dos — el número del grupo arriba, el de cada entidad abajo.
//
// CRITERIO ÚNICO, el del Consolidado: una moneda por vez (mezclar soles con
// dólares da un número que no es plata de nadie), sin anulados, y los tipos
// income/cost/expense de siempre. Es el mismo criterio de
// `resumenFinancieroEmpresa` — de hecho las empresas se calculan con ESA
// función, para que la ficha de una empresa y este resumen nunca muestren dos
// números distintos de lo mismo.
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════
import { resumenFinancieroEmpresa } from './inventario-empresa.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Acumula ingresos/costos/gastos de los movimientos que pasan un filtro.
 * Mismo criterio que resumenFinancieroEmpresa, aplicado a otro corte.
 */
function acumular(movs, incluye, { moneda = 'PEN', demo = false } = {}) {
  const r = { ingresos: 0, costos: 0, gastos: 0, nMovs: 0, otrasMonedas: 0, anulados: 0 };
  for (const m of (movs || [])) {
    if (!m || m.deleted_at) continue;
    if (!!m.demo !== !!demo) continue;
    if (!incluye(m)) continue;
    if (m.payment_status === 'cancelled') { r.anulados++; continue; }
    if ((m.currency || 'PEN') !== moneda) { r.otrasMonedas++; continue; }
    const a = Number(m.amount || 0);
    if (m.type === 'income') r.ingresos += a;
    else if (m.type === 'expense') r.gastos += a;
    else r.costos += a;
    r.nMovs++;
  }
  r.ingresos = r2(r.ingresos); r.costos = r2(r.costos); r.gastos = r2(r.gastos);
  r.egresos = r2(r.costos + r.gastos);
  r.utilidad = r2(r.ingresos - r.egresos);
  r.margen = r.ingresos > 0 ? Math.round((r.utilidad / r.ingresos) * 1000) / 10 : 0;
  return r;
}

/** Suma una lista de resúmenes en uno solo (para la fila de totales). */
function sumar(filas) {
  const t = { ingresos: 0, egresos: 0, utilidad: 0, nMovs: 0 };
  for (const f of filas) {
    t.ingresos += f.ingresos; t.egresos += f.egresos; t.nMovs += f.nMovs;
  }
  t.ingresos = r2(t.ingresos); t.egresos = r2(t.egresos);
  t.utilidad = r2(t.ingresos - t.egresos);
  return t;
}

/**
 * El resumen de todas las contabilidades de entidad.
 *
 * @param companies   filas de companies (se usan las tipo_entidad='propia')
 * @param obras       filas de obras (todas las naturalezas: ejecución, supervisión…)
 * @param trabajos    filas de trabajos (bienes y servicios, mig 174)
 * @param consorcios  filas de consorcios, para nombrar al titular de una obra
 * @param movs        accounting_movements
 * @param moneda      'PEN' | 'USD'
 * @param demo        modo prueba
 * @returns { empresas, trabajos, totales, sinImputar }
 */
export function resumenPorEntidad({
  companies = [], obras = [], trabajos = [], consorcios = [], movs = [],
  moneda = 'PEN', demo = false,
} = {}) {
  const comps = vivos(companies);
  const nombreCompany = (id) => comps.find(c => c.id === id)?.name || null;

  // ── Entidad 1: las EMPRESAS del grupo ───────────────────────────
  // Solo 'propia'. El consorcio lleva libros, pero se miran en su trabajo; el
  // tercero no lleva libros nuestros.
  const empresas = comps
    .filter(c => (c.tipo_entidad || 'propia') === 'propia')
    .map(c => {
      const r = resumenFinancieroEmpresa(movs, { companyId: c.id, moneda, demo });
      return {
        id: c.id,
        kind: 'empresa',
        nombre: c.name || '(empresa sin nombre)',
        ruc: c.ruc || null,
        ingresos: r2(r.total.ingresos),
        egresos: r2(r.total.costos + r.total.gastos),
        utilidad: r2(r.total.utilidad),
        margen: Math.round((r.total.margen || 0) * 10) / 10,
        nMovs: r.nMovs,
        otrasMonedas: (r.otrasMonedas || []).reduce((s, o) => s + (o.movs || 0), 0),
        // Lo facturado entre empresas del grupo, sin emparejar. Es una señal
        // de cuánto de esta empresa es interno; el número consolidado de
        // verdad lo calcula `consolidar()` emparejando cada factura con su
        // espejo, que no es lo mismo que sumar las dos bolsas.
        interco: r2((r.interco?.ingresos || 0) + (r.interco?.costos || 0)),
      };
    })
    .sort((a, b) => b.ingresos - a.ingresos || a.nombre.localeCompare(b.nombre));

  // ── Entidad 2: los TRABAJOS ─────────────────────────────────────
  const deObras = vivos(obras).map(o => {
    const r = acumular(movs, m => m.obra_id === o.id, { moneda, demo });
    // Titular contable: el consorcio si lo hay, si no la ejecutora directa.
    const c = vivos(consorcios).find(x => x.obra_id === o.id);
    const titularId = c?.company_id || o.ejecutora_company_id || null;
    return {
      id: o.id,
      kind: 'obra',
      nombre: o.nombre_obra || '(trabajo sin nombre)',
      tipoTrabajo: o.tipo_trabajo || 'obra_ejecucion',
      estado: o.estado || null,
      titularId,
      titular: nombreCompany(titularId),
      esConsorcio: !!c,
      ...r,
    };
  });

  const deBS = vivos(trabajos).map(t => {
    const r = acumular(movs, m => m.trabajo_id === t.id, { moneda, demo });
    const titularId = t.consorcio_id
      ? (vivos(consorcios).find(c => c.id === t.consorcio_id)?.company_id || null)
      : (t.ejecutor_company_id || null);
    return {
      id: t.id,
      kind: 'bien_servicio',
      nombre: t.nombre || '(trabajo sin nombre)',
      tipoTrabajo: t.tipo || 'bien',
      estado: t.estado || null,
      titularId,
      titular: nombreCompany(titularId),
      esConsorcio: !!t.consorcio_id,
      ...r,
    };
  });

  const trabajosOut = [...deObras, ...deBS]
    .sort((a, b) => b.nMovs - a.nMovs || a.nombre.localeCompare(b.nombre));

  // ── Lo que no está imputado a ningún trabajo ────────────────────
  // No es un error por sí solo (el alquiler de la oficina no es de una obra),
  // pero es el número que le dice a la contadora cuánto queda sin asignar.
  const sinImputar = acumular(movs, m => !m.obra_id && !m.trabajo_id, { moneda, demo });

  // ── Lo que el corte POR EMPRESA no alcanza a mostrar ────────────
  // Los movimientos a nombre de un consorcio o de un tercero no están en la
  // lista de empresas (a propósito: el consorcio se mira en su trabajo). Si no
  // se dijera, el total por empresa parecería "toda la plata del grupo" y no
  // lo es — la contadora vería faltar los 125 movimientos de EL INCA sin
  // explicación.
  const idsPropias = new Set(empresas.map(e => e.id));
  const fueraDeEmpresas = acumular(
    movs, m => !!m.company_id && !idsPropias.has(m.company_id), { moneda, demo }
  );

  return {
    empresas,
    trabajos: trabajosOut,
    totales: {
      // SEPARADOS a propósito: sumarlos contaría dos veces el mismo comprobante.
      empresas: sumar(empresas),
      trabajos: sumar(trabajosOut),
    },
    sinImputar,
    fueraDeEmpresas,
  };
}
