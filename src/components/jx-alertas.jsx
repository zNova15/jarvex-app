import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE, useCallback: uC } = React;

// ─── Helpers ─────────────────────────────────────────────────
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return iso; }
};
const daysBetween = (isoA, isoB) => {
  if (!isoA || !isoB) return null;
  const a = new Date(isoA + 'T00:00:00');
  const b = new Date(isoB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
};
const fmtCur = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Plan default mantenimiento (clon de jx-mantenimiento.jsx)
const PLAN_DEFAULT_MANT = [
  { tipo: 'cambio_aceite', label: 'Cambio aceite motor', cada_hm: 250 },
  { tipo: 'filtros', label: 'Cambio filtros (aire/aceite/comb.)', cada_hm: 500 },
  { tipo: 'hidraulico', label: 'Revisión sistema hidráulico', cada_hm: 1000 },
  { tipo: 'transmision', label: 'Cambio aceite transmisión', cada_hm: 2000 },
  { tipo: 'overhaul', label: 'Overhaul mayor', cada_hm: 5000 },
];

// Severidad: 'critica' | 'alta' | 'media'
const SEV_META = {
  critica: { label: 'Crítica', color: '#E74C3C', badge: 'b-red', order: 0 },
  alta:    { label: 'Alta',    color: '#F28C28', badge: 'b-amber', order: 1 },
  media:   { label: 'Media',   color: '#3498DB', badge: 'b-blue', order: 2 },
};

// Mapa tipo → icono / página de destino
const TIPO_META = {
  stock_bajo:        { icon: 'package',     pagina: 'materiales',               label: 'Stock bajo' },
  mantto_vencido:    { icon: 'tool',        pagina: 'mantenimiento-programado', label: 'Mantenimiento' },
  mantto_proximo:    { icon: 'tool',        pagina: 'mantenimiento-programado', label: 'Mantenimiento' },
  pago_vencido:      { icon: 'dollar',      pagina: 'flujo-caja',               label: 'Pago vencido' },
  pago_proximo:      { icon: 'calendar',    pagina: 'flujo-caja',               label: 'Pago próximo' },
  contrato_vence:    { icon: 'users',       pagina: 'personal-contratos',       label: 'Contrato laboral' },
  iperc_critico:     { icon: 'shield',      pagina: 'iperc',                    label: 'Riesgo IPERC' },
  cotizacion_pend:   { icon: 'clipboard',   pagina: 'requisiciones',            label: 'Cotización' },
  conflicto_sync:    { icon: 'alertCircle', pagina: 'conflictos',               label: 'Conflicto sync' },
  cambio_pend:       { icon: 'fileText',    pagina: 'solicitudes',              label: 'Cambio pendiente' },
  subcontrato_fin:   { icon: 'truck',       pagina: 'subcontratos',             label: 'Subcontrato' },
};

// Navegación (intenta múltiples métodos compatibles con el wiring del usuario)
function navegarA(pagina) {
  try { window.location.hash = '#/' + pagina; } catch { /* noop */ }
  try { window.dispatchEvent(new CustomEvent('jx_navigate', { detail: { page: pagina } })); } catch { /* noop */ }
}

// ─── KPI Card (clon de jx-dashboard-ejecutivo.jsx) ──────────
function AlertaKpiCard({ label, value, color, icon, big }) {
  return (
    <div className="kpi-card" style={{ borderLeft: `3px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 12, color: 'var(--tm)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
        {icon && (
          <div style={{ width: 36, height: 36, borderRadius: 8, background: color + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <JxIcon name={icon} size={18} color={color} />
          </div>
        )}
      </div>
      <div style={{ fontSize: big ? 38 : 28, fontWeight: 800, color, marginTop: 6, lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ─── Item de feed (clon de jx-conflicts.jsx) ────────────────
function AlertaFeedItem({ alerta }) {
  const sev = SEV_META[alerta.severidad] || SEV_META.media;
  const tipoMeta = TIPO_META[alerta.tipo] || { icon: 'alert', pagina: null, label: alerta.tipo };
  return (
    <div className="card card-p" style={{ borderLeft: `3px solid ${sev.color}`, padding: '14px 16px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, background: sev.color + '1a',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <JxIcon name={tipoMeta.icon} size={17} color={sev.color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
            <span className={`badge ${sev.badge}`}>{sev.label}</span>
            <span className="tag">{tipoMeta.label}</span>
            {alerta.fecha_relevante && (
              <span style={{ fontSize: 11, color: 'var(--tm)' }}>· {fmtDate(alerta.fecha_relevante)}</span>
            )}
          </div>
          <div style={{ fontSize: 13.5, color: 'var(--tp)', fontWeight: 700, marginBottom: 3 }}>{alerta.titulo}</div>
          <div style={{ fontSize: 12, color: 'var(--tm)', lineHeight: 1.4 }}>{alerta.descripcion}</div>
          {alerta.contexto && (
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4, fontStyle: 'italic' }}>{alerta.contexto}</div>
          )}
        </div>
        {tipoMeta.pagina && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navegarA(tipoMeta.pagina)}
            style={{ flexShrink: 0, alignSelf: 'flex-start' }}
            title="Ir al módulo"
          >
            Ir a módulo →
          </button>
        )}
      </div>
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  ALERTAS CENTRALIZADAS — vista única tipo "centro de mando"  ║
// ╚══════════════════════════════════════════════════════════════╝
function AlertasCentralizadasPage({ showToast }) {
  // Hooks reactivos
  const { data: materiales }      = window.__hooks.useMateriales?.()      || { data: [] };
  const { data: activos }         = window.__hooks.useActivosPesados?.()  || { data: [] };
  const { data: hms }             = window.__hooks.useHorasMaquina?.()    || { data: [] };
  const { data: pagos }           = window.__hooks.useCronogramaPagos?.() || { data: [] };
  const { data: contratos }       = window.__hooks.usePersonalContrato?.() || { data: [] };
  const { data: iperc }           = window.__hooks.useIperc?.()           || { data: [] };
  const { data: subcontratos }    = window.__hooks.useSubcontratos?.()    || { data: [] };
  const { data: conflictsHook }   = window.__hooks.useConflicts?.()       || { data: null };

  // Datos cargados manualmente (cotizaciones, requisiciones, mantenimientos, change_requests count)
  const [bulk, setBulk] = uS({
    cotizaciones: [],
    requisiciones: [],
    mantenimientos: [],
    changeRequestsCount: 0,
    syncConflicts: [], // fallback si useConflicts no existe
    loaded: false,
  });
  const [refreshTick, setRefreshTick] = uS(0);

  const cargarBulk = uC(async () => {
    try {
      const [cotizaciones, requisiciones, mantenimientos, syncConflicts, changeRequestsCount] = await Promise.all([
        window.__db?.cotizaciones?.filter(x => !x.deleted_at).toArray() ?? Promise.resolve([]),
        window.__db?.requisiciones?.filter(x => !x.deleted_at).toArray() ?? Promise.resolve([]),
        window.__db?.mantenimientos_maquinaria?.filter(x => !x.deleted_at).toArray() ?? Promise.resolve([]),
        window.__db?.sync_conflicts?.where('estado').equals('pendiente').toArray() ?? Promise.resolve([]),
        Promise.resolve(window.__changeRequests?.countPending?.() ?? 0).then(v => Promise.resolve(v)),
      ]);
      setBulk({
        cotizaciones: cotizaciones || [],
        requisiciones: requisiciones || [],
        mantenimientos: mantenimientos || [],
        syncConflicts: syncConflicts || [],
        changeRequestsCount: Number(changeRequestsCount) || 0,
        loaded: true,
      });
    } catch (err) {
      // fallback graceful
      setBulk(b => ({ ...b, loaded: true }));
    }
  }, []);

  uE(() => { cargarBulk(); }, [cargarBulk, refreshTick]);

  // Refresh cuando cambian datos relevantes
  uE(() => {
    const handler = (ev) => {
      const t = ev?.detail?.tabla;
      if (!t) return;
      if (['cotizaciones', 'requisiciones', 'mantenimientos_maquinaria', 'sync_conflicts', 'change_requests'].includes(t)) {
        setRefreshTick(x => x + 1);
      }
    };
    window.addEventListener('jx_data_changed', handler);
    return () => window.removeEventListener('jx_data_changed', handler);
  }, []);

  // ─── Construcción del array de alertas ───────────────────────
  const alertas = uM(() => {
    const out = [];
    const hoy = todayISO();
    const en7d = addDaysISO(7);
    const en30d = addDaysISO(30);

    // 1. Stock bajo de materiales
    (materiales || []).filter(m => !m.deleted_at).forEach(m => {
      const stockMin = Number(m.alerta_minima ?? m.stock_minimo ?? 0);
      const stockAct = Number(m.stock_actual ?? 0);
      if (stockMin > 0 && stockAct <= stockMin) {
        out.push({
          id: `stock_${m.id}`,
          tipo: 'stock_bajo',
          severidad: 'alta',
          titulo: `Stock bajo — ${m.nombre_material || m.nombre || 'Material'}`,
          descripcion: `Stock actual ${stockAct} ${m.unidad || ''} · mínimo ${stockMin} ${m.unidad || ''}`,
          modulo_destino: 'materiales',
          contexto: m.codigo ? `Código: ${m.codigo}` : null,
          fecha_relevante: m.updated_at || null,
        });
      }
    });

    // 2. Mantenimientos programados vencidos / próximos (por activo y tipo)
    const mtByActivo = {};
    for (const m of (bulk.mantenimientos || [])) {
      if (!m.activo_id) continue;
      (mtByActivo[m.activo_id] = mtByActivo[m.activo_id] || []).push(m);
    }
    const hmByActivo = {};
    for (const h of (hms || [])) {
      if (!h?.activo_id || h.deleted_at) continue;
      (hmByActivo[h.activo_id] = hmByActivo[h.activo_id] || []).push(h);
    }
    (activos || []).filter(a => !a.deleted_at).forEach(a => {
      const hmAcum = (hmByActivo[a.id] || []).reduce((s, h) => s + Number(h.horas_trabajadas || h.horas || 0), 0);
      const mtRows = mtByActivo[a.id] || [];
      const ultimos = {};
      for (const m of mtRows) {
        const t = m.tipo; if (!t) continue;
        const prev = ultimos[t];
        if (!prev || (m.hm_actuales || 0) > (prev.hm_actuales || 0) ||
            ((m.hm_actuales || 0) === (prev.hm_actuales || 0) && (m.fecha || '') > (prev.fecha || ''))) {
          ultimos[t] = m;
        }
      }
      for (const plan of PLAN_DEFAULT_MANT) {
        const ult = ultimos[plan.tipo];
        const ultHm = ult ? Number(ult.hm_actuales || 0) : 0;
        const proximo = ult ? ultHm + plan.cada_hm : plan.cada_hm;
        const faltantes = +(proximo - hmAcum).toFixed(1);
        const umbral = plan.cada_hm * 0.10;
        const nombreActivo = a.codigo ? `${a.codigo} · ${a.descripcion || a.tipo || ''}` : (a.descripcion || a.tipo || a.id?.slice(0, 8));
        if (faltantes <= 0) {
          out.push({
            id: `mantv_${a.id}_${plan.tipo}`,
            tipo: 'mantto_vencido',
            severidad: 'critica',
            titulo: `Mantto vencido — ${plan.label}`,
            descripcion: `${nombreActivo} · HM acumuladas ${hmAcum.toFixed(1)} / próximo ${proximo.toFixed(0)} (atrasado ${Math.abs(faltantes).toFixed(0)} HM)`,
            modulo_destino: 'mantenimiento-programado',
            contexto: ult ? `Último: ${fmtDate(ult.fecha)} · ${ultHm.toFixed(0)} HM` : 'Nunca registrado',
            fecha_relevante: ult?.fecha || null,
          });
        } else if (faltantes <= umbral) {
          out.push({
            id: `mantp_${a.id}_${plan.tipo}`,
            tipo: 'mantto_proximo',
            severidad: 'alta',
            titulo: `Mantto por vencer — ${plan.label}`,
            descripcion: `${nombreActivo} · faltan ${faltantes.toFixed(0)} HM (${plan.cada_hm} HM ciclo)`,
            modulo_destino: 'mantenimiento-programado',
            contexto: ult ? `Último: ${fmtDate(ult.fecha)} · ${ultHm.toFixed(0)} HM` : 'Nunca registrado',
            fecha_relevante: ult?.fecha || null,
          });
        }
      }
    });

    // 3. Pagos vencidos
    (pagos || []).filter(p => !p.deleted_at).forEach(p => {
      const esVencido = p.estado === 'vencido' || (p.estado === 'programado' && p.fecha_programada && p.fecha_programada < hoy);
      if (esVencido) {
        const dias = daysBetween(p.fecha_programada, hoy);
        out.push({
          id: `pagov_${p.id}`,
          tipo: 'pago_vencido',
          severidad: 'critica',
          titulo: `Pago vencido — ${p.beneficiario || p.descripcion || 'Sin descripción'}`,
          descripcion: `${fmtCur(p.monto)} ${p.moneda || 'PEN'} · programado ${fmtDate(p.fecha_programada)}${dias ? ` (hace ${dias} día${dias !== 1 ? 's' : ''})` : ''}`,
          modulo_destino: 'flujo-caja',
          contexto: p.categoria ? `Categoría: ${p.categoria}` : null,
          fecha_relevante: p.fecha_programada || null,
        });
      }
    });

    // 4. Pagos próximos (≤7 días)
    (pagos || []).filter(p => !p.deleted_at).forEach(p => {
      if (p.estado === 'programado' && p.fecha_programada && p.fecha_programada >= hoy && p.fecha_programada <= en7d) {
        const dias = daysBetween(hoy, p.fecha_programada);
        out.push({
          id: `pagop_${p.id}`,
          tipo: 'pago_proximo',
          severidad: 'media',
          titulo: `Pago próximo — ${p.beneficiario || p.descripcion || 'Sin descripción'}`,
          descripcion: `${fmtCur(p.monto)} ${p.moneda || 'PEN'} · vence ${fmtDate(p.fecha_programada)} (en ${dias} día${dias !== 1 ? 's' : ''})`,
          modulo_destino: 'flujo-caja',
          contexto: p.categoria ? `Categoría: ${p.categoria}` : null,
          fecha_relevante: p.fecha_programada || null,
        });
      }
    });

    // 5. Contratos laborales próximos a vencer (≤30 días)
    (contratos || []).filter(c => !c.deleted_at).forEach(c => {
      if ((c.estado === 'vigente' || c.estado === 'activo') && c.fecha_fin && c.fecha_fin >= hoy && c.fecha_fin <= en30d) {
        const dias = daysBetween(hoy, c.fecha_fin);
        out.push({
          id: `contr_${c.id}`,
          tipo: 'contrato_vence',
          severidad: 'alta',
          titulo: `Contrato laboral próximo a vencer`,
          descripcion: `Personal ID ${(c.personal_id || '').slice(0, 8)} · vence ${fmtDate(c.fecha_fin)} (en ${dias} día${dias !== 1 ? 's' : ''})`,
          modulo_destino: 'personal-contratos',
          contexto: c.tipo_contrato ? `Tipo: ${c.tipo_contrato}` : null,
          fecha_relevante: c.fecha_fin || null,
        });
      }
    });

    // 6. IPERC riesgo alto/crítico no controlado
    // (esquema real usa 'importante' / 'intolerable'; aceptamos también 'alto'/'critico')
    const clasifCriticas = new Set(['alto', 'critico', 'intolerable', 'importante']);
    (iperc || []).filter(i => !i.deleted_at).forEach(i => {
      const cls = (i.clasificacion || '').toLowerCase();
      if (!clasifCriticas.has(cls)) return;
      const sinControlar = i.estado !== 'controlado' && i.estado !== 'cerrado';
      const sinMedidas = !i.medidas_control || (typeof i.medidas_control === 'string' && !i.medidas_control.trim());
      if (sinControlar || sinMedidas) {
        out.push({
          id: `iperc_${i.id}`,
          tipo: 'iperc_critico',
          severidad: 'critica',
          titulo: `Riesgo ${cls.toUpperCase()} — ${i.peligro || i.actividad || 'Sin descripción'}`,
          descripcion: `Nivel ${i.nivel_riesgo || '—'} · estado ${i.estado || 'identificado'}${sinMedidas ? ' · sin medidas de control' : ''}`,
          modulo_destino: 'iperc',
          contexto: i.actividad ? `Actividad: ${i.actividad}` : null,
          fecha_relevante: i.created_at || null,
        });
      }
    });

    // 7. Cotizaciones recibidas pendientes de aprobar
    const reqsById = {};
    for (const r of (bulk.requisiciones || [])) reqsById[r.id] = r;
    (bulk.cotizaciones || []).forEach(c => {
      if (c.deleted_at) return;
      if (c.estado !== 'recibida') return;
      const req = reqsById[c.requisicion_id];
      if (!req || req.estado !== 'cotizando') return;
      out.push({
        id: `cot_${c.id}`,
        tipo: 'cotizacion_pend',
        severidad: 'media',
        titulo: `Cotización recibida pendiente de aprobar`,
        descripcion: `Requisición ${req.codigo || req.id?.slice(0, 8)} · proveedor ${(c.proveedor_id || '').slice(0, 8)}`,
        modulo_destino: 'requisiciones',
        contexto: c.monto_total ? `Total: ${fmtCur(c.monto_total)}` : null,
        fecha_relevante: c.created_at || c.updated_at || null,
      });
    });

    // 8. Conflictos de sync sin resolver (preferir hook, sino bulk)
    const conflictsList = Array.isArray(conflictsHook) ? conflictsHook : (bulk.syncConflicts || []);
    (conflictsList || []).forEach(cf => {
      if (cf.estado && cf.estado !== 'pendiente') return;
      out.push({
        id: `conf_${cf.local_seq || cf.id}`,
        tipo: 'conflicto_sync',
        severidad: 'alta',
        titulo: `Conflicto de sincronización — ${cf.tabla || 'tabla'}`,
        descripcion: `Registro ${(cf.registro_id || '').slice(0, 8)} · detectado ${fmtDate((cf.created_at || '').slice(0, 10))}`,
        modulo_destino: 'conflictos',
        contexto: 'Resolver manualmente: mantener servidor o forzar local',
        fecha_relevante: cf.created_at ? cf.created_at.slice(0, 10) : null,
      });
    });

    // 9. Solicitudes de cambio sin aprobar (count agregado)
    if (bulk.changeRequestsCount > 0) {
      out.push({
        id: 'changes_pend',
        tipo: 'cambio_pend',
        severidad: 'media',
        titulo: `${bulk.changeRequestsCount} solicitud${bulk.changeRequestsCount !== 1 ? 'es' : ''} de cambio pendiente${bulk.changeRequestsCount !== 1 ? 's' : ''}`,
        descripcion: 'Hay cambios delicados esperando aprobación de un supervisor.',
        modulo_destino: 'solicitudes',
        contexto: null,
        fecha_relevante: null,
      });
    }

    // 10. Subcontratos próximos a fin (≤30d)
    (subcontratos || []).filter(s => !s.deleted_at).forEach(s => {
      if (s.estado !== 'activo') return;
      if (!s.fecha_fin || s.fecha_fin < hoy || s.fecha_fin > en30d) return;
      const dias = daysBetween(hoy, s.fecha_fin);
      out.push({
        id: `sub_${s.id}`,
        tipo: 'subcontrato_fin',
        severidad: 'alta',
        titulo: `Subcontrato próximo a finalizar`,
        descripcion: `${s.descripcion || s.codigo || s.id?.slice(0, 8)} · termina ${fmtDate(s.fecha_fin)} (en ${dias} día${dias !== 1 ? 's' : ''})`,
        modulo_destino: 'subcontratos',
        contexto: s.subcontratista_nombre ? `Subcontratista: ${s.subcontratista_nombre}` : null,
        fecha_relevante: s.fecha_fin || null,
      });
    });

    // Orden: por severidad (crítica → alta → media), luego por fecha relevante asc (más urgente primero)
    out.sort((a, b) => {
      const so = (SEV_META[a.severidad]?.order ?? 9) - (SEV_META[b.severidad]?.order ?? 9);
      if (so !== 0) return so;
      const fa = a.fecha_relevante || '9999-12-31';
      const fb = b.fecha_relevante || '9999-12-31';
      return fa.localeCompare(fb);
    });

    return out;
  }, [materiales, activos, hms, pagos, contratos, iperc, subcontratos, conflictsHook, bulk]);

  // ─── Filtros UI ────────────────────────────────────────────
  const [fSeveridad, setFSeveridad] = uS('todas'); // todas | critica | alta | media
  const [fTipo, setFTipo] = uS('todos');           // todos | <tipo>

  const counts = uM(() => {
    const c = { critica: 0, alta: 0, media: 0, total: alertas.length };
    for (const a of alertas) c[a.severidad] = (c[a.severidad] || 0) + 1;
    return c;
  }, [alertas]);

  const tiposPresentes = uM(() => {
    const s = new Set();
    for (const a of alertas) s.add(a.tipo);
    return Array.from(s);
  }, [alertas]);

  const alertasFiltradas = uM(() => {
    return alertas.filter(a => {
      if (fSeveridad !== 'todas' && a.severidad !== fSeveridad) return false;
      if (fTipo !== 'todos' && a.tipo !== fTipo) return false;
      return true;
    });
  }, [alertas, fSeveridad, fTipo]);

  const refrescar = () => {
    setRefreshTick(x => x + 1);
    showToast?.('Alertas actualizadas', 'green');
  };

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="page-wrap">
      {/* Header */}
      <div className="pg-hd frow-sb" style={{ marginBottom: 18 }}>
        <div>
          <div className="pg-title">Alertas Centralizadas</div>
          <div className="pg-sub">
            {counts.total === 0
              ? 'Todo en orden · sin alertas pendientes'
              : <>
                  <strong style={{ color: SEV_META.critica.color }}>{counts.critica} crítica{counts.critica !== 1 ? 's' : ''}</strong>
                  {' · '}
                  <strong style={{ color: SEV_META.alta.color }}>{counts.alta} alta{counts.alta !== 1 ? 's' : ''}</strong>
                  {' · '}
                  <strong style={{ color: SEV_META.media.color }}>{counts.media} media{counts.media !== 1 ? 's' : ''}</strong>
                </>
            }
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={refrescar} title="Refrescar alertas">
            <JxIcon name="refresh" size={13} /> Refrescar
          </button>
        </div>
      </div>

      {/* KPIs grandes por severidad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 22 }}>
        <AlertaKpiCard label="Críticas" value={String(counts.critica)} color={SEV_META.critica.color} icon="alertCircle" big />
        <AlertaKpiCard label="Altas"    value={String(counts.alta)}    color={SEV_META.alta.color}    icon="alert" big />
        <AlertaKpiCard label="Medias"   value={String(counts.media)}   color={SEV_META.media.color}   icon="bell" big />
      </div>

      {/* Filtros: tabs por severidad + dropdown por tipo */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--bg-soft, rgba(0,0,0,0.05))', borderRadius: 8 }}>
          {[
            { k: 'todas',   l: `Todas (${counts.total})`,   c: 'var(--tp)' },
            { k: 'critica', l: `Críticas (${counts.critica})`, c: SEV_META.critica.color },
            { k: 'alta',    l: `Altas (${counts.alta})`,       c: SEV_META.alta.color },
            { k: 'media',   l: `Medias (${counts.media})`,     c: SEV_META.media.color },
          ].map(t => (
            <button
              key={t.k}
              onClick={() => setFSeveridad(t.k)}
              className="btn btn-sm"
              style={{
                background: fSeveridad === t.k ? t.c : 'transparent',
                color: fSeveridad === t.k ? '#fff' : t.c,
                fontWeight: 600, border: 'none', padding: '6px 12px',
              }}
            >
              {t.l}
            </button>
          ))}
        </div>
        <select className="fi" value={fTipo} onChange={e => setFTipo(e.target.value)} style={{ minWidth: 180 }}>
          <option value="todos">Todos los tipos</option>
          {tiposPresentes.map(t => (
            <option key={t} value={t}>{TIPO_META[t]?.label || t}</option>
          ))}
        </select>
        {(fSeveridad !== 'todas' || fTipo !== 'todos') && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => { setFSeveridad('todas'); setFTipo('todos'); }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Feed de alertas */}
      {alertasFiltradas.length === 0 ? (
        <div className="card card-p empty-state" style={{ padding: '40px 20px', textAlign: 'center' }}>
          <JxIcon name="checkCircle" size={48} color="var(--green)" />
          <p style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: 'var(--tp)' }}>
            {counts.total === 0 ? 'Todo en orden ✓' : 'Sin alertas en este filtro ✓'}
          </p>
          <p style={{ fontSize: 12, color: 'var(--tm)', marginTop: 4 }}>
            {counts.total === 0
              ? 'No hay nada que requiera tu atención ahora mismo.'
              : 'Prueba cambiar los filtros para ver otras alertas.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {alertasFiltradas.map(a => (
            <AlertaFeedItem key={a.id} alerta={a} />
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AlertasCentralizadasPage });
