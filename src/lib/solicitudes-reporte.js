// ═══════════════════════════════════════════════════════════════════
// Lógica pura de las SOLICITUDES DE REPORTE DE FRENTE AJENO.
// Un ingeniero pide permiso al admin/gerente para reportar un frente que no es
// suyo (titular ausente). Flujo de dos compuertas:
//   solicitado → aprobado → enviado → aceptado
// Al aceptar, el admin aplica los avances que el ingeniero cargó en el payload.
// ═══════════════════════════════════════════════════════════════════
import { rendimientoPartida } from './mi-frente.js';

export const SOL_ESTADOS = {
  solicitado: { label: 'Pendiente de aprobación', color: 'var(--amber)' },
  aprobado:   { label: 'Aprobado — cargá y enviá el reporte', color: 'var(--green)' },
  rechazado:  { label: 'Permiso rechazado', color: 'var(--red)' },
  enviado:    { label: 'Reporte enviado — esperando aceptación', color: 'var(--amber)' },
  aceptado:   { label: 'Reporte aceptado y aplicado', color: 'var(--green)' },
  devuelto:   { label: 'Reporte devuelto — corregí y reenviá', color: 'var(--red)' },
};
export const solEstadoInfo = (e) => SOL_ESTADOS[e] || { label: e || '—', color: 'var(--tm)' };

// El ingeniero puede cargar/editar el reporte mientras esté aprobado o devuelto.
export const puedeEditarReporte = (sol) => !!sol && (sol.estado === 'aprobado' || sol.estado === 'devuelto');
// Está esperando una decisión del admin (permiso o aceptación).
export const esperaDecision = (sol) => !!sol && (sol.estado === 'solicitado' || sol.estado === 'enviado');
// Estados terminales del lado del ingeniero (ya no edita): aceptado/rechazado.
export const esTerminal = (sol) => !!sol && (sol.estado === 'aceptado' || sol.estado === 'rechazado');

// La solicitud vigente para (frente, fecha, usuario): la más reciente no borrada.
export function solicitudActiva(solicitudes, { frenteId, fecha, userId }) {
  return (solicitudes || [])
    .filter(s => !s.deleted_at && s.frente_id === frenteId && s.fecha === fecha && s.solicitante_user_id === userId)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null;
}

// Para la bandeja del admin: las que requieren acción (pedido de permiso o reporte enviado).
export function solicitudesPendientes(solicitudes) {
  return (solicitudes || [])
    .filter(s => !s.deleted_at && (s.estado === 'solicitado' || s.estado === 'enviado'))
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
}

// Construye las filas de avance + actualizaciones de partida que el admin aplica
// al ACEPTAR un reporte de frente ajeno. El % se recalcula con el estado actual
// del avance real (no se confía en el pct del payload, que pudo quedar viejo).
export function construirAvancesDeSolicitud(sol, { partidas = [], avances = [], newId } = {}) {
  const byId = new Map((partidas || []).map(p => [p.id, p]));
  const lineas = Array.isArray(sol?.reporte_payload) ? sol.reporte_payload : [];
  const avanceRows = [];
  const partidaUpdates = [];
  for (const l of lineas) {
    if (!l || !l.partida_id) continue;
    const p = byId.get(l.partida_id);
    let pct = null;
    if (p) {
      const mc = Number(p.metrado_contratado) || 0;
      const r = rendimientoPartida(p, avances, sol.fecha);
      const real = (r.realAcum || 0) + (Number(l.metrado) || 0);
      if (mc > 0) pct = Math.max(0, Math.min(100, (real / mc) * 100));
    }
    if (pct != null) pct = Math.round(pct * 10) / 10;
    else if (l.pct != null && l.pct !== '') pct = Number(l.pct);
    avanceRows.push({
      id: newId ? newId() : undefined,
      obra_id: sol.obra_id, partida_id: l.partida_id, frente_id: sol.frente_id, fecha: sol.fecha,
      porcentaje_avance_reportado: pct,
      metrado_ejecutado: l.metrado != null && l.metrado !== '' ? Number(l.metrado) : null,
      descripcion: l.descripcion || null, responsable_id: sol.solicitante_user_id || null,
    });
    if (pct != null) partidaUpdates.push({ id: l.partida_id, porcentaje_avance: pct });
  }
  return { avanceRows, partidaUpdates };
}
