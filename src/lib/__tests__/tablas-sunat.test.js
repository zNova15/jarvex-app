// Las tablas oficiales de SUNAT que usan el registro y los PLE (tanda 4).
import { describe, it, expect } from 'vitest';
import {
  TABLA_10, TABLA_2, nombreTabla10, nombreTabla2,
  tipoComprobante, tipoDocIdentidad, partirComprobante,
  esReciboHonorarios, reciboEsHonorarios,
  usaDependenciaAduanera, esDependenciaAduaneraValida,
} from '../tablas-sunat.js';

describe('las tablas en sí', () => {
  it('no tienen códigos repetidos y todos tienen nombre', () => {
    for (const tabla of [TABLA_10, TABLA_2]) {
      const codigos = tabla.map(t => t.codigo);
      expect(new Set(codigos).size).toBe(codigos.length);
      for (const t of tabla) expect(t.nombre.length).toBeGreaterThan(2);
    }
  });

  it('los códigos de la Tabla 10 son de dos dígitos', () => {
    for (const t of TABLA_10) expect(t.codigo).toMatch(/^\d{2}$/);
  });

  it('traen los cuatro que el grupo usa de verdad', () => {
    const cods = TABLA_10.map(t => t.codigo);
    expect(cods).toContain('01'); // factura, 1.710 en producción
    expect(cods).toContain('07'); // nota de crédito, 28
    expect(cods).toContain('02'); // recibo por honorarios, 3
    expect(cods).toContain('03'); // boleta, 1
    // Y el boleto aéreo, que hace falta en la tanda de SIRE.
    expect(cods).toContain('05');
  });

  it('dan el nombre oficial de un código', () => {
    expect(nombreTabla10('01')).toBe('Factura');
    expect(nombreTabla10('02')).toBe('Recibo por honorarios');
    expect(nombreTabla10('1')).toBe('Factura');      // normaliza a 2 dígitos
    expect(nombreTabla10('99')).toBe('');
    expect(nombreTabla2('6')).toBe('RUC');
    expect(nombreTabla2('a')).toBe('Cédula diplomática de identidad');
  });
});

describe('el tipo de comprobante (Tabla 10)', () => {
  it('reconoce los cuatro valores que hay en producción', () => {
    expect(tipoComprobante({ document_type: 'factura' })).toBe('01');
    expect(tipoComprobante({ document_type: 'nota_credito' })).toBe('07');
    expect(tipoComprobante({ document_type: 'boleta' })).toBe('03');
    expect(tipoComprobante({ document_type: 'recibo', category: 'Recibo Honorarios' })).toBe('02');
  });

  it('un «recibo» a secas NO se declara como factura: va a 00 Otros', () => {
    // Inventarle un '01' le declararía a SUNAT un crédito fiscal inexistente.
    expect(tipoComprobante({ document_type: 'recibo', third_party_ruc: '20100047218' })).toBe('00');
  });

  it('reconoce el recibo por honorarios por el RUC de persona natural', () => {
    expect(tipoComprobante({ document_type: 'recibo', third_party_ruc: '10718263358' })).toBe('02');
    expect(tipoComprobante({ document_type: 'recibo', third_party_ruc: '15615529351' })).toBe('02');
  });

  it('acepta un documento suelto, que es lo que le pasa el Libro Mayor', () => {
    expect(tipoComprobante('F001-00012345')).toBe('01');
    expect(tipoComprobante('E001-20')).toBe('01');
    expect(tipoComprobante('factura')).toBe('01');
  });

  it('cuando no reconoce nada devuelve el fallback, sin adivinar', () => {
    expect(tipoComprobante({ document_type: 'vale interno' })).toBe('00');
    expect(tipoComprobante({}, '01')).toBe('01');
  });

  it('el marcador de honorarios es el mismo para las dos pantallas', () => {
    const rh = { document_type: 'recibo', category: 'Recibo Honorarios' };
    expect(esReciboHonorarios(rh)).toBe(true);
    expect(reciboEsHonorarios(rh)).toBe(true);
    expect(esReciboHonorarios({ document_type: 'factura' })).toBe(false);
  });
});

describe('el documento de identidad (Tabla 2)', () => {
  it('lo deduce del número, que es más confiable que cualquier campo de tipo', () => {
    expect(tipoDocIdentidad('20613434195')).toBe('6');  // RUC
    expect(tipoDocIdentidad('40123456')).toBe('1');     // DNI
    expect(tipoDocIdentidad('001234567')).toBe('4');    // carnet de extranjería
    expect(tipoDocIdentidad('')).toBe('0');
  });

  it('también acepta el nombre del tipo', () => {
    expect(tipoDocIdentidad('RUC')).toBe('6');
    expect(tipoDocIdentidad('dni')).toBe('1');
    expect(tipoDocIdentidad('pasaporte')).toBe('7');
  });
});

describe('serie y número del comprobante', () => {
  it('los parte respetando los ceros de la izquierda', () => {
    expect(partirComprobante('F001-00012345')).toEqual({ serie: 'F001', numero: '00012345' });
    expect(partirComprobante('E001-20')).toEqual({ serie: 'E001', numero: '20' });
    expect(partirComprobante('B004-00008495')).toEqual({ serie: 'B004', numero: '00008495' });
  });

  it('sin guion, no inventa serie', () => {
    expect(partirComprobante('318973')).toEqual({ serie: '', numero: '318973' });
    expect(partirComprobante('')).toEqual({ serie: '', numero: '' });
  });
});

describe('la dependencia aduanera (Tabla 11)', () => {
  it('esa columna lleva el código de aduana solo en las importaciones', () => {
    expect(usaDependenciaAduanera({ document_type: 'dua' })).toBe(true);
    expect(usaDependenciaAduanera({ document_type: 'factura' })).toBe(false);
  });

  it('se le valida la forma: tres dígitos, no una serie', () => {
    expect(esDependenciaAduaneraValida('118')).toBe(true);
    expect(esDependenciaAduaneraValida('F001')).toBe(false);
    expect(esDependenciaAduaneraValida('')).toBe(false);
  });
});
