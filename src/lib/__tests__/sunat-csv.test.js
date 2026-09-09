// ═══════════════════════════════════════════════════════════════════
// LEER LOS CSV DE SUNAT (tanda 14, entrega 5) — lib pura.
//
// Los casos son TEXTUALES de los dos archivos que Gabriel bajó del portal para
// JARVEX, periodo 202607 (`Modelos/`, que no viaja en el repo). Se copian acá
// las filas exactas —comas sin comillas incluidas— porque son la única defensa
// contra el bug silencioso: si alguien «simplifica» el parser a un split, estos
// tests dicen qué columna se corrió y de qué factura era la plata.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { compararLibro } from '../comparativa-sunat.js';
import {
  parseCsvSunat, dividirLineaCsv, repararFila, detectarLibro,
  aFechaIso, aNumero, partirPeriodo, nombreTipoCp,
  filaGuardable, filasGuardables, avisosGuardables, CAMPOS_FILA_GUARDADA,
} from '../sunat-csv.js';

// ── Los encabezados reales (setiembre-2026) ───────────────────────
const H_VENTAS = 'Ruc,Razon Social,Periodo,CAR SUNAT,Fecha de emisión,Fecha Vcto/Pago,Tipo CP/Doc.,Serie del CDP,Nro CP o Doc. Nro Inicial (Rango),Nro Final (Rango),Tipo Doc Identidad,Nro Doc Identidad,Apellidos Nombres/ Razón Social,Valor Facturado Exportación,BI Gravada,Dscto BI,IGV / IPM,Dscto IGV / IPM,Mto Exonerado,Mto Inafecto,ISC,BI Grav IVAP,IVAP,ICBPER,Otros Tributos,Total CP,Moneda,Tipo Cambio,Fecha Emisión Doc Modificado,Tipo CP Modificado,Serie CP Modificado,Nro CP Modificado,ID Proyecto Operadores Atribución,Tipo de Nota,Est. Comp,Valor FOB Embarcado,Valor OP Gratuitas,Tipo Operación,DAM / CP,CLU';

const H_COMPRAS = 'RUC,Apellidos y Nombres o Razón social,Periodo,CAR SUNAT,Fecha de emisión,Fecha Vcto/Pago,Tipo CP/Doc.,Serie del CDP,Año,Nro CP o Doc. Nro Inicial (Rango),Nro Final (Rango),Tipo Doc Identidad,Nro Doc Identidad,Apellidos Nombres/ Razón  Social,BI Gravado DG,IGV / IPM DG,BI Gravado DGNG,IGV / IPM DGNG,BI Gravado DNG,IGV / IPM DNG,Valor Adq. NG,ISC,ICBPER,Otros Trib/ Cargos,Total CP,Moneda,Tipo de Cambio,Fecha Emisión Doc Modificado,Tipo CP Modificado,Serie CP Modificado,COD. DAM O DSI,Nro CP Modificado,Clasif de Bss y Sss,ID Proyecto Operadores,PorcPart,IMB,CAR Orig/ Ind E o I,Detracción,Tipo de Nota,Est. Comp.,Incal,CLU1,CLU2,CLU3';

// ── Filas reales, copiadas tal cual del archivo ───────────────────

// La razón social del titular lleva COMA y no está entre comillas: la fila
// trae un campo de más que corre todas las columnas de la derecha.
const V_FACTURA = '20615646505,JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.,202607,2061564650501E0010000000001,06/07/2026,,01,E001,1,,6,20615346081,CONSORCIO EL INCA,0,10949.15,0,1970.85,0,0,0,0,0,0,0,0,12920,PEN,1.000,,,,,,,1,0,0,0101,,';
// La nota de crédito que anula a la de arriba: MISMA serie y MISMO número,
// distinto tipo (07). Es el caso que obliga a que la llave lleve el tipo.
const V_NOTA = '20615646505,JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.,202607,2061564650507E0010000000001,06/07/2026,,07,E001,1,,6,20615346081,CONSORCIO EL INCA,0,-10949.15,0,-1970.85,0,0,0,0,0,0,0,0,-12920,PEN,1.000,06/07/2026,01,E001,1,,01,1,0,0,,,';

// Compras: las cuatro escrituras distintas del MISMO titular en el MISMO
// archivo. Las dos primeras traen coma (81 campos), las dos últimas no (80).
const C_CON_COMA = '20615646505,JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.,202607,2061453975601F0010000163254,18/07/2026,,01,F001,,163254,,6,20614539756,INVERSIONES Y DESARROLLO ANDINO E.I.R.L.,10980.00,1976.40,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,12956.40,PEN,1.000,,,,,,,,,0.00,,,,1,0,,';
const C_MINUSCULAS = '20615646505,jarvex ingenieria tecnologia y proyectos e.i.r.l.,202607,2060829118101F0010000006742,24/07/2026,24/07/2026,01,F001,,6742,,6,20608291181,saukos chicken s.a.c,166.02,29.88,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,195.90,PEN,1.000,,,,,,,,,0.00,,,,1,0,,';
const C_CON_GUION = '20615646505,JARVEX INGENIERIA TECNOLOGIA Y PROYECTOS E.I.R.L.-,202607,2011227392201F4390000002937,08/07/2026,08/07/2026,01,F439,,2937,,6,20112273922,TIENDAS DEL MEJORAMIENTO DEL HOGAR S.A.,490.00,88.20,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,578.20,PEN,1.000,,,,,,,,,0.00,,,,1,0,,';
// Una comisión del banco: todo el importe va en «Valor Adq. NG», sin IGV.
const C_BANCO = '20615646505,JARVEX INGENIERIA  TECNOLOGIA Y PROYECTOS E.I.R.L.,202607,2010005345501FCC10007964323,08/07/2026,,01,FCC1,,7964323,,6,20100053455,BANCO INTERNACIONAL DEL PERÚ - INTERBANK,0.00,0.00,0.00,0.00,0.00,0.00,10.00,0.00,0.00,0.00,10.00,PEN,1.000,,,,,,,,,0.00,,,,1,0,,';

const csv = (h, ...filas) => [h, ...filas].join('\n');

describe('utilidades', () => {
  it('la fecha se convierte por string, sin new Date()', () => {
    // Una factura del 01/07 tiene que quedar en JULIO, no en junio.
    expect(aFechaIso('01/07/2026')).toBe('2026-07-01');
    expect(aFechaIso('6/7/2026')).toBe('2026-07-06');
    expect(aFechaIso('')).toBe('');
    expect(aFechaIso('2026-07-01')).toBe('');
  });

  it('los importes negativos de una nota de crédito se leen', () => {
    expect(aNumero('-10949.15')).toBe(-10949.15);
    expect(aNumero('')).toBe(0);
    expect(aNumero('  12920 ')).toBe(12920);
  });

  it('el periodo se parte', () => {
    expect(partirPeriodo('202607')).toEqual({ anio: 2026, mes: 7 });
    expect(partirPeriodo('2026')).toBeNull();
  });

  it('los tipos de comprobante tienen nombre', () => {
    expect(nombreTipoCp('01')).toBe('factura');
    expect(nombreTipoCp('07')).toBe('nota_credito');
    expect(nombreTipoCp('1')).toBe('factura');       // sin el cero de adelante
    expect(nombreTipoCp('99')).toBe('otros');
  });
});

describe('dividirLineaCsv', () => {
  it('parte por comas', () => {
    expect(dividirLineaCsv('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('respeta las comillas por si SUNAT algún día las escribe', () => {
    expect(dividirLineaCsv('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
    expect(dividirLineaCsv('a,"di ""hola""",b')).toEqual(['a', 'di "hola"', 'b']);
  });
  it('conserva los campos vacíos del final', () => {
    expect(dividirLineaCsv('a,,')).toEqual(['a', '', '']);
  });
});

describe('detectarLibro', () => {
  it('reconoce cada archivo por una columna que solo él tiene', () => {
    expect(detectarLibro(dividirLineaCsv(H_VENTAS))).toBe('ventas');
    expect(detectarLibro(dividirLineaCsv(H_COMPRAS))).toBe('compras');
  });
  it('no adivina con un archivo que no es de SUNAT', () => {
    expect(detectarLibro(['nombre', 'precio'])).toBeNull();
  });
});

describe('repararFila — el desalineo por las comas sin comillas', () => {
  const iNombreCompras = dividirLineaCsv(H_COMPRAS).findIndex(h => h.includes('Apellidos Nombres'));

  it('vuelve a pegar la razón social del titular partida por su coma', () => {
    const r = repararFila(dividirLineaCsv(C_CON_COMA), iNombreCompras);
    expect(r.titular).toBe('JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.');
    // Y la fila queda alineada con el encabezado: el periodo en su columna.
    expect(r.campos[2]).toBe('202607');
    expect(r.campos[iNombreCompras]).toBe('INVERSIONES Y DESARROLLO ANDINO E.I.R.L.');
  });

  it('las cuatro escrituras del mismo titular quedan todas alineadas', () => {
    // Este es el punto: el largo de la fila NO es una señal fiable.
    for (const linea of [C_CON_COMA, C_MINUSCULAS, C_CON_GUION, C_BANCO]) {
      const r = repararFila(dividirLineaCsv(linea), iNombreCompras);
      expect(r.campos[0]).toBe('20615646505');
      expect(r.campos[2]).toBe('202607');
      expect(r.campos[6]).toBe('01');                 // Tipo CP/Doc.
    }
  });

  it('una razón social de proveedor con coma también se vuelve a pegar', () => {
    // No apareció en julio, pero es el mismo agujero del otro lado.
    const linea = '20615646505,TITULAR SA,202607,CAR1,18/07/2026,,01,F001,,99,,6,20600000001,FERRETERIA GOMEZ, HERMANOS S.A.C.,100.00,18.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,118.00,PEN,1.000';
    const r = repararFila(dividirLineaCsv(linea), iNombreCompras);
    expect(r.contraparte).toBe('FERRETERIA GOMEZ, HERMANOS S.A.C.');
    expect(r.campos[iNombreCompras + 1]).toBe('100.00');   // el importe quedó en su sitio
  });

  it('devuelve null cuando no encuentra el ancla del periodo', () => {
    expect(repararFila(dividirLineaCsv('20615646505,SIN PERIODO,xx,yy'), 13)).toBeNull();
  });
});

describe('parseCsvSunat — ventas', () => {
  const r = parseCsvSunat(csv(H_VENTAS, V_FACTURA, V_NOTA));

  it('saca del propio archivo de quién es y de qué mes', () => {
    expect(r.libro).toBe('ventas');
    expect(r.ruc).toBe('20615646505');
    expect(r.periodo).toBe('202607');
    expect(r.anio).toBe(2026);
    expect(r.mes).toBe(7);
    expect(r.avisos).toEqual([]);
  });

  it('lee la factura con sus importes en las columnas que son', () => {
    const f = r.filas[0];
    expect(f.tipoCp).toBe('01');
    expect(f.serie).toBe('E001');
    expect(f.numero).toBe(1);
    expect(f.documento).toBe('E001-1');
    expect(f.fecha).toBe('2026-07-06');
    expect(f.contraparteRuc).toBe('20615346081');
    expect(f.contraparteNombre).toBe('CONSORCIO EL INCA');
    expect(f.base).toBe(10949.15);
    expect(f.igv).toBe(1970.85);
    expect(f.total).toBe(12920);
    expect(f.moneda).toBe('PEN');
  });

  it('🔴 la nota de crédito comparte serie y número con su factura', () => {
    // La llave de cruce TIENE que llevar el tipo: sin eso, la NC cruzaría
    // contra la factura que anula y el reporte diría que todo cuadra.
    const [factura, nota] = r.filas;
    expect(nota.documento).toBe(factura.documento);
    expect(nota.serie).toBe(factura.serie);
    expect(nota.tipoCp).toBe('07');
    expect(factura.tipoCp).toBe('01');
  });

  it('la nota de crédito dice a qué comprobante modifica, y va en negativo', () => {
    const n = r.filas[1];
    expect(n.total).toBe(-12920);
    expect(n.base).toBe(-10949.15);
    expect(n.modificaTipo).toBe('01');
    expect(n.modificaSerie).toBe('E001');
    expect(n.modificaNumero).toBe('1');
    expect(n.modificaFecha).toBe('2026-07-06');
  });
});

describe('parseCsvSunat — compras', () => {
  const r = parseCsvSunat(csv(H_COMPRAS, C_CON_COMA, C_MINUSCULAS, C_CON_GUION, C_BANCO));

  it('lee las cuatro filas pese a las cuatro escrituras del titular', () => {
    expect(r.libro).toBe('compras');
    expect(r.filas).toHaveLength(4);
    expect(r.avisos).toEqual([]);
    expect(r.filas.map(f => f.documento))
      .toEqual(['F001-163254', 'F001-6742', 'F439-2937', 'FCC1-7964323']);
  });

  it('la factura más cara de julio sale con su importe exacto', () => {
    const f = r.filas[0];
    expect(f.contraparteRuc).toBe('20614539756');
    expect(f.contraparteNombre).toBe('INVERSIONES Y DESARROLLO ANDINO E.I.R.L.');
    expect(f.base).toBe(10980);
    expect(f.igv).toBe(1976.4);
    expect(f.total).toBe(12956.4);
    expect(f.fecha).toBe('2026-07-18');
  });

  it('el nombre del proveedor en minúsculas se respeta tal cual', () => {
    expect(r.filas[1].contraparteNombre).toBe('saukos chicken s.a.c');
  });

  it('la comisión del banco es NO GRAVADA: sin base ni IGV, pero con total', () => {
    const b = r.filas[3];
    expect(b.base).toBe(0);
    expect(b.igv).toBe(0);
    expect(b.noGravado).toBe(10);
    expect(b.total).toBe(10);
    expect(b.contraparteNombre).toBe('BANCO INTERNACIONAL DEL PERÚ - INTERBANK');
  });

  it('🔴 la base junta los tres destinos, no solo el gravado', () => {
    // Una compra de destino mixto (DG + DGNG + DNG) tiene la base repartida;
    // leer solo «DG» dejaría el total sin cerrar contra su propia fila.
    const mixta = C_CON_COMA
      .replace('10980.00,1976.40,0.00,0.00,0.00,0.00', '1000.00,180.00,500.00,90.00,200.00,36.00')
      .replace('12956.40', '2006.00');
    const m = parseCsvSunat(csv(H_COMPRAS, mixta)).filas[0];
    expect(m.base).toBe(1700);
    expect(m.igv).toBe(306);
    expect(m.total).toBe(2006);
  });
});

describe('parseCsvSunat — lo que no se puede leer no se traga', () => {
  it('un archivo que no es de SUNAT avisa en vez de devolver filas vacías', () => {
    const r = parseCsvSunat('nombre,precio\nCemento,28.50');
    expect(r.libro).toBeNull();
    expect(r.filas).toEqual([]);
    expect(r.avisos[0].motivo).toBe('encabezado_desconocido');
  });

  it('una línea rota sale en avisos con su número de línea', () => {
    const r = parseCsvSunat(csv(H_COMPRAS, C_CON_COMA, 'basura,sin,periodo,ni,nada', C_BANCO));
    expect(r.filas).toHaveLength(2);
    expect(r.avisos).toHaveLength(1);
    expect(r.avisos[0].linea).toBe(3);            // 1 es el encabezado
    expect(r.avisos[0].motivo).toBe('no_se_pudo_alinear');
  });

  it('un archivo sin filas no explota', () => {
    const r = parseCsvSunat(csv(H_COMPRAS));
    expect(r.filas).toEqual([]);
    expect(r.libro).toBe('compras');
  });

  it('el BOM de SUNAT no se cuela en el primer encabezado', () => {
    const r = parseCsvSunat('﻿' + csv(H_COMPRAS, C_CON_COMA));
    expect(r.libro).toBe('compras');
    expect(r.ruc).toBe('20615646505');
  });

  it('los saltos de línea de Windows no dejan campos con \\r', () => {
    const r = parseCsvSunat([H_COMPRAS, C_CON_COMA, ''].join('\r\n'));
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].moneda).toBe('PEN');
  });
});

// ═══════════════════════════════════════════════════════════════════
// LO QUE SE GUARDA DEL ARCHIVO (mig 202, tanda 18 entrega B)
//
// Gabriel cargó los CSV de julio, cambió de pestaña y se le borró todo: la
// mig 196 guardaba el resumen —lo derivado— y tiraba las filas, que son lo
// único que la app no puede recalcular. Ahora se guardan, podadas.
// El test que importa es el ÚLTIMO: podar no puede cambiar el cruce.
// ═══════════════════════════════════════════════════════════════════
describe('las filas que se guardan con el corte', () => {
  const filaDe = (texto, header = H_COMPRAS) => parseCsvSunat(csv(header, texto)).filas[0];

  it('deja los campos con los que se cruza', () => {
    const g = filaGuardable(filaDe(C_CON_COMA));
    expect(g.documento).toBe('F001-163254');
    expect(g.serie).toBe('F001');
    expect(g.numero).toBe(163254);
    expect(g.tipoCp).toBe('01');
    expect(g.contraparteRuc).toBe('20614539756');
    expect(g.contraparteNombre).toBe('INVERSIONES Y DESARROLLO ANDINO E.I.R.L.');
    expect(g.total).toBe(12956.40);
    expect(g.fecha).toBe('2026-07-18');
  });

  it('tira lo que ya está en el corte o se deriva', () => {
    const g = filaGuardable(filaDe(C_CON_COMA));
    // `libro` y `periodo` viven en el corte; repetidos por fila podrían
    // contradecirlo. `numeroTexto` sale de `numero`.
    expect(g).not.toHaveProperty('libro');
    expect(g).not.toHaveProperty('periodo');
    expect(g).not.toHaveProperty('numeroTexto');
    expect(g).not.toHaveProperty('carSunat');
  });

  it('se queda con lo que SOLO trae el archivo, aunque hoy nadie lo lea', () => {
    // Tirarlos obligaría a volver a bajar el CSV de SUNAT para recuperarlos:
    // exactamente el error que esta migración corrige.
    expect(CAMPOS_FILA_GUARDADA).toContain('detraccion');
    expect(CAMPOS_FILA_GUARDADA).toContain('estado');
    expect(CAMPOS_FILA_GUARDADA).toContain('tipoCambio');
  });

  it('no guarda campos vacíos, pero sí los ceros', () => {
    const g = filaGuardable(filaDe(C_BANCO));
    expect(g).not.toHaveProperty('modificaSerie');   // '' → no se guarda
    expect(g.base).toBe(0);                          // 0 sí: es un dato
    expect(g.noGravado).toBe(10);
  });

  it('los avisos se guardan con su línea, con tope', () => {
    const muchos = Array.from({ length: 80 }, (_, i) => ({ linea: i + 2, motivo: 'no_se_pudo_alinear', texto: 'x'.repeat(400) }));
    const g = avisosGuardables(muchos);
    expect(g).toHaveLength(50);
    expect(g[0].linea).toBe(2);
    expect(g[0].texto.length).toBe(200);
  });

  it('🔴 podar NO cambia el resultado del cruce', () => {
    // La prueba de fuego: el corte que se guarda tiene que dar el MISMO
    // veredicto que el archivo recién leído. Si algún día el cruce empieza a
    // mirar un campo que el podado tira, este test lo dice.
    const texto = csv(H_COMPRAS, C_CON_COMA, C_MINUSCULAS, C_CON_GUION, C_BANCO);
    const r = parseCsvSunat(texto);
    const movs = [{
      id: 'm1', company_id: 'jx', clase: 'compra', type: 'cost',
      document_type: 'factura', document_number: 'F001-163254',
      third_party_ruc: '20614539756', amount: 12956.40, date: '2026-07-18',
    }];
    const opts = { companyId: 'jx', libro: 'compras', periodo: '202607', companies: [] };
    const completo = compararLibro(r.filas, movs, opts);
    const podado = compararLibro(filasGuardables(r.filas), movs, opts);
    expect(podado.resumen).toEqual(completo.resumen);
    expect(podado.filas.map(f => `${f.llave}|${f.estado}|${f.diferencia}`))
      .toEqual(completo.filas.map(f => `${f.llave}|${f.estado}|${f.diferencia}`));
  });
});
