import { describe, it, expect } from 'vitest';
import { evidenciaDiccionario } from '../indices-unificados-iupc.js';

// ═══════════════════════════════════════════════════════════════════
// La evidencia que se le pone delante a la IA (15-sep-2026).
//
// Gabriel: «veo una barbaridad de errores en las recomendaciones de la IA, y
// creo que hace las recomendaciones sin base en los índices unificados y el
// diccionario que propone el Estado peruano». Era literal: al modelo se le
// mandaban los 95 códigos con su nombre y nada más. Estos tests fijan que los
// tres casos que reportó sí encuentren (o no) evidencia del Anexo 2.
// ═══════════════════════════════════════════════════════════════════

const codigos = (ev) => ev.map(g => g.codigo);

describe('evidenciaDiccionario', () => {
  // El caso 1 de Gabriel: la IA dijo [48] Maquinaria y equipo de construcción
  // liviano. El diccionario tiene todos los alambres de acero bajo [02].
  it('«ALAMBRE DE AMARRE #8» trae los alambres del Anexo 2, con [02] adelante', () => {
    const ev = evidenciaDiccionario('ALAMBRE DE AMARRE #8');
    expect(ev.length).toBeGreaterThan(0);
    expect(ev[0].codigo).toBe('02');
    expect(ev[0].terminos.join(' | ').toLowerCase()).toMatch(/alambre/);
    // Y [48] Maquinaria, que es lo que la IA había contestado, NO aparece.
    expect(codigos(ev)).not.toContain('48');
  });

  // El caso 2: "ABRAZ. SIN FIN 8 M". El diccionario tiene abrazaderas en tres
  // materiales distintos — la evidencia tiene que mostrarlos a todos para que
  // la decisión se tome mirando el material, no adivinando.
  it('«ABRAZADERA» trae los tres materiales que distingue la norma', () => {
    const ev = evidenciaDiccionario('ABRAZADERA SIN FIN 8 M');
    const cods = codigos(ev);
    expect(cods).toContain('02');   // Abrazadera de acero
    expect(cods).toContain('71');   // Abrazadera de hierro / hierro dúctil
    expect(cods).toContain('72');   // Abrazadera de PVC / polipropileno
  });

  // El caso 3: "MESA DE MELAMINE MARCA QUADRA" es mobiliario de oficina y la
  // IA la mandó a [44] Madera terciada. Lo que importa acá es que el
  // diccionario NO diga que es madera: sin evidencia, el prompt le ordena ir a
  // las complementarias en vez de clasificarla por el material del que está
  // hecha.
  it('un mueble de oficina no trae evidencia de madera', () => {
    const ev = evidenciaDiccionario('MESA DE MELAMINE MARCA QUADRA');
    expect(codigos(ev)).not.toContain('44');
  });

  it('un nombre de entidad bancaria no encuentra nada en el diccionario', () => {
    expect(evidenciaDiccionario('LA INMOBILIARIA BCP')).toEqual([]);
  });

  // Sin esto, tokens de 2-3 letras ("de", "x", "8") matchearían medio
  // diccionario y la "evidencia" sería ruido que empeora la respuesta.
  it('exige compartir una palabra de 4 letras o más', () => {
    expect(evidenciaDiccionario('DE X 8')).toEqual([]);
    expect(evidenciaDiccionario('')).toEqual([]);
    expect(evidenciaDiccionario(null)).toEqual([]);
  });

  it('respeta los topes de códigos y de términos por código', () => {
    const ev = evidenciaDiccionario('CABLE DE COBRE PARA INSTALACION ELECTRICA', { maxCodigos: 3, maxPorCodigo: 2 });
    expect(ev.length).toBeLessThanOrEqual(3);
    for (const g of ev) expect(g.terminos.length).toBeLessThanOrEqual(2);
  });

  it('ordena por parecido: el código con el término más cercano va primero', () => {
    const ev = evidenciaDiccionario('ALAMBRE DE PUAS ZINCADO');
    expect(ev[0].codigo).toBe('02');
    expect(ev[0].score).toBeGreaterThanOrEqual(ev[ev.length - 1].score);
  });

  // El diccionario PROPIO de la empresa viaja, porque es la corrección que ya
  // enseñó la contadora — pero EN SU PROPIA BOLSA (tanda 1). Mezclarlo con el
  // Anexo 2 era lo que hacía que la IA leyera su error de ayer como si fuera
  // la R.J. 016-2026.
  it('los términos propios van en `propios`, NUNCA en la evidencia de la norma', () => {
    const ev = evidenciaDiccionario('MESA DE MELAMINE MARCA QUADRA', {
      terminosCustom: [
        { termino: 'MESA DE MELAMINE', clasificacion_codigo: 'administrativos', deleted_at: null },
      ],
    });
    const g = ev.find(x => x.codigo === 'administrativos');
    expect(g).toBeTruthy();
    expect(g.propios).toContain('MESA DE MELAMINE');
    expect(g.terminos).not.toContain('MESA DE MELAMINE');
  });

  // Un término que dejó un recorrido automático NO se le devuelve a la IA:
  // sería pedirle que discuta contra su propia respuesta vieja.
  it('los términos de origen ia no se mandan como evidencia', () => {
    const ev = evidenciaDiccionario('MESA DE MELAMINE MARCA QUADRA', {
      terminosCustom: [
        { termino: 'MESA DE MELAMINE', clasificacion_codigo: 'administrativos', origen: 'ia', deleted_at: null },
      ],
    });
    const g = ev.find(x => x.codigo === 'administrativos');
    expect(g?.propios || []).not.toContain('MESA DE MELAMINE');
  });

  it('ignora los términos propios borrados', () => {
    const ev = evidenciaDiccionario('MESA DE MELAMINE MARCA QUADRA', {
      terminosCustom: [
        { termino: 'MESA DE MELAMINE', clasificacion_codigo: 'administrativos', deleted_at: '2026-09-01T00:00:00Z' },
      ],
    });
    expect(codigos(ev)).not.toContain('administrativos');
  });

  it('cada grupo trae términos sin repetir el código', () => {
    const ev = evidenciaDiccionario('TUBERIA DE PVC PARA DESAGUE');
    expect(new Set(codigos(ev)).size).toBe(ev.length);
    for (const g of ev) {
      expect(g.terminos.length).toBeGreaterThan(0);
      expect(typeof g.score).toBe('number');
    }
  });
});
