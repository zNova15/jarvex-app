// ═══════════════════════════════════════════════════════════════════
// JARVEX — Obras asignadas a un usuario (tabla obra_usuarios, Supabase).
//
// obra_usuarios NO se sincroniza a Dexie → se consulta directo a Supabase.
// Devuelve el Set de obra_ids que el usuario puede ver, o `null` = sin
// restricción (admin/gerente, sin sesión, o sin asignaciones → ve todas).
// Mismo criterio que ObrasPage (jx-obra.jsx).
// ═══════════════════════════════════════════════════════════════════

export async function cargarObrasAsignadas({ userId, rol } = {}) {
  if (rol === 'admin' || rol === 'gerente' || !userId || userId === 'offline') return null;
  try {
    const sb = window.__supabase;
    if (!sb) return null;
    const { data, error } = await sb.from('obra_usuarios')
      .select('obra_id').eq('usuario_id', userId).eq('activo', true);
    if (error) { console.warn('[obras-asignadas] load falló:', error?.message); return null; }
    const ids = (data || []).map(r => r.obra_id).filter(Boolean);
    // Sin asignaciones (sin error) → ve todas (el admin acota desde Usuarios).
    return ids.length ? new Set(ids) : null;
  } catch { return null; }
}
