// ═══════════════════════════════════════════════════════════════════
// TANDA G (26-set-2026): los 41 "TRUNCADO" medidos en producción salían de que
// las llamadas a OpenRouter de Captura Mágica no pedían `razonamiento:'bajo'`
// — el modelo gratuito razona en voz alta y se come el techo pensando — y de
// que el "rescate" pedía MENOS tokens (4000) que la llamada que ya se había
// cortado (≥6000). api/captura-magica.js no tiene test propio (es la función
// serverless, no una lib pura), así que esto es un chequeo estático del
// código fuente para que nadie vuelva a agregar una llamada a OpenRouter sin
// `razonamiento` — ver docs/revision-ola1/ola1-api.md.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../../api/captura-magica.js', import.meta.url), 'utf8');

describe('captura-magica — llamadas a OpenRouter piden razonamiento bajo', () => {
  it('el parser encuentra las 5 llamadas a construirCuerpoOR (si no, el test no prueba nada)', () => {
    const llamadas = [...src.matchAll(/construirCuerpoOR\(\{/g)];
    expect(llamadas.length).toBe(5);
  });

  it('las 5 llamadas a construirCuerpoOR pasan razonamiento: \'bajo\'', () => {
    // Cada llamada es un objeto que cierra con `})` antes del siguiente
    // paréntesis de openrouterChat — partimos el archivo en esos bloques.
    const bloques = src.split('construirCuerpoOR({').slice(1);
    const sinRazonamiento = bloques
      .map((b, i) => ({ i, cierre: b.slice(0, b.indexOf('}), deadline') + 20) }))
      .filter(({ cierre }) => !/razonamiento:\s*'bajo'/.test(cierre));
    expect(sinRazonamiento, JSON.stringify(sinRazonamiento)).toEqual([]);
  });

  it('la llamada de visión gratuita (armada a mano) pide reasoning de bajo esfuerzo', () => {
    expect(src).toMatch(/model:\s*'inclusionai\/ling-3\.0-flash-vl:free'[\s\S]{0,800}reasoning:\s*\{\s*effort:\s*'low'/);
  });

  it('ninguna llamada a OpenRouter usa un max_tokens fijo de 4000 (el piso real es presupuestoSalida)', () => {
    // El único 4000 legítimo que debe quedar es el de la rama Claude
    // (anthropicMessages) del rescate — Haiku no "piensa en voz alta" igual.
    const usosDe4000 = [...src.matchAll(/max_tokens:\s*4000/g)];
    expect(usosDe4000.length).toBe(1);
  });

  it('MAX_BASE64_BYTES está en o por debajo del límite real de body de Vercel (~4.5MB)', () => {
    const m = src.match(/MAX_BASE64_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeLessThanOrEqual(4);
  });
});
