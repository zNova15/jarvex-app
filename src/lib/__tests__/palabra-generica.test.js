// ═══════════════════════════════════════════════════════════════════
// UNA PALABRA GENÉRICA NO DECIDE SOLA (ronda 2 del simulador, tanda 2.1).
//
// Gabriel cargó a mano «MATERIAL SARANDEADO → [04] Agregado fino». El
// término está bien y se queda (decisión suya, 24-set-2026). Lo que estaba
// mal era el algoritmo: con la palabra «material» sola alcanzaba para ganar
// el parecido, y «MATERIAL DE OFICINA Y CAMPO» salía [04] con 80 %.
//
// La regla: un parecido con un término PROPIO tiene que compartir la palabra
// más distintiva de ese término (la menos frecuente en todo el vocabulario).
// Medido contra los 348 términos reales y 1.055 nombres del catálogo y los
// presupuestos: cambian 11 respuestas, todas las que venían de compartir una
// palabra genérica o solo medidas («TUBO DE 1/2» se llevaba «BROCHAS DE 2 1/2»).
//
// El fixture es un recorte de los términos reales de `clasificacion_terminos`.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { clasificarConIUPC, evidenciaDiccionario } from '../indices-unificados-iupc.js';

const T = (termino, clasificacion_codigo, origen = 'decision') =>
  ({ termino, clasificacion_codigo, origen, deleted_at: null });

const TERMINOS = [
  T('MATERIAL SARANDEADO', '04', 'manual'),
  T('REPOSTERO DE MELAMINE COLOR BLANCO X 8 COMPARTIMIENTOS Y 6 CAJONES (MATERIAL MELAMINE ESPSOR GRUESO) ( MARCA HOMECASTLE)', 'administrativos'),
  T('TUBO DE 1/2', '66'),
  T('2 x 6 x 3', '51'),
  T('UNION UNIVERSAL 1/2"', '72'),
  T('PEGAMENTO PVC 1/4 AZUL', '86'),
  T('PL. GALV. 0.90 X 1200 X 2400', '61'),
  T('CEMENTO SOL', '21'),
  T('DIESEL B5 S-50 UV', '53'),
  T('GASOHOL REGULAR', '34'),
  T('PINTURA LATEX CPP ARTICO', '54'),
  T('ZAPATOS DE SEGURIDAD COLISEUM', '83'),
  T('TROMPO MEZCLADOR CON MOTOR KOHLER 1.14HP 310 LT MAKER', '48'),
];

const clasificar = (texto) => clasificarConIUPC(texto, { terminosCustom: TERMINOS });

describe('una palabra genérica no carga sola un término propio', () => {
  it('«MATERIAL DE OFICINA Y CAMPO» ya no sale agregado fino', () => {
    const r = clasificar('MATERIAL DE OFICINA Y CAMPO');
    expect(r.codigo).not.toBe('04');
    // Lo mismo que dice la capa oficial sola, sin el diccionario propio.
    expect(r.codigo).toBe(clasificarConIUPC('MATERIAL DE OFICINA Y CAMPO').codigo);
    expect(r.codigo).toBe('93');
  });

  it('«MATERIAL PARA CAPACITACIÓN A PERSONAL» es capacitación', () => {
    expect(clasificar('MATERIAL PARA CAPACITACIÓN A PERSONAL').codigo).toBe('S04');
  });

  it('«MATERIAL ELÉCTRICO» tampoco cae en agregados', () => {
    expect(clasificar('MATERIAL ELÉCTRICO').codigo).not.toBe('04');
  });

  it('el término de Gabriel sigue mandando donde corresponde', () => {
    const exacto = clasificar('MATERIAL SARANDEADO');
    expect(exacto.codigo).toBe('04');
    expect(exacto.capa).toBe('manual');

    // Comparte la palabra que lo hace ser ese término: sigue ganando.
    const parecido = clasificar('MATERIAL SARANDEADO DE CANTERA');
    expect(parecido.codigo).toBe('04');
    expect(parecido.capa).toBe('manual');
  });

  it('lo aprendido tampoco gana por una medida en común', () => {
    // «TUBO DE 1/2» → [66] se llevaba las brochas por el «1/2».
    expect(clasificar('BROCHAS DE 2 1/2').codigo).toBe('37');
    // «PEGAMENTO PVC 1/4 AZUL» → [86] se llevaba los tarugos por «pvc 1/4».
    expect(clasificar('TARUGOS DE PVC DE 1/4"').codigo).not.toBe('86');
  });

  it('un término hecho solo de medidas vale solo como coincidencia exacta', () => {
    expect(clasificar("BISAGRA HECHIZA 3/8 X 2' X 2 ALAS").codigo).toBe('26');
    expect(clasificar('2 x 6 x 3').codigo).toBe('51');
  });

  it('los parecidos buenos del diccionario aprendido siguen funcionando', () => {
    // Comparten la palabra distintiva (galv, diesel, coliseum, kohler).
    expect(clasificar('PL. GALV. 0.80 X 1200 X 2400').codigo).toBe('61');
    expect(clasificar('DIESEL B5 S-50').codigo).toBe('53');
    expect(clasificar('ZAPATOS COLISEUM TALLA 42').codigo).toBe('83');
    expect(clasificar('TROMPO MEZCLADOR KOHLER 9HP').codigo).toBe('48');
  });

  it('la evidencia que ve la IA tampoco trae el término por la palabra genérica', () => {
    const ev = evidenciaDiccionario('MATERIAL DE OFICINA Y CAMPO', { terminosCustom: TERMINOS });
    expect(ev.flatMap(g => g.propios)).not.toContain('MATERIAL SARANDEADO');

    const conEl = evidenciaDiccionario('MATERIAL SARANDEADO FINO', { terminosCustom: TERMINOS });
    expect(conEl.flatMap(g => g.propios)).toContain('MATERIAL SARANDEADO');
  });
});
