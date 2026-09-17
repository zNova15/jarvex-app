import { describe, it, expect } from 'vitest';
import { evaluarCalidadComprobante, BPP_MINIMO, LADO_MINIMO } from '../calidad-foto.js';

// Las medidas REALES de producción, bajadas de R2 el 17-set-2026. Son la razón
// de ser del umbral, así que son los casos que hay que defender: si alguien lo
// mueve, estos tests dicen a quién deja afuera.
const REALES_BUENAS = [
  { nombre: 'la peor legible del lote', bytes: 129659, ancho: 1200, alto: 1600 },   // 0,5402 bpp
  { nombre: 'una típica de campo', bytes: 163092, ancho: 1200, alto: 1600 },        // 0,6795 bpp
  { nombre: 'la de más detalle', bytes: 1055225, ancho: 1440, alto: 1920 },         // 3,0533 bpp
  { nombre: 'un ticket chico registrado', bytes: 130035, ancho: 901, alto: 1600 },  // 0,7216 bpp
];
// Las dos facturas que se subieron en blanco (720×1600, 7.508 B → 0,0521 bpp).
const REAL_EN_BLANCO = { bytes: 7508, ancho: 720, alto: 1600 };

describe('evaluarCalidadComprobante — atrapa la foto vacía sin frenar las buenas', () => {
  it.each(REALES_BUENAS)('deja pasar $nombre', (foto) => {
    expect(evaluarCalidadComprobante(foto).ok).toBe(true);
  });

  it('frena la factura en blanco del 16-set (el caso que originó todo)', () => {
    const v = evaluarCalidadComprobante(REAL_EN_BLANCO);
    expect(v.ok).toBe(false);
    expect(v.motivo).toMatch(/blanco|legible/i);
  });

  it('el umbral deja margen REAL para los dos lados', () => {
    const peorBuena = (129659 * 8) / (1200 * 1600);     // 0,5402
    const enBlanco = (7508 * 8) / (720 * 1600);          // 0,0521
    // Como el portal BLOQUEA, el margen contra un falso positivo es lo que
    // importa: la peor foto buena tiene que estar MUY por encima del umbral.
    expect(peorBuena / BPP_MINIMO).toBeGreaterThan(3);
    expect(BPP_MINIMO / enBlanco).toBeGreaterThan(2);
  });

  it('frena una miniatura aunque tenga mucho detalle por píxel', () => {
    // 300×400 bien nítida: alto bpp, pero no hay dónde leer un RUC.
    const v = evaluarCalidadComprobante({ bytes: 60000, ancho: 300, alto: 400 });
    expect(v.ok).toBe(false);
    expect(v.motivo).toMatch(/chica/i);
    expect(LADO_MINIMO).toBe(640);
  });

  it('LO QUE NO SE PUDO MEDIR NO SE JUZGA: un PDF o un HEIC sin dimensiones pasa', () => {
    // Bloquear por no haber podido mirar dejaría a alguien en la obra sin
    // poder mandar un comprobante perfectamente bueno.
    expect(evaluarCalidadComprobante(null).ok).toBe(true);
    expect(evaluarCalidadComprobante({}).ok).toBe(true);
    expect(evaluarCalidadComprobante({ bytes: 50896 }).ok).toBe(true);
    expect(evaluarCalidadComprobante({ bytes: 0, ancho: 1200, alto: 1600 }).ok).toBe(true);
  });

  it('devuelve el bpp medido, para poder diagnosticar sin adivinar', () => {
    const v = evaluarCalidadComprobante(REAL_EN_BLANCO);
    expect(v.bpp).toBeCloseTo(0.0521, 3);
  });
});
