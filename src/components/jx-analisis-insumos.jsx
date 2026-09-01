// ═══════════════════════════════════════════════════════════════════
// JARVEX — Análisis de Insumos (mejora 1, sep-2026). Panel de ADMIN/GERENTE.
//
// Dos pestañas:
//  · 🔍 Comparador: buscá un insumo → sus variantes de nombre (según las
//    correlaciones confirmadas), qué proveedor vendió cada una, a qué precio
//    (último/mín/máx), el más barato comparable y el gráfico de evolución.
//    Todo sale RETROACTIVO de las facturas ya registradas (items_factura).
//  · 🤝 Correlaciones: el sistema PROPONE pares de nombres que parecen el
//    mismo insumo; acá se confirma ("mismo") o se rechaza ("distintos") y la
//    decisión queda grabada en insumo_correlaciones (sincronizada) para NO
//    volver a preguntar — pedido explícito de Gabriel. Captura Mágica no se
//    toca: esto es una capa de análisis posterior.
//
// Visibilidad: gate duro admin/gerente (la vista muestra COSTOS por proveedor;
// la regla de la casa es que almacén/campo no ven costos).
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { useChart } from "../lib/chart-loader.js";
import {
  resolverPares, construirGrupos, sugerirPares, normInsumo,
} from "../lib/insumo-correlacion.js";
import {
  extraerComprasDeFacturas, agruparComprasPorInsumo, proveedorMasBarato, seriePrecios,
} from "../lib/analisis-insumos.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const fmtPrecio = (n, moneda) =>
  `${moneda === 'USD' ? 'US$' : 'S/'} ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const COLORES = ['#3aa3ff', '#f5b428', '#2ecc71', '#e74c3c', '#9b59b6', '#1abc9c', '#e67e22'];

function GraficoPrecios({ serie }) {
  const Chart = useChart();
  const canvasRef = uR(null);
  const chartRef = uR(null);
  const monedas = [...new Set(serie.map(s => s.moneda))];
  uE(() => {
    if (!Chart || !canvasRef.current) return;
    const provs = [...new Set(serie.map(s => s.proveedorNombre))];
    const fechas = [...new Set(serie.map(s => s.fecha))].sort();
    const variasMonedas = monedas.length > 1;
    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: fechas,
        datasets: provs.map((p, i) => {
          const monedaProv = [...new Set(serie.filter(s => s.proveedorNombre === p).map(s => s.moneda))].join('/');
          return {
            label: variasMonedas ? `${p} (${monedaProv})` : p,
            data: fechas.map(f => {
              const hits = serie.filter(s => s.proveedorNombre === p && s.fecha === f);
              return hits.length ? hits[hits.length - 1].precio : null;
            }),
            borderColor: COLORES[i % COLORES.length],
            backgroundColor: COLORES[i % COLORES.length],
            tension: 0.2, spanGaps: true, pointRadius: 3,
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { boxWidth: 10, font: { size: 10 } } } },
        scales: { y: { ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 9 } } } },
      },
    });
    return () => { try { chartRef.current?.destroy(); } catch {} };
  }, [Chart, serie]);
  if (!Chart) return <div style={{ color: 'var(--tm)', fontSize: 11 }}>Cargando gráfico…</div>;
  return (
    <>
      {monedas.length > 1 && (
        <div style={{ fontSize: 10.5, color: 'var(--amber)', marginBottom: 4 }}>
          ⚠ Monedas mixtas ({monedas.join(', ')}): las líneas comparten eje pero NO son comparables entre sí.
        </div>
      )}
      <div style={{ height: 220 }}><canvas ref={canvasRef} /></div>
    </>
  );
}

function AnalisisInsumosPage({ showToast }) {
  const rol = (typeof window !== 'undefined' && window.__currentRol) || null;
  const movsHook = window.__hooks.useAccountingMovements();
  const corrHook = window.__hooks.useInsumoCorrelaciones();
  const [tab, setTab] = uS('comparador');
  const [busca, setBusca] = uS('');
  const [sel, setSel] = uS(null);
  // Anti doble-click (regla crítica 2): ref SÍNCRONO — un doble tap en "Mismo
  // insumo" no debe crear el par dos veces.
  const decidiendoRef = uR(false);

  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  const compras = uM(() => extraerComprasDeFacturas(movsHook.data || [], { demo: esPrueba }), [movsHook.data, esPrueba]);
  // El hook ya separa demo/real por modo; resolverPares espeja ese criterio.
  const resueltos = uM(() => resolverPares(corrHook.data || [], { demo: esPrueba }), [corrHook.data, esPrueba]);
  const { grupoDe, grupos } = uM(() => construirGrupos(resueltos), [resueltos]);
  const porInsumo = uM(() => agruparComprasPorInsumo(compras, grupoDe, grupos), [compras, grupoDe, grupos]);
  const sugerencias = uM(
    () => sugerirPares(compras.map(c => c.nombre), resueltos, grupoDe),
    [compras, resueltos, grupoDe]
  );
  const decisiones = uM(
    () => [...resueltos.values()].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 100),
    [resueltos]
  );
  const listaInsumos = uM(() => {
    const toks = normInsumo(busca).split(' ').filter(Boolean);
    return [...porInsumo.values()]
      .filter(ins => !toks.length || toks.every(t =>
        normInsumo(ins.display).includes(t) || ins.variantes.some(v => normInsumo(v).includes(t))))
      .sort((a, b) => b.compras.length - a.compras.length)
      .slice(0, 40);
  }, [porInsumo, busca]);
  // Muestra de contexto para cada nombre de una sugerencia (dónde se vio).
  const muestraDe = uM(() => {
    const m = new Map();
    for (const c of compras) if (!m.has(c.nombreNorm)) m.set(c.nombreNorm, c);
    return m;
  }, [compras]);
  // Serie del gráfico memoizada (identidad estable: sin ella, cada re-render
  // del padre destruía y recreaba el Chart completo). ANTES del early return
  // del gate — regla de hooks.
  const serieSel = uM(() => {
    const ins = sel ? porInsumo.get(sel) : null;
    return ins ? seriePrecios(ins) : [];
  }, [sel, porInsumo]);

  if (rol !== 'admin' && rol !== 'gerente') {
    return <div className="card card-p" style={{ color: 'var(--tm)' }}>Panel exclusivo de administración y gerencia (muestra costos por proveedor).</div>;
  }

  const decidir = async (par, relacion) => {
    if (decidiendoRef.current) return;
    decidiendoRef.current = true;
    try {
      // Contradicción: unir dos nombres cuyos grupos tienen un "distinto"
      // vigente entre medio pisaría esa decisión por transitividad — avisar.
      if (relacion === 'mismo') {
        const gA = grupoDe.get(par.nombre_a) || par.nombre_a;
        const gB = grupoDe.get(par.nombre_b) || par.nombre_b;
        const contradice = [...resueltos.values()].some(f =>
          f.relacion === 'distinto' && (() => {
            const ga = grupoDe.get(normInsumo(f.nombre_a)) || normInsumo(f.nombre_a);
            const gb = grupoDe.get(normInsumo(f.nombre_b)) || normInsumo(f.nombre_b);
            return (ga === gA && gb === gB) || (ga === gB && gb === gA);
          })());
        if (contradice && !confirm('Ojo: una decisión anterior dice que estos grupos son DISTINTOS. ¿Unirlos igual?')) {
          decidiendoRef.current = false;
          return;
        }
      }
      // Canónico con el nombre CRUDO de la factura (los normalizados en
      // minúsculas quedarían feos como display permanente del grupo).
      const crudoA = muestraDe.get(par.nombre_a)?.nombre || par.nombre_a;
      const crudoB = muestraDe.get(par.nombre_b)?.nombre || par.nombre_b;
      const canonico = relacion === 'mismo'
        ? (crudoA.length >= crudoB.length ? crudoA : crudoB)
        : null;
      await corrHook.create({
        id: window.__newId(),
        nombre_a: par.nombre_a, nombre_b: par.nombre_b,
        relacion, canonico, fuente: 'manual', deleted_at: null,
      });
      showToast?.(relacion === 'mismo'
        ? '✓ Correlacionados — no se volverá a preguntar por este par'
        : '✓ Marcados como distintos — no se volverá a preguntar', 'green');
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); }
    finally { decidiendoRef.current = false; }
  };

  const cambiarDecision = async (fila) => {
    if (decidiendoRef.current) return;
    decidiendoRef.current = true;
    try {
      const nueva = fila.relacion === 'mismo' ? 'distinto' : 'mismo';
      await corrHook.update(fila.id, { relacion: nueva, fuente: 'manual' });
      showToast?.(`Cambiado a "${nueva === 'mismo' ? 'mismo insumo' : 'distintos'}"`, 'green');
    } catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); }
    finally { decidiendoRef.current = false; }
  };

  const insumoSel = sel ? porInsumo.get(sel) : null;
  const masBarato = insumoSel ? proveedorMasBarato(insumoSel) : null;

  return (
    // page-wrap = el contenedor con scroll de toda página (mismo fix que el
    // portal de campo: sin él la página no deslizaba).
    <div className="page-wrap">
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className={`btn btn-sm ${tab === 'comparador' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('comparador')}>🔍 Comparador de precios</button>
        <button className={`btn btn-sm ${tab === 'correlaciones' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('correlaciones')}>
          🤝 Correlaciones{sugerencias.length ? <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>{sugerencias.length}</span> : null}
        </button>
      </div>

      {tab === 'comparador' && (
        <>
          <div className="card card-p">
            <input className="fi" placeholder="Buscar insumo comprado (sin tildes, cualquier orden de palabras)…"
              value={busca} onChange={e => { setBusca(e.target.value); setSel(null); }} />
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6 }}>
              {porInsumo.size} insumos distintos detectados en las facturas · las variantes confirmadas en 🤝 Correlaciones se cuentan como UN insumo.
            </div>
          </div>
          {!insumoSel && (
            <div className="card" style={{ overflow: 'auto' }}>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead><tr><th>Insumo</th><th style={{ textAlign: 'right' }}>Compras</th><th style={{ textAlign: 'right' }}>Proveedores</th><th style={{ textAlign: 'right' }}>Último precio</th></tr></thead>
                <tbody>
                  {listaInsumos.map(ins => {
                    const ult = ins.compras[ins.compras.length - 1];
                    return (
                      <tr key={ins.clave} style={{ cursor: 'pointer' }} onClick={() => setSel(ins.clave)}>
                        <td>{ins.display}{ins.variantes.length > 1 && <span className="badge b-blue" style={{ marginLeft: 6, fontSize: 9 }}>{ins.variantes.length} variantes</span>}</td>
                        <td style={{ textAlign: 'right' }}>{ins.compras.length}</td>
                        <td style={{ textAlign: 'right' }}>{ins.porProveedor.size}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{ult ? fmtPrecio(ult.precio, ult.moneda) : '—'}</td>
                      </tr>
                    );
                  })}
                  {listaInsumos.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin coincidencias en las facturas registradas.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {insumoSel && (
            <>
              <div className="card card-p">
                <div className="frow-sb">
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{insumoSel.display}</div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)}><JxIcon name="chevL" size={12} /> Volver</button>
                </div>
                {insumoSel.variantes.length > 1 && (
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                    {insumoSel.variantes.map(v => <span key={v} className="badge b-blue" style={{ fontSize: 10 }}>{v}</span>)}
                  </div>
                )}
                {masBarato && (
                  <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 6, background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.3)', fontSize: 12 }}>
                    💰 Más barato (último precio comparable): <strong>{masBarato.proveedorNombre}</strong> a <strong>{fmtPrecio(masBarato.ultimoPrecio, [...masBarato.monedas][0])}</strong>
                  </div>
                )}
                {!masBarato && insumoSel.porProveedor.size > 1 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--tm)' }}>
                    ⚠ No se declara "más barato": hay monedas o unidades distintas entre proveedores — compará a ojo con la tabla.
                  </div>
                )}
              </div>
              <div className="card" style={{ overflow: 'auto' }}>
                <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Por proveedor</div>
                <table className="tbl" style={{ fontSize: 12 }}>
                  <thead><tr><th>Proveedor</th><th style={{ textAlign: 'right' }}>Veces</th><th style={{ textAlign: 'right' }}>Último precio</th><th style={{ textAlign: 'right' }}>Mín</th><th style={{ textAlign: 'right' }}>Máx</th><th>Unidad</th></tr></thead>
                  <tbody>
                    {[...insumoSel.porProveedor.values()].sort((a, b) => (a.ultimoPrecio ?? 1e12) - (b.ultimoPrecio ?? 1e12)).map(pv => (
                      <tr key={pv.proveedorId || pv.proveedorNombre}>
                        <td>{pv.proveedorNombre}</td>
                        <td style={{ textAlign: 'right' }}>{pv.veces}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtPrecio(pv.ultimoPrecio, [...pv.monedas][0])} <span style={{ color: 'var(--tm)', fontWeight: 400, fontSize: 10 }}>({pv.ultimaFecha})</span></td>
                        <td style={{ textAlign: 'right' }}>{fmtPrecio(pv.minPrecio, [...pv.monedas][0])}</td>
                        <td style={{ textAlign: 'right' }}>{fmtPrecio(pv.maxPrecio, [...pv.monedas][0])}</td>
                        <td>{[...pv.unidades].join(', ')}{pv.monedas.size > 1 ? ' · ⚠ monedas mixtas' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card card-p">
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Evolución del precio</div>
                <GraficoPrecios serie={serieSel} />
              </div>
              <div className="card" style={{ overflow: 'auto' }}>
                <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600 }}>Compras registradas ({insumoSel.compras.length})</div>
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead><tr><th>Fecha</th><th>Comprobante</th><th>Proveedor</th><th>Nombre en la factura</th><th style={{ textAlign: 'right' }}>Cant.</th><th style={{ textAlign: 'right' }}>Precio unit.</th></tr></thead>
                  <tbody>
                    {[...insumoSel.compras].reverse().map((c, i) => (
                      <tr key={`${c.movId}_${i}`}>
                        <td>{c.fecha}</td><td style={{ fontFamily: 'monospace' }}>{c.doc}</td><td>{c.proveedorNombre}</td>
                        <td style={{ color: 'var(--tm)' }}>{c.nombre}</td>
                        <td style={{ textAlign: 'right' }}>{c.cantidad} {c.unidad}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtPrecio(c.precio, c.moneda)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'correlaciones' && (
        <>
          <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6 }}>
            El sistema propone nombres que PARECEN el mismo insumo facturado distinto por cada proveedor.
            Tu decisión queda grabada y <strong>no se vuelve a preguntar</strong>: "mismo" los une en el comparador; "distintos" descarta la sugerencia para siempre.
          </div>
          <div className="card card-p">
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Sugerencias pendientes ({sugerencias.length})</div>
            {sugerencias.length === 0 && <div style={{ color: 'var(--tm)', fontStyle: 'italic', fontSize: 12 }}>No hay pares nuevos para revisar — al registrar más facturas aparecerán acá.</div>}
            <div style={{ display: 'grid', gap: 8 }}>
              {sugerencias.map(par => {
                const ma = muestraDe.get(par.nombre_a), mb = muestraDe.get(par.nombre_b);
                return (
                  <div key={`${par.nombre_a}|${par.nombre_b}`} style={{ padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
                      <strong>{ma?.nombre || par.nombre_a}</strong>
                      <span style={{ color: 'var(--tm)' }}>≈</span>
                      <strong>{mb?.nombre || par.nombre_b}</strong>
                      <span className="badge b-gray" style={{ fontSize: 9 }}>{Math.round(par.score * 100)}% parecido</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
                      {ma && <>«{ma.nombre}» visto en {ma.doc} · {ma.proveedorNombre} · {fmtPrecio(ma.precio, ma.moneda)}. </>}
                      {mb && <>«{mb.nombre}» visto en {mb.doc} · {mb.proveedorNombre} · {fmtPrecio(mb.precio, mb.moneda)}.</>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button className="btn btn-green btn-xs" onClick={() => decidir(par, 'mismo')}>✓ Mismo insumo</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => decidir(par, 'distinto')}>✗ Son distintos</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="card card-p">
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Decisiones tomadas ({decisiones.length})</div>
            {decisiones.length === 0 && <div style={{ color: 'var(--tm)', fontStyle: 'italic', fontSize: 12 }}>Todavía no confirmaste ninguna correlación.</div>}
            <div style={{ display: 'grid', gap: 5, maxHeight: 340, overflow: 'auto' }}>
              {decisiones.map(f => (
                <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5, padding: '5px 8px', background: 'var(--tint-neutral)', borderRadius: 5 }}>
                  <span className={`badge ${f.relacion === 'mismo' ? 'b-green' : 'b-red'}`} style={{ fontSize: 9 }}>{f.relacion === 'mismo' ? '= mismo' : '≠ distintos'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{f.nombre_a} <span style={{ color: 'var(--tm)' }}>↔</span> {f.nombre_b}</span>
                  <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }} title="Corregir: invierte la decisión" onClick={() => cambiarDecision(f)}>↺ Cambiar</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
    </div>
  );
}

Object.assign(window, { AnalisisInsumosPage });
export { AnalisisInsumosPage };
