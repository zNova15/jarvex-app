// ═══════════════════════════════════════════════════════════════════
// JARVEX — REGISTRO DE COMPRAS Y VENTAS, en el formato del Excel modelo.
//
// Tanda 4 de contabilidad. La contadora no revisa el .txt del PLE: revisa el
// Excel de dos hojas que armaba a mano todos los meses. Esta pantalla ES ese
// Excel, ya lleno, con las tres columnas de código resueltas por las Tablas
// SUNAT y la columna CTA tomada de la misma cuenta PCGE que muestra el Libro
// Diario.
//
// Toda la lógica —qué columnas, en qué orden, con qué valores, qué se marca—
// vive en `src/lib/registro-compras-ventas.js` con sus tests. Acá solo está la
// pantalla, el Excel y el PDF, y los tres salen de la MISMA lista de columnas:
// tres definiciones en tres lugares es como se llega a un Excel que no
// coincide con lo que se vio en pantalla.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  armarRegistro, COLUMNAS_COMPRAS, COLUMNAS_VENTAS, celda, matriz,
} from "../lib/registro-compras-ventas.js";
import { nombreTabla10, nombreTabla2 } from "../lib/tablas-sunat.js";
import { obtenerTipoCambio } from "../lib/tipo-cambio.js";

const { useState: uS, useMemo: uM } = React;

const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
const n2 = (v) => (typeof v === 'number' ? v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (v ?? ''));
const fmtMon = (n, mon) => `${mon === 'USD' ? 'US$' : 'S/'} ${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * El registro de un período, en sus dos hojas.
 *
 * @param movsPeriodo  los movimientos del período y la empresa (ya filtrados)
 * @param movsById     índice de TODOS los movimientos (las notas referencian meses anteriores)
 * @param asientos     los asientos del período, para la columna CTA
 */
export function RegistroComprasVentas({ company, movsPeriodo = [], movsById = null, asientos = [], anio, mes, showToast }) {
  const [hoja, setHoja] = uS('compras');
  const [soloAvisos, setSoloAvisos] = uS(false);

  // La CTA sale del asiento, que es donde ya se resolvió la cuenta: la deducida
  // de lo que se compró, o la que la contadora corrigió a mano. Si el
  // comprobante está repartido en dos cuentas, se muestran las dos — poner una
  // sola escondería la mitad del asiento.
  const cuentaDe = uM(() => {
    const porMov = new Map();
    for (const a of asientos || []) {
      const detalle = a?.cuentas?.detalle || [];
      if (!a?.movimiento_id || !detalle.length) continue;
      porMov.set(a.movimiento_id, detalle.map(d => d.cuenta).filter(Boolean).join(' + '));
    }
    return (m) => porMov.get(m?.id) || '';
  }, [asientos]);

  // El tipo de cambio del día de la operación, de lo que haya cacheado. Si no
  // hay, la fila lo avisa en vez de poner el 3,75 de referencia.
  // Se acepta SOLO la tasa de ESE día. `obtenerTipoCambio` devuelve la fecha
  // anterior más cercana cuando no tiene la exacta, y el cache tiene seis
  // fechas: declarar el tipo de cambio de otro día es declarar mal. Si no está
  // la del día, la fila avisa que falta (la tarea que trae la tasa SUNAT de
  // cada día es decisión de Gabriel y va con la tanda de dólares).
  const tasaDe = React.useCallback((ymd) => {
    if (!ymd) return 0;
    try {
      const r = obtenerTipoCambio(ymd);
      if (!r || r.fuente === 'default' || r.fecha !== ymd) return 0;
      return Number(r.venta) || 0;
    } catch { return 0; }
  }, []);

  const registro = uM(
    () => armarRegistro({ movimientos: movsPeriodo, movsById, cuentaDe, tasaDe }),
    [movsPeriodo, movsById, cuentaDe, tasaDe],
  );

  const esCompras = hoja === 'compras';
  const columnas = esCompras ? COLUMNAS_COMPRAS : COLUMNAS_VENTAS;
  const actual = esCompras ? registro.compras : registro.ventas;
  const filas = soloAvisos ? actual.filas.filter(f => f.avisos?.length) : actual.filas;

  const titulo = esCompras ? 'REGISTRO DE COMPRAS' : 'REGISTRO DE VENTAS E INGRESOS';
  const periodoTxt = `${MESES[(Number(mes) || 1) - 1]} DEL ${anio}`;
  const ruc = company?.ruc || '';
  const razon = company?.legal_name || company?.name || '';

  const exportarExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      for (const [cols, reg, nombre, tit] of [
        [COLUMNAS_COMPRAS, registro.compras, 'Registro de Compras', 'REGISTRO DE COMPRAS'],
        [COLUMNAS_VENTAS, registro.ventas, 'Registro de Ventas', 'REGISTRO DE VENTAS E INGRESOS'],
      ]) {
        const aoa = [
          [tit], [], ['PERIODO :', periodoTxt], ['RUC :', ruc], ['APELLIDOS Y NOMBRES :', razon], [],
          cols.map(c => c.t),
          cols.map(c => c.t2),
          ...matriz(reg.filas, cols),
        ];
        // Los totales, una fila por moneda: nunca sumadas entre sí.
        for (const t of reg.totales.monedas) {
          const fila = cols.map(c => {
            if (c.k === 'razonSocial') return `TOTAL ${t.moneda} (${t.filas} comprobantes)`;
            if (c.n && t[c.k] != null) return t[c.k];
            return '';
          });
          aoa.push(fila);
        }
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nombre);
      }
      const archivo = `JARVEX_RC_RV_${ruc || 'empresa'}_${anio}${String(mes).padStart(2, '0')}.xlsx`;
      XLSX.writeFile(wb, archivo);
      showToast?.(`✓ ${archivo} — las dos hojas, con el formato del modelo.`, 'green');
    } catch (e) {
      showToast?.('No se pudo generar el Excel: ' + (e?.message || e), 'red');
    }
  };

  const exportarPdf = () => {
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
      doc.setFontSize(12);
      doc.text(titulo, 30, 30);
      doc.setFontSize(8);
      doc.text(`PERIODO: ${periodoTxt}     RUC: ${ruc}     ${razon}`, 30, 44);
      autoTable(doc, {
        startY: 56,
        head: [columnas.map(c => c.t), columnas.map(c => c.t2)],
        body: matriz(filas, columnas).map(r => r.map(v => (typeof v === 'number' ? n2(v) : String(v ?? '')))),
        styles: { fontSize: 5.4, cellPadding: 1.2, overflow: 'linebreak' },
        headStyles: { fillColor: [60, 60, 60], fontSize: 5 },
      });
      doc.save(`JARVEX_${esCompras ? 'RC' : 'RV'}_${anio}${String(mes).padStart(2, '0')}.pdf`);
    } catch (e) {
      showToast?.('No se pudo generar el PDF: ' + (e?.message || e), 'red');
    }
  };

  return (
    <div>
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div className="frow-sb" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['compras', `Compras (${registro.compras.filas.length})`], ['ventas', `Ventas (${registro.ventas.filas.length})`]].map(([k, label]) => (
              <button key={k} className={hoja === k ? 'btn btn-amber btn-sm' : 'btn btn-sm'} onClick={() => setHoja(k)}>
                {label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {actual.totales.conAvisos > 0 && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer', color: 'var(--amber)' }}>
                <input type="checkbox" checked={soloAvisos} onChange={e => setSoloAvisos(e.target.checked)} />
                Solo las {actual.totales.conAvisos} con algo que mirar
              </label>
            )}
            <button className="btn btn-sm" onClick={exportarExcel}>⤓ Excel (las dos hojas)</button>
            <button className="btn btn-sm" onClick={exportarPdf}>⤓ PDF de esta hoja</button>
          </div>
        </div>

        {/* El encabezado del registro, como en el papel */}
        <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{titulo}</div>
          <div style={{ color: 'var(--tm)' }}>
            <b>PERIODO:</b> {periodoTxt} &nbsp;·&nbsp; <b>RUC:</b> {ruc || <span style={{ color: 'var(--red)' }}>falta el RUC de la empresa</span>} &nbsp;·&nbsp; {razon}
          </div>
        </div>
      </div>

      {/* Totales, una tarjeta por moneda. Nunca sumadas entre sí: soles con
          dólares en la misma bolsa da un número que no es plata de nada. */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {actual.totales.monedas.length === 0 && (
          <div className="card card-p" style={{ padding: 12, fontSize: 12.5, color: 'var(--tm)' }}>
            No hay {esCompras ? 'compras' : 'ventas'} registradas en {periodoTxt.toLowerCase()}.
          </div>
        )}
        {actual.totales.monedas.map(t => (
          <div key={t.moneda} className="card card-p" style={{ padding: 12, minWidth: 210, flex: '1 1 210px' }}>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              {t.moneda === 'PEN' ? 'Soles' : t.moneda} · {t.filas} comprobantes
            </div>
            {esCompras ? (
              <>
                <div style={{ fontSize: 12 }}>Base imponible: <b>{fmtMon(t.baseImponible, t.moneda)}</b></div>
                <div style={{ fontSize: 12 }}>IGV (crédito fiscal): <b>{fmtMon(t.igv, t.moneda)}</b></div>
                <div style={{ fontSize: 12 }}>No gravadas: <b>{fmtMon(t.noGravadas, t.moneda)}</b></div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>Total: {fmtMon(t.importeTotal, t.moneda)}</div>
                {t.retencion4ta > 0 && (
                  <div style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 3 }}>
                    Retención de 4ta a declarar en el PLAME: {fmtMon(t.retencion4ta, t.moneda)}
                  </div>
                )}
              </>
            ) : (
              <>
                {t.exportacion > 0 && <div style={{ fontSize: 12 }}>Exportación: <b>{fmtMon(t.exportacion, t.moneda)}</b></div>}
                <div style={{ fontSize: 12 }}>Base imponible: <b>{fmtMon(t.baseImponible, t.moneda)}</b></div>
                <div style={{ fontSize: 12 }}>IGV y/o IPM: <b>{fmtMon(t.igv, t.moneda)}</b></div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3 }}>Total: {fmtMon(t.importeTotal, t.moneda)}</div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* La hoja. Dos filas de título como en el modelo, y scroll horizontal:
          son 23 columnas y no se pueden achicar sin volverlas ilegibles. */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="tbl" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              {columnas.map((c, i) => {
                // El título de grupo se escribe una sola vez: si la columna
                // anterior es del mismo grupo, la celda va vacía.
                const repetido = i > 0 && columnas[i - 1].t === c.t;
                return (
                  <th key={c.k} style={{ fontSize: 9, lineHeight: 1.25, color: repetido ? 'transparent' : undefined, textAlign: c.n ? 'right' : 'left' }}>
                    {repetido ? '' : c.t}
                  </th>
                );
              })}
              <th style={{ fontSize: 9 }}>MARCAS</th>
            </tr>
            <tr>
              {columnas.map(c => (
                <th key={c.k} style={{ fontSize: 8.5, fontWeight: 400, color: 'var(--tm)', lineHeight: 1.2, textAlign: c.n ? 'right' : 'left' }}>
                  {c.t2}
                </th>
              ))}
              <th/>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && (
              <tr><td colSpan={columnas.length + 1} style={{ textAlign: 'center', padding: 16, color: 'var(--tm)', fontSize: 12.5 }}>
                {soloAvisos ? 'Ninguna fila tiene avisos: el registro está limpio.' : 'No hay comprobantes en este período.'}
              </td></tr>
            )}
            {filas.map(f => (
              <tr key={f.movimiento_id} style={f.avisos?.length ? { background: 'rgba(242,183,5,.07)' } : undefined}>
                {columnas.map(c => {
                  const v = celda(f, c.k);
                  // Los códigos de las tablas se muestran con su nombre en el
                  // title: '01' no dice nada leído solo.
                  const ayuda = c.k === 'tipo' || c.k === 'refTipo' ? nombreTabla10(v)
                    : c.k === 'tipoDocIdent' ? nombreTabla2(v) : undefined;
                  return (
                    <td key={c.k} title={ayuda || undefined}
                      style={{ textAlign: c.n ? 'right' : 'left', color: c.n && Number(v) < 0 ? 'var(--amber)' : undefined }}>
                      {c.n ? n2(v) : String(v ?? '')}
                    </td>
                  );
                })}
                <td>
                  {(f.marcadores || []).map(mk => (
                    <span key={mk.clave} className="badge b-blue" style={{ fontSize: 9, marginRight: 3 }} title={mk.detalle}>
                      {mk.etiqueta}
                    </span>
                  ))}
                  {(f.avisos || []).length > 0 && (
                    <span className="badge b-amber" style={{ fontSize: 9 }} title={f.avisos.join('\n\n')}>
                      ⚠ {f.avisos.length}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 10, lineHeight: 1.5 }}>
        Las columnas «TIPO» son los códigos de las Tablas 10 y 2 de SUNAT — pasá el mouse para ver
        qué significa cada uno. La columna <b>CTA</b> es la misma cuenta PCGE del Libro Diario: si
        está mal, se corrige ahí y acá cambia solo. Las filas en ámbar tienen algo que mirar antes
        de declarar.
      </div>
    </div>
  );
}

export default RegistroComprasVentas;
