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
  resolverPares, construirGrupos, sugerirCandidatos, crearParesDeCluster, normInsumo,
  resaltarDiferencias, camposDeFactor, tieneFactor,
} from "../lib/insumo-correlacion.js";
import {
  extraerLineasDeFacturas, extraerComprasDeFacturas, agruparComprasPorInsumo, proveedorMasBarato, seriePrecios,
} from "../lib/analisis-insumos.js";
import {
  arbolPorNombre, entraEnPestania, contarArboles, noInventariables,
  AMBITO_NO_INVENTARIO, DECISION_NO_INVENTARIO, llaveNoInventario,
} from "../lib/insumo-o-servicio.js";
import { decidirCotejo } from "../lib/cotejo-sunat-db.js";
import { correlacionarConIA } from "../lib/ia-insumos.js";
import { candidatosPorMismoInsumo, unirCandidatos } from "../lib/correlacion-por-clasificacion.js";
import { bandaDePar, bandaDeGrupo, CONFIANZA_OBVIO, unidadesEnConflicto } from "../lib/bandas-correlacion.js";
import { normUnidad, labelUnidad, factorConocido } from "../lib/inventario-empresa.js";
import { modelosDe } from "../lib/modelos-ia-config.js";
import { UMBRAL_BARRIDO_IA } from "../lib/barrido-ia.js";
import { guardarRecomendacion, olvidarRecomendacion } from "../lib/barrido-store.js";
import { BarridoIA, useBarridoIA } from "./jx-barrido-ia.jsx";
import { MapeoInsumosTab } from "./jx-mapeo-insumos.jsx";
import { CatalogoCanonicoTab } from "./jx-catalogo-canonico.jsx";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR, useCallback: uC } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

// El corte insumo / servicio / ni-uno-ni-otro vive en `insumo-o-servicio.js`
// (tanda 3, 15-set-2026), que mira TRES señales en vez de una: el estándar
// IUPC con el diccionario propio, el texto de la factura y el `tipo_insumo`
// que anotó Captura Mágica. Acá arriba había una versión de una sola señal y
// por eso el arbitraje del Consorcio Santa aparecía en 🧱 Insumos — ver la
// cabecera de esa lib, que explica el caso con nombre y número de factura.

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
 * EL FACTOR ENTRE PRESENTACIONES (tanda 5, 15-set-2026).
 *
 * Gabriel, probando la tanda 2: «encontré un caso sobre un par de guantes en
 * unidades y el otro en par, que resulta que sí son lo mismo». SON lo mismo y
 * unirlos es correcto — lo que faltaba era poder SUMARLOS. Sin factor, el
 * inventario deja «20 par» y «15 und» en dos filas que nadie puede restar.
 *
 * 🔴 EL FACTOR ES OPCIONAL Y SE PUEDE SALTEAR. «Unir sin factor» hace
 * exactamente lo de siempre, y es lo correcto cuando nadie sabe todavía
 * cuántos kilos pesa un rollo de alambre: un número inventado es peor que dos
 * filas separadas, porque dos filas se ven y un total falso no.
 */
function FactorPresentacion({ unidadA, unidadB, nombreA, nombreB, onUnir, onCancelar }) {
  // La base arranca en la unidad de B y el factor en lo que la aritmética ya
  // sabe (una docena son doce). Si no se sabe, el campo queda vacío: no se
  // propone un número inventado — se aceptaría sin mirar.
  const [base, setBase] = uS(unidadB);
  const otra = base === unidadB ? unidadA : unidadB;
  const sugerido = factorConocido(otra, base);
  const [factor, setFactor] = uS(sugerido != null ? String(sugerido) : '');
  uE(() => {
    const s = factorConocido(base === unidadB ? unidadA : unidadB, base);
    setFactor(s != null ? String(s) : '');
  }, [base, unidadA, unidadB]);

  const n = Number(String(factor).replace(',', '.'));
  const valido = Number.isFinite(n) && n > 0;
  const nombreDeOtra = otra === unidadA ? nombreA : nombreB;

  return (
    <div style={{
      marginTop: 6, padding: '8px 10px', borderRadius: 6, fontSize: 11.5,
      background: 'rgba(58,163,255,.07)', border: '1px solid rgba(58,163,255,.3)',
    }} onClick={e => e.stopPropagation()}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        📏 Son el mismo insumo en otra presentación
      </div>
      <div style={{ color: 'var(--ts)', marginBottom: 6, lineHeight: 1.5 }}>
        Para que las cantidades se puedan sumar en el inventario hace falta saber cómo se convierte una
        en la otra. Si no lo sabés todavía, unilos igual: quedan en dos filas separadas, que es lo que
        pasa hoy — y se puede completar después.
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>Contar todo en:</span>
        <select className="fi" style={{ width: 'auto' }} value={base} onChange={e => setBase(e.target.value)}>
          <option value={unidadB}>{labelUnidad(unidadB)}</option>
          <option value={unidadA}>{labelUnidad(unidadA)}</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <span>1 {labelUnidad(otra)} de «{String(nombreDeOtra).slice(0, 28)}{String(nombreDeOtra).length > 28 ? '…' : ''}» =</span>
        <input className="fi" style={{ width: 90 }} inputMode="decimal" value={factor}
          placeholder="¿cuántos?" onChange={e => setFactor(e.target.value)} />
        <span>{labelUnidad(base)}</span>
        {sugerido != null && <span className="badge b-gray" style={{ fontSize: 9 }}>propuesto</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-green btn-xs" disabled={!valido}
          title={valido ? undefined : 'Escribí cuántas unidades entran, o usá «Unir sin factor»'}
          onClick={() => onUnir({
            unidadBase: base,
            unidadA, factorA: unidadA === base ? 1 : n,
            unidadB, factorB: unidadB === base ? 1 : n,
          })}>
          ✓ Unir y convertir
        </button>
        <button className="btn btn-ghost btn-xs" onClick={() => onUnir(null)}>
          Unir sin factor
        </button>
        <button className="btn btn-ghost btn-xs" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

/**
 * La unidad en la que se factura un nombre, al lado del nombre (tanda 2).
 *
 * Gabriel, 15-set: «no compara unidades». Antes de que la decida nadie —ni la
 * persona ni la IA— hay que poder VERLA: «ALAMBRE DE AMARRE 16» y «ALAMBRE
 * NEGRO 16» son la misma frase, pero uno se factura en unidades y el otro en
 * kilos, y esa diferencia no estaba en ninguna parte de esta pantalla.
 *
 * `choca` la pinta en ámbar: es la señal de mirar, no de rechazar (unir un kg
 * con una und puede ser correcto y necesitar un factor — ver bandas-correlacion).
 */
function BadgeUnidad({ unidad, choca = false }) {
  if (!unidad) return null;
  return (
    <span
      className={`badge ${choca ? 'b-amber' : 'b-gray'}`}
      style={{ fontSize: 9, marginLeft: 4 }}
      title={choca
        ? 'Los dos nombres se facturan en unidades distintas: puede ser el mismo insumo en otra presentación (hace falta un factor de conversión) o dos cosas distintas.'
        : 'Unidad en la que se factura este nombre'}
    >
      {choca ? '⚠ ' : ''}{labelUnidad(unidad)}
    </span>
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
function AyudaCorrelacionIA({ variantes, unidades = null, textoAplicar, onAplicar, inicial = null, onDescartar = null, banda = null, modeloTexto = null }) {
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
      const r = await correlacionarConIA({ variantes, unidades, modeloTexto });
      if (!r?.result) { setError(r?.razonamiento || 'La IA no pudo decidir esto.'); return; }
      setRes({
        ...r.result, confianza: r.confianza, razonamiento: r.razonamiento, cached: !!r._cached,
        unidades: r.unidades || null, unidades_en_conflicto: !!r.unidades_en_conflicto,
      });
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
      {/* ── EL PRE-FILTRO LOCAL (tanda 4) ────────────────────────────
          Cuando los dos nombres dicen exactamente lo mismo no hay nada que
          preguntar: la respuesta está acá, gratis y al instante. Igual hay
          que apretar el botón — lo que se ahorra es la pregunta, no la
          revisión. Cuando SÍ hay algo que juzgar, se dice qué es: eso es lo
          que hay que mirar antes de gastar un viaje a la IA. */}
      {!mostrado && banda?.banda === 'obvio' && (
        <div style={{
          padding: '5px 8px', fontSize: 10.5, borderRadius: 5, maxWidth: 520,
          background: 'rgba(46,204,113,.09)', border: '1px solid rgba(46,204,113,.35)',
        }}>
          <span className="badge b-green" style={{ fontSize: 9 }}>⚡ Sin IA</span>
          <span style={{ marginLeft: 6 }}>{banda.motivo}</span>
          {textoAplicar && textoAplicar(variantes) && (
            <div style={{ marginTop: 4 }}>
              <button type="button" className="btn btn-xs btn-green"
                onClick={(e) => { e.stopPropagation(); onAplicar?.(variantes, []); }}>
                {textoAplicar(variantes)}
              </button>
            </div>
          )}
        </div>
      )}
      {!mostrado && banda?.banda !== 'obvio' && (
        <button type="button" className="btn btn-xs btn-ghost" disabled={cargando} onClick={preguntar}
          title={banda?.motivo || undefined}>
          {cargando ? '🤖 Pensando…' : '🤖 Preguntale a la IA'}
        </button>
      )}
      {!mostrado && banda?.banda === 'consultar' && (
        <span style={{ fontSize: 10, color: 'var(--tm)', marginLeft: 6 }}>{banda.motivo}</span>
      )}
      {error && <span style={{ color: 'var(--red)', fontSize: 10.5, marginLeft: 6 }}>{error}</span>}
      {mostrado && (() => { const res = mostrado; return (
        <div style={{
          marginTop: 4, padding: '5px 8px', fontSize: 10.5, borderRadius: 5, maxWidth: 520,
          background: sonElMismo ? 'rgba(46,204,113,.09)' : 'rgba(231,76,60,.08)',
          border: `1px solid ${sonElMismo ? 'rgba(46,204,113,.35)' : 'rgba(231,76,60,.3)'}`,
        }}>
          {deRecorrido
            ? (res.origen === 'local'
              ? <span className="badge b-green" style={{ fontSize: 9, marginRight: 4 }}
                  title="No se le preguntó a la IA: los dos nombres dicen lo mismo.">⚡ Resuelto sin IA</span>
              : <span className="badge b-blue" style={{ fontSize: 9, marginRight: 4 }}>🤖 Recomendado por IA</span>)
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
          {/* ── QUÉ UNIDADES VIO LA IA (15-set, tarde) ────────────────
              Gabriel probó un par de unidades distintas: «la verdad no me
              mencionó las unidades». Sin esta línea, «no lo mencionó» y «no
              le llegaron» son indistinguibles desde afuera. Ahora se ve
              exactamente lo que se mandó. */}
          {Array.isArray(res.unidades) && res.unidades.some(u => u.unidad) && (
            <div style={{ color: 'var(--tm)', marginTop: 2, fontSize: 10 }}>
              Unidades que se le mandaron: {res.unidades
                .map(u => `${u.unidad ? labelUnidad(u.unidad) : '—'}`)
                .join(' · ')}
              {res.unidades_en_conflicto && (
                <span className="badge b-amber" style={{ fontSize: 9, marginLeft: 4 }}>⚠ distintas</span>
              )}
            </div>
          )}
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
  // El modelo que el admin eligió para el módulo de insumos (Administración →
  // Modelos de IA). Ver `modeloTextoIA` más abajo.
  const { data: cfgIA } = window.__hooks?.useAppConfig?.() || { data: [] };
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
    // Abre en el PASO 1 de la cadena (15-set): la guia numera el orden de
    // trabajo y el comparador es consulta, no trabajo.
    return 'correlaciones';
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
  // Compras Y VENTAS de la entidad, sin notas (tanda 3, 15-sep-2026): lo que
  // alimenta el Catálogo y la bandeja de clasificación. Una descripción que la
  // entidad solo VENDE (nunca la compró) tiene que poder clasificarse igual —
  // ver el encabezado de `agruparDescripciones`. El comparador de precios de
  // abajo (`compras`) sigue siendo solo-compra a propósito: un precio de venta
  // no es un precio de proveedor.
  const lineasParaCatalogo = uM(
    () => lineasEntidad.filter(l => !l.esNota),
    [lineasEntidad]
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
  // ── EL ÁRBOL DE CADA NOMBRE (tanda 3, 15-set) ────────────────────
  // Insumos y servicios son preguntas DISTINTAS para correlacionar — pedido
  // de Gabriel, 14-sep: «dividir entre las sugerencias de insumos y las de
  // servicios». Y desde el 15-set hay una TERCERA: lo que no es ninguna de
  // las dos (arbitrajes, seguros, detracciones, anticipos). Ver
  // `insumo-o-servicio.js`, que documenta las tres señales y el caso real.
  // Un solo nombre único clasificado una vez (memoizado: son potencialmente
  // miles de líneas, clasificar de más sería regalado).
  const arbolDe = uM(
    () => arbolPorNombre(lineasEntidad, { terminosCustom }),
    [lineasEntidad, terminosCustom]
  );
  const conteoArboles = uM(() => contarArboles(arbolDe), [arbolDe]);
  // ── «ESTO NO VA AL INVENTARIO» (tanda 3) ─────────────────────────
  // Lo que una persona ya descartó no vuelve a preguntarse en ninguna de las
  // tres pestañas. Se guarda por DESCRIPCIÓN (no por par): marcar un par no
  // sirve — la misma descripción reaparece mañana contra otro nombre.
  const decisHook = window.__hooks.useCotejoDecisiones();
  const descartadas = uM(() => noInventariables(decisHook.data || []), [decisHook.data]);
  // Los nombres de UNA pestaña, ya sin los descartados. Lo `desconocido`
  // entra en las tres a propósito: su gemela puede estar de cualquier lado
  // (ver `entraEnPestania`).
  const nombresDe = uC((pestania) => lineasEntidad
    .filter(l => !descartadas.has(l.nombreNorm)
      && entraEnPestania(arbolDe.get(l.nombreNorm) || 'desconocido', pestania))
    .map(l => l.nombre),
  [lineasEntidad, arbolDe, descartadas]);
  const nombresInsumos = uM(() => nombresDe('insumo'), [nombresDe]);
  const nombresServicios = uM(() => nombresDe('servicio'), [nombresDe]);
  const nombresOtros = uM(() => nombresDe('otro'), [nombresDe]);
  // ── UNA SOLA LISTA DE CANDIDATOS (tanda 4, 15-set) ───────────────
  // Gabriel: «actualmente no entiendo las sugerencias individual y las
  // múltiples». Eran DOS listas que salían de la misma función y ninguna
  // excluía a la otra: el mismo par aparecía arriba dentro de un grupo y
  // abajo suelto, y el recorrido con IA lo preguntaba y lo pagaba dos veces.
  // Ahora un candidato es un conjunto de 2 o más nombres y un «par» es
  // simplemente un candidato de dos — ver `sugerirCandidatos`.
  //
  // Cada árbol por separado: un "REDUCCION PVC" nunca compite contra un
  // "ALQUILER DE VOLQUETE" por una raíz común.
  // ── LA SEGUNDA FUENTE DE CANDIDATOS (tanda 9, 15-set-2026) ───────
  // Gabriel: «acabé las recomendaciones y pensé que eso sería todo pero
  // después de ir clasificando me parece que hace falta correlacionar más».
  // Y hace falta: `sugerirCandidatos` propone por PARECIDO DE TEXTO, y al
  // clasificar aparece una señal que antes no existía — dos descripciones
  // pegadas al MISMO insumo del catálogo. Medido el 15-set: 170 pares que el
  // texto nunca acercó. Ver el encabezado de correlacion-por-clasificacion.js.
  const decCatHook = window.__hooks.useInsumoCategorias?.() || { data: [] };
  const catHookCorr = window.__hooks.useCatalogoInsumos?.() || { data: [] };
  const decisionesClasif = uM(
    () => (decCatHook.data || []).filter(d => d && !d.deleted_at && !!d.demo === esPrueba),
    [decCatHook.data, esPrueba],
  );
  const nombresCatalogo = uM(
    () => new Map((catHookCorr.data || []).filter(r => r && !r.deleted_at).map(r => [r.id, r.nombre])),
    [catHookCorr.data],
  );
  const porInsumoDe = uC((nombres) => candidatosPorMismoInsumo({
    decisiones: decisionesClasif, nombresVisibles: nombres,
    paresResueltos: resueltos, grupoDe, nombresCatalogo,
  }), [decisionesClasif, resueltos, grupoDe, nombresCatalogo]);

  const candidatosInsumos = uM(
    () => unirCandidatos(sugerirCandidatos(nombresInsumos, resueltos, grupoDe), porInsumoDe(nombresInsumos)),
    [nombresInsumos, resueltos, grupoDe, porInsumoDe]
  );
  const candidatosServicios = uM(
    () => unirCandidatos(sugerirCandidatos(nombresServicios, resueltos, grupoDe), porInsumoDe(nombresServicios)),
    [nombresServicios, resueltos, grupoDe, porInsumoDe]
  );
  const candidatosOtros = uM(
    () => unirCandidatos(sugerirCandidatos(nombresOtros, resueltos, grupoDe), porInsumoDe(nombresOtros)),
    [nombresOtros, resueltos, grupoDe, porInsumoDe]
  );
  const [subTabCorr, setSubTabCorr] = uS('insumos');
  const [verDescartadas, setVerDescartadas] = uS(false);
  // Qué candidato tiene abierto el paso del factor de conversión (tanda 5).
  const [factorAbierto, setFactorAbierto] = uS(null);
  // 'todos' | 'grupos' | 'pares' — el filtro reemplaza a las dos secciones.
  const [formaCorr, setFormaCorr] = uS('todos');
  const candidatosTodos = subTabCorr === 'servicios' ? candidatosServicios
    : subTabCorr === 'otros' ? candidatosOtros : candidatosInsumos;
  const candidatos = uM(() => {
    if (formaCorr === 'grupos') return candidatosTodos.filter(c => c.esGrupo);
    if (formaCorr === 'pares') return candidatosTodos.filter(c => !c.esGrupo);
    return candidatosTodos;
  }, [candidatosTodos, formaCorr]);
  const nGrupos = uM(() => candidatosTodos.filter(c => c.esGrupo).length, [candidatosTodos]);
  // El número de la pestaña «🤝 Correlaciones»: todo lo pendiente de los tres
  // árboles junto, que es lo que hay para revisar sin importar dónde esté.
  const pendientesCorr = candidatosInsumos.length + candidatosServicios.length + candidatosOtros.length;
  // Las propuestas del recorrido se guardan por ENTIDAD y por sub-pestaña:
  // insumos y servicios son dos listas distintas y no se mezclan.
  const ambitoIA = `${empresaVista || 'grupo'}::${subTabCorr}`;
  const { recomendaciones: recsIA } = useBarridoIA('correlaciones', ambitoIA);
  // 🔴 LA CLAVE DE UNA PROPUESTA SON SUS VARIANTES, NO UN id INVENTADO. Antes
  // `sugerirClusters` armaba el id con la raíz del union-find, que no cambia
  // cuando entra una variante nueva: un grupo {A,B,C} con la propuesta «uní A
  // y B» seguía mostrándola después de que una factura sumara D, y «Marcar
  // solo esas 2» dejaba afuera a D sin que la IA la hubiera visto jamás. Con
  // la clave por contenido, un grupo que cambió simplemente no tiene
  // propuesta y se vuelve a preguntar.
  //
  // Desde la tanda 4 el `id` del candidato YA ES el contenido ordenado (lo
  // arma `sugerirCandidatos`), así que la clave es el id: una sola forma de
  // nombrar una pregunta, en vez de las dos que había (`cl::` y `pa::`).
  const claveDe = (c) => c?.id || '';
  // La misma clave, para cuando solo se tienen los dos nombres sueltos (el
  // camino de `decidir`, que recibe un par y no un candidato).
  const claveDePar = (a, b) => `par:${[a, b].sort().join('|')}`;
  // Solo las que siguen apuntando a algo que hoy está en pantalla.
  const nRecomendadasIA = uM(
    () => candidatosTodos.filter(c => recsIA[claveDe(c)]).length,
    [candidatosTodos, recsIA],
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

  // ── EL PRE-FILTRO LOCAL (tanda 4) ────────────────────────────────
  // Antes de gastar un viaje a la IA por cada par y cada grupo, se mira si hay
  // algo que dudar. «CLAVO N 3» contra «CLAVOS NRO 3» no es una pregunta: es
  // la misma frase escrita por dos personas. Ver bandas-correlacion.js — la
  // banda `obvio` es estricta (no puede sobrar NADA de ninguno de los dos
  // lados) justamente para que nunca tape una diferencia real.
  //
  // Va sobre los nombres CRUDOS, no los normalizados: normInsumo() parte
  // "1/2" en dos números sueltos y la medida es lo que hay que juzgar.
  const crudoDe = uC(
    (v) => muestraDe.get(normInsumo(v))?.nombre || v,
    [muestraDe],
  );

  // ── LA UNIDAD DE CADA NOMBRE (tanda 2, 15-set-2026) ──────────────
  // Gabriel: «no compara unidades». Medido sobre los 160 pares ya decididos:
  // trece «mismo insumo» se facturan en unidades incompatibles (alambre kg
  // contra und, tubo m contra und, botas par contra und, tarugo docena contra
  // und). Unir esos deja el inventario con dos cantidades que no se pueden
  // sumar y apaga el comparador de precios sin avisar.
  //
  // 🔴 LA DOMINANTE, NO LA PRIMERA. `muestraDe` guarda la primera línea que
  // apareció, y un nombre facturado 40 veces en kilos y una suelta en
  // unidades (un error de tipeo del OCR) mandaría a la pantalla la unidad
  // equivocada. Se cuenta y gana la que más veces se usó.
  const unidadPorNombre = uM(() => {
    const cuentas = new Map();   // nombreNorm → Map(unidadCanonica → veces)
    for (const l of lineasEntidad) {
      const u = normUnidad(l.unidad);
      if (!u) continue;
      if (!cuentas.has(l.nombreNorm)) cuentas.set(l.nombreNorm, new Map());
      const m = cuentas.get(l.nombreNorm);
      m.set(u, (m.get(u) || 0) + 1);
    }
    const out = new Map();
    for (const [nombre, m] of cuentas) {
      let mejor = '', veces = -1;
      for (const [u, n] of m) if (n > veces) { mejor = u; veces = n; }
      out.set(nombre, mejor);
    }
    return out;
  }, [lineasEntidad]);
  const unidadDe = uC(
    (v) => unidadPorNombre.get(normInsumo(v)) || '',
    [unidadPorNombre],
  );
  // ── CON QUÉ MODELO PREGUNTA (15-set) ─────────────────────────────
  // 🔴 Correlaciones iba SIEMPRE en 'auto' —la cadena de modelos gratuitos de
  // OpenRouter— aunque el admin hubiera elegido uno en Administración →
  // Modelos de IA. Eso es exactamente lo que tiró producción el 15-set: los
  // gratuitos devolvieron 429 «sin proveedor» durante horas y el botón de IA
  // no contestaba nada. Correlacionar, clasificar y mapear son el MISMO ámbito
  // ('clasificacion'): tres preguntas del mismo módulo, una sola elección. Un
  // cuarto ámbito solo para esto serían más perillas para la misma respuesta.
  const modeloTextoIA = uM(() => modelosDe(cfgIA || [], 'clasificacion').texto, [cfgIA]);

  // La banda de cada candidato, en UN solo índice (tanda 4). Un candidato de
  // dos se mide con `bandaDePar` y uno de tres o más con `bandaDeGrupo` — la
  // pregunta es distinta, pero la lista y la clave son una sola.
  const bandaDe = uM(() => {
    const m = new Map();
    for (const c of candidatosTodos) {
      const crudos = c.variantes.map(crudoDe);
      m.set(c.id, c.variantes.length === 2
        ? bandaDePar(crudos[0], crudos[1], {
          unidadA: unidadDe(c.variantes[0]), unidadB: unidadDe(c.variantes[1]),
        })
        : bandaDeGrupo(crudos, { unidadDe }));
    }
    return m;
  }, [candidatosTodos, crudoDe, unidadDe]);
  // Cuántas de las pendientes NO van a salir a la red. Es el número que el
  // botón muestra antes de arrancar.
  const nSinIA = uM(
    () => [...bandaDe.values()].filter(b => b.banda === 'obvio').length,
    [bandaDe],
  );
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
  // `factor`: { unidadBase, unidadA, factorA, unidadB, factorB } o null (tanda 5).
  const decidir = async (par, relacion, { silencioso = false, factor = null } = {}) => {
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
        // ── EL FACTOR (tanda 5) ────────────────────────────────────
        // 🔴 SIEMPRE los cinco campos, aunque no haya factor: el CHECK de la
        // mig 214 es «todo o nada» y Dexie no lo valida. Una fila a medias se
        // guarda local y rebota en el push con 23514, dejando el sync en
        // reintento eterno (regla 9). `camposDeFactor(null)` devuelve los
        // cinco en null, que es lo que corresponde a «unir sin factor».
        ...camposDeFactor(relacion === 'mismo' ? factor : null),
      });
      // El par quedó resuelto: la propuesta de la IA ya no espera a nadie.
      // La clave es la misma que arma `sugerirCandidatos` para un candidato
      // de dos (tanda 4): el contenido ordenado, una sola forma de nombrarlo.
      olvidarRecomendacion('correlaciones', ambitoIA, claveDePar(par.nombre_a, par.nombre_b));
      if (!silencioso) {
        showToast?.(relacion === 'mismo'
          ? '✓ Correlacionados — no se volverá a preguntar por este par'
          : '✓ Marcados como distintos — no se volverá a preguntar', 'green');
      }
      return 'aplicada';
    } catch (e) { if (!silencioso) showToast?.('Error: ' + (e.message || e), 'red'); throw e; }
    finally { decidiendoRef.current = false; }
  };

  // ── «ESTO NO VA AL INVENTARIO» (tanda 3, 15-set) ─────────────────
  // Gabriel, 15-set, sobre el arbitraje del Consorcio Santa en 🧱 Insumos:
  // hasta hoy las únicas dos respuestas eran «mismo» y «distintos», y ninguna
  // de las dos saca una descripción que no es mercadería: seguía volviendo,
  // emparejada contra otra cosa, una y otra vez.
  //
  // 🔴 VA POR DESCRIPCIÓN, NO POR PAR. Marcar el par «arbitraje E001-209 ≈
  // arbitraje E001-210» como distintos no arregla nada: mañana el motor
  // propone el mismo arbitraje contra cualquier otro texto largo y la
  // pregunta vuelve. Lo que no es un insumo no lo es contra nadie.
  //
  // Y saca la descripción de TODOS lados, no solo de esta pantalla: sus
  // líneas dejan de contar cantidades en el inventario de la empresa (ver
  // `noInventariables` en inventario-empresa.js). Es la misma idea que la
  // factura anulada de la tanda 1 — lo que no es mercadería no tiene stock.
  const descartarNombre = async (nombreCrudo) => {
    if (decidiendoRef.current) return;
    decidiendoRef.current = true;
    try {
      // Ver la nota en guardarDestino (jx-empresa-detalle): __useAuth es el
      // hook, y desde un handler tira "Invalid hook call". Acá el throw caía en
      // el catch y salía como toast rojo — por eso el ámbito `inventario` tenía
      // CERO filas el 16-set, con el botón «No van al inventario» ya soltado.
      const userId = window.__currentUserId || null;
      await decidirCotejo({
        ambito: AMBITO_NO_INVENTARIO,
        llave: llaveNoInventario(nombreCrudo),
        decision: DECISION_NO_INVENTARIO,
        nota: String(nombreCrudo || '').slice(0, 200),
        companyId: empresaVista || null,
      }, userId);
      showToast?.(`✓ «${String(nombreCrudo).slice(0, 40)}…» ya no se propone ni cuenta en el inventario`, 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    } finally {
      decidiendoRef.current = false;
    }
  };

  /** Deshacer: la descripción vuelve a las listas y al inventario. */
  const recuperarNombre = async (llave) => {
    try {
      const userId = window.__currentUserId || null;   // hook NO, ver descartarNombre
      await decidirCotejo({ ambito: AMBITO_NO_INVENTARIO, llave, decision: null }, userId);
      showToast?.('✓ Vuelve a la lista y al inventario', 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
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
    const claveIA = claveDe(cluster);
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
      // `yaResueltos`: no reescribir lo ya contestado ni dejar que un
      // «Son distintos» de grupo pise una unión hecha a mano (ver la lib).
      const pares = crearParesDeCluster(cluster.variantes, canonicoCrudo, relacion, { yaResueltos: resueltos });
      if (!pares.length) {
        if (!silencioso) showToast?.('Estos ya estaban decididos — no había nada nuevo que guardar', 'blue');
        return 'saltada';
      }
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
  // «Lo mismo para correlaciones»: recorre los candidatos de la pestaña
  // activa (Insumos, Servicios o Ni-uno-ni-otro). Los que resuelven más
  // nombres van primero — ese orden ya viene de `sugerirCandidatos`.
  //
  // 🔴 UNA SOLA LISTA = UNA SOLA PREGUNTA POR PAR (tanda 4). Antes recorría
  // `clusters + sugerencias`, que salen de la misma función y se pisaban: un
  // par A–B dentro del grupo {A,B,C} se preguntaba DOS VECES y se pagaba dos
  // veces. Con la tercera pestaña de la tanda 3 eso se habría multiplicado
  // por tres. Ahora los candidatos vienen deduplicados de la lib.
  //
  // 🔴 NO DECIDE NADA en el modo por defecto: deja el veredicto de la IA en
  // la tarjeta de cada grupo/par, y el botón de siempre («Unir las N», «Son
  // distintos») lo sigue apretando una persona. Ver barrido-ia.js.
  /**
   * Lo que hace el recorrido con un candidato de banda `obvio`: NO pregunta.
   * Deja la misma propuesta que dejaría la IA —con el motivo local y el sello
   * `origen: 'local'`— o, en modo «aplicar», la guarda como cualquier otra de
   * confianza alta (0,96 > el umbral). Devuelve lo mismo que los demás
   * caminos, para que el contador del recorrido siga cuadrando.
   */
  const resolverSinIA = async ({ modo, variantes, confianza, motivo, claveRec, aplicar }) => {
    if (modo === 'aplicar') {
      const res = await aplicar();
      return res === 'aplicada' ? 'aplicada' : 'saltada';
    }
    guardarRecomendacion('correlaciones', ambitoIA, claveRec, {
      mismas: variantes, fuera: [], confianza, razonamiento: motivo, origen: 'local',
    });
    return 'recomendada';
  };

  const construirBarrido = (modo) => ({
    items: candidatosTodos.map(item => ({ item, banda: bandaDe.get(item.id) })),
    // 🔴 EL PRE-FILTRO DECIDE QUIÉN SALE A LA RED, no quién se decide. Los de
    // banda `obvio` se resuelven acá mismo y por eso no piden turno: hacerlos
    // esperar 1,1 s sería cobrarles el peaje de una autopista por la que no
    // pasaron. Igual dejan una propuesta que una persona tiene que aceptar.
    necesitaTurno: (t) => t?.banda?.banda !== 'obvio',
    procesarItem: async (t) => {
      const c = t.item;
      const variantes = c.variantes.map(crudoDe);
      const esPar = c.variantes.length === 2;
      // `decidir` habla de pares y `decidirCluster` de conjuntos; un candidato
      // de dos se guarda como par (una fila) y uno de N como cluster (todos
      // sus pares). Es la única diferencia que queda entre las dos formas.
      const parDe = () => ({ nombre_a: c.variantes[0], nombre_b: c.variantes[1] });

      if (t.banda?.banda === 'obvio') {
        return await resolverSinIA({
          modo, variantes, confianza: CONFIANZA_OBVIO, motivo: t.banda.motivo,
          claveRec: claveDe(c),
          aplicar: () => (esPar
            ? decidir(parDe(), 'mismo', { silencioso: true })
            : decidirCluster(c, 'mismo', c.variantes, { silencioso: true })),
        });
      }

      const r = await correlacionarConIA({
        variantes, unidades: c.variantes.map(v => unidadDe(v)), modeloTexto: modeloTextoIA,
      });
      if (!r?.result) return 'saltada';
      const conf = r.confianza || 0;

      if (modo === 'aplicar') {
        if (conf < UMBRAL_BARRIDO_IA) return 'saltada';
        if (esPar) {
          // Acá "distinto" con confianza alta TAMBIÉN se aplica: descartar la
          // sugerencia es una decisión válida, y sacarla de la cola es el punto.
          const relacion = (r.result.mismas || []).length >= 2 ? 'mismo' : 'distinto';
          const res = await decidir(parDe(), relacion, { silencioso: true });
          return res === 'aplicada' ? 'aplicada' : 'saltada';
        }
        // Mismo mapeo normalizado que "Usar esta" del botón individual —
        // ver el comentario de AyudaCorrelacionIA sobre por qué NO comparar
        // los nombres crudos (el server los devuelve ya saneados).
        const dentroNorm = new Set((r.result.mismas || []).map(normInsumo));
        const dentro = c.variantes.filter(v => dentroNorm.has(normInsumo(crudoDe(v))));
        if (dentro.length < 2) return 'saltada';
        const res = await decidirCluster(c, 'mismo', dentro, { silencioso: true });
        return res === 'aplicada' ? 'aplicada' : 'saltada';
      }

      guardarRecomendacion('correlaciones', ambitoIA, claveDe(c), {
        mismas: r.result.mismas || [], fuera: r.result.fuera || [],
        confianza: conf, razonamiento: r.razonamiento || '',
        unidades: r.unidades || null, unidades_en_conflicto: !!r.unidades_en_conflicto,
      }, { modelo: r._model || modeloTextoIA || null });
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
        {/* 🔴 LA GUIA NUMERA EL ORDEN DE TRABAJO, Y LAS PESTANAS VAN EN ESE
            MISMO ORDEN (15-set-2026). Hasta hoy la guia decia 1. Clasificacion,
            2. Correlaciones, y los botones de abajo estaban al reves (Comparador
            primero, Clasificacion ultima): dos ordenes distintos para lo mismo, en
            la misma pantalla. Gabriel: ya sabemos que el orden ha cambiado, los
            usuarios pueden confundirse.
            El orden es el de la cadena real y esta medido: correlacionar ANTES de
            clasificar convierte tres preguntas en una (ver el encabezado de la
            bandeja), y mapear DESPUES de clasificar es lo que hace que cada insumo
            compita solo contra los de su clasificacion. El comparador va al final
            porque es consulta: no hay nada que decidir ahi. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 8 }}>
          <div style={{ padding: '8px 10px', background: 'var(--bg-c)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--ts)', marginBottom: 2 }}>🤝 1. Correlaciones</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              Une las formas distintas de escribir el <strong>mismo</strong> insumo. Va primero: cada grupo que
              unís acá es una pregunta menos al clasificar, no una más.
            </div>
          </div>
          <div style={{ padding: '8px 10px', background: 'var(--bg-c)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--ts)', marginBottom: 2 }}>🗂 2. Clasificación</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              La única sección donde se clasifican los insumos y servicios de la entidad, y donde se reconocen
              los nombres con que aparecen en las facturas.
            </div>
          </div>
          <div style={{ padding: '8px 10px', background: 'var(--bg-c)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--ts)', marginBottom: 2 }}>🎯 3. Mapeo al presupuesto</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              Dice qué insumo del presupuesto de un trabajo es cada insumo ya clasificado de la entidad.
              Necesita los dos pasos de arriba hechos.
            </div>
          </div>
          <div style={{ padding: '8px 10px', background: 'var(--bg-c)', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, color: 'var(--ts)', marginBottom: 2 }}>🔍 4. Comparador de precios</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              Qué proveedor vendió cada insumo, a qué precio y cómo evolucionó. Es consulta: no hay nada
              que decidir acá.
            </div>
          </div>
        </div>
      </div>

      {/* El MISMO orden que la guia de arriba - ver su comentario. */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'correlaciones' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('correlaciones')}>
          🤝 1 · Correlaciones{pendientesCorr ? <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>{pendientesCorr}</span> : null}
        </button>
        <button className={`btn btn-sm ${tab === 'catalogo' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('catalogo')}>
          🗂 2 · Clasificación de insumos y servicios
        </button>
        <button className={`btn btn-sm ${tab === 'mapeo' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('mapeo')}>
          🎯 3 · Mapeo al presupuesto
        </button>
        <button className={`btn btn-sm ${tab === 'comparador' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('comparador')}>🔍 4 · Comparador de precios</button>
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
                        <td style={{ color: 'var(--tm)' }}>
                          {c.nombre}
                          {/* Tanda 2: el detalle de una compra espejo se lee del
                              otro libro. Quien abra ESE comprobante no va a
                              encontrar esta línea adentro — hay que decirlo. */}
                          {c.heredadaDe && (
                            <span className="badge b-purple" style={{ fontSize: 9, marginLeft: 5 }}
                              title="Compra a otra empresa del grupo. La factura espejo se crea sola y sin detalle (si lo trajera, el almacén contaría dos veces lo mismo): esta línea se lee de la venta del otro lado, que es el mismo comprobante.">
                              ↩ del otro libro
                            </span>
                          )}
                        </td>
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
          compras={lineasParaCatalogo}
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
              {candidatosInsumos.length > 0 && (
                <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>
                  {candidatosInsumos.length}
                </span>
              )}
            </button>
            <button className={`btn btn-sm ${subTabCorr === 'servicios' ? 'btn-blue' : 'btn-ghost'}`}
              onClick={() => setSubTabCorr('servicios')}>
              🛠 Servicios
              {candidatosServicios.length > 0 && (
                <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>
                  {candidatosServicios.length}
                </span>
              )}
            </button>
            {/* ── LA TERCERA PESTAÑA (tanda 3, 15-set) ─────────────────
                Lo que no es ni un insumo ni un servicio: arbitrajes, seguros,
                detracciones, penalidades, anticipos. Antes todo esto caía en
                🧱 Insumos porque el estándar no lo reconoce y `tipo_insumo`
                decía «material». Acá se puede correlacionar entre sí (dos
                formas de escribir el mismo arbitraje SON el mismo concepto)
                y, sobre todo, sacarlo del inventario de una vez. */}
            <button className={`btn btn-sm ${subTabCorr === 'otros' ? 'btn-blue' : 'btn-ghost'}`}
              onClick={() => setSubTabCorr('otros')}
              title="Ni insumo ni servicio: arbitrajes, seguros, detracciones, penalidades, anticipos. No es mercadería que entre o salga del inventario.">
              ❔ Ni uno ni otro
              {candidatosOtros.length > 0 && (
                <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>
                  {candidatosOtros.length}
                </span>
              )}
            </button>
          </div>

          {/* Qué está mirando esta pestaña y qué quedó descartado. */}
          <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', borderLeft: '3px solid var(--blue)' }}>
            {subTabCorr === 'otros' ? (
              <>
                <strong style={{ color: 'var(--blue)' }}>Ni insumo ni servicio</strong> — lo que se factura pero no
                es mercadería: arbitrajes, subrogaciones, seguros y SCTR, intereses y comisiones, detracciones,
                penalidades, anticipos. Correlacionarlos entre sí sirve (dos formas de escribir el mismo concepto),
                pero lo que casi siempre corresponde es <strong>«No va al inventario»</strong>: así dejan de
                proponerse y sus líneas dejan de contar cantidades en el inventario de la empresa.
              </>
            ) : (
              <>
                {conteoArboles.otro > 0 && (
                  <>Se apartaron <strong>{conteoArboles.otro} descripción(es)</strong> que no son ni insumo ni
                  servicio (arbitrajes, seguros, detracciones…) — están en <strong>❔ Ni uno ni otro</strong>.{' '}</>
                )}
                {conteoArboles.desconocido > 0 && (
                  <>Hay <strong>{conteoArboles.desconocido}</strong> que el sistema no supo reconocer: aparecen en
                  las tres pestañas a propósito, porque su gemela puede estar de cualquier lado.{' '}</>
                )}
                Si ves acá algo que no es mercadería, usá <strong>«No va al inventario»</strong> en vez de
                «Son distintos»: descartar el par no la saca, vuelve mañana contra otro nombre.
              </>
            )}
            {descartadas.size > 0 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                <strong>{descartadas.size}</strong> descripción(es) marcadas «no va al inventario».{' '}
                <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }}
                  onClick={() => setVerDescartadas(v => !v)}>
                  {verDescartadas ? 'Ocultar' : 'Ver y deshacer'}
                </button>
                {verDescartadas && (
                  <div style={{ display: 'grid', gap: 4, marginTop: 6, maxHeight: 220, overflow: 'auto' }}>
                    {[...descartadas].sort().map(ll => (
                      <div key={ll} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, padding: '4px 8px', background: 'var(--tint-neutral)', borderRadius: 5 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ll}>{ll}</span>
                        <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }}
                          onClick={() => recuperarNombre(ll)}>↺ Devolver</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <BarridoIA
            seccion="correlaciones"
            ambito={ambitoIA}
            etiqueta={subTabCorr === 'servicios' ? 'los servicios'
              : subTabCorr === 'otros' ? 'lo que no es insumo ni servicio' : 'los insumos'}
            cantidadPendiente={candidatosTodos.length}
            cantidadRecomendadas={nRecomendadasIA}
            sinIA={nSinIA}
            construir={construirBarrido}
          />

          {/* ── UNA SOLA LISTA DE CANDIDATOS (tanda 4, 15-set) ──────────
              Gabriel: «actualmente no entiendo las sugerencias individual y
              las múltiples». Eran dos secciones que salían de la misma
              función y se pisaban — el mismo par arriba dentro de un grupo y
              abajo suelto. Ahora es UNA lista: cada tarjeta es un conjunto de
              nombres que parecen el mismo insumo, y un «par» es simplemente
              un conjunto de dos. El filtro de abajo reemplaza a las dos
              secciones. */}
          <div className="card card-p" style={{ borderLeft: '3px solid var(--green)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🔗</span> Candidatos a unir ({candidatosTodos.length})
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[
                  ['todos', `Todos (${candidatosTodos.length})`],
                  ['grupos', `Grupos de 3+ (${nGrupos})`],
                  ['pares', `Pares (${candidatosTodos.length - nGrupos})`],
                ].map(([k, lbl]) => (
                  <button key={k} className={`btn btn-xs ${formaCorr === k ? 'btn-blue' : 'btn-ghost'}`}
                    onClick={() => setFormaCorr(k)}>{lbl}</button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ts)', marginBottom: 10, lineHeight: 1.5 }}>
              Las distintas formas en que cada proveedor escribe el mismo insumo. Primero van las que resuelven
              más nombres de un golpe. En las de tres o más, <strong>tocá una variante para sacarla</strong> antes
              de aceptar: la que saques no queda marcada como distinta — vuelve a aparecer sola, como par, para
              decidirla mirándola. Lo resaltado en{' '}
              <span style={{ background: 'rgba(242,183,5,.28)', borderRadius: 3, padding: '0 2px' }}>ámbar</span> es
              lo que NO tienen en común: mirá eso primero.
            </div>
            {candidatos.length === 0 && (
              <div style={{ color: 'var(--tm)', fontStyle: 'italic', fontSize: 12 }}>
                {candidatosTodos.length === 0
                  ? 'No hay candidatos nuevos para revisar — al registrar más facturas aparecerán acá.'
                  : 'Ninguno con este filtro. Probá «Todos».'}
              </div>
            )}
              <div style={{ display: 'grid', gap: 10 }}>
                {candidatos.filter(c => c.esGrupo).map(c => {
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
                        {/* 🔴 DE DÓNDE SALIÓ ESTE CANDIDATO (tanda 9). Los que
                            vienen de «quedaron en el mismo insumo» NO tienen
                            parecido de texto medido — su señal es una decisión
                            que tomó una persona—, y mostrarles un «100%
                            similitud» sería mentir sobre por qué están ahí.
                            Además la pregunta es otra: acá un «son distintos» no
                            es una correlación perdida, es el aviso de que una de
                            las dos quedó mal clasificada. */}
                        {c.motivo === 'mismo_insumo' ? (
                          <span className="badge b-purple" style={{ marginLeft: 6 }}
                            title={c.insumo
                              ? `Las ${c.variantes.length} quedaron pegadas a «${c.insumo}» al clasificar. Si NO son lo mismo, alguna está mal clasificada.`
                              : 'Quedaron pegadas al mismo insumo del catálogo al clasificar.'}>
                            🗂 mismo insumo{c.insumo ? `: ${c.insumo}` : ''}
                          </span>
                        ) : (
                          <span className="badge b-green" style={{ marginLeft: 6 }}>
                            {Math.round((c.score || 0) * 100)}% similitud
                          </span>
                        )}
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
                        {/* Tanda 3: si el grupo entero no es mercadería (tres
                            formas de escribir el mismo arbitraje), se sacan
                            las N de una — el descarte es por nombre, así que
                            son N decisiones, no una del grupo. */}
                        <button
                          className="btn btn-ghost btn-xs"
                          title="Ninguna de estas es un insumo: dejan de proponerse y sus líneas dejan de contar en el inventario"
                          onClick={async () => {
                            for (const v of c.variantes) {
                              await descartarNombre(muestraDe.get(normInsumo(v))?.nombre || v);
                            }
                          }}
                        >
                          🚫 No van al inventario
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {c.variantes.map((v, vi) => {
                        const m = muestraDe.get(normInsumo(v));
                        const off = fuera.includes(v);
                        const uV = unidadDe(v);
                        // Choca si alguna OTRA variante del grupo se factura
                        // en otra unidad: en un grupo la pregunta es del
                        // conjunto, no de un par suelto.
                        const chocaV = !!uV && c.variantes.some(o => {
                          const uo = unidadDe(o);
                          return uo && uo !== uV;
                        });
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
                            <BadgeUnidad unidad={uV} choca={chocaV} />
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
                      unidades={c.variantes.map(v => unidadDe(v))}
                      banda={bandaDe.get(c.id) || null}
                      modeloTexto={modeloTextoIA}
                      inicial={recsIA[claveDe(c)] || null}
                      onDescartar={() => olvidarRecomendacion('correlaciones', ambitoIA, claveDe(c))}
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
                {/* Los candidatos de DOS, en la misma lista y con el mismo
                    orden: lo que cambia es la tarjeta, porque la decisión es
                    otra («son el mismo / son distintos» en vez de «sacá las
                    que no van y uní el resto»). */}
                {candidatos.filter(c => !c.esGrupo).map(cand => {
                const par = { nombre_a: cand.variantes[0], nombre_b: cand.variantes[1], score: cand.score };
                const ma = muestraDe.get(par.nombre_a), mb = muestraDe.get(par.nombre_b);
                const nombreA = ma?.nombre || par.nombre_a, nombreB = mb?.nombre || par.nombre_b;
                const uA = unidadDe(par.nombre_a), uB = unidadDe(par.nombre_b);
                const chocaU = !!bandaDe.get(cand.id)?.unidades;
                return (
                  <div key={`${par.nombre_a}|${par.nombre_b}`} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12 }}>
                      <span><strong><NombreConDiferencias nombre={nombreA} otro={nombreB} /></strong><BadgeUnidad unidad={uA} choca={chocaU} /></span>
                      <span style={{ color: 'var(--tm)' }}>≈</span>
                      <span><strong><NombreConDiferencias nombre={nombreB} otro={nombreA} /></strong><BadgeUnidad unidad={uB} choca={chocaU} /></span>
                      {cand.motivo === 'mismo_insumo' ? (
                        <span className="badge b-purple" style={{ fontSize: 9 }}
                          title={cand.insumo
                            ? `Las dos quedaron pegadas a «${cand.insumo}» al clasificar. Si NO son lo mismo, alguna está mal clasificada.`
                            : 'Quedaron pegadas al mismo insumo del catálogo al clasificar.'}>
                          🗂 mismo insumo{cand.insumo ? `: ${cand.insumo}` : ''}
                        </span>
                      ) : (
                        <span className="badge b-gray" style={{ fontSize: 9 }}>{Math.round(par.score * 100)}% parecido</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
                      {ma && <>«{ma.nombre}» visto en {ma.doc} · {ma.proveedorNombre} · {fmtPrecio(ma.precio, ma.moneda)}. </>}
                      {mb && <>«{mb.nombre}» visto en {mb.doc} · {mb.proveedorNombre} · {fmtPrecio(mb.precio, mb.moneda)}.</>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      {/* Con las unidades en conflicto, «Mismo insumo» abre el
                          paso del factor en vez de guardar de una (tanda 5).
                          Ahí adentro está «Unir sin factor», que es
                          exactamente lo que hacía este botón antes. */}
                      <button className="btn btn-green btn-xs"
                        onClick={() => (chocaU ? setFactorAbierto(cand.id) : decidir(par, 'mismo').catch(() => {}))}>
                        ✓ Mismo insumo
                      </button>
                      <button className="btn btn-ghost btn-xs" onClick={() => decidir(par, 'distinto').catch(() => {})}>✗ Son distintos</button>
                    </div>
                    {chocaU && factorAbierto === cand.id && (
                      <FactorPresentacion
                        unidadA={uA} unidadB={uB} nombreA={nombreA} nombreB={nombreB}
                        onCancelar={() => setFactorAbierto(null)}
                        onUnir={(factor) => {
                          setFactorAbierto(null);
                          decidir(par, 'mismo', { factor }).catch(() => {});
                        }}
                      />
                    )}
                    {/* La tercera respuesta (tanda 3): esto no es mercadería.
                        Va por nombre y no por par — ver `descartarNombre`. */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: 'var(--tm)' }}>¿No es un insumo?</span>
                      <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }}
                        title={`«${nombreA}» deja de proponerse y sus líneas dejan de contar en el inventario`}
                        onClick={() => descartarNombre(nombreA)}>
                        🚫 Sacar «{nombreA.slice(0, 22)}{nombreA.length > 22 ? '…' : ''}»
                      </button>
                      <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }}
                        title={`«${nombreB}» deja de proponerse y sus líneas dejan de contar en el inventario`}
                        onClick={() => descartarNombre(nombreB)}>
                        🚫 Sacar «{nombreB.slice(0, 22)}{nombreB.length > 22 ? '…' : ''}»
                      </button>
                    </div>
                    <AyudaCorrelacionIA
                      variantes={[nombreA, nombreB]}
                      unidades={[uA, uB]}
                      banda={bandaDe.get(cand.id) || null}
                      modeloTexto={modeloTextoIA}
                      inicial={recsIA[cand.id] || null}
                      onDescartar={() => olvidarRecomendacion('correlaciones', ambitoIA, cand.id)}
                      textoAplicar={(mismas) => (mismas.length >= 2 ? '✓ Unir como mismo insumo' : '✗ Marcar como distintos')}
                      onAplicar={(mismas) => {
                        olvidarRecomendacion('correlaciones', ambitoIA, cand.id);
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
            {/* ── EL FACTOR SOBRE LO YA DECIDIDO (tanda 5) ─────────────
                Los trece pares con unidades incompatibles YA estaban unidos
                antes de que existiera el factor. Si solo se pudiera declarar
                al unir, esos trece —que son justamente los que lo necesitan—
                quedarían afuera para siempre. */}
            <div style={{ display: 'grid', gap: 5, maxHeight: 340, overflow: 'auto' }}>
              {decisiones.map(f => {
                const ua = unidadDe(f.nombre_a), ub = unidadDe(f.nombre_b);
                const chocan = f.relacion === 'mismo' && !!unidadesEnConflicto(ua, ub);
                return (
                <div key={f.id} style={{ display: 'grid', gap: 4, fontSize: 11.5, padding: '5px 8px', background: 'var(--tint-neutral)', borderRadius: 5 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className={`badge ${f.relacion === 'mismo' ? 'b-green' : 'b-red'}`} style={{ fontSize: 9 }}>{f.relacion === 'mismo' ? '= mismo' : '≠ distintos'}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{f.nombre_a} <span style={{ color: 'var(--tm)' }}>↔</span> {f.nombre_b}</span>
                    {tieneFactor(f) && (
                      <span className="badge b-blue" style={{ fontSize: 9 }}
                        title={`1 ${labelUnidad(f.unidad_a)} = ${f.factor_a} ${labelUnidad(f.unidad_base)} · 1 ${labelUnidad(f.unidad_b)} = ${f.factor_b} ${labelUnidad(f.unidad_base)}`}>
                        📏 en {labelUnidad(f.unidad_base)}
                      </span>
                    )}
                    {chocan && !tieneFactor(f) && (
                      <button className="btn btn-xs btn-amber" style={{ fontSize: 10 }}
                        title={`Se facturan en ${labelUnidad(ua)} y en ${labelUnidad(ub)}: mientras no digas cómo se convierten, sus cantidades quedan en dos filas del inventario`}
                        onClick={() => setFactorAbierto(factorAbierto === f.id ? null : f.id)}>
                        📏 Poner factor
                      </button>
                    )}
                    {tieneFactor(f) && (
                      <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }}
                        title="Sacar el factor: las cantidades vuelven a contarse por separado"
                        onClick={() => corrHook.update(f.id, { ...camposDeFactor(null), fuente: 'manual' })
                          .then(() => showToast?.('✓ Factor quitado', 'green'))
                          .catch(e => showToast?.('Error: ' + (e.message || e), 'red'))}>
                        ✕ factor
                      </button>
                    )}
                    <button className="btn btn-ghost btn-xs" style={{ fontSize: 10 }} title="Corregir: invierte la decisión" onClick={() => cambiarDecision(f)}>↺ Cambiar</button>
                  </div>
                  {factorAbierto === f.id && (
                    <FactorPresentacion
                      unidadA={ua} unidadB={ub}
                      nombreA={f.nombre_a} nombreB={f.nombre_b}
                      onCancelar={() => setFactorAbierto(null)}
                      onUnir={(factor) => {
                        setFactorAbierto(null);
                        if (!factor) return;      // «Unir sin factor» acá no cambia nada
                        corrHook.update(f.id, { ...camposDeFactor(factor), fuente: 'manual' })
                          .then(() => showToast?.('✓ Factor guardado — el inventario ya los suma juntos', 'green'))
                          .catch(e => showToast?.('Error: ' + (e.message || e), 'red'));
                      }}
                    />
                  )}
                </div>
                );
              })}
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
