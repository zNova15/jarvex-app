import { describe, it, expect } from 'vitest';
import { almacenesDeMov, obsLegible } from '../almacenes-mov.js';

// Estas dos funciones vivían dentro de jx-movimientos.jsx, así que la TABLA
// mostraba «Almacén salida» y «Almacén llegada» pero el EXCEL de esos mismos
// movimientos exportaba una sola columna «Almacén» con la ubicación cruda. En
// un traspaso eso pierde la mitad del dato — uno de los «no trae todos los
// datos» que reportó la almacenera el 8-set-2026.

const UBIC = new Map([['u1', 'Almacén Central'], ['u2', 'Almacén Frente A']]);

describe('almacenesDeMov — de dónde salió y a dónde llegó', () => {
  it('una salida sale del almacén de la fila y no llega a ninguno', () => {
    const r = almacenesDeMov({ tipo_movimiento: 'salida', ubicacion_id: 'u1' }, UBIC);
    expect(r).toEqual({ salida: 'Almacén Central', llegada: null, esTraspaso: false });
  });

  it('una entrada llega al almacén de la fila', () => {
    const r = almacenesDeMov({ tipo_movimiento: 'entrada', ubicacion_id: 'u2' }, UBIC);
    expect(r).toEqual({ salida: null, llegada: 'Almacén Frente A', esTraspaso: false });
  });

  it('las acciones de herramientas que también son stock que SALE', () => {
    for (const t of ['merma', 'baja', 'mantenimiento']) {
      expect(almacenesDeMov({ tipo_movimiento: t, ubicacion_id: 'u1' }, UBIC).salida).toBe('Almacén Central');
    }
    // `accion` es el campo de herramientas; manda sobre tipo_movimiento.
    expect(almacenesDeMov({ accion: 'salida', ubicacion_id: 'u1' }, UBIC).llegada).toBeNull();
  });

  it('un traspaso trae LOS DOS lados — el otro viene en la observación', () => {
    const sale = almacenesDeMov({ tipo_movimiento: 'salida', ubicacion_id: 'u1', observaciones: 'Traspaso → Almacén Frente A · lo pidió el residente' }, UBIC);
    expect(sale).toEqual({ salida: 'Almacén Central', llegada: 'Almacén Frente A', esTraspaso: true });
    const llega = almacenesDeMov({ tipo_movimiento: 'entrada', ubicacion_id: 'u2', observaciones: 'Traspaso ← Almacén Central' }, UBIC);
    expect(llega).toEqual({ salida: 'Almacén Central', llegada: 'Almacén Frente A', esTraspaso: true });
  });

  it('el formato LEGADO trae los dos lados en la observación y la fila sin ubicación', () => {
    const r = almacenesDeMov({ tipo_movimiento: 'salida', ubicacion_id: null, observaciones: 'Traspaso Depósito Viejo → Obra Norte' }, UBIC);
    expect(r).toEqual({ salida: 'Depósito Viejo', llegada: 'Obra Norte', esTraspaso: true });
  });

  it('una ubicación que ya no existe no rompe: queda en blanco', () => {
    expect(almacenesDeMov({ tipo_movimiento: 'salida', ubicacion_id: 'borrada' }, UBIC).salida).toBeNull();
    expect(almacenesDeMov({ tipo_movimiento: 'salida', ubicacion_id: 'u1' }, null).salida).toBeNull();
  });
});

describe('obsLegible — la nota humana, sin la codificación del traspaso', () => {
  it('saca las tres formas de codificar un traspaso', () => {
    expect(obsLegible({ observaciones: 'Traspaso → Almacén Frente A · lo pidió el residente' })).toBe('lo pidió el residente');
    expect(obsLegible({ observaciones: 'Traspaso ← Almacén Central · devolución parcial' })).toBe('devolución parcial');
    expect(obsLegible({ observaciones: 'Traspaso Depósito → Obra Norte' })).toBe('');
  });

  it('una observación normal se devuelve entera', () => {
    expect(obsLegible({ observaciones: 'faltaban 2 bolsas · se avisó al proveedor' })).toBe('faltaban 2 bolsas · se avisó al proveedor');
  });

  it('sin observación devuelve cadena vacía, no null', () => {
    expect(obsLegible({})).toBe('');
    expect(obsLegible(null)).toBe('');
  });
});
