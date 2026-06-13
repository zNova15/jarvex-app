import { describe, it, expect } from 'vitest';
import {
  detectFormato, parseFechaMigracion, parseInsumosTotales, parseInsumosEmergencia, parseMovimientos,
  parseMovMaquinariaAsignacion, clasificaTipoInsumo, normalizaTipoMov, resumenMovimientos, normTxt, clasificarMovsHerramientas,
  parseCajaChica, parseAsistencia, parseHorasMaquina, parseCombustible, normalizaHora,
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
  it('conserva tipoRaw; "Asignación" deriva salida y un movimiento no reconocido queda tipo null', () => {
    const p = parseMovMaquinariaAsignacion(rows);
    expect(p[0]).toMatchObject({ tipo: 'salida', tipoRaw: 'Salida' });
    expect(p[1]).toMatchObject({ tipo: 'entrada', tipoRaw: 'Devolución' });
    const x = parseMovMaquinariaAsignacion([
      { ID: '9', Fecha: '5/21/26', Equipo: 'Grúa', Movimiento: 'Asignación', 'Tipo destino': 'Personal', 'Asignado a': 'Pedro', 'Observación': '' },
      { ID: '10', Fecha: '5/21/26', Equipo: 'Grúa', Movimiento: 'Préstamo', 'Tipo destino': '', 'Asignado a': '', 'Observación': '' },
    ]);
    expect(x[0]).toMatchObject({ tipo: 'salida', tipoRaw: 'Asignación' });
    expect(x[1]).toMatchObject({ tipo: null, tipoRaw: 'Préstamo' });
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

describe('datasets re-importables (round-trip del export)', () => {
  it('detectFormato reconoce los headers exactos del export', () => {
    expect(detectFormato(['ID', 'Fecha', 'Hora', 'Tipo', 'Monto (S/)', 'Concepto', 'Responsable', 'Proveedor', 'Documento', 'Observaciones'])).toBe('caja_chica');
    expect(detectFormato(['Fecha', 'Trabajador', 'Hora Ingreso', 'Hora Salida', 'Horas', 'Estado', 'Observaciones'])).toBe('asistencia');
    expect(detectFormato(['ID', 'Fecha', 'Equipo', 'Tipo', 'HM Actuales', 'Descripción', 'Costo Repuestos (S/)', 'Costo Mano de Obra (S/)', 'Costo Total (S/)', 'Taller', 'Mecánico', 'Duración (h)', 'Observaciones'])).toBe('mantenimientos');
    expect(detectFormato(['ID', 'Fecha', 'Equipo', 'Horas Trabajadas', 'HM Inicial', 'HM Final', 'Operador', 'Actividad', 'Observaciones'])).toBe('horas_maquina');
    expect(detectFormato(['ID', 'Fecha', 'Equipo', 'Galones', 'Precio/Galón (S/)', 'Total (S/)', 'Surtidor', 'Operador', 'HM Actuales', 'Observaciones'])).toBe('combustible');
    // y NO confunde los formatos de movimientos existentes
    expect(detectFormato(['ID', 'Fecha de Movimiento', 'Material', 'Unidad', 'Cantidad', 'Tipo de Movimiento'])).toBe('mov_materiales');
  });
  it('headers cortos NO roban hojas ajenas a los datasets (match estricto header ⊇ needle)', () => {
    // Regresión: con el match bidireccional, 'Hora' (⊆ 'horas trabajadas') robaba
    // Equipo+Hora a horas_maquina, e 'ID'/'Hora' (⊆ 'hora sal-id-a') fingían asistencia.
    expect(detectFormato(['ID', 'Fecha', 'Hora', 'Equipo', 'Movimiento', 'Destino', 'Observación'])).not.toBe('horas_maquina');
    expect(detectFormato(['ID', 'Trabajador', 'Fecha', 'Estado'])).toBeNull();
    expect(detectFormato(['Fecha', 'Trabajador', 'Hora', 'Estado'])).toBeNull();
    expect(detectFormato(['N°', '#', 'Fecha', 'Detalle'])).toBeNull();
  });
  it('hoja Personal del export: "Contacto/Telefono Emergencia" NO la manda a emergencia', () => {
    // Regresión: el gate de emergencia se comía el roster (Contacto Emergencia)
    // y detectaba 'insumos_emergencia' → la hoja Personal nunca aparecía en el
    // picker de multiHojas ni llegaba a su flujo.
    const exportPersonal = ['Nombres', 'Apellidos', 'Alias', 'Tipo Documento', 'DNI', 'Cargo', 'Area', 'Frente', 'Estado', 'Vínculo', 'Subcontrato', 'Jefe Subcontrato', 'Seguro a cargo', 'Fecha Ingreso', 'Fecha Nacimiento', 'Telefono', 'Email', 'Direccion', 'Contacto Emergencia', 'Telefono Emergencia', 'Regimen Pension', 'Banco', 'Tipo Cuenta', 'Numero Cuenta', 'CCI', 'Moneda', 'Banco CTS', 'Cuenta CTS'];
    expect(detectFormato(exportPersonal)).toBe('personal');
    // y los archivos de emergencia de verdad siguen cayendo en su flujo
    expect(detectFormato(['ID', 'Insumo de Emergencia', 'Categoría', 'Unidad', 'Fecha de creacion'])).toBe('insumos_emergencia');
  });
  it('headers degenerados ("N°"→"n", "#"→"") NO disparan datasets por substring', () => {
    // Regresión: 'galones'.includes('n') / .includes('') matcheaba cualquier
    // hoja ajena como combustible (o caja_chica) e inflaba errores en restore.
    expect(detectFormato(['N°', 'Fecha', 'Detalle'])).toBeNull();
    expect(detectFormato(['#', 'Item', 'Total'])).toBeNull();
    expect(detectFormato(['N°', 'Fecha', 'Descripción', 'Importe'])).toBeNull();
  });
  it('parseCajaChica: Ingreso/Gasto, monto y fila vacía', () => {
    const rows = [
      { ID: '1', Fecha: '2026-05-11', Hora: '08:30', Tipo: 'Ingreso', 'Monto (S/)': '200', Concepto: 'Ingreso 1 Caja', Responsable: 'A OBRA', Proveedor: '', Documento: '', Observaciones: '' },
      { ID: '2', Fecha: '2026-05-14', Hora: '', Tipo: 'Gasto', 'Monto (S/)': '12.5', Concepto: 'Compra urgente', Responsable: '', Proveedor: 'EL FUTURO', Documento: 'FA01-15', Observaciones: '' },
      { ID: '', Fecha: '', Hora: '', Tipo: '', 'Monto (S/)': '', Concepto: '', Responsable: '', Proveedor: '', Documento: '', Observaciones: '' },
    ];
    const p = parseCajaChica(rows);
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({ tipo: 'entrada', monto: 200, hora: '08:30', responsable: 'A OBRA' });
    expect(p[1]).toMatchObject({ tipo: 'salida', monto: 12.5, proveedor: 'EL FUTURO', documento: 'FA01-15' });
  });
  it('normalizaHora: HH:MM, AM/PM y serial Excel', () => {
    expect(normalizaHora('08:30')).toBe('08:30');
    expect(normalizaHora('7:05:00')).toBe('07:05');
    expect(normalizaHora('1:30 pm')).toBe('13:30');
    expect(normalizaHora(0.5)).toBe('12:00');
    expect(normalizaHora('no-hora')).toBeNull();
  });
  it('parseAsistencia normaliza estados al CHECK del server', () => {
    const rows = [
      { Fecha: '2026-06-02', Trabajador: 'Carlos Mendoza', 'Hora Ingreso': '07:30', 'Hora Salida': '17:30', Horas: '9', Estado: 'Asistió', Observaciones: '' },
      { Fecha: '2026-06-03', Trabajador: 'Carlos Mendoza', 'Hora Ingreso': '', 'Hora Salida': '', Horas: '', Estado: 'FALTA', Observaciones: '' },
    ];
    const p = parseAsistencia(rows);
    expect(p[0]).toMatchObject({ estado: 'asistio', horaIngreso: '07:30', horas: 9 });
    expect(p[1]).toMatchObject({ estado: 'falta' });
  });
  it('parseCombustible y parseHorasMaquina leen los headers del export', () => {
    const c = parseCombustible([{ ID: '1', Fecha: '2026-05-15', Equipo: 'Excavadora CAT', Galones: '15', 'Precio/Galón (S/)': '16.5', 'Total (S/)': '247.5', Surtidor: 'Grifo', Operador: 'Juan Silva', 'HM Actuales': '1250', Observaciones: '' }]);
    expect(c[0]).toMatchObject({ equipo: 'Excavadora CAT', galones: 15, precioGalon: 16.5, total: 247.5 });
    const h = parseHorasMaquina([{ ID: '1', Fecha: '2026-05-15', Equipo: 'Excavadora CAT', 'Horas Trabajadas': '8', 'HM Inicial': '1242', 'HM Final': '1250', Operador: 'Juan Silva', Actividad: 'Zanja', Observaciones: '' }]);
    expect(h[0]).toMatchObject({ horas: 8, hmInicial: 1242, hmFinal: 1250, actividad: 'Zanja' });
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
  it('tipo no reconocido: tipo=null pero tipoRaw conserva la celda cruda (Transporte NO cae a traspaso)', () => {
    const p = parseMovimientos([H({ 'Tipo de Movimiento': 'TRANSPORTE' })], 'mov_materiales');
    expect(p[0]).toMatchObject({ tipo: null, tipoRaw: 'TRANSPORTE' });
  });
});

describe('resumenMovimientos.filasProblema — detalle pre-import del panel rojo', () => {
  const fila = (o) => ({ 'Fecha de Movimiento': '5/15/26', Material: 'Yeso 7kg', Unidad: 'Bolsa', Cantidad: '5', 'Tipo de Movimiento': 'Ingreso', ...o });
  const resumen = (...filas) => resumenMovimientos(parseMovimientos(filas, 'mov_materiales'));
  it('fila sin tipo Y sin cantidad → ambos contadores suben pero UNA sola entrada (la de tipo)', () => {
    const r = resumen(fila({ 'Tipo de Movimiento': 'TRANSPORTE', Cantidad: '' }));
    expect(r).toMatchObject({ sinTipo: 1, sinCantidad: 1 });
    expect(r.filasProblema).toHaveLength(1);
    expect(r.filasProblema[0]).toMatchObject({ idx: 2, item: 'Yeso 7kg', problema: 'Tipo "TRANSPORTE" no reconocido', sugerencia: 'Usá Ingreso, Salida o Traspaso' });
  });
  it('celda Tipo vacía → "Sin tipo de movimiento" (sin texto crudo en el aviso)', () => {
    const r = resumen(fila({ 'Tipo de Movimiento': '' }));
    expect(r.filasProblema).toHaveLength(1);
    expect(r.filasProblema[0].problema).toBe('Sin tipo de movimiento');
  });
  it('fila con tipo válido y Cantidad "0" → 1 entrada de cantidad inválida', () => {
    const r = resumen(fila({ Cantidad: '0' }));
    expect(r.filasProblema).toHaveLength(1);
    expect(r.filasProblema[0]).toMatchObject({ idx: 2, item: 'Yeso 7kg', problema: 'Cantidad inválida (0)', sugerencia: 'Poné una cantidad mayor a 0' });
  });
  it('fila sana → filasProblema vacío', () => {
    expect(resumen(fila()).filasProblema).toEqual([]);
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

describe('normalizaTipoMov — devolución (solo herramientas)', () => {
  it('reconoce Devolución/DEVOLUCION/Devuelto con el flag conDevolucion', () => {
    expect(normalizaTipoMov('Devolución', true)).toBe('devolucion');
    expect(normalizaTipoMov('DEVOLUCION', true)).toBe('devolucion');
    expect(normalizaTipoMov('Devuelto', true)).toBe('devolucion');
  });
  it('sin el flag (otros formatos) sigue cayendo a null → error visible', () => {
    expect(normalizaTipoMov('Devolución')).toBeNull();
    expect(normalizaTipoMov('DEVOLUCION', false)).toBeNull();
  });
});

describe('clasificarMovsHerramientas — ingreso vs devolución', () => {
  const fila = (idx, tipo, item, cantidad, extra = {}) => ({
    idx, tipo, nombreItem: item, cantidad, fecha: extra.fecha || '2026-01-10',
    proveedor: extra.proveedor || null, origen: extra.origen || null,
    responsable: extra.responsable || null, subcontrato: extra.subcontrato || null,
    ...extra,
  });

  it('ingreso repetido SIN salida previa NO es devolución (caso PICOS MACHOS)', () => {
    // 2 ingresos al mismo almacén, ninguna salida en medio → ambos son ingreso.
    const r = clasificarMovsHerramientas([
      fila(2, 'entrada', 'Picos Machos', 5, { fecha: '2026-05-14', proveedor: 'Gasomi' }),
      fila(3, 'entrada', 'Picos Machos', 2, { fecha: '2026-05-15', proveedor: 'Gasomi' }),
    ]);
    expect(r.movs[0].tipo).toBe('entrada');
    expect(r.movs[1].tipo).toBe('entrada');
    expect(r.sugerencias).toHaveLength(0); // no hay nada afuera → ni se sugiere
  });

  it('ingreso con salida previa → SUGERENCIA de devolución, no auto-aplicada', () => {
    const r = clasificarMovsHerramientas([
      fila(2, 'entrada', 'Taladro', 1, { fecha: '2026-01-01' }),
      fila(3, 'salida', 'Taladro', 1, { fecha: '2026-01-05', responsable: 'Juan Perez' }),
      fila(4, 'entrada', 'Taladro', 1, { fecha: '2026-01-08', proveedor: 'Juan Perez' }),
    ]);
    expect(r.movs[2].tipo).toBe('entrada'); // por defecto NO se reclasifica
    expect(r.sugerencias).toHaveLength(1);
    expect(r.sugerencias[0].idx).toBe(4);
    expect(r.sugerencias[0].afuera).toBe(1);
    expect(r.sugerencias[0].aceptada).toBe(false);
  });

  it('aceptar la sugerencia (decisiones) la reclasifica a devolución', () => {
    const movs = [
      fila(2, 'entrada', 'Taladro', 1, { fecha: '2026-01-01' }),
      fila(3, 'salida', 'Taladro', 1, { fecha: '2026-01-05', responsable: 'Juan Perez' }),
      fila(4, 'entrada', 'Taladro', 1, { fecha: '2026-01-08', proveedor: 'Juan Perez' }),
    ];
    const r = clasificarMovsHerramientas(movs, { decisiones: { 4: 'devolucion' } });
    expect(r.movs[2].tipo).toBe('devolucion');
    expect(r.movs[2].tipoOriginal).toBe('entrada');
    expect(r.reclasificadas).toHaveLength(1);
    expect(r.excepciones).toHaveLength(0); // devuelve el mismo que sacó
  });

  it('historial con stock afuera → el ingreso se SUGIERE (no se fuerza)', () => {
    const k = normTxt('Pistola de Calor');
    const r = clasificarMovsHerramientas(
      [fila(2, 'entrada', 'Pistola de Calor', 1, { proveedor: 'Elvis Huatay' })],
      { historialPorItem: { [k]: { tuvoIngreso: true, afuera: 1, saldos: { 'p:u1': 1 }, nombres: { 'p:u1': 'Gabriela' } } } }
    );
    expect(r.movs[0].tipo).toBe('entrada');
    expect(r.sugerencias).toHaveLength(1);
  });

  it('historial CON ingreso pero SIN stock afuera → ingreso simple (sin sugerencia)', () => {
    const k = normTxt('Comba');
    const r = clasificarMovsHerramientas(
      [fila(2, 'entrada', 'Comba', 1, { proveedor: 'Gasomi' })],
      { historialPorItem: { [k]: { tuvoIngreso: true, afuera: 0, saldos: {}, nombres: {} } } }
    );
    expect(r.movs[0].tipo).toBe('entrada');
    expect(r.sugerencias).toHaveLength(0);
  });

  it('devolución explícita sin ingreso ni stock previo → primer ingreso (huérfana)', () => {
    const r = clasificarMovsHerramientas([
      fila(2, 'devolucion', 'Amoladora', 1, { proveedor: 'Elvis Huatay' }),
    ]);
    expect(r.movs[0].tipo).toBe('entrada');
    expect(r.movs[0].tipoOriginal).toBe('devolucion');
    expect(r.huerfanas).toHaveLength(1);
  });

  it('devolución explícita con quien devuelve ≠ quien sacó → excepción con el detalle', () => {
    const r = clasificarMovsHerramientas([
      fila(2, 'entrada', 'Taladro', 2, { fecha: '2026-01-01' }),
      fila(3, 'salida', 'Taladro', 2, { fecha: '2026-01-05', responsable: 'Juan Perez' }),
      fila(4, 'devolucion', 'Taladro', 2, { fecha: '2026-01-08', proveedor: 'Pedro Gomez' }),
    ]);
    expect(r.movs[2].tipo).toBe('devolucion'); // explícita, se respeta
    expect(r.excepciones).toHaveLength(1);
    expect(r.excepciones[0].devuelve).toBe('Pedro Gomez');
    expect(r.excepciones[0].saldoDevolvedor).toBe(0);
    expect(r.excepciones[0].conSaldo).toEqual([{ nombre: 'Juan Perez', cantidad: 2 }]);
  });

  it('mismo día: la salida se procesa antes que la devolución (sin falsa excepción)', () => {
    const r = clasificarMovsHerramientas([
      fila(2, 'entrada', 'Taladro', 1, { fecha: '2026-01-01' }),
      fila(4, 'devolucion', 'Taladro', 1, { fecha: '2026-01-05', proveedor: 'Juan Perez' }),
      fila(3, 'salida', 'Taladro', 1, { fecha: '2026-01-05', responsable: 'Juan Perez' }),
    ]);
    expect(r.excepciones).toHaveLength(0);
  });

  it('los traspasos no cuentan como salida ni generan sugerencias', () => {
    const r = clasificarMovsHerramientas([
      fila(2, 'entrada', 'Taladro', 1, { fecha: '2026-01-01' }),
      fila(3, 'traspaso', 'Taladro', 1, { fecha: '2026-01-02' }),
      fila(4, 'entrada', 'Taladro', 1, { fecha: '2026-01-03' }),
    ]);
    expect(r.movs[2].tipo).toBe('entrada'); // el traspaso no dejó nada afuera
    expect(r.sugerencias).toHaveLength(0);
  });
});
