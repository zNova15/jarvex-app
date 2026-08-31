// ═══════════════════════════════════════════════════════════════════
// JARVEX — Detalle de UNA empresa (punto 5 del pedido de las contadoras, sep-2026).
//
// Se abre desde la tabla de Empresas con "Ver detalle" y vive DENTRO de esa
// página (import estático, mismo chunk: no es una página registrada, no toca
// main/sidebar/admin y no viola la regla anti-import-dinámico).
//
// Responde dos preguntas que hasta hoy no tenían dónde mirarse:
//   1) ¿Cómo le fue a ESTA empresa? — KPIs con el criterio EXACTO del
//      Consolidado (una moneda por vez, sin anulados, con lo interco separado).
//   2) ¿QUÉ compró? — el detalle de las facturas (notas.items_factura) agrupado
//      por insumo: cantidades, gasto, proveedores, última compra y, si además
//      revende, cuánto de eso volvió a salir vendido.
//
// ⚠ Es inventario COMPRADO, NO stock: los consumos de obra viven en almacén por
//   obra. La UI lo dice explícitamente para no crear una expectativa falsa.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { extraerLineasDeFacturas } from "../lib/analisis-insumos.js";
import { resolverPares, construirGrupos } from "../lib/insumo-correlacion.js";
import { inventarioDeEmpresa, resumenFinancieroEmpresa, filtrarInventario } from "../lib/inventario-empresa.js";

const { useState: uSD, useMemo: uMD } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const fmtMonto = (n, moneda = 'PEN') =>
  `${moneda === 'USD' ? 'USD ' : 'S/ '}${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCant = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const fmtFecha = (f) => (f ? String(f).split('-').reverse().join('/') : '—');

const TIPO_BADGE = {
  material: 'b-blue', servicio: 'b-gray', epp: 'b-green',
  herramienta: 'b-amber', maquinaria: 'b-red',
};

const PASO_LISTA = 50;   // insumos por tanda (GASOMI tiene cientos)

function EmpresaDetalle({ company, obrasEjecutora = [], onVolver }) {
  // ── Hooks: TODOS antes de cualquier return (regla crítica 3) ──────
  const movsHook = window.__hooks.useAccountingMovements(company?.id);
  const corrHook = window.__hooks.useInsumoCorrelaciones();
  const [moneda, setMoneda] = uSD('PEN');
  const [vista, setVista] = uSD('acumulado');    // 'acumulado' | 'externo'
  const [busca, setBusca] = uSD('');
  const [tipoFiltro, setTipoFiltro] = uSD('');
  const [abierto, setAbierto] = uSD(null);       // clave del insumo expandido
  const [tope, setTope] = uSD(PASO_LISTA);

  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  const movs = movsHook.data || [];

  const resumen = uMD(
    () => resumenFinancieroEmpresa(movs, { companyId: company?.id, moneda, demo: esPrueba }),
    [movs, company?.id, moneda, esPrueba]
  );
  const lineas = uMD(() => extraerLineasDeFacturas(movs, { demo: esPrueba }), [movs, esPrueba]);
  const resueltos = uMD(() => resolverPares(corrHook.data || [], { demo: esPrueba }), [corrHook.data, esPrueba]);
  const { grupoDe, grupos } = uMD(() => construirGrupos(resueltos), [resueltos]);
  const inv = uMD(
    () => inventarioDeEmpresa(lineas, { companyId: company?.id, grupoDe, grupos }),
    [lineas, company?.id, grupoDe, grupos]
  );
  const tiposPresentes = uMD(() => {
    const s = new Set();
    inv.insumos.forEach(i => i.tipos.forEach(t => s.add(t)));
    return [...s].sort();
  }, [inv]);
  const filtrados = uMD(() => {
    const porTexto = filtrarInventario(inv.insumos, busca);
    return tipoFiltro ? porTexto.filter(i => i.tipos.includes(tipoFiltro)) : porTexto;
  }, [inv, busca, tipoFiltro]);

  if (!company) return null;

  const k = vista === 'externo' ? resumen.externo : resumen.total;
  const hayInterco = resumen.interco.ingresos > 0 || resumen.interco.costos > 0;

  return (
    <div className="page-wrap">
      {/* ── Cabecera ─────────────────────────────────────────────── */}
      <div className="pg-hd frow-sb">
        <div style={{ minWidth: 0 }}>
          <button className="btn btn-ghost btn-sm" onClick={onVolver} style={{ marginBottom: 6 }}>
            <JxIcon name="chevL" size={13} />Volver a Empresas
          </button>
          <div className="pg-title" style={{ wordBreak: 'break-word' }}>{company.name}</div>
          <div className="pg-sub">
            {company.ruc ? `RUC ${company.ruc}` : 'sin RUC'}
            {company.legal_name ? ` · ${company.legal_name}` : ''}
            {company.regimen_tributario ? ` · ${company.regimen_tributario}` : ''}
          </div>
          {obrasEjecutora.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 4 }}>
              ✓ Ejecutora en: {obrasEjecutora.map(o => o.nombre).join(' · ')}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select className="fi" value={moneda} onChange={e => setMoneda(e.target.value)} style={{ minWidth: 100 }}>
            <option value="PEN">S/ (PEN)</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </div>

      {/* ── Resumen financiero (criterio del Consolidado) ─────────── */}
      <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--bg-s)', borderRadius: 8, marginBottom: 12, width: 'fit-content', flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${vista === 'acumulado' ? 'btn-amber' : 'btn-ghost'}`} style={{ border: 'none' }} onClick={() => setVista('acumulado')}>
          Todo lo facturado
        </button>
        <button className={`btn btn-sm ${vista === 'externo' ? 'btn-amber' : 'btn-ghost'}`} style={{ border: 'none' }} onClick={() => setVista('externo')}>
          Solo con terceros (sin interco)
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
        {[
          { t: 'Ingresos', v: fmtMonto(k.ingresos, moneda), c: 'var(--green)' },
          { t: 'Costos', v: fmtMonto(k.costos, moneda), c: 'var(--red)' },
          { t: 'Gastos', v: fmtMonto(k.gastos, moneda), c: 'var(--amber)' },
          { t: 'Utilidad', v: fmtMonto(k.utilidad, moneda), c: k.utilidad >= 0 ? 'var(--blue)' : 'var(--red)' },
          { t: 'Margen', v: `${k.margen.toFixed(1)}%`, c: k.margen >= 0 ? 'var(--green)' : 'var(--red)' },
        ].map(x => (
          <div key={x.t} className="card card-p" style={{ borderLeft: `3px solid ${x.c}` }}>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', textTransform: 'uppercase' }}>{x.t}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: x.c, marginTop: 3 }}>{x.v}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 16, display: 'grid', gap: 3 }}>
        {/* Puente con la tabla madre: Empresas muestra una sola columna
            "Egresos" (= costos + gastos, renombrada en el punto 4b). Acá se
            desglosa en dos, así que se explicita la suma para que los dos
            números reconcilien a la vista y nadie crea que falta plata. */}
        <div>
          Egresos = costos + gastos = <strong>{fmtMonto(k.costos + k.gastos, moneda)}</strong>
          {' '}(es la columna «Egresos» de la tabla de Empresas) · Utilidad = ingresos − egresos.
        </div>
        <div>
          {resumen.nMovs} movimiento{resumen.nMovs !== 1 ? 's' : ''} en {moneda === 'USD' ? 'USD' : 'S/'}
          {resumen.cancelados > 0 ? ` · ${resumen.cancelados} anulado(s) fuera del cálculo` : ''}
          {resumen.notas > 0 ? ` · ${resumen.notas} nota(s) de crédito/débito` : ''}
          {resumen.otrasMonedas.map(o => ` · ${o.movs} en ${o.moneda} (cambiá la moneda para verlos)`).join('')}
        </div>
        {hayInterco && (
          <div>
            Entre empresas del grupo: {fmtMonto(resumen.interco.ingresos, moneda)} facturado
            {' '}y {fmtMonto(resumen.interco.costos, moneda)} comprado — la vista
            {' '}<strong>solo con terceros</strong> los saca (es el mismo criterio del Consolidado).
          </div>
        )}
      </div>

      {/* ── Inventario comprado ──────────────────────────────────── */}
      <div className="card card-p" style={{ marginBottom: 10, borderLeft: '3px solid var(--blue)', fontSize: 11.5, color: 'var(--ts)' }}>
        <strong style={{ color: 'var(--blue)' }}>Qué compró esta empresa</strong> — sale del detalle de las
        facturas cargadas por Captura Mágica. Es lo <strong>comprado</strong>, no el stock: los consumos y las
        salidas se llevan en Almacén por obra.
        {resumen.sinItems > 0 && (
          <> Hay <strong>{resumen.sinItems} factura(s) en {moneda === 'USD' ? 'USD' : 'S/'} sin detalle de ítems</strong> (registradas a mano): su monto está en los KPIs pero no en esta tabla.</>
        )}
        {inv.totales.lineasNota > 0 && <> {inv.totales.lineasNota} línea(s) de nota de crédito/débito quedan fuera de las cantidades.</>}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 10, borderBottom: '1px solid var(--border)' }}>
          <input
            className="fi" style={{ flex: 1, minWidth: 180 }}
            placeholder="Buscar insumo (sin tildes, busca también las variantes de nombre)"
            value={busca} onChange={e => { setBusca(e.target.value); setTope(PASO_LISTA); }} />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button className={`btn btn-xs ${tipoFiltro === '' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTipoFiltro('')}>Todos</button>
            {tiposPresentes.map(t => (
              <button key={t} className={`btn btn-xs ${tipoFiltro === t ? 'btn-amber' : 'btn-ghost'}`} onClick={() => { setTipoFiltro(t); setTope(PASO_LISTA); }}>{t}</button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--tm)' }}>{filtrados.length} insumo(s)</span>
        </div>

        {filtrados.length === 0 ? (
          <div className="card-p" style={{ color: 'var(--tm)', fontSize: 12, fontStyle: 'italic' }}>
            {inv.insumos.length === 0
              ? 'Esta empresa todavía no tiene facturas con detalle de ítems.'
              : 'Ningún insumo coincide con la búsqueda.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Insumo</th>
                <th style={{ textAlign: 'right' }}>Comprado</th>
                <th style={{ textAlign: 'right' }}>Gasto</th>
                <th style={{ textAlign: 'right' }}>Vendido</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th>Última compra</th>
                <th style={{ textAlign: 'center' }}>Facturas</th>
              </tr></thead>
              <tbody>
                {filtrados.slice(0, tope).map(ins => {
                  const abiertoEste = abierto === ins.clave;
                  return (
                    <React.Fragment key={ins.clave}>
                      <tr>
                        <td className="col-p">
                          <strong>{ins.display}</strong>
                          <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            {ins.tipos.map(t => (
                              <span key={t} className={`badge ${TIPO_BADGE[t] || 'b-gray'}`} style={{ fontSize: 9 }}>{t}</span>
                            ))}
                            {ins.variantes.length > 1 && (
                              <span style={{ fontSize: 10, color: 'var(--tm)' }} title={ins.variantes.join('\n')}>
                                {ins.variantes.length} variantes de nombre
                              </span>
                            )}
                            {ins.recepcion.conDato > 0 && (
                              <span className="badge b-green" style={{ fontSize: 9 }} title="Almacén confirmó recepción de estas líneas">
                                ✓ {fmtCant(ins.recepcion.recibido)} recibido
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {/* Un insumo puede aparecer SOLO vendido (lo facturó sin
                              tener la compra cargada acá): mostrar "0 compras"
                              confundiría — va un guión. */}
                          {ins.comprado.veces === 0 ? <span style={{ color: 'var(--tm)' }}>—</span> : (<>
                            {ins.comprado.cantidades.map(c => (
                              <div key={c.unidad}>{fmtCant(c.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{c.label}</span></div>
                            ))}
                            <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                              {ins.comprado.veces} compra{ins.comprado.veces !== 1 ? 's' : ''}
                              {ins.comprado.interco > 0 ? ` · ${ins.comprado.interco} interco` : ''}
                            </div>
                          </>)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.comprado.montos.length === 0
                            ? <span style={{ color: 'var(--tm)' }}>—</span>
                            : ins.comprado.montos.map(m => <div key={m.moneda}>{fmtMonto(m.monto, m.moneda)}</div>)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.vendido.veces === 0
                            ? <span style={{ color: 'var(--tm)' }}>—</span>
                            : (<>
                              {ins.vendido.cantidades.map(c => (
                                <div key={c.unidad}>{fmtCant(c.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{c.label}</span></div>
                              ))}
                              {ins.vendido.montos.map(m => (
                                <div key={m.moneda} style={{ fontSize: 10, color: 'var(--green)' }}>{fmtMonto(m.monto, m.moneda)}</div>
                              ))}
                            </>)}
                        </td>
                        <td style={{ textAlign: 'right' }} className="col-num">
                          {ins.saldo.length === 0
                            ? <span style={{ color: 'var(--tm)' }} title="Esta empresa no vendió este insumo: el saldo sería la columna Comprado repetida">—</span>
                            : ins.saldo.map(s => (
                              <div key={s.unidad} style={{ color: s.cantidad < 0 ? 'var(--red)' : 'var(--ts)' }}>
                                {fmtCant(s.cantidad)} <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{s.label}</span>
                              </div>
                            ))}
                        </td>
                        <td style={{ fontSize: 11.5 }}>
                          <div>{fmtFecha(ins.comprado.ultimaFecha)}</div>
                          {ins.comprado.ultimoPrecio != null && (
                            <div style={{ color: 'var(--tm)', fontSize: 10.5 }}>
                              {fmtMonto(ins.comprado.ultimoPrecio, ins.comprado.ultimaMoneda || 'PEN')} · {ins.comprado.ultimoProveedor || 's/ proveedor'}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => setAbierto(abiertoEste ? null : ins.clave)}>
                            {abiertoEste ? '▾' : '▸'} {ins.lineas.length}
                          </button>
                        </td>
                      </tr>
                      {abiertoEste && (
                        <tr>
                          <td colSpan={7} style={{ background: 'rgba(255,255,255,0.02)' }}>
                            <div style={{ display: 'grid', gap: 4, padding: '6px 2px' }}>
                              {ins.variantes.length > 1 && (
                                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                                  Nombres agrupados: {ins.variantes.join(' · ')}
                                </div>
                              )}
                              {ins.lineas.map(l => (
                                <div key={`${l.movId}-${l.itemIdx}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, padding: '4px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 5 }}>
                                  <span className={`badge ${l.clase === 'venta' ? 'b-green' : 'b-red'}`} style={{ fontSize: 9 }}>
                                    {l.clase === 'venta' ? 'venta' : 'compra'}
                                  </span>
                                  {l.interco && <span className="badge b-blue" style={{ fontSize: 9 }}>interco</span>}
                                  <span style={{ color: 'var(--tm)' }}>{fmtFecha(l.fecha)}</span>
                                  <span className="col-m">{l.doc || 's/n'}</span>
                                  <span style={{ flex: 1, minWidth: 120 }} title={l.nombre}>
                                    {l.proveedorNombre || '(sin nombre)'}
                                  </span>
                                  <span>{fmtCant(l.cantidad)} {l.unidad}</span>
                                  <span style={{ color: l.precio > 0 ? 'var(--ts)' : 'var(--tm)' }}>
                                    {l.precio > 0 ? `${fmtMonto(l.precio, l.moneda)} c/u` : 'sin precio'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtrados.length > tope && (
              <div style={{ padding: 10, textAlign: 'center' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setTope(tope + PASO_LISTA)}>
                  Mostrar {Math.min(PASO_LISTA, filtrados.length - tope)} más ({filtrados.length - tope} restantes)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { EmpresaDetalle });
export { EmpresaDetalle };
