// Un <JxIcon name="..."> con un nombre que no existe NO rompe el build ni tira
// un error: `icons[name] || icons.dashboard` dibuja la grilla de cuadraditos
// en su lugar. O sea, el ícono equivocado en silencio. Ya pasó dos veces
// —`arrow-left` en la tanda 2A (el ícono es `chevL`) y `chevU` en la tanda 3
// (no hay flecha arriba)— y las dos se descubrieron mirando la pantalla.
//
// Este test LEE el set real de íconos de jx-icons.jsx y todos los nombres
// literales usados en el código: si alguien escribe uno que no existe, falla
// acá con el archivo y el nombre.
//
// ⚠ La baseline quedó VACÍA el 3-sep-2026: cero íconos fantasma en el código.
// A partir de acá el test es un gate duro — si escribís un nombre que no
// existe, falla. No lo agregues a FANTASMAS_CONOCIDOS: definí el ícono.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/** Los nombres definidos en el mapa de jx-icons.jsx. */
function iconosDefinidos() {
  const src = readFileSync(join(SRC, 'components/jx-icons.jsx'), 'utf8');
  // Entradas del objeto: `    nombre:  <>...`
  return new Set([...src.matchAll(/^\s{2,}([A-Za-z][\w-]*):\s*<>/gm)].map(m => m[1]));
}

function archivosJsx(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f === '__tests__' || f === 'node_modules') continue;
      out.push(...archivosJsx(p));
    } else if (f.endsWith('.jsx') || f.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Nombres LITERALES usados en `name="x"` / `name={'x'}` / `name={c ? 'a' : 'b'}`.
 * Los dinámicos de verdad (`name={fila.icon}`) no se pueden verificar acá; los
 * cubre el test de la sección que los define.
 */
function nombresUsados() {
  const usos = new Map();   // nombre → Set(archivo)
  for (const file of archivosJsx(SRC)) {
    const src = readFileSync(file, 'utf8');
    const rel = file.slice(SRC.length);
    for (const m of src.matchAll(/<JxIcon[^>]*?\sname=(?:"([^"]+)"|\{([^}]*)\})/g)) {
      // En `name={x === 'consorcio' ? 'users' : 'building'}` los nombres de
      // ícono son 'users' y 'building'; 'consorcio' es el valor con el que se
      // COMPARA — y en `name={m.includes('pdf') ? 'file' : 'camera'}`, 'pdf'
      // es el argumento del test. Contarlos daba cuatro fantasmas que nunca
      // existieron ('cambio', 'consorcio', 'obra', 'pdf').
      const expr = m[2]
        // `.includes('pdf')`, `.startsWith('x')`: argumento de un test, no ícono.
        ? m[2].replace(/\.\w+\(\s*(?:'[^']*'|"[^"]*")\s*\)/g, '')
              .replace(/[!=]==?\s*(?:'[^']*'|"[^"]*")/g, '')
        : '';
      const literales = m[1]
        ? [m[1]]
        : [...expr.matchAll(/'([^']+)'|"([^"]+)"/g)].map(x => x[1] || x[2]);
      for (const n of literales) {
        if (!usos.has(n)) usos.set(n, new Set());
        usos.get(n).add(rel);
      }
    }
  }
  return usos;
}

/**
 * Nombres fantasma que YA estaban en el código el 3-sep-2026 (tanda 3).
 * Cada uno dibuja hoy la grilla de `dashboard`. No se tocan en esta pasada;
 * se congelan para que la lista solo pueda achicarse.
 */
const FANTASMAS_CONOCIDOS = new Set([
  // VACÍA desde el 3-sep-2026. Los 12 fantasmas reales se definieron en
  // jx-icons.jsx (archive, barChart, book, clock, external, fileText, info,
  // refresh, send, zap, chevronUp, chevronDown) y los 4 restantes
  // —'cambio', 'consorcio', 'obra', 'pdf'— nunca fueron íconos: eran el lado
  // izquierdo de una comparación que el extractor de arriba leía mal.
  // Si volvés a agregar algo acá, dejá dicho por qué no se puede arreglar hoy.
]);

describe('íconos', () => {
  const definidos = iconosDefinidos();

  it('el mapa de jx-icons.jsx se pudo leer', () => {
    expect(definidos.size).toBeGreaterThan(20);
    expect(definidos.has('chevR')).toBe(true);
  });

  it('no se agregan íconos fantasma nuevos', () => {
    const nuevos = [];
    for (const [nombre, files] of nombresUsados()) {
      if (definidos.has(nombre) || FANTASMAS_CONOCIDOS.has(nombre)) continue;
      nuevos.push(`${nombre} (${[...files].join(', ')})`);
    }
    expect(nuevos, 'ícono usado y jamás definido → dibuja la grilla de dashboard').toEqual([]);
  });

  it('la baseline no tiene nombres que ya se arreglaron', () => {
    // Si alguien define de verdad uno de estos, hay que sacarlo de la lista:
    // si no, la baseline tapa el próximo error con el mismo nombre.
    const yaExisten = [...FANTASMAS_CONOCIDOS].filter(n => definidos.has(n));
    expect(yaExisten, 'sacalos de FANTASMAS_CONOCIDOS').toEqual([]);
  });
});
