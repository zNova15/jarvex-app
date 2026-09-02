import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Regresión: TODO var(--token) usado en el código debe estar definido en CSS.
//
// Esta clase de bug ya pasó DOS veces y las dos duraron meses sin que nadie la
// viera: var(--bd)/var(--bg2) (bordes/fondos invisibles, fix 38de1bb) y luego
// --tx/--text/--gray/--muted/--bg-elev (resaltados y fondos muertos, hallazgo
// de la inspección del 1-sep). Un token fantasma no tira error en ningún lado:
// el valor queda inválido y la propiedad hereda o se hace transparente, en
// ambos temas. Este test lo hace visible en el gate.

const raiz = resolve(__dirname, '../../..');
const leer = (p) => readFileSync(p, 'utf8');

function archivos(dir, exts, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!/node_modules|__tests__|dist|\.git/.test(f)) archivos(p, exts, out);
    } else if (exts.some((e) => f.endsWith(e))) out.push(p);
  }
  return out;
}

// Sacar comentarios para no contar var(--x) mencionados en prosa.
const sinComentarios = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function tokensUsados() {
  const files = [
    ...archivos(join(raiz, 'src'), ['.jsx', '.js', '.css']),
    join(raiz, 'index.html'),
    join(raiz, 'public/theme-boot.js'),
  ];
  const usados = new Map(); // token → [archivo, ...]
  for (const f of files) {
    const src = sinComentarios(leer(f));
    for (const m of src.matchAll(/var\(\s*--([a-z0-9-]+)/gi)) {
      const t = m[1];
      if (!usados.has(t)) usados.set(t, new Set());
      usados.get(t).add(f.slice(raiz.length + 1));
    }
  }
  return usados;
}

function tokensDefinidos() {
  const defs = new Set();
  const fuentes = [...archivos(join(raiz, 'src'), ['.css']), join(raiz, 'index.html')];
  for (const f of fuentes) {
    for (const m of sinComentarios(leer(f)).matchAll(/--([a-z0-9-]+)\s*:/g)) defs.add(m[1]);
  }
  return defs;
}

describe('tokens CSS — sin fantasmas', () => {
  it('todo var(--x) usado está definido en algún CSS', () => {
    const defs = tokensDefinidos();
    const fantasmas = [];
    for (const [t, files] of tokensUsados()) {
      if (!defs.has(t)) fantasmas.push(`--${t} (${[...files].join(', ')})`);
    }
    expect(fantasmas, 'token usado y jamás definido → color/fondo muerto en AMBOS temas').toEqual([]);
  });

  it('el bloque light redefine los tokens de superficie/texto', () => {
    const css = leer(join(raiz, 'src/index.css'));
    const m = /:root\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(m, 'debe existir el bloque :root[data-theme="light"]').toBeTruthy();
    for (const t of ['bg-p', 'bg-c', 'bg-c2', 'tp', 'tm', 'ts', 'border']) {
      expect(m[1], `--${t} debe tener versión light`).toMatch(new RegExp(`--${t}\\s*:`));
    }
  });
});
