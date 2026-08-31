// ═══════════════════════════════════════════════════════════════════
// JARVEX — Detalle POR EMPRESA: resumen financiero + inventario comprado
// (punto 5 del pedido de las contadoras, sep-2026). Lib PURA (sin Dexie/DOM).
//
// Responde, para UNA empresa del grupo: cuánto movió (con el criterio EXACTO
// del Consolidado) y QUÉ compró — insumo por insumo, con cantidades, gasto,
// proveedores y las facturas detrás — y, cuando la empresa además revende,
// cuánto de ese insumo volvió a salir por venta.
//
// Reglas que NO se rompen (son la diferencia entre un número útil y una mentira):
//  · Las CANTIDADES nunca se suman entre unidades distintas (bolsas ≠ kg). Sí se
//    unifican los SINÓNIMOS de la misma unidad ("und"/"unidad"/"each"), porque el
//    OCR de cada factura los escribe distinto. El galón inglés (4.55 L) queda
//    SEPARADO del americano (3.79 L): son volúmenes distintos.
//  · La PLATA nunca se suma entre monedas (PEN y USD van por separado).
//  · Notas de crédito/débito NO entran en los totales (restan, no suman): se
//    cuentan aparte para avisarlo.
//  · Movimientos anulados (payment_status 'cancelled') fuera, igual que el
//    Consolidado.
//  · Esto es inventario COMPRADO según facturas, NO stock: los consumos de obra
//    viven en almacén por obra. La UI tiene que decirlo.
// ═══════════════════════════════════════════════════════════════════
import { claveGrupoDe, normInsumo } from './insumo-correlacion.js';

// ── Unidades ─────────────────────────────────────────────────────────
// El OCR copia la unidad tal cual sale del comprobante: en producción conviven
// "unidad" (1249 líneas) y "und" (841) para lo MISMO, más los códigos SUNAT en
// inglés ("each", "theoretical pound", "dozen piece"). Sin esta tabla el mismo
// insumo se parte en dos filas que nadie puede sumar mentalmente.
const normTxtUnidad = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const SINONIMOS_UNIDAD = {
  und: ['und', 'unid', 'unidad', 'unidades', 'u', 'each', 'pieza', 'piezas', 'pza', 'pzas', 'pieces', 'piece'],
  kg: ['kg', 'kgs', 'kilogramo', 'kilogramos', 'kilo', 'kilos'],
  g: ['g', 'gr', 'gramo', 'gramos'],
  lb: ['lb', 'lbs', 'libra', 'libras', 'pound', 'pounds', 'theoretical pound'],
  t: ['t', 'tn', 'ton', 'tonelada', 'toneladas'],
  m: ['m', 'ml', 'metro', 'metros', 'metro lineal'],
  m2: ['m2', 'metro cuadrado', 'metros cuadrados'],
  m3: ['m3', 'metro cubico', 'metros cubicos'],
  l: ['l', 'lt', 'lts', 'litro', 'litros'],
  gal: ['gal', 'gln', 'galon', 'galones', 'gallon', 'us galon', 'us gallon'],
  'gal-uk': ['galon ingles', 'gal uk', 'imperial gallon', 'gross gallon'],
  par: ['par', 'pares'],
  caja: ['caja', 'cajas', 'cja', 'box'],
  paquete: ['paquete', 'paquetes', 'pqt', 'pack'],
  bolsa: ['bolsa', 'bolsas', 'bls', 'bag'],
  balde: ['balde', 'baldes'],
  cilindro: ['cilindro', 'cilindros'],
  botella: ['botella', 'botellas'],
  rollo: ['rollo', 'rollos', 'rll', 'roll', 'rolls'],
  docena: ['docena', 'docenas', 'doc', 'dozen', 'dozen piece'],
  ciento: ['ciento', 'cientos', 'cto', 'ciento de unidades'],
  millar: ['millar', 'millares', 'mll', 'mill'],
  juego: ['juego', 'juegos', 'jgo', 'set', 'sets', 'kit', 'kits'],
};

const MAPA_UNIDAD = new Map();
for (const [codigo, alias] of Object.entries(SINONIMOS_UNIDAD)) {
  for (const a of alias) MAPA_UNIDAD.set(a, codigo);
}

// Reglas por si el comprobante trae la unidad con paréntesis o texto extra
// ("US GALON (3,7843 L)"). El orden importa: el galón inglés se reconoce ANTES
// que el genérico para no fusionar dos volúmenes distintos.
const REGLAS_UNIDAD = [
  [/gal/, /(uk|ingl|imperial|gross)/, 'gal-uk'],
  [/gal/, null, 'gal'],
  [/kilogram|kilo\b/, null, 'kg'],
  [/litro|liter/, null, 'l'],
  [/docena|dozen/, null, 'docena'],
  [/millar/, null, 'millar'],
  [/ciento/, null, 'ciento'],
];

/** Unidad canónica de una unidad escrita por el OCR. '' si viene vacía. */
export function normUnidad(u) {
  const n = normTxtUnidad(u);
  if (!n) return '';
  const directo = MAPA_UNIDAD.get(n);
  if (directo) return directo;
  for (const [re, extra, codigo] of REGLAS_UNIDAD) {
    if (re.test(n) && (!extra || extra.test(n))) return codigo;
  }
  return n;
}

const LABEL_UNIDAD = {
  und: 'und', kg: 'kg', g: 'g', lb: 'lb', t: 't', m: 'm', m2: 'm²', m3: 'm³',
  l: 'L', gal: 'gal', 'gal-uk': 'gal (UK)', par: 'par', caja: 'caja',
  paquete: 'paquete', bolsa: 'bolsa', balde: 'balde', cilindro: 'cilindro',
  botella: 'botella', rollo: 'rollo', docena: 'docena', ciento: 'ciento',
  millar: 'millar', juego: 'juego',
};

/** Etiqueta legible de una unidad canónica (la propia clave si no se conoce). */
export const labelUnidad = (codigo) => LABEL_UNIDAD[codigo] || codigo || 'und';

// ── Resumen financiero de UNA empresa ────────────────────────────────
// Criterio EXACTO de ConsolidadoPage: una moneda a la vez y sin movimientos
// anulados. Se separa lo INTERCO (facturación entre empresas del grupo) porque
// para el grupo no es plata nueva — el mismo corte que hace el Consolidado.
export function resumenFinancieroEmpresa(movs, opts = {}) {
  const { companyId = null, moneda = 'PEN', demo = false } = opts;
  const cero = () => ({ ingresos: 0, costos: 0, gastos: 0 });
  const total = cero(), externo = cero(), interco = { ingresos: 0, costos: 0 };
  let nMovs = 0, sinItems = 0, cancelados = 0, notas = 0;
  const otrasMonedas = new Map();

  for (const m of (movs || [])) {
    if (!m || m.deleted_at) continue;
    if (!!m.demo !== !!demo) continue;
    if (companyId && m.company_id !== companyId) continue;
    if (m.payment_status === 'cancelled') { cancelados++; continue; }
    const cur = m.currency || 'PEN';
    if (cur !== moneda) { otrasMonedas.set(cur, (otrasMonedas.get(cur) || 0) + 1); continue; }

    nMovs++;
    if (!String(m.notas || '').includes('items_factura')) sinItems++;
    if (['nota_credito', 'nota_debito'].includes(m.document_type)) notas++;

    const a = Number(m.amount || 0);
    const bucket = m.type === 'income' ? 'ingresos' : m.type === 'expense' ? 'gastos' : 'costos';
    total[bucket] += a;
    if (m.is_intercompany) {
      // Un movimiento interno nunca debería ser 'expense' (clasificacion-contable
      // lo fuerza a 'cost'); si una fila vieja quedó así se elimina igual, como
      // en el Consolidado, para no dejarla contada de un solo lado.
      if (m.type === 'income') interco.ingresos += a; else interco.costos += a;
    } else {
      externo[bucket] += a;
    }
  }

  const conUtilidad = (x) => {
    const utilidad = x.ingresos - x.costos - x.gastos;
    return { ...x, utilidad, margen: x.ingresos > 0 ? (utilidad / x.ingresos) * 100 : 0 };
  };

  return {
    moneda,
    total: conUtilidad(total),
    externo: conUtilidad(externo),
    interco,
    nMovs, sinItems, cancelados, notas,
    otrasMonedas: [...otrasMonedas.entries()]
      .map(([m2, n]) => ({ moneda: m2, movs: n }))
      .sort((x, y) => y.movs - x.movs),
  };
}

// ── Inventario comprado (y revendido) por insumo ─────────────────────
const nuevoLado = () => ({
  veces: 0, interco: 0,
  porUnidad: new Map(),      // unidad canónica → cantidad
  porMoneda: new Map(),      // moneda → monto
  proveedores: new Map(),    // clave → {id, nombre, veces}
  ultimaFecha: '', ultimoPrecio: null, ultimaMoneda: null, ultimoProveedor: null,
});

const acumular = (lado, l) => {
  lado.veces++;
  if (l.interco) lado.interco++;
  const u = normUnidad(l.unidad) || 'und';
  lado.porUnidad.set(u, (lado.porUnidad.get(u) || 0) + l.cantidad);
  const monto = l.precio * l.cantidad;
  if (monto) lado.porMoneda.set(l.moneda, (lado.porMoneda.get(l.moneda) || 0) + monto);
  const pk = l.proveedorId || `s/n:${l.proveedorNombre || '¿?'}`;
  if (!lado.proveedores.has(pk)) {
    lado.proveedores.set(pk, { id: l.proveedorId, nombre: l.proveedorNombre || '(sin nombre)', veces: 0 });
  }
  lado.proveedores.get(pk).veces++;
  if (l.fecha >= lado.ultimaFecha) {
    lado.ultimaFecha = l.fecha;
    lado.ultimoPrecio = l.precio || lado.ultimoPrecio;
    lado.ultimaMoneda = l.moneda;
    lado.ultimoProveedor = l.proveedorNombre || null;
  }
};

const cerrarLado = (lado) => ({
  veces: lado.veces,
  interco: lado.interco,
  cantidades: [...lado.porUnidad.entries()]
    .map(([unidad, cantidad]) => ({ unidad, label: labelUnidad(unidad), cantidad }))
    .sort((a, b) => b.cantidad - a.cantidad),
  montos: [...lado.porMoneda.entries()]
    .map(([moneda, monto]) => ({ moneda, monto }))
    .sort((a, b) => b.monto - a.monto),
  proveedores: [...lado.proveedores.values()].sort((a, b) => b.veces - a.veces),
  ultimaFecha: lado.ultimaFecha,
  ultimoPrecio: lado.ultimoPrecio,
  ultimaMoneda: lado.ultimaMoneda,
  ultimoProveedor: lado.ultimoProveedor,
});

/**
 * Inventario de una empresa a partir de las líneas de factura ya extraídas
 * (extraerLineasDeFacturas de analisis-insumos.js).
 *
 * @param lineas  líneas crudas (de todas las empresas o ya filtradas)
 * @param opts.companyId  filtra a esa empresa (si se omite, toma todo lo dado)
 * @param opts.grupoDe    Map(nombreNorm → gid) de las correlaciones confirmadas
 * @param opts.grupos     Map(gid → {canonico}) para el nombre a mostrar
 * @returns { insumos:[...], totales:{...} }
 */
export function inventarioDeEmpresa(lineas, opts = {}) {
  const { companyId = null, grupoDe = null, grupos = null } = opts;
  const porInsumo = new Map();
  const totales = {
    insumos: 0, lineasCompra: 0, lineasVenta: 0, lineasSinPrecio: 0,
    lineasNota: 0, gastos: new Map(), ingresos: new Map(),
  };

  for (const l of (lineas || [])) {
    if (!l) continue;
    if (companyId && l.companyId !== companyId) continue;
    if (l.cancelado) continue;
    if (l.esNota) { totales.lineasNota++; continue; }

    const clave = claveGrupoDe(l.nombre, grupoDe);
    if (!porInsumo.has(clave)) {
      const g = grupos && grupos.get(clave);
      porInsumo.set(clave, {
        clave,
        display: (g && g.canonico) || l.nombre,
        variantes: new Set(),
        tipos: new Set(),
        _compra: nuevoLado(),
        _venta: nuevoLado(),
        recepcion: { conDato: 0, recibido: 0 },
        lineas: [],
      });
    }
    const ins = porInsumo.get(clave);
    ins.variantes.add(l.nombre);
    if (l.tipoInsumo) ins.tipos.add(l.tipoInsumo);
    ins.lineas.push(l);
    if (l.precio <= 0) totales.lineasSinPrecio++;

    if (l.clase === 'venta') {
      totales.lineasVenta++;
      acumular(ins._venta, l);
      const monto = l.precio * l.cantidad;
      if (monto) totales.ingresos.set(l.moneda, (totales.ingresos.get(l.moneda) || 0) + monto);
    } else {
      totales.lineasCompra++;
      acumular(ins._compra, l);
      const monto = l.precio * l.cantidad;
      if (monto) totales.gastos.set(l.moneda, (totales.gastos.get(l.moneda) || 0) + monto);
      // La recepción de almacén se escribe sobre el ítem de la factura de
      // COMPRA (cruce-recepcion.js). En producción casi nadie la usa todavía:
      // por eso se informa "cuántas líneas tienen el dato", no un 0 que
      // parecería "no llegó nada".
      if (l.tieneRecepcion) {
        ins.recepcion.conDato++;
        ins.recepcion.recibido += l.recibido;
      }
    }
  }

  const insumos = [...porInsumo.values()].map(ins => {
    const compra = cerrarLado(ins._compra);
    const venta = cerrarLado(ins._venta);
    // Saldo = comprado − vendido, SOLO si la empresa además vendió ese insumo
    // (sin ventas el "saldo" sería la columna comprado repetida, y encima daría
    // a entender que eso es stock disponible — no lo es: falta el consumo de obra).
    const saldo = venta.veces === 0 ? [] : compra.cantidades.map(c => {
      const v = venta.cantidades.find(x => x.unidad === c.unidad);
      return { unidad: c.unidad, label: c.label, cantidad: c.cantidad - (v ? v.cantidad : 0) };
    });
    return {
      clave: ins.clave,
      display: ins.display,
      variantes: [...ins.variantes].sort(),
      tipos: [...ins.tipos].sort(),
      comprado: compra,
      vendido: venta,
      saldo,
      recepcion: ins.recepcion,
      lineas: ins.lineas.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)),
      // Solo para ORDENAR: el mayor gasto en UNA moneda (no se suman monedas).
      orden: Math.max(0, ...compra.montos.map(m => m.monto)),
    };
  }).sort((a, b) => (b.orden - a.orden) || (b.comprado.veces - a.comprado.veces));

  totales.insumos = insumos.length;
  return {
    insumos,
    totales: {
      ...totales,
      gastos: [...totales.gastos.entries()].map(([moneda, monto]) => ({ moneda, monto })).sort((a, b) => b.monto - a.monto),
      ingresos: [...totales.ingresos.entries()].map(([moneda, monto]) => ({ moneda, monto })).sort((a, b) => b.monto - a.monto),
    },
  };
}

/** Filtro de texto sobre el inventario (busca en el nombre y en las variantes). */
export function filtrarInventario(insumos, texto) {
  const toks = normTxtUnidad(texto).split(' ').filter(Boolean);
  if (!toks.length) return insumos || [];
  return (insumos || []).filter(ins => {
    const heno = normTxtUnidad([ins.display, ...ins.variantes].join(' '));
    return toks.every(t => heno.includes(t));
  });
}
