// El directorio de «a quién se le compra»: que un RUC encuentre a su dueño,
// que el mismo RUC no aparezca tres veces, y que el grupo gane.
import { describe, it, expect } from 'vitest';
import {
  directorioDeCompra, buscarDestinatario, porRucExacto, pareceRuc,
  esBusquedaPorRuc, destinatarioDeCandidato, normNombre,
} from '../directorio-compra.js';

const COMPANIES = [
  { id: 'c-jarvex', name: 'JARVEX INGENIERIA', legal_name: 'JARVEX INGENIERIA E.I.R.L.', ruc: '20615646505', address: 'Av. Siempre 1' },
  { id: 'c-gasomi', name: 'GASOMI', legal_name: 'GASOMI E.I.R.L.', ruc: '20601234567' },
  { id: 'c-inca', name: 'CONSORCIO EL INCA', ruc: '20615346081' },
];

const PROVEEDORES = [
  { id: 'p-1', razon_social: 'FERRETERIA SAN MARTIN SAC', ruc: '20512345678', direccion: 'Jr. Union 200' },
  // El MISMO RUC que una empresa nuestra: alguien la tipeó al capturar.
  { id: 'p-2', razon_social: 'GASOMI EIRL', ruc: '20601234567' },
  { id: 'p-3', razon_social: 'PROVEEDOR SIN RUC' },
  { id: 'p-4', razon_social: 'INACTIVO SAC', ruc: '20599999999', estado: 'inactivo' },
];

const MOVS = [
  { id: 'm1', type: 'cost', clase: 'compra', company_id: 'c-jarvex', date: '2026-06-01',
    third_party_name: 'DISTRIBUIDORA ANDINA SRL', third_party_ruc: '20477777777' },
  { id: 'm2', type: 'cost', clase: 'compra', company_id: 'c-jarvex', date: '2026-07-01',
    third_party_name: 'DISTRIBUIDORA ANDINA SRL', third_party_ruc: '20477777777' },
  // Una VENTA: el tercero acá es el CLIENTE, no alguien a quien comprarle.
  { id: 'm3', type: 'income', clase: 'venta', company_id: 'c-jarvex', date: '2026-07-02',
    third_party_name: 'MUNICIPALIDAD DE MIRAFLORES', third_party_ruc: '20131371355' },
  { id: 'm4', type: 'cost', clase: 'compra', company_id: 'c-jarvex', date: '2026-07-03',
    third_party_name: 'ANULADA SAC', third_party_ruc: '20466666666', payment_status: 'cancelled' },
];

const dir = () => directorioDeCompra({ companies: COMPANIES, proveedores: PROVEEDORES, movs: MOVS });

describe('normNombre', () => {
  it('saca tildes, puntuación y colapsa espacios', () => {
    expect(normNombre('FERRETERÍA  SAN-MARTÍN S.A.C.')).toBe('ferreteria san martin s a c');
  });
});

describe('pareceRuc / esBusquedaPorRuc', () => {
  it('acepta los cuatro prefijos que emite SUNAT', () => {
    expect(pareceRuc('20615646505')).toBe(true);
    expect(pareceRuc('10456789012')).toBe(true);
    expect(pareceRuc('30615646505')).toBe(false);   // prefijo que no existe
    expect(pareceRuc('2061564650')).toBe(false);    // 10 dígitos
  });
  it('tolera el RUC tipeado con espacios o guiones', () => {
    expect(pareceRuc('20-615 646.505')).toBe(true);
  });
  it('distingue buscar por número de buscar por nombre', () => {
    expect(esBusquedaPorRuc('20615')).toBe(true);
    expect(esBusquedaPorRuc('gasomi')).toBe(false);
    expect(esBusquedaPorRuc('20')).toBe(false);     // muy corto para ser una búsqueda
  });
});

describe('directorioDeCompra', () => {
  it('junta las tres fuentes', () => {
    const d = dir();
    const tipos = new Set(d.map(c => c.tipo));
    expect(tipos).toEqual(new Set(['grupo', 'proveedor', 'tercero']));
  });

  it('🔴 el mismo RUC aparece UNA vez y gana la empresa del grupo', () => {
    const d = dir();
    const gasomi = d.filter(c => c.ruc === '20601234567');
    expect(gasomi).toHaveLength(1);
    expect(gasomi[0].tipo).toBe('grupo');
    expect(gasomi[0].companyId).toBe('c-gasomi');
    // El proveedor duplicado no se pierde: su id queda para no romper vínculos.
    expect(gasomi[0].proveedorId).toBe('p-2');
  });

  it('no ofrece a la empresa que emite: nadie se compra a sí mismo', () => {
    const d = directorioDeCompra({ companies: COMPANIES, proveedores: [], movs: [], excluirCompanyId: 'c-jarvex' });
    expect(d.find(c => c.companyId === 'c-jarvex')).toBeUndefined();
  });

  it('el tercero con papel entra, con cuántas veces se le compró', () => {
    const andina = dir().find(c => c.ruc === '20477777777');
    expect(andina.tipo).toBe('tercero');
    expect(andina.veces).toBe(2);
    expect(andina.ultimaFecha).toBe('2026-07-01');
  });

  it('un CLIENTE no entra: a un cliente no se le emite una orden de compra', () => {
    expect(dir().find(c => c.ruc === '20131371355')).toBeUndefined();
  });

  it('un comprobante anulado no da de alta a nadie', () => {
    expect(dir().find(c => c.ruc === '20466666666')).toBeUndefined();
  });

  it('un proveedor inactivo no se ofrece', () => {
    expect(dir().find(c => c.ruc === '20599999999')).toBeUndefined();
  });

  it('sin RUC la clave es el nombre: dos «sin RUC» distintos no se fusionan', () => {
    const d = directorioDeCompra({
      companies: [], movs: [],
      proveedores: [{ id: 'a', razon_social: 'UNO' }, { id: 'b', razon_social: 'DOS' }],
    });
    expect(d).toHaveLength(2);
  });
});

describe('buscarDestinatario', () => {
  it('por RUC completo trae exactamente a ése', () => {
    const r = buscarDestinatario(dir(), '20512345678');
    expect(r[0].nombre).toBe('FERRETERIA SAN MARTIN SAC');
  });

  it('por RUC parcial funciona como prefijo — «si es que me acuerdo»', () => {
    const r = buscarDestinatario(dir(), '2061');
    expect(r.length).toBeGreaterThan(1);
    expect(r.every(c => c.ruc.startsWith('2061'))).toBe(true);
  });

  it('🔴 buscando por RUC NO devuelve a los que no tienen RUC cargado', () => {
    const r = buscarDestinatario(dir(), '205123');
    expect(r.find(c => c.nombre === 'PROVEEDOR SIN RUC')).toBeUndefined();
  });

  it('por razón social, sin importar tildes ni mayúsculas', () => {
    const r = buscarDestinatario(dir(), 'ferretería san');
    expect(r[0].nombre).toBe('FERRETERIA SAN MARTIN SAC');
  });

  it('exige TODOS los tokens, como el resto de la app', () => {
    expect(buscarDestinatario(dir(), 'ferreteria inexistente')).toHaveLength(0);
  });

  it('a igual parecido, la empresa del grupo va primero', () => {
    const r = buscarDestinatario(dir(), 'gasomi');
    expect(r[0].tipo).toBe('grupo');
  });

  it('sin texto no inventa resultados', () => {
    expect(buscarDestinatario(dir(), '')).toEqual(expect.any(Array));
  });
});

describe('porRucExacto', () => {
  it('encuentra el duplicado antes de que alguien lo cargue dos veces', () => {
    expect(porRucExacto(dir(), '20 512 345 678').nombre).toBe('FERRETERIA SAN MARTIN SAC');
  });
  it('un RUC incompleto no matchea nada', () => {
    expect(porRucExacto(dir(), '2051234')).toBeNull();
  });
});

describe('destinatarioDeCandidato', () => {
  it('la empresa del grupo viaja con su companyId — es lo que abre el buzón', () => {
    const cand = dir().find(c => c.companyId === 'c-gasomi');
    const d = destinatarioDeCandidato(cand);
    expect(d.modo).toBe('grupo');
    expect(d.companyId).toBe('c-gasomi');
    expect(d.ruc).toBe('20601234567');
  });
  it('sin candidato devuelve el molde vacío, no revienta', () => {
    expect(destinatarioDeCandidato(null).modo).toBe('nuevo');
  });
});
