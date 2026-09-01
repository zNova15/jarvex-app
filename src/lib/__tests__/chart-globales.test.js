import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Regresión: los componentes de gráfico (ChartLine/ChartBar/ChartDoughnut) viven
// en jx-dashboard.jsx, que es EAGER y NO los exporta — se consumen como globales
// window.* porque importarlos partiría un chunk con init circular (regla crítica 1).
//
// El bug que motiva esto: jx-gestion.jsx los usaba "pelados" (<ChartLine .../> sin
// declararlos). Eso NO reventaba — la búsqueda del identificador subía por la cadena
// de scopes hasta el objeto global y encontraba window.ChartLine — pero era una
// dependencia implícita, invisible para lint y para cualquier lectura del archivo:
// el día que jx-dashboard deje de exponerlos, o deje de ser eager, la página Costos
// se rompe sin que nada lo avise antes.

const raiz = resolve(__dirname, '../../..');
const leer = (p) => readFileSync(resolve(raiz, p), 'utf8');
const COMPONENTES = resolve(raiz, 'src/components');
const CHARTS = ['ChartLine', 'ChartBar', 'ChartDoughnut'];

describe('componentes de gráfico — sin globales implícitos', () => {
  it('jx-dashboard.jsx los expone en window', () => {
    const src = leer('src/components/jx-dashboard.jsx');
    for (const c of CHARTS) {
      expect(src, `${c} debe seguir expuesto en window desde jx-dashboard`)
        .toMatch(new RegExp(`Object\\.assign\\(window,[^)]*\\b${c}\\b`));
    }
  });

  it('jx-dashboard.jsx sigue siendo EAGER (import estático en main.jsx)', () => {
    // Si pasara a lazy, los globales no existirían al renderizar otra página.
    expect(leer('src/main.jsx')).toMatch(/^import\s+['"]\.\/components\/jx-dashboard\.jsx['"];?$/m);
  });

  it('quien los usa, los declara: local o desde window (nunca pelados)', () => {
    const archivos = readdirSync(COMPONENTES).filter(f => f.endsWith('.jsx'));
    const culpables = [];

    for (const f of archivos) {
      const src = leer(`src/components/${f}`);
      for (const c of CHARTS) {
        const usa = new RegExp(`<${c}[\\s/>]`).test(src);
        if (!usa) continue;
        const declarado =
          new RegExp(`function\\s+${c}\\s*\\(`).test(src) ||           // definido acá (jx-dashboard)
          new RegExp(`\\b${c}\\s*=\\s*window\\.${c}\\b`).test(src) ||  // const ChartLine = window.ChartLine
          new RegExp(`import[^;]*\\b${c}\\b[^;]*from`).test(src);      // si algún día se exporta de verdad
        if (!declarado) culpables.push(`${f} usa <${c}> sin declararlo`);
      }
    }

    expect(culpables, 'usar el global implícito rompe silenciosamente si jx-dashboard cambia').toEqual([]);
  });
});
