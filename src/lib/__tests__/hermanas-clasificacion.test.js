// ═══════════════════════════════════════════════════════════════════
// EL AVISO DE CONTRADICCIÓN CONTRA LAS HERMANAS (tanda 3, 15-set-2026).
//
// El caso real: «TUBO E. CUAD. 3/4IN * 1.2» y «… * 1.5» quedaron en dos
// clasificaciones distintas y nadie se enteró. Y el otro, medido en producción
// en la tanda 1: las cinco maneras de escribir ABRAZADERA en cinco códigos.
//
// La mitad de estos tests defiende que el aviso SALTE; la otra mitad, que NO
// salte de más. Un cartel que aparece cuando no corresponde deja de leerse a la
// tercera vez, y entonces no sirve cuando sí corresponde.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  raizDeDescripcion, indiceDeHermanas, hermanasDe, avisoDeContradiccion,
} from '../hermanas-clasificacion.js';

describe('la raíz de una descripción', () => {
  it('🔴 las dos gemelas tienen la MISMA raíz: cambian solo las medidas', () => {
    expect(raizDeDescripcion('TUBO E. CUAD. 3/4IN * 1.2'))
      .toBe(raizDeDescripcion('TUBO E. CUAD. 3/4IN * 1.5'));
  });

  it('la marca no cambia qué es la cosa', () => {
    expect(raizDeDescripcion('MESA DE MELAMINE MARCA QUADRA'))
      .toBe(raizDeDescripcion('MESA DE MELAMINE 1.20 X 0.60'));
  });

  it('dos materiales distintos NO son hermanos', () => {
    expect(raizDeDescripcion('TUBO PVC 2"')).not.toBe(raizDeDescripcion('TUBO HDPE 2"'));
    expect(raizDeDescripcion('VALVULA COMPUERTA BRONCE 1/2'))
      .not.toBe(raizDeDescripcion('VALVULA COMPUERTA HIERRO 1/2'));
  });

  it('una sola palabra con contenido no alcanza para tener hermanas', () => {
    // «TUBO 2"» contra «TUBO 4"» no es evidencia de nada: medio catálogo dice
    // tubo. Sin dos palabras, no hay raíz.
    expect(raizDeDescripcion('TUBO 2"')).toBe('');
    expect(raizDeDescripcion('CEMENTO')).toBe('');
    expect(raizDeDescripcion('')).toBe('');
    expect(raizDeDescripcion(null)).toBe('');
  });

  it('el orden de las palabras no importa, el conjunto sí', () => {
    expect(raizDeDescripcion('ALAMBRE NEGRO RECOCIDO'))
      .toBe(raizDeDescripcion('RECOCIDO NEGRO ALAMBRE'));
  });
});

describe('el aviso', () => {
  const DECIDIDAS = [
    { texto: 'TUBO E. CUAD. 3/4IN * 1.5', codigo: '65' },
    { texto: 'TUBO E. CUAD. 1IN * 2.0', codigo: '65' },
    { texto: 'TUBO E. CUAD. 2IN * 1.5', codigo: '65' },
    { texto: 'CEMENTO PORTLAND TIPO I 42.5', codigo: '21' },
  ];
  const idx = indiceDeHermanas(DECIDIDAS);

  it('🔴 salta cuando la propuesta contradice a las hermanas', () => {
    const h = hermanasDe('TUBO E. CUAD. 3/4IN * 1.2', idx);
    expect(h.codigos[0]).toMatchObject({ codigo: '65', veces: 3 });
    const a = avisoDeContradiccion('03', h);
    expect(a).toMatchObject({ codigo: '65', veces: 3, unanime: true });
    expect(a.ejemplo).toMatch(/TUBO E\. CUAD/);
  });

  it('NO salta cuando la propuesta coincide con las hermanas', () => {
    const h = hermanasDe('TUBO E. CUAD. 3/4IN * 1.2', idx);
    expect(avisoDeContradiccion('65', h)).toBe(null);
  });

  it('NO salta si no hay hermanas — que es el caso normal', () => {
    expect(hermanasDe('LADRILLO KING KONG 18 HUECOS', idx)).toBe(null);
    expect(avisoDeContradiccion('17', null)).toBe(null);
  });

  it('🔴 una fila NO es hermana de sí misma', () => {
    // Sin esto, una descripción YA decidida siempre encontraría su propio
    // código entre el de sus hermanas y jamás se avisaría de la contradicción
    // — que es justo la que hay que ver: la que quedó sola en otro código.
    const conIntrusa = indiceDeHermanas([...DECIDIDAS, { texto: 'TUBO E. CUAD. 3/4IN * 1.2', codigo: '03' }]);
    const h = hermanasDe('TUBO E. CUAD. 3/4IN * 1.2', conIntrusa);
    expect(h.codigos.map(c => c.codigo)).toEqual(['65']);
    expect(avisoDeContradiccion('03', h)).toMatchObject({ codigo: '65', veces: 3 });
  });

  it('cuando las hermanas ya venían divididas, el aviso lo dice', () => {
    const dividida = indiceDeHermanas([
      { texto: 'ABRAZADERA SIN FIN 1/2', codigo: '26' },
      { texto: 'ABRAZADERA SIN FIN 2', codigo: '26' },
      { texto: 'ABRAZADERA SIN FIN 3/4', codigo: '65' },
    ]);
    const a = avisoDeContradiccion('37', hermanasDe('ABRAZADERA SIN FIN 1', dividida));
    expect(a).toMatchObject({ codigo: '26', veces: 2, unanime: false, total: 3 });
  });

  it('la misma descripción por dos caminos cuenta UNA vez', () => {
    // La decisión de la bandeja Y el término que esa decisión le enseñó al
    // diccionario son la misma descripción: contarla dos veces inflaría el
    // «ya se decidieron 6 así» con un 6 que no existe.
    const dup = indiceDeHermanas([
      { texto: 'TUBO E. CUAD. 3/4IN * 1.5', codigo: '65' },
      { texto: 'tubo e. cuad. 3/4in * 1.5', codigo: '65' },
      { texto: 'TUBO E. CUAD. 1IN * 2.0', codigo: '65' },
    ]);
    expect(hermanasDe('TUBO E. CUAD. 3/4IN * 1.2', dup).total).toBe(2);
  });

  it('«no es un insumo» y «sin clasificar» no contradicen a nadie', () => {
    const conVacias = indiceDeHermanas([
      { texto: 'TUBO E. CUAD. 3/4IN * 1.5', codigo: null },
      { texto: 'TUBO E. CUAD. 1IN * 2.0', codigo: 'sin_clasificar' },
    ]);
    expect(hermanasDe('TUBO E. CUAD. 3/4IN * 1.2', conVacias)).toBe(null);
  });
});
