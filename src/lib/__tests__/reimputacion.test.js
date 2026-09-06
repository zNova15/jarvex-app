import { describe, it, expect } from 'vitest';
import {
  DESTINOS_REIMPUTACION, validarReimputacion, cambiosDeReimputacion, explicarReimputacion,
} from '../reimputacion.js';

// El caso real que lo destapó (Gabriel, 5-sep-2026): E001-40, una VENTA de
// AGENCIA DE VIAJES VIAJEROS CAJAMARCA a CONSORCIO ESPERANZA (un tercero),
// imputada por error a la obra Plan Miraflores. Está marcada is_intercompany,
// que es lo que bloqueaba el editor.
const ventaCruzada = {
  id: 'e001-40', clase: 'venta', type: 'income', is_intercompany: true,
  obra_id: 'obra-miraflores', destino_contable: 'obra',
};

const compraDeObra = {
  id: 'c1', clase: 'compra', type: 'cost', is_intercompany: false,
  obra_id: 'obra-miraflores', destino_contable: 'obra',
};

describe('validarReimputacion — no se guarda una vinculación que no vincula', () => {
  it('destino "obra" sin obra elegida se rechaza', () => {
    expect(validarReimputacion({ destino_contable: 'obra' })).toMatch(/a qué obra/i);
    expect(validarReimputacion({ destino_contable: 'obra', obra_id: 'o1' })).toBe(null);
  });

  it('los destinos sin obra no piden obra', () => {
    for (const d of ['gastos_generales', 'contabilidad_neta', 'sin_clasificar']) {
      expect(validarReimputacion({ destino_contable: d })).toBe(null);
    }
  });

  it('sin destino, o con uno inventado, no pasa', () => {
    expect(validarReimputacion({})).toMatch(/destino/i);
    expect(validarReimputacion({ destino_contable: 'lo_que_sea' })).toMatch(/desconocido/i);
  });

  it('los cuatro destinos ofrecidos son los que entiende la clasificación contable', () => {
    expect(DESTINOS_REIMPUTACION.map(d => d.v).sort())
      .toEqual(['contabilidad_neta', 'gastos_generales', 'obra', 'sin_clasificar']);
  });
});

describe('cambiosDeReimputacion — solo toca la vinculación', () => {
  it('sacar de la obra a contabilidad neta LIMPIA obra_id', () => {
    const p = cambiosDeReimputacion(ventaCruzada, { destino_contable: 'contabilidad_neta' });
    expect(p.destino_contable).toBe('contabilidad_neta');
    expect(p.obra_id).toBe(null);
  });

  it('NUNCA devuelve monto, empresa ni fecha — por eso es segura en un intercompany', () => {
    const p = cambiosDeReimputacion(ventaCruzada, { destino_contable: 'contabilidad_neta' });
    for (const prohibido of ['amount', 'company_id', 'date', 'currency', 'related_company_id', 'clase']) {
      expect(p, prohibido).not.toHaveProperty(prohibido);
    }
  });

  it('🔴 en un intercompany el `type` NO se mueve: es lo que mantiene cuadrado el Consolidado', () => {
    for (const destino of ['obra', 'gastos_generales', 'contabilidad_neta', 'sin_clasificar']) {
      const p = cambiosDeReimputacion(ventaCruzada, { destino_contable: destino, obra_id: 'obra-x' });
      expect(p === null || !('type' in p), `destino ${destino}`).toBe(true);
    }
    // Y lo mismo para una COMPRA interna, que se fuerza a 'cost'.
    const compraInterna = { ...compraDeObra, is_intercompany: true };
    const p = cambiosDeReimputacion(compraInterna, { destino_contable: 'gastos_generales' });
    expect('type' in p).toBe(false);
  });

  it('en una compra NORMAL sí recalcula: obra → gastos generales pasa de costo a gasto', () => {
    const p = cambiosDeReimputacion(compraDeObra, { destino_contable: 'gastos_generales' });
    expect(p.type).toBe('expense');
    expect(p.obra_id).toBe(null);
  });

  it('…y al volver a una obra, de gasto a costo', () => {
    const gasto = { ...compraDeObra, obra_id: null, destino_contable: 'gastos_generales', type: 'expense' };
    const p = cambiosDeReimputacion(gasto, { destino_contable: 'obra', obra_id: 'obra-nueva' });
    expect(p.type).toBe('cost');
    expect(p.obra_id).toBe('obra-nueva');
  });

  it('mover de una obra a OTRA obra no cambia la clasificación, solo la obra', () => {
    const p = cambiosDeReimputacion(compraDeObra, { destino_contable: 'obra', obra_id: 'obra-san-marcos' });
    expect(p.obra_id).toBe('obra-san-marcos');
    expect('type' in p).toBe(false);
    expect('destino_contable' in p).toBe(false);
  });

  it('si no cambia nada, devuelve null (no se escribe por escribir)', () => {
    expect(cambiosDeReimputacion(compraDeObra, { destino_contable: 'obra', obra_id: 'obra-miraflores' })).toBe(null);
  });
});

describe('explicarReimputacion — la contadora ve el efecto ANTES de guardar', () => {
  const nombreObra = (id) => (id === 'obra-miraflores' ? 'Plan Miraflores' : 'Obras San Marcos');

  it('dice que deja de sumar en la obra de la que sale', () => {
    const t = explicarReimputacion(ventaCruzada, { destino_contable: 'contabilidad_neta' }, nombreObra);
    expect(t).toMatch(/Plan Miraflores/);
    expect(t).toMatch(/deja de sumar/i);
  });

  it('avisa que en un intercompany la clasificación queda fija, y por qué', () => {
    const t = explicarReimputacion(ventaCruzada, { destino_contable: 'contabilidad_neta' }, nombreObra);
    expect(t).toMatch(/Consolidado/);
  });

  it('en una compra normal anuncia el cambio de costo a gasto', () => {
    const t = explicarReimputacion(compraDeObra, { destino_contable: 'gastos_generales' }, nombreObra);
    expect(t).toMatch(/cost.*expense/);
  });

  it('sin cambios lo dice en vez de prometer algo', () => {
    expect(explicarReimputacion(compraDeObra, { destino_contable: 'obra', obra_id: 'obra-miraflores' }, nombreObra))
      .toMatch(/ya está así/i);
  });
});
