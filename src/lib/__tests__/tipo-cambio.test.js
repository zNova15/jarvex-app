import { describe, it, expect } from 'vitest';
import {
  UMBRAL_BANCARIZACION_PEN,
  UMBRAL_BANCARIZACION_USD,
  obtenerTipoCambio,
  convertirMoneda,
  requiereBancarizacion,
  registrarTipoCambio,
} from '../tipo-cambio.js';

describe('tipo-cambio: umbrales y conversión', () => {
  it('define los umbrales legales del D.L. 1529', () => {
    expect(UMBRAL_BANCARIZACION_PEN).toBe(2000);
    expect(UMBRAL_BANCARIZACION_USD).toBe(500);
  });

  it('obtiene tipo de cambio referencial o histórico', () => {
    const tc = obtenerTipoCambio('2026-09-12');
    expect(tc.venta).toBeGreaterThan(3.5);
    expect(tc.compra).toBeLessThanOrEqual(tc.venta);
  });

  it('permite registrar tipos de cambio personalizados', () => {
    registrarTipoCambio('2026-05-15', { compra: 3.72, venta: 3.73, fuente: 'test' });
    const tc = obtenerTipoCambio('2026-05-15');
    expect(tc.venta).toBe(3.73);
    expect(tc.compra).toBe(3.72);
  });

  it('convierte montos USD a PEN correctamente', () => {
    const soles = convertirMoneda({
      monto: 1000,
      monedaOrigen: 'USD',
      monedaDestino: 'PEN',
      tipoCambio: 3.75,
    });
    expect(soles).toBe(3750);
  });

  it('convierte montos PEN a USD correctamente', () => {
    const dolares = convertirMoneda({
      monto: 3750,
      monedaOrigen: 'PEN',
      monedaDestino: 'USD',
      tipoCambio: 3.75,
    });
    expect(dolares).toBe(1000);
  });

  it('mantiene el mismo monto si las monedas coinciden', () => {
    expect(convertirMoneda({ monto: 500, monedaOrigen: 'PEN', monedaDestino: 'PEN' })).toBe(500);
    expect(convertirMoneda({ monto: 800, monedaOrigen: 'USD', monedaDestino: 'USD' })).toBe(800);
  });
});

describe('requiereBancarizacion (D.L. 1529)', () => {
  it('en PEN: >= 2000 requiere bancarización, < 2000 no', () => {
    expect(requiereBancarizacion(2000, 'PEN')).toBe(true);
    expect(requiereBancarizacion(3500, 'PEN')).toBe(true);
    expect(requiereBancarizacion(1999.99, 'PEN')).toBe(false);
    expect(requiereBancarizacion(500, 'PEN')).toBe(false);
  });

  it('en USD: >= 500 requiere bancarización obligatoria por ley', () => {
    expect(requiereBancarizacion(500, 'USD')).toBe(true);
    expect(requiereBancarizacion(9000, 'USD')).toBe(true);
    expect(requiereBancarizacion(550, 'USD')).toBe(true);
  });

  it('en USD: < 500 no requiere a menos que supere S/ 2000 al cambio', () => {
    // 400 USD * 3.75 = 1500 PEN (no supera 2000 y es < 500 USD)
    expect(requiereBancarizacion(400, 'USD', 3.75)).toBe(false);
    // 600 USD (supera 500 USD)
    expect(requiereBancarizacion(600, 'USD', 3.75)).toBe(true);
  });
});

