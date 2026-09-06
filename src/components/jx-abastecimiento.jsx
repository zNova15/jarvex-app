// ═══════════════════════════════════════════════════════════════════
// JARVEX — ABASTECIMIENTO DE LA OBRA (tanda 7, entrega 6).
//
// La pantalla donde se decide QUÉ COMPRAR y A QUIÉN, y desde donde nace la
// orden — antes del comprobante, que es lo que pidió la jefa de contabilidad.
//
// Cuatro columnas y una pregunta cada una:
//   NECESITA    ¿cuánto pide el presupuesto?      (insumos_partida, sumado)
//   YA COMPRADO ¿cuánto compró la ejecutora?      (su propio libro)
//   EN EL GRUPO ¿cuánto tienen las demás empresas y todavía no le vendieron?
//   FALTA       ¿cuánto no tiene nadie?
//
// La lógica vive entera en `src/lib/abastecimiento.js` (18 tests contra los
// números reales de Miraflores). Acá solo está la pantalla.
//
// ── LO QUE ESTA PANTALLA NO HACE, A PROPÓSITO ─────────────────────
// No inventa oferta. Una línea de factura solo cuenta si alguien MAPEÓ su
// descripción a un código del presupuesto y ese mapeo tiene factor de
// conversión. Al 6-sep-2026 `insumo_mapeo` tiene 0 filas, así que la columna
// «en el grupo» arranca en cero para todo — y la pantalla lo DICE con un
// cartel, en vez de mostrar una tabla de ceros que se leería como «el grupo no
// tiene nada». Ese es el mismo error que el escáner de facturas ya enseñó a no
// cometer: una herramienta que afirma de más se deja de abrir.
//
// El interruptor «incluir propuestas del motor» deja ver lo que el mapeo
// sugiere sin confirmar, pintado distinto y con la advertencia puesta. Nunca
// es el estado por defecto: no se emite una orden contra un número que nadie
// miró.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { abastecimientoDeObra, lineasParaOrden } from "../lib/abastecimiento.js";
import { resolverMapeos, indicePorGrupo } from "../lib/mapeo-insumos.js";
import { resolverPares, construirGrupos } from "../lib/insumo-correlacion.js";
import { titularContableDeObra } from "../lib/consorcio.js";
import { extraerComprasDeFacturas } from "../lib/analisis-insumos.js";

const { useState: uS, useMemo: uM, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const cant = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });

const FILTROS = [
  ['falta', 'Falta comprar'],
  ['en_grupo', 'Hay en el grupo'],
  ['cubierto', 'Ya cubierto'],
  ['todos', 'Todos'],
];

function AbastecimientoPage() {
  const obrasHook = window.__hooks.useObras();
  const movsHook = window.__hooks.useAccountingMovements();
  const mapHook = window.__hooks.useInsumoMapeos();
  const corrHook = window.__hooks.useInsumoCorrelaciones();
  const compHook = window.__hooks.useCompanies();
  const consHook = window.__hooks.useConsorcios();

  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();

  const obras = uM(() => (obrasHook.data || []).filter(o => !o.deleted_at), [obrasHook.data]);
  // La obra activa se toma en el INICIALIZADOR, no en un efecto: si se
  // esperara al efecto, el primer pintado mostraría «Elige la obra» y recién
  // después la tabla — un parpadeo en cada entrada. El efecto de abajo queda
  // igual para el caso en que las obras lleguen después (offline-first).
  const [obraId, setObraId] = uS(() => {
    try { return window.__getObraActivaId?.() || ''; } catch { return ''; }
  });
  const [filtro, setFiltro] = uS('falta');
  const [busca, setBusca] = uS('');
  const [conPropuestas, setConPropuestas] = uS(false);
  const [pedido, setPedido] = uS({});          // codigo → { companyId: cantidad }
  const armandoRef = uR(false);

  React.useEffect(() => {
    if (!obraId && obras.length) {
      const guardada = window.__getObraActivaId?.();
      const a = (guardada && obras.find(o => o.id === guardada)) || obras[0];
      if (a) setObraId(a.id);
    }
  }, [obras, obraId]);

  const ipHook = window.__hooks.useInsumosPartida(obraId);

  // Las órdenes ya emitidas RESERVAN stock: sus unidades salieron del
  // disponible aunque la factura todavía no exista. No hay hook para
  // `oc_items`, así que se leen de Dexie y se refrescan cuando cambia algo.
  const [ordenes, setOrdenes] = uS([]);
  const [ocItems, setOcItems] = uS([]);
  React.useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const [o, i] = await Promise.all([
          window.__db.ordenes_compra.toArray(),
          window.__db.oc_items.toArray(),
        ]);
        if (!vivo) return;
        setOrdenes(o.filter(x => !x.deleted_at));
        setOcItems(i.filter(x => !x.deleted_at));
      } catch { if (vivo) { setOrdenes([]); setOcItems([]); } }
    };
    cargar();
    const on = (e) => {
      const t = e?.detail?.tabla;
      if (!t || t === 'ordenes_compra' || t === 'oc_items') cargar();
    };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', cargar);
    return () => {
      vivo = false;
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', cargar);
    };
  }, []);

  const obra = uM(() => obras.find(o => o.id === obraId) || null, [obras, obraId]);
  const titularId = uM(
    () => titularContableDeObra(obra, consHook.data || []),
    [obra, consHook.data]
  );
  const titular = uM(
    () => (compHook.data || []).find(c => c.id === titularId) || null,
    [compHook.data, titularId]
  );

  // Los mapeos ya resueltos (manual > ia > regla), más el puente por
  // correlaciones: si Gabriel ya dijo que dos nombres son el mismo fierro,
  // mapear uno mapea el otro.
  const mapeos = uM(() => resolverMapeos(mapHook.data || [], { demo: esPrueba }), [mapHook.data, esPrueba]);
  const grupoDe = uM(() => {
    const pares = resolverPares(corrHook.data || [], { demo: esPrueba });
    return construirGrupos(pares).grupoDe;
  }, [corrHook.data, esPrueba]);
  const compras = uM(
    () => extraerComprasDeFacturas(movsHook.data || [], { demo: esPrueba }),
    [movsHook.data, esPrueba]
  );
  const porGrupo = uM(
    () => indicePorGrupo(mapeos, compras.map(c => ({ descripcion: c.nombre })), grupoDe),
    [mapeos, compras, grupoDe]
  );

  const { filas, resumen } = uM(() => abastecimientoDeObra({
    insumosPartida: ipHook.data || [],
    movs: movsHook.data || [],
    mapeos, grupoDe, porGrupo,
    titularId,
    companies: compHook.data || [],
    ordenes, ocItems,
    incluirPropuestas: conPropuestas,
  }), [ipHook.data, movsHook.data, mapeos, grupoDe, porGrupo, titularId, compHook.data, ordenes, ocItems, conPropuestas]);

  const visibles = uM(() => {
    const q = busca.trim().toLowerCase();
    return filas.filter(f => {
      if (q && !(`${f.nombre} ${f.codigo}`.toLowerCase().includes(q))) return false;
      if (filtro === 'falta') return f.falta > 0;
      if (filtro === 'en_grupo') return f.disponible > 0;
      if (filtro === 'cubierto') return f.falta <= 0;
      return true;
    });
  }, [filas, filtro, busca]);

  const lineasPedido = uM(() => lineasParaOrden(filas, pedido), [filas, pedido]);
  const totalPedido = lineasPedido.length;

  const setCantidad = (codigo, companyId, valor) => {
    setPedido(p => {
      const n = { ...p, [codigo]: { ...(p[codigo] || {}) } };
      const v = Number(valor);
      if (!Number.isFinite(v) || v <= 0) delete n[codigo][companyId];
      else n[codigo][companyId] = v;
      if (!Object.keys(n[codigo]).length) delete n[codigo];
      return n;
    });
  };

  // Anti doble-click (regla crítica 2): ref SÍNCRONO. Armar el pedido navega a
  // Órdenes con el borrador cargado; dos clicks generarían dos borradores.
  const irAOrden = async () => {
    if (armandoRef.current) return;
    if (!lineasPedido.length) { window.__showToast?.('Elige al menos un insumo y una cantidad', 'amber'); return; }
    armandoRef.current = true;
    try {
      // Se deja el pedido en un buzón que la pantalla de Órdenes lee al abrir.
      // No se escribe nada en la base todavía: el borrador se crea allá, con
      // el proveedor y la empresa emisora ya elegidos.
      window.__pedidoAbastecimiento = {
        obra_id: obraId,
        obra_nombre: obra?.nombre_obra || obra?.nombre || '',
        titular_id: titularId,
        lineas: lineasPedido,
        creado: new Date().toISOString(),
      };
      window.__navTo?.("ordenes");
    } finally { armandoRef.current = false; }
  };

  const cargando = obrasHook.loading || movsHook.loading || ipHook.loading;

  return (
    <div>
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <select className="fi" style={{ maxWidth: 420 }} value={obraId} onChange={e => { setObraId(e.target.value); setPedido({}); }}>
            <option value="">— Elige la obra —</option>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre_obra || o.nombre}</option>)}
          </select>
          <input className="fi" style={{ maxWidth: 260 }} placeholder="Buscar insumo o código…" value={busca} onChange={e => setBusca(e.target.value)} />
          <div style={{ display: 'flex', gap: 4 }}>
            {FILTROS.map(([id, lbl]) => (
              <button key={id} className={`btn btn-sm ${filtro === id ? "btn-amber" : "btn-ghost"}`} onClick={() => setFiltro(id)}>{lbl}</button>
            ))}
          </div>
        </div>

        {titular && (
          <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '10px 0 0' }}>
            Ejecuta <b>{titular.name || titular.legal_name}</b>. «Ya comprado» es lo que compró ella —lo único que ya es costo de la obra—;
            «en el grupo» es lo que tienen las demás empresas y todavía no le facturaron.
          </p>
        )}
        {obraId && !titular && (
          <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: '10px 0 0' }}>
            ⚠ Esta obra no tiene una ejecutora declarada, así que no se puede separar lo que ya es costo de lo que aporta el grupo.
            Cárgala en Consorcios para que las columnas signifiquen algo.
          </p>
        )}
      </div>

      {/* ── EL CARTEL QUE EVITA LEER CEROS COMO DATOS ─────────────── */}
      {obraId && !resumen.hayMapeos && (
        <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)' }}>
          <b>Todavía no hay ningún insumo mapeado al presupuesto.</b>
          <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
            La columna «en el grupo» sale de traducir las descripciones de las facturas a los códigos del presupuesto, y esa
            traducción todavía no empezó. Hasta que se haga, la pantalla muestra lo que la obra necesita y lo que compró la
            ejecutora, y no puede saber qué stock tiene el grupo. Se mapea en <b>Contabilidad → Análisis de Insumos → 🎯 Mapeo al presupuesto</b>.
          </p>
        </div>
      )}

      {obraId && resumen.sinFactor > 0 && (
        <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)' }}>
          <b>{resumen.sinFactor} línea(s) mapeada(s) sin factor de conversión.</b>
          <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
            No se cuentan como stock: no sabemos cuántas unidades del presupuesto trae cada unidad de la factura. Contarlas como
            cero diría «no hay nada» y contarlas como uno diría de más — las dos harían comprar mal. Completa el factor en el
            Mapeo al presupuesto.
          </p>
        </div>
      )}

      <div className="card card-p" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
        <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Insumos del presupuesto</div><b>{resumen.insumos}</b></div>
        <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Con algo comprado</div><b>{resumen.conOferta}</b></div>
        <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Con stock en el grupo</div><b>{resumen.conDisponibleEnGrupo}</b></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginLeft: 'auto', cursor: 'pointer' }}>
          <input type="checkbox" checked={conPropuestas} onChange={e => { setConPropuestas(e.target.checked); setPedido({}); }} />
          Incluir propuestas del motor (sin confirmar)
        </label>
      </div>

      {conPropuestas && (
        <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: '0 0 12px' }}>
          ⚠ Estás viendo stock que nadie confirmó: son propuestas automáticas del mapeo. Sirven para explorar, no para emitir una orden.
        </p>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Insumo</th>
                <th style={{ textAlign: 'right' }}>Necesita</th>
                <th style={{ textAlign: 'right' }}>Ya comprado</th>
                <th>Disponible en el grupo</th>
                <th style={{ textAlign: 'right' }}>Falta</th>
                <th style={{ width: 200 }}>Pedir</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Cargando…</td></tr>
              ) : !obraId ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Elige una obra para ver su abastecimiento.</td></tr>
              ) : visibles.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>Sin insumos en este filtro.</td></tr>
              ) : visibles.map(f => (
                <tr key={f.codigo}>
                  <td className="col-p">
                    <div style={{ fontWeight: 600 }}>{f.nombre}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{f.codigo} · {f.unidad} · en {f.enPartidas} partida(s)</div>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{cant(f.necesita)}</td>
                  <td style={{ textAlign: 'right' }}>{f.yaComprado > 0 ? cant(f.yaComprado) : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                  <td>
                    {f.porEmpresa.length === 0 ? <span style={{ color: 'var(--tm)' }}>—</span> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {f.porEmpresa.map(e => (
                          <div key={e.company_id || 'sin'} style={{ fontSize: 11.5 }}>
                            <b>{cant(e.disponible)}</b> <span style={{ color: 'var(--tm)' }}>{e.nombre}</span>
                            {e.comprometido > 0 && (
                              <span style={{ color: 'var(--amber)' }} title="Ya reservado por una orden emitida sin factura todavía">
                                {' '}· {cant(e.comprometido)} en órdenes
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: f.falta > 0 ? 'var(--red)' : 'var(--green)' }}>{cant(f.falta)}</td>
                  <td>
                    {f.porEmpresa.length === 0 ? <span style={{ fontSize: 11, color: 'var(--tm)' }}>nada que pedir adentro</span> : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {f.porEmpresa.map(e => {
                          const k = e.company_id || 'sin_empresa';
                          return (
                            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <input
                                className="fi" type="number" min="0" max={e.disponible} step="any"
                                style={{ width: 90, padding: '3px 6px', fontSize: 12 }}
                                placeholder={`máx ${cant(e.disponible)}`}
                                value={pedido[f.codigo]?.[k] ?? ''}
                                onChange={ev => setCantidad(f.codigo, k, ev.target.value)}
                              />
                              <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>{(e.nombre || '').slice(0, 14)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPedido > 0 && (
        <div className="card card-p" style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div>
            <b>{totalPedido} línea(s)</b> seleccionadas
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              {[...new Set(lineasPedido.map(l => l.empresa))].join(' · ')}
            </div>
          </div>
          <button className="btn" onClick={() => setPedido({})}>Limpiar</button>
          <button className="btn btn-amber" onClick={irAOrden} disabled={conPropuestas}
            title={conPropuestas ? 'Confirma los mapeos antes de emitir una orden contra propuestas automáticas' : ''}>
            <JxIcon name="package" size={14} /> Armar la orden
          </button>
          {conPropuestas && <span style={{ fontSize: 11, color: 'var(--amber)' }}>Apaga «incluir propuestas» para poder emitir.</span>}
        </div>
      )}
    </div>
  );
}

window.AbastecimientoPage = AbastecimientoPage;
export { AbastecimientoPage };
export default AbastecimientoPage;
