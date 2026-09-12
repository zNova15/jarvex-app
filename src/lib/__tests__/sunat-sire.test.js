import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  LIBRO_RVIE_REEMPLAZO,
  LIBRO_RCE_REEMPLAZO,
  buildSireFilenameBase,
  generateReemplazoPropuestaRVIE,
  generateReemplazoPropuestaRCE,
  createSireZip,
  buildSireZipPackage,
  analizarComprobantesParaSire,
} from '../sunat-sire.js';

const RUC_EMPRESA = '20615346081';
const RAZON_SOCIAL = 'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.';
const PERIODO = { anio: 2026, mes: 7 };

describe('Nomenclatura reglamentaria SUNAT SIRE', () => {
  it('genera el nombre base exacto de 33 caracteres para RVIE Reemplazo (140400)', () => {
    const filenameBase = buildSireFilenameBase(RUC_EMPRESA, PERIODO, LIBRO_RVIE_REEMPLAZO, true, false);
    expect(filenameBase).toBe('LE2061534608120260700140400021112');
    expect(filenameBase.length).toBe(33);
  });

  it('genera el nombre base exacto de 33 caracteres para RCE Reemplazo (080400)', () => {
    const filenameBase = buildSireFilenameBase(RUC_EMPRESA, PERIODO, LIBRO_RCE_REEMPLAZO, true, false);
    expect(filenameBase).toBe('LE2061534608120260700080400021112');
    expect(filenameBase.length).toBe(33);
  });

  it('permite periodo en formato string AAAAMM', () => {
    const filenameBase = buildSireFilenameBase(RUC_EMPRESA, '202407', LIBRO_RVIE_REEMPLAZO, true, false);
    expect(filenameBase).toBe('LE2061534608120240700140400021112');
  });
});

describe('Generador RVIE Reemplazo de Propuesta (Libro 140400)', () => {
  const movVenta1 = {
    id: 'v1',
    company_id: 'emp-1',
    type: 'income',
    date: '2026-07-05',
    document_type: 'factura',
    document_number: 'F001-00000123',
    third_party_ruc: '20501234567',
    third_party_name: 'CLIENTE CONSTRUCTORA SAC',
    amount: 1180.00,
    currency: 'PEN',
  };

  const movVenta2 = {
    id: 'v2',
    company_id: 'emp-1',
    type: 'income',
    date: '2026-07-10',
    document_type: 'boleta',
    document_number: 'B001-456',
    third_party_ruc: '10445566778',
    third_party_name: 'CLIENTE PARTICULAR',
    amount: 200.00,
    currency: 'PEN',
  };

  it('genera las 40 columnas reglamentarias por línea delimitadas por pipes', () => {
    const res = generateReemplazoPropuestaRVIE([movVenta1], PERIODO, RUC_EMPRESA, RAZON_SOCIAL);
    expect(res.registros).toBe(1);
    expect(res.zipFilename).toBe('LE2061534608120260700140400021112.zip');
    expect(res.txtFilename).toBe('LE2061534608120260700140400021112.txt');

    const lineas = res.txtContent.trim().split('\r\n');
    expect(lineas).toHaveLength(1);

    const linea = lineas[0];
    // En SIRE la línea termina en pipe, así que al dividir por '|' da 41 elementos (el último vacío tras el pipe final)
    const partes = linea.split('|');
    expect(partes).toHaveLength(41);
    expect(partes[40]).toBe(''); // por el pipe final

    // Validar campos clave:
    expect(partes[0]).toBe(RUC_EMPRESA); // 1. RUC Generador
    expect(partes[1]).toBe(RAZON_SOCIAL); // 2. Razón social
    expect(partes[2]).toBe('202607'); // 3. Periodo
    expect(partes[4]).toBe('05/07/2026'); // 5. Fecha de emisión
    expect(partes[6]).toBe('01'); // 7. Tipo CP Factura
    expect(partes[7]).toBe('F001'); // 8. Serie
    expect(partes[8]).toBe('00000123'); // 9. Correlativo
    expect(partes[10]).toBe('6'); // 11. Tipo doc cliente RUC
    expect(partes[11]).toBe('20501234567'); // 12. Nro doc cliente
    expect(partes[14]).toBe('1000.00'); // 15. Base gravada
    expect(partes[16]).toBe('180.00'); // 17. IGV
    expect(partes[24]).toBe('1180.00'); // 25. Total
    expect(partes[25]).toBe('PEN'); // 26. Moneda
    expect(partes[39]).toBe('1'); // 40. Indicador de estado (1)
  });

  it('permite exportar solo los comprobantes seleccionados por ID', () => {
    const res = generateReemplazoPropuestaRVIE([movVenta1, movVenta2], PERIODO, RUC_EMPRESA, RAZON_SOCIAL, {
      seleccionadosIds: ['v2'],
    });
    expect(res.registros).toBe(1);
    expect(res.totTotal).toBe(200.00);
    const lineas = res.txtContent.trim().split('\r\n');
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toContain('B001|456|');
  });
});

describe('Generador RCE Reemplazo de Propuesta (Libro 080400)', () => {
  const movCompra1 = {
    id: 'c1',
    company_id: 'emp-1',
    type: 'cost',
    date: '2026-07-15',
    document_type: 'factura',
    document_number: 'E001-8899',
    third_party_ruc: '20100088899',
    third_party_name: 'PROVEEDOR MATERIALES SAC',
    amount: 590.00,
    currency: 'PEN',
    detraccion_fecha: '2026-07-16',
    detraccion_numero: '987654321',
  };

  it('genera las 42 columnas reglamentarias por línea delimitadas por pipes', () => {
    const res = generateReemplazoPropuestaRCE([movCompra1], PERIODO, RUC_EMPRESA, RAZON_SOCIAL);
    expect(res.registros).toBe(1);
    expect(res.zipFilename).toBe('LE2061534608120260700080400021112.zip');
    expect(res.txtFilename).toBe('LE2061534608120260700080400021112.txt');

    const lineas = res.txtContent.trim().split('\r\n');
    expect(lineas).toHaveLength(1);

    const partes = lineas[0].split('|');
    // 42 campos + pipe final = 43 elementos
    expect(partes).toHaveLength(43);
    expect(partes[42]).toBe('');

    // Validar campos clave:
    expect(partes[0]).toBe(RUC_EMPRESA); // 1. RUC deudor
    expect(partes[1]).toBe(RAZON_SOCIAL); // 2. Razón social
    expect(partes[2]).toBe('202607'); // 3. Periodo
    expect(partes[4]).toBe('15/07/2026'); // 5. Fecha emision
    expect(partes[6]).toBe('01'); // 7. Tipo CP
    expect(partes[7]).toBe('E001'); // 8. Serie
    expect(partes[9]).toBe('8899'); // 10. Correlativo
    expect(partes[11]).toBe('6'); // 12. Tipo doc prov
    expect(partes[12]).toBe('20100088899'); // 13. RUC prov
    expect(partes[14]).toBe('500.00'); // 15. Base gravada
    expect(partes[15]).toBe('90.00'); // 16. IGV
    expect(partes[24]).toBe('590.00'); // 25. Total
    expect(partes[32]).toBe('16/07/2026'); // 33. Fecha detracción
    expect(partes[33]).toBe('987654321'); // 34. Nro constancia detracción
    expect(partes[41]).toBe('1'); // 42. Indicador (1)
  });
});

describe('Empaquetado y Compresión en ZIP', () => {
  it('crea un archivo ZIP que contiene exactamente el TXT con el mismo nombre y contenido íntegro', async () => {
    const mov = {
      id: 'v1',
      type: 'income',
      date: '2026-07-01',
      document_type: 'factura',
      document_number: 'F001-1',
      third_party_ruc: '20600000000',
      third_party_name: 'CLIENTE PRUEBA',
      amount: 118,
      currency: 'PEN',
    };
    const rvie = generateReemplazoPropuestaRVIE([mov], PERIODO, RUC_EMPRESA, RAZON_SOCIAL);
    const pkg = await buildSireZipPackage(rvie);

    expect(pkg.zipFilename).toBe('LE2061534608120260700140400021112.zip');
    expect(pkg.zipSize).toBeGreaterThan(0);

    // Descomprimir el ZIP con JSZip para verificar integridad
    const unzipped = await JSZip.loadAsync(pkg.zipData);
    const files = Object.keys(unzipped.files);
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('LE2061534608120260700140400021112.txt');

    const txtLeido = await unzipped.file(files[0]).async('string');
    expect(txtLeido).toBe(rvie.txtContent);
  });
});

describe('Auditoría y Cruce con Comprobantes ya Presentados', () => {
  it('identifica qué comprobantes ya fueron presentados y cuáles faltan', () => {
    const movs = [
      {
        id: 'c1',
        type: 'cost',
        date: '2026-07-02',
        document_type: 'factura',
        document_number: 'F001-100',
        third_party_ruc: '20555555555',
        amount: 500,
      },
      {
        id: 'c2',
        type: 'cost',
        date: '2026-07-03',
        document_type: 'factura',
        document_number: 'F001-200',
        third_party_ruc: '20666666666',
        amount: 800,
      },
    ];

    // Simulamos que F001-100 ya fue presentado (por ejemplo en un corte descargado de SUNAT)
    const corteSunatFilas = [
      {
        tipoCp: '01',
        serie: 'F001',
        numero: 100,
        contraparteRuc: '20555555555',
        total: 500,
      },
    ];

    const analisis = analizarComprobantesParaSire(movs, 'compras', {
      periodo: PERIODO,
      comprobantesPresentados: corteSunatFilas,
    });

    expect(analisis.totalMovs).toBe(2);
    expect(analisis.yaPresentadosCount).toBe(1);
    expect(analisis.faltantesCount).toBe(1);

    const item1 = analisis.items.find(i => i.id === 'c1');
    const item2 = analisis.items.find(i => i.id === 'c2');

    expect(item1.yaPresentado).toBe(true);
    expect(item2.yaPresentado).toBe(false);
  });
});
