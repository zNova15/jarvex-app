// ═══════════════════════════════════════════════════════════════════
// EL ESCÁNER DE INCOHERENCIAS (tanda 14, entrega 6) — lib pura.
//
// La mitad de estos tests existen para probar lo que el escáner NO dice. Una
// regla que acusa de más se apaga y no la vuelve a abrir nadie (la lección de
// las recomendaciones de movida del catálogo, que eran 31 y la mitad basura).
// Los casos afirmativos son los MEDIDOS en producción el 8-set-2026.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  intercompanySinEspejo, notasIncoherentes, importesIncoherentes,
  seriesImposibles, escanear, resumirHallazgos, aplicarDecisionesEscaner,
  hallazgosPendientes, FAMILIAS,
} from '../escaner-incoherencias.js';

const JARVEX = 'jarvex-id', INCA = 'inca-id', FERRE = 'ferre-id';
const COMPANIES = [
  { id: JARVEX, name: 'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.', ruc: '20615646505', tipo_entidad: 'propia' },
  { id: INCA, name: 'CONSORCIO EL INCA', ruc: '20615346081', tipo_entidad: 'consorcio' },
  { id: FERRE, name: 'FERRETERIA AJENA S.A.C.', ruc: '20999999999', tipo_entidad: 'tercero' },
];

const venta = (id, company, doc, ruc, amount, date, extra = {}) => ({
  id, company_id: company, clase: 'venta', type: 'income',
  document_type: 'factura', document_number: doc,
  third_party_ruc: ruc, third_party_name: 'CONTRAPARTE', amount, date,
  created_at: `${date}T10:00:00Z`, ...extra,
});
const compra = (id, company, doc, ruc, amount, date, extra = {}) => ({
  ...venta(id, company, doc, ruc, amount, date, extra), clase: 'compra', type: 'cost',
});

describe('1. intercompany sin espejo', () => {
  it('🔴 la venta de JARVEX a EL INCA sin el costo del otro lado se reporta', () => {
    // El caso real: E001-2 por S/ 19.028,68 marcada intercompany, y EL INCA
    // no tiene la compra.
    const movs = [venta('v2', JARVEX, 'E001-2', '20615346081', 19028.68, '2026-07-06', { is_intercompany: true })];
    const r = intercompanySinEspejo(movs, { companies: COMPANIES });
    expect(r).toHaveLength(1);
    expect(r[0].regla).toBe('intercompany_sin_espejo');
    expect(r[0].gravedad).toBe('alta');
    expect(r[0].monto).toBe(19028.68);
    expect(r[0].empresaEsperada).toBe('CONSORCIO EL INCA');
  });

  it('cuando el espejo existe, no dice nada', () => {
    // E001-3 y E001-4 sí lo tienen: no deben salir.
    const movs = [
      venta('v3', JARVEX, 'E001-3', '20615346081', 2551.16, '2026-07-07', { is_intercompany: true }),
      compra('c3', INCA, 'E001-3', '20615646505', 2551.16, '2026-07-07', { is_intercompany: true }),
    ];
    expect(intercompanySinEspejo(movs, { companies: COMPANIES })).toHaveLength(0);
  });

  it('el espejo vale aunque la serie esté tipeada distinta', () => {
    // Se busca por RUC + importe, no por número: el espejo se carga a mano.
    const movs = [
      venta('v', JARVEX, 'E001-9', '20615346081', 500, '2026-07-07', { is_intercompany: true }),
      compra('c', INCA, 'F001-9', '20615646505', 500, '2026-07-07', { is_intercompany: true }),
    ];
    expect(intercompanySinEspejo(movs, { companies: COMPANIES })).toHaveLength(0);
  });

  it('no acusa a lo que no está marcado intercompany', () => {
    const movs = [venta('v', JARVEX, 'E001-2', '20615346081', 19028.68, '2026-07-06')];
    expect(intercompanySinEspejo(movs, { companies: COMPANIES })).toHaveLength(0);
  });

  it('no acusa cuando la contraparte no es del grupo', () => {
    const movs = [compra('c', JARVEX, 'F001-1', '20111111111', 100, '2026-07-06', { is_intercompany: true })];
    expect(intercompanySinEspejo(movs, { companies: COMPANIES })).toHaveLength(0);
  });
});

describe('2. notas de crédito', () => {
  it('una nota sin factura enlazada es huérfana', () => {
    const movs = [compra('n', JARVEX, 'E001-93', '20999999999', -850, '2026-07-20', { document_type: 'nota_credito' })];
    const r = notasIncoherentes(movs);
    expect(r).toHaveLength(1);
    expect(r[0].regla).toBe('nota_huerfana');
  });

  it('una nota enlazada a su factura no es huérfana', () => {
    const movs = [
      compra('f', JARVEX, 'E001-5', '20999999999', 9000, '2026-07-07'),
      compra('n', JARVEX, 'E001-5', '20999999999', -100, '2026-07-08', { document_type: 'nota_credito', related_movement_id: 'f' }),
    ];
    expect(notasIncoherentes(movs).filter(h => h.regla === 'nota_huerfana')).toHaveLength(0);
  });

  it('🔴 una factura anulada por completo que sigue viva se reporta', () => {
    const movs = [
      venta('f', JARVEX, 'E001-1', '20615346081', 12920, '2026-07-06'),
      venta('n', JARVEX, 'E001-1', '20615346081', -12920, '2026-07-06', { document_type: 'nota_credito', related_movement_id: 'f' }),
    ];
    const r = notasIncoherentes(movs).filter(h => h.regla === 'factura_anulada_viva');
    expect(r).toHaveLength(1);
    expect(r[0].gravedad).toBe('alta');
    expect(r[0].monto).toBe(12920);
  });

  it('si ya la dieron de baja, no insiste', () => {
    const movs = [
      venta('f', JARVEX, 'E001-1', '20615346081', 12920, '2026-07-06', { payment_status: 'cancelled' }),
      venta('n', JARVEX, 'E001-1', '20615346081', -12920, '2026-07-06', { document_type: 'nota_credito', related_movement_id: 'f' }),
    ];
    expect(notasIncoherentes(movs).filter(h => h.regla === 'factura_anulada_viva')).toHaveLength(0);
  });

  it('una nota PARCIAL no convierte la factura en anulada', () => {
    const movs = [
      venta('f', JARVEX, 'E001-7', '20615346081', 9000, '2026-07-06'),
      venta('n', JARVEX, 'E001-7', '20615346081', -100, '2026-07-08', { document_type: 'nota_credito', related_movement_id: 'f' }),
    ];
    expect(notasIncoherentes(movs).filter(h => h.regla === 'factura_anulada_viva')).toHaveLength(0);
  });
});

describe('3. importes que no cuadran solos', () => {
  it('🔴 una nota de crédito en positivo suma donde debería restar', () => {
    // Medido: 2 de las 18 notas vivas están así (las de Despegar).
    const movs = [compra('n', JARVEX, 'FN06-41040', '20512333456', 35.20, '2026-07-05', { document_type: 'nota_credito', related_movement_id: null })];
    const r = importesIncoherentes(movs).filter(h => h.regla === 'nota_en_positivo');
    expect(r).toHaveLength(1);
    expect(r[0].gravedad).toBe('alta');
  });

  it('el mismo comprobante cargado dos veces se reporta una sola vez', () => {
    const movs = [
      compra('a', JARVEX, 'F001-100', '20999999999', 500, '2026-07-10'),
      compra('b', JARVEX, 'F001-100', '20999999999', 500, '2026-07-11'),
    ];
    const r = importesIncoherentes(movs).filter(h => h.regla === 'comprobante_duplicado');
    expect(r).toHaveLength(1);
    expect(r[0].movimientoId).toBe('b');           // el primero se deja en paz
    expect(r[0].gemeloId).toBe('a');
  });

  it('el mismo número en DOS empresas distintas no es duplicado', () => {
    const movs = [
      compra('a', JARVEX, 'F001-100', '20999999999', 500, '2026-07-10'),
      compra('b', INCA, 'F001-100', '20999999999', 500, '2026-07-10'),
    ];
    expect(importesIncoherentes(movs).filter(h => h.regla === 'comprobante_duplicado')).toHaveLength(0);
  });

  it('un IGV al 18% declarado por el comprobante no se toca', () => {
    const movs = [compra('a', JARVEX, 'F001-1', '20999999999', 118, '2026-07-10', {
      notas: JSON.stringify({ subtotal: 100, igv: 18 }),
    })];
    expect(importesIncoherentes(movs).filter(h => h.regla === 'igv_fuera_de_tasa')).toHaveLength(0);
  });

  it('un comprobante exonerado (IGV 0) tampoco', () => {
    // Es como viajan las comisiones del banco: total = subtotal, IGV 0.
    const movs = [compra('a', JARVEX, 'FCC1-7964323', '20100053455', 10, '2026-07-08', {
      notas: JSON.stringify({ subtotal: 10, igv: 0 }),
    })];
    expect(importesIncoherentes(movs).filter(h => h.regla === 'igv_fuera_de_tasa')).toHaveLength(0);
  });

  it('🔴 SIN desglose guardado NO se acusa a nadie', () => {
    // La enorme mayoría de los 1.395 movimientos no tiene desglose: si el 18%
    // estimado de la app pudiera acusar, la pantalla sería inservible.
    const movs = [compra('a', JARVEX, 'F001-1', '20999999999', 123.45, '2026-07-10')];
    expect(importesIncoherentes(movs).filter(h => h.regla === 'igv_fuera_de_tasa')).toHaveLength(0);
  });

  it('un IGV que no es ninguna tasa legal sí se reporta', () => {
    const movs = [compra('a', JARVEX, 'F001-1', '20999999999', 150, '2026-07-10', {
      notas: JSON.stringify({ subtotal: 100, igv: 50 }),      // 50%
    })];
    const r = importesIncoherentes(movs).filter(h => h.regla === 'igv_fuera_de_tasa');
    expect(r).toHaveLength(1);
    expect(r[0].tasaPct).toBe(50);
  });
});

describe('4. serie o número imposible', () => {
  it('un documento sin forma de comprobante se reporta', () => {
    const movs = [compra('a', JARVEX, 'recibo del mes', '20999999999', 100, '2026-07-10')];
    const r = seriesImposibles(movs, { companies: COMPANIES });
    expect(r).toHaveLength(1);
    expect(r[0].regla).toBe('documento_sin_forma');
  });

  it('🔴 el correlativo repetido solo se mira en lo que EMITE el grupo', () => {
    // Dos proveedores distintos con F001-1 el mismo mes es NORMAL.
    const movs = [
      compra('a', JARVEX, 'F001-1', '20111111111', 100, '2026-07-10'),
      compra('b', JARVEX, 'F001-1', '20222222222', 200, '2026-07-11'),
    ];
    expect(seriesImposibles(movs, { companies: COMPANIES }).filter(h => h.regla === 'correlativo_repetido')).toHaveLength(0);
  });

  it('emitir dos veces el mismo número sí es un error', () => {
    const movs = [
      venta('a', JARVEX, 'E001-5', '20111111111', 100, '2026-07-10'),
      venta('b', JARVEX, 'E001-5', '20222222222', 200, '2026-07-11'),
    ];
    const r = seriesImposibles(movs, { companies: COMPANIES }).filter(h => h.regla === 'correlativo_repetido');
    expect(r).toHaveLength(1);
    expect(r[0].movimientoId).toBe('b');
    expect(r[0].gravedad).toBe('alta');
  });

  it('la factura y su nota de crédito pueden compartir serie y número', () => {
    // En SUNAT la numeración corre por TIPO: E001-1 factura y E001-1 nota son
    // dos documentos válidos. Esto se corrigió en la tanda 10; no volver atrás.
    const movs = [
      venta('f', JARVEX, 'E001-1', '20615346081', 12920, '2026-07-06'),
      venta('n', JARVEX, 'E001-1', '20615346081', -12920, '2026-07-06', { document_type: 'nota_credito' }),
    ];
    expect(seriesImposibles(movs, { companies: COMPANIES }).filter(h => h.regla === 'correlativo_repetido')).toHaveLength(0);
  });

  it('lo que emite un TERCERO no se juzga', () => {
    const movs = [
      venta('a', FERRE, 'E001-5', '20111111111', 100, '2026-07-10'),
      venta('b', FERRE, 'E001-5', '20222222222', 200, '2026-07-11'),
    ];
    expect(seriesImposibles(movs, { companies: COMPANIES }).filter(h => h.regla === 'correlativo_repetido')).toHaveLength(0);
  });
});

describe('el escáner completo', () => {
  const movs = [
    venta('v2', JARVEX, 'E001-2', '20615346081', 19028.68, '2026-07-06', { is_intercompany: true }),
    compra('n', JARVEX, 'FN06-41040', '20512333456', 35.20, '2026-07-05', { document_type: 'nota_credito' }),
    compra('x', JARVEX, 'sin forma', '20999999999', 10, '2026-07-05'),
  ];

  it('corre las cuatro familias y ordena por gravedad y plata', () => {
    const r = escanear(movs, { companies: COMPANIES });
    expect(r.length).toBeGreaterThanOrEqual(3);
    // Lo más grave y más caro primero: la venta sin espejo de S/ 19.028,68.
    expect(r[0].regla).toBe('intercompany_sin_espejo');
    expect(r[0].monto).toBe(19028.68);
    // Lo más leve al final.
    expect(r[r.length - 1].gravedad).toBe('baja');
  });

  it('se puede correr una sola familia', () => {
    const r = escanear(movs, { companies: COMPANIES, familias: ['serie'] });
    expect(r.every(h => h.familia === 'serie')).toBe(true);
  });

  it('el resumen cuenta por familia y suma la plata', () => {
    const r = resumirHallazgos(escanear(movs, { companies: COMPANIES }));
    expect(r.total).toBeGreaterThanOrEqual(3);
    expect(r.porFamilia.intercompany).toBe(1);
    expect(r.porGravedad.alta).toBeGreaterThanOrEqual(2);
  });

  it('cada familia tiene nombre en español', () => {
    for (const k of Object.keys(FAMILIAS)) expect(FAMILIAS[k]).toBeTruthy();
  });

  it('un hallazgo tiene el mismo id en las dos PCs (id derivado, no aleatorio)', () => {
    const a = escanear(movs, { companies: COMPANIES });
    const b = escanear(movs, { companies: COMPANIES });
    expect(a.map(h => h.id)).toEqual(b.map(h => h.id));
    expect(a[0].id).toBe('intercompany_sin_espejo:v2');
  });

  it('lo marcado como revisado deja de ser pendiente', () => {
    const r = escanear(movs, { companies: COMPANIES });
    const con = aplicarDecisionesEscaner(r, [
      { llave: 'intercompany_sin_espejo:v2', decision: 'no_aplica', nota: 'se factura el mes que viene', updated_at: '2026-09-08' },
    ]);
    expect(con[0].decision).toBe('no_aplica');
    expect(hallazgosPendientes(con)).toHaveLength(r.length - 1);
  });

  it('los movimientos borrados no se escanean', () => {
    const borrados = movs.map(m => ({ ...m, deleted_at: '2026-08-01' }));
    expect(escanear(borrados, { companies: COMPANIES })).toHaveLength(0);
  });

  it('sin movimientos no explota', () => {
    expect(escanear([], { companies: COMPANIES })).toEqual([]);
    expect(resumirHallazgos([]).total).toBe(0);
  });
});
