// ═══════════════════════════════════════════════════════════════════
// LOS DOS LADOS DEL MISMO DINERO
//
// Un movimiento bancario se puede saber por dos caminos, y los dos son
// verdad a medias:
//
//   · EL BANCO lo sabe todo: cada línea del extracto, incluidas las que
//     nadie registró — la comisión de mantenimiento, el ITF, la
//     transferencia que se hizo desde el celular y no se anotó.
//   · JARVEX sabe el POR QUÉ: esta transferencia fue el pago de la factura
//     tal al proveedor tal, con su constancia adjunta. Pero solo de lo que
//     alguien se sentó a registrar.
//
// Conciliar es decir «esta línea del banco ES aquel pago». Este módulo hace
// tres cosas y ninguna toca la base: normaliza la entidad bancaria (para que
// «BCP», «bcp» y «Banco de Crédito» sean un solo banco al agrupar), arma el
// saldo corrido, y propone los cruces con un puntaje — porque el que concilia
// es el tesorero, no la app: acá se sugiere, allá se confirma.
//
// El saldo NUNCA se guarda: sale de saldo_inicial + Σ movimientos, igual que
// el stock de almacén sale de sus movimientos.
// ═══════════════════════════════════════════════════════════════════

// ── LA ENTIDAD BANCARIA ─────────────────────────────────────────────
// `banco` es texto libre a propósito (hay cajas municipales de todos lados).
// `banco_codigo` es con lo que se AGRUPA. Sin esto, el resumen por entidad
// mostraba el mismo banco tres veces según cómo lo hubieran tecleado.

// Sin tildes al comparar: «Crédito» y «Credito» son el mismo banco, y en la
// práctica se escriben de las dos formas (el nombre viene tecleado a mano).
const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const ALIAS_BANCO = [
  [/credito|^bcp\b/i,            'bcp'],
  [/bbva|continental/i,          'bbva'],
  [/interbank/i,                 'interbank'],
  [/scotia/i,                    'scotiabank'],
  [/naci[oó]n/i,                 'nacion'],
  [/banbif|interamericano/i,     'banbif'],
  [/pichincha/i,                 'pichincha'],
  [/mibanco/i,                   'mibanco'],
  [/comercio/i,                  'comercio'],
  [/gnb/i,                       'gnb'],
  [/falabella/i,                 'falabella'],
  [/ripley/i,                    'ripley'],
];

export const NOMBRE_BANCO = {
  bcp: 'BCP', bbva: 'BBVA', interbank: 'Interbank', scotiabank: 'Scotiabank',
  nacion: 'Banco de la Nación', banbif: 'BanBif', pichincha: 'Banco Pichincha',
  mibanco: 'Mibanco', comercio: 'Banco de Comercio', gnb: 'Banco GNB',
  falabella: 'Banco Falabella', ripley: 'Banco Ripley',
};

/** Código normalizado de la entidad bancaria. Nunca devuelve null si hay texto. */
export function normalizarBanco(texto) {
  const t = String(texto || '').trim();
  if (!t) return null;
  const plano = sinTildes(t);
  for (const [re, cod] of ALIAS_BANCO) if (re.test(plano)) return cod;
  // Caja municipal, financiera, cooperativa: sin alias conocido, el propio
  // nombre en minúsculas y con guiones bajos ES el código. Lo importante no es
  // acertarle al catálogo oficial, es que dos filas escritas igual agrupen.
  return sinTildes(t).toLowerCase().replace(/\s+/g, '_');
}

/** Etiqueta para mostrar: el alias conocido, o lo que escribió el usuario. */
export function etiquetaBanco(codigo, textoOriginal) {
  if (codigo && NOMBRE_BANCO[codigo]) return NOMBRE_BANCO[codigo];
  return String(textoOriginal || codigo || '').trim() || '—';
}

/** Cómo se llama una cuenta en una lista: alias si lo tiene, si no banco + últimos 4. */
export function nombreCuenta(cuenta) {
  if (!cuenta) return '—';
  if (cuenta.alias) return cuenta.alias;
  const banco = etiquetaBanco(cuenta.banco_codigo, cuenta.banco);
  const num = String(cuenta.numero_cuenta || '');
  const cola = num.length > 4 ? `···${num.slice(-4)}` : num;
  const tipo = cuenta.tipo === 'detracciones' ? ' detracciones' : '';
  return cola ? `${banco}${tipo} ${cola}` : `${banco}${tipo}`;
}

// ── EL SALDO ────────────────────────────────────────────────────────

const nMonto = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * Los movimientos de UNA cuenta en orden cronológico, cada uno con el saldo
 * que queda después de él. Empata por fecha usando created_at para que dos
 * movimientos del mismo día salgan siempre en el mismo orden (si no, el saldo
 * corrido bailaba entre renders).
 */
export function saldoCorrido(movimientos, saldoInicial = 0) {
  const orden = (movimientos || []).slice().sort((a, b) =>
    String(a.fecha || '').localeCompare(String(b.fecha || ''))
    || String(a.created_at || '').localeCompare(String(b.created_at || ''))
    || String(a.id || '').localeCompare(String(b.id || '')));
  let saldo = nMonto(saldoInicial);
  return orden.map(m => {
    saldo += nMonto(m.monto);
    return { ...m, saldo };
  });
}

/**
 * ¿El saldo que calculamos coincide con el que dice el banco?
 *
 * La última línea importada del extracto trae `saldo_extracto`: el saldo real
 * después de esa operación. Si no coincide con el calculado, falta un
 * movimiento (o sobra). Es el chequeo que convierte esta pantalla en algo
 * confiable en vez de una lista bonita.
 */
export function cuadreDeCuenta(movimientos, saldoInicial = 0) {
  const filas = saldoCorrido(movimientos, saldoInicial);
  const calculado = filas.length ? filas[filas.length - 1].saldo : nMonto(saldoInicial);
  // La referencia es la última línea del BANCO que trajo saldo, no la última
  // fila: un movimiento manual posterior no sabe nada del saldo real.
  let refBanco = null;
  for (const f of filas) if (f.saldo_extracto != null && f.origen === 'extracto') refBanco = f;
  if (!refBanco) return { calculado, banco: null, diferencia: null, cuadra: null, hasta: null };
  // Comparamos contra el saldo calculado HASTA esa línea, no contra el final.
  const idx = filas.findIndex(f => f.id === refBanco.id);
  const calcHasta = idx >= 0 ? filas[idx].saldo : calculado;
  const diferencia = Math.round((calcHasta - nMonto(refBanco.saldo_extracto)) * 100) / 100;
  return {
    calculado, banco: nMonto(refBanco.saldo_extracto), diferencia,
    cuadra: Math.abs(diferencia) < 0.01, hasta: refBanco.fecha,
  };
}

/** Totales de un conjunto de movimientos: lo que entró, lo que salió, el neto. */
export function totales(movimientos) {
  let entradas = 0, salidas = 0, sinConciliar = 0;
  for (const m of movimientos || []) {
    const v = nMonto(m.monto);
    if (v >= 0) entradas += v; else salidas += Math.abs(v);
    if (!m.conciliado) sinConciliar++;
  }
  return { entradas, salidas, neto: entradas - salidas, sinConciliar, total: (movimientos || []).length };
}

// ── AGRUPAR POR ENTIDAD ─────────────────────────────────────────────

/**
 * El árbol que pidió Gabriel: TITULAR (empresa propia o consorcio) › ENTIDAD
 * BANCARIA › cuentas, con el saldo de cada nivel.
 *
 * El titular es una fila de `companies`, y ahí está la gracia: CONSORCIO EL
 * INCA no es un caso especial, es una company con tipo_entidad='consorcio'.
 * Por eso una obra puede mirar «sus» movimientos sin que exista una cuenta
 * bancaria de obra: mira las de su ejecutora.
 */
export function agruparPorEntidad(cuentas, movimientos, companies) {
  const porCuenta = new Map();
  for (const m of movimientos || []) {
    if (!porCuenta.has(m.cuenta_id)) porCuenta.set(m.cuenta_id, []);
    porCuenta.get(m.cuenta_id).push(m);
  }
  const co = new Map((companies || []).map(c => [c.id, c]));
  const titulares = new Map();

  for (const c of cuentas || []) {
    const emp = co.get(c.company_id);
    const tid = c.company_id || 'sin-titular';
    if (!titulares.has(tid)) {
      titulares.set(tid, {
        id: tid,
        nombre: emp?.name || '(empresa eliminada)',
        tipo_entidad: emp?.tipo_entidad || null,
        ruc: emp?.ruc || null,
        bancos: new Map(), saldo: 0, cuentas: 0, sinConciliar: 0,
      });
    }
    const t = titulares.get(tid);
    const cod = c.banco_codigo || normalizarBanco(c.banco) || 'otro';
    if (!t.bancos.has(cod)) {
      t.bancos.set(cod, { codigo: cod, nombre: etiquetaBanco(cod, c.banco), cuentas: [], saldo: 0 });
    }
    const movs = porCuenta.get(c.id) || [];
    const tot = totales(movs);
    const saldo = nMonto(c.saldo_inicial) + movs.reduce((s, m) => s + nMonto(m.monto), 0);
    const b = t.bancos.get(cod);
    b.cuentas.push({ ...c, saldo, movimientos: movs.length, sinConciliar: tot.sinConciliar });
    b.saldo += saldo;
    t.saldo += saldo;
    t.cuentas++;
    t.sinConciliar += tot.sinConciliar;
  }

  return [...titulares.values()]
    .map(t => ({
      ...t,
      bancos: [...t.bancos.values()].sort((a, b) => a.nombre.localeCompare(b.nombre)),
    }))
    // Los consorcios primero: son los que ejecutan obra y los que Gabriel mira.
    .sort((a, b) =>
      (a.tipo_entidad === 'consorcio' ? 0 : 1) - (b.tipo_entidad === 'consorcio' ? 0 : 1)
      || a.nombre.localeCompare(b.nombre));
}

// ── EL LADO DE JARVEX: lo registrado que todavía no cuadró ──────────

/** Referencia comparable: solo dígitos, sin ceros a la izquierda. */
export function normalizarRef(ref) {
  const d = String(ref || '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 4 ? d : null;   // menos de 4 dígitos no identifica nada
}

const METODOS_BANCARIOS = new Set(['transferencia', 'deposito', 'cheque']);

/**
 * Lo que JARVEX sabe que pasó por el banco y todavía no está cruzado con
 * ninguna línea del extracto: constancias de pago y depósitos de
 * bancarización. Es la mitad izquierda de la pantalla de conciliación.
 *
 * `signo` es -1 en los pagos (sale plata) y sale de la clase en los depósitos:
 * una bancarización de compra es plata que sale, una de venta es plata que
 * entra (el tercero nos paga).
 */
export function pendientesDeJarvex({ partes = [], depositos = [], movimientos = [], cuentaId = null } = {}) {
  const yaCruzado = new Set();
  for (const m of movimientos) {
    if (m.deleted_at) continue;
    if (m.pago_parte_id) yaCruzado.add('pp:' + m.pago_parte_id);
    if (m.deposito_id) yaCruzado.add('dp:' + m.deposito_id);
  }
  const out = [];

  for (const p of partes) {
    if (p.deleted_at) continue;
    if (!METODOS_BANCARIOS.has(String(p.metodo || '').toLowerCase())) continue;  // efectivo no pasa por banco
    if (yaCruzado.has('pp:' + p.id)) continue;
    if (cuentaId && p.cuenta_id && p.cuenta_id !== cuentaId) continue;
    out.push({
      clase: 'pago_parte', id: p.id, fecha: p.fecha,
      monto: -Math.abs(nMonto(p.monto)),
      referencia: p.referencia || null, metodo: p.metodo || null,
      cuenta_id: p.cuenta_id || null,
      etiqueta: p.observaciones || 'Constancia de pago',
      obra_id: p.obra_id || null,
    });
  }

  for (const d of depositos) {
    if (d.deleted_at) continue;
    if (yaCruzado.has('dp:' + d.id)) continue;
    if (cuentaId && d.cuenta_id && d.cuenta_id !== cuentaId) continue;
    const entra = d.clase === 'venta';   // el tercero nos paga
    out.push({
      clase: 'deposito', id: d.id, fecha: d.fecha,
      monto: entra ? Math.abs(nMonto(d.monto_total)) : -Math.abs(nMonto(d.monto_total)),
      referencia: d.referencia || null, metodo: d.metodo || null,
      cuenta_id: d.cuenta_id || null,
      etiqueta: `Bancarización ${d.clase} · ${d.tercero_nombre || d.tercero_ruc || 'tercero'}`,
      obra_id: d.obra_id || null,
    });
  }

  return out.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
}

// ── EL CRUCE ────────────────────────────────────────────────────────

const diasEntre = (a, b) => {
  const da = Date.parse(String(a || '') + 'T00:00:00Z');
  const db = Date.parse(String(b || '') + 'T00:00:00Z');
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  return Math.abs(da - db) / 86400000;
};

/**
 * Puntaje de 0 a 100 de que esta línea del banco y este pendiente sean la
 * misma operación. El número de operación manda (es lo único que identifica
 * de verdad); el monto confirma; la fecha desempata.
 *
 * Lo que NO puntúa: la descripción. El banco escribe «TRANSF A TERCEROS» en
 * todo y compararla contra el nombre del proveedor da falsos positivos.
 */
export function puntajeCruce(linea, pend, { toleranciaDias = 5, toleranciaMonto = 0.05 } = {}) {
  // Signo distinto = no es la misma operación, aunque coincida todo lo demás.
  const sl = Math.sign(nMonto(linea.monto)), sp = Math.sign(nMonto(pend.monto));
  if (sl !== 0 && sp !== 0 && sl !== sp) return 0;

  const dif = Math.abs(Math.abs(nMonto(linea.monto)) - Math.abs(nMonto(pend.monto)));
  if (dif > toleranciaMonto) return 0;         // el monto es innegociable

  const d = diasEntre(linea.fecha, pend.fecha);
  if (d != null && d > toleranciaDias) return 0;

  let p = dif < 0.005 ? 45 : 30;               // monto exacto vs dentro del centavo
  const rl = normalizarRef(linea.referencia), rp = normalizarRef(pend.referencia);
  if (rl && rp && rl === rp) p += 45;
  else if (rl && rp) p -= 10;                  // los dos tienen n° y NO coinciden: sospechoso
  if (d != null) p += Math.round(15 * (1 - d / (toleranciaDias || 1)));
  if (pend.cuenta_id && linea.cuenta_id && pend.cuenta_id === linea.cuenta_id) p += 5;

  return Math.max(0, Math.min(100, p));
}

/**
 * Empareja las líneas del banco con lo registrado en JARVEX.
 *
 * Codicioso por puntaje: el mejor par se lleva sus dos filas y ninguna se
 * reutiliza — el servidor no admite una constancia conciliada dos veces (mig
 * 191), así que proponerlo sería mentirle al tesorero.
 *
 * Devuelve `seguros` (≥ 85: coincide el n° de operación y el monto — se pueden
 * confirmar de a montón) y `probables` (≥ umbral: pide mirar antes de aceptar).
 */
export function sugerirCruces(lineas, pendientes, opts = {}) {
  const { umbral = 55, seguroDesde = 85 } = opts;
  const cands = [];
  for (const l of lineas || []) {
    if (l.conciliado || l.deleted_at) continue;
    for (const p of pendientes || []) {
      const score = puntajeCruce(l, p, opts);
      if (score >= umbral) cands.push({ linea: l, pendiente: p, score });
    }
  }
  cands.sort((a, b) => b.score - a.score
    || String(a.linea.fecha || '').localeCompare(String(b.linea.fecha || '')));

  // EMPATES. Los datos reales de producción lo obligan: las 13 constancias
  // bancarias cargadas hasta hoy NO tienen n° de operación (la columna está
  // vacía en las 13), y encima hay montos repetidos —1.500 y 1.500 el mismo
  // 6-abr, 7.005 y 7.005 el 7-ago, 35.032,20 dos días seguidos—. Sin número,
  // dos constancias gemelas puntúan EXACTAMENTE igual contra la misma línea
  // del banco, y elegir por orden de lista sería inventar una certeza que no
  // hay: el saldo daría bien y la trazabilidad quedaría mal, que es la peor
  // de las dos combinaciones porque no se nota.
  const empatesPorLinea = new Map();
  for (const c of cands) {
    const cur = empatesPorLinea.get(c.linea.id);
    if (!cur || c.score > cur.mejor) empatesPorLinea.set(c.linea.id, { mejor: c.score, cuantos: 1 });
    else if (c.score === cur.mejor) cur.cuantos++;
  }

  const usadasL = new Set(), usadosP = new Set(), pares = [];
  for (const c of cands) {
    const kp = c.pendiente.clase + ':' + c.pendiente.id;
    if (usadasL.has(c.linea.id) || usadosP.has(kp)) continue;
    usadasL.add(c.linea.id); usadosP.add(kp);
    const e = empatesPorLinea.get(c.linea.id);
    pares.push({ ...c, ambiguo: !!e && e.cuantos > 1, candidatos: e ? e.cuantos : 1 });
  }

  return {
    // Un cruce ambiguo NUNCA es seguro, por alto que puntúe: hay otro
    // candidato idéntico y la app no puede saber cuál es.
    seguros: pares.filter(p => p.score >= seguroDesde && !p.ambiguo),
    probables: pares.filter(p => p.score < seguroDesde || p.ambiguo),
    // Lo que quedó suelto de cada lado: son las dos preguntas que importan —
    // «¿qué movió el banco que nadie registró?» y «¿qué registramos que el
    // banco no muestra?».
    soloBanco: (lineas || []).filter(l => !l.conciliado && !l.deleted_at && !usadasL.has(l.id)),
    soloJarvex: (pendientes || []).filter(p => !usadosP.has(p.clase + ':' + p.id)),
  };
}

// ── IMPORTAR EL EXTRACTO ────────────────────────────────────────────

/**
 * Huella de una línea del extracto. Reimportar el mismo archivo (o el del mes
 * siguiente, que repite las últimas filas) no puede duplicar movimientos: el
 * índice único de la mig 191 lo rechaza, y acá lo detectamos antes de intentar.
 */
export function huellaLinea({ fecha, monto, referencia, descripcion }) {
  const m = nMonto(monto).toFixed(2);
  const r = normalizarRef(referencia) || '';
  const d = String(descripcion || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60);
  return `${String(fecha || '')}|${m}|${r}|${r ? '' : d}`;
}

// El ORDEN importa: se resuelve de la cabecera más específica a la más
// genérica, y una columna ya asignada no se vuelve a ofrecer. Sin eso,
// «Fecha Operación» se la llevaba `descripcion` (termina en "Operación") y el
// extracto entero quedaba sin fecha.
const CAB = [
  ['fecha',       [/fecha.*oper/i, /fecha.*proc/i, /^fecha/i, /^date$/i, /^d[ií]a$/i]],
  ['referencia',  [/n[°ºo]?\.?\s*oper/i, /nro.*oper/i, /num.*oper/i, /referen/i, /^ref/i, /n[°ºo]?\.?\s*doc/i, /^c[oó]digo/i]],
  ['descripcion', [/descrip/i, /concepto/i, /detalle/i, /glosa/i, /^operaci[oó]n$/i]],
  ['cargo',       [/cargo/i, /d[eé]bito/i, /salida/i, /retiro/i]],
  ['abono',       [/abono/i, /cr[eé]dito/i, /entrada/i, /dep[oó]sito/i]],
  ['monto',       [/^monto/i, /^importe/i, /^valor/i]],
  ['saldo',       [/saldo/i, /balance/i]],
];

/** Adivina qué columna del Excel del banco es cuál. Cada banco los llama distinto. */
export function detectarColumnas(headers) {
  const map = {};
  const tomadas = new Set();
  for (const [campo, patrones] of CAB) {
    const h = (headers || []).find(x =>
      !tomadas.has(x) && patrones.some(re => re.test(sinTildes(String(x || '')).trim())));
    if (h) { map[campo] = h; tomadas.add(h); }
  }
  return map;
}

const aNumero = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  // «1,234.56» y «1.234,56» conviven según de dónde salga el archivo.
  let s = String(v).trim().replace(/[^\d.,\-()]/g, '');
  const neg = /^\(.*\)$/.test(s);             // contabilidad: (1,200.00) es negativo
  s = s.replace(/[()]/g, '');
  const ultimaComa = s.lastIndexOf(','), ultimoPunto = s.lastIndexOf('.');
  if (ultimaComa > ultimoPunto) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
};

const aFecha = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);   // dd/mm/aaaa (Perú)
  if (m) {
    const [, d, mo, y] = m;
    const yy = y.length === 2 ? (Number(y) > 70 ? '19' + y : '20' + y) : y;
    return `${yy}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};

/**
 * Convierte las filas crudas del Excel del banco en movimientos listos para
 * guardar. Dos formatos: una columna `monto` con signo, o dos columnas
 * separadas (cargo/abono) — que es lo que dan casi todos los bancos de acá.
 *
 * No inventa: la fila sin fecha o sin monto se devuelve en `descartadas` con
 * el motivo, para que la pantalla lo muestre en vez de tragárselo.
 */
export function parsearExtracto(rows, columnas) {
  const cols = columnas || detectarColumnas(rows?.length ? Object.keys(rows[0]) : []);
  const lineas = [], descartadas = [];

  (rows || []).forEach((r, i) => {
    const fecha = aFecha(r[cols.fecha]);
    let monto = null;
    if (cols.monto != null && r[cols.monto] != null && r[cols.monto] !== '') {
      monto = aNumero(r[cols.monto]);
    } else {
      const cargo = cols.cargo ? aNumero(r[cols.cargo]) : null;
      const abono = cols.abono ? aNumero(r[cols.abono]) : null;
      if (cargo != null && cargo !== 0) monto = -Math.abs(cargo);
      else if (abono != null && abono !== 0) monto = Math.abs(abono);
    }
    if (!fecha)               { descartadas.push({ fila: i + 2, motivo: 'sin fecha reconocible', datos: r }); return; }
    if (monto == null || monto === 0) { descartadas.push({ fila: i + 2, motivo: 'sin monto', datos: r }); return; }

    const descripcion = cols.descripcion ? String(r[cols.descripcion] ?? '').trim() : '';
    const referencia  = cols.referencia  ? String(r[cols.referencia]  ?? '').trim() : '';
    const saldo       = cols.saldo ? aNumero(r[cols.saldo]) : null;

    lineas.push({
      fecha, monto, descripcion: descripcion || null, referencia: referencia || null,
      saldo_extracto: saldo, tipo: tipoDesde(monto, descripcion),
      import_hash: huellaLinea({ fecha, monto, referencia, descripcion }),
    });
  });

  // Duplicados DENTRO del mismo archivo (pasa cuando se pega dos veces el mes).
  const vistos = new Set(); const unicas = [];
  for (const l of lineas) {
    if (vistos.has(l.import_hash)) { descartadas.push({ fila: null, motivo: 'repetida en el archivo', datos: l }); continue; }
    vistos.add(l.import_hash); unicas.push(l);
  }
  return { lineas: unicas, descartadas, columnas: cols };
}

/** Tipo del movimiento a partir del signo y de lo que escribe el banco. */
export function tipoDesde(monto, descripcion) {
  const d = String(descripcion || '').toLowerCase();
  if (/comisi[oó]n|mantenimiento|portes|itf/.test(d)) return 'comision';
  if (/inter[eé]s/.test(d)) return 'interes';
  if (/transf/.test(d)) return nMonto(monto) >= 0 ? 'transferencia_in' : 'transferencia_out';
  if (/dep[oó]sito|abono/.test(d)) return 'deposito';
  if (/retiro|cargo/.test(d)) return 'retiro';
  return nMonto(monto) >= 0 ? 'deposito' : 'retiro';
}
