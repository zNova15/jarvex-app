// ═══════════════════════════════════════════════════════════════════
// JARVEX — Experiencia profesional para postular a procesos de selección.
//
// Responde la pregunta que hoy se contesta revisando carpetas a mano:
// "necesito un Residente, Ingeniero Civil, con 60 meses en saneamiento —
// ¿a quién puedo presentar y con qué sustento?".
//
// DOS REGLAS QUE DEFINEN TODO ESTE ARCHIVO:
//
// 1. LOS PERIODOS SOLAPADOS NO SE SUMAN DOS VECES. Quien estuvo en dos obras
//    a la vez tiene UN año, no dos. Sumar los periodos por separado infla el
//    total y es una observación segura en la evaluación; por eso todo pasa
//    por fusionarPeriodos() antes de contar.
//
// 2. LA EXPERIENCIA SUSTENTADA SE CUENTA APARTE. En un proceso real solo vale
//    lo que tiene constancia adjunta. Cada cálculo devuelve el total y el
//    sustentado por separado para que nadie presente un número que no puede
//    respaldar con un papel.
//
// 3. Y DESDE LA MIG 200, TRES NIVELES EN VEZ DE DOS: declarado, con archivo
//    adjunto, y VERIFICADO por una persona que miró el documento. El CV de un
//    profesional trae sus constancias adentro, así que «tiene archivo» dejó de
//    significar «está probado»: el archivo es el CV entero. Una experiencia
//    marcada 'sin_sustento' —se buscó el papel y no está— NO cuenta como
//    sustentada aunque tenga archivo. Las 'pendiente' se cuentan como antes,
//    para no cambiarle el número a nadie de un día para el otro, pero el
//    evaluador avisa cuántas son.
//
// CONVENCIÓN DE CONTEO: se cuentan DÍAS exactos (inclusive ambos extremos) y
// se expresan en meses a razón de 30 días = 1 mes. Está centralizado en
// DIAS_POR_MES: si las bases que postulan usan otro criterio, se cambia acá y
// todo el módulo lo sigue.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

export const DIAS_POR_MES = 30;

/** 'YYYY-MM-DD' → días desde época (UTC, sin hora). null si no parsea. */
function aDia(fecha) {
  const s = String(fecha || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Number.isNaN(t) ? null : Math.floor(t / 86400000);
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

/**
 * Normaliza una experiencia a un intervalo [ini, fin] en días.
 * fecha_fin vacía = sigue en curso → se cierra en `hoy`.
 * Devuelve null si no tiene inicio o si el rango es imposible.
 */
export function periodoDe(exp, hoy = hoyISO()) {
  const ini = aDia(exp?.fecha_inicio);
  if (ini == null) return null;
  const fin = aDia(exp?.fecha_fin) ?? aDia(hoy);
  if (fin == null || fin < ini) return null;
  return { ini, fin };
}

/**
 * Fusiona intervalos solapados o contiguos. La pieza central: sin esto,
 * dos obras simultáneas se contarían dos veces.
 * @param periodos [{ini, fin}] en días
 * @returns [{ini, fin}] ordenados y sin superposición
 */
export function fusionarPeriodos(periodos) {
  const ps = (periodos || []).filter(Boolean).slice().sort((a, b) => a.ini - b.ini || a.fin - b.fin);
  const out = [];
  for (const p of ps) {
    const ult = out[out.length - 1];
    // `p.ini <= ult.fin + 1` también une los contiguos (termina el 31 y
    // arranca el 1): son continuidad real, no dos periodos con un hueco.
    if (ult && p.ini <= ult.fin + 1) ult.fin = Math.max(ult.fin, p.fin);
    else out.push({ ini: p.ini, fin: p.fin });
  }
  return out;
}

/** Días totales de una lista de intervalos ya fusionados (ambos extremos inclusive). */
const diasDe = (periodos) => (periodos || []).reduce((t, p) => t + (p.fin - p.ini + 1), 0);

/** Días → meses con la convención del módulo (1 decimal). */
export const diasAMeses = (dias) => Math.round((Number(dias) || 0) / DIAS_POR_MES * 10) / 10;

/**
 * Experiencia total de un conjunto de periodos, con y sin sustento.
 * @param experiencias filas de personal_experiencia
 * @param opts { hoy?, filtro?: (exp) => bool }
 * @returns { dias, meses, diasSustentados, mesesSustentados, conSustento, sinSustento }
 */
export function totalizarExperiencia(experiencias, opts = {}) {
  const hoy = opts.hoy || hoyISO();
  const filtro = opts.filtro || (() => true);
  const vivas = (experiencias || []).filter(e => e && !e.deleted_at && filtro(e));

  const conPeriodo = vivas.map(e => ({ exp: e, per: periodoDe(e, hoy) })).filter(x => x.per);
  // 'sin_sustento' = alguien buscó el papel y NO está. Tener el archivo del CV
  // adjunto no lo convierte en probado (mig 200).
  const sustentadas = conPeriodo.filter(x => !!x.exp.evidencia_id && x.exp.verificacion !== 'sin_sustento');
  const verificadas = conPeriodo.filter(x => x.exp.verificacion === 'verificado');

  const dias = diasDe(fusionarPeriodos(conPeriodo.map(x => x.per)));
  const diasSust = diasDe(fusionarPeriodos(sustentadas.map(x => x.per)));
  const diasVerif = diasDe(fusionarPeriodos(verificadas.map(x => x.per)));
  return {
    dias, meses: diasAMeses(dias),
    diasSustentados: diasSust, mesesSustentados: diasAMeses(diasSust),
    diasVerificados: diasVerif, mesesVerificados: diasAMeses(diasVerif),
    conSustento: sustentadas.length,
    sinSustento: conPeriodo.length - sustentadas.length,
    conVerificacion: verificadas.length,
    // Las que están esperando que alguien mire su constancia.
    porVerificar: conPeriodo.filter(x => (x.exp.verificacion || 'pendiente') === 'pendiente').length,
    observadas: conPeriodo.filter(x => x.exp.verificacion === 'observado').length,
  };
}

/**
 * Meses por rubro (fusionando DENTRO de cada rubro).
 * @returns Map<rubroId, { meses, mesesSustentados, dias, diasSustentados, n }>
 */
export function experienciaPorRubro(experiencias, opts = {}) {
  const porRubro = new Map();
  for (const e of (experiencias || [])) {
    if (!e || e.deleted_at) continue;
    const k = e.rubro_id || '__sin_rubro';
    if (!porRubro.has(k)) porRubro.set(k, []);
    porRubro.get(k).push(e);
  }
  const out = new Map();
  for (const [k, exps] of porRubro) {
    const t = totalizarExperiencia(exps, opts);
    out.set(k, { ...t, n: exps.length });
  }
  return out;
}

// ── Colegiatura ────────────────────────────────────────────────────

export const COLEGIATURA_POR_VENCER_DIAS = 30;

/**
 * Estado de la habilidad del colegio profesional. Un profesional con la
 * colegiatura vencida NO se puede presentar, así que es un bloqueo duro.
 * @returns { estado: 'vigente'|'por_vencer'|'vencida'|'sin_dato', diasRestantes }
 */
export function estadoColegiatura(ficha, hoy = hoyISO()) {
  const hasta = aDia(ficha?.colegiatura_habil_hasta);
  const h = aDia(hoy);
  if (hasta == null || h == null) return { estado: 'sin_dato', diasRestantes: null };
  const diff = hasta - h;
  if (diff < 0) return { estado: 'vencida', diasRestantes: diff };
  if (diff <= COLEGIATURA_POR_VENCER_DIAS) return { estado: 'por_vencer', diasRestantes: diff };
  return { estado: 'vigente', diasRestantes: diff };
}

/**
 * Antigüedad como colegiado, en meses. Es con lo que las bases acreditan la
 * EXPERIENCIA GENERAL: «experiencia no menor de 03 años, sustentada con copia
 * de diploma de incorporación al Colegio respectivo».
 *
 * `colegiatura_habil_hasta` NO sirve para esto: dice si puede presentarse hoy,
 * no cuántos años lleva. Por eso la mig 198 agregó `colegiatura_fecha`.
 * @returns meses, o null si no hay fecha de colegiatura cargada
 */
export function mesesDesdeColegiatura(ficha, hoy = hoyISO()) {
  const desde = aDia(ficha?.colegiatura_fecha);
  const h = aDia(hoy);
  if (desde == null || h == null || h < desde) return null;
  return diasAMeses(h - desde + 1);
}

// ── Evaluación contra los requisitos de las bases ──────────────────

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * ¿La profesión del candidato satisface la que pide el requisito?
 * Comparación tolerante: las bases escriben "Ingeniero Civil" y la ficha
 * puede decir "Ing. Civil" o "INGENIERO CIVIL". Se exige que todas las
 * palabras significativas del requisito estén en la profesión del candidato.
 */
export function profesionCoincide(profesionCandidato, profesionRequerida) {
  const req = norm(profesionRequerida);
  if (!req) return true;                       // el requisito no pide profesión
  const cand = norm(profesionCandidato);
  if (!cand) return false;
  const abrev = cand.replace(/\bing\b\.?/g, 'ingeniero').replace(/\barq\b\.?/g, 'arquitecto');
  return req.split(/\s+/).filter(w => w.length > 2).every(w => abrev.includes(w));
}

/**
 * ¿El cargo de esta experiencia está entre los que las bases aceptan?
 *
 * Las bases no piden "Residente": piden «Residente de obra y/o Supervisor de
 * obra y/o Inspector de obra y/o Gerente de obra y/o …» — diez sinónimos por
 * puesto, distintos en cada puesto. Con la lista vacía no se filtra nada (las
 * bases no acotaron el cargo, o el requisito se cargó a mano sin la lista).
 *
 * Coincide si algún equivalente aparece dentro del cargo de la constancia o al
 * revés: la constancia dice "Ingeniero Residente de Obra" y las bases piden
 * "Residente de obra". Se compara sin tildes ni mayúsculas.
 */
export function cargoCoincide(cargoExperiencia, cargosEquivalentes) {
  const lista = (cargosEquivalentes || []).map(norm).filter(Boolean);
  if (!lista.length) return true;
  const c = norm(cargoExperiencia);
  if (!c) return false;
  return lista.some(eq => c.includes(eq) || eq.includes(c));
}

/**
 * Recorta un periodo a la ventana «en los últimos N años».
 * La experiencia que quedó afuera no cuenta, y la que entra a medias cuenta
 * solo por su parte de adentro.
 * @returns {ini, fin} recortado, o null si quedó entera afuera
 */
export function recortarAVentana(periodo, ventanaAnios, hoy = hoyISO()) {
  if (!periodo) return null;
  const n = Number(ventanaAnios) || 0;
  if (n <= 0) return periodo;                     // las bases no acotan
  const h = aDia(hoy);
  if (h == null) return periodo;
  const desde = h - Math.round(n * 365.25);
  const ini = Math.max(periodo.ini, desde);
  const fin = Math.min(periodo.fin, h);
  return fin < ini ? null : { ini, fin };
}

/**
 * Cuenta PARTICIPACIONES, que es otra pregunta que los meses.
 *
 * «Sustentar como mínimo 02 participaciones … por un plazo no menor a 02 meses
 * cada participación, en los últimos 10 años».
 *
 * LAS PARTICIPACIONES NO SE FUSIONAN. Es lo contrario de totalizarExperiencia():
 * dos obras simultáneas son UN año pero son DOS participaciones. Fusionarlas
 * acá contaría una sola y descalificaría a alguien que sí cumple; no fusionar
 * en los meses inflaría el total y es observable. Son dos reglas opuestas
 * sobre los mismos datos, y cada una está donde corresponde.
 *
 * @param opts { hoy, filtro, cargosEquivalentes, mesesPorParticipacion,
 *               ventanaAnios, exigeSustento }
 * @returns { n, nSustentadas, descartadasPorCorta, descartadasPorCargo }
 */
export function contarParticipaciones(experiencias, opts = {}) {
  const hoy = opts.hoy || hoyISO();
  const filtro = opts.filtro || (() => true);
  const minMeses = Number(opts.mesesPorParticipacion) || 0;
  let n = 0, nSust = 0, porCorta = 0, porCargo = 0;

  for (const e of (experiencias || [])) {
    if (!e || e.deleted_at || !filtro(e)) continue;
    if (!cargoCoincide(e.cargo, opts.cargosEquivalentes)) { porCargo++; continue; }
    const per = recortarAVentana(periodoDe(e, hoy), opts.ventanaAnios, hoy);
    if (!per) continue;                            // quedó fuera de la ventana
    if (diasAMeses(per.fin - per.ini + 1) < minMeses) { porCorta++; continue; }
    n++;
    if (e.evidencia_id && e.verificacion !== 'sin_sustento') nSust++;
  }
  return { n, nSustentadas: nSust, descartadasPorCorta: porCorta, descartadasPorCargo: porCargo };
}

/**
 * Evalúa UN candidato contra UN requisito del proceso.
 *
 * @param candidato { persona, ficha, experiencias }
 * @param requisito {
 *   cargo?           etiqueta del puesto ('Residente de Obra')
 *   profesion?       'Ingeniero Civil'
 *   mesesMinimos?    60
 *   rubroId?         null = cualquier rubro (experiencia general)
 *   exigeColegiatura?  default true
 *   exigeSustento?   default true → mide con los meses SUSTENTADOS
 *
 *   — criterios de la mig 198, todos APAGADOS por default: un requisito
 *     viejo se evalúa exactamente igual que antes —
 *   mesesGeneralesMinimos?  experiencia general, contra la colegiatura
 *   participacionesMinimas? «como mínimo 02 participaciones»
 *   mesesPorParticipacion?  «no menor a 02 meses cada participación»
 *   ventanaAnios?           «en los últimos 10 años»
 *   cargosEquivalentes?     los sinónimos de cargo que aceptan las bases
 * }
 * @returns {
 *   cumple, meses, mesesSustentados, mesesFaltantes,
 *   bloqueos[]   impiden presentarlo (profesión, colegiatura vencida, experiencia)
 *   avisos[]     no impiden pero hay que resolverlos (CV, constancias, por vencer)
 * }
 */
export function evaluarRequisito(candidato, requisito = {}, opts = {}) {
  const hoy = opts.hoy || hoyISO();
  const { persona, ficha, experiencias } = candidato || {};
  const exigeColegiatura = requisito.exigeColegiatura !== false;
  const exigeSustento = requisito.exigeSustento !== false;
  const minimo = Number(requisito.mesesMinimos) || 0;

  const bloqueos = [], avisos = [];

  // `aplica` = la profesión encaja. Es una distinción que importa para
  // ordenar: al que le faltan meses o una constancia se le puede conseguir;
  // el que tiene otra profesión NUNCA va a calificar para ESTE puesto.
  const aplica = !requisito.profesion || profesionCoincide(ficha?.profesion, requisito.profesion);
  if (!aplica) {
    bloqueos.push(ficha?.profesion
      ? `Es ${ficha.profesion} y se pide ${requisito.profesion}`
      : `Sin profesión registrada (se pide ${requisito.profesion})`);
  }

  const col = estadoColegiatura(ficha, hoy);
  if (exigeColegiatura) {
    if (col.estado === 'vencida') bloqueos.push(`Colegiatura vencida el ${ficha.colegiatura_habil_hasta}`);
    else if (col.estado === 'sin_dato') avisos.push('Falta la fecha de habilidad del colegio');
    else if (col.estado === 'por_vencer') avisos.push(`La colegiatura vence en ${col.diasRestantes} día(s)`);
    if (!ficha?.colegiatura_numero) avisos.push('Falta el número de colegiatura');
  }

  // EXPERIENCIA GENERAL: la que las bases acreditan con el diploma de
  // incorporación al colegio, no con constancias de obra. Es otro número que
  // los meses específicos de abajo.
  const minGeneral = Number(requisito.mesesGeneralesMinimos) || 0;
  const mesesGenerales = mesesDesdeColegiatura(ficha, hoy);
  if (minGeneral > 0) {
    if (mesesGenerales == null) {
      // No se puede afirmar que cumple ni que no: falta el dato. Se avisa y NO
      // se bloquea — bloquear por un campo vacío descartaría gente que sí
      // califica, que es el error caro de este módulo.
      avisos.push(`Falta la fecha de colegiatura para acreditar los ${formatearMeses(minGeneral)} de experiencia general`);
    } else if (mesesGenerales < minGeneral) {
      bloqueos.push(`Colegiado hace ${formatearMeses(mesesGenerales)} y se piden ${formatearMeses(minGeneral)} de experiencia general`);
    }
  }

  // Experiencia ESPECÍFICA: del rubro pedido, o toda si el requisito no lo
  // acota, y solo en los cargos que las bases aceptan.
  const porRubro = requisito.rubroId ? (e) => e.rubro_id === requisito.rubroId : () => true;
  const filtro = (e) => porRubro(e) && cargoCoincide(e.cargo, requisito.cargosEquivalentes);
  const t = totalizarExperiencia(experiencias, { hoy, filtro });
  const mesesQueCuentan = exigeSustento ? t.mesesSustentados : t.meses;
  const faltantes = Math.max(0, Math.round((minimo - mesesQueCuentan) * 10) / 10);

  if (minimo > 0 && mesesQueCuentan < minimo) {
    bloqueos.push(exigeSustento && t.meses >= minimo
      ? `Tiene ${t.meses} meses pero solo ${t.mesesSustentados} con constancia (faltan ${faltantes})`
      : `Tiene ${mesesQueCuentan} de los ${minimo} meses exigidos`);
  }

  // PARTICIPACIONES: la pregunta que el modelo viejo no hacía, y por la que
  // alguien con cinco años en UNA sola obra pasaba como calificado.
  const minPart = Number(requisito.participacionesMinimas) || 0;
  const part = contarParticipaciones(experiencias, {
    hoy, filtro: porRubro,
    cargosEquivalentes: requisito.cargosEquivalentes,
    mesesPorParticipacion: requisito.mesesPorParticipacion,
    ventanaAnios: requisito.ventanaAnios,
  });
  const partQueCuentan = exigeSustento ? part.nSustentadas : part.n;
  if (minPart > 0 && partQueCuentan < minPart) {
    const detalle = [];
    if (part.descartadasPorCorta) detalle.push(`${part.descartadasPorCorta} más corta(s) que ${formatearMeses(Number(requisito.mesesPorParticipacion) || 0)}`);
    if (part.descartadasPorCargo) detalle.push(`${part.descartadasPorCargo} en un cargo que las bases no aceptan`);
    if (exigeSustento && part.n > partQueCuentan) detalle.push(`${part.n - partQueCuentan} sin constancia`);
    bloqueos.push(`Tiene ${partQueCuentan} de las ${minPart} participaciones exigidas`
      + (detalle.length ? ` (${detalle.join('; ')})` : ''));
  }

  if (t.sinSustento > 0) avisos.push(`${t.sinSustento} experiencia(s) sin constancia adjunta`);
  // Lo que el CV declara y nadie comprobó todavía. No bloquea —descartar por
  // trabajo pendiente sería el error caro— pero tiene que verse antes de
  // escribir el nombre en un expediente.
  if (t.porVerificar > 0) avisos.push(`${t.porVerificar} experiencia(s) declaradas en el CV que nadie verificó contra su constancia`);
  if (t.observadas > 0) avisos.push(`${t.observadas} experiencia(s) con observaciones al revisar su constancia`);
  if (!ficha?.cv_evidencia_id) avisos.push('Sin CV adjunto');

  return {
    persona, ficha, aplica,
    cumple: bloqueos.length === 0,
    meses: t.meses,
    mesesSustentados: t.mesesSustentados,
    mesesVerificados: t.mesesVerificados,
    porVerificar: t.porVerificar,
    mesesFaltantes: faltantes,
    mesesGenerales,
    participaciones: partQueCuentan,
    participacionesFaltantes: Math.max(0, minPart - partQueCuentan),
    detalleParticipaciones: part,
    colegiatura: col,
    bloqueos, avisos,
  };
}

/**
 * Evalúa TODOS los candidatos contra TODOS los requisitos del proceso.
 * Ordena: primero los que cumplen (más experiencia arriba), después los que
 * están más cerca — a esos les falta poco y suele convenir conseguirles la
 * constancia antes que descartarlos.
 *
 * @returns [{ requisito, candidatos: [evaluación], nCumplen }]
 */
export function buscarPlantel(candidatos, requisitos, opts = {}) {
  return (requisitos || []).map(req => {
    const evaluados = (candidatos || [])
      .map(c => evaluarRequisito(c, req, opts))
      .sort((a, b) => {
        if (a.cumple !== b.cumple) return a.cumple ? -1 : 1;
        if (a.cumple) return b.mesesSustentados - a.mesesSustentados;
        // Entre los que NO cumplen: primero los que al menos APLICAN (a esos
        // les falta algo conseguible). Un profesional de otra carrera puede
        // tener 15 años y "no faltarle meses", pero jamás va a calificar para
        // este puesto: va al final, no arriba.
        if (a.aplica !== b.aplica) return a.aplica ? -1 : 1;
        return a.mesesFaltantes - b.mesesFaltantes || b.mesesSustentados - a.mesesSustentados;
      });
    return { requisito: req, candidatos: evaluados, nCumplen: evaluados.filter(e => e.cumple).length };
  });
}

/** Meses → "3 años 2 meses" para mostrar (las bases hablan así). */
export function formatearMeses(meses) {
  const m = Math.max(0, Number(meses) || 0);
  const anios = Math.floor(m / 12);
  const resto = Math.round((m - anios * 12) * 10) / 10;
  if (!anios) return `${resto} mes${resto === 1 ? '' : 'es'}`;
  if (!resto) return `${anios} año${anios === 1 ? '' : 's'}`;
  return `${anios} año${anios === 1 ? '' : 's'} ${resto} mes${resto === 1 ? '' : 'es'}`;
}
