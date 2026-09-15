// ═══════════════════════════════════════════════════════════════════
// EL RECORTE DE CANDIDATOS (tanda 2, 15-set-2026).
//
// Se le mandaban al modelo las 95 clasificaciones enteras en cada pregunta:
// ~1.900 tokens de lista y, peor, 83 formas de irse por las ramas. Estos tests
// defienden que la lista corta sigue teniendo lo que tiene que tener —sin eso,
// recortar es perder respuestas correctas en vez de ahorrar.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { candidatosParaIA, categoriasParaElegir } from '../indices-unificados-iupc.js';

const codigos = (lista) => lista.map(c => String(c.codigo));

describe('candidatosParaIA', () => {
  it('manda unas pocas opciones, no las 95', () => {
    const todas = categoriasParaElegir();
    const cortos = candidatosParaIA('CEMENTO PORTLAND TIPO I 42.5 KG');
    expect(todas.length).toBeGreaterThan(80);
    expect(cortos.length).toBeLessThanOrEqual(12);
    expect(cortos.length).toBeGreaterThan(0);
  });

  it('la propuesta del motor local SIEMPRE está', () => {
    // Si no estuviera, la IA no podría confirmarla ni aunque quisiera, y
    // confirmarla es lo que más acierta (el motor local lee el Anexo 2).
    const c = candidatosParaIA('UN TEXTO QUE NO SE PARECE A NADA CONOCIDO', {
      propuestaLocal: { codigo: '21', nombre: 'Cemento' },
    });
    expect(codigos(c)).toContain('21');
  });

  it('el primero es la propuesta local: la lista se lee en orden', () => {
    const c = candidatosParaIA('ALAMBRE DE AMARRE #8', { propuestaLocal: { codigo: '02', nombre: 'Alambre' } });
    expect(String(c[0].codigo)).toBe('02');
  });

  it('las dos salidas de escape SIEMPRE están', () => {
    // Sin ellas el modelo fuerza un código IUPC sobre algo que no es un insumo
    // de obra — el error de «LA INMOBILIARIA BCP», que es el interés de un
    // préstamo. Se comprueba con un texto que arrastra mucha evidencia, para
    // que el escape tenga que hacerse lugar a los codazos.
    const c = codigos(candidatosParaIA('TUBO DE ACERO GALVANIZADO PARA AGUA POTABLE CON VALVULA'));
    expect(c).toContain('servicios');
    expect(c).toContain('administrativos');
  });

  it('NUNCA ofrece sin_clasificar', () => {
    // Regla 8 del CLAUDE.md: «no sé» no se sugiere. Y como esta lista es la que
    // valida la respuesta en el server, ofrecerla sería habilitarla.
    for (const texto of ['CEMENTO', 'XYZQW', 'SERVICIO DE ALGO', 'LA INMOBILIARIA BCP']) {
      expect(codigos(candidatosParaIA(texto))).not.toContain('sin_clasificar');
    }
  });

  it('rellena con lo que la empresa usa cuando el diccionario no alcanza', () => {
    const c = codigos(candidatosParaIA('QWXZ PLPL', { frecuentes: ['21', '03', '72', '83', '37', '65', '07', '43'] }));
    expect(c.length).toBeGreaterThanOrEqual(8);
    expect(c).toContain('21');
  });

  it('no inventa códigos: todo sale del universo que se le pasa', () => {
    const universo = [
      { codigo: '21', nombre: 'Cemento' },
      { codigo: 'servicios', nombre: 'Servicios' },
      { codigo: 'administrativos', nombre: 'Administrativos' },
    ];
    const c = codigos(candidatosParaIA('CEMENTO PORTLAND', { opciones: universo, frecuentes: ['03', '72'] }));
    // '03' y '72' son frecuentes de verdad, pero no están en ESTE universo: no
    // pueden aparecer. Lo contrario sería ofrecerle a la IA un código que el
    // desplegable de esa pantalla no tiene.
    expect(c).not.toContain('03');
    expect(c).not.toContain('72');
    expect(c.sort()).toEqual(['21', 'administrativos', 'servicios']);
  });

  it('una clasificación propia del universo puede salir elegida', () => {
    const universo = [
      ...categoriasParaElegir(),
      { codigo: 'PI-GEO', nombre: 'Geosintéticos', label: '[PI-GEO] Geosintéticos' },
    ];
    const c = codigos(candidatosParaIA('GEOMALLA TRIAXIAL', {
      opciones: universo, propuestaLocal: { codigo: 'PI-GEO', nombre: 'Geosintéticos' },
    }));
    expect(c).toContain('PI-GEO');
  });

  it('no repite un código aunque venga por dos caminos', () => {
    const c = codigos(candidatosParaIA('SERVICIO DE ALQUILER DE CAMIONETA', {
      propuestaLocal: { codigo: 'servicios', nombre: 'Servicios' },
      frecuentes: ['servicios', 'servicios'],
    }));
    expect(new Set(c).size).toBe(c.length);
  });
});

// ═══════════════════════════════════════════════════════════════════
// LA MEDICIÓN QUE JUSTIFICA EL DISEÑO.
//
// Recortar de 95 a 12 solo sirve si la respuesta CORRECTA sigue estando. Medido
// el 15-set-2026 contra los 32 casos reales del piloto: sin el relleno de
// `FRECUENTES_POR_DEFECTO` la correcta se perdía en 8 de 32 (25%) — el recorte
// habría fabricado errores nuevos en vez de ahorrar. Este test es el que avisa
// si alguien afloja el relleno o el mínimo.
// ═══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { clasificarConIUPC, etiquetaCategoria } from '../indices-unificados-iupc.js';

describe('el recorte no se come la respuesta correcta', () => {
  const SET = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), 'scripts/piloto/set-clasificacion.json'), 'utf8'));

  const listaDe = (caso) => {
    const rec = clasificarConIUPC(caso.descripcion);
    const propuestaLocal = rec?.codigo && rec.codigo !== 'sin_clasificar'
      ? { codigo: rec.codigo, nombre: etiquetaCategoria(rec.codigo) } : null;
    return codigos(candidatosParaIA(caso.descripcion, { propuestaLocal }));
  };

  it('cubre al menos 30 de los 32 casos reales', () => {
    const cubiertos = SET.casos.filter(c =>
      [c.esperado, ...(c.tambien_ok || [])].some(k => listaDe(c).includes(k))).length;
    expect(cubiertos).toBeGreaterThanOrEqual(30);
  });

  it('ninguna pregunta sale con menos de 8 opciones', () => {
    for (const c of SET.casos) {
      expect(listaDe(c).length).toBeGreaterThanOrEqual(8);
    }
  });
});
