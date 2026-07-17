import { describe, it, expect } from 'vitest';
import { bucketDeMovHerr } from '../stock-estados.js';

// bucketDeMovHerr decide QUÉ bucket de condición tocó un movimiento y con qué
// signo, para poder revertirlo al eliminar/reversar. Es la lógica que evita el
// drift del ROTOMARTILLOS (nuevo=2 con total real 1).
describe('bucketDeMovHerr', () => {
  it('ingreso → bucket nuevo, signo +1 (el caso del ROTOMARTILLOS)', () => {
    expect(bucketDeMovHerr({ tipo_movimiento: 'ingreso', accion: 'entrada', cantidad: 1 }))
      .toEqual({ estado: 'nuevo', signo: +1 });
  });

  it('ingreso viejo sin tipo_movimiento (solo accion=entrada) → nuevo', () => {
    expect(bucketDeMovHerr({ accion: 'entrada', cantidad: 2 }))
      .toEqual({ estado: 'nuevo', signo: +1 });
  });

  it('salida → bucket de la condición de origen (estado_salida), signo −1', () => {
    expect(bucketDeMovHerr({ tipo_movimiento: 'salida', accion: 'salida', estado_salida: 'bueno' }))
      .toEqual({ estado: 'bueno', signo: -1 });
  });

  it('salida sin condición persistida (movimiento viejo) → null (no se adivina el bucket)', () => {
    expect(bucketDeMovHerr({ tipo_movimiento: 'salida', accion: 'salida' })).toBe(null);
  });

  it('salida desde "sin clasificar" (_sin) → null (no tocó ningún bucket)', () => {
    expect(bucketDeMovHerr({ tipo_movimiento: 'salida', accion: 'salida', estado_salida: '_sin' })).toBe(null);
  });

  it('devolución → bucket de la condición de retorno (estado_devolucion), signo +1', () => {
    expect(bucketDeMovHerr({ tipo_movimiento: 'devolucion', accion: 'entrada', estado_devolucion: 'reparacion' }))
      .toEqual({ estado: 'reparacion', signo: +1 });
  });

  it('devolución sin condición persistida → null', () => {
    expect(bucketDeMovHerr({ tipo_movimiento: 'devolucion', accion: 'entrada' })).toBe(null);
  });

  it('null/undefined → null', () => {
    expect(bucketDeMovHerr(null)).toBe(null);
    expect(bucketDeMovHerr(undefined)).toBe(null);
  });

  // La reversión aplica delta = -signo*cant → deshace exactamente lo del alta.
  it('coherencia: el delta de reversión anula al del alta', () => {
    const ingreso = bucketDeMovHerr({ tipo_movimiento: 'ingreso', accion: 'entrada' });
    // alta hizo +cant en nuevo; reversión = -signo*cant = -1*cant → se cancela
    expect(-ingreso.signo).toBe(-1);
    const salida = bucketDeMovHerr({ tipo_movimiento: 'salida', accion: 'salida', estado_salida: 'nuevo' });
    // alta hizo -cant en nuevo; reversión = -(-1)*cant = +cant → se cancela
    expect(-salida.signo).toBe(+1);
  });
});
