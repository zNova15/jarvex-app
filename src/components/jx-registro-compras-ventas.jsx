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
// pantalla, el Excel, el PDF y el .zip, y los cuatro salen de la MISMA lista
// de columnas y de la MISMA selección: cuatro definiciones en cuatro lugares es
// como se llega a un archivo que no coincide con lo que se vio en pantalla.
//
// ── ACÁ SE MUDARON DOS PESTAÑAS (17-set, tandas 5 y 6) ─────────────
// Pedido de Gabriel: «los registros de compra y venta deberían ser el primer
// plano; el reemplazo SIRE y el escáner de incoherencias se vuelven parte del
// Registro». Tiene razón y el motivo es el mes: las tres preguntas que se hacen
// sobre un período —qué tengo, qué le mando a SUNAT, qué está mal— se
// contestaban en tres pestañas que no compartían ni el filtro. Ahora:
//   · EXPORTAR A SIRE (.zip) es una de las tres exportaciones del registro, y
//     la selección de qué comprobante va se hace con un casillero en la propia
//     fila de la hoja que se está mirando (antes era otra tabla, con otro
//     filtro, mostrando lo mismo).
//   · EL ESCÁNER DE INCOHERENCIAS es una ventana que se abre desde acá, ya
//     apuntada al período que se está cerrando, con sus arreglos rápidos. El
//     botón muestra cuántas hay antes de abrirlo: si son cero, no hay nada que
//     mirar y no hace falta entrar.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  armarRegistro, COLUMNAS_COMPRAS, COLUMNAS_VENTAS, celda, matriz,
  totalesCompras, totalesVentas,
} from "../lib/registro-compras-ventas.js";
import { nombreTabla10, nombreTabla2 } from "../lib/tablas-sunat.js";
import { sembrarTiposCambio } from "../lib/tipo-cambio.js";
import { planDePasada, tasaDeComprobante, validarTasaManual } from "../lib/tipo-cambio-pasada.js";
import { ejecutarPasada, guardarTasa } from "../lib/tipo-cambio-db.js";
import {
  analizarComprobantesParaSire, generateReemplazoPropuestaRCE, generateReemplazoPropuestaRVIE,
  buildSireZipPackage, downloadSireZip, buildSireFilenameBase,
  LIBRO_RCE_REEMPLAZO, LIBRO_RVIE_REEMPLAZO,
} from "../lib/sunat-sire.js";
import { downloadPLE } from "../lib/sunat-ple.js";
import { escanear, aplicarDecisionesEscaner, hallazgosPendientes } from "../lib/escaner-incoherencias.js";
import { enPeriodo } from "../lib/fecha.js";
import { EscanerIncoherencias, OjoComprobante, abrirEvidencia, useEvidencias } from "./jx-cotejo-sunat.jsx";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;

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
export function RegistroComprasVentas({
  company, companies = [], movs = [], movsPeriodo = [], movsById = null, asientos = [],
  anio, mes, showToast, userId = null, empresaFija = null,
}) {
  const [hoja, setHoja] = uS('compras');
  const [soloAvisos, setSoloAvisos] = uS(false);
  // ── LA SELECCIÓN PARA EXPORTAR ───────────────────────────────────
  // Un Set de ids de movimiento, compartido por las dos hojas (los ids son
  // únicos), y un modo que hace aparecer el casillero en cada fila. Fuera del
  // modo, exportar significa «todo lo que estoy viendo», que es lo que se
  // espera de un botón sin preguntas.
  const [modoSeleccion, setModoSeleccion] = uS(false);
  const [seleccion, setSeleccion] = uS(() => new Set());
  const [escanerAbierto, setEscanerAbierto] = uS(false);
  const [busy, setBusy] = uS(false);
  // La pasada de tipos de cambio (tanda 7): su progreso, y lo que haya que
  // cargar a mano cuando SUNAT no publicó ese día (feriado, domingo).
  const [pasada, setPasada] = uS(null);
  const [aMano, setAMano] = uS({});
  const pasadaRef = uR(false);

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

  // ── EL TIPO DE CAMBIO (tanda 7) ──────────────────────────────────
  // Sale de la tabla `tipos_cambio` (mig 222): la tasa que SUNAT publicó para
  // ESA fecha, pedida una sola vez en la vida y guardada para las dos PCs. Si
  // la fecha no está, la fila avisa que falta — antes acá había seis tasas
  // escritas a mano en el código y estaban mal por un 11 %.
  const { data: tasas = [] } = window.__hooks?.useTiposCambio?.() || { data: [] };
  // El resto de la app convierte monedas con funciones SÍNCRONAS
  // (`convertirMoneda`, `obtenerTipoCambio`), así que se les siembra el cache
  // con lo que hay en la base en vez de volverlas asíncronas.
  uE(() => { try { sembrarTiposCambio(tasas); } catch { /* noop */ } }, [tasas]);

  const tasaDe = React.useCallback((ymd, mov) => {
    if (!ymd) return 0;
    const t = tasaDeComprobante(mov || { date: ymd, currency: 'USD', clase: 'compra' }, tasas);
    return t ? t.valor : 0;
  }, [tasas]);

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
  const periodoCod = `${anio}${String(mes).padStart(2, '0')}`;
  const periodoObj = uM(() => ({ anio: Number(anio), mes: Number(mes), cod: periodoCod }), [anio, mes, periodoCod]);
  const ruc = company?.ruc || '';
  const rucValido = String(ruc).replace(/\D/g, '').length === 11;
  const razon = company?.legal_name || company?.name || '';

  // ── QUÉ YA LE PRESENTAMOS A SUNAT DE ESTE MES ────────────────────
  // El corte guardado del período y del libro (los CSV que se cargan en «SUNAT
  // vs JARVEX» quedan guardados en `sunat_cortes`). Con eso, la selección puede
  // ofrecer «solo los que faltan», que es la razón de ser del reemplazo de
  // propuesta: mandar lo que SUNAT no tiene, no todo de nuevo.
  const cortesHook = window.__hooks?.useSunatCortes?.() || { data: [] };
  const filasPresentadas = uM(() => {
    const cs = (cortesHook.data || []).filter(c =>
      c && !c.deleted_at && c.company_id === company?.id && Array.isArray(c.filas) && c.filas.length > 0);
    const exacto = cs.find(c => String(c.periodo) === periodoCod && c.libro === hoja);
    return exacto?.filas || [];
  }, [cortesHook.data, company?.id, periodoCod, hoja]);

  const analisisSire = uM(
    () => analizarComprobantesParaSire(movsPeriodo, hoja, {
      periodo: periodoObj, comprobantesPresentados: filasPresentadas,
    }),
    [movsPeriodo, hoja, periodoObj, filasPresentadas],
  );
  const presentadosIds = uM(
    () => new Set((analisisSire.items || []).filter(i => i.yaPresentado).map(i => i.id)),
    [analisisSire],
  );

  // ── LAS INCOHERENCIAS DE ESTE MES ────────────────────────────────
  // Se cuentan acá para poder decir el número EN el botón: un botón que hay que
  // apretar para saber si hacía falta apretarlo no se aprieta. El ámbito es el
  // mismo con el que abre la ventana (esta empresa, este período), así que el
  // número y la lista no pueden discrepar.
  const decHook = window.__hooks?.useCotejoDecisiones?.() || { data: [] };
  const incoherenciasDelPeriodo = uM(() => {
    try {
      const todos = escanear(movs || [], { companies: companies || [] });
      const conDec = aplicarDecisionesEscaner(todos, (decHook.data || []).filter(d => d.ambito === 'escaner'));
      return hallazgosPendientes(conDec).filter(h =>
        (!company?.id || h.companyId === company.id)
        && enPeriodo(h.fecha, Number(anio), Number(mes)));
    } catch { return []; }
  }, [movs, companies, decHook.data, company?.id, anio, mes]);

  // ── SELECCIÓN ────────────────────────────────────────────────────
  // Al entrar al modo arranca TODO marcado: el caso normal del reemplazo es la
  // propuesta completa del mes, y desmarcar tres es más rápido que marcar 120.
  const idsDeLaHoja = uM(() => actual.filas.map(f => f.movimiento_id), [actual.filas]);

  // ── EL 👁 DE CADA FILA (22-set-2026, pedido de Gabriel) ───────────
  // «En los libros electrónicos, en la pestaña de compras y ventas, me gustaría
  // que también agregues el ojo para visualizar los comprobantes.» Es el MISMO
  // botón del cotejo y del escáner, importado de allá y no redefinido acá: solo
  // aparece donde hay archivo cargado, precalienta la firma al pasar el mouse y
  // firma la URL recién al hacer clic. Se piden los ids de la hoja que se está
  // mirando —los mismos de la selección del SIRE—, no los del período entero.
  const evidencias = useEvidencias(idsDeLaHoja);

  uE(() => {
    if (!modoSeleccion) return;
    setSeleccion(new Set(idsDeLaHoja));
  }, [modoSeleccion, hoja, idsDeLaHoja.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFila = (id) => setSeleccion(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const marcarTodos = () => setSeleccion(new Set(idsDeLaHoja));
  const marcarNinguno = () => setSeleccion(new Set());
  const marcarFaltantes = () => {
    const faltan = idsDeLaHoja.filter(id => !presentadosIds.has(id));
    setSeleccion(new Set(faltan));
    showToast?.(`Marcados los ${faltan.length} que SUNAT no tiene de este mes.`, 'blue');
  };

  const elegidosDeLaHoja = uM(
    () => actual.filas.filter(f => seleccion.has(f.movimiento_id)),
    [actual.filas, seleccion],
  );
  // Lo que se exporta: la selección cuando el modo está activo, y si no, lo que
  // se está viendo (con el filtro de avisos incluido).
  const paraExportar = (reg) => (modoSeleccion
    ? reg.filas.filter(f => seleccion.has(f.movimiento_id))
    : reg.filas);

  const exportarExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.book_new();
      for (const [cols, reg, nombre, tit, totalesDe] of [
        [COLUMNAS_COMPRAS, registro.compras, 'Registro de Compras', 'REGISTRO DE COMPRAS', totalesCompras],
        [COLUMNAS_VENTAS, registro.ventas, 'Registro de Ventas', 'REGISTRO DE VENTAS E INGRESOS', totalesVentas],
      ]) {
        const propias = paraExportar(reg);
        const aoa = [
          [tit], [], ['PERIODO :', periodoTxt], ['RUC :', ruc], ['APELLIDOS Y NOMBRES :', razon],
          // Un archivo con una selección adentro TIENE que decirlo en el papel:
          // si no, se lee como el registro completo del mes.
          ...(modoSeleccion && propias.length !== reg.filas.length
            ? [['SELECCIÓN :', `${propias.length} de ${reg.filas.length} comprobantes`]] : []),
          [],
          cols.map(c => c.t),
          cols.map(c => c.t2),
          ...matriz(propias, cols),
        ];
        // Los totales, una fila por moneda: nunca sumadas entre sí.
        // Recalculados sobre lo que REALMENTE va en la hoja: un total del mes
        // entero al pie de una selección es un número que no cierra con nada.
        for (const t of totalesDe(propias).monedas) {
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
      const propias = modoSeleccion ? filas.filter(f => seleccion.has(f.movimiento_id)) : filas;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });
      doc.setFontSize(12);
      doc.text(titulo, 30, 30);
      doc.setFontSize(8);
      doc.text(`PERIODO: ${periodoTxt}     RUC: ${ruc}     ${razon}`, 30, 44);
      if (propias.length !== actual.filas.length) {
        doc.text(`Selección: ${propias.length} de ${actual.filas.length} comprobantes del período.`, 30, 54);
      }
      autoTable(doc, {
        startY: propias.length !== actual.filas.length ? 64 : 56,
        head: [columnas.map(c => c.t), columnas.map(c => c.t2)],
        body: matriz(propias, columnas).map(r => r.map(v => (typeof v === 'number' ? n2(v) : String(v ?? '')))),
        styles: { fontSize: 5.4, cellPadding: 1.2, overflow: 'linebreak' },
        headStyles: { fillColor: [60, 60, 60], fontSize: 5 },
      });
      doc.save(`JARVEX_${esCompras ? 'RC' : 'RV'}_${anio}${String(mes).padStart(2, '0')}.pdf`);
    } catch (e) {
      showToast?.('No se pudo generar el PDF: ' + (e?.message || e), 'red');
    }
  };

  // ── EXPORTAR A SIRE (.zip) — lo que era la pestaña «Reemplazo SIRE» ──
  // El paquete reglamentario (R.S. 112-2021) con su nomenclatura de 33
  // caracteres. La hoja que se está mirando ES el libro: compras → RCE 080400,
  // ventas → RVIE 140400. No hay un segundo selector de libro porque sería el
  // mismo que ya se eligió arriba, y dos selectores del mismo dato terminan
  // diciendo cosas distintas.
  const generarSire = async (soloTxt = false) => {
    if (!rucValido) return showToast?.('La empresa no tiene un RUC de 11 dígitos: SUNAT no acepta el archivo sin eso.', 'red');
    const ids = elegidosDeLaHoja.map(f => f.movimiento_id);
    if (ids.length === 0) {
      const ok = window.confirm(
        'No hay ningún comprobante marcado. ¿Generar el reemplazo VACÍO? '
        + 'Presentarlo así le dice a SUNAT que este período no tiene operaciones en este libro.');
      if (!ok) return;
    }
    setBusy(true);
    try {
      const gen = esCompras
        ? generateReemplazoPropuestaRCE(movsPeriodo, periodoObj, ruc, razon, { seleccionadosIds: ids })
        : generateReemplazoPropuestaRVIE(movsPeriodo, periodoObj, ruc, razon, { seleccionadosIds: ids });

      if (soloTxt) {
        downloadPLE(gen.txtFilename, gen.txtContent);
        showToast?.(`✓ ${gen.txtFilename} — el TXT de comprobación, para leerlo antes de presentar.`, 'blue');
        return;
      }
      const pkg = await buildSireZipPackage(gen);
      downloadSireZip(pkg.zipBlob, pkg.zipFilename);
      // El generador vuelve a filtrar por su cuenta (por `type`, no por
      // `clase`), así que se compara lo que entró con lo que salió: una fila
      // que se cae en silencio entre la pantalla y el .zip es un comprobante
      // que nadie declara y nadie extraña.
      if (ids.length && pkg.registros !== ids.length) {
        showToast?.(
          `⚠ ${pkg.zipFilename}: marcaste ${ids.length} comprobantes y el archivo salió con ${pkg.registros}. `
          + 'Revisá si alguno está cargado como venta en la hoja de compras (o al revés) antes de presentarlo.',
          'amber');
      } else {
        showToast?.(`✓ ${pkg.zipFilename} — ${pkg.registros} comprobantes listos para el SIRE.`, 'green');
      }
    } catch (e) {
      showToast?.('No se pudo generar el paquete SIRE: ' + (e?.message || e), 'red');
    } finally {
      setBusy(false);
    }
  };

  // ── LA PASADA DE TIPOS DE CAMBIO ─────────────────────────────────
  // Cubre TODOS los períodos de la empresa, no solo el que se está mirando:
  // «hay que darle una pasada y colocarle el tipo de cambio que aceptó SUNAT
  // el día de la emisión» (Gabriel). En producción son 42 comprobantes en USD
  // sobre 23 fechas, del 11-set-2024 al 3-set-2026 — se corre una vez y la
  // tarjeta desaparece.
  const movsEmpresa = uM(
    () => (movs || []).filter(m => m && !m.deleted_at && (!company?.id || m.company_id === company.id)),
    [movs, company?.id],
  );
  const planTC = uM(() => planDePasada(movsEmpresa, tasas), [movsEmpresa, tasas]);

  // Guard SÍNCRONO: dos clics acá serían dos tandas de pedidos a SUNAT y el
  // segundo se comería el rate limit del primero.
  const correrPasada = async () => {
    if (pasadaRef.current) return;
    pasadaRef.current = true;
    setPasada({ corriendo: true, hecho: 0, de: planTC.fechas.length });
    try {
      const r = await ejecutarPasada({
        movs: movsEmpresa, tasas, userId,
        onProgreso: (p) => setPasada({ corriendo: true, ...p }),
      });
      setPasada({ corriendo: false, ...r });
      if (r.cortada === 'limite') {
        showToast?.(
          `Se trajeron ${r.fechasTraidas} fechas y SUNAT cortó por exceso de consultas. `
          + 'Lo hecho quedó guardado: volvé a darle en un minuto y sigue desde donde quedó.', 'amber');
      } else if (r.fallaron.length) {
        showToast?.(`✓ ${r.comprobantes} comprobantes con su tipo de cambio. ${r.fallaron.length} fechas quedaron sin tasa: cargalas a mano.`, 'amber');
      } else if (r.comprobantes) {
        showToast?.(`✓ ${r.comprobantes} comprobantes quedaron con el tipo de cambio de SUNAT de su fecha.`, 'green');
      } else {
        showToast?.('No había nada que completar.', 'blue');
      }
    } catch (e) {
      setPasada(null);
      showToast?.('La pasada se cortó: ' + (e?.message || e), 'red');
    } finally {
      pasadaRef.current = false;
    }
  };

  const guardarAMano = async (fecha) => {
    const v = validarTasaManual(aMano[fecha]);
    if (!v.ok) return showToast?.(v.error, 'red');
    const r = await guardarTasa(
      { fecha, venta: v.valor, compra: v.valor, fuente: 'manual', nota: 'Copiada del portal de SUNAT' },
      { userId });
    if (!r.ok) return showToast?.(r.error, 'red');
    setAMano(p => ({ ...p, [fecha]: '' }));
    showToast?.(`✓ Tipo de cambio del ${fecha} guardado. Volvé a darle a la pasada para estamparlo.`, 'green');
  };

  const nombreZip = uM(() => {
    const cod = esCompras ? LIBRO_RCE_REEMPLAZO : LIBRO_RVIE_REEMPLAZO;
    try { return `${buildSireFilenameBase(ruc, periodoObj, cod, true, false)}.zip`; } catch { return ''; }
  }, [ruc, periodoObj, esCompras]);

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
            {/* EL ESCÁNER, con su número por delante: si dice 0 no hay por qué
                abrirlo, y eso es la mitad del valor de tenerlo acá. */}
            <button
              className={incoherenciasDelPeriodo.length ? 'btn btn-sm' : 'btn btn-ghost btn-sm'}
              style={incoherenciasDelPeriodo.length ? { color: 'var(--amber)' } : undefined}
              onClick={() => setEscanerAbierto(true)}
              title={incoherenciasDelPeriodo.length
                ? 'Ver qué está mal en los comprobantes de este mes, con los arreglos que se pueden aplicar de un clic'
                : 'Revisar los comprobantes de este mes contra sí mismos'}>
              🩺 {incoherenciasDelPeriodo.length
                ? `${incoherenciasDelPeriodo.length} incoherencia${incoherenciasDelPeriodo.length === 1 ? '' : 's'}`
                : 'Sin incoherencias'}
            </button>
            <button className="btn btn-sm" onClick={exportarExcel}>⤓ Excel (las dos hojas)</button>
            <button className="btn btn-sm" onClick={exportarPdf}>⤓ PDF de esta hoja</button>
            <button
              className={modoSeleccion ? 'btn btn-amber btn-sm' : 'btn btn-sm'}
              onClick={() => setModoSeleccion(v => !v)}
              title="Elegir comprobante por comprobante qué va en el archivo, y generar el .zip reglamentario del SIRE">
              📦 Exportar a SIRE (.zip)
            </button>
          </div>
        </div>

        {/* ── LA BARRA DE SELECCIÓN ──────────────────────────────────
            Aparece al pedir el SIRE y gobierna las TRES exportaciones: lo que
            se marca acá es lo que sale en el .zip, en el Excel y en el PDF. Un
            casillero que solo valiera para uno de los tres botones sería una
            trampa. */}
        {modoSeleccion && (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: 6,
            background: 'rgba(242,183,5,.10)', display: 'grid', gap: 8,
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 12.5 }}>
                {elegidosDeLaHoja.length} de {actual.filas.length} comprobantes de {esCompras ? 'compras' : 'ventas'}
              </strong>
              <button className="btn btn-ghost btn-xs" onClick={marcarTodos}>Marcar todos</button>
              <button className="btn btn-ghost btn-xs" onClick={marcarNinguno}>Quitar todos</button>
              {analisisSire.hasPresentadosRef && (
                <button className="btn btn-ghost btn-xs" onClick={marcarFaltantes}
                  title="Marcar solo los que no figuran en el corte de SUNAT de este mes">
                  Solo los {analisisSire.faltantesCount} que SUNAT no tiene
                </button>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-xs" onClick={() => generarSire(true)} disabled={busy}>
                  TXT de comprobación
                </button>
                <button className="btn btn-amber btn-sm" onClick={() => generarSire(false)} disabled={busy}>
                  {busy ? 'Generando…' : `📦 Generar el .zip del ${esCompras ? 'RCE' : 'RVIE'}`}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setModoSeleccion(false); setSeleccion(new Set()); }}>
                  Salir de la selección
                </button>
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--tm)', lineHeight: 1.5 }}>
              Reemplazo de propuesta SIRE (R.S. 112-2021) del libro de{' '}
              <b>{esCompras ? 'COMPRAS — RCE' : 'VENTAS — RVIE'}</b>: la hoja que estás mirando es el libro que se
              genera. {nombreZip ? <>El archivo va a salir como <code>{nombreZip}</code>.</> : null}
              {!rucValido && <span style={{ color: 'var(--red)' }}> Falta el RUC de 11 dígitos de la empresa.</span>}
              {!analisisSire.hasPresentadosRef && <> No hay ningún corte de SUNAT cargado de este mes, así que no se puede saber qué ya está presentado — cargalo en «SUNAT vs JARVEX» si querés mandar solo lo que falta.</>}
            </div>
          </div>
        )}

        {/* El encabezado del registro, como en el papel */}
        <div style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{titulo}</div>
          <div style={{ color: 'var(--tm)' }}>
            <b>PERIODO:</b> {periodoTxt} &nbsp;·&nbsp; <b>RUC:</b> {ruc || <span style={{ color: 'var(--red)' }}>falta el RUC de la empresa</span>} &nbsp;·&nbsp; {razon}
          </div>
        </div>
      </div>

      {/* ── LA PASADA DE TIPOS DE CAMBIO (tanda 7) ─────────────────
          Solo aparece si hay algo que completar, y desaparece cuando no queda
          nada: una tarjeta permanente que dice «0 pendientes» es ruido. */}
      {(planTC.comprobantes > 0 || pasada) && (
        <div className="card card-p" style={{ marginBottom: 12, padding: 12, background: 'rgba(52,152,219,.08)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 260, fontSize: 12.5, lineHeight: 1.5 }}>
              <strong>Tipos de cambio por completar</strong><br/>
              <span style={{ color: 'var(--tm)' }}>
                {planTC.comprobantes} comprobante{planTC.comprobantes === 1 ? '' : 's'} en moneda extranjera
                {' '}sin tipo de cambio, en <b>{planTC.fechas.length}</b> fecha{planTC.fechas.length === 1 ? '' : 's'}
                {' '}distinta{planTC.fechas.length === 1 ? '' : 's'} — de todos los períodos, no solo del que estás viendo.
                {planTC.consultas > 0
                  ? ` Se le pide a SUNAT ${planTC.consultas} vez${planTC.consultas === 1 ? '' : 'es'} (una por fecha) y queda guardado para siempre.`
                  : ' Las tasas ya están guardadas: solo falta estamparlas.'}
              </span>
            </div>
            <button className="btn btn-amber btn-sm" onClick={correrPasada} disabled={pasada?.corriendo || planTC.comprobantes === 0}>
              {pasada?.corriendo
                ? `Trayendo… ${pasada.hecho || 0}/${pasada.de || planTC.fechas.length}`
                : (planTC.consultas > 0
                  ? (planTC.consultas === 1 ? 'Traer el tipo de cambio que falta' : `Traer los ${planTC.consultas} tipos de cambio`)
                  : 'Completar los comprobantes')}
            </button>
          </div>

          {pasada?.corriendo && pasada.fecha && (
            <div style={{ fontSize: 11.5, color: 'var(--tm)', marginTop: 8 }}>
              Consultando el {pasada.fecha}… Se pide de a una fecha a propósito: la API de SUNAT corta si se
              la golpea seguido.
            </div>
          )}

          {pasada && !pasada.corriendo && (
            <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.55 }}>
              {pasada.fechasTraidas > 0 && <>Se trajeron <b>{pasada.fechasTraidas}</b> tasas nuevas de SUNAT. </>}
              {pasada.fechasYaEstaban > 0 && <>{pasada.fechasYaEstaban} ya estaban guardadas. </>}
              {pasada.comprobantes > 0 && <>Quedaron con su tipo de cambio <b>{pasada.comprobantes}</b> comprobantes. </>}
              {pasada.cortada === 'limite' && (
                <span style={{ color: 'var(--amber)' }}>
                  SUNAT cortó por exceso de consultas. Lo hecho quedó guardado: dale de nuevo en un minuto y sigue desde donde quedó.
                </span>
              )}
            </div>
          )}

          {/* LAS QUE NO SE PUDIERON, A MANO. Pasa de verdad: SUNAT no publica
              tasa los domingos ni los feriados, y una factura con fecha de
              domingo existe. Copiarla del portal es la única salida honesta —
              la alternativa sería inventarla. */}
          {pasada && !pasada.corriendo && pasada.fallaron?.some(f => f.fecha) && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 6 }}>
                Estas fechas quedaron sin tasa. Buscalas en el portal de SUNAT y cargalas acá:
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {[...new Map(pasada.fallaron.filter(f => f.fecha).map(f => [f.fecha, f])).values()].map(f => (
                  <div key={f.fecha} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
                    <b style={{ minWidth: 88 }}>{f.fecha}</b>
                    <input
                      className="fi" style={{ maxWidth: 110 }} inputMode="decimal" placeholder="3.36"
                      value={aMano[f.fecha] || ''}
                      onChange={e => setAMano(p => ({ ...p, [f.fecha]: e.target.value }))}
                    />
                    <button className="btn btn-ghost btn-xs" onClick={() => guardarAMano(f.fecha)}>Guardar</button>
                    <span style={{ color: 'var(--tm)', fontSize: 11 }}>{f.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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
              {modoSeleccion && (
                <th style={{ width: 28 }} title="Marcar o desmarcar todos los de esta hoja">
                  <input
                    type="checkbox"
                    checked={actual.filas.length > 0 && elegidosDeLaHoja.length === actual.filas.length}
                    onChange={e => (e.target.checked ? marcarTodos() : marcarNinguno())}
                  />
                </th>
              )}
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
              {modoSeleccion && <th/>}
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
              <tr><td colSpan={columnas.length + (modoSeleccion ? 2 : 1)} style={{ textAlign: 'center', padding: 16, color: 'var(--tm)', fontSize: 12.5 }}>
                {soloAvisos ? 'Ninguna fila tiene avisos: el registro está limpio.' : 'No hay comprobantes en este período.'}
              </td></tr>
            )}
            {filas.map(f => (
              <tr key={f.movimiento_id} style={
                modoSeleccion && !seleccion.has(f.movimiento_id) ? { opacity: 0.45 }
                  : f.avisos?.length ? { background: 'rgba(242,183,5,.07)' } : undefined
              }>
                {modoSeleccion && (
                  <td>
                    <input
                      type="checkbox"
                      checked={seleccion.has(f.movimiento_id)}
                      onChange={() => toggleFila(f.movimiento_id)}
                    />
                  </td>
                )}
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
                  {/* El 👁 va PRIMERO en la columna de marcas: es lo que se
                      busca cuando una fila tiene un aviso al lado. */}
                  {evidencias.get(f.movimiento_id) && (
                    <span style={{ marginRight: 4, display: 'inline-block' }}>
                      <OjoComprobante
                        entry={evidencias.get(f.movimiento_id)}
                        onAbrir={(e) => abrirEvidencia(e, showToast)}
                        titulo="Ver el comprobante cargado"
                      />
                    </span>
                  )}
                  {modoSeleccion && analisisSire.hasPresentadosRef && (
                    presentadosIds.has(f.movimiento_id)
                      ? <span className="badge b-green" style={{ fontSize: 9, marginRight: 3 }}
                          title="Este comprobante ya figura en el corte de SUNAT de este mes.">ya en SUNAT</span>
                      : <span className="badge b-amber" style={{ fontSize: 9, marginRight: 3 }}
                          title="SUNAT no lo tiene en el corte de este mes.">falta en SUNAT</span>
                  )}
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

      {/* ── EL ESCÁNER, COMO VENTANA ────────────────────────────────
          Ventana y no pestaña porque es una interrupción del trabajo del mes,
          no un lugar donde se vive: se abre, se arregla lo que se puede de un
          clic, se cierra y se sigue cerrando el período. Arranca apuntado a
          ESTE mes y a ESTA empresa —el mismo ámbito con el que se contó el
          número del botón— y adentro se puede soltar para ver el histórico o
          el grupo entero. */}
      {escanerAbierto && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setEscanerAbierto(false)}>
          <div className="modal" style={{ maxWidth: 1100, width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-hd">
              <div className="modal-hd-left">
                🩺 Incoherencias de {periodoTxt.toLowerCase()}
                {company?.name ? ` · ${company.name}` : ''}
              </div>
              <button className="btn btn-ghost btn-xs" onClick={() => setEscanerAbierto(false)}>
                {window.JxIcon ? <window.JxIcon name="x" size={13}/> : '✕'}
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 10, lineHeight: 1.5 }}>
              Revisa los comprobantes contra sí mismos —sin necesidad de ningún archivo de SUNAT— y
              propone el arreglo donde se puede aplicar de un clic. Nada se aplica solo: cada botón
              pide confirmación y conviene verificar contra el PDF.
            </div>
            <EscanerIncoherencias
              company={company}
              companies={companies}
              movs={movs}
              showToast={showToast}
              userId={userId}
              empresaFija={empresaFija}
              periodo={periodoObj}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default RegistroComprasVentas;
