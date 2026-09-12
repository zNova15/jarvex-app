// ═══════════════════════════════════════════════════════════════════
// REEMPLAZO DE PROPUESTA SIRE — RVIE (140400) y RCE (080400) EN ZIP
//
// Permite a la contadora y asistentes:
// 1. Seleccionar qué facturas/comprobantes de JARVEX incluir en el reemplazo.
// 2. Cruzar automáticamente con presentaciones o propuestas previas de SUNAT
//    (ej. cortes históricos o propuesta descargada de Julio 2024 / Junio 2026)
//    para ver qué ya está presentado y qué falta presentar.
// 3. Seleccionar rápidamente "Solo los que faltan" o "Reemplazar propuesta completa".
// 4. Generar y descargar el archivo .ZIP reglamentario con la nomenclatura oficial
//    de 33 caracteres de SUNAT SIRE.
// ═══════════════════════════════════════════════════════════════════

import React from 'react';
import {
  LIBRO_RVIE_REEMPLAZO,
  LIBRO_RCE_REEMPLAZO,
  buildSireFilenameBase,
  generateReemplazoPropuestaRVIE,
  generateReemplazoPropuestaRCE,
  buildSireZipPackage,
  analizarComprobantesParaSire,
  downloadSireZip,
  splitDoc,
} from '../lib/sunat-sire.js';
import { downloadPLE } from '../lib/sunat-ple.js';
import { enPeriodo, fmtFechaCorta } from '../lib/fecha.js';
import { leerArchivoSunat, parseCsvSunat } from '../lib/sunat-csv.js';

const { useState, useMemo, useEffect } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function pad2(n) { return String(n || 0).padStart(2, '0'); }

export function ReemplazoPropuestaSire({
  company,
  companies = [],
  movs = [],
  anio,
  mes,
  showToast,
  userId,
}) {
  const [libro, setLibro] = useState('compras'); // 'compras' | 'ventas'
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todos'); // 'todos' | 'pendientes' | 'presentados'
  const [seleccionadosIds, setSeleccionadosIds] = useState(() => new Set());
  const [corteElegidoId, setCorteElegidoId] = useState('auto');
  const [archivoExtraFilas, setArchivoExtraFilas] = useState(null);
  const [archivoExtraNombre, setArchivoExtraNombre] = useState('');
  const [busy, setBusy] = useState(false);

  const periodoCod = `${anio}${pad2(mes)}`;
  const periodoObj = useMemo(() => ({ anio: Number(anio), mes: Number(mes), cod: periodoCod }), [anio, mes, periodoCod]);

  // Cortes guardados en sunat_cortes
  const cortesHook = window.__hooks?.useSunatCortes?.() || { data: [] };
  const cortesDisponibles = useMemo(() => {
    return (cortesHook.data || []).filter(c =>
      c && !c.deleted_at && c.company_id === company?.id && Array.isArray(c.filas) && c.filas.length > 0
    );
  }, [cortesHook.data, company?.id]);

  // Encontrar corte sugerido para el período y libro actual
  const corteSugerido = useMemo(() => {
    if (corteElegidoId === 'ninguno') return null;
    if (corteElegidoId !== 'auto') {
      return cortesDisponibles.find(c => c.id === corteElegidoId) || null;
    }
    // Auto: busca primero del mismo período y libro
    const exacto = cortesDisponibles.find(c => String(c.periodo) === periodoCod && c.libro === libro);
    if (exacto) return exacto;
    // O el más reciente del mismo libro
    const delLibro = cortesDisponibles
      .filter(c => c.libro === libro)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    return delLibro || null;
  }, [cortesDisponibles, corteElegidoId, periodoCod, libro]);

  // Filas SUNAT para cruce (del corte o del archivo subido manualmente)
  const filasSunatReferencia = useMemo(() => {
    if (archivoExtraFilas && archivoExtraFilas.length > 0) {
      return archivoExtraFilas;
    }
    if (corteSugerido && Array.isArray(corteSugerido.filas)) {
      return corteSugerido.filas;
    }
    return [];
  }, [archivoExtraFilas, corteSugerido]);

  // Movimientos de la empresa en el período
  const movsDelPeriodo = useMemo(() => {
    return (movs || []).filter(m => {
      if (!m || m.deleted_at) return false;
      if (m.payment_status === 'cancelled') return false;
      if (company?.id && m.company_id && m.company_id !== company.id) return false;
      return enPeriodo(m.date || m.created_at, Number(anio), Number(mes));
    });
  }, [movs, company?.id, anio, mes]);

  // Análisis y Cruce con comprobantes presentados
  const analisis = useMemo(() => {
    return analizarComprobantesParaSire(movsDelPeriodo, libro, {
      periodo: periodoObj,
      comprobantesPresentados: filasSunatReferencia,
    });
  }, [movsDelPeriodo, libro, periodoObj, filasSunatReferencia]);

  // Al cambiar período o libro, por defecto seleccionar todos
  useEffect(() => {
    if (analisis.items && analisis.items.length > 0) {
      setSeleccionadosIds(new Set(analisis.items.map(i => i.id)));
    } else {
      setSeleccionadosIds(new Set());
    }
  }, [periodoCod, libro, analisis.totalMovs]);

  // Selección rápida
  const handleSeleccionarFaltantes = () => {
    const pendientes = analisis.items.filter(i => !i.yaPresentado).map(i => i.id);
    setSeleccionadosIds(new Set(pendientes));
    showToast?.(`Seleccionados ${pendientes.length} comprobantes no presentados`, 'blue');
  };

  const handleSeleccionarTodos = () => {
    const todos = analisis.items.map(i => i.id);
    setSeleccionadosIds(new Set(todos));
    showToast?.(`Seleccionados todos los ${todos.length} comprobantes`, 'blue');
  };

  const handleDesmarcarTodos = () => {
    setSeleccionadosIds(new Set());
  };

  const toggleItem = (id) => {
    setSeleccionadosIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Carga manual de archivo de propuesta SUNAT al vuelo
  const handleCargarArchivoSunat = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const texto = await leerArchivoSunat(file);
      const resultado = parseCsvSunat(texto, file.name);
      if (resultado.filas && resultado.filas.length > 0) {
        setArchivoExtraFilas(resultado.filas);
        setArchivoExtraNombre(file.name);
        showToast?.(`Cargado ${file.name}: ${resultado.filas.length} comprobantes SUNAT`, 'green');
      } else {
        showToast?.('No se pudieron extraer comprobantes del archivo', 'orange');
      }
    } catch (err) {
      console.error('[CargarArchivoSunat]', err);
      showToast?.('Error al leer archivo: ' + err.message, 'red');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  };

  // Comprobantes filtrados para visualización en tabla
  const itemsFiltrados = useMemo(() => {
    let list = analisis.items || [];
    if (filtroEstado === 'pendientes') {
      list = list.filter(i => !i.yaPresentado);
    } else if (filtroEstado === 'presentados') {
      list = list.filter(i => i.yaPresentado);
    }
    if (filtroTexto.trim()) {
      const q = filtroTexto.toLowerCase().trim();
      list = list.filter(i =>
        String(i.documento || '').toLowerCase().includes(q) ||
        String(i.terceroRuc || '').toLowerCase().includes(q) ||
        String(i.terceroNombre || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [analisis.items, filtroEstado, filtroTexto]);

  // Métricas de los seleccionados
  const metricasSeleccion = useMemo(() => {
    const elegidos = (analisis.items || []).filter(i => seleccionadosIds.has(i.id));
    const totalMonto = elegidos.reduce((sum, i) => sum + i.monto, 0);
    return {
      cantidad: elegidos.length,
      totalMonto,
    };
  }, [analisis.items, seleccionadosIds]);

  const ruc = company?.ruc || '';
  const rucValid = String(ruc).length === 11;
  const razonSocial = company?.legal_name || company?.name || '';

  // Descarga del paquete ZIP reglamentario SIRE
  const handleDescargarZip = async () => {
    if (!rucValid) {
      return showToast?.('La empresa no tiene RUC válido de 11 dígitos', 'red');
    }
    if (metricasSeleccion.cantidad === 0) {
      const ok = window.confirm('No has seleccionado comprobantes. ¿Deseas generar el reemplazo SIN operaciones (vacío)?');
      if (!ok) return;
    }

    setBusy(true);
    try {
      const opts = {
        seleccionadosIds: Array.from(seleccionadosIds),
      };

      const resultadoGen = libro === 'compras'
        ? generateReemplazoPropuestaRCE(movsDelPeriodo, periodoObj, ruc, razonSocial, opts)
        : generateReemplazoPropuestaRVIE(movsDelPeriodo, periodoObj, ruc, razonSocial, opts);

      const pkg = await buildSireZipPackage(resultadoGen);
      downloadSireZip(pkg.zipBlob, pkg.zipFilename);
      showToast?.(`ZIP SIRE generado: ${pkg.zipFilename} (${pkg.registros} comprobantes)`, 'green');
    } catch (err) {
      console.error('[DescargarZipSire]', err);
      showToast?.('Error al generar ZIP SIRE: ' + err.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  // Descarga de comprobación en TXT
  const handleDescargarTxt = () => {
    if (!rucValid) return showToast?.('Empresa sin RUC válido', 'red');
    const opts = { seleccionadosIds: Array.from(seleccionadosIds) };
    const res = libro === 'compras'
      ? generateReemplazoPropuestaRCE(movsDelPeriodo, periodoObj, ruc, razonSocial, opts)
      : generateReemplazoPropuestaRVIE(movsDelPeriodo, periodoObj, ruc, razonSocial, opts);

    downloadPLE(res.txtFilename, res.txtContent);
    showToast?.(`TXT generado: ${res.txtFilename}`, 'blue');
  };

  const zipFilenamePreview = useMemo(() => {
    const codLibro = libro === 'compras' ? LIBRO_RCE_REEMPLAZO : LIBRO_RVIE_REEMPLAZO;
    return `${buildSireFilenameBase(ruc, periodoObj, codLibro, true, false)}.zip`;
  }, [ruc, periodoObj, libro]);

  return (
    <div className="card card-p" style={{ padding: 20 }}>
      {/* Cabecera de la sección SIRE */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📦 Reemplazo de Propuesta SIRE SUNAT (.ZIP)</span>
            <span style={{ fontSize: 11, background: 'var(--blue)', color: '#fff', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
              Oficial R.S. 112-2021
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--tm)', marginTop: 4 }}>
            Selecciona comprobantes, cruza con presentaciones de SUNAT y descarga el ZIP con estructura reglamentaria para reemplazar la propuesta.
          </div>
        </div>

        {/* Sub-selector de Registro: Compras vs Ventas */}
        <div style={{ display: 'flex', background: 'var(--bg-card, #202634)', borderRadius: 8, padding: 3, border: '1px solid var(--b-dim)' }}>
          <button
            type="button"
            className={`btn btn-sm ${libro === 'compras' ? 'btn-amber' : ''}`}
            style={{ borderRadius: 6, fontWeight: libro === 'compras' ? 700 : 400 }}
            onClick={() => setLibro('compras')}
          >
            🛒 Compras (RCE - 080400)
          </button>
          <button
            type="button"
            className={`btn btn-sm ${libro === 'ventas' ? 'btn-amber' : ''}`}
            style={{ borderRadius: 6, fontWeight: libro === 'ventas' ? 700 : 400 }}
            onClick={() => setLibro('ventas')}
          >
            💰 Ventas (RVIE - 140400)
          </button>
        </div>
      </div>

      {/* Banner de Cruce con Presentación / Propuesta de SUNAT */}
      <div style={{
        background: 'var(--bg-sub, rgba(255,255,255,0.03))',
        border: '1px solid var(--b-dim)',
        borderRadius: 8,
        padding: 14,
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🔍</span>
            <strong style={{ fontSize: 13 }}>Cotejo con Presentación / Propuesta SUNAT:</strong>
            <select
              className="fi"
              style={{ width: 'auto', minWidth: 260, height: 32, fontSize: 12 }}
              value={corteElegidoId}
              onChange={e => {
                setCorteElegidoId(e.target.value);
                setArchivoExtraFilas(null);
                setArchivoExtraNombre('');
              }}
            >
              <option value="auto">
                {corteSugerido ? `📌 Sugerido: ${corteSugerido.archivo} (${corteSugerido.periodo})` : '🔍 Autodetectar corte disponible'}
              </option>
              {cortesDisponibles.map(c => (
                <option key={c.id} value={c.id}>
                  {c.archivo || `Corte ${c.periodo}`} · {c.periodo} ({c.libro}) [{c.filas?.length || 0} cps]
                </option>
              ))}
              <option value="ninguno">— Sin comparar con SUNAT (solo contabilidad JARVEX) —</option>
            </select>
          </div>

          <label className="btn btn-sm" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>📂 Subir otro CSV / TXT SUNAT</span>
            <input
              type="file"
              accept=".csv,.txt"
              style={{ display: 'none' }}
              onChange={handleCargarArchivoSunat}
            />
          </label>
        </div>

        {archivoExtraNombre && (
          <div style={{ fontSize: 12, color: 'var(--green)', marginBottom: 8 }}>
            Usando archivo temporal: <strong>{archivoExtraNombre}</strong> ({archivoExtraFilas?.length || 0} comprobantes).
          </div>
        )}

        {/* Resumen de estado de comprobantes */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--tm)' }}>Comprobantes JARVEX en período: </span>
            <strong style={{ fontSize: 14 }}>{analisis.totalMovs}</strong>
          </div>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--tm)' }}>Ya en SUNAT: </span>
            <strong style={{ fontSize: 14, color: 'var(--green)' }}>{analisis.yaPresentadosCount}</strong>
          </div>
          <div style={{ fontSize: 12 }}>
            <span style={{ color: 'var(--tm)' }}>Pendientes / Por presentar: </span>
            <strong style={{ fontSize: 14, color: 'var(--amber, #f59e0b)' }}>{analisis.faltantesCount}</strong>
          </div>
          {analisis.hasPresentadosRef && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-sm btn-amber"
                onClick={handleSeleccionarFaltantes}
                title="Desmarca los ya presentados y selecciona los que faltan"
              >
                ⚡ Seleccionar solo pendientes ({analisis.faltantesCount})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Barra de herramientas y filtros de comprobantes */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleSeleccionarTodos}
          >
            ☑️ Seleccionar todos
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleDesmarcarTodos}
          >
            ⬜ Desmarcar todos
          </button>

          <div style={{ display: 'inline-flex', border: '1px solid var(--b-dim)', borderRadius: 6, overflow: 'hidden' }}>
            <button
              type="button"
              className={`btn btn-sm ${filtroEstado === 'todos' ? 'btn-amber' : ''}`}
              style={{ borderRadius: 0, padding: '4px 10px' }}
              onClick={() => setFiltroEstado('todos')}
            >
              Todos ({analisis.totalMovs})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filtroEstado === 'pendientes' ? 'btn-amber' : ''}`}
              style={{ borderRadius: 0, padding: '4px 10px' }}
              onClick={() => setFiltroEstado('pendientes')}
            >
              Pendientes ({analisis.faltantesCount})
            </button>
            <button
              type="button"
              className={`btn btn-sm ${filtroEstado === 'presentados' ? 'btn-amber' : ''}`}
              style={{ borderRadius: 0, padding: '4px 10px' }}
              onClick={() => setFiltroEstado('presentados')}
            >
              En SUNAT ({analisis.yaPresentadosCount})
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            className="fi"
            placeholder="Buscar por serie, número o RUC..."
            value={filtroTexto}
            onChange={e => setFiltroTexto(e.target.value)}
            style={{ width: 220, height: 32, fontSize: 12 }}
          />
        </div>
      </div>

      {/* Tabla de comprobantes */}
      <div style={{ overflowX: 'auto', maxHeight: 420, border: '1px solid var(--b-dim)', borderRadius: 6, marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ background: 'var(--bg-sub, #1e2430)', position: 'sticky', top: 0, zIndex: 2 }}>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--b-dim)' }}>
              <th style={{ padding: '8px 10px', width: 36, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={itemsFiltrados.length > 0 && itemsFiltrados.every(i => seleccionadosIds.has(i.id))}
                  onChange={e => {
                    if (e.target.checked) {
                      setSeleccionadosIds(prev => {
                        const next = new Set(prev);
                        itemsFiltrados.forEach(i => next.add(i.id));
                        return next;
                      });
                    } else {
                      setSeleccionadosIds(prev => {
                        const next = new Set(prev);
                        itemsFiltrados.forEach(i => next.delete(i.id));
                        return next;
                      });
                    }
                  }}
                />
              </th>
              <th style={{ padding: '8px 10px' }}>Estado SUNAT</th>
              <th style={{ padding: '8px 10px' }}>Fecha</th>
              <th style={{ padding: '8px 10px' }}>Tipo</th>
              <th style={{ padding: '8px 10px' }}>Documento</th>
              <th style={{ padding: '8px 10px' }}>Tercero (RUC / Razón Social)</th>
              <th style={{ padding: '8px 10px', textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {itemsFiltrados.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--tm)' }}>
                  No hay comprobantes que coincidan con los filtros en este período.
                </td>
              </tr>
            ) : (
              itemsFiltrados.map(item => {
                const checked = seleccionadosIds.has(item.id);
                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid var(--b-dim, rgba(255,255,255,0.05))',
                      background: checked ? 'rgba(245, 158, 11, 0.05)' : undefined,
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleItem(item.id)}
                  >
                    <td style={{ padding: '8px 10px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(item.id)}
                      />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {item.yaPresentado ? (
                        <span style={{
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#10b981',
                          padding: '2px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                        }}>
                          ✅ Ya en SUNAT
                        </span>
                      ) : (
                        <span style={{
                          background: 'rgba(245, 158, 11, 0.15)',
                          color: '#f59e0b',
                          padding: '2px 8px',
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 600,
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                        }}>
                          ⭐ Pendiente
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{fmtFechaCorta(item.fecha)}</td>
                    <td style={{ padding: '8px 10px', textTransform: 'capitalize' }}>
                      {item.tipoDocumento || 'Factura'}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                      {item.documento || '—'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <div>{item.terceroNombre || '—'}</div>
                      <div style={{ fontSize: 10, color: 'var(--tm)' }}>{item.terceroRuc}</div>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>
                      {item.moneda === 'USD' ? 'US$ ' : 'S/ '}
                      {item.monto.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Card de Resumen de Selección y Descarga Reglamentaria */}
      <div style={{
        background: 'var(--bg-sub, #1e2430)',
        border: '1px solid var(--b-dim)',
        borderRadius: 8,
        padding: 16,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16,
      }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--tm)' }}>
            Comprobantes listos para el archivo de reemplazo:
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--amber, #f59e0b)' }}>
              {metricasSeleccion.cantidad} seleccionados
            </span>
            <span style={{ fontSize: 16, fontWeight: 600 }}>
              Total: {fmtS(metricasSeleccion.totalMonto)}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4, fontFamily: 'monospace' }}>
            Nombre del archivo: {zipFilenamePreview}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            onClick={handleDescargarTxt}
            disabled={busy || !rucValid}
            title="Descargar solo el archivo .txt de 40/42 campos para revisión previa"
          >
            📄 Ver / Bajar .txt
          </button>
          <button
            type="button"
            className="btn btn-amber"
            style={{ fontWeight: 700, padding: '8px 16px', fontSize: 14 }}
            onClick={handleDescargarZip}
            disabled={busy || !rucValid}
          >
            📦 Descargar Reemplazo Propuesta (.ZIP)
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReemplazoPropuestaSire;
