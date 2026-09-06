// ═══════════════════════════════════════════════════════════════════
// JARVEX — MAPEO AL PRESUPUESTO (tanda 7, entrega 5). Pestaña de Análisis
// de Insumos, gate admin/gerente heredado del panel.
//
// Traduce lo que dicen las facturas a los códigos del presupuesto de la obra.
// Es el paso que le falta a todo lo demás: sin esto no se puede comparar lo que
// la obra NECESITA contra lo que el grupo YA COMPRÓ, y sin esa comparación no
// hay pantalla de Abastecimiento ni órdenes que nazcan antes del comprobante.
//
// Cómo se trabaja acá: se decide por DESCRIPCIÓN, no por factura. El mismo
// texto aparece en facturas de varias empresas; se decide una vez y vale para
// todas, las de ayer y las que entren mañana. Las filas vienen ordenadas por
// plata, así que decidir las primeras veinte ya mueve la aguja.
//
// Tres botones y ninguna sorpresa: aceptar el código propuesto, elegir otro, o
// decir «esto no está en el presupuesto» —que es la respuesta correcta para la
// mitad del gasto medido y que TAMBIÉN se recuerda, para que no vuelva a
// preguntarse. El factor de conversión se puede editar siempre: lo que propone
// la norma es un punto de partida, no una imposición.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../lib/app-mode-core.js";
import {
  prepararCatalogo, sugerirMapeo, resolverMapeos, buscarMapeo, indicePorGrupo,
  claveMapeo, proponerFactor, prepararLinea, cantidadCanonica,
} from "../lib/mapeo-insumos.js";

const { useState: uS, useMemo: uM, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const SearchableSelect = (p) => (window.SearchableSelect ? <window.SearchableSelect {...p} /> : null);

const soles = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;
const cant = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });

const ETIQUETA_FUENTE = {
  tabla: { txt: 'norma', color: 'b-green', ayuda: 'Sale de una tabla técnica (kg/m del acero, kg por bolsa).' },
  descripcion: { txt: 'de la factura', color: 'b-green', ayuda: 'La propia factura dice el largo o la presentación.' },
  supuesto: { txt: 'supuesto', color: 'b-amber', ayuda: 'Valor comercial asumido. Revisalo antes de aceptar.' },
  manual: { txt: 'tuyo', color: 'b-blue', ayuda: 'Lo escribiste vos.' },
};

const FILTROS = [
  ['pendientes', 'Por decidir'],
  ['propuesto', 'Con propuesta'],
  ['revisar', 'Dudosas'],
  ['sin_candidato', 'Sin candidato'],
  ['servicio', 'Servicios'],
  ['decididas', 'Ya decididas'],
];

function MapeoInsumosTab({ compras, grupoDe, showToast }) {
  const mapHook = window.__hooks.useInsumoMapeos();
  const obrasHook = window.__hooks.useObras();
  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();

  const [obraSel, setObraId] = uS('');
  const [filtro, setFiltro] = uS('pendientes');
  const [busca, setBusca] = uS('');

  const [elegido, setElegido] = uS({});       // norm → insumo_codigo elegido a mano
  const [factorEdit, setFactorEdit] = uS({}); // norm → factor escrito a mano
  const [limite, setLimite] = uS(60);
  // Anti doble-click (regla crítica de la casa): ref SÍNCRONO. Un doble tap en
  // «Aceptar» no puede escribir dos filas para la misma descripción.
  const guardandoRef = uR(false);

  const obras = uM(() => (obrasHook.data || []).filter(o => !o.deleted_at), [obrasHook.data]);
  // La obra por defecto se DERIVA en el render, no se setea en un efecto: así
  // no hay un primer pintado con el selector vacío, y el test de montaje ve la
  // tabla de verdad (renderToString no corre efectos).
  const obraId = obraSel || obras[0]?.id || '';

  // El catálogo canónico sale del presupuesto de la obra, por HOOK y no por un
  // useEffect con estado: así se calcula durante el render y el test de montaje
  // puede ver la tabla dibujada. Con `useEffect` el cuerpo de la pestaña no se
  // renderizaba nunca en el gate —renderToString no corre efectos— y un TDZ ahí
  // adentro habría pasado en verde, igual que el que dejó Movimientos Contables
  // muerto el 3-sep.
  const ipsHook = window.__hooks.useInsumosPartida(obraId);
  const catalogo = uM(() => {
    if (!obraId || ipsHook.loading) return null;
    // El presupuesto reparte el mismo insumo en muchas partidas (el cemento
    // está en 191): se consolida por código, que es la unidad de decisión.
    const porCodigo = new Map();
    for (const ip of (ipsHook.data || [])) {
      const k = ip?.insumo_codigo && String(ip.insumo_codigo).trim();
      if (!k) continue;
      const cur = porCodigo.get(k) || { insumo_codigo: k, nombre: ip.nombre_insumo, unidad: ip.unidad, tipo: ip.tipo_insumo, cantidad: 0, partidas: 0 };
      cur.cantidad += Number(ip.cantidad_presupuestada) || 0;
      cur.partidas += 1;
      porCodigo.set(k, cur);
    }
    return prepararCatalogo([...porCodigo.values()]);
  }, [obraId, ipsHook.data, ipsHook.loading]);

  const mapeos = uM(() => resolverMapeos(mapHook.data || [], { demo: esPrueba }), [mapHook.data, esPrueba]);

  // Una fila por DESCRIPCIÓN, con lo que esa descripción movió en total.
  const descripciones = uM(() => {
    const porNorm = new Map();
    for (const c of (compras || [])) {
      if (c.clase && c.clase !== 'compra') continue;
      const k = claveMapeo(c.nombre);
      if (!k) continue;
      const cur = porNorm.get(k) || { norm: k, muestra: c.nombre, veces: 0, cantidad: 0, importe: 0, unidades: new Set(), provs: new Set() };
      cur.veces += 1;
      cur.cantidad += Number(c.cantidad) || 0;
      cur.importe += (Number(c.cantidad) || 0) * (Number(c.precio) || 0);
      if (c.unidad) cur.unidades.add(c.unidad);
      if (c.proveedorNombre) cur.provs.add(c.proveedorNombre);
      porNorm.set(k, cur);
    }
    return [...porNorm.values()].sort((a, b) => b.importe - a.importe);
  }, [compras]);

  const porGrupo = uM(
    () => indicePorGrupo(mapeos, descripciones.map(d => ({ descripcion: d.muestra })), grupoDe),
    [mapeos, descripciones, grupoDe],
  );

  // El motor corre acá, sobre TODAS las descripciones. Son ~0,6 s para 1.852 ×
  // 433 comparaciones, memoizadas: solo se recalcula si cambia el presupuesto.
  const filas = uM(() => {
    if (!catalogo) return [];
    return descripciones.map(d => {
      const decidido = buscarMapeo(d.muestra, mapeos, grupoDe, porGrupo);
      const sug = sugerirMapeo({ descripcion: d.muestra, unidad: [...d.unidades][0] || '' }, catalogo);
      return { ...d, decidido, sug, estado: decidido ? 'decididas' : sug.estado };
    });
  }, [descripciones, catalogo, mapeos, grupoDe, porGrupo]);

  const resumen = uM(() => {
    const r = { total: 0, decidido: 0, mapeado: 0, noAplica: 0, propuesto: 0, revisar: 0, sinCand: 0, servicio: 0, nDecididas: 0 };
    for (const f of filas) {
      r.total += f.importe;
      if (f.decidido) {
        r.decidido += f.importe; r.nDecididas += 1;
        if (f.decidido.fila.decision === 'mapeado') r.mapeado += f.importe; else r.noAplica += f.importe;
      } else if (f.estado === 'propuesto') r.propuesto += f.importe;
      else if (f.estado === 'revisar') r.revisar += f.importe;
      else if (f.estado === 'servicio') r.servicio += f.importe;
      else r.sinCand += f.importe;
    }
    return r;
  }, [filas]);

  const visibles = uM(() => {
    const t = busca.trim().toLowerCase();
    return filas.filter(f => {
      if (t && !f.muestra.toLowerCase().includes(t)) return false;
      if (filtro === 'pendientes') return !f.decidido && f.estado !== 'servicio';
      if (filtro === 'decididas') return !!f.decidido;
      return !f.decidido && f.estado === filtro;
    });
  }, [filas, filtro, busca]);

  const opcionesCatalogo = uM(() => (catalogo?.items || []).map(c => ({
    value: c.codigo, label: `${c.nombre} — ${cant(c.cantidad)} ${c.unidad} (${c.codigo})`,
  })), [catalogo]);

  const candidatoDe = (f) => {
    const cod = elegido[f.norm];
    if (cod) {
      const enSug = f.sug.candidatos.find(c => c.cat.codigo === cod);
      if (enSug) return enSug;
      const cat = catalogo.items.find(c => c.codigo === cod);
      if (!cat) return null;
      // Elegido a mano fuera de los sugeridos: igual se le propone un factor.
      return { cat, score: null, motivos: ['elegido a mano'], factor: proponerFactor(prepararLinea({ descripcion: f.muestra, unidad: [...f.unidades][0] || '' }), cat) };
    }
    return f.sug.candidatos[0] || null;
  };

  const factorDe = (f, c) => {
    const escrito = factorEdit[f.norm];
    if (escrito !== undefined && escrito !== '') return { factor: Number(escrito), fuente: 'manual' };
    return c?.factor || { factor: null, fuente: null };
  };

  const guardar = async (f, payload) => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    try {
      const previa = (mapHook.data || []).find(m => !m.deleted_at && !!m.demo === esPrueba && m.norm === f.norm);
      const fila = { norm: f.norm, muestra: f.muestra, fuente: 'manual', deleted_at: null, ...payload };
      if (previa) await mapHook.update(previa.id, fila);
      else await mapHook.create({ id: window.__newId(), ...fila });
      setElegido(p => { const n = { ...p }; delete n[f.norm]; return n; });
      setFactorEdit(p => { const n = { ...p }; delete n[f.norm]; return n; });
      showToast?.(payload.decision === 'no_aplica'
        ? '✓ Marcado como fuera del presupuesto — no se vuelve a preguntar'
        : '✓ Mapeado — vale para todas las facturas con ese texto', 'green');
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); }
    finally { guardandoRef.current = false; }
  };

  const aceptar = (f) => {
    const c = candidatoDe(f);
    if (!c) return;
    const fa = factorDe(f, c);
    guardar(f, {
      decision: 'mapeado', insumo_codigo: c.cat.codigo,
      factor: Number.isFinite(fa.factor) ? fa.factor : null,
      factor_fuente: fa.factor == null ? null : fa.fuente,
      unidad_origen: [...f.unidades][0] || null, unidad_destino: c.cat.unidad || null,
      score: c.score ?? null, nota: c.factor?.nota || null,
    });
  };

  const noAplica = (f) => guardar(f, {
    decision: 'no_aplica', insumo_codigo: null, factor: null, factor_fuente: null,
    unidad_origen: [...f.unidades][0] || null, unidad_destino: null, score: null,
    nota: f.estado === 'servicio' ? 'es un servicio' : null,
  });

  const reabrir = async (f) => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    try {
      const previa = (mapHook.data || []).find(m => !m.deleted_at && !!m.demo === esPrueba && m.norm === f.norm);
      if (previa) await mapHook.update(previa.id, { deleted_at: new Date().toISOString() });
      showToast?.('Decisión deshecha — vuelve a la lista', 'green');
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); }
    finally { guardandoRef.current = false; }
  };

  if (!obras.length) return <div className="card card-p" style={{ color: 'var(--tm)' }}>No hay obras cargadas.</div>;

  const pct = resumen.total ? (resumen.mapeado / resumen.total) * 100 : 0;

  return (
    <>
      <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6 }}>
        Acá se dice <strong>qué insumo del presupuesto</strong> es cada cosa que aparece en las facturas.
        Se decide <strong>por texto, no por factura</strong>: vale para todas las que digan lo mismo, y no se vuelve a preguntar.
        «No está en el presupuesto» también es una respuesta válida y también se recuerda.
      </div>

      <div className="card card-p">
        <div className="frow-sb" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div style={{ minWidth: 240, flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--tm)' }}>Presupuesto de</label>
            <select className="fi" value={obraId} onChange={e => setObraId(e.target.value)}>
              {obras.map(o => <option key={o.id} value={o.id}>{o.nombre_obra || o.nombre || o.id}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 240, flex: 2 }}>
            <label style={{ fontSize: 11, color: 'var(--tm)' }}>Buscar en las descripciones</label>
            <input className="fi" value={busca} onChange={e => setBusca(e.target.value)} placeholder="cemento, fierro, tubo…" />
          </div>
        </div>

        {catalogo === null && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--tm)' }}>Leyendo el presupuesto…</div>}
        {catalogo && catalogo.items.length === 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--amber)' }}>
            ⚠ Esta obra no tiene presupuesto cargado con códigos de insumo. Sin catálogo no hay contra qué mapear.
          </div>
        )}
        {catalogo && catalogo.items.length > 0 && (
          <>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{pct.toFixed(0)}%</div>
              <div style={{ fontSize: 12, color: 'var(--ts)' }}>
                del gasto en compras ya está mapeado al presupuesto — {soles(resumen.mapeado)} de {soles(resumen.total)}
              </div>
            </div>
            <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', marginTop: 6, background: 'var(--tint-neutral)' }}>
              {[['#2ecc71', resumen.mapeado], ['#7f8c8d', resumen.noAplica], ['#3aa3ff', resumen.propuesto],
                ['#f5b428', resumen.revisar], ['#9b59b6', resumen.servicio], ['transparent', resumen.sinCand]].map(([col, val], i) => (
                <div key={i} style={{ width: `${resumen.total ? (val / resumen.total) * 100 : 0}%`, background: col }} />
              ))}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 5 }}>
              {resumen.nDecididas} descripciones decididas de {filas.length} · mapeado {soles(resumen.mapeado)} · fuera del presupuesto {soles(resumen.noAplica)} ·
              con propuesta {soles(resumen.propuesto)} · dudosas {soles(resumen.revisar)} · servicios {soles(resumen.servicio)} · sin candidato {soles(resumen.sinCand)}
            </div>
          </>
        )}
      </div>

      {catalogo && catalogo.items.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {FILTROS.map(([id, txt]) => {
              const n = filas.filter(f => (id === 'pendientes' ? (!f.decidido && f.estado !== 'servicio')
                : id === 'decididas' ? !!f.decidido : (!f.decidido && f.estado === id))).length;
              return (
                <button key={id} className={`btn btn-xs ${filtro === id ? 'btn-amber' : 'btn-ghost'}`}
                  onClick={() => { setFiltro(id); setLimite(60); }}>
                  {txt} <span style={{ opacity: 0.7 }}>({n})</span>
                </button>
              );
            })}
          </div>

          <div className="card" style={{ overflow: 'auto' }}>
            <table className="tbl" style={{ fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: 230 }}>Lo que dice la factura</th>
                  <th style={{ textAlign: 'right' }}>Comprado</th>
                  <th style={{ textAlign: 'right' }}>Importe</th>
                  <th style={{ minWidth: 260 }}>Insumo del presupuesto</th>
                  <th style={{ minWidth: 150 }}>Conversión</th>
                  <th style={{ minWidth: 140 }} />
                </tr>
              </thead>
              <tbody>
                {visibles.slice(0, limite).map(f => {
                  const c = candidatoDe(f);
                  const fa = factorDe(f, c);
                  const et = fa.fuente ? ETIQUETA_FUENTE[fa.fuente] : null;
                  const equiv = c && cantidadCanonica(f.cantidad, fa.factor);
                  const dec = f.decidido;
                  return (
                    <tr key={f.norm}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{f.muestra}</div>
                        <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                          {f.veces} {f.veces === 1 ? 'línea' : 'líneas'} · {f.provs.size} {f.provs.size === 1 ? 'proveedor' : 'proveedores'}
                          {f.sug.familia !== 'otro' && <> · {f.sug.familia.replace(/_/g, ' ')}</>}
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cant(f.cantidad)} {[...f.unidades][0] || ''}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{soles(f.importe)}</td>

                      {dec ? (
                        <>
                          <td colSpan={2}>
                            {dec.fila.decision === 'no_aplica'
                              ? <span className="badge b-gray" style={{ fontSize: 9 }}>fuera del presupuesto</span>
                              : <>
                                  <span className="badge b-green" style={{ fontSize: 9 }}>✓ mapeado</span>{' '}
                                  {catalogo.items.find(i => i.codigo === dec.fila.insumo_codigo)?.nombre || dec.fila.insumo_codigo}
                                  {dec.fila.factor != null && <span style={{ color: 'var(--tm)' }}> · ×{dec.fila.factor} {dec.fila.unidad_destino || ''}</span>}
                                </>}
                            {dec.heredado && (
                              <div style={{ fontSize: 10, color: 'var(--tm)' }} title="Viene de una correlación que ya confirmaste en la pestaña 🤝">
                                heredado de un nombre correlacionado
                              </div>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {!dec.heredado && <button className="btn btn-ghost btn-xs" onClick={() => reabrir(f)}>↺ Cambiar</button>}
                          </td>
                        </>
                      ) : f.estado === 'servicio' ? (
                        <>
                          <td colSpan={2} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>
                            Es un servicio — no consume insumos del presupuesto.
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-ghost btn-xs" onClick={() => noAplica(f)}>Confirmar</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td>
                            <SearchableSelect
                              value={elegido[f.norm] || c?.cat.codigo || ''}
                              onChange={v => setElegido(p => ({ ...p, [f.norm]: v }))}
                              options={opcionesCatalogo}
                              placeholder={f.sug.candidatos.length ? '— Elegí otro —' : '— Buscá el insumo —'}
                              fontSize={11}
                            />
                            {c && (
                              <div style={{ fontSize: 10, color: 'var(--tm)', marginTop: 3 }}>
                                {c.score != null && <span className={`badge ${f.estado === 'propuesto' ? 'b-blue' : 'b-amber'}`} style={{ fontSize: 9, marginRight: 4 }}>{Math.round(c.score * 100)}%</span>}
                                {c.motivos.join(' · ')}
                                {f.sug.ambiguo && <> · <span style={{ color: 'var(--amber)' }}>hay otro parecido, mirá bien</span></>}
                              </div>
                            )}
                          </td>
                          <td>
                            {c ? (
                              <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 10, color: 'var(--tm)' }}>×</span>
                                  <input className="fi" style={{ width: 78, fontSize: 11, padding: '3px 5px' }}
                                    inputMode="decimal"
                                    value={factorEdit[f.norm] ?? (fa.factor ?? '')}
                                    placeholder="?"
                                    onChange={e => setFactorEdit(p => ({ ...p, [f.norm]: e.target.value }))} />
                                  <span style={{ fontSize: 10 }}>{c.cat.unidad}</span>
                                </div>
                                {et && <span className={`badge ${et.color}`} style={{ fontSize: 9 }} title={et.ayuda}>{et.txt}</span>}
                                {c.factor?.nota && <div style={{ fontSize: 9.5, color: 'var(--tm)' }}>{c.factor.nota}</div>}
                                {equiv != null && <div style={{ fontSize: 10, color: 'var(--ts)' }}>= {cant(equiv)} {c.cat.unidad}</div>}
                              </>
                            ) : <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>—</span>}
                          </td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button className="btn btn-green btn-xs" disabled={!c} onClick={() => aceptar(f)}>✓ Es este</button>{' '}
                            <button className="btn btn-ghost btn-xs" onClick={() => noAplica(f)} title="No está en el presupuesto de esta obra">✗ No está</button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
                {visibles.length === 0 && (
                  <tr><td colSpan={6} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>
                    {filtro === 'pendientes' ? 'No queda nada por decidir en este filtro.' : 'Sin descripciones en este filtro.'}
                  </td></tr>
                )}
              </tbody>
            </table>
            {visibles.length > limite && (
              <div style={{ padding: 10, textAlign: 'center' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setLimite(l => l + 60)}>
                  Ver más ({visibles.length - limite} restantes) <JxIcon name="chevD" size={12} />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

Object.assign(window, { MapeoInsumosTab });
export { MapeoInsumosTab };
