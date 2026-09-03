// ═══════════════════════════════════════════════════════════════════
// JARVEX — PANTALLA PRINCIPAL: los bloques del grupo y nada más.
//
// Reescrita en la TANDA 2D (prueba de Gabriel en staging, 3-sep-2026). La
// versión anterior (entrega 2A) tenía tres cosas que él señaló como errores:
//
//   1. Un selector "OBRA DE TRABAJO" arriba. La obra no se elige acá: se
//      elige DENTRO del bloque Trabajos, que es la lista de trabajos.
//   2. Una sección "TRABAJO EN LA OBRA" con los bloques de la obra (Almacén,
//      Logística, Gestión…) planos en el Inicio. Ese es el DESGLOSE DE UN
//      TRABAJO y vive en el Panel del trabajo (entrega 2B), no acá.
//   3. Los bloques se EXPANDÍAN en el lugar ("Ver N secciones"). Un bloque
//      tiene que LLEVARTE A OTRA PANTALLA: Trabajos → la lista de trabajos →
//      un trabajo → su desglose. Expandir dejaba todo en una sola pantalla
//      cada vez más larga, que era justo el desorden que veníamos a arreglar.
//
// Ahora el Inicio es SOLO el primer nivel: los bloques del grupo, cada uno
// navegando a su pantalla. Nada de datos de obra, nada de expandir.
//
// Los ROLES DE OBRA (almacenero, ingeniero, prevencionista…) ni siquiera
// llegan acá: `resolveLanding` los manda directo a su trabajo, o a la lista
// de los suyos si tienen varios (nav-planos.js).
//
// Usa globales: window.JxIcon, window.__useAuth, window.__canSeeSidebarItem.
// Se registra como window.InicioPage.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
// Los bloques viven en una lib pura para que un test pueda atarlos al menú y
// al registro de páginas REALES: un bloque que apunta a una página inexistente
// deja una tarjeta muerta en la primera pantalla sin romper nada visible.
import { bloquesVisibles, atajosVisibles } from "../lib/bloques-inicio.js";
const { useMemo: uMI, useState: uSI, useEffect: uEI } = React;
const Icon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

function InicioPage({ onNav }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const rol = auth?.profile?.rol;
  // Deny-by-default (igual que el route-guard puedeVerPagina): un profile sin
  // rol NO ve bloques llenos para después chocar con "Sin acceso" en cada click.
  const canSee = (id) => rol === 'admin' ? true : (window.__canSeeSidebarItem?.(rol, id) ?? false);

  // Números de un vistazo (baratos: son los mismos hooks que ya usan las
  // pantallas de segundo nivel, leídos de Dexie).
  const { data: obras } = window.__hooks?.useObras?.() || { data: [] };
  const { data: trabajos } = window.__hooks?.useTrabajos?.() || { data: [] };
  const { data: companies } = window.__hooks?.useCompanies?.() || { data: [] };

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

  // Resumen por bloque: una línea corta, no un dashboard. Si el dato no está
  // cargado todavía queda vacío en vez de mostrar un 0 que miente.
  const resumen = uMI(() => {
    // Respeta el aislamiento: si alguien de obra llega hasta acá, el contador
    // no puede anunciarle obras que no puede abrir.
    const permitidas = window.__obrasPermitidas === undefined ? null : window.__obrasPermitidas;
    const obrasVivas = (obras || []).filter(o => !o.deleted_at && (!permitidas || permitidas.has(o.id)));
    const bs = (trabajos || []).filter(t => !t.deleted_at);
    const comps = (companies || []).filter(c => !c.deleted_at);
    const porTipo = (t) => comps.filter(c => (c.tipo_entidad || 'propia') === t).length;
    return {
      trabajos: obrasVivas.length || bs.length
        ? `${obrasVivas.length} obra${obrasVivas.length === 1 ? '' : 's'}${bs.length ? ` · ${bs.length} bien/servicio` : ''}`
        : '',
      empresas: comps.length
        ? `${porTipo('propia')} del grupo · ${porTipo('consorcio')} consorcio(s) · ${porTipo('tercero')} tercero(s)`
        : '',
      contabilidad: comps.length || obrasVivas.length
        ? `${porTipo('propia') + obrasVivas.length + bs.length} entidad(es) con contabilidad propia`
        : '',
    };
  }, [obras, trabajos, companies]);

  // Un bloque se muestra si el rol puede abrir alguna de sus entradas.
  const bloques = uMI(() => bloquesVisibles(canSee), [rol]);   // eslint-disable-line react-hooks/exhaustive-deps
  const atajos = uMI(() => atajosVisibles(canSee), [rol]);     // eslint-disable-line react-hooks/exhaustive-deps

  const nombreUsuario = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || '';
  const esRevisorSol = rol === 'admin' || rol === 'contador';
  const puedeConflictos = canSee('conflictos');

  return (
    <div className="page-wrap" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div className="pg-hd" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div className="pg-title">Inicio{nombreUsuario ? ` · ${nombreUsuario}` : ''}</div>
          <div className="pg-sub">Elegí en qué parte del grupo querés trabajar.</div>
        </div>
        {/* Tema claro/oscuro también acá: el Inicio no muestra sidebar, así que
            sin esto Mi Perfil (y con él el toggle) era inalcanzable desde esta
            pantalla — pedido de Gabriel (1-sep). Global expuesto por jx-sidebar
            (eager); mismo patrón que window.JxIcon, sin import cruzado. */}
        {window.TemaToggle ? <window.TemaToggle compacto /> : null}
      </div>

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

      {/* ── LOS BLOQUES ── */}
      {bloques.length === 0 ? (
        <div className="card card-p empty-state">
          <Icon name="lock" size={40} color="var(--tm)" />
          <p>Tu rol no tiene bloques habilitados. Pedile acceso al administrador.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
          {bloques.map(b => (
            <button key={b.id} type="button" className="card card-p"
              onClick={() => onNav?.(b.entrada)}
              title={`Ir a ${b.titulo}`}
              style={{
                border: '1px solid var(--border)', textAlign: 'left', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 8, minHeight: 132,
                background: 'var(--bg-c)', color: 'inherit', font: 'inherit',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = b.color; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 38, height: 38, borderRadius: 9, background: `color-mix(in srgb, ${b.color} 12%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name={b.icon} size={18} color={b.color} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tp)' }}>{b.titulo}</div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--tm)', lineHeight: 1.45, flex: 1 }}>{b.desc}</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 10.5, color: 'var(--ts)' }}>{resumen[b.id] || ''}</span>
                <Icon name="chevR" size={14} color={b.color} />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ── ATAJOS ── */}
      {atajos.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--tm)', marginBottom: 8 }}>
            ACCESOS RÁPIDOS
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {atajos.map(a => (
              <button key={a.id} className="btn btn-ghost btn-sm" onClick={() => onNav?.(a.id)}>
                <Icon name={a.icon} size={13} /> {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { InicioPage });
