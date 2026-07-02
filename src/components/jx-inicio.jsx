// ═══════════════════════════════════════════════════════════════════
// JARVEX — Pantalla de INICIO (launcher, plano GENERAL).
//
// Estilo Delphin: antes de entrar a trabajar, una pantalla que separa
//  · DATOS GENERALES (global, sin obra): Empresas, Proveedores, Captura, etc.
//  · OBRAS: entrás a una y trabajás SU workspace (almacén/partidas/conciliación…).
//
// Usa globales: window.JxIcon, window.__useAuth, window.__hooks.useObras,
// window.__canSeeSidebarItem. Se registra como window.InicioPage.
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

// Mosaicos del plano GENERAL (global, sin obra). Cada uno se muestra solo si el
// rol puede verlo (__canSeeSidebarItem). Empresas se FUSIONÓ en Contabilidad (era
// redundante: ambos llevan al área contable, donde el sidebar ya tiene Empresas).
const TILES = [
  { id: 'cont-dashboard',     label: 'Contabilidad',      icon: 'dollar',   desc: 'Empresas, movimientos, balance, libros, SUNAT' },
  { id: 'captura-magica',     label: 'Captura Mágica',    icon: 'upload',   desc: 'Subí comprobantes y routealos a su obra' },
  { id: 'proveedores',        label: 'Proveedores',       icon: 'truck',    desc: 'Proveedores y distribuidoras (global)' },
  { id: 'dashboard-ejecutivo',label: 'Dirección',         icon: 'dashboard',desc: 'Dashboard ejecutivo, KPIs, alertas' },
  { id: 'reportes',           label: 'Reportes',          icon: 'chart',    desc: 'Reportes generales' },
  { id: 'obras',              label: 'Obras / Proyectos', icon: 'building', desc: 'Crear y administrar obras' },
  { id: 'usuarios',           label: 'Usuarios y Roles',  icon: 'user',     desc: 'Usuarios, roles y permisos' },
  { id: 'configuracion',      label: 'Configuración',     icon: 'settings', desc: 'Ajustes del sistema' },
];

// Accesos rápidos POR ROL dentro de cada obra (páginas de plano OBRA). El almacén,
// las partidas, etc. son por-obra → cada rol ve su entrada en la tarjeta de la obra,
// que lo lleva directo a su trabajo en ESA obra. Se filtran por __canSeeSidebarItem.
// [label, page, icono]. El ícono hace los chips más visibles como accesos reales
// (antes eran píldoras sutiles que pasaban desapercibidas). El admin/gerente/jefe
// de compras ahora tienen ALMACÉN directo (materiales y herramientas) sin tener
// que entrar al workspace y navegar las secciones.
const ACCESOS_OBRA = {
  admin:               [['Gestión', 'dashboard-gestion', 'dashboard'], ['Materiales', 'mov-materiales', 'package'], ['Herramientas', 'mov-herramientas', 'tool'], ['Contabilidad', 'movimientos-contables', 'dollar'], ['Conciliación', 'conciliacion-insumos', 'compare'], ['Avance', 'avance', 'chart']],
  gerente:             [['Gestión', 'dashboard-gestion', 'dashboard'], ['Almacén', 'mov-materiales', 'package'], ['Avance', 'avance', 'chart'], ['Contabilidad', 'movimientos-contables', 'dollar']],
  ingeniero_residente: [['Avance', 'avance', 'chart'], ['Partidas', 'partidas', 'clipboard'], ['Aprobaciones', 'aprobaciones-reporte', 'checkCircle']],
  ingeniero:           [['Mis Partidas', 'mis-partidas', 'clipboard'], ['Reporte Diario', 'reporte-diario', 'chart'], ['Vinculación', 'salidas-frente', 'compare']],
  supervisor:          [['Asistencia', 'asistencia', 'clipboard'], ['Avance', 'avance', 'chart'], ['Almacén', 'mov-materiales', 'package']],
  almacenero:          [['Materiales', 'mov-materiales', 'package'], ['Herramientas', 'mov-herramientas', 'tool'], ['Compras pend.', 'compras-pendientes', 'clipboard']],
  asistente_admin:     [['Gestión', 'dashboard-gestion', 'dashboard'], ['Partidas', 'partidas', 'clipboard'], ['Personal', 'personal', 'clipboard']],
  contador:            [['Movimientos', 'movimientos-contables', 'dollar'], ['Conciliación', 'conciliacion-insumos', 'compare'], ['Avance', 'avance', 'chart']],
  ayudante_contador:   [['Movimientos', 'movimientos-contables', 'dollar'], ['Conciliación', 'conciliacion-insumos', 'compare']],
  tesorero:            [['Movimientos', 'movimientos-contables', 'dollar']],
  jefe_compras:        [['Requisiciones', 'requisiciones', 'clipboard'], ['Órdenes de Compra', 'ordenes-compra', 'truck'], ['Compras pend.', 'compras-pendientes', 'clipboard'], ['Almacén', 'mov-materiales', 'package']],
  rrhh:                [['Personal', 'personal', 'clipboard'], ['Asistencia', 'asistencia', 'clipboard'], ['Planillas', 'planillas', 'dollar']],
  prevencionista:      [['IPERC', 'iperc', 'clipboard'], ['Charlas', 'charlas-seguridad', 'clipboard'], ['Inspecciones', 'inspecciones-seguridad', 'checkCircle']],
  maestro_obra:        [['Avance', 'avance', 'chart'], ['Asistencia', 'asistencia', 'clipboard']],
  solo_lectura:        [['Gestión', 'dashboard-gestion', 'dashboard'], ['Avance', 'avance', 'chart']],
};

// Secciones de OBRA que el rol puede ver, derivadas del MENÚ REAL (window.NAV
// del sidebar) — no de una lista a mano que se desactualiza. Devuelve
// [{ section, items: [{id,label,icon}] }] solo con secciones no vacías.
// Esto es lo que hace que el Inicio muestre TODO el trabajo del rol (antes
// quedaba escondido dentro del workspace y solo asomaban 3-4 chips).
function seccionesObraDelRol(canSee) {
  const nav = window.NAV || [];
  const out = [];
  let cur = null;
  for (const it of nav) {
    if (it.section) { cur = { section: it.section, items: [] }; out.push(cur); continue; }
    if (!cur || !it.id) continue;
    if ((it.plano || planoDe(it.id)) !== 'obra') continue;   // solo trabajo POR OBRA
    if (!canSee(it.id)) continue;
    cur.items.push({ id: it.id, label: String(it.label || it.id).replace(/^✨\s*/, ''), icon: it.icon });
  }
  return out.filter(s => s.items.length > 0);
}

function InicioPage({ onNav, onEnterObra }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const rol = auth?.profile?.rol;
  const { data: obras } = window.__hooks?.useObras?.() || { data: [] };

  const canSee = (id) => (!rol || rol === 'admin') ? true : (window.__canSeeSidebarItem?.(rol, id) ?? true);
  const tiles = uMI(() => TILES.filter(t => canSee(t.id)), [rol]);
  // Accesos rápidos por rol DENTRO de cada obra (máx 4, solo los permitidos).
  const accesosObra = uMI(() => (ACCESOS_OBRA[rol] || []).filter(([, p]) => canSee(p)).slice(0, 6), [rol]);
  // Mapa COMPLETO del trabajo del rol en una obra (derivado del menú real).
  const seccionesObra = uMI(() => seccionesObraDelRol(canSee), [rol]);
  // Obra cuyo panel de secciones está abierto: null = ninguno aún (se auto-abre
  // si hay UNA sola obra), 'none' = cerrado a propósito por el usuario.
  const [obraExpandida, setObraExpandida] = uSI(null);

  // Obras asignadas (null = ve todas). Y avance físico + facturado por obra para
  // las tarjetas (partidas + conciliacion_vinculos — tablas livianas; NO cargamos
  // insumos_partida acá por ser pesada).
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
        // Facturado por obra (Σ cantidad × precio de los vínculos del contador).
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
        // Obras con facturado pero sin partidas igual muestran el facturado.
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

  // Con UNA sola obra, el panel de secciones arranca abierto (el usuario ve todo
  // su trabajo de entrada — caso típico de almacenero/ingeniero). 'none' (cerrado
  // a propósito) se respeta: solo se auto-abre desde el estado inicial null.
  uEI(() => {
    if (obrasVivas.length === 1) setObraExpandida(prev => prev === null ? obrasVivas[0].id : prev);
  }, [obrasVivas]);

  const nombreUsuario = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || '';

  return (
    <div className="page-wrap" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="pg-hd">
        <div className="pg-title">Inicio{nombreUsuario ? ` · ${nombreUsuario}` : ''}</div>
        <div className="pg-sub">{tiles.length > 0
          ? 'Elegí una sección general, o abrí "Secciones" en una obra para ver todo tu trabajo en ella.'
          : 'Este es tu espacio: abajo tenés todas tus secciones de trabajo en la obra — entrá con un clic.'}</div>
      </div>

      {/* ── DATOS GENERALES (mosaicos) ── */}
      {tiles.length > 0 && (<>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)', margin: '6px 0 10px' }}>DATOS GENERALES</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 12, marginBottom: 26 }}>
          {tiles.map(t => (
            <button key={t.id} className="card card-p" onClick={() => onNav?.(t.id)}
              style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 96 }}>
              <div style={{ width: 38, height: 38, borderRadius: 9, background: 'rgba(242,183,5,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={t.icon} size={18} color="var(--amber)" />
              </div>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--tp)' }}>{t.label}</div>
                <div style={{ fontSize: 11, color: 'var(--tm)', lineHeight: 1.35, marginTop: 2 }}>{t.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </>)}

      {/* ── OBRAS ── */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)', margin: '6px 0 10px' }}>
        OBRAS <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>· entrá a una para trabajar</span>
      </div>
      {obrasVivas.length === 0 ? (
        <div className="card card-p empty-state"><Icon name="building" size={36} color="var(--tm)" /><p>No hay obras todavía. Creá una desde "Obras / Proyectos".</p></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {obrasVivas.map(o => {
            const av = avancePorObra.get(o.id);
            return (
            <div key={o.id} className="card card-p" style={{ border: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 78 }}>
              {/* Cabecera clickeable: entra al workspace (home del rol) */}
              <div onClick={() => onEnterObra?.(o.id)} role="button" title="Entrar al workspace de esta obra"
                   style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(52,152,219,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="building" size={17} color="#3498DB" />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', lineHeight: 1.3 }}>{o.nombre_obra || '(obra sin nombre)'}</div>
                  {av && (
                    <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11 }}>
                      <span style={{ color: 'var(--tm)' }}>Físico <strong style={{ color: '#3498DB' }}>{av.fisico.toFixed(0)}%</strong></span>
                      <span style={{ color: 'var(--tm)' }}>Facturado <strong style={{ color: 'var(--amber)' }}>{fmtSk(av.facturado)}</strong></span>
                    </div>
                  )}
                </div>
              </div>
              {/* Accesos rápidos del rol DENTRO de esta obra (entran directo a la
                  página, sin pasar por el workspace + navegar secciones) */}
              {accesosObra.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, paddingLeft: 46 }}>
                  {accesosObra.map(([lbl, pg, ic]) => (
                    <button key={pg} className="btn btn-ghost btn-xs" title={`${lbl} de esta obra`}
                            onClick={() => onEnterObra?.(o.id, pg)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: '1px solid var(--bd)', fontSize: 10.5, padding: '3px 8px' }}>
                      {ic && <Icon name={ic} size={11} color="var(--amber)" />}{lbl}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 'auto', paddingLeft: 46 }}>
                {seccionesObra.length > 0 && (
                  <div onClick={() => setObraExpandida(prev => prev === o.id ? 'none' : o.id)} role="button"
                       style={{ fontSize: 11, color: obraExpandida === o.id ? 'var(--tp)' : 'var(--ts)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontWeight: obraExpandida === o.id ? 700 : 400 }}>
                    Secciones {obraExpandida === o.id ? '▴' : '▾'}
                  </div>
                )}
                <div onClick={() => onEnterObra?.(o.id)} role="button"
                     style={{ fontSize: 11, color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  Entrar al workspace <Icon name="chevR" size={12} color="var(--amber)" />
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* ── TU TRABAJO EN LA OBRA (mapa completo de secciones del rol) ──
          Derivado del menú real: muestra desde el Inicio TODO lo que el rol
          puede hacer en la obra elegida — antes quedaba escondido dentro del
          workspace. Con una sola obra se abre solo. */}
      {(() => {
        if (!obraExpandida || obraExpandida === 'none' || seccionesObra.length === 0) return null;
        const o = obrasVivas.find(x => x.id === obraExpandida);
        if (!o) return null;
        return (
          <div className="card card-p" style={{ marginTop: 16, border: '1px solid var(--bd)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)' }}>TU TRABAJO EN</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--tp)', flex: 1, minWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.nombre_obra}</div>
              {obrasVivas.length > 1 && (
                <button className="btn btn-ghost btn-xs" onClick={() => setObraExpandida('none')} title="Ocultar secciones">✕</button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(215px, 1fr))', gap: '14px 18px' }}>
              {seccionesObra.map(sec => (
                <div key={sec.section}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', color: 'var(--tm)', marginBottom: 6, textTransform: 'uppercase' }}>{sec.section}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {sec.items.map(it => (
                      <button key={it.id} onClick={() => onEnterObra?.(o.id, it.id)} title={`${it.label} · ${o.nombre_obra}`}
                              style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 6, textAlign: 'left', color: 'var(--ts)', fontSize: 12 }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(242,183,5,0.08)'; e.currentTarget.style.color = 'var(--tp)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--ts)'; }}>
                        <Icon name={it.icon} size={13} color="var(--amber)" />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

Object.assign(window, { InicioPage });
