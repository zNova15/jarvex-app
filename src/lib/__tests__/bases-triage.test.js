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
  UMBRAL_PAGINA_CM,
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
