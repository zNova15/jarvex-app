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
//
// EL CV SE LEE CON IA (tanda 15, entrega 4 — 8-set-2026). El padrón estaba
// vacío porque tipear 12 periodos con fechas por persona es justo el trabajo
// que nadie hace. «Cargar CV con IA» sube el PDF, dice cuánto cuesta leer las
// páginas escaneadas ANTES de gastar, y propone persona + ficha + experiencias,
// cada una con la página de la constancia que la sustenta. Nada se guarda
// solo: se revisa y se tilda. La cadena vive en src/lib/cv-analisis.js.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  totalizarExperiencia, experienciaPorRubro, estadoColegiatura,
  buscarPlantel, formatearMeses,
} from "../lib/experiencia-profesional.js";
import { categoriaDe } from "../lib/personal-categoria.js";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { filaLimpia, CAMPOS_VERIFICABLES, compararCv } from "../lib/cv-extraccion.js";

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
  const [cvIa, setCvIa] = uS(null);            // { personaFija } → el lector de CV
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
      // 🔴 `abrirUrlEvidencia` recibe la URL, NO el objeto. Pasarle `r` hacía
      // que `url.startsWith` reventara y el botón «Ver CV» no abriera nada:
      // era el único lugar del repo que lo llamaba mal (8-set-2026).
      if (r?.url) abrirUrlEvidencia(r.url);
      else toast('El archivo aún no terminó de subir', 'amber');
    } catch (e) { toast('No se pudo abrir: ' + (e?.message || e), 'red'); }
  };

  /**
   * Lo que aprobó el lector de CV, guardado de una sola vez (entrega 4).
   *
   * NO reusa guardarFicha/guardarExperiencia en bucle: tienen el guard
   * síncrono (regla crítica 2) que cortaría la segunda llamada en silencio.
   * Orden: persona → CV como evidencia → ficha → experiencias. Si la persona
   * ya existe (por DNI), se completa su ficha en vez de crear otra.
   */
  const aplicarCv = async ({ persona, personaExistente = null, ficha, experiencias = [], archivo = null, costo = null, modelos = [], paginasOcr = null }) => {
    if (enCursoRef.current) return null;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      // 1. La persona: la existente, la que coincide por DNI, o una nueva SIN obra.
      let personaRow = personaExistente
        || (persona?.dni ? (personal || []).find(p => !p.deleted_at && String(p.dni) === String(persona.dni)) : null)
        || null;
      if (!personaRow) {
        if (!persona?.dni) throw new Error('Sin DNI no se puede crear la persona en el padrón');
        const pid = window.__newId();
        personaRow = {
          id: pid, ...persona,
          created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
          idempotency_key: `${userId}_pers_${pid}`,
          ...marcaModo,
        };
        await window.__db.personal.add(personaRow);
        try { await window.__logAudit?.({ action: 'create', table: 'personal', recordId: pid, reason: `Profesional creado desde su CV (IA) · DNI ${persona.dni}` }); } catch {}
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'personal' } }));
      } else {
        // Los datos de contacto que le faltaban, sin pisar los que tenía.
        const patch = {};
        for (const k of ['telefono', 'email', 'direccion', 'fecha_nacimiento']) {
          if (!personaRow[k] && persona?.[k]) patch[k] = persona[k];
        }
        if (Object.keys(patch).length) {
          await window.__db.personal.update(personaRow.id, {
            ...patch, updated_at: ahora, updated_by: userId,
            version: (personaRow.version ?? 0) + 1,
            sync_status: personaRow.demo === true ? 'synced'
              : (personaRow.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
          });
          window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'personal' } }));
        }
      }

      // 2. El CV, como evidencia. Es el mismo archivo que sustenta cada
      //    experiencia (por página), así que se sube UNA vez.
      const existente = fichaPorPersona.get(personaRow.id);
      let evId = existente?.cv_evidencia_id || null;
      if (archivo) {
        evId = await adjuntar(archivo, { tipo: 'cv_profesional', registroId: personaRow.id, obs: `CV de ${nombreDe(personaRow)} (leído con IA)` });
      }

      // 3. La ficha. `rnp_inscrito` y lo que empieza con `_` son de la
      //    pantalla, no columnas: no viajan.
      const { rnp_inscrito, ...camposFicha } = filaLimpia(ficha || {});
      void rnp_inscrito;
      if (!camposFicha.verificaciones) camposFicha.verificaciones = {};
      const analisis = { fecha: ahora, archivo: archivo?.name || null, costo: costo?.total ?? null, modelos, paginasOcr };
      if (existente) {
        // Lo leído completa lo vacío; lo que la ficha ya tenía se respeta.
        const patch = {};
        for (const [k, v] of Object.entries(camposFicha)) {
          if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue;
          const actual = existente[k];
          if (actual == null || actual === '' || (Array.isArray(actual) && !actual.length)) patch[k] = v;
        }
        await window.__db.personal_profesional.update(existente.id, {
          ...patch, cv_evidencia_id: evId, cv_analisis: analisis,
          updated_at: ahora, updated_by: userId,
          version: (existente.version ?? 0) + 1,
          sync_status: existente.demo === true ? 'synced'
            : (existente.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
        });
      } else {
        const fid = window.__newId();
        await window.__db.personal_profesional.add({
          id: fid, personal_id: personaRow.id, ...camposFicha,
          especialidades: camposFicha.especialidades || [],
          capacitaciones: camposFicha.capacitaciones || [],
          cv_evidencia_id: evId, cv_analisis: analisis, fuente: 'cv_ia',
          created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
          idempotency_key: `prof_${personaRow.id}`,
          ...marcaModo,
        });
      }

      // 4. Las experiencias, en lote. `evidencia_id` SOLO si hay constancia en
      //    el archivo: una experiencia declarada sin constancia se guarda sin
      //    evidencia, que es la verdad.
      const filas = experiencias.map((e) => {
        const nid = window.__newId();
        const f = filaLimpia(e);
        return {
          id: nid, personal_id: personaRow.id, ...f,
          evidencia_id: f.sustento_pagina != null && evId ? evId : null,
          created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
          idempotency_key: `exp_${nid}`,
          ...marcaModo,
        };
      });
      if (filas.length) await window.__db.personal_experiencia.bulkAdd(filas);

      for (const t of ['personal_profesional', 'personal_experiencia']) {
        window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } }));
      }
      try { window.dispatchEvent(new Event('online')); } catch {}
      const plata = costo?.total ? ` · la lectura costó USD ${Number(costo.total).toFixed(3)}` : '';
      toast(`✓ Ficha de ${nombreDe(personaRow)} guardada con ${filas.length} experiencia(s)${plata}`, 'green');
      return personaRow.id;
    } catch (e) {
      toast('No se pudo guardar la ficha: ' + (e?.message || e), 'red');
      return null;
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  /**
   * Marcar una experiencia como comprobada (o no) contra su constancia.
   *
   * Es el acto que da valor a todo el módulo: hasta que alguien mira el papel,
   * lo del CV es una declaración. Queda con quién y cuándo, porque si mañana
   * la entidad observa el expediente hay que saber quién dio ese dato por
   * bueno (mig 200).
   */
  const marcarVerificacion = async (exp, estado, nota = null) => {
    try {
      const ahora = new Date().toISOString();
      await window.__db.personal_experiencia.update(exp.id, {
        verificacion: estado,
        verificado_por: estado === 'pendiente' ? null : userId,
        verificado_at: estado === 'pendiente' ? null : ahora,
        ...(nota !== null ? { verificacion_nota: nota } : {}),
        updated_at: ahora, updated_by: userId,
        version: (exp.version ?? 0) + 1,
        sync_status: exp.demo === true ? 'synced'
          : (exp.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'personal_experiencia' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
    } catch (e) { toast('No se pudo guardar la verificación: ' + (e?.message || e), 'red'); }
  };

  /** Lo mismo para un campo de la ficha (título, colegiatura, RUC, RNP…). */
  const marcarCampoFicha = async (persona, campo, estado, nota = null) => {
    try {
      const ahora = new Date().toISOString();
      const ficha = fichaPorPersona.get(persona.id);
      if (!ficha) return toast('Guarda primero la ficha', 'amber');
      const previas = (ficha.verificaciones && typeof ficha.verificaciones === 'object') ? ficha.verificaciones : {};
      const verificaciones = { ...previas };
      if (estado === 'pendiente') delete verificaciones[campo];
      else verificaciones[campo] = { estado, por: userId, at: ahora, ...(nota ? { nota } : {}) };
      await window.__db.personal_profesional.update(ficha.id, {
        verificaciones, updated_at: ahora, updated_by: userId,
        version: (ficha.version ?? 0) + 1,
        sync_status: ficha.demo === true ? 'synced'
          : (ficha.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'personal_profesional' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
    } catch (e) { toast('No se pudo guardar la verificación: ' + (e?.message || e), 'red'); }
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${tab === 'profesionales' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('profesionales')}>
            👷 Profesionales <span style={{ opacity: .7 }}>({listado.length})</span>
          </button>
          <button className={`btn btn-sm ${tab === 'plantel' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('plantel')}>
            🔎 Buscar plantel
          </button>
          {canWrite && (
            <button className="btn btn-blue btn-sm" onClick={() => setCvIa({ personaFija: null })}
              title="Sube un CV en PDF: se lee, se arma la ficha con sus experiencias y sus constancias, y tú la revisas antes de guardar">
              🤖 Cargar CV con IA
            </button>
          )}
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
                  <th>Experiencia (verificada)</th><th>CV</th><th></th>
                </tr></thead>
                <tbody>
                  {listado.length === 0 && (
                    <tr><td colSpan={6} className="empty-state" style={{ padding: '30px 0' }}>
                      {q ? 'Nadie coincide con la búsqueda.' : <>Todavía no hay profesionales cargados. Sube un CV con <b>«Cargar CV con IA»</b>: la ficha y sus experiencias salen del PDF.</>}
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
                          {formatearMeses(t.meses)} <span style={{ fontSize: 10, color: 'var(--tm)' }}>declarados</span>
                          <div style={{ fontSize: 10, color: t.conVerificacion ? 'var(--green)' : 'var(--amber)' }}>
                            {formatearMeses(t.mesesVerificados)} verificados
                            {t.porVerificar > 0 ? ` · ${t.porVerificar} por revisar` : ''}
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
          onLeerCv={canWrite ? () => setCvIa({ personaFija: detalle.persona }) : null}
          onVerificarExp={canWrite ? marcarVerificacion : null}
          onVerificarCampo={canWrite ? marcarCampoFicha : null}
          toast={toast}
        />
      )}

      {cvIa && (
        <AnalisisCvModal
          personaFija={cvIa.personaFija} personal={personal || []} rubros={rubros || []}
          fichaActual={cvIa.personaFija ? fichaPorPersona.get(cvIa.personaFija.id) : null}
          experienciasActuales={cvIa.personaFija ? (expsPorPersona.get(cvIa.personaFija.id) || []) : []}
          busy={busy} toast={toast}
          onClose={() => setCvIa(null)}
          onAplicar={async (payload) => {
            const id = await aplicarCv(payload);
            if (id) {
              setCvIa(null);
              const c = candidatos.find(x => x.persona.id === id);
              if (c) setDetalle(c);
              else setDetalle({ persona: (personal || []).find(p => p.id === id) || { id, ...payload.persona }, ficha: null, experiencias: [] });
            }
            return id;
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EL LECTOR DE CV (tanda 15, entrega 4)
//
// Mismo contrato que el lector de bases: el precio ANTES de cobrarlo, nada se
// guarda solo, lo no verificado se ve destildado. Y lo propio del CV: cada
// experiencia dice si tiene constancia y en qué página del PDF está.
// ═══════════════════════════════════════════════════════════════════
const PASO_CV_LBL = {
  leyendo: 'Abriendo el CV',
  ocr: 'Leyendo las constancias escaneadas',
  ficha: 'Leyendo el currículum',
  constancias: 'Leyendo qué certifica cada constancia',
  verificar: 'Cruzando constancias con experiencias y verificando citas',
};
const usd = (n) => `USD ${Number(n || 0).toFixed(3)}`;

function AnalisisCvModal({ personaFija, personal, rubros, fichaActual = null, experienciasActuales = [],
                           busy, onClose, onAplicar, toast }) {
  const Modal = window.Modal;
  const [archivo, setArchivo] = uS(null);
  const [fase, setFase] = uS('elegir');
  const [progreso, setProgreso] = uS(null);
  const [presupuesto, setPresupuesto] = uS(null);
  const [bloques, setBloques] = uS(null);
  const [salida, setSalida] = uS(null);
  const [persona, setPersona] = uS(null);
  const [ficha, setFicha] = uS(null);
  const [exps, setExps] = uS([]);
  const [marcadas, setMarcadas] = uS(() => new Set());
  const [guardando, setGuardando] = uS(false);
  // Leer las constancias escaneadas con OCR. APAGADO: las páginas de texto
  // traen todo lo declarativo y las escaneadas se verifican mirándolas.
  const [conOcr, setConOcr] = uS(false);
  const guardandoRef = uR(false);

  const rubrosVivos = uM(() => (rubros || []).filter(r => r.activo !== false), [rubros]);
  // QUÉ CAMBIA respecto de lo guardado. Solo tiene sentido si la ficha ya
  // existe: releer un CV no puede pisar en silencio lo que alguien corrigió a
  // mano o ya verificó contra su constancia.
  const relectura = !!fichaActual?.cv_analisis;
  const diff = uM(() => (relectura && salida
    ? compararCv({ fichaActual, experienciasActuales, leido: { ficha: salida.ficha, experiencias: salida.experiencias } })
    : null), [relectura, salida, fichaActual, experienciasActuales]);
  // ¿Ya está en el padrón? Por DNI, que es la identidad de `personal`.
  const existente = uM(() => {
    if (personaFija) return personaFija;
    const dni = persona?.dni;
    return dni ? (personal || []).find(p => !p.deleted_at && String(p.dni) === String(dni)) || null : null;
  }, [personaFija, persona, personal]);

  if (!Modal) return null;

  const elegirArchivo = async (file) => {
    if (!file) return;
    setArchivo(file);
    setFase('corriendo');
    setProgreso({ paso: 'leyendo' });
    try {
      const { leerCv, presupuestarCv } = await import('../lib/cv-analisis.js');
      const { bloques: bs } = await leerCv(file, { onProgreso: setProgreso });
      setBloques(bs);
      setPresupuesto(presupuestarCv(bs));
      setFase('presupuesto');
    } catch (e) {
      toast('No se pudo abrir el CV: ' + (e?.message || e), 'red');
      setFase('elegir');
      setArchivo(null);
    }
  };

  const correr = async () => {
    setFase('corriendo');
    try {
      const { analizarCv } = await import('../lib/cv-analisis.js');
      const { apiFetch, apiParse } = await import('../lib/api-client');
      const r = await analizarCv(bloques, { apiFetch, apiParse, rubros: rubrosVivos, onProgreso: setProgreso, conOcr });
      setSalida(r);
      setPersona({ ...r.persona });
      setFicha({ ...r.ficha });
      setExps(r.experiencias);
      // Arrancan tildadas las que tienen fecha de inicio y cita verificada. En
      // una RELECTURA, además, solo las que NO estaban: volver a guardar las
      // mismas duplicaría el padrón.
      const yaEstaban = relectura
        ? compararCv({ fichaActual, experienciasActuales, leido: { ficha: r.ficha, experiencias: r.experiencias } })
        : null;
      const esNueva = (e) => !yaEstaban || yaEstaban.nuevas.includes(e);
      setMarcadas(new Set(r.experiencias.map((e, i) => (e.fecha_inicio && e._verificada && esNueva(e) ? i : -1)).filter(i => i >= 0)));
      setFase('revisar');
    } catch (e) {
      toast('La lectura falló: ' + (e?.message || e), 'red');
      setFase('presupuesto');
    }
  };

  const upP = (patch) => setPersona(p => ({ ...p, ...patch }));
  const upF = (patch) => setFicha(f => ({ ...f, ...patch }));
  const upE = (i, patch) => setExps(es => es.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const alternar = (i) => setMarcadas(prev => { const s = new Set(prev); if (s.has(i)) s.delete(i); else s.add(i); return s; });

  const puedeGuardar = fase === 'revisar' && !guardando && (existente || (persona?.dni && /^\d{8}$/.test(persona.dni)))
    && (persona?.nombres || existente);

  const guardar = async () => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    try {
      await onAplicar({
        persona: { ...persona, dni: String(persona?.dni || '').replace(/\D/g, '') || null },
        personaExistente: existente || null,
        ficha,
        experiencias: exps.filter((_, i) => marcadas.has(i)),
        archivo,
        costo: salida?.costo || null, modelos: salida?.modelos || [], paginasOcr: salida?.paginasOcr ?? null,
      });
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <Modal title={personaFija
      ? `${fichaActual?.cv_analisis ? 'Volver a revisar el CV' : 'Leer el CV con IA'} — ${nombreDe(personaFija)}`
      : 'Cargar un profesional desde su CV'} onClose={onClose} size="xl">

      {fase === 'elegir' && (
        <div style={{ padding: '18px 4px' }}>
          <div style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
            Sube el <b>CV en PDF</b>, con sus constancias adentro si las tiene. Se lee en tu propia computadora
            y <b>no cuesta nada</b>: solo se leen las páginas que ya son texto, que es donde el profesional
            escribe su experiencia, sus estudios y sus certificados.
          </div>
          <input type="file" className="fi" accept=".pdf,application/pdf" onChange={e => elegirArchivo(e.target.files?.[0])} />
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 10, lineHeight: 1.5 }}>
            Las páginas escaneadas del CV son los papeles que respaldan: constancias, diplomas, el DNI. Esas
            <b> no se leen con IA</b>, se miran. Al terminar vas a poder abrir el CV y marcar dato por dato
            cuál está respaldado, que es lo único que después se puede presentar en un proceso.
            {personaFija ? ' Como la persona ya está en el padrón, se completa su ficha.' : ' Si la persona ya está en el padrón (por DNI), se completa su ficha en vez de duplicarla.'}
          </div>
        </div>
      )}

      {fase === 'presupuesto' && presupuesto && (
        <div style={{ padding: '10px 4px' }}>
          <div className="card card-p" style={{ marginBottom: 12 }}>
            <b style={{ fontSize: 12.5 }}>Esto es lo que hay en {archivo?.name}</b>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 10, fontSize: 12 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>{presupuesto.paginasNativas}</div>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>páginas de currículum · se leen gratis</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{presupuesto.paginasEscaneadas}</div>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>páginas escaneadas · las vas a mirar tú</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>
                  {usd(conOcr ? presupuesto.costoConConstancias.total : presupuesto.costo.total)}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>lo que cuesta esta lectura</div>
              </div>
            </div>
            {presupuesto.paginasEscaneadas > 0 && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, cursor: 'pointer',
                padding: '8px 10px', borderRadius: 6, background: 'var(--bg-c2)' }}>
                <input type="checkbox" checked={conOcr} onChange={() => setConOcr(v => !v)} style={{ marginTop: 2 }} />
                <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                  <b>Leer también las {presupuesto.paginasEscaneadas} páginas escaneadas</b>
                  <span style={{ color: 'var(--amber)' }}> · cuesta {usd(presupuesto.costoConConstancias.total)}</span>
                  <div style={{ color: 'var(--tm)', marginTop: 2 }}>
                    Sirve para que la app intente adivinar qué constancia respalda cada periodo. No hace falta
                    para cargar la ficha, y <b>no reemplaza tu revisión</b>: lo que un modelo lee sigue quedando
                    pendiente de que alguien mire el papel. Con un CV de muchas páginas puede ahorrarte el hojeo.
                  </div>
                </div>
              </label>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setFase('elegir'); setArchivo(null); }}>Elegir otro archivo</button>
            <button className="btn btn-blue btn-sm" onClick={correr}>
              Leer el CV · {usd(conOcr ? presupuesto.costoConConstancias.total : presupuesto.costo.total)}
            </button>
          </div>
        </div>
      )}

      {fase === 'corriendo' && (
        <div style={{ padding: '28px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{PASO_CV_LBL[progreso?.paso] || 'Trabajando'}…</div>
          {(progreso?.paso === 'ocr' || progreso?.paso === 'constancias') && progreso.total > 0 && (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 8 }}>{progreso.hecho} de {progreso.total} páginas</div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-c2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((progreso.hecho / progreso.total) * 100)}%`, background: 'var(--blue)' }} />
              </div>
            </>
          )}
          {progreso?.paso === 'leyendo' && progreso.total > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>página {progreso.pagina} de {progreso.total}</div>
          )}
          {progreso?.detalle && typeof progreso.detalle === 'string' && (
            <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>{progreso.detalle}</div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 14 }}>No cierres esta ventana: el CV se está leyendo en tu computadora.</div>
        </div>
      )}

      {fase === 'revisar' && salida && persona && ficha && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div className="card card-p" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div><div style={{ fontSize: 18, fontWeight: 700 }}>{exps.length}</div><div style={{ fontSize: 10.5, color: 'var(--tm)' }}>experiencias declaradas</div></div>
            <div><div style={{ fontSize: 18, fontWeight: 700 }}>{salida.paginasSinLeer?.length ?? 0}</div><div style={{ fontSize: 10.5, color: 'var(--tm)' }}>páginas escaneadas para revisar</div></div>
            <div><div style={{ fontSize: 18, fontWeight: 700 }}>{(ficha.capacitaciones || []).length}</div><div style={{ fontSize: 10.5, color: 'var(--tm)' }}>cursos y diplomados</div></div>
            <div><div style={{ fontSize: 18, fontWeight: 700 }}>{usd(salida.costo?.total)}</div><div style={{ fontSize: 10.5, color: 'var(--tm)' }}>costó de verdad · {salida.paginasOcr} páginas leídas</div></div>
            {salida.modelos?.length > 0 && <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--tm)', textAlign: 'right' }}>leído por<br />{salida.modelos.join(' · ')}</div>}
          </div>

          {salida.alertas?.length > 0 && (
            <div style={{ padding: '9px 12px', borderRadius: 8, fontSize: 11, background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.35)' }}>
              <b style={{ color: 'var(--amber)' }}>⚠ Para revisar ({salida.alertas.length})</b>
              <ul style={{ margin: '6px 0 0 16px', padding: 0, lineHeight: 1.5 }}>
                {salida.alertas.slice(0, 10).map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          {/* ── QUÉ CAMBIA (relectura) ── */}
          {diff && (
            <div className="card card-p" style={{ borderLeft: '3px solid var(--blue)' }}>
              <b style={{ fontSize: 12.5 }}>Qué cambia respecto de lo que ya está guardado</b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 6 }}>
                Nada se pisa solo. Esto es para que veas si la lectura nueva encontró algo mejor.
              </div>
              {!diff.hayAlgo ? (
                <div style={{ fontSize: 11.5, color: 'var(--green)' }}>
                  ✅ La lectura nueva dice lo mismo que ya tienes guardado. No hay nada que cambiar.
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 4, fontSize: 11 }}>
                  {diff.campos.filter(c => c.estado !== 'igual').map(c => (
                    <div key={c.campo} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <span className={`badge ${c.estado === 'falta' ? 'b-blue' : 'b-amber'}`} style={{ fontSize: 8.5 }}>
                        {c.estado === 'falta' ? 'faltaba' : 'difiere'}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b>{c.label}:</b>{' '}
                        {c.estado === 'difiere' && <span style={{ color: 'var(--tm)', textDecoration: 'line-through' }}>{String(c.actual)} </span>}
                        <b style={{ color: 'var(--blue)' }}>{String(c.leido)}</b>
                      </span>
                    </div>
                  ))}
                  {diff.nuevas.length > 0 && (
                    <div><span className="badge b-green" style={{ fontSize: 8.5 }}>nuevas</span>{' '}
                      {diff.nuevas.length} experiencia(s) que no estaban cargadas</div>
                  )}
                  {diff.cursos.length > 0 && (
                    <div><span className="badge b-green" style={{ fontSize: 8.5 }}>nuevos</span>{' '}
                      {diff.cursos.length} curso(s) que no estaban</div>
                  )}
                  {diff.yaEstan > 0 && (
                    <div style={{ color: 'var(--tm)' }}>
                      {diff.yaEstan} experiencia(s) ya estaban: vienen destildadas para no duplicarlas.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* La persona */}
          <div className="card card-p">
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
              {existente
                ? <>Persona: <span style={{ color: 'var(--green)' }}>{nombreDe(existente)} ya está en el padrón</span> <span style={{ fontWeight: 400, fontSize: 10.5, color: 'var(--tm)' }}>(DNI {existente.dni}) — se completa su ficha</span></>
                : <>Persona nueva <span style={{ fontWeight: 400, fontSize: 10.5, color: 'var(--tm)' }}>— se crea en el padrón como profesional, sin obra</span></>}
            </div>
            {!existente && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                <div><label className="flabel">Nombres *</label><input className="fi" value={persona.nombres || ''} onChange={e => upP({ nombres: e.target.value })} /></div>
                <div><label className="flabel">Apellidos *</label><input className="fi" value={persona.apellidos || ''} onChange={e => upP({ apellidos: e.target.value })} /></div>
                <div><label className="flabel">DNI * {!/^\d{8}$/.test(String(persona.dni || '')) && <span style={{ color: 'var(--red)' }}>(8 dígitos)</span>}</label>
                  <input className="fi" value={persona.dni || ''} onChange={e => upP({ dni: e.target.value.replace(/\D/g, '').slice(0, 8) })} /></div>
                <div><label className="flabel">Celular</label><input className="fi" value={persona.telefono || ''} onChange={e => upP({ telefono: e.target.value })} /></div>
                <div><label className="flabel">Correo</label><input className="fi" value={persona.email || ''} onChange={e => upP({ email: e.target.value })} /></div>
              </div>
            )}
          </div>

          {/* La ficha */}
          <div className="card card-p">
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Ficha profesional</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
              <div><label className="flabel">Profesión</label><input className="fi" value={ficha.profesion || ''} onChange={e => upF({ profesion: e.target.value })} /></div>
              <div><label className="flabel">Título</label><input className="fi" value={ficha.titulo || ''} onChange={e => upF({ titulo: e.target.value })} /></div>
              <div><label className="flabel">Universidad</label><input className="fi" value={ficha.universidad || ''} onChange={e => upF({ universidad: e.target.value })} /></div>
              <div><label className="flabel">Año de egreso</label><input className="fi" type="number" value={ficha.anio_egreso ?? ''} onChange={e => upF({ anio_egreso: e.target.value === '' ? null : Number(e.target.value) })} /></div>
              <div><label className="flabel">Colegio</label>
                <select className="fi" value={ficha.colegio || ''} onChange={e => upF({ colegio: e.target.value || null })}>
                  <option value="">—</option><option value="CIP">CIP (Ingenieros)</option><option value="CAP">CAP (Arquitectos)</option><option value="OTRO">Otro</option>
                </select></div>
              <div><label className="flabel">N° de colegiatura</label><input className="fi" value={ficha.colegiatura_numero || ''} onChange={e => upF({ colegiatura_numero: e.target.value })} /></div>
              <div><label className="flabel" title="Con esto se acredita la experiencia general que piden las bases">Colegiado desde</label>
                <input className="fi" type="date" value={ficha.colegiatura_fecha || ''} onChange={e => upF({ colegiatura_fecha: e.target.value || null })} /></div>
              <div><label className="flabel">Habilitado hasta</label>
                <input className="fi" type="date" value={ficha.colegiatura_habil_hasta || ''} onChange={e => upF({ colegiatura_habil_hasta: e.target.value || null })} /></div>
              <div><label className="flabel">RUC</label><input className="fi" value={ficha.ruc || ''} onChange={e => upF({ ruc: e.target.value.replace(/\D/g, '').slice(0, 11) })} /></div>
            </div>
            {(ficha.capacitaciones || []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 3 }}>Cursos y diplomados ({ficha.capacitaciones.length}) — se guardan con la ficha</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {ficha.capacitaciones.map((c, i) => (
                    <span key={i} className="badge b-blue" style={{ fontSize: 9.5 }} title={`${c.institucion || ''}${c.horas ? ` · ${c.horas} h` : ''}${c.desde ? ` · ${c.desde}` : ''}`}>
                      {c.nombre.slice(0, 60)}{c.horas ? ` · ${c.horas} h` : ''}{c.sustento_pagina ? ' 📎' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Las experiencias */}
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, margin: '2px 0 6px' }}>
              Experiencias ({marcadas.size} de {exps.length} se guardan)
              <span style={{ fontWeight: 400, fontSize: 10.5, color: 'var(--tm)', marginLeft: 8 }}>
                Todas entran como <b>declaradas</b>. Al guardar vas a poder abrir el CV y marcar cuál está
                respaldada por su constancia: solo eso se presenta en un proceso.
              </span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {exps.map((e, i) => (
                <div key={i} className="card card-p" style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
                  borderLeft: `3px solid ${e.sustento_pagina != null ? 'var(--green)' : (e._verificada ? 'var(--tm)' : 'var(--amber)')}` }}>
                  <input type="checkbox" checked={marcadas.has(i)} onChange={() => alternar(i)} style={{ marginTop: 4 }} />
                  <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <b style={{ fontSize: 12 }}>{e.cargo || '(sin cargo)'}</b>
                      <span style={{ fontSize: 11, color: 'var(--tm)' }}>· {e.entidad || 'entidad sin nombre'}</span>
                      {e.sustento_pagina != null
                        ? <span className="badge b-green" style={{ fontSize: 9 }}>📎 constancia pág. {e.sustento_pagina}</span>
                        : <span className="badge b-gray" style={{ fontSize: 9 }}>por verificar</span>}
                      {!e._verificada && <span className="badge b-amber" style={{ fontSize: 9 }}>cita sin verificar</span>}
                      {e.observaciones && <span style={{ fontSize: 10, color: 'var(--blue)' }}>{e.observaciones}</span>}
                    </div>
                    <div><label className="flabel" style={{ fontSize: 10 }}>Obra / proyecto</label>
                      <input className="fi" style={{ fontSize: 11 }} value={e.obra_nombre || ''} onChange={ev => upE(i, { obra_nombre: ev.target.value })} /></div>
                    <div><label className="flabel" style={{ fontSize: 10 }}>Desde</label>
                      <input className="fi" style={{ fontSize: 11 }} type="date" value={e.fecha_inicio || ''} onChange={ev => upE(i, { fecha_inicio: ev.target.value || null })} /></div>
                    <div><label className="flabel" style={{ fontSize: 10 }}>Hasta (vacío = en curso)</label>
                      <input className="fi" style={{ fontSize: 11 }} type="date" value={e.fecha_fin || ''} onChange={ev => upE(i, { fecha_fin: ev.target.value || null })} /></div>
                    <div><label className="flabel" style={{ fontSize: 10 }}>Rubro {e._rubroPropuesto && e.rubro_id && <span style={{ color: 'var(--blue)' }}>(propuesto)</span>}</label>
                      <select className="fi" style={{ fontSize: 11 }} value={e.rubro_id || ''} onChange={ev => upE(i, { rubro_id: ev.target.value || null })}>
                        <option value="">(sin rubro)</option>
                        {rubrosVivos.map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                      </select></div>
                    {(e._alertas?.length > 0 || (!e._verificada && e._verificacionMotivo)) && (
                      <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: 'var(--amber)' }}>
                        {[...(e._alertas || []), ...(!e._verificada && e._verificacionMotivo ? [e._verificacionMotivo] : [])].join(' · ')}
                      </div>
                    )}
                    {e.fuente_cita && (
                      <div style={{ gridColumn: '1 / -1', fontSize: 10.5, padding: '4px 8px', borderRadius: 5, background: 'var(--bg-c2)', fontStyle: 'italic' }}>
                        «{e.fuente_cita.slice(0, 200)}»{e.fuente_pagina != null && <b style={{ fontStyle: 'normal' }}> — pág. {e.fuente_pagina}</b>}
                      </div>
                    )}
                    {e.sustento_esperado && (
                      <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: 'var(--blue)' }}>
                        Para darla por buena, busca en el CV: <b>{e.sustento_esperado}</b>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {exps.length === 0 && (
                <div className="empty-state" style={{ padding: '16px', textAlign: 'center', fontSize: 11.5 }}>
                  No se encontraron experiencias. La ficha se guarda igual; las experiencias se pueden cargar a mano después.
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
            {!existente && !/^\d{8}$/.test(String(persona.dni || '')) && (
              <span style={{ fontSize: 11, color: 'var(--red)', marginRight: 'auto' }}>Falta el DNI (8 dígitos): sin él no se puede crear la persona.</span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={guardando}>Cancelar</button>
            <button className="btn btn-blue btn-sm" onClick={guardar} disabled={!puedeGuardar || busy}>
              {guardando ? 'Guardando…' : `Guardar ficha y ${marcadas.size} experiencia${marcadas.size === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
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

// ── Estados de verificación, compartidos por la ficha y la experiencia ──
const VERIF = {
  pendiente:    { label: 'Por verificar', icono: '○', cls: 'b-gray',  color: 'var(--tm)' },
  verificado:   { label: 'Verificado',    icono: '✅', cls: 'b-green', color: 'var(--green)' },
  observado:    { label: 'Observado',     icono: '⚠️', cls: 'b-amber', color: 'var(--amber)' },
  sin_sustento: { label: 'Sin sustento',  icono: '⛔', cls: 'b-red',   color: 'var(--red)' },
};
const estadoDe = (v) => VERIF[v] || VERIF.pendiente;

/** Los tres botones que marcan un ítem. Se repiten en la ficha y en cada
 *  experiencia, así que viven acá una sola vez. */
function BotonesVerificar({ valor, disabled, onMarcar }) {
  const actual = valor || 'pendiente';
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {['verificado', 'observado', 'sin_sustento'].map(v => (
        <button key={v} className={`btn btn-xs ${actual === v ? 'btn-amber' : 'btn-ghost'}`}
          disabled={disabled} title={VERIF[v].label}
          onClick={() => onMarcar(actual === v ? 'pendiente' : v)}
          style={{ padding: '2px 6px', ...(actual === v ? {} : { color: VERIF[v].color }) }}>
          {VERIF[v].icono}
        </button>
      ))}
    </div>
  );
}

function FichaModal({ candidato, rubros, rubroById, obras, hoy, canWrite, busy,
                      onClose, onGuardarFicha, onGuardarExperiencia, onBorrarExperiencia,
                      onAdjuntar, onVerEvidencia, onLeerCv = null,
                      onVerificarExp = null, onVerificarCampo = null, toast }) {
  const Modal = window.Modal;
  const { persona, ficha, experiencias } = candidato;
  // TODOS los hooks antes de cualquier early return (regla crítica 3).
  const [f, setF] = uS(() => ({
    profesion: ficha?.profesion || '', titulo: ficha?.titulo || '',
    universidad: ficha?.universidad || '', anio_egreso: ficha?.anio_egreso || '',
    colegio: ficha?.colegio || 'CIP', colegiatura_numero: ficha?.colegiatura_numero || '',
    colegiatura_habil_hasta: ficha?.colegiatura_habil_hasta || '',
    colegiatura_fecha: ficha?.colegiatura_fecha || '',
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
            <div><label className="flabel" title="Fecha de incorporación al colegio: con esto se acredita la experiencia GENERAL que piden las bases (mig 198)">Colegiado desde</label>
              <input className="fi" type="date" value={f.colegiatura_fecha} disabled={!canWrite}
                onChange={e => setF({ ...f, colegiatura_fecha: e.target.value })} /></div>
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
            {onLeerCv && (
              <button className="btn btn-blue btn-sm" disabled={busy} onClick={onLeerCv}
                title={ficha?.cv_analisis?.fecha
                  ? 'Vuelve a leer el CV y te muestra QUÉ CAMBIA respecto de lo que ya está guardado. No pisa nada sin que lo apruebes.'
                  : 'Sube el CV en PDF y la IA propone la ficha y las experiencias'}>
                {ficha?.cv_analisis?.fecha ? '🤖 Volver a revisar con IA' : '🤖 Leer el CV con IA'}
              </button>
            )}
            {ficha?.cv_analisis?.fecha && (
              <span style={{ fontSize: 10, color: 'var(--tm)' }}>
                leído con IA el {String(ficha.cv_analisis.fecha).slice(0, 10)}{ficha.cv_analisis.costo != null ? ` · USD ${Number(ficha.cv_analisis.costo).toFixed(3)}` : ''}
              </span>
            )}
          </div>
        </div>

        {/* ── QUÉ HAY QUE CORROBORAR, Y CON QUÉ DOCUMENTO ──
            Gabriel, 8-set-2026: «cómo podríamos corroborar cada punto de lo
            que él menciona […] y el administrador se encarga de colocar
            verificado». Cada fila dice qué papel lo prueba; el CV está a un
            clic para ir a buscarlo. ── */}
        <div className="card card-p">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>Qué hay que corroborar</div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                El CV es lo que la persona declara. Abre el archivo, busca cada papel y marca.
              </div>
            </div>
            {ficha?.cv_evidencia_id && (
              <button className="btn btn-blue btn-xs" onClick={() => onVerEvidencia(ficha.cv_evidencia_id)}>
                📄 Abrir el CV para revisar
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gap: 4 }}>
            {CAMPOS_VERIFICABLES.map(c => {
              const v = (ficha?.verificaciones || {})[c.campo] || {};
              const est = estadoDe(v.estado);
              // Un campo vacío no se puede verificar: no tiene sentido pedirlo.
              const valor = c.campo === 'titulo' ? f.titulo
                : c.campo === 'colegiatura' ? f.colegiatura_numero
                  : c.campo === 'habilidad' ? f.colegiatura_habil_hasta
                    : c.campo === 'dni' ? persona?.dni
                      : c.campo === 'ruc' ? ficha?.ruc
                        : ficha?.rnp_numero;
              return (
                <div key={c.campo} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
                  padding: '5px 8px', borderRadius: 5, background: 'var(--bg-c2)', fontSize: 11 }}>
                  <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <b>{c.label}:</b>{' '}
                    {valor ? <span>{String(valor).slice(0, 60)}</span> : <span style={{ color: 'var(--tm)' }}>sin dato en la ficha</span>}
                    <div style={{ fontSize: 10, color: 'var(--tm)' }}>Se prueba con: {c.con}</div>
                    {v.nota && <div style={{ fontSize: 10, color: est.color }}>{v.nota}</div>}
                  </span>
                  <span className={`badge ${est.cls}`} style={{ fontSize: 9 }}>{est.label}</span>
                  {canWrite && onVerificarCampo && valor && (
                    <BotonesVerificar valor={v.estado} disabled={busy}
                      onMarcar={(estado) => {
                        const nota = estado === 'observado' || estado === 'sin_sustento'
                          ? (window.prompt(`¿Qué observaste en «${c.label}»?`) || null) : null;
                        onVerificarCampo(persona, c.campo, estado, nota);
                      }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Resumen de experiencia por rubro ── */}
        <div className="card card-p">
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            Experiencia · {formatearMeses(total.meses)} <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--tm)' }}>declarados</span>
            <span style={{ fontWeight: 400, color: total.conVerificacion ? 'var(--green)' : 'var(--amber)', marginLeft: 8, fontSize: 11 }}>
              {formatearMeses(total.mesesVerificados)} verificados
            </span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 8 }}>
            Los meses se calculan de los periodos: si dos obras se superponen, ese tiempo cuenta UNA vez.
            {total.porVerificar > 0 && <> Hay <b style={{ color: 'var(--amber)' }}>{total.porVerificar} sin revisar</b> contra su constancia.</>}
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
                <th>Obra / Entidad</th><th>Cargo</th><th>Rubro</th><th>Periodo</th><th>Tiempo</th>
                <th>Constancia</th><th>Verificación</th><th></th>
              </tr></thead>
              <tbody>
                {(experiencias || []).length === 0 && (
                  <tr><td colSpan={8} className="empty-state" style={{ padding: '20px 0' }}>Sin experiencia cargada.</td></tr>
                )}
                {(experiencias || []).slice()
                  .sort((a, b) => String(b.fecha_inicio || '').localeCompare(String(a.fecha_inicio || '')))
                  .map(x => {
                    const t = totalizarExperiencia([x], { hoy });
                    return (
                      <tr key={x.id}>
                        <td style={{ fontSize: 11.5 }}>
                          <div style={{ fontWeight: 600 }}>{x.obra_nombre || '—'}</div>
                          <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                            {x.entidad || ''}{x.obra_id ? ' · obra del grupo' : ''}
                            {x.fuente === 'cv_ia' && <span className="badge b-blue" style={{ fontSize: 8.5, marginLeft: 4 }} title={x.fuente_cita ? `«${x.fuente_cita}»${x.fuente_pagina ? ` — pág. ${x.fuente_pagina} del CV` : ''}` : 'Leída del CV'}>del CV</span>}
                          </div>
                        </td>
                        <td style={{ fontSize: 11.5 }}>{x.cargo || '—'}</td>
                        <td style={{ fontSize: 11 }}>{rubroById.get(x.rubro_id)?.nombre || <span style={{ color: 'var(--amber)' }}>sin rubro</span>}</td>
                        <td style={{ fontSize: 10.5 }}>{x.fecha_inicio || '?'} → {x.fecha_fin || 'en curso'}</td>
                        <td style={{ fontSize: 11 }}>{formatearMeses(t.meses)}</td>
                        <td>
                          {x.evidencia_id
                            ? <button className="btn btn-ghost btn-xs" style={{ color: 'var(--blue)' }} onClick={() => onVerEvidencia(x.evidencia_id)}
                                title={x.sustento_pagina ? `La constancia está en la página ${x.sustento_pagina} del CV` : ''}>
                                📎 Ver{x.sustento_pagina ? ` (pág. ${x.sustento_pagina})` : ''}
                              </button>
                            : canWrite ? (
                              <label className="btn btn-ghost btn-xs" style={{ color: 'var(--amber)', cursor: 'pointer' }}>
                                ⬆ Adjuntar
                                <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }}
                                  disabled={subiendo} onChange={e => { subirConstancia(e.target.files?.[0], x); e.target.value = ''; }} />
                              </label>
                            ) : <span style={{ fontSize: 10, color: 'var(--amber)' }}>sin constancia</span>}
                        </td>
                        <td>
                          {(() => {
                            const est = estadoDe(x.verificacion);
                            return (
                              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span className={`badge ${est.cls}`} style={{ fontSize: 8.5 }}
                                  title={x.verificacion_nota || x.sustento_esperado || ''}>{est.label}</span>
                                {canWrite && onVerificarExp && (
                                  <BotonesVerificar valor={x.verificacion} disabled={busy}
                                    onMarcar={(estado) => {
                                      const nota = estado === 'observado' || estado === 'sin_sustento'
                                        ? (window.prompt(`¿Qué observaste en «${x.obra_nombre || x.cargo || 'esta experiencia'}»?`) || null) : null;
                                      onVerificarExp(x, estado, nota);
                                    }} />
                                )}
                              </div>
                            );
                          })()}
                          {x.sustento_esperado && (x.verificacion || 'pendiente') === 'pendiente' && (
                            <div style={{ fontSize: 9.5, color: 'var(--blue)', marginTop: 2, maxWidth: 260 }}>
                              Busca: {x.sustento_esperado}
                            </div>
                          )}
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
