import { describe, it, expect } from 'vitest';
import {
  SERVICIOS_CODIGOS, SERVICIO_POR_CODIGO, esCodigoServicio, DICCIONARIO_SERVICIOS,
} from '../clasificacion-servicios.js';
import {
  clasificarConIUPC, listarCategoriasDisponibles, etiquetaCategoria,
  tipoDeCategoria, gastoDeCategoria, terminosDeClasificacion,
  esCodigoOficial, codigoSugerido, validarClasificacion,
} from '../indices-unificados-iupc.js';

describe('el árbol de servicios', () => {
  it('tiene las 13 clasificaciones acordadas y todas con destino de gasto', () => {
    expect(SERVICIOS_CODIGOS).toHaveLength(13);
    expect(SERVICIOS_CODIGOS.every(s => /^S\d{2}$/.test(s.codigo))).toBe(true);
    expect(SERVICIOS_CODIGOS.every(s => s.nombre && s.gasto)).toBe(true);
    expect(esCodigoServicio('S05')).toBe(true);
    expect(esCodigoServicio('05')).toBe(false);
  });

  it('todo término del diccionario apunta a una clasificación que existe', () => {
    const huerfanos = DICCIONARIO_SERVICIOS.filter(t => !SERVICIO_POR_CODIGO.has(t.cod));
    expect(huerfanos.map(t => `${t.nombre} → ${t.cod}`)).toEqual([]);
  });

  it('los servicios de obra son costo y los de estructura, gasto general', () => {
    expect(gastoDeCategoria('S02')).toBe('servicios');        // alquiler de maquinaria
    expect(gastoDeCategoria('S09')).toBe('servicios');        // subcontrato de obra
    expect(gastoDeCategoria('S11')).toBe('gastos_generales'); // alimentación
    expect(gastoDeCategoria('S13')).toBe('gastos_generales'); // servicios básicos
    // Y ninguno va a una tabla de inventario.
    expect(SERVICIOS_CODIGOS.every(s => tipoDeCategoria(s.codigo) === 'servicio')).toBe(true);
  });

  it('los dos árboles conviven en el desplegable, separados por grupo', () => {
    const cats = listarCategoriasDisponibles();
    const arboles = new Set(cats.map(c => c.arbol));
    expect(arboles.has('insumo')).toBe(true);
    expect(arboles.has('servicio')).toBe(true);
    expect(cats.filter(c => c.arbol === 'servicio')).toHaveLength(13);
    expect(cats.every(c => c.label && c.grupo)).toBe(true);
  });
});

describe('clasificar contra los dos árboles', () => {
  // Los diez casos salen del catálogo REAL del grupo (35 servicios, medidos el
  // 13-set). Antes caían todos en el mismo cajón «Servicios en general».
  const CASOS = [
    ['ALQUILER DE ALMACEN', 'S01'],
    ['ALQUILER DE RETROEXCAVADORA ORUGA', 'S02'],
    ['TRANSPORTE DE RESIDUOS DE OBRA DURANTE LA EJECUCION', 'S03'],
    ['CAPACITACION: COMO ACTUAR EN CASO DE SISMOS', 'S04'],
    ['MONITOREO DE CALIDAD DE AGUA', 'S05'],
    ['EXAMENES MEDICOS OCUPACIONALES', 'S06'],
    ['SC LICENCIADO ARQUEOLOGO', 'S07'],
    ['MANTENIMIENTO DE CAMIONETAS', 'S08'],
    ['INSTALACION DE DE ESTRUCTURA METALICA', 'S09'],
    ['CHOFER', 'S10'],
    ['ALIMENTACIÓN PARA PERSONAL TECNICO Y ADMINISTRATIVO', 'S11'],
    ['PUBLICACIONES', 'S12'],
  ];

  it.each(CASOS)('«%s» cae en %s', (texto, esperado) => {
    const r = clasificarConIUPC(texto);
    expect(r.codigo).toBe(esperado);
    expect(r.banda).toBe('alta');
  });

  it('un material NO se va al árbol de servicios', () => {
    for (const t of ['CEMENTO PORTLAND TIPO I 42.5 KG', 'GUANTES DE SEGURIDAD BADANA',
      'TUBERIA PVC-U 160MM PARA INSTALACION DE ALCANTARILLADO']) {
      expect(esCodigoServicio(clasificarConIUPC(t).codigo), t).toBe(false);
    }
  });

  it('un servicio sin precisar admite que no sabe cuál es', () => {
    // «servicio» y «alquiler» los dice TODO el árbol: si contaran como
    // evidencia, «SERVICIO DE ALGO RARO» pegaba con «Servicio técnico» al 80%
    // y salía como Mantenimiento.
    const r = clasificarConIUPC('SERVICIO DE ALGO NO ESPECIFICADO');
    expect(r.codigo).toBe('servicios');
    expect(r.banda).not.toBe('alta');
  });
});

describe('el diccionario de cada clasificación', () => {
  it('junta la base del bundle con lo que se agregó a mano', () => {
    const custom = [{ id: 't1', termino: 'Cemento cabezón', norm: 'cemento cabezon', clasificacion_codigo: '21' }];
    const d = terminosDeClasificacion('21', custom);
    expect(d.some(t => t.origen === 'inei')).toBe(true);
    expect(d.some(t => t.origen === 'manual' && t.termino === 'Cemento cabezón')).toBe(true);
    // El de servicios trae su propia base.
    expect(terminosDeClasificacion('S05').every(t => t.origen === 'base')).toBe(true);
  });

  it('un término borrado no aparece', () => {
    const custom = [{ id: 't1', termino: 'X', norm: 'x', clasificacion_codigo: '21', deleted_at: '2026-09-13' }];
    expect(terminosDeClasificacion('21', custom).some(t => t.origen === 'manual')).toBe(false);
  });

  it('el término propio le GANA a la base oficial', () => {
    // Es una corrección deliberada sobre la norma: si alguien se tomó el
    // trabajo de decirlo, no la puede pisar una heurística.
    const custom = [{ id: 't1', termino: 'Cemento cabezón', norm: 'cemento cabezon', clasificacion_codigo: '21' }];
    expect(clasificarConIUPC('CEMENTO CABEZON').codigo).not.toBe('21');
    const r = clasificarConIUPC('CEMENTO CABEZON', { terminosCustom: custom });
    expect(r.codigo).toBe('21');
    expect(r.score).toBeGreaterThan(0.9);
  });

  it('un término propio puede apuntar a una clasificación propia', () => {
    const custom = [{ id: 't2', termino: 'Geomalla triaxial', norm: 'geomalla triaxial', clasificacion_codigo: 'PI-GEO' }];
    expect(clasificarConIUPC('GEOMALLA TRIAXIAL TX160', { terminosCustom: custom }).codigo).toBe('PI-GEO');
  });
});

describe('crear una clasificación propia', () => {
  it('propone un código con prefijo según el árbol', () => {
    expect(codigoSugerido('Geosintéticos y geomallas', 'insumo')).toMatch(/^PI-/);
    expect(codigoSugerido('Buceo industrial', 'servicio')).toMatch(/^PS-/);
  });

  it('NO deja pisar el espacio de la base oficial', () => {
    // Si un código propio pisara uno oficial, una fila del catálogo apuntaría
    // a dos clasificaciones distintas según qué capa gane al resolver.
    expect(esCodigoOficial('21')).toBe(true);
    expect(esCodigoOficial('S05')).toBe(true);
    expect(esCodigoOficial('servicios')).toBe(true);
    expect(esCodigoOficial('PI-GEO')).toBe(false);
    expect(validarClasificacion({ codigo: '21', nombre: 'Mía' }, [])).toMatch(/base oficial/);
    expect(validarClasificacion({ codigo: 'S05', nombre: 'Mía' }, [])).toMatch(/base oficial/);
  });

  it('pide nombre, código, y sin espacios ni duplicados', () => {
    expect(validarClasificacion({ codigo: 'PI-X', nombre: '' }, [])).toMatch(/nombre/i);
    expect(validarClasificacion({ codigo: '', nombre: 'X' }, [])).toMatch(/código/i);
    expect(validarClasificacion({ codigo: 'A B', nombre: 'X' }, [])).toMatch(/espacios/i);
    expect(validarClasificacion({ codigo: 'PI-X', nombre: 'X' }, [{ codigo: 'PI-X' }])).toMatch(/Ya existe/);
    expect(validarClasificacion({ codigo: 'PI-GEO', nombre: 'Geosintéticos' }, [])).toBeNull();
  });

  it('la clasificación propia entra al desplegable, marcada como tuya', () => {
    const propias = [{ id: 'c1', codigo: 'PS-BUZO', nombre: 'Buceo industrial', arbol: 'servicio', activo: true }];
    const cats = listarCategoriasDisponibles(propias);
    const mia = cats.find(c => c.codigo === 'PS-BUZO');
    expect(mia).toBeDefined();
    expect(mia.propia).toBe(true);
    expect(mia.arbol).toBe('servicio');
    expect(etiquetaCategoria('PS-BUZO')).toBe('PS-BUZO'); // sin fila, devuelve el código crudo
  });

  it('una clasificación desactivada o borrada no se ofrece', () => {
    const propias = [
      { id: 'c1', codigo: 'PI-A', nombre: 'A', arbol: 'insumo', activo: false },
      { id: 'c2', codigo: 'PI-B', nombre: 'B', arbol: 'insumo', activo: true, deleted_at: '2026-09-13' },
    ];
    const cods = listarCategoriasDisponibles(propias).map(c => c.codigo);
    expect(cods).not.toContain('PI-A');
    expect(cods).not.toContain('PI-B');
  });
});
