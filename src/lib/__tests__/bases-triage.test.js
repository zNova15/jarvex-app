// ═══════════════════════════════════════════════════════════════════
// TRIAGE — la parte pura, y una verificación contra las bases DE VERDAD.
//
// Los tests puros corren siempre. Los de abajo abren los .docx reales del
// proceso de Chilete, que viven en `Modelos/` y están GITIGNOREADOS (el repo
// es público y esa carpeta trae DNI y CCI). Si no están, se saltan con un
// aviso en vez de fallar: nadie más que Gabriel los tiene.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import {
  ratioAlfabetico, contarAlfabeticos, clasificarPaginaPdf, normalizarRotacion,
  clasificarImagenDocx, resumenTriage, bloquesDeDocx, bloquesAMarkdown,
  UMBRAL_PAGINA_CM, renglonesDeItems, bloquesDePdf,
} from '../bases-triage.js';

describe('ratioAlfabetico / contarAlfabeticos', () => {
  it('cuenta tildes y ñ como letras (son bases en español)', () => {
    expect(contarAlfabeticos('Ingeniería Civil ñ')).toBe(16);
    expect(ratioAlfabetico('abc')).toBe(1);
    expect(ratioAlfabetico('')).toBe(0);
    expect(ratioAlfabetico(null)).toBe(0);
  });
});

describe('clasificarPaginaPdf', () => {
  it('una página de El Peruano es nativa (medido: 8.620 letras, 71% del total)', () => {
    const texto = 'a'.repeat(8620) + '.'.repeat(3557);
    const r = clasificarPaginaPdf(texto);
    expect(r.nativa).toBe(true);
    expect(r.necesitaOcr).toBe(false);
  });

  it('una página escaneada no devuelve texto: va a OCR', () => {
    const r = clasificarPaginaPdf('');
    expect(r.necesitaOcr).toBe(true);
    expect(r.motivo).toMatch(/sin texto extraíble/);
  });

  it('unas pocas letras sueltas (número de página) NO son una página nativa', () => {
    const r = clasificarPaginaPdf('Pág. 12');
    expect(r.necesitaOcr).toBe(true);
  });

  it('una extracción con ruido va a OCR aunque tenga muchos caracteres', () => {
    const r = clasificarPaginaPdf('a'.repeat(100) + '§'.repeat(900));
    expect(r.necesitaOcr).toBe(true);
    expect(r.motivo).toMatch(/ruido/);
  });
});

describe('normalizarRotacion', () => {
  it('lleva cualquier ángulo a [0,360)', () => {
    expect(normalizarRotacion(270)).toBe(270);
    expect(normalizarRotacion(-90)).toBe(270);
    expect(normalizarRotacion(360)).toBe(0);
    expect(normalizarRotacion(null)).toBe(0);
  });
});

describe('clasificarImagenDocx', () => {
  it('una página del TDR (22,3 cm, declarada a 270°) va a OCR y se endereza 90°', () => {
    const r = clasificarImagenDocx({ rotGrados: 270, anchoCm: 22.3, altoCm: 16.0 });
    expect(r.tipo).toBe('pagina');
    expect(r.necesitaOcr).toBe(true);
    expect(r.rotacionCorreccion).toBe(90);
    expect(r.motivo).toMatch(/270°/);
  });

  it('EL CASO QUE ROMPE ROTAR TODO 90°: en el Anexo 12 hay 3 páginas a 90°', () => {
    // Rotarlas 90° como al resto las dejaría de cabeza. La corrección de una
    // página a 90° es 270°, y solo el documento sabe cuál es cuál.
    const r = clasificarImagenDocx({ rotGrados: 90, anchoCm: 25.7, altoCm: 17.1 });
    expect(r.rotacionCorreccion).toBe(270);
  });

  it('el logo de la carátula (7,7 cm) NO va a OCR', () => {
    const r = clasificarImagenDocx({ rotGrados: 0, anchoCm: 7.7, altoCm: 5.4 });
    expect(r.tipo).toBe('decorativa');
    expect(r.necesitaOcr).toBe(false);
  });

  it('una página derecha no se rota', () => {
    expect(clasificarImagenDocx({ rotGrados: 0, anchoCm: 21, altoCm: 29.7 }).rotacionCorreccion).toBe(0);
  });

  it('mide por el lado LARGO: una página vertical angosta sigue siendo página', () => {
    const r = clasificarImagenDocx({ rotGrados: 0, anchoCm: 14, altoCm: 20 });
    expect(r.tipo).toBe('pagina');
    expect(UMBRAL_PAGINA_CM).toBe(15);
  });
});

describe('resumenTriage / bloquesAMarkdown', () => {
  const bloques = [
    { tipo: 'texto', texto: 'ANEXO N° 3-A: TÉRMINOS DE REFERENCIA' },
    { tipo: 'imagen', media: 'word/media/image1.png', necesitaOcr: false, rotacionCorreccion: 0 },
    { tipo: 'imagen', media: 'word/media/image2.png', necesitaOcr: true, rotacionCorreccion: 90 },
    { tipo: 'imagen', media: 'word/media/image3.png', necesitaOcr: true, rotacionCorreccion: 0 },
  ];

  it('cuenta lo que se lee gratis y lo que se paga', () => {
    const r = resumenTriage(bloques);
    expect(r.charsNativos).toBe(36);
    expect(r.paginasOcr).toBe(2);
    expect(r.decorativas).toBe(1);
    expect(r.rotadas).toBe(1);
  });

  it('el markdown deja un hueco EN SU LUGAR por cada página pendiente', () => {
    const md = bloquesAMarkdown(bloques);
    expect(md).toContain('TÉRMINOS DE REFERENCIA');
    expect(md).toMatch(/PÁGINA ESCANEADA PENDIENTE DE OCR: word\/media\/image2\.png/);
    expect(md).not.toContain('image1.png');     // el logo no aporta nada
  });

  it('con el OCR hecho, el texto entra donde estaba la imagen', () => {
    const md = bloquesAMarkdown(bloques, { 'word/media/image2.png': '1. DESCRIPCIÓN DEL PROYECTO' });
    const iTitulo = md.indexOf('TÉRMINOS DE REFERENCIA');
    const iOcr = md.indexOf('DESCRIPCIÓN DEL PROYECTO');
    expect(iOcr).toBeGreaterThan(iTitulo);
    expect(md).not.toContain('PENDIENTE DE OCR: word/media/image2.png');
  });

  it('tolera entrada vacía', () => {
    expect(resumenTriage(null).bloques).toBe(0);
    expect(bloquesAMarkdown(null)).toBe('');
  });
});

describe('regresiones del lector de .docx', () => {
  it('el bloque de una imagen conserva tipo "imagen" (la clasificación va en `clase`)', () => {
    // clasificarImagenDocx devuelve su propio `tipo`; esparcirlo sobre el
    // bloque pisaba el `tipo: 'imagen'` y las 15 páginas del TDR quedaban
    // invisibles para todo el módulo, que filtra por ese campo.
    const c = clasificarImagenDocx({ rotGrados: 270, anchoCm: 22.3, altoCm: 16 });
    expect(c.tipo).toBe('pagina');
    const bloque = { tipo: 'imagen', clase: c.tipo, necesitaOcr: c.necesitaOcr };
    expect(bloque.tipo).toBe('imagen');
    expect(resumenTriage([bloque]).paginasOcr).toBe(1);
  });
});

// ── Contra los archivos reales ─────────────────────────────────────
const DIR = path.resolve(__dirname, '../../../Modelos/Modelos Licitaciones');
const REALES = [
  { archivo: 'Anexo-12 - Modelo de Bases - EP - MERC CHILETE.docx',
    charsMin: 190000, paginasOcr: 15, decorativas: 1 },
  { archivo: 'Anexo-13 - Modelo de Bases - EPS - CHILETE.docx',
    charsMin: 118000, paginasOcr: 17, decorativas: 1 },
];
const hay = (f) => fs.existsSync(path.join(DIR, f));

describe('bases reales del proceso de Chilete', () => {
  for (const caso of REALES) {
    const t = hay(caso.archivo) ? it : it.skip;
    t(`${caso.archivo.slice(0, 24)}… se tría como se midió a mano`, async () => {
      const zip = await JSZip.loadAsync(fs.readFileSync(path.join(DIR, caso.archivo)));
      const bloques = await bloquesDeDocx(zip);
      const r = resumenTriage(bloques);
      expect(r.paginasOcr).toBe(caso.paginasOcr);
      expect(r.decorativas).toBe(caso.decorativas);
      expect(r.charsNativos).toBeGreaterThan(caso.charsMin);
      // Toda página que va a OCR tiene su archivo resuelto: sin esto no hay
      // qué mandarle al motor.
      for (const b of bloques.filter(b => b.tipo === 'imagen' && b.necesitaOcr)) {
        expect(b.media, 'página sin archivo resuelto').toMatch(/^word\/media\//);
      }
    });
  }

  const t0 = hay(REALES[0].archivo) ? it : it.skip;
  t0('el calendario con fechas REALES sale del texto nativo, sin OCR', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(DIR, REALES[0].archivo)));
    const md = bloquesAMarkdown(await bloquesDeDocx(zip));
    expect(md).toContain('CALENDARIO DEL PROCESO DE SELECCIÓN');
    expect(md).toContain('17/08/2026');            // convocatoria
    expect(md).toContain('18/09/2026');            // otorgamiento de buena pro
  });

  const t1 = hay(REALES[1].archivo) ? it : it.skip;
  t1('el personal clave de la SUPERVISIÓN es nativo: se lee sin gastar OCR', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(DIR, REALES[1].archivo)));
    const md = bloquesAMarkdown(await bloquesDeDocx(zip));
    expect(md).toContain('EXPERIENCIA DEL PERSONAL CLAVE');
    expect(md).toContain('Jefe de Supervisión del Proyecto');
    expect(md).toMatch(/02 Participaciones/i);
  });

  const t2 = hay(REALES[0].archivo) ? it : it.skip;
  t2('las páginas del TDR salen con su rotación declarada, no adivinada', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(DIR, REALES[0].archivo)));
    const bloques = await bloquesDeDocx(zip);
    const paginas = bloques.filter(b => b.tipo === 'imagen' && b.necesitaOcr);
    const correcciones = new Set(paginas.map(p => p.rotacionCorreccion));
    // 12 a 270° (se corrigen con 90) y 3 a 90° (se corrigen con 270).
    expect(correcciones).toEqual(new Set([90, 270]));
    expect(paginas.filter(p => p.rotacionCorreccion === 90).length).toBe(12);
    expect(paginas.filter(p => p.rotacionCorreccion === 270).length).toBe(3);
  });
});

// ── El otro camino: PDF (tanda 15, entrega 3) ──────────────────────
//
// Las BASES INTEGRADAS del proceso 009 son el espejo exacto de Chilete:
// 96 páginas de las que 94 están escaneadas y solo 2 son nativas. El mismo
// triage sirve para las dos porque nunca decidió a nivel de documento.

/** Un documento de pdf.js de mentira: alcanza para probar la decisión. */
const pdfFalso = (paginas) => ({
  numPages: paginas.length,
  getPage: async (n) => ({
    getTextContent: async () => ({
      items: (paginas[n - 1] || []).map((s, i) => ({ str: s, transform: [1, 0, 0, 1, 0, 1000 - i * 12] })),
    }),
  }),
});

describe('renglonesDeItems', () => {
  it('reconstruye los renglones de arriba hacia abajo y de izquierda a derecha', () => {
    const items = [
      { str: 'CIVIL', transform: [1, 0, 0, 1, 80, 500] },
      { str: 'INGENIERO ', transform: [1, 0, 0, 1, 10, 500] },
      { str: 'TÍTULO', transform: [1, 0, 0, 1, 10, 600] },
    ];
    expect(renglonesDeItems(items)).toEqual(['TÍTULO', 'INGENIERO CIVIL']);
  });
  it('sin ítems no explota', () => {
    expect(renglonesDeItems(null)).toEqual([]);
  });
});

describe('bloquesDePdf', () => {
  it('separa la página nativa de la escaneada y le pone su número a cada una', async () => {
    // Un párrafo de verdad: con 71 letras esto NO califica como nativo (el
    // piso son 80) y el triage lo mandaría a OCR — el umbral haciendo su trabajo.
    const nativa = 'REQUISITOS DE CALIFICACION DEL PERSONAL CLAVE PROPUESTO PARA LA '
      + 'EJECUCION DE LA OBRA, conforme a lo señalado en los Terminos de Referencia.';
    const bloques = await bloquesDePdf(pdfFalso([[nativa], [''], [nativa]]));
    expect(bloques.map(b => b.tipo)).toEqual(['texto', 'imagen', 'texto']);
    expect(bloques.map(b => b.pagina)).toEqual([1, 2, 3]);
    expect(bloques[1].media).toBe('pdf:p2');
    expect(bloques[1].necesitaOcr).toBe(true);
  });

  it('NO corrige rotación: en un PDF el viewport ya la aplicó (a diferencia del .docx)', async () => {
    const bloques = await bloquesDePdf(pdfFalso([['']]));
    expect(bloques[0].rotacionCorreccion).toBe(0);
  });

  it('solo rasteriza lo que va a OCR — rasterizar una página nativa es pagar de gusto', async () => {
    const pedidas = [];
    await bloquesDePdf(pdfFalso([['x'.repeat(300)], ['']]), {
      rasterizar: async (_page, n) => { pedidas.push(n); return 'data:image/jpeg;base64,AAA'; },
    });
    expect(pedidas).toEqual([2]);
  });

  it('el markdown lleva el ancla de página, que es lo que permite citar', async () => {
    const bloques = await bloquesDePdf(pdfFalso([['A'.repeat(200)], ['B'.repeat(200)]]));
    const md = bloquesAMarkdown(bloques);
    expect(md).toContain('<!-- página 1 -->');
    expect(md).toContain('<!-- página 2 -->');
  });

  it('un .docx sigue sin anclas: no tiene páginas y no se le inventan', () => {
    const md = bloquesAMarkdown([{ tipo: 'texto', texto: 'sin páginas' }]);
    expect(md).not.toContain('<!-- página');
  });
});

// Contra el PDF de verdad. 96 páginas, medido a mano el 8-set-2026.
const PDF_REAL = 'BASES_INTEGRADAS_PROCESO_SELECCION_009 (2).pdf';
const tPdf = hay(PDF_REAL) ? it : it.skip;
describe('BASES INTEGRADAS 009 — el PDF casi todo escaneado', () => {
  tPdf('96 páginas: 2 nativas y 94 a OCR, como se midió', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(fs.readFileSync(path.join(DIR, PDF_REAL)));
    const pdf = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    const bloques = await bloquesDePdf(pdf);
    const r = resumenTriage(bloques);
    expect(bloques).toHaveLength(96);
    expect(r.paginasOcr).toBe(94);
    expect(bloques.filter(b => b.tipo === 'texto')).toHaveLength(2);
  }, 120000);
});

// ═══════════════════════════════════════════════════════════════════
// ENTREGA 5 — los TRAMOS del .docx (el bug del 8-set-2026)
// ═══════════════════════════════════════════════════════════════════
import { CHARS_POR_TRAMO } from '../bases-triage.js';

/** Un .docx de mentira: N párrafos de `chars` caracteres. */
function zipFalso(parrafos) {
  const xml = '<w:document><w:body>'
    + parrafos.map(t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')
    + '</w:body></w:document>';
  return {
    file: (nombre) => ({
      async: async () => (nombre === 'word/document.xml' ? xml : '<Relationships></Relationships>'),
    }),
  };
}

describe('bloquesDeDocx — un Word no tiene páginas, así que se numeran TRAMOS', () => {
  it('numera tramos y el markdown SÍ trae anclas (antes no traía ninguna)', async () => {
    const parrafos = Array.from({ length: 10 }, (_, i) => `${'a'.repeat(1000)} parrafo ${i}`);
    const bloques = await bloquesDeDocx(zipFalso(parrafos));
    expect(bloques.every(b => b.pagina != null)).toBe(true);
    expect(bloques.every(b => b.unidad === 'tramo')).toBe(true);
    const md = bloquesAMarkdown(bloques);
    expect(md).toMatch(/<!-- página 1 -->/);
    expect(md).toMatch(/<!-- página 2 -->/);
  });

  it('un tramo agrupa unos 3.000 caracteres, como una página de bases', async () => {
    const parrafos = Array.from({ length: 9 }, () => 'x'.repeat(1000));
    const bloques = await bloquesDeDocx(zipFalso(parrafos));
    const ultimo = Math.max(...bloques.map(b => b.pagina));
    expect(CHARS_POR_TRAMO).toBe(3000);
    expect(ultimo).toBeGreaterThanOrEqual(3);
    expect(ultimo).toBeLessThanOrEqual(4);
  });

  it('el troceo de verdad: un documento largo se puede cortar por rangos', async () => {
    const parrafos = Array.from({ length: 80 }, (_, i) => `${'z'.repeat(1000)} bloque ${i}`);
    const bloques = await bloquesDeDocx(zipFalso(parrafos));
    const r = resumenTriage(bloques);
    expect(r.unidad).toBe('tramo');
    expect(r.tramos).toBeGreaterThan(20);
  });

  it('resumenTriage dice «pagina» cuando el documento sí las tiene', () => {
    expect(resumenTriage([{ tipo: 'texto', pagina: 1, texto: 'a' }]).unidad).toBe('pagina');
  });
});
