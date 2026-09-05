import { describe, it, expect } from 'vitest';
import { etiquetaMotorIa, segundos } from '../ia-motor.js';

describe('segundos — formato es-PE', () => {
  it('usa coma decimal', () => {
    expect(segundos(3512)).toBe('3,5 s');
    expect(segundos(890)).toBe('0,9 s');
  });
  it('no inventa un tiempo que no llegó', () => {
    expect(segundos(undefined)).toBe(null);
    expect(segundos(null)).toBe(null);
    expect(segundos(-1)).toBe(null);
  });
});

describe('etiquetaMotorIa — la etiqueta no puede mentir', () => {
  it('el camino normal se nombra por sus dos piezas', () => {
    const e = etiquetaMotorIa({ engine: 'mistral-ocr+openrouter', model: 'inclusionai/ling-3.0-flash-fin:free', proveedor: 'Novita', ms: 3300 });
    expect(e.texto).toBe('Mistral OCR + OpenRouter');
    expect(e.respaldo).toBe(false);
    expect(e.tiempo).toBe('3,3 s');
    expect(e.detalle).toContain('inclusionai/ling-3.0-flash-fin:free');
    expect(e.detalle).toContain('Novita');
  });

  it('cuando lo terminó el respaldo, LO DICE (es la señal de que el titular falla)', () => {
    const e = etiquetaMotorIa({ engine: 'mistral-ocr+claude(respaldo)', model: 'claude-haiku-4-5-20251001', ms: 9000 });
    expect(e.respaldo).toBe(true);
    expect(e.texto).toContain('respaldo');
    expect(e.detalle).toContain('motor de respaldo');
  });

  it('el fallback de visión también es un camino excepcional', () => {
    expect(etiquetaMotorIa({ engine: 'claude-vision', ms: 20000 }).respaldo).toBe(true);
  });

  it('muestra el modelo REALMENTE servido, que puede no ser el titular configurado', () => {
    const e = etiquetaMotorIa({ engine: 'mistral-ocr+openrouter', model: 'minimax/minimax-m3:free', proveedor: 'GMICloud', ms: 3000 });
    expect(e.detalle).toContain('minimax/minimax-m3:free');
  });

  it('un motor desconocido se muestra tal cual en vez de desaparecer', () => {
    expect(etiquetaMotorIa({ engine: 'motor-nuevo', ms: 1000 }).texto).toBe('motor-nuevo');
  });

  it('las filas viejas (sin motor guardado) no rompen nada', () => {
    expect(etiquetaMotorIa(null)).toBe(null);
    expect(etiquetaMotorIa({})).toBe(null);
    expect(etiquetaMotorIa({ ms: 100 })).toBe(null);
  });

  it('sin tiempo medido, el resto de la etiqueta sigue sirviendo', () => {
    const e = etiquetaMotorIa({ engine: 'mistral-ocr+claude', model: 'claude-haiku-4-5-20251001' });
    expect(e.texto).toBe('Mistral OCR + Claude');
    expect(e.tiempo).toBe(null);
    expect(e.detalle).toContain('claude-haiku-4-5-20251001');
  });
});
