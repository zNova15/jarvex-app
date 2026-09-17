import { describe, it, expect } from 'vitest';
import { encodarHastaObjetivo, ESCALONES, pixelesUniformes } from '../optimizar-imagen.js';

// La escalera de compresión, sin canvas ni navegador. `encode(dim, q)` se
// simula: modela que a menor calidad, menor tamaño.
const blob = (size) => ({ size });

describe('encodarHastaObjetivo — la escalera que acota el peso', () => {
  it('corta en el primer escalón si ya cumple (la foto simple no se degrada)', async () => {
    const pedidos = [];
    const out = await encodarHastaObjetivo(async (dim, q) => {
      pedidos.push(q);
      return blob(120 * 1024);
    });
    expect(out.size).toBe(120 * 1024);
    // Lo importante: NO siguió bajando calidad de una foto que ya estaba bien.
    expect(pedidos).toEqual([0.78]);
  });

  it('baja de escalón hasta alcanzar el objetivo (el caso de la factura)', async () => {
    // Foto de documento: a 0.78 pesa 900 KB (el caso medido en producción),
    // a 0.62 entra bajo el techo.
    const porCalidad = { 0.78: 900 * 1024, 0.62: 330 * 1024 };
    const pedidos = [];
    const out = await encodarHastaObjetivo(async (dim, q) => {
      pedidos.push({ dim, q });
      return blob(porCalidad[q]);
    });
    expect(out.size).toBe(330 * 1024);
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]).toEqual({ dim: null, q: 0.62 });
  });

  it('si ningún escalón alcanza, devuelve el último y NO sigue degradando', async () => {
    const out = await encodarHastaObjetivo(async () => blob(2 * 1024 * 1024));
    expect(out.size).toBe(2 * 1024 * 1024);
    // La escalera tiene fondo: una evidencia ilegible es peor que una pesada.
    expect(ESCALONES).toHaveLength(3);
    expect(Math.min(...ESCALONES.map(e => e.q))).toBeGreaterThanOrEqual(0.56);
  });

  it('el último escalón baja RESOLUCIÓN, no más calidad', async () => {
    const ultimo = ESCALONES[ESCALONES.length - 1];
    expect(ultimo.dim).toBe(1280);
    // Bajar calidad por debajo de 0.62 embarra el texto antes que reducir px.
    expect(ultimo.q).toBe(ESCALONES[ESCALONES.length - 2].q);
  });

  it('los dos primeros escalones reusan el lienzo (dim null = no redibujar)', async () => {
    expect(ESCALONES[0].dim).toBeNull();
    expect(ESCALONES[1].dim).toBeNull();
  });

  it('un escalón que falla no aborta la cadena', async () => {
    const out = await encodarHastaObjetivo(async (dim, q) =>
      q === 0.78 ? null : blob(200 * 1024));
    expect(out.size).toBe(200 * 1024);
  });

  it('devuelve null si TODOS los escalones fallan (el caller sube el original)', async () => {
    expect(await encodarHastaObjetivo(async () => null)).toBeNull();
  });

  it('respeta un objetivo a medida', async () => {
    const out = await encodarHastaObjetivo(
      async (dim, q) => blob(q === 0.78 ? 300 * 1024 : 100 * 1024),
      150 * 1024);
    expect(out.size).toBe(100 * 1024);   // 300 KB no cumplía un techo de 150
  });
});

// Incidente del 16-set-2026: dos facturas del portal de campo se guardaron
// como un JPEG BLANCO de 720×1600 (7.508 bytes, las dos idénticas byte a
// byte). El decoder decía que sí, pero al lienzo no llegaba nada.
describe('pixelesUniformes — el detector de lienzo en blanco', () => {
  // RGBA plano, como getImageData: n píxeles del mismo color.
  const planos = (n, [r, g, b]) => Uint8ClampedArray.from(
    Array.from({ length: n }, () => [r, g, b, 255]).flat());

  it('detecta el blanco liso, que es como salía la factura perdida', () => {
    expect(pixelesUniformes(planos(64, [255, 255, 255]))).toBe(true);
  });

  it('detecta cualquier color liso, no solo el blanco', () => {
    expect(pixelesUniformes(planos(64, [0, 0, 0]))).toBe(true);
    expect(pixelesUniformes(planos(64, [17, 90, 200]))).toBe(true);
  });

  it('un solo píxel distinto ya NO es uniforme: la foto se conserva', () => {
    const d = planos(64, [255, 255, 255]);
    d[4 * 40] = 30;   // una marca de tinta en algún lado
    expect(pixelesUniformes(d)).toBe(false);
  });

  it('tolera el ruido mínimo del reescalado (no descarta una foto buena)', () => {
    const d = planos(64, [255, 255, 255]);
    d[4] = 254; d[8] = 253;
    expect(pixelesUniformes(d)).toBe(true);
  });

  it('ante datos vacíos o ausentes NO acusa blanco (la duda no descarta nada)', () => {
    expect(pixelesUniformes(null)).toBe(false);
    expect(pixelesUniformes(new Uint8ClampedArray([]))).toBe(false);
    expect(pixelesUniformes(new Uint8ClampedArray([255, 255, 255, 255]))).toBe(false);
  });
});
