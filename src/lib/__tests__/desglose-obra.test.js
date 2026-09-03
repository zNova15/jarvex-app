import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GRUPOS_TRABAJO, grupoDePagina, paginasCanonicas, gruposDelTrabajo } from '../desglose-obra.js';
import { planoDe } from '../nav-planos.js';

// Páginas del plano OBRA que NO son una sección del desglose (son el desglose
// mismo o entradas de otro plano que el menú repite).
const NO_SON_SECCION = new Set(['panel-obra']);

/** Ids de página del NAV real (jx-sidebar.jsx), con su plano explícito. */
function itemsDelNav() {
  const src = readFileSync(new URL('../../components/jx-sidebar.jsx', import.meta.url), 'utf8');
  const ini = src.indexOf('const NAV = [');
  const fin = src.indexOf('\n];', ini);
  expect(ini, 'no se encontró el array NAV en jx-sidebar.jsx').toBeGreaterThan(-1);
  const bloque = src.slice(ini, fin);
  const items = [];
  for (const linea of bloque.split('\n')) {
    const m = linea.match(/\{\s*id:\s*'([^']+)'/);
    if (!m) continue;
    const p = linea.match(/plano:\s*'([^']+)'/);
    items.push({ id: m[1], plano: p ? p[1] : planoDe(m[1]) });
  }
  return items;
}

describe('desglose-obra — estructura de los grupos', () => {
  it('cada grupo tiene id, título, ícono y al menos una página', () => {
    for (const g of GRUPOS_TRABAJO) {
      expect(g.id, JSON.stringify(g)).toBeTruthy();
      expect(g.titulo, g.id).toBeTruthy();
      expect(g.icon, g.id).toBeTruthy();
      expect(g.items.length, g.id).toBeGreaterThan(0);
    }
  });

  it('los grupos son los 7 que definió Gabriel, en orden', () => {
    expect(GRUPOS_TRABAJO.map(g => g.id)).toEqual([
      'almacen', 'logistica', 'gestion', 'personal', 'especiales',
      'contabilidad-obra', 'cadenas',
    ]);
  });

  it('una página pertenece a UN SOLO grupo (canónico)', () => {
    const todas = paginasCanonicas();
    const dup = todas.filter((id, i) => todas.indexOf(id) !== i);
    expect(dup, `páginas en más de un grupo: ${dup.join(', ')}`).toEqual([]);
  });

  it('grupoDePagina resuelve las nuevas de la entrega B', () => {
    expect(grupoDePagina('movimientos-contables')).toBe('contabilidad-obra');
    expect(grupoDePagina('trazabilidad')).toBe('cadenas');
    expect(grupoDePagina('materiales')).toBe('almacen');
    expect(grupoDePagina('no-existe')).toBeNull();
  });
});

describe('desglose-obra — cobertura contra el menú real', () => {
  it('TODA página del plano obra del sidebar tiene grupo', () => {
    const huerfanas = itemsDelNav()
      .filter(it => it.plano === 'obra' && !NO_SON_SECCION.has(it.id))
      .map(it => it.id)
      .filter(id => !grupoDePagina(id));
    expect(huerfanas, `páginas de obra sin grupo en el desglose: ${huerfanas.join(', ')}`).toEqual([]);
  });

  it('ninguna página del desglose es del plano general (salvo las duales)', () => {
    const nav = itemsDelNav();
    const planoNav = new Map();
    for (const it of nav) if (it.plano === 'obra') planoNav.set(it.id, true);
    const fuera = paginasCanonicas().filter(id => !planoNav.has(id));
    expect(fuera, `páginas del desglose que el sidebar no ofrece en el plano obra: ${fuera.join(', ')}`).toEqual([]);
  });
});

describe('gruposDelTrabajo — filtro por rol', () => {
  const info = (id) => ({ label: id.toUpperCase(), icon: 'x' });

  it('sin permisos no devuelve ningún grupo', () => {
    expect(gruposDelTrabajo({ canSee: () => false, info })).toEqual([]);
  });

  it('un rol de almacén ve su grupo y no los demás', () => {
    const soloAlmacen = new Set(['materiales', 'mov-materiales', 'epps-inventario']);
    const gs = gruposDelTrabajo({ canSee: (id) => soloAlmacen.has(id), info });
    expect(gs.map(g => g.id)).toEqual(['almacen', 'especiales']);
    expect(gs[0].paginas.map(p => p.id)).toEqual(['materiales', 'mov-materiales', 'epps-inventario']);
    // 'epps-inventario' es `extra` de Almacén y canónico de Especiales: aparece
    // en las dos tarjetas a propósito (stock para la almacenera, EPP para SSOMA).
    expect(gs[1].paginas.map(p => p.id)).toEqual(['epps-inventario']);
  });

  it('una página que el menú no conoce se ignora (no rompe la tarjeta)', () => {
    const gs = gruposDelTrabajo({ canSee: () => true, info: (id) => id === 'materiales' ? { label: 'M' } : undefined });
    expect(gs.map(g => g.id)).toEqual(['almacen']);
    expect(gs[0].paginas).toEqual([{ id: 'materiales', label: 'M', icon: undefined }]);
  });

  it('sin argumentos no explota (todo visible)', () => {
    expect(gruposDelTrabajo().length).toBe(GRUPOS_TRABAJO.length);
  });
});
