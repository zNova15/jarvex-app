// ═══════════════════════════════════════════════════════════════════
// LEER UN CV SIN GASTAR, Y PARTIRLO CUANDO NO ENTRA (tanda 15, entrega 6).
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { presupuestarCv, fundirCv, MIN_ALFA_CV } from '../cv-analisis.js';

/** El CV real: 8 páginas de texto y 31 escaneadas. */
const bloquesCv = () => [
  ...Array.from({ length: 8 }, (_, i) => ({ tipo: 'texto', pagina: i + 1, texto: 'a'.repeat(1200) })),
  ...Array.from({ length: 31 }, (_, i) => ({
    tipo: 'imagen', pagina: i + 9, media: `pdf:p${i + 9}`, necesitaOcr: true, imagen: 'data:image/jpeg;base64,AAA',
  })),
];

describe('presupuestarCv — leer un CV no cuesta nada', () => {
  it('la lectura normal sale USD 0: solo se lee lo que ya es texto', () => {
    const p = presupuestarCv(bloquesCv());
    expect(p.paginasNativas).toBe(8);
    expect(p.paginasEscaneadas).toBe(31);
    expect(p.costo.total).toBe(0);
  });
  it('y dice aparte cuánto costaría pasar las constancias por OCR', () => {
    const p = presupuestarCv(bloquesCv());
    expect(p.costoConConstancias.total).toBeCloseTo(31 * 0.002, 4);
  });
  it('el piso de texto deja fuera la cabecera impresa sobre cada constancia', () => {
    // Medido en el CV real: 69 letras de cabecera contra 325 a 1.570 de una
    // página de currículum. El piso de las bases (80) las daba por nativas.
    expect(MIN_ALFA_CV).toBeGreaterThan(69);
    expect(MIN_ALFA_CV).toBeLessThan(325);
  });
});

describe('fundirCv — dos mitades del mismo CV', () => {
  it('junta las experiencias y los cursos de las dos tandas', () => {
    const a = { persona: { nombres: 'Jaime', dni: '40584979' }, ficha: { profesion: 'Ingeniero de Sistemas', capacitaciones: [{ nombre: 'SIAF' }] },
      experiencias: [{ entidad: 'PROREGIÓN' }], alertas: ['a1'] };
    const b = { persona: { apellidos: 'Ayay Valdez' }, ficha: { universidad: 'UNC', capacitaciones: [{ nombre: 'Power BI' }] },
      experiencias: [{ entidad: 'NISSI' }], alertas: ['a2'] };
    const r = fundirCv(a, b);
    expect(r.persona).toMatchObject({ nombres: 'Jaime', apellidos: 'Ayay Valdez', dni: '40584979' });
    expect(r.ficha.profesion).toBe('Ingeniero de Sistemas');
    expect(r.ficha.universidad).toBe('UNC');
    expect(r.ficha.capacitaciones).toHaveLength(2);
    expect(r.experiencias).toHaveLength(2);
    expect(r.alertas).toEqual(['a1', 'a2']);
  });
  it('la primera mitad manda: no se pisa un dato bueno con uno vacío', () => {
    const r = fundirCv({ ficha: { profesion: 'Ingeniero Civil' } }, { ficha: { profesion: null, titulo: 'Ing.' } });
    expect(r.ficha.profesion).toBe('Ingeniero Civil');
    expect(r.ficha.titulo).toBe('Ing.');
  });
  it('si una mitad falló, vale la otra', () => {
    expect(fundirCv(null, { experiencias: [1] }).experiencias).toHaveLength(1);
    expect(fundirCv({ experiencias: [1] }, null).experiencias).toHaveLength(1);
  });
});
