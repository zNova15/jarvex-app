// ═══════════════════════════════════════════════════════════════════
// JARVEX — GUÍAS DE REMISIÓN (apartado de contabilidad)
//
// Las guías llegan por Captura Mágica (tipo 'guia_remision') o se vinculan
// acá. VÍNCULO BIDIRECCIONAL con la factura (accounting_movement_id):
// · desde la guía → botón "Ver factura" (abre Movimientos filtrado);
// · desde Movimientos → 📄 abre esta página filtrada por la serie.
// El deep-link usa el patrón intent global (window.__guiasFocusIntent /
// window.__movsBuscarIntent) + window.__navTo.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { matchFacturaDeGuia, normalizarDoc, clasificarOrigenGuia, facturasQueRequierenGuia,
         sugerirGuiasParaFactura, indexarVinculos, referenciasDeGuia, coberturaDeGuias } from "../lib/guias.js";
// Normalizadores canónicos del repo (guias.js es puro y no importa nada: se
// los inyecta). normInsumo quita tildes/puntuación; normUnidad unifica los
// sinónimos que escribe el OCR ("bolsa"/"bls"/"BOLSA" son la misma unidad).
import { normInsumo } from "../lib/insumo-correlacion.js";
import { normUnidad } from "../lib/inventario-empresa.js";
import { itemsDeFactura, parseNotas } from "../lib/cruce-recepcion.js";
import { normalizarRuc } from "../lib/doc-id.js";
import { getCurrentMode } from "../lib/app-mode-core.js";

const { useState: uS, useMemo: uM, useEffect: uE } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

// Badge de origen (pedido 31-ago): EMITIDA la despachó una empresa del grupo;
// RECIBIDA viene de un proveedor.
const ORIGEN_BADGE = {
  emitida:     { label: '↗ Emitida',  cls: 'b-green', title: 'La emitió una empresa del grupo' },
  recibida:    { label: '↘ Recibida', cls: 'b-blue',  title: 'La emitió un proveedor' },
  desconocida: { label: '? Sin RUC',  cls: 'b-gray',  title: 'La guía no tiene RUC de emisor' },
};

function GuiasRemisionPage({ showToast }) {
  const toast = showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = rol === 'admin' || (window.__hasPerm?.(rol, 'Movs. Contables', 'w') ?? false);
  const movsHook = window.__hooks.useAccountingMovements();
  const movs = movsHook.data;
  const { data: obras } = window.__hooks.useObras();
  const { data: companies } = window.__hooks.useCompanies();

  const [guias, setGuias] = uS([]);
  // Vínculos N:M guía↔factura (mig 165). La columna vieja
  // guias_remision.accounting_movement_id ya no manda: solo espeja el primero.
  const [vinculos, setVinculos] = uS([]);
  const [q, setQ] = uS(() => {
    // Deep-link desde Movimientos: pre-filtrar por la serie de la guía.
    const intent = window.__guiasFocusIntent;
    if (intent) { window.__guiasFocusIntent = null; return String(intent); }
    return '';
  });
  const [busy, setBusy] = uS(false);
  const [vincular, setVincular] = uS(null);   // guía a vincular manualmente
  // Pestaña de origen. Arranca SIEMPRE en 'todas': el deep-link desde el chip
  // 📄 de Movimientos no sabe si la guía es emitida o recibida.
  const [tab, setTab] = uS('todas');
  const [filtroVinculo, setFiltroVinculo] = uS('todos');   // todos | vinculadas | sin_vincular | esperando
  const [filtroEmpresa, setFiltroEmpresa] = uS('todas');   // empresa del grupo
  const [filtroObra, setFiltroObra] = uS('todas');
  const [fDesde, setFDesde] = uS('');
  const [fHasta, setFHasta] = uS('');
  // Panel "facturas que requieren guía": colapsado por defecto; ventana de 90
  // días por defecto (hay cientos de facturas viejas — el backlog completo se
  // abre a pedido con "Ver todo el histórico").
  const [panelAbierto, setPanelAbierto] = uS(false);
  const [panelTodo, setPanelTodo] = uS(false);
  const [verSinDatos, setVerSinDatos] = uS(false);
  const [verNoRequiere, setVerNoRequiere] = uS(false);
  const [buscarGuiaPara, setBuscarGuiaPara] = uS(null);    // factura → elegir guía suelta

  uE(() => {
    let cancel = false;
    const load = async () => {
      try {
        const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
        const rows = await window.__db.guias_remision.filter(g => !g.deleted_at && (esPrueba ? g.demo === true : g.demo !== true)).toArray();
        const vins = await window.__db.guia_factura.filter(v => !v.deleted_at && (esPrueba ? v.demo === true : v.demo !== true)).toArray();
        if (cancel) return;
        rows.sort((a, b) => String(b.fecha_emision || b.created_at || '').localeCompare(String(a.fecha_emision || a.created_at || '')));
        setGuias(rows);
        setVinculos(vins);
      } catch {}
    };
    load();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || t === 'guias_remision' || t === 'guia_factura') load(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jarvex_master_updated', on);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', on); window.removeEventListener('jarvex_master_updated', on); };
  }, []);

  const movById = uM(() => new Map((movs || []).map(m => [m.id, m])), [movs]);
  const idxVinc = uM(() => indexarVinculos(vinculos), [vinculos]);
  // Facturas de una guía. Manda la tabla N:M; si la guía es anterior a la mig
  // 165 (o la creó un cliente con bundle viejo) todavía no tiene filas ahí y
  // se cae al espejo de la columna, así que nada queda invisible.
  const facturasDeGuia = (g) => {
    const ids = idxVinc.porGuia.get(g.id);
    const lista = ids && ids.size ? [...ids] : (g.accounting_movement_id ? [g.accounting_movement_id] : []);
    return lista.map(id => movById.get(id)).filter(Boolean);
  };
  const nVinculos = (g) => (idxVinc.porGuia.get(g.id)?.size) || (g.accounting_movement_id ? 1 : 0);
  const guiasDeFactura = (movId) => [...(idxVinc.porFactura.get(movId) || [])]
    .map(gid => guias.find(g => g.id === gid)).filter(Boolean);
  const obraNombre = (id) => (obras || []).find(o => o.id === id)?.nombre_obra || '';

  // RUCs del grupo → clasificar cada guía como emitida/recibida (derive puro).
  const rucsGrupo = uM(() =>
    new Set((companies || []).filter(c => !c.deleted_at && c.ruc).map(c => normalizarRuc(c.ruc))),
    [companies]);
  const origenDe = uM(() => {
    const m = new Map();
    for (const g of guias) m.set(g.id, clasificarOrigenGuia(g, rucsGrupo));
    return m;
  }, [guias, rucsGrupo]);

  // Opciones comunes del matcher (cercos de emisor y dirección venta/compra).
  const optsGuia = uM(() => {
    const rucPorCompany = new Map((companies || []).filter(c => !c.deleted_at).map(c => [c.id, normalizarRuc(c.ruc)]));
    return { rucsGrupo, rucCompanyDe: (m) => rucPorCompany.get(m.company_id) || '', vinculos };
  }, [companies, rucsGrupo, vinculos]);

  // ── PENDIENTE guía → factura ──
  // Facturas que la guía dice amparar y que todavía NO están en el sistema.
  // Es derivado, no un estado guardado: desaparece solo cuando la factura entra.
  // Se computa UNA vez por cambio de datos (guias/movs/vínculos) en un Map:
  // llamarlo por fila recorría TODOS los movs G veces en CADA render — con el
  // buscador eso era O(guías × movs) por tecla (hallazgo de la inspección 1-sep).
  const pendPorGuia = uM(() => {
    const m = new Map();
    for (const g of guias) {
      const p = referenciasDeGuia(g, movs || [], optsGuia).filter(x => x.estado === 'ausente');
      if (p.length) m.set(g.id, p);
    }
    return m;
  }, [guias, movs, optsGuia]);
  const pendientesDe = (g) => pendPorGuia.get(g.id) || [];
  const guiasConPendiente = uM(() => guias.filter(g => pendPorGuia.has(g.id)), [guias, pendPorGuia]);
  const idsConPendiente = uM(() => new Set(guiasConPendiente.map(g => g.id)), [guiasConPendiente]);

  // ── PENDIENTE factura → guías ──
  // La factura ya tiene guía(s), pero las cantidades trasladadas no cubren lo
  // facturado: todavía falta que entreguen material, o sea falta subir una
  // guía. Se excluye 'sinCruce' (las descripciones del OCR no matchearon): ahí
  // no se puede afirmar que falte nada.
  const parciales = uM(() => {
    const out = [];
    for (const movId of idxVinc.porFactura.keys()) {
      const mov = movById.get(movId);
      if (!mov || mov.deleted_at) continue;
      const c = coberturaDeGuias(mov, guiasDeFactura(movId), itemsDeFactura, { normDesc: normInsumo, normUnidad });
      if (c.aplica && !c.sinGuias && !c.sinCruce && !c.completa) out.push({ mov, cobertura: c });
    }
    return out.sort((a, b) => String(b.mov.date || '').localeCompare(String(a.mov.date || '')));
  }, [idxVinc, movById, guias, movs]);

  // ¿A qué empresa del grupo pertenece la guía? Emitida → por RUC del emisor;
  // recibida → la empresa de la factura vinculada (fallback g.company_id, que
  // Captura Mágica solo llena a veces).
  const empresaDeGuia = (g) => {
    const origen = origenDe.get(g.id);
    if (origen === 'emitida') {
      const ruc = normalizarRuc(g.emisor_ruc);
      return (companies || []).find(c => c.ruc && normalizarRuc(c.ruc) === ruc)?.id || null;
    }
    const mov = facturasDeGuia(g)[0] || null;
    return mov?.company_id || g.company_id || null;
  };

  const filtradas = uM(() => {
    const qn = q.trim().toLowerCase();
    return guias.filter(g => {
      if (qn && !(
        String(g.serie_correlativo || '').toLowerCase().includes(qn) ||
        String(g.emisor_razon_social || '').toLowerCase().includes(qn) ||
        String(g.doc_referencia || '').toLowerCase().includes(qn))) return false;
      if (tab !== 'todas' && origenDe.get(g.id) !== tab) return false;
      if (filtroVinculo === 'vinculadas' && nVinculos(g) === 0) return false;
      if (filtroVinculo === 'sin_vincular' && nVinculos(g) > 0) return false;
      // "Esperando factura": la guía referencia comprobantes que todavía no
      // están cargados (con o sin otras facturas ya vinculadas).
      if (filtroVinculo === 'esperando' && !idsConPendiente.has(g.id)) return false;
      if (filtroEmpresa !== 'todas' && empresaDeGuia(g) !== filtroEmpresa) return false;
      if (filtroObra !== 'todas' && g.obra_id !== filtroObra) return false;
      const f = String(g.fecha_emision || g.created_at || '').slice(0, 10);
      if (fDesde && f && f < fDesde) return false;
      if (fHasta && f && f > fHasta) return false;
      return true;
    });
  }, [guias, q, tab, filtroVinculo, filtroEmpresa, filtroObra, fDesde, fHasta, origenDe, movById, companies, idxVinc, idsConPendiente]);

  // ── Facturas que requieren guía y no la tienen (heurística + override) ──
  // El espejo automático de una venta interco no lleva guía propia (la guía
  // vive en la venta original) → fuera de la lista.
  const requieren = uM(() => facturasQueRequierenGuia(movs || [], guias, itemsDeFactura, {
    esEspejoAuto: (m) => parseNotas(m?.notas)?.intercompany_auto === true,
    vinculos,
  }), [movs, guias, vinculos]);
  const cortePanel = uM(() => {
    // Ventana de 90 días para el panel (backlog viejo a pedido). "Hoy" en zona
    // Lima (regla crítica 7: nunca new Date().toISOString() directo).
    if (panelTodo) return null;
    const hoy = window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10);
    const [y, mo, da] = hoy.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, da - 90)).toISOString().slice(0, 10);
  }, [panelTodo]);
  const enVentana = (m) => !cortePanel || String(m.date || '').slice(0, 10) >= cortePanel;
  const comprasPend = uM(() => requieren.compras.filter(enVentana).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [requieren, cortePanel]);
  const ventasPend = uM(() => requieren.ventas.filter(enVentana).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))), [requieren, cortePanel]);
  const sinDatosPend = uM(() => requieren.sinDatos.filter(enVentana), [requieren, cortePanel]);

  const marcarGuiaEstado = async (m, estado) => {
    if (busy) return;
    if (estado === 'no_requiere' && !confirm(`¿Marcar ${m.document_number || 'esta factura'} como "NO requiere guía"? Sale de la lista de pendientes (reversible desde el plegado "Marcadas no requiere").`)) return;
    setBusy(true);
    try {
      // Escritura directa estilo setVinculo (demo-aware): el update genérico
      // del hook dejaba los movimientos DEMO en pending_update para siempre
      // (el push filtra demos y el contador de pendientes no) → badge
      // "N pendiente(s)" eterno en la barra de sync.
      const { SYNC_STATUS } = await import('../db/jarvex.db');
      const fresh = await window.__db.accounting_movements.get(m.id);
      if (!fresh) return;
      await window.__db.accounting_movements.update(m.id, {
        guia_estado: estado,
        updated_at: new Date().toISOString(), updated_by: userId,
        version: (fresh.version ?? 0) + 1,
        sync_status: fresh.demo === true ? SYNC_STATUS.SYNCED
          : (fresh.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
      });
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast(estado === 'no_requiere'
        ? `✓ ${m.document_number || 'Factura'} marcada "no requiere guía" — sale de la lista (reversible abajo)`
        : estado === 'requiere'
          ? `⚑ ${m.document_number || 'Factura'} marcada "SÍ requiere" — queda entre los pendientes`
          : `↩ ${m.document_number || 'Factura'} vuelve a decidirse por la heurística`, 'green');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // Reversibilidad de "no requiere": lista de marcadas para poder deshacer.
  const noRequiereList = uM(() =>
    (movs || []).filter(m => m && !m.deleted_at && m.document_type === 'factura' && m.guia_estado === 'no_requiere'),
    [movs]);

  const verFactura = (g) => {
    const mov = facturasDeGuia(g)[0];
    // Movimientos filtra por búsqueda: pasamos el número de documento.
    window.__movsBuscarIntent = mov?.document_number || g.doc_referencia || '';
    window.__navTo?.('movimientos-contables', 'general');
  };

  const abrirEvidencia = async (g) => {
    try {
      const ev = g.evidencia_id ? await window.__db.evidencias.get(g.evidencia_id) : null;
      if (!ev) { toast('Esta guía no tiene el PDF adjunto', 'amber'); return; }
      const { getEvidenciaSrc, abrirUrlEvidencia } = await import('../lib/evidencias-url.js');
      const r = await getEvidenciaSrc(ev);
      if (r?.url) abrirUrlEvidencia(r.url);
    } catch {}
  };

  // Vincular/desvincular una guía con UNA factura. Con el N:M (mig 165) esto
  // SUMA o QUITA un vínculo en vez de reemplazar el único que había: una guía
  // puede amparar varias facturas. movId null = quitar todos (el "Desvincular"
  // de siempre). La columna vieja de la guía se mantiene espejando el primer
  // vínculo, para los clientes PWA que todavía tengan bundle cacheado.
  const setVinculo = async (g, movId, quitar = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const { SYNC_STATUS } = await import('../db/jarvex.db');
      const fresh = await window.__db.guias_remision.get(g.id);
      if (!fresh) return;
      const ahora = new Date().toISOString();
      const esDemo = fresh.demo === true;
      const marcaSync = esDemo ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING_UPDATE;

      const existentes = await window.__db.guia_factura
        .filter(v => !v.deleted_at && v.guia_id === g.id).toArray();

      const borrar = (movId && quitar) ? existentes.filter(v => v.accounting_movement_id === movId)
        : (!movId ? existentes : []);
      for (const v of borrar) {
        await window.__db.guia_factura.update(v.id, {
          deleted_at: ahora, updated_at: ahora, updated_by: userId,
          version: (v.version ?? 0) + 1, sync_status: marcaSync,
        });
      }
      if (movId && !quitar && !existentes.some(v => v.accounting_movement_id === movId)) {
        // Si el par existió y se desvinculó, el tombstone CONSERVA el
        // idempotency_key global `gf_<guia>_<mov>` (UNIQUE en el server):
        // crear una fila NUEVA con el mismo key choca 23505 al pushear y el
        // vínculo queda FAILED para siempre, visible solo en este device.
        // Se RESUCITA el tombstone en su lugar.
        const tomb = await window.__db.guia_factura
          .filter(v => v.guia_id === g.id && v.accounting_movement_id === movId && !!v.deleted_at)
          .first();
        if (tomb) {
          await window.__db.guia_factura.update(tomb.id, {
            deleted_at: null, origen: 'manual', updated_at: ahora, updated_by: userId,
            version: (tomb.version ?? 0) + 1,
            sync_status: esDemo ? SYNC_STATUS.SYNCED
              : (tomb.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
          });
        } else {
          await window.__db.guia_factura.add({
            id: window.__newId(), guia_id: g.id, accounting_movement_id: movId,
            origen: 'manual', confianza: null,
            created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
            idempotency_key: `gf_${g.id}_${movId}`,
            ...(esDemo ? { demo: true, sync_status: SYNC_STATUS.SYNCED } : { sync_status: SYNC_STATUS.PENDING_CREATE }),
          });
        }
      }

      // Espejo legacy: el primero de los que quedan vivos.
      const vivos = (await window.__db.guia_factura.filter(v => !v.deleted_at && v.guia_id === g.id).toArray())
        .map(v => v.accounting_movement_id);
      await window.__db.guias_remision.update(g.id, {
        accounting_movement_id: vivos[0] || null,
        updated_at: ahora, updated_by: userId,
        version: (fresh.version ?? 0) + 1,
        sync_status: esDemo ? SYNC_STATUS.SYNCED
          : (fresh.sync_status === SYNC_STATUS.PENDING_CREATE ? SYNC_STATUS.PENDING_CREATE : SYNC_STATUS.PENDING_UPDATE),
      });
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'guias_remision' } }));
      window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'guia_factura' } }));
      try { window.dispatchEvent(new Event('online')); } catch {}
      toast(!movId || quitar ? 'Vínculo quitado' : `Guía vinculada (${vivos.length} factura${vivos.length === 1 ? '' : 's'})`, 'green');
      setVincular(null);
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
    finally { setBusy(false); }
  };

  // Candidatos de factura para vincular a mano (sugerencia por Doc.Ref primero).
  const candidatosDe = (g) => {
    // rucCompanyDe: en una VENTA el emisor es NUESTRA empresa, no third_party_ruc
    // (sin esto las guías EMITIDAS nunca sugerían su factura).
    const rucPorCompany = new Map((companies || []).filter(c => !c.deleted_at).map(c => [c.id, normalizarRuc(c.ruc)]));
    const sug = matchFacturaDeGuia({ id: g.id, doc_referencia: g.doc_referencia, emisor_ruc: g.emisor_ruc }, movs || [], {
      rucsGrupo, rucCompanyDe: (m) => rucPorCompany.get(m.company_id) || '', vinculos,
    });
    const ref = normalizarDoc(g.doc_referencia);
    const yaVinc = idxVinc.porGuia.get(g.id) || new Set();
    const lista = (movs || [])
      .filter(m => !m.deleted_at && m.document_number && !yaVinc.has(m.id))
      .map(m => ({ m, pri: sug?.mov?.id === m.id ? 2 : (ref && normalizarDoc(m.document_number)?.correlativo === ref.correlativo ? 1 : 0) }))
      .sort((a, b) => b.pri - a.pri || String(b.m.date || '').localeCompare(String(a.m.date || '')))
      .slice(0, 30);
    return { lista, sugerido: sug?.mov?.id || null };
  };

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Guías de Remisión</div>
          <div className="pg-sub">{guias.length} guía(s) · emitidas por el grupo o recibidas de proveedores · vinculadas (ida y vuelta) a su factura</div>
        </div>
      </div>

      {/* Pestañas de ORIGEN (pedido 31-ago): emitida = el RUC emisor es de una
          empresa del grupo; recibida = de un proveedor. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {[['todas', 'Todas'], ['emitida', '↗ Emitidas (nuestras)'], ['recibida', '↘ Recibidas (proveedores)']].map(([v, l]) => (
          <button key={v} className={`btn btn-sm ${tab === v ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab(v)}>
            {l} <span style={{ opacity: 0.7, fontSize: 10 }}>({v === 'todas' ? guias.length : guias.filter(g => origenDe.get(g.id) === v).length})</span>
          </button>
        ))}
      </div>

      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-bar" style={{ flex: '1 1 240px' }}>
            <JxIcon name="search" size={14} color="var(--tm)" />
            <input placeholder="Buscar por serie / emisor / referencia…" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          {(q || tab !== 'todas' || filtroVinculo !== 'todos' || filtroEmpresa !== 'todas' || filtroObra !== 'todas' || fDesde || fHasta) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setTab('todas'); setFiltroVinculo('todos'); setFiltroEmpresa('todas'); setFiltroObra('todas'); setFDesde(''); setFHasta(''); }}>
              ✕ Limpiar filtros
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 10, marginTop: 10 }}>
          <div>
            <label className="flabel">Vínculo con factura</label>
            <select className="fi" value={filtroVinculo} onChange={e => setFiltroVinculo(e.target.value)} style={{ width: '100%' }}>
              <option value="todos">Todas</option>
              <option value="vinculadas">✓ Vinculadas</option>
              <option value="sin_vincular">⚠ Sin vincular</option>
              <option value="esperando">⏳ Esperando factura ({guiasConPendiente.length})</option>
            </select>
          </div>
          <div>
            <label className="flabel">🏢 Empresa del grupo</label>
            <select className="fi" value={filtroEmpresa} onChange={e => setFiltroEmpresa(e.target.value)} style={{ width: '100%' }}
              title="Emitidas: por el RUC emisor. Recibidas: la empresa de la factura vinculada.">
              <option value="todas">Todas</option>
              {(companies || []).filter(c => !c.deleted_at).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="flabel">🏗 Obra</label>
            <select className="fi" value={filtroObra} onChange={e => setFiltroObra(e.target.value)} style={{ width: '100%' }}>
              <option value="todas">Todas</option>
              {(obras || []).filter(o => !o.deleted_at).map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
            </select>
          </div>
          <div>
            <label className="flabel">📅 Emisión del / al</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="fi" type="date" value={fDesde} onChange={e => setFDesde(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
              <input className="fi" type="date" value={fHasta} onChange={e => setFHasta(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── APARTADO: guías esperando su factura (pedido de Gabriel 1-sep) ──
          La guía YA está registrada acá (Captura Mágica no retiene nada: al
          confirmarla sale de esa bandeja pase lo que pase); lo que falta es
          cargar la(s) factura(s) que referencia. Cuando esa factura entre por
          Captura Mágica el vínculo se cierra solo y la guía sale de esta lista
          sin tocar nada. */}
      {guiasConPendiente.length > 0 && (
        <div className="card" style={{ marginBottom: 12, overflow: 'hidden', border: '1px solid color-mix(in srgb, var(--amber) 40%, transparent)' }}>
          <div style={{ padding: '10px 14px', background: 'color-mix(in srgb, var(--amber) 8%, transparent)', fontSize: 12.5, fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
            <span>⏳ Guías esperando su factura
              <span style={{ color: 'var(--amber)', marginLeft: 8 }}>{guiasConPendiente.length}</span>
              <div style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--tm)', marginTop: 2 }}>
                Referencian facturas que todavía no están cargadas. No hay nada que hacer acá: al subir esa factura por Captura Mágica, el vínculo se cierra solo.
              </div>
            </span>
            <button className="btn btn-ghost btn-xs" onClick={() => { setFiltroVinculo(filtroVinculo === 'esperando' ? 'todos' : 'esperando'); }}>
              {filtroVinculo === 'esperando' ? 'Ver todas las guías' : 'Filtrar la tabla ↓'}
            </button>
          </div>
          <div style={{ padding: '8px 14px', display: 'grid', gap: 5 }}>
            {guiasConPendiente.slice(0, 20).map(g => {
              const o = ORIGEN_BADGE[origenDe.get(g.id)] || ORIGEN_BADGE.desconocida;
              return (
                <div key={g.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 700, fontSize: 11.5 }}>{g.serie_correlativo || '(sin serie)'}</span>
                  <span className={`badge ${o.cls}`} style={{ fontSize: 8.5 }}>{o.label}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--tm)', flex: 1, minWidth: 120 }}>{g.emisor_razon_social || ''}</span>
                  {pendientesDe(g).map(pp => (
                    <span key={pp.doc} className="badge" style={{ background: 'var(--amber)', color: '#000', fontSize: 9 }}>falta {pp.doc}</span>
                  ))}
                </div>
              );
            })}
            {guiasConPendiente.length > 20 && <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>…y {guiasConPendiente.length - 20} más — usá el filtro "Esperando factura".</div>}
          </div>
        </div>
      )}

      {/* ── Facturas que REQUIEREN guía y no la tienen (pedido 31-ago) ── */}
      {/* Cobertura incompleta: la factura YA tiene guías, pero las cantidades
          trasladadas no llegan a lo facturado → falta entregar material y, con
          eso, falta subir una guía más. */}
      {parciales.length > 0 && (
        <div className="card" style={{ marginBottom: 12, overflow: 'hidden', border: '1px solid color-mix(in srgb, var(--orange) 40%, transparent)' }}>
          <div style={{ padding: '10px 14px', background: 'color-mix(in srgb, var(--orange) 8%, transparent)', fontSize: 12.5, fontWeight: 700 }}>
            📦 Facturas con guías INCOMPLETAS
            <span style={{ color: 'var(--orange)', marginLeft: 8 }}>{parciales.length}</span>
            <div style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--tm)', marginTop: 2 }}>
              Ya tienen guía, pero lo trasladado no cubre lo facturado: falta que entreguen el resto y suba su guía.
            </div>
          </div>
          <div style={{ padding: '8px 14px', display: 'grid', gap: 6 }}>
            {parciales.slice(0, 25).map(({ mov, cobertura }) => (
              <div key={mov.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap', paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
                <button className="btn btn-ghost btn-xs" title="Ir a la factura en Movimientos Contables"
                  onClick={() => { window.__movsBuscarIntent = mov.document_number || ''; window.__navTo?.('movimientos-contables', 'general'); }}>
                  🧾 {mov.document_number || 'factura'}
                </button>
                <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>{mov.third_party_name || ''} {mov.date ? `· ${mov.date}` : ''}</span>
                <div style={{ fontSize: 11, flexBasis: '100%' }}>
                  {cobertura.faltantes.slice(0, 4).map((l, i) => (
                    <span key={i} style={{ marginRight: 10 }}>
                      falta <b style={{ color: 'var(--orange)' }}>{Number(l.falta).toLocaleString('es-PE')} {l.unidad || ''}</b> de {String(l.descripcion || '').slice(0, 40)}
                      <span style={{ color: 'var(--tm)' }}> ({Number(l.trasladado).toLocaleString('es-PE')} de {Number(l.facturado).toLocaleString('es-PE')})</span>
                    </span>
                  ))}
                  {cobertura.faltantes.length > 4 && <span style={{ color: 'var(--tm)' }}>+{cobertura.faltantes.length - 4} más</span>}
                </div>
              </div>
            ))}
            {parciales.length > 25 && <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>…y {parciales.length - 25} más.</div>}
          </div>
        </div>
      )}

      {(comprasPend.length + ventasPend.length + sinDatosPend.length > 0 || panelAbierto) && (
        <div className="card" style={{ marginBottom: 12, overflow: 'hidden', border: '1px solid rgba(242,183,5,0.35)' }}>
          <button onClick={() => setPanelAbierto(a => !a)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '10px 14px', background: 'rgba(242,183,5,0.07)', border: 'none', cursor: 'pointer', color: 'var(--tp)', fontSize: 12.5, fontWeight: 700 }}>
            <span>🚚 Facturas que requieren guía y NO la tienen
              <span style={{ color: 'var(--amber)', marginLeft: 8 }}>
                {comprasPend.length} compra{comprasPend.length === 1 ? '' : 's'} · {ventasPend.length} venta{ventasPend.length === 1 ? '' : 's'}
              </span>
              <span style={{ color: 'var(--tm)', fontWeight: 400, fontSize: 10.5, marginLeft: 8 }}>
                {panelTodo ? 'todo el histórico' : 'últimos 90 días'}
              </span>
            </span>
            <span style={{ color: 'var(--amber)', fontSize: 11 }}>{panelAbierto ? '▲ Cerrar' : '▼ Revisar'}</span>
          </button>
          {panelAbierto && (
            <div style={{ padding: '10px 14px', display: 'grid', gap: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                Criterio: facturas con al menos un ítem que NO es servicio (los bienes se trasladan con guía) y sin guía vinculada.
                "No requiere" la saca de la lista para siempre.
                <button className="btn btn-ghost btn-xs" style={{ marginLeft: 8 }} onClick={() => setPanelTodo(t => !t)}>
                  {panelTodo ? 'Ver solo 90 días' : 'Ver todo el histórico'}
                </button>
              </div>
              {[['🧾 VENTAS — nos tocaba EMITIR la guía (riesgo tributario propio)', ventasPend], ['🛒 COMPRAS — reclamar la guía al proveedor', comprasPend]].map(([titulo, lista]) => lista.length > 0 && (
                <div key={titulo}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6, color: 'var(--ts)' }}>{titulo} · {lista.length}</div>
                  <div style={{ display: 'grid', gap: 4, maxHeight: 260, overflow: 'auto' }}>
                    {lista.slice(0, 80).map(m => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 11.5, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
                        <strong>{m.document_number || 's/n'}</strong>
                        <span style={{ color: 'var(--tm)' }}>{m.date || ''}</span>
                        <span style={{ flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.third_party_name || m.description || ''}</span>
                        <span style={{ color: 'var(--ts)' }}>{m.currency === 'USD' ? '$' : 'S/'} {Number(m.amount || 0).toLocaleString('es-PE')}</span>
                        {canWrite && (
                          <>
                            <button className="btn btn-ghost btn-xs" disabled={busy} title="Elegir entre las guías sin vincular"
                              onClick={() => setBuscarGuiaPara(m)}>🔗 Vincular guía</button>
                            <button className="btn btn-ghost btn-xs" style={{ color: 'var(--tm)' }} disabled={busy}
                              title="Esta factura NO lleva guía — no volver a mostrarla"
                              onClick={() => marcarGuiaEstado(m, 'no_requiere')}>✕ No requiere</button>
                          </>
                        )}
                      </div>
                    ))}
                    {lista.length > 80 && <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>…y {lista.length - 80} más (afiná el período)</div>}
                  </div>
                </div>
              ))}
              {comprasPend.length === 0 && ventasPend.length === 0 && (
                <div style={{ fontSize: 12, color: 'var(--green)' }}>✓ Sin pendientes en este período.</div>
              )}
              {sinDatosPend.length > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setVerSinDatos(v => !v)}>
                    {verSinDatos ? '▲' : '▼'} {sinDatosPend.length} factura(s) sin detalle de ítems (la heurística no puede opinar)
                  </button>
                  {verSinDatos && (
                    <div style={{ display: 'grid', gap: 3, marginTop: 5, maxHeight: 160, overflow: 'auto' }}>
                      {sinDatosPend.slice(0, 60).map(m => (
                        <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span>{m.document_number || 's/n'} · {m.date || ''} · {(m.third_party_name || '').slice(0, 40)}</span>
                          {canWrite && <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => marcarGuiaEstado(m, 'no_requiere')}>✕ No requiere</button>}
                          {canWrite && <button className="btn btn-ghost btn-xs" disabled={busy} title="Sí lleva guía — mantener en la lista" onClick={() => marcarGuiaEstado(m, 'requiere')}>⚑ Sí requiere</button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {noRequiereList.length > 0 && (
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setVerNoRequiere(v => !v)}>
                    {verNoRequiere ? '▲' : '▼'} 🚫 {noRequiereList.length} marcada(s) "no requiere" — deshacer acá
                  </button>
                  {verNoRequiere && (
                    <div style={{ display: 'grid', gap: 3, marginTop: 5, maxHeight: 160, overflow: 'auto' }}>
                      {noRequiereList.slice(0, 60).map(m => (
                        <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span>{m.document_number || 's/n'} · {m.date || ''} · {(m.third_party_name || '').slice(0, 40)}</span>
                          {canWrite && <button className="btn btn-ghost btn-xs" disabled={busy} title="Quitar la marca — vuelve a decidir la heurística" onClick={() => marcarGuiaEstado(m, null)}>↩ Deshacer</button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {filtradas.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="truck" size={36} color="var(--tm)" />
          <p>Sin guías aún. Subílas en ✨ Captura Mágica — las detecta y las enlaza a su factura.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th style={{ width: 130 }}>Guía</th>
                <th>Emisor</th>
                <th>Traslado</th>
                <th style={{ width: 140 }}>Doc. Ref.</th>
                <th style={{ width: 210 }}>Facturas vinculadas</th>
                <th style={{ width: 90 }}></th>
              </tr></thead>
              <tbody>
                {filtradas.map(g => {
                  const movsG = facturasDeGuia(g);
                  const mov = movsG[0] || null;
                  const pendG = pendientesDe(g);
                  return (
                    <tr key={g.id}>
                      <td style={{ fontWeight: 600, fontSize: 12 }}>{g.serie_correlativo || '—'}
                        <div style={{ fontSize: 10, color: 'var(--tm)' }}>{g.fecha_emision || ''}</div>
                        {(() => { const o = ORIGEN_BADGE[origenDe.get(g.id)] || ORIGEN_BADGE.desconocida;
                          return <span className={`badge ${o.cls}`} style={{ fontSize: 8.5 }} title={o.title}>{o.label}</span>; })()}
                      </td>
                      <td style={{ fontSize: 11.5 }}>{g.emisor_razon_social || '—'}
                        {g.obra_id && <div style={{ fontSize: 10, color: 'var(--tm)' }}>🏗 {String(obraNombre(g.obra_id)).slice(0, 40)}</div>}
                      </td>
                      <td style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                        {(g.punto_partida || g.punto_llegada) ? `${String(g.punto_partida || '?').slice(0, 28)} → ${String(g.punto_llegada || '?').slice(0, 28)}` : '—'}
                        {g.fecha_traslado && <div>traslado {g.fecha_traslado}</div>}
                      </td>
                      <td style={{ fontSize: 11.5 }}>{g.doc_referencia || '—'}</td>
                      <td>
                        {mov ? (
                          // Una guía puede amparar VARIAS facturas (mig 165): se
                          // listan todas, cada una con su ✕ para quitar solo esa.
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {movsG.map(mv => (
                              <div key={mv.id} style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                                <button className="btn btn-ghost btn-xs" title="Ir a la factura en Movimientos Contables" onClick={() => verFactura(g)}>
                                  🧾 {mv.document_number || 'factura'} · S/ {Number(mv.amount || 0).toLocaleString('es-PE')}
                                </button>
                                {canWrite && <button className="btn btn-ghost btn-xs" style={{ color: 'var(--tm)' }} title="Quitar este vínculo" disabled={busy} onClick={() => setVinculo(g, mv.id, true)}>✕</button>}
                              </div>
                            ))}
                            {canWrite && (
                              <button className="btn btn-ghost btn-xs" style={{ alignSelf: 'flex-start', color: 'var(--blue)' }}
                                title="Vincular esta guía a otra factura más" disabled={busy} onClick={() => setVincular(g)}>+ otra factura</button>
                            )}
                          </div>
                        ) : canWrite ? (
                          <button className="btn btn-amber btn-xs" disabled={busy} onClick={() => setVincular(g)}>
                            <JxIcon name="link" size={10} /> Vincular factura
                          </button>
                        ) : <span style={{ fontSize: 10.5, color: 'var(--amber)' }}>sin vincular</span>}
                        {/* Fuera de la rama de arriba a propósito: una guía cuyas
                            referencias están TODAS pendientes no tiene ninguna
                            factura vinculada y igual tiene que avisar. */}
                        {pendG.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 }}>
                            {pendG.map(p => (
                              <span key={p.doc} className="badge" style={{ background: 'var(--amber)', color: '#000', fontSize: 8.5 }}
                                title="La guía la referencia pero esa factura todavía no está cargada. Se vinculará sola cuando la subas.">
                                ⏳ falta {p.doc}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-xs" title="Ver el PDF de la guía" onClick={() => abrirEvidencia(g)}>📎</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {vincular && (() => {
        const { lista, sugerido } = candidatosDe(vincular);
        return (
          <window.Modal title={`Vincular guía ${vincular.serie_correlativo || ''} a su factura`} icon="link" onClose={() => setVincular(null)}>
            <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 10 }}>
              Referencia impresa en la guía: <strong>{vincular.doc_referencia || '—'}</strong>. Elegí la factura registrada en Movimientos:
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', display: 'grid', gap: 4 }}>
              {lista.map(({ m, pri }) => (
                <button key={m.id} className="btn btn-ghost btn-xs" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', whiteSpace: 'normal', ...(m.id === sugerido ? { border: '1px solid var(--green)' } : {}) }}
                  disabled={busy} onClick={() => setVinculo(vincular, m.id)}>
                  {m.id === sugerido && <span className="badge b-green" style={{ fontSize: 8.5, marginRight: 5 }}>sugerida</span>}
                  <span style={{ fontWeight: 600 }}>{m.document_number || 's/n'}</span>
                  <span style={{ color: 'var(--tm)', marginLeft: 6 }}>{m.third_party_name || ''} · {m.date || ''} · S/ {Number(m.amount || 0).toLocaleString('es-PE')}</span>
                </button>
              ))}
              {lista.length === 0 && <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>No hay movimientos con documento registrado.</span>}
            </div>
          </window.Modal>
        );
      })()}

      {/* Camino INVERSO (panel "requieren guía"): elegir una guía suelta para
          esta factura. Sugiere por referencia exacta y descarta RUC contradicho. */}
      {buscarGuiaPara && (() => {
        const cands = sugerirGuiasParaFactura(buscarGuiaPara, guias, rucsGrupo, { vinculos });
        return (
          <window.Modal title={`Vincular una guía a ${buscarGuiaPara.document_number || 'la factura'}`} icon="link" onClose={() => setBuscarGuiaPara(null)}>
            <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 10 }}>
              {buscarGuiaPara.third_party_name || ''} · {buscarGuiaPara.date || ''} · Guías SIN vincular: {cands.length}
            </div>
            <div style={{ maxHeight: 300, overflow: 'auto', display: 'grid', gap: 4 }}>
              {cands.map(({ guia: g, pri }) => (
                <button key={g.id} className="btn btn-ghost btn-xs" style={{ justifyContent: 'flex-start', textAlign: 'left', height: 'auto', whiteSpace: 'normal', ...(pri >= 2 ? { border: '1px solid var(--green)' } : {}) }}
                  disabled={busy} onClick={async () => { await setVinculo(g, buscarGuiaPara.id); setBuscarGuiaPara(null); }}>
                  {pri >= 2 && <span className="badge b-green" style={{ fontSize: 8.5, marginRight: 5 }}>coincide ref.</span>}
                  <span style={{ fontWeight: 600 }}>{g.serie_correlativo || 's/n'}</span>
                  <span style={{ color: 'var(--tm)', marginLeft: 6 }}>{g.emisor_razon_social || ''} · {g.fecha_emision || ''} · ref {g.doc_referencia || '—'}</span>
                </button>
              ))}
              {cands.length === 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                  No hay guías sueltas que puedan corresponderle. Cuando llegue, subila por ✨ Captura Mágica — se vincula sola o desde acá.
                </span>
              )}
            </div>
          </window.Modal>
        );
      })()}
    </div>
  );
}

Object.assign(window, { GuiasRemisionPage });
export { GuiasRemisionPage };
