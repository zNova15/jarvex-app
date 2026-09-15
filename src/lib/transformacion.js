// ═══════════════════════════════════════════════════════════════════
// JARVEX — LO QUE ENTRA DE UNA FORMA Y SALE DE OTRA (tanda 7, 15-set-2026).
// Lib PURA (sin Dexie, sin DOM, sin red).
//
// ── EL PEDIDO, TEXTUAL ────────────────────────────────────────────
// Gabriel, 6-set-2026, definiendo el cuarto cajón del recomendador de activos:
// «podría o bien revenderse, o ser parte de uso de la empresa para
// transformarla en otro insumo (planchas metálicas por ejemplo a láminas más
// pequeñas)».
//
// El cajón «🔁 Se transforma» existe desde la tanda 6 y hasta hoy no
// significaba nada: marcarlo apagaba el saldo del insumo —con razón, porque
// «comprado − vendido» no cierra cuando la mercadería salió convertida en otra
// cosa— pero no había forma de decir EN QUÉ se convirtió. El insumo quedaba en
// un limbo: ni cuadra ni se puede explicar por qué no cuadra. Esto es lo que
// faltaba.
//
// ── LA INVARIANTE, Y POR QUÉ ES LA ÚNICA RAZÓN DE QUE ESTO SIRVA ──
//     valor_salidas = valor_entradas + valor_costos
//
// Sin ella se podría meter una plancha de S/ 118 y sacar láminas por S/ 400, y
// el inventario diría que la empresa fabricó S/ 282 de la nada. Toda esta lib
// existe para que ese cierre sea exacto: los valores se redondean a 2 decimales
// y el residuo del reparto se asigna a la salida más grande, así la diferencia
// es 0 y no «0,003 que ya se va a acomodar».
//
// 🔴 UN SOLO CAMINO DE ESCRITURA: `construirTransformacion()`. La mig 216 tiene
// un CHECK sobre esa invariante y Dexie no valida CHECKs (regla 9 del
// CLAUDE.md): una fila armada a mano que no cierre se guardaría local y
// rebotaría en el push con 23514, dejando el sync en reintento eterno. Ninguna
// pantalla arma la fila por su cuenta.
//
// ── LOS COSTOS DE CONVERSIÓN NO SON UN EXTRA ─────────────────────
// Medido en producción el 15-set-2026: el trabajo de transformar YA ESTÁ
// FACTURADO como un ítem más.
//     GASOMI, FE01-1006: «CORTE GUILLOTINA EN PLANCHA 1/16"» 105 × S/ 1,2712
//     GASOMI, FE01-1123: el mismo corte, 4 und = S/ 6,78
//     JULCA SALAZAR CLAUDIA SOFIA: «SERVICIO DE CORTE» en 4 facturas = S/ 344,92
// Las láminas valen la plancha MÁS lo que costó cortarla. Sin `costos`, ese
// corte se perdería y el margen de la venta de las láminas saldría inflado en
// exactamente ese monto.
//
// ── LO QUE NO SE INVENTA ─────────────────────────────────────────
// El costo unitario de lo que entra se PROPONE desde las compras del propio
// insumo (promedio de lo comprado en esa unidad). Cuando no se puede —el
// insumo se compró en dos monedas, o en otra unidad, o no se compró nunca— se
// devuelve `null` y lo escribe una persona. Misma disciplina que
// `factorConocido()` de la tanda 5: un número inventado acá se aceptaría sin
// mirar, y un costo falso se propaga a todo lo que salga de esa plancha.
// ═══════════════════════════════════════════════════════════════════
import { normInsumo } from './insumo-correlacion.js';
import { normUnidad, labelUnidad } from './inventario-empresa.js';

/** Tolerancia del cierre, en unidades monetarias. Espejo del CHECK de la mig 216. */
export const TOLERANCIA_CIERRE = 0.05;

export const REPARTOS = ['cantidad', 'manual', 'mercado'];

export const REPARTO_INFO = {
  cantidad: {
    label: 'Por cantidad',
    ayuda: 'El valor se reparte proporcional a la cantidad de cada salida. Solo se puede cuando todas las salidas están en la misma unidad: repartir entre «10 kg» y «2 und» sería sumar peras con manzanas.',
  },
  manual: {
    label: 'A mano',
    ayuda: 'Vos escribís cuánto vale cada salida. Tienen que sumar exactamente lo que entró.',
  },
  mercado: {
    label: 'Por valor de venta',
    ayuda: 'El valor se reparte proporcional a lo que vale cada salida en el mercado. Es lo correcto cuando de una plancha salen piezas grandes y recortes: los recortes no valen lo mismo por kilo.',
  },
};

/** Dos decimales, siempre. El redondeo es parte de la invariante, no un detalle. */
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** La unidad de una línea, canónica. Vacía = 'und', igual que el inventario. */
export const unidadDeLinea = (u) => normUnidad(u) || 'und';

// ── 1. QUÉ VALE LO QUE ENTRA ──────────────────────────────────────
/**
 * El costo unitario que se le propone a quien carga la transformación, a partir
 * de las compras de ese insumo.
 *
 * @param ins      un insumo tal como lo devuelve `inventarioDeEmpresa`
 * @param unidad   la unidad en la que se va a consumir (canónica o cruda)
 * @returns { costo, moneda, cantidad, veces } | null
 *
 * Devuelve null —y NO un número aproximado— cuando:
 *   · el insumo se compró en más de una moneda (sumarlas sería inventar un TC),
 *   · no se compró nunca en esa unidad,
 *   · la cantidad comprada es 0.
 */
export function costoUnitarioSugerido(ins, unidad) {
  if (!ins || !ins.comprado) return null;
  const u = unidadDeLinea(unidad);
  const montos = ins.comprado.montos || [];
  if (montos.length !== 1) return null;          // 0 monedas, o más de una
  const cant = (ins.comprado.cantidades || []).find(c => c.unidad === u);
  if (!cant || !(cant.cantidad > 0)) return null;
  const monto = num(montos[0].monto);
  if (!(monto > 0)) return null;
  return {
    costo: monto / cant.cantidad,
    moneda: montos[0].moneda || 'PEN',
    cantidad: cant.cantidad,
    veces: ins.comprado.veces || 0,
  };
}

/**
 * Lo que queda de un insumo según el inventario, en la unidad pedida.
 * Se usa para AVISAR que se está transformando más de lo que hay — nunca para
 * bloquear: un saldo corto tiene tres causas reales y todas legítimas (la
 * compra está en otra empresa del grupo, está escrita con otro nombre y sin
 * mapear, o todavía no se cargó). Mismo criterio que el rojo de la tanda 9.
 */
export function disponibleDe(ins, unidad) {
  if (!ins) return null;
  const u = unidadDeLinea(unidad);
  const desdeSaldo = (ins.saldo || []).find(s => s.unidad === u);
  if (desdeSaldo) return num(desdeSaldo.cantidad);
  const comprado = (ins.comprado?.cantidades || []).find(c => c.unidad === u);
  return comprado ? num(comprado.cantidad) : null;
}

// ── 2. CÓMO SE REPARTE EL VALOR ENTRE LAS SALIDAS ─────────────────
/**
 * Reparte `total` entre las salidas según el criterio elegido.
 *
 * @returns { valores:[n], error:string|null }
 *   `valores` en el MISMO orden que las salidas, ya redondeados a 2 decimales
 *   y sumando exactamente `total`.
 *
 * 🔴 EL RESIDUO VA A LA SALIDA MÁS GRANDE, no a la última. Repartir S/ 100
 * entre 3 da 33,33 tres veces y sobra un centavo; ponerlo en la línea mayor lo
 * hace desaparecer dentro del ruido, ponerlo en «la última» lo deja pegado a
 * una fila que puede ser la más chica de todas y verse como un error de carga.
 */
export function repartirValor(total, salidas, reparto = 'cantidad') {
  const t = r2(total);
  const n = (salidas || []).length;
  if (!n) return { valores: [], error: 'Sin salidas no hay nada que repartir.' };

  if (reparto === 'manual') {
    return { valores: salidas.map(s => r2(s.valor)), error: null };
  }

  let pesos;
  if (reparto === 'mercado') {
    pesos = salidas.map(s => num(s.valorMercado));
    if (pesos.some(p => !(p > 0))) {
      return { valores: [], error: 'Para repartir por valor de venta hay que poner el valor de mercado de cada salida.' };
    }
  } else {
    // Por cantidad. Las unidades tienen que ser la MISMA: repartir entre 10 kg
    // y 2 und sería sumar dos magnitudes distintas y darle a cada una un peso
    // que no significa nada.
    const unidades = new Set(salidas.map(s => unidadDeLinea(s.unidad)));
    if (unidades.size > 1) {
      return {
        valores: [],
        error: `Las salidas están en ${unidades.size} unidades distintas (${[...unidades].map(labelUnidad).join(', ')}): no se pueden repartir por cantidad. Poné los valores a mano o usá el valor de venta.`,
      };
    }
    pesos = salidas.map(s => num(s.cantidad));
    if (pesos.some(p => !(p > 0))) {
      return { valores: [], error: 'Todas las salidas necesitan una cantidad mayor que cero.' };
    }
  }

  const suma = pesos.reduce((a, b) => a + b, 0);
  if (!(suma > 0)) return { valores: [], error: 'No hay con qué repartir: los pesos suman cero.' };

  const valores = pesos.map(p => r2((t * p) / suma));
  // El residuo del redondeo, a la línea más grande.
  const residuo = r2(t - valores.reduce((a, b) => a + b, 0));
  if (Math.abs(residuo) >= 0.005) {
    let iMax = 0;
    for (let i = 1; i < valores.length; i++) if (Math.abs(valores[i]) > Math.abs(valores[iMax])) iMax = i;
    valores[iMax] = r2(valores[iMax] + residuo);
  }
  return { valores, error: null };
}

// ── 3. EL ÚNICO CAMINO DE ESCRITURA ───────────────────────────────
const normLinea = (l) => ({
  nombre: String(l?.nombre || '').trim(),
  nombre_norm: normInsumo(l?.nombre || ''),
  cantidad: num(l?.cantidad),
  unidad: unidadDeLinea(l?.unidad),
  valor: r2(l?.valor),
  // El valor de mercado solo se guarda si alguien lo escribió: un 0 fabricado
  // por un input vacío se leería mañana como «esto no vale nada».
  ...(l?.valorMercado != null && l?.valorMercado !== '' ? { valor_mercado: r2(l.valorMercado) } : {}),
  ...(l?.movimientoId ? { movimiento_id: l.movimientoId } : {}),
  ...(l?.itemIdx != null ? { item_idx: Number(l.itemIdx) } : {}),
});

const normCosto = (c) => ({
  concepto: String(c?.concepto || '').trim(),
  monto: r2(c?.monto),
  ...(c?.movimientoId ? { movimiento_id: c.movimientoId } : {}),
});

/**
 * Arma la fila de `transformaciones` a partir de un borrador de pantalla.
 * Calcula los tres totales y reparte el valor: TODO sale de acá o no sale.
 *
 * @param b.entradas [{ nombre, cantidad, unidad, valor }]
 * @param b.costos   [{ concepto, monto, movimientoId }]
 * @param b.salidas  [{ nombre, cantidad, unidad, valor?, valorMercado? }]
 * @param b.reparto  'cantidad' | 'manual' | 'mercado'
 * @returns { fila, error }  — `fila` es null si el reparto no se pudo hacer.
 */
export function construirTransformacion(b = {}) {
  const entradas = (b.entradas || []).map(normLinea);
  const costos = (b.costos || []).filter(c => String(c?.concepto || '').trim() || num(c?.monto)).map(normCosto);
  const salidasCrudas = (b.salidas || []).map(normLinea);
  const reparto = REPARTOS.includes(b.reparto) ? b.reparto : 'cantidad';

  const valor_entradas = r2(entradas.reduce((a, l) => a + num(l.valor), 0));
  const valor_costos = r2(costos.reduce((a, c) => a + num(c.monto), 0));
  const aRepartir = r2(valor_entradas + valor_costos);

  const { valores, error } = repartirValor(aRepartir, (b.salidas || []).map((s, i) => ({
    ...s, unidad: salidasCrudas[i].unidad, cantidad: salidasCrudas[i].cantidad,
  })), reparto);
  if (error) return { fila: null, error };

  const salidas = salidasCrudas.map((s, i) => ({ ...s, valor: valores[i] }));
  const valor_salidas = r2(salidas.reduce((a, l) => a + num(l.valor), 0));

  return {
    fila: {
      company_id: b.companyId || null,
      fecha: b.fecha || '',
      descripcion: String(b.descripcion || '').trim(),
      moneda: b.moneda || 'PEN',
      entradas, costos, salidas,
      valor_entradas, valor_costos, valor_salidas,
      reparto,
      obra_id: b.obraId || null,
      estado: 'registrada',
      notas: String(b.notas || '').trim() || null,
    },
    error: null,
  };
}

// ── 4. QUÉ ESTÁ MAL, Y QUÉ SOLO HAY QUE MIRAR ─────────────────────
/**
 * @param b       el mismo borrador de `construirTransformacion`
 * @param opts.insumoPorNorm  Map(nombreNorm → insumo del inventario), para
 *        avisar cuando se transforma más de lo que hay y cuando la salida ya
 *        existe como insumo comprado.
 * @returns { errores:[string], avisos:[string], ok:boolean }
 *
 * Los ERRORES impiden guardar; los AVISOS no. La diferencia no es de gravedad:
 * un error es una fila que se contradice a sí misma (aritmética o estructura),
 * un aviso es algo que puede estar bien y decide la persona. Una regla que
 * grita cuando no debe se vuelve ruido y nadie la mira otra vez.
 */
export function validarTransformacion(b = {}, opts = {}) {
  const { insumoPorNorm = null } = opts;
  const errores = [];
  const avisos = [];

  const entradas = (b.entradas || []).map(normLinea);
  const salidas = (b.salidas || []).map(normLinea);
  const costos = (b.costos || []).filter(c => String(c?.concepto || '').trim() || num(c?.monto)).map(normCosto);

  if (!b.fecha) errores.push('Falta la fecha.');
  if (!b.companyId) errores.push('Falta la empresa.');

  if (!entradas.length) errores.push('Poné al menos un insumo que entra.');
  if (!salidas.length) errores.push('Poné al menos un insumo que sale.');

  const revisarLado = (lineas, lado) => {
    const vistos = new Set();
    lineas.forEach((l, i) => {
      const dónde = `${lado} ${i + 1}`;
      if (!l.nombre) errores.push(`${dónde}: falta el nombre del insumo.`);
      if (!(l.cantidad > 0)) errores.push(`${dónde}: la cantidad tiene que ser mayor que cero.`);
      if (l.nombre_norm) {
        if (vistos.has(l.nombre_norm)) {
          errores.push(`${dónde}: «${l.nombre}» está dos veces del mismo lado. Ponelo una sola vez con la cantidad total.`);
        }
        vistos.add(l.nombre_norm);
      }
    });
    return vistos;
  };
  const normsEntrada = revisarLado(entradas, 'Entrada');
  const normsSalida = revisarLado(salidas, 'Salida');

  // Un insumo que entra y sale es un ciclo: restaría y sumaría la misma fila
  // del inventario, y el saldo quedaría igual mientras el valor se mueve solo.
  for (const n of normsSalida) {
    if (normsEntrada.has(n)) {
      const nombre = salidas.find(s => s.nombre_norm === n)?.nombre || n;
      errores.push(`«${nombre}» entra y sale al mismo tiempo. Si lo que cambia es la presentación, eso es un factor de conversión (📏 Poner factor en Correlaciones), no una transformación.`);
    }
  }

  costos.forEach((c, i) => {
    if (!c.concepto) errores.push(`Costo ${i + 1}: falta el concepto.`);
    if (!(c.monto > 0)) errores.push(`Costo ${i + 1}: el monto tiene que ser mayor que cero.`);
  });

  entradas.forEach((l, i) => {
    if (l.valor < 0) errores.push(`Entrada ${i + 1}: el valor no puede ser negativo.`);
  });

  const valorEntradas = r2(entradas.reduce((a, l) => a + num(l.valor), 0));
  const valorCostos = r2(costos.reduce((a, c) => a + num(c.monto), 0));
  const aRepartir = r2(valorEntradas + valorCostos);

  if (!(aRepartir > 0)) {
    avisos.push('Todo entra con valor cero: lo que salga va a quedar con costo cero, y el margen de su venta va a salir inflado. Poné cuánto valía lo que se consumió.');
  }

  const reparto = REPARTOS.includes(b.reparto) ? b.reparto : 'cantidad';
  if (salidas.length) {
    const { valores, error } = repartirValor(aRepartir, (b.salidas || []).map((s, i) => ({
      ...s, unidad: salidas[i].unidad, cantidad: salidas[i].cantidad,
    })), reparto);
    if (error) {
      errores.push(error);
    } else if (reparto === 'manual') {
      const suma = r2(valores.reduce((a, v) => a + v, 0));
      const dif = r2(suma - aRepartir);
      if (Math.abs(dif) > TOLERANCIA_CIERRE) {
        errores.push(
          `Lo que sale (${suma.toFixed(2)}) no es igual a lo que entra (${aRepartir.toFixed(2)}): ` +
          `${dif > 0 ? 'sobran' : 'faltan'} ${Math.abs(dif).toFixed(2)}. La plata no se crea ni se destruye al cortar una plancha.`
        );
      }
    }
  }

  // ── Los avisos: cosas que pueden estar bien ─────────────────────
  if (insumoPorNorm) {
    for (const l of entradas) {
      const ins = insumoPorNorm.get(l.nombre_norm);
      if (!ins) {
        avisos.push(`«${l.nombre}» no figura en el inventario de esta empresa. Si la compra está cargada con otro nombre, unilos en Correlaciones para que el saldo cierre.`);
        continue;
      }
      const hay = disponibleDe(ins, l.unidad);
      if (hay != null && l.cantidad > hay + 0.0001) {
        avisos.push(`De «${l.nombre}» hay ${hay.toLocaleString('es-PE')} ${labelUnidad(l.unidad)} y se están transformando ${l.cantidad.toLocaleString('es-PE')}. Puede ser que la compra esté en otra empresa del grupo, escrita con otro nombre, o todavía sin cargar.`);
      }
    }
    for (const l of salidas) {
      const ins = insumoPorNorm.get(l.nombre_norm);
      if (ins && (ins.comprado?.veces || 0) > 0) {
        avisos.push(`«${l.nombre}» ya se compra: lo que salga de acá se va a sumar a esa misma fila del inventario.`);
      }
    }
  }

  return { errores, avisos, ok: errores.length === 0 };
}

// ── 5. QUÉ LE HACE AL INVENTARIO ──────────────────────────────────
const nuevoEfecto = () => ({
  consumido: new Map(),   // unidad → cantidad
  producido: new Map(),
  valorConsumido: 0,
  valorProducido: 0,
  vecesConsumido: 0,
  vecesProducido: 0,
  nombres: new Set(),
});

const cerrarCantidades = (m) => [...m.entries()]
  .map(([unidad, cantidad]) => ({ unidad, label: labelUnidad(unidad), cantidad: r2(cantidad) }))
  .sort((a, b) => b.cantidad - a.cantidad);

/**
 * El efecto de las transformaciones sobre el inventario, por insumo.
 *
 * 🔴 SE ARMA ACÁ Y SE LE PASA RESUELTO a `inventarioDeEmpresa`, igual que el
 * destino y el hecho de la tanda 6. `inventario-empresa.js` es la lib BASE —la
 * importan muchas pantallas— y no puede depender de esta capa: la tanda 6
 * probó en el reparto de chunks de dist/assets qué pasa cuando esa flecha va al
 * revés.
 *
 * @returns Map(nombreNorm → { consumido:[{unidad,label,cantidad}], producido:[...],
 *                             valorConsumido, valorProducido, veces... })
 */
export function efectoEnInventario(transformaciones, opts = {}) {
  const { companyId = null } = opts;
  const out = new Map();
  const tocar = (norm) => {
    if (!out.has(norm)) out.set(norm, nuevoEfecto());
    return out.get(norm);
  };

  for (const t of (transformaciones || [])) {
    if (!t || t.deleted_at) continue;
    if (t.estado === 'anulada') continue;
    if (companyId && t.company_id !== companyId) continue;
    for (const l of leerLineas(t.entradas)) {
      const norm = l.nombre_norm || normInsumo(l.nombre);
      if (!norm) continue;
      const e = tocar(norm);
      const u = unidadDeLinea(l.unidad);
      e.consumido.set(u, (e.consumido.get(u) || 0) + num(l.cantidad));
      e.valorConsumido += num(l.valor);
      e.vecesConsumido++;
      if (l.nombre) e.nombres.add(l.nombre);
    }
    for (const l of leerLineas(t.salidas)) {
      const norm = l.nombre_norm || normInsumo(l.nombre);
      if (!norm) continue;
      const e = tocar(norm);
      const u = unidadDeLinea(l.unidad);
      e.producido.set(u, (e.producido.get(u) || 0) + num(l.cantidad));
      e.valorProducido += num(l.valor);
      e.vecesProducido++;
      if (l.nombre) e.nombres.add(l.nombre);
    }
  }

  const fin = new Map();
  for (const [norm, e] of out) {
    fin.set(norm, {
      consumido: cerrarCantidades(e.consumido),
      producido: cerrarCantidades(e.producido),
      valorConsumido: r2(e.valorConsumido),
      valorProducido: r2(e.valorProducido),
      vecesConsumido: e.vecesConsumido,
      vecesProducido: e.vecesProducido,
      nombres: [...e.nombres],
    });
  }
  return fin;
}

/**
 * Las líneas de una transformación, venga el jsonb ya parseado (lo normal) o
 * como string (según de dónde salga la fila). Nunca tira: una fila ilegible
 * cuenta como vacía y no rompe la pantalla de al lado.
 */
export function leerLineas(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.filter(Boolean) : [];
    } catch { return []; }
  }
  return [];
}

/** Las transformaciones vivas de una empresa, de la más nueva a la más vieja. */
export function transformacionesDe(filas, companyId = null) {
  return (filas || [])
    .filter(t => t && !t.deleted_at && (!companyId || t.company_id === companyId))
    .slice()
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))
      || String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/** Los números de arriba de la lista: cuántas hay y cuánto valor movieron. */
export function resumenTransformaciones(filas, companyId = null) {
  let registradas = 0, anuladas = 0, valor = 0, costos = 0;
  const insumos = new Set();
  for (const t of transformacionesDe(filas, companyId)) {
    if (t.estado === 'anulada') { anuladas++; continue; }
    registradas++;
    // El total lo escribe siempre `construirTransformacion`; si por lo que sea
    // faltara, se suma de las líneas antes que mostrar un S/ 0 que parecería
    // «esta transformación no movió nada».
    valor += num(t.valor_salidas) || leerLineas(t.salidas).reduce((a, l) => a + num(l.valor), 0);
    costos += num(t.valor_costos) || leerLineas(t.costos).reduce((a, c) => a + num(c.monto), 0);
    for (const l of leerLineas(t.entradas)) insumos.add(l.nombre_norm || normInsumo(l.nombre));
    for (const l of leerLineas(t.salidas)) insumos.add(l.nombre_norm || normInsumo(l.nombre));
  }
  return { registradas, anuladas, valor: r2(valor), costos: r2(costos), insumos: insumos.size };
}

/** Una línea de texto que resume qué pasó, para la lista y para el log. */
export function resumirTransformacion(t) {
  const ent = leerLineas(t?.entradas);
  const sal = leerLineas(t?.salidas);
  const trozo = (ls) => ls.map(l => `${num(l.cantidad).toLocaleString('es-PE')} ${labelUnidad(unidadDeLinea(l.unidad))} ${l.nombre}`).join(' + ');
  return `${trozo(ent) || '—'} → ${trozo(sal) || '—'}`;
}
