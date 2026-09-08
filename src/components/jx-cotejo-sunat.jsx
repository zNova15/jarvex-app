// ═══════════════════════════════════════════════════════════════════
// JARVEX — SUNAT CONTRA JARVEX + EL ESCÁNER (tanda 14, entregas 5 y 6).
//
// Se monta como dos pestañas DENTRO de Libros Electrónicos, que ya tiene el
// ámbito exacto que hace falta —empresa + año + mes— y es donde la contadora
// ya entra a hacer justamente esto. Una pantalla nueva en el menú habría
// partido en dos un mismo trabajo.
//
// NO se importa con `import()` dinámico: lo trae `jx-libros-electronicos.jsx`
// con un import estático y viaja en su mismo chunk (regla 1 del CLAUDE.md).
//
// La lógica no está acá. Está en las libs puras con tests:
//   · `sunat-csv.js`             — leer los CSV rotos de SUNAT
//   · `comparativa-sunat.js`     — el cruce y sus estados
//   · `escaner-incoherencias.js` — las cuatro familias
//   · `cotejo-sunat-db.js`       — el aterrizaje en Dexie
// Acá solo está la pantalla.
// ═══════════════════════════════════════════════════════════════════
import React from 'react';
import { parseCsvSunat, leerArchivoSunat } from '../lib/sunat-csv.js';
import {
  compararLibro, aplicarDecisiones, filasPendientes, exportarComparativaCsv,
  ETIQUETA_ESTADO, ESTADOS_PENDIENTES, mesDePeriodo,
} from '../lib/comparativa-sunat.js';
import {
  escanear, resumirHallazgos, aplicarDecisionesEscaner, hallazgosPendientes,
  FAMILIAS,
} from '../lib/escaner-incoherencias.js';
import { guardarCorte, decidirCotejo, decidirCotejoLote } from '../lib/cotejo-sunat-db.js';

const { useState: uS, useMemo: uM, useRef: uR } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periodoDe = (anio, mes) => `${anio}${String(mes).padStart(2, '0')}`;

// Cada estado tiene su color: el rojo es solo para lo que de verdad falta.
const COLOR_ESTADO = {
  cuadra: 'var(--green)',
  solo_sunat: '#d33',
  solo_jarvex: '#d33',
  importe_distinto: 'var(--orange)',
  signo_distinto: 'var(--orange)',
  serie_distinta: 'var(--amber, #d97706)',
  otra_empresa: 'var(--blue)',
  otro_periodo: 'var(--blue)',
  fecha_distinta: 'var(--tm)',
};
const COLOR_GRAVEDAD = { alta: '#d33', media: 'var(--orange)', baja: 'var(--tm)' };

function descargarTexto(nombre, texto) {
  const blob = new Blob([texto], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ═══════════════════════════════════════════════════════════════════
// PESTAÑA 1 — SUNAT CONTRA JARVEX
// ═══════════════════════════════════════════════════════════════════
export function ComparativaSunat({ company, companies, movs, anio, mes, showToast, userId }) {
  const periodo = periodoDe(anio, mes);
  // Un corte por libro: se pueden cargar los dos archivos y verlos juntos.
  const [cortes, setCortes] = uS({});        // { compras: {...}, ventas: {...} }
  const [filtro, setFiltro] = uS('pendientes');
  const [busy, setBusy] = uS(false);
  const enCursoRef = uR(false);              // guard SÍNCRONO (regla 2)
  const inputRef = uR(null);

  const decHook = window.__hooks?.useCotejoDecisiones?.() || { data: [] };
  const decisiones = uM(
    () => (decHook.data || []).filter(d => d.ambito === 'comparativa'),
    [decHook.data],
  );

  // El cruce se recalcula solo: el CSV ya está en memoria y los movimientos
  // vienen del hook, así que si alguien carga una factura que faltaba, la
  // pantalla lo refleja sin volver a subir el archivo.
  const resultados = uM(() => {
    const out = {};
    for (const libro of ['compras', 'ventas']) {
      const c = cortes[libro];
      if (!c) continue;
      const { filas, resumen } = compararLibro(c.filas, movs, {
        companyId: company?.id, libro, periodo, companies,
      });
      out[libro] = { ...c, filas: aplicarDecisiones(filas, decisiones), resumen };
    }
    return out;
  }, [cortes, movs, company?.id, periodo, companies, decisiones]);

  const todas = uM(
    () => [...(resultados.compras?.filas || []), ...(resultados.ventas?.filas || [])],
    [resultados],
  );

  const visibles = uM(() => {
    if (filtro === 'todas') return todas;
    if (filtro === 'pendientes') return filasPendientes(todas);
    if (filtro === 'decididas') return todas.filter(f => f.decision);
    return todas.filter(f => f.estado === filtro);
  }, [todas, filtro]);

  const global = uM(() => {
    const pend = filasPendientes(todas);
    return {
      total: todas.length,
      cuadran: todas.filter(f => f.estado === 'cuadra').length,
      pendientes: pend.length,
      brecha: pend.reduce((a, f) => a + (f.estado === 'solo_sunat' ? f.sunatTotal
        : f.estado === 'solo_jarvex' ? -(f.appTotal || 0)
        : f.estado === 'importe_distinto' ? f.diferencia : 0), 0),
    };
  }, [todas]);

  const cargarArchivo = async (file) => {
    if (!file) return;
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const texto = await leerArchivoSunat(file);
      const r = parseCsvSunat(texto);

      if (!r.libro) {
        showToast?.('Ese archivo no parece un CSV de SUNAT (no se reconoce el encabezado).', 'red');
        return;
      }
      // El archivo dice de quién y de cuándo es: se VERIFICA, no se pregunta.
      const rucEmpresa = String(company?.ruc || '').replace(/\D/g, '');
      if (rucEmpresa && r.ruc && r.ruc !== rucEmpresa) {
        showToast?.(`Ese archivo es del RUC ${r.ruc} y estás parado en ${company?.name} (RUC ${rucEmpresa}). Cambiá de empresa o de archivo.`, 'red');
        return;
      }
      if (r.periodo && r.periodo !== periodo) {
        showToast?.(`Ese archivo es del periodo ${r.periodo} y arriba está seleccionado ${periodo}. Cambiá el mes.`, 'red');
        return;
      }

      setCortes(prev => ({
        ...prev,
        [r.libro]: { filas: r.filas, avisos: r.avisos, archivo: file.name, periodo: r.periodo || periodo },
      }));

      const { resumen } = compararLibro(r.filas, movs, {
        companyId: company?.id, libro: r.libro, periodo, companies,
      });
      await guardarCorte({
        companyId: company?.id, periodo, libro: r.libro, archivo: file.name,
        resumen, filasArchivo: r.filas.length, avisos: r.avisos.length,
      }, userId);

      const aviso = r.avisos.length
        ? ` ⚠️ ${r.avisos.length} línea(s) no se pudieron leer.`
        : '';
      showToast?.(`${r.libro === 'compras' ? 'Compras' : 'Ventas'}: ${r.filas.length} comprobantes de SUNAT.${aviso}`, r.avisos.length ? 'amber' : 'green');
    } catch (e) {
      console.error('[cotejo-sunat]', e);
      showToast?.('No se pudo leer el archivo: ' + e.message, 'red');
    } finally {
      setBusy(false);
      enCursoRef.current = false;
      if (inputRef.current) inputRef.current.value = '';   // permitir recargar el mismo
    }
  };

  const decidir = async (fila, decision) => {
    await decidirCotejo({
      ambito: 'comparativa', llave: fila.llave, decision,
      companyId: company?.id, periodo, libro: fila.libro,
      estado: fila.estado, documento: fila.documento, monto: fila.sunatTotal || fila.appTotal,
    }, userId);
  };

  const marcarTodasNoAplica = async () => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try {
      const cuerpos = visibles.filter(f => !f.decision && f.llave).map(f => ({
        ambito: 'comparativa', llave: f.llave, decision: 'no_aplica',
        companyId: company?.id, periodo, libro: f.libro,
        estado: f.estado, documento: f.documento, monto: f.sunatTotal || f.appTotal,
      }));
      const n = await decidirCotejoLote(cuerpos, userId);
      showToast?.(`${n} diferencia(s) marcadas como «no aplica».`, 'green');
    } finally { enCursoRef.current = false; }
  };

  const exportar = () => {
    const csv = exportarComparativaCsv(visibles, { periodo, empresa: company?.name || '' });
    descargarTexto(`cotejo-sunat-${company?.ruc || 'empresa'}-${periodo}.csv`, csv);
  };

  const hayAlgo = todas.length > 0;

  return (
    <div>
      {/* Carga de los dos archivos */}
      <div className="card card-p" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Cargá los CSV que bajaste de SUNAT</div>
        <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 12 }}>
          El de <strong>ventas</strong> (export del RVIE, empieza con «LE…») y el de <strong>compras</strong>
          {' '}(la propuesta del RCE, termina en «-propuesta.csv»). El archivo dice solo de qué RUC y de qué mes es:
          si no coincide con {company?.name || 'la empresa'} y {periodo}, se avisa y no se carga.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple
          disabled={busy || !company}
          onChange={async (e) => {
            const files = Array.from(e.target.files || []);
            for (const f of files) await cargarArchivo(f);
          }}
        />
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12 }}>
          {['compras', 'ventas'].map(l => (
            <div key={l} style={{ color: cortes[l] ? 'var(--green)' : 'var(--tm)' }}>
              {cortes[l] ? '✓' : '○'} {l === 'compras' ? 'Compras' : 'Ventas'}
              {cortes[l] ? ` · ${cortes[l].filas.length} comprobantes` : ' · sin cargar'}
              {cortes[l]?.avisos?.length ? (
                <span style={{ color: '#d33' }}> · ⚠️ {cortes[l].avisos.length} línea(s) ilegibles</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {!hayAlgo ? null : (
        <>
          {/* Resumen */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
            <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ color: 'var(--tm)', fontSize: 11 }}>Comprobantes cotejados</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{global.total}</div>
            </div>
            <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ color: 'var(--tm)', fontSize: 11 }}>Cuadran</div>
              <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--green)' }}>
                {global.cuadran}
                <span style={{ fontSize: 12, color: 'var(--tm)', fontWeight: 400 }}>
                  {' '}({global.total ? Math.round((global.cuadran / global.total) * 100) : 0}%)
                </span>
              </div>
            </div>
            <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ color: 'var(--tm)', fontSize: 11 }}>Por revisar</div>
              <div style={{ fontWeight: 700, fontSize: 20, color: global.pendientes ? '#d33' : 'var(--green)' }}>
                {global.pendientes}
              </div>
            </div>
            <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ color: 'var(--tm)', fontSize: 11 }}>Plata sin registrar</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: Math.abs(global.brecha) > 0.05 ? '#d33' : 'var(--green)' }}>
                {fmtS(global.brecha)}
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="card card-p" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="fi" style={{ maxWidth: 260 }} value={filtro} onChange={e => setFiltro(e.target.value)}>
              <option value="pendientes">Por revisar ({filasPendientes(todas).length})</option>
              <option value="todas">Todas ({todas.length})</option>
              <option value="decididas">Ya decididas ({todas.filter(f => f.decision).length})</option>
              <option value="cuadra">Las que cuadran ({todas.filter(f => f.estado === 'cuadra').length})</option>
              {ESTADOS_PENDIENTES.map(e => {
                const n = todas.filter(f => f.estado === e).length;
                return n ? <option key={e} value={e}>{ETIQUETA_ESTADO[e]} ({n})</option> : null;
              })}
            </select>
            <button className="btn" onClick={exportar} disabled={!visibles.length}>
              Exportar lo que se ve (.csv)
            </button>
            {filtro !== 'cuadra' && filtro !== 'decididas' && (
              <button className="btn" onClick={marcarTodasNoAplica} disabled={!visibles.some(f => !f.decision)}>
                Marcar todo lo que se ve como «no aplica»
              </button>
            )}
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm)' }}>
              Lo que marcás no vuelve a salir el mes que viene.
            </div>
          </div>

          {/* Tabla */}
          <div className="card card-p" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="tbl" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Estado</th>
                  <th style={{ textAlign: 'left' }}>Comprobante</th>
                  <th style={{ textAlign: 'left' }}>Fecha</th>
                  <th style={{ textAlign: 'left' }}>Tercero</th>
                  <th style={{ textAlign: 'right' }}>SUNAT</th>
                  <th style={{ textAlign: 'right' }}>JARVEX</th>
                  <th style={{ textAlign: 'right' }}>Dif.</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: 'var(--tm)' }}>
                    {filtro === 'pendientes' ? '✓ No queda nada por revisar en este mes.' : 'Nada que mostrar con este filtro.'}
                  </td></tr>
                )}
                {visibles.map((f, i) => (
                  <tr key={`${f.llave}|${f.libro}|${i}`} style={{ opacity: f.decision ? 0.55 : 1 }}>
                    <td>
                      <span style={{ color: COLOR_ESTADO[f.estado] || 'var(--tm)', fontWeight: 600 }}>
                        {ETIQUETA_ESTADO[f.estado] || f.estado}
                      </span>
                      {f.estado === 'otra_empresa' && (
                        <div style={{ fontSize: 11, color: 'var(--tm)' }}>en {f.empresaAjena}</div>
                      )}
                      {f.decision && (
                        <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                          {f.decision === 'no_aplica' ? 'no aplica' : 'revisada'}
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{f.documento || f.appDocumento || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                        {f.libro === 'compras' ? 'compra' : 'venta'} · {f.tipoNombre?.replace('_', ' ')}
                        {f.modifica ? ` · anula ${f.modifica}` : ''}
                      </div>
                      {f.estado === 'serie_distinta' && (
                        <div style={{ fontSize: 11, color: 'var(--amber, #d97706)' }}>
                          en JARVEX está como {f.appDocumento}
                        </div>
                      )}
                    </td>
                    <td>
                      {f.fecha || f.appFecha || '—'}
                      {f.estado === 'fecha_distinta' || f.estado === 'otro_periodo' ? (
                        <div style={{ fontSize: 11, color: 'var(--blue)' }}>JARVEX: {f.appFecha}</div>
                      ) : null}
                    </td>
                    <td style={{ maxWidth: 260 }}>
                      <div style={{ fontSize: 12 }}>{f.contraparteNombre || f.appNombre || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--tm)' }}>{f.contraparteRuc}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {f.estado === 'solo_jarvex' ? '—' : fmtS(f.sunatTotal)}
                      {f.sunatIgv ? <div style={{ fontSize: 11, color: 'var(--tm)' }}>IGV {fmtS(f.sunatIgv)}</div> : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {f.movimientoId ? fmtS(f.appTotal) : <span style={{ color: '#d33' }}>no está</span>}
                    </td>
                    <td style={{ textAlign: 'right', color: Math.abs(f.diferencia || 0) > 0.05 ? '#d33' : 'var(--tm)' }}>
                      {Math.abs(f.diferencia || 0) > 0.05 ? fmtS(f.diferencia) : '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {f.estado === 'cuadra' ? null : f.decision ? (
                        <button className="btn btn-sm" onClick={() => decidir(f, null)}>Deshacer</button>
                      ) : (
                        <>
                          <button className="btn btn-sm" onClick={() => decidir(f, 'revisada')}>Ya la vi</button>
                          <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => decidir(f, 'no_aplica')}>No aplica</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PESTAÑA 2 — EL ESCÁNER DE INCOHERENCIAS
// ═══════════════════════════════════════════════════════════════════
export function EscanerIncoherencias({ company, companies, movs, showToast, userId, empresaFija }) {
  // Por defecto mira TODO el grupo: la incoherencia más cara que se midió
  // —una venta marcada intercompany sin su costo del otro lado— es imposible
  // de ver parado en una sola empresa. Con una empresa fijada por navegación,
  // se respeta ese ámbito.
  const [soloEmpresa, setSoloEmpresa] = uS(!!empresaFija);
  const [familia, setFamilia] = uS('todas');
  const enCursoRef = uR(false);

  const decHook = window.__hooks?.useCotejoDecisiones?.() || { data: [] };
  const decisiones = uM(
    () => (decHook.data || []).filter(d => d.ambito === 'escaner'),
    [decHook.data],
  );

  const hallazgos = uM(() => {
    // El universo: el grupo entero, o solo esta empresa. Ojo: intercompany
    // NECESITA los dos lados, así que con el filtro puesto se acota DESPUÉS de
    // escanear, no antes — si no, todo saldría como «sin espejo».
    const todos = escanear(movs, { companies });
    const conDec = aplicarDecisionesEscaner(todos, decisiones);
    const porEmpresa = soloEmpresa && company?.id
      ? conDec.filter(h => h.companyId === company.id)
      : conDec;
    return familia === 'todas' ? porEmpresa : porEmpresa.filter(h => h.familia === familia);
  }, [movs, companies, decisiones, soloEmpresa, company?.id, familia]);

  const pendientes = uM(() => hallazgosPendientes(hallazgos), [hallazgos]);
  const resumen = uM(() => resumirHallazgos(pendientes), [pendientes]);

  const decidir = async (h, decision) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try {
      await decidirCotejo({
        ambito: 'escaner', llave: h.id, decision,
        companyId: h.companyId, estado: h.regla, documento: h.documento, monto: h.monto,
      }, userId);
    } finally { enCursoRef.current = false; }
  };

  const exportar = () => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const cols = ['Familia', 'Gravedad', 'Regla', 'Comprobante', 'Fecha', 'Tercero', 'RUC', 'Monto', 'Qué pasa'];
    const filas = hallazgos.map(h => [
      FAMILIAS[h.familia] || h.familia, h.gravedad, h.regla, h.documento, h.fecha,
      h.terceroNombre, h.terceroRuc, h.monto, h.detalle,
    ]);
    descargarTexto(
      `escaner-incoherencias-${new Date().toISOString().slice(0, 10)}.csv`,
      [cols.map(esc).join(','), ...filas.map(f => f.map(esc).join(','))].join('\n'),
    );
    showToast?.(`${filas.length} hallazgo(s) exportados.`, 'green');
  };

  return (
    <div>
      <div className="card card-p" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="fi" style={{ maxWidth: 260 }} value={familia} onChange={e => setFamilia(e.target.value)}>
          <option value="todas">Todas las familias</option>
          {Object.entries(FAMILIAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={soloEmpresa}
            disabled={!!empresaFija}
            onChange={e => setSoloEmpresa(e.target.checked)}
          />
          Solo {company?.name || 'esta empresa'}
        </label>
        <button className="btn" onClick={exportar} disabled={!hallazgos.length}>Exportar (.csv)</button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 12 }}>
          <span style={{ color: '#d33' }}>● {resumen.porGravedad.alta} graves</span>
          <span style={{ color: 'var(--orange)' }}>● {resumen.porGravedad.media} medias</span>
          <span style={{ color: 'var(--tm)' }}>● {resumen.porGravedad.baja} leves</span>
          <strong>{fmtS(resumen.monto)} en juego</strong>
        </div>
      </div>

      {pendientes.length === 0 ? (
        <div className="card card-p" style={{ padding: 24, textAlign: 'center', color: 'var(--tm)' }}>
          ✓ No hay incoherencias pendientes
          {familia !== 'todas' ? ' en esta familia' : ''}
          {soloEmpresa ? ` en ${company?.name || 'esta empresa'}` : ' en todo el grupo'}.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {pendientes.map(h => (
            <div key={h.id} className="card card-p" style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 6, alignSelf: 'stretch', borderRadius: 3, background: COLOR_GRAVEDAD[h.gravedad] }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong>{h.titulo}</strong>
                  <span style={{ fontSize: 11, color: 'var(--tm)' }}>{FAMILIAS[h.familia]}</span>
                  {h.monto ? <span style={{ fontSize: 12, fontWeight: 700 }}>{fmtS(h.monto)}</span> : null}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{h.detalle}</div>
                <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>
                  {h.documento || 's/n'} · {h.fecha || 'sin fecha'} · {h.terceroNombre || 'sin tercero'}
                </div>
              </div>
              <div style={{ whiteSpace: 'nowrap' }}>
                <button className="btn btn-sm" onClick={() => decidir(h, 'revisada')}>Ya la vi</button>
                <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => decidir(h, 'no_aplica')}>No aplica</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {hallazgos.some(h => h.decision) && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 6 }}>
            Ya decididas ({hallazgos.filter(h => h.decision).length})
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            {hallazgos.filter(h => h.decision).map(h => (
              <div key={h.id} className="card card-p" style={{ padding: 8, display: 'flex', gap: 10, alignItems: 'center', opacity: 0.6, fontSize: 12 }}>
                <span style={{ flex: 1 }}>{h.titulo} · {h.documento || 's/n'}</span>
                <span>{h.decision === 'no_aplica' ? 'no aplica' : 'revisada'}</span>
                <button className="btn btn-sm" onClick={() => decidir(h, null)}>Deshacer</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ComparativaSunat;
