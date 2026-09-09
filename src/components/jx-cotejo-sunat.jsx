// ═══════════════════════════════════════════════════════════════════
// JARVEX — SUNAT CONTRA JARVEX + EL ESCÁNER (tanda 14, entregas 5 y 6;
// tanda 18, entrega B).
//
// Se monta como dos pestañas DENTRO de Libros Electrónicos, que ya tiene el
// ámbito exacto que hace falta —empresa + año + mes— y es donde la contadora
// ya entra a hacer justamente esto. Una pantalla nueva en el menú habría
// partido en dos un mismo trabajo.
//
// NO se importa con `import()` dinámico: lo trae `jx-libros-electronicos.jsx`
// con un import estático y viaja en su mismo chunk (regla 1 del CLAUDE.md).
//
// ── LO QUE CAMBIÓ EL 9-SET-2026 (entrega B) ───────────────────────
// Gabriel cargó los dos CSV de julio, cambió de pestaña y se le borró todo.
// Y del escáner: «no tiene botón para analizar nuevamente. No propone
// soluciones». Las tres cosas eran la misma falta —una pantalla que mira y no
// deja hacer nada— y se arreglan así:
//   · EL CORTE VIVE EN LA BASE, no en el estado del componente. Las filas del
//     CSV se guardan con el corte (mig 202) y la pestaña se rearma sola al
//     volver, en esta PC y en la otra.
//   · EL 👁 A LA FACTURA REAL en cada diferencia y en cada hallazgo. 1.271 de
//     los 1.424 movimientos vivos tienen su comprobante cargado: la serie
//     «incorrecta» casi siempre se resuelve mirando el papel.
//   · SOLUCIONES QUE SE APLICAN: crear la compra espejo que falta, y enlazar
//     una nota de crédito huérfana a la factura que rebaja.
//
// La lógica no está acá. Está en las libs puras con tests:
//   · `sunat-csv.js`             — leer los CSV rotos de SUNAT y podarlos
//   · `comparativa-sunat.js`     — el cruce y sus estados
//   · `escaner-incoherencias.js` — las cuatro familias
//   · `interco-espejo.js`        — qué venta interna no tiene su espejo
//   · `notas-credito.js`         — a qué factura puede apuntar una nota
//   · `cotejo-sunat-db.js`       — el aterrizaje en Dexie
// Acá solo está la pantalla.
// ═══════════════════════════════════════════════════════════════════
import React from 'react';
import { parseCsvSunat, leerArchivoSunat } from '../lib/sunat-csv.js';
import {
  compararLibro, aplicarDecisiones, filasPendientes, exportarComparativaCsv,
  ETIQUETA_ESTADO, ESTADOS_PENDIENTES,
} from '../lib/comparativa-sunat.js';
import {
  escanear, resumirHallazgos, aplicarDecisionesEscaner, hallazgosPendientes,
  FAMILIAS,
} from '../lib/escaner-incoherencias.js';
import { guardarCorte, borrarCorte, decidirCotejo, decidirCotejoLote } from '../lib/cotejo-sunat-db.js';
import { evidenciasDeComprobantes } from '../lib/evidencia-de-comprobante.js';
import { getEvidenciaSrc, abrirUrlEvidencia, precargarEvidencia } from '../lib/evidencias-url.js';
import { ventasSinEspejo, datosDelEspejo } from '../lib/interco-espejo.js';
import { candidatasDeNota } from '../lib/notas-credito.js';
import { esVentaMov } from '../lib/costo-obra.js';
import { getCurrentMode } from '../lib/app-mode-core.js';

const { useState: uS, useMemo: uM, useRef: uR, useEffect: uE } = React;

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periodoDe = (anio, mes) => `${anio}${String(mes).padStart(2, '0')}`;
const fmtFechaHora = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('es-PE', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(iso).slice(0, 16).replace('T', ' '); }
};

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

// ── El 👁: el mismo botón en las dos pestañas ─────────────────────
// Solo aparece cuando el comprobante TIENE archivo cargado (el mapa no trae a
// los que no lo tienen): un ojo que después dice «no hay nada» enseña a no
// hacerle caso al ojo. Se precalienta la firma al pasar el mouse — cuando llega
// el clic, el archivo ya abre de una.
function OjoComprobante({ entry, onAbrir, titulo = 'Ver la factura cargada' }) {
  if (!entry) return null;
  return (
    <button
      className="btn btn-sm"
      title={`${titulo} (${entry.nombre})`}
      onMouseEnter={() => precargarEvidencia(entry.ev)}
      onClick={() => onAbrir(entry)}
      style={{ padding: '2px 8px' }}
    >
      {typeof window !== 'undefined' && window.JxIcon
        ? React.createElement(window.JxIcon, { name: 'eye', size: 12 })
        : '👁'}
    </button>
  );
}

/**
 * Abre el archivo de un comprobante. Firma la URL recién acá —un viaje, el del
 * archivo que de verdad se va a mirar— y la abre en una pestaña aparte, que es
 * lo que sirve para comparar contra la tabla que quedó atrás.
 */
async function abrirEvidencia(entry, showToast) {
  try {
    const src = await getEvidenciaSrc(entry?.ev);
    if (!src?.url) { showToast?.('No se pudo abrir el archivo. Si acaba de subirse, probá en un minuto.', 'red'); return; }
    await abrirUrlEvidencia(src.url);
  } catch (e) {
    showToast?.('No se pudo abrir el comprobante: ' + (e?.message || e), 'red');
  }
}

/** Hook chico: el archivo de cada comprobante de una lista de ids. */
function useEvidencias(ids) {
  const [mapa, setMapa] = uS(() => new Map());
  // La lista de ids se recalcula en cada render; la CLAVE (ordenada y pegada)
  // no. Sin esto el efecto se volvería a disparar en cada recálculo del cruce.
  const clave = uM(() => [...new Set((ids || []).filter(Boolean))].sort().join(','), [ids]);
  uE(() => {
    let cancel = false;
    (async () => {
      const m = await evidenciasDeComprobantes(clave ? clave.split(',') : []);
      if (!cancel) setMapa(m);
    })();
    return () => { cancel = true; };
  }, [clave]);
  return mapa;
}

// ═══════════════════════════════════════════════════════════════════
// PESTAÑA 1 — SUNAT CONTRA JARVEX
// ═══════════════════════════════════════════════════════════════════
export function ComparativaSunat({ company, companies, movs, anio, mes, showToast, userId }) {
  const periodo = periodoDe(anio, mes);
  const [filtro, setFiltro] = uS('pendientes');
  const [busy, setBusy] = uS(false);
  const enCursoRef = uR(false);              // guard SÍNCRONO (regla 2)
  const inputRef = uR(null);

  const decHook = window.__hooks?.useCotejoDecisiones?.() || { data: [] };
  const decisiones = uM(
    () => (decHook.data || []).filter(d => d.ambito === 'comparativa'),
    [decHook.data],
  );

  // ── EL CORTE VIVE EN LA BASE ────────────────────────────────────
  // Antes los CSV vivían en un `useState` de este componente: cambiar de
  // pestaña desmontaba la pantalla y se llevaba puesto el trabajo. Ahora la
  // única fuente es `sunat_cortes` (mig 202, con las filas adentro), así que
  // volver a entrar —o entrar desde la otra PC después de sincronizar— muestra
  // exactamente lo mismo.
  const cortesHook = window.__hooks?.useSunatCortes?.() || { data: [] };
  const cortes = uM(() => {
    const out = {};
    const mios = (cortesHook.data || []).filter(c =>
      c && !c.deleted_at && c.company_id === company?.id && String(c.periodo) === periodo);
    for (const libro of ['compras', 'ventas']) {
      const vivo = mios
        .filter(c => c.libro === libro)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
      if (!vivo) continue;
      out[libro] = {
        id: vivo.id,
        filas: Array.isArray(vivo.filas) ? vivo.filas : [],
        avisos: Array.isArray(vivo.avisos_detalle) ? vivo.avisos_detalle : [],
        avisosN: vivo.avisos || 0,
        archivo: vivo.archivo || '',
        cargadoAt: vivo.created_at || null,
        filasArchivo: vivo.filas_archivo || 0,
      };
    }
    return out;
  }, [cortesHook.data, company?.id, periodo]);

  // El cruce se recalcula solo: las filas ya están en memoria y los movimientos
  // vienen del hook, así que si alguien carga una factura que faltaba, la
  // pantalla lo refleja sin volver a subir el archivo.
  const resultados = uM(() => {
    const out = {};
    for (const libro of ['compras', 'ventas']) {
      const c = cortes[libro];
      if (!c || !c.filas.length) continue;
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

  // El archivo de cada comprobante que SÍ está en JARVEX (los `solo_sunat` no
  // tienen movimiento, así que tampoco tienen papel que mirar acá).
  const evidencias = useEvidencias(uM(() => todas.map(f => f.movimientoId), [todas]));
  const abriendoRef = uR(false);
  const abrir = async (entry) => {
    if (abriendoRef.current) return;
    abriendoRef.current = true;
    try { await abrirEvidencia(entry, showToast); } finally { abriendoRef.current = false; }
  };

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

      const { resumen } = compararLibro(r.filas, movs, {
        companyId: company?.id, libro: r.libro, periodo, companies,
      });
      // Las FILAS van adentro del corte: es lo único que la app no puede
      // recalcular sola (mig 202). Guardar esto es lo que hace que la pestaña
      // sobreviva a cambiar de pestaña, cerrar la app o cambiar de PC.
      await guardarCorte({
        companyId: company?.id, periodo, libro: r.libro, archivo: file.name,
        resumen, filas: r.filas, avisosDetalle: r.avisos,
        filasArchivo: r.filas.length, avisos: r.avisos.length,
      }, userId);

      const aviso = r.avisos.length
        ? ` ⚠️ ${r.avisos.length} línea(s) no se pudieron leer.`
        : '';
      showToast?.(`${r.libro === 'compras' ? 'Compras' : 'Ventas'}: ${r.filas.length} comprobantes de SUNAT, guardados.${aviso}`, r.avisos.length ? 'amber' : 'green');
    } catch (e) {
      console.error('[cotejo-sunat]', e);
      showToast?.('No se pudo leer el archivo: ' + e.message, 'red');
    } finally {
      setBusy(false);
      enCursoRef.current = false;
      if (inputRef.current) inputRef.current.value = '';   // permitir recargar el mismo
    }
  };

  // Volver a cotejar: el archivo es el mismo, lo que cambió son los
  // movimientos. Recalcula y REESCRIBE el resumen guardado, para que el corte
  // de la base diga lo que la pantalla está mostrando y no lo de la semana
  // pasada.
  const recotejar = async (libro) => {
    const c = cortes[libro];
    if (!c || !c.filas.length || enCursoRef.current) return;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const { resumen } = compararLibro(c.filas, movs, {
        companyId: company?.id, libro, periodo, companies,
      });
      await guardarCorte({
        companyId: company?.id, periodo, libro, archivo: c.archivo,
        resumen, filas: c.filas, avisosDetalle: c.avisos,
        filasArchivo: c.filasArchivo || c.filas.length, avisos: c.avisosN,
      }, userId);
      showToast?.(`${libro === 'compras' ? 'Compras' : 'Ventas'}: cotejado de nuevo · ${resumen.cuadran} de ${resumen.total} cuadran.`, 'green');
    } catch (e) {
      showToast?.('No se pudo volver a cotejar: ' + (e?.message || e), 'red');
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  const quitarCorte = async (libro) => {
    const c = cortes[libro];
    if (!c || enCursoRef.current) return;
    if (!confirm(`¿Sacar el archivo de ${libro} de ${periodo}?\n\nSe borra el corte cargado, no los movimientos. Las diferencias que ya marcaste se conservan.`)) return;
    enCursoRef.current = true;
    try {
      await borrarCorte(c.id, userId);
      showToast?.('Corte quitado. Podés cargar el CSV de nuevo.', 'green');
    } catch (e) {
      showToast?.('No se pudo quitar el corte: ' + (e?.message || e), 'red');
    } finally { enCursoRef.current = false; }
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
  // Cortes guardados por una versión anterior a la mig 202: tienen el resumen
  // pero no las filas. Se dicen con todas las letras en vez de mostrar una
  // tabla vacía que parecería un mes sin diferencias.
  const sinDetalle = ['compras', 'ventas'].filter(l => cortes[l] && !cortes[l].filas.length);

  return (
    <div>
      {/* Carga de los dos archivos */}
      <div className="card card-p" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Cargá los CSV que bajaste de SUNAT</div>
        <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 12 }}>
          El de <strong>ventas</strong> (export del RVIE, empieza con «LE…») y el de <strong>compras</strong>
          {' '}(la propuesta del RCE, termina en «-propuesta.csv»). El archivo dice solo de qué RUC y de qué mes es:
          si no coincide con {company?.name || 'la empresa'} y {periodo}, se avisa y no se carga.
          {' '}Quedan <strong>guardados</strong>: podés cambiar de pestaña y volver, y siguen acá.
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
        <div style={{ display: 'grid', gap: 8, marginTop: 12, fontSize: 12 }}>
          {['compras', 'ventas'].map(l => {
            const c = cortes[l];
            const nombre = l === 'compras' ? 'Compras' : 'Ventas';
            if (!c) return (
              <div key={l} style={{ color: 'var(--tm)' }}>○ {nombre} · sin cargar</div>
            );
            return (
              <div key={l} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ color: c.filas.length ? 'var(--green)' : 'var(--orange)' }}>
                  {c.filas.length ? '✓' : '⚠'} {nombre}
                  {c.filas.length
                    ? ` · ${c.filas.length} comprobantes`
                    : ' · guardado sin el detalle (versión anterior): volvé a cargar el CSV'}
                </span>
                {c.archivo ? <span style={{ color: 'var(--tm)' }}>· {c.archivo}</span> : null}
                {c.cargadoAt ? <span style={{ color: 'var(--tm)' }}>· cargado {fmtFechaHora(c.cargadoAt)}</span> : null}
                {c.avisosN ? (
                  <span style={{ color: '#d33' }}>· ⚠️ {c.avisosN} línea(s) ilegibles</span>
                ) : null}
                {c.filas.length ? (
                  <button className="btn btn-sm" disabled={busy} onClick={() => recotejar(l)}>Volver a cotejar</button>
                ) : null}
                <button className="btn btn-sm" disabled={busy} onClick={() => quitarCorte(l)}>Quitar</button>
              </div>
            );
          })}
        </div>
        {sinDetalle.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--orange)' }}>
            Los cortes de {sinDetalle.join(' y ')} se guardaron cuando la app todavía no guardaba el archivo:
            quedó el resumen y no la lista. Cargá el CSV de nuevo y esta vez se conserva completo.
          </div>
        )}
        {['compras', 'ventas'].map(l => (cortes[l]?.avisos?.length ? (
          <details key={l} style={{ marginTop: 10, fontSize: 12 }}>
            <summary style={{ cursor: 'pointer', color: '#d33' }}>
              {l === 'compras' ? 'Compras' : 'Ventas'}: {cortes[l].avisosN} línea(s) del archivo que no se pudieron leer
            </summary>
            <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
              {cortes[l].avisos.map((a, i) => (
                <div key={i} style={{ color: 'var(--tm)' }}>
                  línea {a.linea} · {a.motivo}: <code>{a.texto}</code>
                </div>
              ))}
            </div>
          </details>
        ) : null))}
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
                          en JARVEX está como {f.appDocumento} — mirá la factura para decidir
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
                      {/* El papel, antes que cualquier botón: casi siempre es lo
                          que decide si la diferencia existe o no aplica. */}
                      <OjoComprobante entry={evidencias.get(f.movimientoId)} onAbrir={abrir} />
                      {f.estado === 'cuadra' ? null : f.decision ? (
                        <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => decidir(f, null)}>Deshacer</button>
                      ) : (
                        <>
                          <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => decidir(f, 'revisada')}>Ya la vi</button>
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
  const abriendoRef = uR(false);

  // «No tiene botón para analizar nuevamente» (Gabriel, 9-set-2026). El escáner
  // ya se recalculaba solo con cada cambio de datos, pero eso es invisible: no
  // había forma de decirle «volvé a mirar ahora que corregí» ni de saber cuándo
  // fue la última vez. `corrida` fuerza el recálculo y además sincroniza antes,
  // que es lo que hace falta cuando lo corregido se cargó en la otra PC.
  const [corrida, setCorrida] = uS(0);
  const [ultimaCorrida, setUltimaCorrida] = uS(null);
  const [analizando, setAnalizando] = uS(false);

  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol || '';
  const canWrite = rol === 'admin' || (window.__hasPerm?.(rol, 'Movs. Contables', 'w') ?? false);

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
    // `corrida` está en las deps a propósito: es el botón «analizar de nuevo».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movs, companies, decisiones, soloEmpresa, company?.id, familia, corrida]);

  const pendientes = uM(() => hallazgosPendientes(hallazgos), [hallazgos]);
  const resumen = uM(() => resumirHallazgos(pendientes), [pendientes]);

  const movsPorId = uM(() => new Map((movs || []).map(m => [m.id, m])), [movs]);
  const evidencias = useEvidencias(uM(() => pendientes.map(h => h.movimientoId), [pendientes]));

  // ── LAS SOLUCIONES ──────────────────────────────────────────────
  // 1) La compra espejo que falta. Se propone SOLO cuando `ventasSinEspejo` —la
  //    misma lib que usa Movimientos y Órdenes— dice que se puede: una venta
  //    interna, viva, no anulada, contra una empresa del grupo. El escáner
  //    marca también compras marcadas interco sin su venta del otro lado, y esa
  //    no se crea sola: el otro lado sería una VENTA, que lleva correlativo
  //    propio y se emite, no se fabrica desde acá.
  const espejables = uM(() => {
    const m = new Map();
    for (const e of ventasSinEspejo(movs || [], { companies: companies || [] })) m.set(e.venta.id, e);
    return m;
  }, [movs, companies]);

  // 2) La factura a la que puede apuntar una nota huérfana.
  const candidatasPorNota = uM(() => {
    const m = new Map();
    for (const h of pendientes) {
      if (h.regla !== 'nota_huerfana') continue;
      const nota = movsPorId.get(h.movimientoId);
      if (nota) m.set(h.id, candidatasDeNota(nota, movs || []));
    }
    return m;
  }, [pendientes, movsPorId, movs]);

  // Qué factura eligió la persona para cada nota (por defecto, la primera
  // propuesta: la del importe exacto si la hay).
  const [elegida, setElegida] = uS({});

  const nombreEmpresa = uM(
    () => new Map((companies || []).map(c => [c.id, c.name])),
    [companies],
  );

  const reanalizar = async () => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setAnalizando(true);
    try {
      // Lo corregido puede haberse cargado en la otra PC: bajarlo primero es
      // parte de «analizar de nuevo». Si no hay red, se analiza igual con lo
      // que hay — nunca se bloquea el botón por eso.
      try {
        if (window.__syncAll) await window.__syncAll();
        else if (window.__sync?.sync) await window.__sync.sync();
      } catch { /* sin red: se analiza igual con lo que hay */ }
      setCorrida(c => c + 1);
      setUltimaCorrida(new Date());
      showToast?.('Listo: se volvió a revisar todo.', 'green');
    } finally {
      setAnalizando(false);
      enCursoRef.current = false;
    }
  };

  const abrir = async (entry) => {
    if (abriendoRef.current) return;
    abriendoRef.current = true;
    try { await abrirEvidencia(entry, showToast); } finally { abriendoRef.current = false; }
  };

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

  /**
   * Crear la compra espejo de una venta interna. Mismo contrato que el botón de
   * Movimientos y el de Órdenes: `datosDelEspejo()` es la única fuente de esos
   * campos, confirmación explícita —crear un costo en el libro de otra empresa
   * es plata— y guard SÍNCRONO, porque el doble clic duplicaría una factura.
   */
  const crearEspejo = async (h) => {
    if (enCursoRef.current) return;
    if (!canWrite) { showToast?.('No tenés permiso para cargar comprobantes.', 'red'); return; }
    const e = espejables.get(h.movimientoId);
    if (!e) return;
    const comprador = nombreEmpresa.get(e.compradorId) || 'la otra empresa';
    if (!confirm(
      `¿Cargar la compra espejo de ${e.documento} en el libro de ${comprador}?\n\n`
      + `${e.moneda === 'USD' ? 'US$' : 'S/'} ${Number(e.monto || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}\n\n`
      + 'Es el mismo comprobante visto del otro lado. No se toca la venta.'
    )) return;
    enCursoRef.current = true;
    try {
      const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
      const marcaModo = esPrueba ? { demo: true, sync_status: 'synced' } : { sync_status: 'pending_create' };
      const espId = window.__newId();
      const now = new Date().toISOString();
      await window.__db.accounting_movements.add({
        id: espId,
        ...datosDelEspejo(e.venta, {
          vendedora: (companies || []).find(c => c.id === e.vendedorId) || null,
          compradora: (companies || []).find(c => c.id === e.compradorId) || null,
        }),
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, last_synced_at: null, ...marcaModo,
        idempotency_key: `${userId}_acc_${espId}`,
      });
      // NO se enlaza la venta → espejo desde este lado: el par con
      // `related_movement_id` mutuo y las dos patas sin subir se traba en el
      // gate de FK del push (mismo motivo que en Captura Mágica y en Órdenes).
      try {
        await window.__logAudit?.({
          action: 'insert', table: 'accounting_movements', recordId: espId,
          newData: { espejo_de: e.venta.id, doc: e.documento, comprador: e.compradorId },
          reason: 'Escáner de incoherencias · compra espejo de una venta interna que no la tenía',
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      showToast?.(`✓ Compra espejo cargada en el libro de ${comprador}.`, 'green');
    } catch (err) {
      showToast?.('No se pudo crear el espejo: ' + (err?.message || err), 'red');
    } finally { enCursoRef.current = false; }
  };

  /**
   * Enlazar una nota de crédito huérfana a la factura que rebaja.
   *
   * Es un solo campo (`related_movement_id`) y sin embargo es la diferencia
   * entre una nota que no descuenta nada y una factura correctamente rebajada
   * o anulada en todos los reportes. La app NO elige por su cuenta: propone las
   * candidatas y la persona confirma contra el PDF.
   */
  const enlazarNota = async (h) => {
    if (enCursoRef.current) return;
    if (!canWrite) { showToast?.('No tenés permiso para editar comprobantes.', 'red'); return; }
    const cands = candidatasPorNota.get(h.id) || [];
    const facturaId = elegida[h.id] || cands[0]?.id;
    const factura = cands.find(c => c.id === facturaId);
    if (!factura) return;
    if (!confirm(
      `¿Enlazar la nota ${h.documento || 's/n'} a la factura ${factura.documento}?\n\n`
      + `Factura del ${factura.fecha} por ${fmtS(factura.monto)}.\n\n`
      + 'La nota va a rebajar esa factura en todos los reportes. Verificá contra el PDF.'
    )) return;
    enCursoRef.current = true;
    try {
      const fresh = await window.__db.accounting_movements.get(h.movimientoId);
      if (!fresh) { showToast?.('La nota no está en este dispositivo — sincronizá.', 'red'); return; }
      await window.__db.accounting_movements.update(h.movimientoId, {
        related_movement_id: facturaId,
        updated_at: new Date().toISOString(), updated_by: userId,
        version: (fresh.version ?? 0) + 1,
        sync_status: fresh.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      try {
        await window.__logAudit?.({
          action: 'update', table: 'accounting_movements', recordId: h.movimientoId,
          newData: { related_movement_id: facturaId },
          reason: `Escáner de incoherencias · nota ${h.documento || 's/n'} enlazada a la factura ${factura.documento}`,
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      showToast?.(`✓ ${h.documento || 'La nota'} quedó enlazada a ${factura.documento}.`, 'green');
    } catch (err) {
      showToast?.('No se pudo enlazar la nota: ' + (err?.message || err), 'red');
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
        <button className="btn btn-amber" onClick={reanalizar} disabled={analizando}>
          {analizando ? 'Analizando…' : '↻ Analizar de nuevo'}
        </button>
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
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 12, alignItems: 'center' }}>
          {ultimaCorrida && (
            <span style={{ color: 'var(--tm)' }}>última corrida {fmtFechaHora(ultimaCorrida.toISOString())}</span>
          )}
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
          {pendientes.map(h => {
            const espejable = h.regla === 'intercompany_sin_espejo' && espejables.has(h.movimientoId);
            const cands = candidatasPorNota.get(h.id) || [];
            return (
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

                  {/* La solución, cuando la app puede proponer una de verdad */}
                  {espejable && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-amber" onClick={() => crearEspejo(h)} disabled={!canWrite}>
                        Crear la compra espejo en {h.empresaEsperada}
                      </button>
                      <span style={{ fontSize: 11, color: 'var(--tm)' }}>
                        Es el mismo comprobante del otro lado: no se duplica nada, se completa el par.
                      </span>
                    </div>
                  )}
                  {h.regla === 'intercompany_sin_espejo' && !espejable && (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--tm)' }}>
                      {esVentaMov(movsPorId.get(h.movimientoId))
                        ? `El espejo automático es para una venta interna enlazada a una empresa del grupo. Ésta no lo está (o la contraparte figura como tercero en el catálogo): revisala en Movimientos Contables.`
                        : `Acá el otro lado sería una VENTA de ${h.empresaEsperada}: lleva su propio correlativo y se emite, así que no se fabrica desde esta pantalla.`}
                    </div>
                  )}
                  {h.regla === 'factura_anulada_viva' && (
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--tm)' }}>
                      Se arregla en Movimientos Contables: en la fila de la factura, el estado de pago
                      pasa a «✗ Anulado». No se hace desde acá porque dar de baja una factura mueve
                      todos los reportes de esa empresa.
                    </div>
                  )}
                  {h.regla === 'nota_huerfana' && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {cands.length === 0 ? (
                        <span style={{ fontSize: 11, color: 'var(--tm)' }}>
                          No hay ninguna factura de ese proveedor, anterior a la nota y con importe suficiente:
                          hay que buscarla a mano en Movimientos.
                        </span>
                      ) : (
                        <>
                          <select
                            className="fi"
                            style={{ maxWidth: 320, fontSize: 12 }}
                            value={elegida[h.id] || cands[0].id}
                            onChange={e => setElegida(p => ({ ...p, [h.id]: e.target.value }))}
                          >
                            {cands.map(c => (
                              <option key={c.id} value={c.id}>
                                {c.documento} · {c.fecha} · {fmtS(c.monto)}{c.exacta ? ' · mismo importe' : ''}
                              </option>
                            ))}
                          </select>
                          <button className="btn btn-sm btn-amber" onClick={() => enlazarNota(h)} disabled={!canWrite}>
                            Enlazar a esta factura
                          </button>
                          <span style={{ fontSize: 11, color: 'var(--tm)' }}>
                            {cands.length === 1 ? 'Una sola candidata' : `${cands.length} candidatas`} · verificá contra el PDF.
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div style={{ whiteSpace: 'nowrap' }}>
                  <OjoComprobante entry={evidencias.get(h.movimientoId)} onAbrir={abrir} />
                  <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => decidir(h, 'revisada')}>Ya la vi</button>
                  <button className="btn btn-sm" style={{ marginLeft: 4 }} onClick={() => decidir(h, 'no_aplica')}>No aplica</button>
                </div>
              </div>
            );
          })}
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
