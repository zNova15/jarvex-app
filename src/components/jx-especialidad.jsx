// ═══════════════════════════════════════════════════════════════════
// JARVEX — Gestiones de especialidad (Fase 1).
//
//  · ReporteEspecialidadPage: el ingeniero especialista (seguridad/ambiental/
//    calidad/social) presenta su REPORTE DIARIO con descripción + fotos.
//    El área se infiere del rol; admin/residente ven todas (lectura + filtro).
//  · PanelResidentePage: tablero del Residente de Obra — cumplimiento de
//    reportes de HOY (ingenieros de frente + especialistas), personal obrero
//    activo y accesos. SIN nada de dinero.
//
// reportes_especialidad se escribe directo a Dexie con sync fields (patrón
// reportes_dia). Fotos → evidencias modulo 'reportes_especialidad'.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { hoyLocal } from "../lib/fecha.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

export const AREA_POR_ROL = {
  prevencionista: 'seguridad',
  ing_ambiental: 'ambiental',
  ing_calidad: 'calidad',
  ing_social: 'social',
};
const AREAS = [
  { key: 'seguridad', label: 'Seguridad (SSOMA)', icon: 'shield', color: '#E74C3C' },
  { key: 'ambiental', label: 'Ambiental', icon: 'map', color: '#2ECC71' },
  { key: 'calidad', label: 'Calidad', icon: 'checkCircle', color: '#3498DB' },
  { key: 'social', label: 'Social', icon: 'users', color: '#9B59B6' },
];
const AREA_META = Object.fromEntries(AREAS.map(a => [a.key, a]));

function useObraActivaLocal() {
  const [obraId, setObraId] = uS(() => window.__getObraActivaId?.() || null);
  uE(() => {
    const on = () => setObraId(window.__getObraActivaId?.() || null);
    window.addEventListener('obra_activa_change', on);
    return () => window.removeEventListener('obra_activa_change', on);
  }, []);
  return obraId;
}

async function cargarReportes(obraId) {
  try {
    return await window.__db.reportes_especialidad
      .where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray();
  } catch { return []; }
}

// ── Reporte diario del especialista ─────────────────────────────────
function ReporteEspecialidadPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id || 'offline';
  const userName = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || '';
  const obraId = useObraActivaLocal();

  const miArea = AREA_POR_ROL[rol] || null;           // especialista → su área
  const veTodas = !miArea;                             // admin / residente / otros con acceso
  const [areaFiltro, setAreaFiltro] = uS('todas');

  const [reportes, setReportes] = uS([]);
  const [fecha, setFecha] = uS(() => hoyLocal());
  const [descripcion, setDescripcion] = uS('');
  const [fotos, setFotos] = uS([]);
  const [busy, setBusy] = uS(false);

  const recargar = async () => { if (obraId) setReportes(await cargarReportes(obraId)); };
  uE(() => {
    recargar();
    let deb; const on = (e) => { const t = e?.detail?.tabla; if (t && t !== 'reportes_especialidad' && t !== 'evidencias') return; clearTimeout(deb); deb = setTimeout(recargar, 400); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId]);

  const [perfiles, setPerfiles] = uS(() => new Map());
  uE(() => { window.__db.profiles.toArray().then(ps => setPerfiles(new Map(ps.map(p => [p.id, `${p.nombres || ''} ${p.apellidos || ''}`.trim() || p.email])))).catch(() => {}); }, []);

  const lista = uM(() => {
    let f = [...reportes];
    if (miArea) f = f.filter(r => r.area === miArea);
    else if (areaFiltro !== 'todas') f = f.filter(r => r.area === areaFiltro);
    return f.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }, [reportes, miArea, areaFiltro]);

  const yaReporteHoy = uM(() => !!miArea && reportes.some(r => r.area === miArea && r.fecha === hoyLocal() && r.responsable_id === userId), [reportes, miArea, userId]);

  const guardar = async () => {
    if (!obraId) { toast('Selecciona una obra activa', 'red'); return; }
    if (!miArea) { toast('Solo los ingenieros especialistas cargan reportes', 'red'); return; }
    if (descripcion.trim().length < 10) { toast('Contá qué se hizo hoy (mín. 10 caracteres)', 'red'); return; }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const id = window.__newId();
      await window.__db.reportes_especialidad.add({
        id, obra_id: obraId, area: miArea, fecha,
        descripcion: descripcion.trim(), responsable_id: userId,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_repesp_${id}`,
      });
      // Fotos como evidencias enlazadas al reporte.
      let subidas = 0;
      for (const f of fotos) {
        try {
          await window.__saveEvidenciaLocal?.({
            id: window.__newId(), obra_id: obraId,
            tipo_evidencia: 'foto_especialidad',
            modulo_relacionado: 'reportes_especialidad',
            registro_relacionado_id: id,
            nombre_archivo: f.name, mime_type: f.type, blob: f,
            fecha, observaciones: `Reporte ${miArea} · ${fecha}`,
            created_by: userId,
          });
          subidas++;
        } catch {}
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'reportes_especialidad' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast(`✓ Reporte de ${AREA_META[miArea].label} guardado${fotos.length ? ` · ${subidas}/${fotos.length} foto(s)` : ''}`, 'green');
      setDescripcion(''); setFotos([]); setFecha(hoyLocal());
      recargar();
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="shield" size={32} color="var(--tm)" /><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div className="pg-title">Reporte Diario {miArea ? `· ${AREA_META[miArea].label}` : 'de Especialidades'}</div>
        <div className="pg-sub">{miArea ? 'Registrá qué se hizo hoy en tu área — el Residente y el admin siguen tu cumplimiento.' : 'Reportes de seguridad, ambiental, calidad y social.'}</div>
      </div>

      {miArea && (
        <div className="card card-p" style={{ marginBottom: 16 }}>
          {yaReporteHoy && (
            <div style={{ background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: 'var(--ts)', marginBottom: 12 }}>
              ✓ Ya presentaste tu reporte de hoy. Podés agregar otro si hubo novedades.
            </div>
          )}
          <div className="g2">
            <div>
              <label className="flabel">Fecha</label>
              <input className="fi" type="date" value={fecha} max={hoyLocal()} onChange={e => setFecha(e.target.value)} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">¿Qué se hizo hoy? *</label>
              <textarea className="fi" rows={3} value={descripcion} onChange={e => setDescripcion(e.target.value)}
                placeholder="Ej: Charla de 5 min sobre trabajos en altura (18 asistentes), inspección de andamios frente B, entrega de 4 cascos nuevos…" />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label className="flabel">Fotos (opcional)</label>
              <input className="fi" type="file" accept="image/*" multiple onChange={e => setFotos([...(e.target.files || [])])} />
              {fotos.length > 0 && <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>{fotos.length} foto(s) seleccionada(s)</div>}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-amber" disabled={busy} onClick={guardar}>
              <JxIcon name="check" size={13} /> {busy ? 'Guardando…' : 'Guardar reporte'}
            </button>
          </div>
        </div>
      )}

      {veTodas && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${areaFiltro === 'todas' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setAreaFiltro('todas')}>Todas</button>
          {AREAS.map(a => (
            <button key={a.key} className={`btn btn-sm ${areaFiltro === a.key ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setAreaFiltro(a.key)}>
              <JxIcon name={a.icon} size={12} /> {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>
          {miArea ? 'Mis reportes' : 'Reportes'} · {lista.length}
        </div>
        <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)' }}>
          <table className="tbl">
            <thead><tr><th>Fecha</th>{veTodas && <th>Área</th>}<th>Descripción</th><th>Reportó</th></tr></thead>
            <tbody>
              {lista.length === 0 ? (
                <tr><td colSpan={veTodas ? 4 : 3} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>Sin reportes aún.</td></tr>
              ) : lista.map(r => {
                const meta = AREA_META[r.area] || {};
                return (
                  <tr key={r.id}>
                    <td className="col-m">{r.fecha}</td>
                    {veTodas && <td><span className="badge" style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}>{meta.label || r.area}</span></td>}
                    <td style={{ maxWidth: 420, whiteSpace: 'normal', fontSize: 12.5 }}>{r.descripcion}</td>
                    <td>{perfiles.get(r.responsable_id) || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Panel del Residente ─────────────────────────────────────────────
// Cargos considerados "personal obrero" (el residente y la ing. de seguridad
// solo gestionan estos). Comparación laxa: sin acentos, case-insensitive.
export const CARGOS_OBRERO = ['peon', 'oficial', 'operario'];
const esObrero = (cargo) => {
  const c = String(cargo || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return CARGOS_OBRERO.some(k => c === k || c.startsWith(k + ' '));
};

function PanelResidentePage({ showToast }) {
  const obraId = useObraActivaLocal();
  const hoy = hoyLocal();
  const [datos, setDatos] = uS({ avanceHoy: [], repDiaHoy: [], repEspHoy: [], especialistas: [], ingenieros: [], obreros: [] });

  uE(() => {
    if (!obraId) return;
    let cancel = false;
    const cargar = async () => {
      try {
        const [avance, repDia, repEsp, profiles, personal] = await Promise.all([
          window.__db.avance_obra.where('obra_id').equals(obraId).filter(r => !r.deleted_at && r.fecha === hoy).toArray().catch(() => []),
          window.__db.reportes_dia.where('obra_id').equals(obraId).filter(r => !r.deleted_at && r.fecha === hoy).toArray().catch(() => []),
          window.__db.reportes_especialidad.where('obra_id').equals(obraId).filter(r => !r.deleted_at && r.fecha === hoy).toArray().catch(() => []),
          window.__db.profiles.toArray().catch(() => []),
          window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray().catch(() => []),
        ]);
        if (cancel) return;
        const especialistas = profiles.filter(p => AREA_POR_ROL[p.rol] && p.activo !== false);
        const ingenieros = profiles.filter(p => p.rol === 'ingeniero' && p.activo !== false);
        const obreros = personal.filter(p => esObrero(p.cargo));
        setDatos({ avanceHoy: avance, repDiaHoy: repDia, repEspHoy: repEsp, especialistas, ingenieros, obreros });
      } catch {}
    };
    cargar();
    let deb; const on = () => { clearTimeout(deb); deb = setTimeout(cargar, 500); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, [obraId, hoy]);

  const nombreDe = (p) => `${p.nombres || ''} ${p.apellidos || ''}`.trim() || p.email || '—';

  // Cumplimiento de HOY por persona: ingenieros de frente (avance_obra o
  // reportes_dia "sin avance") y especialistas (reportes_especialidad).
  const filas = uM(() => {
    const out = [];
    const repIng = new Set([...datos.avanceHoy.map(a => a.responsable_id), ...datos.repDiaHoy.map(r => r.responsable_id)].filter(Boolean));
    for (const ing of datos.ingenieros) out.push({ nombre: nombreDe(ing), rolLbl: 'Ing. de frente', area: 'frente', reporto: repIng.has(ing.id) });
    const repEspPor = new Map();
    for (const r of datos.repEspHoy) repEspPor.set(r.responsable_id, r.area);
    for (const esp of datos.especialistas) {
      const area = AREA_POR_ROL[esp.rol];
      const meta = AREA_META[area] || {};
      out.push({ nombre: nombreDe(esp), rolLbl: meta.label || area, area, reporto: [...datos.repEspHoy].some(r => r.responsable_id === esp.id || r.area === area && r.responsable_id === esp.id) || repEspPor.has(esp.id) });
    }
    return out.sort((a, b) => Number(a.reporto) - Number(b.reporto) || a.nombre.localeCompare(b.nombre));
  }, [datos]);

  const cumplen = filas.filter(f => f.reporto).length;
  const obrerosActivos = datos.obreros.filter(p => p.activo !== false).length;

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="hardHat" size={32} color="var(--tm)" /><p>Selecciona una obra activa.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div className="pg-title">Panel del Residente</div>
        <div className="pg-sub">Cumplimiento de reportes de hoy ({hoy}) · personal obrero · accesos de gestión</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        {[
          { lbl: 'REPORTARON HOY', val: `${cumplen} / ${filas.length}`, color: cumplen === filas.length && filas.length > 0 ? 'var(--green)' : 'var(--amber)' },
          { lbl: 'AVANCES DE FRENTE HOY', val: datos.avanceHoy.length, color: 'var(--blue)' },
          { lbl: 'REPORTES ESPECIALIDAD HOY', val: datos.repEspHoy.length, color: 'var(--tp)' },
          { lbl: 'OBREROS ACTIVOS', val: `${obrerosActivos} / ${datos.obreros.length}`, color: 'var(--green)' },
        ].map((k, i) => (
          <div key={i} className="card card-p" style={{ borderLeft: `3px solid ${k.color}` }}>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', letterSpacing: '.05em' }}>{k.lbl}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: k.color, marginTop: 4 }}>{k.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('frentes')}><JxIcon name="flag" size={12} /> Frentes y partidas</button>
        <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('personal')}><JxIcon name="users" size={12} /> Personal (crear obrero)</button>
        <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('aprobaciones-reporte')}><JxIcon name="checkCircle" size={12} /> Aprobaciones</button>
        <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('reporte-especialidad')}><JxIcon name="shield" size={12} /> Reportes de especialidad</button>
        <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('avance')}><JxIcon name="chart" size={12} /> Avance de obra</button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 700, color: 'var(--tp)', borderBottom: '1px solid var(--border)' }}>¿Quién reportó hoy?</div>
        <table className="tbl">
          <thead><tr><th>Responsable</th><th>Rol / Área</th><th>Reporte de hoy</th></tr></thead>
          <tbody>
            {filas.length === 0 ? (
              <tr><td colSpan={3} style={{ textAlign: 'center', padding: 22, color: 'var(--tm)' }}>No hay ingenieros ni especialistas registrados como usuarios.</td></tr>
            ) : filas.map((f, i) => (
              <tr key={i}>
                <td className="col-p">{f.nombre}</td>
                <td style={{ fontSize: 12 }}>{f.rolLbl}</td>
                <td>{f.reporto ? <span className="badge b-green">✓ Presentado</span> : <span className="badge b-red">Pendiente</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

Object.assign(window, { ReporteEspecialidadPage, PanelResidentePage });
