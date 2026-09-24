// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES: IMPUTAR LO YA COMPRADO AL PRESUPUESTO
// (ronda 2, tanda 2.5 de docs/plan-simulador-ordenes.md, 24-set-2026)
//
// El simulador solo puede restar lo que sabe contra qué línea del
// presupuesto restar. Hasta esta tanda había dos agujeros, medidos en
// Miraflores:
//
//   · Las 62 líneas de las 14 órdenes retroactivas: `insumo_codigo` NULL en
//     el 100%. Son cemento (3 × 750 bolsas), ~43 herramientas de OC-002 y
//     servicios del documento de trabajo (topografía, estudio de suelos…).
//   · El ALMACÉN, que es donde de verdad quedó lo comprado: 467 ítems con
//     entradas, 3.140 bolsas de cemento entradas contra las 2.250 que
//     explican las órdenes. Los nombres son los del almacén («CEMENTO»,
//     «TUBO PVC-U 200 mm S-25 UF» en unidades) y no traen código.
//
// Esta lib arma la BANDEJA que cierra los dos agujeros. PURA: sin React, sin
// Dexie. La pantalla escribe el parche que devuelve `parcheImputacion()`.
//
// ── TRES DESTINOS, NO UNO ─────────────────────────────────────────
//   insumo — un código del presupuesto, con su factor: cuántas unidades del
//            presupuesto trae una unidad de la fila (tubo → 5 m).
//   sobre  — solo para líneas de ORDEN: las herramientas de OC-002 no tienen
//            un insumo propio en el expediente, son plata del sobre
//            «HERRAMIENTAS MANUALES» (S/ 132.493). Restan monto, no cantidad.
//            El almacén no puede ir a un sobre: sus ítems no tienen precio
//            (valor de inventario de Miraflores: S/ 0 en herramientas y EPPs).
//   fuera  — no corresponde a ninguna línea del presupuesto (los estudios del
//            documento de trabajo; los lapiceros del almacén). Deja de
//            contarse como «no se sabe» y pasa a «no corresponde».
//
// ── RECOMIENDA; LA PERSONA DECIDE ─────────────────────────────────
// La sugerencia sale de `match-solicitud.js` (el match de 86bce80), que es
// estricto a propósito: medido contra Miraflores, 157 de 467 ítems del
// almacén salen con sugerencia y varias están mal («VÁLVULA DE 1/2" PARA
// MEDIDOR» → «VÁLVULA CHECK»). Por eso NADA se imputa solo y no hay «aceptar
// todas»: una imputación equivocada resta el insumo equivocado, y eso hace
// pedir dos veces uno y quedarse corto del otro.
//
// Y un factor que no se sabe no se inventa: si la unidad de la fila no es la
// del presupuesto y el nombre no dice la presentación, `factor` queda null y
// la pantalla lo pide antes de dejar imputar.
//
// Testeado en __tests__/simulador-imputacion.test.js
// ═══════════════════════════════════════════════════════════════════

import {
  prepararCatalogo, recomendarInsumos, decidirSugerencia, familiaUnidad, mismaUnidad,
} from './match-solicitud.js';
import { clasificarInsumoDePresupuesto, clasificarInsumo } from './insumo-clasificador.js';
import { resolverCompra } from './simulador-compra.js';
import { claveDeSobre } from './simulador-ordenes.js';

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r4 = (n) => Math.round((num(n) + Number.EPSILON) * 10000) / 10000;
const r2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

export const IMPUTACIONES = ['insumo', 'sobre', 'fuera'];
export const IMPUTACION_LABEL = {
  pendiente: 'Sin imputar',
  insumo: 'Imputada a un insumo',
  sobre: 'Contra un sobre',
  fuera: 'Fuera del presupuesto',
};

/** Tablas del almacén que se imputan, con su columna de nombre. */
export const TABLAS_ALMACEN = {
  materiales: { nombre: 'nombre_material', mov: 'material_id', entrada: 'entrada', label: 'Material' },
  herramientas: { nombre: 'nombre_herramienta', mov: 'herramienta_id', entrada: 'ingreso', label: 'Herramienta' },
  epps: { nombre: 'nombre_epp', mov: 'epp_id', entrada: 'entrada', label: 'EPP' },
};

// Órdenes que ya no reservan nada: no se piden imputar.
const ORDEN_MUERTA = new Set(['anulada', 'cancelada']);

// ═══════════════════════════════════════════════════════════════════
// 1. EL PRESUPUESTO, COMO CATÁLOGO CONTRA EL QUE SE IMPUTA
// ═══════════════════════════════════════════════════════════════════

/**
 * Los insumos comprables del presupuesto, consolidados por código, y sus
 * sobres aparte. La mano de obra no entra: nadie compra HH en una orden.
 *
 * @returns {{insumos:Array, sobres:Array, porCodigo:Map, prep:Object}}
 */
export function catalogoDelPresupuesto(insumosPartida = []) {
  const porCodigo = new Map();
  for (const ip of vivos(insumosPartida)) {
    const cod = ip.insumo_codigo && String(ip.insumo_codigo).trim();
    if (!cod) continue;
    if (String(ip.tipo_insumo || '').toLowerCase() === 'mano_obra') continue;
    let e = porCodigo.get(cod);
    if (!e) {
      const cls = clasificarInsumoDePresupuesto(ip);
      e = {
        codigo: cod, nombre: ip.nombre_insumo || cod, unidad: ip.unidad || '',
        tipo: ip.tipo_insumo || '', esSobre: !!cls.esSobre,
        claveSobre: cls.esSobre ? claveDeSobre(ip) : null,
        cantidad: 0, costo: 0,
      };
      porCodigo.set(cod, e);
    }
    e.cantidad += num(ip.cantidad_presupuestada);
    e.costo += num(ip.costo_presupuestado)
      || num(ip.cantidad_presupuestada) * num(ip.precio_presupuestado);
  }
  const todos = [...porCodigo.values()].map(e => ({ ...e, cantidad: r4(e.cantidad), costo: r2(e.costo) }));
  for (const e of todos) porCodigo.set(e.codigo, e);
  const insumos = todos.filter(e => !e.esSobre)
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const sobres = todos.filter(e => e.esSobre).sort((a, b) => b.costo - a.costo);
  const prep = prepararCatalogo(insumos.map(e => ({ id: e.codigo, nombre: e.nombre, unidad: e.unidad, tipo: e.tipo })));
  return { insumos, sobres, porCodigo, prep };
}

// ═══════════════════════════════════════════════════════════════════
// 2. EL ALMACÉN: QUÉ ENTRÓ Y QUÉ HAY
// ═══════════════════════════════════════════════════════════════════

/**
 * Cada ítem del almacén de la obra con lo que ENTRÓ y lo que HAY.
 *
 * `entradas` = stock inicial + movimientos de entrada (en herramientas se
 * llaman «ingreso»), sin reversas ni reversados — la misma regla que
 * `stock-conciliacion.js`. Una devolución NO es una entrada: es la
 * herramienta que vuelve del trabajador, no algo que se compró.
 *
 * `stock` = `stock_actual`, el contador del almacén. Puede estar desfasado
 * del historial (ver stock-conciliacion.js), pero es el número que la
 * almacenera ve y el que Gabriel eligió como opción «lo que hay».
 *
 * Los grupos (`es_grupo`) no se imputan: son carpetas, no cosas.
 */
export function existenciasDelAlmacen({
  materiales = [], herramientas = [], epps = [],
  movMateriales = [], movHerramientas = [], movEpp = [],
  obraId = null,
} = {}) {
  const movs = { materiales: movMateriales, herramientas: movHerramientas, epps: movEpp };
  const filas = { materiales, herramientas, epps };
  const out = [];
  for (const [tabla, cfg] of Object.entries(TABLAS_ALMACEN)) {
    const entradas = new Map();
    for (const m of vivos(movs[tabla])) {
      if (m.reverses_id || m.reversed_by_id) continue;
      if (obraId && m.obra_id && m.obra_id !== obraId) continue;
      if (String(m.tipo_movimiento || '') !== cfg.entrada) continue;
      const id = m[cfg.mov];
      if (!id) continue;
      // Una herramienta sin cantidad (la que no «maneja cantidad») es una.
      const cant = m.cantidad == null ? 1 : num(m.cantidad);
      entradas.set(id, (entradas.get(id) || 0) + cant);
    }
    for (const f of vivos(filas[tabla])) {
      if (obraId && f.obra_id !== obraId) continue;
      if (f.es_grupo) continue;
      out.push({
        tabla, id: f.id,
        nombre: f[cfg.nombre] || '',
        unidad: f.unidad || '',
        entradas: r4(num(f.stock_inicial) + (entradas.get(f.id) || 0)),
        stock: r4(num(f.stock_actual)),
        insumo_codigo: f.insumo_codigo || null,
        factor_presupuesto: f.factor_presupuesto ?? null,
        imputacion: f.imputacion || null,
      });
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 3. LA SUGERENCIA Y EL FACTOR
// ═══════════════════════════════════════════════════════════════════

// Unidades que son «una cosa»: una pieza del almacén contra metros del
// presupuesto se convierte con la presentación que dice el nombre.
const ES_PIEZA = new Set(['und']);
const PIEZA_EXTRA = /^(tubo|tubos|varilla|varillas|pieza|piezas|pza)$/i;

/**
 * Cuántas unidades del presupuesto trae UNA unidad de la fila.
 *
 * · Misma unidad (und = UNIDAD, bol = Bolsas) → 1.
 * · Una pieza contra un insumo cuyo nombre declara la presentación
 *   («TUBERIA … x 5 m», madera en pies, varilla con diámetro) → el factor de
 *   esa presentación, el MISMO que usa el plan para pedir (`resolverCompra`,
 *   incluida la corrección a mano de la obra si la hay).
 * · Otra cosa → null: el factor se pregunta, no se adivina.
 *
 * @returns {{factor:number|null, fuente:'misma_unidad'|'presentacion'|null, motivo:string}}
 */
export function factorPropuesto(unidadFila, insumo, { compras = null } = {}) {
  if (!insumo) return { factor: null, fuente: null, motivo: '' };
  if (mismaUnidad(unidadFila, insumo.unidad)) {
    return { factor: 1, fuente: 'misma_unidad', motivo: 'Misma unidad que el presupuesto.' };
  }
  const fam = familiaUnidad(unidadFila);
  const esPieza = ES_PIEZA.has(fam) || PIEZA_EXTRA.test(String(unidadFila || '').trim());
  if (esPieza) {
    const c = resolverCompra(compras?.[insumo.codigo], { nombre: insumo.nombre, unidad: insumo.unidad });
    if (c.origen !== 'expediente' && c.factor > 0 && c.factor !== 1) {
      return {
        factor: r4(c.factor), fuente: 'presentacion',
        motivo: `1 ${unidadFila || 'unidad'} = ${r4(c.factor)} ${insumo.unidad} (${c.unidadCompra}).`,
      };
    }
  }
  return {
    factor: null, fuente: null,
    motivo: `La fila está en «${unidadFila || '—'}» y el presupuesto en «${insumo.unidad || '—'}»: falta decir cuánto trae cada una.`,
  };
}

/**
 * La recomendación para una fila. Nunca decide: devuelve a lo sumo UNA
 * sugerencia con su puntaje, y las alternativas para cambiarla con un clic.
 *
 * Una línea de ORDEN de herramienta que no reconoce ningún insumo se sugiere
 * contra el sobre de herramientas, si el presupuesto lo tiene: es lo que el
 * expediente dice que son (§4.1 del plan). Al almacén no se le sugiere un
 * sobre — no puede ir a uno.
 */
export function sugerirImputacion(fila, catalogo, { compras = null } = {}) {
  if (!catalogo || !fila) return { sugerencia: null, alternativas: [] };
  const cands = recomendarInsumos(fila.nombre, catalogo.prep, { max: 6 });
  const d = decidirSugerencia(cands);
  const alternativas = cands
    .filter(c => !d.elegido || c.id !== d.elegido.id)
    .slice(0, 5)
    .map(c => ({ codigo: c.id, nombre: c.nombre, unidad: c.unidad, score: c.score }));
  if (d.elegido) {
    const ins = catalogo.porCodigo.get(d.elegido.id);
    const f = factorPropuesto(fila.unidad, ins, { compras });
    return {
      sugerencia: {
        tipo: 'insumo', codigo: ins.codigo, nombre: ins.nombre, unidad: ins.unidad,
        score: d.elegido.score, factor: f.factor, factorFuente: f.fuente, motivoFactor: f.motivo,
      },
      alternativas,
    };
  }
  // El tipo de la línea no alcanza: en OC-002 las carretillas y los picos
  // quedaron cargados como «material». El nombre también cuenta.
  const esHerramienta = fila.fuente === 'orden'
    && (String(fila.tipo_insumo || '').toLowerCase() === 'herramienta'
      || clasificarInsumo(fila.nombre) === 'herramienta');
  if (esHerramienta) {
    const sobre = catalogo.sobres.find(s => /herramienta/i.test(s.nombre));
    if (sobre) {
      return {
        sugerencia: {
          tipo: 'sobre', codigo: sobre.codigo, nombre: sobre.nombre, unidad: sobre.unidad,
          score: null, factor: null, factorFuente: null,
          motivoFactor: 'Una herramienta suelta no tiene insumo propio en el expediente: gasta plata del sobre.',
        },
        alternativas,
      };
    }
  }
  return { sugerencia: null, alternativas };
}

// ═══════════════════════════════════════════════════════════════════
// 4. EL PARCHE — respeta el CHECK de la mig 229 (regla 9 de CLAUDE.md)
// ═══════════════════════════════════════════════════════════════════

/**
 * Lo que se escribe en la fila. Dexie no valida el CHECK
 * `…_imputacion_coherente`, así que una fila mal formada se guardaría local y
 * rebotaría en el push (23514) dejando el sync en reintento eterno. Por eso
 * el parche sale SOLO de acá, y lo que no cumple vuelve con `ok:false`.
 *
 * @param {{tipo:'insumo'|'sobre'|'fuera'|null, codigo?:string, factor?:number}} decision
 *        `tipo:null` = deshacer.
 * @param {{permiteSobre?:boolean, catalogo?:Object}} o
 * @returns {{ok:true, patch:Object}|{ok:false, motivo:string}}
 */
export function parcheImputacion(decision, { permiteSobre = false, catalogo = null } = {}) {
  const tipo = decision?.tipo ?? null;
  if (tipo === null) {
    return { ok: true, patch: { imputacion: null, insumo_codigo: null, factor_presupuesto: null } };
  }
  if (!IMPUTACIONES.includes(tipo)) return { ok: false, motivo: 'Destino desconocido.' };
  if (tipo === 'fuera') {
    return { ok: true, patch: { imputacion: 'fuera', insumo_codigo: null, factor_presupuesto: null } };
  }
  const codigo = String(decision.codigo || '').trim();
  if (!codigo) return { ok: false, motivo: 'Falta elegir la línea del presupuesto.' };
  const ins = catalogo?.porCodigo?.get(codigo) || null;
  if (catalogo && !ins) return { ok: false, motivo: `El código ${codigo} no está en el presupuesto de esta obra.` };
  if (tipo === 'sobre') {
    if (!permiteSobre) return { ok: false, motivo: 'Un ítem del almacén no tiene precio: no puede gastar un sobre.' };
    if (ins && !ins.esSobre) return { ok: false, motivo: `${ins.nombre} no es un sobre.` };
    return { ok: true, patch: { imputacion: 'sobre', insumo_codigo: codigo, factor_presupuesto: null } };
  }
  if (ins && ins.esSobre) return { ok: false, motivo: `${ins.nombre} es un sobre, no un insumo.` };
  const f = Number(decision.factor);
  if (!Number.isFinite(f) || f <= 0) return { ok: false, motivo: 'Falta el factor: cuántas unidades del presupuesto trae cada una.' };
  return {
    ok: true,
    // El factor 1 se guarda como null — así lo lee `factorDeItem` y así lo
    // escribe el plan desde la mig 228.
    patch: { imputacion: 'insumo', insumo_codigo: codigo, factor_presupuesto: r4(f) === 1 ? null : r4(f) },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. LA BANDEJA
// ═══════════════════════════════════════════════════════════════════

const estadoDe = (f) => (f.imputacion && IMPUTACIONES.includes(f.imputacion) ? f.imputacion : 'pendiente');

const ordenar = (a, b) => (
  ((a.estado === 'pendiente') ? 0 : 1) - ((b.estado === 'pendiente') ? 0 : 1)
  // Con sugerencia arriba: es lo que se despacha con un clic.
  || ((b.sugerencia ? 1 : 0) - (a.sugerencia ? 1 : 0))
  || (num(b.peso) - num(a.peso))
  || String(a.nombre).localeCompare(String(b.nombre), 'es')
);

/**
 * Las filas a imputar de UNA obra.
 *
 * Órdenes: solo las líneas SIN código, o las que ya se imputaron desde acá
 * (para poder deshacerlas). Una línea que el plan escribió con código
 * (`imputacion` null, `insumo_codigo` puesto) no es asunto de esta bandeja.
 *
 * Almacén: todo ítem que recibió algo o tiene stock.
 *
 * @returns {{ordenes:Array, almacen:Array, resumen:Object}}
 */
export function bandejaImputacion({
  ordenes = [], ocItems = [], almacen = [], catalogo = null, compras = null,
} = {}) {
  const vivas = new Map();
  for (const o of vivos(ordenes)) {
    if (ORDEN_MUERTA.has(String(o.estado || ''))) continue;
    vivas.set(o.id, o);
  }
  const destinoDe = (cod) => (cod && catalogo?.porCodigo?.get(String(cod))) || null;

  const filasOrden = [];
  for (const it of vivos(ocItems)) {
    const o = vivas.get(it.orden_compra_id);
    if (!o) continue;
    if (it.insumo_codigo && !it.imputacion) continue;
    const monto = num(it.subtotal) || num(it.cantidad) * num(it.precio_unitario);
    const fila = {
      fuente: 'orden', tabla: 'oc_items', id: it.id,
      nombre: it.nombre || it.nombre_libre || '',
      unidad: it.unidad || '', cantidad: r4(it.cantidad), monto: r2(monto),
      tipo_insumo: it.tipo_insumo || '',
      ordenCodigo: o.codigo || '', ordenEstado: o.estado || '', ordenFecha: o.fecha || null,
      proveedor: o.proveedor_nombre || '',
      estado: estadoDe(it),
      insumo_codigo: it.insumo_codigo || null,
      factor: it.factor_presupuesto ?? null,
      peso: monto,
    };
    fila.destino = destinoDe(fila.insumo_codigo);
    Object.assign(fila, fila.estado === 'pendiente'
      ? sugerirImputacion(fila, catalogo, { compras })
      : { sugerencia: null, alternativas: [] });
    filasOrden.push(fila);
  }

  const filasAlm = [];
  for (const f of (almacen || [])) {
    if (!f || !(num(f.entradas) > 0 || num(f.stock) > 0)) continue;
    const fila = {
      fuente: 'almacen', tabla: f.tabla, id: f.id,
      nombre: f.nombre, unidad: f.unidad,
      entradas: f.entradas, stock: f.stock,
      estado: estadoDe(f),
      insumo_codigo: f.insumo_codigo || null,
      factor: f.factor_presupuesto ?? null,
      peso: num(f.entradas),
    };
    fila.destino = destinoDe(fila.insumo_codigo);
    Object.assign(fila, fila.estado === 'pendiente'
      ? sugerirImputacion(fila, catalogo, { compras })
      : { sugerencia: null, alternativas: [] });
    filasAlm.push(fila);
  }

  filasOrden.sort(ordenar);
  filasAlm.sort(ordenar);

  const cuenta = (arr) => {
    const r = { total: arr.length, pendiente: 0, insumo: 0, sobre: 0, fuera: 0, conSugerencia: 0, montoPendiente: 0 };
    for (const f of arr) {
      r[f.estado] += 1;
      if (f.estado === 'pendiente') {
        if (f.sugerencia) r.conSugerencia += 1;
        r.montoPendiente += num(f.monto);
      }
    }
    r.montoPendiente = r2(r.montoPendiente);
    return r;
  };
  return {
    ordenes: filasOrden,
    almacen: filasAlm,
    resumen: { ordenes: cuenta(filasOrden), almacen: cuenta(filasAlm) },
  };
}

/**
 * Los insumos que el almacén ya cubre, para el modo «personalizado»: uno por
 * código, con lo que entró y lo que hay (ya en unidades del presupuesto).
 */
export function insumosCubiertosPorAlmacen(almacen = [], catalogo = null) {
  const porCod = new Map();
  for (const f of (almacen || [])) {
    if (!f || f.imputacion !== 'insumo' || !f.insumo_codigo) continue;
    const cod = String(f.insumo_codigo);
    const fac = Number(f.factor_presupuesto) > 0 ? Number(f.factor_presupuesto) : 1;
    const e = porCod.get(cod) || {
      codigo: cod,
      nombre: catalogo?.porCodigo?.get(cod)?.nombre || cod,
      unidad: catalogo?.porCodigo?.get(cod)?.unidad || '',
      necesita: catalogo?.porCodigo?.get(cod)?.cantidad ?? null,
      entradas: 0, stock: 0, items: 0,
    };
    e.entradas += num(f.entradas) * fac;
    e.stock += num(f.stock) * fac;
    e.items += 1;
    porCod.set(cod, e);
  }
  return [...porCod.values()]
    .map(e => ({ ...e, entradas: r4(e.entradas), stock: r4(e.stock) }))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}
