import { describe, it, expect } from 'vitest';
import {
  detectFormato, parseFechaMigracion, parseInsumosTotales, parseInsumosEmergencia, parseMovimientos,
  parseMovMaquinariaAsignacion, clasificaTipoInsumo, normalizaTipoMov, resumenMovimientos, normTxt,
} from '../migracion-parser.js';

describe('parseFechaMigracion — fechas en formato US (raw:false) / serial / ISO', () => {
  it('M/D/YY US → ISO (el componente día > 12 confirma mes-primero)', () => {
    expect(parseFechaMigracion('5/25/26')).toBe('2026-05-25');
    expect(parseFechaMigracion('5/21/26')).toBe('2026-05-21');
    expect(parseFechaMigracion('12/3/2026')).toBe('2026-12-03');
  });
  it('serial Excel → ISO', () => {
    expect(parseFechaMigracion(46167)).toBe('2026-05-25');
    expect(parseFechaMigracion('46163')).toBe('2026-05-21');
  });
  it('ISO se respeta; vacío/inválido → null', () => {
    expect(parseFechaMigracion('2026-04-01')).toBe('2026-04-01');
    expect(parseFechaMigracion('')).toBeNull();
    expect(parseFechaMigracion(null)).toBeNull();
    expect(parseFechaMigracion('texto')).toBeNull();
  });
  it('D/M/Y cuando el primer componente > 12', () => {
    expect(parseFechaMigracion('25/5/26')).toBe('2026-05-25');
  });
});

describe('detectFormato — distingue los 5 formatos por headers', () => {
  it('insumos totales: retirado del flujo → ya no se detecta como formato', () => {
    expect(detectFormato(['ID', 'Nombre Insumo', 'Tipo', 'Unidad', 'Fecha de creacion'])).toBeNull();
  });
  it('movimientos materiales', () => {
    expect(detectFormato(['ID', 'Fecha de Movimiento', 'Material', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Almacen de Salida', 'Resposable (Salida)', 'Lugar llega / Frente'])).toBe('mov_materiales');
  });
  it('movimientos herramientas', () => {
    expect(detectFormato(['ID', 'Fecha de Movimiento', 'Herramientas', 'Estado', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsible', 'Lugar llega / Frente'])).toBe('mov_herramientas');
  });
  it('EPP vs Maquinaria: Unidad → epp, Estado → maquinaria (misma columna "EPP")', () => {
    expect(detectFormato(['ID', 'Fecha de Movimiento', 'EPP', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsable', 'Lugar de llegada'])).toBe('mov_epp');
    expect(detectFormato(['ID', 'Fecha de Movimiento', 'EPP', 'Estado', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsable', 'Lugar de llegada'])).toBe('mov_maquinaria');
  });
  it('headers desconocidos → null', () => {
    expect(detectFormato(['Col1', 'Col2'])).toBeNull();
  });
  it('insumos de emergencia: catálogo vs movimientos por header "emergencia"', () => {
    expect(detectFormato(['ID', 'Insumo de Emergencia', 'Categoría', 'Unidad', 'Fecha de creacion'])).toBe('insumos_emergencia');
    expect(detectFormato(['ID', 'Fecha de Movimiento', 'Insumo de Emergencia', 'Unidad', 'Cantidad', 'Tipo de Movimiento', 'Proveedor/Responsable', 'Lugar'])).toBe('mov_emergencia');
  });
  it('asignaciones de maquinaria: detecta por header "Asignado a"', () => {
    expect(detectFormato(['ID', 'Fecha', 'Equipo', 'Movimiento', 'Tipo destino', 'Asignado a', 'Observación'])).toBe('mov_maquinaria_asignacion');
  });
});

describe('parseMovMaquinariaAsignacion', () => {
  const rows = [
    { ID: '1', Fecha: '5/21/26', Equipo: 'Excavadora CAT 320', Movimiento: 'Salida', 'Tipo destino': 'Personal', 'Asignado a': 'Juan Pérez', 'Observación': 'Frente A' },
    { ID: '2', Fecha: '5/28/26', Equipo: 'Excavadora CAT 320', Movimiento: 'Devolución', 'Tipo destino': '', 'Asignado a': '', 'Observación': 'OK' },
    { ID: '3', Fecha: '5/22/26', Equipo: 'Rodillo', Movimiento: 'Salida', 'Tipo destino': 'Subcontratista', 'Asignado a': 'Construcciones SAC', 'Observación': '' },
  ];
  it('mapea salida con destino personal y devolución', () => {
    const p = parseMovMaquinariaAsignacion(rows);
    expect(p[0]).toMatchObject({ equipo: 'Excavadora CAT 320', tipo: 'salida', destinoTipo: 'personal', destinoNombre: 'Juan Pérez', fecha: '2026-05-21' });
    expect(p[1]).toMatchObject({ equipo: 'Excavadora CAT 320', tipo: 'entrada', fecha: '2026-05-28' });
  });
  it('reconoce destino subcontratista', () => {
    const p = parseMovMaquinariaAsignacion(rows);
    expect(p[2]).toMatchObject({ tipo: 'salida', destinoTipo: 'subcontratista', destinoNombre: 'Construcciones SAC' });
  });
});

describe('parseInsumosEmergencia', () => {
  it('mapea nombre/categoría/unidad/fecha (sin clasificar por tipo)', () => {
    const rows = [{ ID: '1', 'Insumo de Emergencia': 'Botiquín portátil', 'Categoría': 'Primeros auxilios', Unidad: 'kit', 'Fecha de creacion': '5/25/26' }];
    const out = parseInsumosEmergencia(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ nombre: 'Botiquín portátil', categoria: 'Primeros auxilios', unidad: 'kit', fechaCreacion: '2026-05-25' });
  });
  it('movimientos de emergencia: columna "Insumo de Emergencia" como item', () => {
    const rows = [{ ID: '1', 'Fecha de Movimiento': '5/21/26', 'Insumo de Emergencia': 'Extintor PQS 6kg', Unidad: 'Und', Cantidad: '4', 'Tipo de Movimiento': 'Ingreso', 'Proveedor/Responsable': 'Seguridad SAC', Lugar: 'Almacen' }];
    const p = parseMovimientos(rows, 'mov_emergencia');
    expect(p[0]).toMatchObject({ tipo: 'entrada', nombreItem: 'Extintor PQS 6kg', cantidad: 4 });
  });
});

describe('clasificaTipoInsumo / normalizaTipoMov', () => {
  it('clasifica a la tabla destino', () => {
    expect(clasificaTipoInsumo('Material')).toBe('materiales');
    expect(clasificaTipoInsumo('Herramienta')).toBe('herramientas');
    expect(clasificaTipoInsumo('Maquinaria')).toBe('activos_pesados');
    expect(clasificaTipoInsumo('EPP')).toBe('epps');
    expect(clasificaTipoInsumo('Otro raro')).toBeNull();
  });
  it('normaliza Ingreso/Salida', () => {
    expect(normalizaTipoMov('Ingreso')).toBe('entrada');
    expect(normalizaTipoMov('Salida')).toBe('salida');
    expect(normalizaTipoMov('')).toBeNull();
  });
  it('normaliza Traspaso y sus variantes (incl. "Transpaso" con n)', () => {
    expect(normalizaTipoMov('Traspaso')).toBe('traspaso');
    expect(normalizaTipoMov('TRANSPASO')).toBe('traspaso');
    expect(normalizaTipoMov('Transferencia')).toBe('traspaso');
    expect(normalizaTipoMov('Traslado')).toBe('traspaso');
    // "Transporte" NO es traspaso: debe fallar visible como tipo no reconocido.
    expect(normalizaTipoMov('Transporte')).toBeNull();
  });
});

describe('parseMovimientos — formato real con Almacen de Salida/Llegada', () => {
  const H = (o) => ({
    'Fecha de Movimiento': '5/15/26', Material: 'Lubricante PVC', Unidad: 'unidad', Cantidad: '49',
    'Tipo de Movimiento': '', Proveedor: '', 'Almacen de Salida': '', 'Resposable (Salida)': '',
    'Almacen de Llegada': '', Frente: '', Observaciones: '', ...o,
  });
  it('TRANSPASO: almacen=origen, almacenDestino=llegada', () => {
    const p = parseMovimientos([H({ 'Tipo de Movimiento': 'TRANSPASO', 'Almacen de Salida': 'Zona Juan Carlos', 'Almacen de Llegada': 'Almacen Central' })], 'mov_materiales');
    expect(p[0]).toMatchObject({ tipo: 'traspaso', almacen: 'Zona Juan Carlos', almacenDestino: 'Almacen Central' });
  });
  it('INGRESO: la llegada queda en almacenDestino (almacen/lugar vacíos)', () => {
    const p = parseMovimientos([H({ 'Tipo de Movimiento': 'INGRESO', Proveedor: 'Koplast', 'Almacen de Llegada': 'Zona Juan Carlos' })], 'mov_materiales');
    expect(p[0]).toMatchObject({ tipo: 'entrada', almacen: null, almacenDestino: 'Zona Juan Carlos' });
  });
  it('SALIDA: almacen=origen, responsable con el header con typo', () => {
    const p = parseMovimientos([H({ 'Tipo de Movimiento': 'SALIDA', Cantidad: '1', 'Almacen de Salida': 'Almacen Central', 'Resposable (Salida)': 'Ing Elvis' })], 'mov_materiales');
    expect(p[0]).toMatchObject({ tipo: 'salida', almacen: 'Almacen Central', responsable: 'Ing Elvis' });
  });
});

describe('parseInsumosTotales', () => {
  it('mapea nombre/tipo/unidad/fecha', () => {
    const rows = [{ ID: '1', 'Nombre Insumo': 'Cemento Tipo I', Tipo: 'Material', Unidad: 'bolsa', 'Fecha de creacion': '5/25/26' }];
    const out = parseInsumosTotales(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ nombre: 'Cemento Tipo I', tipo: 'materiales', unidad: 'bolsa', fechaCreacion: '2026-05-25' });
  });
  it('ignora filas sin nombre', () => {
    expect(parseInsumosTotales([{ ID: '2', 'Nombre Insumo': '' }])).toHaveLength(0);
  });
});

describe('parseMovimientos — no engancha la columna ID en "salida"/"unidad"', () => {
  const rows = [
    { ID: '1', 'Fecha de Movimiento': '5/21/26', Material: 'Yeso 7kg', Unidad: 'Bolsa', Cantidad: '20', 'Tipo de Movimiento': 'Ingreso', 'Proveedor/Almacen de Salida': null, 'Resposable (Salida)': null, 'Lugar llega / Frente': 'Almacen Central' },
    { ID: '2', 'Fecha de Movimiento': '5/22/26', Material: 'Yeso 7kg', Unidad: 'Bolsa', Cantidad: '3', 'Tipo de Movimiento': 'Salida', 'Proveedor/Almacen de Salida': 'Almacen Central', 'Resposable (Salida)': 'Ing Elvis', 'Lugar llega / Frente': 'Frente Elvis' },
  ];
  it('ingreso: origen/responsable vacíos (no "1" de la columna ID)', () => {
    const p = parseMovimientos(rows, 'mov_materiales');
    expect(p[0]).toMatchObject({ tipo: 'entrada', nombreItem: 'Yeso 7kg', cantidad: 20, unidad: 'Bolsa', origen: null, responsable: null, lugar: 'Almacen Central' });
  });
  it('salida: origen=almacén, responsable=persona, lugar=frente', () => {
    const p = parseMovimientos(rows, 'mov_materiales');
    expect(p[1]).toMatchObject({ tipo: 'salida', cantidad: 3, origen: 'Almacen Central', responsable: 'Ing Elvis', lugar: 'Frente Elvis' });
  });
  it('resumen cuenta entradas/salidas/items', () => {
    const r = resumenMovimientos(parseMovimientos(rows, 'mov_materiales'));
    expect(r).toMatchObject({ total: 2, entradas: 1, salidas: 1, itemsUnicos: 1, sinTipo: 0, sinFecha: 0, sinCantidad: 0 });
  });
});

describe('normTxt — normaliza acentos y símbolos', () => {
  it('quita acentos, espacios y símbolos', () => {
    expect(normTxt('Fecha de creación')).toBe('fechadecreacion');
    expect(normTxt('Proveedor/Responsable')).toBe('proveedorresponsable');
  });
});
