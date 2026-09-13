import { describe, it, expect } from 'vitest';
import { evaluarRecepcionAlmacen, obraRecibeAlmacen } from '../recepcion-almacen.js';

const OBRA_VIVA = { id: 'o1', nombre_obra: 'Plan Miraflores', estado: 'activo' };
const OBRA_FIN  = { id: 'o2', nombre_obra: 'Obras San Marcos', estado: 'terminado' };
const OBRAS = [OBRA_VIVA, OBRA_FIN];

describe('obraRecibeAlmacen', () => {
  it('una obra activa recibe', () => expect(obraRecibeAlmacen(OBRA_VIVA)).toBe(true));
  it('planificación y pausada también (se compra antes de arrancar)', () => {
    expect(obraRecibeAlmacen({ estado: 'planificacion' })).toBe(true);
    expect(obraRecibeAlmacen({ estado: 'pausado' })).toBe(true);
  });
  it('terminada o cancelada, no', () => {
    expect(obraRecibeAlmacen(OBRA_FIN)).toBe(false);
    expect(obraRecibeAlmacen({ estado: 'cancelado' })).toBe(false);
  });
  it('los estados legacy se normalizan (finalizada → terminado)', () => {
    expect(obraRecibeAlmacen({ estado: 'finalizada' })).toBe(false);
    expect(obraRecibeAlmacen({ estado: 'cancelada' })).toBe(false);
  });
  it('una obra borrada o inexistente, no', () => {
    expect(obraRecibeAlmacen({ ...OBRA_VIVA, deleted_at: '2026-01-01' })).toBe(false);
    expect(obraRecibeAlmacen(null)).toBe(false);
  });
  it('sin estado (fila vieja) se asume viva: no bloquear por un dato que falta', () => {
    expect(obraRecibeAlmacen({ id: 'o3' })).toBe(true);
  });
});

describe('evaluarRecepcionAlmacen', () => {
  const base = { obras: OBRAS };

  it('compra de bienes a una obra viva → permitido', () => {
    const v = evaluarRecepcionAlmacen({ ...base, obraDestino: 'o1' });
    expect(v.permitido).toBe(true);
    expect(v.obra).toBe(OBRA_VIVA);
    expect(v.texto).toBe('');
  });

  // El caso que reportó Gabriel: el casillero salía marcado igual.
  it('Gastos Generales de la Empresa → NO, y lo explica', () => {
    const v = evaluarRecepcionAlmacen({ ...base, obraDestino: '__empresa__' });
    expect(v.permitido).toBe(false);
    expect(v.motivo).toBe('gastos_generales');
    expect(v.texto).toMatch(/no entra al almacén/i);
  });

  it('Contabilidad Neta y "No sé" tampoco', () => {
    expect(evaluarRecepcionAlmacen({ ...base, obraDestino: '__otros__' }).permitido).toBe(false);
    expect(evaluarRecepcionAlmacen({ ...base, obraDestino: '__nose__' }).motivo).toBe('sin_clasificar');
  });

  it('sin destino elegido todavía → no, con el pedido de elegirlo', () => {
    const v = evaluarRecepcionAlmacen({ ...base, obraDestino: '' });
    expect(v.motivo).toBe('sin_destino');
    expect(v.texto).toMatch(/destino/i);
  });

  it('obra terminada → no, nombrándola', () => {
    const v = evaluarRecepcionAlmacen({ ...base, obraDestino: 'o2' });
    expect(v.permitido).toBe(false);
    expect(v.motivo).toBe('obra_cerrada');
    expect(v.texto).toContain('Obras San Marcos');
  });

  it('obra que ya no está en este dispositivo → no, y avisa que sincronice', () => {
    const v = evaluarRecepcionAlmacen({ ...base, obraDestino: 'fantasma' });
    expect(v.motivo).toBe('obra_inexistente');
  });

  it('los documentos que nunca fueron compra de bienes salen sin comentario', () => {
    for (const p of [{ esRxh: true }, { esNota: true }, { esVenta: true }]) {
      const v = evaluarRecepcionAlmacen({ ...base, obraDestino: 'o1', ...p });
      expect(v.permitido).toBe(false);
      expect(v.texto).toBe('');
    }
  });

  it('el tipo de documento gana sobre el destino (una NC a una obra viva no recepciona)', () => {
    expect(evaluarRecepcionAlmacen({ ...base, obraDestino: 'o1', esNota: true }).motivo).toBe('nota');
  });
});
