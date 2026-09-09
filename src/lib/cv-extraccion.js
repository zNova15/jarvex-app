// ═══════════════════════════════════════════════════════════════════
// JARVEX — DEL CV A LA FICHA PROFESIONAL (tanda 15, entrega 4).
//
// El padrón de profesionales estaba VACÍO (confirmado por Gabriel el
// 8-set-2026: 84 personas en `personal`, 0 fichas, 0 experiencias). Tipear a
// mano 12 periodos por persona con sus fechas es justo el trabajo que hacía
// que nadie lo llenara. Este archivo convierte lo que devuelve el lector de CV
// (api/bases-analizar.js, acción 'extraer_cv') en las filas que la app ya
// sabe evaluar: `personal`, `personal_profesional` y `personal_experiencia`.
//
// LO QUE EL CV REAL ENSEÑÓ (39 páginas: 8 de currículum, 31 de constancias):
//
// 1. «EL CV» SON DOS DOCUMENTOS. Las páginas nativas DECLARAN experiencias;
//    las escaneadas las CERTIFICAN. En un proceso solo vale lo certificado
//    (experiencia-profesional.js cuenta aparte lo sustentado), así que la
//    pieza central de este archivo es `emparejarConstancias()`: cruza cada
//    constancia con la experiencia que respalda y le pone la PÁGINA. Una
//    experiencia sin constancia entra igual, pero sin `evidencia_id`: se ve,
//    no se presenta.
//
// 2. LAS FECHAS VIENEN COMO LAS ESCRIBIÓ LA PERSONA: «09/04/2026», «abril de
//    2013», «26/07!2011» (error de tipeo real). El modelo las convierte y este
//    archivo las vuelve a comprobar: una fecha que no parsea NO se inventa, se
//    deja vacía y se avisa, porque una experiencia sin inicio no cuenta y eso
//    es mejor que contar mal.
//
// 3. LA MISMA ENTIDAD, SIETE PERIODOS. PROREGIÓN contrató a la misma persona
//    siete veces por dos o tres meses. Son SIETE experiencias, no una: los
//    meses se fusionan al contar (regla 1 de experiencia-profesional.js) pero
//    las participaciones no (mig 198). No se deduplica por entidad.
//
// 4. EL RUBRO NO LO DICE EL CV. Es nuestra taxonomía (`rubros_obra`). Se
//    PROPONE por palabras clave del nombre de la obra y la persona lo
//    confirma; sin palabra clave queda vacío. Mismo criterio que rubro_id en
//    los requisitos de las bases: eso no lo decide un modelo.
//
// 5. EL CV ES UNA DECLARACIÓN, NO UNA PRUEBA (entrega 5, 8-set-2026).
//    Gabriel: «me gustaría que veas cómo podemos corroborar cada dato de lo
//    que él menciona […] y nosotros ya manualmente vamos corroborando que lo
//    que ha colocado está verificado».
//
//    Que el CV diga «trabajé 3 meses en PROREGIÓN» no prueba nada: la prueba
//    es la constancia, y a esa la mira una persona. Por eso cada dato leído
//    nace en `verificacion: 'pendiente'` y lleva `sustento_esperado`, que es
//    la frase que le dice al administrador QUÉ documento buscar entre las
//    páginas escaneadas del propio CV. Lo verificado es lo único presentable.
//
// 6. LAS CONSTANCIAS NO SE ESCANEAN CON IA POR DEFECTO. Medido sobre el CV
//    real: las 8 páginas nativas traen TODO lo declarativo, incluidas la
//    constancia del RNP y la ficha RUC de SUNAT (son impresiones de web a
//    PDF, con su texto intacto). Las 31 escaneadas son los papeles que
//    respaldan, y para respaldar hay que MIRARLOS, no leerlos con un modelo.
//    Leerlas cuesta USD 0,062 y sigue sin dar certeza; mirarlas cuesta USD 0
//    y da certeza. El OCR queda como opción explícita, apagada.
//
// Puro: sin React, sin Dexie, sin red. Todo se prueba en node.
// ═══════════════════════════════════════════════════════════════════

import { normalizar, verificarCita } from './bases-extraccion.js';

// ── Fechas ─────────────────────────────────────────────────────────

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
};

const pad2 = (n) => String(n).padStart(2, '0');
const fechaValida = (y, m, d) => {
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

/**
 * Cualquier fecha como la escribe un CV peruano → 'YYYY-MM-DD', o null.
 *   '2026-04-09' · '09/04/2026' · '9-4-2026' · '26/07!2011' (tipeo) ·
 *   'abril de 2013' · 'Abril 2013' · 'abr-2013' · '2013' (→ 01-01, aproximada)
 * Día/mes/año SIEMPRE: en Perú «09/04» es 9 de abril, no 4 de setiembre.
 * @returns { iso, aproximada } | null
 */
export function normalizarFechaCv(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s || /^(actual|a la fecha|presente|hoy|vigente|en curso|actualidad)/.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return fechaValida(y, mo, d) ? { iso: `${y}-${pad2(mo)}-${pad2(d)}`, aproximada: false } : null;
  }
  m = s.match(/^(\d{1,2})\s*[/.\-!|]\s*(\d{1,2})\s*[/.\-!|]\s*(\d{4})/);
  if (m) {
    const d = +m[1], mo = +m[2], y = +m[3];
    return fechaValida(y, mo, d) ? { iso: `${y}-${pad2(mo)}-${pad2(d)}`, aproximada: false } : null;
  }
  m = s.match(/^(\d{1,2})?\s*(?:de\s+)?([a-zñ]+)\.?\s*(?:de(?:l)?\s+)?(\d{4})/);
  if (m && MESES[m[2]]) {
    const d = m[1] ? +m[1] : 1;
    const mo = MESES[m[2]], y = +m[3];
    return fechaValida(y, mo, d) ? { iso: `${y}-${pad2(mo)}-${pad2(d)}`, aproximada: !m[1] } : null;
  }
  m = s.match(/^(\d{4})-(\d{1,2})$/) || s.match(/^(\d{1,2})[/-](\d{4})$/);
  if (m) {
    const y = m[1].length === 4 ? +m[1] : +m[2];
    const mo = m[1].length === 4 ? +m[2] : +m[1];
    return fechaValida(y, mo, 1) ? { iso: `${y}-${pad2(mo)}-01`, aproximada: true } : null;
  }
  m = s.match(/^(\d{4})$/);
  if (m && +m[1] >= 1950 && +m[1] <= 2100) return { iso: `${m[1]}-01-01`, aproximada: true };
  return null;
}

// ── Persona ────────────────────────────────────────────────────────

/**
 * Nombres y apellidos a partir de un nombre completo, cuando el modelo no los
 * separó. En Perú van DOS apellidos al final: «Jaime Nelson Ayay Valdez» →
 * nombres «Jaime Nelson», apellidos «Ayay Valdez». Con dos palabras, una y
 * una; con una sola, va a nombres.
 */
export function separarNombre(completo) {
  const partes = String(completo || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (!partes.length) return { nombres: '', apellidos: '' };
  if (partes.length === 1) return { nombres: partes[0], apellidos: '' };
  if (partes.length === 2) return { nombres: partes[0], apellidos: partes[1] };
  return { nombres: partes.slice(0, -2).join(' '), apellidos: partes.slice(-2).join(' ') };
}

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
const limpio = (v, max = 200) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
};
const capitalizar = (s) => String(s || '').toLowerCase()
  .replace(/(^|\s|-)([a-zñáéíóú])/g, (_, a, b) => a + b.toUpperCase());

/**
 * La fila de `personal` que sale del CV. `obra_id` va en null (mig 199): un
 * profesional del banco de propuestas no está en ninguna obra todavía.
 * `cargo` lleva la profesión para que `categoriaDe()` lo clasifique como
 * profesional, y `categoria` lo fija por si el cargo no tiene palabra clave.
 */
export function aPersona(resultado = {}) {
  const p = resultado.persona || {};
  let nombres = limpio(p.nombres, 120);
  let apellidos = limpio(p.apellidos, 120);
  if (!apellidos && nombres) ({ nombres, apellidos } = separarNombre(nombres));
  const dni = soloDigitos(p.dni);
  const ruc = soloDigitos(p.ruc);
  const dniDeRuc = ruc.length === 11 && ruc.startsWith('10') ? ruc.slice(2, 10) : '';
  return {
    nombres: nombres ? capitalizar(nombres) : '',
    apellidos: apellidos ? capitalizar(apellidos) : '',
    dni: dni.length === 8 ? dni : (dniDeRuc || null),
    telefono: limpio(p.celular, 40),
    email: limpio(p.email, 120)?.toLowerCase() || null,
    direccion: limpio(p.direccion, 240),
    fecha_nacimiento: normalizarFechaCv(p.fecha_nacimiento)?.iso || null,
    cargo: limpio(resultado.ficha?.profesion, 120) || 'Profesional',
    categoria: 'profesionales',
    estado: 'activo',
    obra_id: null,
  };
}

// ── Ficha ──────────────────────────────────────────────────────────

const COLEGIOS = new Set(['CIP', 'CAP', 'OTRO']);

/** Colegio a partir de la profesión, cuando el modelo no lo dijo. */
export function colegioDeProfesion(profesion) {
  const n = normalizar(profesion);
  if (/ARQUITECT/.test(n)) return 'CAP';
  if (/INGENIER/.test(n)) return 'CIP';
  return n ? 'OTRO' : null;
}

export function aCapacitaciones(lista) {
  const out = [];
  const vistas = new Set();
  for (const c of (Array.isArray(lista) ? lista : [])) {
    const nombre = limpio(c?.nombre || c?.curso_nombre, 240);
    if (!nombre) continue;
    const k = normalizar(nombre).slice(0, 80);
    if (vistas.has(k)) continue;
    vistas.add(k);
    const horas = Number(c?.horas ?? c?.curso_horas);
    const fila = {
      nombre,
      institucion: limpio(c?.institucion || c?.curso_institucion, 200),
      horas: Number.isFinite(horas) && horas > 0 ? Math.round(horas) : null,
      desde: normalizarFechaCv(c?.desde || c?.fecha_inicio)?.iso || null,
      hasta: normalizarFechaCv(c?.hasta || c?.fecha_fin)?.iso || null,
      ...(c?.sustento_pagina != null ? { sustento_pagina: c.sustento_pagina } : {}),
      verificacion: c?.verificacion || 'pendiente',
    };
    fila.sustento_esperado = sustentoEsperadoCurso(fila);
    out.push(fila);
  }
  return out;
}

/** Los campos de `personal_profesional` que se pueden proponer. */
export function aFicha(resultado = {}) {
  const f = resultado.ficha || {};
  const ruc = soloDigitos(f.ruc || resultado.persona?.ruc);
  const anio = Number(f.anio_egreso);
  const colegio = COLEGIOS.has(String(f.colegio || '').toUpperCase())
    ? String(f.colegio).toUpperCase()
    : colegioDeProfesion(f.profesion);
  return {
    profesion: limpio(f.profesion, 160),
    titulo: limpio(f.titulo, 200),
    universidad: limpio(f.universidad, 200),
    anio_egreso: Number.isInteger(anio) && anio > 1950 && anio < 2100 ? anio : null,
    colegio,
    colegiatura_numero: limpio(f.colegiatura_numero, 40),
    colegiatura_fecha: normalizarFechaCv(f.colegiatura_fecha)?.iso || null,
    colegiatura_habil_hasta: normalizarFechaCv(f.colegiatura_habil_hasta)?.iso || null,
    ruc: ruc.length === 11 ? ruc : null,
    especialidades: (Array.isArray(f.especialidades) ? f.especialidades : [])
      .map(e => limpio(e, 120)).filter(Boolean).slice(0, 12),
    capacitaciones: aCapacitaciones(f.capacitaciones),
    rnp_numero: limpio(f.rnp_numero, 40),
    rnp_vigente_desde: normalizarFechaCv(f.rnp_vigente_desde)?.iso || null,
    resumen: limpio(f.resumen, 1200),
    fuente: 'cv_ia',
    // Todo lo leído nace sin verificar. El administrador marca campo por
    // campo mirando el diploma, la ficha RUC o la constancia del RNP.
    verificaciones: {},
  };
}

// ── Rubro propuesto por palabras clave ─────────────────────────────
//
// Las llaves son el `idempotency_key` de los rubros semilla de la mig 171; si
// el admin renombró el rubro la llave sigue igual. Un rubro agregado a mano no
// tiene palabras clave y no se propone nunca — eso es correcto.
export const PALABRAS_RUBRO = {
  rubro_saneamiento: ['AGUA POTABLE', 'ALCANTARILLADO', 'SANEAMIENTO', 'DESAGUE', 'PTAR', 'PTAP', 'RESERVORIO', 'LETRINAS', 'UBS'],
  rubro_viales: ['CARRETERA', 'VIAL', 'CAMINO VECINAL', 'TROCHA', 'ASFALT', 'PAVIMENTACION', 'PAVIMENTO'],
  rubro_pistas_veredas: ['PISTAS Y VEREDAS', 'PISTAS', 'VEREDAS', 'CALLES', 'JR.', 'AV.', 'TRANSITABILIDAD'],
  rubro_edificaciones: ['MERCADO', 'COLEGIO', 'INSTITUCION EDUCATIVA', 'I.E.', 'HOSPITAL', 'CENTRO DE SALUD', 'POSTA', 'LOCAL COMUNAL', 'LOCAL MUNICIPAL', 'EDIFICIO', 'PALACIO MUNICIPAL', 'ESTADIO', 'LOSA', 'COMISARIA', 'FARMACIA', 'AULAS', 'CASA COMUNAL', 'PLAZA', 'INFRAESTRUCTURA EDUCATIVA'],
  rubro_puentes: ['PUENTE', 'PONTON', 'OBRAS DE ARTE', 'ALCANTARILLA'],
  rubro_electrificacion: ['ELECTRIFICACION', 'ELECTRICA', 'REDES PRIMARIAS', 'REDES SECUNDARIAS', 'ALUMBRADO', 'SUBESTACION'],
  rubro_riego: ['RIEGO', 'CANAL', 'REPRESA', 'BOCATOMA', 'HIDRAULIC', 'IRRIGACION'],
  rubro_defensas: ['DEFENSA RIBERENA', 'DEFENSAS RIBERENAS', 'ENROCADO', 'MURO DE CONTENCION', 'GAVION', 'ENCAUZAMIENTO'],
};

/**
 * ¿A qué rubro parece pertenecer esta obra? Por palabras clave del NOMBRE DE
 * LA OBRA, nunca de la entidad: «Municipalidad Distrital de X» contrató agua
 * potable, y el nombre del contratante no dice nada del rubro. Devuelve la
 * fila del rubro (de `rubros`) o null.
 */
export function proponerRubro(texto, rubros) {
  const n = normalizar(texto);
  if (!n) return null;
  const porClave = new Map((rubros || []).filter(r => !r.deleted_at).map(r => [r.idempotency_key, r]));
  let mejor = null, mejorLargo = 0;
  for (const [clave, palabras] of Object.entries(PALABRAS_RUBRO)) {
    const rubro = porClave.get(clave);
    if (!rubro) continue;
    for (const p of palabras) {
      // La palabra más larga que aparece gana: «PISTAS Y VEREDAS» antes que «CALLES».
      if (n.includes(p) && p.length > mejorLargo) { mejor = rubro; mejorLargo = p.length; }
    }
  }
  return mejor;
}

// ── Qué documento probaría cada cosa ───────────────────────────────

/**
 * La frase que el administrador va a buscar entre las páginas escaneadas.
 *
 * Se arma con lo que el propio CV declara, no con una plantilla genérica:
 * «Constancia de trabajo de PROREGIÓN por el periodo 01/05/2025 – 29/07/2025»
 * se encuentra hojeando; «adjuntar sustento» no le sirve a nadie.
 */
export function sustentoEsperadoDe(exp = {}) {
  const quien = limpio(exp.entidad, 120);
  const periodo = [exp.fecha_inicio, exp.fecha_fin || 'a la fecha'].filter(Boolean).join(' a ');
  const partes = ['Constancia o certificado de trabajo'];
  if (quien) partes.push(`de ${quien}`);
  if (exp.cargo) partes.push(`como ${String(exp.cargo).trim().slice(0, 80)}`);
  if (periodo) partes.push(`por el periodo ${periodo}`);
  return partes.join(' ').slice(0, 400);
}

/** Los campos de la ficha que se verifican, y con qué documento cada uno. */
export const CAMPOS_VERIFICABLES = [
  { campo: 'titulo', label: 'Título profesional', con: 'Diploma de bachiller o de título de la universidad' },
  { campo: 'colegiatura', label: 'Colegiatura', con: 'Diploma de incorporación al colegio profesional (CIP/CAP), donde figura el número y la fecha' },
  { campo: 'habilidad', label: 'Habilidad vigente', con: 'Certificado de habilidad del colegio, vigente a la fecha de presentación' },
  { campo: 'dni', label: 'DNI', con: 'Copia del documento de identidad' },
  { campo: 'ruc', label: 'RUC', con: 'Ficha RUC de SUNAT (constancia de información registrada)' },
  { campo: 'rnp', label: 'RNP', con: 'Constancia de inscripción en el Registro Nacional de Proveedores' },
];

/** Qué documento probaría una capacitación declarada. */
export function sustentoEsperadoCurso(c = {}) {
  const partes = ['Certificado o diploma'];
  if (c.nombre) partes.push(`de «${String(c.nombre).slice(0, 90)}»`);
  if (c.institucion) partes.push(`emitido por ${String(c.institucion).slice(0, 70)}`);
  if (c.horas) partes.push(`(${c.horas} horas)`);
  return partes.join(' ').slice(0, 300);
}

// ── Experiencias y constancias ─────────────────────────────────────

/** Tipos de documento escaneado que CERTIFICAN un periodo de trabajo. */
export const TIPOS_SUSTENTO_TRABAJO = new Set(['constancia_trabajo', 'contrato', 'conformidad', 'orden_servicio']);

const aDia = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
};

/** ¿Estos dos nombres de entidad hablan del mismo contratante? Tolerante:
 *  «PROREGIÓN» dentro de «Unidad Ejecutora de Programas Regionales -
 *  PROREGIÓN», o el RUC igual. */
export function mismaEntidad(a, b, rucA = null, rucB = null) {
  const ra = soloDigitos(rucA), rb = soloDigitos(rucB);
  if (ra.length === 11 && rb.length === 11) return ra === rb;
  const na = normalizar(a).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const nb = normalizar(b).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  // Comparten al menos dos palabras significativas (sin S.A.C., E.I.R.L., DE, LA…),
  // o UNA palabra distintiva: una sigla o marca («PROREGION», «CONYSER») que
  // no sea un genérico institucional ni un lugar. «Municipalidad Distrital de
  // Llapa» y «Municipalidad Provincial de Cajamarca» comparten MUNICIPALIDAD y
  // no son la misma entidad; «Unidad Ejecutora … - PROREGIÓN» y «PROREGION
  // CAJAMARCA» comparten PROREGION y sí lo son.
  const stop = new Set(['DE', 'LA', 'EL', 'LOS', 'LAS', 'DEL', 'Y', 'SAC', 'SA', 'SRL', 'EIRL', 'S', 'A', 'C', 'R', 'L', 'E', 'I']);
  const wa = new Set(na.split(' ').filter(w => w.length > 2 && !stop.has(w)));
  const wb = nb.split(' ').filter(w => w.length > 2 && !stop.has(w));
  const comunes = wb.filter(w => wa.has(w));
  if (comunes.length >= 2) return true;
  return comunes.some(w => w.length >= 6 && !GENERICAS_ENTIDAD.has(w));
}

/** Palabras que aparecen en el nombre de media entidad peruana y no
 *  identifican a ninguna: instituciones, formas societarias y departamentos. */
export const GENERICAS_ENTIDAD = new Set([
  'MUNICIPALIDAD', 'DISTRITAL', 'PROVINCIAL', 'GOBIERNO', 'REGIONAL', 'REGION', 'UNIDAD', 'EJECUTORA',
  'PROGRAMAS', 'REGIONALES', 'PROYECTO', 'PROYECTOS', 'ESPECIAL', 'GERENCIA', 'SUBGERENCIA', 'DIRECCION',
  'MINISTERIO', 'INSTITUTO', 'UNIVERSIDAD', 'NACIONAL', 'EMPRESA', 'CONSORCIO', 'CONSTRUCTORA', 'CONSTRUCCIONES',
  'CONTRATISTAS', 'CONTRATISTA', 'SERVICIOS', 'GENERALES', 'INGENIERIA', 'INGENIEROS', 'INVERSIONES',
  'ASOCIACION', 'COOPERATIVA', 'SOCIEDAD', 'ANONIMA', 'CERRADA', 'LIMITADA', 'MULTIPLES', 'NEGOCIOS',
  'PERU', 'CAJAMARCA', 'TRUJILLO', 'PIURA', 'AREQUIPA', 'CUSCO', 'LAMBAYEQUE', 'CHICLAYO', 'ANCASH',
  'HUARAZ', 'JUNIN', 'HUANCAYO', 'LORETO', 'IQUITOS', 'AMAZONAS', 'HUANUCO', 'TACNA', 'AYACUCHO', 'UCAYALI',
  'PUCALLPA', 'TUMBES', 'MOQUEGUA', 'APURIMAC', 'HUANCAVELICA', 'CALLAO', 'MARTIN', 'TARAPOTO', 'CHIMBOTE',
]);

/** ¿Los periodos se pisan (con 45 días de tolerancia: las constancias suelen
 *  redondear)? Sin fechas de un lado, se compara por cargo. */
function periodosCompatibles(exp, doc) {
  const ei = aDia(exp.fecha_inicio), ef = aDia(exp.fecha_fin) ?? 10 ** 7;
  const di = aDia(doc.fecha_inicio), df = aDia(doc.fecha_fin) ?? 10 ** 7;
  if (ei == null || di == null) return normalizar(exp.cargo) && normalizar(exp.cargo) === normalizar(doc.cargo);
  const tol = 45;
  return di <= ef + tol && ei <= df + tol;
}

/**
 * Cruza las experiencias DECLARADAS (páginas nativas) con las constancias
 * LEÍDAS (páginas escaneadas). Cada constancia sustenta a lo sumo UNA
 * experiencia (la de fechas más cercanas); una constancia sin experiencia
 * declarada se vuelve experiencia nueva, con sustento. Nada se descarta.
 *
 * @param experiencias  [{ entidad, entidad_ruc, cargo, fecha_inicio, fecha_fin, ... }]
 * @param documentos    [{ tipo, pagina_desde, emisor, emisor_ruc, cargo, fecha_inicio, fecha_fin, ... }]
 * @returns { experiencias: [...con sustento_pagina], nuevasDesdeConstancias, sinSustento, constanciasSueltas }
 */
export function emparejarConstancias(experiencias, documentos) {
  const exps = (experiencias || []).map(e => ({ ...e, sustento_pagina: e.sustento_pagina ?? null }));
  const docs = (documentos || []).filter(d => TIPOS_SUSTENTO_TRABAJO.has(d?.tipo));
  const usadas = new Set();
  let nuevas = 0;
  for (const d of docs) {
    let mejor = -1, mejorDist = Infinity;
    exps.forEach((e, i) => {
      if (usadas.has(i)) return;
      if (!mismaEntidad(e.entidad, d.emisor, e.entidad_ruc, d.emisor_ruc)) return;
      if (!periodosCompatibles(e, d)) return;
      const dist = Math.abs((aDia(e.fecha_inicio) ?? 0) - (aDia(d.fecha_inicio) ?? 0));
      if (dist < mejorDist) { mejorDist = dist; mejor = i; }
    });
    if (mejor >= 0) {
      usadas.add(mejor);
      exps[mejor].sustento_pagina = d.pagina_desde ?? null;
      exps[mejor].sustento_tipo = d.tipo;
      // La constancia puede traer lo que el CV no dijo.
      if (!exps[mejor].obra_nombre && d.obra_nombre) exps[mejor].obra_nombre = d.obra_nombre;
      if (exps[mejor].monto == null && d.monto != null) exps[mejor].monto = d.monto;
      if (!exps[mejor].entidad_ruc && d.emisor_ruc) exps[mejor].entidad_ruc = d.emisor_ruc;
      if (!exps[mejor].fecha_fin && d.fecha_fin) exps[mejor].fecha_fin = d.fecha_fin;
    } else if (d.fecha_inicio) {
      nuevas++;
      exps.push({
        entidad: d.emisor || null, entidad_ruc: d.emisor_ruc || null,
        obra_nombre: d.obra_nombre || null, cargo: d.cargo || null,
        fecha_inicio: d.fecha_inicio, fecha_fin: d.fecha_fin || null,
        monto: d.monto ?? null, moneda: d.moneda || 'PEN',
        fuente_pagina: d.pagina_desde ?? null, fuente_cita: d.fuente_cita || null,
        sustento_pagina: d.pagina_desde ?? null, sustento_tipo: d.tipo,
        desde_constancia: true,
      });
    }
  }
  const sueltas = docs.filter(d => !d.fecha_inicio && !exps.some(e => e.sustento_pagina === d.pagina_desde));
  return {
    experiencias: exps,
    nuevasDesdeConstancias: nuevas,
    sinSustento: exps.filter(e => e.sustento_pagina == null).length,
    constanciasSueltas: sueltas,
  };
}

/**
 * Lo que las constancias dicen de la FICHA (no de la experiencia): la fecha de
 * colegiatura sale del diploma, la habilidad del certificado, los cursos de
 * sus certificados, el DNI del DNI. Solo llena lo que la ficha no tenía.
 */
export function completarFichaConDocumentos(ficha, persona, documentos) {
  const f = { ...ficha };
  const p = { ...persona };
  const cursos = [];
  for (const d of (documentos || [])) {
    if (!d || typeof d !== 'object') continue;
    if (d.tipo === 'diploma_colegiatura') {
      if (!f.colegiatura_fecha) f.colegiatura_fecha = normalizarFechaCv(d.colegiatura_fecha || d.fecha_emision)?.iso || f.colegiatura_fecha || null;
      if (!f.colegiatura_numero && d.colegiatura_numero) f.colegiatura_numero = limpio(d.colegiatura_numero, 40);
    } else if (d.tipo === 'habilidad_colegio') {
      if (!f.colegiatura_habil_hasta) f.colegiatura_habil_hasta = normalizarFechaCv(d.habil_hasta)?.iso || null;
      if (!f.colegiatura_numero && d.colegiatura_numero) f.colegiatura_numero = limpio(d.colegiatura_numero, 40);
    } else if (d.tipo === 'certificado_curso') {
      cursos.push({ ...d, sustento_pagina: d.pagina_desde ?? null });
    } else if (d.tipo === 'dni') {
      const dni = soloDigitos(d.dni);
      if (!p.dni && dni.length === 8) p.dni = dni;
    } else if (d.tipo === 'ruc' || d.tipo === 'rnp') {
      const ruc = soloDigitos(d.ruc);
      if (!f.ruc && ruc.length === 11) f.ruc = ruc;
      if (!p.dni && ruc.length === 11 && ruc.startsWith('10')) p.dni = ruc.slice(2, 10);
      if (d.tipo === 'rnp') f.rnp_inscrito = true;
    }
  }
  if (cursos.length) {
    const ya = new Set((f.capacitaciones || []).map(c => normalizar(c.nombre).slice(0, 80)));
    for (const c of aCapacitaciones(cursos)) {
      const k = normalizar(c.nombre).slice(0, 80);
      if (!ya.has(k)) { f.capacitaciones = [...(f.capacitaciones || []), c]; ya.add(k); }
      else {
        // El certificado le pone la página al curso que el CV ya declaraba.
        f.capacitaciones = (f.capacitaciones || []).map(x =>
          normalizar(x.nombre).slice(0, 80) === k && x.sustento_pagina == null ? { ...x, sustento_pagina: c.sustento_pagina } : x);
      }
    }
  }
  return { ficha: f, persona: p };
}

/**
 * Una experiencia lista para `personal_experiencia`. `evidencia_id` lo pone
 * quien guarda (es el id del CV subido) y SOLO si hay `sustento_pagina`: una
 * experiencia declarada sin constancia se guarda sin evidencia, que es la
 * verdad, y el verificador la cuenta como no sustentada.
 */
export function aFilaExperiencia(e = {}, { rubros = [] } = {}) {
  const ini = normalizarFechaCv(e.fecha_inicio);
  const fin = normalizarFechaCv(e.fecha_fin);
  const monto = Number(e.monto);
  const rubro = proponerRubro(e.obra_nombre || '', rubros);
  const alertas = [];
  if (!ini) alertas.push('sin fecha de inicio legible');
  else if (ini.aproximada) alertas.push('la fecha de inicio es aproximada (solo mes o año)');
  if (fin?.aproximada) alertas.push('la fecha de fin es aproximada');
  if (ini && fin && fin.iso < ini.iso) alertas.push('termina antes de empezar: revisar las fechas');
  return {
    entidad: limpio(e.entidad, 200),
    entidad_ruc: soloDigitos(e.entidad_ruc).length === 11 ? soloDigitos(e.entidad_ruc) : null,
    obra_nombre: limpio(e.obra_nombre, 300),
    cargo: limpio(e.cargo, 160),
    rubro_id: rubro?.id || null,
    monto: Number.isFinite(monto) && monto > 0 ? monto : null,
    moneda: e.moneda === 'USD' ? 'USD' : 'PEN',
    fecha_inicio: ini?.iso || null,
    fecha_fin: fin?.iso || null,
    obra_id: null,
    observaciones: e.desde_constancia ? 'Cargada desde la constancia (no estaba declarada en el CV)' : null,
    fuente: 'cv_ia',
    fuente_pagina: e.fuente_pagina != null ? Number(e.fuente_pagina) || null : null,
    fuente_cita: limpio(e.fuente_cita, 1200),
    sustento_pagina: e.sustento_pagina != null ? Number(e.sustento_pagina) || null : null,
    sustento_tipo: e.sustento_tipo || null,
    // Nace declarada. Solo una persona que ve el papel la pasa a verificada
    // (mig 200). Si la constancia ya se cruzó por OCR, igual queda pendiente:
    // que un modelo diga que el papel existe no es lo mismo que haberlo visto.
    verificacion: 'pendiente',
    sustento_esperado: sustentoEsperadoDe(e),
    // Solo pantalla (no viajan a la tabla): la pantalla los quita al guardar.
    _rubroPropuesto: rubro ? rubro.nombre : null,
    _alertas: alertas,
    _verificada: e.verificada !== false,
    _verificacionMotivo: e.verificacion_motivo || null,
  };
}

/** Todas las filas, con la de fecha más reciente primero. */
export function aFilasExperiencia(experiencias, opts = {}) {
  return (experiencias || []).map(e => aFilaExperiencia(e, opts))
    .sort((a, b) => String(b.fecha_inicio || '').localeCompare(String(a.fecha_inicio || '')));
}

/** Separa lo que viaja a la tabla de lo que era solo para la pantalla. */
export function filaLimpia(fila) {
  const out = {};
  for (const [k, v] of Object.entries(fila || {})) if (!k.startsWith('_')) out[k] = v;
  return out;
}

// ── Verificación de citas (la misma aduana que las bases) ──────────

export function verificarCv(resultado, markdown) {
  const r = resultado && typeof resultado === 'object' ? resultado : {};
  const alertas = Array.isArray(r.alertas) ? [...r.alertas] : [];
  const marcar = (item, rotulo) => {
    const v = verificarCita(markdown, item.fuente_cita, item.fuente_pagina ?? item.pagina_desde ?? null);
    if (!v.verificada) alertas.push(`«${rotulo}»: ${v.motivo}. Revisar en el CV antes de guardarla.`);
    return {
      ...item,
      ...(v.paginaReal != null && item.pagina_desde == null ? { fuente_pagina: v.paginaReal } : {}),
      verificada: v.verificada, verificacion_motivo: v.motivo,
    };
  };
  const experiencias = (Array.isArray(r.experiencias) ? r.experiencias : [])
    .map(e => marcar(e, `${e.cargo || 'experiencia'} · ${e.entidad || ''}`.trim()));
  const documentos = (Array.isArray(r.documentos) ? r.documentos : [])
    .map(d => marcar(d, `${d.tipo || 'documento'} pág. ${d.pagina_desde ?? '?'}`));
  return { ...r, experiencias, documentos, alertas };
}

/**
 * Todo junto: del resultado crudo de las dos pasadas a lo que la pantalla
 * muestra y guarda.
 */
export function armarFicha({ ficha: resFicha, documentos = [], markdown = '', rubros = [] }) {
  const v = verificarCv({ ...(resFicha || {}), documentos }, markdown);
  const persona0 = aPersona(v);
  const ficha0 = aFicha(v);
  const { ficha, persona } = completarFichaConDocumentos(ficha0, persona0, v.documentos);
  const cruce = emparejarConstancias(v.experiencias, v.documentos);
  const filas = aFilasExperiencia(cruce.experiencias, { rubros });
  const alertas = [...v.alertas];
  if (!persona.dni) alertas.push('No se encontró el DNI: sin DNI la persona no se puede crear en el padrón.');
  if (!ficha.profesion) alertas.push('No se encontró la profesión.');
  if (cruce.nuevasDesdeConstancias) alertas.push(`${cruce.nuevasDesdeConstancias} constancia(s) certifican periodos que el currículum no declaraba: se agregan como experiencias.`);
  // Todo lo leído es DECLARADO. Decirlo una vez, con el número, evita que
  // alguien presente en un proceso lo que nadie comprobó.
  if (filas.length) {
    alertas.push(`Las ${filas.length} experiencias salen de lo que el CV declara. Ninguna cuenta como sustentada hasta que abras el CV y marques cuál está respaldada por su constancia.`);
  }
  return {
    persona, ficha, experiencias: filas, documentos: v.documentos, alertas, cruce,
    // Los campos de la ficha que hay que corroborar, con qué documento cada uno.
    porVerificar: CAMPOS_VERIFICABLES.map(c => ({ ...c, estado: 'pendiente' })),
  };
}

// ── Volver a leer el CV: qué CAMBIA, no qué pisa ───────────────────
//
// Gabriel, 8-set-2026: «debería el botón decir como volver a revisar con IA
// para ver mejoras. En caso de que encuentre cosas distintas o fallos, pues
// serviría eso, NO PARA QUE LO CAMBIE Y YA».
//
// Tiene razón y es la misma regla de todo el módulo: la IA propone, la persona
// decide. Releer un CV que ya se cargó no puede pisar en silencio un dato que
// alguien corrigió a mano o que ya verificó contra su constancia. Esto compara
// lo leído con lo guardado y devuelve las tres cosas que importan: lo que
// falta, lo que difiere, y lo que ya está igual.

const CAMPOS_FICHA_COMPARABLES = [
  ['profesion', 'Profesión'], ['titulo', 'Título'], ['universidad', 'Universidad'],
  ['anio_egreso', 'Año de egreso'], ['colegio', 'Colegio'], ['colegiatura_numero', 'N° de colegiatura'],
  ['colegiatura_fecha', 'Colegiado desde'], ['colegiatura_habil_hasta', 'Habilitado hasta'],
  ['ruc', 'RUC'], ['rnp_numero', 'RNP'], ['resumen', 'Resumen'],
];

const vacio = (v) => v == null || v === '' || (Array.isArray(v) && !v.length);

/** ¿Estas dos experiencias son la misma? Misma entidad y periodo que se pisa. */
export function mismaExperiencia(a, b) {
  if (!mismaEntidad(a.entidad, b.entidad, a.entidad_ruc, b.entidad_ruc)) return false;
  const ai = aDia(a.fecha_inicio), bi = aDia(b.fecha_inicio);
  if (ai == null || bi == null) return normalizar(a.cargo) === normalizar(b.cargo);
  return Math.abs(ai - bi) <= 45;
}

/**
 * Compara una lectura nueva contra lo que ya está guardado.
 * @returns {
 *   campos:   [{ campo, label, actual, leido, estado }]  estado: falta|difiere|igual
 *   nuevas:   experiencias que no estaban
 *   yaEstan:  cuántas coinciden con una guardada
 *   cursos:   capacitaciones que no estaban
 *   hayAlgo:  si vale la pena mostrar algo
 * }
 */
export function compararCv({ fichaActual = {}, experienciasActuales = [], leido = {} }) {
  const fl = leido.ficha || {};
  const campos = CAMPOS_FICHA_COMPARABLES.map(([campo, label]) => {
    const actual = fichaActual?.[campo] ?? null;
    const nuevo = fl[campo] ?? null;
    if (vacio(nuevo)) return null;
    const estado = vacio(actual) ? 'falta'
      : (normalizar(String(actual)) === normalizar(String(nuevo)) ? 'igual' : 'difiere');
    return { campo, label, actual, leido: nuevo, estado };
  }).filter(Boolean);

  const vivas = (experienciasActuales || []).filter(e => !e.deleted_at);
  const nuevas = [], yaEstan = [];
  for (const e of (leido.experiencias || [])) {
    (vivas.some(x => mismaExperiencia(x, e)) ? yaEstan : nuevas).push(e);
  }

  const yaCursos = new Set((fichaActual?.capacitaciones || []).map(c => normalizar(c.nombre).slice(0, 80)));
  const cursos = (fl.capacitaciones || []).filter(c => !yaCursos.has(normalizar(c.nombre).slice(0, 80)));

  return {
    campos, nuevas, yaEstan: yaEstan.length, cursos,
    hayAlgo: campos.some(c => c.estado !== 'igual') || nuevas.length > 0 || cursos.length > 0,
  };
}

export default {
  compararCv, mismaExperiencia,
  normalizarFechaCv, separarNombre, aPersona, aFicha, aCapacitaciones, colegioDeProfesion,
  PALABRAS_RUBRO, proponerRubro, TIPOS_SUSTENTO_TRABAJO, mismaEntidad, emparejarConstancias,
  completarFichaConDocumentos, aFilaExperiencia, aFilasExperiencia, filaLimpia, verificarCv,
  armarFicha, sustentoEsperadoDe, sustentoEsperadoCurso, CAMPOS_VERIFICABLES,
};
