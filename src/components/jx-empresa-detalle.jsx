// ═══════════════════════════════════════════════════════════════════
// JARVEX — Detalle de UNA empresa (punto 5 del pedido de las contadoras, sep-2026;
// entrega C de la tanda 2, docs/tanda-2-navegacion.md §4).
//
// Se abre desde la tabla de Empresas con "Ver detalle" y vive DENTRO de esa
// página (import estático, mismo chunk: no es una página registrada, no toca
// main/sidebar/admin y no viola la regla anti-import-dinámico).
//
// Cuatro pestañas, las que pide el documento:
//   1) CONTABILIDAD — KPIs con el criterio EXACTO del Consolidado (una moneda
//      por vez, sin anulados, con lo interco separado).
//   2) INVENTARIO — QUÉ compró: el detalle de las facturas (notas.items_factura)
//      agrupado por insumo: cantidades, gasto, proveedores, última compra y, si
//      además revende, cuánto de eso volvió a salir vendido.
//   3) PERSONAL — DERIVADO, no una columna nueva: `personal` no tiene
//      company_id (decisión de Gabriel, 3-sep-2026, ver
//      docs/tanda-2-navegacion.md §4) — es la gente de las obras que esta
//      empresa ejecuta o de las que es socia de consorcio, agrupada por forma
//      de pago (planilla / recibo por honorarios / sin definir).
//   4) TRABAJOS — obras (como ejecutora o socia) y bienes/servicios
//      (`trabajos.ejecutor_company_id` o vía `trabajos.consorcio_id`) que esta
//      empresa ejecuta o de los que es parte.
//
// ⚠ El inventario es lo COMPRADO, NO stock: los consumos de obra viven en
//   almacén por obra. La UI lo dice explícitamente para no crear una
//   expectativa falsa.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { extraerLineasDeFacturas } from "../lib/analisis-insumos.js";
import { resolverPares, construirGrupos } from "../lib/insumo-correlacion.js";
import { inventarioDeEmpresa, resumenFinancieroEmpresa, filtrarInventario } from "../lib/inventario-empresa.js";
import { sociosDeObra } from "../lib/consorcio.js";
import { TIPO_LBL as TRABAJO_TIPO_LBL, ESTADO_LBL as TRABAJO_ESTADO_LBL, ESTADO_BADGE as TRABAJO_ESTADO_BADGE, esAbierto as trabajoAbierto } from "../lib/trabajos.js";
import { TIPOS_TRABAJO, TIPO_TRABAJO_DEFAULT, normalizarEstadoObra, ESTADO_OBRA_LBL, ESTADO_OBRA_BADGE } from "../lib/tipos-trabajo.js";
import { categoriaDe, CATEGORIA_LABEL, CATEGORIA_BADGE } from "../lib/personal-categoria.js";
import { MODO_PAGO_LABEL } from "../lib/pagos.js";

const { useState: uSD, useMemo: uMD } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const fmtMonto = (n, moneda = 'PEN') =>
  `${moneda === 'USD' ? 'USD ' : 'S/ '}${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCant = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const fmtFecha = (f) => (f ? String(f).split('-').reverse().join('/') : '—');

// Ir al panel de un trabajo (obra) fijando la obra activa — mismo mecanismo
// que TrabajosPage.abrir()/entrarObra en jx-app.jsx, pero sin el gate de
// aislamiento por obra: Empresas es una pantalla cross-obra (admin/contador),
// y solo se listan acá obras donde la empresa YA participa.
const irAObra = (obraId) => {
  if (!obraId) return;
  try { window.__setObraActivaId?.(obraId); } catch {}
  window.__navTo?.('panel-obra');
};

const TIPO_BADGE = {
  material: 'b-blue', servicio: 'b-gray', epp: 'b-green',
  herramienta: 'b-amber', maquinaria: 'b-red',
};

const PASO_LISTA = 50;   // insumos por tanda (GASOMI tiene cientos)

function EmpresaDetalle({ company, obrasEjecutora = [], obras = [], consorcios = [], consorcioSocios = [], trabajosBS = [], onVolver }) {
  // ── Hooks: TODOS antes de cualquier return (regla crítica 3) ──────
  const movsHook = window.__hooks.useAccountingMovements(company?.id);
  const corrHook = window.__hooks.useInsumoCorrelaciones();
  const personalHook = window.__hooks.usePersonal?.() || { data: [] };
  const [moneda, setMoneda] = uSD('PEN');
  const [tab, setTab] = uSD('contabilidad');     // 'contabilidad' | 'inventario' | 'personal' | 'trabajos'
  const [vista, setVista] = uSD('acumulado');    // 'acumulado' | 'externo'
  const [busca, setBusca] = uSD('');
  const [tipoFiltro, setTipoFiltro] = uSD('');
  const [abierto, setAbierto] = uSD(null);       // clave del insumo expandido
  const [tope, setTope] = uSD(PASO_LISTA);
  const [modoPagoFiltro, setModoPagoFiltro] = uSD(''); // '' | 'planilla' | 'rxh' | 'otro'

  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  const movs = movsHook.data || [];

  // ── Personal (entrega C, bloque 3): DERIVADO, no personal.company_id ──
  // Los trabajos que la empresa ejecuta o de los que es socia (obrasEjecutora,
  // ya filtrado por rolesPorObra en EmpresasPage) dan el conjunto de obras;
  // el personal de esas obras ES el personal de esta empresa.
  const obraById = uMD(() => new Map((obras || []).map(o => [o.id, o])), [obras]);
  const obraIdsRelacionadas = uMD(() => new Set(obrasEjecutora.map(x => x.obra_id)), [obrasEjecutora]);
  const personalDeEmpresa = uMD(
    () => (personalHook.data || []).filter(p => !p.deleted_at && obraIdsRelacionadas.has(p.obra_id)),
    [personalHook.data, obraIdsRelacionadas]
  );
  const personalPorModo = uMD(() => {
    const grupos = { planilla: [], rxh: [], otro: [] };
    for (const p of personalDeEmpresa) {
      const modo = p.modo_pago === 'planilla' || p.modo_pago === 'rxh' ? p.modo_pago : 'otro';
      grupos[modo].push(p);
    }
    return grupos;
  }, [personalDeEmpresa]);
  const personalFiltrado = uMD(
    () => modoPagoFiltro ? personalPorModo[modoPagoFiltro] : personalDeEmpresa,
    [personalDeEmpresa, personalPorModo, modoPagoFiltro]
  );

  // ── Trabajos (entrega C, bloque 4): obras (ejecutora/socia) + bienes y
  // servicios (`trabajos.ejecutor_company_id` o vía `trabajos.consorcio_id`) ──
  const obrasDeEmpresa = uMD(() => {
    return obrasEjecutora
      .map(x => {
        const obra = obraById.get(x.obra_id);
        if (!obra || obra.deleted_at) return null;
        const socio = x.rol === 'miembro_consorcio'
          ? sociosDeObra(obra, consorcios, consorcioSocios).find(s => s.company_id === company?.id)
          : null;
        return { obra, rol: x.rol, pct: socio?.participacion_pct ?? null, lider: !!socio?.es_lider };
      })
      .filter(Boolean)
      .sort((a, b) => (b.rol === 'ejecutora') - (a.rol === 'ejecutora')
        || String(a.obra.nombre_obra || '').localeCompare(String(b.obra.nombre_obra || '')));
  }, [obrasEjecutora, obraById, consorcios, consorcioSocios, company?.id]);

  const trabajosBSDeEmpresa = uMD(() => (trabajosBS || []).filter(t => {
    if (t.deleted_at) return false;
    if (t.ejecutor_company_id === company?.id) return true;
    if (t.consorcio_id) return (consorcios || []).find(c => c.id === t.consorcio_id)?.company_id === company?.id;
    return false;
  }).sort((a, b) => trabajoAbierto(b.estado) - trabajoAbierto(a.estado)
    || String(a.nombre || '').localeCompare(String(b.nombre || ''))), [trabajosBS, consorcios, company?.id]);

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
        {tab === 'contabilidad' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select className="fi" value={moneda} onChange={e => setMoneda(e.target.value)} style={{ minWidth: 100 }}>
              <option value="PEN">S/ (PEN)</option>
              <option value="USD">USD</option>
            </select>
          </div>
        )}
      </div>

      {/* ── Las 4 secciones del documento (docs/tanda-2-navegacion.md §4) ── */}
      <div style={{ display: 'flex', gap: 6, padding: 4, background: 'var(--bg-s)', borderRadius: 8, marginBottom: 16, width: 'fit-content', flexWrap: 'wrap' }}>
        {[
          { v: 'contabilidad', label: 'Contabilidad' },
          { v: 'inventario', label: 'Inventario' },
          { v: 'personal', label: `Personal${personalDeEmpresa.length ? ` (${personalDeEmpresa.length})` : ''}` },
          { v: 'trabajos', label: `Trabajos${(obrasDeEmpresa.length + trabajosBSDeEmpresa.length) ? ` (${obrasDeEmpresa.length + trabajosBSDeEmpresa.length})` : ''}` },
        ].map(t => (
          <button key={t.v} className={`btn btn-sm ${tab === t.v ? 'btn-amber' : 'btn-ghost'}`} style={{ border: 'none' }} onClick={() => setTab(t.v)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'contabilidad' && (<>
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
      </>)}

      {tab === 'inventario' && (<>
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
                          <td colSpan={7} style={{ background: 'var(--tint-neutral)' }}>
                            <div style={{ display: 'grid', gap: 4, padding: '6px 2px' }}>
                              {ins.variantes.length > 1 && (
                                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                                  Nombres agrupados: {ins.variantes.join(' · ')}
                                </div>
                              )}
                              {ins.lineas.map(l => (
                                <div key={`${l.movId}-${l.itemIdx}`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, padding: '4px 6px', background: 'var(--tint-neutral)', borderRadius: 5 }}>
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
      </>)}

      {tab === 'personal' && (
        <div className="card card-p" style={{ borderLeft: '3px solid var(--purple)', fontSize: 11.5, color: 'var(--ts)', marginBottom: 10 }}>
          <strong style={{ color: 'var(--purple)' }}>Personal de esta empresa</strong> — se DERIVA, no es una
          columna nueva: es la gente designada en las obras que esta empresa ejecuta o de las que es socia de
          consorcio. Agrupado por forma de pago (definida en Pagos), no por cargo.
        </div>
      )}
      {tab === 'personal' && (
        obraIdsRelacionadas.size === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="users" size={40} color="var(--tm)" />
            <p>Esta empresa no ejecuta ni es socia de ningún trabajo: no tiene personal para mostrar.</p>
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 10, borderBottom: '1px solid var(--border)' }}>
              <button className={`btn btn-xs ${modoPagoFiltro === '' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModoPagoFiltro('')}>
                Todos ({personalDeEmpresa.length})
              </button>
              <button className={`btn btn-xs ${modoPagoFiltro === 'planilla' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModoPagoFiltro('planilla')}>
                Planilla ({personalPorModo.planilla.length})
              </button>
              <button className={`btn btn-xs ${modoPagoFiltro === 'rxh' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModoPagoFiltro('rxh')}>
                Recibo por honorarios ({personalPorModo.rxh.length})
              </button>
              <button className={`btn btn-xs ${modoPagoFiltro === 'otro' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setModoPagoFiltro('otro')}>
                Sin definir / libre ({personalPorModo.otro.length})
              </button>
            </div>
            {personalFiltrado.length === 0 ? (
              <div className="card-p" style={{ color: 'var(--tm)', fontSize: 12, fontStyle: 'italic' }}>
                Nadie en este grupo todavía.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr>
                    <th>Nombre</th><th>Cargo</th><th>Categoría</th><th>Obra</th><th>Forma de pago</th><th>Estado</th>
                  </tr></thead>
                  <tbody>
                    {personalFiltrado.map(p => {
                      const { categoria } = categoriaDe(p, null);
                      const obra = obraById.get(p.obra_id);
                      return (
                        <tr key={p.id}>
                          <td className="col-p"><strong>{`${p.nombres || ''} ${p.apellidos || ''}`.trim() || '(sin nombre)'}</strong></td>
                          <td>{p.cargo || '—'}</td>
                          <td><span className={`badge ${CATEGORIA_BADGE[categoria]}`} style={{ fontSize: 9 }}>{CATEGORIA_LABEL[categoria]}</span></td>
                          <td>
                            {obra ? (
                              <button className="btn btn-ghost btn-xs" onClick={() => irAObra(obra.id)} title="Ir al panel de este trabajo">
                                {obra.nombre_obra || '(sin nombre)'}
                              </button>
                            ) : '—'}
                          </td>
                          <td>{p.modo_pago ? <span className="badge b-gray" style={{ fontSize: 9 }}>{MODO_PAGO_LABEL[p.modo_pago] || p.modo_pago}</span> : <span style={{ color: 'var(--tm)' }}>—</span>}</td>
                          <td><span className={`badge ${p.estado === 'activo' ? 'b-green' : 'b-gray'}`} style={{ fontSize: 9 }}>{p.estado || '—'}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      )}

      {tab === 'trabajos' && (
        <div className="card card-p" style={{ borderLeft: '3px solid var(--blue)', fontSize: 11.5, color: 'var(--ts)', marginBottom: 10 }}>
          <strong style={{ color: 'var(--blue)' }}>Qué ejecuta esta empresa</strong> — obras donde es ejecutora o
          socia de consorcio (<code>obras.ejecutora_company_id</code>, <code>consorcio_socios</code>) y bienes/servicios
          que presta o vende (<code>trabajos.ejecutor_company_id</code>).
        </div>
      )}
      {tab === 'trabajos' && (
        (obrasDeEmpresa.length === 0 && trabajosBSDeEmpresa.length === 0) ? (
          <div className="card card-p empty-state">
            <JxIcon name="hardHat" size={40} color="var(--tm)" />
            <p>Esta empresa todavía no ejecuta ni participa en ningún trabajo registrado.</p>
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>Trabajo</th><th>Tipo</th><th>Rol</th><th>Estado</th><th style={{ textAlign: 'center' }}>Ir</th>
                </tr></thead>
                <tbody>
                  {obrasDeEmpresa.map(({ obra, rol, pct, lider }) => {
                    const estado = normalizarEstadoObra(obra.estado);
                    const tipoLbl = TIPOS_TRABAJO.find(t => t.v === (obra.tipo_trabajo || TIPO_TRABAJO_DEFAULT))?.corto || '—';
                    return (
                      <tr key={obra.id}>
                        <td className="col-p"><strong>{obra.nombre_obra || '(sin nombre)'}</strong></td>
                        <td>{tipoLbl}</td>
                        <td>
                          {rol === 'ejecutora'
                            ? <span className="badge b-green" style={{ fontSize: 9 }}>Ejecutora</span>
                            : <span className="badge b-gray" style={{ fontSize: 9 }} title="Aporta capital o experiencia; no lleva los libros">
                                Socia{pct != null ? ` · ${Number(pct)}%` : ''}{lider ? ' · líder' : ''}
                              </span>}
                        </td>
                        <td><span className={`badge ${ESTADO_OBRA_BADGE[estado] || 'b-gray'}`} style={{ fontSize: 9 }}>{ESTADO_OBRA_LBL[estado]}</span></td>
                        <td style={{ textAlign: 'center' }}>
                          <button className="btn btn-ghost btn-xs" onClick={() => irAObra(obra.id)} title="Ir al panel de este trabajo">
                            <JxIcon name="chevR" size={11} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {trabajosBSDeEmpresa.map(t => (
                    <tr key={t.id}>
                      <td className="col-p"><strong>{t.nombre || '(sin nombre)'}</strong></td>
                      <td>{TRABAJO_TIPO_LBL[t.tipo] || '—'}</td>
                      <td><span className="badge b-green" style={{ fontSize: 9 }}>Ejecutor</span></td>
                      <td>
                        <span className={`badge ${TRABAJO_ESTADO_BADGE[t.estado] || 'b-gray'}`} style={{ fontSize: 9 }}>
                          {TRABAJO_ESTADO_LBL[t.estado] || t.estado}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn btn-ghost btn-xs" onClick={() => window.__navTo?.('bienes-servicios')} title="Ver en Bienes y Servicios">
                          <JxIcon name="chevR" size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}

Object.assign(window, { EmpresaDetalle });
export { EmpresaDetalle };
