// ═══════════════════════════════════════════════════════════════════
// JARVEX — REGISTRO PROFESIONAL (para postular a procesos de selección)
//
// Pedido de Gabriel (1-sep) desde el equipo que busca obras y arma las
// propuestas. Dos pestañas:
//
//  · PROFESIONALES — la ficha de cada persona (profesión, colegiatura, CV) y
//    su experiencia como PERIODOS por rubro, cada uno con su constancia.
//  · BUSCAR PLANTEL — cargás los requisitos de las bases (cargo + profesión +
//    meses + rubro) y dice quién califica, a quién le falta poco y QUÉ le
//    falta. Es la pregunta que hoy se contesta revisando carpetas a mano.
//
// Los meses NUNCA se escriben: los calcula src/lib/experiencia-profesional.js
// fusionando periodos solapados (dos obras a la vez son un año, no dos) y
// contando aparte lo que tiene constancia, que es lo único presentable.
//
// La persona es la de `personal` (DNI único): un profesional que además está
// en planilla es UNA sola persona, no dos padrones que reconciliar.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  totalizarExperiencia, experienciaPorRubro, estadoColegiatura,
  buscarPlantel, formatearMeses,
} from "../lib/experiencia-profesional.js";
import { categoriaDe } from "../lib/personal-categoria.js";
import { getCurrentMode } from "../lib/app-mode-core.js";

const { useState: uS, useMemo: uM, useRef: uR } = React;

const COL_BADGE = {
  vigente:    { cls: 'b-green',  label: 'Habilitado' },
  por_vencer: { cls: 'b-amber',  label: 'Por vencer' },
  vencida:    { cls: 'b-red',    label: 'Colegiatura vencida' },
  sin_dato:   { cls: 'b-gray',   label: 'Sin dato de habilidad' },
};

const nombreDe = (p) => `${p?.nombres || ''} ${p?.apellidos || ''}`.trim() || '(sin nombre)';
const hoyLocal = () => (window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10));

function ProfesionalesPage({ showToast }) {
  const toast = showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = rol === 'admin' || (window.__hasPerm?.(rol, 'Registro Profesional', 'w') ?? false);

  const { data: personal } = window.__hooks.usePersonal();
  const { data: rubros } = window.__hooks.useRubrosObra();
  const { data: fichas } = window.__hooks.usePersonalProfesional();
  const { data: experiencias } = window.__hooks.usePersonalExperiencia();
  const { data: obras } = window.__hooks.useObras();

  const [tab, setTab] = uS('profesionales');   // profesionales | plantel
  const [q, setQ] = uS('');
  const [soloProfesionales, setSoloProfesionales] = uS(true);
  const [detalle, setDetalle] = uS(null);      // persona abierta
  const [busy, setBusy] = uS(false);
  // Guard SÍNCRONO contra doble click (regla crítica 2: el guard por estado
  // llega tarde, después del primer await a Dexie).
  const enCursoRef = uR(false);

  const hoy = hoyLocal();
  const esPrueba = getCurrentMode() === 'prueba';
  const rubroById = uM(() => new Map((rubros || []).map(r => [r.id, r])), [rubros]);
  const fichaPorPersona = uM(() => {
    const m = new Map();
    for (const f of (fichas || [])) if (!f.deleted_at) m.set(f.personal_id, f);
    return m;
  }, [fichas]);
  const expsPorPersona = uM(() => {
    const m = new Map();
    for (const e of (experiencias || [])) {
      if (e.deleted_at) continue;
      if (!m.has(e.personal_id)) m.set(e.personal_id, []);
      m.get(e.personal_id).push(e);
    }
    return m;
  }, [experiencias]);

  // Candidatos = personas + su ficha + su experiencia. Se arma una sola vez y
  // lo consumen las dos pestañas.
  const candidatos = uM(() => (personal || [])
    .filter(p => !p.deleted_at)
    .map(p => ({
      persona: p,
      ficha: fichaPorPersona.get(p.id) || null,
      experiencias: expsPorPersona.get(p.id) || [],
      categoria: categoriaDe(p, null)?.categoria,
    })), [personal, fichaPorPersona, expsPorPersona]);

  const listado = uM(() => {
    const t = q.trim().toLowerCase();
    return candidatos
      .filter(c => !soloProfesionales || c.categoria === 'profesionales' || c.ficha)
      .filter(c => !t || nombreDe(c.persona).toLowerCase().includes(t)
        || String(c.persona.dni || '').includes(t)
        || String(c.ficha?.profesion || '').toLowerCase().includes(t))
      .sort((a, b) => nombreDe(a.persona).localeCompare(nombreDe(b.persona)));
  }, [candidatos, q, soloProfesionales]);

  // ── Escrituras ───────────────────────────────────────────────────
  const marcaModo = esPrueba
    ? { demo: true, sync_status: 'synced' }
    : { sync_status: 'pending_create' };

  const guardarFicha = async (persona, campos) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      const existente = fichaPorPersona.get(persona.id);
      if (existente) {
        await window.__db.personal_profesional.update(existente.id, {
          ...campos, updated_at: ahora, updated_by: userId,
          version: (existente.version ?? 0) + 1,
          sync_status: existente.demo === true ? 'synced'
            : (existente.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
        });
      } else {
        const id = window.__newId();
        await window.__db.personal_profesional.add({
          id, personal_id: persona.id, ...campos,
          especialidades: campos.especialidades || [],
          created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
          idempotency_key: `prof_${persona.id}`,
          ...marcaModo,
        });
      }
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'personal_profesional' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast('Ficha guardada', 'green');
    } catch (e) {
      toast('No se pudo guardar la ficha: ' + (e?.message || e), 'red');
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  const guardarExperiencia = async (persona, exp, id = null) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      if (id) {
        const prev = (experiencias || []).find(x => x.id === id);
        await window.__db.personal_experiencia.update(id, {
          ...exp, updated_at: ahora, updated_by: userId,
          version: (prev?.version ?? 0) + 1,
          sync_status: prev?.demo === true ? 'synced'
            : (prev?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
        });
      } else {
        const nid = window.__newId();
        await window.__db.personal_experiencia.add({
          id: nid, personal_id: persona.id, ...exp,
          created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
          idempotency_key: `exp_${nid}`,
          ...marcaModo,
        });
      }
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'personal_experiencia' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast('Experiencia guardada', 'green');
    } catch (e) {
      toast('No se pudo guardar: ' + (e?.message || e), 'red');
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  const borrarExperiencia = async (row) => {
    if (!window.confirm(`¿Quitar la experiencia "${row.obra_nombre || row.cargo || ''}"?`)) return;
    try {
      const ahora = new Date().toISOString();
      await window.__db.personal_experiencia.update(row.id, {
        deleted_at: ahora, updated_at: ahora, updated_by: userId,
        version: (row.version ?? 0) + 1,
        sync_status: row.demo === true ? 'synced'
          : (row.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'personal_experiencia' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
    } catch (e) { toast('No se pudo quitar: ' + (e?.message || e), 'red'); }
  };

  // Adjuntar un archivo (CV o constancia). SIEMPRE por saveEvidenciaLocal —
  // es el único camino sancionado para evidencias en todo el repo.
  const adjuntar = async (file, { tipo, registroId, obs }) => {
    const evidenciaId = window.__newId();
    await window.__saveEvidenciaLocal({
      id: evidenciaId, obra_id: null, tipo_evidencia: tipo,
      modulo_relacionado: tipo === 'cv_profesional' ? 'personal_profesional' : 'personal_experiencia',
      registro_relacionado_id: registroId,
      nombre_archivo: file.name, mime_type: file.type || '', blob: file,
      fecha: hoy, created_by: userId, observaciones: obs,
      ...(esPrueba ? { demo: true } : {}),
    });
    try { window.dispatchEvent(new Event('online')); } catch {}
    return evidenciaId;
  };

  const verEvidencia = async (evidenciaId) => {
    try {
      const ev = await window.__db.evidencias.get(evidenciaId);
      if (!ev) return toast('El archivo todavía no está disponible en este equipo', 'amber');
      const { getEvidenciaSrc, abrirUrlEvidencia } = await import('../lib/evidencias-url.js');
      const r = await getEvidenciaSrc(ev);
      if (r?.url) abrirUrlEvidencia(r);
      else toast('El archivo aún no terminó de subir', 'amber');
    } catch (e) { toast('No se pudo abrir: ' + (e?.message || e), 'red'); }
  };

  return (
    <div className="page-wrap">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Registro Profesional</h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
            Qué profesionales tenemos, con cuánta experiencia por rubro y con qué sustento — para armar el plantel de una propuesta.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={`btn btn-sm ${tab === 'profesionales' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('profesionales')}>
            👷 Profesionales <span style={{ opacity: .7 }}>({listado.length})</span>
          </button>
          <button className={`btn btn-sm ${tab === 'plantel' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('plantel')}>
            🔎 Buscar plantel
          </button>
        </div>
      </div>

      {tab === 'profesionales' ? (
        <>
          <div className="card card-p" style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="fi" placeholder="Buscar por nombre, DNI o profesión…" value={q}
              onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <input type="checkbox" checked={soloProfesionales} onChange={e => setSoloProfesionales(e.target.checked)} />
              Solo profesionales
            </label>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Persona</th><th>Profesión</th><th>Colegiatura</th>
                  <th>Experiencia (sustentada)</th><th>CV</th><th></th>
                </tr></thead>
                <tbody>
                  {listado.length === 0 && (
                    <tr><td colSpan={6} className="empty-state" style={{ padding: '30px 0' }}>
                      {q ? 'Nadie coincide con la búsqueda.' : 'Todavía no hay profesionales cargados.'}
                    </td></tr>
                  )}
                  {listado.map(c => {
                    const col = estadoColegiatura(c.ficha, hoy);
                    const b = COL_BADGE[col.estado];
                    const t = totalizarExperiencia(c.experiencias, { hoy });
                    return (
                      <tr key={c.persona.id}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{nombreDe(c.persona)}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                            DNI {c.persona.dni || '—'}{c.persona.cargo ? ` · ${c.persona.cargo}` : ''}
                          </div>
                        </td>
                        <td style={{ fontSize: 11.5 }}>{c.ficha?.profesion || <span style={{ color: 'var(--tm)' }}>sin ficha</span>}</td>
                        <td>
                          <span className={`badge ${b.cls}`} style={{ fontSize: 9 }} title={c.ficha?.colegiatura_habil_hasta ? `Habilitado hasta ${c.ficha.colegiatura_habil_hasta}` : ''}>
                            {b.label}
                          </span>
                          {c.ficha?.colegiatura_numero && (
                            <div style={{ fontSize: 10, color: 'var(--tm)' }}>{c.ficha.colegio || 'CIP'} {c.ficha.colegiatura_numero}</div>
                          )}
                        </td>
                        <td style={{ fontSize: 11.5 }}>
                          {formatearMeses(t.meses)}
                          <div style={{ fontSize: 10, color: t.sinSustento ? 'var(--amber)' : 'var(--green)' }}>
                            {formatearMeses(t.mesesSustentados)} con constancia
                            {t.sinSustento > 0 ? ` · ${t.sinSustento} sin sustento` : ''}
                          </div>
                        </td>
                        <td>
                          {c.ficha?.cv_evidencia_id
                            ? <button className="btn btn-ghost btn-xs" style={{ color: 'var(--blue)' }} onClick={() => verEvidencia(c.ficha.cv_evidencia_id)}>📄 Ver CV</button>
                            : <span style={{ fontSize: 10.5, color: 'var(--amber)' }}>sin CV</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => setDetalle(c)}>Abrir ficha ›</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <BuscarPlantel candidatos={candidatos} rubros={rubros || []} hoy={hoy} onAbrir={setDetalle} />
      )}

      {detalle && (
        <FichaModal
          candidato={candidatos.find(c => c.persona.id === detalle.persona.id) || detalle}
          rubros={rubros || []} rubroById={rubroById} obras={obras || []} hoy={hoy}
          canWrite={canWrite} busy={busy}
          onClose={() => setDetalle(null)}
          onGuardarFicha={guardarFicha}
          onGuardarExperiencia={guardarExperiencia}
          onBorrarExperiencia={borrarExperiencia}
          onAdjuntar={adjuntar}
          onVerEvidencia={verEvidencia}
          toast={toast}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// BUSCAR PLANTEL — los requisitos de las bases contra el padrón
// ═══════════════════════════════════════════════════════════════════
const REQ_VACIO = { cargo: '', profesion: '', mesesMinimos: 60, rubroId: '', exigeColegiatura: true, exigeSustento: true };

function BuscarPlantel({ candidatos, rubros, hoy, onAbrir }) {
  const [reqs, setReqs] = uS([{ ...REQ_VACIO, cargo: 'Residente de Obra', profesion: 'Ingeniero Civil' }]);

  const upd = (i, patch) => setReqs(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const resultados = uM(
    () => buscarPlantel(candidatos, reqs.map(r => ({ ...r, rubroId: r.rubroId || null })), { hoy }),
    [candidatos, reqs, hoy]);

  return (
    <>
      <div className="card card-p" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>Requisitos del proceso</div>
        <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 8 }}>
          Copiá lo que piden las bases para cada puesto del plantel clave. Se evalúa contra la experiencia
          <b> con constancia</b>: es la única que se puede presentar.
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {reqs.map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end',
              padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8 }}>
              <div style={{ flex: '1 1 160px' }}>
                <label className="flabel">Cargo</label>
                <input className="fi" value={r.cargo} placeholder="Residente de Obra"
                  onChange={e => upd(i, { cargo: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 160px' }}>
                <label className="flabel">Profesión</label>
                <input className="fi" value={r.profesion} placeholder="Ingeniero Civil"
                  onChange={e => upd(i, { profesion: e.target.value })} />
              </div>
              <div style={{ width: 120 }}>
                <label className="flabel">Meses mínimos</label>
                <input className="fi" type="number" min="0" value={r.mesesMinimos}
                  onChange={e => upd(i, { mesesMinimos: Number(e.target.value) || 0 })} />
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label className="flabel">Rubro</label>
                <select className="fi" value={r.rubroId} onChange={e => upd(i, { rubroId: e.target.value })}>
                  <option value="">Cualquier rubro (experiencia general)</option>
                  {rubros.filter(x => x.activo !== false).map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}
                title="Si se apaga, cuenta también la experiencia declarada sin constancia adjunta">
                <input type="checkbox" checked={r.exigeSustento} onChange={e => upd(i, { exigeSustento: e.target.checked })} />
                Solo con constancia
              </label>
              {reqs.length > 1 && (
                <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }}
                  onClick={() => setReqs(rs => rs.filter((_, j) => j !== i))}>✕</button>
              )}
            </div>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
          onClick={() => setReqs(rs => [...rs, { ...REQ_VACIO }])}>+ Agregar puesto</button>
      </div>

      {resultados.map((res, i) => (
        <div key={i} className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
          <div style={{ padding: '9px 14px', background: 'var(--bg-c2)', fontSize: 12.5, fontWeight: 700 }}>
            {res.requisito.cargo || `Puesto ${i + 1}`}
            <span style={{ color: res.nCumplen ? 'var(--green)' : 'var(--red)', marginLeft: 8 }}>
              {res.nCumplen} {res.nCumplen === 1 ? 'califica' : 'califican'}
            </span>
            <span style={{ fontWeight: 400, color: 'var(--tm)', fontSize: 10.5, marginLeft: 8 }}>
              {res.requisito.profesion || 'cualquier profesión'} · {res.requisito.mesesMinimos} meses
            </span>
          </div>
          <div style={{ padding: '6px 14px', display: 'grid', gap: 5 }}>
            {res.candidatos.slice(0, 12).map(ev => (
              <div key={ev.persona.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap',
                paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: 15, lineHeight: 1.2 }} title={ev.cumple ? 'Califica' : 'No califica'}>
                  {ev.cumple ? '✅' : (ev.aplica ? '⚠️' : '⛔')}
                </span>
                <div style={{ flex: '1 1 200px' }}>
                  <button className="btn btn-ghost btn-xs" style={{ padding: 0, fontWeight: 600 }} onClick={() => onAbrir(ev)}>
                    {nombreDe(ev.persona)}
                  </button>
                  <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                    {ev.ficha?.profesion || 'sin ficha'} · {formatearMeses(ev.mesesSustentados)} con constancia
                    {ev.meses !== ev.mesesSustentados ? ` (${formatearMeses(ev.meses)} declarados)` : ''}
                  </div>
                </div>
                <div style={{ flex: '2 1 260px', fontSize: 10.5 }}>
                  {ev.bloqueos.map((b, k) => (
                    <div key={k} style={{ color: 'var(--red)' }}>✕ {b}</div>
                  ))}
                  {ev.avisos.map((a, k) => (
                    <div key={k} style={{ color: 'var(--amber)' }}>• {a}</div>
                  ))}
                  {!ev.bloqueos.length && !ev.avisos.length && (
                    <div style={{ color: 'var(--green)' }}>Sin observaciones — listo para presentar</div>
                  )}
                </div>
              </div>
            ))}
            {res.candidatos.length === 0 && (
              <div className="empty-state" style={{ padding: '20px 0' }}>No hay personas cargadas todavía.</div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FICHA — datos profesionales + experiencia de una persona
// ═══════════════════════════════════════════════════════════════════
const EXP_VACIA = { entidad: '', obra_nombre: '', cargo: '', rubro_id: '', monto: '', moneda: 'PEN', fecha_inicio: '', fecha_fin: '', obra_id: '', observaciones: '' };

function FichaModal({ candidato, rubros, rubroById, obras, hoy, canWrite, busy,
                      onClose, onGuardarFicha, onGuardarExperiencia, onBorrarExperiencia,
                      onAdjuntar, onVerEvidencia, toast }) {
  const Modal = window.Modal;
  const { persona, ficha, experiencias } = candidato;
  // TODOS los hooks antes de cualquier early return (regla crítica 3).
  const [f, setF] = uS(() => ({
    profesion: ficha?.profesion || '', titulo: ficha?.titulo || '',
    universidad: ficha?.universidad || '', anio_egreso: ficha?.anio_egreso || '',
    colegio: ficha?.colegio || 'CIP', colegiatura_numero: ficha?.colegiatura_numero || '',
    colegiatura_habil_hasta: ficha?.colegiatura_habil_hasta || '',
    resumen: ficha?.resumen || '',
  }));
  const [nueva, setNueva] = uS({ ...EXP_VACIA });
  const [editando, setEditando] = uS(null);
  const [subiendo, setSubiendo] = uS(false);

  const porRubro = uM(() => experienciaPorRubro(experiencias, { hoy }), [experiencias, hoy]);
  const total = uM(() => totalizarExperiencia(experiencias, { hoy }), [experiencias, hoy]);
  const col = estadoColegiatura({ ...ficha, ...f }, hoy);

  if (!Modal) return null;

  const subirCV = async (file) => {
    if (!file) return;
    setSubiendo(true);
    try {
      const evId = await onAdjuntar(file, { tipo: 'cv_profesional', registroId: persona.id, obs: `CV de ${nombreDe(persona)}` });
      await onGuardarFicha(persona, { ...f, cv_evidencia_id: evId });
    } catch (e) { toast('No se pudo subir el CV: ' + (e?.message || e), 'red'); }
    finally { setSubiendo(false); }
  };

  const subirConstancia = async (file, expRow) => {
    if (!file) return;
    setSubiendo(true);
    try {
      const evId = await onAdjuntar(file, {
        tipo: 'constancia_experiencia', registroId: expRow.id,
        obs: `Constancia: ${expRow.obra_nombre || expRow.cargo || ''}`,
      });
      await onGuardarExperiencia(persona, { evidencia_id: evId }, expRow.id);
    } catch (e) { toast('No se pudo subir la constancia: ' + (e?.message || e), 'red'); }
    finally { setSubiendo(false); }
  };

  const guardarNueva = async () => {
    if (!nueva.fecha_inicio) return toast('La experiencia necesita al menos la fecha de inicio', 'red');
    await onGuardarExperiencia(persona, {
      ...nueva,
      rubro_id: nueva.rubro_id || null,
      obra_id: nueva.obra_id || null,
      monto: nueva.monto === '' ? null : Number(nueva.monto),
      fecha_fin: nueva.fecha_fin || null,
    }, editando);
    setNueva({ ...EXP_VACIA });
    setEditando(null);
  };

  return (
    <Modal title={`Ficha profesional — ${nombreDe(persona)}`} onClose={onClose} size="xl">
      <div style={{ display: 'grid', gap: 12 }}>

        {/* ── Datos profesionales ── */}
        <div className="card card-p">
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>Datos profesionales</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            <div><label className="flabel">Profesión</label>
              <input className="fi" value={f.profesion} disabled={!canWrite} placeholder="Ingeniero Civil"
                onChange={e => setF({ ...f, profesion: e.target.value })} /></div>
            <div><label className="flabel">Título</label>
              <input className="fi" value={f.titulo} disabled={!canWrite} onChange={e => setF({ ...f, titulo: e.target.value })} /></div>
            <div><label className="flabel">Universidad</label>
              <input className="fi" value={f.universidad} disabled={!canWrite} onChange={e => setF({ ...f, universidad: e.target.value })} /></div>
            <div><label className="flabel">Año de egreso</label>
              <input className="fi" type="number" value={f.anio_egreso} disabled={!canWrite}
                onChange={e => setF({ ...f, anio_egreso: e.target.value })} /></div>
            <div><label className="flabel">Colegio</label>
              <select className="fi" value={f.colegio} disabled={!canWrite} onChange={e => setF({ ...f, colegio: e.target.value })}>
                <option value="CIP">CIP (Ingenieros)</option>
                <option value="CAP">CAP (Arquitectos)</option>
                <option value="OTRO">Otro</option>
              </select></div>
            <div><label className="flabel">N° de colegiatura</label>
              <input className="fi" value={f.colegiatura_numero} disabled={!canWrite}
                onChange={e => setF({ ...f, colegiatura_numero: e.target.value })} /></div>
            <div><label className="flabel">Habilitado hasta</label>
              <input className="fi" type="date" value={f.colegiatura_habil_hasta} disabled={!canWrite}
                onChange={e => setF({ ...f, colegiatura_habil_hasta: e.target.value })} />
              <div style={{ fontSize: 10, marginTop: 2 }}>
                <span className={`badge ${COL_BADGE[col.estado].cls}`} style={{ fontSize: 9 }}>{COL_BADGE[col.estado].label}</span>
              </div></div>
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {canWrite && (
              <button className="btn btn-amber btn-sm" disabled={busy} onClick={() => onGuardarFicha(persona, f)}>
                Guardar ficha
              </button>
            )}
            {ficha?.cv_evidencia_id
              ? <button className="btn btn-ghost btn-sm" style={{ color: 'var(--blue)' }} onClick={() => onVerEvidencia(ficha.cv_evidencia_id)}>📄 Ver CV</button>
              : <span style={{ fontSize: 11, color: 'var(--amber)' }}>Sin CV adjunto</span>}
            {canWrite && (
              <label className="btn btn-ghost btn-sm" style={{ cursor: subiendo ? 'wait' : 'pointer' }}>
                {subiendo ? 'Subiendo…' : (ficha?.cv_evidencia_id ? '↻ Cambiar CV' : '⬆ Subir CV')}
                <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                  disabled={subiendo} onChange={e => { subirCV(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            )}
          </div>
        </div>

        {/* ── Resumen de experiencia por rubro ── */}
        <div className="card card-p">
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            Experiencia · {formatearMeses(total.meses)}
            <span style={{ fontWeight: 400, color: total.sinSustento ? 'var(--amber)' : 'var(--green)', marginLeft: 8, fontSize: 11 }}>
              {formatearMeses(total.mesesSustentados)} con constancia
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 8 }}>
            Los meses se calculan de los periodos: si dos obras se superponen, ese tiempo cuenta UNA vez.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[...porRubro.entries()].map(([rid, v]) => (
              <span key={rid} className="badge b-blue" style={{ fontSize: 9.5 }}
                title={`${formatearMeses(v.mesesSustentados)} con constancia`}>
                {rubroById.get(rid)?.nombre || 'Sin rubro'}: {formatearMeses(v.meses)}
              </span>
            ))}
            {porRubro.size === 0 && <span style={{ fontSize: 11, color: 'var(--tm)' }}>Todavía sin experiencia cargada.</span>}
          </div>
        </div>

        {/* ── Lista de experiencias ── */}
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Obra / Entidad</th><th>Cargo</th><th>Rubro</th><th>Periodo</th><th>Tiempo</th><th>Constancia</th><th></th>
              </tr></thead>
              <tbody>
                {(experiencias || []).length === 0 && (
                  <tr><td colSpan={7} className="empty-state" style={{ padding: '20px 0' }}>Sin experiencia cargada.</td></tr>
                )}
                {(experiencias || []).slice()
                  .sort((a, b) => String(b.fecha_inicio || '').localeCompare(String(a.fecha_inicio || '')))
                  .map(x => {
                    const t = totalizarExperiencia([x], { hoy });
                    return (
                      <tr key={x.id}>
                        <td style={{ fontSize: 11.5 }}>
                          <div style={{ fontWeight: 600 }}>{x.obra_nombre || '—'}</div>
                          <div style={{ fontSize: 10, color: 'var(--tm)' }}>{x.entidad || ''}{x.obra_id ? ' · obra del grupo' : ''}</div>
                        </td>
                        <td style={{ fontSize: 11.5 }}>{x.cargo || '—'}</td>
                        <td style={{ fontSize: 11 }}>{rubroById.get(x.rubro_id)?.nombre || <span style={{ color: 'var(--amber)' }}>sin rubro</span>}</td>
                        <td style={{ fontSize: 10.5 }}>{x.fecha_inicio || '?'} → {x.fecha_fin || 'en curso'}</td>
                        <td style={{ fontSize: 11 }}>{formatearMeses(t.meses)}</td>
                        <td>
                          {x.evidencia_id
                            ? <button className="btn btn-ghost btn-xs" style={{ color: 'var(--blue)' }} onClick={() => onVerEvidencia(x.evidencia_id)}>📎 Ver</button>
                            : canWrite ? (
                              <label className="btn btn-ghost btn-xs" style={{ color: 'var(--amber)', cursor: 'pointer' }}>
                                ⬆ Adjuntar
                                <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                                  disabled={subiendo} onChange={e => { subirConstancia(e.target.files?.[0], x); e.target.value = ''; }} />
                              </label>
                            ) : <span style={{ fontSize: 10, color: 'var(--amber)' }}>sin constancia</span>}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {canWrite && (
                            <>
                              <button className="btn btn-ghost btn-xs" title="Editar"
                                onClick={() => { setEditando(x.id); setNueva({
                                  entidad: x.entidad || '', obra_nombre: x.obra_nombre || '', cargo: x.cargo || '',
                                  rubro_id: x.rubro_id || '', monto: x.monto ?? '', moneda: x.moneda || 'PEN',
                                  fecha_inicio: x.fecha_inicio || '', fecha_fin: x.fecha_fin || '',
                                  obra_id: x.obra_id || '', observaciones: x.observaciones || '',
                                }); }}>✎</button>
                              <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} title="Quitar"
                                onClick={() => onBorrarExperiencia(x)}>✕</button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Alta / edición de experiencia ── */}
        {canWrite && (
          <div className="card card-p">
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
              {editando ? 'Editar experiencia' : 'Agregar experiencia'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <div><label className="flabel">Obra</label>
                <input className="fi" value={nueva.obra_nombre} onChange={e => setNueva({ ...nueva, obra_nombre: e.target.value })} /></div>
              <div><label className="flabel">Entidad / empresa</label>
                <input className="fi" value={nueva.entidad} onChange={e => setNueva({ ...nueva, entidad: e.target.value })} /></div>
              <div><label className="flabel">Cargo</label>
                <input className="fi" value={nueva.cargo} onChange={e => setNueva({ ...nueva, cargo: e.target.value })} /></div>
              <div><label className="flabel">Rubro</label>
                <select className="fi" value={nueva.rubro_id} onChange={e => setNueva({ ...nueva, rubro_id: e.target.value })}>
                  <option value="">(sin rubro)</option>
                  {rubros.filter(r => r.activo !== false).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select></div>
              <div><label className="flabel">Desde</label>
                <input className="fi" type="date" value={nueva.fecha_inicio} onChange={e => setNueva({ ...nueva, fecha_inicio: e.target.value })} /></div>
              <div><label className="flabel">Hasta <span style={{ color: 'var(--tm)' }}>(vacío = en curso)</span></label>
                <input className="fi" type="date" value={nueva.fecha_fin} onChange={e => setNueva({ ...nueva, fecha_fin: e.target.value })} /></div>
              <div><label className="flabel">Monto de la obra</label>
                <input className="fi" type="number" step="0.01" value={nueva.monto} onChange={e => setNueva({ ...nueva, monto: e.target.value })} /></div>
              <div><label className="flabel">¿Es una obra nuestra?</label>
                <select className="fi" value={nueva.obra_id} onChange={e => {
                  const o = (obras || []).find(x => x.id === e.target.value);
                  setNueva({
                    ...nueva, obra_id: e.target.value,
                    // Al elegir una obra del grupo se prellenan sus datos: la
                    // app ya los sabe, no hay por qué volver a tipearlos.
                    obra_nombre: o ? (o.nombre_obra || nueva.obra_nombre) : nueva.obra_nombre,
                    entidad: o ? (o.cliente || nueva.entidad) : nueva.entidad,
                    fecha_inicio: o?.fecha_inicio || nueva.fecha_inicio,
                    rubro_id: o?.rubro_id || nueva.rubro_id,
                  });
                }}>
                  <option value="">No (obra externa)</option>
                  {(obras || []).filter(o => !o.deleted_at).map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
                </select></div>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button className="btn btn-amber btn-sm" disabled={busy} onClick={guardarNueva}>
                {editando ? 'Guardar cambios' : '+ Agregar'}
              </button>
              {editando && (
                <button className="btn btn-ghost btn-sm" onClick={() => { setEditando(null); setNueva({ ...EXP_VACIA }); }}>Cancelar</button>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

Object.assign(window, { ProfesionalesPage });
