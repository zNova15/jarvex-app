// ═══════════════════════════════════════════════════════════════════
// ELIMINAR Y FUSIONAR CLASIFICACIONES PROPIAS (tanda 8, 15-set-2026).
//
// Los dos casos de Gabriel: la que creó por error y no se podía borrar, y las
// varias que la IA le hizo crear con el mismo nombre.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { planBaja, planFusion, loQueApuntaA, parecidasEntreSi } from '../fusion-clasificaciones.js';

const CATS = [
  { codigo: '51', nombre: 'Pinturas', label: '[51] Pinturas', arbol: 'insumo' },
  { codigo: 'S13', nombre: 'Servicios básicos', label: '[S13] Servicios básicos', arbol: 'servicio' },
  { codigo: 'PI-PINT-BARN', nombre: 'Pinturas y barnices', label: '[PI-PINT-BARN] Pinturas y barnices', arbol: 'insumo', propia: true },
  { codigo: 'PI-PINT-ANTI', nombre: 'Pinturas anticorrosivas', label: '[PI-PINT-ANTI] Pinturas anticorrosivas', arbol: 'insumo', propia: true },
  { codigo: 'PI-VACIA', nombre: 'Me equivoqué', label: '[PI-VACIA] Me equivoqué', arbol: 'insumo', propia: true },
  { codigo: 'PS-ALQ', nombre: 'Alquileres varios', label: '[PS-ALQ] Alquileres varios', arbol: 'servicio', propia: true },
];

const INSUMOS = [
  { id: 'i1', nombre: 'ESMALTE SINTETICO', familia: 'PI-PINT-BARN' },
  { id: 'i2', nombre: 'BARNIZ MARINO', familia: 'PI-PINT-BARN' },
  { id: 'i3', nombre: 'LATEX BLANCO', familia: '51' },
  { id: 'i4', nombre: 'BORRADA', familia: 'PI-PINT-BARN', deleted_at: '2026-09-01' },
];

const TERMINOS = [
  { id: 't1', termino: 'ESMALTE', norm: 'esmalte', clasificacion_codigo: 'PI-PINT-BARN' },
  { id: 't2', termino: 'BARNIZ', norm: 'barniz', clasificacion_codigo: 'PI-PINT-BARN' },
  { id: 't3', termino: 'ESMALTE', norm: 'esmalte', clasificacion_codigo: 'PI-PINT-ANTI' },
];

const DECISIONES = [
  { id: 'd1', norm: 'esmalte sintetico blanco', familia: 'PI-PINT-BARN' },
  { id: 'd2', norm: 'latex', familia: '51' },
];

describe('lo que apunta a una clasificación', () => {
  it('junta las tres tablas y descarta lo borrado', () => {
    const u = loQueApuntaA('PI-PINT-BARN', { insumos: INSUMOS, terminos: TERMINOS, decisiones: DECISIONES });
    expect(u.insumos.map(r => r.id)).toEqual(['i1', 'i2']);
    expect(u.terminos.map(r => r.id)).toEqual(['t1', 't2']);
    expect(u.decisiones.map(r => r.id)).toEqual(['d1']);
  });
});

describe('dar de baja', () => {
  it('la creada por error, que no usa nadie, se borra sin más', () => {
    const p = planBaja({ codigo: 'PI-VACIA', cats: CATS, insumos: INSUMOS, terminos: TERMINOS, decisiones: DECISIONES });
    expect(p.ok).toBe(true);
    expect(p.vacia).toBe(true);
  });

  it('la que tiene contenido NO está vacía y dice cuánto arrastra', () => {
    const p = planBaja({ codigo: 'PI-PINT-BARN', cats: CATS, insumos: INSUMOS, terminos: TERMINOS, decisiones: DECISIONES });
    expect(p.vacia).toBe(false);
    expect(p.nInsumos).toBe(2);
    expect(p.nTerminos).toBe(2);
    expect(p.nDecisiones).toBe(1);
  });

  it('🔴 la base oficial no se borra: es la ley', () => {
    const p = planBaja({ codigo: '51', cats: CATS });
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/norma|oficial/i);
  });

  it('una que no existe tampoco', () => {
    expect(planBaja({ codigo: 'NO-EXISTE', cats: CATS }).ok).toBe(false);
  });
});

describe('fusionar dos propias en una', () => {
  const plan = () => planFusion({
    desde: 'PI-PINT-BARN', hacia: 'PI-PINT-ANTI',
    cats: CATS, insumos: INSUMOS, terminos: TERMINOS, decisiones: DECISIONES,
  });

  it('mueve insumos, términos y decisiones', () => {
    const p = plan();
    expect(p.ok).toBe(true);
    expect(p.insumos.map(r => r.id)).toEqual(['i1', 'i2']);
    expect(p.decisiones.map(r => r.id)).toEqual(['d1']);
  });

  it('🔴 el término repetido NO viaja: el destino ya tiene «esmalte»', () => {
    const p = plan();
    expect(p.moverTerminos.map(t => t.id)).toEqual(['t2']);
    expect(p.descartarTerminos.map(t => t.id)).toEqual(['t1']);
  });

  it('el resumen se puede leer antes de escribir nada', () => {
    const p = plan();
    expect(p.resumen.join(' · ')).toMatch(/2 insumos pasan/);
    expect(p.resumen.join(' · ')).toMatch(/repetido se descarta/);
  });

  it('una propia puede irse a una OFICIAL — es cómo se deshace haber duplicado la norma', () => {
    const p = planFusion({ desde: 'PI-PINT-BARN', hacia: '51', cats: CATS, insumos: INSUMOS, terminos: TERMINOS, decisiones: DECISIONES });
    expect(p.ok).toBe(true);
    expect(p.hacia.codigo).toBe('51');
  });

  it('🔴 la oficial NO puede ser el origen', () => {
    const p = planFusion({ desde: '51', hacia: 'PI-PINT-BARN', cats: CATS });
    expect(p.ok).toBe(false);
  });

  it('🔴 no se mezclan los dos árboles', () => {
    const p = planFusion({ desde: 'PS-ALQ', hacia: 'PI-PINT-ANTI', cats: CATS });
    expect(p.ok).toBe(false);
    expect(p.error).toMatch(/árbol|arbol/i);
  });

  it('no se fusiona consigo misma ni sin destino', () => {
    expect(planFusion({ desde: 'PI-VACIA', hacia: 'PI-VACIA', cats: CATS }).ok).toBe(false);
    expect(planFusion({ desde: 'PI-VACIA', hacia: '', cats: CATS }).ok).toBe(false);
  });
});

describe('avisar de las que se parecen entre sí', () => {
  it('encuentra el par de pinturas propias', () => {
    const pares = parecidasEntreSi([
      { codigo: 'PI-A', nombre: 'Pinturas', arbol: 'insumo', propia: true },
      { codigo: 'PI-B', nombre: 'Pinturas y barnices', arbol: 'insumo', propia: true },
    ]);
    expect(pares).toHaveLength(1);
  });

  it('no compara contra la base oficial', () => {
    expect(parecidasEntreSi(CATS.filter(c => !c.propia))).toHaveLength(0);
  });

  it('no cruza árboles', () => {
    const pares = parecidasEntreSi([
      { codigo: 'PI-A', nombre: 'Alquileres', arbol: 'insumo', propia: true },
      { codigo: 'PS-A', nombre: 'Alquileres', arbol: 'servicio', propia: true },
    ]);
    expect(pares).toHaveLength(0);
  });
});
