// ═══════════════════════════════════════════════════════════════════
// PARTIR UNAS BASES EN SUS ANEXOS (tanda 15, entrega 7).
//
// Los casos salen del Anexo 13 real de Chilete, que tiene 23 partes: tres
// capítulos, seis anexos con letra (A a F) y catorce formatos numerados.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { partirEnAnexos, nombreDeArchivo, agruparPorSobre, MIN_CHARS_PARTE } from '../documentos-partes.js';

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
  it('sin número, ordena por lo que contiene: acreditación, técnica, económica', () => {
    const g = agruparPorSobre([
      { sobre: 'Propuesta económica', documento: 'a' },
      { sobre: 'Acreditación', documento: 'b' },
      { sobre: 'Propuesta técnica', documento: 'c' },
    ]);
    expect(g.map(x => x.sobre)).toEqual(['Acreditación', 'Propuesta técnica', 'Propuesta económica']);
  });
  it('sin documentos devuelve lista vacía', () => {
    expect(agruparPorSobre([])).toEqual([]);
  });
});
