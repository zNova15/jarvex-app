import { describe, it, expect } from 'vitest';
import {
  consorcioDeObra, esObraDeConsorcio, sociosDeConsorcio, sociosDeObra,
  titularContableDeObra, companyIdsDeObra, rolDeCompanyEnObra,
  sumaParticipacion, validarSocios, etiquetaEjecutora,
  MIN_SOCIOS,
} from '../consorcio.js';

// Caso de producción: CONSORCIO EL INCA ejecuta la obra de Los Baños del Inca.
const OBRA = 'obra-inca';
const TITULAR = 'company-el-inca';   // la company con el RUC del consorcio
const SOCIO_A = 'company-jarvex';
const SOCIO_B = 'company-jade';

const obra = (o = {}) => ({ id: OBRA, nombre_obra: 'Los Baños del Inca', ejecutora_tipo: 'consorcio', ejecutora_company_id: TITULAR, ...o });
const cons = (o = {}) => ({ id: 'c1', obra_id: OBRA, company_id: TITULAR, nombre: 'CONSORCIO EL INCA', estado: 'activo', ...o });
const socio = (company_id, pct, o = {}) => ({ id: `s-${company_id}`, consorcio_id: 'c1', company_id, participacion_pct: pct, ...o });

const COMPANIES = {
  [TITULAR]: { id: TITULAR, name: 'CONSORCIO EL INCA' },
  [SOCIO_A]: { id: SOCIO_A, name: 'JARVEX INGENIERIA' },
  [SOCIO_B]: { id: SOCIO_B, name: 'JADE CONSULTORIA' },
};
const lookup = (id) => COMPANIES[id];

describe('consorcioDeObra / esObraDeConsorcio', () => {
  it('encuentra el consorcio de la obra e ignora los borrados', () => {
    expect(consorcioDeObra(OBRA, [cons()])?.nombre).toBe('CONSORCIO EL INCA');
    expect(consorcioDeObra(OBRA, [cons({ deleted_at: '2026-01-01' })])).toBeNull();
    expect(consorcioDeObra('otra', [cons()])).toBeNull();
    expect(consorcioDeObra(null, [cons()])).toBeNull();
  });

  it('una obra sin fila en consorcios pero con el flag viejo sigue siendo de consorcio', () => {
    // Un bundle PWA cacheado puede haber dejado ejecutora_tipo sin la fila nueva.
    expect(esObraDeConsorcio(obra(), [])).toBe(true);
    expect(esObraDeConsorcio(obra({ ejecutora_tipo: 'empresa' }), [])).toBe(false);
    expect(esObraDeConsorcio(obra({ ejecutora_tipo: 'empresa' }), [cons()])).toBe(true);
  });
});

describe('sociosDeObra', () => {
  it('lee de consorcio_socios y normaliza', () => {
    const r = sociosDeObra(obra(), [cons()], [socio(SOCIO_A, 60, { es_lider: true }), socio(SOCIO_B, 40)]);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ company_id: SOCIO_A, participacion_pct: 60, es_lider: true });
  });

  it('el líder va primero, después por participación desc', () => {
    const r = sociosDeConsorcio('c1', [socio(SOCIO_A, 70), socio(SOCIO_B, 30, { es_lider: true })]);
    expect(r.map(s => s.company_id)).toEqual([SOCIO_B, SOCIO_A]);
  });

  it('cae al jsonb deprecado cuando el consorcio todavía no tiene socios cargados', () => {
    const o = obra({ consorcio_miembros: [{ company_id: SOCIO_A, participacion_pct: 51 }] });
    const r = sociosDeObra(o, [cons()], []);
    expect(r).toEqual([{ company_id: SOCIO_A, participacion_pct: 51, es_lider: false, _legacy: true }]);
  });

  it('la tabla nueva GANA sobre el jsonb: no se mezclan las dos fuentes', () => {
    const o = obra({ consorcio_miembros: [{ company_id: 'fantasma', participacion_pct: 99 }] });
    const r = sociosDeObra(o, [cons()], [socio(SOCIO_A, 60), socio(SOCIO_B, 40)]);
    expect(r.map(s => s.company_id)).toEqual([SOCIO_A, SOCIO_B]);
  });

  it('ignora socios borrados y miembros del jsonb sin empresa', () => {
    expect(sociosDeObra(obra(), [cons()], [socio(SOCIO_A, 100, { deleted_at: 'x' })])).toEqual([]);
    const o = obra({ consorcio_miembros: [{ company_id: '', participacion_pct: 50 }, null] });
    expect(sociosDeObra(o, [cons()], [])).toEqual([]);
  });
});

describe('titularContableDeObra — el invariante que sostiene toda la contabilidad', () => {
  it('el titular es la company DEL CONSORCIO, nunca la de un socio', () => {
    const socios = [socio(SOCIO_A, 60), socio(SOCIO_B, 40)];
    expect(titularContableDeObra(obra(), [cons()])).toBe(TITULAR);
    expect(sociosDeObra(obra(), [cons()], socios).map(s => s.company_id)).not.toContain(TITULAR);
  });

  it('sin fila en consorcios cae a obras.ejecutora_company_id', () => {
    expect(titularContableDeObra(obra(), [])).toBe(TITULAR);
  });

  it('un consorcio recién ganado sin RUC todavía no tiene titular', () => {
    expect(titularContableDeObra({ id: OBRA }, [cons({ company_id: null })])).toBeNull();
  });
});

describe('companyIdsDeObra y rolDeCompanyEnObra', () => {
  const socios = [socio(SOCIO_A, 60), socio(SOCIO_B, 40)];

  it('el conjunto de matcheo incluye al titular Y a los socios', () => {
    const ids = companyIdsDeObra(obra(), [cons()], socios);
    expect([...ids].sort()).toEqual([SOCIO_B, TITULAR, SOCIO_A].sort());
  });

  it('distingue ejecutora de miembro y devuelve null para una ajena', () => {
    expect(rolDeCompanyEnObra(TITULAR, obra(), [cons()], socios)).toBe('ejecutora');
    expect(rolDeCompanyEnObra(SOCIO_A, obra(), [cons()], socios)).toBe('miembro_consorcio');
    expect(rolDeCompanyEnObra('ajena', obra(), [cons()], socios)).toBeNull();
    expect(rolDeCompanyEnObra(null, obra(), [cons()], socios)).toBeNull();
  });
});

describe('validarSocios — las reglas que un CHECK de fila no puede ver', () => {
  const ok = [{ company_id: SOCIO_A, participacion_pct: 60 }, { company_id: SOCIO_B, participacion_pct: 40 }];

  it('acepta el caso correcto', () => {
    const r = validarSocios(ok);
    expect(r.ok).toBe(true);
    expect(r.errores).toEqual([]);
    expect(r.suma).toBe(100);
  });

  it('rechaza si no suman 100 y lo dice con el número', () => {
    const r = validarSocios([{ company_id: SOCIO_A, participacion_pct: 60 }, { company_id: SOCIO_B, participacion_pct: 30 }]);
    expect(r.ok).toBe(false);
    expect(r.errores.join(' ')).toContain('90%');
  });

  it('tolera el error de flotante de 33.33 + 33.33 + 33.34', () => {
    const tercios = [
      { company_id: 'a', participacion_pct: 33.33 },
      { company_id: 'b', participacion_pct: 33.33 },
      { company_id: 'c', participacion_pct: 33.34 },
    ];
    expect(validarSocios(tercios).ok).toBe(true);
  });

  it(`exige al menos ${MIN_SOCIOS} socios`, () => {
    expect(validarSocios([{ company_id: SOCIO_A, participacion_pct: 100 }]).ok).toBe(false);
  });

  it('rechaza empresas repetidas', () => {
    const r = validarSocios([{ company_id: SOCIO_A, participacion_pct: 50 }, { company_id: SOCIO_A, participacion_pct: 50 }]);
    expect(r.errores.join(' ')).toContain('repetida');
  });

  it('rechaza que el consorcio sea socio de sí mismo', () => {
    const r = validarSocios([{ company_id: TITULAR, participacion_pct: 50 }, { company_id: SOCIO_A, participacion_pct: 50 }],
      { titularCompanyId: TITULAR });
    expect(r.errores.join(' ')).toContain('socio de sí mismo');
  });

  it('rechaza porcentajes no positivos y más de un líder', () => {
    expect(validarSocios([{ company_id: 'a', participacion_pct: 0 }, { company_id: 'b', participacion_pct: 100 }]).ok).toBe(false);
    const dosLideres = [
      { company_id: 'a', participacion_pct: 50, es_lider: true },
      { company_id: 'b', participacion_pct: 50, es_lider: true },
    ];
    expect(validarSocios(dosLideres).errores.join(' ')).toContain('líder');
  });

  it('avisa de las filas sin empresa elegida', () => {
    const r = validarSocios([{ company_id: SOCIO_A, participacion_pct: 60 }, { company_id: '', participacion_pct: 40 }]);
    expect(r.errores.join(' ')).toContain('sin empresa');
  });

  it('no explota con entradas basura', () => {
    expect(validarSocios(null).ok).toBe(false);
    expect(validarSocios(undefined).ok).toBe(false);
    expect(sumaParticipacion(null)).toBe(0);
    expect(sumaParticipacion([{ participacion_pct: 'no-es-numero' }])).toBe(0);
  });
});

describe('etiquetaEjecutora', () => {
  const socios = [{ id: 's1', consorcio_id: 'c1', company_id: SOCIO_A, participacion_pct: 60 },
                  { id: 's2', consorcio_id: 'c1', company_id: SOCIO_B, participacion_pct: 40 }];

  it('no repite la palabra Consorcio cuando ya está en el nombre', () => {
    expect(etiquetaEjecutora(obra(), [cons()], socios, lookup))
      .toBe('CONSORCIO EL INCA (JARVEX INGENIERIA + JADE CONSULTORIA)');
  });

  it('la agrega cuando el nombre no la trae', () => {
    expect(etiquetaEjecutora(obra(), [cons({ nombre: 'San Marcos' })], socios, lookup))
      .toBe('Consorcio San Marcos (JARVEX INGENIERIA + JADE CONSULTORIA)');
  });

  it('una obra de empresa directa muestra el nombre de la empresa', () => {
    const o = { id: 'o2', ejecutora_tipo: 'empresa', ejecutora_company_id: SOCIO_A };
    expect(etiquetaEjecutora(o, [], [], lookup)).toBe('JARVEX INGENIERIA');
  });

  it('sin ejecutora devuelve un guion, no rompe', () => {
    expect(etiquetaEjecutora({ id: 'o3' }, [], [], lookup)).toBe('—');
    expect(etiquetaEjecutora(null, [], [], lookup)).toBe('—');
  });
});
