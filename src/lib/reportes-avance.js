// ═══════════════════════════════════════════════════════════════════
// JARVEX — Reportes de Avance Técnico (núcleo de agregación).
//
// Se apoya en los reportes diarios de los ingenieros (avance_obra), los días
// SIN avance (reportes_dia), las metas de metrado (avance_metas) y las partidas
// (para valorizar el avance con precio_unitario_pres). El cálculo es PURO y
// testeable; la carga desde Dexie es una capa fina.
//
// Modelo (verificado):
//  · avance_obra: obra_id, partida_id, frente_id, fecha, metrado_ejecutado,
//    porcentaje_avance_reportado, responsable_id (USUARIO/profiles), evidencia_id.
//  · reportes_dia: obra_id, frente_id, fecha, motivo, responsable_id (día sin avance).
//  · avance_metas: obra_id, frente_id, partida_id, fecha, meta_metrado.
//  · partidas: metrado_contratado, metrado_ejecutado, precio_unitario_pres, costo_total_presupuestado.
// ═══════════════════════════════════════════════════════════════════

/** Carga y normaliza los insumos del reporte de avance para una obra. */
export async function cargarAvanceObra(db, obraId) {
  const safe = async (p) => { try { return await p; } catch { return []; } };
  const [avance, reportesDia, metas, partidas, profiles, fotosEvid] = await Promise.all([
    safe(db.avance_obra.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()),
    safe(db.reportes_dia.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()),
    safe(db.avance_metas.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()),
    safe(db.partidas.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()),
    safe(db.profiles.toArray()),
    // Las fotos del reporte NO viven en avance_obra.evidencia_id (legacy) sino en
    // la tabla evidencias con modulo 'avance_obra' + registro_relacionado_id = avance.id.
    safe(db.evidencias.filter(e => e.modulo_relacionado === 'avance_obra' && !e.deleted_at && e.registro_relacionado_id).toArray()),
  ]);
  const fotosPorAvance = new Set(fotosEvid.map(e => e.registro_relacionado_id));
  const partidasById = new Map();
  for (const p of partidas) {
    const pu = Number(p.precio_unitario_pres || 0) || (Number(p.metrado_contratado || 0) > 0 ? Number(p.costo_total_presupuestado || 0) / Number(p.metrado_contratado) : 0);
    partidasById.set(p.id, { nombre: p.nombre_partida || p.codigo_delfin || '—', codigo: p.codigo_delfin || '', precioUnit: pu });
  }
  const ingenierosById = new Map();
  for (const u of profiles) ingenierosById.set(u.id, `${u.nombres || ''} ${u.apellidos || ''}`.trim() || u.email || '(usuario)');
  return { avance, reportesDia, metas, partidasById, ingenierosById, fotosPorAvance };
}

const inRango = (f, from, to) => (!from || (f && f >= from)) && (!to || (f && f <= to));

/**
 * Agrega el avance técnico en KPIs, rankings y avance por frente. FUNCIÓN PURA.
 * @returns { kpis, topReportes, topAvance, ingenieros, porFrente, atrasos, detalle }
 */
export function agregarAvance({
  avance = [], reportesDia = [], metas = [],
  partidasById = new Map(), frentesById = new Map(), ingenierosById = new Map(),
  fotosPorAvance = new Set(),
  from = null, to = null, topN = 10,
} = {}) {
  const tieneFoto = (a) => fotosPorAvance.has(a.id) || !!a.evidencia_id;
  const av = avance.filter(a => inRango(a.fecha, from, to));
  const rd = reportesDia.filter(r => inRango(r.fecha, from, to));
  const mt = metas.filter(m => inRango(m.fecha, from, to));

  const valorDe = (a) => (Number(a.metrado_ejecutado) || 0) * (partidasById.get(a.partida_id)?.precioUnit || 0);
  const nombreIng = (id) => ingenierosById.get(id) || '(usuario)';
  const nombreFrente = (id) => (id ? (frentesById.get(id) || 'Frente') : 'Sin frente');

  // ── Por ingeniero (responsable_id = usuario) ──
  const porIng = new Map();
  for (const a of av) {
    const k = a.responsable_id || 'sin';
    const e = porIng.get(k) || { key: k, nombre: a.responsable_id ? nombreIng(a.responsable_id) : 'Sin responsable', reportes: 0, metrado: 0, valor: 0, diasSinAvance: 0, fotos: 0 };
    e.reportes += 1; e.metrado += Number(a.metrado_ejecutado) || 0; e.valor += valorDe(a);
    if (tieneFoto(a)) e.fotos += 1;
    porIng.set(k, e);
  }
  for (const r of rd) {
    const k = r.responsable_id || 'sin';
    const e = porIng.get(k) || { key: k, nombre: r.responsable_id ? nombreIng(r.responsable_id) : 'Sin responsable', reportes: 0, metrado: 0, valor: 0, diasSinAvance: 0, fotos: 0 };
    e.diasSinAvance += 1;
    porIng.set(k, e);
  }
  const ingenieros = [...porIng.values()];
  const topReportes = [...ingenieros].sort((a, b) => b.reportes - a.reportes).slice(0, topN);
  const topAvance = [...ingenieros].filter(e => e.valor > 0 || e.metrado > 0).sort((a, b) => b.valor - a.valor || b.metrado - a.metrado).slice(0, topN);

  // ── Por frente: real vs meta ──
  const porFr = new Map();
  const get = (id) => { const k = id || 'sin'; let e = porFr.get(k); if (!e) { e = { key: k, nombre: nombreFrente(id), metradoReal: 0, valor: 0, meta: 0, reportes: 0, diasSinAvance: 0 }; porFr.set(k, e); } return e; };
  for (const a of av) { const e = get(a.frente_id); e.metradoReal += Number(a.metrado_ejecutado) || 0; e.valor += valorDe(a); e.reportes += 1; }
  for (const m of mt) { const e = get(m.frente_id); e.meta += Number(m.meta_metrado) || 0; }
  for (const r of rd) { const e = get(r.frente_id); e.diasSinAvance += 1; }
  const porFrente = [...porFr.values()].map(e => ({ ...e, cumplimiento: e.meta > 0 ? e.metradoReal / e.meta : null })).sort((a, b) => b.metradoReal - a.metradoReal);
  // Atrasos: frentes con meta y cumplimiento < 90%.
  const atrasos = porFrente.filter(e => e.meta > 0 && (e.cumplimiento ?? 1) < 0.9).sort((a, b) => (a.cumplimiento ?? 0) - (b.cumplimiento ?? 0));

  const detalle = [...av].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));

  return {
    kpis: {
      reportes: av.length,
      diasConReporte: new Set(av.map(a => a.fecha)).size,
      metradoTotal: +av.reduce((s, a) => s + (Number(a.metrado_ejecutado) || 0), 0).toFixed(2),
      valorAvance: +av.reduce((s, a) => s + valorDe(a), 0).toFixed(2),
      diasSinAvance: rd.length,
      frentesActivos: new Set(av.map(a => a.frente_id).filter(Boolean)).size,
      ingenierosActivos: new Set(av.map(a => a.responsable_id).filter(Boolean)).size,
    },
    topReportes, topAvance, ingenieros: ingenieros.sort((a, b) => b.reportes - a.reportes),
    porFrente, atrasos, detalle,
  };
}
