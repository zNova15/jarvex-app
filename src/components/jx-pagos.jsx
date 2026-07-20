// ═══════════════════════════════════════════════════════════════════
// JARVEX — PAGOS de personal y subcontratos (área contable)
//
// Pedido de Gabriel (jul 2026): aún sin contratos, cada trabajador se paga
// distinto — pocos en PLANILLA, varios con RECIBO POR HONORARIOS, otros de
// otra forma; los SUBCONTRATOS reciben pagos grandes contra un monto
// acordado, muchas veces EN PARTES (900 + 3200 + 2900 = 7000). Todo pago
// exige EVIDENCIA: constancia de transferencia/depósito/agente, y en RxH
// además el recibo emitido por el trabajador.
//
// Modelo: `pagos` (compromiso con monto acordado) + `pagos_partes` (cada
// transferencia parcial, con su evidencia). Evidencias tipo
// 'pago_evidencia' / 'recibo_honorarios' = CONTABLES (solo contadora
// jefe + admin + autor pueden verlas — RLS mig 121 + filtro de galería).
//
// Página del plano OBRA, módulo 'Planillas' (contadora jefe + admin).
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { MODOS_PAGO, MODO_PAGO_LABEL, METODOS_PARTE, METODO_PARTE_LABEL, ESTADOS_PAGO, calcularEstadoPago, validarParte, evidenciasRequeridas, checklistPago } from "../lib/pagos.js";
import { etiquetaPersona } from "../lib/destino-mov.js";
import { categoriaDe } from "../lib/personal-categoria.js";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoyISO = () => (window.__fecha?.hoyLocal ? window.__fecha.hoyLocal() : new Date().toISOString().slice(0, 10));

function PagosPage({ showToast }) {
  const toast = showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = rol === 'admin';
  // Gestión (crear pagos, partes, subir recibos/constancias, cambiar modo de
  // pago): contadora jefe + admin + AYUDANTE de contabilidad (pedido 20-jul:
  // las asistentes registran pagos al personal y suben recibos por honorarios).
  const canGestionar = isAdmin || rol === 'contador' || rol === 'ayudante_contador';
  const obraHook = window.__useObraActiva ? window.__useObraActiva() : { obraId: null };
  const obraId = obraHook?.obraId || null;

  // UNA sola instancia del hook: con dos, el update refrescaba la instancia
  // equivocada y el select de forma de pago REVERTÍA visualmente (el dato sí
  // se guardaba, pero la tabla quedaba stale y "Pagar" seguía bloqueado).
  const personalHook = window.__hooks.usePersonal(obraId);
  const personal = personalHook.data;
  const { data: subcontratos } = window.__hooks.useSubcontratos ? window.__hooks.useSubcontratos(obraId) : { data: [] };
  const { data: subcontratistas } = window.__hooks.useSubcontratistas ? window.__hooks.useSubcontratistas() : { data: [] };

  const [tab, setTab] = uS('personal');           // personal | subcontratos
  const [pagos, setPagos] = uS([]);
  const [partes, setPartes] = uS([]);
  const [evidencias, setEvidencias] = uS([]);
  const [busy, setBusy] = uS(false);
  const [nuevoPago, setNuevoPago] = uS(null);     // { beneficiario_tipo, personal?, subcontrato? }
  const [detalleId, setDetalleId] = uS(null);     // pago abierto

  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  const filaDelModo = (r) => (esPrueba ? r.demo === true : r.demo !== true);

  // ── Carga de pagos + partes + evidencias del área (reactivo a cambios) ──
  uE(() => {
    if (!obraId) { setPagos([]); setPartes([]); setEvidencias([]); return; }
    let cancel = false;
    const load = async () => {
      try {
        const [pg, pp, evs] = await Promise.all([
          window.__db.pagos.where('obra_id').equals(obraId).filter(p => !p.deleted_at && filaDelModo(p)).toArray(),
          window.__db.pagos_partes.where('obra_id').equals(obraId).filter(p => !p.deleted_at && filaDelModo(p)).toArray(),
          window.__db.evidencias.where('obra_id').equals(obraId)
            .filter(e => !e.deleted_at && ['pagos', 'pagos_partes'].includes(e.modulo_relacionado)).toArray(),
        ]);
        if (cancel) return;
        pg.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        setPagos(pg); setPartes(pp); setEvidencias(evs);
      } catch (e) { console.warn('[pagos]', e?.message); }
    };
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || ['pagos', 'pagos_partes', 'evidencias', 'personal', 'subcontratos'].includes(t)) load(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId, esPrueba]);

  const subNombre = uM(() => new Map((subcontratistas || []).map(s => [s.id, s.razon_social])), [subcontratistas]);
  const partesDe = uM(() => {
    const m = new Map();
    for (const p of partes) { const a = m.get(p.pago_id) || []; a.push(p); m.set(p.pago_id, a); }
    return m;
  }, [partes]);
  const evidenciasDe = uM(() => {
    const m = new Map();   // pagoId → evidencias (del pago y de sus partes)
    const porParte = new Map(partes.map(p => [p.id, p.pago_id]));
    for (const e of evidencias) {
      const pagoId = e.modulo_relacionado === 'pagos' ? e.registro_relacionado_id : porParte.get(e.registro_relacionado_id);
      if (!pagoId) continue;
      const a = m.get(pagoId) || []; a.push(e); m.set(pagoId, a);
    }
    return m;
  }, [evidencias, partes]);

  const pagosDePersona = uM(() => { const m = new Map(); for (const p of pagos) if (p.personal_id) { const a = m.get(p.personal_id) || []; a.push(p); m.set(p.personal_id, a); } return m; }, [pagos]);
  const pagosDeSub = uM(() => { const m = new Map(); for (const p of pagos) if (p.subcontrato_id) { const a = m.get(p.subcontrato_id) || []; a.push(p); m.set(p.subcontrato_id, a); } return m; }, [pagos]);

  // Personal PAGABLE directo (pedido 20-jul): tiene que estar ACTIVO (almacén /
  // ing. de seguridad van inactivando al que cesa) y NO pertenecer a un
  // SUBCONTRATO — a esa gente no se le paga directo: se le paga al subcontrato
  // (pestaña Subcontratos) y él le paga a su propia gente.
  const noActivo = (p) => ['inactivo', 'retirado', 'suspendido'].includes(p.estado);
  const esDeSubcontrato = (p) => categoriaDe(p) === 'subcontratos';
  const personalActivo = uM(() => (personal || []).filter(p => !p.deleted_at && !noActivo(p) && !esDeSubcontrato(p)), [personal]);
  const subsVivos = uM(() => (subcontratos || []).filter(s => !s.deleted_at && s.estado !== 'cancelado'), [subcontratos]);
  // Base de seguimiento: el personal que YA tiene pagos no desaparece de la
  // vista aunque esté inactivo o haya pasado a un subcontrato — su historial
  // de recibos/planillas queda visible (solo consulta, sin botón Pagar).
  const personalHistorial = uM(() => (personal || []).filter(p => !p.deleted_at && (noActivo(p) || esDeSubcontrato(p)) && (pagosDePersona.get(p.id) || []).some(x => x.estado !== 'anulado')), [personal, pagosDePersona]);
  const nSubcontratoOcultos = uM(() => (personal || []).filter(p => !p.deleted_at && !noActivo(p) && esDeSubcontrato(p)).length, [personal]);

  // ── Escrituras (patrón manual Dexie, coherente con el RLS del server) ──
  const cambiarModoPago = async (persona, modo) => {
    if (!canGestionar || busy) return;
    try {
      await personalHook.update(persona.id, { modo_pago: modo || null });
      // Avisar a otras vistas montadas que personal cambió (el hook propio ya
      // se refresca solo con su tick interno).
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'personal' } })); } catch {}
      toast(`${persona.nombres || ''}: pago por ${MODO_PAGO_LABEL[modo] || '—'}`, 'green');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const crearPago = async ({ beneficiario_tipo, personal_id, subcontrato_id, beneficiario_nombre, concepto, modo_pago, monto_acordado, periodo }) => {
    if (busy) return;
    setBusy(true);
    try {
      const { newId, newIdempotencyKey, SYNC_STATUS } = await import('../db/jarvex.db');
      const now = new Date().toISOString();
      const id = newId();
      await window.__db.pagos.add({
        id, obra_id: obraId, beneficiario_tipo,
        personal_id: personal_id || null, subcontrato_id: subcontrato_id || null,
        beneficiario_nombre: beneficiario_nombre || null,
        concepto: concepto || null, modo_pago: modo_pago || null,
        monto_acordado: Number(monto_acordado) || 0, moneda: 'PEN',
        periodo: periodo || null, estado: 'pendiente', notas: null,
        created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1,
        idempotency_key: newIdempotencyKey(userId, 'pagos'),
        ...(esPrueba ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
      });
      try { await window.__logAudit?.({ action: 'create', table: 'pagos', recordId: id, reason: `Pago creado · ${concepto || beneficiario_tipo} · ${fmtS(monto_acordado)}` }); } catch {}
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'pagos' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast('Pago registrado — ahora agregá las partes con su evidencia', 'green');
      setNuevoPago(null);
      setDetalleId(id);
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // Persistir el estado derivado en el pago (para filtros/listas en otras vistas).
  const syncEstadoPago = async (pagoId) => {
    try {
      const { SYNC_STATUS } = await import('../db/jarvex.db');
      const fresh = await window.__db.pagos.get(pagoId);
      if (!fresh || fresh.estado === 'anulado') return;
      const pps = await window.__db.pagos_partes.where('pago_id').equals(pagoId).filter(p => !p.deleted_at && filaDelModo(p)).toArray();
      const { estado } = calcularEstadoPago(fresh.monto_acordado, pps);
      if (estado === fresh.estado) return;
      await window.__db.pagos.update(pagoId, {
        estado, updated_at: new Date().toISOString(), updated_by: userId,
        version: (fresh.version ?? 0) + 1,
        sync_status: (esPrueba || fresh.demo === true) ? SYNC_STATUS.SYNCED
          : (fresh.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
      });
    } catch {}
  };

  const agregarParte = async (pago, { fecha, monto, metodo, referencia, archivo }) => {
    if (busy) return;
    setBusy(true);
    try {
      const partesVivas = (partesDe.get(pago.id) || []);
      const { falta } = calcularEstadoPago(pago.monto_acordado, partesVivas);
      const errs = validarParte({ monto, fecha, metodo }, { faltante: falta });
      const aviso = errs.find(e => e.startsWith('AVISO_EXCESO:'));
      const duros = errs.filter(e => !e.startsWith('AVISO_EXCESO:'));
      if (duros.length) { toast(duros[0], 'red'); return; }
      if (aviso && !window.confirm(`Esta parte EXCEDE lo acordado por S/ ${aviso.split(':')[1]}. ¿Registrar igual?`)) return;

      const { newId, newIdempotencyKey, SYNC_STATUS } = await import('../db/jarvex.db');
      const now = new Date().toISOString();
      const parteId = newId();
      let evidenciaId = null;
      if (archivo) {
        evidenciaId = window.__newId();
        await window.__saveEvidenciaLocal({
          id: evidenciaId, obra_id: obraId, tipo_evidencia: 'pago_evidencia', modulo_relacionado: 'pagos_partes',
          registro_relacionado_id: parteId, nombre_archivo: archivo.name, mime_type: archivo.type || '',
          blob: archivo, fecha, created_by: userId,
          observaciones: `Pago ${pago.concepto || ''} · parte ${fmtS(monto)} (${METODO_PARTE_LABEL[metodo] || metodo})`.trim(),
        });
      }
      await window.__db.pagos_partes.add({
        id: parteId, pago_id: pago.id, accounting_movement_id: null, obra_id: obraId,
        fecha, monto: Number(monto), metodo, referencia: referencia || null,
        evidencia_id: evidenciaId, observaciones: null,
        created_by: userId, updated_by: userId, created_at: now, updated_at: now, version: 1,
        idempotency_key: newIdempotencyKey(userId, 'pagos_partes'),
        ...(esPrueba || pago.demo === true ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
      });
      await syncEstadoPago(pago.id);
      try { await window.__logAudit?.({ action: 'create', table: 'pagos_partes', recordId: parteId, reason: `Parte de pago ${fmtS(monto)} (${metodo}) · ${pago.concepto || pago.id}` }); } catch {}
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'pagos_partes' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast(archivo ? 'Parte registrada con su evidencia' : 'Parte registrada — subí la constancia cuando la tengas', archivo ? 'green' : 'amber');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // Adjunta una evidencia al PAGO (modulo 'pagos', ej. el recibo RxH) o a una
  // PARTE concreta (modulo 'pagos_partes', la constancia de esa transferencia).
  const subirEvidenciaPago = async (target, tipo, archivo, modulo = 'pagos') => {
    if (busy || !archivo) return;
    setBusy(true);
    try {
      await window.__saveEvidenciaLocal({
        id: window.__newId(), obra_id: obraId, tipo_evidencia: tipo, modulo_relacionado: modulo,
        registro_relacionado_id: target.id, nombre_archivo: archivo.name, mime_type: archivo.type || '',
        blob: archivo, fecha: hoyISO(), created_by: userId,
        observaciones: `${tipo === 'recibo_honorarios' ? 'RxH' : 'Evidencia de pago'} · ${target.concepto || target.beneficiario_nombre || ''}`.trim(),
      });
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias' } }));
      toast('Evidencia guardada', 'green');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const anularPago = async (pago) => {
    if (!isAdmin || busy) return;
    if (!window.confirm(`¿Anular el pago "${pago.concepto || fmtS(pago.monto_acordado)}"? Las partes registradas quedan en el historial.`)) return;
    setBusy(true);
    try {
      const { SYNC_STATUS } = await import('../db/jarvex.db');
      const fresh = await window.__db.pagos.get(pago.id);
      await window.__db.pagos.update(pago.id, {
        estado: 'anulado', updated_at: new Date().toISOString(), updated_by: userId,
        version: (fresh?.version ?? 0) + 1,
        sync_status: (esPrueba || fresh?.demo === true) ? SYNC_STATUS.SYNCED
          : (fresh?.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
      });
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'pagos' } }));
      toast('Pago anulado', 'amber');
      setDetalleId(null);
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  const nombrePago = (p) => {
    if (p.beneficiario_tipo === 'subcontrato') {
      const s = subsVivos.find(x => x.id === p.subcontrato_id);
      return s ? (subNombre.get(s.subcontratista_id) || 'Subcontrato') : (p.beneficiario_nombre || 'Subcontrato');
    }
    const per = (personal || []).find(x => x.id === p.personal_id);
    return per ? `${per.nombres || ''} ${per.apellidos || ''}`.trim() : (p.beneficiario_nombre || '—');
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><JxIcon name="dollar" size={32} color="var(--tm)" /><p>Seleccioná una obra activa.</p></div></div>;
  if (!canGestionar && !['gerente', 'tesorero', 'ayudante_contador'].includes(rol)) {
    return <div className="page-wrap"><div className="empty-state"><p>Esta sección es del área contable (contadora jefe y administradores).</p></div></div>;
  }

  const detalle = detalleId ? pagos.find(p => p.id === detalleId) : null;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Pagos</div>
          <div className="pg-sub">Cómo se paga a cada trabajador y los pagos a subcontratos — con evidencia de cada transferencia</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className={`btn btn-sm ${tab === 'personal' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('personal')}>Personal</button>
          <button className={`btn btn-sm ${tab === 'subcontratos' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('subcontratos')}>Subcontratos</button>
        </div>
      </div>

      {tab === 'personal' && (<>
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Trabajador</th>
                <th style={{ width: 190 }}>Forma de pago</th>
                <th>Pagos registrados</th>
                <th style={{ width: 110 }}></th>
              </tr></thead>
              <tbody>
                {personalActivo.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--tm)', padding: 14 }}>Sin personal activo en esta obra.</td></tr>}
                {personalActivo.map(per => {
                  const pgs = (pagosDePersona.get(per.id) || []).filter(p => p.estado !== 'anulado');
                  return (
                    <tr key={per.id}>
                      <td className="col-p" style={{ fontSize: 12.5 }}>{etiquetaPersona(per, subNombre)}</td>
                      <td>
                        <select className="fi" style={{ fontSize: 11, padding: '4px 6px' }} disabled={!canGestionar || busy}
                          title={canGestionar ? 'Cómo se le paga a este trabajador' : 'Solo contadora jefe / admin'}
                          value={per.modo_pago || ''} onChange={e => cambiarModoPago(per, e.target.value)}>
                          <option value="">— Sin definir —</option>
                          {MODOS_PAGO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td style={{ fontSize: 11 }}>
                        {pgs.length === 0 ? <span style={{ color: 'var(--tm)' }}>—</span> : pgs.slice(0, 3).map(p => {
                          const st = calcularEstadoPago(p.monto_acordado, partesDe.get(p.id));
                          const e = ESTADOS_PAGO[st.estado] || ESTADOS_PAGO.pendiente;
                          return (
                            <button key={p.id} className="btn btn-ghost btn-xs" style={{ marginRight: 4, marginBottom: 2 }} onClick={() => setDetalleId(p.id)}>
                              {p.periodo || p.concepto || 'pago'} · {fmtS(st.pagado)}/{fmtS(p.monto_acordado)} <span className={`badge ${e.cls}`} style={{ fontSize: 8.5, marginLeft: 3 }}>{e.lbl}</span>
                            </button>
                          );
                        })}
                        {pgs.length > 3 && <span style={{ color: 'var(--tm)', fontSize: 10 }}>+{pgs.length - 3} más</span>}
                        {pgs.length > 0 && (
                          <div style={{ fontSize: 10, color: 'var(--ts)', fontWeight: 700, marginTop: 2 }}>
                            Σ pagado: {fmtS(pgs.reduce((t, p) => t + calcularEstadoPago(p.monto_acordado, partesDe.get(p.id)).pagado, 0))}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {canGestionar && (
                          <button className="btn btn-amber btn-xs" disabled={busy}
                            title={per.modo_pago ? 'Registrar un pago a este trabajador' : 'Definí primero la forma de pago'}
                            onClick={() => per.modo_pago ? setNuevoPago({ beneficiario_tipo: 'personal', persona: per }) : toast('Definí primero la forma de pago (planilla / RxH / otro)', 'amber')}>
                            💸 Pagar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {nSubcontratoOcultos > 0 && (
            <div style={{ padding: '9px 14px', borderTop: '1px solid var(--border)', fontSize: 11.5, color: 'var(--tm)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span>👷 {nSubcontratoOcultos} trabajador{nSubcontratoOcultos > 1 ? 'es' : ''} de SUBCONTRATOS no {nSubcontratoOcultos > 1 ? 'aparecen' : 'aparece'} acá: a esa gente le paga su subcontratista.</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setTab('subcontratos')}>Pagar al subcontrato →</button>
            </div>
          )}
        </div>
        {/* Base de seguimiento: personal inactivo o pasado a subcontrato que YA
            tiene recibos/planillas registrados — solo consulta, sin "Pagar". */}
        {personalHistorial.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', marginTop: 12 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 700, color: 'var(--tm)', letterSpacing: '.05em', textTransform: 'uppercase' }}>
              Historial · personal inactivo o de subcontrato con pagos registrados
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <tbody>
                  {personalHistorial.map(per => {
                    const pgs = (pagosDePersona.get(per.id) || []).filter(p => p.estado !== 'anulado');
                    const total = pgs.reduce((t, p) => t + calcularEstadoPago(p.monto_acordado, partesDe.get(p.id)).pagado, 0);
                    return (
                      <tr key={per.id}>
                        <td className="col-p" style={{ fontSize: 12.5 }}>
                          {etiquetaPersona(per, subNombre)}
                          <span className={`badge ${esDeSubcontrato(per) ? 'b-purple' : 'b-gray'}`} style={{ marginLeft: 6, fontSize: 9, textTransform: 'capitalize' }}>
                            {esDeSubcontrato(per) ? 'Subcontrato' : (per.estado || 'inactivo')}
                          </span>
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {pgs.map(p => {
                            const st = calcularEstadoPago(p.monto_acordado, partesDe.get(p.id));
                            const e = ESTADOS_PAGO[st.estado] || ESTADOS_PAGO.pendiente;
                            return (
                              <button key={p.id} className="btn btn-ghost btn-xs" style={{ marginRight: 4, marginBottom: 2 }} onClick={() => setDetalleId(p.id)}>
                                {p.periodo || p.concepto || 'pago'} · {fmtS(st.pagado)}/{fmtS(p.monto_acordado)} <span className={`badge ${e.cls}`} style={{ fontSize: 8.5, marginLeft: 3 }}>{e.lbl}</span>
                              </button>
                            );
                          })}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: 'var(--ts)', whiteSpace: 'nowrap' }}>Σ {fmtS(total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </>)}

      {tab === 'subcontratos' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Subcontrato</th>
                <th style={{ textAlign: 'right', width: 130 }}>Monto contrato</th>
                <th>Pagos registrados</th>
                <th style={{ width: 130 }}></th>
              </tr></thead>
              <tbody>
                {subsVivos.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--tm)', padding: 14 }}>Sin subcontratos en esta obra.</td></tr>}
                {subsVivos.map(sc => {
                  const pgs = (pagosDeSub.get(sc.id) || []).filter(p => p.estado !== 'anulado');
                  return (
                    <tr key={sc.id}>
                      <td className="col-p" style={{ fontSize: 12.5 }}>
                        {subNombre.get(sc.subcontratista_id) || '—'}
                        {sc.descripcion && <div style={{ fontSize: 10, color: 'var(--tm)' }}>{String(sc.descripcion).slice(0, 60)}</div>}
                      </td>
                      <td style={{ textAlign: 'right', fontSize: 12, fontWeight: 600 }}>{fmtS(sc.monto_contrato)}</td>
                      <td style={{ fontSize: 11 }}>
                        {pgs.length === 0 ? <span style={{ color: 'var(--tm)' }}>—</span> : pgs.slice(0, 3).map(p => {
                          const st = calcularEstadoPago(p.monto_acordado, partesDe.get(p.id));
                          const e = ESTADOS_PAGO[st.estado] || ESTADOS_PAGO.pendiente;
                          return (
                            <button key={p.id} className="btn btn-ghost btn-xs" style={{ marginRight: 4, marginBottom: 2 }} onClick={() => setDetalleId(p.id)}>
                              {p.concepto || 'pago'} · {fmtS(st.pagado)}/{fmtS(p.monto_acordado)} <span className={`badge ${e.cls}`} style={{ fontSize: 8.5, marginLeft: 3 }}>{e.lbl}</span>
                            </button>
                          );
                        })}
                        {pgs.length > 3 && <span style={{ color: 'var(--tm)', fontSize: 10 }}>+{pgs.length - 3} más</span>}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {canGestionar && (
                          <button className="btn btn-amber btn-xs" disabled={busy} onClick={() => setNuevoPago({ beneficiario_tipo: 'subcontrato', subcontrato: sc })}>
                            💸 Registrar pago
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

      {nuevoPago && (
        <NuevoPagoModal
          ctx={nuevoPago} busy={busy} subNombre={subNombre}
          onConfirm={crearPago} onClose={() => setNuevoPago(null)}
        />
      )}
      {detalle && (
        <PagoDetalleModal
          pago={detalle}
          partes={(partesDe.get(detalle.id) || []).sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')))}
          evidencias={evidenciasDe.get(detalle.id) || []}
          nombre={nombrePago(detalle)}
          canGestionar={canGestionar} isAdmin={isAdmin} busy={busy}
          onAgregarParte={agregarParte} onSubirEvidencia={subirEvidenciaPago}
          onAnular={anularPago}
          onClose={() => setDetalleId(null)}
        />
      )}
    </div>
  );
}

// ─── Modal: crear pago ─────────────────────────────────────────────────────
function NuevoPagoModal({ ctx, busy, subNombre, onConfirm, onClose }) {
  const esSub = ctx.beneficiario_tipo === 'subcontrato';
  const [concepto, setConcepto] = uS(esSub ? '' : `Pago ${MODO_PAGO_LABEL[ctx.persona?.modo_pago] || ''}`.trim());
  const [monto, setMonto] = uS(esSub ? String(ctx.subcontrato?.monto_contrato ?? '') : '');
  const [periodo, setPeriodo] = uS(() => (window.__fecha?.hoyLocal ? window.__fecha.hoyLocal() : new Date().toISOString().slice(0, 10)).slice(0, 7));
  const titulo = esSub
    ? `Pago a subcontrato · ${subNombre.get(ctx.subcontrato?.subcontratista_id) || ''}`
    : `Pago a ${`${ctx.persona?.nombres || ''} ${ctx.persona?.apellidos || ''}`.trim()}`;
  const ok = Number(monto) > 0;
  return (
    <Modal title={titulo} icon="dollar" onClose={() => !busy && onClose()}>
      <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 10 }}>
        {esSub
          ? 'Definí el monto ACORDADO de este pago. Después vas a registrar cada transferencia/depósito parcial con su evidencia hasta completarlo.'
          : `Forma de pago: ${MODO_PAGO_LABEL[ctx.persona?.modo_pago] || '—'}. ${ctx.persona?.modo_pago === 'rxh' ? 'Vas a necesitar el RECIBO emitido por el trabajador además de la constancia del pago.' : 'Vas a necesitar la constancia del depósito/transferencia.'}`}
      </div>
      <div className="g2">
        <div><label className="flabel">Concepto</label>
          <input className="fi" value={concepto} placeholder={esSub ? 'Ej: Valorización 2 / Adelanto' : 'Ej: Sueldo julio / Quincena 1'} onChange={e => setConcepto(e.target.value)} /></div>
        <div><label className="flabel">Período</label>
          <input className="fi" type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} /></div>
        <div><label className="flabel">Monto acordado (S/) *</label>
          <input className="fi" type="number" min="0" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} /></div>
      </div>
      <div className="modal-actions" style={{ marginTop: 14 }}>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className="btn btn-amber" disabled={busy || !ok}
          onClick={() => onConfirm({
            beneficiario_tipo: ctx.beneficiario_tipo,
            personal_id: ctx.persona?.id || null,
            subcontrato_id: ctx.subcontrato?.id || null,
            beneficiario_nombre: esSub ? (subNombre.get(ctx.subcontrato?.subcontratista_id) || null) : `${ctx.persona?.nombres || ''} ${ctx.persona?.apellidos || ''}`.trim(),
            concepto: concepto.trim() || null,
            modo_pago: esSub ? 'subcontrato' : (ctx.persona?.modo_pago || null),
            monto_acordado: monto, periodo,
          })}>
          {busy ? 'Guardando…' : 'Crear pago'}
        </button>
      </div>
    </Modal>
  );
}

// ─── Modal: detalle del pago (partes + evidencias + checklist) ─────────────
function PagoDetalleModal({ pago, partes, evidencias, nombre, canGestionar, isAdmin, busy, onAgregarParte, onSubirEvidencia, onAnular, onClose }) {
  const st = calcularEstadoPago(pago.monto_acordado, partes);
  const check = checklistPago(pago, partes, evidencias);
  const editable = canGestionar && pago.estado !== 'anulado';
  const [fecha, setFecha] = uS(hoyISO());
  const [monto, setMonto] = uS(() => (st.falta > 0 ? String(st.falta) : ''));
  const [metodo, setMetodo] = uS('transferencia');
  const [referencia, setReferencia] = uS('');
  const [archivo, setArchivo] = uS(null);
  const archivoRef = React.useRef(null);   // para limpiar el <input file> tras agregar
  const [verEv, setVerEv] = uS(null);   // evidencia abierta

  const evPorParte = uM(() => {
    const m = new Map();
    for (const e of evidencias) if (e.modulo_relacionado === 'pagos_partes') { const a = m.get(e.registro_relacionado_id) || []; a.push(e); m.set(e.registro_relacionado_id, a); }
    return m;
  }, [evidencias]);
  const evsDelPago = evidencias.filter(e => e.modulo_relacionado === 'pagos');
  const reqs = evidenciasRequeridas(pago.modo_pago);
  const est = ESTADOS_PAGO[pago.estado === 'anulado' ? 'anulado' : st.estado] || ESTADOS_PAGO.pendiente;

  const abrirEvidencia = async (ev) => {
    try {
      const { getEvidenciaSrc } = await import('../lib/evidencias-url.js');
      const r = await getEvidenciaSrc(ev);
      if (r?.url) window.open(r.url, '_blank');
    } catch {}
  };

  return (
    <Modal title={`${nombre} · ${pago.concepto || 'Pago'}`} icon="dollar" onClose={() => !busy && onClose()} size="xl">
      {/* Encabezado: progreso del dinero */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <span className={`badge ${est.cls}`} style={{ fontSize: 11 }}>{est.lbl}</span>
        <div style={{ fontSize: 13 }}>
          Pagado <strong style={{ color: 'var(--green)' }}>{fmtS(st.pagado)}</strong> de <strong>{fmtS(pago.monto_acordado)}</strong>
          {st.falta > 0 && <span style={{ color: 'var(--amber)' }}> · faltan {fmtS(st.falta)}</span>}
          {st.exceso > 0 && <span style={{ color: 'var(--red)' }}> · exceso {fmtS(st.exceso)}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 140, height: 8, background: 'var(--bg2)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ width: `${st.pct}%`, height: '100%', background: st.estado === 'pagado' ? 'var(--green)' : 'var(--amber)', transition: 'width .25s' }} />
        </div>
      </div>

      {/* Checklist de evidencias requeridas */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12, fontSize: 11.5 }}>
        {check.items.map(it => (
          <span key={it.tipo} style={{ color: it.ok ? 'var(--green)' : 'var(--amber)' }}>
            {it.ok ? '✓' : '○'} {it.lbl}
          </span>
        ))}
        {check.partesSinEvidencia > 0 && <span style={{ color: 'var(--red)' }}>⚠ {check.partesSinEvidencia} parte(s) sin comprobante</span>}
        {check.completo && <span className="badge b-green" style={{ fontSize: 10 }}>✓ COMPLETO (dinero + evidencias)</span>}
      </div>

      {/* Recibo por honorarios (a nivel del pago) */}
      {reqs.some(r => r.tipo === 'recibo_honorarios') && editable && (
        <div style={{ marginBottom: 12, padding: '8px 10px', background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 6, fontSize: 11.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong>Recibo por honorarios:</strong>
          {evsDelPago.filter(e => e.tipo_evidencia === 'recibo_honorarios').map(e => (
            <button key={e.id} className="btn btn-ghost btn-xs" onClick={() => abrirEvidencia(e)}>📎 {String(e.nombre_archivo || 'recibo').slice(0, 24)}</button>
          ))}
          <label className="btn btn-ghost btn-xs" style={{ cursor: 'pointer' }}>
            + Subir recibo
            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; if (f) onSubirEvidencia(pago, 'recibo_honorarios', f); e.target.value = ''; }} />
          </label>
        </div>
      )}

      {/* Partes registradas */}
      <div style={{ border: '1px solid var(--bd)', borderRadius: 6, overflow: 'auto', maxHeight: 260, marginBottom: 12 }}>
        <table className="tbl" style={{ fontSize: 12 }}>
          <thead><tr>
            <th style={{ width: 100 }}>Fecha</th>
            <th style={{ textAlign: 'right', width: 110 }}>Monto</th>
            <th style={{ width: 130 }}>Método</th>
            <th>Referencia</th>
            <th style={{ width: 140 }}>Evidencia</th>
          </tr></thead>
          <tbody>
            {partes.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--tm)', padding: 12 }}>Sin partes aún. Registrá abajo cada transferencia/depósito.</td></tr>
            ) : partes.map(p => {
              const evs = evPorParte.get(p.id) || [];
              return (
                <tr key={p.id}>
                  <td style={{ fontSize: 11.5 }}>{p.fecha || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtS(p.monto)}</td>
                  <td style={{ fontSize: 11 }}>{METODO_PARTE_LABEL[p.metodo] || p.metodo || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--tm)' }}>{p.referencia || '—'}</td>
                  <td>
                    {evs.length > 0 ? evs.map(e => (
                      <button key={e.id} className="btn btn-ghost btn-xs" title={e.nombre_archivo} onClick={() => abrirEvidencia(e)}>📎 ver</button>
                    )) : p.metodo === 'efectivo' ? (
                      <span style={{ fontSize: 10, color: 'var(--tm)' }}>efectivo</span>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--red)' }} title="Esta parte no tiene comprobante adjunto">⚠ falta</span>
                    )}
                    {editable && (
                      <label className="btn btn-ghost btn-xs" style={{ cursor: 'pointer' }} title="Adjuntar constancia a esta parte">
                        +
                        <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} disabled={busy}
                          onChange={ev => {
                            const f = ev.target.files?.[0];
                            if (f) onSubirEvidencia({ id: p.id, concepto: pago.concepto }, 'pago_evidencia', f, 'pagos_partes');
                            ev.target.value = '';
                          }} />
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Agregar parte */}
      {editable && (
        <div style={{ padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 6, marginBottom: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 8 }}>Registrar una parte del pago {st.falta > 0 && <span style={{ color: 'var(--tm)', fontWeight: 400 }}>(faltan {fmtS(st.falta)})</span>}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div><label className="flabel">Fecha</label><input className="fi" type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ width: 140 }} /></div>
            <div><label className="flabel">Monto (S/)</label><input className="fi" type="number" min="0" step="0.01" value={monto} onChange={e => setMonto(e.target.value)} style={{ width: 110, textAlign: 'right' }} /></div>
            <div><label className="flabel">Método</label>
              <select className="fi" value={metodo} onChange={e => setMetodo(e.target.value)} style={{ width: 150 }}>
                {METODOS_PARTE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></div>
            <div><label className="flabel">N° operación</label><input className="fi" value={referencia} placeholder="opcional" onChange={e => setReferencia(e.target.value)} style={{ width: 130 }} /></div>
            <div>
              <label className="flabel">Constancia {metodo !== 'efectivo' ? '(recomendada)' : '(opcional)'}</label>
              <input className="fi" type="file" accept="image/*,application/pdf" style={{ fontSize: 10.5, maxWidth: 210 }}
                ref={archivoRef}
                onChange={e => setArchivo(e.target.files?.[0] || null)} />
            </div>
            <button className="btn btn-amber btn-sm" disabled={busy || !(Number(monto) > 0)}
              onClick={async () => {
                await onAgregarParte(pago, { fecha, monto, metodo, referencia, archivo });
                setMonto(''); setReferencia(''); setArchivo(null);
                // Limpiar el value del input: si no, muestra el archivo anterior
                // (que NO se adjuntará) y re-elegir el MISMO archivo no dispara
                // onChange (caso real: un voucher para varias operaciones).
                if (archivoRef.current) archivoRef.current.value = '';
              }}>
              {busy ? 'Guardando…' : '+ Agregar parte'}
            </button>
          </div>
        </div>
      )}

      <div className="modal-actions">
        {isAdmin && pago.estado !== 'anulado' && (
          <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)', marginRight: 'auto' }} disabled={busy} onClick={() => onAnular(pago)}>Anular pago</button>
        )}
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cerrar</button>
      </div>
    </Modal>
  );
}

Object.assign(window, { PagosPage });
export { PagosPage };
