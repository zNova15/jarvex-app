// Ata los bloques de la pantalla principal al menú y al registro de páginas
// REALES. Un bloque que apunta a una página inexistente no rompe el build ni
// falla visiblemente: deja una tarjeta muerta en la primera pantalla de la app.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BLOQUES_INICIO, ATAJOS_INICIO, bloquesVisibles, atajosVisibles } from '../bloques-inicio.js';
import { planoDe } from '../nav-planos.js';

const leer = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/** Ids de página del NAV real (jx-sidebar.jsx). */
function idsDelNav() {
  const src = leer('../../components/jx-sidebar.jsx');
  const ini = src.indexOf('const NAV = [');
  const fin = src.indexOf('\n];', ini);
  expect(ini, 'no se encontró el array NAV en jx-sidebar.jsx').toBeGreaterThan(-1);
  return new Set([...src.slice(ini, fin).matchAll(/\{\s*id:\s*'([^']+)'/g)].map(m => m[1]));
}

/** Ids que jx-app.jsx sabe RENDERIZAR (PAGE_REGISTRY + los del switch). */
function idsRenderizables() {
  const src = leer('../../jx-app.jsx');
  const ids = new Set();
  const ini = src.indexOf('const PAGE_REGISTRY = {');
  const fin = src.indexOf('\n};', ini);
  expect(ini, 'no se encontró PAGE_REGISTRY en jx-app.jsx').toBeGreaterThan(-1);
  for (const m of src.slice(ini, fin).matchAll(/^\s*'([^']+)':\s*\{/gm)) ids.add(m[1]);
  // Páginas eager, resueltas en el switch de renderPage.
  for (const m of src.matchAll(/case\s+'([^']+)':/g)) ids.add(m[1]);
  return ids;
}

describe('bloques del Inicio — estructura', () => {
  it('son los cinco bloques del grupo, en orden', () => {
    expect(BLOQUES_INICIO.map(b => b.id)).toEqual([
      'trabajos', 'empresas', 'contabilidad', 'licitaciones', 'config',
    ]);
  });

  it('cada bloque tiene título, ícono, descripción y al menos una entrada', () => {
    for (const b of BLOQUES_INICIO) {
      expect(b.titulo, b.id).toBeTruthy();
      expect(b.icon, b.id).toBeTruthy();
      expect(b.desc, b.id).toBeTruthy();
      expect(b.entradas.length, b.id).toBeGreaterThan(0);
    }
  });
});

describe('bloques del Inicio — atados a las páginas reales', () => {
  it('cada entrada existe en el menú real (jx-sidebar NAV)', () => {
    const nav = idsDelNav();
    for (const b of BLOQUES_INICIO) {
      for (const id of b.entradas) {
        expect(nav.has(id), `el bloque "${b.id}" apunta a "${id}", que no está en el NAV`).toBe(true);
      }
    }
  });

  it('cada entrada la sabe renderizar jx-app (PAGE_REGISTRY o el switch)', () => {
    const render = idsRenderizables();
    for (const b of BLOQUES_INICIO) {
      for (const id of b.entradas) {
        expect(render.has(id), `el bloque "${b.id}" apunta a "${id}", que jx-app no sabe renderizar`).toBe(true);
      }
    }
  });

  it('🔴 toda entrada es del plano GENERAL: la pantalla principal no tiene obra activa', () => {
    for (const b of BLOQUES_INICIO) {
      for (const id of b.entradas) {
        expect(planoDe(id), `el bloque "${b.id}" lleva a "${id}", que es del plano obra`).toBe('general');
      }
    }
  });

  it('los atajos también existen y son del plano general', () => {
    const nav = idsDelNav();
    for (const a of ATAJOS_INICIO) {
      expect(nav.has(a.id), `el atajo "${a.id}" no está en el NAV`).toBe(true);
      expect(planoDe(a.id), `el atajo "${a.id}" es del plano obra`).toBe('general');
    }
  });
});

describe('bloquesVisibles / atajosVisibles — filtrado por rol', () => {
  it('sin permisos no se muestra ningún bloque (deny-by-default)', () => {
    expect(bloquesVisibles(() => false)).toEqual([]);
    expect(atajosVisibles(() => false)).toEqual([]);
  });

  it('con todos los permisos se muestran los cinco, con su primera entrada', () => {
    const v = bloquesVisibles(() => true);
    expect(v.length).toBe(5);
    expect(v.find(b => b.id === 'contabilidad').entrada).toBe('contabilidad');
    expect(v.find(b => b.id === 'config').entrada).toBe('usuarios');
  });

  it('usa la SIGUIENTE entrada cuando la primera no está permitida', () => {
    // La contadora no administra usuarios, pero sí entra a los ajustes.
    const canSee = (id) => id !== 'usuarios' && id !== 'contabilidad';
    const v = bloquesVisibles(canSee);
    expect(v.find(b => b.id === 'config').entrada).toBe('configuracion');
    expect(v.find(b => b.id === 'contabilidad').entrada).toBe('cont-dashboard');
  });

  it('el bloque Contabilidad NO ofrece la página dual de movimientos', () => {
    // Regresión: 'movimientos-contables' vive en los dos planos y planoDe() la
    // da como 'obra' — desde el Inicio (sin obra activa) metía al usuario en
    // el workspace de una obra cualquiera.
    const cont = BLOQUES_INICIO.find(b => b.id === 'contabilidad');
    expect(cont.entradas).not.toContain('movimientos-contables');
  });

  it('un rol que solo ve trabajos (almacenero) ve UN bloque', () => {
    const v = bloquesVisibles((id) => id === 'trabajos');
    expect(v.map(b => b.id)).toEqual(['trabajos']);
  });
});
