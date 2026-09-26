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
import {
  sePuedeDarDeAlta, borradorDesdeFila, movimientoDesdeCorte, avisosDelBorrador,
} from '../lib/alta-desde-sunat.js';
import { evidenciasDeComprobantes } from '../lib/evidencia-de-comprobante.js';
import { OjoComprobante, useVisorComprobante } from './jx-visor-comprobante.jsx';
import { ventasSinEspejo, datosDelEspejo } from '../lib/interco-espejo.js';
import { candidatasDeNota } from '../lib/notas-credito.js';
import { movimientosConParRegistrado, puedeEditarMovimiento, puedeEliminarMovimiento } from '../lib/interco-edicion.js';
import { esVentaMov } from '../lib/costo-obra.js';
import { getCurrentMode } from '../lib/app-mode-core.js';
import { setEmpresaActivaId } from '../lib/empresa-activa.js';
import { enPeriodo, fmtFechaCorta } from '../lib/fecha.js';

const { useState: uS, useMemo: uM, useRef: uR, useEffect: uE } = React;

// Para decir el ámbito del escáner en palabras cuando se lo abre por período.
const MESES_ESCANER = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','setiembre','octubre','noviembre','diciembre'];

/**
 * Abre el comprobante en Movimientos Contables con foco en la fila y el modal
 * de edición directamente abierto para reparar la serie u otro dato.
 */
const irAEditarMovimiento = (companyId, movId, doc) => {
  if (companyId) {
    try { setEmpresaActivaId(companyId); } catch {}
  }
  window.__movFocoIntent = { id: movId || null, doc: doc || null, autoEdit: true };
  window.__navTo?.('movimientos-contables', 'general');
};

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** El importe con SU moneda: los comprobantes de KOPLAST son en dólares y
 *  escribirles «S/» adelante es exactamente lo que hacía parecer que el cruce
 *  estaba mal por S/ 199.600. */
const fmtMoneda = (n, moneda) => {
  const m = String(moneda || 'PEN').trim().toUpperCase();
  const simbolo = m === 'PEN' ? 'S/' : m === 'USD' ? 'US$' : m;
  return `${simbolo} ` + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
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
  sunat_otro_periodo: 'var(--purple, #8b5cf6)',
  fecha_distinta: 'var(--tm)',
  ruc_distinto: 'var(--amber, #d97706)',
  duplicado_jarvex: '#d33',
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
// hacerle caso al ojo.
//
// `OjoComprobante` y el visor viven en `jx-visor-comprobante.jsx` (22-set,
// pedido de Gabriel: «quiero los ojos como de Movimientos Contables, que te
// abren el comprobante en una ventana en la misma aplicación» — acá abría en
// una pestaña del navegador, y no era el único lugar). Es el MISMO archivo
// que usan ahora el Registro de Compras y Ventas y Anticipos: un ojo que
// abriera distinto en cada pantalla sería peor que no compartirlo.

/** Hook chico: el archivo de cada comprobante de una lista de ids. */
export function useEvidencias(ids) {
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
  const [filtroLibro, setFiltroLibro] = uS('todos');
  const [busy, setBusy] = uS(false);
  const enCursoRef = uR(false);              // guard SÍNCRONO (regla 2)
  const inputRef = uR(null);

  // ── EL ALTA DE LO QUE FALTA (23-set-2026) ───────────────────────
  // La pantalla era de SOLO LECTURA por decisión de Gabriel (8-set) y para el
  // caso normal lo sigue siendo: lo que falta se carga por Captura Mágica con
  // el PDF, que es lo único que trae el detalle. Lo que apareció después es el
  // caso donde NO HAY PDF: las dos facturas del BANCO DE CRÉDITO de enero-2026
  // que el portal de SUNAT no deja descargar, y sin las cuales el total de NO
  // GRAVADAS del Registro de Compras no cuadra. La regla y su excepción viven
  // documentadas en `alta-desde-sunat.js`; acá solo está la ventana.
  const [altaBorrador, setAltaBorrador] = uS(null);   // { fila, libro, b } | null
  const rolCotejo = (() => { try { return window.__useAuth?.()?.profile?.rol; } catch { return null; } })();
  // El permiso es el de MOVIMIENTOS CONTABLES, no el de Libros Electrónicos:
  // lo que se crea acá es un movimiento contable. Es lo que hace que la
  // asistente (que tiene 'w' ahí y 'r' acá) pueda dar de alta lo que encuentra.
  const puedeAlta = rolCotejo === 'admin' || (window.__hasPerm?.(rolCotejo, 'Movs. Contables', 'w') ?? false);
  const { data: obrasCotejo = [] } = window.__hooks?.useObras?.() || { data: [] };

  const decHook = window.__hooks?.useCotejoDecisiones?.() || { data: [] };
  const decisiones = uM(
    () => (decHook.data || []).filter(d => d.ambito === 'comparativa'),
    [decHook.data],
  );

  // ── EL REGISTRO DE LO QUE YA REVISASTE ──────────────────────────
  // 🔴 Gabriel (13-set-2026): «los botones de "aplica" o "ya lo vi", ¿para qué
  // sirven? La idea es que se guarde eso también… pero no veo una sección
  // donde se guarde eso que corregí o acepté».
  //
  // Se guardaba desde siempre —19 decisiones vivas en `cotejo_decisiones` al
  // 13-set— pero sólo se podían ver desde adentro del mes que las originó y
  // eligiendo «Ya decididas» en un desplegable. Si el corte de ese mes se
  // quitaba, o se estaba parado en otro mes, el trabajo era invisible: parecía
  // que el botón no guardaba nada. Ahora hay un registro propio, de TODOS los
  // meses de esta empresa, que no depende de que haya un CSV cargado.
  const [verRegistro, setVerRegistro] = uS(false);
  const registro = uM(() => decisiones
    .filter(d => !d.company_id || d.company_id === company?.id)
    .slice()
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))),
  [decisiones, company?.id]);

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

  // Cortes de OTROS períodos cargados para esta empresa (para cotejo inteligente multi-período).
  const otrosCortes = uM(() => {
    return (cortesHook.data || []).filter(c =>
      c && !c.deleted_at && c.company_id === company?.id && String(c.periodo) !== periodo && Array.isArray(c.filas) && c.filas.length > 0
    );
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
        companyId: company?.id, libro, periodo, companies, otrosCortes,
      });
      out[libro] = { ...c, filas: aplicarDecisiones(filas, decisiones), resumen };
    }
    return out;
  }, [cortes, movs, company?.id, periodo, companies, decisiones, otrosCortes]);

  const todas = uM(
    () => [...(resultados.compras?.filas || []), ...(resultados.ventas?.filas || [])],
    [resultados],
  );

  const nCompras = uM(() => todas.filter(f => f.libro === 'compras').length, [todas]);
  const nVentas = uM(() => todas.filter(f => f.libro === 'ventas').length, [todas]);

  const basePorLibro = uM(() => {
    if (filtroLibro === 'compras') return todas.filter(f => f.libro === 'compras');
    if (filtroLibro === 'ventas') return todas.filter(f => f.libro === 'ventas');
    return todas;
  }, [todas, filtroLibro]);

  // El archivo de cada comprobante que SÍ está en JARVEX (los `solo_sunat` no
  // tienen movimiento, así que tampoco tienen papel que mirar acá).
  const evidencias = useEvidencias(uM(() => todas.map(f => f.movimientoId), [todas]));
  // Abre el comprobante EN LA APP (22-set): el visor es un modal, así que no
  // hace falta el guard de doble-click de antes (armar el mismo `entry` dos
  // veces seguidas es inofensivo — el useEffect del visor recién firma al
  // montar).
  const { abrirComprobante: abrir, visorModal } = useVisorComprobante();

  const visibles = uM(() => {
    if (filtro === 'todas') return basePorLibro;
    if (filtro === 'pendientes') return filasPendientes(basePorLibro);
    if (filtro === 'decididas') return basePorLibro.filter(f => f.decision);
    return basePorLibro.filter(f => f.estado === filtro);
  }, [basePorLibro, filtro]);

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
        showToast?.('Ese archivo no parece un CSV de SUNAT (no se reconoce si es Compras o Ventas por el encabezado).', 'red');
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
        companyId: company?.id, libro: r.libro, periodo, companies, otrosCortes,
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
      showToast?.(`${r.libro === 'compras' ? '🛒 Compras' : '💵 Ventas'}: ${r.filas.length} comprobantes de SUNAT, guardados.${aviso}`, r.avisos.length ? 'amber' : 'green');
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
        companyId: company?.id, libro, periodo, companies, otrosCortes,
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

  /**
   * Dar de alta el comprobante que SUNAT tiene y JARVEX no.
   *
   * Mismo contrato que el resto de los botones que crean plata en esta app:
   * la lib pura arma los campos (una sola definición, con tests), guard
   * SÍNCRONO porque el doble clic duplicaría la factura, y auditoría. La
   * diferencia es que acá NO se pregunta con un `confirm()`: la ventana de
   * revisión YA es la confirmación, y es lo que Gabriel pidió — se registra
   * plata, conviene verla antes.
   */
  const confirmarAlta = async () => {
    if (enCursoRef.current || !altaBorrador) return;
    if (!puedeAlta) { showToast?.('No tenés permiso para registrar comprobantes.', 'red'); return; }
    enCursoRef.current = true;
    try {
      const { b, libro, fila } = altaBorrador;
      const campos = movimientoDesdeCorte(b, {
        companyId: company?.id, libro, periodo,
        obraExiste: (id) => (obrasCotejo || []).some(o => o.id === id && !o.deleted_at),
      });
      const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
      const marcaModo = esPrueba ? { demo: true, sync_status: 'synced' } : { sync_status: 'pending_create' };
      const movId = window.__newId();
      const now = new Date().toISOString();
      await window.__db.accounting_movements.add({
        id: movId, ...campos,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, last_synced_at: null, ...marcaModo,
        idempotency_key: `${userId}_acc_${movId}`,
      });
      try {
        await window.__logAudit?.({
          action: 'insert', table: 'accounting_movements', recordId: movId,
          newData: { doc: campos.document_number, total: campos.amount, corte: periodo, falta_comprobante: true },
          reason: 'SUNAT vs JARVEX · alta desde el corte porque el comprobante no se pudo descargar del portal',
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      // Se da por vista la diferencia que acaba de resolverse: si no, la fila
      // sigue en «por revisar» hasta que alguien vuelva a cotejar, y parece
      // que el alta no hizo nada.
      try { await decidir(fila, 'revisada'); } catch {}
      setAltaBorrador(null);
      showToast?.(`✓ ${campos.document_number} registrado en ${company?.name || 'la empresa'}, marcado «falta el comprobante». Volvé a cotejar para verlo cuadrar.`, 'green');
    } catch (e) {
      showToast?.('No se pudo registrar: ' + (e?.message || e), 'red');
    } finally { enCursoRef.current = false; }
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 14 }}>
          {['compras', 'ventas'].map(l => {
            const c = cortes[l];
            const esComp = l === 'compras';
            const nombre = esComp ? 'Compras (RCE)' : 'Ventas (RVIE)';
            const icono = esComp ? '🛒' : '💵';
            const colorTema = esComp ? '#2563eb' : '#16a34a';
            const bgTema = esComp ? 'rgba(37, 99, 235, 0.05)' : 'rgba(22, 163, 74, 0.05)';
            const borderTema = esComp ? 'rgba(37, 99, 235, 0.25)' : 'rgba(22, 163, 74, 0.25)';

            return (
              <div
                key={l}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: `1px solid ${borderTema}`,
                  backgroundColor: bgTema,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: colorTema, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{icono}</span>
                    <span>{nombre}</span>
                  </div>
                  {c ? (
                    <span style={{ fontSize: 11, fontWeight: 600, color: c.filas.length ? 'var(--green)' : 'var(--orange)' }}>
                      {c.filas.length ? '✓ Cargado' : '⚠ Sin detalle'}
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: 'var(--tm)' }}>○ sin cargar</span>
                  )}
                </div>

                {!c ? (
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
                    {esComp
                      ? 'Propuesta del RCE (archivo termina en -propuesta.csv)'
                      : 'Export del RVIE (archivo empieza con «LE…»)'}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {c.filas.length
                        ? `${c.filas.length} comprobantes detectados`
                        : 'guardado sin el detalle (versión anterior): volvé a cargar el CSV'}
                    </div>
                    {c.archivo && (
                      <div style={{ fontSize: 11, color: 'var(--tm)', wordBreak: 'break-all' }}>
                        Archivo: <strong>{c.archivo}</strong>
                      </div>
                    )}
                    {c.cargadoAt && (
                      <div style={{ fontSize: 11, color: 'var(--tm)' }}>
                        Cargado: {fmtFechaHora(c.cargadoAt)}
                      </div>
                    )}
                    {c.avisosN > 0 && (
                      <div style={{ fontSize: 11, color: '#d33', fontWeight: 500 }}>
                        ⚠️ {c.avisosN} línea(s) no se pudieron leer
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      {c.filas.length > 0 && (
                        <button className="btn btn-sm" disabled={busy} onClick={() => recotejar(l)}>
                          Volver a cotejar
                        </button>
                      )}
                      <button className="btn btn-sm" disabled={busy} onClick={() => quitarCorte(l)}>
                        Quitar
                      </button>
                    </div>
                  </>
                )}
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

      {/* ── LO QUE YA REVISASTE, DE TODOS LOS MESES ──────────────── */}
      {registro.length > 0 && (
        <div className="card card-p" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>
              Lo que ya revisaste: {registro.length}
              {' '}{registro.length === 1 ? 'diferencia' : 'diferencias'}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--tm)', flex: 1, minWidth: 260 }}>
              De todos los meses de {company?.name || 'esta empresa'}. Queda guardado y sincronizado entre las
              dos PCs: lo que marcaste «no aplica» no vuelve a salir, y «ya la vi» dice que la miraste y
              decidiste dejarla así.
            </div>
            <button className="btn btn-sm" onClick={() => setVerRegistro(v => !v)}>
              {verRegistro ? 'Ocultar' : 'Ver el registro'}
            </button>
          </div>
          {verRegistro && (
            <div style={{ marginTop: 10, maxHeight: 320, overflow: 'auto' }}>
              <table className="tbl" style={{ width: '100%', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Período</th>
                    <th style={{ textAlign: 'left' }}>Comprobante</th>
                    <th style={{ textAlign: 'left' }}>Qué decía</th>
                    <th style={{ textAlign: 'left' }}>Qué dijiste</th>
                    <th style={{ textAlign: 'right' }}>Importe</th>
                    <th style={{ textAlign: 'left' }}>Cuándo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {registro.map(d => (
                    <tr key={d.id}>
                      <td>{formatoPeriodoHumano(d.periodo) || '—'}</td>
                      <td>
                        {d.documento || '—'}
                        {d.libro ? <span style={{ fontSize: 10.5, color: 'var(--tm)' }}> · {d.libro}</span> : null}
                      </td>
                      <td style={{ color: 'var(--tm)' }}>{ETIQUETA_ESTADO[d.estado] || d.estado || '—'}</td>
                      <td style={{ fontWeight: 600 }}>
                        {d.decision === 'no_aplica' ? 'No aplica' : 'Ya la vi'}
                        {d.nota ? <div style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--tm)' }}>{d.nota}</div> : null}
                      </td>
                      <td style={{ textAlign: 'right' }}>{d.monto ? fmtS(d.monto) : '—'}</td>
                      <td style={{ color: 'var(--tm)' }}>{fmtFechaHora(d.updated_at)}</td>
                      <td>
                        <button className="btn btn-sm"
                          title="Vuelve a la lista de pendientes del mes al que pertenece."
                          onClick={() => decidirCotejo(
                            { ambito: 'comparativa', llave: d.llave, decision: null }, userId,
                          )}>
                          Deshacer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!hayAlgo ? null : (
        <>
          {/* Resumen */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
            <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ color: 'var(--tm)', fontSize: 11 }}>Comprobantes cotejados</div>
              <div style={{ fontWeight: 700, fontSize: 20 }}>{global.total}</div>
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
                🛒 {nCompras} compras · 💵 {nVentas} ventas
              </div>
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
          <div className="card card-p" style={{ padding: 12, marginBottom: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Selector de libro: Todos, Compras, Ventas */}
            <div style={{ display: 'inline-flex', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden' }}>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  backgroundColor: filtroLibro === 'todos' ? 'var(--bg-c2)' : 'transparent',
                  color: filtroLibro === 'todos' ? 'var(--tp)' : 'var(--tm)',
                  border: 'none',
                  borderRadius: 0,
                  padding: '4px 10px',
                  fontWeight: filtroLibro === 'todos' ? 700 : 400,
                  cursor: 'pointer',
                }}
                onClick={() => setFiltroLibro('todos')}
              >
                Todos ({todas.length})
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  backgroundColor: filtroLibro === 'compras' ? 'var(--blue-l)' : 'transparent',
                  color: filtroLibro === 'compras' ? 'var(--blue)' : 'var(--tm)',
                  border: 'none',
                  borderLeft: '1px solid var(--border)',
                  borderRadius: 0,
                  padding: '4px 10px',
                  fontWeight: filtroLibro === 'compras' ? 700 : 400,
                  cursor: 'pointer',
                }}
                onClick={() => setFiltroLibro('compras')}
              >
                🛒 Solo Compras ({nCompras})
              </button>
              <button
                type="button"
                className="btn btn-sm"
                style={{
                  backgroundColor: filtroLibro === 'ventas' ? 'var(--green-l)' : 'transparent',
                  color: filtroLibro === 'ventas' ? 'var(--green)' : 'var(--tm)',
                  border: 'none',
                  borderLeft: '1px solid var(--border)',
                  borderRadius: 0,
                  padding: '4px 10px',
                  fontWeight: filtroLibro === 'ventas' ? 700 : 400,
                  cursor: 'pointer',
                }}
                onClick={() => setFiltroLibro('ventas')}
              >
                💵 Solo Ventas ({nVentas})
              </button>
            </div>

            <select className="fi" style={{ maxWidth: 260 }} value={filtro} onChange={e => setFiltro(e.target.value)}>
              <option value="pendientes">Por revisar ({filasPendientes(basePorLibro).length})</option>
              <option value="todas">Todas ({basePorLibro.length})</option>
              <option value="decididas">Ya decididas ({basePorLibro.filter(f => f.decision).length})</option>
              <option value="cuadra">Las que cuadran ({basePorLibro.filter(f => f.estado === 'cuadra').length})</option>
              {ESTADOS_PENDIENTES.map(e => {
                const n = basePorLibro.filter(f => f.estado === e).length;
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            backgroundColor: f.libro === 'compras' ? 'rgba(37, 99, 235, 0.12)' : 'rgba(22, 163, 74, 0.12)',
                            color: f.libro === 'compras' ? '#2563eb' : '#16a34a',
                            border: `1px solid ${f.libro === 'compras' ? 'rgba(37, 99, 235, 0.28)' : 'rgba(22, 163, 74, 0.28)'}`,
                          }}
                        >
                          {f.libro === 'compras' ? '🛒 COMPRA' : '💵 VENTA'}
                        </span>
                        {f.movimientoId ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs"
                            style={{
                              padding: '0 4px',
                              fontWeight: 600,
                              fontSize: 13,
                              color: 'inherit',
                              textDecoration: 'underline',
                              textDecorationStyle: 'dotted',
                              cursor: 'pointer',
                            }}
                            title={`Abrir comprobante ${f.appDocumento || f.documento} en Movimientos Contables`}
                            onClick={() => irAEditarMovimiento(f.empresaAjenaId || f.companyId || company?.id, f.movimientoId, f.appDocumento || f.documento)}
                          >
                            {f.documento || f.appDocumento || '—'}
                          </button>
                        ) : (
                          <span style={{ fontWeight: 600 }}>{f.documento || f.appDocumento || '—'}</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
                        {f.tipoNombre?.replace('_', ' ')}
                        {f.modifica ? ` · anula ${f.modifica}` : ''}
                      </div>
                      {f.estado === 'serie_distinta' && (
                        <div style={{ fontSize: 11, color: 'var(--amber, #d97706)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>en JARVEX está como <strong>{f.appDocumento}</strong></span>
                          <button
                            type="button"
                            className="btn btn-xs btn-amber"
                            style={{ padding: '1px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            title={`Abrir y corregir la factura ${f.appDocumento} en Movimientos Contables`}
                            onClick={() => irAEditarMovimiento(f.companyId || company?.id, f.movimientoId, f.appDocumento)}
                          >
                            <span>✏️</span>
                            <span>Reparar en Movimientos</span>
                          </button>
                        </div>
                      )}
                      {f.estado === 'otra_empresa' && (
                        <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>en {f.empresaAjena}</span>
                          <button
                            type="button"
                            className="btn btn-xs"
                            style={{ padding: '1px 6px', fontSize: 10, cursor: 'pointer' }}
                            title={`Ir a ${f.empresaAjena} y ver la factura ${f.appDocumento}`}
                            onClick={() => irAEditarMovimiento(f.empresaAjenaId, f.movimientoId, f.appDocumento)}
                          >
                            Ir a {f.empresaAjena}
                          </button>
                        </div>
                      )}
                      {f.estado === 'otro_periodo' && (
                        <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          <span>📅 {f.motivoPeriodo || `Registrado en JARVEX en ${f.appFecha || 'otro mes'}`}</span>
                        </div>
                      )}
                      {f.estado === 'sunat_otro_periodo' && (
                        <div style={{ fontSize: 11, color: 'var(--purple, #8b5cf6)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                          <span>📌 {f.motivoPeriodo || `En SUNAT en período ${f.periodoDetectado}`}</span>
                        </div>
                      )}
                      {/* RUC DISTINTO: no se sabe si es un RUC mal tipeado o dos
                          comprobantes reales que coinciden en número — se muestra
                          el contraste (sin PDF no se puede decidir por la persona). */}
                      {f.estado === 'ruc_distinto' && (
                        <div style={{ fontSize: 11, color: 'var(--amber, #d97706)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span>⚠ mismo N°, pero SUNAT dice RUC <strong>{f.contraparteRuc}</strong> y en JARVEX está con RUC <strong>{f.appRuc}</strong> ({f.appNombre || 'sin nombre'}) — ¿RUC mal cargado, o dos comprobantes distintos?</span>
                          <button
                            type="button"
                            className="btn btn-xs"
                            style={{ padding: '1px 6px', fontSize: 10, cursor: 'pointer' }}
                            title={`Abrir ${f.appDocumento} en Movimientos Contables para verificar el RUC contra el PDF`}
                            onClick={() => irAEditarMovimiento(f.companyId || company?.id, f.movimientoId, f.appDocumento)}
                          >
                            Revisar en Movimientos
                          </button>
                        </div>
                      )}
                      {/* DUPLICADO EN JARVEX: el papel SÍ está registrado, pero
                          más de una vez — no es que falte plata, sobra un registro. */}
                      {f.estado === 'duplicado_jarvex' && (
                        <div style={{ fontSize: 11, color: '#d33', marginTop: 4 }}>
                          ⚠ Este comprobante está cargado {f.duplicados} veces en JARVEX — SUNAT lo declara una sola. Fusioná o eliminá el duplicado en Movimientos Contables.
                        </div>
                      )}
                    </td>
                    <td>
                      {f.fecha || f.appFecha || '—'}
                      {f.estado === 'fecha_distinta' || f.estado === 'otro_periodo' ? (
                        <div style={{ fontSize: 11, color: 'var(--blue)' }}>JARVEX: {f.appFecha}</div>
                      ) : f.estado === 'sunat_otro_periodo' && f.periodoDetectado ? (
                        <div style={{ fontSize: 11, color: 'var(--purple, #8b5cf6)' }}>Período SUNAT: {f.periodoDetectado}</div>
                      ) : null}
                    </td>
                    <td style={{ maxWidth: 260 }}>
                      <div style={{ fontSize: 12 }}>{f.contraparteNombre || f.appNombre || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--tm)' }}>{f.contraparteRuc}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {f.estado === 'solo_jarvex' || f.estado === 'duplicado_jarvex' ? '—' : fmtS(f.sunatTotal)}
                      {f.estado === 'sunat_otro_periodo' && f.periodoDetectado ? (
                        <div style={{ fontSize: 10, color: 'var(--purple, #8b5cf6)' }}>en SUNAT {f.periodoDetectado}</div>
                      ) : f.sunatIgv ? (
                        <div style={{ fontSize: 11, color: 'var(--tm)' }}>IGV {fmtS(f.sunatIgv)}</div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {f.movimientoId
                        ? fmtMoneda(f.appTotal, f.appMoneda)
                        : <span style={{ color: '#d33' }}>no está</span>}
                      {/* Un comprobante en dólares y un archivo en soles no son
                          una incoherencia: hay que decir con qué TC se compararon. */}
                      {f.tipoCambio ? (
                        <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                          = {fmtS(f.appEnSoles)} · TC {f.tipoCambio}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right', color: Math.abs(f.diferencia || 0) <= 0.05 ? 'var(--tm)'
                      // Ámbar, no rojo: en `ruc_distinto` no está confirmado que
                      // sea plata faltante — puede ser el mismo papel con el RUC
                      // mal cargado, y no la brecha real que sugieren los otros
                      // estados en rojo (ver resumirComparativa: no se le suma).
                      : f.estado === 'ruc_distinto' ? 'var(--amber, #d97706)' : '#d33' }}>
                      {Math.abs(f.diferencia || 0) > 0.05 ? fmtS(f.diferencia) : '—'}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {/* El papel, antes que cualquier botón: casi siempre es lo
                          que decide si la diferencia existe o no aplica. */}
                      <OjoComprobante entry={evidencias.get(f.movimientoId)} onAbrir={abrir} />
                      {f.movimientoId ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{ marginLeft: 4, padding: '2px 8px' }}
                          title={`Editar ${f.appDocumento || 'comprobante'} en Movimientos Contables`}
                          onClick={() => irAEditarMovimiento(f.empresaAjenaId || f.companyId || company?.id, f.movimientoId, f.appDocumento || f.documento)}
                        >
                          {typeof window !== 'undefined' && window.JxIcon
                            ? React.createElement(window.JxIcon, { name: 'edit', size: 12 })
                            : '✏️'}
                        </button>
                      ) : null}
                      {/* REGISTRARLA: solo en las que SUNAT tiene y acá faltan.
                          Es para el comprobante que no se puede bajar del
                          portal (los de bancos), no un atajo para cargar
                          facturas sin mirarlas — por eso abre una ventana de
                          revisión con el desglose del archivo. */}
                      {puedeAlta && !f.decision && sePuedeDarDeAlta(f) && (
                        <button
                          type="button" className="btn btn-amber btn-sm" style={{ marginLeft: 4 }}
                          title="Registrar este comprobante en JARVEX con el desglose que trae el archivo de SUNAT, marcado «falta el comprobante»"
                          onClick={() => setAltaBorrador({
                            fila: f, libro: f.libro,
                            b: borradorDesdeFila(f, { periodo }),
                          })}>
                          + Registrar
                        </button>
                      )}
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
      {/* ── LA VENTANA DE REVISIÓN DEL ALTA ─────────────────────────
          Lo que muestra es lo MISMO que se va a guardar (`borradorDesdeFila`
          arma el objeto y `movimientoDesdeCorte` lo convierte sin volver a
          calcular nada), así lo confirmado y lo guardado no pueden diferir. */}
      {altaBorrador && (() => {
        const b = altaBorrador.b;
        const set = (patch) => setAltaBorrador(prev => ({ ...prev, b: { ...prev.b, ...patch } }));
        const num = (v) => (v === '' ? 0 : Number(v));
        const avisos = avisosDelBorrador(b);
        const esVenta = altaBorrador.libro === 'ventas';
        const sim = b.currency === 'PEN' ? 'S/' : b.currency === 'USD' ? 'US$' : b.currency;
        return (
          <div className="overlay" onClick={e => e.target === e.currentTarget && setAltaBorrador(null)}>
            <div className="modal" style={{ maxWidth: 680, width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
              <h3 style={{ marginTop: 0 }}>Registrar el comprobante que falta</h3>
              <div style={{ fontSize: 12, color: 'var(--tm)', lineHeight: 1.55, marginBottom: 12 }}>
                Se registra en <b>{company?.name}</b> como {esVenta ? 'venta' : 'compra'} de {periodo}, con el desglose
                que trae el archivo de SUNAT. Queda marcado <b>«falta el comprobante»</b>: el registro existe para que el
                mes cuadre, y cuando consigas el papel lo subís por Captura Mágica.
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <label style={{ fontSize: 12 }}>Comprobante
                  <input className="fi" value={b.documentNumber} onChange={e => set({ documentNumber: e.target.value })}/>
                </label>
                <label style={{ fontSize: 12 }}>Fecha de emisión
                  <input className="fi" type="date" value={b.date} onChange={e => set({ date: e.target.value })}/>
                </label>
                <label style={{ fontSize: 12 }}>{esVenta ? 'RUC del cliente' : 'RUC del proveedor'}
                  <input className="fi" value={b.ruc} onChange={e => set({ ruc: e.target.value })}/>
                </label>
                <label style={{ fontSize: 12, gridColumn: '1 / -1' }}>Razón social
                  <input className="fi" value={b.nombre} onChange={e => set({ nombre: e.target.value })}/>
                </label>
              </div>

              <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--tm)' }}>
                EL DESGLOSE, en {b.currency}{b.tipoCambio ? ` (el archivo lo trae en soles al TC ${b.tipoCambio}; acá vuelve a su moneda)` : ''}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                <label style={{ fontSize: 12 }}>Base gravada
                  <input className="fi" inputMode="decimal" value={b.base} onChange={e => set({ base: num(e.target.value) })}/>
                </label>
                <label style={{ fontSize: 12 }}>IGV
                  <input className="fi" inputMode="decimal" value={b.igv} onChange={e => set({ igv: num(e.target.value) })}/>
                </label>
                <label style={{ fontSize: 12 }}>No gravadas
                  <input className="fi" inputMode="decimal" value={b.noGravado} onChange={e => set({ noGravado: num(e.target.value) })}/>
                </label>
                <label style={{ fontSize: 12 }}>Importe total
                  <input className="fi" inputMode="decimal" value={b.amount} onChange={e => set({ amount: num(e.target.value) })}/>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 12 }}>
                {/* EL MES EN QUE SE DECLARA. Viene con el del corte porque es
                    ahí donde SUNAT lo está declarando; se puede mover si el
                    comprobante es de otro mes y el crédito se usa más tarde. */}
                <label style={{ fontSize: 12 }}>Se declara en el período
                  <input className="fi" inputMode="numeric" placeholder="202601" maxLength={6}
                    value={b.periodoDeclarado}
                    onChange={e => set({ periodoDeclarado: e.target.value.replace(/\D/g, '').slice(0, 6) })}/>
                </label>
                <label style={{ fontSize: 12 }}>Destino
                  <select className="fi" value={b.destinoSel} onChange={e => set({ destinoSel: e.target.value })}>
                    <option value="__nose__">No sé — que lo decida la Contadora Jefe</option>
                    <option value="__empresa__">Gastos generales de la empresa</option>
                    <option value="__otros__">Contabilidad neta</option>
                    {(obrasCotejo || []).filter(o => !o.deleted_at).map(o => (
                      <option key={o.id} value={o.id}>Obra: {o.nombre || o.name || o.id}</option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 12, gridColumn: '1 / -1' }}>¿Por qué no está el comprobante? (opcional)
                  <input className="fi" placeholder="El portal de SUNAT no deja descargar los emitidos por bancos"
                    value={b.faltaComprobanteMotivo}
                    onChange={e => set({ faltaComprobanteMotivo: e.target.value })}/>
                </label>
              </div>

              {avisos.length > 0 && (
                <div style={{ marginTop: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(242,183,5,.12)', fontSize: 11.5, lineHeight: 1.5 }}>
                  {avisos.map((a, i) => <div key={i}>⚠ {a}</div>)}
                </div>
              )}

              <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                <span style={{ marginRight: 'auto', fontSize: 13, fontWeight: 700 }}>
                  {sim} {Number(b.amount || 0).toLocaleString('es-PE', { minimumFractionDigits: 2 })}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setAltaBorrador(null)}>Cancelar</button>
                <button className="btn btn-amber btn-sm" onClick={confirmarAlta} disabled={!b.documentNumber || !b.date}>
                  Registrar en JARVEX
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {visorModal}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PESTAÑA 2 — EL ESCÁNER DE INCOHERENCIAS
// ═══════════════════════════════════════════════════════════════════
export function EscanerIncoherencias({ company, companies, movs, showToast, userId, empresaFija, periodo = null }) {
  // Por defecto mira TODO el grupo: la incoherencia más cara que se midió
  // —una venta marcada intercompany sin su costo del otro lado— es imposible
  // de ver parado en una sola empresa. Con una empresa fijada por navegación,
  // se respeta ese ámbito.
  const [soloEmpresa, setSoloEmpresa] = uS(!!empresaFija || !!periodo);
  // ── ÁMBITO POR PERÍODO (17-set) ─────────────────────────────────
  // Abierto desde el Registro de Compras y Ventas, el escáner arranca mirando
  // el MES que se está cerrando: es la pregunta que se hace ahí («¿puedo
  // declarar este mes?»), no «¿está todo bien desde siempre?». El check lo
  // suelta para ver el histórico sin salir de la ventana.
  const [soloPeriodo, setSoloPeriodo] = uS(!!periodo);
  const [familia, setFamilia] = uS('todas');
  const enCursoRef = uR(false);
  const { abrirComprobante: abrir, visorModal } = useVisorComprobante();

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

  // Borrar un comprobante es de admin, igual que en Movimientos Contables: el
  // escáner no puede ser la puerta de atrás de un permiso que allá no se da.
  const esAdmin = rol === 'admin';
  // Y el mismo cerco de las operaciones entre empresas: una pata de un par
  // registrado se toca desde ahí, para que los dos lados se muevan juntos.
  const { data: intercoTx } = window.__hooks?.useIntercompanyTransactions?.() || { data: [] };
  const idsConPar = uM(() => movimientosConParRegistrado(intercoTx), [intercoTx]);

  // (Hasta el 25-set acá vivía la «anulación en cascada» de la tanda 9, que
  // daba de baja la factura anulada por su nota. Gabriel decidió que las dos
  // quedan vigentes, como en el RCE: ver `notas-credito.js`.)

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
    // El período se acota DESPUÉS de escanear, igual que la empresa: una nota
    // de crédito de este mes puede apuntar a una factura de marzo, y el
    // hallazgo se cuenta en el mes de la nota.
    const porPeriodo = (soloPeriodo && periodo)
      ? porEmpresa.filter(h => enPeriodo(h.fecha, Number(periodo.anio), Number(periodo.mes)))
      : porEmpresa;
    return familia === 'todas' ? porPeriodo : porPeriodo.filter(h => h.familia === familia);
    // `corrida` está en las deps a propósito: es el botón «analizar de nuevo».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movs, companies, decisiones, soloEmpresa, company?.id, familia, corrida, soloPeriodo, periodo?.anio, periodo?.mes]);

  const pendientes = uM(() => hallazgosPendientes(hallazgos), [hallazgos]);
  const resumen = uM(() => resumirHallazgos(pendientes), [pendientes]);

  const movsPorId = uM(() => new Map((movs || []).map(m => [m.id, m])), [movs]);

  // ── LOS DOCUMENTOS QUE HAY QUE PODER MIRAR PARA CADA HALLAZGO ─────
  // 🔴 Gabriel (23-set-2026): «actualmente solo muestras un ojo, y puede ser
  // necesario en otros casos donde comparas una incoherencia entre 2
  // comprobantes o más, en esos casos debes poder mostrarme el icono de
  // visualización de los 2 documentos». La mayoría de las reglas son sobre UN
  // comprobante y ahí alcanza con el 👁 de siempre. Pero tres reglas COMPARAN
  // dos papeles —¿es el mismo dos veces?, ¿esta nota corrige a esta factura?—
  // y con un solo ojo había que ir a Movimientos Contables a buscar el
  // segundo. Cada regla ya trae el id del otro documento en su propio
  // hallazgo (`gemeloId`, `notasIds`, `facturaId`): acá solo se arma la lista
  // de a quiénes mostrar, con una etiqueta que diga cuál es cuál.
  const docsDelHallazgo = React.useCallback((h) => {
    if (h.regla === 'comprobante_duplicado' && h.gemeloId) {
      return [
        { id: h.movimientoId, etiqueta: 'Ver esta copia' },
        { id: h.gemeloId, etiqueta: 'Ver la copia original' },
      ];
    }
    if (h.regla === 'factura_baja_con_nota' && h.notasIds?.length) {
      return [
        { id: h.movimientoId, etiqueta: 'Ver la factura' },
        ...h.notasIds.map((id, i) => ({
          id, etiqueta: h.notasIds.length > 1 ? `Ver la nota ${i + 1} de ${h.notasIds.length}` : 'Ver la nota de crédito',
        })),
      ];
    }
    if (h.regla === 'nota_fecha_imposible' && h.facturaId) {
      return [
        { id: h.movimientoId, etiqueta: 'Ver la nota' },
        { id: h.facturaId, etiqueta: 'Ver el comprobante que modifica' },
      ];
    }
    return [{ id: h.movimientoId, etiqueta: 'Ver el comprobante cargado' }];
  }, []);

  const evidencias = useEvidencias(uM(() => {
    const ids = new Set();
    for (const h of pendientes) for (const d of docsDelHallazgo(h)) if (d.id) ids.add(d.id);
    return [...ids];
  }, [pendientes, docsDelHallazgo]));

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

  /**
   * Borrar la COPIA de un comprobante cargado dos veces.
   *
   * El hallazgo ya sabe cuál es cuál: `movimientoId` es la copia (la que se
   * cargó después) y `gemeloId` el original que se queda. Borrar la primera y
   * dejar la segunda daría el mismo resultado contable, pero se pierde el
   * historial de la que sí venía de la captura original.
   *
   * Es un BORRADO (soft-delete, como en Movimientos Contables) y por eso pide
   * admin. Antes de permitirlo se revisa que nada apunte a la copia: si una
   * nota de crédito la señala, borrarla dejaría la nota huérfana —cambiando un
   * problema por otro— así que se bloquea y se dice cuál es.
   */
  const borrarDuplicado = async (h) => {
    if (enCursoRef.current) return;
    if (!esAdmin) { showToast?.('Borrar un comprobante es de admin, igual que en Movimientos Contables.', 'red'); return; }
    const copia = movsPorId.get(h.movimientoId);
    if (!copia) { showToast?.('El comprobante no está en este dispositivo — sincronizá.', 'red'); return; }
    const gate = puedeEliminarMovimiento(copia, idsConPar);
    if (!gate.puede) { showToast?.(gate.motivo, 'amber'); return; }

    const apuntan = (movs || []).filter(m => m && !m.deleted_at && m.related_movement_id === copia.id);
    if (apuntan.length) {
      showToast?.(
        `No se puede borrar todavía: ${apuntan.map(m => m.document_number || 's/n').join(', ')} `
        + 'apunta a esta copia. Reenlazalo al comprobante que se queda y después borrala.', 'amber');
      return;
    }

    const original = movsPorId.get(h.gemeloId);
    if (!confirm(
      `¿Borrar la copia de ${h.documento || 's/n'}? Se borra la que se cargó después`
      + `${copia.created_at ? ` (${fmtFechaCorta(copia.created_at)})` : ''} por ${fmtS(Math.abs(Number(copia.amount) || 0))}`
      + `${original ? `, y se queda la original${original.created_at ? ` del ${fmtFechaCorta(original.created_at)}` : ''} por ${fmtS(Math.abs(Number(original.amount) || 0))}` : ''}. `
      + 'Verificá contra el PDF que sean el mismo comprobante antes de confirmar.'
    )) return;

    enCursoRef.current = true;
    try {
      const fresh = await window.__db.accounting_movements.get(h.movimientoId);
      if (!fresh) { showToast?.('El comprobante no está en este dispositivo — sincronizá.', 'red'); return; }
      await window.__db.accounting_movements.update(h.movimientoId, {
        deleted_at: new Date().toISOString(),
        sync_status: fresh.sync_status === 'pending_create' ? 'pending_create' : 'pending_delete',
      });
      try {
        await window.__logAudit?.({
          action: 'delete', table: 'accounting_movements', recordId: h.movimientoId, oldData: fresh,
          reason: `Escáner de incoherencias · copia duplicada de ${h.documento || 'un comprobante'}; se conserva ${original?.document_number || h.gemeloId}`,
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      showToast?.(`✓ Se borró la copia de ${h.documento || 'ese comprobante'}.`, 'amber');
    } catch (err) {
      showToast?.('No se pudo borrar: ' + (err?.message || err), 'red');
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
        {periodo && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={soloPeriodo} onChange={e => setSoloPeriodo(e.target.checked)} />
            Solo {MESES_ESCANER[(Number(periodo.mes) || 1) - 1]} {periodo.anio}
          </label>
        )}
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
          {soloEmpresa ? ` en ${company?.name || 'esta empresa'}` : ' en todo el grupo'}
          {soloPeriodo && periodo ? `, en ${MESES_ESCANER[(Number(periodo.mes) || 1) - 1]} de ${periodo.anio}` : ''}.
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
                  {h.regla === 'comprobante_duplicado' && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button className="btn btn-sm btn-amber" onClick={() => borrarDuplicado(h)} disabled={!esAdmin}>
                        Borrar esta copia
                      </button>
                      <span style={{ fontSize: 11, color: 'var(--tm)' }}>
                        {esAdmin
                          ? 'Se borra la que se cargó DESPUÉS y se queda la original. Verificá contra el PDF que sean el mismo comprobante.'
                          : 'Borrar un comprobante es de admin, igual que en Movimientos Contables.'}
                      </span>
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
                  {/* Un 👁 por cada documento relevante — dos cuando la
                      incoherencia compara un papel contra otro, para poder
                      verificar mirándolos en vez de confiar en el texto. */}
                  {docsDelHallazgo(h).map((d, i) => (
                    <span key={d.id || i} style={{ marginLeft: i ? 4 : 0, display: 'inline-block' }}>
                      <OjoComprobante entry={evidencias.get(d.id)} onAbrir={abrir} titulo={d.etiqueta} />
                    </span>
                  ))}
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
      {visorModal}
    </div>
  );
}

export default ComparativaSunat;
