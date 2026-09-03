// Espejo del test de desglose-obra: si una sección del panel de empresa queda
// sin permiso válido o apunta a una página que no existe, la tarjeta muere en
// "Sin acceso" o no lleva a ningún lado, y nadie se entera hasta que un usuario
// la toca.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SECCIONES_EMPRESA, SECCIONES_INTERNAS, seccionEmpresa, seccionesDeEmpresa,
  CATEGORIAS_EMPRESA, categoriaDeEmpresa, empresasPorCategoria,
  BLOQUES_CONTABILIDAD_EMPRESA, bloquesContabilidadEmpresa, esPaginaDeEmpresa,
} from '../desglose-empresa.js';

/** Ids de página del NAV real (jx-sidebar.jsx). */
function idsDelNav() {
  const src = readFileSync(new URL('../../components/jx-sidebar.jsx', import.meta.url), 'utf8');
  const ini = src.indexOf('const NAV = [');
  const fin = src.indexOf('\n];', ini);
  return new Set([...src.slice(ini, fin).matchAll(/\{\s*id:\s*'([^']+)'/g)].map(m => m[1]));
}

describe('desglose-empresa — estructura', () => {
  it('cada sección tiene id, título, ícono, descripción, tipo y permiso', () => {
    for (const s of SECCIONES_EMPRESA) {
      expect(s.id, JSON.stringify(s)).toBeTruthy();
      expect(s.titulo, s.id).toBeTruthy();
      expect(s.icon, s.id).toBeTruthy();
      expect(s.desc, s.id).toBeTruthy();
      expect(['interna', 'pagina'], s.id).toContain(s.tipo);
      expect(s.permiso, s.id).toBeTruthy();
    }
  });

  it('los ids son únicos', () => {
    const ids = SECCIONES_EMPRESA.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('una empresa se desglosa en las 7 secciones que pidió Gabriel', () => {
    // «cada empresa va a tener su desglose al igual que las obras que tienen
    // sus propias secciones» — no solo la parte contable.
    // 'documentos' se fue DENTRO de contabilidad: «pienso que eso debería
    // estar dentro de contabilidad».
    expect(SECCIONES_EMPRESA.map(s => s.id)).toEqual([
      'ficha', 'contabilidad', 'inventario', 'personal', 'trabajos',
      'tesoreria', 'equipos',
    ]);
  });

  it('el permiso de cada sección es una página REAL del menú', () => {
    const nav = idsDelNav();
    for (const s of SECCIONES_EMPRESA) {
      expect(nav.has(s.permiso), `la sección "${s.id}" se gatea con "${s.permiso}", que no está en el NAV`).toBe(true);
    }
  });

  it('toda sección de tipo pagina apunta a una página real, y las internas no', () => {
    const nav = idsDelNav();
    for (const s of SECCIONES_EMPRESA) {
      if (s.tipo === 'pagina') {
        expect(s.pagina, `"${s.id}" es tipo pagina y no dice cuál`).toBeTruthy();
        expect(nav.has(s.pagina), `"${s.id}" apunta a "${s.pagina}", que no está en el NAV`).toBe(true);
      } else {
        expect(s.pagina, `"${s.id}" es interna: no debería declarar pagina`).toBeUndefined();
      }
      // El "ver más" es opcional, pero si está tiene que existir.
      if (s.verMas) expect(nav.has(s.verMas), `"${s.id}" enlaza a "${s.verMas}", que no está en el NAV`).toBe(true);
    }
  });

  it('SECCIONES_INTERNAS son exactamente las de tipo interna', () => {
    expect(SECCIONES_INTERNAS).toEqual(
      SECCIONES_EMPRESA.filter(s => s.tipo === 'interna').map(s => s.id)
    );
  });

  it('seccionEmpresa devuelve la sección o null', () => {
    expect(seccionEmpresa('contabilidad').titulo).toBe('Contabilidad');
    expect(seccionEmpresa('no-existe')).toBe(null);
  });
});

describe('contabilidad de la empresa — el sub-panel', () => {
  it('la contabilidad es un panel de bloques, no una vista con cinco números', () => {
    // «Contabilidad debería ser la parte que esté MÁS DESARROLLADA en cada
    // empresa»: movimientos, comprobantes, guías, compras por categoría,
    // libro diario…
    const ids = BLOQUES_CONTABILIDAD_EMPRESA.map(b => b.id);
    for (const imprescindible of ['movimientos-contables', 'comprobantes', 'guias-remision',
      'compras-categoria', 'libro-diario', 'plan-cuentas', 'flujo-caja']) {
      expect(ids, `falta el bloque ${imprescindible}`).toContain(imprescindible);
    }
  });

  it('el libro diario está: era lo que Gabriel no encontraba y llamó "importantísimo"', () => {
    expect(BLOQUES_CONTABILIDAD_EMPRESA.some(b => b.id === 'libro-diario')).toBe(true);
  });

  it('cada bloque apunta a una página real del menú y tiene título e ícono', () => {
    const nav = idsDelNav();
    for (const b of BLOQUES_CONTABILIDAD_EMPRESA) {
      expect(nav.has(b.id), `el bloque "${b.id}" no está en el NAV`).toBe(true);
      expect(b.titulo, b.id).toBeTruthy();
      expect(b.icon, b.id).toBeTruthy();
      expect(b.desc, b.id).toBeTruthy();
    }
  });

  it('los ids de bloque son únicos', () => {
    const ids = BLOQUES_CONTABILIDAD_EMPRESA.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('el gate por rol usa la página destino', () => {
    expect(bloquesContabilidadEmpresa({ canSee: () => false })).toEqual([]);
    const soloDiario = bloquesContabilidadEmpresa({ canSee: (id) => id === 'libro-diario' });
    expect(soloDiario.map(b => b.id)).toEqual(['libro-diario']);
  });

  it('esPaginaDeEmpresa deja AFUERA lo que es del grupo por definición', () => {
    // Con una empresa activa, estas SÍ son "su" contabilidad…
    expect(esPaginaDeEmpresa('movimientos-contables')).toBe(true);
    expect(esPaginaDeEmpresa('libro-diario')).toBe(true);
    expect(esPaginaDeEmpresa('comprobantes')).toBe(true);
    // …pero estas comparan o consolidan TODAS: mirarlas "desde una empresa" no
    // significa nada, así que el menú no entra en contexto.
    expect(esPaginaDeEmpresa('contabilidad')).toBe(false);   // resumen por entidad
    expect(esPaginaDeEmpresa('consolidado')).toBe(false);
    expect(esPaginaDeEmpresa('analisis-insumos')).toBe(false);
    expect(esPaginaDeEmpresa('trabajos')).toBe(false);
  });
});

describe('seccionesDeEmpresa — gate por rol', () => {
  it('sin permisos no se muestra ninguna sección', () => {
    expect(seccionesDeEmpresa({ canSee: () => false })).toEqual([]);
  });
  it('con todo se muestran las 7', () => {
    expect(seccionesDeEmpresa({ canSee: () => true }).length).toBe(7);
  });
  it('un rol que solo ve empresas obtiene ficha e inventario', () => {
    const v = seccionesDeEmpresa({ canSee: (id) => id === 'empresas' });
    expect(v.map(s => s.id)).toEqual(['ficha', 'inventario']);
  });
});

describe('categorías del catálogo', () => {
  it('son las tres de la mig 172', () => {
    expect(CATEGORIAS_EMPRESA.map(c => c.v)).toEqual(['propia', 'consorcio', 'tercero']);
  });

  it('sin tipo_entidad una company cuenta como propia (el DEFAULT de la mig)', () => {
    expect(categoriaDeEmpresa({})).toBe('propia');
    expect(categoriaDeEmpresa({ tipo_entidad: 'inventado' })).toBe('propia');
    expect(categoriaDeEmpresa({ tipo_entidad: 'tercero' })).toBe('tercero');
  });

  it('agrupa el catálogo en las tres categorías, ordenado por nombre', () => {
    const g = empresasPorCategoria([
      { id: '1', name: 'ZETA', tipo_entidad: 'propia' },
      { id: '2', name: 'ALFA', tipo_entidad: 'propia' },
      { id: '3', name: 'EL INCA', tipo_entidad: 'consorcio' },
      { id: '4', name: 'PROVEEDOR', tipo_entidad: 'tercero' },
      { id: '5', name: 'BORRADA', tipo_entidad: 'propia', deleted_at: '2026-01-01' },
    ]);
    expect(g.find(x => x.v === 'propia').empresas.map(e => e.name)).toEqual(['ALFA', 'ZETA']);
    expect(g.find(x => x.v === 'consorcio').empresas.length).toBe(1);
    expect(g.find(x => x.v === 'tercero').empresas.length).toBe(1);
  });

  it('devuelve también las categorías vacías, para poder decirlo en pantalla', () => {
    const g = empresasPorCategoria([{ id: '1', name: 'ALFA', tipo_entidad: 'propia' }]);
    expect(g.length).toBe(3);
    expect(g.find(x => x.v === 'consorcio').empresas).toEqual([]);
  });

  it('busca por nombre, razón social y RUC', () => {
    const cs = [
      { id: '1', name: 'JARVEX', legal_name: 'JARVEX SAC', ruc: '20111', tipo_entidad: 'propia' },
      { id: '2', name: 'GASOMI', ruc: '20222', tipo_entidad: 'propia' },
    ];
    expect(empresasPorCategoria(cs, { texto: 'jarv' }).find(x => x.v === 'propia').empresas.length).toBe(1);
    expect(empresasPorCategoria(cs, { texto: '20222' }).find(x => x.v === 'propia').empresas[0].name).toBe('GASOMI');
    expect(empresasPorCategoria(cs, { texto: 'sac' }).find(x => x.v === 'propia').empresas[0].name).toBe('JARVEX');
  });

  it('sin datos no explota', () => {
    expect(empresasPorCategoria(null).length).toBe(3);
    expect(empresasPorCategoria(undefined)[0].empresas).toEqual([]);
  });
});
