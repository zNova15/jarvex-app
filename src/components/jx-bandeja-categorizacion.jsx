// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA BANDEJA QUE APRENDE (tanda 14, entrega 4). Pestaña de Análisis
// de Insumos, gate admin/gerente heredado del panel.
//
// QUÉ SE HACE ACÁ
// Decir qué insumo del CATÁLOGO CANÓNICO es cada cosa que aparece en las
// facturas — o que no es un insumo. Se decide por TEXTO, no por factura: el
// mismo nombre aparece en facturas de varias entidades, se decide una vez y
// vale para todas, las de ayer y las que entren mañana.
//
// NO ES LA PESTAÑA DE AL LADO. «Mapeo al presupuesto» contesta otra pregunta
// —«¿qué código del presupuesto de ESTA obra es esto?»— contra otro catálogo y
// para otra cosa (Abastecimiento). Esta contesta «¿qué es esto?» contra las 478
// filas del archivo de Gabriel, y por eso funciona en las 24 entidades y no
// solo donde hay una obra con presupuesto cargado.
//
// ── LO QUE HACE QUE SE TERMINE, Y POR QUÉ ─────────────────────────
// Medido el 7-set-2026: 1.885 descripciones distintas, S/ 1.950.400. El top 20
// es el 34,6% de la plata y hacen falta 200 decisiones para el 83,5%. De a una
// no se termina nunca. Entonces:
//   · ORDENADA POR PLATA — decidir arriba rinde, y el avance se mide en soles.
//   · LOTES POR PROPUESTA — «VARILLA DE ACERO CORRUGADO DE 5/8» y «FIERRO
//     CORRUGADO DE 5/8 SIDER PERU X 9M» caen en la misma fila del catálogo y se
//     aceptan de un golpe. Solo entran al lote las que el motor propuso CON
//     confianza; las dudosas se miran de a una.
//   · TECLADO — A acepta, N marca «no es un insumo», F abre el alta al
//     catálogo, ↑↓ mueven. Sin esto la cola de 1.473 descripciones baratas
//     (5,8% del gasto: comida, medicinas, «artículo 1») no se limpia jamás.
//   · «FALTA EN EL CATÁLOGO» — el 45% de la plata no tiene candidato porque la
//     fila NO EXISTE. La respuesta correcta no es «no es un insumo»: es
//     agregarla, y desde acá mismo. El catálogo crece con el trabajo del día.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../lib/app-mode-core.js";
import {
  catalogoParaProponer, indiceDePropuestas, resolverCategorias,
  agruparDescripciones, filasDeBandeja, lotesPorPropuesta, resumenAvance,
  decisionDeCatalogo, decisionNoInsumo, ESTADOS, ORDENES, ordenarFilasBandeja,
  normsDeFila, muestrasDeFila, replicarEnVariantes,
} from "../lib/bandeja-categorizacion.js";
import { resolverPares, construirGrupos } from "../lib/insumo-correlacion.js";
import {
  decidirEnLote, agregarAlCatalogoYDecidir, reabrirEnLote, enseñarALaContadora,
} from "../lib/bandeja-categorizacion-db.js";
import { corregirEnLote, adoptarEnEntidad } from "../lib/catalogo-canonico-db.js";
import {
  equivalenciasDe,
} from "../lib/catalogo-canonico.js";
import {
  categoriasParaElegir, etiquetaCategoria, bandaConfianza,
} from "../lib/indices-unificados-iupc.js";
import { enseñarDiccionario, olvidarDiccionario } from "../lib/clasificaciones-db.js";
import { SelectorClasificacion, ClasificacionDatalist } from "./jx-selector-clasificacion.jsx";
import { clasificarInsumoConIA, notaDeIA, esDecisionDeIA } from "../lib/ia-insumos.js";
import { prepararClasificacionNueva } from "../lib/clasificacion-propuesta.js";
import { crearClasificacion, validarClasificacion } from "../lib/clasificaciones-db.js";
import { avisoDeContradiccion } from "../lib/hermanas-clasificacion.js";
import { modelosDe } from "../lib/modelos-ia-config.js";
import { UMBRAL_BARRIDO_IA } from "../lib/barrido-ia.js";
import { guardarRecomendacion, olvidarRecomendacion } from "../lib/barrido-store.js";
import { BarridoIA, RecomendacionIA, Razonamiento, SelloIA, useBarridoIA } from "./jx-barrido-ia.jsx";

const { useState: uS, useMemo: uM, useRef: uR, useEffect: uE, useId: uId, useCallback: uC } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

// 🔴 ESTO ERA UN `const` DE MÓDULO Y ESE ERA EL BUG (tanda 8, 15-set-2026).
//
// `categoriasParaElegir()` se llamaba UNA vez, al importar el archivo, y sin
// las clasificaciones propias. Consecuencia, reportada por Gabriel: «después de
// crear una nueva clasificación no se actualiza automáticamente en las
// secciones de las recomendaciones». Y no se actualizaba nunca — ni recargando:
// la clasificación recién creada no estaba en el desplegable de cada fila, ni
// en el datalist, ni entre los candidatos que se le mandan a la IA, así que la
// IA tampoco podía proponerla. Crear la clasificación que la propia IA pedía
// no servía para nada.
//
// Ahora la lista se arma en el componente desde `useClasificaciones()` y viaja
// por props hasta las filas. `sin_clasificar` sigue AFUERA a propósito (pedido
// de Gabriel, 14-sep): elegirla a mano de una lista es lo mismo que no elegir
// nada — ver `categoriasParaElegir()`.
//
// El piso de la base oficial queda acá solo como respaldo para los componentes
// que se montan sueltos en un test sin pasarles `opciones`.
const OPCIONES_BASE = categoriasParaElegir();

const soles = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;

/**
 * EL PRECIO UNITARIO, QUE ES UNA PISTA DE QUÉ COSA ES (tanda 8, 15-set-2026).
 *
 * Gabriel: «había una descripción de tapa ciega que lo relacionó con una tapa
 * de cemento y su valor era de 4 soles; eso era una tapa que usan para
 * electricidad, quedaba mejor con el índice 12». Una tapa de buzón de concreto
 * no cuesta S/ 4 y una tapa ciega de caja eléctrica no cuesta S/ 400: con la
 * descripción sola las dos se escriben igual, con el precio no.
 *
 * 🔴 DEVUELVE null CUANDO NO SE PUEDE SABER, y eso es la mitad del diseño. El
 * mismo Gabriel lo anticipó: «no siempre el precio será el correcto pues a
 * veces ocurre casos donde te hacen descuento y sale como 0». Un 0 mandado como
 * dato es peor que no mandar nada — el modelo lo leería como «es baratísimo».
 * `importe` además solo acumula SOLES (los dólares se ven pero no se suman,
 * decisión del 7-set), así que una fila en dólares también cae acá en null.
 */
function precioUnitarioDeFila(f) {
  const imp = Number(f?.importe) || 0;
  const cant = Number(f?.cantidad) || 0;
  if (imp <= 0 || cant <= 0) return null;
  const p = imp / cant;
  return Number.isFinite(p) && p > 0 ? p : null;
}

/**
 * Botón "🤖 Preguntale a la IA" — segunda opinión CON RAZONAMIENTO (14-sep).
 * El parecido de palabras del motor local se equivoca con cosas como ropa de
 * trabajo con cinta reflectiva saliendo "herramienta manual". No reemplaza al
 * motor local (sigue siendo el primero, gratis y sin red) ni se aplica sola:
 * el resultado se muestra y `onElegir(codigo)` es un click aparte.
 */
function AyudaClasificacionIA({ descripcion, unidad, precioUnitario = null, onElegir, opciones = OPCIONES_BASE, onCrearClasificacion = null, terminosCustom = null, propuestaLocal = null, frecuentes = [], modeloTexto = null }) {
  const [sugerencia, setSugerencia] = uS(null);
  const [noSabe, setNoSabe] = uS(null);
  const [cargando, setCargando] = uS(false);
  const [error, setError] = uS(null);

  const preguntar = async (e) => {
    e.stopPropagation();
    if (cargando) return;
    setCargando(true); setError(null); setNoSabe(null); setSugerencia(null);
    try {
      const r = await clasificarInsumoConIA({
        descripcion, unidad, precioUnitario, candidatos: opciones, terminosCustom, propuestaLocal,
        frecuentes, modeloTexto,
      });
      // «No sé» NO es un error (tanda 3). Antes la duda honesta salía en rojo
      // al lado del botón, con el mismo formato que «no se pudo consultar la
      // IA»: una respuesta pensada disfrazada de falla técnica. Ahora se
      // muestra como lo que es —la IA la miró y hace falta una persona— y con
      // lo que sí llegó a razonar, que es de lo que se agarra quien decide.
      if (r?.no_se) {
        setNoSabe({
          razonamiento: r.razonamiento || 'No encontró con qué decidir.',
          nuevaClasificacion: r.result?.clasificacion_nueva || r.clasificacion_nueva || null,
          arbolNuevo: r.result?.clasificacion_nueva_arbol || r.clasificacion_nueva_arbol || null,
        });
        return;
      }
      if (!r?.result?.codigo_sugerido) {
        setError(r?.razonamiento || 'No encontró una clasificación clara para esto.');
        return;
      }
      const opt = opciones.find(o => o.codigo === r.result.codigo_sugerido);
      setSugerencia({
        codigo: r.result.codigo_sugerido, nombre: opt?.label || r.result.codigo_sugerido,
        confianza: r.confianza, razonamiento: r.razonamiento, cached: !!r._cached,
        nuevaClasificacion: r.result.clasificacion_nueva || null,
        arbolNuevo: r.result.clasificacion_nueva_arbol || null,
      });
    } catch (e2) {
      setError(e2?.message || 'No se pudo consultar la IA.');
    } finally {
      setCargando(false);
    }
  };

  // Crear la propuesta de la IA y dejarla elegida en la misma fila: si hubiera
  // que ir a otra vista, volver y buscarla, nadie lo haría con 875 filas por
  // delante — que es la razón por la que el aviso no servía para nada.
  const crearYElegir = onCrearClasificacion
    ? async (prep) => { const cod = await onCrearClasificacion(prep); if (cod) onElegir(cod); }
    : null;

  return (
    <div style={{ marginTop: 6 }} onClick={e => e.stopPropagation()}>
      <button type="button" className="btn btn-xs btn-ghost" disabled={cargando} onClick={preguntar}>
        {cargando ? '🤖 Pensando…' : '🤖 Preguntale a la IA'}
      </button>
      {error && <span style={{ color: 'var(--red)', fontSize: 10.5, marginLeft: 6 }}>{error}</span>}
      {noSabe && (
        <div style={{ marginTop: 4, padding: '6px 9px', background: 'rgba(148,163,184,.12)', border: '1px solid rgba(148,163,184,.4)', borderRadius: 5, fontSize: 10.5, maxWidth: 680, width: '100%' }}>
          🤖 <strong>La IA no sabe</strong> y lo dice — no hay nada que aceptar acá, elegí la clasificación a mano.
          <Razonamiento texto={noSabe.razonamiento} />
          {noSabe.nuevaClasificacion && (
            <ClasificacionNueva nombre={noSabe.nuevaClasificacion} arbol={noSabe.arbolNuevo}
              cats={opciones} onCrear={crearYElegir} onUsar={onElegir} />
          )}
        </div>
      )}
      {sugerencia && (
        <div style={{ marginTop: 4, padding: '6px 9px', background: 'rgba(58,163,255,.08)', border: '1px solid rgba(58,163,255,.3)', borderRadius: 5, fontSize: 10.5, maxWidth: 680, width: '100%' }}>
          🤖 Sugiere <strong>{sugerencia.nombre}</strong>
          <span className="badge b-blue" style={{ marginLeft: 4, fontSize: 9 }}>{Math.round((sugerencia.confianza || 0) * 100)}%</span>
          {sugerencia.cached && <span style={{ color: 'var(--tm)' }}> · ya preguntada</span>}
          <Razonamiento texto={sugerencia.razonamiento} />
          {sugerencia.nuevaClasificacion && (
            <ClasificacionNueva nombre={sugerencia.nuevaClasificacion} arbol={sugerencia.arbolNuevo}
              cats={opciones} onCrear={crearYElegir} onUsar={onElegir} />
          )}
          <button type="button" className="btn btn-xs btn-blue" style={{ marginTop: 4 }}
            onClick={(e) => { e.stopPropagation(); onElegir(sugerencia.codigo); }}>
            Usar esta clasificación
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * «Ninguna de la lista le queda bien» — el aviso que pidió Gabriel el 15-sep
 * con "LA INMOBILIARIA BCP", que es el interés de un préstamo y no es un
 * insumo de construcción ni un consumo de oficina.
 *
 * DESDE LA TANDA 8 ACÁ SE PUEDE CREAR, y ese fue el pedido: «tener la facilidad
 * de darle a aceptar y que la IA me lo cree pero bien (cuidado duplique)». El
 * «pero bien» es todo el asunto y lo resuelve `prepararClasificacionNueva()`:
 *   · si ya existe una que se llama así —propia o de la NORMA— no se crea nada,
 *     se ofrece la que hay;
 *   · si hay parecidas se muestran primero, para elegir en vez de duplicar;
 *   · el árbol (insumo o servicio) sale de lo que dijo la IA, y si no lo dijo
 *     se deduce del nombre;
 *   · el código se propone con prefijo propio y numerado si está tomado, así
 *     nunca pisa el espacio oficial del IUPC.
 * Sin `onCrear` sigue siendo la nota de antes — es como se monta en un test.
 */
function ClasificacionNueva({ nombre, arbol = null, cats = null, onCrear = null, onUsar = null }) {
  const prep = uM(
    () => prepararClasificacionNueva({ nombre, arbol, cats: cats || [] }),
    [nombre, arbol, cats],
  );
  const puedeCrear = !!onCrear && prep.ok && !prep.yaExiste;

  return (
    <div style={{ marginTop: 4, padding: '4px 6px', borderRadius: 4, background: 'rgba(242,183,5,.12)', border: '1px solid rgba(242,183,5,.35)' }}
      onClick={e => e.stopPropagation()}>
      ⚠ Ninguna clasificación de la lista le queda bien. La IA propone crear una:
      {' '}<strong>«{prep.nombre || nombre}»</strong>.

      {prep.yaExiste ? (
        <div style={{ marginTop: 3 }}>
          ✓ <strong>Ya existe</strong> y se llama igual: {prep.yaExiste.label || prep.yaExiste.nombre}. No hace falta crear nada.
          {onUsar && (
            <button type="button" className="btn btn-xs btn-green" style={{ marginLeft: 6 }}
              onClick={() => onUsar(prep.yaExiste.codigo)}>Usar esa</button>
          )}
        </div>
      ) : (
        <>
          {prep.parecidas?.length > 0 && (
            <div style={{ marginTop: 3, color: 'var(--tm)' }}>
              Ojo, ya hay {prep.parecidas.length === 1 ? 'una parecida' : 'parecidas'}:{' '}
              {prep.parecidas.map((x, i) => (
                <span key={x.cat.codigo}>
                  {i > 0 ? ' · ' : ''}
                  {x.cat.label || x.cat.nombre}
                  {onUsar && (
                    <button type="button" className="btn btn-xs btn-ghost" style={{ marginLeft: 3 }}
                      onClick={() => onUsar(x.cat.codigo)}>usar esa</button>
                  )}
                </span>
              ))}
            </div>
          )}
          {puedeCrear ? (
            <div style={{ marginTop: 4 }}>
              <button type="button" className="btn btn-xs btn-amber" onClick={() => onCrear(prep)}>
                Crear «{prep.nombre}»
              </button>
              <span style={{ color: 'var(--tm)', marginLeft: 6 }}>
                como código <code>{prep.codigo}</code>, en el árbol de {prep.arbol === 'servicio' ? 'servicios' : 'insumos'}.
              </span>
            </div>
          ) : (
            <div style={{ color: 'var(--tm)' }}>
              Se crea desde <strong>Clasificaciones y diccionario</strong>; acá no se crea sola.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BandejaCategorizacionTab({ compras, showToast, empresaFija = null, ambitoExterno = false }) {
  const catHook = window.__hooks.useCatalogoInsumos();
  const disgHook = window.__hooks.useCatalogoDisgregacion();
  const eqHook = window.__hooks.useCatalogoFamiliaMapeo();
  const decHook = window.__hooks.useInsumoCategorias();
  const compHook = window.__hooks.useCompanies();
  // El diccionario PROPIO (mig 205). Va a la IA en su PROPIA bolsa, aparte del
  // Anexo 2 (tanda 1): es la corrección que ya enseñó la contadora y mejora la
  // propuesta con el uso, pero no es la norma y no puede presentarse como tal.
  const terHook = window.__hooks.useClasificacionTerminos?.() || { data: [] };
  // Las clasificaciones PROPIAS (mig 205). Antes esta pantalla no las leía y
  // por eso una clasificación recién creada no aparecía acá nunca — ver el
  // comentario de OPCIONES_BASE.
  const clasHook = window.__hooks.useClasificaciones?.() || { data: [] };
  // Las correlaciones ya decididas: son las que fusionan varias descripciones
  // en una sola fila de esta bandeja (tanda 4 — ver `fusionarPorCorrelacion`).
  const corrHook = window.__hooks.useInsumoCorrelaciones?.() || { data: [] };
  // Qué modelo usa esta sección, elegido en Administración → Modelos de IA.
  const { data: cfgIA } = window.__hooks?.useAppConfig?.() || { data: [] };
  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  const userId = (() => { try { return window.__useAuth?.()?.profile?.id || null; } catch { return null; } })();

  // El ámbito por defecto es TODO EL GRUPO, y acá sí corresponde: lo que se
  // decide es «qué ES esto», no «contra qué presupuesto va». Una descripción
  // significa lo mismo la facture GASOMI o EL INCA, así que decidirla una vez
  // para todos es lo correcto — y es lo contrario de lo que pasaba en «Mapeo al
  // presupuesto», donde mezclar entidades era el bug que Gabriel encontró.
  // Con `empresaFija` (tanda 18, entrega C) el ámbito lo manda la pantalla:
  // las `compras` que llegan ya vienen filtradas por ella y este selector se
  // clava, para que no puedan decir cosas distintas.
  const [entidad, setEntidad] = uS(() => empresaFija || '');
  const [filtro, setFiltro] = uS('pendientes');
  // Por costo por defecto: es el orden que hace que 200 decisiones cubran el
  // 83% del gasto. Los otros tres son para auditar (ver `ORDENES`).
  const [orden, setOrden] = uS('costo');
  const [busca, setBusca] = uS('');
  const [limite, setLimite] = uS(40);
  const [cursor, setCursor] = uS(0);
  const [altaDe, setAltaDe] = uS(null);      // fila para la que se abre el alta
  const [marcadas, setMarcadas] = uS(() => new Set());
  // Anti doble-click (regla crítica 2): ref SÍNCRONO. Un doble tap en «Aceptar»
  // no puede escribir dos filas para la misma descripción.
  const guardandoRef = uR(false);
  // Su propio guard: crear la clasificación que propone la IA no bloquea (ni
  // lo bloquea) a aceptar una fila, pero tampoco puede dispararse dos veces.
  const creandoClasRef = uR(false);
  // Un solo <datalist> para TODA la pantalla (rendimiento — ver el
  // encabezado de jx-selector-clasificacion.jsx): cada fila solo pone un
  // <input list={listId}> liviano.
  const listId = uId();

  const empresas = uM(() => (compHook.data || []).filter(c => !c.deleted_at), [compHook.data]);
  // `ambitoExterno`: la bandeja vive DENTRO de la sección de clasificación
  // (13-set-2026) y el ámbito lo manda el selector de esa pantalla —incluido
  // «todo el grupo», que es `null`—. Dos selectores que pueden decir cosas
  // distintas sobre la misma lista es la forma más rápida de mirar la base
  // equivocada, así que acá no se ofrece ninguno.
  const companyId = ambitoExterno ? (empresaFija || null) : (empresaFija || entidad || null);

  // `equivalenciasDe` (familia local → familia del grupo) es la forma que
  // espera `familiaEfectiva`; `resolverEquivalencias` devuelve las filas
  // crudas con clave «empresa|familia» y no sirve para esto.
  const equivalencias = uM(() => equivalenciasDe(eqHook.data || [], companyId), [eqHook.data, companyId]);

  // Las propuestas de IA se guardan por ENTIDAD: la misma descripción en otra
  // empresa es otra pregunta (otro catálogo, otras clasificaciones propias).
  const ambitoIA = companyId || 'grupo';
  const { recomendaciones: recsIA } = useBarridoIA('clasificacion', ambitoIA);

  // El catálogo y su índice se calculan DURANTE EL RENDER (useMemo), no en un
  // efecto: así el test de montaje ve la tabla dibujada de verdad. Con
  // `useEffect` el cuerpo no se renderiza nunca en el gate —renderToString no
  // corre efectos— y un TDZ acá adentro pasaría en verde, igual que el que dejó
  // Movimientos Contables muerto el 3-sep.
  const filasCatalogo = uM(
    () => catalogoParaProponer(catHook.data || [], disgHook.data || [], { companyId }),
    [catHook.data, disgHook.data, companyId],
  );
  const { prep, porId } = uM(() => indiceDePropuestas(filasCatalogo), [filasCatalogo]);

  const decisiones = uM(
    () => resolverCategorias(decHook.data || [], { companyId, demo: esPrueba }),
    [decHook.data, companyId, esPrueba],
  );

  const comprasEnAlcance = uM(
    () => (companyId ? (compras || []).filter(c => c.companyId === companyId) : (compras || [])),
    [compras, companyId],
  );
  // ── UNA SOLA COLA: CORRELACIONAR → CLASIFICAR (tanda 4) ──────────
  // Lo que Correlaciones ya resolvió como «el mismo insumo» acá es UNA fila.
  // El orden de trabajo es ese a propósito: tres variantes sueltas son tres
  // preguntas que pueden contestarse distinto; una vez correlacionadas son una
  // sola pregunta con una sola respuesta.
  const grupoDe = uM(
    () => construirGrupos(resolverPares(corrHook.data || [], { demo: esPrueba })).grupoDe,
    [corrHook.data, esPrueba],
  );
  const descripciones = uM(
    () => agruparDescripciones(comprasEnAlcance, { grupoDe }),
    [comprasEnAlcance, grupoDe],
  );

  // 🔴 VA ANTES DE `filas` A PROPÓSITO: esta pantalla ENSEÑA términos y hasta
  // la tanda 1 era la única que no los LEÍA — `filasDeBandeja` se llamaba sin
  // `terminosCustom`, así que el aprendizaje acá era de solo escritura y lo
  // aprendido aparecía en las otras vistas pero no en ésta.
  const terminosCustom = uM(
    () => (terHook.data || []).filter(t => !t.deleted_at && !!t.demo === esPrueba),
    [terHook.data, esPrueba],
  );

  const filas = uM(
    () => filasDeBandeja(descripciones, { prep, porId, decisiones, terminosCustom }),
    [descripciones, prep, porId, decisiones, terminosCustom],
  );

  // LO QUE ESTA EMPRESA USA DE VERDAD (tanda 2). Es el relleno de la lista
  // corta que se le manda a la IA cuando el diccionario no alcanza para llegar
  // al mínimo: a falta de toda otra señal, lo más probable es lo que ya se
  // decidió cien veces. Sale de las decisiones tomadas, no de una lista fija.
  // Lo que se OFRECE para elegir en esta pantalla: la base oficial + lo que
  // Gabriel creó. Es la misma lista que se le manda a la IA como candidatos, así
  // que una clasificación propia recién creada ya puede ser propuesta por ella.
  const opcionesClasificacion = uM(
    () => categoriasParaElegir((clasHook.data || []).filter(c => !c.deleted_at && !!c.demo === esPrueba)),
    [clasHook.data, esPrueba],
  );

  /**
   * Crear la clasificación que propuso la IA, desde la fila donde se propuso.
   * Devuelve el código creado (o el de la que ya existía) para que quien llamó
   * la deje elegida. `prepararClasificacionNueva()` ya resolvió el nombre, el
   * árbol y un código libre; `validarClasificacion()` sigue siendo la última
   * palabra sobre si ese código puede existir.
   */
  const crearClasificacionDesdeIA = async (prep) => {
    if (!prep?.ok) return null;
    if (prep.yaExiste) return prep.yaExiste.codigo;
    // Anti doble-click (regla crítica de la casa): ref SÍNCRONO, no estado. Un
    // doble tap en «Crear» no puede dejar dos clasificaciones gemelas — que es
    // justamente el duplicado que este flujo vino a evitar. Va aparte de
    // `guardandoRef` porque crear no bloquea ni es bloqueado por aceptar.
    if (creandoClasRef.current) return null;
    creandoClasRef.current = true;
    // `validarClasificacion()` sigue siendo la última palabra sobre el código:
    // `prepararClasificacionNueva()` ya eligió uno libre, pero el que valida si
    // un código puede existir es uno solo, y es ése.
    const err = validarClasificacion(prep, (clasHook.data || []).filter(c => !c.deleted_at));
    if (err) { showToast?.(err, 'error'); return null; }
    try {
      await crearClasificacion({
        codigo: prep.codigo, nombre: prep.nombre, arbol: prep.arbol, companyId,
      }, { userId });
      await clasHook.refresh?.();
      showToast?.(`✓ Clasificación «${prep.nombre}» creada (${prep.codigo}). Ya se puede elegir acá.`, 'green');
      return prep.codigo;
    } catch (e) {
      showToast?.('No se pudo crear la clasificación: ' + (e?.message || e), 'error');
      return null;
    } finally {
      creandoClasRef.current = false;
    }
  };

  const frecuentes = uM(() => {
    const cuenta = new Map();
    const sumar = (cod, peso) => {
      if (!cod || cod === 'sin_clasificar') return;
      cuenta.set(cod, (cuenta.get(cod) || 0) + peso);
    };
    // Las decisiones pesan más que el catálogo: son respuestas dadas sobre
    // descripciones de factura, que es exactamente la pregunta que se hace.
    for (const d of decisiones.values()) sumar(d?.familia, 3);
    for (const f of filasCatalogo) sumar(f?.familia, 1);
    return [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([cod]) => cod);
  }, [decisiones, filasCatalogo]);

  // El modelo que el admin eligió para clasificar (Administración → Modelos de
  // IA). `null` = la cadena de gratuitos de siempre.
  const modeloTexto = uM(() => modelosDe(cfgIA || [], 'clasificacion').texto, [cfgIA]);
  const avance = uM(() => resumenAvance(filas), [filas]);
  const lotes = uM(() => lotesPorPropuesta(filas), [filas]);

  const visibles = uM(() => {
    const t = busca.trim().toLowerCase();
    const filtradas = filas.filter(f => {
      if (t && !f.muestra.toLowerCase().includes(t)) return false;
      // «Recomendadas por IA»: lo que dejó el recorrido y todavía nadie miró.
      // Es la lista con la que Gabriel «va pasando y dando un vistazo».
      if (filtro === 'ia') return f.estado !== 'decididas' && !!recsIA[f.norm];
      if (filtro === 'pendientes') return f.estado !== 'decididas';
      if (['alta', 'media', 'baja', 'rara', 'extrema_baja'].includes(filtro)) {
        return f.estado !== 'decididas' && f.banda === filtro;
      }
      return f.estado === filtro;
    });
    // El orden lo elige quien mira (tanda 1): por costo para rendir, A-Z para
    // auditar familias enteras, por probabilidad para despachar por banda.
    return ordenarFilasBandeja(filtradas, orden);
  }, [filas, filtro, busca, recsIA, orden]);

  const enPantalla = uM(() => visibles.slice(0, limite), [visibles, limite]);

  // El cursor no puede quedar fuera de la lista cuando se filtra o se decide.
  uE(() => { setCursor(c => Math.min(c, Math.max(0, enPantalla.length - 1))); }, [enPantalla.length]);

  const catalogoDe = (fila) => {
    const cod = fila?.sug?.candidatos?.[0]?.cat?.codigo;
    return cod ? porId.get(cod) : null;
  };

  /**
   * La clasificación que propone el motor LOCAL para esta fila — la misma que
   * se ve en pantalla. Se le manda a la IA para que la confirme o la corrija
   * CON ARGUMENTO, en vez de contestar desde cero: en los casos que reportó
   * Gabriel (alambre de amarre, mesa de melamine) la local era la buena.
   */
  const propuestaLocalDe = (f) => {
    const cod = catalogoDe(f)?.familia || f?.recomendacionIUPC?.codigo || null;
    if (!cod || cod === 'sin_clasificar') return null;
    return {
      codigo: cod,
      nombre: etiquetaCategoria(cod),
      motivos: f?.recomendacionIUPC?.motivos || f?.sug?.candidatos?.[0]?.motivos || [],
    };
  };

  // ── Acciones ─────────────────────────────────────────────────────
  // Si el último argumento trae `{ silencioso: true }` (el barrido de IA,
  // 14-sep), el error NO se traga acá — se relanza para que ejecutarBarridoIA
  // lo cuente como error de ese ítem y siga con el siguiente, en vez de
  // reportarlo como "aplicada" y encima mostrar un toast en medio de un
  // recorrido que se pidió silencioso.
  const conGuard = (fn) => async (...args) => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    const opts = args[args.length - 1];
    const silencioso = !!(opts && typeof opts === 'object' && opts.silencioso);
    try { await fn(...args); }
    catch (e) { if (silencioso) throw e; showToast?.('Error: ' + (e.message || e), 'red'); }
    finally { guardandoRef.current = false; }
  };

  // `silencioso`: para el barrido de IA (14-sep) — recorre cientos de filas
  // solo, y un toast por cada una sería una lluvia de carteles. El barrido
  // muestra su propio progreso; acá alcanza con no interrumpir.
  // `desdeIA`: la confianza de la recomendación cuando lo que se acepta salió
  // del recorrido con IA. Deja la marca «Recomendado por IA» en la decisión
  // (en `nota` — ver MARCA_IA) para que después se pueda ver de dónde vino.
  const aceptar = conGuard(async (fila, categoriaElegida = null, { silencioso = false, desdeIA = null } = {}) => {
    const notaIA = desdeIA != null ? notaDeIA(desdeIA) : null;
    // DE DÓNDE SALE EL TÉRMINO QUE SE VA A ENSEÑAR (tanda 1). `silencioso` es
    // el recorrido en modo «aplicar»: guardó solo, sin que nadie lo mirara, así
    // que lo que aprenda queda marcado 'ia' — no vuelve a la IA como evidencia
    // ni le gana a la norma (mig 212). Lo que una persona aceptó mirándolo,
    // aunque la propuesta venga de la IA, es una decisión y vale como tal.
    const origenTermino = silencioso ? 'ia' : 'decision';
    const cand = fila?.sug?.candidatos?.[0];
    const catFila = catalogoDe(fila);
    // Sin propuesta no se puede «aceptar» nada: guardar 'sin_clasificar' sería
    // sacar la fila de la cola sin haberla clasificado. El botón ya viene
    // apagado; esto es el cinturón por si alguien llega por el atajo «A».
    if (fila?.sinPropuesta && !categoriaElegida) {
      if (!silencioso) showToast?.('Elegí primero una clasificación: el sistema no tiene ninguna que proponer.', 'amber');
      return;
    }
    const catFinal = categoriaElegida
      || catFila?.familia || fila?.recomendacionIUPC?.codigo || 'sin_clasificar';

    // 🔴 SIN FILA DEL CATÁLOGO NO SE PUEDE DECIDIR «catalogo».
    // La base lo prohíbe: el CHECK `insumo_categoria_catalogo_coherente` exige
    // que `decision='catalogo'` venga con un `catalogo_insumo_id` real. Escribir
    // null pasaba en Dexie y REBOTABA en el push a Supabase (23514) — el sync
    // quedaba trabado reintentando para siempre y nadie se enteraba.
    // Cuando el motor no encontró candidato pero SÍ hay recomendación IUPC, la
    // respuesta correcta no es inventar una decisión sin destino: es dar de
    // alta el insumo con esa categoría y decidir contra la fila recién creada.
    if (!catFila) {
      if (!fila?.recomendacionIUPC) return;
      const creado = await agregarAlCatalogoYDecidir(fila, {
        companyId, familia: catFinal, userId,
        unidad: [...(fila.unidades || [])][0] || 'und',
        nota: notaIA ? `${notaIA} · Alta desde la bandeja` : null,
        variantes: fila.variantes || null,
        // Lo aplicado por el recorrido sin que nadie lo mire queda SIN revisar:
        // esas son las que «Insumos y servicios» tiene que seguir mostrando.
        decidida: !silencioso,
      });
      await enseñarALaContadora(paresParaContadora(fila, creado), { userId, equivalencias });
      // Enseña la clasificación IUPC — sea que se haya aceptado la propuesta
      // TAL CUAL, o que se haya elegido otra cosa a mano (un descarte): lo que
      // se enseña es SIEMPRE la decisión final (ver enseñarDiccionario).
      await enseñarTodasLasVariantes(fila, catFinal, origenTermino);
      olvidarRecomendacion('clasificacion', ambitoIA, fila.norm);
      await Promise.all([decHook.refresh?.(), catHook.refresh?.()]);
      if (!silencioso) showToast?.(`✓ «${creado.nombre}» dado de alta en ${etiquetaCategoria(catFinal)} y decidido`, 'green');
      return;
    }

    const cuerpo = decisionDeCatalogo(fila, catFila, {
      factor: cand?.factor?.factor ?? null,
      factorFuente: cand?.factor?.fuente ?? null,
      score: cand?.score ?? fila?.recomendacionIUPC?.score ?? null,
      companyId,
      categoria: catFinal,
      nota: notaIA,
    });
    await decidirEnLote(replicarEnVariantes(cuerpo, fila), { userId });
    // 🔴 LA DECISIÓN TAMBIÉN CORRIGE EL VOCABULARIO (tanda 8, 15-set-2026).
    // Decidir acá escribía solo en `insumo_categoria` (la descripción de
    // factura → el insumo), y dejaba al INSUMO del catálogo con su
    // clasificación vieja. Resultado: la pestaña de al lado seguía mostrando
    // otra clasificación para lo mismo y su triángulo ámbar pedía confirmar de
    // nuevo lo recién decidido. Si una persona eligió una clasificación
    // distinta a la que tenía el insumo, eso ES la corrección del insumo.
    // Solo cuando la eligió una persona: el recorrido silencioso no reescribe
    // el catálogo por su cuenta.
    // Parado en una entidad, corregir una fila que viene del catálogo GENERAL
    // no lo cambia para todos: le hace a esa entidad su propia copia. Es el
    // mismo criterio de `corregirLote` en el panel del catálogo.
    // `soloEnDisgregacion` son filas sintéticas (no existen en la tabla): esas
    // no se corrigen, se dan de alta cuando corresponde.
    if (!silencioso && catFila.id && !catFila.soloEnDisgregacion
      && catFinal && catFinal !== 'sin_clasificar' && catFinal !== catFila.familia) {
      const cambios = { familia: catFinal, revisado: true };
      if ((catFila.company_id || null) === (companyId || null)) {
        await corregirEnLote([catFila.id], cambios, { userId });
      } else if (companyId) {
        await adoptarEnEntidad(catFila.id, companyId, cambios, { userId });
      } else {
        await corregirEnLote([catFila.id], cambios, { userId });
      }
      await catHook.refresh?.();
    }
    await enseñarALaContadora(paresParaContadora(fila, { ...catFila, familia: catFinal }), { userId, equivalencias });
    await enseñarTodasLasVariantes(fila, catFinal, origenTermino);
    olvidarRecomendacion('clasificacion', ambitoIA, fila.norm);
    await decHook.refresh?.();
    if (!silencioso) showToast?.(`✓ ${catFila.nombre} [${etiquetaCategoria(catFinal)}] — vale para todas las facturas`, 'green');
  });

  // ── LO QUE UNA DECISIÓN ALCANZA (tanda 4) ────────────────────────
  // Una fila puede ser un GRUPO de variantes correlacionadas. La decisión es
  // una sola —la que tomó la persona— pero se escribe una vez por descripción,
  // porque `insumo_categoria` se indexa por `norm` y el diccionario aprende
  // por texto. Escribir solo la del representante dejaba a las hermanas
  // pendientes y la próxima factura volvía a preguntar por ellas.
  const enseñarTodasLasVariantes = async (fila, codigo, origenTermino) => {
    if (!codigo) return;
    // SECUENCIAL: enseñarDiccionario lee-antes-de-escribir y dos variantes en
    // paralelo verían ambas «no hay término» y crearían un duplicado.
    for (const muestra of muestrasDeFila(fila)) {
      await enseñarDiccionario({ descripcion: muestra, clasificacionCodigo: codigo, companyId, origen: origenTermino }, { userId });
    }
  };
  const paresParaContadora = (fila, catalogoFila) =>
    muestrasDeFila(fila).map(muestra => ({ fila: { ...fila, muestra }, catalogoFila }));

  const noEsInsumo = conGuard(async (fila) => {
    await decidirEnLote(replicarEnVariantes(decisionNoInsumo(fila, { companyId }), fila), { userId });
    // Decir «no es un insumo» también resuelve la fila: la propuesta de la IA
    // ya no tiene a quién esperar.
    olvidarRecomendacion('clasificacion', ambitoIA, fila.norm);
    await decHook.refresh?.();
    showToast?.('✓ Marcado: no es un insumo del catálogo — no se vuelve a preguntar', 'green');
  });

  const deshacer = conGuard(async (fila) => {
    await reabrirEnLote(normsDeFila(fila), { companyId });
    // Deshacer una decisión también DESENSEÑA lo que esa decisión enseñó (ver
    // `olvidarDiccionario`): dejar el término vivo era lo que fabricaba los
    // 365 huérfanos. Lo escrito a mano en el panel no se toca.
    const olvidados = await olvidarDiccionario(muestrasDeFila(fila), { userId });
    await Promise.all([decHook.refresh?.(), olvidados ? terHook.refresh?.() : null]);
    showToast?.(olvidados
      ? 'Decisión deshecha — vuelve a la lista y el diccionario la olvida'
      : 'Decisión deshecha — vuelve a la lista', 'green');
  });

  const aceptarLote = conGuard(async (grupo) => {
    const catFila = porId.get(grupo.codigo);
    if (!catFila) return;
    const cuerpos = grupo.filas.flatMap(f => replicarEnVariantes(decisionDeCatalogo(f, catFila, {
      factor: f.sug?.candidatos?.[0]?.factor?.factor ?? null,
      factorFuente: f.sug?.candidatos?.[0]?.factor?.fuente ?? null,
      score: f.sug?.candidatos?.[0]?.score ?? null, companyId,
    }), f));
    const n = await decidirEnLote(cuerpos, { userId });
    await enseñarALaContadora(grupo.filas.flatMap(f => paresParaContadora(f, catFila)), { userId, equivalencias });
    // Un término por descripción del lote — todas terminan en la MISMA
    // clasificación (la del insumo del catálogo al que se aceptó el lote).
    // SECUENCIAL a propósito: enseñarDiccionario lee-antes-de-escribir, y dos
    // filas del lote con la misma descripción normalizada bajo un Promise.all
    // verían ambas "no hay término todavía" y crearían un duplicado.
    if (catFila.familia) {
      for (const f of grupo.filas) await enseñarTodasLasVariantes(f, catFila.familia, 'decision');
    }
    for (const f of grupo.filas) olvidarRecomendacion('clasificacion', ambitoIA, f.norm);
    await decHook.refresh?.();
    showToast?.(`✓ ${n} descripciones → ${catFila.nombre}`, 'green');
  });

  /**
   * DESCLASIFICAR EN LOTE — pedido de Gabriel, 15-sep: «quiero que tengamos
   * una manera para desclasificar todos los insumos también, o seleccionando
   * un grupo». Después de un recorrido con IA que aplicó de más, deshacer de
   * a una no alcanza.
   *
   * `filas` son las que se van a reabrir. Pide confirmación SIEMPRE (borra
   * trabajo hecho) y dice cuántas son antes de tocar nada.
   */
  const desclasificar = conGuard(async (filasADeshacer, queEs) => {
    const elegidas = (filasADeshacer || []).filter(f => f?.norm);
    // Un grupo correlacionado se desclasifica entero: dejar media hermana
    // decidida es exactamente la contradicción que la fusión vino a evitar.
    const norms = [...new Set(elegidas.flatMap(f => normsDeFila(f)))];
    if (!norms.length) return;
    const ok = typeof confirm !== 'function' || confirm(
      `Se van a DESCLASIFICAR ${norms.length} ${norms.length === 1 ? 'descripción' : 'descripciones'} (${queEs}).\n\n`
      + 'Vuelven a la lista de pendientes y hay que volver a decidirlas. '
      + 'El diccionario también las OLVIDA (lo que hayas escrito a mano en '
      + 'Clasificaciones no se toca).\n\n¿Seguir?',
    );
    if (!ok) return;
    const n = await reabrirEnLote(norms, { companyId });
    // Desclasificar desenseña — ver `olvidarDiccionario`. Sin esto cada tanda
    // arrancaba con los términos de la anterior, incluidos los que se
    // deshicieron justamente porque estaban mal.
    const olvidados = await olvidarDiccionario(elegidas.flatMap(f => muestrasDeFila(f)), { userId });
    setMarcadas(new Set());
    await Promise.all([decHook.refresh?.(), olvidados ? terHook.refresh?.() : null]);
    showToast?.(`↩ ${n} ${n === 1 ? 'decisión deshecha' : 'decisiones deshechas'}`
      + (olvidados ? ` · ${olvidados} ${olvidados === 1 ? 'término olvidado' : 'términos olvidados'}` : ''), 'green');
  });

  const noSonInsumoEnLote = conGuard(async () => {
    const elegidas = enPantalla.filter(f => marcadas.has(f.norm) && f.estado !== 'decididas');
    if (!elegidas.length) return;
    const n = await decidirEnLote(elegidas.flatMap(f => replicarEnVariantes(decisionNoInsumo(f, { companyId }), f)), { userId });
    // También resuelve filas: sin esto sus propuestas de IA quedaban huérfanas
    // en localStorage y el contador de arriba decía más que el filtro de abajo.
    for (const f of elegidas) olvidarRecomendacion('clasificacion', ambitoIA, f.norm);
    setMarcadas(new Set());
    await decHook.refresh?.();
    showToast?.(`✓ ${n} marcadas como «no es un insumo» — no vuelven a preguntarse`, 'green');
  });

  const crearEnCatalogo = conGuard(async (fila, campos) => {
    const creado = await agregarAlCatalogoYDecidir(fila, { ...campos, companyId, userId, variantes: fila.variantes || null });
    if (campos.familia) await enseñarTodasLasVariantes(fila, campos.familia, 'decision');
    olvidarRecomendacion('clasificacion', ambitoIA, fila.norm);
    setAltaDe(null);
    await Promise.all([catHook.refresh?.(), decHook.refresh?.()]);
    showToast?.(`✓ «${creado.nombre}» agregado al catálogo y mapeado`, 'green');
  });

  // ── El recorrido completo con IA (14-sep) ─────────────────────────
  // «Un botón que se encargue de dar una pasada completa a todos los
  // insumos sin clasificar» — TODO lo pendiente (no solo lo que se ve con
  // el filtro actual), una descripción a la vez.
  //
  // 🔴 NO GUARDA NADA en el modo por defecto: deja la propuesta al lado de
  // cada fila y quien clasifica la acepta. Ver el encabezado de barrido-ia.js.
  const pendientesTotal = uM(() => filas.filter(f => f.estado !== 'decididas'), [filas]);
  const construirBarrido = uC((modo) => ({
    items: pendientesTotal,
    procesarItem: async (f) => {
      const r = await clasificarInsumoConIA({
        descripcion: f.muestra, unidad: [...(f.unidades || [])][0] || '',
        precioUnitario: precioUnitarioDeFila(f), candidatos: opcionesClasificacion,
        terminosCustom, propuestaLocal: propuestaLocalDe(f), frecuentes, modeloTexto,
      });
      // 🔴 EL «NO SÉ» SE GUARDA, NO SE TIRA (tanda 3). Un recorrido de 875
      // preguntas que descarta las dudas deja a la persona sin saber cuáles
      // MIRÓ la IA y cuáles se saltó por un error de red — y el próximo
      // recorrido las vuelve a pagar igual. Guardada, la fila queda en el
      // filtro «con recomendación» diciendo que hace falta una persona, que es
      // la información que el recorrido fue a buscar. En modo 'aplicar' no se
      // aplica nada: no hay código que aplicar.
      if (r?.no_se) {
        if (modo === 'aplicar') return 'saltada';
        guardarRecomendacion('clasificacion', ambitoIA, f.norm, {
          noSe: true, confianza: r.confianza || 0, razonamiento: r.razonamiento || '',
          nuevaClasificacion: r.result?.clasificacion_nueva || r.clasificacion_nueva || null,
          arbolNuevo: r.result?.clasificacion_nueva_arbol || r.clasificacion_nueva_arbol || null,
        }, { modelo: r._model || modeloTexto || null });
        return 'recomendada';
      }
      const cod = r?.result?.codigo_sugerido;
      if (!cod) return 'saltada';
      const conf = r.confianza || 0;
      if (modo === 'aplicar') {
        if (conf < UMBRAL_BARRIDO_IA) return 'saltada';
        await aceptar(f, cod, { silencioso: true, desdeIA: conf });
        return 'aplicada';
      }
      guardarRecomendacion('clasificacion', ambitoIA, f.norm, {
        codigo: cod, nombre: etiquetaCategoria(cod), confianza: conf, razonamiento: r.razonamiento || '',
        nuevaClasificacion: r.result.clasificacion_nueva || null,
        arbolNuevo: r.result.clasificacion_nueva_arbol || null,
      }, { modelo: r._model || modeloTexto || null });
      return 'recomendada';
    },
  }), [pendientesTotal, ambitoIA, aceptar, terminosCustom, opcionesClasificacion]);

  // ── Teclado ──────────────────────────────────────────────────────
  // Es la mitad de por qué esta pantalla se puede terminar. Se apaga mientras
  // hay un modal abierto o el foco está en un campo de texto: si no, escribir
  // «anticipo» en el buscador dispararía A → aceptar, N → no es insumo.
  uE(() => {
    if (typeof window === 'undefined' || !window.addEventListener) return undefined;
    const onKey = (e) => {
      if (altaDe) return;
      const t = e.target?.tagName;
      if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.metaKey || e.ctrlKey || e.altKey) return;
      const fila = enPantalla[cursor];
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); setCursor(c => Math.min(c + 1, enPantalla.length - 1)); return; }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); return; }
      if (!fila) return;
      const k = e.key.toLowerCase();
      if (k === 'a' && fila.sug?.candidatos?.length) { e.preventDefault(); aceptar(fila); }
      else if (k === 'n' && fila.estado !== 'decididas') { e.preventDefault(); noEsInsumo(fila); }
      else if (k === 'f' && fila.estado !== 'decididas') { e.preventDefault(); setAltaDe(fila); }
      else if (k === ' ') {
        e.preventDefault();
        setMarcadas(m => { const s = new Set(m); if (s.has(fila.norm)) s.delete(fila.norm); else s.add(fila.norm); return s; });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enPantalla, cursor, altaDe]);

  // ── Render ───────────────────────────────────────────────────────
  const sinCatalogo = filasCatalogo.length === 0;
  const nMarcadas = enPantalla.filter(f => marcadas.has(f.norm) && f.estado !== 'decididas').length;
  // Las marcadas que YA estaban decididas: son las que se pueden desclasificar
  // en lote. Van aparte de `nMarcadas` porque las dos acciones no se mezclan —
  // «no son insumos» sobre una fila ya decidida la re-decidiría, no la abriría.
  const marcadasDecididas = enPantalla.filter(f => marcadas.has(f.norm) && f.estado === 'decididas');
  const nMarcadasDecididas = marcadasDecididas.length;
  // Lo que se ve AHORA con el filtro «Decididas» (respeta la búsqueda): es lo
  // que se lleva el botón de desclasificar todo, para que lo que se borra sea
  // exactamente lo que está a la vista.
  const decididasVisibles = uM(() => visibles.filter(f => f.estado === 'decididas'), [visibles]);
  // Solo las que siguen pendientes: una recomendación sobre algo ya decidido
  // no es nada que revisar (y se olvida sola al aceptar).
  const nRecomendadasIA = filas.filter(f => f.estado !== 'decididas' && recsIA[f.norm]).length;

  return (
    <>
      <ClasificacionDatalist id={listId} opciones={opcionesClasificacion} />
      <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6 }}>
        Acá se dice <strong>qué insumo del catálogo</strong> es cada cosa que aparece en las facturas.
        Se decide <strong>por texto, no por factura</strong>: vale para todas las que digan lo mismo y no se vuelve a preguntar.
        «No es un insumo» y «falta en el catálogo» también son respuestas válidas — y la segunda <strong>agrega la fila</strong> y la deja mapeada.
        <div style={{ marginTop: 6, color: 'var(--tm)' }}>
          Con el teclado: <strong>↑ ↓</strong> moverse · <strong>A</strong> aceptar · <strong>N</strong> no es un insumo ·
          {' '}<strong>F</strong> falta en el catálogo · <strong>espacio</strong> marcar para el lote.
        </div>
      </div>

      {sinCatalogo && (
        <div className="card card-p" style={{ color: 'var(--amber)', fontSize: 12 }}>
          ⚠ No hay catálogo cargado{entidad ? ' para esta entidad' : ''}. Sin catálogo no hay contra qué proponer:
          importá «Categorizacion Simple.xlsx» desde la pestaña <strong>📚 Catálogo</strong>.
        </div>
      )}

      <div className="card card-p">
        <div className="frow-sb" style={{ flexWrap: 'wrap', gap: 8 }}>
          {!ambitoExterno && (
            <div style={{ minWidth: 220, flex: 1 }}>
              <label style={{ fontSize: 11, color: 'var(--tm)' }}>Compras de</label>
              <select className="fi" value={companyId || ''} disabled={!!empresaFija}
                title={empresaFija ? 'El ámbito lo fija el selector de arriba de la pantalla.' : undefined}
                onChange={e => { setEntidad(e.target.value); setCursor(0); }}>
                {!empresaFija && <option value="">Todo el grupo ({(compras || []).length} líneas)</option>}
                {empresas.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
              </select>
            </div>
          )}
          <div style={{ minWidth: 240, flex: 2 }}>
            <label style={{ fontSize: 11, color: 'var(--tm)' }}>Buscar en las descripciones</label>
            <input className="fi" value={busca} onChange={e => { setBusca(e.target.value); setCursor(0); }} placeholder="cemento, fierro, tubo…" />
          </div>
          {/* ORDEN (tanda 1) — el costo rinde, pero A-Z es lo que deja ver que
              «ABRAZADERA», «ABRAZADERA 1/2"» y «ABRAZADERAS 2"» terminaron en
              cinco códigos distintos. Auditar es otra tarea que decidir. */}
          <div style={{ minWidth: 150, flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--tm)' }}>Ordenar por</label>
            <select className="fi" value={orden}
              onChange={e => { setOrden(e.target.value); setCursor(0); }}>
              {ORDENES.map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
            </select>
          </div>
        </div>

        {/* El avance se mide en PLATA: decidir las 20 más caras vale más que
            decidir 200 de la cola, y el número tiene que decir eso.
            🔴 OJO (14-sep-2026, Gabriel vio "138 de 886 … 76%" y pensó que
            estaba mal calculado): antes esta misma línea mezclaba el % por
            plata con el conteo por filas, y con dos escalas distintas en una
            sola oración parece un error aunque no lo sea. Ahora van
            separados: arriba el % SIEMPRE es plata (con el rótulo puesto),
            abajo el conteo de filas trae SU PROPIO % — que es un número
            distinto a propósito, y acá se explica por qué. */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{avance.pct.toFixed(0)}%</div>
          <div style={{ fontSize: 12, color: 'var(--ts)' }}>
            del <strong>GASTO</strong> ya categorizado ({soles(avance.plataDecidida)} de {soles(avance.totalPlata)})
          </div>
        </div>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-s)', marginTop: 6 }}>
          <div style={{ width: `${Math.min(100, avance.pct)}%`, background: 'var(--green)' }} />
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--tm)' }}>
          Se mide por plata, no por cantidad de filas — decidir lo caro rinde más que decidir muchas descripciones
          baratas. Por eso <strong>{avance.decididas}</strong> de <strong>{avance.total}</strong> descripciones decididas
          {' '}({avance.total > 0 ? Math.round((avance.decididas * 100) / avance.total) : 0}% de las filas) es
          {' '}<strong> otro número</strong>, y va a avanzar distinto que el de arriba: es normal, no es un error.
        </div>
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--tm)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span>✓ en el catálogo: <strong>{avance.enCatalogo}</strong> ({soles(avance.plataEnCatalogo)})</span>
          <span>✗ no son insumo: <strong>{avance.noInsumo}</strong> ({soles(avance.plataNoInsumo)})</span>
          <span>· coincidencia alta: <strong>{avance.alta}</strong> ({soles(avance.plataAlta)})</span>
          <span>· media: <strong>{avance.media}</strong> ({soles(avance.plataMedia)})</span>
          <span>· para mirar de a una: <strong>{avance.baja + avance.rara + avance.extrema_baja}</strong> ({soles(avance.plataBaja + avance.plataRara + avance.plataExtremaBaja)})</span>
          {avance.sin_propuesta > 0 && (
            <span title="El sistema no reconoce estas descripciones: no hay nada que aceptar, hay que elegir la clasificación a mano.">
              · sin propuesta: <strong>{avance.sin_propuesta}</strong> ({soles(avance.plataSinPropuesta)})
            </span>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <BarridoIA
            seccion="clasificacion"
            ambito={ambitoIA}
            etiqueta="lo pendiente"
            cantidadPendiente={pendientesTotal.length}
            cantidadRecomendadas={nRecomendadasIA}
            construir={construirBarrido}
            onVerRecomendadas={() => { setFiltro('ia'); setCursor(0); }}
          />
        </div>
      </div>

      {/* ── LOS LOTES ─────────────────────────────────────────────── */}
      {lotes.length > 0 && (
        <div className="card card-p">
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
            De a lotes: {lotes.length} {lotes.length === 1 ? 'grupo cae' : 'grupos caen'} en el mismo insumo
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 8 }}>
            Distintas formas de escribir lo mismo. Solo entran acá las que el motor propuso con confianza;
            las dudosas se deciden de a una, abajo.
          </div>
          {lotes.slice(0, 8).map(g => (
            <div key={g.codigo} style={{ borderTop: '1px solid var(--border)', padding: '8px 0', display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{porId.get(g.codigo)?.nombre || g.nombre}</div>
                <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
                  {g.filas.map(f => f.muestra).join('  ·  ')}
                </div>
              </div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', minWidth: 90, textAlign: 'right' }}>{soles(g.importe)}</div>
              <button className="btn btn-sm btn-green" onClick={() => aceptarLote(g)}>
                Aceptar las {g.filas.length}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── LA LISTA ──────────────────────────────────────────────── */}
      <div className="card card-p">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {ESTADOS.map(([k, lbl]) => {
            const count = k === 'pendientes' ? avance.total - avance.decididas
              : k === 'decididas' ? avance.decididas
              : (avance[k] || 0);   // las cinco bandas
            return (
              <button key={k} className={`btn btn-sm ${filtro === k ? 'btn-amber' : 'btn-ghost'}`}
                onClick={() => { setFiltro(k); setCursor(0); }}>
                {lbl} ({count})
              </button>
            );
          })}
          {/* El filtro del recorrido: solo lo que la IA propuso y todavía
              nadie miró. Aparece únicamente cuando hay algo — si no, sería
              un botón que nunca muestra nada. */}
          {(nRecomendadasIA > 0 || filtro === 'ia') && (
            <button className={`btn btn-sm ${filtro === 'ia' ? 'btn-amber' : 'btn-ghost'}`}
              title="Lo que dejó propuesto el recorrido con IA. Se aceptan de a una, mirándolas."
              onClick={() => { setFiltro('ia'); setCursor(0); }}>
              🤖 Recomendadas por IA ({nRecomendadasIA})
            </button>
          )}
        </div>

        {(nMarcadas > 0 || nMarcadasDecididas > 0) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'var(--bg-s)', borderRadius: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12 }}>{nMarcadas + nMarcadasDecididas} marcadas</strong>
            {nMarcadas > 0 && (
              <button className="btn btn-sm" onClick={noSonInsumoEnLote}>✗ No son insumos del catálogo</button>
            )}
            {nMarcadasDecididas > 0 && (
              <button className="btn btn-sm btn-amber"
                onClick={() => desclasificar(marcadasDecididas, 'las marcadas')}>
                ↩ Desclasificar las {nMarcadasDecididas}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setMarcadas(new Set())}>Desmarcar</button>
          </div>
        )}

        {/* Desclasificar TODO lo decidido. Solo aparece parado en «Decididas»:
            es la pantalla donde se ve qué se está por deshacer, y esconderlo
            del resto evita el click accidental sobre 800 decisiones. */}
        {filtro === 'decididas' && decididasVisibles.length > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 11.5, color: 'var(--tm)' }}>
            <button className="btn btn-sm btn-amber"
              title="Todas las decisiones de este ámbito vuelven a la lista de pendientes, y el diccionario olvida lo que le enseñaron."
              onClick={() => desclasificar(decididasVisibles, busca.trim() ? 'las que coinciden con la búsqueda' : 'todas las decididas')}>
              ↩ Desclasificar {busca.trim() ? `las ${decididasVisibles.length} de la búsqueda` : `las ${decididasVisibles.length}`}
            </button>
            <span>Vuelven a pendientes y el diccionario las <strong>olvida</strong>. Lo que escribiste a mano en Clasificaciones no se toca.</span>
          </div>
        )}

        {!visibles.length && (
          <div style={{ color: 'var(--tm)', fontSize: 12, padding: 12 }}>
            {filas.length ? 'Nada acá con ese filtro.' : 'No hay compras con ítems de factura para categorizar.'}
          </div>
        )}

        {enPantalla.map((f, i) => (
          <FilaBandeja
            key={f.norm} f={f} activa={i === cursor}
            catFila={catalogoDe(f)}
            listId={listId}
            opciones={opcionesClasificacion}
            onCrearClasificacion={crearClasificacionDesdeIA}
            recIA={recsIA[f.norm] || null}
            terminosCustom={terminosCustom}
            frecuentes={frecuentes}
            modeloTexto={modeloTexto}
            propuestaLocal={propuestaLocalDe(f)}
            onAceptarIA={(rec) => aceptar(f, rec.codigo, { desdeIA: rec.confianza })}
            onDescartarIA={() => olvidarRecomendacion('clasificacion', ambitoIA, f.norm)}
            marcada={marcadas.has(f.norm)}
            onFocus={() => setCursor(i)}
            onMarcar={() => setMarcadas(m => {
              const s = new Set(m); if (s.has(f.norm)) s.delete(f.norm); else s.add(f.norm); return s;
            })}
            onAceptar={(cat) => aceptar(f, cat)}
            onFalta={() => setAltaDe(f)}
            onNoInsumo={() => noEsInsumo(f)}
            onDeshacer={() => deshacer(f)}
          />
        ))}

        {visibles.length > enPantalla.length && (
          <div style={{ paddingTop: 10 }}>
            <button className="btn btn-sm" onClick={() => setLimite(l => l + 60)}>
              Ver más ({visibles.length - enPantalla.length} restantes)
            </button>
          </div>
        )}
      </div>

      {altaDe && <AltaEnCatalogo fila={altaDe} listId={listId} opciones={opcionesClasificacion}
        onCrearClasificacion={crearClasificacionDesdeIA} terminosCustom={terminosCustom}
        frecuentes={frecuentes} modeloTexto={modeloTexto}
        propuestaLocal={propuestaLocalDe(altaDe)} onCancel={() => setAltaDe(null)} onGuardar={crearEnCatalogo} />}
    </>
  );
}

/**
 * «Sus hermanas ya se decidieron, y distinto» (tanda 3).
 *
 * El caso que lo pidió: «TUBO E. CUAD. 3/4IN * 1.2» y «… * 1.5» son el mismo
 * tubo en dos espesores y quedaron en dos clasificaciones. Nadie se entera —
 * son dos filas de 900 que no se ven juntas nunca. Acá no se corrige solo:
 * se avisa, con el botón para alinearla de un click si corresponde.
 */
function AvisoHermanas({ aviso, onUsar }) {
  if (!aviso) return null;
  return (
    <div style={{
      marginTop: 5, padding: '4px 8px', fontSize: 10.5, borderRadius: 5, maxWidth: 520,
      background: 'rgba(242,183,5,.12)', border: '1px solid rgba(242,183,5,.4)',
    }} onClick={e => e.stopPropagation()}>
      ⚠ {aviso.veces === 1 ? 'Una descripción hermana' : `${aviso.veces} descripciones hermanas`}
      {' '}(misma cosa, otra medida) {aviso.veces === 1 ? 'quedó' : 'quedaron'} en
      {' '}<strong>{etiquetaCategoria(aviso.codigo)}</strong>
      {!aviso.unanime && <span style={{ color: 'var(--tm)' }}> — y esa familia ya venía dividida</span>}.
      <div style={{ color: 'var(--tm)' }}>Por ejemplo: «{aviso.ejemplo}»</div>
      {onUsar && (
        <button type="button" className="btn btn-xs btn-amber" style={{ marginTop: 4 }}
          onClick={(e) => { e.stopPropagation(); onUsar(aviso.codigo); }}>
          Usar el mismo que las hermanas
        </button>
      )}
    </div>
  );
}

/**
 * Una fila de la bandeja. Va en su propio componente para que el test de
 * montaje pueda renderizar la rama «ya decidida» sin poder hacer clic en el
 * filtro: es donde un `f.decision.decision` sobre un null explotaría en la obra
 * y pasaría el green gate en verde.
 */
function FilaBandeja({ f, activa, catFila, listId, opciones = OPCIONES_BASE, onCrearClasificacion = null, recIA = null, onAceptarIA, onDescartarIA, terminosCustom = null, propuestaLocal = null, frecuentes = [], modeloTexto = null, marcada, onFocus, onMarcar, onAceptar, onFalta, onNoInsumo, onDeshacer }) {
  const cand = f?.sug?.candidatos?.[0] || f?.candidatoIUPC;
  const targetCat = catFila || (f?.candidatoIUPC ? {
    id: null,
    nombre: f.candidatoIUPC.cat.nombre,
    familia: f.candidatoIUPC.cat.familia,
    unidad: [...(f.unidades || [])][0] || 'und',
  } : null);

  // Sin propuesta: el sistema no reconoce la descripción. El desplegable arranca
  // VACÍO a propósito —no hay nada que aceptar hasta que una persona elija— y
  // «Aceptar» queda apagado. Ver `BANDA_SIN_PROPUESTA` en la lib.
  const sinPropuesta = !!f?.sinPropuesta;
  const catInicial = () => (sinPropuesta ? '' : (targetCat?.familia || f?.recomendacionIUPC?.codigo || 'otros'));
  const [categoriaSel, setCategoriaSel] = uS(catInicial);
  uE(() => {
    setCategoriaSel(sinPropuesta ? '' : (targetCat?.familia || f?.recomendacionIUPC?.codigo || 'otros'));
  }, [sinPropuesta, targetCat?.familia, f?.recomendacionIUPC?.codigo]);

  // El aviso se calcula contra lo que está ELEGIDO en este momento, no contra
  // la propuesta: así también salta cuando alguien elige a mano un código que
  // contradice a las hermanas, que es cuando más sirve. En las ya decididas,
  // contra el código con el que quedaron.
  const avisoHermanas = uM(
    () => avisoDeContradiccion(
      f?.estado === 'decididas' ? f?.decision?.familia : categoriaSel,
      f?.hermanas),
    [f?.estado, f?.decision?.familia, categoriaSel, f?.hermanas],
  );

  // Crear la clasificación que propone la IA y dejarla elegida en esta misma
  // fila. Sin esto había que ir a otra vista, crearla y volver a buscar la fila.
  const crearYElegir = onCrearClasificacion
    ? async (prep) => { const cod = await onCrearClasificacion(prep); if (cod) setCategoriaSel(cod); }
    : null;

  const rec = f?.recomendacionIUPC;
  const score = cand?.score ?? rec?.score ?? 0.08;
  const scorePct = Math.round(score * 100);
  // `f.banda` es la que cuenta `resumenAvance` para las pestañas: si el badge
  // usara otra fuente, el filtro «Coincidencia alta (12)» podría mostrar filas
  // con el badge en ámbar. Una sola verdad.
  const banda = f?.banda || bandaConfianza(score).slug;

  const BADGE_BANDA = {
    alta: { cls: 'b-green', lbl: `Coincidencia alta (${scorePct}%)` },
    media: { cls: 'b-blue', lbl: `Coincidencia media (${scorePct}%)` },
    baja: { cls: 'b-amber', lbl: `Coincidencia baja (${scorePct}%)` },
    rara: { cls: 'b-purple', lbl: `Coincidencia rara (${scorePct}%)` },
    extrema_baja: { cls: 'b-red', lbl: `Coincidencia extremadamente baja (${scorePct}%)` },
    // Sin porcentaje: un 5% de confianza sobre «no sé» es un número inventado
    // que sólo sirve para que parezca que hubo un análisis.
    sin_propuesta: { cls: 'b-gray', lbl: 'Sin propuesta' },
  };
  const bInfo = BADGE_BANDA[banda] || BADGE_BANDA.baja;

  return (
    <div
      onClick={onFocus}
      style={{
        borderTop: '1px solid var(--border)', padding: '9px 8px',
        background: activa ? 'var(--bg-s)' : 'transparent',
        borderLeft: activa ? '3px solid var(--amber)' : '3px solid transparent',
        cursor: 'pointer',
      }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* También en las ya decididas: es como se arma el grupo a
            desclasificar (pedido de Gabriel, 15-sep). */}
        <input type="checkbox" checked={marcada} onChange={onMarcar} style={{ marginTop: 3 }}
          title={f.estado === 'decididas' ? 'Marcar para desclasificar en lote' : 'Marcar para decidir en lote'} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
            {f.muestra}
            {/* UNA FILA QUE SON VARIAS (tanda 4). Lo que se correlacionó en
                «Análisis de insumos» llega acá como una sola pregunta: se
                decide una vez y la decisión se escribe para las N. El detalle
                se muestra porque decidir a ciegas sobre nombres que no se ven
                sería peor que decidirlos de a uno. */}
            {f.variantes?.length > 1 && (
              <span className="badge b-blue" style={{ marginLeft: 6, fontSize: 9 }}
                title={`Correlacionadas como el mismo insumo: ${f.variantes.map(v => v.muestra).join(' · ')}. Lo que decidas acá vale para las ${f.variantes.length}.`}>
                🔗 {f.variantes.length} variantes
              </span>
            )}
          </div>
          {f.variantes?.length > 1 && (
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 2, fontStyle: 'italic' }}>
              también: {f.variantes.slice(1, 4).map(v => v.muestra).join(' · ')}
              {f.variantes.length > 4 ? ` +${f.variantes.length - 4}` : ''}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
            {f.veces} {f.veces === 1 ? 'vez' : 'veces'}
            {f.provs?.size > 0 && <> · {[...f.provs].slice(0, 2).join(', ')}{f.provs.size > 2 ? ` +${f.provs.size - 2}` : ''}</>}
            {f.unidades?.size > 0 && <> · {[...f.unidades].join('/')}</>}
            {/* Los dólares se VEN con su marcador y NO se suman al total
                (decisión de Gabriel del 7-set, la misma de «Sin respaldo»). */}
            {[...(f.monedas || [])].some(m => m !== 'PEN') && (
              <span className="badge b-amber" style={{ marginLeft: 6 }}>en dólares</span>
            )}
          </div>

          {f.estado === 'decididas' ? (
            <div style={{ fontSize: 11.5, marginTop: 4 }}>
              {f.decision?.decision === 'catalogo'
                ? <>→ <strong>{f.cat?.nombre || '(insumo del catálogo)'}</strong>
                    {f.decision.familia && <span className="badge b-gray" style={{ marginLeft: 6 }}>{etiquetaCategoria(f.decision.familia)}</span>}</>
                : <span style={{ color: 'var(--tm)' }}>✗ No es un insumo del catálogo</span>}
              {/* «Quiero saber qué insumo he aceptado como recomendación yo»
                  (Gabriel, 14-sep): el sello queda en la fila ya decidida. */}
              {esDecisionDeIA(f.decision) && <SelloIA titulo={f.decision?.nota} />}
              <AvisoHermanas aviso={avisoHermanas} />
            </div>
          ) : (
            <div style={{ fontSize: 11.5, marginTop: 4 }}>
              {sinPropuesta ? (
                <span style={{ color: 'var(--tm)' }}>
                  → <em>El sistema no reconoce esta descripción.</em> Elegí su clasificación:
                </span>
              ) : (
                <>→ <strong>{targetCat?.nombre || rec?.nombre || 'Insumo sugerido'}</strong></>
              )}
              <span className={`badge ${bInfo.cls}`} style={{ marginLeft: 6 }}>
                {bInfo.lbl}
              </span>

              {/* Modificación directa de categoría en la misma fila — con
                  búsqueda: escribí un par de letras y aparece, en vez de
                  desplazar 95 opciones (pedido de Gabriel, 14-sep). */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--tm)' }}>Clasificación:</label>
                <SelectorClasificacion
                  listId={listId}
                  opciones={opciones}
                  value={categoriaSel}
                  // Sin esto, una fila que cae en el fallback 'otros' (o en una
                  // categoría vieja) mostraba el campo VACÍO y «Aceptar» igual
                  // guardaba ese valor: se aceptaba a ciegas algo que no se veía.
                  actualLabel={categoriaSel ? etiquetaCategoria(categoriaSel) : null}
                  permitirVacio
                  onChange={setCategoriaSel}
                  placeholder={sinPropuesta ? '— Escribí para elegir —' : 'Escribí para buscar…'}
                  style={{
                    fontSize: 11, height: 22, padding: '0 4px', width: 200,
                    ...(sinPropuesta && !categoriaSel ? { borderColor: 'var(--amber)' } : null),
                  }}
                  onClick={e => e.stopPropagation()}
                />
              </span>

              <AvisoHermanas aviso={avisoHermanas} onUsar={setCategoriaSel} />

              {/* El recorrido con IA la miró y dijo que no sabe. No hay botón
                  de aceptar porque no hay nada que aceptar: la fila necesita
                  una persona, y eso es exactamente lo que el recorrido fue a
                  averiguar. Ver el comentario de `construirBarrido`. */}
              {recIA?.noSe && (
                <div style={{
                  marginTop: 5, padding: '6px 9px', fontSize: 10.5, borderRadius: 5, maxWidth: 680, width: '100%',
                  background: 'rgba(148,163,184,.12)', border: '1px solid rgba(148,163,184,.4)',
                }} onClick={e => e.stopPropagation()}>
                  <span className="badge b-gray" style={{ fontSize: 9 }}>🤖 La IA no sabe</span>
                  <span style={{ marginLeft: 6 }}>La miró y no encontró con qué decidir — clasificala a mano.</span>
                  {recIA.razonamiento && <Razonamiento texto={recIA.razonamiento} />}
                  {recIA.nuevaClasificacion && (
                    <ClasificacionNueva nombre={recIA.nuevaClasificacion} arbol={recIA.arbolNuevo}
                      cats={opciones} onCrear={crearYElegir} onUsar={setCategoriaSel} />
                  )}
                  <div style={{ marginTop: 4 }}>
                    <button type="button" className="btn btn-xs btn-ghost"
                      onClick={(e) => { e.stopPropagation(); onDescartarIA?.(); }}>Descartar</button>
                  </div>
                </div>
              )}

              {/* Lo que dejó el recorrido con IA. Se muestra APARTE del
                  desplegable a propósito: si se metiera solo en el campo,
                  «Aceptar» guardaría una elección que nadie hizo — que es
                  justo lo que había que corregir. */}
              {recIA?.codigo && (
                <RecomendacionIA
                  titulo={<>Clasificarlo como <strong>{recIA.nombre || etiquetaCategoria(recIA.codigo)}</strong></>}
                  confianza={recIA.confianza}
                  razonamiento={recIA.razonamiento}
                  extra={recIA.nuevaClasificacion
                    ? (
                      <ClasificacionNueva nombre={recIA.nuevaClasificacion} arbol={recIA.arbolNuevo}
                        cats={opciones} onCrear={crearYElegir} onUsar={setCategoriaSel} />
                    )
                    : null}
                  onAceptar={() => onAceptarIA?.(recIA)}
                  onDescartar={() => onDescartarIA?.()}
                />
              )}

              <AyudaClasificacionIA
                descripcion={f.muestra}
                unidad={[...(f.unidades || [])][0] || ''}
                precioUnitario={precioUnitarioDeFila(f)}
                opciones={opciones}
                onCrearClasificacion={onCrearClasificacion}
                terminosCustom={terminosCustom}
                propuestaLocal={propuestaLocal}
                frecuentes={frecuentes}
                modeloTexto={modeloTexto}
                onElegir={setCategoriaSel}
              />

              {rec?.inclinacion && (
                <div style={{ fontSize: 11, color: '#d97706', marginTop: 3, fontWeight: 500 }}>
                  🛠 Servicio con inclinación: <strong>{rec.inclinacion}</strong>
                </div>
              )}

              {cand?.motivos?.length > 0 && (
                <span style={{ color: 'var(--tm)', marginLeft: 6, display: 'block', fontSize: 10.5 }}>
                  ({cand.motivos.slice(0, 3).join(', ')})
                </span>
              )}
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, fontFamily: 'monospace', minWidth: 84, textAlign: 'right' }}>{soles(f.importe)}</div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {f.estado === 'decididas' ? (
            <button className="btn btn-sm" onClick={onDeshacer}>Deshacer</button>
          ) : (
            <>
              {(cand || rec) && (
                <button
                  className="btn btn-sm btn-green"
                  disabled={sinPropuesta && !categoriaSel}
                  title={sinPropuesta && !categoriaSel
                    ? 'Elegí primero una clasificación: el sistema no tiene ninguna que proponer.'
                    : undefined}
                  onClick={() => onAceptar?.(categoriaSel)}>
                  Aceptar
                </button>
              )}
              <button className="btn btn-sm" onClick={onFalta}>Falta en el catálogo</button>
              <button className="btn btn-sm" onClick={onNoInsumo}>No es un insumo</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * El alta al catálogo desde la bandeja. Llega con todo propuesto —nombre de la
 * factura en mayúsculas, unidad de la factura, categoría IUPC o complementaria—
 * porque si hubiera que escribir tres campos desde cero nadie lo usaría.
 * Todo es corregible antes de guardar.
 */
function AltaEnCatalogo({ fila, listId, opciones = OPCIONES_BASE, onCrearClasificacion = null, terminosCustom = null, propuestaLocal = null, frecuentes = [], modeloTexto = null, onCancel, onGuardar }) {
  const [nombre, setNombre] = uS(() => (fila?.muestra || '').trim().toUpperCase().replace(/\s+/g, ' '));
  // Si el estándar no reconoció nada, el desplegable arranca VACÍO: dar de alta
  // un insumo nuevo ya clasificado como «sin clasificar» es agregarle ruido al
  // catálogo con un click.
  const sinPropuesta = !!fila?.sinPropuesta || fila?.recomendacionIUPC?.codigo === 'sin_clasificar';
  const [familia, setFamilia] = uS(() => (sinPropuesta ? '' : (fila?.recomendacionIUPC?.codigo || '')));
  const [unidad, setUnidad] = uS(() => [...(fila?.unidades || [])][0] || 'und');
  const Modal = window.Modal;
  const cuerpo = (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.5 }}>
        Se agrega al catálogo y esta descripción queda mapeada de una.
        Queda como <strong>cargada a mano</strong>, así que reimportar el xlsx no la pisa.
      </div>
      <div>
        <label style={{ fontSize: 11, color: 'var(--tm)' }}>Nombre en el catálogo</label>
        <input className="fi" value={nombre} onChange={e => setNombre(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: 220 }}>
          <label style={{ fontSize: 11, color: 'var(--tm)' }}>Clasificación (IUPC / Servicios / Complementaria)</label>
          <SelectorClasificacion
            listId={listId}
            opciones={opciones}
            value={familia}
            actualLabel={familia ? etiquetaCategoria(familia) : null}
            permitirVacio
            onChange={setFamilia}
            placeholder="Escribí para buscar…"
            style={{ width: '100%' }}
          />
          {!familia && (
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
              El estándar no reconoció esta descripción: elegila vos.
            </div>
          )}
          <AyudaClasificacionIA descripcion={fila?.muestra} unidad={unidad}
            precioUnitario={precioUnitarioDeFila(fila)} opciones={opciones}
            onCrearClasificacion={onCrearClasificacion}
            terminosCustom={terminosCustom} propuestaLocal={propuestaLocal}
            frecuentes={frecuentes} modeloTexto={modeloTexto} onElegir={setFamilia} />
        </div>
        <div style={{ flex: 1, minWidth: 110 }}>
          <label style={{ fontSize: 11, color: 'var(--tm)' }}>Unidad</label>
          <input className="fi" value={unidad} onChange={e => setUnidad(e.target.value)} />
        </div>
      </div>
      {fila?.recomendacionIUPC?.inclinacion && (
        <div style={{ fontSize: 11, color: '#d97706' }}>
          🛠 Inclinación detectada: {fila.recomendacionIUPC.inclinacion}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--tm)' }}>
        De la factura: «{fila.muestra}» — {fila.veces} {fila.veces === 1 ? 'vez' : 'veces'}, {soles(fila.importe)}.
      </div>
    </div>
  );
  const pie = (
    <>
      <button className="btn btn-sm" onClick={onCancel}>Cancelar</button>
      <button className="btn btn-sm btn-green" disabled={!nombre.trim() || !familia}
        onClick={() => onGuardar(fila, { nombre, familia, unidad })}>
        Agregar al catálogo
      </button>
    </>
  );
  const pieEnvuelto = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>{pie}</div>
  );
  if (!Modal) {
    return <div className="card card-p">{cuerpo}{pieEnvuelto}</div>;
  }
  return (
    <Modal title="Falta en el catálogo" icon="tool" onClose={onCancel}>
      {cuerpo}{pieEnvuelto}
    </Modal>
  );
}

export { BandejaCategorizacionTab, FilaBandeja, AltaEnCatalogo };
export default BandejaCategorizacionTab;
