// ═══════════════════════════════════════════════════════════════════
// JARVEX — Pantalla de INICIO (launcher por BLOQUES, plano GENERAL).
//
// Rediseño (pedido de Gabriel, jul 2026): el Inicio anterior mezclaba
// mosaicos generales + tarjetas de obra + "Tu trabajo en" y se sentía
// desordenado. Ahora:
//  · OBRA DE TRABAJO: un selector arriba fija la obra activa (los bloques
//    por-obra operan sobre ella). El cambio rápido del header sigue vivo.
//  · BLOQUES temáticos (Almacén, Logística, Gestión de Obra, Contabilidad…)
//    que derivan a las secciones. Un bloque puede repetir secciones de otro
//    (ej. EPPs vive en Almacén y en SSOMA). Cada bloque muestra SOLO las
//    secciones que el rol puede ver (__canSeeSidebarItem); bloque vacío no
//    se muestra.
//  · Bloques "por obra" vs "generales" (Contabilidad, Reportes, IA, Empresas
//    y Proveedores, Solicitudes, Usuarios y Configuración son cross-obra).
//
// Usa globales: window.JxIcon, window.__useAuth, window.NAV,
// window.__canSeeSidebarItem, window.__get/setObraActivaId.
// Se registra como window.InicioPage.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { cargarObrasAsignadas } from "../lib/obras-asignadas.js";
import { planoDe } from "../lib/nav-planos.js";
const { useMemo: uMI, useState: uSI, useEffect: uEI } = React;
const Icon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return 'S/ ' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return 'S/ ' + (v / 1e3).toFixed(0) + 'K';
  return 'S/ ' + Math.round(v);
};

// ── BLOQUES del Inicio ──────────────────────────────────────────────
// items = ids de página (labels/íconos salen del menú real window.NAV — una
// sola fuente de verdad; si una página se renombra, acá se actualiza sola).
// tipo 'obra' = opera sobre la obra de trabajo elegida; 'general' = cross-obra.
const BLOQUES = [
  {
    id: 'almacen', titulo: 'Almacén', icon: 'package', tipo: 'obra', color: 'var(--amber)',
    desc: 'Inventarios, movimientos, ubicaciones y vinculación de compras',
    items: ['materiales', 'mov-materiales', 'herramientas', 'mov-herramientas', 'epps-inventario', 'epp',
      'insumos-emergencia', 'insumos-persona', 'ubicaciones', 'compras-pendientes', 'movimientos-insumos', 'caja-chica',
      'evidencias', 'plantillas'],
  },
  {
    id: 'logistica', titulo: 'Logística', icon: 'truck', tipo: 'obra', color: 'var(--blue)',
    desc: 'Solicitud de insumos, requisiciones y órdenes de compra',
    items: ['solicitud-residente', 'requisiciones', 'ordenes-compra'],
  },
  {
    id: 'gestion-obra', titulo: 'Gestión de Obra', icon: 'hardHat', tipo: 'obra', color: 'var(--green)',
    desc: 'Presupuesto, partidas, avance, costos, maquinaria e ingeniería',
    items: ['obras', 'dashboard-gestion', 'panel-residente', 'importar', 'partidas', 'insumos', 'control-consumo', 'versiones',
      'cronograma', 'avance', 'aprobaciones-reporte', 'rendimiento-ingenieros', 'comparativo', 'costos',
      'valorizaciones', 'incidencias', 'activos-pesados', 'mantenimiento-programado',
      'dashboard-tecnico', 'mis-partidas', 'cronograma-frente', 'salidas-frente', 'reporte-diario',
      'mis-reportes', 'borradores-reporte', 'plan-real', 'emitir-alerta'],
  },
  {
    id: 'personal', titulo: 'Personal y Subcontratos', icon: 'users', tipo: 'obra', color: 'var(--purple)',
    desc: 'RRHH, asistencia, planillas y subcontratos',
    items: ['personal', 'frentes', 'asistencia', 'personal-contratos', 'planillas', 'cts', 'gratificaciones',
      'plame', 'subcontratistas', 'subcontratos', 'subcontrato-valorizaciones'],
  },
  {
    id: 'ssoma', titulo: 'Seguridad (SSOMA)', icon: 'shield', tipo: 'obra', color: 'var(--orange)',
    desc: 'Reporte diario, charlas, IPERC, inspecciones y EPPs',
    items: ['reporte-especialidad', 'charlas-plan', 'sctr-personal', 'inducciones', 'charlas-seguridad', 'iperc', 'inspecciones-seguridad', 'capacitaciones', 'epps-inventario',
      'epp', 'insumos-persona', 'insumos-emergencia'],
  },
  {
    id: 'ambiental', titulo: 'Ambiental', icon: 'map', tipo: 'obra', color: 'var(--green)',
    desc: 'Reporte diario y evidencias de gestión ambiental (ISO 14001)',
    items: ['reporte-especialidad', 'gestion-ambiental', 'charlas-plan', 'inducciones', 'charlas-seguridad', 'capacitaciones', 'evidencias'],
  },
  {
    id: 'calidad', titulo: 'Calidad', icon: 'checkCircle', tipo: 'obra', color: 'var(--blue)',
    desc: 'Reporte diario y verificación de insumos (certificados vs expediente)',
    items: ['reporte-especialidad', 'gestion-calidad', 'materiales', 'evidencias'],
  },
  {
    id: 'social', titulo: 'Social', icon: 'users', tipo: 'obra', color: 'var(--purple)',
    desc: 'Compromisos con la comunidad, quejas/reclamos, padrón y charlas',
    items: ['reporte-especialidad', 'gestion-social', 'charlas-plan', 'charlas-seguridad', 'capacitaciones', 'evidencias'],
  },
  {
    id: 'contabilidad', titulo: 'Contabilidad', icon: 'dollar', tipo: 'general', color: 'var(--amber)',
    desc: 'Empresas del grupo, movimientos, conciliación, tesorería y SUNAT',
    items: ['cont-dashboard', 'movimientos-contables', 'conciliacion-insumos', 'guias-remision', 'pagos',
      // SCTR vive acá para contabilidad (la contadora sube el trámite) — así no
      // necesita ver el bloque de Seguridad (pedido 21-jul).
      'sctr-personal',
      'compras-categoria', 'ordenes-intercompany', 'intercompany', 'trazabilidad', 'consolidado',
      'cuentas-bancarias', 'flujo-caja', 'flujo-proyectado', 'plan-cuentas', 'libro-diario',
      'balance-general', 'estado-resultados', 'comprobantes', 'libros-electronicos', 'config-sunat',
      'comparativo-periodos'],
  },
  {
    id: 'reportes', titulo: 'Reportes y Dashboards', icon: 'chart', tipo: 'general', color: 'var(--blue)',
    desc: 'Visión ejecutiva, KPIs, cumplimiento y alertas',
    items: ['dashboard', 'reportes', 'dashboard-ejecutivo', 'kpis-obra', 'cumplimiento-cronograma', 'alertas'],
  },
  {
    id: 'ia', titulo: 'Herramientas IA', icon: 'upload', tipo: 'general', color: 'var(--green)',
    desc: 'Captura Mágica de comprobantes y búsqueda global',
    items: ['captura-magica', 'captura-campo', 'busqueda'],
  },
  {
    id: 'empresas-prov', titulo: 'Empresas y Proveedores', icon: 'building', tipo: 'general', color: 'var(--purple)',
    desc: 'Entidades del grupo y proveedores (global)',
    items: ['empresas', 'proveedores'],
  },
  {
    id: 'solicitudes-blq', titulo: 'Solicitudes', icon: 'bell', tipo: 'general', color: 'var(--orange)',
    desc: 'Solicitud de insumos, requisiciones, cambios y conflictos',
    items: ['solicitud-residente', 'requisiciones', 'solicitudes', 'conflictos'],
  },
  {
    id: 'usuarios-blq', titulo: 'Usuarios y Roles', icon: 'user', tipo: 'general', color: 'var(--red)',
    desc: 'Cuentas, permisos y auditoría',
    items: ['usuarios', 'roles', 'audit-log'],
  },
  {
    id: 'config-blq', titulo: 'Configuración', icon: 'settings', tipo: 'general', color: 'var(--tm)',
    desc: 'Ajustes del sistema',
    items: ['configuracion'],
  },
];

// Cuántas secciones muestra un bloque antes del "+N más".
const MAX_VISIBLES = 7;

// ── Bloques de ESPECIALIDAD: cada especialista ve SOLO el suyo ──────
// Los 4 bloques comparten ids de página (reporte-especialidad, evidencias,
// charlas-plan…), y como un bloque se muestra si el rol ve ≥1 item, canSee()
// solo no alcanza: ing_calidad veía también SSOMA/Ambiental/Social (bug
// reportado por Gabriel). Regla: un ESPECIALISTA solo ve el bloque de su
// especialidad; los demás roles (admin/gerente/residente/etc.) no cambian —
// siguen viendo lo que su matriz permita.
const DUENO_ESPECIALIDAD = { ssoma: 'prevencionista', ambiental: 'ing_ambiental', calidad: 'ing_calidad', social: 'ing_social' };
const ROLES_ESPECIALISTAS = new Set(Object.values(DUENO_ESPECIALIDAD));

// ── Tarjeta de un bloque ────────────────────────────────────────────
function BloqueCard({ blq, items, onAbrir }) {
  const [verTodo, setVerTodo] = uSI(false);
  const visibles = verTodo ? items : items.slice(0, MAX_VISIBLES);
  const ocultos = items.length - MAX_VISIBLES;
  return (
    <div className="card card-p" style={{ border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: `color-mix(in srgb, ${blq.color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={blq.icon} size={17} color={blq.color} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--tp)' }}>{blq.titulo}</div>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', lineHeight: 1.3 }}>{blq.desc}</div>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {visibles.map(it => (
          <button key={it.id} onClick={() => onAbrir(it.id)} title={it.label}
            style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, textAlign: 'left', color: 'var(--ts)', fontSize: 12 }}
            onMouseEnter={e => { e.currentTarget.style.background = `color-mix(in srgb, ${blq.color} 8%, transparent)`; e.currentTarget.style.color = 'var(--tp)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--ts)'; }}>
            <Icon name={it.icon} size={13} color={blq.color} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
          </button>
        ))}
        {ocultos > 0 && (
          <button onClick={() => setVerTodo(v => !v)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', textAlign: 'left', color: 'var(--tm)', fontSize: 11.5, fontWeight: 600 }}>
            {verTodo ? '▴ Ver menos' : `+${ocultos} más ▾`}
          </button>
        )}
      </div>
    </div>
  );
}

function InicioPage({ onNav, onEnterObra }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const rol = auth?.profile?.rol;
  const { data: obras } = window.__hooks?.useObras?.() || { data: [] };
  // Deny-by-default (igual que el route-guard puedeVerPagina): un profile sin
  // rol NO ve los bloques llenos para después chocar con "Sin acceso" en cada
  // click — __canSeeSidebarItem ya deja pasar los utilities (dashboard/búsqueda).
  const canSee = (id) => rol === 'admin' ? true : (window.__canSeeSidebarItem?.(rol, id) ?? false);

  // ── PENDIENTES DE ATENCIÓN (solicitudes / conflictos / sync fallido) ──
  // countPending consulta el server: con el RLS estricto, para un no-revisor
  // cuenta SUS solicitudes pendientes (la almacenera ve las suyas).
  const [atencion, setAtencion] = uSI({ solicitudes: 0, conflictos: 0, failed: 0 });
  uEI(() => {
    let cancel = false;
    const load = async () => {
      try {
        const [sol, conf, failed] = await Promise.all([
          window.__changeRequests?.countPending ? window.__changeRequests.countPending().catch(() => 0) : 0,
          window.__db.sync_conflicts.where('estado').equals('pendiente').count().catch(() => 0),
          import('../sync/SyncEngine').then(m => m.getFailedCount()).catch(() => 0),
        ]);
        if (!cancel) setAtencion({ solicitudes: sol || 0, conflictos: conf || 0, failed: Number(failed) || 0 });
      } catch {}
    };
    load();
    // Solo recargar cuando el evento es de solicitudes/conflictos (el COUNT de
    // solicitudes va al SERVER; recontarlo por cambios de otras tablas era puro
    // gasto) — y con debounce: un pull de sync emite ráfagas de eventos.
    let deb = null;
    const on = (e) => {
      const t = e?.detail?.tabla;
      if (t && !['change_requests', 'sync_conflicts'].includes(t)) return;
      clearTimeout(deb);
      deb = setTimeout(load, 2000);
    };
    window.addEventListener('jx_data_changed', on);
    return () => { cancel = true; clearTimeout(deb); window.removeEventListener('jx_data_changed', on); };
  }, []);

  // Obras asignadas (null = ve todas) + avance físico/facturado por obra
  // (partidas + conciliacion_vinculos — livianas; insumos_partida NO se carga acá).
  const [misObrasIds, setMisObrasIds] = uSI(null);
  const [avancePorObra, setAvancePorObra] = uSI(() => new Map());
  uEI(() => {
    let cancel = false;
    cargarObrasAsignadas({ userId: auth?.profile?.id, rol }).then(s => { if (!cancel) setMisObrasIds(s); });
    return () => { cancel = true; };
  }, [auth?.profile?.id, rol]);
  uEI(() => {
    let cancel = false;
    const calc = async () => {
      try {
        const [partidas, vinculos] = await Promise.all([
          window.__db.partidas.filter(p => !p.deleted_at && p.codigo_delfin).toArray(),
          window.__db.conciliacion_vinculos.filter(v => !v.deleted_at).toArray(),
        ]);
        const fact = new Map();
        for (const v of vinculos) fact.set(v.obra_id, (fact.get(v.obra_id) || 0) + (Number(v.cantidad) || 0) * (Number(v.precio_unitario) || 0));
        // Físico por obra (avance ponderado por costo, solo HOJAS).
        const porObra = new Map();
        for (const p of partidas) { const a = porObra.get(p.obra_id) || []; a.push(p); porObra.set(p.obra_id, a); }
        const m = new Map();
        for (const [oid, ps] of porObra) {
          const folders = new Set();
          for (const p of ps) { const s = String(p.codigo_delfin).trim().split('.'); for (let i = 1; i < s.length; i++) folders.add(s.slice(0, i).join('.')); }
          let sumPres = 0, sumAv = 0;
          for (const p of ps) { if (folders.has(String(p.codigo_delfin).trim())) continue; const pres = Number(p.costo_total_presupuestado) || 0; sumPres += pres; sumAv += (Number(p.porcentaje_avance) || 0) * pres; }
          m.set(oid, { fisico: sumPres > 0 ? sumAv / sumPres : 0, facturado: fact.get(oid) || 0 });
        }
        for (const [oid, f] of fact) if (!m.has(oid)) m.set(oid, { fisico: 0, facturado: f });
        if (!cancel) setAvancePorObra(m);
      } catch { /* conciliacion_vinculos puede no existir en Dexie viejos */ }
    };
    calc();
    let deb; const on = () => { clearTimeout(deb); deb = setTimeout(calc, 600); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; clearTimeout(deb); window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, []);

  const obrasVivas = uMI(() => (obras || []).filter(o => !o.deleted_at && (!misObrasIds || misObrasIds.has(o.id)))
    .sort((a, b) => String(a.nombre_obra || '').localeCompare(String(b.nombre_obra || ''))), [obras, misObrasIds]);

  // ── OBRA DE TRABAJO (selector). Arranca en la obra activa persistida; si no
  // está entre las visibles, cae a la primera. Elegir acá fija la obra activa
  // global (misma que el cambio rápido del header en las secciones).
  const [obraSelId, setObraSelId] = uSI(() => window.__getObraActivaId?.() || null);
  const obraSel = uMI(() => obrasVivas.find(o => o.id === obraSelId) || obrasVivas[0] || null, [obrasVivas, obraSelId]);
  const elegirObra = (id) => {
    setObraSelId(id);
    if (window.__setObraActivaId) window.__setObraActivaId(id);
  };
  // Si el id persistido no está entre las obras visibles (obra borrada o ya no
  // asignada), el display cae a la primera — alinear el GLOBAL con lo que la
  // pantalla anuncia: si no, los flujos que resuelven la obra por localStorage
  // (ej. Captura Mágica) operarían sobre una obra distinta a la mostrada.
  uEI(() => {
    if (!obraSel) return;
    const stored = window.__getObraActivaId?.();
    if (stored !== obraSel.id) elegirObra(obraSel.id);
  }, [obraSel?.id]);

  // Labels/íconos desde el menú real (window.NAV): una sola fuente de verdad.
  const navInfo = uMI(() => {
    const m = new Map();
    for (const it of (window.NAV || [])) {
      if (it.id) m.set(it.id, { label: String(it.label || it.id).replace(/^✨\s*/, ''), icon: it.icon });
    }
    return m;
  }, []);

  // Bloques con sus secciones permitidas para el rol (bloque vacío no se
  // muestra). Además, un ESPECIALISTA no ve los bloques de OTRAS especialidades
  // aunque comparta páginas con ellas (ver DUENO_ESPECIALIDAD arriba).
  const bloques = uMI(() => BLOQUES.map(b => ({
    ...b,
    items: b.items.filter(id => navInfo.has(id) && canSee(id))
      .map(id => ({ id, ...navInfo.get(id) })),
  })).filter(b => {
    if (b.items.length === 0) return false;
    const dueno = DUENO_ESPECIALIDAD[b.id];
    // Bloques de ESPECIALIDAD: solo su especialista y el admin (pedido 21-jul:
    // la contadora no debe ver el bloque de Seguridad solo por el SCTR — esa
    // sección vive también en su bloque de Contabilidad).
    if (dueno) return rol === 'admin' || rol === dueno;
    return true;
  }), [rol, navInfo]);
  const bloquesObra = bloques.filter(b => b.tipo === 'obra');
  const bloquesGeneral = bloques.filter(b => b.tipo === 'general');

  // Abrir una sección: las de plano OBRA fijan la obra de trabajo y entran;
  // las generales navegan directo. 'movimientos-contables' es DUAL (obra y
  // general): desde el bloque Contabilidad se abre su vista general
  // ("todas / por obra"), igual que desde el sidebar del área contable.
  const abrir = (pageId) => {
    if (pageId === 'movimientos-contables') { onNav?.(pageId, 'general'); return; }
    if (planoDe(pageId) === 'obra') {
      if (!obraSel) { window.__showToast?.('Primero elegí una obra de trabajo', 'amber'); return; }
      onEnterObra?.(obraSel.id, pageId);
    } else {
      onNav?.(pageId);
    }
  };

  const nombreUsuario = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || '';
  const av = obraSel ? avancePorObra.get(obraSel.id) : null;
  const esRevisorSol = rol === 'admin' || rol === 'contador';
  // Con la MISMA función del route-guard (asistente_admin pasa la matriz de
  // 'Conflictos Sync' pero su allowlist exclusiva no incluye la página →
  // chip clickeable que moría en "Sin acceso").
  const puedeConflictos = canSee('conflictos');

  return (
    <div className="page-wrap" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="pg-hd">
        <div className="pg-title">Inicio{nombreUsuario ? ` · ${nombreUsuario}` : ''}</div>
        <div className="pg-sub">Elegí tu obra de trabajo y entrá a las secciones desde los bloques.</div>
      </div>

      {/* ── OBRA DE TRABAJO ── */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)', margin: '6px 0 10px' }}>
        OBRA DE TRABAJO <span style={{ fontWeight: 400, letterSpacing: 0 }}>· los bloques "de obra" trabajan sobre ella</span>
      </div>
      {obrasVivas.length === 0 ? (
        <div className="card card-p" style={{ marginBottom: 22, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Icon name="building" size={22} color="var(--tm)" />
          <div style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: 'var(--ts)' }}>No hay obras todavía (o no tenés obras asignadas).</div>
          {(rol === 'admin' || (window.__hasPerm?.(rol, 'Obras', 'w') ?? false)) && (
            <button className="btn btn-amber btn-sm" onClick={() => onNav?.('obras')}>
              <Icon name="plus" size={13} /> Crear obra
            </button>
          )}
        </div>
      ) : (
        <div className="card card-p" style={{ marginBottom: 22, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ width: 38, height: 38, borderRadius: 9, background: 'rgba(52,152,219,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="building" size={18} color="var(--blue)" />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            {obrasVivas.length === 1 ? (
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', lineHeight: 1.35 }}>{obraSel?.nombre_obra || '(obra sin nombre)'}</div>
            ) : (
              <select className="fi" value={obraSel?.id || ''} onChange={e => elegirObra(e.target.value)}
                style={{ width: '100%', fontWeight: 600 }}>
                {obrasVivas.map(o => <option key={o.id} value={o.id}>{o.nombre_obra || '(obra sin nombre)'}</option>)}
              </select>
            )}
            {av && (
              <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11 }}>
                <span style={{ color: 'var(--tm)' }}>Físico <strong style={{ color: 'var(--blue)' }}>{av.fisico.toFixed(0)}%</strong></span>
                <span style={{ color: 'var(--tm)' }}>Facturado <strong style={{ color: 'var(--amber)' }}>{fmtSk(av.facturado)}</strong></span>
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" title="Abrir el workspace completo de esta obra (con su menú lateral)"
            style={{ color: 'var(--amber)', border: '1px solid var(--border)' }}
            onClick={() => obraSel && onEnterObra?.(obraSel.id)}>
            Entrar al workspace <Icon name="chevR" size={12} color="var(--amber)" />
          </button>
        </div>
      )}

      {/* ── PENDIENTES DE ATENCIÓN ── */}
      {(() => {
        const chips = [];
        if (atencion.solicitudes > 0) chips.push({
          id: 'solicitudes', icon: '🔔', color: 'var(--amber)',
          lbl: esRevisorSol
            ? `${atencion.solicitudes} solicitud(es) de cambio por revisar`
            : `${atencion.solicitudes} solicitud(es) tuya(s) esperando respuesta`,
        });
        if (puedeConflictos && atencion.conflictos > 0) chips.push({ id: 'conflictos', icon: '⚔️', lbl: `${atencion.conflictos} conflicto(s) de sync`, color: 'var(--red)' });
        if (atencion.failed > 0) chips.push({ id: null, icon: '🔴', lbl: `${atencion.failed} registro(s) sin subir — click en el badge de sync (arriba)`, color: 'var(--red)' });
        if (!chips.length) return null;
        return (
          <div className="card card-p" style={{ marginBottom: 22, border: '1px solid rgba(242,183,5,0.35)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)' }}>PENDIENTES DE ATENCIÓN</div>
            {chips.map((c, i) => (
              <button key={i} className="btn btn-ghost btn-sm" style={{ color: c.color, cursor: c.id ? 'pointer' : 'default' }}
                onClick={() => c.id && onNav?.(c.id)}>
                {c.icon} {c.lbl} {c.id && '→'}
              </button>
            ))}
          </div>
        );
      })()}

      {/* ── BLOQUES DE OBRA ── */}
      {bloquesObra.length > 0 && obrasVivas.length > 0 && (<>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)', margin: '6px 0 10px', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          TRABAJO EN LA OBRA
          {obraSel && <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none', color: 'var(--ts)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }}>· {obraSel.nombre_obra}</span>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12, marginBottom: 26 }}>
          {bloquesObra.map(b => <BloqueCard key={b.id} blq={b} items={b.items} onAbrir={abrir} />)}
        </div>
      </>)}

      {/* ── BLOQUES GENERALES ── */}
      {bloquesGeneral.length > 0 && (<>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)', margin: '6px 0 10px' }}>
          GENERAL <span style={{ fontWeight: 400, letterSpacing: 0 }}>· cruzan todas las obras</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 12 }}>
          {bloquesGeneral.map(b => <BloqueCard key={b.id} blq={b} items={b.items} onAbrir={abrir} />)}
        </div>
      </>)}
    </div>
  );
}

Object.assign(window, { InicioPage });
