// ═══════════════════════════════════════════════════════════════════
// SUNAT CONTRA JARVEX (tanda 14, entrega 5) — lib pura.
//
// El caso central es el cruce REAL de julio-2026 de JARVEX: 35 compras y 5
// ventas en los CSV contra los 30 y 4 movimientos que había cargados. Los
// nombres, series e importes son textuales. Si alguien afloja la llave o el
// rescate por serie, estos tests dicen qué factura se dejó de ver y por
// cuánta plata.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  llaveComprobante, llaveDeFilaSunat, llaveDeMovimiento, movimientosDelLibro,
  compararLibro, resumirComparativa, aplicarDecisiones, filasPendientes,
  exportarComparativaCsv, mesDePeriodo, ETIQUETA_ESTADO,
} from '../comparativa-sunat.js';

const JARVEX = 'jarvex-id';
const GASOMI = 'gasomi-id';
const COMPANIES = [
  { id: JARVEX, name: 'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.' },
  { id: GASOMI, name: 'GASOMI INGENIEROS E.I.R.L.' },
];

// Una fila del CSV ya parseada.
const sunat = (tipoCp, serie, numero, ruc, total, fecha, extra = {}) => ({
  linea: 2, tipoCp, tipoNombre: tipoCp === '07' ? 'nota_credito' : 'factura',
  serie, numero, documento: `${serie}-${numero}`, fecha,
  contraparteRuc: ruc, contraparteNombre: extra.nombre || 'PROVEEDOR SAC',
  base: extra.base ?? 0, igv: extra.igv ?? 0, noGravado: extra.noGravado ?? 0,
  total, moneda: 'PEN', modificaSerie: '', modificaNumero: '', ...extra,
});

// Un movimiento de accounting_movements.
const mov = (id, documento, ruc, amount, date, extra = {}) => ({
  id, company_id: JARVEX, clase: 'compra', type: 'cost',
  document_type: 'factura', document_number: documento,
  third_party_ruc: ruc, third_party_name: extra.nombre || 'PROVEEDOR SAC',
  amount, date, currency: 'PEN', ...extra,
});

describe('la llave de cruce', () => {
  it('🔴 lleva el tipo: la nota de crédito NO es su factura', () => {
    // El caso real de julio: 01 E001-1 y 07 E001-1 conviven en el archivo.
    const factura = llaveComprobante({ tipoCp: '01', serie: 'E001', numero: 1, ruc: '20615346081' });
    const nota = llaveComprobante({ tipoCp: '07', serie: 'E001', numero: 1, ruc: '20615346081' });
    expect(factura).not.toBe(nota);
  });

  it('el correlativo se compara como número, no como texto', () => {
    // SUNAT dice 292, la app FDX1-292, el PDF FDX1-00000292.
    const a = llaveDeFilaSunat(sunat('01', 'FDX1', 292, '20529497009', 370, '2026-07-09'));
    const b = llaveDeMovimiento(mov('m1', 'FDX1-292', '20529497009', 370, '2026-07-09'));
    const c = llaveDeMovimiento(mov('m2', 'FDX1-00000292', '20529497009', 370, '2026-07-09'));
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('la serie se compara en mayúsculas', () => {
    expect(llaveDeMovimiento(mov('m', 'f001-8', '20611028947', 135, '2026-07-08')))
      .toBe(llaveComprobante({ tipoCp: '01', serie: 'F001', numero: 8, ruc: '20611028947' }));
  });

  it('sin serie-correlativo no hay llave (no se cruza a ciegas)', () => {
    expect(llaveDeMovimiento(mov('m', 'sin numero', '20611028947', 135, '2026-07-08'))).toBe('');
    expect(llaveComprobante({ tipoCp: '01', serie: 'F001', numero: 8, ruc: '' })).toBe('');
  });

  it('el RUC se compara sin guiones ni espacios', () => {
    expect(llaveComprobante({ tipoCp: '01', serie: 'F001', numero: 8, ruc: '206-110 28947' }))
      .toBe(llaveComprobante({ tipoCp: '01', serie: 'F001', numero: 8, ruc: '20611028947' }));
  });
});

describe('movimientosDelLibro — el sentido importa', () => {
  const movs = [
    mov('compra', 'E001-2', '20615646505', 19028.68, '2026-07-06'),
    { ...mov('venta', 'E001-2', '20615346081', 19028.68, '2026-07-06'), clase: 'venta', type: 'income' },
    { ...mov('ajena', 'E001-2', '20615346081', 19028.68, '2026-07-06'), company_id: GASOMI, clase: 'venta', type: 'income' },
    { ...mov('borrada', 'E001-9', '20615346081', 100, '2026-07-06'), clase: 'venta', type: 'income', deleted_at: '2026-08-01' },
  ];

  it('el libro de ventas solo mira ventas de esta empresa', () => {
    const r = movimientosDelLibro(movs, { companyId: JARVEX, libro: 'ventas' });
    expect(r.map(m => m.id)).toEqual(['venta']);
  });

  it('el libro de compras solo mira compras', () => {
    const r = movimientosDelLibro(movs, { companyId: JARVEX, libro: 'compras' });
    expect(r.map(m => m.id)).toEqual(['compra']);
  });
});

describe('compararLibro — el cruce real de julio-2026 (compras)', () => {
  // Las cinco que faltaban de verdad + una que cruza + la de la serie mal.
  const filas = [
    sunat('01', 'F001', 163254, '20614539756', 12956.40, '2026-07-18', { base: 10980, igv: 1976.40, nombre: 'INVERSIONES Y DESARROLLO ANDINO E.I.R.L.' }),
    sunat('01', 'F001', 170359, '20614544768', 16949.60, '2026-07-16', { base: 14364.07, igv: 2585.53, nombre: 'GRUPO DE INVERSIONES FRONTIER E.I.R.L.' }),
    sunat('01', 'F004', 2866, '20610136843', 100.00, '2026-07-15', { base: 84.75, igv: 15.25, nombre: 'INVERSIONES CGR E.I.R.L.' }),
    sunat('01', 'F203', 1570, '20612601951', 120.00, '2026-07-06', { base: 101.69, igv: 18.31, nombre: 'PETRO LA MERCED S.A.C.' }),
    sunat('01', 'FCC1', 7964323, '20100053455', 10.00, '2026-07-08', { noGravado: 10, nombre: 'BANCO INTERNACIONAL DEL PERÚ - INTERBANK' }),
    sunat('01', 'FA01', 5101, '20516107503', 134.00, '2026-07-05', { base: 113.56, igv: 20.44, nombre: 'CHIFA MONTEORO SOCIEDAD ANONIMA CERRADA' }),
  ];
  const movs = [
    mov('m1', 'F001-163254', '20614539756', 12956.40, '2026-07-18', { nombre: 'INVERSIONES Y DESARROLLO ANDINO E.I.R.L.' }),
    // CHIFA está cargada con la serie mal: F001 en vez de FA01.
    mov('m2', 'F001-5101', '20516107503', 134.00, '2026-07-05', { nombre: 'CHIFA MONTEORO SOCIEDAD ANONIMA CERRADA' }),
  ];
  const { filas: r, resumen } = compararLibro(filas, movs, {
    companyId: JARVEX, libro: 'compras', periodo: '202607', companies: COMPANIES,
  });
  const porDoc = Object.fromEntries(r.map(f => [f.documento, f]));

  it('la que está bien cargada cuadra', () => {
    expect(porDoc['F001-163254'].estado).toBe('cuadra');
    expect(porDoc['F001-163254'].diferencia).toBe(0);
  });

  it('las cuatro que faltan de verdad salen como «falta en JARVEX»', () => {
    for (const d of ['F001-170359', 'F004-2866', 'F203-1570', 'FCC1-7964323']) {
      expect(porDoc[d].estado).toBe('solo_sunat');
      expect(porDoc[d].movimientoId).toBeNull();
    }
    // La más cara del mes, con su plata.
    expect(porDoc['F001-170359'].sunatTotal).toBe(16949.60);
    expect(porDoc['F001-170359'].sunatIgv).toBe(2585.53);
  });

  it('🔴 CHIFA sale como UN error de serie, no como dos comprobantes', () => {
    // Sin el rescate por RUC+importe+fecha saldrían dos filas: una que falta
    // (FA01-5101) y una que sobra (F001-5101). Es el mismo almuerzo.
    const chifa = porDoc['FA01-5101'];
    expect(chifa.estado).toBe('serie_distinta');
    expect(chifa.appDocumento).toBe('F001-5101');
    expect(chifa.diferencia).toBe(0);
    // Y no queda ninguna fila «solo_jarvex» por el movimiento rescatado.
    expect(r.filter(f => f.estado === 'solo_jarvex')).toHaveLength(0);
  });

  it('la comisión del banco viaja como no gravada', () => {
    expect(porDoc['FCC1-7964323'].sunatNoGravado).toBe(10);
    expect(porDoc['FCC1-7964323'].sunatIgv).toBe(0);
  });

  it('el resumen dice cuánta plata falta cargar', () => {
    expect(resumen.total).toBe(6);
    expect(resumen.cuadran).toBe(1);
    expect(resumen.faltanEnApp).toBe(4);
    // 16949.60 + 100 + 120 + 10
    expect(resumen.brecha).toBe(17179.60);
    // La de la serie distinta NO suma a la brecha: el comprobante existe.
    expect(resumen.porEstado.serie_distinta).toBe(1);
  });
});

describe('compararLibro — ventas: la nota de crédito que falta', () => {
  const venta = (id, doc, amount, date, extra = {}) => ({
    ...mov(id, doc, '20615346081', amount, date, extra),
    clase: 'venta', type: 'income', nombre: 'CONSORCIO EL INCA',
  });
  const filas = [
    sunat('01', 'E001', 1, '20615346081', 12920, '2026-07-06', { base: 10949.15, igv: 1970.85, nombre: 'CONSORCIO EL INCA' }),
    sunat('07', 'E001', 1, '20615346081', -12920, '2026-07-06', {
      base: -10949.15, igv: -1970.85, nombre: 'CONSORCIO EL INCA',
      tipoNombre: 'nota_credito', modificaSerie: 'E001', modificaNumero: '1',
    }),
    sunat('01', 'E001', 2, '20615346081', 19028.68, '2026-07-06', { base: 16126, igv: 2902.68, nombre: 'CONSORCIO EL INCA' }),
  ];
  const movs = [
    venta('v1', 'E001-1', 12920, '2026-07-06'),
    venta('v2', 'E001-2', 19028.68, '2026-07-06'),
  ];
  const { filas: r, resumen } = compararLibro(filas, movs, {
    companyId: JARVEX, libro: 'ventas', periodo: '202607', companies: COMPANIES,
  });

  it('🔴 la factura cuadra y la nota de crédito falta — no se tapan entre sí', () => {
    const factura = r.find(f => f.tipoCp === '01' && f.numero === 1);
    const nota = r.find(f => f.tipoCp === '07');
    expect(factura.estado).toBe('cuadra');
    expect(nota.estado).toBe('solo_sunat');
    expect(nota.sunatTotal).toBe(-12920);
    // La nota dice a qué factura anula, para poder explicarlo en pantalla.
    expect(nota.modifica).toBe('E001-1');
  });

  it('la brecha refleja el ingreso que la app cuenta de más', () => {
    expect(resumen.faltanEnApp).toBe(1);
    expect(resumen.brecha).toBe(-12920);
  });
});

describe('compararLibro — está, pero en otro lado', () => {
  const filas = [
    sunat('01', 'F001', 100, '20600000001', 500, '2026-07-10'),
    sunat('01', 'F001', 200, '20600000002', 300, '2026-07-11'),
    sunat('01', 'F001', 300, '20600000003', 700, '2026-07-12'),
  ];
  const movs = [
    // Cargada en GASOMI, no en JARVEX.
    { ...mov('a', 'F001-100', '20600000001', 500, '2026-07-10'), company_id: GASOMI },
    // Cargada con fecha de otro mes.
    mov('b', 'F001-200', '20600000002', 300, '2026-06-11'),
    // Cargada con otro importe.
    mov('c', 'F001-300', '20600000003', 690, '2026-07-12'),
  ];
  const { filas: r } = compararLibro(filas, movs, {
    companyId: JARVEX, libro: 'compras', periodo: '202607', companies: COMPANIES,
  });
  const porDoc = Object.fromEntries(r.map(f => [f.documento, f]));

  it('«cargado en otra empresa» dice en cuál, en vez de decir que falta', () => {
    expect(porDoc['F001-100'].estado).toBe('otra_empresa');
    expect(porDoc['F001-100'].empresaAjena).toBe('GASOMI INGENIEROS E.I.R.L.');
  });

  it('«cargado en otro mes» no es «falta»', () => {
    expect(porDoc['F001-200'].estado).toBe('otro_periodo');
    expect(porDoc['F001-200'].appFecha).toBe('2026-06-11');
  });

  it('el importe distinto sale con la diferencia exacta', () => {
    expect(porDoc['F001-300'].estado).toBe('importe_distinto');
    expect(porDoc['F001-300'].diferencia).toBe(10);
  });
});

describe('compararLibro — lo que la app tiene y SUNAT no', () => {
  it('sale como «SUNAT no lo tiene», pero solo si es del mes del corte', () => {
    const movs = [
      mov('a', 'F001-999', '20600000009', 250, '2026-07-20'),
      mov('b', 'F001-888', '20600000009', 400, '2026-05-20'),   // de otro mes
    ];
    const { filas: r, resumen } = compararLibro([], movs, {
      companyId: JARVEX, libro: 'compras', periodo: '202607', companies: COMPANIES,
    });
    expect(r).toHaveLength(1);
    expect(r[0].estado).toBe('solo_jarvex');
    expect(r[0].documento).toBe('F001-999');
    expect(resumen.faltanEnSunat).toBe(1);
    expect(resumen.brecha).toBe(-250);
  });
});

describe('la nota de crédito cargada en positivo', () => {
  it('es «signo distinto», no «importe distinto»', () => {
    // Medido: 2 de las 18 notas de crédito de la app están en positivo.
    const filas = [sunat('07', 'FN06', 41040, '20512333456', -35.20, '2026-07-05')];
    const movs = [mov('nc', 'FN06-41040', '20512333456', 35.20, '2026-07-05', { document_type: 'nota_credito' })];
    const { filas: r } = compararLibro(filas, movs, {
      companyId: JARVEX, libro: 'compras', periodo: '202607', companies: COMPANIES,
    });
    expect(r[0].estado).toBe('signo_distinto');
    expect(r[0].diferencia).toBe(0);
  });
});

describe('las decisiones se recuerdan entre meses', () => {
  const filas = [
    { llave: '01|FCC1|7964323|20100053455', estado: 'solo_sunat', sunatTotal: 10, documento: 'FCC1-7964323' },
    { llave: '01|F001|170359|20614544768', estado: 'solo_sunat', sunatTotal: 16949.60, documento: 'F001-170359' },
  ];

  it('una diferencia marcada «no aplica» deja de ser pendiente', () => {
    const con = aplicarDecisiones(filas, [
      { id: 'd1', llave: '01|FCC1|7964323|20100053455', decision: 'no_aplica', nota: 'comisión del banco', updated_at: '2026-09-08' },
    ]);
    expect(con[0].decision).toBe('no_aplica');
    expect(filasPendientes(con).map(f => f.documento)).toEqual(['F001-170359']);
  });

  it('se busca por llave, no por fila: el CSV del mes que viene es otro archivo', () => {
    const otrasFilas = [{ ...filas[0], linea: 99 }];
    const con = aplicarDecisiones(otrasFilas, [
      { id: 'd1', llave: '01|FCC1|7964323|20100053455', decision: 'revisada', updated_at: '2026-09-08' },
    ]);
    expect(con[0].decision).toBe('revisada');
  });

  it('con dos PCs decidiendo lo mismo, gana la más reciente', () => {
    const con = aplicarDecisiones(filas, [
      { id: 'd1', llave: '01|FCC1|7964323|20100053455', decision: 'revisada', updated_at: '2026-09-01' },
      { id: 'd2', llave: '01|FCC1|7964323|20100053455', decision: 'no_aplica', updated_at: '2026-09-08' },
    ]);
    expect(con[0].decision).toBe('no_aplica');
  });

  it('una decisión borrada no se aplica', () => {
    const con = aplicarDecisiones(filas, [
      { id: 'd1', llave: '01|FCC1|7964323|20100053455', decision: 'no_aplica', deleted_at: '2026-09-08' },
    ]);
    expect(con[0].decision).toBeUndefined();
  });
});

describe('utilidades del corte', () => {
  it('el periodo se convierte a mes', () => {
    expect(mesDePeriodo('202607')).toBe('2026-07');
    expect(mesDePeriodo('')).toBe('');
  });

  it('cada estado tiene una etiqueta en español', () => {
    for (const e of Object.keys(ETIQUETA_ESTADO)) expect(ETIQUETA_ESTADO[e]).toBeTruthy();
  });

  it('el resumen de una comparativa vacía no divide por cero', () => {
    const r = resumirComparativa([]);
    expect(r.total).toBe(0);
    expect(r.pctCuadra).toBe(0);
  });

  it('el CSV que exporta SÍ pone comillas — no repite el error de SUNAT', () => {
    const csv = exportarComparativaCsv([{
      libro: 'compras', estado: 'solo_sunat', tipoNombre: 'factura',
      documento: 'F001-170359', appDocumento: '', fecha: '2026-07-16', appFecha: '',
      contraparteRuc: '20614544768', contraparteNombre: 'GRUPO, DE INVERSIONES FRONTIER',
      sunatBase: 14364.07, sunatIgv: 2585.53, sunatTotal: 16949.60, appTotal: null,
      diferencia: 16949.60, moneda: 'PEN',
    }], { periodo: '202607', empresa: 'JARVEX' });
    const lineas = csv.split('\n');
    expect(lineas[0]).toContain('"Estado"');
    // El nombre con coma queda entre comillas y no parte la fila.
    expect(lineas[1]).toContain('"GRUPO, DE INVERSIONES FRONTIER"');
    expect(lineas[1].split('","')).toHaveLength(20);
  });
});
