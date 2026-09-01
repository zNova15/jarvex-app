import { describe, it, expect } from 'vitest';
import {
  clasificarPartes, permiteCrearProveedor, permiteCrearEmpresaGrupo, empresaDelMovimiento,
  OP_COMPRA, OP_VENTA_EXTERNA, OP_INTERCO, OP_AJENA,
} from '../partes-comprobante.js';

const compra  = { emisorEsNuestro: false, receptorEsNuestro: true };
const venta   = { emisorEsNuestro: true,  receptorEsNuestro: false };
const interco = { emisorEsNuestro: true,  receptorEsNuestro: true };
const ajena   = { emisorEsNuestro: false, receptorEsNuestro: false };

describe('clasificarPartes', () => {
  it('los cuatro casos', () => {
    expect(clasificarPartes(compra)).toBe(OP_COMPRA);
    expect(clasificarPartes(venta)).toBe(OP_VENTA_EXTERNA);
    expect(clasificarPartes(interco)).toBe(OP_INTERCO);
    expect(clasificarPartes(ajena)).toBe(OP_AJENA);
  });
  it('sin datos no rompe (cae a ajena)', () => {
    expect(clasificarPartes()).toBe(OP_AJENA);
  });
});

// El bug de Gabriel (1-sep): factura donde NOSOTROS vendemos a un externo.
describe('venta a cliente externo — lo que NO se debe poder crear', () => {
  const op = clasificarPartes(venta);

  it('NO ofrece dar de alta a nuestra propia empresa como proveedor', () => {
    expect(permiteCrearProveedor(op)).toBe(false);
  });

  it('NO ofrece incorporar al cliente externo como empresa del grupo', () => {
    expect(permiteCrearEmpresaGrupo(op)).toBe(false);
  });

  it('la empresa del movimiento es el EMISOR (nosotros), no el receptor', () => {
    expect(empresaDelMovimiento(op, { emisorCompanyId: 'nuestra', receptorCompanyId: null })).toBe('nuestra');
  });
});

describe('compra normal — sigue funcionando como siempre', () => {
  const op = clasificarPartes(compra);
  it('el emisor sí puede darse de alta como proveedor', () => {
    expect(permiteCrearProveedor(op)).toBe(true);
  });
  it('la empresa del movimiento es el receptor (nosotros)', () => {
    expect(empresaDelMovimiento(op, { emisorCompanyId: null, receptorCompanyId: 'nuestra' })).toBe('nuestra');
  });
});

describe('intercompany — ninguna alta, ya son las dos nuestras', () => {
  const op = clasificarPartes(interco);
  it('ni proveedor ni empresa nueva', () => {
    expect(permiteCrearProveedor(op)).toBe(false);
    expect(permiteCrearEmpresaGrupo(op)).toBe(false);
  });
  it('la empresa del movimiento es el emisor (quien vende)', () => {
    expect(empresaDelMovimiento(op, { emisorCompanyId: 'A', receptorCompanyId: 'B' })).toBe('A');
  });
});

describe('ninguna parte reconocida', () => {
  const op = clasificarPartes(ajena);
  it('sigue permitiendo las altas: puede ser un proveedor nuevo y una empresa del grupo sin registrar', () => {
    expect(permiteCrearProveedor(op)).toBe(true);
    expect(permiteCrearEmpresaGrupo(op)).toBe(true);
  });
});
