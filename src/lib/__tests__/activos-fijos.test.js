import { describe, it, expect } from 'vitest';
import {
  cuentaInfo, tasaSugerida, alertaTasa,
  valorHistorico, valorAjustado, depreciacionEjercicio,
  depreciacionAcumuladaHistorica, depreciacionAcumuladaAjustada, valorEnLibros,
  calcularActivo, mesesDeUsoEnEjercicio, totales, porCuenta,
  validarActivo, activosConProblemas, desdeActivoPesado,
  filaFormato71, cuerpoFormato71, cerrarEjercicio,
  COLUMNAS_FORMATO_71,
} from '../activos-fijos.js';

// ── LAS CUATRO FILAS REALES del Excel que dejó Gabriel ──────────────
// Modelos/6.1.- REGISTRO ACTIVOS_VALIDO.xls, hoja «ACTIVOS 2022», período 2025.
const base = (o) => ({
  company_id: 'c1', periodo: 2025,
  saldo_inicial: 0, adquisiciones: 0, mejoras: 0, retiros: 0, otros_ajustes: 0,
  ajuste_inflacion: 0, deprec_retiros: 0, deprec_otros_ajustes: 0, ajuste_inflacion_deprec: 0,
  metodo_depreciacion: 'linea_recta', estado: 'activo', ...o,
});

const REMOLCADOR = base({
  codigo_relacionado: '1', cuenta_contable: '33411',
  descripcion: 'REMOLCADOR, MODELO T800, CARROCERIA -REMOLCADOR',
  marca: 'KENWORTH', modelo: 'T800', serie_placa: '3WKDDU9X27F210531',
  saldo_inicial: 70002.85, fecha_adquisicion: '2015-09-29',
  porcentaje_depreciacion: 20, meses_uso: 3, deprec_acum_anterior: 47964,
});
const SCANIA = base({
  codigo_relacionado: '2', cuenta_contable: '33412',
  descripcion: 'REPARACION - REVALUACION', marca: 'SCANIA', modelo: 'R500 A6X4',
  saldo_inicial: 44875, fecha_adquisicion: '2019-07-09',
  porcentaje_depreciacion: 20, meses_uso: 6, deprec_acum_anterior: 4488,
});
const LAPTOP = base({
  codigo_relacionado: '1', cuenta_contable: '33611',
  descripcion: 'LAPTO HP 15 DY5010LA SN 5CD22FSKV', marca: 'HP', serie_placa: '5CD22FSKV',
  saldo_inicial: 2542.37, fecha_adquisicion: '2022-10-21',
  porcentaje_depreciacion: 25, meses_uso: 2, deprec_acum_anterior: 70,
});
const GPS = base({
  codigo_relacionado: '1', cuenta_contable: '33691',
  descripcion: 'EQUIPO GPS', marca: 'S/M', modelo: 'S/M', serie_placa: 'S/S',
  saldo_inicial: 423.73, fecha_adquisicion: '2018-06-04',
  porcentaje_depreciacion: 25, meses_uso: 6, deprec_acum_anterior: 71,
});
const MODELO = [REMOLCADOR, SCANIA, LAPTOP, GPS];

describe('la fórmula reproduce el Excel real de las contadoras', () => {
  it('REMOLCADOR KENWORTH: 70.002,85 × 20% × 3/12 = 3.500 (el Excel dice 3.500)', () => {
    expect(depreciacionEjercicio(REMOLCADOR)).toBeCloseTo(3500, 0);
    expect(depreciacionAcumuladaHistorica(REMOLCADOR)).toBeCloseTo(51464, 0);
    expect(valorEnLibros(REMOLCADOR)).toBeCloseTo(18538.85, 0);
  });

  it('SCANIA R500: 44.875 × 20% × 6/12 = 4.487,50 (el Excel lo redondea a 4.488)', () => {
    // Acá está la única diferencia contra la planilla, y es a favor: el Excel
    // trabaja en soles enteros, la app en céntimos. 4.487,50 es el número
    // exacto; redondear a 4.488 arrastra medio sol por bien y por año.
    expect(depreciacionEjercicio(SCANIA)).toBe(4487.5);
    expect(depreciacionAcumuladaHistorica(SCANIA)).toBe(8975.5);
    expect(valorEnLibros(SCANIA)).toBe(35899.5);
  });

  it('LAPTOP HP: 2.542,37 × 25% × 2/12 = 106 (el Excel dice 106)', () => {
    expect(depreciacionEjercicio(LAPTOP)).toBeCloseTo(106, 0);
    expect(depreciacionAcumuladaHistorica(LAPTOP)).toBeCloseTo(176, 0);
    expect(valorEnLibros(LAPTOP)).toBeCloseTo(2366.37, 0);
  });

  it('EQUIPO GPS: 423,73 × 25% × 6/12 = 53 (el Excel dice 53)', () => {
    expect(depreciacionEjercicio(GPS)).toBeCloseTo(53, 0);
    expect(depreciacionAcumuladaHistorica(GPS)).toBeCloseTo(124, 0);
    expect(valorEnLibros(GPS)).toBeCloseTo(299.73, 0);
  });

  it('los TOTALES cuadran con la fila de totales del Excel', () => {
    const t = totales(MODELO);
    expect(t.valorHistorico).toBeCloseTo(117843.95, 2);   // el Excel: 117.843,95
    expect(t.deprecAcumAnterior).toBeCloseTo(52593, 0);   // el Excel:  52.593,00
    expect(t.deprecEjercicio).toBeCloseTo(8147, 0);       // el Excel:   8.147,00
    expect(t.deprecAcumHistorica).toBeCloseTo(60740, 0);  // el Excel:  60.740,00
    expect(t.valorLibros).toBeCloseTo(57103.95, 0);       // el Excel:  57.103,95
  });
});

describe('valor histórico y ajustado', () => {
  it('suma saldo, adquisiciones y mejoras; resta retiros', () => {
    const a = base({ saldo_inicial: 1000, adquisiciones: 500, mejoras: 200, retiros: 300, otros_ajustes: 50 });
    expect(valorHistorico(a)).toBe(1450);
  });
  it('el ajustado agrega el ajuste por inflación', () => {
    expect(valorAjustado(base({ saldo_inicial: 1000, ajuste_inflacion: 100 }))).toBe(1100);
  });
  it('sin datos no explota', () => {
    expect(valorHistorico(null)).toBe(0);
    expect(valorEnLibros(undefined)).toBe(0);
  });
});

describe('depreciación — los topes que la planilla a mano no tiene', () => {
  it('no deprecia por debajo de cero: recorta al remanente', () => {
    // Queda 1.000 por depreciar pero la fórmula pediría 2.000.
    const a = base({ saldo_inicial: 10000, porcentaje_depreciacion: 20, meses_uso: 12, deprec_acum_anterior: 9000 });
    expect(depreciacionEjercicio(a)).toBe(1000);
    expect(valorEnLibros(a)).toBe(0);
  });

  it('un bien ya agotado deja de generar gasto', () => {
    const a = base({ saldo_inicial: 5000, porcentaje_depreciacion: 20, meses_uso: 12, deprec_acum_anterior: 5000 });
    expect(depreciacionEjercicio(a)).toBe(0);
    expect(valorEnLibros(a)).toBe(0);
    expect(calcularActivo(a).agotado).toBe(true);
  });

  it('0 meses de uso = 0 de depreciación (comprado en diciembre, usado en enero)', () => {
    expect(depreciacionEjercicio(base({ saldo_inicial: 50000, porcentaje_depreciacion: 20, meses_uso: 0 }))).toBe(0);
  });

  it('meses fuera de rango se recortan a [0,12]', () => {
    const a = base({ saldo_inicial: 1200, porcentaje_depreciacion: 100, meses_uso: 99 });
    expect(depreciacionEjercicio(a)).toBe(1200);
    expect(depreciacionEjercicio({ ...a, meses_uso: -5 })).toBe(0);
  });

  it('un terreno (0%) no deprecia', () => {
    const a = base({ cuenta_contable: '331', saldo_inicial: 200000, porcentaje_depreciacion: 0, meses_uso: 12 });
    expect(depreciacionEjercicio(a)).toBe(0);
    expect(valorEnLibros(a)).toBe(200000);
  });

  it('un método que no es línea recta NO se inventa: se carga a mano', () => {
    const a = base({ metodo_depreciacion: 'unidades_produccion', saldo_inicial: 10000, porcentaje_depreciacion: 20, meses_uso: 12 });
    expect(depreciacionEjercicio(a)).toBe(0);
    expect(depreciacionEjercicio({ ...a, deprec_ejercicio_manual: 1234.56 })).toBe(1234.56);
  });

  it('el importe manual manda incluso sobre línea recta', () => {
    expect(depreciacionEjercicio({ ...REMOLCADOR, deprec_ejercicio_manual: 999 })).toBe(999);
  });

  it('la acumulada ajustada suma el ajuste por inflación de la depreciación', () => {
    const a = base({ saldo_inicial: 1000, porcentaje_depreciacion: 10, meses_uso: 12, ajuste_inflacion_deprec: 25 });
    expect(depreciacionAcumuladaHistorica(a)).toBe(100);
    expect(depreciacionAcumuladaAjustada(a)).toBe(125);
  });
});

describe('cuentas y tasas SUNAT', () => {
  it('resuelve las cuentas del modelo', () => {
    expect(cuentaInfo('33411').label).toMatch(/vehículos motorizados/i);
    expect(cuentaInfo('33611').label).toMatch(/procesamiento de datos/i);
    expect(tasaSugerida('33411')).toBe(20);
    expect(tasaSugerida('33611')).toBe(25);
    expect(tasaSugerida('331')).toBe(0);
  });
  it('una cuenta con más dígitos cae en su prefijo', () => {
    expect(cuentaInfo('3331101')?.codigo).toBe('333');
    expect(tasaSugerida('3331101')).toBe(20);
  });
  it('una cuenta desconocida usa el 10% de "otros bienes"', () => {
    expect(tasaSugerida('99999')).toBe(10);
  });
  it('avisa cuando la tasa supera el máximo (gasto no deducible)', () => {
    expect(alertaTasa(base({ cuenta_contable: '33411', porcentaje_depreciacion: 20 }))).toBeNull();
    expect(alertaTasa(base({ cuenta_contable: '33411', porcentaje_depreciacion: 33 }))).toMatch(/supera el máximo de 20%/);
  });
  it('depreciar MÁS LENTO que el tope está permitido y no avisa', () => {
    expect(alertaTasa(base({ cuenta_contable: '33611', porcentaje_depreciacion: 10 }))).toBeNull();
  });
});

describe('mesesDeUsoEnEjercicio', () => {
  it('prorratea desde el mes en que empezó a usarse', () => {
    expect(mesesDeUsoEnEjercicio('2025-10-01', 2025)).toBe(3);   // oct, nov, dic
    expect(mesesDeUsoEnEjercicio('2025-11-15', 2025)).toBe(2);
    expect(mesesDeUsoEnEjercicio('2025-01-05', 2025)).toBe(12);
  });
  it('un bien de años anteriores usa los 12 meses', () => {
    expect(mesesDeUsoEnEjercicio('2018-06-04', 2025)).toBe(12);
  });
  it('un bien que empieza el año que viene no deprecia todavía', () => {
    expect(mesesDeUsoEnEjercicio('2026-02-01', 2025)).toBe(0);
  });
  it('sin fecha asume el año entero', () => {
    expect(mesesDeUsoEnEjercicio(null, 2025)).toBe(12);
    expect(mesesDeUsoEnEjercicio('basura', 2025)).toBe(12);
  });
});

describe('porCuenta', () => {
  it('agrupa por cuenta con su subtotal y en orden', () => {
    const g = porCuenta(MODELO);
    expect(g.map(x => x.cuenta)).toEqual(['33411', '33412', '33611', '33691']);
    expect(g[0].totales.valorHistorico).toBeCloseTo(70002.85, 2);
  });
  it('los borrados no cuentan', () => {
    const g = porCuenta([...MODELO, base({ cuenta_contable: '333', saldo_inicial: 999, deleted_at: '2026-01-01' })]);
    expect(g.find(x => x.cuenta === '333')).toBeUndefined();
  });
});

describe('validación', () => {
  it('una fila del modelo está bien', () => {
    expect(validarActivo(REMOLCADOR)).toEqual([]);
  });
  it('exige empresa, cuenta, descripción y período', () => {
    const errs = validarActivo({ });
    expect(errs).toContain('Falta la empresa dueña del activo');
    expect(errs).toContain('Falta la cuenta contable (PCGE 33x)');
    expect(errs).toContain('Falta la descripción del bien');
    expect(errs).toContain('Falta el período (ejercicio)');
  });
  it('detecta un valor histórico negativo por retiros mal cargados', () => {
    expect(validarActivo(base({ cuenta_contable: '333', descripcion: 'X', saldo_inicial: 100, retiros: 500 })))
      .toContain('El valor histórico da negativo — revisá retiros y ajustes');
  });
  it('detecta un porcentaje imposible', () => {
    expect(validarActivo(base({ cuenta_contable: '333', descripcion: 'X', porcentaje_depreciacion: 250 })))
      .toContain('El porcentaje de depreciación tiene que estar entre 0 y 100');
  });
  it('activosConProblemas junta errores y avisos de tasa', () => {
    const malo = base({ cuenta_contable: '33411', descripcion: 'Camión', porcentaje_desconocido: 1, porcentaje_depreciacion: 50, meses_uso: 12, saldo_inicial: 1000 });
    const r = activosConProblemas([REMOLCADOR, malo]);
    expect(r).toHaveLength(1);
    expect(r[0].aviso).toMatch(/supera el máximo/);
  });
});

describe('desdeActivoPesado — el puente con el registro operativo', () => {
  it('arma el borrador sin pedir tipear dos veces la misma máquina', () => {
    const b = desdeActivoPesado({
      id: 'ap1', nombre: 'EXCAVADORA', marca: 'CAT', modelo: '320D', placa: 'ABC-123',
      costo_adquisicion: 350000, fecha_adquisicion: '2025-04-10', company_id: 'c1',
      obra_actual_id: 'o1', depreciacion_acumulada: 1000,
    }, { periodo: 2025 });
    expect(b.saldo_inicial).toBe(350000);
    expect(b.cuenta_contable).toBe('333');
    expect(b.porcentaje_depreciacion).toBe(20);
    expect(b.meses_uso).toBe(9);                 // abril → 9 meses del ejercicio
    expect(b.activo_pesado_id).toBe('ap1');
    expect(b.deprec_acum_anterior).toBe(1000);
    expect(b.serie_placa).toBe('ABC-123');
  });
  it('un vehículo va a unidades de transporte con su tasa', () => {
    const b = desdeActivoPesado({ id: 'ap2', tipo: 'vehiculo', nombre: 'CAMIONETA' }, { periodo: 2025, companyId: 'c1' });
    expect(b.cuenta_contable).toBe('33411');
    expect(b.porcentaje_depreciacion).toBe(20);
    expect(b.company_id).toBe('c1');
  });
  it('las dos filas reales de activos_pesados (sin costo ni fecha) no rompen nada', () => {
    const b = desdeActivoPesado({ id: 'ap3', nombre: 'GENERADOR GASOLINERO KAILI 3800KW', tipo: 'equipo' }, { periodo: 2025 });
    expect(b.saldo_inicial).toBe(0);
    expect(b.meses_uso).toBe(12);
    expect(b.descripcion).toBe('GENERADOR GASOLINERO KAILI 3800KW');
  });
});

describe('exportación al formato 7.1', () => {
  it('tiene las 28 columnas del formato', () => {
    expect(COLUMNAS_FORMATO_71).toHaveLength(28);
    expect(filaFormato71(REMOLCADOR)).toHaveLength(28);
  });

  it('la fila lleva los calculados ya resueltos', () => {
    const f = filaFormato71(REMOLCADOR);
    expect(f[1]).toBe('33411');
    expect(f[3]).toBe('KENWORTH');
    expect(f[11]).toBeCloseTo(70002.85, 2);      // valor histórico
    expect(f[18]).toBe('20%');
    expect(f[19]).toBe(3);
    expect(f[21]).toBeCloseTo(3500, 0);          // depreciación del ejercicio
    expect(f[27]).toBeCloseTo(18538.85, 0);      // valor en libros
  });

  it('el cuerpo trae un subtotal por cuenta y la fila TOTALES al final', () => {
    const filas = cuerpoFormato71(MODELO);
    // 4 bienes + 4 subtotales + 1 total
    expect(filas).toHaveLength(9);
    expect(filas[filas.length - 1][0]).toBe('TOTALES');
    expect(filas[filas.length - 1][11]).toBeCloseTo(117843.95, 2);
    expect(filas[1][2]).toMatch(/^SUBTOTAL 33411/);
    // Todas las filas tienen el mismo ancho: si no, el Excel sale corrido.
    for (const f of filas) expect(f).toHaveLength(28);
  });

  it('sin activos igual sale el formato con su fila de totales en cero', () => {
    const filas = cuerpoFormato71([]);
    expect(filas).toHaveLength(1);
    expect(filas[0][11]).toBe(0);
  });
});

describe('cerrarEjercicio', () => {
  it('arrastra el valor histórico y la acumulada al año siguiente', () => {
    const [nuevo] = cerrarEjercicio([REMOLCADOR], { periodoNuevo: 2026 });
    expect(nuevo.periodo).toBe(2026);
    expect(nuevo.saldo_inicial).toBeCloseTo(70002.85, 2);
    expect(nuevo.deprec_acum_anterior).toBeCloseTo(51464, 0);
    expect(nuevo.adquisiciones).toBe(0);
    expect(nuevo.mejoras).toBe(0);
    expect(nuevo.meses_uso).toBe(12);
    expect(nuevo.id).toBeUndefined();   // es una fila nueva, no la misma
  });

  it('no arrastra lo retirado ni lo vendido', () => {
    const salida = cerrarEjercicio([
      REMOLCADOR,
      base({ cuenta_contable: '333', descripcion: 'VENDIDO', estado: 'vendido' }),
      base({ cuenta_contable: '333', descripcion: 'DADO DE BAJA', estado: 'retirado' }),
    ], { periodoNuevo: 2026 });
    expect(salida).toHaveLength(1);
  });

  it('marca como totalmente depreciado el bien que se agotó', () => {
    const agotado = base({
      cuenta_contable: '333', descripcion: 'VIEJO',
      saldo_inicial: 5000, porcentaje_depreciacion: 20, meses_uso: 12, deprec_acum_anterior: 5000,
    });
    const [n] = cerrarEjercicio([agotado], { periodoNuevo: 2026 });
    expect(n.estado).toBe('totalmente_depreciado');
    expect(n.deprec_acum_anterior).toBe(5000);
  });

  it('el ejercicio nuevo, recalculado, no da valores en libros negativos', () => {
    for (const n of cerrarEjercicio(MODELO, { periodoNuevo: 2026 })) {
      expect(valorEnLibros(n)).toBeGreaterThanOrEqual(0);
    }
  });
});
