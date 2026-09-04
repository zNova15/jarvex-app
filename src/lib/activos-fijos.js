// ═══════════════════════════════════════════════════════════════════
// JARVEX — REGISTRO DE ACTIVOS FIJOS (Formato SUNAT 7.1).
//
// Lo pidieron las contadoras y Gabriel dejó su Excel real de referencia
// (Modelos/6.1.- REGISTRO ACTIVOS_VALIDO.xls). Hoy lo llevan a mano, ejercicio
// por ejercicio, en una planilla suelta.
//
// LA REGLA QUE ORDENA TODO ESTE ARCHIVO: en el formato 7.1 hay 27 columnas,
// pero SOLO 14 son datos. Las otras 13 son ARITMÉTICA de esos 14, y guardarlas
// es la forma más barata de terminar con un registro que no cuadra consigo
// mismo. Acá se calculan; en la tabla no existen.
//
// LA FÓRMULA, VERIFICADA CONTRA LAS CUATRO FILAS DEL MODELO:
//
//     depreciación del ejercicio = valor histórico × tasa × meses de uso / 12
//
//   REMOLCADOR KENWORTH  70.002,85 × 20% × 3/12 = 3.500,14  → el Excel: 3.500
//   SCANIA R500          44.875,00 × 20% × 6/12 = 4.487,50  → el Excel: 4.488
//   LAPTOP HP            2.542,37 × 25% × 2/12 =   105,93  → el Excel:   106
//   EQUIPO GPS             423,73 × 25% × 6/12 =    52,97  → el Excel:    53
//
// Las cuatro dan. No es una fórmula deducida de un manual: es la que están
// usando, reproducida.
//
// EL TOPE QUE EL EXCEL NO TIENE: un bien no se puede depreciar por debajo de
// cero. En una planilla, seguir arrastrando la fórmula un año de más da un
// valor en libros negativo y nadie lo ve hasta el balance. Acá la
// depreciación del ejercicio se recorta a lo que queda por depreciar.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

// ── LAS CUENTAS DEL PCGE ───────────────────────────────────────────
// Las de la división 33 (Propiedad, planta y equipo). El modelo usa 33411
// (unidades de transporte), 33412, 33611 (equipos de procesamiento de datos) y
// 33691 (otros equipos).
export const CUENTAS_ACTIVO_FIJO = [
  { codigo: '331', label: 'Terrenos', tasaMax: 0 },
  { codigo: '332', label: 'Edificaciones', tasaMax: 5 },
  { codigo: '333', label: 'Maquinarias y equipos de explotación', tasaMax: 20 },
  { codigo: '33411', label: 'Unidades de transporte — vehículos motorizados', tasaMax: 20 },
  { codigo: '33412', label: 'Unidades de transporte — vehículos no motorizados', tasaMax: 20 },
  { codigo: '335', label: 'Muebles y enseres', tasaMax: 10 },
  { codigo: '33611', label: 'Equipos de procesamiento de datos', tasaMax: 25 },
  { codigo: '33621', label: 'Equipos de comunicación', tasaMax: 10 },
  { codigo: '33691', label: 'Otros equipos diversos', tasaMax: 10 },
  { codigo: '337', label: 'Herramientas y unidades de reemplazo', tasaMax: 10 },
];

export function cuentaInfo(codigo) {
  const c = String(codigo || '').trim();
  return CUENTAS_ACTIVO_FIJO.find(x => x.codigo === c)
    // Una cuenta con más dígitos (33711) cae en su prefijo: la tasa la manda
    // el rubro, no el nivel de detalle con que la contadora la escribió.
    || CUENTAS_ACTIVO_FIJO.slice().sort((a, b) => b.codigo.length - a.codigo.length)
        .find(x => c.startsWith(x.codigo))
    || null;
}

/**
 * La tasa que le corresponde a la cuenta según el Reglamento de la LIR.
 * Es una SUGERENCIA para el alta: la contadora puede depreciar más lento
 * (eso está permitido), nunca más rápido.
 */
export function tasaSugerida(cuentaContable) {
  return cuentaInfo(cuentaContable)?.tasaMax ?? 10;
}

/**
 * ¿La tasa cargada supera el máximo aceptado para esa cuenta?
 * Devuelve el mensaje, o null si está bien. Depreciar por encima del tope es
 * gasto no deducible: SUNAT lo repara, y en una planilla no lo avisa nadie.
 */
export function alertaTasa(a) {
  const info = cuentaInfo(a?.cuenta_contable);
  if (!info) return null;
  const pct = num(a?.porcentaje_depreciacion);
  if (pct > info.tasaMax) {
    return `${pct}% supera el máximo de ${info.tasaMax}% para ${info.label} — el exceso no es deducible`;
  }
  return null;
}

export const METODOS_DEPRECIACION = {
  linea_recta: 'Línea recta',
  unidades_produccion: 'Unidades de producción',
  otro: 'Otro',
};

export const ESTADOS_ACTIVO = {
  activo: 'Activo',
  retirado: 'Retirado / dado de baja',
  vendido: 'Vendido',
  totalmente_depreciado: 'Totalmente depreciado',
};

// ── LOS DERIVADOS ──────────────────────────────────────────────────

/** Valor histórico al 31.12 — columna «VALOR HISTÓRICO DEL ACTIVO FIJO». */
export function valorHistorico(a) {
  return round2(
    num(a?.saldo_inicial) + num(a?.adquisiciones) + num(a?.mejoras)
    - num(a?.retiros) + num(a?.otros_ajustes)
  );
}

/** Valor ajustado al 31.12 = histórico + ajuste por inflación. */
export function valorAjustado(a) {
  return round2(valorHistorico(a) + num(a?.ajuste_inflacion));
}

/**
 * Depreciación del ejercicio.
 *
 * Línea recta prorrateada por meses de uso, y TOPEADA por lo que queda por
 * depreciar: sin el tope, un bien ya agotado sigue generando gasto todos los
 * años y el valor en libros se va a negativo.
 *
 * Los métodos distintos de línea recta no se calculan solos: la contadora
 * carga el importe del ejercicio a mano en `deprec_ejercicio_manual` y eso
 * manda. Inventar una fórmula de unidades de producción sin los datos de
 * producción sería peor que no calcular nada.
 */
export function depreciacionEjercicio(a) {
  if (a?.deprec_ejercicio_manual !== undefined && a?.deprec_ejercicio_manual !== null && a?.deprec_ejercicio_manual !== '') {
    return round2(a.deprec_ejercicio_manual);
  }
  if ((a?.metodo_depreciacion || 'linea_recta') !== 'linea_recta') return 0;

  const base = valorHistorico(a);
  const meses = Math.max(0, Math.min(12, num(a?.meses_uso)));
  const bruta = round2(base * (num(a?.porcentaje_depreciacion) / 100) * (meses / 12));

  // Lo que todavía se puede depreciar de este bien.
  const yaDepreciado = num(a?.deprec_acum_anterior) - num(a?.deprec_retiros) + num(a?.deprec_otros_ajustes);
  const restante = round2(base - yaDepreciado);
  if (restante <= 0) return 0;
  return Math.min(bruta, restante);
}

/** Depreciación acumulada histórica al cierre del ejercicio. */
export function depreciacionAcumuladaHistorica(a) {
  return round2(
    num(a?.deprec_acum_anterior) + depreciacionEjercicio(a)
    - num(a?.deprec_retiros) + num(a?.deprec_otros_ajustes)
  );
}

/** Depreciación acumulada ajustada por inflación. */
export function depreciacionAcumuladaAjustada(a) {
  return round2(depreciacionAcumuladaHistorica(a) + num(a?.ajuste_inflacion_deprec));
}

/** Valor en libros = valor ajustado − depreciación acumulada ajustada. */
export function valorEnLibros(a) {
  return round2(valorAjustado(a) - depreciacionAcumuladaAjustada(a));
}

/** Todos los derivados de un activo, de una sola pasada. */
export function calcularActivo(a) {
  const vh = valorHistorico(a);
  const va = valorAjustado(a);
  const de = depreciacionEjercicio(a);
  const dah = depreciacionAcumuladaHistorica(a);
  const daa = depreciacionAcumuladaAjustada(a);
  return {
    valorHistorico: vh,
    valorAjustado: va,
    deprecEjercicio: de,
    deprecAcumHistorica: dah,
    deprecAcumAjustada: daa,
    valorLibros: round2(va - daa),
    // Cuánto de la vida del bien está consumido — el semáforo de la pantalla.
    pctDepreciado: vh > 0 ? round2((dah / vh) * 100) : 0,
    agotado: vh > 0 && dah >= vh,
  };
}

/**
 * Los meses de uso que le tocan a un bien en un ejercicio.
 *
 * Si empezó a usarse DENTRO del año, se prorratea desde ese mes (el modelo
 * tiene un bien con 3 meses y otro con 2, que es exactamente este caso). Si
 * venía de antes, son 12. Si todavía no empezó, 0 — un bien comprado en
 * diciembre y puesto en uso en enero no deprecia nada en el ejercicio de la
 * compra, y ése es un error clásico de la planilla a mano.
 */
export function mesesDeUsoEnEjercicio(fechaInicioUso, periodo) {
  if (!fechaInicioUso) return 12;
  const s = String(fechaInicioUso);
  const anio = Number(s.slice(0, 4));
  const mes = Number(s.slice(5, 7));
  if (!Number.isFinite(anio) || !Number.isFinite(mes) || mes < 1 || mes > 12) return 12;
  const p = Number(periodo);
  if (!Number.isFinite(p)) return 12;
  if (anio < p) return 12;
  if (anio > p) return 0;
  return 13 - mes;   // enero → 12, diciembre → 1
}

// ── TOTALES Y AGRUPACIONES ─────────────────────────────────────────

/** La fila TOTALES del formato. */
export function totales(activos) {
  const vivos = (activos || []).filter(a => a && !a.deleted_at);
  const acc = {
    filas: vivos.length,
    saldoInicial: 0, adquisiciones: 0, mejoras: 0, retiros: 0, otrosAjustes: 0,
    valorHistorico: 0, ajusteInflacion: 0, valorAjustado: 0,
    deprecAcumAnterior: 0, deprecEjercicio: 0, deprecRetiros: 0, deprecOtrosAjustes: 0,
    deprecAcumHistorica: 0, ajusteInflacionDeprec: 0, deprecAcumAjustada: 0,
    valorLibros: 0,
  };
  for (const a of vivos) {
    const c = calcularActivo(a);
    acc.saldoInicial += num(a.saldo_inicial);
    acc.adquisiciones += num(a.adquisiciones);
    acc.mejoras += num(a.mejoras);
    acc.retiros += num(a.retiros);
    acc.otrosAjustes += num(a.otros_ajustes);
    acc.valorHistorico += c.valorHistorico;
    acc.ajusteInflacion += num(a.ajuste_inflacion);
    acc.valorAjustado += c.valorAjustado;
    acc.deprecAcumAnterior += num(a.deprec_acum_anterior);
    acc.deprecEjercicio += c.deprecEjercicio;
    acc.deprecRetiros += num(a.deprec_retiros);
    acc.deprecOtrosAjustes += num(a.deprec_otros_ajustes);
    acc.deprecAcumHistorica += c.deprecAcumHistorica;
    acc.ajusteInflacionDeprec += num(a.ajuste_inflacion_deprec);
    acc.deprecAcumAjustada += c.deprecAcumAjustada;
    acc.valorLibros += c.valorLibros;
  }
  for (const k of Object.keys(acc)) if (k !== 'filas') acc[k] = round2(acc[k]);
  return acc;
}

/**
 * Agrupado por cuenta contable — así se presenta el formato 7.1: cada cuenta
 * con sus bienes y su subtotal, que es lo que después cuadra contra el mayor.
 */
export function porCuenta(activos) {
  const grupos = new Map();
  for (const a of (activos || []).filter(x => x && !x.deleted_at)) {
    const key = String(a.cuenta_contable || '(sin cuenta)');
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key).push(a);
  }
  return [...grupos.entries()]
    .sort((x, y) => x[0].localeCompare(y[0]))
    .map(([cuenta, items]) => ({
      cuenta,
      label: cuentaInfo(cuenta)?.label || 'Otros activos',
      items,
      totales: totales(items),
    }));
}

// ── VALIDACIÓN ─────────────────────────────────────────────────────

/**
 * Los errores que hacen que una fila NO sirva para presentar.
 * Devuelve una lista de mensajes; vacía = la fila está bien.
 */
export function validarActivo(a) {
  const errores = [];
  if (!a?.company_id) errores.push('Falta la empresa dueña del activo');
  if (!a?.cuenta_contable) errores.push('Falta la cuenta contable (PCGE 33x)');
  if (!String(a?.descripcion || '').trim()) errores.push('Falta la descripción del bien');
  if (!Number.isFinite(Number(a?.periodo))) errores.push('Falta el período (ejercicio)');
  if (valorHistorico(a) < 0) errores.push('El valor histórico da negativo — revisá retiros y ajustes');
  const pct = num(a?.porcentaje_depreciacion);
  if (pct < 0 || pct > 100) errores.push('El porcentaje de depreciación tiene que estar entre 0 y 100');
  const meses = num(a?.meses_uso);
  if (meses < 0 || meses > 12) errores.push('Los meses de uso tienen que estar entre 0 y 12');
  if (valorEnLibros(a) < -0.01) errores.push('El valor en libros da negativo — el bien ya está totalmente depreciado');
  return errores;
}

/** Las filas con problemas, para el aviso de la pantalla. */
export function activosConProblemas(activos) {
  return (activos || [])
    .filter(a => a && !a.deleted_at)
    .map(a => ({ activo: a, errores: validarActivo(a), aviso: alertaTasa(a) }))
    .filter(x => x.errores.length > 0 || x.aviso);
}

// ── EL PUENTE CON EL REGISTRO OPERATIVO ────────────────────────────

/**
 * Un borrador de activo fijo a partir de una fila de `activos_pesados`.
 *
 * Sirve para no tipear dos veces la misma excavadora. NO copia lo que el
 * registro operativo no sabe (la cuenta contable la elige la contadora), y
 * deja explícito lo que falta.
 */
export function desdeActivoPesado(ap, { periodo, companyId } = {}) {
  const anio = periodo || new Date().getFullYear();
  const cuenta = ap?.tipo === 'vehiculo' ? '33411' : '333';
  const costo = num(ap?.costo_adquisicion);
  return {
    company_id: ap?.company_id || companyId || null,
    periodo: anio,
    cuenta_contable: cuenta,
    descripcion: [ap?.nombre, ap?.marca, ap?.modelo].filter(Boolean).join(' — ') || ap?.nombre || '',
    marca: ap?.marca || null,
    modelo: ap?.modelo || null,
    serie_placa: ap?.placa || ap?.serie || null,
    saldo_inicial: costo,
    adquisiciones: 0, mejoras: 0, retiros: 0, otros_ajustes: 0, ajuste_inflacion: 0,
    fecha_adquisicion: ap?.fecha_adquisicion || null,
    fecha_inicio_uso: ap?.fecha_adquisicion || null,
    metodo_depreciacion: 'linea_recta',
    porcentaje_depreciacion: tasaSugerida(cuenta),
    meses_uso: mesesDeUsoEnEjercicio(ap?.fecha_adquisicion, anio),
    deprec_acum_anterior: num(ap?.depreciacion_acumulada),
    deprec_retiros: 0, deprec_otros_ajustes: 0, ajuste_inflacion_deprec: 0,
    estado: 'activo',
    activo_pesado_id: ap?.id || null,
    obra_id: ap?.obra_actual_id || ap?.obra_id || null,
  };
}

// ── LA EXPORTACIÓN AL FORMATO 7.1 ──────────────────────────────────

/** Los encabezados del formato, en el orden en que SUNAT los pide. */
export const COLUMNAS_FORMATO_71 = [
  'CÓDIGO RELACIONADO CON EL ACTIVO FIJO',
  'CUENTA CONTABLE DEL ACTIVO FIJO',
  'DESCRIPCIÓN',
  'MARCA DEL ACTIVO FIJO',
  'MODELO DEL ACTIVO FIJO',
  'NÚMERO DE SERIE Y/O PLACA DEL ACTIVO FIJO',
  'SALDO INICIAL',
  'ADQUISICIONES ADICIONES',
  'MEJORAS',
  'RETIROS Y/O BAJAS',
  'OTROS AJUSTES',
  'VALOR HISTÓRICO DEL ACTIVO FIJO AL 31.12',
  'AJUSTE POR INFLACIÓN',
  'VALOR AJUSTADO DEL ACTIVO FIJO AL 31.12',
  'FECHA DE ADQUISICIÓN',
  'FECHA DE INICIO DEL USO DEL ACTIVO FIJO',
  'MÉTODO APLICADO',
  'N° DE DOCUMENTO DE AUTORIZACIÓN',
  'PORCENTAJE DE DEPRECIACIÓN',
  'MESES USO',
  'DEPRECIACIÓN ACUMULADA AL CIERRE DEL EJERCICIO ANTERIOR',
  'DEPRECIACIÓN DEL EJERCICIO',
  'DEPRECIACIÓN DEL EJERCICIO RELACIONADA CON LOS RETIROS Y/O BAJAS',
  'DEPRECIACIÓN RELACIONADA CON OTROS AJUSTES',
  'DEPRECIACIÓN ACUMULADA HISTÓRICA',
  'AJUSTE POR INFLACIÓN DE LA DEPRECIACIÓN',
  'DEPRECIACIÓN ACUMULADA AJUSTADA POR INFLACIÓN',
  'VALOR EN LIBROS',
];

/** Una fila del formato 7.1 (los cálculos ya resueltos). */
export function filaFormato71(a) {
  const c = calcularActivo(a);
  return [
    a?.codigo_relacionado || '',
    a?.cuenta_contable || '',
    a?.descripcion || '',
    a?.marca || '',
    a?.modelo || '',
    a?.serie_placa || '',
    round2(a?.saldo_inicial),
    round2(a?.adquisiciones),
    round2(a?.mejoras),
    round2(a?.retiros),
    round2(a?.otros_ajustes),
    c.valorHistorico,
    round2(a?.ajuste_inflacion),
    c.valorAjustado,
    a?.fecha_adquisicion || '',
    a?.fecha_inicio_uso || '',
    METODOS_DEPRECIACION[a?.metodo_depreciacion] || 'Línea recta',
    a?.doc_autorizacion || '',
    `${round2(a?.porcentaje_depreciacion)}%`,
    Math.round(num(a?.meses_uso)),
    round2(a?.deprec_acum_anterior),
    c.deprecEjercicio,
    round2(a?.deprec_retiros),
    round2(a?.deprec_otros_ajustes),
    c.deprecAcumHistorica,
    round2(a?.ajuste_inflacion_deprec),
    c.deprecAcumAjustada,
    c.valorLibros,
  ];
}

/**
 * El cuerpo completo del formato: los bienes agrupados por cuenta, con el
 * subtotal de cada cuenta y la fila TOTALES al final — igual que el Excel que
 * llevan las contadoras.
 */
export function cuerpoFormato71(activos) {
  const filas = [];
  for (const g of porCuenta(activos)) {
    for (const a of g.items) filas.push(filaFormato71(a));
    const t = g.totales;
    filas.push([
      '', '', `SUBTOTAL ${g.cuenta} — ${g.label}`, '', '', '',
      t.saldoInicial, t.adquisiciones, t.mejoras, t.retiros, t.otrosAjustes,
      t.valorHistorico, t.ajusteInflacion, t.valorAjustado,
      '', '', '', '', '', '',
      t.deprecAcumAnterior, t.deprecEjercicio, t.deprecRetiros, t.deprecOtrosAjustes,
      t.deprecAcumHistorica, t.ajusteInflacionDeprec, t.deprecAcumAjustada, t.valorLibros,
    ]);
  }
  const t = totales(activos);
  filas.push([
    'TOTALES', '', '', '', '', '',
    t.saldoInicial, t.adquisiciones, t.mejoras, t.retiros, t.otrosAjustes,
    t.valorHistorico, t.ajusteInflacion, t.valorAjustado,
    '', '', '', '', '', '',
    t.deprecAcumAnterior, t.deprecEjercicio, t.deprecRetiros, t.deprecOtrosAjustes,
    t.deprecAcumHistorica, t.ajusteInflacionDeprec, t.deprecAcumAjustada, t.valorLibros,
  ]);
  return filas;
}

/**
 * El cierre del ejercicio: cada activo vivo se copia al año siguiente con la
 * depreciación acumulada de éste como punto de partida, el saldo inicial ya
 * consolidado y los movimientos del año en cero.
 *
 * Es lo que en la planilla se hace copiando la hoja y borrando columnas a
 * mano — que es donde se arrastran los errores de un año al otro.
 */
export function cerrarEjercicio(activos, { periodoNuevo } = {}) {
  const anio = periodoNuevo || (new Date().getFullYear());
  return (activos || [])
    .filter(a => a && !a.deleted_at && a.estado !== 'retirado' && a.estado !== 'vendido')
    .map(a => {
      const c = calcularActivo(a);
      return {
        ...a,
        id: undefined,
        periodo: anio,
        saldo_inicial: c.valorHistorico,
        adquisiciones: 0, mejoras: 0, retiros: 0, otros_ajustes: 0,
        ajuste_inflacion: 0,
        deprec_acum_anterior: c.deprecAcumHistorica,
        deprec_retiros: 0, deprec_otros_ajustes: 0, ajuste_inflacion_deprec: 0,
        // Un bien que ya venía de antes usa los 12 meses del año nuevo.
        meses_uso: 12,
        estado: c.agotado ? 'totalmente_depreciado' : (a.estado || 'activo'),
      };
    });
}

export default {
  CUENTAS_ACTIVO_FIJO, METODOS_DEPRECIACION, ESTADOS_ACTIVO, COLUMNAS_FORMATO_71,
  cuentaInfo, tasaSugerida, alertaTasa,
  valorHistorico, valorAjustado, depreciacionEjercicio,
  depreciacionAcumuladaHistorica, depreciacionAcumuladaAjustada, valorEnLibros,
  calcularActivo, mesesDeUsoEnEjercicio, totales, porCuenta,
  validarActivo, activosConProblemas, desdeActivoPesado,
  filaFormato71, cuerpoFormato71, cerrarEjercicio,
};
