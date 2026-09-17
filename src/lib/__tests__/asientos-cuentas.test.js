// El asiento completo, con la cuenta saliendo de lo que se compró.
//
// Los otros tests miran las piezas: `pcge-puente` la tabla, y
// `cuenta-de-comprobante` el reparto. Éste mira el resultado: el asiento tal
// como lo va a ver la contadora en el Libro Diario, y sobre todo que SIGA
// CUADRANDO cuando se parte en varias líneas — un asiento que no cuadra es
// peor que uno con la cuenta equivocada.
import { describe, it, expect } from 'vitest';
import { generarAsiento, generarAsientosBatch } from '../asientos.js';
import { crearResolvedorDeFamilia, cuentasDeComprobante } from '../cuenta-de-comprobante.js';

const familiaDe = crearResolvedorDeFamilia({});
const OPTS = { repartoDe: (m) => cuentasDeComprobante(m, { familiaDe }) };

const item = (descripcion, cantidad, precio_unitario) => ({ descripcion, cantidad, precio_unitario });
const compra = (items, extra = {}) => ({
  id: 'mov-1', clase: 'compra', type: 'cost', amount: 118,
  payment_status: 'pending', category: 'Factura',
  description: 'Factura F001-1', document_number: 'F001-1',
  notas: JSON.stringify({ items_factura: items }),
  ...extra,
});

const cuentas = (a) => a.partidas.map(p => p.cuenta);
// El asiento se escribe con la SUBCUENTA (631), que es el detalle que el
// PCGE espera en el libro. `madres` la agrupa a dos dígitos, que es como
// hablan las contadoras: «eso debería ser 63».
const madres = (a) => a.partidas.map(p => String(p.cuenta).slice(0, 2));
const gastoDe = (a) => a.partidas.filter(p => (p.debe > 0 || p.haber > 0) && p.cuenta !== '4011');
const cuadra = (a) => expect(a.sumDebe).toBeCloseTo(a.sumHaber, 2);

describe('EL CASO QUE REPORTARON LAS CONTADORAS', () => {
  it('la F055-6246 de MARVISUR se asienta en la 63, no en la 60', () => {
    // El movimiento real: S/ 37 con base 31,36 e IGV 5,64, ítem
    // «TRANSPORTE NACIONAL». Antes salía en la 60 porque `category` decía
    // 'Factura' y ningún regex coincidía con eso.
    const a = generarAsiento(compra([item('TRANSPORTE NACIONAL', 1, 31.36)], {
      amount: 37, document_number: 'F055-6246',
      description: 'Factura F055-6246 · AREQUIPA EXPRESO MARVISUR EIRL',
      notas: JSON.stringify({ subtotal: 31.36, igv: 5.64, items_factura: [item('TRANSPORTE NACIONAL', 1, 31.36)] }),
    }), OPTS);

    expect(madres(a)).toContain('63');
    expect(madres(a)).not.toContain('60');
    expect(cuentas(a)).toContain('631');        // Transporte, correos y gastos de viaje
    expect(a.partidas.find(p => p.cuenta === '631').debe).toBeCloseTo(31.36, 2);
    expect(a.partidas.find(p => p.cuenta === '4011').debe).toBeCloseTo(5.64, 2);
    cuadra(a);
  });

  it('sin el reparto, el mismo movimiento vuelve a caer en la 60 — pero avisando', () => {
    const a = generarAsiento(compra([item('TRANSPORTE NACIONAL', 1, 31.36)], { amount: 37 }));
    expect(cuentas(a)).toContain('60');
    expect(a.cuentas.provisional).toBe(true);   // ya no se hace pasar por buena
  });
});

describe('el asiento partido sigue cuadrando', () => {
  it('materiales y herramientas en la misma factura van a dos cuentas', () => {
    const a = generarAsiento(compra([
      item('CEMENTO PORTLAND TIPO I', 10, 80),   // 800 → 602 (60)
      item('CARRETILLA BUGGY', 1, 200),          // 200 → 656 (65)
    ], { amount: 1180 }), OPTS);

    expect(madres(a)).toContain('60');
    expect(madres(a)).toContain('65');
    expect(a.cuadra).toBe(true);
    expect(a.cuentas.partida).toBe(true);
    cuadra(a);
  });

  it('la base repartida suma EXACTAMENTE la base imponible', () => {
    // Con importes que no dividen redondo, el prorrateo deja resto. Si el
    // resto no se absorbe, el asiento descuadra por un centavo y aparece en la
    // herramienta de descuadre como si el dato estuviera roto.
    const a = generarAsiento(compra([
      item('CEMENTO PORTLAND', 3, 33.33),
      item('FLETE TERRESTRE DE MATERIALES', 1, 77.77),
      item('CASCO DE SEGURIDAD', 2, 19.99),
    ], { amount: 260.63 }), OPTS);

    const sumaGasto = a.partidas.filter(p => p.debe > 0 && p.cuenta !== '4011')
      .reduce((s, p) => s + p.debe, 0);
    expect(sumaGasto).toBeCloseTo(a.desglose.subtotal, 2);
    cuadra(a);
  });

  it('cada línea dice de qué es, o no habría forma de distinguirlas', () => {
    const a = generarAsiento(compra([
      item('CEMENTO PORTLAND TIPO I', 10, 80),
      item('CARRETILLA BUGGY', 1, 200),
    ], { amount: 1180 }), OPTS);
    const gasto = gastoDe(a).filter(p => p.debe > 0 && p.cuenta !== '42');
    expect(gasto.length).toBeGreaterThan(1);
    expect(new Set(gasto.map(p => p.descripcion)).size).toBe(gasto.length);
  });

  it('una sola cuenta NO lleva sufijo de familia: no hay nada que distinguir', () => {
    const a = generarAsiento(compra([item('CEMENTO PORTLAND TIPO I', 10, 80)], { amount: 944 }), OPTS);
    const gasto = a.partidas.find(p => p.debe > 0 && p.cuenta !== '4011');
    expect(gasto.descripcion).toBe('Factura F001-1');
  });
});

describe('la cuenta elegida a mano manda sobre todo', () => {
  it('cuenta_pcge le gana al reparto', () => {
    const a = generarAsiento(compra([item('TRANSPORTE NACIONAL', 1, 100)], {
      amount: 118, cuenta_pcge: '659',
    }), OPTS);
    expect(cuentas(a)).toContain('659');
    expect(cuentas(a)).not.toContain('631');
    expect(a.cuentas.manual).toBe(true);
    expect(a.cuentas.provisional).toBe(false);
    cuadra(a);
  });
});

describe('la planilla no se confunde con los gastos de personal facturados', () => {
  it('una CAPACITACIÓN cae en la 62 pero NO es planilla: lleva IGV y se debe a un proveedor', () => {
    // La 624 Capacitación es elemento 62. La regla vieja marcaba planilla con
    // «cuenta === 62» y, si el asiento llevara solo los dos dígitos, le
    // quitaría el IGV a la factura del instituto y se la debería al trabajador
    // (41) en vez de al proveedor (42). Por eso el asiento lleva la subcuenta.
    const a = generarAsiento(compra([item('CAPACITACION EN SEGURIDAD Y SALUD OCUPACIONAL', 1, 100)], {
      amount: 118,
    }), OPTS);
    expect(madres(a)).toContain('62');
    expect(cuentas(a)).toContain('624');
    expect(cuentas(a)).toContain('4011');       // el IGV se mantiene
    expect(cuentas(a)).toContain('42');         // se le debe al proveedor
    expect(cuentas(a)).not.toContain('41');     // NO a remuneraciones
    cuadra(a);
  });

  it('la planilla de verdad sigue funcionando como antes', () => {
    // Sin ítems que clasificar, la cuenta cae al camino viejo — que mira
    // `category` y para la planilla acierta — y da '62' pelada. Ahí sí es
    // planilla: sin IGV y contra Remuneraciones por pagar.
    const a = generarAsiento({
      id: 'p1', type: 'expense', category: 'planilla', amount: 1000,
      payment_status: 'pending', description: 'Planilla setiembre',
    }, OPTS);
    expect(cuentas(a)).toContain('62');
    expect(cuentas(a)).toContain('41');
    expect(cuentas(a)).not.toContain('4011');
    cuadra(a);
  });
});

describe('ventas', () => {
  it('una venta de servicio va a la 70 con su IGV al haber', () => {
    const a = generarAsiento({
      id: 'v1', clase: 'venta', type: 'income', amount: 1180,
      payment_status: 'pending', description: 'Valorización 01',
      notas: JSON.stringify({ items_factura: [item('EJECUCION DE OBRA SEGUN CONTRATO', 1, 1000)] }),
    }, OPTS);
    expect(madres(a)).toContain('70');
    expect(cuentas(a)).toContain('121');
    expect(a.partidas.find(p => p.cuenta === '4011').haber).toBeGreaterThan(0);
    cuadra(a);
  });
});

describe('notas de crédito', () => {
  it('el extorno usa la misma cuenta que la factura que rebaja', () => {
    const a = generarAsiento(compra([item('TRANSPORTE NACIONAL', 1, 100)], {
      amount: -118, document_type: 'nota_credito',
    }), OPTS);
    expect(a.extorno).toBe(true);
    expect(cuentas(a)).toContain('631');
    cuadra(a);
  });
});

describe('el lote entero', () => {
  it('generarAsientosBatch pasa el reparto a cada asiento', () => {
    const asientos = generarAsientosBatch([
      compra([item('TRANSPORTE NACIONAL', 1, 100)], { id: 'a', amount: 118 }),
      compra([item('CEMENTO PORTLAND TIPO I', 1, 100)], { id: 'b', amount: 118 }),
    ], OPTS);
    expect(asientos).toHaveLength(2);
    expect(asientos.flatMap(madres)).toContain('63');
    expect(asientos.flatMap(madres)).toContain('60');
    asientos.forEach(cuadra);
  });

  it('sin opts se comporta como siempre — nada se rompe por no pasarle nada', () => {
    const asientos = generarAsientosBatch([compra([item('CEMENTO', 1, 100)])]);
    expect(asientos).toHaveLength(1);
    asientos.forEach(cuadra);
  });
});
