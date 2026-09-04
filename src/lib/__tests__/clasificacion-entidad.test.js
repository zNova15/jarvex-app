import { describe, it, expect } from 'vitest';
import {
  sugerirTipoEntidad, revisarCatalogo, pendientesDeVincular,
  TIPOS_ENTIDAD, TIPO_ENTIDAD_LBL,
} from '../clasificacion-entidad.js';

// Fotografía del catálogo real de producción (2-sep-2026). El valor de este
// bloque es que contiene las dos trampas: companies que se llaman CONSORCIO y
// no lo son.
const OBRA_INCA = { id: 'o-inca', nombre_obra: 'Los Baños del Inca', ejecutora_company_id: 'c-inca' };
const OBRA_SM   = { id: 'o-sm',   nombre_obra: 'Obras San Marcos',   ejecutora_company_id: 'c-chusaac' };

const CATALOGO = [
  // Consorcios EN CURSO: ejecutan una obra.
  { id: 'c-inca',    name: 'CONSORCIO EL INCA', ruc: '20615346081', rol_grupo: 'mixta',  notas: null },
  { id: 'c-chusaac', name: 'CONSORCIO CHUSAAC', ruc: '20613408011', rol_grupo: 'mixta',  notas: 'Creada rápidamente desde Obra' },
  // Consorcios YA TERMINADOS. Gabriel corrigió el 3-sep: son del grupo, siguen
  // abiertos porque falta bancarizar, y su obra nunca se cargó en la app.
  // La versión anterior de la heurística los mandaba a 'tercero'.
  { id: 'c-esper',   name: 'CONSORCIO ESPERANZA', ruc: '20611547367', rol_grupo: 'origen', notas: 'Creada automáticamente desde Captura Mágica' },
  { id: 'c-samaday', name: 'CONSORCIO SAMADAY',   ruc: '20612219479', rol_grupo: 'origen', notas: 'Creada automáticamente desde Captura Mágica' },
  // Empresa propia cargada a mano, sin obra: NO se puede saber sola.
  { id: 'c-jarvex',  name: 'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.', ruc: '20615646505', rol_grupo: 'mixta', notas: null },
  // Proveedor autocreado: tampoco se puede saber solo.
  { id: 'c-gasomi',  name: 'GASOMI INGENIEROS E.I.R.L.', ruc: '20600097726', rol_grupo: 'origen', notas: 'Creada automáticamente desde Captura Mágica' },
  // Persona natural del entorno familiar (RUC 10…).
  { id: 'c-gabriel', name: 'JULCA SALAZAR GABRIEL JESUS', ruc: '10600375399', rol_grupo: 'origen', notas: 'Creada automáticamente desde Captura Mágica' },
];
const OBRAS = [OBRA_INCA, OBRA_SM];
const MOVS = { 'c-inca': 125, 'c-chusaac': 42, 'c-esper': 47, 'c-samaday': 12, 'c-jarvex': 160, 'c-gasomi': 296, 'c-gabriel': 75 };

const filaDe = (r, id) => r.filas.find(f => f.company.id === id);

describe('sugerirTipoEntidad — solo habla con evidencia fuerte', () => {
  it('llamarse consorcio Y ejecutar obra = consorcio', () => {
    const r = sugerirTipoEntidad(CATALOGO[0], [OBRA_INCA], 125);
    expect(r.sugerido).toBe('consorcio');
    expect(r.confianza).toBe('alta');
    expect(r.evidencia.movs).toBe(125);
    expect(r.evidencia.obras).toEqual(['Los Baños del Inca']);
  });

  it('EL BUG QUE GABRIEL CORRIGIÓ: un consorcio TERMINADO sigue siendo consorcio', () => {
    // ESPERANZA y SAMADAY no ejecutan ninguna obra viva (la suya nunca se
    // cargó) y la primera versión los mandaba a 'tercero'. "No ejecuta obra"
    // no significa "no es del grupo".
    for (const c of [CATALOGO[2], CATALOGO[3]]) {
      const r = sugerirTipoEntidad(c, [], MOVS[c.id]);
      expect(r.sugerido).toBe('consorcio');
      expect(r.motivo).toContain('ya terminado');
    }
  });

  it('ejecutar una obra sin llamarse consorcio = empresa propia', () => {
    const r = sugerirTipoEntidad({ id: 'x', name: 'CONSTRUCTORA X S.A.C.' }, [OBRA_SM], 10);
    expect(r.sugerido).toBe('propia');
    expect(r.confianza).toBe('alta');
  });

  it('sin obra y sin nombre de consorcio NO se sugiere nada', () => {
    // Ni la empresa propia ni el proveedor autocreado se pueden distinguir por
    // los datos: las 17 companies tienen movimientos propios. Callar es lo
    // correcto; sugerir invita a aceptar en lote algo equivocado.
    for (const c of [CATALOGO[4], CATALOGO[5], CATALOGO[6]]) {
      const r = sugerirTipoEntidad(c, [], MOVS[c.id]);
      expect(r.sugerido).toBeNull();
      expect(r.confianza).toBe('ninguna');
    }
  });

  it('el motivo enumera los indicios en vez de decidir por ellos', () => {
    const r = sugerirTipoEntidad(CATALOGO[5], [], 296);
    expect(r.motivo).toContain('Captura Mágica');
    expect(r.motivo).toContain('296 movimientos');
  });

  it('marca las personas naturales por su RUC 10…', () => {
    expect(sugerirTipoEntidad(CATALOGO[6], [], 75).evidencia.personaNatural).toBe(true);
    expect(sugerirTipoEntidad(CATALOGO[5], [], 296).evidencia.personaNatural).toBe(false);
  });

  it('detecta "Magica" sin tilde igual que "Mágica"', () => {
    const sin = { id: 'x', name: 'P', notas: 'Creada automaticamente desde Captura Magica' };
    expect(sugerirTipoEntidad(sin, [], 0).evidencia.autocreada).toBe(true);
  });

  it('el nombre matchea por palabra, no por substring accidental', () => {
    const r = sugerirTipoEntidad({ id: 'x', name: 'INCONSORCIABLE S.A.' }, [OBRA_SM], 0);
    expect(r.sugerido).toBe('propia');
  });

  it('también mira legal_name', () => {
    const r = sugerirTipoEntidad({ id: 'x', name: 'CCH', legal_name: 'CONSORCIO CHUSAAC' }, [OBRA_SM], 0);
    expect(r.sugerido).toBe('consorcio');
  });
});

describe('revisarCatalogo — sobre el catálogo real', () => {
  const r = revisarCatalogo({ companies: CATALOGO, obras: OBRAS, movsPorCompany: MOVS });

  it('los 4 consorcios salen como consorcio, incluidos los terminados', () => {
    for (const id of ['c-inca', 'c-chusaac', 'c-esper', 'c-samaday']) {
      expect(filaDe(r, id).sugerido).toBe('consorcio');
    }
    expect(r.resumen.consorcio).toBe(4);
  });

  it('lo que no se puede saber queda SIN sugerencia y no propone cambio', () => {
    for (const id of ['c-jarvex', 'c-gasomi', 'c-gabriel']) {
      const f = filaDe(r, id);
      expect(f.sugerido).toBeNull();
      expect(f.requiereDecision).toBe(true);
      expect(f.cambia).toBe(false);   // no se toca sin que alguien decida
    }
    expect(r.resumen.sinDecidir).toBe(3);
    expect(r.resumen.total).toBe(7);
  });

  it('lo que hay que decidir va primero; después lo que cambia', () => {
    expect(r.filas.slice(0, 3).every(f => f.requiereDecision)).toBe(true);
    expect(r.filas.slice(3).every(f => f.cambia)).toBe(true);
    expect(r.resumen.cambian).toBe(4);   // los 4 consorcios
  });

  it('una company ya clasificada no figura como cambio', () => {
    const yaOk = revisarCatalogo({
      companies: [{ ...CATALOGO[0], tipo_entidad: 'consorcio' }], obras: OBRAS, movsPorCompany: MOVS,
    });
    expect(yaOk.filas[0].cambia).toBe(false);
  });

  it('una decisión del catálogo NO se propone deshacer (ESPERANZA como tercero)', () => {
    // Gabriel decidió el 3-sep tratar a CONSORCIO ESPERANZA y CONSORCIO
    // SAMADAY como terceros. La heurística sigue viendo "se llama consorcio",
    // pero no puede proponer el cambio en bucle: 'tercero' no es el default de
    // la columna, alguien lo eligió. Revertirlo es un acto manual.
    const decidido = revisarCatalogo({
      companies: [
        { ...CATALOGO.find(c => c.id === 'c-esper'), tipo_entidad: 'tercero' },
        { ...CATALOGO.find(c => c.id === 'c-samaday'), tipo_entidad: 'tercero' },
      ],
      obras: OBRAS, movsPorCompany: MOVS,
    });
    expect(decidido.filas.every(f => f.decidido)).toBe(true);
    expect(decidido.filas.every(f => f.cambia)).toBe(false);
    expect(decidido.resumen.cambian).toBe(0);
    // La sugerencia se sigue mostrando, con el motivo diciendo quién manda.
    expect(decidido.filas[0].sugerido).toBe('consorcio');
    expect(decidido.filas[0].motivo).toContain('manda esa decisión');
  });

  it('ignora borrados y aguanta que no le pasen nada', () => {
    const conBorrada = revisarCatalogo({ companies: [...CATALOGO, { id: 'z', name: 'Z', deleted_at: 'x' }], obras: OBRAS });
    expect(conBorrada.resumen.total).toBe(7);
    expect(revisarCatalogo().resumen.total).toBe(0);
    expect(revisarCatalogo({}).filas).toEqual([]);
  });
});

describe('pendientesDeVincular — un consorcio sin obra quedaría invisible', () => {
  it('resuelve sola la obra cuando la company ya es su ejecutora', () => {
    const p = pendientesDeVincular({ 'c-inca': 'consorcio' }, { companies: CATALOGO, obras: OBRAS, consorcios: [] });
    expect(p).toHaveLength(1);
    expect(p[0].obraSugerida.id).toBe('o-inca');
  });

  it('deja obraSugerida en null cuando no hay de dónde deducirla', () => {
    const p = pendientesDeVincular({ 'c-esper': 'consorcio' }, { companies: CATALOGO, obras: OBRAS, consorcios: [] });
    expect(p[0].obraSugerida).toBeNull();
  });

  it('no pide nada si el consorcio ya está vinculado', () => {
    const consorcios = [{ id: 'k1', obra_id: 'o-inca', company_id: 'c-inca' }];
    expect(pendientesDeVincular({ 'c-inca': 'consorcio' }, { companies: CATALOGO, obras: OBRAS, consorcios })).toEqual([]);
  });

  it('propia y tercero no generan pendientes', () => {
    const p = pendientesDeVincular({ 'c-gasomi': 'tercero', 'c-jarvex': 'propia' }, { companies: CATALOGO, obras: OBRAS });
    expect(p).toEqual([]);
  });
});

describe('catálogo de tipos', () => {
  it('son exactamente los tres del CHECK de la mig 172', () => {
    expect(TIPOS_ENTIDAD.map(t => t.v)).toEqual(['propia', 'consorcio', 'tercero']);
    expect(TIPO_ENTIDAD_LBL.consorcio).toBe('Consorcio');
  });
});
