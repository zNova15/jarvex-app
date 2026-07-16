import React from "react";
import { getPeriod, PERIODO_LABEL, JxIcon } from "./jx-reportes-shared.jsx";
import { MovimientosView } from "./jx-reportes-movimientos.jsx";
import { AvanceView } from "./jx-reportes-avance.jsx";
import { ContableView } from "./jx-reportes-contable.jsx";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

// Familias de reporte. Cada una gateada por su PERMISO real (la matriz), no por
// una lista de roles paralela. La página ya está gateada por módulo 'Reportes'.
const FAMILIAS = [
  { id: 'movimientos', label: 'Movimientos de Insumos', icon: 'package', ambitoObra: true,
    puede: (rol) => rol === 'admin' || (window.__hasPerm?.(rol, 'Mov. Materiales', 'r') ?? false) },
  { id: 'avance', label: 'Avance Técnico', icon: 'hardHat', ambitoObra: true,
    puede: (rol) => rol === 'admin' || (window.__hasPerm?.(rol, 'Avance', 'r') ?? false) },
  { id: 'contable', label: 'Contable', icon: 'dollar', ambitoObra: false,
    puede: (rol) => rol === 'admin' || (window.__hasPerm?.(rol, 'Movs. Contables', 'r') ?? false) },
];

function loadHistorial() { try { return JSON.parse(localStorage.getItem('reportes_historial') || '[]'); } catch { return []; } }
function saveHistorial(a) { try { localStorage.setItem('reportes_historial', JSON.stringify(a)); } catch {} }

const DIAS_SEMANA = [['1','Lunes'],['2','Martes'],['3','Miércoles'],['4','Jueves'],['5','Viernes'],['6','Sábado'],['7','Domingo']];

// Config del email programado (tabla reportes_email_config, leída/escrita directo
// en Supabase — no está en Dexie). El envío lo hace n8n a las 18:00 (hora Lima).
function EmailConfigModal({ onClose, showToast }) {
  const Modal = window.Modal;
  const [cfg, setCfg] = uS(null);
  const [destText, setDestText] = uS('');
  const [busy, setBusy] = uS(false);
  uE(() => {
    (async () => {
      try {
        const { data, error } = await window.__supabase.from('reportes_email_config').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (error) throw error;
        const c = data || { activo: true, frecuencia: 'diario', dia_semana: 1, destinatarios: [], incluir: ['movimientos', 'contable'] };
        setCfg(c); setDestText((c.destinatarios || []).join('\n'));
      } catch (e) { showToast('No se pudo cargar la configuración: ' + (e.message || e), 'red'); onClose(); }
    })();
  }, []);
  const guardar = async () => {
    if (!cfg) return;
    const destinatarios = destText.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    const invalido = destinatarios.find(d => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d));
    if (invalido) { showToast(`Correo inválido: ${invalido}`, 'red'); return; }
    if (cfg.activo && !destinatarios.length) { showToast('Agregá al menos un correo (o desactivá el envío)', 'red'); return; }
    setBusy(true);
    try {
      const patch = { activo: !!cfg.activo, frecuencia: cfg.frecuencia, dia_semana: Number(cfg.dia_semana) || 1, destinatarios, updated_at: new Date().toISOString() };
      const res = cfg.id
        ? await window.__supabase.from('reportes_email_config').update(patch).eq('id', cfg.id)
        : await window.__supabase.from('reportes_email_config').insert(patch);
      if (res.error) throw res.error;
      showToast('Configuración de email guardada', 'green');
      onClose();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };
  if (!Modal) return null;
  if (!cfg) return <Modal title="Reporte por email" icon="chart" onClose={onClose}><div style={{ padding: 20, color: 'var(--tm)' }}>Cargando…</div></Modal>;
  return (
    <Modal title="Reporte diario por email" icon="chart" onClose={onClose}>
      <div style={{ background: 'rgba(52,152,219,0.08)', border: '1px solid rgba(52,152,219,0.25)', borderRadius: 6, padding: '9px 12px', fontSize: 11.5, color: 'var(--ts)', marginBottom: 14 }}>
        Se envía automáticamente por n8n a las <strong>18:00 (hora Lima)</strong> un resumen con los movimientos del día por obra y la bancarización pendiente. El PDF completo sigue siendo descarga manual desde acá.
      </div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id="ec-activo" checked={!!cfg.activo} onChange={e => setCfg({ ...cfg, activo: e.target.checked })} />
        <label htmlFor="ec-activo" style={{ fontSize: 13, fontWeight: 600, color: 'var(--tp)' }}>Envío automático activo</label>
      </div>
      <div className="g2">
        <div>
          <label className="flabel">Frecuencia</label>
          <select className="fi" value={cfg.frecuencia} onChange={e => setCfg({ ...cfg, frecuencia: e.target.value })}>
            <option value="diario">Todos los días</option>
            <option value="cada_3_dias">Cada 3 días</option>
            <option value="semanal">Semanal</option>
          </select>
        </div>
        {cfg.frecuencia === 'semanal' && (
          <div>
            <label className="flabel">Día de la semana</label>
            <select className="fi" value={String(cfg.dia_semana || 1)} onChange={e => setCfg({ ...cfg, dia_semana: e.target.value })}>
              {DIAS_SEMANA.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )}
        <div style={{ gridColumn: '1/-1' }}>
          <label className="flabel">Correos que reciben <span style={{ color: 'var(--tm)', fontWeight: 400 }}>(uno por línea)</span></label>
          <textarea className="fi" rows={4} value={destText} onChange={e => setDestText(e.target.value)} placeholder={'admin@empresa.com\ngerencia@empresa.com'} />
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="btn btn-amber" disabled={busy} onClick={guardar}><JxIcon name="check" size={13} />{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </Modal>
  );
}

function ReportesPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth ? window.__useAuth() : {};
  const rol = auth?.profile?.rol || '';
  const userName = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || 'Usuario';

  const familias = uM(() => FAMILIAS.filter(f => f.puede(rol)), [rol]);
  const [familiaId, setFamiliaId] = uS(() => familias[0]?.id || null);
  const familia = uM(() => familias.find(f => f.id === familiaId) || familias[0] || null, [familias, familiaId]);
  const [tab, setTab] = uS('dashboard');

  const { data: obras } = window.__hooks?.useObras?.() || { data: [] };
  const { data: personal } = window.__hooks?.usePersonal?.(undefined) || { data: [] };
  const { data: subcontratistas } = window.__hooks?.useSubcontratistas?.() || { data: [] };

  const [obraId, setObraId] = uS(() => window.__getObraActivaId?.() || '');
  const [periodo, setPeriodo] = uS('mes');
  const [customFrom, setCustomFrom] = uS('');
  const [customTo, setCustomTo] = uS('');
  const [historial, setHistorial] = uS(loadHistorial());
  const [emailCfgOpen, setEmailCfgOpen] = uS(false);

  const { data: frentes } = window.__hooks?.useFrentesObra?.(obraId, { soloActivas: false }) || { data: [] };
  const [companies, setCompanies] = uS([]);
  uE(() => { window.__db.companies.filter(c => !c.deleted_at).toArray().then(setCompanies).catch(() => setCompanies([])); }, []);

  const obrasVivas = uM(() => (obras || []).filter(o => !o.deleted_at), [obras]);
  uE(() => { if (!obraId && obrasVivas.length) setObraId(obrasVivas[0].id); }, [obrasVivas, obraId]);
  const obraActual = uM(() => obrasVivas.find(o => o.id === obraId), [obrasVivas, obraId]);

  const personalById = uM(() => { const m = new Map(); (personal || []).forEach(p => m.set(p.id, p)); return m; }, [personal]);
  const subById = uM(() => { const m = new Map(); (subcontratistas || []).forEach(s => m.set(s.id, s)); return m; }, [subcontratistas]);
  const frenteById = uM(() => { const m = new Map(); (frentes || []).forEach(f => m.set(f.id, f.nombre || '—')); return m; }, [frentes]);
  const obrasById = uM(() => { const m = new Map(); obrasVivas.forEach(o => m.set(o.id, o)); return m; }, [obrasVivas]);
  const companiesById = uM(() => { const m = new Map(); companies.forEach(c => m.set(c.id, c)); return m; }, [companies]);
  const company = uM(() => companies.find(c => c.status === 'activa') || companies[0] || {}, [companies]);

  const period = uM(() => getPeriod(periodo, customFrom, customTo), [periodo, customFrom, customTo]);

  const pushHistorial = (entry) => { const upd = [entry, ...historial].slice(0, 100); setHistorial(upd); saveHistorial(upd); };

  const ctx = {
    obraId, obraActual, period, periodoLabel: PERIODO_LABEL[periodo], periodo,
    company, userName, showToast: toast, pushHistorial,
    personalById, subById, frenteById, obrasById, companiesById,
  };

  if (!familias.length) {
    return <div className="page-wrap"><div className="card card-p empty-state"><JxIcon name="chart" size={40} color="var(--tm)" /><p>Tu rol no tiene reportes asignados por ahora.</p></div></div>;
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Reportes</div>
          <div className="pg-sub">Dashboard interactivo y exportación a PDF</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {rol === 'admin' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setEmailCfgOpen(true)} title="Configurar el envío automático de reportes por email">
              <JxIcon name="bell" size={13} /> Envío por email
            </button>
          )}
          {['dashboard', 'historial'].map(t => (
            <button key={t} onClick={() => setTab(t)} className={`btn ${tab === t ? 'btn-amber' : 'btn-ghost'} btn-sm`} style={{ textTransform: 'capitalize' }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Familias */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {familias.map(f => (
          <button key={f.id} className={`btn btn-sm ${familia?.id === f.id ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setFamiliaId(f.id)}>
            <JxIcon name={f.icon} size={12} /> {f.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && (<>
        {/* Controles compartidos */}
        <div className="card card-p" style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {familia?.ambitoObra && (
            <div style={{ flex: '1 1 240px', minWidth: 200 }}>
              <label className="flabel">Obra</label>
              <select className="fi" value={obraId} onChange={e => setObraId(e.target.value)}>
                {obrasVivas.length === 0 && <option value="">— Sin obras —</option>}
                {obrasVivas.map(o => <option key={o.id} value={o.id}>{o.nombre_obra || o.nombre}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: '0 0 160px' }}>
            <label className="flabel">Período</label>
            <select className="fi" value={periodo} onChange={e => setPeriodo(e.target.value)}>
              <option value="dia">Hoy</option><option value="semana">Semana actual</option>
              <option value="mes">Mes actual</option><option value="acumulado">Acumulado</option>
              <option value="custom">Rango personalizado</option>
            </select>
          </div>
          {periodo === 'custom' && <>
            <div style={{ flex: '0 0 140px' }}><label className="flabel">Desde</label><input type="date" className="fi" value={customFrom} onChange={e => setCustomFrom(e.target.value)} /></div>
            <div style={{ flex: '0 0 140px' }}><label className="flabel">Hasta</label><input type="date" className="fi" value={customTo} onChange={e => setCustomTo(e.target.value)} /></div>
          </>}
        </div>

        {familia?.id === 'movimientos' && <MovimientosView ctx={ctx} />}
        {familia?.id === 'avance' && <AvanceView ctx={ctx} />}
        {familia?.id === 'contable' && <ContableView ctx={ctx} />}
      </>)}

      {tab === 'historial' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 10 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { if (confirm('¿Limpiar historial?')) { setHistorial([]); saveHistorial([]); } }}><JxIcon name="trash" size={12} /> Limpiar</button>
          </div>
          <table className="tbl">
            <thead><tr><th>Reporte</th><th>Obra / Ámbito</th><th>Generado</th><th>Usuario</th><th>Tipo</th></tr></thead>
            <tbody>
              {historial.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--tm)' }}>Sin reportes generados aún</td></tr>
              ) : historial.map((h, i) => (
                <tr key={i}><td className="col-p"><JxIcon name="file" size={13} color="var(--red)" /> {h.nombre}</td><td className="col-m">{h.obra || '—'}</td><td className="col-m">{h.fecha}</td><td>{h.user}</td><td><span className="badge b-red">{h.formato}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {emailCfgOpen && <EmailConfigModal onClose={() => setEmailCfgOpen(false)} showToast={toast} />}
    </div>
  );
}

Object.assign(window, { ReportesPage });
