// ═══════════════════════════════════════════════════════════════════
// JARVEX — REGISTRO DE ACTIVOS FIJOS (Formato SUNAT 7.1).
//
// Gabriel, 4-sep-2026: «los activos de la empresa es algo nuevo y necesario,
// las contadoras me pidieron ver si podemos implementar algo que las ayude».
// Y dejó el Excel que llevan hoy: Modelos/6.1.- REGISTRO ACTIVOS_VALIDO.xls.
//
// QUÉ LES DUELE DE LA PLANILLA, y qué hace esta pantalla con cada cosa:
//
//  1. RECALCULAN A MANO. En el Excel, valor histórico, depreciación del
//     ejercicio, acumulada y valor en libros son fórmulas que se copian de
//     fila en fila — y basta una mal arrastrada para que el total no cuadre.
//     Acá NO se guardan: se calculan al leer (src/lib/activos-fijos.js, 43
//     tests, verificados contra las cuatro filas reales de SU Excel).
//
//  2. NADA AVISA. Una tasa por encima del máximo SUNAT es gasto reparable, y
//     un bien ya totalmente depreciado que sigue depreciando da un valor en
//     libros negativo. La planilla no dice ni una cosa ni la otra; la barra
//     de avisos de arriba, sí.
//
//  3. EL CIERRE DE EJERCICIO ES COPIAR-Y-BORRAR. Duplicar la hoja, mover la
//     acumulada a «ejercicio anterior», poner los movimientos en cero. Es el
//     paso donde se arrastran los errores de un año al siguiente. Acá es un
//     botón, y no arrastra lo retirado ni lo vendido.
//
// LO QUE NO HACE, Y HAY QUE DECIRLO: no genera el TXT del PLE 7.1 (código
// 070100). El Excel en el formato oficial sí — que es con lo que trabajan
// hoy. El TXT necesita la especificación de campos vigente de SUNAT: emitir
// un archivo con los campos en otro orden es peor que no emitirlo.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  CUENTAS_ACTIVO_FIJO, METODOS_DEPRECIACION, ESTADOS_ACTIVO, COLUMNAS_FORMATO_71,
  cuentaInfo, tasaSugerida, calcularActivo, mesesDeUsoEnEjercicio,
  totales, porCuenta, validarActivo, activosConProblemas,
  desdeActivoPesado, cuerpoFormato71, cerrarEjercicio,
} from "../lib/activos-fijos.js";
import { filtroInicialEmpresa, setEmpresaActivaId } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";
import { RecomendadorActivosModal } from "./jx-recomendador-activos.jsx";
import { candidatosActivo, claveLinea } from "../lib/recomendador-activos.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return 'S/ ' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return 'S/ ' + (v / 1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};
const ANIO_ACTUAL = new Date().getFullYear();

const FORM_VACIO = (periodo, companyId) => ({
  company_id: companyId || null,
  periodo,
  codigo_relacionado: '',
  cuenta_contable: '333',
  descripcion: '', marca: '', modelo: '', serie_placa: '',
  saldo_inicial: 0, adquisiciones: 0, mejoras: 0, retiros: 0, otros_ajustes: 0,
  ajuste_inflacion: 0,
  fecha_adquisicion: '', fecha_inicio_uso: '',
  metodo_depreciacion: 'linea_recta', doc_autorizacion: '',
  porcentaje_depreciacion: 20, meses_uso: 12,
  deprec_acum_anterior: 0, deprec_retiros: 0, deprec_otros_ajustes: 0, ajuste_inflacion_deprec: 0,
  estado: 'activo', notas: '',
});

function ActivosFijosPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id ?? 'offline';
  const puedeEditar = ['admin', 'gerente', 'contador', 'ayudante_contador', 'tesorero'].includes(rol);

  const { data: companies } = window.__hooks.useCompanies();
  const { data: activosPesados } = window.__hooks.useActivosPesados();
  // ── RECOMENDADOR (tanda 7): qué de lo comprado parece activo ──────
  const { data: movsCompra } = window.__hooks.useAccountingMovements?.() || { data: [] };
  const [showReco, setShowReco] = uS(false);

  const empresaFija = useEmpresaBloqueada();
  const [filtroEmpresaRaw, setFiltroEmpresa] = uS(() => filtroInicialEmpresa(''));
  const filtroEmpresa = empresaFija || filtroEmpresaRaw;
  const [periodo, setPeriodo] = uS(ANIO_ACTUAL);
  const [activos, setActivos] = uS([]);
  // ⚠ Estos dos memos van DESPUÉS de `activos`: leerlo antes es un TDZ, y el
  // array de deps se evalúa en cada render. Es el mismo error que dejó
  // Movimientos Contables muerto el 3-sep con el green gate en verde; acá lo
  // cazó pantallas-montan.test.jsx antes de salir.
  const yaCargadosLinea = uM(() => {
    const set = new Set();
    for (const a of activos || []) {
      if (a.deleted_at || !a.accounting_movement_id || a.accounting_item_idx == null) continue;
      set.add(claveLinea(a.accounting_movement_id, a.accounting_item_idx));
    }
    return set;
  }, [activos]);
  const nCandidatos = uM(() => filtroEmpresa
    ? candidatosActivo(movsCompra || [], { companyId: filtroEmpresa, yaCargados: yaCargadosLinea }).length
    : 0, [movsCompra, filtroEmpresa, yaCargadosLinea]);
  const [modal, setModal] = uS(null);      // 'alta' | 'importar' | 'cierre'
  const [form, setForm] = uS(() => FORM_VACIO(ANIO_ACTUAL, null));
  const [editando, setEditando] = uS(null);
  const [busqueda, setBusqueda] = uS('');
  const [seleccionPesados, setSeleccionPesados] = uS({});
  const guardandoRef = uR(false);
  const [guardando, setGuardando] = uS(false);

  const recargar = React.useCallback(async () => {
    try {
      const all = await window.__db.activos_fijos.toArray();
      setActivos(all.filter(a => !a.deleted_at));
    } catch { setActivos([]); }
  }, []);

  uE(() => {
    recargar();
    const on = (e) => { if (!e?.detail?.tabla || e.detail.tabla === 'activos_fijos') recargar(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', recargar);
    return () => {
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', recargar);
    };
  }, [recargar]);

  const empresasPropias = uM(
    () => (companies || []).filter(c => !c.deleted_at && c.tipo_entidad !== 'tercero').sort((a, b) => a.name.localeCompare(b.name)),
    [companies]
  );

  // Una empresa siempre elegida: el formato 7.1 es POR empresa, un registro
  // "de todas" no significa nada contablemente.
  uE(() => {
    if (!filtroEmpresa && empresasPropias.length && !empresaFija) {
      setFiltroEmpresa(empresasPropias[0].id);
    }
  }, [filtroEmpresa, empresasPropias, empresaFija]);

  const company = uM(() => empresasPropias.find(c => c.id === filtroEmpresa) || null, [empresasPropias, filtroEmpresa]);

  const periodosCargados = uM(() => {
    const set = new Set(activos.filter(a => a.company_id === filtroEmpresa).map(a => Number(a.periodo)));
    set.add(ANIO_ACTUAL);
    return [...set].filter(Number.isFinite).sort((a, b) => b - a);
  }, [activos, filtroEmpresa]);

  const delEjercicio = uM(() => {
    let f = activos.filter(a => a.company_id === filtroEmpresa && Number(a.periodo) === Number(periodo));
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(a =>
        (a.descripcion || '').toLowerCase().includes(q) ||
        (a.marca || '').toLowerCase().includes(q) ||
        (a.serie_placa || '').toLowerCase().includes(q) ||
        (a.cuenta_contable || '').includes(q));
    }
    return f;
  }, [activos, filtroEmpresa, periodo, busqueda]);

  const grupos = uM(() => porCuenta(delEjercicio), [delEjercicio]);
  const tot = uM(() => totales(delEjercicio), [delEjercicio]);
  const problemas = uM(() => activosConProblemas(delEjercicio), [delEjercicio]);

  // Los activos pesados de esta empresa que todavía no están en el registro
  // contable — el puente para no tipear la misma máquina dos veces.
  const pesadosSinRegistrar = uM(() => {
    const yaEstan = new Set(activos.filter(a => a.activo_pesado_id).map(a => a.activo_pesado_id));
    return (activosPesados || []).filter(ap => !ap.deleted_at && !yaEstan.has(ap.id)
      && (!ap.company_id || ap.company_id === filtroEmpresa));
  }, [activosPesados, activos, filtroEmpresa]);

  // ── Alta / edición ──────────────────────────────────────────────
  const abrirAlta = () => {
    setForm(FORM_VACIO(periodo, filtroEmpresa));
    setEditando(null);
    setModal('alta');
  };
  const abrirEdicion = (a) => {
    setForm({ ...a, fecha_adquisicion: a.fecha_adquisicion || '', fecha_inicio_uso: a.fecha_inicio_uso || '' });
    setEditando(a);
    setModal('alta');
  };

  const setCampo = (patch) => setForm(f => {
    const next = { ...f, ...patch };
    // Cambiar de cuenta reajusta la tasa a la que le corresponde — es lo que
    // la contadora haría a mano, y evita dejar el 20% de un camión en una
    // laptop que va al 25%.
    if ('cuenta_contable' in patch) next.porcentaje_depreciacion = tasaSugerida(patch.cuenta_contable);
    // Cambiar la fecha de inicio de uso recalcula los meses del ejercicio.
    if ('fecha_inicio_uso' in patch && patch.fecha_inicio_uso) {
      next.meses_uso = mesesDeUsoEnEjercicio(patch.fecha_inicio_uso, next.periodo);
    }
    return next;
  });

  const guardar = async () => {
    if (guardandoRef.current) return;
    const errores = validarActivo(form);
    if (errores.length) { toast(errores[0], 'red'); return; }
    guardandoRef.current = true; setGuardando(true);
    try {
      const now = new Date().toISOString();
      const limpio = {
        ...form,
        periodo: Number(form.periodo),
        porcentaje_depreciacion: Number(form.porcentaje_depreciacion) || 0,
        meses_uso: Math.max(0, Math.min(12, Math.round(Number(form.meses_uso) || 0))),
        fecha_adquisicion: form.fecha_adquisicion || null,
        fecha_inicio_uso: form.fecha_inicio_uso || null,
      };
      for (const k of ['saldo_inicial', 'adquisiciones', 'mejoras', 'retiros', 'otros_ajustes',
        'ajuste_inflacion', 'deprec_acum_anterior', 'deprec_retiros', 'deprec_otros_ajustes', 'ajuste_inflacion_deprec']) {
        limpio[k] = Number(limpio[k]) || 0;
      }
      if (editando) {
        await window.__db.activos_fijos.update(editando.id, {
          ...limpio, id: editando.id,
          updated_at: now, updated_by: userId,
          version: (editando.version ?? 0) + 1,
          sync_status: editando.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        toast('Activo actualizado', 'green');
      } else {
        const id = window.__newId();
        await window.__db.activos_fijos.add({
          ...limpio, id,
          created_by: userId, updated_by: userId, created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_af_${id}`,
        });
        toast('Activo registrado', 'green');
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'activos_fijos' } })); } catch {}
      await recargar();
      setModal(null); setEditando(null);
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { guardandoRef.current = false; setGuardando(false); }
  };

  const borrar = async (a) => {
    if (!window.confirm(`Dar de baja del registro «${a.descripcion}»?\n\nSe puede recuperar desde Auditoría.`)) return;
    try {
      const now = new Date().toISOString();
      await window.__db.activos_fijos.update(a.id, {
        deleted_at: now, updated_at: now, updated_by: userId,
        version: (a.version ?? 0) + 1, sync_status: 'pending_delete',
      });
      try { await window.__logAudit?.({ action: 'delete', table: 'activos_fijos', recordId: a.id, oldData: a, reason: `Baja del registro de activos fijos: ${a.descripcion}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'activos_fijos' } })); } catch {}
      await recargar();
      toast('Activo dado de baja', 'amber');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  // ── Aceptar un candidato del recomendador (tanda 7) ──────────────
  // Crea la fila del 7.1 con lo que la factura ya sabe: descripción, costo
  // unitario × cantidad, fecha, y la cuenta + tasa que propone la lib. Guarda
  // de qué LÍNEA salió (mig 182) para no volver a proponerla, y enlaza con
  // Equipos Pesados si el nombre coincide — si no, el botón «Traer de Equipos
  // Pesados» lo ofrecería otra vez y quedaría registrado dos veces.
  const aceptarCandidato = async (c) => {
    const now = new Date().toISOString();
    const id = window.__newId();
    const costo = Number(c.precio_unitario || 0) * Number(c.cantidad || 1);
    const normalizar = (t) => String(t || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/).filter(w => w.length > 3);
    const tokens = new Set(normalizar(c.descripcion));
    const pesado = (activosPesados || []).find(ap => {
      if (ap.deleted_at) return false;
      const t = normalizar(ap.nombre);
      if (!t.length) return false;
      const comunes = t.filter(w => tokens.has(w)).length;
      return comunes >= Math.min(2, t.length);
    }) || null;

    await window.__db.activos_fijos.add({
      id,
      company_id: c.company_id || filtroEmpresa,
      periodo: Number(periodo),
      codigo_relacionado: c.documento || '',
      cuenta_contable: c.cuenta,
      descripcion: c.descripcion,
      marca: '', modelo: '', serie_placa: '',
      saldo_inicial: 0,
      adquisiciones: costo,
      mejoras: 0, retiros: 0, otros_ajustes: 0, ajuste_inflacion: 0,
      fecha_adquisicion: c.fecha || '',
      fecha_inicio_uso: c.fecha || '',
      metodo_depreciacion: 'linea_recta',
      doc_autorizacion: '',
      porcentaje_depreciacion: c.tasa,
      meses_uso: 12,
      deprec_acum_anterior: 0, deprec_retiros: 0, deprec_otros_ajustes: 0, ajuste_inflacion_deprec: 0,
      estado: 'activo',
      activo_pesado_id: pesado ? pesado.id : null,
      accounting_movement_id: c.movimiento_id,
      accounting_item_idx: c.item_idx,
      obra_id: c.obra_id || null,
      notas: pesado ? `Enlazado con el equipo «${pesado.nombre}» del registro operativo.` : '',
      created_by: userId, updated_by: userId, created_at: now, updated_at: now,
      deleted_at: null,
      version: 1, sync_status: 'pending_create', last_synced_at: null,
      idempotency_key: `${userId}_af_${id}`,
    });
    // Si el equipo operativo no tenía costo ni fecha, se los completa: era una
    // de las razones por las que el 7.1 estaba vacío.
    if (pesado && pesado.costo_adquisicion == null) {
      try {
        await window.__db.activos_pesados.update(pesado.id, {
          costo_adquisicion: Number(c.precio_unitario) || null,
          fecha_adquisicion: c.fecha || null,
          company_id: pesado.company_id || c.company_id || null,
          updated_at: now, updated_by: userId,
          version: (pesado.version ?? 0) + 1,
          sync_status: pesado.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      } catch (e) { console.warn('[recomendador] no se pudo completar el equipo pesado:', e); }
    }
    try { await window.__logAudit?.({ action: 'create', table: 'activos_fijos', recordId: id,
      newData: { descripcion: c.descripcion, adquisiciones: costo, cuenta_contable: c.cuenta },
      reason: `Aceptado desde el recomendador (${c.documento || 's/doc'})` }); } catch {}
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'activos_fijos' } })); } catch {}
    await recargar();
  };

  // ── Importar desde el registro operativo ────────────────────────
  const importarPesados = async () => {
    if (guardandoRef.current) return;
    const elegidos = pesadosSinRegistrar.filter(ap => seleccionPesados[ap.id]);
    if (!elegidos.length) { toast('Elegí al menos un equipo', 'amber'); return; }
    guardandoRef.current = true; setGuardando(true);
    try {
      const now = new Date().toISOString();
      for (const ap of elegidos) {
        const b = desdeActivoPesado(ap, { periodo, companyId: filtroEmpresa });
        const id = window.__newId();
        await window.__db.activos_fijos.add({
          ...b, id, company_id: b.company_id || filtroEmpresa,
          created_by: userId, updated_by: userId, created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_af_${id}`,
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'activos_fijos' } })); } catch {}
      await recargar();
      setSeleccionPesados({});
      setModal(null);
      toast(`✓ ${elegidos.length} equipo(s) traídos — completá cuenta contable y valores`, 'green');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { guardandoRef.current = false; setGuardando(false); }
  };

  // ── Cierre de ejercicio ─────────────────────────────────────────
  const cerrar = async () => {
    if (guardandoRef.current) return;
    const destino = Number(periodo) + 1;
    const yaHay = activos.filter(a => a.company_id === filtroEmpresa && Number(a.periodo) === destino);
    if (yaHay.length) { toast(`El ejercicio ${destino} ya tiene ${yaHay.length} activos cargados`, 'red'); return; }
    const nuevos = cerrarEjercicio(delEjercicio, { periodoNuevo: destino });
    if (!nuevos.length) { toast('No hay activos vivos para arrastrar', 'amber'); return; }
    if (!window.confirm(`Abrir el ejercicio ${destino} con ${nuevos.length} activos?\n\nCada uno arranca con el valor histórico y la depreciación acumulada de ${periodo}. Lo retirado y lo vendido NO se arrastra.`)) return;
    guardandoRef.current = true; setGuardando(true);
    try {
      const now = new Date().toISOString();
      for (const n of nuevos) {
        const id = window.__newId();
        await window.__db.activos_fijos.add({
          ...n, id,
          created_by: userId, updated_by: userId, created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_af_${id}`,
        });
      }
      try { await window.__logAudit?.({ action: 'create', table: 'activos_fijos', recordId: null, newData: { periodo: destino, filas: nuevos.length }, reason: `Cierre de ejercicio ${periodo} → ${destino} (${company?.name || ''})` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'activos_fijos' } })); } catch {}
      await recargar();
      setPeriodo(destino);
      toast(`✓ Ejercicio ${destino} abierto con ${nuevos.length} activos`, 'green');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { guardandoRef.current = false; setGuardando(false); }
  };

  // ── Exportar al formato 7.1 ─────────────────────────────────────
  const exportar = async () => {
    if (!delEjercicio.length) { toast('No hay activos en este ejercicio', 'amber'); return; }
    try {
      await window.__reports?.generateExcel?.({
        sheetName: `ACTIVOS ${periodo}`,
        columnas: COLUMNAS_FORMATO_71,
        filas: cuerpoFormato71(delEjercicio),
        filename: `Formato_7.1_Activos_Fijos_${(company?.nombre_corto || company?.name || 'empresa').replace(/[^\w]+/g, '_')}_${periodo}.xlsx`,
      });
      toast('✓ Formato 7.1 exportado', 'green');
    } catch (e) { toast('Error exportando: ' + (e.message || e), 'red'); }
  };

  const Banner = window.EmpresaActivaBanner;
  const avisoTasa = alertaDeForm(form);

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div>
          <div className="pg-title">Activos Fijos de la empresa</div>
          <div className="pg-sub">
            Formato SUNAT 7.1 · {delEjercicio.length} bienes en {periodo}
            {company ? ` · ${company.name}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportar}><JxIcon name="download" size={13} />Exportar formato 7.1</button>
          {/* Recomendador (tanda 7): lee lo que compró la empresa y propone qué
              parece un bien que dura. NADA entra solo — cada fila la acepta una
              persona, que fue la condición de Gabriel. */}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowReco(true)}
            title="Revisar las compras de esta empresa y ver qué parece activo fijo">
            <JxIcon name="search" size={13} />Revisar compras
            {nCandidatos ? <span className="badge b-amber" style={{ marginLeft: 4 }}>{nCandidatos}</span> : ''}
          </button>
          {puedeEditar && <button className="btn btn-amber btn-sm" onClick={abrirAlta}><JxIcon name="plus" size={13} />Nuevo activo</button>}
        </div>
      </div>

      {Banner && <Banner onSalir={() => setFiltroEmpresa('')} />}

      {/* ── Los cuatro números que la contadora mira primero ──────── */}
      <div className="g4" style={{ marginBottom: 12 }}>
        <div className="card card-p">
          <div style={{ fontSize: 10.5, color: 'var(--tm)', textTransform: 'uppercase' }}>Valor histórico</div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{fmtSk(tot.valorHistorico)}</div>
        </div>
        <div className="card card-p">
          <div style={{ fontSize: 10.5, color: 'var(--tm)', textTransform: 'uppercase' }}>Deprec. del ejercicio</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--amber)' }}>{fmtSk(tot.deprecEjercicio)}</div>
        </div>
        <div className="card card-p">
          <div style={{ fontSize: 10.5, color: 'var(--tm)', textTransform: 'uppercase' }}>Deprec. acumulada</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tm)' }}>{fmtSk(tot.deprecAcumHistorica)}</div>
        </div>
        <div className="card card-p">
          <div style={{ fontSize: 10.5, color: 'var(--tm)', textTransform: 'uppercase' }}>Valor en libros</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)' }}>{fmtSk(tot.valorLibros)}</div>
        </div>
      </div>

      {problemas.length > 0 && (
        <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>
            <JxIcon name="alert" size={13} color="var(--amber)" /> {problemas.length} activo(s) para revisar
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: 'var(--ts)' }}>
            {problemas.slice(0, 6).map(({ activo, errores, aviso }) => (
              <li key={activo.id} style={{ marginBottom: 3 }}>
                <strong>{activo.descripcion}</strong> — {[...errores, aviso].filter(Boolean).join(' · ')}
              </li>
            ))}
          </ul>
          {problemas.length > 6 && <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>…y {problemas.length - 6} más.</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select className="fi" value={filtroEmpresa} disabled={!!empresaFija}
          title={empresaFija ? 'Estás dentro de esta empresa: son SUS activos.' : undefined}
          onChange={e => { setFiltroEmpresa(e.target.value); setEmpresaActivaId(e.target.value || null); }}
          style={{ minWidth: 220 }}>
          {empresasPropias.filter(c => !empresaFija || c.id === empresaFija)
            .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="fi" value={periodo} onChange={e => setPeriodo(Number(e.target.value))} style={{ minWidth: 110 }}>
          {periodosCargados.map(p => <option key={p} value={p}>Ejercicio {p}</option>)}
        </select>
        <div className="search-bar" style={{ flex: '1 1 180px' }}>
          <JxIcon name="search" size={14} color="var(--tm)" />
          <input placeholder="Buscar bien, marca, serie o cuenta…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        {puedeEditar && pesadosSinRegistrar.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setModal('importar')}>
            <JxIcon name="tool" size={12} />Traer {pesadosSinRegistrar.length} de Equipos Pesados
          </button>
        )}
        {puedeEditar && delEjercicio.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={cerrar} disabled={guardando}>
            <JxIcon name="calendar" size={12} />Cerrar {periodo} → abrir {Number(periodo) + 1}
          </button>
        )}
      </div>

      {delEjercicio.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="tool" size={40} color="var(--tm)" />
          <p>
            {company ? `${company.name} no tiene activos fijos cargados en ${periodo}.` : 'Elegí una empresa.'}
          </p>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', maxWidth: 460, margin: '0 auto' }}>
            Este es el registro CONTABLE (cuenta del PCGE, depreciación, valor en libros), distinto
            de «Equipos Pesados», que es el operativo (horómetro, combustible, en qué obra está).
          </div>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ fontSize: 11.5 }}>
              <thead><tr>
                <th>Cuenta / Bien</th>
                <th>Marca · Modelo · Serie</th>
                <th style={{ textAlign: 'right' }}>Valor histórico</th>
                <th style={{ textAlign: 'center' }}>Tasa</th>
                <th style={{ textAlign: 'center' }}>Meses</th>
                <th style={{ textAlign: 'right' }}>Deprec. ejercicio</th>
                <th style={{ textAlign: 'right' }}>Deprec. acumulada</th>
                <th style={{ textAlign: 'right' }}>Valor en libros</th>
                {puedeEditar && <th style={{ textAlign: 'center' }}></th>}
              </tr></thead>
              <tbody>
                {grupos.map(g => (
                  <React.Fragment key={g.cuenta}>
                    <tr style={{ background: 'var(--bg-c2)' }}>
                      <td colSpan={puedeEditar ? 9 : 8} style={{ fontWeight: 700, fontSize: 11.5 }}>
                        <span style={{ fontFamily: 'monospace' }}>{g.cuenta}</span> — {g.label}
                        <span style={{ color: 'var(--tm)', fontWeight: 400 }}> · {g.items.length} bien(es)</span>
                      </td>
                    </tr>
                    {g.items.map(a => {
                      const c = calcularActivo(a);
                      return (
                        <tr key={a.id}>
                          <td style={{ maxWidth: 260 }}>
                            <div style={{ fontWeight: 600 }}>{a.descripcion}</div>
                            <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                              {a.codigo_relacionado ? `cód. ${a.codigo_relacionado} · ` : ''}
                              {a.fecha_adquisicion || 'sin fecha'}
                              {a.estado !== 'activo' ? ` · ${ESTADOS_ACTIVO[a.estado] || a.estado}` : ''}
                            </div>
                          </td>
                          <td style={{ fontSize: 10.5, color: 'var(--ts)', maxWidth: 180 }}>
                            {[a.marca, a.modelo, a.serie_placa].filter(Boolean).join(' · ') || '—'}
                          </td>
                          <td style={{ textAlign: 'right' }}>{fmtS(c.valorHistorico)}</td>
                          <td style={{ textAlign: 'center' }}>{Number(a.porcentaje_depreciacion)}%</td>
                          <td style={{ textAlign: 'center' }}>{a.meses_uso}</td>
                          <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmtS(c.deprecEjercicio)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--tm)' }}>
                            {fmtS(c.deprecAcumHistorica)}
                            <div style={{ fontSize: 9.5 }}>{c.pctDepreciado.toFixed(0)}%</div>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: c.agotado ? 'var(--tm)' : 'var(--green)' }}>
                            {fmtS(c.valorLibros)}
                          </td>
                          {puedeEditar && (
                            <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                              <button className="btn btn-ghost btn-xs" title="Editar" onClick={() => abrirEdicion(a)}><JxIcon name="edit" size={11} /></button>
                              <button className="btn btn-ghost btn-xs" title="Dar de baja" onClick={() => borrar(a)} style={{ marginLeft: 4 }}><JxIcon name="trash" size={11} /></button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    <tr style={{ fontSize: 11, fontStyle: 'italic', color: 'var(--tm)' }}>
                      <td colSpan={2} style={{ textAlign: 'right' }}>Subtotal {g.cuenta}:</td>
                      <td style={{ textAlign: 'right' }}>{fmtS(g.totales.valorHistorico)}</td>
                      <td colSpan={2}></td>
                      <td style={{ textAlign: 'right' }}>{fmtS(g.totales.deprecEjercicio)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtS(g.totales.deprecAcumHistorica)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtS(g.totales.valorLibros)}</td>
                      {puedeEditar && <td></td>}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'rgba(242,183,5,0.15)', fontWeight: 700 }}>
                  <td colSpan={2} style={{ padding: '8px 12px', textAlign: 'right' }}>TOTALES</td>
                  <td style={{ textAlign: 'right' }}>{fmtS(tot.valorHistorico)}</td>
                  <td colSpan={2}></td>
                  <td style={{ textAlign: 'right' }}>{fmtS(tot.deprecEjercicio)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtS(tot.deprecAcumHistorica)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmtS(tot.valorLibros)}</td>
                  {puedeEditar && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Alta / edición ──────────────────────────────────────── */}
      {modal === 'alta' && (
        <Modal title={editando ? 'Editar activo fijo' : 'Nuevo activo fijo'} icon="tool" onClose={() => { setModal(null); setEditando(null); }} wide>
          <div className="g2">
            <div>
              <label className="flabel">Cuenta contable (PCGE) *</label>
              <select className="fi" value={form.cuenta_contable} onChange={e => setCampo({ cuenta_contable: e.target.value })}>
                {CUENTAS_ACTIVO_FIJO.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} — {c.label}</option>)}
              </select>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
                Tasa máxima SUNAT para esta cuenta: {cuentaInfo(form.cuenta_contable)?.tasaMax ?? 10}%
              </div>
            </div>
            <div><label className="flabel">Código relacionado</label><input className="fi" value={form.codigo_relacionado || ''} onChange={e => setCampo({ codigo_relacionado: e.target.value })} placeholder="1, 2, 3…" /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">Descripción del bien *</label><input className="fi" value={form.descripcion || ''} onChange={e => setCampo({ descripcion: e.target.value })} /></div>
            <div><label className="flabel">Marca</label><input className="fi" value={form.marca || ''} onChange={e => setCampo({ marca: e.target.value })} /></div>
            <div><label className="flabel">Modelo</label><input className="fi" value={form.modelo || ''} onChange={e => setCampo({ modelo: e.target.value })} /></div>
            <div style={{ gridColumn: '1/-1' }}><label className="flabel">N° de serie y/o placa</label><input className="fi" value={form.serie_placa || ''} onChange={e => setCampo({ serie_placa: e.target.value })} /></div>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: 'var(--ts)' }}>Valor del bien</div>
          <div className="g4" style={{ marginTop: 6 }}>
            <div><label className="flabel">Saldo inicial</label><input className="fi" type="number" step="0.01" value={form.saldo_inicial} onChange={e => setCampo({ saldo_inicial: e.target.value })} /></div>
            <div><label className="flabel">Adquisiciones</label><input className="fi" type="number" step="0.01" value={form.adquisiciones} onChange={e => setCampo({ adquisiciones: e.target.value })} /></div>
            <div><label className="flabel">Mejoras</label><input className="fi" type="number" step="0.01" value={form.mejoras} onChange={e => setCampo({ mejoras: e.target.value })} /></div>
            <div><label className="flabel">Retiros / bajas</label><input className="fi" type="number" step="0.01" value={form.retiros} onChange={e => setCampo({ retiros: e.target.value })} /></div>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: 'var(--ts)' }}>Depreciación</div>
          <div className="g4" style={{ marginTop: 6 }}>
            <div><label className="flabel">Fecha de adquisición</label><input className="fi" type="date" value={form.fecha_adquisicion || ''} onChange={e => setCampo({ fecha_adquisicion: e.target.value })} /></div>
            <div><label className="flabel">Inicio de uso</label><input className="fi" type="date" value={form.fecha_inicio_uso || ''} onChange={e => setCampo({ fecha_inicio_uso: e.target.value })} /></div>
            <div>
              <label className="flabel">% depreciación</label>
              <input className="fi" type="number" step="0.01" min="0" max="100" value={form.porcentaje_depreciacion} onChange={e => setCampo({ porcentaje_depreciacion: e.target.value })} />
            </div>
            <div><label className="flabel">Meses de uso (0-12)</label><input className="fi" type="number" min="0" max="12" value={form.meses_uso} onChange={e => setCampo({ meses_uso: e.target.value })} /></div>
            <div><label className="flabel">Método</label>
              <select className="fi" value={form.metodo_depreciacion} onChange={e => setCampo({ metodo_depreciacion: e.target.value })}>
                {Object.entries(METODOS_DEPRECIACION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label className="flabel">Deprec. acum. anterior</label><input className="fi" type="number" step="0.01" value={form.deprec_acum_anterior} onChange={e => setCampo({ deprec_acum_anterior: e.target.value })} /></div>
            <div><label className="flabel">Estado</label>
              <select className="fi" value={form.estado} onChange={e => setCampo({ estado: e.target.value })}>
                {Object.entries(ESTADOS_ACTIVO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label className="flabel">Ejercicio</label><input className="fi" type="number" value={form.periodo} onChange={e => setCampo({ periodo: Number(e.target.value) })} /></div>
          </div>

          {avisoTasa && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(245,158,11,0.12)', fontSize: 11.5, color: 'var(--amber)' }}>
              ⚠ {avisoTasa}
            </div>
          )}

          {/* Lo que va a quedar registrado, calculado en vivo: la contadora ve
              el resultado ANTES de guardar, que es lo que en el Excel solo
              aparece cuando la fórmula ya se arrastró. */}
          <div className="card card-p" style={{ marginTop: 12, background: 'var(--bg-c2)' }}>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12 }}>
              <span>Valor histórico: <strong>{fmtS(calcularActivo(form).valorHistorico)}</strong></span>
              <span>Deprec. del ejercicio: <strong style={{ color: 'var(--amber)' }}>{fmtS(calcularActivo(form).deprecEjercicio)}</strong></span>
              <span>Acumulada: <strong>{fmtS(calcularActivo(form).deprecAcumHistorica)}</strong></span>
              <span>Valor en libros: <strong style={{ color: 'var(--green)' }}>{fmtS(calcularActivo(form).valorLibros)}</strong></span>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setModal(null); setEditando(null); }}>Cancelar</button>
            <button className="btn btn-amber" disabled={guardando} onClick={guardar}>
              <JxIcon name="check" size={13} />{guardando ? 'Guardando…' : (editando ? 'Guardar' : 'Registrar')}
            </button>
          </div>
        </Modal>
      )}

      {showReco && (
        <RecomendadorActivosModal
          movs={movsCompra || []} activos={activos || []} companies={companies || []}
          activosPesados={activosPesados || []}
          companyId={filtroEmpresa} periodo={periodo}
          puedeEditar={puedeEditar} showToast={toast}
          onAceptar={aceptarCandidato}
          onClose={() => setShowReco(false)}/>
      )}

      {/* ── Traer desde Equipos Pesados ─────────────────────────── */}
      {modal === 'importar' && (
        <Modal title="Traer equipos del registro operativo" icon="tool" onClose={() => setModal(null)}>
          <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 10, lineHeight: 1.55 }}>
            Estos equipos están en «Equipos Pesados» (el registro operativo) y todavía no en el
            contable. Al traerlos se copia lo que ese registro sabe; <strong>la cuenta contable y
            los valores hay que completarlos</strong> — el registro operativo no los tiene.
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="tbl" style={{ fontSize: 11.5 }}>
              <tbody>
                {pesadosSinRegistrar.map(ap => (
                  <tr key={ap.id}>
                    <td style={{ width: 32, textAlign: 'center' }}>
                      <input type="checkbox" checked={!!seleccionPesados[ap.id]}
                        onChange={e => setSeleccionPesados(s => ({ ...s, [ap.id]: e.target.checked }))} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{ap.nombre}</div>
                      <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                        {[ap.marca, ap.modelo, ap.placa].filter(Boolean).join(' · ') || 'sin marca ni placa'}
                        {ap.costo_adquisicion ? ` · ${fmtS(ap.costo_adquisicion)}` : ' · sin costo cargado'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => setModal(null)}>Cancelar</button>
            <button className="btn btn-amber" disabled={guardando} onClick={importarPesados}>
              <JxIcon name="check" size={13} />Traer seleccionados
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Fuera del componente para no recrearla en cada render — y para que la regla
// de hooks no tenga que mirarla.
function alertaDeForm(form) {
  const info = cuentaInfo(form?.cuenta_contable);
  const pct = Number(form?.porcentaje_depreciacion) || 0;
  if (info && pct > info.tasaMax) {
    return `${pct}% supera el máximo de ${info.tasaMax}% para ${info.label} — el exceso no es deducible`;
  }
  return null;
}

Object.assign(window, { ActivosFijosPage });
export { ActivosFijosPage };
