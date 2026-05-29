import { describe, it, expect } from 'vitest';
import { normNombre, palabraBase, agruparPorPadre, detectarSugerencias, detectarDuplicados } from '../variantes.js';

describe('normNombre — normaliza para detectar duplicados', () => {
  it('colapsa espacios y acentos', () => {
    expect(normNombre('ZAPATO 39')).toBe('zapato39');
    expect(normNombre('ZAPATO39')).toBe('zapato39');
    expect(normNombre('  Botín  Acero  ')).toBe('botinacero');
  });
  it('vacío → ""', () => { expect(normNombre('')).toBe(''); expect(normNombre(null)).toBe(''); });
});

describe('palabraBase — base para agrupar variantes', () => {
  it('quita dígitos/talla del final del primer token', () => {
    expect(palabraBase('ZAPATOS38')).toBe('zapatos');
    expect(palabraBase('Zapatos 38')).toBe('zapatos');
    expect(palabraBase('GUANTES C35/T9')).toBe('guantes');
  });
  it('ZAPATOS38 (sin espacio) cae en la misma base que "Zapatos 38"', () => {
    expect(palabraBase('ZAPATOS38')).toBe(palabraBase('Zapatos 38'));
  });
  it('token corto o numérico → null', () => {
    expect(palabraBase('39')).toBe(null);
    expect(palabraBase('')).toBe(null);
  });
});

describe('agruparPorPadre', () => {
  it('agrupa hijos por padre_id', () => {
    const m = agruparPorPadre([
      { id: 'g', es_grupo: true }, { id: 'a', padre_id: 'g' }, { id: 'b', padre_id: 'g' }, { id: 'c' },
    ]);
    expect(m.get('g').map(x => x.id)).toEqual(['a', 'b']);
    expect(m.has('c')).toBe(false);
  });
});

describe('detectarSugerencias', () => {
  it('sugiere CREAR grupo con ≥3 sueltos de la misma base', () => {
    const items = [
      { id: '1', nombre_epp: 'ZAPATOS 38' }, { id: '2', nombre_epp: 'ZAPATOS 39' },
      { id: '3', nombre_epp: 'ZAPATOS 40' }, { id: '4', nombre_epp: 'CASCO' },
    ];
    const s = detectarSugerencias(items, 'nombre_epp');
    const zap = s.find(x => x.clave === 'zapatos');
    expect(zap.tipo).toBe('create');
    expect(zap.items.length).toBe(3);
  });
  it('sugiere AÑADIR a grupo existente (caso ZAPATOS38 corregido)', () => {
    const items = [
      { id: 'g', nombre_epp: 'Zapatos', es_grupo: true },
      { id: 'x', nombre_epp: 'ZAPATOS 38' },          // suelto que debería entrar al grupo
    ];
    const s = detectarSugerencias(items, 'nombre_epp');
    const zap = s.find(x => x.clave === 'zapatos');
    expect(zap.tipo).toBe('add');
    expect(zap.grupo.id).toBe('g');
    expect(zap.items.map(i => i.id)).toEqual(['x']);
  });
  it('no sugiere sobre ítems ya agrupados ni borrados', () => {
    const items = [
      { id: 'g', nombre_epp: 'Zapatos', es_grupo: true },
      { id: 'a', nombre_epp: 'Zapatos 38', padre_id: 'g' },
      { id: 'b', nombre_epp: 'Zapatos 39', deleted_at: 'x' },
    ];
    const s = detectarSugerencias(items, 'nombre_epp');
    expect(s.length).toBe(0);
  });
});

describe('detectarDuplicados', () => {
  it('agrupa nombres iguales tras normalizar (ZAPATO 39 == ZAPATO39)', () => {
    const items = [
      { id: '1', nombre: 'ZAPATO 39' }, { id: '2', nombre: 'ZAPATO39' }, { id: '3', nombre: 'OTRO' },
    ];
    const d = detectarDuplicados(items, 'nombre');
    expect(d.length).toBe(1);
    expect(d[0].items.map(i => i.id).sort()).toEqual(['1', '2']);
  });
  it('ignora grupos y borrados', () => {
    const items = [
      { id: 'g', nombre: 'Zapatos', es_grupo: true },
      { id: 'g2', nombre: 'Zapatos', es_grupo: true },
      { id: '1', nombre: 'Casco', deleted_at: 'x' }, { id: '2', nombre: 'Casco' },
    ];
    expect(detectarDuplicados(items, 'nombre').length).toBe(0);
  });
});
