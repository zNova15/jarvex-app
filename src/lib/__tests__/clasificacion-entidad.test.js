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
  // Los 2 consorcios reales: ejecutan una obra Y se llaman consorcio.
  { id: 'c-inca',    name: 'CONSORCIO EL INCA', ruc: '20615346081', rol_grupo: 'mixta',  notas: null },
  { id: 'c-chusaac', name: 'CONSORCIO CHUSAAC', ruc: '20613408011', rol_grupo: 'mixta',  notas: 'Creada rápidamente desde Obra' },
  // Las 2 trampas: se llaman consorcio, NO ejecutan nada, las creó el OCR.
  { id: 'c-esper',   name: 'CONSORCIO ESPERANZA', rol_grupo: 'origen', notas: 'Creada automáticamente desde Captura Mágica' },
  { id: 'c-samaday', name: 'CONSORCIO SAMADAY',   rol_grupo: 'origen', notas: 'Creada automáticamente desde Captura Mágica' },
  // Empresa propia cargada a mano.
  { id: 'c-jarvex',  name: 'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.', rol_grupo: 'mixta', notas: null },
  // Proveedor común autocreado.
  { id: 'c-gasomi',  name: 'GASOMI INGENIEROS E.I.R.L.', rol_grupo: 'origen', notas: 'Creada automáticamente desde Captura Mágica' },
];
const OBRAS = [OBRA_INCA, OBRA_SM];
const MOVS = { 'c-inca': 125, 'c-chusaac': 42, 'c-esper': 47, 'c-samaday': 12, 'c-jarvex': 160, 'c-gasomi': 296 };

const filaDe = (r, id) => r.filas.find(f => f.company.id === id);

describe('sugerirTipoEntidad — el nombre nunca decide solo', () => {
  it('ejecutar una obra + llamarse consorcio = consorcio', () => {
    const r = sugerirTipoEntidad(CATALOGO[0], [OBRA_INCA], 125);
    expect(r.sugerido).toBe('consorcio');
    expect(r.evidencia.movs).toBe(125);
    expect(r.evidencia.obras).toEqual(['Los Baños del Inca']);
  });

  it('LA TRAMPA: llamarse consorcio SIN ejecutar obra = tercero', () => {
    // Esto es lo que un UPDATE por name ILIKE '%consorcio%' rompería.
    for (const c of [CATALOGO[2], CATALOGO[3]]) {
      const r = sugerirTipoEntidad(c, [], MOVS[c.id]);
      expect(r.sugerido).toBe('tercero');
      expect(r.motivo).toContain('no ejecuta ninguna obra del grupo');
    }
  });

  it('ejecutar una obra sin llamarse consorcio = empresa propia', () => {
    const r = sugerirTipoEntidad({ id: 'x', name: 'CONSTRUCTORA X S.A.C.' }, [OBRA_SM], 10);
    expect(r.sugerido).toBe('propia');
  });

  it('autocreada por el OCR y sin obra = tercero', () => {
    expect(sugerirTipoEntidad(CATALOGO[5], [], 296).sugerido).toBe('tercero');
  });

  it('rol_grupo=origen basta aunque las notas estén vacías', () => {
    expect(sugerirTipoEntidad({ id: 'x', name: 'PROVEEDOR', rol_grupo: 'origen' }, [], 0).sugerido).toBe('tercero');
  });

  it('detecta "Magica" sin tilde igual que "Mágica"', () => {
    const sin = { id: 'x', name: 'P', notas: 'Creada automaticamente desde Captura Magica' };
    expect(sugerirTipoEntidad(sin, [], 0).evidencia.autocreada).toBe(true);
  });

  it('cargada a mano y sin obra: propia, pero el motivo pide revisión', () => {
    const r = sugerirTipoEntidad(CATALOGO[4], [], 160);
    expect(r.sugerido).toBe('propia');
    expect(r.motivo).toContain('revisar');
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

  it('clasifica los 6 casos como corresponde', () => {
    expect(filaDe(r, 'c-inca').sugerido).toBe('consorcio');
    expect(filaDe(r, 'c-chusaac').sugerido).toBe('consorcio');
    expect(filaDe(r, 'c-esper').sugerido).toBe('tercero');
    expect(filaDe(r, 'c-samaday').sugerido).toBe('tercero');
    expect(filaDe(r, 'c-jarvex').sugerido).toBe('propia');
    expect(filaDe(r, 'c-gasomi').sugerido).toBe('tercero');
  });

  it('el resumen cuenta exactamente 2 consorcios', () => {
    expect(r.resumen.consorcio).toBe(2);
    expect(r.resumen.total).toBe(6);
  });

  it('lo que cambia va primero, y dentro de eso lo que más contabilidad mueve', () => {
    // Sin tipo_entidad guardado todas parten de 'propia', así que cambian las 5
    // que no son propias; la de más movimientos (gasomi, 296) encabeza y la
    // única que NO cambia (JARVEX, propia) queda al final pese a sus 160 movs.
    expect(r.filas[0].company.id).toBe('c-gasomi');
    expect(r.filas.slice(0, 5).every(f => f.cambia)).toBe(true);
    expect(r.resumen.cambian).toBe(5);
    expect(r.filas[5].company.id).toBe('c-jarvex');
    expect(r.filas[5].cambia).toBe(false);
  });

  it('una company ya clasificada no figura como cambio', () => {
    const yaOk = revisarCatalogo({
      companies: [{ ...CATALOGO[0], tipo_entidad: 'consorcio' }], obras: OBRAS, movsPorCompany: MOVS,
    });
    expect(yaOk.filas[0].cambia).toBe(false);
  });

  it('ignora borrados y aguanta que no le pasen nada', () => {
    const conBorrada = revisarCatalogo({ companies: [...CATALOGO, { id: 'z', name: 'Z', deleted_at: 'x' }], obras: OBRAS });
    expect(conBorrada.resumen.total).toBe(6);
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
