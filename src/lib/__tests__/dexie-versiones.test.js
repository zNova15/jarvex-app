// ═══════════════════════════════════════════════════════════════════
// UN NÚMERO DE db.version() NO SE REPITE (tanda E, 26-set-2026).
//
// `tipos_cambio` (mig 222) se agregó como una SEGUNDA db.version(60) y
// `clasificaciones` (mig 205) como una segunda db.version(47): números que los
// equipos ya tenían instalados. Andaba solo porque Dexie 4 detecta «el esquema
// creció sin subir la versión» y lo parcha solo (con un warning en cada
// arranque). Con otra versión de Dexie, o si alguien ordenaba el archivo,
// esas tablas no se creaban en los equipos viejos. Se movieron a la v68; este
// test impide que vuelva a pasar.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../db/jarvex.db.js', import.meta.url), 'utf8');
const versiones = [...src.matchAll(/db\.version\((\d+)\)\.stores\(/g)].map(m => Number(m[1]));

describe('Dexie — versiones del esquema', () => {
  it('el parser encuentra las versiones (si no, el test no prueba nada)', () => {
    expect(versiones.length).toBeGreaterThan(60);
    expect(Math.max(...versiones)).toBeGreaterThanOrEqual(68);
  });

  it('ningún número de versión aparece dos veces', () => {
    const vistos = new Map();
    for (const v of versiones) vistos.set(v, (vistos.get(v) || 0) + 1);
    const repetidos = [...vistos].filter(([, n]) => n > 1).map(([v, n]) => `db.version(${v}) × ${n}`);
    expect(repetidos, `Una tabla nueva va en una versión NUEVA (la más alta + 1):\n  ${repetidos.join('\n  ')}`).toEqual([]);
  });

  it('tipos_cambio, clasificaciones y clasificacion_terminos viven en la v68', () => {
    const v68 = src.replace(/\r\n/g, '\n').match(/db\.version\(68\)\.stores\(\{([\s\S]*?)\n\}\);/);
    expect(v68, 'falta db.version(68)').toBeTruthy();
    for (const t of ['tipos_cambio', 'clasificaciones', 'clasificacion_terminos']) {
      expect(v68[1]).toMatch(new RegExp(`^\\s{2}${t}:`, 'm'));
    }
  });
});
