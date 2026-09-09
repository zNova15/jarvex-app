import { describe, it, expect } from 'vitest';
import { crearProgreso, pctDeCorrida, FASES_ANALISIS } from '../bases-progreso.js';

/** Junta los avisos para poder mirar la última barra emitida. */
function espia() {
  const avisos = [];
  const prog = crearProgreso(p => avisos.push(p));
  return { prog, avisos, ultimo: () => avisos[avisos.length - 1] };
}

describe('crearProgreso — el reparto del reloj', () => {
  it('arranca en 0 y no llega a 100 hasta que terminó', () => {
    const { prog } = espia();
    expect(prog.valor()).toBe(0);
    for (const f of FASES_ANALISIS) { prog.plan(f.clave, 1); prog.avance(f.clave, 1); }
    // Todo hecho, pero sin fin(): el techo es 99.
    expect(prog.valor()).toBe(99);
    prog.fin();
    expect(prog.valor()).toBe(100);
  });

  it('fin() avisa con paso "listo" y 100', () => {
    const { prog, ultimo } = espia();
    prog.fin();
    expect(ultimo()).toMatchObject({ paso: 'listo', pct: 100 });
  });

  it('una fase que no va a correr sale del denominador', () => {
    // Sin OCR (documento nativo o en caché), la barra NO arranca en 42%.
    const { prog } = espia();
    prog.plan('ocr', 0);
    expect(prog.valor()).toBe(0);
    // Y las demás fases se reparten el 100 entre ellas: cerrar 'indice' y
    // 'localizar' vale más de lo que valdría con el OCR en el denominador.
    prog.plan('indice', 1); prog.avance('indice', 1);
    prog.plan('localizar', 1); prog.avance('localizar', 1);
    const sinOcr = prog.valor();

    const b = espia();
    b.prog.plan('ocr', 10);
    b.prog.plan('indice', 1); b.prog.avance('indice', 1);
    b.prog.plan('localizar', 1); b.prog.avance('localizar', 1);
    expect(sinOcr).toBeGreaterThan(b.prog.valor());
  });

  it('la barra nunca retrocede aunque el denominador crezca', () => {
    const { prog } = espia();
    prog.plan('ocr', 0);
    prog.plan('indice', 1); prog.avance('indice', 1);
    prog.plan('localizar', 1); prog.avance('localizar', 1);
    prog.plan('extraer', 4); prog.avance('extraer', 4);
    prog.plan('barrido', 0);
    const antes = prog.valor();
    // El barrido aparece a último momento (la lectura dirigida no encontró
    // nada): el denominador crece de golpe. La barra se queda quieta.
    prog.plan('barrido', 16);
    expect(prog.valor()).toBe(antes);
    prog.avance('barrido', 16);
    expect(prog.valor()).toBeGreaterThanOrEqual(antes);
  });

  it('en() es absoluto y avance() es delta', () => {
    const { prog } = espia();
    prog.plan('ocr', 10);
    prog.en('ocr', 6);
    prog.en('ocr', 6);            // el OCR reavisa con el mismo acumulado
    const a = prog.valor();
    prog.avance('ocr', 2);        // 6 + 2
    expect(prog.valor()).toBeGreaterThan(a);
    prog.en('ocr', 999);          // no se pasa del total
    prog.cerrar('ocr');
    expect(prog.valor()).toBeLessThanOrEqual(99);
  });

  it('cerrar() da la fase por hecha aunque falten unidades', () => {
    const { prog } = espia();
    prog.plan('ocr', 0); prog.plan('indice', 0); prog.plan('localizar', 0);
    prog.plan('extraer', 10); prog.avance('extraer', 3);
    prog.plan('barrido', 0); prog.plan('verificar', 0);
    const aMedias = prog.valor();
    prog.cerrar('extraer');
    expect(prog.valor()).toBeGreaterThan(aMedias);
    expect(prog.valor()).toBe(99);   // todo cerrado, pero sin fin()
  });

  it('cerrar() una fase que nunca se planificó la saca del denominador', () => {
    const { prog } = espia();
    prog.plan('ocr', 0); prog.plan('indice', 1); prog.avance('indice', 1);
    prog.plan('localizar', 1); prog.avance('localizar', 1);
    prog.plan('extraer', 2); prog.avance('extraer', 2);
    prog.plan('verificar', 1); prog.avance('verificar', 1);
    // 'barrido' jamás se planificó: sin esto se quedaría reteniendo su peso.
    prog.cerrar('barrido');
    expect(prog.valor()).toBe(99);
  });

  it('el aviso lleva paso, pct y el detalle que le pasen', () => {
    const { prog, ultimo } = espia();
    prog.plan('extraer', 4);
    prog.avance('extraer', 1, { detalle: 'personal · 21–23' });
    expect(ultimo()).toMatchObject({ paso: 'extraer', detalle: 'personal · 21–23', hecho: 1, total: 4 });
    expect(ultimo().pct).toBeGreaterThanOrEqual(0);
  });

  it('un plan inválido se trata como «no va a correr»', () => {
    const { prog } = espia();
    prog.plan('ocr', NaN);
    prog.plan('indice', -3);
    prog.plan('localizar', 1); prog.avance('localizar', 1);
    prog.plan('extraer', 0); prog.plan('barrido', 0); prog.plan('verificar', 0);
    expect(prog.valor()).toBe(99);
  });

  it('planificar una fase clave que no existe no rompe nada', () => {
    const { prog, ultimo } = espia();
    prog.plan('inexistente', 5);
    prog.avance('inexistente', 1, { detalle: 'x' });
    expect(ultimo()).toMatchObject({ paso: 'inexistente', detalle: 'x' });
  });
});

describe('pctDeCorrida — dos lecturas, una sola barra', () => {
  it('con una sola corrida devuelve el mismo porcentaje', () => {
    expect(pctDeCorrida(0, 0, 1)).toBe(0);
    expect(pctDeCorrida(37, 0, 1)).toBe(37);
    expect(pctDeCorrida(100, 0, 1)).toBe(100);
  });

  it('con dos corridas, la primera ocupa la mitad de abajo', () => {
    expect(pctDeCorrida(0, 0, 2)).toBe(0);
    expect(pctDeCorrida(100, 0, 2)).toBe(50);
    expect(pctDeCorrida(0, 1, 2)).toBe(50);
    expect(pctDeCorrida(100, 1, 2)).toBe(100);
  });

  it('no retrocede al pasar de una corrida a la siguiente', () => {
    // El caso que esto cierra: la barra se llenaba, volvía a cero y arrancaba
    // de nuevo, que se lee como que la primera lectura se perdió.
    expect(pctDeCorrida(99, 0, 2)).toBeLessThanOrEqual(pctDeCorrida(1, 1, 2));
  });

  it('aguanta valores fuera de rango', () => {
    expect(pctDeCorrida(-10, 0, 2)).toBe(0);
    expect(pctDeCorrida(150, 1, 2)).toBe(100);
    expect(pctDeCorrida(undefined, 0, 2)).toBe(0);
    expect(pctDeCorrida(50, 9, 2)).toBe(75);   // el índice se recorta al último
    expect(pctDeCorrida(50, 0, 0)).toBe(50);
  });
});
