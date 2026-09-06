import React from "react";
import { useFotosEvidencias, FotoInsumoCell } from "./jx-foto-insumo.jsx";
import { etiquetaPersona } from "../lib/destino-mov.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return 'S/ ' + (v/1e6).toFixed(2) + 'M';
  if (Math.abs(v) >= 1e3) return 'S/ ' + (v/1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const AP_TYPES = [
  { v:'excavadora', l:'Excavadora' },
  { v:'retroexcavadora', l:'Retroexcavadora' },
  { v:'volquete', l:'Volquete' },
  { v:'cargador', l:'Cargador frontal' },
  { v:'tractor', l:'Tractor' },
  { v:'motoniveladora', l:'Motoniveladora' },
  { v:'rodillo', l:'Rodillo' },
  { v:'grua', l:'Grúa' },
  { v:'pavimentadora', l:'Pavimentadora' },
  { v:'bulldozer', l:'Bulldozer' },
  { v:'camion', l:'Camión' },
  { v:'otro', l:'Otro' },
];

function ActivosPesadosPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? 'offline';
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Activos Pesados', 'w') ?? false);
  // Adjuntar foto = permiso de Evidencias: el almacenero (Activos solo lectura)
  // puede ponerle foto a la máquina sin poder editar sus specs.
  const canFoto = canWrite || (window.__hasPerm?.(myRol, 'Evidencias', 'w') ?? false);
  const appMode = window.__useAppMode ? window.__useAppMode() : { superAdmin: false };
  const superAdmin = !!appMode.superAdmin;
  const { data: activos } = window.__hooks.useActivosPesados();
  const { data: companies } = window.__hooks.useCompanies();
  const { data: obras } = window.__hooks.useObras();
  const { data: hms } = window.__hooks.useHorasMaquina();
  // Custodia: a quién se le asigna el equipo (personal de la obra activa o subcontratista).
  const { obraId: obraActivaId } = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const { data: personal } = window.__hooks.usePersonal(obraActivaId);
  const { data: subcontratistas } = window.__hooks.useSubcontratistas();
  // id → razón social para etiquetar personas con su subcontrato en el selector.
  const subNameAct = uM(() => new Map((subcontratistas || []).map(s => [s.id, s.razon_social])), [subcontratistas]);
  const movMaqHook = window.__hooks.useMovimientosMaquinaria(obraActivaId);
  // Frentes de trabajo activos de la obra → picker opcional en la salida de custodia.
  const { data: frentes } = window.__hooks.useFrentesObra(obraActivaId, { soloActivas: true });
  // Fotos del catálogo de máquinas (todas las obras: los activos rotan entre obras).
  const fotosActivos = useFotosEvidencias(null, 'foto_activo');

  const [modal, setModal] = uS(null);
  const [editing, setEditing] = uS(null);
  const [form, setForm] = uS({});
  const [hmModal, setHmModal] = uS(null); // activo seleccionado para registrar HM/comb/mant
  const [historial, setHistorial] = uS(null); // { activo, hm: [], cb: [], mt: [] }
  // Asignación / devolución de custodia
  const [asignModal, setAsignModal] = uS(null); // { activo, mode:'salida'|'entrada' }
  const [asignForm, setAsignForm] = uS({});
  const [frenteSalida, setFrenteSalida] = uS(''); // frente donde opera la máquina (obligatorio salvo "completar después", solo salida)
  const [frentePendiente, setFrentePendiente] = uS(false); // salida sin frente → marcada como pendiente para completar luego
  const [asignFoto, setAsignFoto] = uS(null);   // { blob, url }
  const [busyAsign, setBusyAsign] = uS(false);
  const [editFechaMaq, setEditFechaMaq] = uS(null); // { tipo, row } en edición de fecha (Super Admin)
  const [editFechaMaqVal, setEditFechaMaqVal] = uS('');

  // Recarga los registros del historial del activo abierto.
  const recargarHistorial = async (activo) => {
    const a = activo || historial?.activo;
    if (!a) return;
    const [hm, cb, mt, mv] = await Promise.all([
      window.__db.horas_maquina.where('activo_id').equals(a.id).filter(x => !x.deleted_at).toArray(),
      window.__db.consumos_combustible.where('activo_id').equals(a.id).filter(x => !x.deleted_at).toArray(),
      window.__db.mantenimientos_maquinaria.where('activo_id').equals(a.id).filter(x => !x.deleted_at).toArray(),
      window.__db.movimientos_maquinaria.where('activo_id').equals(a.id).filter(x => !x.deleted_at).toArray(),
    ]);
    const desc = (arr) => arr.sort((x, y) => (y.fecha || '').localeCompare(x.fecha || ''));
    const aFresh = (await window.__db.activos_pesados.get(a.id)) || a;
    setHistorial({ activo: aFresh, hm: desc(hm), cb: desc(cb), mt: desc(mt), mv: desc(mv) });
  };
  const TABLA_HIST = { mv: 'movimientos_maquinaria', hm: 'horas_maquina', cb: 'consumos_combustible', mt: 'mantenimientos_maquinaria' };
  // Super Admin: eliminar un registro del historial (ajusta HM acumuladas / custodia).
  const borrarHistorial = async (tipo, row) => {
    if (!superAdmin) return;
    if (!confirm('¿Eliminar este registro del historial? (Super Admin)')) return;
    const tabla = TABLA_HIST[tipo];
    try {
      const now = new Date().toISOString();
      await window.__db[tabla].update(row.id, { deleted_at: now, updated_at: now, updated_by: userId, version: (row.version ?? 0) + 1, sync_status: row.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete' });
      // HM: descontar las horas del acumulado del activo.
      if (tipo === 'hm') {
        const a = await window.__db.activos_pesados.get(row.activo_id);
        if (a) await window.__db.activos_pesados.update(a.id, { hm_acumuladas: Math.max(0, Number(a.hm_acumuladas || 0) - Number(row.horas_trabajadas || 0)), updated_at: now, version: (a.version ?? 0) + 1, sync_status: a.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
      }
      // Custodia: si borro el movimiento que dejó el equipo asignado, lo libero.
      if (tipo === 'mv') {
        const a = await window.__db.activos_pesados.get(row.activo_id);
        if (a && row.tipo_movimiento === 'salida' && a.asignado_a_id && a.fecha_asignacion === row.fecha) {
          await window.__db.activos_pesados.update(a.id, { asignado_a_tipo: null, asignado_a_id: null, asignado_a_nombre: null, fecha_asignacion: null, updated_at: now, version: (a.version ?? 0) + 1, sync_status: a.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
        }
      }
      try { await window.__logAudit?.({ action: 'delete', table: tabla, recordId: row.id, oldData: row, reason: 'Super Admin · eliminar registro de historial de maquinaria' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } })); } catch {}
      showToast('Registro eliminado', 'amber');
      await recargarHistorial();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const guardarFechaMaq = async () => {
    if (!editFechaMaq || !editFechaMaqVal) { showToast('Elegí una fecha', 'red'); return; }
    const { tipo, row } = editFechaMaq;
    const tabla = TABLA_HIST[tipo];
    try {
      await window.__db[tabla].update(row.id, { fecha: editFechaMaqVal, updated_at: new Date().toISOString(), updated_by: userId, version: (row.version ?? 0) + 1, sync_status: row.sync_status === 'pending_create' ? 'pending_create' : 'pending_update' });
      try { await window.__logAudit?.({ action: 'update', table: tabla, recordId: row.id, oldData: { fecha: row.fecha }, newData: { fecha: editFechaMaqVal }, reason: 'Super Admin · corrección de fecha histórica de maquinaria' }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } })); } catch {}
      showToast('Fecha actualizada', 'green');
      setEditFechaMaq(null); await recargarHistorial();
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
  };
  const accionesSA = (tipo, row) => superAdmin ? (
    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
      <button className="btn btn-ghost btn-xs" title="⚡ Editar fecha" style={{ color: 'var(--red)', padding: '0 4px' }} onClick={() => { setEditFechaMaq({ tipo, row }); setEditFechaMaqVal((row.fecha || '').slice(0, 10)); }}>📅</button>
      <button className="btn btn-red btn-xs" title="⚡ Eliminar" onClick={() => borrarHistorial(tipo, row)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={10} /></button>
    </td>
  ) : null;

  // Ubicaciones del catálogo de la obra seleccionada en el form
  const { data: ubicaciones } = window.__hooks.useUbicacionesObra?.(form.obra_actual_id || null) || { data: [] };
  const ubicacionesActivas = uM(() => (ubicaciones || []).filter(u => u.activo !== false && !u.deleted_at), [ubicaciones]);

  // Cache de todas las ubicaciones por id (de todas las obras) para mostrar en la tabla principal
  const [ubicacionesAll, setUbicacionesAll] = uS({});
  uE(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const all = await window.__db.ubicaciones_obra.filter(u => !u.deleted_at).toArray();
        if (cancelled) return;
        const map = {};
        all.forEach(u => { map[u.id] = u; });
        setUbicacionesAll(map);
      } catch {}
    };
    load();
    const onChange = (e) => { if (!e?.detail?.tabla || e.detail.tabla === 'ubicaciones_obra') load(); };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', load);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jx_sync_pull', load);
    };
  }, []);

  // KPIs por activo (HM acumuladas, combustible total, mantenim total)
  const [kpisActivo, setKpisActivo] = uS({});
  uE(() => {
    if (!activos) return;
    let cancelled = false;
    (async () => {
      const out = {};
      for (const a of activos) {
        try {
          const hm = await window.__db.horas_maquina.where('activo_id').equals(a.id).filter(x=>!x.deleted_at).toArray();
          const cb = await window.__db.consumos_combustible.where('activo_id').equals(a.id).filter(x=>!x.deleted_at).toArray();
          const mt = await window.__db.mantenimientos_maquinaria.where('activo_id').equals(a.id).filter(x=>!x.deleted_at).toArray();
          const horasTotal = hm.reduce((s,h)=>s+Number(h.horas_trabajadas||0),0);
          const combTotal = cb.reduce((s,c)=>s+Number(c.total||0),0);
          const mantTotal = mt.reduce((s,m)=>s+Number(m.costo_total||0),0);
          out[a.id] = { horasTotal, combTotal, mantTotal,
            costoHora: horasTotal > 0 ? (combTotal+mantTotal)/horasTotal : 0 };
        } catch { out[a.id] = { horasTotal:0, combTotal:0, mantTotal:0, costoHora:0 }; }
      }
      if (!cancelled) setKpisActivo(out);
    })();
    return () => { cancelled = true; };
  }, [activos, hms]);

  const openNuevo = () => {
    setForm({
      codigo:'', nombre:'', tipo:'excavadora', marca:'', modelo:'',
      anio: new Date().getFullYear(), placa:'', serie:'',
      costo_adquisicion: '', vida_util_anios: 5,
      hm_acumuladas: 0, estado: 'operativo',
      company_id: '', obra_actual_id: '', ubicacion_id: '',
    });
    setEditing(null);
    setModal('activo');
  };

  const openEditar = (a) => {
    setForm({ ...a, ubicacion_id: a.ubicacion_id || '' });
    setEditing(a);
    setModal('activo');
  };

  const guardar = async () => {
    if (!form.nombre?.trim()) { showToast('Nombre requerido', 'red'); return; }
    const now = new Date().toISOString();
    try {
      if (editing) {
        await window.__db.activos_pesados.update(editing.id, {
          ...form,
          costo_adquisicion: parseFloat(form.costo_adquisicion)||null,
          anio: parseInt(form.anio)||null,
          vida_util_anios: parseInt(form.vida_util_anios)||5,
          hm_acumuladas: parseFloat(form.hm_acumuladas)||0,
          company_id: form.company_id || null,
          obra_actual_id: form.obra_actual_id || null,
          // `obra_id` ADEMÁS de `obra_actual_id`, y no es cosmético: el cerco de
          // obra de la mig 177 filtra por `obra_id`, y su primera cláusula es
          // `obra_id IS NULL OR …` — o sea, NULL = fila del grupo, visible para
          // TODOS. Esta pantalla escribía solo `obra_actual_id`, así que cada
          // equipo dado de alta aquí nacía fuera del cerco y lo veían los
          // usuarios de todas las obras. (Las 2 filas reales de producción no
          // tienen el problema porque entraron por Compras Pendientes, que sí
          // escribe obra_id.)
          obra_id: form.obra_actual_id || null,
          ubicacion_id: form.ubicacion_id || null,
          updated_at: now, updated_by: userId,
          version: (editing.version ?? 0) + 1,
          sync_status: editing.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } else {
        const id = window.__newId();
        await window.__db.activos_pesados.add({
          id,
          codigo: form.codigo || null,
          nombre: form.nombre.trim(),
          tipo: form.tipo, marca: form.marca || null, modelo: form.modelo || null,
          anio: parseInt(form.anio)||null,
          placa: form.placa || null, serie: form.serie || null,
          costo_adquisicion: parseFloat(form.costo_adquisicion)||null,
          fecha_adquisicion: form.fecha_adquisicion || null,
          vida_util_anios: parseInt(form.vida_util_anios)||5,
          depreciacion_acumulada: 0,
          hm_acumuladas: parseFloat(form.hm_acumuladas)||0,
          hm_proximo_mant: null,
          estado: form.estado || 'operativo',
          company_id: form.company_id || null,
          obra_actual_id: form.obra_actual_id || null,
          obra_id: form.obra_actual_id || null,   // ver el comentario de arriba: cerco RLS de la mig 177
          ubicacion_id: form.ubicacion_id || null,
          notas: form.notas || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_ap_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'activos_pesados' } })); } catch {}
      showToast(editing ? 'Activo actualizado' : 'Activo creado', 'green');
      setModal(null); setEditing(null);
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const eliminar = async (a) => {
    if (!isAdmin) return;
    if (!confirm(`¿Dar de baja "${a.nombre}"?`)) return;
    try {
      await window.__db.activos_pesados.update(a.id, {
        deleted_at: new Date().toISOString(),
        sync_status: a.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'activos_pesados' } })); } catch {}
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  // ── Custodia: salida (asignación) / devolución ─────────────────────
  const openAsignar = (a, mode) => {
    setAsignModal({ activo: a, mode });
    setAsignForm({ fecha: new Date().toISOString().slice(0, 10), destino_tipo: 'personal', destino_id: '', observaciones: '' });
    setFrenteSalida(''); setFrentePendiente(false);
    if (asignFoto?.url) { try { URL.revokeObjectURL(asignFoto.url); } catch {} }
    setAsignFoto(null);
  };
  const onAsignFoto = (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    if (!f.type.startsWith('image/')) { showToast('Solo se permiten imágenes', 'red'); return; }
    if (f.size > 8 * 1024 * 1024) { showToast('La foto supera los 8 MB', 'red'); return; }
    if (asignFoto?.url) { try { URL.revokeObjectURL(asignFoto.url); } catch {} }
    setAsignFoto({ blob: f, url: URL.createObjectURL(f) });
  };
  const guardarAsignacion = async () => {
    if (busyAsign || !asignModal) return;
    const { activo, mode } = asignModal;
    const esSalida = mode === 'salida';
    if (esSalida && !asignForm.destino_id) { showToast('Elegí a quién se le asigna el equipo', 'red'); return; }
    if (esSalida && !frenteSalida && !frentePendiente) { showToast('Elegí el frente de trabajo, o marcá "lo completo después".', 'red'); return; }
    const obraId = obraActivaId || activo.obra_actual_id || null;
    setBusyAsign(true);
    try {
      const now = new Date().toISOString();
      let responsable_id = null, subcontratista_id = null, destino_tipo = null, destino_nombre = null;
      if (esSalida) {
        destino_tipo = asignForm.destino_tipo;
        if (destino_tipo === 'personal') {
          responsable_id = asignForm.destino_id;
          const p = (personal || []).find(x => x.id === responsable_id);
          destino_nombre = p ? `${p.nombres} ${p.apellidos || ''}`.trim() : null;
        } else {
          subcontratista_id = asignForm.destino_id;
          const s = (subcontratistas || []).find(x => x.id === subcontratista_id);
          destino_nombre = s ? s.razon_social : null;
        }
      }
      // Movimiento (la custodia y la evidencia se enlazan con su id real).
      const mov = await movMaqHook.create({
        obra_id: obraId, activo_id: activo.id, fecha: asignForm.fecha,
        tipo_movimiento: esSalida ? 'salida' : 'entrada',
        cantidad: null, unidad: null,
        responsable_id, subcontratista_id, destino_tipo,
        frente_id: esSalida ? (frenteSalida || null) : null,
        frente_pendiente: (esSalida && !frenteSalida) ? true : false,
        observaciones: asignForm.observaciones?.trim() || (esSalida ? `Asignado a ${destino_nombre || '—'}` : 'Devolución'),
      });
      // Foto (prueba física) → evidencia local enlazada al movimiento
      if (asignFoto?.blob && mov?.id) {
        const evId = window.__newId();
        try {
          await window.__saveEvidenciaLocal?.({
            id: evId, obra_id: obraId, tipo_evidencia: 'movimiento_maquinaria',
            modulo_relacionado: 'movimientos_maquinaria', registro_relacionado_id: mov.id,
            nombre_archivo: `maquinaria_${mode}_${mov.id}.jpg`, mime_type: asignFoto.blob.type || 'image/jpeg',
            blob: asignFoto.blob, observaciones: `${esSalida ? 'Salida' : 'Devolución'} · ${activo.nombre}`,
            fecha: asignForm.fecha, created_by: userId,
          });
          await movMaqHook.update(mov.id, { evidencia_id: evId });
        } catch {}
      }
      // Custodia denormalizada en el activo
      await window.__db.activos_pesados.update(activo.id, esSalida ? {
        asignado_a_tipo: destino_tipo, asignado_a_id: asignForm.destino_id, asignado_a_nombre: destino_nombre, fecha_asignacion: asignForm.fecha,
        updated_at: now, version: (activo.version ?? 0) + 1,
        sync_status: activo.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      } : {
        asignado_a_tipo: null, asignado_a_id: null, asignado_a_nombre: null, fecha_asignacion: null,
        updated_at: now, version: (activo.version ?? 0) + 1,
        sync_status: activo.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try { await window.__logAudit?.({ action: 'insert', table: 'movimientos_maquinaria', recordId: mov?.id, reason: `${esSalida ? 'Salida/asignación' : 'Devolución'} de ${activo.nombre}${destino_nombre ? ` → ${destino_nombre}` : ''}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'activos_pesados' } })); } catch {}
      showToast(esSalida ? `Equipo asignado a ${destino_nombre || '—'}` : 'Devolución registrada', 'green');
      if (asignFoto?.url) { try { URL.revokeObjectURL(asignFoto.url); } catch {} }
      setAsignModal(null); setAsignForm({}); setFrenteSalida(''); setFrentePendiente(false); setAsignFoto(null);
    } catch (e) { showToast('Error: ' + (e.message || e), 'red'); }
    finally { setBusyAsign(false); }
  };

  // Form para registrar HM, combustible, mantenimiento
  const [tipoRegistro, setTipoRegistro] = uS('hm'); // hm | comb | mant
  const [formReg, setFormReg] = uS({});

  const openHm = (a) => {
    setHmModal(a);
    setTipoRegistro('hm');
    setFormReg({
      fecha: new Date().toISOString().slice(0,10),
      horas_trabajadas: '',
      hm_inicial: a.hm_acumuladas,
      hm_final: '',
      operador_id: '',
      obra_id: a.obra_actual_id || '',
      actividad: '',
    });
  };

  const guardarRegistro = async () => {
    const now = new Date().toISOString();
    const id = window.__newId();
    try {
      if (tipoRegistro === 'hm') {
        const horas = parseFloat(formReg.horas_trabajadas) || 0;
        if (horas <= 0) { showToast('Horas inválidas', 'red'); return; }
        await window.__db.horas_maquina.add({
          id, activo_id: hmModal.id,
          obra_id: formReg.obra_id || hmModal.obra_actual_id,
          fecha: formReg.fecha,
          horas_trabajadas: horas,
          hm_inicial: parseFloat(formReg.hm_inicial)||null,
          hm_final: parseFloat(formReg.hm_final)||null,
          operador_id: formReg.operador_id || null,
          actividad: formReg.actividad || null,
          observaciones: formReg.observaciones || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_hm_${id}`,
        });
        // Actualizar hm acumuladas del activo
        await window.__db.activos_pesados.update(hmModal.id, {
          hm_acumuladas: Number(hmModal.hm_acumuladas||0) + horas,
          updated_at: now,
          version: (hmModal.version ?? 0) + 1,
          sync_status: hmModal.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'horas_maquina' } })); } catch {}
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'activos_pesados' } })); } catch {}
        showToast(`+${horas} HM registradas`, 'green');
      } else if (tipoRegistro === 'comb') {
        const galones = parseFloat(formReg.galones) || 0;
        const precio = parseFloat(formReg.precio_galon) || 0;
        if (galones <= 0) { showToast('Galones inválidos', 'red'); return; }
        await window.__db.consumos_combustible.add({
          id, activo_id: hmModal.id,
          obra_id: formReg.obra_id || hmModal.obra_actual_id,
          fecha: formReg.fecha,
          galones, precio_galon: precio,
          total: +(galones * precio).toFixed(2),
          surtidor: formReg.surtidor || null,
          hm_actuales: parseFloat(formReg.hm_actuales)||null,
          observaciones: formReg.observaciones || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_cc_${id}`,
        });
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'consumos_combustible' } })); } catch {}
        showToast(`${galones} gal × ${fmtS(precio)} = ${fmtS(galones*precio)} registrados`, 'green');
      } else if (tipoRegistro === 'mant') {
        if (!formReg.descripcion?.trim()) { showToast('Descripción requerida', 'red'); return; }
        const repuestos = parseFloat(formReg.costo_repuestos) || 0;
        const mo = parseFloat(formReg.costo_mano_obra) || 0;
        await window.__db.mantenimientos_maquinaria.add({
          id, activo_id: hmModal.id,
          fecha: formReg.fecha,
          tipo: formReg.tipo_mant || 'preventivo',
          hm_actuales: parseFloat(formReg.hm_actuales)||null,
          descripcion: formReg.descripcion.trim(),
          costo_repuestos: repuestos,
          costo_mano_obra: mo,
          costo_total: +(repuestos + mo).toFixed(2),
          taller: formReg.taller || null,
          mecanico: formReg.mecanico || null,
          duracion_horas: parseFloat(formReg.duracion_horas)||null,
          observaciones: formReg.observaciones || null,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_mm_${id}`,
        });
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'mantenimientos_maquinaria' } })); } catch {}
        showToast('Mantenimiento registrado', 'green');
      }
      setHmModal(null); setFormReg({});
    } catch (e) { showToast('Error: '+e.message, 'red'); }
  };

  const lookupCo = (id) => companies?.find(c => c.id === id);
  const lookupOb = (id) => obras?.find(o => o.id === id);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Activos Pesados / Maquinaria</div>
          <div className="pg-sub">{(activos||[]).length} equipos · {(activos||[]).filter(a=>a.estado==='operativo').length} operativos{(activos||[]).filter(a=>a.maneja_cantidad).length>0?` · ${(activos||[]).filter(a=>a.maneja_cantidad).length} por cantidad`:''}</div>
        </div>
        {canWrite ? (
          <button className="btn btn-amber btn-sm" onClick={openNuevo}>
            <JxIcon name="plus" size={13}/>Nuevo Equipo
          </button>
        ) : (
          <span className="badge b-gray" title="Tu rol es solo lectura para Activos Pesados">Solo lectura</span>
        )}
      </div>

      {(activos||[]).length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="tool" size={40} color="var(--tm)"/>
          <p>No hay equipos pesados registrados.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Código</th><th>Equipo</th><th>Tipo</th><th>Placa / Stock</th>
                <th>Estado</th><th>Obra actual</th><th>Ubicación</th>
                <th style={{ textAlign:'right' }}>HM acum.</th>
                <th style={{ textAlign:'right' }}>Combust.</th>
                <th style={{ textAlign:'right' }}>Mantenim.</th>
                <th style={{ textAlign:'right' }}>Costo/HM</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {(activos||[]).map(a => {
                  const k = kpisActivo[a.id] || {};
                  return (
                    <tr key={a.id}>
                      <td className="col-m" style={{ fontFamily:'monospace' }}>{a.codigo || '—'}</td>
                      <td className="col-p">
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <FotoInsumoCell obraId={a.obra_actual_id || obraActivaId} tipoEvidencia="foto_activo" modulo="activos_pesados"
                            registroId={a.id} nombre={a.nombre} foto={fotosActivos.get(a.id)}
                            canFoto={canFoto} userId={userId} showToast={showToast}/>
                          <div>
                            <strong>{a.nombre}</strong>
                            {a.marca && <div style={{ fontSize:10, color:'var(--tm)' }}>{a.marca} {a.modelo} {a.anio}</div>}
                            {a.asignado_a_id && <div style={{ fontSize:10.5, color:'var(--amber)', marginTop:2 }} title={`En custodia desde ${a.fecha_asignacion || '—'}`}>🔧 En uso: {a.asignado_a_nombre || '—'}{a.fecha_asignacion ? ` · ${a.fecha_asignacion}` : ''}</div>}
                          </div>
                        </div>
                      </td>
                      <td><span className="tag">{AP_TYPES.find(t=>t.v===a.tipo)?.l || a.tipo}</span></td>
                      <td className="col-m">{a.maneja_cantidad
                        ? (() => {
                            const st = Number(a.stock_actual ?? 0);
                            const cls = (a.alerta === 'agotado' || a.alerta === 'critico') ? 'b-red'
                              : (a.alerta === 'reponer' || a.alerta === 'cerca') ? 'b-amber' : 'b-green';
                            return <span className={`badge ${cls}`} title="Stock por cantidad">{st.toLocaleString('es-PE')} {a.unidad || 'und'}</span>;
                          })()
                        : (a.placa || '—')}</td>
                      <td><span className={`badge ${a.estado==='operativo'?'b-green':a.estado==='mantenimiento'?'b-amber':a.estado==='reparacion'?'b-red':'b-gray'}`}>{a.estado}</span></td>
                      <td>{lookupOb(a.obra_actual_id)?.nombre_obra || '—'}</td>
                      <td style={{ fontSize:11 }}>
                        {a.ubicacion_id && ubicacionesAll[a.ubicacion_id]
                          ? <span style={{ color: ubicacionesAll[a.ubicacion_id].activo === false ? 'var(--tm)' : 'var(--tp)' }}>
                              {ubicacionesAll[a.ubicacion_id].nombre}
                              {ubicacionesAll[a.ubicacion_id].activo === false ? ' (inact.)' : ''}
                            </span>
                          : <span style={{ color:'var(--tm)' }}>—</span>}
                      </td>
                      <td style={{ textAlign:'right', fontWeight:600 }}>{(k.horasTotal||0).toFixed(1)}</td>
                      <td style={{ textAlign:'right', color:'var(--orange)' }}>{fmtSk(k.combTotal||0)}</td>
                      <td style={{ textAlign:'right', color:'var(--red)' }}>{fmtSk(k.mantTotal||0)}</td>
                      <td style={{ textAlign:'right', fontWeight:700, color:'var(--blue)' }}>{fmtS(k.costoHora||0)}</td>
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        <button className="btn btn-amber btn-xs" title="Registrar HM / Comb / Mant" onClick={()=>openHm(a)}>
                          <JxIcon name="plus" size={11}/>
                        </button>
                        {/* Custodia: asignar (salida) / devolución. Solo equipos con placa (no por cantidad). */}
                        {canWrite && !a.maneja_cantidad && (
                          a.asignado_a_id
                            ? <button className="btn btn-green btn-xs" title="Registrar devolución" onClick={()=>openAsignar(a,'entrada')} style={{ marginLeft:4 }}><JxIcon name="arrowIn" size={11}/></button>
                            : <button className="btn btn-ghost btn-xs" title="Asignar equipo (salida)" onClick={()=>openAsignar(a,'salida')} style={{ marginLeft:4 }}><JxIcon name="arrowOut" size={11}/></button>
                        )}
                        <button className="btn btn-ghost btn-xs" title="Ver historial completo (custodia, HM, combustible, mantenimiento)" onClick={async ()=>{
                          try { await recargarHistorial(a); }
                          catch (e) { showToast('Error cargando historial: '+(e.message||e), 'red'); }
                        }} style={{ marginLeft:4 }}>
                          <JxIcon name="list" size={11}/>
                        </button>
                        <button className="btn btn-ghost btn-xs" title="Editar" onClick={()=>openEditar(a)} style={{ marginLeft:4 }}>
                          <JxIcon name="edit" size={11}/>
                        </button>
                        {isAdmin && (
                          <button className="btn btn-red btn-xs" title="Dar de baja" onClick={()=>eliminar(a)} style={{ marginLeft:4 }}>
                            <JxIcon name="trash" size={11}/>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal crear/editar activo */}
      {modal === 'activo' && (
        <Modal title={editing ? 'Editar Equipo' : 'Nuevo Equipo Pesado'} icon="tool" onClose={()=>{setModal(null); setEditing(null);}} wide>
          <div className="g2">
            <div><label className="flabel">Código</label><input className="fi" value={form.codigo||''} placeholder="EXC-001" onChange={e=>setForm({...form, codigo:e.target.value})}/></div>
            <div><label className="flabel">Nombre *</label><input className="fi" value={form.nombre||''} placeholder="Excavadora CAT 320" onChange={e=>setForm({...form, nombre:e.target.value})}/></div>
            <div><label className="flabel">Tipo</label>
              <select className="fi" value={form.tipo||'excavadora'} onChange={e=>setForm({...form, tipo:e.target.value})}>
                {AP_TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado||'operativo'} onChange={e=>setForm({...form, estado:e.target.value})}>
                <option value="operativo">Operativo</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="reparacion">Reparación</option>
                <option value="baja">Baja</option>
              </select>
            </div>
            <div><label className="flabel">Marca</label><input className="fi" value={form.marca||''} onChange={e=>setForm({...form, marca:e.target.value})}/></div>
            <div><label className="flabel">Modelo</label><input className="fi" value={form.modelo||''} onChange={e=>setForm({...form, modelo:e.target.value})}/></div>
            <div><label className="flabel">Año</label><input className="fi" type="number" value={form.anio||''} onChange={e=>setForm({...form, anio:e.target.value})}/></div>
            <div><label className="flabel">Placa</label><input className="fi" value={form.placa||''} onChange={e=>setForm({...form, placa:e.target.value})}/></div>
            <div><label className="flabel">N° serie</label><input className="fi" value={form.serie||''} onChange={e=>setForm({...form, serie:e.target.value})}/></div>
            <div><label className="flabel">Costo adquisición (S/)</label><input className="fi" type="number" step="0.01" value={form.costo_adquisicion||''} onChange={e=>setForm({...form, costo_adquisicion:e.target.value})}/></div>
            <div><label className="flabel">Vida útil (años)</label><input className="fi" type="number" value={form.vida_util_anios||5} onChange={e=>setForm({...form, vida_util_anios:e.target.value})}/></div>
            <div><label className="flabel">HM iniciales</label><input className="fi" type="number" step="0.01" value={form.hm_acumuladas||0} onChange={e=>setForm({...form, hm_acumuladas:e.target.value})}/></div>
            <div><label className="flabel">Empresa propietaria</label>
              <select className="fi" value={form.company_id||''} onChange={e=>setForm({...form, company_id:e.target.value})}>
                <option value="">—</option>
                {(companies||[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="flabel">Obra actual</label>
              <select className="fi" value={form.obra_actual_id||''} onChange={e=>setForm({...form, obra_actual_id:e.target.value, ubicacion_id: ''})}>
                <option value="">— en almacén —</option>
                {(obras||[]).filter(o=>!o.deleted_at).map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
              </select>
            </div>
            <div><label className="flabel">Ubicación en obra</label>
              <select
                className="fi"
                value={form.ubicacion_id||''}
                onChange={e=>setForm({...form, ubicacion_id:e.target.value||null})}
                disabled={!form.obra_actual_id}
              >
                <option value="">{form.obra_actual_id ? '— sin asignar —' : '— elegí una obra primero —'}</option>
                {ubicacionesActivas.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                {form.ubicacion_id && ubicacionesAll[form.ubicacion_id] && ubicacionesAll[form.ubicacion_id].activo === false && (
                  <option value={form.ubicacion_id}>{ubicacionesAll[form.ubicacion_id].nombre} (inactiva)</option>
                )}
              </select>
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setModal(null); setEditing(null);}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardar}><JxIcon name="check" size={13}/>{editing?'Guardar':'Crear'}</button>
          </div>
        </Modal>
      )}

      {/* Modal registrar HM/Combustible/Mantenimiento */}
      {hmModal && (
        <Modal title={`Registrar — ${hmModal.nombre}`} icon="plus" onClose={()=>{setHmModal(null); setFormReg({});}} wide>
          <div style={{ display:'flex', gap:6, padding:4, background:'var(--bg-s)', borderRadius:8, marginBottom:14, width:'fit-content' }}>
            {[
              { v:'hm', l:'⏱ Horas-máquina' },
              { v:'comb', l:'⛽ Combustible' },
              { v:'mant', l:'🔧 Mantenimiento' },
            ].map(t => (
              <button key={t.v}
                className={`btn btn-sm ${tipoRegistro===t.v?'btn-amber':'btn-ghost'}`}
                onClick={()=>setTipoRegistro(t.v)}
                style={{ border:'none' }}>
                {t.l}
              </button>
            ))}
          </div>

          {tipoRegistro === 'hm' && (
            <div className="g2">
              <div><label className="flabel">Fecha</label><input className="fi" type="date" value={formReg.fecha||''} onChange={e=>setFormReg({...formReg, fecha:e.target.value})}/></div>
              <div><label className="flabel">Horas trabajadas *</label><input className="fi" type="number" min="0" step="0.1" value={formReg.horas_trabajadas||''} onChange={e=>setFormReg({...formReg, horas_trabajadas:e.target.value})}/></div>
              <div><label className="flabel">HM inicial (horómetro)</label><input className="fi" type="number" step="0.1" value={formReg.hm_inicial||''} onChange={e=>setFormReg({...formReg, hm_inicial:e.target.value})}/></div>
              <div><label className="flabel">HM final</label><input className="fi" type="number" step="0.1" value={formReg.hm_final||''} onChange={e=>setFormReg({...formReg, hm_final:e.target.value})}/></div>
              <div style={{ gridColumn:'1/-1' }}><label className="flabel">Actividad</label><input className="fi" value={formReg.actividad||''} placeholder="Ej: Excavación cimientos zona A" onChange={e=>setFormReg({...formReg, actividad:e.target.value})}/></div>
              <div style={{ gridColumn:'1/-1' }}><label className="flabel">Observaciones</label><textarea className="fi" rows={2} value={formReg.observaciones||''} onChange={e=>setFormReg({...formReg, observaciones:e.target.value})}/></div>
            </div>
          )}

          {tipoRegistro === 'comb' && (
            <div className="g2">
              <div><label className="flabel">Fecha</label><input className="fi" type="date" value={formReg.fecha||''} onChange={e=>setFormReg({...formReg, fecha:e.target.value})}/></div>
              <div><label className="flabel">Galones *</label><input className="fi" type="number" min="0" step="0.01" value={formReg.galones||''} onChange={e=>setFormReg({...formReg, galones:e.target.value})}/></div>
              <div><label className="flabel">Precio por galón</label><input className="fi" type="number" min="0" step="0.0001" value={formReg.precio_galon||''} onChange={e=>setFormReg({...formReg, precio_galon:e.target.value})}/></div>
              <div><label className="flabel">Total</label><input className="fi" disabled value={fmtS((parseFloat(formReg.galones)||0)*(parseFloat(formReg.precio_galon)||0))}/></div>
              <div><label className="flabel">HM al cargar</label><input className="fi" type="number" step="0.1" value={formReg.hm_actuales||''} onChange={e=>setFormReg({...formReg, hm_actuales:e.target.value})}/></div>
              <div><label className="flabel">Surtidor / grifo</label><input className="fi" value={formReg.surtidor||''} onChange={e=>setFormReg({...formReg, surtidor:e.target.value})}/></div>
            </div>
          )}

          {tipoRegistro === 'mant' && (
            <div className="g2">
              <div><label className="flabel">Fecha</label><input className="fi" type="date" value={formReg.fecha||''} onChange={e=>setFormReg({...formReg, fecha:e.target.value})}/></div>
              <div><label className="flabel">Tipo</label>
                <select className="fi" value={formReg.tipo_mant||'preventivo'} onChange={e=>setFormReg({...formReg, tipo_mant:e.target.value})}>
                  <option value="preventivo">Preventivo</option>
                  <option value="correctivo">Correctivo</option>
                </select>
              </div>
              <div style={{ gridColumn:'1/-1' }}><label className="flabel">Descripción *</label><input className="fi" value={formReg.descripcion||''} placeholder="Ej: Cambio de aceite + filtros" onChange={e=>setFormReg({...formReg, descripcion:e.target.value})}/></div>
              <div><label className="flabel">Costo repuestos</label><input className="fi" type="number" min="0" step="0.01" value={formReg.costo_repuestos||''} onChange={e=>setFormReg({...formReg, costo_repuestos:e.target.value})}/></div>
              <div><label className="flabel">Costo mano de obra</label><input className="fi" type="number" min="0" step="0.01" value={formReg.costo_mano_obra||''} onChange={e=>setFormReg({...formReg, costo_mano_obra:e.target.value})}/></div>
              <div><label className="flabel">Total</label><input className="fi" disabled value={fmtS((parseFloat(formReg.costo_repuestos)||0)+(parseFloat(formReg.costo_mano_obra)||0))}/></div>
              <div><label className="flabel">Duración (horas)</label><input className="fi" type="number" step="0.1" value={formReg.duracion_horas||''} onChange={e=>setFormReg({...formReg, duracion_horas:e.target.value})}/></div>
              <div><label className="flabel">Taller</label><input className="fi" value={formReg.taller||''} onChange={e=>setFormReg({...formReg, taller:e.target.value})}/></div>
              <div><label className="flabel">Mecánico</label><input className="fi" value={formReg.mecanico||''} onChange={e=>setFormReg({...formReg, mecanico:e.target.value})}/></div>
            </div>
          )}

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>{setHmModal(null); setFormReg({});}}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardarRegistro}><JxIcon name="check" size={13}/>Registrar</button>
          </div>
        </Modal>
      )}

      {/* Modal historial: HM + Combustible + Mantenimientos del activo */}
      {historial && (
        <Modal title={`Historial · ${historial.activo.nombre}${historial.activo.placa?` (${historial.activo.placa})`:''}`} icon="list" onClose={()=>setHistorial(null)} wide>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 }}>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--blue)' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>HORAS-MÁQUINA</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--blue)' }}>
                {historial.hm.reduce((s,h)=>s+Number(h.horas_trabajadas||0),0).toFixed(1)}
              </div>
              <div style={{ fontSize:11, color:'var(--tm)' }}>{historial.hm.length} registros</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--orange)' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>COMBUSTIBLE</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--orange)' }}>
                {fmtS(historial.cb.reduce((s,c)=>s+Number(c.total||0),0))}
              </div>
              <div style={{ fontSize:11, color:'var(--tm)' }}>{historial.cb.length} cargas · {historial.cb.reduce((s,c)=>s+Number(c.galones||0),0).toFixed(1)} gal</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>MANTENIMIENTOS</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--red)' }}>
                {fmtS(historial.mt.reduce((s,m)=>s+Number(m.costo_total||0),0))}
              </div>
              <div style={{ fontSize:11, color:'var(--tm)' }}>{historial.mt.length} servicios</div>
            </div>
          </div>

          {/* Custodia: salidas (asignación) y devoluciones — quién tuvo el equipo */}
          <div style={{ marginBottom:18 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:'var(--amber)', marginBottom:6 }}>
              🔧 Custodia — salidas y devoluciones
              {historial.activo.asignado_a_id
                ? <span className="badge b-amber" style={{ marginLeft:8 }}>En uso: {historial.activo.asignado_a_nombre || '—'}{historial.activo.fecha_asignacion ? ` · desde ${historial.activo.fecha_asignacion}` : ''}</span>
                : <span className="badge b-green" style={{ marginLeft:8 }}>Disponible en almacén</span>}
            </div>
            {(!historial.mv || historial.mv.length === 0) ? <div style={{ fontSize:11, color:'var(--tm)' }}>Sin movimientos de custodia. Usá ↗ (salida) / ↙ (devolución) en la lista.</div> : (
              <div style={{ maxHeight:180, overflow:'auto', border:'1px solid var(--border)', borderRadius:6 }}>
                <table className="tbl"><thead><tr>
                  <th>Fecha</th><th>Movimiento</th><th>Asignado a</th><th>Prueba</th><th>Observaciones</th>{superAdmin && <th style={{textAlign:'center'}}>⚡</th>}
                </tr></thead><tbody>
                  {historial.mv.map(mv => {
                    const esSalida = mv.tipo_movimiento === 'salida';
                    let quien = '—';
                    if (mv.responsable_id) { const p = (personal||[]).find(x=>x.id===mv.responsable_id); quien = p ? `${p.nombres} ${p.apellidos||''}`.trim() : '—'; }
                    else if (mv.subcontratista_id) { const s = (subcontratistas||[]).find(x=>x.id===mv.subcontratista_id); quien = s ? `${s.razon_social} (subcontrato)` : '—'; }
                    return (
                      <tr key={mv.id}>
                        <td style={{ fontSize:11 }}>{mv.fecha || '—'}</td>
                        <td><span className={`badge ${esSalida ? 'b-amber' : 'b-green'}`}>{esSalida ? '↗ Salida' : '↙ Devolución'}</span></td>
                        <td style={{ fontSize:11 }}>{esSalida ? quien : '—'}</td>
                        <td style={{ fontSize:11 }}>{mv.evidencia_id ? '📷 Sí' : '—'}</td>
                        <td style={{ fontSize:11, color:'var(--tm)' }}>{mv.observaciones || '—'}</td>
                        {accionesSA('mv', mv)}
                      </tr>
                    );
                  })}
                </tbody></table>
              </div>
            )}
          </div>

          {/* HM */}
          <div style={{ marginBottom:18 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:'var(--blue)', marginBottom:6 }}>⏱ Registros de Horas-Máquina</div>
            {historial.hm.length === 0 ? <div style={{ fontSize:11, color:'var(--tm)' }}>Sin registros.</div> : (
              <div style={{ maxHeight:160, overflow:'auto', border:'1px solid var(--border)', borderRadius:6 }}>
                <table className="tbl"><thead><tr>
                  <th>Fecha</th><th>Obra</th><th style={{textAlign:'right'}}>Horas</th><th>Operador</th><th>Notas</th>{superAdmin && <th style={{textAlign:'center'}}>⚡</th>}
                </tr></thead><tbody>
                  {historial.hm.map(h => (
                    <tr key={h.id}>
                      <td style={{ fontSize:11 }}>{h.fecha || '—'}</td>
                      <td style={{ fontSize:11 }}>{lookupOb(h.obra_id)?.nombre_obra || '—'}</td>
                      <td style={{ textAlign:'right', fontWeight:600, color:'var(--blue)' }}>{Number(h.horas_trabajadas||0).toFixed(1)}</td>
                      <td style={{ fontSize:11 }}>{h.operador || '—'}</td>
                      <td style={{ fontSize:11, color:'var(--tm)' }}>{h.notas || '—'}</td>
                      {accionesSA('hm', h)}
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>

          {/* Combustible */}
          <div style={{ marginBottom:18 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:'var(--orange)', marginBottom:6 }}>⛽ Cargas de Combustible</div>
            {historial.cb.length === 0 ? <div style={{ fontSize:11, color:'var(--tm)' }}>Sin registros.</div> : (
              <div style={{ maxHeight:160, overflow:'auto', border:'1px solid var(--border)', borderRadius:6 }}>
                <table className="tbl"><thead><tr>
                  <th>Fecha</th><th style={{textAlign:'right'}}>Galones</th><th style={{textAlign:'right'}}>Precio/gal</th><th style={{textAlign:'right'}}>Total</th><th>Grifo</th><th>Notas</th>{superAdmin && <th style={{textAlign:'center'}}>⚡</th>}
                </tr></thead><tbody>
                  {historial.cb.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontSize:11 }}>{c.fecha || '—'}</td>
                      <td style={{ textAlign:'right' }}>{Number(c.galones||0).toFixed(1)}</td>
                      <td style={{ textAlign:'right' }}>{fmtS(c.precio_galon||0)}</td>
                      <td style={{ textAlign:'right', fontWeight:600, color:'var(--orange)' }}>{fmtS(c.total||0)}</td>
                      <td style={{ fontSize:11 }}>{c.grifo || c.proveedor || '—'}</td>
                      <td style={{ fontSize:11, color:'var(--tm)' }}>{c.notas || '—'}</td>
                      {accionesSA('cb', c)}
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>

          {/* Mantenimientos */}
          <div>
            <div style={{ fontSize:12.5, fontWeight:700, color:'var(--red)', marginBottom:6 }}>🔧 Servicios de Mantenimiento</div>
            {historial.mt.length === 0 ? <div style={{ fontSize:11, color:'var(--tm)' }}>Sin registros.</div> : (
              <div style={{ maxHeight:160, overflow:'auto', border:'1px solid var(--border)', borderRadius:6 }}>
                <table className="tbl"><thead><tr>
                  <th>Fecha</th><th>Tipo</th><th>Descripción</th><th style={{textAlign:'right'}}>Costo</th><th>Taller</th><th>HM al servicio</th>{superAdmin && <th style={{textAlign:'center'}}>⚡</th>}
                </tr></thead><tbody>
                  {historial.mt.map(m => (
                    <tr key={m.id}>
                      <td style={{ fontSize:11 }}>{m.fecha || '—'}</td>
                      <td><span className="tag">{m.tipo || '—'}</span></td>
                      <td style={{ fontSize:11 }}>{m.descripcion || '—'}</td>
                      <td style={{ textAlign:'right', fontWeight:600, color:'var(--red)' }}>{fmtS(m.costo_total || ((Number(m.costo_repuestos)||0)+(Number(m.costo_mano_obra)||0)))}</td>
                      <td style={{ fontSize:11 }}>{m.taller || '—'}</td>
                      <td style={{ textAlign:'right', fontSize:11 }}>{m.hm_actuales != null ? Number(m.hm_actuales).toFixed(1) : '—'}</td>
                      {accionesSA('mt', m)}
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setHistorial(null)}>Cerrar</button>
          </div>
        </Modal>
      )}

      {/* Modal Super Admin: editar fecha de un registro del historial */}
      {editFechaMaq && (
        <Modal title="⚡ Editar fecha del registro" icon="calendar" onClose={()=>setEditFechaMaq(null)}>
          <div style={{ fontSize:12, color:'var(--tm)', marginBottom:12 }}>Corrección de fecha histórica (Super Admin). Original: <strong>{editFechaMaq.row.fecha || '—'}</strong>.</div>
          <label className="flabel">Nueva fecha</label>
          <input className="fi" type="date" max={new Date().toISOString().slice(0,10)} value={editFechaMaqVal} onChange={(e)=>setEditFechaMaqVal(e.target.value)}/>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setEditFechaMaq(null)}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardarFechaMaq}><JxIcon name="check" size={13}/> Guardar fecha</button>
          </div>
        </Modal>
      )}

      {/* Modal asignación (salida) / devolución de custodia */}
      {asignModal && (() => {
        const esSalida = asignModal.mode === 'salida';
        const a = asignModal.activo;
        return (
          <Modal title={esSalida ? `Asignar equipo — ${a.nombre}` : `Devolución — ${a.nombre}`} icon={esSalida ? 'arrowOut' : 'arrowIn'} onClose={()=>{ setAsignModal(null); setAsignForm({}); setFrenteSalida(''); setFrentePendiente(false); if (asignFoto?.url) { try { URL.revokeObjectURL(asignFoto.url); } catch {} } setAsignFoto(null); }}>
            {!esSalida && a.asignado_a_id && (
              <div style={{ padding:'10px 12px', background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.25)', borderRadius:8, fontSize:12.5, color:'var(--ts)', marginBottom:12 }}>
                Actualmente en uso por <strong style={{ color:'var(--amber)' }}>{a.asignado_a_nombre || '—'}</strong>{a.fecha_asignacion ? ` desde el ${a.fecha_asignacion}` : ''}.
              </div>
            )}
            <div className="g2">
              {esSalida && (
                <>
                  <div><label className="flabel">Asignar a</label>
                    <select className="fi" value={asignForm.destino_tipo || 'personal'} onChange={e=>setAsignForm({ ...asignForm, destino_tipo:e.target.value, destino_id:'' })}>
                      <option value="personal">Personal</option>
                      <option value="subcontratista">Subcontratista</option>
                    </select></div>
                  <div><label className="flabel">{asignForm.destino_tipo === 'subcontratista' ? 'Subcontratista' : 'Trabajador'} *</label>
                    {asignForm.destino_tipo === 'subcontratista'
                      ? <select className="fi" value={asignForm.destino_id || ''} onChange={e=>setAsignForm({ ...asignForm, destino_id:e.target.value })}>
                          <option value="">Selecciona…</option>
                          {(subcontratistas||[]).filter(s=>!s.deleted_at).map(s => <option key={s.id} value={s.id}>{s.razon_social}</option>)}
                        </select>
                      : <select className="fi" value={asignForm.destino_id || ''} onChange={e=>setAsignForm({ ...asignForm, destino_id:e.target.value })}>
                          <option value="">Selecciona…</option>
                          {(personal||[]).filter(p=>!p.deleted_at).map(p => <option key={p.id} value={p.id}>{etiquetaPersona(p, subNameAct)}</option>)}
                        </select>}
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label className="flabel">Frente de trabajo *</label>
                    <select className="fi" value={frenteSalida} disabled={frentePendiente} onChange={e => setFrenteSalida(e.target.value)}>
                      <option value="">— Sin frente —</option>
                      {(frentes || []).map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
                    </select>
                    <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:11.5, marginTop:4, color:'var(--tm)' }}>
                      <input type="checkbox" checked={frentePendiente} onChange={e => { setFrentePendiente(e.target.checked); if (e.target.checked) setFrenteSalida(''); }} />
                      No sé el frente todavía — lo completo después (queda marcado como pendiente)
                    </label>
                  </div>
                </>
              )}
              <div><label className="flabel">Fecha</label>
                <input className="fi" type="date" value={asignForm.fecha || ''} max={new Date().toISOString().slice(0,10)} onChange={e=>setAsignForm({ ...asignForm, fecha:e.target.value })}/></div>
              <div style={{ gridColumn: esSalida ? 'auto' : '1/-1' }}><label className="flabel">Observaciones</label>
                <input className="fi" value={asignForm.observaciones || ''} onChange={e=>setAsignForm({ ...asignForm, observaciones:e.target.value })} placeholder={esSalida ? 'Frente, motivo…' : 'Estado de devolución…'}/></div>
              <div style={{ gridColumn:'1/-1' }}>
                <label className="flabel">Prueba física (foto) <span style={{ color:'var(--tm)', textTransform:'none', fontWeight:400 }}>· opcional, recomendada</span></label>
                <input type="file" accept="image/*" onChange={onAsignFoto} style={{ fontSize:12 }}/>
                {asignFoto?.url && <div style={{ marginTop:8 }}><img src={asignFoto.url} alt="prueba" style={{ maxHeight:120, borderRadius:6, border:'1px solid var(--border)' }}/></div>}
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop:16 }}>
              <button className="btn btn-ghost" onClick={()=>{ setAsignModal(null); setAsignForm({}); setFrenteSalida(''); setFrentePendiente(false); if (asignFoto?.url) { try { URL.revokeObjectURL(asignFoto.url); } catch {} } setAsignFoto(null); }} disabled={busyAsign}>Cancelar</button>
              <button className={`btn ${esSalida ? 'btn-amber' : 'btn-green'}`} onClick={guardarAsignacion} disabled={busyAsign}>{busyAsign ? 'Guardando…' : (esSalida ? 'Asignar equipo' : 'Registrar devolución')}</button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

Object.assign(window, { ActivosPesadosPage });
