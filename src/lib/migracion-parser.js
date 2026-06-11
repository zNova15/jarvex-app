// ═══════════════════════════════════════════════════════════════════
// JARVEX — Parser de migración histórica (SuperAdmin)
//
// La obra arrancó antes de tener JARVEX, así que meses de movimientos
// quedaron en Excel. Este módulo parsea los 5 formatos de migración y los
// normaliza a estructuras simples; la creación en Dexie + el resolver de
// items/ubicaciones/responsables vive en jx-migracion-import.jsx.
//
// Formatos (headers verbatim, leídos de ~/Downloads):
//   insumos_totales : ID · Nombre Insumo · Tipo · Unidad · Fecha de creacion
//   mov_materiales  : ID · Fecha de Movimiento · Material · Unidad · Cantidad
//                     · Tipo de Movimiento · Proveedor/Almacen de Salida
//                     · Resposable (Salida) · Lugar llega / Frente
//   mov_herramientas: ID · Fecha · Herramientas · Estado · Cantidad · Tipo
//                     · Proveedor/Responsible · Lugar llega / Frente
//   mov_epp         : ID · Fecha · EPP · Unidad · Cantidad · Tipo
//                     · Proveedor/Responsable · Lugar de llegada
//   mov_maquinaria  : ID · Fecha · EPP(*) · Estado · Cantidad · Tipo
//                     · Proveedor/Responsable · Lugar de llegada
//   (*) la columna del nombre viene mal rotulada "EPP" en el formato real.
//
// Todo es PURO (sin DOM ni Dexie) para que sea testeable.
// ═══════════════════════════════════════════════════════════════════

/** Normaliza un texto para comparar headers/nombres (sin acentos ni símbolos). */
export const normTxt = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Metadatos de los formatos: id, etiqueta y descripción para la UI.
 * "Insumos Totales" quedó retirado: ahora el catálogo se completa solo al
 * cargar movimientos (con paso de revisión de items en el wizard). */
export const FORMATOS = {
  mov_materiales:  { id: 'mov_materiales', label: 'Movimientos de Materiales', icon: 'package',
    desc: 'Ingresos y salidas de materiales con fecha histórica.' },
  mov_herramientas:{ id: 'mov_herramientas', label: 'Movimientos de Herramientas', icon: 'tool',
    desc: 'Ingresos y salidas de herramientas con cantidad.' },
  mov_epp:         { id: 'mov_epp', label: 'Movimientos de EPP', icon: 'shield',
    desc: 'Entregas y reposiciones de EPP con fecha histórica.' },
  mov_maquinaria:  { id: 'mov_maquinaria', label: 'Movimientos de Maquinaria', icon: 'tool',
    desc: 'Ingresos y salidas de equipos pesados / maquinaria menor.' },
  insumos_emergencia: { id: 'insumos_emergencia', label: 'Insumos de Emergencia (catálogo)', icon: 'package',
    desc: 'Crea el inventario de insumos de emergencia (SSOMA). Sin stock ni movimientos.' },
  mov_emergencia:  { id: 'mov_emergencia', label: 'Movimientos de Insumos de Emergencia', icon: 'shield',
    desc: 'Ingresos y salidas de insumos de emergencia con fecha histórica.' },
  mov_maquinaria_asignacion: { id: 'mov_maquinaria_asignacion', label: 'Asignaciones de Maquinaria (custodia)', icon: 'tool',
    desc: 'Salidas (asignación a personal/subcontrato) y devoluciones de equipos pesados, con fecha.' },
  personal: { id: 'personal', label: 'Personal (datos + cuentas bancarias)', icon: 'users',
    desc: 'Roster de trabajadores: datos personales, contacto y cuentas bancarias. Crea o actualiza por DNI; las cuentas van a Cuentas Bancarias → Personal.' },
  // ── Datasets re-importables del export histórico (round-trip completo) ──
  caja_chica: { id: 'caja_chica', label: 'Caja Chica', icon: 'dollar',
    desc: 'Ingresos (fondo) y gastos de caja chica con fecha histórica. Re-importa el Excel exportado desde Exportar → Caja Chica sin duplicar.' },
  asistencia: { id: 'asistencia', label: 'Asistencia', icon: 'calendar',
    desc: 'Asistencia diaria por trabajador. El trabajador debe existir en Personal (importá el roster primero). Una fila por persona y día; no duplica.' },
  mantenimientos: { id: 'mantenimientos', label: 'Mantenimientos de Maquinaria', icon: 'tool',
    desc: 'Mantenimientos preventivos/correctivos con costos. El equipo debe existir en Equipos Pesados.' },
  horas_maquina: { id: 'horas_maquina', label: 'Horas Máquina', icon: 'tool',
    desc: 'Partes diarios de horas trabajadas por equipo (horómetro inicial/final, operador).' },
  combustible: { id: 'combustible', label: 'Consumos de Combustible', icon: 'tool',
    desc: 'Consumos de combustible por equipo (galones, precio, surtidor, operador).' },
};

/**
 * Detecta cuál de los 5 formatos es a partir de los headers.
 * Devuelve el id del formato o null si no coincide con ninguno.
 */
export function detectFormato(headers) {
  const H = (headers || []).map(normTxt);
  // h && : un header que normaliza a '' (p.ej. '#') matchearía CUALQUIER
  // needle vía n.includes('') — nunca es un match real.
  const tiene = (txt) => { const n = normTxt(txt); return H.some((h) => h && (h.includes(n) || n.includes(h))); };

  // Emergencia: si algún header menciona "emergencia" mandamos a su flujo
  // (catálogo si no hay tipo de movimiento, si no movimientos). Va primero
  // para que un archivo separado de emergencia no caiga en Insumos Totales.
  // OJO: el roster de Personal trae "Contacto Emergencia" / "Telefono
  // Emergencia" — esas columnas NO convierten el archivo en emergencia
  // (sin esta exclusión la hoja Personal del export caía acá y nunca
  // llegaba a la regla 'personal' de abajo).
  if (H.some((h) => h.includes('emergencia') && !h.includes('contacto') && !h.includes('telefono'))) {
    return tiene('tipo de movimiento') ? 'mov_emergencia' : 'insumos_emergencia';
  }

  // Asignaciones de maquinaria: el header "Asignado a" / "Asignar a" lo
  // distingue de los movimientos por cantidad. (Su template usa "Movimiento",
  // no "Tipo de Movimiento", así que va antes del gate de abajo.)
  if (H.some((h) => h.includes('asigna'))) return 'mov_maquinaria_asignacion';

  // Datasets del export histórico (round-trip): se reconocen por columnas
  // distintivas que ningún formato de movimientos tiene. Combustible va
  // primero ('Galones' es inequívoco); mantenimientos antes que horas
  // (ambos tienen 'Equipo', pero solo mantenimientos trae taller/costos).
  // OJO: estas reglas corren ANTES del gate de 'movimiento', así que el match
  // es estricto: SOLO header ⊇ needle (una dirección). Con el bidireccional un
  // header corto roba hojas ajenas aunque se exija longitud mínima: 'Hora'
  // (4 chars) matchea 'horas trabajadas' → Equipo+Hora caía en horas_maquina;
  // 'ID' matchea 'hora sal-id-a'; 'N°'→'n' y '#'→'' matcheaban todo. Los
  // headers del export contienen el needle completo, así que esto basta.
  const tieneCol = (txt) => {
    const n = normTxt(txt);
    return H.some((h) => h.includes(n));
  };
  if (tieneCol('galones')) return 'combustible';
  if (tieneCol('equipo') && (tieneCol('taller') || tieneCol('costo repuestos') || tieneCol('mecanico'))) return 'mantenimientos';
  if (tieneCol('equipo') && (tieneCol('hm inicial') || tieneCol('horas trabajadas'))) return 'horas_maquina';
  if (tieneCol('monto') && tieneCol('concepto')) return 'caja_chica';
  if (tieneCol('trabajador') && (tieneCol('hora ingreso') || tieneCol('hora salida'))) return 'asistencia';

  // Personal: roster de trabajadores (Nombres + Apellidos + DNI). Los archivos
  // de movimientos llevan "Responsable" (una sola columna), no Nombres/Apellidos
  // separados, así que no colisionan. También reconoce la hoja "Cuentas
  // bancarias (personal)" del export (trae las mismas tres columnas).
  if (tiene('nombres') && tiene('apellidos') && tiene('dni')) return 'personal';

  // (Insumos Totales se retiró del flujo — el catálogo lo crea el paso de
  // revisión al cargar movimientos.)
  // Para ser mov_*, requerimos que ALGÚN header contenga "movimiento" — así
  // no confundimos un archivo con columna sola "Tipo" (catálogo viejo).
  const tieneMovimiento = H.some((h) => h.includes('movimiento'));
  if (!tieneMovimiento) return null;
  if (!tiene('tipo de movimiento')) return null;

  if (tiene('material')) return 'mov_materiales';
  if (tiene('herramienta')) return 'mov_herramientas';
  // EPP y Maquinaria comparten la columna "EPP"; las distingue Unidad vs Estado.
  if (tiene('unidad') && !tiene('estado')) return 'mov_epp';
  if (tiene('estado')) return 'mov_maquinaria';
  return 'mov_epp';
}

// ── Date parsing ─────────────────────────────────────────────────────
// parseExcelFile lee con raw:false, así que las fechas llegan formateadas
// en formato US (M/D/YY) — p.ej. "5/25/26". También toleramos serial Excel
// e ISO. (No usamos excelDateToISO de apuParser porque ése asume dd/mm/yyyy
// y malinterpretaría "5/25/26".)
const iso = (y, m, d) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function parseFechaMigracion(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;

  // ISO ya formateado
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // Serial Excel puro (sin separadores)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 59 && n < 200000) {
      const d = new Date((n - 25569) * 86400 * 1000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }

  // M/D/YY · M/D/YYYY · YYYY/M/D (con / o -)
  const m = s.match(/^(\d{1,4})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const p1 = parseInt(m[1], 10), p2 = parseInt(m[2], 10), p3 = parseInt(m[3], 10);
    if (m[1].length === 4) {                       // YYYY/M/D
      if (p2 >= 1 && p2 <= 12 && p3 >= 1 && p3 <= 31) return iso(p1, p2, p3);
    } else {
      const year = p3 < 100 ? 2000 + p3 : p3;
      let month, day;
      if (p1 > 12 && p2 <= 12) { day = p1; month = p2; }   // D/M/Y
      else { month = p1; day = p2; }                        // M/D/Y (default XLSX raw:false)
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return iso(year, month, day);
    }
  }
  return null;
}

// ── Helpers de fila ──────────────────────────────────────────────────
/** Devuelve un getter que busca el valor de una fila por nombre(s) de columna. */
function rowGetter(row) {
  const idx = {};
  for (const k of Object.keys(row || {})) idx[normTxt(k)] = k;
  return (...cands) => {
    for (const c of cands) {
      const key = idx[normTxt(c)];
      if (key != null) { const v = row[key]; if (v != null && String(v).trim() !== '') return v; }
    }
    // match parcial — exige ≥4 chars en ambos lados para no enganchar
    // columnas cortas como "ID" (p.ej. "salida"/"unidad" contienen "id").
    for (const c of cands) {
      const nc = normTxt(c);
      if (nc.length < 4) continue;
      const hit = Object.keys(idx).find((nk) => nk && nk.length >= 4 && (nk.includes(nc) || nc.includes(nk)));
      if (hit) { const v = row[idx[hit]]; if (v != null && String(v).trim() !== '') return v; }
    }
    return null;
  };
}

const txt = (v) => (v == null ? null : String(v).trim() || null);
const num = (v) => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
// Como num pero devuelve null si está vacío (para precio: no forzar 0).
const numN = (v) => { if (v == null || String(v).trim() === '') return null; const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; };

/** "Ingreso"/"Entrada" → 'entrada'; "Salida" → 'salida';
 *  "Traspaso"/"Transpaso"/"Transferencia"/"Traslado" → 'traspaso' (sale de un
 *  almacén y entra a otro: el loader lo convierte en el par salida+entrada). */
export function normalizaTipoMov(v) {
  const n = normTxt(v);
  if (!n) return null;
  // 'transpas' (no 'transp'): "Transporte" debe seguir cayendo a null →
  // error visible de fila, no convertirse en un par de traspaso silencioso.
  if (n.startsWith('trasp') || n.startsWith('transpas') || n.startsWith('transf') || n.startsWith('trasl')) return 'traspaso';
  if (n.startsWith('ingr') || n.startsWith('entr') || n.includes('compra')) return 'entrada';
  if (n.startsWith('sal') || n.includes('despacho') || n.includes('consumo')) return 'salida';
  return null;
}

/** Clasifica el Tipo de un insumo a su tabla destino. */
export function clasificaTipoInsumo(v) {
  const n = normTxt(v);
  // 'emergencia' va primero: "Insumo de Emergencia" contiene "insumo" pero
  // debe ir a su inventario propio (SSOMA), no a materiales.
  if (n.includes('emergencia')) return 'insumos_emergencia';
  if (n.includes('material')) return 'materiales';
  if (n.includes('herramient')) return 'herramientas';
  if (n.includes('maquinaria') || n.includes('equipo') || n.includes('activo')) return 'activos_pesados';
  if (n.includes('epp')) return 'epps';
  return null; // desconocido
}

// ── Parsers ──────────────────────────────────────────────────────────

/** Formato "Insumos Totales" → [{ nombre, tipo (tabla), tipoRaw, unidad, fechaCreacion }] */
export function parseInsumosTotales(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const nombre = txt(g('Nombre Insumo', 'Insumo', 'Nombre'));
    if (!nombre) return;
    const tipoRaw = txt(g('Tipo'));
    out.push({
      idx: i + 2,
      nombre,
      tipoRaw,
      tipo: clasificaTipoInsumo(tipoRaw),
      unidad: txt(g('Unidad')) || 'Und',
      fechaCreacion: parseFechaMigracion(g('Fecha de creacion', 'Fecha de creación', 'Fecha creacion', 'Fecha')),
    });
  });
  return out;
}

/** Formato catálogo "Insumos de Emergencia" → [{ nombre, categoria, unidad, fechaCreacion }] */
export function parseInsumosEmergencia(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const nombre = txt(g('Insumo de Emergencia', 'Nombre Insumo', 'Insumo', 'Nombre'));
    if (!nombre) return;
    out.push({
      idx: i + 2,
      nombre,
      categoria: txt(g('Categoria', 'Categoría')),
      unidad: txt(g('Unidad')) || 'Und',
      fechaCreacion: parseFechaMigracion(g('Fecha de creacion', 'Fecha de creación', 'Fecha creacion', 'Fecha')),
    });
  });
  return out;
}

/**
 * Personal: roster de trabajadores con datos de contacto y cuentas bancarias.
 * Lee tanto la plantilla nueva como la hoja Personal del export histórico
 * (headers flexibles, con o sin tildes). Las columnas bancarias se separan en
 * `cuentas` — el loader las crea en personal_cuentas_bancarias.
 */
export function parsePersonal(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const nombres = txt(g('Nombres', 'Nombre'));
    const apellidos = txt(g('Apellidos', 'Apellido'));
    if (!nombres && !apellidos) return;
    // Tipo de documento: dni (default) | ce (carnet extranjería) | pasaporte.
    // El número se sanitiza según el tipo: DNI solo dígitos; CE/pasaporte
    // alfanumérico (un CE como "001043328" o pasaporte "AB123456" no debe
    // perder letras).
    const tdRaw = normTxt(txt(g('Tipo Documento', 'Tipo Doc', 'Tipo de documento')) || 'dni');
    const tipoDoc = tdRaw.includes('extranjeria') || tdRaw === 'ce' ? 'ce'
      : tdRaw.includes('pasaporte') ? 'pasaporte' : 'dni';
    const numRaw = String(g('DNI', 'Documento', 'N° Documento', 'Numero Documento') ?? '');
    const dni = tipoDoc === 'dni' ? numRaw.replace(/\D/g, '') : numRaw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const cuentas = [];
    const banco = txt(g('Banco'));
    const nroCta = txt(g('Numero Cuenta', 'Número Cuenta', 'N° Cuenta', 'Nro Cuenta', 'Numero de cuenta', 'Cuenta'));
    const cci = (txt(g('CCI')) || '').replace(/[\s-]/g, '') || null;
    if (banco || nroCta || cci) {
      const pCol = txt(g('Principal'));
      const tipoCta = (txt(g('Tipo Cuenta', 'Tipo de cuenta')) || 'ahorros').toLowerCase();
      cuentas.push({ banco: banco || 'Banco', tipo_cuenta: tipoCta, numero_cuenta: nroCta, cci,
        moneda: (txt(g('Moneda')) || 'PEN').toUpperCase(),
        principal: pCol != null ? pCol.toLowerCase().startsWith('s') : tipoCta !== 'cts' });
    }
    const bancoCts = txt(g('Banco CTS'));
    const ctaCts = txt(g('Cuenta CTS'));
    if (bancoCts || ctaCts) {
      cuentas.push({ banco: bancoCts || 'Banco de la Nación', tipo_cuenta: 'cts', numero_cuenta: ctaCts, cci: null, moneda: 'PEN', principal: false });
    }
    const estadoRaw = (txt(g('Estado')) || '').toLowerCase();
    out.push({
      idx: i + 2,
      nombres: nombres || '',
      apellidos: apellidos || '',
      // Solo Alias/Apodo: 'Sobrenombre' contiene 'nombre' y el partial-match
      // de rowGetter engancharía el header 'Nombre' (alias = nombre, contaminado).
      alias: txt(g('Alias', 'Apodo')),
      dni,
      tipoDoc,
      cargo: txt(g('Cargo')),
      area: txt(g('Area', 'Área')),
      frente: txt(g('Frente', 'Frente/Zona')),
      subcontrato: txt(g('Subcontrato', 'Subcontratista')),
      // El server tiene CHECK: seguro_a_cargo ∈ {empresa, subcontrato} o NULL.
      // El Excel trae texto libre ("Subcontratista", "Sí", "EMPRESA")  → se
      // normaliza a la whitelist; lo que no calza queda NULL (no rompe sync).
      seguro: (() => {
        const v = (txt(g('Seguro a cargo')) || '').toLowerCase();
        if (v.startsWith('emp')) return 'empresa';
        if (v.startsWith('sub')) return 'subcontrato';
        return null;
      })(),
      estado: ['activo', 'inactivo', 'suspendido', 'retirado'].includes(estadoRaw) ? estadoRaw : 'activo',
      fechaIngreso: parseFechaMigracion(g('Fecha Ingreso', 'Fecha de Ingreso')),
      fechaNacimiento: parseFechaMigracion(g('Fecha Nacimiento', 'Fecha Nac.', 'Fecha de Nacimiento')),
      telefono: txt(g('Telefono', 'Teléfono')),
      email: txt(g('Email', 'Correo', 'E-mail', 'Correo electronico', 'Correo electrónico', 'E_MAIL')),
      direccion: txt(g('Direccion', 'Dirección')),
      contactoEmergencia: txt(g('Contacto Emergencia', 'Contacto de emergencia')),
      telefonoEmergencia: txt(g('Telefono Emergencia', 'Teléfono Emergencia', 'Telefono de emergencia')),
      regimen: txt(g('Regimen Pension', 'Régimen Pensión', 'Regimen de pension', 'AFP/ONP', 'Regimen')),
      cuentas,
    });
  });
  return out;
}


/** Hora a 'HH:MM' (24h). Acepta 'HH:MM', 'H:MM:SS', 'h:mm AM/PM' y el serial
 *  de Excel (fracción de día). Devuelve null si no se puede interpretar. */
export function normalizaHora(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(a|p)?\.?\s*m?\.?\s*$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'p' && h < 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, '0')}:${m[2]}`;
    return null;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 0 && n < 1) {
    const tot = Math.round(n * 24 * 60);
    return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
  }
  return null;
}

/** Caja chica (export: ID·Fecha·Hora·Tipo·Monto (S/)·Concepto·Responsable·
 *  Proveedor·Documento·Observaciones). Tipo: Ingreso/Reposición → entrada;
 *  Gasto/Compra/Salida → salida. */
export function parseCajaChica(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const tipoRaw = normTxt(g('Tipo', 'Tipo de Movimiento'));
    let tipo = null;
    if (tipoRaw.startsWith('ingre') || tipoRaw.startsWith('entra') || tipoRaw.startsWith('repos')) tipo = 'entrada';
    else if (tipoRaw.startsWith('gasto') || tipoRaw.startsWith('sal') || tipoRaw.startsWith('compra') || tipoRaw.startsWith('egre')) tipo = 'salida';
    const monto = num(g('Monto (S/)', 'Monto', 'Importe'));
    const concepto = txt(g('Concepto', 'Descripción', 'Descripcion', 'Detalle'));
    if (!tipo && !monto && !concepto) return; // fila vacía
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha')),
      hora: normalizaHora(g('Hora')),
      tipo, monto, concepto,
      responsable: txt(g('Responsable')),
      proveedor: txt(g('Proveedor')),
      documento: txt(g('Documento', 'Documento Asociado', 'Boleta', 'Factura', 'N° Documento')),
      observaciones: txt(g('Observaciones', 'Observación', 'Observacion')),
    });
  });
  return out;
}

/** Asistencia (export: Fecha·Trabajador·Hora Ingreso·Hora Salida·Horas·
 *  Estado·Observaciones). Estado normalizado al CHECK del server. */
export function parseAsistencia(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const trabajador = txt(g('Trabajador', 'Personal', 'Nombre Completo', 'Nombre'));
    if (!trabajador) return;
    const eRaw = normTxt(g('Estado', 'Estado Asistencia', 'Asistencia'));
    let estado = null;
    if (eRaw.startsWith('asis') || eRaw === 'presente' || eRaw === 'a' || eRaw === 'x') estado = 'asistio';
    else if (eRaw.startsWith('tard')) estado = 'tardanza';
    else if (eRaw.startsWith('falt') || eRaw === 'f') estado = 'falta';
    else if (eRaw.startsWith('perm') || eRaw.startsWith('licen')) estado = 'permiso';
    else if (eRaw.startsWith('desc') || eRaw.startsWith('domin')) estado = 'descanso';
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha')),
      trabajador,
      horaIngreso: normalizaHora(g('Hora Ingreso', 'Ingreso')),
      horaSalida: normalizaHora(g('Hora Salida', 'Salida')),
      horas: numN(g('Horas', 'Horas Trabajadas')),
      estado, // null → el loader asume 'asistio'
      observaciones: txt(g('Observaciones', 'Observación', 'Observacion')),
    });
  });
  return out;
}

/** Mantenimientos de maquinaria (export: ID·Fecha·Equipo·Tipo·HM Actuales·
 *  Descripción·Costo Repuestos·Costo Mano de Obra·Costo Total·Taller·
 *  Mecánico·Duración·Observaciones). */
export function parseMantenimientos(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const equipo = txt(g('Equipo', 'Maquinaria', 'Activo'));
    if (!equipo) return;
    const tRaw = normTxt(g('Tipo'));
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha')),
      equipo,
      tipo: tRaw.startsWith('corr') ? 'correctivo' : 'preventivo',
      hmActuales: numN(g('HM Actuales', 'Horometro', 'Horómetro')),
      descripcion: txt(g('Descripción', 'Descripcion', 'Detalle')),
      costoRepuestos: numN(g('Costo Repuestos (S/)', 'Costo Repuestos')),
      costoManoObra: numN(g('Costo Mano de Obra (S/)', 'Costo Mano de Obra')),
      costoTotal: numN(g('Costo Total (S/)', 'Costo Total')),
      taller: txt(g('Taller')),
      mecanico: txt(g('Mecánico', 'Mecanico')),
      duracion: numN(g('Duración (h)', 'Duracion (h)', 'Duración', 'Duracion')),
      observaciones: txt(g('Observaciones', 'Observación', 'Observacion')),
    });
  });
  return out;
}

/** Horas máquina (export: ID·Fecha·Equipo·Horas Trabajadas·HM Inicial·
 *  HM Final·Operador·Actividad·Observaciones). */
export function parseHorasMaquina(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const equipo = txt(g('Equipo', 'Maquinaria', 'Activo'));
    if (!equipo) return;
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha')),
      equipo,
      horas: numN(g('Horas Trabajadas', 'Horas')),
      hmInicial: numN(g('HM Inicial')),
      hmFinal: numN(g('HM Final')),
      operador: txt(g('Operador', 'Operario')),
      actividad: txt(g('Actividad')),
      observaciones: txt(g('Observaciones', 'Observación', 'Observacion')),
    });
  });
  return out;
}

/** Consumos de combustible (export: ID·Fecha·Equipo·Galones·Precio/Galón·
 *  Total·Surtidor·Operador·HM Actuales·Observaciones). */
export function parseCombustible(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const equipo = txt(g('Equipo', 'Maquinaria', 'Activo'));
    if (!equipo) return;
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha')),
      equipo,
      galones: numN(g('Galones')),
      precioGalon: numN(g('Precio/Galón (S/)', 'Precio/Galon (S/)', 'Precio Galon', 'Precio por galon')),
      total: numN(g('Total (S/)', 'Total')),
      surtidor: txt(g('Surtidor', 'Grifo')),
      operador: txt(g('Operador', 'Operario')),
      hmActuales: numN(g('HM Actuales', 'Horometro', 'Horómetro')),
      observaciones: txt(g('Observaciones', 'Observación', 'Observacion')),
    });
  });
  return out;
}

/** "ELVIS IVAN HUATAY" → "Elvis Ivan Huatay". RENIEC devuelve todo en
 *  MAYÚSCULAS; al autocompletar/corregir lo pasamos a Título para que quede
 *  como el resto del roster. */
export function titleCaseNombre(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase()).trim();
}

/** ¿Distancia de edición ≤ 1? (typo de una letra, p.ej. "Huaman"/"Huamán" ya
 *  normalizado, o "Quispe"/"Quizpe"). Barato y suficiente para nombres. */
function lev1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la === lb) { i++; j++; }
    else if (la > lb) i++;
    else j++;
  }
  return edits + (la - i) + (lb - j) <= 1;
}

/**
 * Compara los nombres del Excel contra lo que devolvió RENIEC para ese DNI.
 * Devuelve { estado, coincidencias, total, ratio }:
 *   ok          → coinciden (incluye orden distinto y tildes)
 *   difiere     → coincidencia parcial (typo, segundo nombre faltante…) →
 *                 sugerir corregir con los datos RENIEC
 *   no_coincide → NADA coincide → el DNI probablemente está mal escrito →
 *                 recomendar verificar el número
 */
export function compararNombresReniec(excelNombres, excelApellidos, reniec) {
  const tok = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zñ ]/g, ' ').split(/\s+/).filter((t) => t.length >= 2);
  const ex = [...tok(excelNombres), ...tok(excelApellidos)];
  const rn = [...tok(reniec?.nombres), ...tok(reniec?.apellidoPaterno), ...tok(reniec?.apellidoMaterno)];
  if (!ex.length || !rn.length) return { estado: 'sin_datos', coincidencias: 0, total: Math.max(ex.length, rn.length), ratio: 0 };
  let match = 0;
  const usados = new Set();
  for (const t of ex) {
    const hit = rn.findIndex((r, i) => !usados.has(i) && (r === t || (t.length >= 4 && lev1(t, r))));
    if (hit >= 0) { usados.add(hit); match++; }
  }
  const total = Math.max(ex.length, rn.length);
  const ratio = match / total;
  const estado = ratio >= 0.99 ? 'ok' : (match >= 2 || ratio >= 0.5) ? 'difiere' : 'no_coincide';
  return { estado, coincidencias: match, total, ratio };
}

/**
 * Parser unificado de movimientos. `formato` ∈ mov_materiales | mov_epp |
 * mov_herramientas | mov_maquinaria | mov_emergencia. Devuelve filas normalizadas con la
 * semántica de origen/responsable/lugar resuelta por el caller.
 */
export function parseMovimientos(rows, formato) {
  const out = [];
  const itemCols = {
    mov_materiales:  ['Material'],
    mov_epp:         ['EPP'],
    mov_herramientas:['Herramientas', 'Herramienta'],
    mov_maquinaria:  ['EPP', 'Maquinaria', 'Equipo'],
    mov_emergencia:  ['Insumo de Emergencia', 'Insumo', 'EPP', 'Material', 'Nombre'],
  }[formato] || ['Material'];

  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    // Getter EXACTO (sin match parcial). Las columnas NUEVAS de la plantilla
    // mejorada se leen exacto para no engancharse con headers viejos combinados:
    // p.ej. 'Almacén' NO debe leer 'Proveedor/Almacen de Salida' por substring.
    const gE = (...cands) => {
      for (const c of cands) {
        const key = Object.keys(row || {}).find((k) => normTxt(k) === normTxt(c));
        if (key != null) { const v = row[key]; if (v != null && String(v).trim() !== '') return v; }
      }
      return null;
    };
    const nombreItem = txt(g(...itemCols));
    if (!nombreItem) return;
    const tipoRaw = txt(g('Tipo de Movimiento', 'Tipo'));
    const tipo = normalizaTipoMov(tipoRaw);
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha de Movimiento', 'Fecha')),
      hora: txt(gE('Hora')),
      nombreItem,
      categoria: txt(gE('Categoría', 'Categoria')),
      unidad: txt(g('Unidad')),
      estado: txt(g('Estado')),
      cantidad: num(g('Cantidad')),
      // texto crudo de la celda — num() fuerza 0 en celdas vacías/no numéricas,
      // y el aviso pre-import debe distinguir «vacía» de un 0 escrito.
      cantidadRaw: txt(g('Cantidad')),
      tipo, // 'entrada' | 'salida' | 'traspaso' | null
      tipoRaw, // texto crudo de la celda — para avisos «Fila N: Tipo "X" no reconocido»
      // proveedor (ingreso) / almacén de salida (salida materiales) — col. combinada vieja
      origen: txt(g('Proveedor/Almacen de Salida', 'Proveedor/Responsable', 'Proveedor/Responsible', 'Proveedor')),
      // Plantilla mejorada: columnas SEPARADAS, leídas EXACTO (gE) para no
      // confundirse con la columna combinada vieja (backward-compat: en plantillas
      // viejas estas quedan null y el loader cae a origen/lugar como antes).
      proveedor: txt(gE('Proveedor')),
      almacen: txt(gE('Almacén', 'Almacen', 'Almacén de Salida', 'Almacen de Salida', 'Almacén de salida', 'Almacén Origen', 'Almacen Origen')),
      // Traspaso: a qué almacén llega (el 'Almacén' de arriba es el de origen).
      almacenDestino: txt(gE('Almacén Destino', 'Almacen Destino', 'Almacén de destino', 'Almacen de destino', 'Almacén de llegada', 'Almacen de llegada')),
      subcontrato: txt(gE('Subcontrato', 'Subcontratista')),
      documento: txt(gE('Documento', 'Documento Asociado', 'Vale', 'Guía', 'Guia', 'N° Vale', 'N° Guía')),
      precio: numN(gE('Precio Unit. (S/)', 'Precio Unitario', 'Precio Unit.', 'Precio unitario', 'Precio')),
      observaciones: txt(gE('Observaciones', 'Observación', 'Observacion')),
      // responsable que retira (salida) — flexible (en EPP/herr viejos viene de la col. combinada)
      responsable: txt(g('Resposable (Salida)', 'Responsable (Salida)', 'Responsable', 'Proveedor/Responsable', 'Proveedor/Responsible')),
      // lugar de llegada (ingreso = almacén) / frente (salida) — col. vieja
      lugar: txt(g('Lugar llega / Frente', 'Lugar de llegada', 'Lugar', 'Frente')),
      frente: txt(gE('Frente / Zona', 'Frente', 'Zona')),
    });
  });
  return out;
}

/**
 * Asignaciones de maquinaria (custodia). Devuelve filas normalizadas:
 * { idx, fecha, equipo, tipo ('salida'|'entrada'), destinoTipo
 * ('personal'|'subcontratista'|null), destinoNombre, observaciones }.
 * Salida = asignación; Devolución/Ingreso = entrada (vuelve al pool).
 */
export function parseMovMaquinariaAsignacion(rows) {
  const out = [];
  (rows || []).forEach((row, i) => {
    const g = rowGetter(row);
    const equipo = txt(g('Equipo', 'Maquinaria', 'Activo', 'Nombre'));
    if (!equipo) return;
    const tipoRaw = txt(g('Movimiento', 'Tipo de Movimiento', 'Tipo'));
    const movRaw = normTxt(tipoRaw);
    let tipo = null;
    if (movRaw.startsWith('sal') || movRaw.includes('asign')) tipo = 'salida';
    else if (movRaw.startsWith('dev') || movRaw.startsWith('ingr') || movRaw.startsWith('entr')) tipo = 'entrada';
    const dt = normTxt(g('Tipo destino', 'Asignar a', 'Destino tipo', 'Destino'));
    const destinoTipo = dt.includes('subcontr') ? 'subcontratista'
      : (dt.includes('personal') || dt.includes('trabajad')) ? 'personal' : null;
    out.push({
      idx: i + 2,
      fecha: parseFechaMigracion(g('Fecha', 'Fecha de Movimiento')),
      hora: txt(g('Hora')),
      equipo,
      tipo,
      tipoRaw,
      destinoTipo,
      destinoNombre: txt(g('Asignado a', 'Asignado', 'Responsable', 'Proveedor/Responsable')),
      frente: txt(g('Frente / Zona', 'Frente', 'Zona')),
      observaciones: txt(g('Observación', 'Observacion', 'Observaciones')),
    });
  });
  return out;
}

/** Resumen de un parse de movimientos para el preview. */
export function resumenMovimientos(parsed) {
  const r = { total: parsed.length, entradas: 0, salidas: 0, traspasos: 0, sinTipo: 0, sinFecha: 0, sinCantidad: 0, items: new Set(), filasProblema: [] };
  for (const p of parsed) {
    if (p.tipo === 'entrada') r.entradas++;
    else if (p.tipo === 'salida') r.salidas++;
    else if (p.tipo === 'traspaso') r.traspasos++;
    else {
      r.sinTipo++;
      // Detalle pre-import: ANTES solo se contaba — el usuario no podía saber
      // QUÉ fila iba a fallar hasta después de importar ("Fila 101: Tipo no
      // reconocido"). Ahora la fila, el insumo y el texto crudo se listan.
      r.filasProblema.push({ idx: p.idx, item: p.nombreItem || '(sin nombre)', problema: p.tipoRaw ? `Tipo "${p.tipoRaw}" no reconocido` : 'Sin tipo de movimiento', sugerencia: 'Usá Ingreso, Salida o Traspaso' });
    }
    if (!(p.cantidad > 0)) {
      r.sinCantidad++;
      if (p.tipo) r.filasProblema.push({ idx: p.idx, item: p.nombreItem || '(sin nombre)', problema: `Cantidad inválida (${p.cantidadRaw ?? 'vacía'})`, sugerencia: 'Poné una cantidad mayor a 0' });
    }
    if (!p.fecha) r.sinFecha++;
    if (p.nombreItem) r.items.add(normTxt(p.nombreItem));
  }
  r.itemsUnicos = r.items.size;
  return r;
}
