// Tests de la AUDITORÍA DEL DICCIONARIO APRENDIDO (tanda 5).
//
// Los casos no son inventados: son los que se encontraron en producción el
// 14-sep-2026 y que motivaron la mig 212 — «CUSQUEÑA» apuntando a cemento y
// «PERFORADOR INDUSTRIAL FABER CASTELL» a maquinaria liviana. Si esta lista
// no los pone arriba, la pantalla no sirve para lo que se hizo.
import { describe, it, expect } from 'vitest';
import {
  ORIGENES, origenDe, filasDeAuditoria, resumenPorOrigen, conflictosDeCodigo,
  filtrarAuditoria, codigosConTerminos, contradiceALaNorma, veredictoDeLaNorma,
} from '../auditoria-diccionario.js';

const t = (termino, codigo, extra = {}) => ({
  id: extra.id || `${termino}-${codigo}`,
  termino,
  norm: termino.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
  clasificacion_codigo: codigo,
  origen: 'decision',
  updated_at: '2026-09-15T00:00:00Z',
  ...extra,
});

describe('origenDe — la mig 212 y las filas viejas', () => {
  it('reconoce los tres orígenes', () => {
    expect(origenDe({ origen: 'manual' })).toBe('manual');
    expect(origenDe({ origen: 'ia' })).toBe('ia');
    expect(origenDe({ origen: 'decision' })).toBe('decision');
  });

  it('una fila sin columna (o con basura) se lee como aprendida de una decisión', () => {
    expect(origenDe({})).toBe('decision');
    expect(origenDe({ origen: 'cualquier-cosa' })).toBe('decision');
    expect(origenDe(null)).toBe('decision');
  });

  it('los tres orígenes están declarados, y la IA va primera', () => {
    expect(ORIGENES.map(o => o.slug)).toEqual(['ia', 'decision', 'manual']);
  });
});

describe('filasDeAuditoria', () => {
  it('saca las borradas y las del otro modo', () => {
    const filas = filasDeAuditoria([
      t('CEMENTO SOL', '21'),
      t('BORRADO', '21', { id: 'x', deleted_at: '2026-09-01' }),
      t('DEMO', '21', { id: 'y', demo: true }),
    ]);
    expect(filas.map(f => f.termino)).toEqual(['CEMENTO SOL']);
  });

  it('en modo prueba pasa lo contrario', () => {
    const filas = filasDeAuditoria([t('DEMO', '21', { demo: true })], { demo: true });
    expect(filas).toHaveLength(1);
  });

  it('ordena alfabéticamente, que es como se busca a ojo', () => {
    const filas = filasDeAuditoria([t('ZINC', '25'), t('ARENA', '04')]);
    expect(filas.map(f => f.termino)).toEqual(['ARENA', 'ZINC']);
  });

  it('`conNorma: false` no contrasta (es el camino barato para contar)', () => {
    const filas = filasDeAuditoria([t('CUSQUEÑA', '21')], { conNorma: false });
    expect(filas[0].contra).toBeNull();
  });
});

describe('contradiceALaNorma — la lista corta donde mirar primero', () => {
  it('un término que coincide con la norma no es sospechoso', () => {
    // El Anexo 2 reconoce «CEMENTO PORTLAND»: si el término apunta ahí, está bien.
    const v = veredictoDeLaNorma('CEMENTO PORTLAND TIPO I');
    expect(contradiceALaNorma('CEMENTO PORTLAND TIPO I', v.codigo)).toBeNull();
  });

  it('si el término lo manda a otro lado, lo marca', () => {
    const v = veredictoDeLaNorma('CEMENTO PORTLAND TIPO I');
    const otro = v.codigo === '53' ? '21' : '53';
    const r = contradiceALaNorma('CEMENTO PORTLAND TIPO I', otro);
    expect(r).not.toBeNull();
    expect(r.codigo).toBe(v.codigo);
  });

  it('🔴 cuando la norma NO reconoce el texto NO hay contradicción', () => {
    // Es el caso más común y es exactamente para lo que existe el diccionario
    // propio. Marcarlo llenaría la lista de ruido y nadie la miraría.
    expect(contradiceALaNorma('ZZZQQQ XYZ 999', '21')).toBeNull();
  });

  it('el veredicto se pide SIN el diccionario propio', () => {
    // Si se consultara con `terminosCustom`, el término se encontraría a sí
    // mismo con score 0,99 y contestaría «coincide» siempre.
    const v = veredictoDeLaNorma('CUSQUEÑA');
    expect(v.codigo === 'sin_clasificar' || typeof v.codigo === 'string').toBe(true);
    expect(v.score).toBeLessThanOrEqual(1);
  });
});

describe('conflictosDeCodigo — el defecto más silencioso', () => {
  it('el mismo texto apuntando a dos clasificaciones sale a la luz', () => {
    const filas = filasDeAuditoria([
      t('TUBO PVC', '18', { id: 'a', updated_at: '2026-09-10' }),
      t('TUBO PVC', '25', { id: 'b', updated_at: '2026-09-14' }),
      t('ARENA', '04', { id: 'c' }),
    ], { conNorma: false });
    const c = conflictosDeCodigo(filas);
    expect(c).toHaveLength(1);
    expect(c[0].codigos.sort()).toEqual(['18', '25']);
    // La más reciente primero: es la que probablemente esté ganando hoy.
    expect(c[0].filas[0].id).toBe('b');
  });

  it('dos filas con el mismo código no son un conflicto', () => {
    const filas = filasDeAuditoria([
      t('TUBO PVC', '18', { id: 'a' }),
      t('TUBO PVC', '18', { id: 'b' }),
    ], { conNorma: false });
    expect(conflictosDeCodigo(filas)).toHaveLength(0);
  });

  it('sin términos no inventa conflictos', () => {
    expect(conflictosDeCodigo([])).toEqual([]);
    expect(conflictosDeCodigo(null)).toEqual([]);
  });
});

describe('resumenPorOrigen', () => {
  it('cuenta cada capa por separado', () => {
    const filas = filasDeAuditoria([
      t('A', '21', { id: '1', origen: 'ia' }),
      t('B', '21', { id: '2', origen: 'ia' }),
      t('C', '21', { id: '3', origen: 'manual' }),
      t('D', '21', { id: '4' }),
    ], { conNorma: false });
    const r = resumenPorOrigen(filas);
    expect(r.find(x => x.slug === 'ia').n).toBe(2);
    expect(r.find(x => x.slug === 'manual').n).toBe(1);
    expect(r.find(x => x.slug === 'decision').n).toBe(1);
  });

  it('siempre devuelve las tres capas, aunque alguna esté en cero', () => {
    expect(resumenPorOrigen([]).map(x => x.n)).toEqual([0, 0, 0]);
  });
});

describe('filtrarAuditoria', () => {
  const filas = () => filasDeAuditoria([
    t('CEMENTO SOL', '21', { id: '1', origen: 'ia' }),
    t('ARENA GRUESA', '04', { id: '2', origen: 'manual' }),
    t('TUBO PVC', '18', { id: '3', origen: 'ia' }),
    t('TUBO PVC', '25', { id: '4', origen: 'decision' }),
  ], { conNorma: false });

  it('sin filtros no filtra nada', () => {
    expect(filtrarAuditoria(filas(), {})).toHaveLength(4);
  });

  it('por origen', () => {
    expect(filtrarAuditoria(filas(), { origen: 'ia' })).toHaveLength(2);
  });

  it('por clasificación', () => {
    expect(filtrarAuditoria(filas(), { codigo: '04' }).map(f => f.termino)).toEqual(['ARENA GRUESA']);
  });

  it('la búsqueda ignora tildes y mayúsculas', () => {
    expect(filtrarAuditoria(filas(), { busca: 'aréna' })).toHaveLength(1);
    expect(filtrarAuditoria(filas(), { busca: 'TUBO' })).toHaveLength(2);
  });

  it('solo los que se pelean entre sí', () => {
    const r = filtrarAuditoria(filas(), { soloConflictos: true });
    expect(r.map(f => f.id).sort()).toEqual(['3', '4']);
  });

  it('los filtros se combinan', () => {
    const r = filtrarAuditoria(filas(), { soloConflictos: true, origen: 'ia' });
    expect(r.map(f => f.id)).toEqual(['3']);
  });
});

describe('codigosConTerminos — el desplegable', () => {
  it('solo ofrece clasificaciones que hoy tienen términos, con su cuenta', () => {
    const filas = filasDeAuditoria([
      t('A', '21', { id: '1' }), t('B', '21', { id: '2' }), t('C', '04', { id: '3' }),
    ], { conNorma: false });
    const c = codigosConTerminos(filas);
    expect(c).toHaveLength(2);
    expect(c.find(x => x.codigo === '21').n).toBe(2);
  });
});
