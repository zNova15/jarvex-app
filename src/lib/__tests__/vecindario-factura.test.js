// ═══════════════════════════════════════════════════════════════════
// LO QUE VINO EN LA MISMA FACTURA (tanda 9, 15-set-2026).
//
// Los dos casos reales que lo pidieron, con las líneas textuales de las
// facturas de producción. Gabriel tuvo que buscarlos en Google Imágenes porque
// ni el motor local ni la IA sabían qué eran; el comprobante ya lo decía.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { vecindarioDeFactura, vecindarioDeFila } from '../vecindario-factura.js';
import { normMapeo } from '../mapeo-insumos.js';

const li = (movId, nombre, cantidad, precio, extra = {}) => ({
  movId, nombre, cantidad, precio, unidad: 'und', clase: 'compra',
  proveedorNombre: 'PROV', doc: 'E001-1', ...extra,
});

// E001-85 de CASAS LLICO: la factura de pintura de pared, textual.
const PINTURA = [
  li('m1', 'PASTA FINA CPP', 30, 101.69, { unidad: 'gal' }),
  li('m1', 'PINTURA LAVABLE PATO', 30, 49.15),
  li('m1', 'PINTURA LAVABLE CREMA PATO', 18, 63.56),
  li('m1', 'BROCHA TUMI 4 PULGADAS', 15, 38.14),
  li('m1', 'RODILLO DE 9 PULGADAS TORO', 12, 13.56),
  li('m1', 'LIJA', 35, 2.12),
].map(x => ({ ...x, proveedorNombre: 'CASAS LLICO JHON MARCK', doc: 'E001-85' }));

// E001-73 de M & G: estructura metálica y cobertura, textual.
const METAL = [
  li('m2', 'SUPER. TR4 0.25 X 1.05 X 6MTS ALZN', 36, 100.93),
  li('m2', 'PL. GALV. 0.80 X 1200 X 2400', 18, 77.12),
  li('m2', 'PL. GALV. 0.90 X 1200 X 2400', 28, 86.95),
  li('m2', 'TUBO LAC RECT. 2 PULG X 4 PULG X 1/8', 34, 118.47),
].map(x => ({ ...x, proveedorNombre: 'M & G CONTRATISTAS DEL PERU E.I.R.L.', doc: 'E001-73' }));

describe('el vecindario de una descripción', () => {
  it('🔴 «PASTA FINA CPP» llega con las pinturas al lado', () => {
    const m = vecindarioDeFactura(PINTURA);
    const v = m.get(normMapeo('PASTA FINA CPP'));
    expect(v.proveedor).toBe('CASAS LLICO JHON MARCK');
    const nombres = v.vecinos.map(x => x.nombre);
    expect(nombres).toContain('PINTURA LAVABLE PATO');
    expect(nombres).toContain('BROCHA TUMI 4 PULGADAS');
    // Y NO se incluye a sí misma: sería ruido en el prompt.
    expect(nombres).not.toContain('PASTA FINA CPP');
  });

  it('🔴 «SUPER. TR4 … ALZN» llega con las planchas, no con tubos solamente', () => {
    const m = vecindarioDeFactura(METAL);
    const v = m.get(normMapeo('SUPER. TR4 0.25 X 1.05 X 6MTS ALZN'));
    const nombres = v.vecinos.map(x => x.nombre);
    expect(nombres).toContain('PL. GALV. 0.80 X 1200 X 2400');
    expect(nombres).toContain('PL. GALV. 0.90 X 1200 X 2400');
  });

  it('la unidad de cada vecino viaja: dice de qué se habla', () => {
    const m = vecindarioDeFactura(PINTURA);
    const v = m.get(normMapeo('PINTURA LAVABLE PATO'));
    expect(v.vecinos.find(x => x.nombre === 'PASTA FINA CPP').unidad).toBe('gal');
  });

  it('no mezcla facturas distintas', () => {
    const m = vecindarioDeFactura([...PINTURA, ...METAL]);
    const nombres = m.get(normMapeo('PASTA FINA CPP')).vecinos.map(x => x.nombre);
    expect(nombres.some(n => n.startsWith('PL. GALV'))).toBe(false);
  });

  it('las ventas no son vecindario de compra', () => {
    const m = vecindarioDeFactura([
      li('mv', 'ALGO', 1, 10, { clase: 'venta' }),
      li('mv', 'OTRO', 1, 10, { clase: 'venta' }),
    ]);
    expect(m.size).toBe(0);
  });

  it('una descripción sola en su factura no tiene vecinos', () => {
    const m = vecindarioDeFactura([li('m9', 'SOLITARIA', 1, 100)]);
    expect(m.get(normMapeo('SOLITARIA')).vecinos).toHaveLength(0);
  });

  it('el tope de vecinos se respeta: más no aclara y sí cuesta', () => {
    const muchas = Array.from({ length: 30 }, (_, i) => li('mX', `ITEM ${i}`, 1, 10));
    const m = vecindarioDeFactura(muchas, { maxVecinos: 8 });
    expect(m.get(normMapeo('ITEM 0')).vecinos).toHaveLength(8);
  });
});

describe('🔴 de qué factura se toman', () => {
  it('de aquella donde la descripción movió MÁS plata, no de la última', () => {
    const chica = [
      li('chica', 'CEMENTO', 1, 10),
      li('chica', 'VECINO DE LA CHICA', 1, 10),
    ];
    const grande = [
      li('grande', 'CEMENTO', 500, 30),
      li('grande', 'VECINO DE LA GRANDE', 1, 10),
    ];
    const m = vecindarioDeFactura([...grande, ...chica]);
    const nombres = m.get(normMapeo('CEMENTO')).vecinos.map(x => x.nombre);
    expect(nombres).toEqual(['VECINO DE LA GRANDE']);
  });

  it('con todo en cero igual queda una elegida, no ninguna', () => {
    const m = vecindarioDeFactura([
      li('m0', 'ANTICIPO DE CLIENTE', 1, 0),
      li('m0', 'OTRA COSA', 1, 0),
    ]);
    expect(m.get(normMapeo('ANTICIPO DE CLIENTE')).vecinos).toHaveLength(1);
  });
});

describe('la fila de la bandeja', () => {
  const mapa = vecindarioDeFactura(PINTURA);

  it('encuentra el vecindario por su norm', () => {
    const v = vecindarioDeFila({ norm: normMapeo('PASTA FINA CPP') }, mapa);
    expect(v.vecinos.length).toBeGreaterThan(0);
  });

  it('una fila correlacionada usa la variante de mayor importe que tenga vecinos', () => {
    const v = vecindarioDeFila({
      norm: 'x',
      variantes: [
        { norm: 'sin-vecinos', importe: 10 },
        { norm: normMapeo('PASTA FINA CPP'), importe: 5 },
      ],
    }, mapa);
    expect(v.vecinos.map(x => x.nombre)).toContain('PINTURA LAVABLE PATO');
  });

  it('sin vecindario devuelve null — el prompt no paga un encabezado vacío', () => {
    expect(vecindarioDeFila({ norm: 'no-existe' }, mapa)).toBeNull();
    expect(vecindarioDeFila(null, mapa)).toBeNull();
    expect(vecindarioDeFila({ norm: 'x' }, null)).toBeNull();
  });
});
