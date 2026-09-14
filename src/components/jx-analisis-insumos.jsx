// ═══════════════════════════════════════════════════════════════════
// JARVEX — Análisis de Insumos (mejora 1, sep-2026). Panel de ADMIN/GERENTE
// y CONTADOR (la Contadora Jefe es quien clasifica insumos y servicios).
//
// Dos pestañas:
//  · 🔍 Comparador: buscá un insumo → sus variantes de nombre (según las
//    correlaciones confirmadas), qué proveedor vendió cada una, a qué precio
//    (último/mín/máx), el más barato comparable y el gráfico de evolución.
//    Todo sale RETROACTIVO de las facturas ya registradas (items_factura).
//  · 🎯 Mapeo al presupuesto: dice qué insumo del presupuesto de un TRABAJO es
//    cada insumo ya clasificado de la empresa (mig 206, 13-set-2026). Es un
//    mapeo entre CATÁLOGOS y no toca compras: la cadena hasta la factura sale
//    sola por el otro lado —`insumo_categoria` pega cada descripción a un
//    insumo de la empresa, y de ahí acá—. Antes preguntaba por cada una de las
//    2.220 descripciones del grupo, que es una pantalla que no se termina.
//  · 🗂 Clasificación de insumos y servicios: UNA sola sección (13-set-2026)
//    con tres vistas — las clasificaciones y su diccionario, la lista de
//    insumos y servicios de la entidad, y los nombres de factura por
//    reconocer. Antes eran DOS pestañas («Catálogo» y «Categorizar») que
//    contestaban mitades de la misma pregunta y mostraban dos números que no
//    cerraban: 484 filas de catálogo contra 723 descripciones por decidir.
//    Gabriel: «se supone que haya una sola sección donde clasifiquemos todos
//    los insumos y servicios de la entidad en la que estemos». Por dentro
//    siguen siendo dos tablas y tienen que serlo: `catalogo_insumos` es el
//    vocabulario y `insumo_categoria` (mig 195) son los alias; lo que se
//    unificó es la pregunta que se le hace a la persona.
//  · 🤝 Correlaciones: el sistema PROPONE pares de nombres que parecen el
//    mismo insumo; acá se confirma ("mismo") o se rechaza ("distintos") y la
//    decisión queda grabada en insumo_correlaciones (sincronizada) para NO
//    volver a preguntar — pedido explícito de Gabriel. Captura Mágica no se
//    toca: esto es una capa de análisis posterior.
//
// Visibilidad: gate duro admin/gerente/contador (la vista muestra COSTOS por
// proveedor; la regla de la casa es que almacén/campo no ven costos, pero
// contabilidad sí — es quien clasifica y necesita ver a qué precio compró
// cada uno). Mig 211 (14-sep-2026) alineó la RLS de escritura de las tablas
// que esta pantalla toca con este mismo gate: antes solo admin/gerente podían
// insertar/actualizar del lado del server y a la contadora le rebotaba el
// push con "sin permiso" apenas intentaba clasificar algo.
//
// ── TANDA 18, ENTREGA C: LA PUERTA DESDE LA EMPRESA ───────────────
// Gabriel pidió «la base de datos de insumos por empresa». La pieza estaba
// entera —el catálogo es por entidad desde la mig 193 y la bandeja también—,
// pero desde el bloque de una empresa no había cómo llegar: esta pantalla vivía
// solo en el menú general y `esPaginaDeEmpresa()` la dejaba afuera a propósito.
// Ahora es un bloque más de la contabilidad de la empresa, y entrando por ahí
// TODA la pantalla queda clavada en ella: el comparador solo mira SUS facturas
// y las cuatro pestañas heredan el ámbito, con el selector deshabilitado. Sin
// empresa activa se sigue viendo el grupo entero, como siempre.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { filtroInicialEmpresa } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";
import { useChart } from "../lib/chart-loader.js";
import {
  resolverPares, construirGrupos, sugerirPares, sugerirClusters, crearParesDeCluster, normInsumo,
  resaltarDiferencias,
} from "../lib/insumo-correlacion.js";
import {
  extraerLineasDeFacturas, extraerComprasDeFacturas, agruparComprasPorInsumo, proveedorMasBarato, seriePrecios,
} from "../lib/analisis-insumos.js";
import { clasificarConIUPC, tipoDeCategoria } from "../lib/indices-unificados-iupc.js";
import { correlacionarConIA } from "../lib/ia-insumos.js";
import { UMBRAL_BARRIDO_IA } from "../lib/barrido-ia.js";
import { guardarRecomendacion, olvidarRecomendacion } from "../lib/barrido-store.js";
import { BarridoIA, useBarridoIA } from "./jx-barrido-ia.jsx";
import { MapeoInsumosTab } from "./jx-mapeo-insumos.jsx";
import { CatalogoCanonicoTab } from "./jx-catalogo-canonico.jsx";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

// Si un nombre clasifica como SERVICIO (árbol S01…S13), como INSUMO (IUPC +
// complementarias) o como DESCONOCIDO. Reusa el MISMO clasificador que
// "Clasificación de insumos y servicios" — es la misma pregunta, una sola
// respuesta (pedido de Gabriel, 14-sep: «dividir entre las sugerencias de
// insumos, y las de servicios»).
//
// 🔴 `terminosCustom` NO es opcional: el diccionario propio LE GANA a la base
// (regla 8 del CLAUDE.md) y sin pasarlo esta pantalla clasificaría distinto
// que todas las demás.
//
// 🔴 Y «sin_clasificar» devuelve 'desconocido', no 'insumo'. Si cayera del
// lado de insumos, una forma de escribir un servicio que el estándar todavía
// no reconoce quedaría en la pestaña de Insumos y su gemela reconocida en la
// de Servicios: nunca más se podrían correlacionar entre sí, que es
// justamente el par que más falta hace unir.
const tipoDeNombre = (nombre, terminosCustom) => {
  const cod = clasificarConIUPC(nombre, { terminosCustom }).codigo;
  if (!cod || cod === 'sin_clasificar') return 'desconocido';
  return tipoDeCategoria(cod) === 'servicio' ? 'servicio' : 'insumo';
};

// Un nombre con las diferencias contra `otro` resaltadas — mismo criterio que
// decide el motor (resaltarDiferencias usa tokenMatch, el mismo de
// scoreNombres): lo que queda en ámbar es EXACTAMENTE lo que no matcheó.
// Pedido de Gabriel, 14-sep, tras ver "REDUCCION 1\" X 1/2" al lado de
// "REDUCCION 2 1/2\" A 1"": «marcá de un color distinto las diferencias».
function NombreConDiferencias({ nombre, otro }) {
  const partes = uM(() => resaltarDiferencias(nombre, otro).a, [nombre, otro]);
  return (
    <>
      {partes.map((p, i) => (
        <React.Fragment key={i}>
          {i > 0 && ' '}
          {p.distinto
            ? <span style={{ background: 'rgba(242,183,5,.28)', borderRadius: 3, padding: '0 2px' }}>{p.texto}</span>
            : p.texto}
        </React.Fragment>
      ))}
    </>
  );
}

/**
 * "🤖 Preguntale a la IA" para CORRELACIONAR (14-sep-2026, pedido de Gabriel:
 * la misma ayuda que en clasificación pero enfocada en este módulo).
 *
 * Sirve igual para un PAR suelto (dos variantes) que para un GRUPO (N): la
 * IA contesta cuáles son de verdad el mismo artículo y cuáles quedan afuera,
 * mirando MEDIDAS y material en vez de parecido de texto — que es lo que
 * proponía "REDUCCION 1\" X 1/2" junto a "REDUCCION 2 1/2\" A 1".
 *
 * Los nombres viajan CRUDOS a propósito: normInsumo() convierte "1/2" en dos
 * números sueltos y justamente la medida es lo que hay que juzgar.
 *
 * Nunca decide sola: muestra el veredicto y `onAplicar` es un clic aparte.
 * `textoAplicar(mismas)` puede devolver null para no ofrecer botón (ej. la IA
 * dice que ninguna es la misma: para eso ya está "Son distintos").
 */
function AyudaCorrelacionIA({ variantes, textoAplicar, onAplicar, inicial = null, onDescartar = null }) {
  // `inicial`: lo que dejó el recorrido completo (barrido-store). Se muestra
  // sin volver a preguntar —ya se pagó— y con el sello de que vino de ahí.
  const [res, setRes] = uS(null);
  const [cargando, setCargando] = uS(false);
  const [error, setError] = uS(null);
  const mostrado = res || inicial;
  const deRecorrido = !res && !!inicial;

  const preguntar = async (e) => {
    e?.stopPropagation?.();
    if (cargando) return;
    setCargando(true); setError(null);
    try {
      const r = await correlacionarConIA({ variantes });
      if (!r?.result) { setError(r?.razonamiento || 'La IA no pudo decidir esto.'); return; }
      setRes({ ...r.result, confianza: r.confianza, razonamiento: r.razonamiento, cached: !!r._cached });
    } catch (e2) {
      setError(e2?.message || 'No se pudo consultar la IA.');
    } finally {
      setCargando(false);
    }
  };

  const esPar = variantes.length === 2;
  const sonElMismo = !!mostrado && (mostrado.mismas || []).length >= 2;
  const etiqueta = mostrado ? (textoAplicar ? textoAplicar(mostrado.mismas || []) : null) : null;

  return (
    <div style={{ marginTop: 6 }} onClick={e => e.stopPropagation()}>
      {!mostrado && (
        <button type="button" className="btn btn-xs btn-ghost" disabled={cargando} onClick={preguntar}>
          {cargando ? '🤖 Pensando…' : '🤖 Preguntale a la IA'}
        </button>
      )}
      {error && <span style={{ color: 'var(--red)', fontSize: 10.5, marginLeft: 6 }}>{error}</span>}
      {mostrado && (() => { const res = mostrado; return (
        <div style={{
          marginTop: 4, padding: '5px 8px', fontSize: 10.5, borderRadius: 5, maxWidth: 520,
          background: sonElMismo ? 'rgba(46,204,113,.09)' : 'rgba(231,76,60,.08)',
          border: `1px solid ${sonElMismo ? 'rgba(46,204,113,.35)' : 'rgba(231,76,60,.3)'}`,
        }}>
          {deRecorrido
            ? <span className="badge b-blue" style={{ fontSize: 9, marginRight: 4 }}>🤖 Recomendado por IA</span>
            : '🤖 '}
          {esPar
            ? (sonElMismo ? <strong>Son el mismo insumo</strong> : <strong>NO son el mismo insumo</strong>)
            : (sonElMismo
              ? <>Uniría <strong>{(res.mismas || []).length}</strong> de {variantes.length}</>
              : <strong>Ninguna es la misma que otra</strong>)}
          <span className={`badge ${sonElMismo ? 'b-green' : 'b-red'}`} style={{ marginLeft: 4, fontSize: 9 }}>
            {Math.round((res.confianza || 0) * 100)}%
          </span>
          {res.cached && <span style={{ color: 'var(--tm)' }}> · ya preguntada</span>}
          <div style={{ color: 'var(--tm)', marginTop: 2 }}>{res.razonamiento}</div>
          {!esPar && sonElMismo && (res.fuera || []).length > 0 && (
            <div style={{ color: 'var(--tm)', marginTop: 2 }}>
              Deja afuera: {res.fuera.map(f => `«${f}»`).join(', ')}
            </div>
          )}
          <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
            {etiqueta && (
              <button type="button" className="btn btn-xs btn-blue"
                onClick={(e) => { e.stopPropagation(); onAplicar?.(res.mismas || [], res.fuera || []); }}>
                {etiqueta}
              </button>
            )}
            {deRecorrido && onDescartar && (
              <button type="button" className="btn btn-xs btn-ghost"
                onClick={(e) => { e.stopPropagation(); onDescartar(); }}>Descartar</button>
            )}
          </div>
        </div>
      ); })()}
    </div>
  );
}

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
  const compHook = window.__hooks.useCompanies();
  // El diccionario propio: le GANA a la base oficial al clasificar (regla 8
  // del CLAUDE.md), así que el corte insumo/servicio de las correlaciones
  // tiene que mirarlo igual que lo mira la sección de Clasificación.
  const terHook = window.__hooks.useClasificacionTerminos();
  const terminosCustom = terHook.data || null;
  // ÁMBITO, no filtro: con una empresa activa ésta es SU base de insumos y el
  // selector va clavado — el mismo corte que usan las 15 pantallas contables.
  const empresaFija = useEmpresaBloqueada();
  const [empresaSelRaw, setEmpresaSel] = uS(() => filtroInicialEmpresa(''));
  const empresaVista = empresaFija || empresaSelRaw || null;
  // «bandeja» ya no es una pestaña: la categorización vive DENTRO de la
  // sección de clasificación, como tercera vista. El alias se conserva porque
  // hay navegaciones guardadas (y la memoria muscular de Gabriel) que todavía
  // piden esa pestaña por nombre.
  const [tab, setTab] = uS(() => {
    const t = typeof window !== 'undefined' && window.__analisisInsumosIntent?.tab;
    if (t) {
      delete window.__analisisInsumosIntent.tab;
      // Deja la vista pedida para el useState de abajo, que corre después.
      if (t === 'bandeja') window.__analisisInsumosIntent.vista = 'reconocer';
      return t === 'bandeja' ? 'catalogo' : t;
    }
    return 'comparador';
  });
  const [vistaCatalogo, setVistaCatalogo] = uS(() => {
    const v = typeof window !== 'undefined' && window.__analisisInsumosIntent?.vista;
    if (v) { delete window.__analisisInsumosIntent.vista; return v; }
    return 'clasificaciones';
  });
  const [busca, setBusca] = uS('');
  const [sel, setSel] = uS(null);
  // Variantes que se sacaron a mano de un grupo sugerido, por id de grupo.
  // Es estado de pantalla, no una decisión: no se guarda nada hasta aceptar.
  const [excluidasCluster, setExcluidasCluster] = uS(() => ({}));
  const [manualA, setManualA] = uS('');
  const [manualB, setManualB] = uS('');
  // Anti doble-click (regla crítica 2): ref SÍNCRONO — un doble tap en "Mismo
  // insumo" no debe crear el par dos veces.
  const decidiendoRef = uR(false);

  uE(() => {
    if (typeof window !== 'undefined' && window.__analisisInsumosIntent) {
      if (window.__analisisInsumosIntent.tab) {
        const t = window.__analisisInsumosIntent.tab;
        setTab(t === 'bandeja' ? 'catalogo' : t);
        if (t === 'bandeja') setVistaCatalogo('reconocer');
        delete window.__analisisInsumosIntent.tab;
      }
      if (window.__analisisInsumosIntent.vista) {
        setVistaCatalogo(window.__analisisInsumosIntent.vista);
        delete window.__analisisInsumosIntent.vista;
      }
      if (window.__analisisInsumosIntent.companyId) {
        setEmpresaSel(window.__analisisInsumosIntent.companyId);
        delete window.__analisisInsumosIntent.companyId;
      }
    }
  }, []);

  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  // TODAS las líneas de factura (compras y ventas) de la entidad o grupo:
  // alimentan las correlaciones (para cruzar compras con ventas), el catálogo y la bandeja.
  const lineasTodas = uM(() => extraerLineasDeFacturas(movsHook.data || [], { demo: esPrueba }), [movsHook.data, esPrueba]);
  const lineasEntidad = uM(
    () => (empresaVista ? lineasTodas.filter(c => c.companyId === empresaVista) : lineasTodas),
    [lineasTodas, empresaVista]
  );
  // Solo compras con precio (para el comparador de precios y proveedores):
  const comprasTodas = uM(
    () => lineasTodas.filter(l => l.clase === 'compra' && !l.esNota && l.precio > 0),
    [lineasTodas]
  );
  const compras = uM(
    () => lineasEntidad.filter(l => l.clase === 'compra' && !l.esNota && l.precio > 0),
    [lineasEntidad]
  );
  // Las que pueden tener base propia: del grupo y consorcios ejecutores. La
  // que esté FIJADA entra siempre, aunque sea de otra clase: si no, entrar al
  // panel de una entidad rara dejaba el selector en blanco.
  const empresas = uM(() => (compHook.data || [])
    .filter(c => !c.deleted_at
      && (['propia', 'consorcio'].includes(c.tipo_entidad || 'propia') || c.id === empresaVista))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es')),
  [compHook.data, empresaVista]);
  const nombreEmpresa = uM(() => (empresas.find(c => c.id === empresaVista)?.name || null), [empresas, empresaVista]);
  // El hook ya separa demo/real por modo; resolverPares espeja ese criterio.
  const resueltos = uM(() => resolverPares(corrHook.data || [], { demo: esPrueba }), [corrHook.data, esPrueba]);
  const { grupoDe, grupos } = uM(() => construirGrupos(resueltos), [resueltos]);
  const porInsumo = uM(() => agruparComprasPorInsumo(compras, grupoDe, grupos), [compras, grupoDe, grupos]);
  // Insumos y servicios son preguntas DISTINTAS para correlacionar — pedido
  // de Gabriel, 14-sep: «dividir entre las sugerencias de insumos y las de
  // servicios». Un solo nombre único clasificado una vez (memoizado: son
  // potencialmente miles de líneas, clasificar de más sería regalado).
  const tipoPorNombre = uM(() => {
    const m = new Map();
    for (const l of lineasEntidad) {
      if (!m.has(l.nombreNorm)) m.set(l.nombreNorm, tipoDeNombre(l.nombre, terminosCustom));
    }
    return m;
  }, [lineasEntidad, terminosCustom]);
  // Las que el estándar NO reconoce entran a las DOS listas: su gemela puede
  // estar de cualquiera de los dos lados, y dejarlas en una sola las
  // condenaría a no poder correlacionarse nunca (ver `tipoDeNombre`).
  const nombresInsumos = uM(
    () => lineasEntidad.filter(l => tipoPorNombre.get(l.nombreNorm) !== 'servicio').map(c => c.nombre),
    [lineasEntidad, tipoPorNombre]
  );
  const nombresServicios = uM(
    () => lineasEntidad.filter(l => tipoPorNombre.get(l.nombreNorm) !== 'insumo').map(c => c.nombre),
    [lineasEntidad, tipoPorNombre]
  );
  // Sugerir pares cruzando tanto compras como ventas registradas, cada árbol
  // por separado — un "REDUCCION PVC" nunca compite contra un "ALQUILER DE
  // VOLQUETE" por una raíz común.
  const sugerenciasInsumos = uM(
    () => sugerirPares(nombresInsumos, resueltos, grupoDe),
    [nombresInsumos, resueltos, grupoDe]
  );
  const sugerenciasServicios = uM(
    () => sugerirPares(nombresServicios, resueltos, grupoDe),
    [nombresServicios, resueltos, grupoDe]
  );
  // Sugerir clusters multi-variantes (N a N), también por árbol:
  const clustersInsumos = uM(
    () => sugerirClusters(nombresInsumos, resueltos, grupoDe),
    [nombresInsumos, resueltos, grupoDe]
  );
  const clustersServicios = uM(
    () => sugerirClusters(nombresServicios, resueltos, grupoDe),
    [nombresServicios, resueltos, grupoDe]
  );
  const [subTabCorr, setSubTabCorr] = uS('insumos');
  const sugerencias = subTabCorr === 'servicios' ? sugerenciasServicios : sugerenciasInsumos;
  const clustersSugeridos = subTabCorr === 'servicios' ? clustersServicios : clustersInsumos;
  // Las propuestas del recorrido se guardan por ENTIDAD y por sub-pestaña:
  // insumos y servicios son dos listas distintas y no se mezclan.
  const ambitoIA = `${empresaVista || 'grupo'}::${subTabCorr}`;
  const { recomendaciones: recsIA } = useBarridoIA('correlaciones', ambitoIA);
  // 🔴 LA CLAVE DE UN GRUPO SON SUS VARIANTES, NO SU `id`. `sugerirClusters`
  // arma el id con la raíz del union-find, que no cambia cuando entra una
  // variante nueva: un grupo {A,B,C} con la propuesta «uní A y B» seguía
  // mostrándola después de que una factura sumara D, y «Marcar solo esas 2»
  // dejaba afuera a D sin que la IA la hubiera visto jamás. Con la clave por
  // contenido, un grupo que cambió simplemente no tiene propuesta y se vuelve
  // a preguntar.
  const claveCluster = (c) => `cl::${[...(c?.variantes || [])].sort().join('|')}`;
  const clavePar = (par) => `pa::${par.nombre_a}|${par.nombre_b}`;
  // Solo las que siguen apuntando a algo que hoy está en pantalla.
  const nRecomendadasIA = uM(
    () => clustersSugeridos.filter(c => recsIA[claveCluster(c)]).length
      + sugerencias.filter(p => recsIA[clavePar(p)]).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clustersSugeridos, sugerencias, recsIA],
  );
  const decisiones = uM(
    () => [...resueltos.values()].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, 100),
    [resueltos]
  );
  // Lista única de nombres para correlación manual:
  const nombresDisponibles = uM(() => {
    const s = new Set();
    lineasEntidad.forEach(l => { if (l.nombre) s.add(l.nombre); });
    return [...s].sort((a, b) => a.localeCompare(b, 'es'));
  }, [lineasEntidad]);
  const listaInsumos = uM(() => {
    const toks = normInsumo(busca).split(' ').filter(Boolean);
    return [...porInsumo.values()]
      .filter(ins => !toks.length || toks.every(t =>
        normInsumo(ins.display).includes(t) || ins.variantes.some(v => normInsumo(v).includes(t))))
      .sort((a, b) => b.compras.length - a.compras.length)
      .slice(0, 40);
  }, [porInsumo, busca]);
  // Muestra de contexto para cada nombre de una sugerencia (dónde se vio, compra o venta).
  const muestraDe = uM(() => {
    const m = new Map();
    for (const c of lineasEntidad) if (!m.has(c.nombreNorm)) m.set(c.nombreNorm, c);
    return m;
  }, [lineasEntidad]);
  // Serie del gráfico memoizada (identidad estable: sin ella, cada re-render
  // del padre destruía y recreaba el Chart completo). ANTES del early return
  // del gate — regla de hooks.
  const serieSel = uM(() => {
    const ins = sel ? porInsumo.get(sel) : null;
    return ins ? seriePrecios(ins) : [];
  }, [sel, porInsumo]);

  if (rol !== 'admin' && rol !== 'gerente' && rol !== 'contador') {
    return <div className="card card-p" style={{ color: 'var(--tm)' }}>Panel exclusivo de administración, gerencia y contabilidad.</div>;
  }

  // `silencioso`: para el barrido de IA (14-sep) — sin toast por ítem, y sin
  // el confirm() de contradicción (bloquearía el recorrido con un diálogo
  // nativo): si hay contradicción, ese par se salta y queda para revisar a mano.
  const decidir = async (par, relacion, { silencioso = false } = {}) => {
    if (decidiendoRef.current) return 'saltada';
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
        if (contradice) {
          if (silencioso) { decidiendoRef.current = false; return 'saltada'; }
          if (!confirm('Ojo: una decisión anterior dice que estos grupos son DISTINTOS. ¿Unirlos igual?')) {
            decidiendoRef.current = false;
            return 'saltada';
          }
        }
      }
      // Canónico con el nombre CRUDO de la factura (los normalizados en
      // minúsculas quedarían feos como display permanente del grupo).
      const crudoA = par.crudoA || muestraDe.get(par.nombre_a)?.nombre || par.nombre_a;
      const crudoB = par.crudoB || muestraDe.get(par.nombre_b)?.nombre || par.nombre_b;
      const canonico = relacion === 'mismo'
        ? (crudoA.length >= crudoB.length ? crudoA : crudoB)
        : null;
      await corrHook.create({
        id: window.__newId(),
        nombre_a: par.nombre_a, nombre_b: par.nombre_b,
        relacion, canonico, fuente: 'manual', deleted_at: null,
      });
      // El par quedó resuelto: la propuesta de la IA ya no espera a nadie.
      olvidarRecomendacion('correlaciones', ambitoIA, clavePar(par));
      if (!silencioso) {
        showToast?.(relacion === 'mismo'
          ? '✓ Correlacionados — no se volverá a preguntar por este par'
          : '✓ Marcados como distintos — no se volverá a preguntar', 'green');
      }
      return 'aplicada';
    } catch (e) { if (!silencioso) showToast?.('Error: ' + (e.message || e), 'red'); throw e; }
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

  const decidirCluster = async (cluster, relacion = 'mismo', soloEstas = null, { silencioso = false } = {}) => {
    if (decidiendoRef.current) return 'saltada';
    decidiendoRef.current = true;
    // La clave de la propuesta se calcula ANTES de recortar el cluster: abajo
    // `cluster` se reemplaza por el de las variantes marcadas y la clave del
    // recortado no es la del grupo que se propuso.
    const claveIA = claveCluster(cluster);
    try {
      // `soloEstas` son las variantes que quedaron marcadas en la tarjeta: se
      // puede sacar alguna del grupo antes de aceptarlo. La que se saca NO se
      // marca como distinta — simplemente no entra a este grupo, y vuelve a
      // aparecer como par suelto para decidirla mirándola.
      const cluster0 = soloEstas && soloEstas.length
        ? { ...cluster, variantes: soloEstas, canonico: soloEstas.reduce((m, n) => (n.length > m.length ? n : m), soloEstas[0]) }
        : cluster;
      cluster = cluster0;
      // 🔴 La firma es (variantes, canonico, relacion, opts). Pasarle el CLUSTER
      // entero como primer argumento tiraba «(variantes || []).map is not a
      // function» y, peor, corría `relacion` al lugar de `canonico`: el botón
      // «Son distintos» habría guardado 'mismo' si el throw no lo hubiera
      // tapado. Los dos bugs vivían en la misma línea.
      // El canónico va con el nombre CRUDO de la factura, igual que en el
      // decidir de a pares: los normalizados en minúscula quedan feos como
      // display permanente del grupo.
      const canonicoCrudo = relacion === 'mismo'
        ? (muestraDe.get(normInsumo(cluster.canonico))?.nombre || cluster.canonico)
        : null;
      const pares = crearParesDeCluster(cluster.variantes, canonicoCrudo, relacion);
      if (!pares.length) return 'saltada';
      for (const p of pares) {
        await corrHook.create({
          id: window.__newId(),
          nombre_a: p.nombre_a,
          nombre_b: p.nombre_b,
          relacion: p.relacion,
          canonico: p.canonico,
          fuente: 'manual',
          deleted_at: null,
        });
      }
      olvidarRecomendacion('correlaciones', ambitoIA, claveIA);
      if (!silencioso) {
        showToast?.(relacion === 'mismo'
          ? `✓ ${cluster.variantes.length} variantes correlacionadas bajo «${canonicoCrudo}» (${pares.length} enlaces)`
          : `✓ Grupo de ${cluster.variantes.length} variantes marcado como distintos`, 'green');
      }
      return 'aplicada';
    } catch (e) {
      if (!silencioso) showToast?.('Error: ' + (e.message || e), 'red');
      throw e;
    } finally {
      decidiendoRef.current = false;
    }
  };

  // ── El recorrido completo con IA (14-sep) ─────────────────────────
  // «Lo mismo para correlaciones»: recorre los grupos de variantes y las
  // sugerencias individuales de la pestaña actual (Insumos o Servicios,
  // ya que `sugerencias`/`clustersSugeridos` apuntan a la que está activa).
  // Los clusters van primero — resuelven varios nombres de un golpe.
  //
  // 🔴 NO DECIDE NADA en el modo por defecto: deja el veredicto de la IA en
  // la tarjeta de cada grupo/par, y el botón de siempre («Unir las N», «Son
  // distintos») lo sigue apretando una persona. Ver barrido-ia.js.
  const construirBarrido = (modo) => ({
    items: [
      ...clustersSugeridos.map(item => ({ tipo: 'cluster', item })),
      ...sugerencias.map(item => ({ tipo: 'par', item })),
    ],
    procesarItem: async (t) => {
      if (t.tipo === 'cluster') {
        const c = t.item;
        const variantes = c.variantes.map(v => muestraDe.get(normInsumo(v))?.nombre || v);
        const r = await correlacionarConIA({ variantes });
        if (!r?.result) return 'saltada';
        const conf = r.confianza || 0;
        // Mismo mapeo normalizado que "Usar esta" del botón individual —
        // ver el comentario de AyudaCorrelacionIA sobre por qué NO comparar
        // los nombres crudos (el server los devuelve ya saneados).
        const dentroNorm = new Set((r.result.mismas || []).map(normInsumo));
        const dentro = c.variantes.filter(v => dentroNorm.has(normInsumo(muestraDe.get(normInsumo(v))?.nombre || v)));
        if (modo === 'aplicar') {
          if (conf < UMBRAL_BARRIDO_IA || dentro.length < 2) return 'saltada';
          const res = await decidirCluster(c, 'mismo', dentro, { silencioso: true });
          return res === 'aplicada' ? 'aplicada' : 'saltada';
        }
        guardarRecomendacion('correlaciones', ambitoIA, claveCluster(c), {
          mismas: r.result.mismas || [], fuera: r.result.fuera || [],
          confianza: conf, razonamiento: r.razonamiento || '',
        });
        return 'recomendada';
      }
      const par = t.item;
      const ma = muestraDe.get(par.nombre_a), mb = muestraDe.get(par.nombre_b);
      const nombreA = ma?.nombre || par.nombre_a, nombreB = mb?.nombre || par.nombre_b;
      const r = await correlacionarConIA({ variantes: [nombreA, nombreB] });
      if (!r?.result) return 'saltada';
      const conf = r.confianza || 0;
      if (modo === 'aplicar') {
        if (conf < UMBRAL_BARRIDO_IA) return 'saltada';
        // Acá "distinto" con confianza alta TAMBIÉN se aplica: descartar la
        // sugerencia es una decisión válida, y sacarla de la cola es el punto.
        const relacion = (r.result.mismas || []).length >= 2 ? 'mismo' : 'distinto';
        const res = await decidir(par, relacion, { silencioso: true });
        return res === 'aplicada' ? 'aplicada' : 'saltada';
      }
      guardarRecomendacion('correlaciones', ambitoIA, clavePar(par), {
        mismas: r.result.mismas || [], fuera: r.result.fuera || [],
        confianza: conf, razonamiento: r.razonamiento || '',
      });
      return 'recomendada';
    },
  });

  const insumoSel = sel ? porInsumo.get(sel) : null;
  const masBarato = insumoSel ? proveedorMasBarato(insumoSel) : null;

  return (
    // page-wrap = el contenedor con scroll de toda página (mismo fix que el
    // portal de campo: sin él la página no deslizaba).
    <div className="page-wrap">
    <div style={{ display: 'grid', gap: 12 }}>
      {window.EmpresaActivaBanner ? <window.EmpresaActivaBanner/> : null}

      <div className="card card-p" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 240, flex: 1 }}>
          <label style={{ fontSize: 11, color: 'var(--tm)' }}>Base de insumos de</label>
          <select className="fi" value={empresaVista || ''} disabled={!!empresaFija}
            title={empresaFija ? 'Estás dentro de la contabilidad de esta empresa: la base es solo suya.' : undefined}
            onChange={e => { setEmpresaSel(e.target.value); setSel(null); }}>
            {!empresaFija && <option value="">Todo el grupo ({comprasTodas.length} líneas de compra)</option>}
            {empresas.filter(c => !empresaFija || c.id === empresaFija).map(c => (
              <option key={c.id} value={c.id}>{c.name || c.id}</option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--tm)', flex: 2, minWidth: 260 }}>
          {empresaVista
            ? <>Todo lo de abajo —precios, correlaciones, catálogo y categorización— es de <strong>{nombreEmpresa || 'esta entidad'}</strong>: {compras.length} líneas de compra. Su catálogo propio manda sobre el general del grupo.</>
            : <>Sin entidad elegida se ve el grupo entero. Eligiendo una, las cuatro pestañas quedan en <strong>su</strong> base de insumos.</>}
        </div>
      </div>

      <div className="card card-p" style={{ background: 'var(--tint-neutral)', borderLeft: '4px solid var(--blue)', fontSize: 12, lineHeight: 1.5 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <strong style={{ fontSize: 13, color: 'var(--blue)' }}>
            💡 Guía de Insumos y Servicios en JARVEX
          </strong>
          <span style={{ fontSize: 11, color: 'var(--tm)' }}>Base de datos central con aprendizaje global entre entidades</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 8 }}>
          <div style={{ padding: '8px 10px', background: 'var(--bg-c)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--ts)', marginBottom: 2 }}>🗂 1. Clasificación</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              La única sección donde se clasifican los insumos y servicios de la entidad, y donde se reconocen
              los nombres con que aparecen en las facturas.
            </div>
          </div>
          <div style={{ padding: '8px 10px', background: 'var(--bg-c)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--ts)', marginBottom: 2 }}>🤝 2. Correlaciones</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              Une variantes de nombres del mismo insumo y cruza compras con ventas para cuadrar inventarios y saldos.
            </div>
          </div>
          <div style={{ padding: '8px 10px', background: 'var(--bg-c)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--ts)', marginBottom: 2 }}>🎯 3. Mapeo al presupuesto</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              Dice qué insumo del presupuesto de un trabajo es cada insumo ya clasificado de la entidad.
            </div>
          </div>
          <div style={{ padding: '8px 10px', background: 'var(--bg-c)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--ts)', marginBottom: 2 }}>🔍 4. Comparador de precios</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              Qué proveedor vendió cada insumo, a qué precio y cómo evolucionó.
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'comparador' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('comparador')}>🔍 Comparador de precios</button>
        <button className={`btn btn-sm ${tab === 'correlaciones' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('correlaciones')}>
          🤝 Correlaciones{(sugerenciasInsumos.length + sugerenciasServicios.length) ? <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>{sugerenciasInsumos.length + sugerenciasServicios.length}</span> : null}
        </button>
        <button className={`btn btn-sm ${tab === 'mapeo' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('mapeo')}>
          🎯 Mapeo al presupuesto
        </button>
        <button className={`btn btn-sm ${tab === 'catalogo' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('catalogo')}>
          🗂 Clasificación de insumos y servicios
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

      {tab === 'mapeo' && (
        <MapeoInsumosTab showToast={showToast} empresaFija={empresaVista} />
      )}

      {/* UNA SOLA SECCIÓN DE CLASIFICACIÓN (13-set-2026). Antes esto eran dos
          pestañas —«Catálogo» y «Categorizar»— que contestaban mitades de la
          misma pregunta y mostraban dos números que no cerraban (484 vs 723).
          Ahora es una sección con tres vistas; el encabezado de adentro
          explica qué cuenta cada número. */}
      {tab === 'catalogo' && (
        <CatalogoCanonicoTab
          showToast={showToast}
          empresaFija={empresaVista}
          compras={compras}
          vistaInicial={vistaCatalogo}
        />
      )}

      {tab === 'correlaciones' && (
        <>
          <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6 }}>
            El sistema propone nombres que PARECEN el mismo insumo facturado distinto por cada proveedor (cruzando compras y ventas).
            Tu decisión queda grabada y <strong>no se vuelve a preguntar</strong>: "mismo" los une en el comparador y en el inventario; "distintos" descarta la sugerencia para siempre.
            <div style={{ marginTop: 4 }}>
              Mira <strong>solo</strong> las compras y ventas de {empresaVista ? <>«{nombreEmpresa || 'esta entidad'}»</> : 'todo el grupo (sin entidad elegida arriba)'}
              {' '}— los movimientos de otra empresa quedan afuera de este cálculo.
            </div>
          </div>

          {/* Unir dos insumos manualmente */}
          <div className="card card-p" style={{ border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🔗</span> Unir dos insumos manualmente (compras o ventas)
            </div>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginBottom: 10 }}>
              Si dos comprobantes registraron el mismo insumo con nombres distintos (o querés correlacionar lo que compraste con lo que vendiste para que cuadre en tu inventario), seleccionalos acá y hacé clic en "Unir como mismo insumo".
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={{ fontSize: 10.5, color: 'var(--tm)', display: 'block', marginBottom: 3 }}>Primer insumo (compra o venta)</label>
                <input
                  className="fi"
                  list="insumos-lista-a"
                  placeholder="Escribí o seleccioná un nombre..."
                  value={manualA}
                  onChange={e => setManualA(e.target.value)}
                  style={{ width: '100%' }}
                />
                <datalist id="insumos-lista-a">
                  {nombresDisponibles.map(n => <option key={`a-${n}`} value={n} />)}
                </datalist>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', paddingBottom: 6, color: 'var(--tm)', fontWeight: 700, fontSize: 15 }}>
                ↔
              </div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <label style={{ fontSize: 10.5, color: 'var(--tm)', display: 'block', marginBottom: 3 }}>Segundo insumo equivalente</label>
                <input
                  className="fi"
                  list="insumos-lista-b"
                  placeholder="Escribí o seleccioná el equivalente..."
                  value={manualB}
                  onChange={e => setManualB(e.target.value)}
                  style={{ width: '100%' }}
                />
                <datalist id="insumos-lista-b">
                  {nombresDisponibles.map(n => <option key={`b-${n}`} value={n} />)}
                </datalist>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-green btn-sm"
                  disabled={!manualA.trim() || !manualB.trim() || normInsumo(manualA) === normInsumo(manualB)}
                  onClick={async () => {
                    // decidir() ya avisa por toast si falla y relanza el error
                    // (lo necesita el barrido de IA); acá solo hace falta no
                    // dejarlo sin atrapar, y no limpiar el formulario si no
                    // se guardó nada — así la persona no reescribe de cero.
                    try {
                      await decidir({
                        nombre_a: normInsumo(manualA),
                        nombre_b: normInsumo(manualB),
                        crudoA: manualA.trim(),
                        crudoB: manualB.trim(),
                      }, 'mismo');
                      setManualA('');
                      setManualB('');
                    } catch {}
                  }}
                >
                  ✓ Unir como mismo insumo
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!manualA.trim() || !manualB.trim() || normInsumo(manualA) === normInsumo(manualB)}
                  onClick={async () => {
                    try {
                      await decidir({
                        nombre_a: normInsumo(manualA),
                        nombre_b: normInsumo(manualB),
                        crudoA: manualA.trim(),
                        crudoB: manualB.trim(),
                      }, 'distinto');
                      setManualA('');
                      setManualB('');
                    } catch {}
                  }}
                >
                  ✗ Marcar como distintos
                </button>
              </div>
            </div>
          </div>

          {/* Insumos y servicios son preguntas distintas — pedido de Gabriel,
              14-sep: un "codo PVC" nunca debería competir por atención contra
              un "alquiler de volquete" en la misma lista. */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`btn btn-sm ${subTabCorr === 'insumos' ? 'btn-blue' : 'btn-ghost'}`}
              onClick={() => setSubTabCorr('insumos')}>
              🧱 Insumos
              {(sugerenciasInsumos.length + clustersInsumos.length) > 0 && (
                <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>
                  {sugerenciasInsumos.length + clustersInsumos.length}
                </span>
              )}
            </button>
            <button className={`btn btn-sm ${subTabCorr === 'servicios' ? 'btn-blue' : 'btn-ghost'}`}
              onClick={() => setSubTabCorr('servicios')}>
              🛠 Servicios
              {(sugerenciasServicios.length + clustersServicios.length) > 0 && (
                <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>
                  {sugerenciasServicios.length + clustersServicios.length}
                </span>
              )}
            </button>
          </div>

          <BarridoIA
            seccion="correlaciones"
            ambito={ambitoIA}
            etiqueta={subTabCorr === 'servicios' ? 'los servicios' : 'los insumos'}
            cantidadPendiente={clustersSugeridos.length + sugerencias.length}
            cantidadRecomendadas={nRecomendadasIA}
            construir={construirBarrido}
          />

          {/* ── Clusters Multi-Insumo (N a N) ────────────────── */}
          {clustersSugeridos.length > 0 && (
            <div className="card card-p" style={{ borderLeft: '3px solid var(--green)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📦</span> Grupos de variantes sugeridos ({clustersSugeridos.length} {clustersSugeridos.length === 1 ? 'grupo multi-insumo' : 'grupos multi-insumo'})
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ts)', marginBottom: 10, lineHeight: 1.5 }}>
                Las distintas formas en que cada proveedor escribe el mismo insumo, agrupadas de una.
                <strong> Tocá una variante para sacarla del grupo</strong> antes de aceptarlo: la que saques no queda
                marcada como distinta — vuelve a aparecer abajo, como par suelto, para decidirla mirándola.
                Al aceptar, el grupo desaparece de acá y el resto se recalcula solo.
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {clustersSugeridos.map(c => {
                  const fuera = excluidasCluster[c.id] || [];
                  const dentro = c.variantes.filter(v => !fuera.includes(v));
                  const canon = dentro.length
                    ? dentro.reduce((m, n) => (n.length > m.length ? n : m), dentro[0])
                    : c.canonico;
                  const togglear = (v) => setExcluidasCluster(p => {
                    const act = p[c.id] || [];
                    return { ...p, [c.id]: act.includes(v) ? act.filter(x => x !== v) : [...act, v] };
                  });
                  return (
                  <div key={c.id} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 7, background: 'var(--bg-s)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
                      <div>
                        <strong style={{ fontSize: 13 }}>{canon}</strong>
                        <span className="badge b-blue" style={{ marginLeft: 8 }}>
                          {dentro.length} {dentro.length === 1 ? 'variante' : 'variantes'}
                        </span>
                        <span className="badge b-green" style={{ marginLeft: 6 }}>
                          {Math.round((c.score || 0) * 100)}% similitud
                        </span>
                        {fuera.length > 0 && (
                          <span className="badge b-amber" style={{ marginLeft: 6 }}>
                            {fuera.length} fuera del grupo
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-green btn-xs"
                          style={{ fontWeight: 600 }}
                          disabled={dentro.length < 2}
                          title={dentro.length < 2 ? 'Hacen falta al menos dos variantes para unir' : undefined}
                          onClick={() => decidirCluster(c, 'mismo', dentro).catch(() => {})}
                        >
                          ✓ Unir {dentro.length === c.variantes.length ? `las ${dentro.length} variantes` : `las ${dentro.length} marcadas`}
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          disabled={dentro.length < 2}
                          onClick={() => decidirCluster(c, 'distinto', dentro).catch(() => {})}
                        >
                          ✗ Son distintos
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {c.variantes.map((v, vi) => {
                        const m = muestraDe.get(normInsumo(v));
                        const off = fuera.includes(v);
                        return (
                          <button
                            key={vi}
                            className={`badge ${off ? 'b-gray' : 'b-blue'}`}
                            onClick={() => togglear(v)}
                            style={{
                              fontSize: 11, padding: '3px 8px', border: 'none', cursor: 'pointer',
                              fontFamily: 'inherit', opacity: off ? 0.45 : 1,
                              textDecoration: off ? 'line-through' : 'none',
                            }}
                            title={off
                              ? 'Fuera del grupo — tocá para volver a incluirla'
                              : `Tocá para sacarla del grupo${m ? ` · ${m.doc} · ${m.proveedorNombre}` : ''}`}
                          >
                            {off ? '＋' : '✓'} «<NombreConDiferencias nombre={v} otro={canon} />» {m && <span style={{ color: 'var(--tm)' }}>({m.proveedorNombre || 'factura'})</span>}
                          </button>
                        );
                      })}
                    </div>
                    {/* La IA marca por vos cuáles quedan adentro: después
                        seguís tocando "Unir las N marcadas", que es la
                        decisión que se guarda. Los nombres van CRUDOS —
                        la medida ("1/2") es justo lo que hay que juzgar. */}
                    <AyudaCorrelacionIA
                      variantes={c.variantes.map(v => muestraDe.get(normInsumo(v))?.nombre || v)}
                      inicial={recsIA[claveCluster(c)] || null}
                      onDescartar={() => olvidarRecomendacion('correlaciones', ambitoIA, claveCluster(c))}
                      textoAplicar={(mismas) => (mismas.length >= 2 ? `Marcar solo esas ${mismas.length}` : null)}
                      onAplicar={(mismas) => {
                        // Se comparan NORMALIZADOS: el nombre que vuelve pasó
                        // por el saneado del server (espacios colapsados,
                        // corte a 160) y un === contra el crudo dejaba afuera
                        // justo las que la IA había dejado adentro.
                        const dentroNorm = new Set(mismas.map(normInsumo));
                        setExcluidasCluster(p => ({
                          ...p,
                          [c.id]: c.variantes.filter(v => !dentroNorm.has(
                            normInsumo(muestraDe.get(normInsumo(v))?.nombre || v)
                          )),
                        }));
                      }}
                    />
                  </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="card card-p">
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>Sugerencias individuales ({sugerencias.length})</div>
            {sugerencias.length > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 8 }}>
                Lo resaltado en <span style={{ background: 'rgba(242,183,5,.28)', borderRadius: 3, padding: '0 2px' }}>ámbar</span> es
                {' '}lo que NO tienen en común — mirá eso primero para decidir rápido.
              </div>
            )}
            {sugerencias.length === 0 && <div style={{ color: 'var(--tm)', fontStyle: 'italic', fontSize: 12 }}>No hay pares nuevos para revisar — al registrar más facturas aparecerán acá.</div>}
            <div style={{ display: 'grid', gap: 8 }}>
              {sugerencias.map(par => {
                const ma = muestraDe.get(par.nombre_a), mb = muestraDe.get(par.nombre_b);
                const nombreA = ma?.nombre || par.nombre_a, nombreB = mb?.nombre || par.nombre_b;
                return (
                  <div key={`${par.nombre_a}|${par.nombre_b}`} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
                      <strong><NombreConDiferencias nombre={nombreA} otro={nombreB} /></strong>
                      <span style={{ color: 'var(--tm)' }}>≈</span>
                      <strong><NombreConDiferencias nombre={nombreB} otro={nombreA} /></strong>
                      <span className="badge b-gray" style={{ fontSize: 9 }}>{Math.round(par.score * 100)}% parecido</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
                      {ma && <>«{ma.nombre}» visto en {ma.doc} · {ma.proveedorNombre} · {fmtPrecio(ma.precio, ma.moneda)}. </>}
                      {mb && <>«{mb.nombre}» visto en {mb.doc} · {mb.proveedorNombre} · {fmtPrecio(mb.precio, mb.moneda)}.</>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button className="btn btn-green btn-xs" onClick={() => decidir(par, 'mismo').catch(() => {})}>✓ Mismo insumo</button>
                      <button className="btn btn-ghost btn-xs" onClick={() => decidir(par, 'distinto').catch(() => {})}>✗ Son distintos</button>
                    </div>
                    <AyudaCorrelacionIA
                      variantes={[nombreA, nombreB]}
                      inicial={recsIA[clavePar(par)] || null}
                      onDescartar={() => olvidarRecomendacion('correlaciones', ambitoIA, clavePar(par))}
                      textoAplicar={(mismas) => (mismas.length >= 2 ? '✓ Unir como mismo insumo' : '✗ Marcar como distintos')}
                      onAplicar={(mismas) => {
                        olvidarRecomendacion('correlaciones', ambitoIA, clavePar(par));
                        decidir(par, mismas.length >= 2 ? 'mismo' : 'distinto').catch(() => {});
                      }}
                    />
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
