import { describe, it, expect } from 'vitest';
import {
  REGLAS, NIVEL, UMBRAL_DETRACCION,
  revisarMovimiento, revisarLote, resumenRevision, claveDescarte,
} from '../revision-facturas.js';

const mov = (o = {}) => ({ id: 'm1', amount: 10000, currency: 'PEN', date: '2026-05-01',
  document_type: 'factura', notas: '{}', ...o });
const conNotas = (o, n) => ({ ...mov(o), notas: JSON.stringify(n) });
const hallazgos = (m, opts) => revisarMovimiento(m, opts).map(h => h.regla);

describe('estructura de las reglas', () => {
  it('toda regla tiene id único, nivel válido, título y evaluar()', () => {
    const ids = REGLAS.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of REGLAS) {
      expect(r.titulo, r.id).toBeTruthy();
      expect([NIVEL.CONTRADICCION, NIVEL.REVISAR]).toContain(r.nivel);
      expect(typeof r.evaluar).toBe('function');
    }
  });
  it('un comprobante limpio no dispara nada', () => {
    expect(hallazgos(conNotas({ amount: 1180 }, { subtotal: 1000, igv: 180 }))).toEqual([]);
  });
});

// ── Los CASOS REALES de producción, uno por uno ────────────────────

describe('detracción: el monto no cuadra con su propio %', () => {
  it('E001-347 — 12% de 10.000 son 1.200, tiene cargado 1.016,95', () => {
    const h = revisarMovimiento(mov({ detraccion_aplica: true, detraccion_pct: 12,
      detraccion_monto: 1016.95, detraccion_codigo: '03' }));
    const d = h.find(x => x.regla === 'detraccion-monto-no-cuadra');
    expect(d).toBeTruthy();
    expect(d.nivel).toBe(NIVEL.CONTRADICCION);
    expect(d.detalle).toMatch(/1200\.00|1200/);
  });

  it('E001-43 — 12% de 9.000 son 1.080, tiene 950,40', () => {
    expect(hallazgos(mov({ amount: 9000, detraccion_aplica: true, detraccion_pct: 12,
      detraccion_monto: 950.40, detraccion_codigo: '037' })))
      .toContain('detraccion-monto-no-cuadra');
  });

  it('E001-20 — 4% de 7.005 son 280,20 y tiene 280: NO se marca (tolerancia)', () => {
    // La contadora confirmó que el 4% es correcto para obra de construcción.
    // Marcar esto sería el falso positivo que hundió la primera pasada.
    expect(hallazgos(mov({ amount: 7005, detraccion_aplica: true, detraccion_pct: 4,
      detraccion_monto: 280, detraccion_codigo: '019' }))).toEqual([]);
  });

  it('E001-354 — el MISMO código 019 al 10% tampoco se marca', () => {
    expect(hallazgos(mov({ amount: 5040, detraccion_aplica: true, detraccion_pct: 10,
      detraccion_monto: 504, detraccion_codigo: '019' }))).toEqual([]);
  });

  it('una nota de crédito (total negativo) se evalúa sobre el valor absoluto', () => {
    expect(hallazgos(mov({ amount: -5040, document_type: 'nota_credito', detraccion_aplica: true,
      detraccion_pct: 10, detraccion_monto: 504, detraccion_codigo: '019' }))).toEqual([]);
  });
});

describe('detracción: código inválido', () => {
  it("E001-347 usa '03', que no es de tres dígitos", () => {
    expect(hallazgos(mov({ detraccion_aplica: true, detraccion_codigo: '03',
      detraccion_pct: 12, detraccion_monto: 1200 }))).toContain('detraccion-codigo-invalido');
  });
  it('019, 027 y 037 son válidos', () => {
    for (const c of ['019', '027', '037']) {
      expect(hallazgos(mov({ detraccion_aplica: true, detraccion_codigo: c,
        detraccion_pct: 10, detraccion_monto: 1000 })))
        .not.toContain('detraccion-codigo-invalido');
    }
  });
  it('sin código no dispara ESTA regla (dispara la de código faltante)', () => {
    const h = hallazgos(mov({ detraccion_aplica: true, detraccion_pct: 12, detraccion_monto: 1200 }));
    expect(h).not.toContain('detraccion-codigo-invalido');
    expect(h).toContain('detraccion-sin-codigo');
  });
});

describe('detracción bajo el umbral de S/ 700', () => {
  it('F001-000818 — S/ 54 con detracción cargada', () => {
    expect(hallazgos(mov({ amount: 54, detraccion_aplica: true, detraccion_pct: 12, detraccion_monto: 0, detraccion_codigo: '037' })))
      .toContain('detraccion-bajo-umbral');
  });
  it('justo en 700 tampoco corresponde (el umbral es "mayor a")', () => {
    expect(hallazgos(mov({ amount: UMBRAL_DETRACCION, detraccion_aplica: true, detraccion_pct: 12,
      detraccion_monto: 84, detraccion_codigo: '037' }))).toContain('detraccion-bajo-umbral');
  });
  it('en 701 ya corresponde y no se marca', () => {
    expect(hallazgos(mov({ amount: 701, detraccion_aplica: true, detraccion_pct: 12,
      detraccion_monto: 84.12, detraccion_codigo: '037' }))).not.toContain('detraccion-bajo-umbral');
  });
  it('el umbral es en SOLES: un comprobante en dólares no se juzga con él', () => {
    expect(hallazgos(mov({ amount: 54, currency: 'USD', detraccion_aplica: true, detraccion_pct: 12,
      detraccion_monto: 6.48, detraccion_codigo: '037' }))).not.toContain('detraccion-bajo-umbral');
  });
});

describe('detracción sin código — los 6 de julio', () => {
  it('E001-34: 12% y 5.400 cargados, código vacío', () => {
    expect(hallazgos(mov({ amount: 45000, detraccion_aplica: true, detraccion_pct: 12, detraccion_monto: 5400 })))
      .toContain('detraccion-sin-codigo');
  });
  it('sin detracción aplicada no se pide código', () => {
    expect(hallazgos(mov({ detraccion_aplica: false }))).toEqual([]);
  });
});

describe('totales: |total| ≠ subtotal + IGV', () => {
  it('FW01-318974 — subtotal 65 sobre un total de 55 es imposible', () => {
    expect(hallazgos(conNotas({ amount: 55 }, { subtotal: 65, igv: 0 })))
      .toContain('totales-no-cuadran');
  });
  it('F030-792 — 1.203,33 + 126,34 = 1.329,67 y el total dice 1.450', () => {
    expect(hallazgos(conNotas({ amount: 1450 }, { subtotal: 1203.33, igv: 126.34 })))
      .toContain('totales-no-cuadran');
  });

  it('🔴 una NOTA DE CRÉDITO no se marca: el total va negativo y el subtotal positivo', () => {
    // Esta es la regresión que importa: sin abs() esta regla marcaba las 49
    // notas de crédito de producción, todas correctas.
    expect(hallazgos(conNotas({ amount: -23571.30, document_type: 'nota_credito' },
      { subtotal: 19975.68, igv: 3595.62 }))).not.toContain('totales-no-cuadran');
  });

  it('sin subtotal o sin IGV la regla se calla en vez de inventar', () => {
    expect(hallazgos(conNotas({ amount: 100 }, { subtotal: 100 }))).not.toContain('totales-no-cuadran');
    expect(hallazgos(conNotas({ amount: 100 }, {}))).not.toContain('totales-no-cuadran');
  });
  it('una diferencia de un sol entra en la tolerancia', () => {
    expect(hallazgos(conNotas({ amount: 1180.5 }, { subtotal: 1000, igv: 180 })))
      .not.toContain('totales-no-cuadran');
  });
});

describe('fecha futura', () => {
  it('marca lo fechado después de hoy', () => {
    expect(hallazgos(mov({ date: '2026-12-01' }), { hoy: '2026-09-06' })).toContain('fecha-futura');
  });
  it('hoy mismo está bien', () => {
    expect(hallazgos(mov({ date: '2026-09-06' }), { hoy: '2026-09-06' })).not.toContain('fecha-futura');
  });
  it('sin saber qué día es hoy, no opina', () => {
    expect(hallazgos(mov({ date: '2030-01-01' }))).not.toContain('fecha-futura');
  });
});

describe('NIVEL 2 — lo que puede estar bien', () => {
  it('IGV en cero se marca como REVISAR, nunca como contradicción', () => {
    const h = revisarMovimiento(conNotas({ amount: 559.24 }, { subtotal: 559.24, igv: 0 }))
      .find(x => x.regla === 'igv-no-es-18');
    expect(h).toBeTruthy();
    expect(h.nivel).toBe(NIVEL.REVISAR);
    expect(h.sugerencia).toMatch(/exonerada|inafecta/);
  });

  it('🔴 un RECIBO POR HONORARIOS con IGV 0 NO se marca: nunca lleva IGV', () => {
    expect(hallazgos(conNotas({ document_type: 'recibo', category: 'Recibo Honorarios' },
      { subtotal: 1000, igv: 0 }))).not.toContain('igv-no-es-18');
    expect(hallazgos(conNotas({ document_type: 'recibo_honorarios' },
      { subtotal: 1000, igv: 0 }))).not.toContain('igv-no-es-18');
  });

  it('una nota tampoco: hereda el IGV del comprobante que corrige', () => {
    expect(hallazgos(conNotas({ amount: -3109, document_type: 'nota_credito' },
      { subtotal: 3100, igv: 9 }))).not.toContain('igv-no-es-18');
  });

  it('los ítems que no suman el subtotal son REVISAR', () => {
    const h = revisarMovimiento(conNotas({ amount: 1180 }, {
      subtotal: 1000, igv: 180,
      items_factura: [{ cantidad: 2, precio_unitario: 100 }],
    })).find(x => x.regla === 'items-no-suman-subtotal');
    expect(h.nivel).toBe(NIVEL.REVISAR);
    expect(h.detalle).toMatch(/200\.00/);
  });

  it('si a un ítem le falta cantidad o precio, la regla se calla', () => {
    expect(hallazgos(conNotas({ amount: 1180 }, {
      subtotal: 1000, igv: 180, items_factura: [{ descripcion: 'algo' }],
    }))).not.toContain('items-no-suman-subtotal');
  });
});

describe('descartes y robustez', () => {
  it('un hallazgo descartado no vuelve a aparecer', () => {
    const m = mov({ detraccion_aplica: true, detraccion_pct: 12, detraccion_monto: 999, detraccion_codigo: '037' });
    expect(hallazgos(m)).toContain('detraccion-monto-no-cuadra');
    const fuera = new Set([claveDescarte('m1', 'detraccion-monto-no-cuadra')]);
    expect(hallazgos(m, { descartados: fuera })).not.toContain('detraccion-monto-no-cuadra');
  });

  it('el descarte es por comprobante, no por regla global', () => {
    const otro = { ...mov({ id: 'm2', detraccion_aplica: true, detraccion_pct: 12, detraccion_monto: 999, detraccion_codigo: '037' }) };
    const fuera = new Set([claveDescarte('m1', 'detraccion-monto-no-cuadra')]);
    expect(hallazgos(otro, { descartados: fuera })).toContain('detraccion-monto-no-cuadra');
  });

  it('notas ilegibles, null y basura no rompen nada', () => {
    expect(() => revisarMovimiento({ id: 'x', amount: 1, notas: '{roto' })).not.toThrow();
    expect(() => revisarMovimiento({ id: 'x', amount: 1, notas: null })).not.toThrow();
    expect(revisarMovimiento(null)).toEqual([]);
    expect(revisarMovimiento({ id: 'x', deleted_at: 'ya' })).toEqual([]);
  });
});

describe('revisarLote y resumen', () => {
  const lote = [
    conNotas({ id: 'chico', amount: 55 }, { subtotal: 65, igv: 0 }),
    conNotas({ id: 'grande', amount: 1450 }, { subtotal: 1203.33, igv: 126.34 }),
    mov({ id: 'limpio', amount: 1180, notas: JSON.stringify({ subtotal: 1000, igv: 180 }) }),
  ];

  it('ordena las contradicciones primero y, dentro, lo más caro arriba', () => {
    const h = revisarLote(lote).filter(x => x.nivel === NIVEL.CONTRADICCION);
    expect(h[0].movimiento_id).toBe('grande');
  });

  it('el resumen cuenta por nivel y por regla', () => {
    const r = resumenRevision(revisarLote(lote));
    expect(r.contradicciones).toBeGreaterThan(0);
    expect(r.total).toBe(r.contradicciones + r.revisar);
    expect(r.porRegla['totales-no-cuadran']).toBe(2);
  });

  it('lote vacío o basura no rompe', () => {
    expect(revisarLote([])).toEqual([]);
    expect(revisarLote(null)).toEqual([]);
    expect(resumenRevision(null).total).toBe(0);
  });
});
