// ═══════════════════════════════════════════════════════════════════
// JARVEX — POSTULACIONES (tanda 15, entrega 1).
//
// El bloque "Licitaciones" prometía desde la tanda 2 "el plantel profesional
// Y LOS TRABAJOS A LOS QUE NOS PRESENTAMOS". Esta es la segunda mitad.
//
// QUÉ CAMBIA RESPECTO DE LO QUE YA HABÍA. El verificador de requisitos
// mínimos ya existía (Registro Profesional › Buscar plantel, mig 171), pero
// los requisitos se tipeaban de cero cada vez y se perdían al cerrar la
// pestaña. Servía para una consulta suelta, no para trabajar: nadie podía
// volver mañana a ver contra qué proceso se había evaluado, ni qué se decidió.
// Acá los requisitos son de UNA postulación y quedan guardados, con el nombre
// del candidato que se eligió para cada puesto.
//
// LA PANTALLA CONTESTA UNA PREGUNTA, NO MUESTRA UNA TABLA: "¿calificamos?".
// Por eso el veredicto va en la tarjeta de la lista, antes de abrir nada — el
// costo real no es preparar mal una propuesta, es invertir una semana en un
// proceso que nunca calificaba.
//
// EL PASO A TRABAJOS ES UN BOTÓN, NO UN AUTOMATISMO. Al ganar se prellena el
// borrador de la obra (src/lib/licitaciones.js → prefillObraDesde) y una
// persona confirma. Prellenar no es crear.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  ETAPAS, ETAPA_LBL, ETAPA_BADGE, ETAPA_DEFAULT, esCerrada,
  TIPOS_PROCESO, TIPO_PROCESO_LBL, TIPO_PROCESO_DEFAULT, ORIGENES,
  requisitosDePersonal, veredictoPlantel, resumenVeredicto,
  urgencia, prefillObraDesde, puedePasarATrabajos, destinoAlGanar,
} from "../lib/licitaciones.js";
import { buscarPlantel, formatearMeses } from "../lib/experiencia-profesional.js";
import { getCurrentMode } from "../lib/app-mode-core.js";

const { useState: uS, useMemo: uM, useRef: uR } = React;

const nombreDe = (p) => `${p?.nombres || ''} ${p?.apellidos || ''}`.trim() || '(sin nombre)';
const hoyLocal = () => (window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10));
const money = (n, mon = 'PEN') => n == null || n === ''
  ? '—'
  : `${mon === 'USD' ? 'US$' : 'S/'} ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const URG_COLOR = {
  vencida: 'var(--red)', hoy: 'var(--red)', alta: 'var(--amber)',
  normal: 'var(--tm)', sin_fecha: 'var(--tm)', ninguna: 'var(--tm)',
};

function LicitacionesPage({ showToast }) {
  const toast = showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = rol === 'admin' || (window.__hasPerm?.(rol, 'Licitaciones', 'w') ?? false);

  const { data: licitaciones } = window.__hooks.useLicitaciones();
  const { data: requisitos } = window.__hooks.useLicitacionRequisitos();
  const { data: personal } = window.__hooks.usePersonal();
  const { data: fichas } = window.__hooks.usePersonalProfesional();
  const { data: experiencias } = window.__hooks.usePersonalExperiencia();
  const { data: rubros } = window.__hooks.useRubrosObra();
  const { data: companies } = window.__hooks.useCompanies();

  const [q, setQ] = uS('');
  const [filtroEtapa, setFiltroEtapa] = uS('abiertas');
  const [abierta, setAbierta] = uS(null);      // id de la postulación abierta
  const [creando, setCreando] = uS(false);
  const [busy, setBusy] = uS(false);
  // Regla crítica 2: el guard por estado llega tarde (se activa recién tras el
  // await a Dexie). El ref corta el segundo click en el mismo tick.
  const enCursoRef = uR(false);

  const hoy = hoyLocal();
  const esPrueba = getCurrentMode() === 'prueba';
  const marcaModo = esPrueba
    ? { demo: true, sync_status: 'synced' }
    : { sync_status: 'pending_create' };

  // ── Candidatos: mismo armado que Registro Profesional ────────────
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
  const candidatos = uM(() => (personal || [])
    .filter(p => !p.deleted_at)
    .map(p => ({
      persona: p,
      ficha: fichaPorPersona.get(p.id) || null,
      experiencias: expsPorPersona.get(p.id) || [],
    })), [personal, fichaPorPersona, expsPorPersona]);

  const vivas = uM(() => (licitaciones || []).filter(l => !l.deleted_at), [licitaciones]);

  // El veredicto de CADA postulación, para poder mostrarlo en la lista sin
  // abrir nada. Es la razón de ser de la pantalla.
  const veredictos = uM(() => {
    const m = new Map();
    for (const l of vivas) {
      const reqs = requisitosDePersonal(requisitos, l.id);
      m.set(l.id, veredictoPlantel(buscarPlantel(candidatos, reqs, { hoy })));
    }
    return m;
  }, [vivas, requisitos, candidatos, hoy]);

  const listado = uM(() => {
    const t = q.trim().toLowerCase();
    return vivas
      .filter(l => filtroEtapa === 'todas'
        || (filtroEtapa === 'abiertas' ? !esCerrada(l.etapa) : l.etapa === filtroEtapa))
      .filter(l => !t
        || String(l.objeto || '').toLowerCase().includes(t)
        || String(l.nomenclatura || '').toLowerCase().includes(t)
        || String(l.entidad_convocante || '').toLowerCase().includes(t))
      .sort((a, b) => {
        // Lo que corre primero: las abiertas con fecha más próxima arriba.
        const ca = esCerrada(a.etapa), cb = esCerrada(b.etapa);
        if (ca !== cb) return ca ? 1 : -1;
        const fa = a.fecha_presentacion || '9999-12-31';
        const fb = b.fecha_presentacion || '9999-12-31';
        return fa.localeCompare(fb) || String(a.objeto || '').localeCompare(String(b.objeto || ''));
      });
  }, [vivas, q, filtroEtapa]);

  const conteoAbiertas = uM(() => vivas.filter(l => !esCerrada(l.etapa)).length, [vivas]);

  // ── Escrituras ───────────────────────────────────────────────────
  const avisar = (tabla) => {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } }));
    try { window.dispatchEvent(new Event('online')); } catch {}
  };

  const guardarLicitacion = async (campos, id = null) => {
    if (enCursoRef.current) return null;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      if (id) {
        const prev = vivas.find(l => l.id === id);
        await window.__db.licitaciones.update(id, {
          ...campos, updated_at: ahora, updated_by: userId,
          version: (prev?.version ?? 0) + 1,
          sync_status: prev?.demo === true ? 'synced'
            : (prev?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
        });
        avisar('licitaciones');
        toast('Postulación guardada', 'green');
        return id;
      }
      const nid = window.__newId();
      await window.__db.licitaciones.add({
        id: nid, etapa: ETAPA_DEFAULT, moneda: 'PEN',
        tipo_trabajo: TIPO_PROCESO_DEFAULT, origen: 'publico',
        ...campos,
        created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
        idempotency_key: `lic_${nid}`,
        ...marcaModo,
      });
      avisar('licitaciones');
      toast('Postulación creada', 'green');
      return nid;
    } catch (e) {
      toast('No se pudo guardar: ' + (e?.message || e), 'red');
      return null;
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  const guardarRequisito = async (licitacionId, campos, id = null) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      if (id) {
        const prev = (requisitos || []).find(r => r.id === id);
        await window.__db.licitacion_requisitos.update(id, {
          ...campos, updated_at: ahora, updated_by: userId,
          version: (prev?.version ?? 0) + 1,
          sync_status: prev?.demo === true ? 'synced'
            : (prev?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
        });
      } else {
        const nid = window.__newId();
        await window.__db.licitacion_requisitos.add({
          id: nid, licitacion_id: licitacionId, clase: 'personal', fuente: 'manual',
          orden: ((requisitos || []).filter(r => r.licitacion_id === licitacionId && !r.deleted_at).length + 1) * 10,
          meses_minimos: 0, exige_colegiatura: true, exige_sustento: true,
          ...campos,
          created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
          idempotency_key: `licreq_${nid}`,
          ...marcaModo,
        });
      }
      avisar('licitacion_requisitos');
    } catch (e) {
      toast('No se pudo guardar el requisito: ' + (e?.message || e), 'red');
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  const borrarRequisito = async (row) => {
    if (!window.confirm(`¿Quitar el puesto "${row.cargo || 'sin cargo'}"?`)) return;
    try {
      const ahora = new Date().toISOString();
      await window.__db.licitacion_requisitos.update(row.id, {
        deleted_at: ahora, updated_at: ahora, updated_by: userId,
        version: (row.version ?? 0) + 1,
        sync_status: row.demo === true ? 'synced'
          : (row.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      avisar('licitacion_requisitos');
    } catch (e) { toast('No se pudo quitar: ' + (e?.message || e), 'red'); }
  };

  const borrarLicitacion = async (lic) => {
    if (!window.confirm(`¿Eliminar la postulación "${lic.objeto}"? Se van también sus requisitos.`)) return;
    try {
      const ahora = new Date().toISOString();
      const patch = (row) => ({
        deleted_at: ahora, updated_at: ahora, updated_by: userId,
        version: (row.version ?? 0) + 1,
        sync_status: row.demo === true ? 'synced'
          : (row.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      for (const r of (requisitos || []).filter(r => r.licitacion_id === lic.id && !r.deleted_at)) {
        await window.__db.licitacion_requisitos.update(r.id, patch(r));
      }
      await window.__db.licitaciones.update(lic.id, patch(lic));
      avisar('licitacion_requisitos'); avisar('licitaciones');
      setAbierta(null);
      toast('Postulación eliminada', 'green');
    } catch (e) { toast('No se pudo eliminar: ' + (e?.message || e), 'red'); }
  };

  const licAbierta = vivas.find(l => l.id === abierta) || null;

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Postulaciones</h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
            Los procesos a los que nos presentamos, y si calificamos — antes de invertir una semana en el expediente.
          </div>
        </div>
        {canWrite && (
          <button className="btn btn-amber btn-sm" onClick={() => setCreando(true)}>+ Nueva postulación</button>
        )}
      </div>

      <div className="card card-p" style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="fi" placeholder="Buscar por objeto, nomenclatura o entidad…" value={q}
          onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <select className="fi" value={filtroEtapa} onChange={e => setFiltroEtapa(e.target.value)} style={{ width: 220 }}>
          <option value="abiertas">En juego ({conteoAbiertas})</option>
          <option value="todas">Todas ({vivas.length})</option>
          {ETAPAS.map(e => <option key={e.v} value={e.v}>{e.label}</option>)}
        </select>
      </div>

      {listado.length === 0 ? (
        <div className="card card-p empty-state" style={{ padding: '34px 0', textAlign: 'center' }}>
          {vivas.length === 0
            ? 'Todavía no hay postulaciones. Creá una y cargale los requisitos que piden las bases.'
            : 'Ninguna postulación coincide con el filtro.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {listado.map(l => {
            const v = veredictos.get(l.id);
            const u = urgencia(l, hoy);
            return (
              <div key={l.id} className="card card-p" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '2 1 320px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{l.objeto}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                    {l.nomenclatura ? `${l.nomenclatura} · ` : ''}
                    {l.entidad_convocante || 'sin entidad'}
                    {' · '}{TIPO_PROCESO_LBL[l.tipo_trabajo] || l.tipo_trabajo}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 2 }}>
                    Valor referencial {money(l.valor_referencial, l.moneda)}
                  </div>
                </div>

                <div style={{ flex: '1 1 170px' }}>
                  <span className={`badge ${ETAPA_BADGE[l.etapa] || 'b-gray'}`} style={{ fontSize: 9 }}>
                    {ETAPA_LBL[l.etapa] || l.etapa}
                  </span>
                  <div style={{ fontSize: 10.5, marginTop: 3, color: URG_COLOR[u.nivel] }}>
                    {u.texto || (l.fecha_presentacion ? `Presentación ${l.fecha_presentacion}` : '')}
                  </div>
                </div>

                <div style={{ flex: '1 1 190px' }}>
                  <div style={{ fontSize: 15, lineHeight: 1.1 }} title="Veredicto del plantel">
                    {!v?.total ? '❓' : (v.limpio ? '✅' : (v.califica ? '⚠️' : '⛔'))}
                    <span style={{
                      fontSize: 11.5, marginLeft: 6,
                      color: !v?.total ? 'var(--tm)' : (v.califica ? (v.limpio ? 'var(--green)' : 'var(--amber)') : 'var(--red)'),
                    }}>
                      {resumenVeredicto(v)}
                    </span>
                  </div>
                </div>

                <div style={{ flex: '0 0 auto' }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setAbierta(l.id)}>Abrir ›</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creando && (
        <PostulacionModal
          lic={null} rubros={rubros || []} companies={companies || []}
          canWrite={canWrite} busy={busy}
          onClose={() => setCreando(false)}
          onGuardar={async (campos) => {
            const id = await guardarLicitacion(campos);
            if (id) { setCreando(false); setAbierta(id); }
          }}
        />
      )}

      {licAbierta && (
        <DetalleModal
          lic={licAbierta}
          requisitos={(requisitos || []).filter(r => r.licitacion_id === licAbierta.id && !r.deleted_at)}
          veredicto={veredictos.get(licAbierta.id)}
          candidatos={candidatos} rubros={rubros || []} companies={companies || []}
          hoy={hoy} canWrite={canWrite} busy={busy}
          onClose={() => setAbierta(null)}
          onGuardarLic={(campos) => guardarLicitacion(campos, licAbierta.id)}
          onGuardarReq={(campos, id) => guardarRequisito(licAbierta.id, campos, id)}
          onBorrarReq={borrarRequisito}
          onBorrarLic={() => borrarLicitacion(licAbierta)}
          toast={toast}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ALTA — los datos mínimos del proceso
// ═══════════════════════════════════════════════════════════════════
function PostulacionModal({ lic, rubros, companies, canWrite, busy, onClose, onGuardar }) {
  const Modal = window.Modal;
  const [f, setF] = uS(() => ({
    objeto: lic?.objeto || '',
    nomenclatura: lic?.nomenclatura || '',
    entidad_convocante: lic?.entidad_convocante || '',
    tipo_trabajo: lic?.tipo_trabajo || TIPO_PROCESO_DEFAULT,
    origen: lic?.origen || 'publico',
    rubro_id: lic?.rubro_id || '',
    valor_referencial: lic?.valor_referencial ?? '',
    moneda: lic?.moneda || 'PEN',
    fecha_presentacion: lic?.fecha_presentacion || '',
    postulante_company_id: lic?.postulante_company_id || '',
  }));
  const up = (patch) => setF(x => ({ ...x, ...patch }));
  if (!Modal) return null;

  const puedeGuardar = canWrite && !busy && f.objeto.trim().length > 2;

  return (
    <Modal title={lic ? 'Editar postulación' : 'Nueva postulación'} onClose={onClose} size="lg">
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <label className="flabel">Objeto del proceso *</label>
          <input className="fi" value={f.objeto} onChange={e => up({ objeto: e.target.value })}
            placeholder="Mejoramiento del servicio de agua potable — Chilete" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label className="flabel">Nomenclatura</label>
            <input className="fi" value={f.nomenclatura} onChange={e => up({ nomenclatura: e.target.value })}
              placeholder="LP-SM-1-2026-MDCH-1" />
          </div>
          <div style={{ flex: '2 1 240px' }}>
            <label className="flabel">Entidad convocante</label>
            <input className="fi" value={f.entidad_convocante} onChange={e => up({ entidad_convocante: e.target.value })}
              placeholder="Municipalidad Distrital de Chilete" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label className="flabel">Tipo de proceso</label>
            <select className="fi" value={f.tipo_trabajo} onChange={e => up({ tipo_trabajo: e.target.value })}>
              {TIPOS_PROCESO.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 130px' }}>
            <label className="flabel">Origen</label>
            <select className="fi" value={f.origen} onChange={e => up({ origen: e.target.value })}>
              {ORIGENES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label className="flabel">Rubro</label>
            <select className="fi" value={f.rubro_id} onChange={e => up({ rubro_id: e.target.value })}>
              <option value="">Sin rubro</option>
              {rubros.filter(r => r.activo !== false).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label className="flabel">Valor referencial</label>
            <input className="fi" type="number" step="0.01" value={f.valor_referencial}
              onChange={e => up({ valor_referencial: e.target.value })} />
          </div>
          <div style={{ flex: '0 1 100px' }}>
            <label className="flabel">Moneda</label>
            <select className="fi" value={f.moneda} onChange={e => up({ moneda: e.target.value })}>
              <option value="PEN">S/ (soles)</option>
              <option value="USD">US$ (dólares)</option>
            </select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label className="flabel">Presentación de ofertas</label>
            <input className="fi" type="date" value={f.fecha_presentacion}
              onChange={e => up({ fecha_presentacion: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="flabel">Postulamos con</label>
          <select className="fi" value={f.postulante_company_id} onChange={e => up({ postulante_company_id: e.target.value })}>
            <option value="">Sin definir</option>
            {companies.filter(c => !c.deleted_at).map(c => <option key={c.id} value={c.id}>{c.name || c.nombre}</option>)}
          </select>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
            La empresa del grupo que lleva el RUC. Si va en consorcio, la que lo lidera.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn btn-amber btn-sm" disabled={!puedeGuardar}
            onClick={() => onGuardar({
              ...f,
              rubro_id: f.rubro_id || null,
              postulante_company_id: f.postulante_company_id || null,
              fecha_presentacion: f.fecha_presentacion || null,
              valor_referencial: f.valor_referencial === '' ? null : Number(f.valor_referencial),
            })}>
            {lic ? 'Guardar' : 'Crear postulación'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DETALLE — requisitos del proceso y el veredicto del plantel
// ═══════════════════════════════════════════════════════════════════
function DetalleModal({
  lic, requisitos, veredicto, candidatos, rubros, companies, hoy, canWrite, busy,
  onClose, onGuardarLic, onGuardarReq, onBorrarReq, onBorrarLic, toast,
}) {
  const Modal = window.Modal;
  const [editando, setEditando] = uS(false);
  const [nuevo, setNuevo] = uS(null);          // borrador del puesto nuevo
  if (!Modal) return null;

  const v = veredicto;
  const filas = [...requisitos].sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100));
  const empresa = companies.find(c => c.id === lic.postulante_company_id);
  const u = urgencia(lic, hoy);
  const destino = destinoAlGanar(lic.tipo_trabajo);

  // Cada puesto de la tabla con su evaluación ya calculada por el veredicto.
  const puestoDe = (reqId) => (v?.puestos || []).find(p => p.requisitoId === reqId) || null;

  return (
    <Modal title={lic.objeto} onClose={onClose} size="xl">
      {/* ── Cabecera: el veredicto primero ── */}
      <div className="card card-p" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 26, lineHeight: 1 }}>
            {!v?.total ? '❓' : (v.limpio ? '✅' : (v.califica ? '⚠️' : '⛔'))}
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ fontWeight: 700, fontSize: 13,
              color: !v?.total ? 'var(--tm)' : (v.califica ? (v.limpio ? 'var(--green)' : 'var(--amber)') : 'var(--red)') }}>
              {resumenVeredicto(v)}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
              {!v?.total
                ? 'Cargá los puestos que piden las bases para saber si calificamos.'
                : (v.califica
                  ? (v.limpio
                    ? 'Hay a quién presentar en todos los puestos, y los elegidos cumplen.'
                    : 'Hay a quién presentar, pero algún nombre ya elegido no cumple — eso es una observación segura.')
                  : 'Falta gente para al menos un puesto. Mirá abajo a quién le falta poco.')}
            </div>
          </div>
          <div style={{ flex: '0 1 auto', textAlign: 'right' }}>
            <span className={`badge ${ETAPA_BADGE[lic.etapa] || 'b-gray'}`} style={{ fontSize: 9 }}>
              {ETAPA_LBL[lic.etapa] || lic.etapa}
            </span>
            <div style={{ fontSize: 10.5, marginTop: 3, color: URG_COLOR[u.nivel] }}>{u.texto}</div>
          </div>
        </div>
      </div>

      {/* ── Datos del proceso ── */}
      <div className="card card-p" style={{ marginBottom: 10, fontSize: 11.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <b style={{ fontSize: 12.5 }}>Datos del proceso</b>
          {canWrite && <button className="btn btn-ghost btn-xs" onClick={() => setEditando(true)}>Editar</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 8 }}>
          <div><span style={{ color: 'var(--tm)' }}>Nomenclatura:</span> {lic.nomenclatura || '—'}</div>
          <div><span style={{ color: 'var(--tm)' }}>Entidad:</span> {lic.entidad_convocante || '—'}</div>
          <div><span style={{ color: 'var(--tm)' }}>Tipo:</span> {TIPO_PROCESO_LBL[lic.tipo_trabajo] || lic.tipo_trabajo}</div>
          <div><span style={{ color: 'var(--tm)' }}>Valor referencial:</span> {money(lic.valor_referencial, lic.moneda)}</div>
          <div><span style={{ color: 'var(--tm)' }}>Presentación:</span> {lic.fecha_presentacion || '—'}</div>
          <div><span style={{ color: 'var(--tm)' }}>Postulamos con:</span> {empresa?.name || empresa?.nombre || '—'}</div>
        </div>

        {canWrite && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--tm)' }}>Etapa:</span>
            <select className="fi" style={{ width: 210 }} value={lic.etapa} disabled={busy}
              onChange={e => onGuardarLic({ etapa: e.target.value })}>
              {ETAPAS.map(e => <option key={e.v} value={e.v}>{e.label}</option>)}
            </select>
            {v && v.total > 0 && !v.califica && !esCerrada(lic.etapa) && (
              <span style={{ fontSize: 10.5, color: 'var(--amber)' }}>
                Si no calificamos, «Desistido» deja registrado por qué no nos presentamos.
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Requisitos de personal ── */}
      <div className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ padding: '9px 14px', background: 'var(--bg-c2)', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <div>
            <b style={{ fontSize: 12.5 }}>Plantel clave que piden las bases</b>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
              Se mide contra la experiencia <b>con constancia</b>: es la única presentable.
            </div>
          </div>
          {canWrite && (
            <button className="btn btn-ghost btn-xs" disabled={busy}
              onClick={() => setNuevo({
                cargo: '', profesion: '', rubro_id: '', exige_sustento: true,
                meses_generales_minimos: 36, meses_minimos: 0,
                participaciones_minimas: 2, meses_por_participacion: 2,
                ventana_anios: 10, cargos_equivalentes: '',
              })}>
              + Agregar puesto
            </button>
          )}
        </div>

        {filas.length === 0 && !nuevo && (
          <div className="empty-state" style={{ padding: '26px 14px', textAlign: 'center', fontSize: 11.5 }}>
            Todavía no hay puestos cargados. Copiá los del plantel clave de las bases.
          </div>
        )}

        <div style={{ display: 'grid', gap: 0 }}>
          {filas.map(r => (
            <PuestoFila key={r.id} fila={r} puesto={puestoDe(r.id)} rubros={rubros}
              candidatos={candidatos} canWrite={canWrite} busy={busy}
              onGuardar={(campos) => onGuardarReq(campos, r.id)}
              onBorrar={() => onBorrarReq(r)} />
          ))}
        </div>

        {nuevo && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label className="flabel">Cargo</label>
              <input className="fi" autoFocus value={nuevo.cargo} placeholder="Residente de Obra"
                onChange={e => setNuevo(n => ({ ...n, cargo: e.target.value }))} />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label className="flabel">Profesión</label>
              <input className="fi" value={nuevo.profesion} placeholder="Ingeniero Civil"
                onChange={e => setNuevo(n => ({ ...n, profesion: e.target.value }))} />
            </div>
            <div style={{ width: 130 }}>
              <label className="flabel" title="La que se acredita con el diploma de incorporación al colegio">
                Exp. general (meses)
              </label>
              <input className="fi" type="number" min="0" value={nuevo.meses_generales_minimos}
                onChange={e => setNuevo(n => ({ ...n, meses_generales_minimos: Number(e.target.value) || 0 }))} />
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label className="flabel">Rubro</label>
              <select className="fi" value={nuevo.rubro_id}
                onChange={e => setNuevo(n => ({ ...n, rubro_id: e.target.value }))}>
                <option value="">Cualquier rubro (general)</option>
                {rubros.filter(x => x.activo !== false).map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            </div>
            {/* Los tres criterios que las bases piden juntos y que un modelo de
                "solo meses" no distingue. Ver mig 198. */}
            <div style={{ width: 110 }}>
              <label className="flabel" title="«Sustentar como mínimo 02 participaciones»">Participac. mín.</label>
              <input className="fi" type="number" min="0" value={nuevo.participaciones_minimas}
                onChange={e => setNuevo(n => ({ ...n, participaciones_minimas: Number(e.target.value) || 0 }))} />
            </div>
            <div style={{ width: 120 }}>
              <label className="flabel" title="«por un plazo no menor a 02 meses cada participación»">Meses c/u</label>
              <input className="fi" type="number" min="0" value={nuevo.meses_por_participacion}
                onChange={e => setNuevo(n => ({ ...n, meses_por_participacion: Number(e.target.value) || 0 }))} />
            </div>
            <div style={{ width: 120 }}>
              <label className="flabel" title="«en los últimos 10 años». Vacío = las bases no acotan">Últimos (años)</label>
              <input className="fi" type="number" min="0" value={nuevo.ventana_anios ?? ''}
                onChange={e => setNuevo(n => ({ ...n, ventana_anios: e.target.value === '' ? null : Number(e.target.value) }))} />
            </div>
            <div style={{ flex: '1 1 100%' }}>
              <label className="flabel">Cargos que las bases aceptan (separados por «/»)</label>
              <input className="fi" value={nuevo.cargos_equivalentes}
                placeholder="Residente de obra / Supervisor de obra / Inspector de obra / Gerente de obra"
                onChange={e => setNuevo(n => ({ ...n, cargos_equivalentes: e.target.value }))} />
              <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                Vacío = no se filtra por cargo. Si las bases listan sinónimos, copiálos todos: una constancia
                con un cargo fuera de la lista no cuenta como participación.
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setNuevo(null)}>Cancelar</button>
            <button className="btn btn-amber btn-sm" disabled={busy || !nuevo.cargo.trim()}
              onClick={async () => {
                const { cargos_equivalentes, ...resto } = nuevo;
                await onGuardarReq({
                  ...resto,
                  rubro_id: nuevo.rubro_id || null,
                  cargos_equivalentes: String(cargos_equivalentes || '')
                    .split(/[/;\n]|\sy\/o\s/i).map(x => x.trim()).filter(Boolean),
                });
                setNuevo(null);
              }}>Agregar</button>
          </div>
        )}
      </div>

      {/* ── Pasar a Trabajos ── */}
      <PasarATrabajos lic={lic} veredicto={v} destino={destino} canWrite={canWrite} toast={toast} />

      {canWrite && (
        <div style={{ marginTop: 10, textAlign: 'right' }}>
          <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={onBorrarLic}>
            Eliminar postulación
          </button>
        </div>
      )}

      {editando && (
        <PostulacionModal lic={lic} rubros={rubros} companies={companies}
          canWrite={canWrite} busy={busy}
          onClose={() => setEditando(false)}
          onGuardar={async (campos) => { await onGuardarLic(campos); setEditando(false); }} />
      )}
    </Modal>
  );
}

// ── Un puesto: el requisito, quién califica y a quién elegimos ──────
function PuestoFila({ fila, puesto, rubros, candidatos, canWrite, busy, onGuardar, onBorrar }) {
  const [abierto, setAbierto] = uS(false);
  const rubro = rubros.find(r => r.id === fila.rubro_id);
  const p = puesto;
  const evaluaciones = uM(() => {
    if (!p) return [];
    // El veredicto ya trae el elegido y el más cerca; para la lista completa se
    // reevalúa solo este puesto contra todos los candidatos.
    return buscarPlantel(candidatos, [p.requisito], { hoy: hoyLocal() })[0]?.candidatos || [];
  }, [p, candidatos]);

  const icono = !p ? '❓' : (p.elegidoEnFalta ? '⚠️' : (p.cubierto ? '✅' : '⛔'));

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{ padding: '8px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, lineHeight: 1.2 }}>{icono}</span>
        <div style={{ flex: '2 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{fila.cargo || '(sin cargo)'}</div>
          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
            {fila.profesion || 'cualquier profesión'}
            {fila.meses_generales_minimos > 0 && ` · ${formatearMeses(fila.meses_generales_minimos)} de exp. general`}
            {fila.participaciones_minimas > 0 && ` · ${fila.participaciones_minimas} participaciones`}
            {fila.meses_por_participacion > 0 && ` de ${formatearMeses(fila.meses_por_participacion)} c/u`}
            {fila.ventana_anios ? ` · últimos ${fila.ventana_anios} años` : ''}
            {fila.meses_minimos > 0 && ` · ${formatearMeses(fila.meses_minimos)} acumulados`}
            {rubro ? ` · ${rubro.nombre}` : ''}
            {fila.exige_sustento === false ? ' · sin exigir constancia' : ''}
          </div>
          {Array.isArray(fila.cargos_equivalentes) && fila.cargos_equivalentes.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--tm)' }}
              title={fila.cargos_equivalentes.join(' · ')}>
              Cargos aceptados: {fila.cargos_equivalentes.slice(0, 3).join(', ')}
              {fila.cargos_equivalentes.length > 3 ? ` y ${fila.cargos_equivalentes.length - 3} más` : ''}
            </div>
          )}
          {fila.fuente === 'extraccion' && (
            <div style={{ fontSize: 10, color: 'var(--blue)' }}>
              Extraído de las bases{fila.fuente_pagina ? ` · pág. ${fila.fuente_pagina}` : ''}
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 190px' }}>
          <div style={{ fontSize: 11, color: p?.cubierto ? 'var(--green)' : 'var(--red)' }}>
            {p ? `${p.nCumplen} ${p.nCumplen === 1 ? 'califica' : 'califican'}` : '—'}
          </div>
          {p && !p.cubierto && p.masCerca && (
            <div style={{ fontSize: 10, color: 'var(--amber)' }}>
              Más cerca: {nombreDe(p.masCerca.persona)} — {
                p.masCerca.participacionesFaltantes > 0
                  ? `le falta${p.masCerca.participacionesFaltantes > 1 ? 'n' : ''} ${p.masCerca.participacionesFaltantes} participación(es)`
                  : `le faltan ${formatearMeses(p.masCerca.mesesFaltantes)}`
              }
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 200px' }}>
          <label className="flabel" style={{ fontSize: 10 }}>Presentamos a</label>
          <select className="fi" style={{ fontSize: 11 }} disabled={!canWrite || busy}
            value={fila.candidato_personal_id || ''}
            onChange={e => onGuardar({ candidato_personal_id: e.target.value || null })}>
            <option value="">Sin elegir</option>
            {evaluaciones.map(ev => (
              <option key={ev.persona.id} value={ev.persona.id}>
                {ev.cumple ? '✅ ' : (ev.aplica ? '⚠️ ' : '⛔ ')}{nombreDe(ev.persona)}
              </option>
            ))}
          </select>
          {p?.elegidoEnFalta && (
            <div style={{ fontSize: 10, color: 'var(--red)' }}>
              El elegido no cumple: {p.elegido.bloqueos[0] || 'revisar'}
            </div>
          )}
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-xs" onClick={() => setAbierto(a => !a)}>
            {abierto ? 'Ocultar' : 'Ver quién'}
          </button>
          {canWrite && (
            <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={onBorrar}>✕</button>
          )}
        </div>
      </div>

      {abierto && (
        <div style={{ padding: '4px 14px 10px 40px', display: 'grid', gap: 5 }}>
          {evaluaciones.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              No hay nadie en el padrón profesional todavía.
            </div>
          )}
          {evaluaciones.slice(0, 12).map(ev => (
            <div key={ev.persona.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
              flexWrap: 'wrap', paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 14, lineHeight: 1.2 }}>
                {ev.cumple ? '✅' : (ev.aplica ? '⚠️' : '⛔')}
              </span>
              <div style={{ flex: '1 1 190px' }}>
                <div style={{ fontWeight: 600, fontSize: 11.5 }}>{nombreDe(ev.persona)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  {ev.ficha?.profesion || 'sin ficha'} · {formatearMeses(ev.mesesSustentados)} con constancia
                </div>
              </div>
              <div style={{ flex: '2 1 250px', fontSize: 10.5 }}>
                {ev.bloqueos.map((b, k) => <div key={k} style={{ color: 'var(--red)' }}>✕ {b}</div>)}
                {ev.avisos.map((a, k) => <div key={k} style={{ color: 'var(--amber)' }}>• {a}</div>)}
                {!ev.bloqueos.length && !ev.avisos.length && (
                  <div style={{ color: 'var(--green)' }}>Sin observaciones — listo para presentar</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── El botón que cruza a Trabajos ──────────────────────────────────
// Prellena, NO crea. La decisión de convertir una postulación ganada en un
// trabajo con contabilidad propia la toma una persona, mirando el borrador.
function PasarATrabajos({ lic, veredicto, destino, canWrite, toast }) {
  const [ver, setVer] = uS(false);

  if (lic.obra_id || lic.trabajo_id) {
    return (
      <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--green)' }}>
        ✅ Esta postulación ya pasó a Trabajos.
      </div>
    );
  }
  if (!puedePasarATrabajos(lic)) {
    return (
      <div className="card card-p" style={{ fontSize: 11, color: 'var(--tm)' }}>
        El paso a Trabajos se habilita cuando la etapa es <b>Buena pro (ganado)</b>. Es manual a propósito.
      </div>
    );
  }

  const borrador = prefillObraDesde(lic);

  return (
    <div className="card card-p">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11.5 }}>
          <b>Ganamos este proceso.</b> Podés abrir el borrador del {destino === 'obra' ? 'trabajo de obra' : 'trabajo de bienes/servicios'} con los datos ya cargados.
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setVer(v => !v)}>
          {ver ? 'Ocultar borrador' : 'Ver borrador'}
        </button>
      </div>

      {ver && (
        <div style={{ marginTop: 8, fontSize: 11.5 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 6 }}>
            <div><span style={{ color: 'var(--tm)' }}>Nombre:</span> {borrador.nombre_obra || '—'}</div>
            <div><span style={{ color: 'var(--tm)' }}>Cliente:</span> {borrador.cliente || '—'}</div>
            <div><span style={{ color: 'var(--tm)' }}>Presupuesto:</span> {money(borrador.presupuesto_total, lic.moneda)}</div>
            <div><span style={{ color: 'var(--tm)' }}>Estado inicial:</span> Planificación</div>
          </div>
          <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--amber)' }}>
            Falta decidir a mano si ejecuta una empresa sola o un consorcio: errarlo desarma la
            contabilidad de la obra, así que no se deduce de con qué RUC se postuló.
          </div>
          {canWrite && (
            <button className="btn btn-amber btn-sm" style={{ marginTop: 8 }}
              onClick={() => {
                // El alta de la obra vive en jx-obra.jsx, con su consorcio, su
                // seed de ubicaciones y su auditoría. NO se duplica acá: se le
                // pasa el borrador y esa pantalla abre su propio formulario ya
                // lleno. Al guardar, jx-obra escribe de vuelta licitaciones.obra_id.
                try {
                  window.__prefillObraDesdeLicitacion = { ...borrador, __licitacion_id: lic.id };
                  window.dispatchEvent(new CustomEvent('jx_navigate', { detail: { page: 'obras' } }));
                } catch {
                  toast('Abrí Obras para crear la obra con estos datos', 'blue');
                }
              }}>
              Abrir el formulario de obra con estos datos ›
            </button>
          )}
        </div>
      )}

      {veredicto && veredicto.total > 0 && !veredicto.limpio && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--amber)' }}>
          Ojo: el plantel de esta postulación todavía tiene observaciones.
        </div>
      )}
    </div>
  );
}

Object.assign(window, { LicitacionesPage });
