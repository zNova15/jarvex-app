import { describe, it, expect } from 'vitest';
import { valeLaPenaConsultar, compararSugerencia, CONFIANZA_MINIMA } from '../sugerencia-clasificacion.js';

const compraDeObra = {
  clase: 'compra', type: 'cost', obra_id: 'o1', destino_contable: 'obra',
  description: 'CEMENTO PORTLAND', third_party_name: 'FERRETERIA INDUSTRIAL',
};
const sug = (clasificacion, confianza = 0.9, razonamiento = 'porque sí') =>
  ({ result: { clasificacion }, confianza, razonamiento });

describe('valeLaPenaConsultar — no gastar una llamada donde no se puede aplicar', () => {
  it('una VENTA no se clasifica en costo/gasto', () => {
    expect(valeLaPenaConsultar({ ...compraDeObra, clase: 'venta' })).toBe(false);
  });

  it('una operación interna tiene el tipo forzado por el Consolidado', () => {
    expect(valeLaPenaConsultar({ ...compraDeObra, is_intercompany: true })).toBe(false);
  });

  it('sin nada que leer, la IA adivinaría', () => {
    expect(valeLaPenaConsultar({ clase: 'compra' })).toBe(false);
    expect(valeLaPenaConsultar({ clase: 'compra', description: 'CEMENTO' })).toBe(true);
    expect(valeLaPenaConsultar({ clase: 'compra', items: ['fierro'] })).toBe(true);
  });

  it('una compra normal con descripción sí se consulta', () => {
    expect(valeLaPenaConsultar(compraDeObra)).toBe(true);
  });
});

describe('compararSugerencia — solo interrumpe cuando hay desacuerdo', () => {
  it('si coincide, NO es una interrupción', () => {
    const r = compararSugerencia(compraDeObra, sug('cost'));
    expect(r.estado).toBe('coincide');
    expect(r.accion).toBe(null);
  });

  it('🔴 si contradice, lo dice con todas las letras y ofrece el arreglo', () => {
    // Útiles de oficina cargados a la obra: la IA dice gasto, la pantalla costo.
    const utiles = { ...compraDeObra, description: 'UTILES DE OFICINA', third_party_name: 'LIBRERIA' };
    const r = compararSugerencia(utiles, sug('expense', 0.88, 'No se consume en la obra.'));
    expect(r.estado).toBe('contradice');
    expect(r.actual).toBe('cost');
    expect(r.sugerido).toBe('expense');
    expect(r.titulo).toMatch(/GASTO de la empresa/);
    expect(r.detalle).toMatch(/No se consume/);
    // El arreglo lo saca de la obra hacia Gastos Generales.
    expect(r.accion.destino_contable).toBe('gastos_generales');
  });

  it('al revés: un gasto general que en realidad es costo de obra se arregla con override', () => {
    const gasto = { clase: 'compra', type: 'expense', destino_contable: 'gastos_generales', obra_id: null, description: 'FIERRO' };
    const r = compararSugerencia(gasto, sug('cost'));
    expect(r.estado).toBe('contradice');
    expect(r.titulo).toMatch(/COSTO de obra/);
    expect(r.accion.clasificacion_manual).toBe('cost');
  });

  it('con poca confianza avisa que NO sabe, en vez de empujar una respuesta', () => {
    const r = compararSugerencia(compraDeObra, sug('expense', CONFIANZA_MINIMA - 0.01));
    expect(r.estado).toBe('sin_confianza');
    expect(r.accion).toBe(null);
    expect(r.titulo).toMatch(/no está segura/i);
  });

  it('justo en el umbral sí opina', () => {
    expect(compararSugerencia(compraDeObra, sug('expense', CONFIANZA_MINIMA)).estado).toBe('contradice');
  });

  it('una clasificación fuera de cost|expense se ignora (anti-alucinación)', () => {
    expect(compararSugerencia(compraDeObra, sug('income')).estado).toBe('no_aplica');
    expect(compararSugerencia(compraDeObra, sug(null)).estado).toBe('no_aplica');
  });

  it('en una venta o un interco nunca se muestra nada', () => {
    expect(compararSugerencia({ ...compraDeObra, clase: 'venta' }, sug('expense')).estado).toBe('no_aplica');
    expect(compararSugerencia({ ...compraDeObra, is_intercompany: true }, sug('expense')).estado).toBe('no_aplica');
  });

  it('sin sugerencia no explota', () => {
    expect(compararSugerencia(compraDeObra, null).estado).toBe('no_aplica');
    expect(compararSugerencia(null, sug('cost')).estado).toBe('no_aplica');
  });
});
