// ═══════════════════════════════════════════════════════════════════
// LAS TRES CAPAS DEL DICCIONARIO (tanda 1, 15-set-2026).
//
// Lo que estos tests defienden es UNA sola regla, la que faltaba: el
// diccionario que la empresa APRENDE no es la ley y no puede pisarla.
//
// Antes sí la pisaba. Medido en producción: 368 términos vivos, 365 de ellos
// huérfanos de decisiones ya deshechas, ~70 mal («CUSQUEÑA» → [21] Cemento,
// «PL. GALV. 0.80» → [53] Petróleo diésel), y todos entraban en
// `clasificarConIUPC` con score 0,99 — ANTES del Anexo 2 de la R.J. 016-2026.
// El error de ayer volvía hoy con autoridad de norma peruana.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { clasificarConIUPC } from '../indices-unificados-iupc.js';

// «Alambre negro recocido» está en el Anexo 2 y apunta a [02] Alambre. Es el
// caso perfecto para ver qué capa gana: si una capa propia lo manda a otro
// lado, o le gana a la norma o no.
const EN_LA_NORMA = 'ALAMBRE NEGRO RECOCIDO';

const termino = (extra = {}) => [{
  id: 't1', termino: EN_LA_NORMA, norm: 'alambre negro recocido',
  clasificacion_codigo: '53', deleted_at: null, ...extra,
}];

describe('las tres capas del diccionario', () => {
  it('sin nada propio, manda el Anexo 2', () => {
    expect(clasificarConIUPC(EN_LA_NORMA).codigo).toBe('02');
  });

  it('lo APRENDIDO de una decisión NO pisa un término de la norma', () => {
    const r = clasificarConIUPC(EN_LA_NORMA, { terminosCustom: termino({ origen: 'decision' }) });
    expect(r.codigo).toBe('02');
  });

  it('lo que dejó un recorrido con IA tampoco', () => {
    const r = clasificarConIUPC(EN_LA_NORMA, { terminosCustom: termino({ origen: 'ia' }) });
    expect(r.codigo).toBe('02');
  });

  it('las filas viejas sin `origen` se leen como aprendidas (lado conservador)', () => {
    // Antes de la mig 212 la columna no existía: esas 365 filas no pueden
    // seguir ganándole a la norma solo porque nadie les puso el sello.
    const r = clasificarConIUPC(EN_LA_NORMA, { terminosCustom: termino() });
    expect(r.codigo).toBe('02');
  });

  it('lo escrito A MANO sí le gana: es una corrección deliberada sobre la norma', () => {
    const r = clasificarConIUPC(EN_LA_NORMA, { terminosCustom: termino({ origen: 'manual' }) });
    expect(r.codigo).toBe('53');
    expect(r.score).toBeGreaterThan(0.9);
  });

  it('lo aprendido SÍ vale donde la norma no dice nada', () => {
    // El punto no es desconfiar del aprendizaje: es ordenarlo. Una descripción
    // que el Anexo 2 no reconoce se resuelve con lo que ya se decidió antes.
    const custom = [{
      id: 't2', termino: 'GEOMALLA TRIAXIAL TX160', norm: 'geomalla triaxial tx160',
      clasificacion_codigo: 'PI-GEO', origen: 'decision', deleted_at: null,
    }];
    expect(clasificarConIUPC('GEOMALLA TRIAXIAL TX160', { terminosCustom: custom }).codigo).toBe('PI-GEO');
  });

  it('el parecido a algo aprendido no tapa una coincidencia buena de la norma', () => {
    // «CEMENTO PORTLAND TIPO I» lo reconoce el Anexo 2. Un término aprendido
    // que comparte palabras pero apunta a otro lado no puede robárselo sin
    // sacarle ventaja clara (ver VENTAJA_APRENDIDO).
    const custom = [{
      id: 't3', termino: 'CEMENTO PORTLAND TIPO V', norm: 'cemento portland tipo v',
      clasificacion_codigo: '53', origen: 'decision', deleted_at: null,
    }];
    const r = clasificarConIUPC('CEMENTO PORTLAND TIPO I', { terminosCustom: custom });
    expect(r.codigo).not.toBe('53');
  });
});
