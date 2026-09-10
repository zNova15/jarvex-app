// El cursor compuesto (cursor-incremental.js) arregló LA bomba del 9-set-2026:
// tablas con sellos updated_at idénticos de un import masivo. Pero nada avisaba
// que estaba pasando hasta que Supabase cortó el proyecto entero. Este es el
// detector: mide qué fracción de una tabla trae cada pull INCREMENTAL, y marca
// sospechoso lo que se parezca a la forma de ese bug.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  medirCicloIncremental, saludDelTecho, haySospechaActiva,
  UMBRAL_SOSPECHOSO_PCT, _resetParaTests,
} from '../../sync/techo-pull';

beforeEach(() => { _resetParaTests(); });

describe('medirCicloIncremental — el cálculo', () => {
  it('un pull incremental normal (pocas filas) no dispara nada', () => {
    // Trabajo normal: 3 movimientos nuevos sobre una tabla de 1974.
    const r = medirCicloIncremental('movimientos_materiales', 3, 1974);
    expect(r.pct).toBeLessThan(1);
    expect(r.sospechoso).toBe(false);
    expect(haySospechaActiva()).toBe(false);
  });

  it('sin base local (tabla nueva en este device) no mide — no hay con qué comparar', () => {
    expect(medirCicloIncremental('tabla_nueva', 50, 0)).toBe(null);
    expect(saludDelTecho()).toEqual([]);
  });
});

describe('el caso real del 9-set-2026', () => {
  it('insumos_partida_versionadas: 6722 de 6722 (100%) — la forma exacta del corte', () => {
    const r = medirCicloIncremental('insumos_partida_versionadas', 6722, 6722);
    expect(r.pct).toBe(100);
    expect(r.sospechoso).toBe(true);
    expect(haySospechaActiva()).toBe(true);
  });

  it('insumos_partida: 1115 de 6722 (16.6%) — bajo el umbral, no se marca', () => {
    // Este caso real quedó JUSTO por debajo del piso del 20%. Documentado a
    // propósito: el umbral es un piso de ruido, no una garantía de agarrar
    // absolutamente todo — lo que sí agarra son las dos tablas al 100/50% que
    // eran el grueso del tráfico.
    const r = medirCicloIncremental('insumos_partida', 1115, 6722);
    expect(r.pct).toBeCloseTo(16.6, 1);
    expect(r.sospechoso).toBe(false);
  });

  it('oc_items: 46 de 92 (50%) — sí se marca aunque la tabla sea chica', () => {
    const r = medirCicloIncremental('oc_items', 46, 92);
    expect(r.pct).toBe(50);
    expect(r.sospechoso).toBe(true);
  });
});

describe('el umbral en el borde', () => {
  it('exactamente en el umbral NO es sospechoso (estrictamente mayor)', () => {
    const r = medirCicloIncremental('x', UMBRAL_SOSPECHOSO_PCT, 100);
    expect(r.pct).toBe(UMBRAL_SOSPECHOSO_PCT);
    expect(r.sospechoso).toBe(false);
  });

  it('un punto por encima del umbral SÍ es sospechoso', () => {
    const r = medirCicloIncremental('x', UMBRAL_SOSPECHOSO_PCT + 1, 100);
    expect(r.sospechoso).toBe(true);
  });
});

describe('saludDelTecho — lo que ve Administración', () => {
  it('ordena las tablas de mayor a menor porcentaje', () => {
    medirCicloIncremental('baja', 2, 100);
    medirCicloIncremental('alta', 90, 100);
    medirCicloIncremental('media', 40, 100);
    const salud = saludDelTecho();
    expect(salud.map(s => s.tabla)).toEqual(['alta', 'media', 'baja']);
  });

  it('cuenta cuántas veces reciente estuvo sospechosa, no solo el último ciclo', () => {
    medirCicloIncremental('intermitente', 90, 100); // sospechoso
    medirCicloIncremental('intermitente', 2, 100);  // normal
    medirCicloIncremental('intermitente', 95, 100); // sospechoso otra vez
    const [fila] = saludDelTecho();
    expect(fila.vecesSospechosoReciente).toBe(2);
    expect(fila.ciclosMedidos).toBe(3);
    expect(fila.sospechoso).toBe(true); // el ÚLTIMO ciclo es el que manda el ícono
  });

  it('no acumula sin límite — se queda con los últimos ciclos, no con todo el historial', () => {
    for (let i = 0; i < 30; i++) medirCicloIncremental('ruidosa', 1, 1000);
    const [fila] = saludDelTecho();
    expect(fila.ciclosMedidos).toBeLessThanOrEqual(12);
  });
});

describe('haySospechaActiva — la bandera que mira la UI', () => {
  it('false cuando nada se midió todavía', () => {
    expect(haySospechaActiva()).toBe(false);
  });

  it('se apaga si el último ciclo de esa tabla ya volvió a la normalidad', () => {
    medirCicloIncremental('recuperada', 90, 100); // sospechoso
    expect(haySospechaActiva()).toBe(true);
    medirCicloIncremental('recuperada', 1, 100);  // el ciclo siguiente, normal
    expect(haySospechaActiva()).toBe(false);
  });
});
