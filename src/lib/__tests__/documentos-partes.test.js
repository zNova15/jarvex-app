// ═══════════════════════════════════════════════════════════════════
// PARTIR UNAS BASES EN SUS ANEXOS (tanda 15, entrega 7).
//
// Los casos salen del Anexo 13 real de Chilete, que tiene 23 partes: tres
// capítulos, seis anexos con letra (A a F) y catorce formatos numerados.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { partirEnAnexos, nombreDeArchivo, agruparPorSobre, MIN_CHARS_PARTE } from '../documentos-partes.js';
import { detectarRegimen, REGIMENES, normalizar } from '../bases-extraccion.js';

const relleno = (n) => 'contenido del anexo con texto suficiente. '.repeat(n);

const MD = `<!-- página 1 -->
BASES DEL PROCESO DE SELECCIÓN
ÍNDICE
ANEXO A: DEFINICIONES8
ANEXO C: REQUISITOS DE CALIFICACIÓN31
FORMATO N° 6: PROMESA FORMAL DE CONSORCIO.......62

<!-- página 8 -->
ANEXO A:DEFINICIONES
${relleno(12)}

<!-- página 31 -->
ANEXO C:REQUISITOS DE CALIFICACIÓN
Jefe de Supervisión del Proyecto. Experiencia no menor de 03 años.
${relleno(12)}

<!-- página 62 -->
FORMATO N° 6:PROMESA FORMAL DE CONSORCIO
${relleno(12)}`;

describe('partirEnAnexos — cada anexo es su propia unidad', () => {
  it('corta por los rótulos reales de unas bases peruanas', () => {
    const partes = partirEnAnexos(MD);
    expect(partes.map(p => p.titulo)).toEqual([
      'ANEXO A:DEFINICIONES',
      'ANEXO C:REQUISITOS DE CALIFICACIÓN',
      'FORMATO N° 6:PROMESA FORMAL DE CONSORCIO',
    ]);
  });

  it('NO corta por la línea del índice de contenidos', () => {
    // «ANEXO A: DEFINICIONES8» y «…CONSORCIO.......62» son referencias, no la
    // sección: cortar ahí daría veinte anexos de dos renglones.
    const partes = partirEnAnexos(MD);
    expect(partes.every(p => !/\d$/.test(p.titulo))).toBe(true);
    expect(partes).toHaveLength(3);
  });

  it('cada parte lleva su texto completo y en qué página empieza', () => {
    const c = partirEnAnexos(MD).find(p => /REQUISITOS/.test(p.titulo));
    expect(c.pagina).toBe(31);
    expect(c.texto).toMatch(/Jefe de Supervisión del Proyecto/);
    expect(c.chars).toBeGreaterThan(MIN_CHARS_PARTE);
  });

  it('descarta los rótulos sin contenido detrás', () => {
    expect(partirEnAnexos('<!-- página 1 -->\nANEXO A: DEFINICIONES\nANEXO B: CALENDARIO')).toHaveLength(0);
  });

  it('un documento sin anexos no inventa ninguno', () => {
    expect(partirEnAnexos('<!-- página 1 -->\n' + relleno(30))).toHaveLength(0);
  });

  it('el nombre del archivo es seguro para el sistema de archivos', () => {
    expect(nombreDeArchivo({ titulo: 'ANEXO C: REQUISITOS/CALIFICACIÓN «2026»', n: 3 }))
      .toMatch(/^ANEXO C REQUISITOS CALIFICACION 2026 ?\.docx$/);
    expect(nombreDeArchivo({ n: 7 })).toBe('parte-7.docx');
  });
});

describe('detectarRegimen — bajo qué norma se rige el proceso', () => {
  it('«CREDENCIALES» + «SOBRE N° 3» son Obras por Impuestos con Empresa Privada', () => {
    expect(detectarRegimen('SOBRE N° 1: CREDENCIALES ... SOBRE N° 3: PROPUESTA TÉCNICA')).toBe('oxi_empresa');
    expect(REGIMENES.oxi_empresa.sobres).toBe(3);
    // Fiel cumplimiento 4%, no 10%: en OxI es distinto que en contratación ordinaria.
    expect(REGIMENES.oxi_empresa.fielCumplimiento).toBe(4);
  });
  it('sin el sobre 3 pero con Ley 29230 es la supervisora, con 2 sobres', () => {
    expect(detectarRegimen('proceso bajo la Ley N° 29230 · SOBRE N° 2: PROPUESTA ECONÓMICA')).toBe('oxi_supervisora');
    expect(REGIMENES.oxi_supervisora.sobres).toBe(2);
    expect(REGIMENES.oxi_supervisora.fielCumplimiento).toBe(10);
  });
  it('«cuantía de la contratación» es la Ley 32069, que NO tiene sobres', () => {
    expect(detectarRegimen('el postor acredita un monto sobre la CUANTÍA DE LA CONTRATACIÓN')).toBe('ley32069');
    expect(REGIMENES.ley32069.sobres).toBe(0);
    expect(REGIMENES.ley32069.rangoEconomico).toEqual([95, 110]);
  });
  it('«valor referencial» + «obras similares» es el régimen anterior', () => {
    expect(detectarRegimen('una (1) vez el VALOR REFERENCIAL en OBRAS SIMILARES')).toBe('ley30225');
  });
  it('un documento que no es unas bases no fuerza ningún régimen', () => {
    expect(detectarRegimen('lista de precios de abarrotes')).toBeNull();
  });
  it('el rango económico de Obras por Impuestos es 90-110, distinto del 95-110 de la 32069', () => {
    expect(REGIMENES.oxi_empresa.rangoEconomico).toEqual([90, 110]);
  });
});

describe('normalizar — las trampas de los documentos oficiales', () => {
  it('«N°» y «Nº» se ven igual y conviven en el MISMO documento', () => {
    // Medido: 1.132 del signo de grado contra 61 del ordinal masculino.
    expect(normalizar('ANEXO N° 4')).toBe(normalizar('ANEXO Nº 4'));
  });
  it('los ceros a la izquierda no hacen otro sobre', () => {
    expect(normalizar('SOBRE N° 01')).toBe(normalizar('SOBRE N° 1'));
    expect(normalizar('SOBRE N°03')).toBe(normalizar('SOBRE N° 3'));
  });
});

describe('agruparPorSobre — lo que Gabriel pidió desglosado', () => {
  const docs = [
    { sobre: 'Sobre N° 2', documento: 'Propuesta técnica' },
    { sobre: 'Sobre N° 1', documento: 'Carta de expresión de interés' },
    { sobre: 'Sobre N° 3', documento: 'Carta de propuesta económica' },
    { sobre: 'Sobre N° 1', documento: 'Declaración jurada de datos del postor' },
    { documento: 'Anexo suelto sin sobre' },
  ];
  it('agrupa por sobre y los ordena como se presentan', () => {
    const g = agruparPorSobre(docs);
    expect(g.map(x => x.sobre)).toEqual(['Sobre N° 1', 'Sobre N° 2', 'Sobre N° 3', 'Sin sobre indicado']);
    expect(g[0].documentos).toHaveLength(2);
  });
  it('lo que no se pudo ubicar queda al final y marcado, no se descarta', () => {
    const g = agruparPorSobre(docs);
    expect(g[3].sinUbicar).toBe(true);
    expect(g[3].documentos[0].documento).toBe('Anexo suelto sin sobre');
  });
  it('el NÚMERO manda, aunque el contenido diga otra cosa', () => {
    // En Obras por Impuestos con Empresa Privada el sobre 2 es la ECONÓMICA y
    // el 3 la TÉCNICA: se abre primero la económica y solo se evalúa la
    // técnica del que ganó. Ordenar por contenido las daría vuelta.
    const g = agruparPorSobre([
      { sobre: 'Sobre N° 3: Propuesta técnica', documento: 'a' },
      { sobre: 'Sobre N° 2: Propuesta económica', documento: 'b' },
      { sobre: 'Sobre N° 1: Credenciales', documento: 'c' },
    ]);
    expect(g.map(x => x.orden)).toEqual([1, 2, 3]);
    expect(g[1].sobre).toMatch(/económica/i);
    expect(g[2].sobre).toMatch(/técnica/i);
  });
  it('sin número conserva el orden en que el documento los nombró', () => {
    const g = agruparPorSobre([
      { sobre: 'Propuesta económica', documento: 'a' },
      { sobre: 'Acreditación', documento: 'b' },
    ]);
    expect(g.map(x => x.sobre)).toEqual(['Propuesta económica', 'Acreditación']);
  });
  it('sin documentos devuelve lista vacía', () => {
    expect(agruparPorSobre([])).toEqual([]);
  });
});
