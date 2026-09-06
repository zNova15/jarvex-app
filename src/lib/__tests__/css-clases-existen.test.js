// ═══════════════════════════════════════════════════════════════════
// EL OTRO TEST QUE FALTABA: ¿la clase de CSS existe?
//
// Gabriel, 6-sep-2026, sobre la pantalla de Órdenes:
//   «los títulos están en una zona muy arriba a la izquierda, casi tocando con
//    las líneas de división, y se ve feo. Además, filtré y quería deslizar
//    hacia abajo y no me deja.»
//
// Los dos síntomas eran UNA sola causa: la pantalla abría con
// `className="pg"` y `className="pg-head"`, y ninguna de las dos existe en
// index.css. La clase buena es `.page-wrap`, que es la que trae
// `padding: 24px 28px` (por eso el título pegado al borde) y
// `overflow-y: auto; height: 100%` (por eso no scrolleaba).
//
// Un className mal escrito NO lo ve nada: es un string válido para el build,
// el lint no conoce el CSS, y el test que monta las 114 pantallas la monta
// igual — renderiza perfecto, solo que sin estilos. El único síntoma es que
// alguien la abre y la ve fea.
//
// El barrido del 6-sep encontró 14 clases inventadas, 7 de ellas rompiendo
// algo visible: dos pantallas sin scroll (Órdenes, Activos Fijos), una tercera
// sin scroll (Config SUNAT), TRES modales sin overlay —renderizaban dentro del
// flujo de la página en vez de flotar—, 8 grillas de KPI apiladas en una
// columna, inputs sin estilo y 14 botones de acción principal que no se veían
// como principales.
//
// Este test es ESTRICTO a propósito, sin lista de excepciones: una excepción
// crece y termina tapando justo el caso que importa. Si necesitas una clase
// nueva, defínela en index.css — que es lo que había que hacer desde el principio.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const cssUrl = new URL('../../index.css', import.meta.url);
const compsUrl = new URL('../../components/', import.meta.url);

/** Todas las clases que index.css define (`.loQueSea` en cualquier selector). */
function clasesDefinidas() {
  const css = readFileSync(cssUrl, 'utf8');
  return new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
}

/**
 * Las clases usadas en `className="..."` literales.
 *
 * Solo los literales estáticos: un `className={cond ? 'a' : 'b'}` se arma en
 * runtime y no se puede verificar desde acá sin evaluar el componente. La
 * mayoría del código usa el literal, que es donde caben las 14 de la tanda 6.
 */
function clasesUsadas() {
  const archivos = [
    ...readdirSync(compsUrl).filter(f => f.endsWith('.jsx')).map(f => new URL(f, compsUrl)),
    new URL('../../jx-app.jsx', import.meta.url),
  ];
  const uso = new Map();   // clase -> Set(archivo)
  for (const url of archivos) {
    const src = readFileSync(url, 'utf8');
    const archivo = url.pathname.split('/').pop();
    for (const m of src.matchAll(/className="([^"{}]+)"/g)) {
      for (const c of m[1].trim().split(/\s+/)) {
        if (!c) continue;
        if (!uso.has(c)) uso.set(c, new Set());
        uso.get(c).add(archivo);
      }
    }
  }
  return uso;
}

describe('CSS — ninguna pantalla usa una clase que no existe', () => {
  it('toda clase de un className literal está definida en index.css', () => {
    const definidas = clasesDefinidas();
    const huerfanas = [...clasesUsadas().entries()]
      .filter(([c]) => !definidas.has(c))
      .map(([c, files]) => `${c} (en ${[...files].sort().join(', ')})`);
    expect(huerfanas, `clases usadas que index.css no define:\n  ${huerfanas.join('\n  ')}`).toEqual([]);
  });

  it('las clases que dan padding y scroll a una pantalla siguen existiendo', () => {
    // Guard explícito del caso de Gabriel: si alguien renombra o borra
    // .page-wrap, todas las pantallas pierden el scroll a la vez.
    const css = readFileSync(cssUrl, 'utf8');
    const pageWrap = css.match(/\.page-wrap\s*\{([^}]*)\}/);
    expect(pageWrap, 'desapareció .page-wrap: TODAS las pantallas se quedan sin scroll').toBeTruthy();
    expect(pageWrap[1]).toMatch(/overflow-y:\s*auto/);
    expect(pageWrap[1]).toMatch(/padding:/);
    // Y el backdrop de los modales: sin él, un modal renderiza dentro del flujo.
    const overlay = css.match(/\.overlay\s*\{([^}]*)\}/);
    expect(overlay, 'desapareció .overlay: los modales dejan de flotar').toBeTruthy();
    expect(overlay[1]).toMatch(/position:\s*fixed/);
  });
});
