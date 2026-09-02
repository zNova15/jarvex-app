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
  const sustentadas = conPeriodo.filter(x => !!x.exp.evidencia_id);

  const dias = diasDe(fusionarPeriodos(conPeriodo.map(x => x.per)));
  const diasSust = diasDe(fusionarPeriodos(sustentadas.map(x => x.per)));
  return {
    dias, meses: diasAMeses(dias),
    diasSustentados: diasSust, mesesSustentados: diasAMeses(diasSust),
    conSustento: sustentadas.length,
    sinSustento: conPeriodo.length - sustentadas.length,
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

  // Experiencia: del rubro pedido, o toda si el requisito no lo acota.
  const filtro = requisito.rubroId ? (e) => e.rubro_id === requisito.rubroId : () => true;
  const t = totalizarExperiencia(experiencias, { hoy, filtro });
  const mesesQueCuentan = exigeSustento ? t.mesesSustentados : t.meses;
  const faltantes = Math.max(0, Math.round((minimo - mesesQueCuentan) * 10) / 10);

  if (minimo > 0 && mesesQueCuentan < minimo) {
    bloqueos.push(exigeSustento && t.meses >= minimo
      ? `Tiene ${t.meses} meses pero solo ${t.mesesSustentados} con constancia (faltan ${faltantes})`
      : `Tiene ${mesesQueCuentan} de los ${minimo} meses exigidos`);
  }
  if (t.sinSustento > 0) avisos.push(`${t.sinSustento} experiencia(s) sin constancia adjunta`);
  if (!ficha?.cv_evidencia_id) avisos.push('Sin CV adjunto');

  return {
    persona, ficha, aplica,
    cumple: bloqueos.length === 0,
    meses: t.meses,
    mesesSustentados: t.mesesSustentados,
    mesesFaltantes: faltantes,
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
