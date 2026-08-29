// ═══════════════════════════════════════════════════════════════════
// JARVEX — Visor de historial de precios (compartido por los 4 inventarios)
//
// <PrecioHistorialModal itemTipo itemId nombre precioActual onClose/>
// Lee de la tabla correcta vía leerHistorialPrecios (material→material_precios_
// historial; herr/epp/emergencia→insumo_precios_historial) y muestra la
// evolución del precio unitario: anterior→nuevo, Δ%, fuente, documento, motivo.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { leerHistorialPrecios } from "../lib/precio-historial.js";
import { useChart } from "../lib/chart-loader.js";

const { useState: uS, useEffect: uE, useRef: uR } = React;

// Gráfico de evolución (mejora 1b): línea del precio nuevo por fecha.
function GraficoHistorial({ lista }) {
  const Chart = useChart();
  const canvasRef = uR(null);
  const chartRef = uR(null);
  uE(() => {
    if (!Chart || !canvasRef.current || !lista.length) return;
    const crono = [...lista].reverse();   // leerHistorialPrecios viene desc
    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: crono.map(h => h.fecha),
        datasets: [{
          label: 'Precio unitario (S/)',
          data: crono.map(h => Number(h.precio_nuevo || 0)),
          borderColor: '#3aa3ff', backgroundColor: '#3aa3ff', tension: 0.2, pointRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { font: { size: 10 } } }, x: { ticks: { font: { size: 9 } } } },
      },
    });
    return () => { try { chartRef.current?.destroy(); } catch {} };
  }, [Chart, lista]);
  if (!lista.length) return null;
  if (!Chart) return <div style={{ fontSize: 11, color: 'var(--tm)' }}>Cargando gráfico…</div>;
  return <div style={{ height: 160, marginBottom: 12 }}><canvas ref={canvasRef} /></div>;
}
const JxIcon = (props) => (window.JxIcon ? <window.JxIcon {...props} /> : null);
const Modal = (props) => (window.Modal ? <window.Modal {...props} /> : null);

const FUENTE_LABEL = { manual: 'Manual', apu: 'APU', movimiento: 'Comprobante', importacion: 'Importación' };

export function PrecioHistorialModal({ itemTipo, itemId, nombre, precioActual, onClose }) {
  const [rows, setRows] = uS(null);
  // Nombres de proveedor (mig 153: el historial ahora sabe a quién se compró).
  const [provMap, setProvMap] = uS(new Map());
  uE(() => {
    let cancel = false;
    const ids = [...new Set((rows || []).map(h => h.proveedor_id).filter(Boolean))];
    if (!ids.length) { setProvMap(new Map()); return; }
    (async () => {
      try {
        const provs = await window.__db.proveedores.where('id').anyOf(ids).toArray();
        if (!cancel) setProvMap(new Map(provs.map(p => [p.id, p.razon_social])));
      } catch {}
    })();
    return () => { cancel = true; };
  }, [rows]);

  uE(() => {
    let cancel = false;
    (async () => {
      const data = await leerHistorialPrecios(itemTipo, itemId);
      if (!cancel) setRows(data);
    })();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || ['material_precios_historial', 'insumo_precios_historial'].includes(t)) {
        leerHistorialPrecios(itemTipo, itemId).then(d => { if (!cancel) setRows(d); });
      }
    };
    window.addEventListener('jx_data_changed', onChange);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', onChange); };
  }, [itemTipo, itemId]);

  const lista = rows || [];
  const actual = Number(precioActual || 0);
  const variacion = (() => {
    if (lista.length === 0) return '—';
    const primero = lista[lista.length - 1];
    const base = Number(primero.precio_anterior || 0);
    if (base === 0) return '—';
    const pct = ((actual - base) / base) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  })();

  return (
    <Modal title={`Historial de precios — ${nombre || ''}`} icon="dollar" onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
        <div className="card card-p" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>Precio actual</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--blue)' }}>S/ {actual.toFixed(2)}</div>
        </div>
        <div className="card card-p" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>Cambios registrados</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--amber)' }}>{lista.length}</div>
        </div>
        <div className="card card-p" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>Variación total</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)' }}>{variacion}</div>
        </div>
      </div>

      {rows === null ? (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Cargando…</div>
      ) : lista.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="dollar" size={32} color="var(--tm)" />
          <p>Sin historial de cambios. El primer cambio de precio (al recibir un comprobante o al editarlo) quedará registrado acá.</p>
        </div>
      ) : (
        <>
        <GraficoHistorial lista={lista} />
        <div className="card" style={{ overflow: 'auto', maxHeight: 400 }}>
          <table className="tbl" style={{ fontSize: 11 }}>
            <thead><tr>
              <th>Fecha</th>
              <th style={{ textAlign: 'right' }}>Anterior</th>
              <th style={{ textAlign: 'right' }}>Nuevo</th>
              <th style={{ textAlign: 'right' }}>Δ</th>
              <th>Proveedor</th>
              <th>Fuente</th>
              <th>Documento</th>
              <th>Motivo</th>
            </tr></thead>
            <tbody>
              {lista.map(h => {
                const ant = Number(h.precio_anterior || 0);
                const nuevo = Number(h.precio_nuevo || 0);
                const delta = nuevo - ant;
                const pct = ant > 0 ? (delta / ant * 100) : 0;
                return (
                  <tr key={h.id}>
                    <td>{h.fecha}</td>
                    <td style={{ textAlign: 'right' }}>S/ {ant.toFixed(2)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>S/ {nuevo.toFixed(2)}</td>
                    <td style={{ textAlign: 'right', color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {delta >= 0 ? '+' : ''}{delta.toFixed(2)}{ant > 0 ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}
                    </td>
                    <td style={{ color: 'var(--ts)' }}>{provMap.get(h.proveedor_id) || '—'}</td>
                    <td><span className="badge b-gray" style={{ fontSize: 9 }}>{FUENTE_LABEL[h.fuente] || h.fuente || '—'}</span></td>
                    <td style={{ color: 'var(--tm)' }}>{h.documento_ref || '—'}</td>
                    <td style={{ color: 'var(--tm)' }}>{h.motivo || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Modal>
  );
}

try { Object.assign(window, { PrecioHistorialModal }); } catch {}
