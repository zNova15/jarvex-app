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
const { useMemo: uMI } = React;
const Icon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

// Accesos del plano GENERAL (los mosaicos). Cada uno se muestra solo si el rol
// puede verlo (__canSeeSidebarItem). El resto de páginas generales se alcanzan
// desde el sidebar general una vez que entrás a una de estas.
const TILES = [
  { id: 'empresas',           label: 'Empresas',          icon: 'building', desc: 'Las empresas que manejamos y su contabilidad' },
  { id: 'proveedores',        label: 'Proveedores',       icon: 'truck',    desc: 'Proveedores y distribuidoras (global)' },
  { id: 'captura-magica',     label: 'Captura Mágica',    icon: 'upload',   desc: 'Subí comprobantes y routealos a su obra' },
  { id: 'cont-dashboard',     label: 'Contabilidad',      icon: 'dollar',   desc: 'Dashboard contable, balance, libros, SUNAT' },
  { id: 'dashboard-ejecutivo',label: 'Dirección',         icon: 'dashboard',desc: 'Dashboard ejecutivo, KPIs, alertas' },
  { id: 'obras',              label: 'Obras / Proyectos', icon: 'building', desc: 'Crear y administrar obras' },
  { id: 'reportes',           label: 'Reportes',          icon: 'chart',    desc: 'Reportes generales' },
  { id: 'usuarios',           label: 'Usuarios y Roles',  icon: 'user',     desc: 'Usuarios, roles y permisos' },
  { id: 'configuracion',      label: 'Configuración',     icon: 'settings', desc: 'Ajustes del sistema' },
];

function InicioPage({ onNav, onEnterObra }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const rol = auth?.profile?.rol;
  const { data: obras } = window.__hooks?.useObras?.() || { data: [] };

  const canSee = (id) => (!rol || rol === 'admin') ? true : (window.__canSeeSidebarItem?.(rol, id) ?? true);
  const tiles = uMI(() => TILES.filter(t => canSee(t.id)), [rol]);
  const obrasVivas = uMI(() => (obras || []).filter(o => !o.deleted_at)
    .sort((a, b) => String(a.nombre_obra || '').localeCompare(String(b.nombre_obra || ''))), [obras]);

  const nombreUsuario = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || '';

  return (
    <div className="page-wrap" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="pg-hd">
        <div className="pg-title">Inicio{nombreUsuario ? ` · ${nombreUsuario}` : ''}</div>
        <div className="pg-sub">Elegí una sección general, o entrá a una obra para trabajar en ella.</div>
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
          {obrasVivas.map(o => (
            <button key={o.id} className="card card-p" onClick={() => onEnterObra?.(o.id)}
              style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--bd)', display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 78 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'rgba(52,152,219,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="building" size={17} color="#3498DB" />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)', lineHeight: 1.3 }}>{o.nombre_obra || '(obra sin nombre)'}</div>
                <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  Entrar al workspace <Icon name="chevR" size={12} color="var(--amber)" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { InicioPage });
