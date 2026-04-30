import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

// ─── HELPERS ────────────────────────────────────────────
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CONTRATO_BADGE = {
  vigente:    { class: 'b-green',  label: 'Vigente' },
  suspendido: { class: 'b-yellow', label: 'Suspendido' },
  liquidado:  { class: 'b-gray',   label: 'Liquidado' },
  sin:        { class: 'b-red',    label: 'Sin contrato' },
};

const REGIMEN_LABEL = {
  general: 'Régimen General',
  construccion_civil: 'Construcción Civil',
  agrario: 'Agrario',
  mype: 'MYPE',
};

const AFP_NOMBRES = ['Integra', 'Prima', 'Profuturo', 'Habitat'];

// ─── PERSONAL CONTRATOS PAGE ────────────────────────────
function PersonalContratosPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const puedeGestionar = isAdmin || ['gerente', 'asistente_admin'].includes(myRol);

  const [obraId, setObraId] = uS(null);
  const [contratosByPersonal, setContratosByPersonal] = uS({}); // { personal_id: contrato }
  const [loadingC, setLoadingC] = uS(false);
  const [q, setQ] = uS('');
  const [modal, setModal] = uS(null); // null | 'gestionar'
  const [target, setTarget] = uS(null); // personal seleccionado
  const [form, setForm] = uS({});
  const [editingId, setEditingId] = uS(null);

  // ── Obra activa (copy del file existente) ──
  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); return; }
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    const onChange = () => { attempts = 0; find(); };
    window.addEventListener('jarvex_master_updated', onChange);
    window.addEventListener('obra_activa_change', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvex_master_updated', onChange);
      window.removeEventListener('obra_activa_change', onChange);
    };
  }, []);

  const { data: personal, loading } = window.__hooks.usePersonal(obraId);

  const personalActivo = uM(
    () => (personal || []).filter(p => p.estado === 'activo'),
    [personal]
  );

  // ── Carga contratos vigentes por trabajador ──
  const cargarContratos = async () => {
    if (!personalActivo.length) { setContratosByPersonal({}); return; }
    setLoadingC(true);
    const map = {};
    try {
      for (const p of personalActivo) {
        const list = await window.__db.personal_contrato
          .where('personal_id').equals(p.id)
          .filter(c => !c.deleted_at)
          .toArray();
        // ordenar por fecha_inicio desc, luego created_at desc
        list.sort((a, b) => {
          const fa = (a.fecha_inicio || '') + '|' + (a.created_at || '');
          const fb = (b.fecha_inicio || '') + '|' + (b.created_at || '');
          return fb.localeCompare(fa);
        });
        // priorizar vigente; si no hay, el más reciente
        const vigente = list.find(c => c.estado === 'vigente');
        map[p.id] = vigente || list[0] || null;
      }
      setContratosByPersonal(map);
    } catch (e) {
      console.error('[contratos load]', e);
    } finally {
      setLoadingC(false);
    }
  };

  uE(() => { cargarContratos(); /* eslint-disable-next-line */ }, [personalActivo]);

  // ── KPIs ──
  const kpis = uM(() => {
    const total = personalActivo.length;
    let vigentes = 0, sin = 0;
    personalActivo.forEach(p => {
      const c = contratosByPersonal[p.id];
      if (c && c.estado === 'vigente') vigentes++;
      else if (!c) sin++;
    });
    return { total, vigentes, sin };
  }, [personalActivo, contratosByPersonal]);

  // ── Filtro búsqueda ──
  const filtered = uM(() => {
    const q2 = q.trim().toLowerCase();
    if (!q2) return personalActivo;
    return personalActivo.filter(p =>
      `${p.nombres || ''} ${p.apellidos || ''}`.toLowerCase().includes(q2) ||
      (p.dni || '').includes(q2) ||
      (p.cargo || '').toLowerCase().includes(q2)
    );
  }, [personalActivo, q]);

  // ── Abrir modal ──
  const abrirGestionar = (p) => {
    if (!puedeGestionar) return;
    const c = contratosByPersonal[p.id];
    setTarget(p);
    if (c) {
      setEditingId(c.id);
      setForm({
        fecha_inicio: c.fecha_inicio || new Date().toISOString().slice(0, 10),
        fecha_fin: c.fecha_fin || '',
        sueldo_basico: c.sueldo_basico ?? 0,
        asignacion_familiar: c.asignacion_familiar ?? 102.50,
        bonificaciones_fijas: c.bonificaciones_fijas ?? 0,
        regimen: c.regimen || 'construccion_civil',
        tipo_pension: c.tipo_pension || 'ONP',
        afp_nombre: c.afp_nombre || '',
        afp_pct_aporte_obligatorio: c.afp_pct_aporte_obligatorio ?? 10,
        afp_pct_seguro: c.afp_pct_seguro ?? 1.49,
        afp_pct_comision: c.afp_pct_comision ?? 1.55,
        cargo_planilla: c.cargo_planilla || p.cargo || '',
        tiene_essalud: c.tiene_essalud !== false,
        domicilio_fiscal: c.domicilio_fiscal || '',
        cuenta_bancaria: c.cuenta_bancaria || '',
        cci: c.cci || '',
        estado: c.estado || 'vigente',
        notas: c.notas || '',
      });
    } else {
      setEditingId(null);
      setForm({
        fecha_inicio: new Date().toISOString().slice(0, 10),
        fecha_fin: '',
        sueldo_basico: 0,
        asignacion_familiar: 102.50,
        bonificaciones_fijas: 0,
        regimen: 'construccion_civil',
        tipo_pension: 'ONP',
        afp_nombre: '',
        afp_pct_aporte_obligatorio: 10,
        afp_pct_seguro: 1.49,
        afp_pct_comision: 1.55,
        cargo_planilla: p.cargo || '',
        tiene_essalud: true,
        domicilio_fiscal: '',
        cuenta_bancaria: '',
        cci: '',
        estado: 'vigente',
        notas: '',
      });
    }
    setModal('gestionar');
  };

  const cerrarModal = () => {
    setModal(null); setTarget(null); setEditingId(null); setForm({});
  };

  // ── Guardar ──
  const guardar = async () => {
    if (!target) return;
    if (!puedeGestionar) { showToast?.('No tienes permiso para gestionar contratos', 'red'); return; }
    if (!form.fecha_inicio) { showToast?.('Falta fecha de inicio', 'red'); return; }
    const sueldo = Number(form.sueldo_basico || 0);
    if (sueldo <= 0) { showToast?.('Sueldo básico debe ser mayor a 0', 'red'); return; }
    const now = new Date().toISOString();

    const payload = {
      personal_id: target.id,
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin || null,
      sueldo_basico: sueldo,
      asignacion_familiar: Number(form.asignacion_familiar || 0),
      bonificaciones_fijas: Number(form.bonificaciones_fijas || 0),
      regimen: form.regimen || 'construccion_civil',
      tipo_pension: form.tipo_pension || 'ONP',
      afp_nombre: form.tipo_pension === 'AFP' ? (form.afp_nombre || null) : null,
      afp_pct_aporte_obligatorio: form.tipo_pension === 'AFP' ? Number(form.afp_pct_aporte_obligatorio || 10) : null,
      afp_pct_seguro: form.tipo_pension === 'AFP' ? Number(form.afp_pct_seguro || 1.49) : null,
      afp_pct_comision: form.tipo_pension === 'AFP' ? Number(form.afp_pct_comision || 1.55) : null,
      cargo_planilla: form.cargo_planilla?.trim() || null,
      tiene_essalud: !!form.tiene_essalud,
      domicilio_fiscal: form.domicilio_fiscal?.trim() || null,
      cuenta_bancaria: form.cuenta_bancaria?.trim() || null,
      cci: form.cci?.trim() || null,
      estado: form.estado || 'vigente',
      notas: form.notas?.trim() || null,
      updated_at: now,
      sync_status: 'pending',
    };

    try {
      if (editingId) {
        const old = await window.__db.personal_contrato.get(editingId);
        await window.__db.personal_contrato.update(editingId, payload);
        try {
          await window.__logAudit?.({
            action: 'update', table: 'personal_contrato',
            recordId: editingId, oldData: old, newData: payload,
          });
        } catch {}
        showToast?.(`Contrato actualizado para ${target.nombres} ${target.apellidos}`, 'green');
      } else {
        // Si vamos a crear uno nuevo y ya hay otro vigente, marcamos el viejo como liquidado
        const previos = await window.__db.personal_contrato
          .where('personal_id').equals(target.id)
          .filter(c => !c.deleted_at && c.estado === 'vigente')
          .toArray();
        for (const v of previos) {
          await window.__db.personal_contrato.update(v.id, {
            estado: 'liquidado',
            updated_at: now,
            sync_status: 'pending',
          });
        }
        const id = window.__newId();
        const created = {
          id,
          ...payload,
          version: 1,
          created_at: now,
        };
        await window.__db.personal_contrato.add(created);
        try {
          await window.__logAudit?.({
            action: 'insert', table: 'personal_contrato',
            recordId: id, newData: created,
          });
        } catch {}
        showToast?.(`Contrato registrado para ${target.nombres} ${target.apellidos}`, 'green');
      }
      try { window.dispatchEvent(new CustomEvent('jarvex_master_updated')); } catch {}
      cerrarModal();
      await cargarContratos();
    } catch (e) {
      console.error('[contrato save]', e);
      showToast?.('Error al guardar contrato: ' + (e.message || e), 'red');
    }
  };

  // ── Render ──
  if (!obraId) {
    return typeof SinObraEmpty !== 'undefined'
      ? <SinObraEmpty icon="users" />
      : <div className="page-wrap"><div className="empty-state"><JxIcon name="users" size={32} color="var(--tm)" /><p>Sin obra activa</p></div></div>;
  }
  if (loading) {
    return (
      <div className="page-wrap">
        <div className="empty-state">
          <JxIcon name="users" size={32} color="var(--tm)" />
          <p>Cargando personal…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Contratos de Personal</div>
          <div className="pg-sub">Gestión de contratos laborales para planillas</div>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
        <div className="card card-p">
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>Trabajadores activos</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{kpis.total}</div>
        </div>
        <div className="card card-p">
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>Con contrato vigente</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: 'var(--green)' }}>{kpis.vigentes}</div>
        </div>
        <div className="card card-p">
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>Sin contrato</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4, color: 'var(--red)' }}>{kpis.sin}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div className="search-bar">
          <JxIcon name="search" size={14} color="var(--tm)" />
          <input
            placeholder="Buscar por nombre, DNI o cargo…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        {loadingC && <span style={{ fontSize: 11, color: 'var(--tm)', alignSelf: 'center' }}>Cargando contratos…</span>}
      </div>

      {personalActivo.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="users" size={40} color="var(--tm)" />
          <p>No hay trabajadores activos en esta obra. Registra personal primero.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Trabajador</th>
                <th>DNI</th>
                <th>Cargo</th>
                <th>Estado contrato</th>
                <th style={{ textAlign: 'right' }}>Sueldo básico</th>
                <th>Régimen</th>
                <th>Pensión</th>
                <th style={{ textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const c = contratosByPersonal[p.id];
                const estadoKey = c ? (c.estado || 'vigente') : 'sin';
                const badge = CONTRATO_BADGE[estadoKey] || CONTRATO_BADGE.sin;
                const pensionLabel = c
                  ? (c.tipo_pension === 'AFP' ? `AFP${c.afp_nombre ? ' · ' + c.afp_nombre : ''}` : 'ONP')
                  : '—';
                return (
                  <tr key={p.id}>
                    <td className="col-p">{p.nombres} {p.apellidos}</td>
                    <td className="col-m">{p.dni || '—'}</td>
                    <td>{p.cargo || '—'}</td>
                    <td><span className={`badge ${badge.class}`}>{badge.label}</span></td>
                    <td className="col-m" style={{ textAlign: 'right' }}>
                      {c ? fmtS(c.sueldo_basico) : '—'}
                    </td>
                    <td>{c ? (REGIMEN_LABEL[c.regimen] || c.regimen) : '—'}</td>
                    <td className="col-m">{pensionLabel}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {puedeGestionar ? (
                        <button
                          className="btn btn-amber btn-xs"
                          onClick={() => abrirGestionar(p)}
                          title={c ? 'Editar contrato' : 'Crear contrato'}
                        >
                          <JxIcon name={c ? 'edit' : 'plus'} size={11} />
                          {c ? 'Gestionar contrato' : 'Crear contrato'}
                        </button>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--tm)' }}>solo gerencia</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: gestionar contrato */}
      {modal === 'gestionar' && target && (
        <Modal
          title={`${editingId ? 'Editar' : 'Nuevo'} contrato — ${target.nombres} ${target.apellidos}`}
          icon="user"
          onClose={cerrarModal}
          wide
        >
          <div className="g2">
            <div>
              <label className="flabel">Fecha inicio *</label>
              <input
                className="fi" type="date"
                value={form.fecha_inicio || ''}
                onChange={e => setForm({ ...form, fecha_inicio: e.target.value })}
              />
            </div>
            <div>
              <label className="flabel">Fecha fin (opcional)</label>
              <input
                className="fi" type="date"
                value={form.fecha_fin || ''}
                onChange={e => setForm({ ...form, fecha_fin: e.target.value })}
              />
            </div>

            <div>
              <label className="flabel">Sueldo básico (S/) *</label>
              <input
                className="fi" type="number" step="0.01" min="0"
                value={form.sueldo_basico ?? ''}
                onChange={e => setForm({ ...form, sueldo_basico: e.target.value })}
              />
            </div>
            <div>
              <label className="flabel">Asignación familiar (S/)</label>
              <input
                className="fi" type="number" step="0.01" min="0"
                value={form.asignacion_familiar ?? ''}
                onChange={e => setForm({ ...form, asignacion_familiar: e.target.value })}
              />
            </div>

            <div>
              <label className="flabel">Bonificaciones fijas (S/)</label>
              <input
                className="fi" type="number" step="0.01" min="0"
                value={form.bonificaciones_fijas ?? ''}
                onChange={e => setForm({ ...form, bonificaciones_fijas: e.target.value })}
              />
            </div>
            <div>
              <label className="flabel">Régimen</label>
              <select
                className="fi"
                value={form.regimen || 'construccion_civil'}
                onChange={e => setForm({ ...form, regimen: e.target.value })}
              >
                <option value="construccion_civil">Construcción Civil</option>
                <option value="general">General</option>
                <option value="agrario">Agrario</option>
                <option value="mype">MYPE</option>
              </select>
            </div>

            <div>
              <label className="flabel">Tipo de pensión</label>
              <select
                className="fi"
                value={form.tipo_pension || 'ONP'}
                onChange={e => setForm({ ...form, tipo_pension: e.target.value })}
              >
                <option value="ONP">ONP</option>
                <option value="AFP">AFP</option>
              </select>
            </div>
            <div>
              <label className="flabel">Cargo en planilla</label>
              <input
                className="fi"
                value={form.cargo_planilla || ''}
                onChange={e => setForm({ ...form, cargo_planilla: e.target.value })}
              />
            </div>

            {form.tipo_pension === 'AFP' && (
              <>
                <div>
                  <label className="flabel">AFP</label>
                  <select
                    className="fi"
                    value={form.afp_nombre || ''}
                    onChange={e => setForm({ ...form, afp_nombre: e.target.value })}
                  >
                    <option value="">— Selecciona AFP —</option>
                    {AFP_NOMBRES.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="flabel">% Aporte obligatorio</label>
                  <input
                    className="fi" type="number" step="0.01" min="0"
                    value={form.afp_pct_aporte_obligatorio ?? ''}
                    onChange={e => setForm({ ...form, afp_pct_aporte_obligatorio: e.target.value })}
                  />
                </div>
                <div>
                  <label className="flabel">% Seguro</label>
                  <input
                    className="fi" type="number" step="0.01" min="0"
                    value={form.afp_pct_seguro ?? ''}
                    onChange={e => setForm({ ...form, afp_pct_seguro: e.target.value })}
                  />
                </div>
                <div>
                  <label className="flabel">% Comisión</label>
                  <input
                    className="fi" type="number" step="0.01" min="0"
                    value={form.afp_pct_comision ?? ''}
                    onChange={e => setForm({ ...form, afp_pct_comision: e.target.value })}
                  />
                </div>
              </>
            )}

            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 16, alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={!!form.tiene_essalud}
                  onChange={e => setForm({ ...form, tiene_essalud: e.target.checked })}
                />
                Tiene EsSalud (aporte 9% empleador)
              </label>
              <div style={{ flex: 1 }}>
                <label className="flabel">Estado del contrato</label>
                <select
                  className="fi"
                  value={form.estado || 'vigente'}
                  onChange={e => setForm({ ...form, estado: e.target.value })}
                >
                  <option value="vigente">Vigente</option>
                  <option value="suspendido">Suspendido</option>
                  <option value="liquidado">Liquidado</option>
                </select>
              </div>
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label className="flabel">Domicilio fiscal</label>
              <input
                className="fi"
                value={form.domicilio_fiscal || ''}
                onChange={e => setForm({ ...form, domicilio_fiscal: e.target.value })}
              />
            </div>

            <div>
              <label className="flabel">Cuenta bancaria</label>
              <input
                className="fi"
                placeholder="Nº de cuenta para abono de sueldo"
                value={form.cuenta_bancaria || ''}
                onChange={e => setForm({ ...form, cuenta_bancaria: e.target.value })}
              />
            </div>
            <div>
              <label className="flabel">CCI</label>
              <input
                className="fi"
                placeholder="Código de cuenta interbancario"
                value={form.cci || ''}
                onChange={e => setForm({ ...form, cci: e.target.value })}
              />
            </div>

            <div style={{ gridColumn: '1 / -1' }}>
              <label className="flabel">Notas</label>
              <textarea
                className="fi"
                rows={2}
                value={form.notas || ''}
                onChange={e => setForm({ ...form, notas: e.target.value })}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={cerrarModal}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}>
              <JxIcon name="check" size={13} />
              {editingId ? 'Guardar cambios' : 'Crear contrato'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { PersonalContratosPage });
