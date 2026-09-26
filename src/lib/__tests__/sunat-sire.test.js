import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  LIBRO_RVIE_REEMPLAZO,
  LIBRO_RCE_REEMPLAZO,
  CAMPOS_RVIE,
  CAMPOS_RCE,
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

// ── Los encabezados REALES que baja SUNAT (setiembre-2026) ─────────
// Copiados de `sunat-csv.test.js`. El reemplazo tiene que escribir cada dato
// en la MISMA posición en que SUNAT lo pone en su propia propuesta: estos
// tests buscan la columna por NOMBRE en el encabezado real y miran qué quedó
// ahí. Antes solo se contaban columnas, y el RVIE salió corrido desde la 23
// (el total en «Otros Tributos») sin que ningún test lo viera.
const H_VENTAS = 'Ruc,Razon Social,Periodo,CAR SUNAT,Fecha de emisión,Fecha Vcto/Pago,Tipo CP/Doc.,Serie del CDP,Nro CP o Doc. Nro Inicial (Rango),Nro Final (Rango),Tipo Doc Identidad,Nro Doc Identidad,Apellidos Nombres/ Razón Social,Valor Facturado Exportación,BI Gravada,Dscto BI,IGV / IPM,Dscto IGV / IPM,Mto Exonerado,Mto Inafecto,ISC,BI Grav IVAP,IVAP,ICBPER,Otros Tributos,Total CP,Moneda,Tipo Cambio,Fecha Emisión Doc Modificado,Tipo CP Modificado,Serie CP Modificado,Nro CP Modificado,ID Proyecto Operadores Atribución,Tipo de Nota,Est. Comp,Valor FOB Embarcado,Valor OP Gratuitas,Tipo Operación,DAM / CP,CLU'.split(',');
const H_COMPRAS = 'RUC,Apellidos y Nombres o Razón social,Periodo,CAR SUNAT,Fecha de emisión,Fecha Vcto/Pago,Tipo CP/Doc.,Serie del CDP,Año,Nro CP o Doc. Nro Inicial (Rango),Nro Final (Rango),Tipo Doc Identidad,Nro Doc Identidad,Apellidos Nombres/ Razón  Social,BI Gravado DG,IGV / IPM DG,BI Gravado DGNG,IGV / IPM DGNG,BI Gravado DNG,IGV / IPM DNG,Valor Adq. NG,ISC,ICBPER,Otros Trib/ Cargos,Total CP,Moneda,Tipo de Cambio,Fecha Emisión Doc Modificado,Tipo CP Modificado,Serie CP Modificado,COD. DAM O DSI,Nro CP Modificado,Clasif de Bss y Sss,ID Proyecto Operadores,PorcPart,IMB,CAR Orig/ Ind E o I,Detracción,Tipo de Nota,Est. Comp.,Incal,CLU1,CLU2,CLU3'.split(',');

// Una fila REAL de la propuesta del RCE de julio-2026 (sin comas en la razón
// social, así se puede partir directo). Es lo que SUNAT espera recibir de vuelta.
const C_REAL = '20615646505,jarvex ingenieria tecnologia y proyectos e.i.r.l.,202607,2060829118101F0010000006742,24/07/2026,24/07/2026,01,F001,,6742,,6,20608291181,saukos chicken s.a.c,166.02,29.88,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,195.90,PEN,1.000,,,,,,,,,0.00,,,,1,0,,'.split(',');

const campo = (partes, header, nombre) => {
  const i = header.indexOf(nombre);
  if (i < 0) throw new Error(`columna inexistente en el encabezado real: ${nombre}`);
  return partes[i];
};
const lineas = (res) => res.txtContent.trim().split('\r\n').map(l => l.split('|'));

describe('Las columnas del reemplazo son las del archivo real de SUNAT', () => {
  it('el RVIE son los campos 1 a 33 del encabezado de ventas, en el mismo orden (Anexo 3)', () => {
    expect([...CAMPOS_RVIE]).toEqual(H_VENTAS.slice(0, 33));
  });
  it('el RCE son los campos 1 a 41 del encabezado de compras, en el mismo orden (Anexo 11 + error 453)', () => {
    expect([...CAMPOS_RCE]).toEqual(H_COMPRAS.slice(0, 41));
  });
});

describe('Generador RVIE Reemplazo de Propuesta (Libro 140400)', () => {
  const movVenta1 = {
    id: 'v1', company_id: 'emp-1', type: 'income', clase: 'venta', date: '2026-07-05',
    document_type: 'factura', document_number: 'F001-00000123',
    third_party_ruc: '20501234567', third_party_name: 'CLIENTE CONSTRUCTORA SAC',
    amount: 1180.00, currency: 'PEN',
  };
  const movVenta2 = {
    id: 'v2', company_id: 'emp-1', type: 'income', date: '2026-07-10',
    document_type: 'boleta', document_number: 'B001-456',
    third_party_ruc: '10445566778', third_party_name: 'CLIENTE PARTICULAR',
    amount: 200.00, currency: 'PEN',
  };

  it('escribe cada dato en la columna del encabezado real, con 33 campos y pipe final', () => {
    const res = generateReemplazoPropuestaRVIE([movVenta1], PERIODO, RUC_EMPRESA, RAZON_SOCIAL);
    expect(res.registros).toBe(1);
    expect(res.zipFilename).toBe('LE2061534608120260700140400021112.zip');
    expect(res.txtContent.endsWith('|\r\n')).toBe(true);
    const [p] = lineas(res);
    expect(p).toHaveLength(34);          // 33 campos + el vacío tras el pipe final
    expect(p[33]).toBe('');
    const v = (n) => campo(p, H_VENTAS, n);
    expect(v('Ruc')).toBe(RUC_EMPRESA);
    expect(v('Razon Social')).toBe(RAZON_SOCIAL);
    expect(v('Periodo')).toBe('202607');
    expect(v('CAR SUNAT')).toBe('');     // «consignar vacío»
    expect(v('Fecha de emisión')).toBe('05/07/2026');
    expect(v('Tipo CP/Doc.')).toBe('01');
    expect(v('Serie del CDP')).toBe('F001');
    expect(v('Nro CP o Doc. Nro Inicial (Rango)')).toBe('123');   // como lo escribe SUNAT
    expect(v('Tipo Doc Identidad')).toBe('6');
    expect(v('Nro Doc Identidad')).toBe('20501234567');
    expect(v('BI Gravada')).toBe('1000.00');
    expect(v('IGV / IPM')).toBe('180.00');
    expect(v('BI Grav IVAP')).toBe('0.00');
    expect(v('IVAP')).toBe('0.00');       // la columna que faltaba y corría todo
    expect(v('Otros Tributos')).toBe('0.00');
    expect(v('Total CP')).toBe('1180.00');
    expect(v('Moneda')).toBe('PEN');
    expect(v('Tipo Cambio')).toBe('1.000');
  });

  it('una venta en USD se declara en SOLES con la moneda y el tipo de cambio aparte', () => {
    const usd = { ...movVenta1, id: 'v3', currency: 'USD', amount: 1000, tipo_cambio: 3.5 };
    const [p] = lineas(generateReemplazoPropuestaRVIE([usd], PERIODO, RUC_EMPRESA, RAZON_SOCIAL));
    const v = (n) => campo(p, H_VENTAS, n);
    expect(v('Total CP')).toBe('3500.00');
    expect(v('Moneda')).toBe('USD');
    expect(v('Tipo Cambio')).toBe('3.500');
  });

  it('una venta en USD sin tipo de cambio NO se escribe: sale en omitidos', () => {
    const usd = { ...movVenta1, id: 'v4', currency: 'USD', amount: 1000 };
    const res = generateReemplazoPropuestaRVIE([usd], PERIODO, RUC_EMPRESA, RAZON_SOCIAL);
    expect(res.registros).toBe(0);
    expect(res.omitidos).toEqual([{ id: 'v4', documento: 'F001-00000123', motivo: 'sin_tipo_cambio' }]);
  });

  it('sin tasa estampada usa la de su fecha (`tasaDe`)', () => {
    const usd = { ...movVenta1, id: 'v5', currency: 'USD', amount: 100 };
    const res = generateReemplazoPropuestaRVIE([usd], PERIODO, RUC_EMPRESA, RAZON_SOCIAL, { tasaDe: () => 3.4 });
    expect(campo(lineas(res)[0], H_VENTAS, 'Total CP')).toBe('340.00');
  });

  it('permite exportar solo los comprobantes seleccionados por ID', () => {
    const res = generateReemplazoPropuestaRVIE([movVenta1, movVenta2], PERIODO, RUC_EMPRESA, RAZON_SOCIAL, {
      seleccionadosIds: ['v2'],
    });
    expect(res.registros).toBe(1);
    expect(res.totTotal).toBe(200.00);
    expect(res.txtContent).toContain('|B001|456|');
  });

  it('la nota de crédito va en negativo y referencia su factura', () => {
    const factura = { ...movVenta1, id: 'fv', date: '2026-06-20' };
    const nc = {
      ...movVenta1, id: 'ncv', document_type: 'nota_credito', document_number: 'FC01-9',
      amount: 118, related_movement_id: 'fv',
    };
    const res = generateReemplazoPropuestaRVIE([nc], PERIODO, RUC_EMPRESA, RAZON_SOCIAL,
      { movsById: new Map([['fv', factura], ['ncv', nc]]) });
    const v = (n) => campo(lineas(res)[0], H_VENTAS, n);
    expect(v('Tipo CP/Doc.')).toBe('07');
    expect(v('Total CP')).toBe('-118.00');
    expect(v('BI Gravada')).toBe('-100.00');
    expect(v('Fecha Emisión Doc Modificado')).toBe('20/06/2026');
    expect(v('Tipo CP Modificado')).toBe('01');
    expect(v('Serie CP Modificado')).toBe('F001');
    expect(v('Nro CP Modificado')).toBe('123');
  });
});

describe('Generador RCE Reemplazo de Propuesta (Libro 080400)', () => {
  const movCompra1 = {
    id: 'c1', company_id: 'emp-1', type: 'cost', date: '2026-07-15',
    document_type: 'factura', document_number: 'E001-8899',
    third_party_ruc: '20100088899', third_party_name: 'PROVEEDOR MATERIALES SAC',
    amount: 590.00, currency: 'PEN',
  };

  it('41 campos (1 a 37 + los cuatro palotes vacíos del 38 al 41) y pipe final', () => {
    const res = generateReemplazoPropuestaRCE([movCompra1], PERIODO, RUC_EMPRESA, RAZON_SOCIAL);
    expect(res.registros).toBe(1);
    expect(res.zipFilename).toBe('LE2061534608120260700080400021112.zip');
    const [p] = lineas(res);
    expect(p).toHaveLength(42);
    expect(p.slice(37)).toEqual(['', '', '', '', '']);
    const v = (n) => campo(p, H_COMPRAS, n);
    expect(v('Serie del CDP')).toBe('E001');
    expect(v('Nro CP o Doc. Nro Inicial (Rango)')).toBe('8899');
    expect(v('BI Gravado DG')).toBe('500.00');
    expect(v('IGV / IPM DG')).toBe('90.00');
    expect(v('Total CP')).toBe('590.00');
    // La fecha de detracción iba en «Clasif de Bss y Sss»: ahora esa columna va vacía.
    expect(v('Clasif de Bss y Sss')).toBe('');
  });

  it('reproduce campo por campo una fila real de la propuesta de SUNAT (salvo el CAR, que va vacío)', () => {
    // saukos chicken, F001-6742, 24/07/2026, 166.02 + 29.88 = 195.90
    const mov = {
      id: 'saukos', type: 'expense', date: '2026-07-24', document_type: 'factura',
      document_number: 'F001-6742', third_party_ruc: '20608291181',
      third_party_name: 'saukos chicken s.a.c', amount: 195.90, currency: 'PEN',
      notas: JSON.stringify({ subtotal: 166.02, igv: 29.88 }),
    };
    const [p] = lineas(generateReemplazoPropuestaRCE([mov], PERIODO, '20615646505',
      'jarvex ingenieria tecnologia y proyectos e.i.r.l.'));
    for (let i = 0; i < 37; i++) {
      const nombre = H_COMPRAS[i];
      if (nombre === 'CAR SUNAT') { expect(p[i]).toBe(''); continue; }
      // SUNAT pone la fecha de vencimiento aunque no la pida; el reemplazo solo
      // la escribe en los recibos de servicios públicos (tipo 14), que es donde
      // es obligatoria y donde no puede pasarse del mes.
      if (nombre === 'Fecha Vcto/Pago') { expect(p[i]).toBe(''); continue; }
      expect(`${nombre}=${p[i]}`).toBe(`${nombre}=${C_REAL[i]}`);
    }
  });

  it('una compra en USD va en soles con su tasa (KOPLAST F003-3384: 80.000 × 3,495)', () => {
    const koplast = {
      ...movCompra1, id: 'kp', document_number: 'F003-3384', third_party_ruc: '20505543174',
      amount: 80000, currency: 'USD', tipo_cambio: 3.495,
    };
    const v = (n) => campo(lineas(generateReemplazoPropuestaRCE([koplast], PERIODO, RUC_EMPRESA, RAZON_SOCIAL))[0], H_COMPRAS, n);
    expect(v('Total CP')).toBe('279600.00');
    expect(v('Moneda')).toBe('USD');
    expect(v('Tipo de Cambio')).toBe('3.495');
  });

  it('un comprobante movido de mes se declara en el mes al que se lo movió (periodo_declarado)', () => {
    const feb = { ...movCompra1, id: 'feb', date: '2026-02-10', periodo_declarado: '202607' };
    const jul = { ...movCompra1, id: 'jul' };
    const movido = { ...movCompra1, id: 'fuera', date: '2026-07-20', periodo_declarado: '202608' };
    const res = generateReemplazoPropuestaRCE([feb, jul, movido], PERIODO, RUC_EMPRESA, RAZON_SOCIAL);
    expect(res.registros).toBe(2);
    expect(res.txtContent).toContain('|10/02/2026|');   // la fecha del papel no se toca
  });

  it('el sentido lo decide `clase`, no `type`: una venta cargada con type cost no entra al RCE', () => {
    const venta = { ...movCompra1, id: 'vx', clase: 'venta' };
    expect(generateReemplazoPropuestaRCE([venta], PERIODO, RUC_EMPRESA, RAZON_SOCIAL).registros).toBe(0);
    expect(generateReemplazoPropuestaRVIE([venta], PERIODO, RUC_EMPRESA, RAZON_SOCIAL).registros).toBe(1);
  });

  it('un recibo por honorarios va entero como adquisición no gravada', () => {
    const rh = {
      ...movCompra1, id: 'rh', document_type: 'recibo', category: 'Recibo Honorarios',
      document_number: 'E001-55', third_party_ruc: '10456789012', amount: 1500,
    };
    const v = (n) => campo(lineas(generateReemplazoPropuestaRCE([rh], PERIODO, RUC_EMPRESA, RAZON_SOCIAL))[0], H_COMPRAS, n);
    expect(v('Tipo CP/Doc.')).toBe('02');
    expect(v('BI Gravado DG')).toBe('0.00');
    expect(v('Valor Adq. NG')).toBe('1500.00');
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
