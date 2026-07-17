// ═══════════════════════════════════════════════════════════════════
// JARVEX — Fase 5: Gestión Social.
//
// El ing. social gestiona la relación obra↔comunidad: COMPROMISOS asumidos en
// actas (con vencimiento y semáforo), QUEJAS/RECLAMOS con seguimiento hasta el
// cierre, y el PADRÓN de actores sociales (autoridades, dirigentes). Las
// charlas comunitarias salen del Planificador compartido (charlas_plan área
// social, Fase 2). Funciones PURAS y testeables; la UI vive en jx-social.jsx.
// ═══════════════════════════════════════════════════════════════════

export const ESTADOS_COMPROMISO = ['pendiente', 'en_proceso', 'cumplido'];
export const TIPOS_QUEJA = ['queja', 'reclamo', 'sugerencia'];
export const ESTADOS_QUEJA = ['abierta', 'en_atencion', 'cerrada'];
export const TIPOS_ACTOR = ['autoridad', 'dirigente', 'institucion', 'vecino', 'otro'];

export const COMPROMISO_META = {
  pendiente: { label: 'Pendiente', badge: 'b-gray' },
  en_proceso: { label: 'En proceso', badge: 'b-blue' },
  cumplido: { label: '✓ Cumplido', badge: 'b-green' },
  por_vencer: { label: '⚠ Por vencer', badge: 'b-amber' },
  vencido: { label: '⛔ Vencido', badge: 'b-red' },
};
export const QUEJA_META = {
  abierta: { label: 'Abierta', badge: 'b-red' },
  en_atencion: { label: 'En atención', badge: 'b-amber' },
  cerrada: { label: '✓ Cerrada', badge: 'b-green' },
};
export const ACTOR_META = {
  autoridad: { label: 'Autoridad' }, dirigente: { label: 'Dirigente' },
  institucion: { label: 'Institución' }, vecino: { label: 'Vecino/a' }, otro: { label: 'Otro' },
};

/** Días entre dos 'YYYY-MM-DD' (b − a), por Date.UTC para esquivar TZ. */
export function diasEntre(a, b) {
  const [ay, am, ad] = String(a).slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = String(b).slice(0, 10).split('-').map(Number);
  if (![ay, am, ad, by, bm, bd].every(Number.isFinite)) return null;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * Estado EFECTIVO de un compromiso para el semáforo:
 * cumplido manda; si no, vencido (límite pasado), por_vencer (≤7 días) o el
 * estado guardado (pendiente/en_proceso). Sin fecha límite → estado guardado.
 */
export function estadoCompromiso(c, hoy) {
  if (!c) return 'pendiente';
  if (c.estado === 'cumplido') return 'cumplido';
  const base = ESTADOS_COMPROMISO.includes(c.estado) ? c.estado : 'pendiente';
  if (!c.fecha_limite) return base;
  const dias = diasEntre(hoy, c.fecha_limite);
  if (dias === null) return base;
  if (dias < 0) return 'vencido';
  if (dias <= 7) return 'por_vencer';
  return base;
}

/** Días que lleva abierta una queja (hasta su cierre si ya cerró). */
export function diasAbierta(q, hoy) {
  if (!q?.fecha) return null;
  const fin = q.estado === 'cerrada' && q.fecha_cierre ? q.fecha_cierre : hoy;
  const d = diasEntre(q.fecha, fin);
  return d === null ? null : Math.max(0, d);
}

/**
 * KPIs del panel social. PURA.
 * @returns { compromisos: {total, cumplidos, vencidos, por_vencer, abiertos},
 *            quejas: {total, abiertas, en_atencion, cerradas} }
 */
export function kpisSocial({ compromisos = [], quejas = [] } = {}, hoy) {
  const kc = { total: compromisos.length, cumplidos: 0, vencidos: 0, por_vencer: 0, abiertos: 0 };
  for (const c of compromisos) {
    const e = estadoCompromiso(c, hoy);
    if (e === 'cumplido') kc.cumplidos++;
    else if (e === 'vencido') kc.vencidos++;
    else if (e === 'por_vencer') { kc.por_vencer++; kc.abiertos++; }
    else kc.abiertos++;
  }
  const kq = { total: quejas.length, abiertas: 0, en_atencion: 0, cerradas: 0 };
  for (const q of quejas) {
    if (q.estado === 'cerrada') kq.cerradas++;
    else if (q.estado === 'en_atencion') kq.en_atencion++;
    else kq.abiertas++;
  }
  return { compromisos: kc, quejas: kq };
}
