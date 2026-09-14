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
  decisionDeCatalogo, decisionNoInsumo, ESTADOS,
} from "../lib/bandeja-categorizacion.js";
import {
  decidir, decidirEnLote, agregarAlCatalogoYDecidir, reabrir, enseñarALaContadora,
} from "../lib/bandeja-categorizacion-db.js";
import {
  equivalenciasDe,
} from "../lib/catalogo-canonico.js";
import {
  categoriasParaElegir, etiquetaCategoria, bandaConfianza,
} from "../lib/indices-unificados-iupc.js";
import { enseñarDiccionario } from "../lib/clasificaciones-db.js";
import { SelectorClasificacion, ClasificacionDatalist } from "./jx-selector-clasificacion.jsx";
import { clasificarInsumoConIA, notaDeIA, esDecisionDeIA } from "../lib/ia-insumos.js";
import { UMBRAL_BARRIDO_IA } from "../lib/barrido-ia.js";
import { guardarRecomendacion, olvidarRecomendacion } from "../lib/barrido-store.js";
import { BarridoIA, RecomendacionIA, SelloIA, useBarridoIA } from "./jx-barrido-ia.jsx";

const { useState: uS, useMemo: uM, useRef: uR, useEffect: uE, useId: uId, useCallback: uC } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

// Se calcula UNA vez: son 95 categorías y este componente se renderiza en
// cada fila de la tabla. `sin_clasificar` queda AFUERA a propósito (pedido de
// Gabriel, 14-sep): elegirla a mano de una lista es lo mismo que no elegir
// nada — ver `categoriasParaElegir()`.
const OPCIONES_CLASIFICACION = categoriasParaElegir();

const soles = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;

const COLOR_ESTADO = {
  propuesto: 'b-green', revisar: 'b-amber', falta: 'b-blue', decididas: 'b-gray',
};

/**
 * Botón "🤖 Preguntale a la IA" — segunda opinión CON RAZONAMIENTO (14-sep).
 * El parecido de palabras del motor local se equivoca con cosas como ropa de
 * trabajo con cinta reflectiva saliendo "herramienta manual". No reemplaza al
 * motor local (sigue siendo el primero, gratis y sin red) ni se aplica sola:
 * el resultado se muestra y `onElegir(codigo)` es un click aparte.
 */
function AyudaClasificacionIA({ descripcion, unidad, onElegir }) {
  const [sugerencia, setSugerencia] = uS(null);
  const [cargando, setCargando] = uS(false);
  const [error, setError] = uS(null);

  const preguntar = async (e) => {
    e.stopPropagation();
    if (cargando) return;
    setCargando(true); setError(null);
    try {
      const r = await clasificarInsumoConIA({ descripcion, unidad, candidatos: OPCIONES_CLASIFICACION });
      if (!r?.result?.codigo_sugerido) {
        setError(r?.razonamiento || 'No encontró una clasificación clara para esto.');
        return;
      }
      const opt = OPCIONES_CLASIFICACION.find(o => o.codigo === r.result.codigo_sugerido);
      setSugerencia({
        codigo: r.result.codigo_sugerido, nombre: opt?.label || r.result.codigo_sugerido,
        confianza: r.confianza, razonamiento: r.razonamiento, cached: !!r._cached,
      });
    } catch (e2) {
      setError(e2?.message || 'No se pudo consultar la IA.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div style={{ marginTop: 6 }} onClick={e => e.stopPropagation()}>
      <button type="button" className="btn btn-xs btn-ghost" disabled={cargando} onClick={preguntar}>
        {cargando ? '🤖 Pensando…' : '🤖 Preguntale a la IA'}
      </button>
      {error && <span style={{ color: 'var(--red)', fontSize: 10.5, marginLeft: 6 }}>{error}</span>}
      {sugerencia && (
        <div style={{ marginTop: 4, padding: '5px 8px', background: 'rgba(58,163,255,.08)', border: '1px solid rgba(58,163,255,.3)', borderRadius: 5, fontSize: 10.5, maxWidth: 360 }}>
          🤖 Sugiere <strong>{sugerencia.nombre}</strong>
          <span className="badge b-blue" style={{ marginLeft: 4, fontSize: 9 }}>{Math.round((sugerencia.confianza || 0) * 100)}%</span>
          {sugerencia.cached && <span style={{ color: 'var(--tm)' }}> · ya preguntada</span>}
          <div style={{ color: 'var(--tm)', marginTop: 2 }}>{sugerencia.razonamiento}</div>
          <button type="button" className="btn btn-xs btn-blue" style={{ marginTop: 4 }}
            onClick={(e) => { e.stopPropagation(); onElegir(sugerencia.codigo); }}>
            Usar esta clasificación
          </button>
        </div>
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
  const [busca, setBusca] = uS('');
  const [limite, setLimite] = uS(40);
  const [cursor, setCursor] = uS(0);
  const [altaDe, setAltaDe] = uS(null);      // fila para la que se abre el alta
  const [marcadas, setMarcadas] = uS(() => new Set());
  // Anti doble-click (regla crítica 2): ref SÍNCRONO. Un doble tap en «Aceptar»
  // no puede escribir dos filas para la misma descripción.
  const guardandoRef = uR(false);
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
  const descripciones = uM(() => agruparDescripciones(comprasEnAlcance), [comprasEnAlcance]);
  const filas = uM(
    () => filasDeBandeja(descripciones, { prep, porId, decisiones }),
    [descripciones, prep, porId, decisiones],
  );
  const avance = uM(() => resumenAvance(filas), [filas]);
  const lotes = uM(() => lotesPorPropuesta(filas), [filas]);

  const visibles = uM(() => {
    const t = busca.trim().toLowerCase();
    return filas.filter(f => {
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
  }, [filas, filtro, busca, recsIA]);

  const enPantalla = uM(() => visibles.slice(0, limite), [visibles, limite]);

  // El cursor no puede quedar fuera de la lista cuando se filtra o se decide.
  uE(() => { setCursor(c => Math.min(c, Math.max(0, enPantalla.length - 1))); }, [enPantalla.length]);

  const catalogoDe = (fila) => {
    const cod = fila?.sug?.candidatos?.[0]?.cat?.codigo;
    return cod ? porId.get(cod) : null;
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
      });
      await enseñarALaContadora([{ fila, catalogoFila: creado }], { userId, equivalencias });
      // Enseña la clasificación IUPC — sea que se haya aceptado la propuesta
      // TAL CUAL, o que se haya elegido otra cosa a mano (un descarte): lo que
      // se enseña es SIEMPRE la decisión final (ver enseñarDiccionario).
      await enseñarDiccionario({ descripcion: fila.muestra, clasificacionCodigo: catFinal, companyId }, { userId });
      olvidarRecomendacion('clasificacion', ambitoIA, fila.norm);
      await Promise.all([decHook.refresh?.(), catHook.refresh?.()]);
      if (!silencioso) showToast?.(`✓ «${creado.nombre}» dado de alta en ${etiquetaCategoria(catFinal)} y decidido`, 'green');
      return;
    }

    await decidir(decisionDeCatalogo(fila, catFila, {
      factor: cand?.factor?.factor ?? null,
      factorFuente: cand?.factor?.fuente ?? null,
      score: cand?.score ?? fila?.recomendacionIUPC?.score ?? null,
      companyId,
      categoria: catFinal,
      nota: notaIA,
    }), { userId });
    await enseñarALaContadora([{ fila, catalogoFila: { ...catFila, familia: catFinal } }], { userId, equivalencias });
    await enseñarDiccionario({ descripcion: fila.muestra, clasificacionCodigo: catFinal, companyId }, { userId });
    olvidarRecomendacion('clasificacion', ambitoIA, fila.norm);
    await decHook.refresh?.();
    if (!silencioso) showToast?.(`✓ ${catFila.nombre} [${etiquetaCategoria(catFinal)}] — vale para todas las facturas`, 'green');
  });

  const noEsInsumo = conGuard(async (fila) => {
    await decidir(decisionNoInsumo(fila, { companyId }), { userId });
    // Decir «no es un insumo» también resuelve la fila: la propuesta de la IA
    // ya no tiene a quién esperar.
    olvidarRecomendacion('clasificacion', ambitoIA, fila.norm);
    await decHook.refresh?.();
    showToast?.('✓ Marcado: no es un insumo del catálogo — no se vuelve a preguntar', 'green');
  });

  const deshacer = conGuard(async (fila) => {
    await reabrir(fila.norm, { companyId });
    await decHook.refresh?.();
    showToast?.('Decisión deshecha — vuelve a la lista', 'green');
  });

  const aceptarLote = conGuard(async (grupo) => {
    const catFila = porId.get(grupo.codigo);
    if (!catFila) return;
    const cuerpos = grupo.filas.map(f => decisionDeCatalogo(f, catFila, {
      factor: f.sug?.candidatos?.[0]?.factor?.factor ?? null,
      factorFuente: f.sug?.candidatos?.[0]?.factor?.fuente ?? null,
      score: f.sug?.candidatos?.[0]?.score ?? null, companyId,
    }));
    const n = await decidirEnLote(cuerpos, { userId });
    await enseñarALaContadora(grupo.filas.map(f => ({ fila: f, catalogoFila: catFila })), { userId, equivalencias });
    // Un término por descripción del lote — todas terminan en la MISMA
    // clasificación (la del insumo del catálogo al que se aceptó el lote).
    // SECUENCIAL a propósito: enseñarDiccionario lee-antes-de-escribir, y dos
    // filas del lote con la misma descripción normalizada bajo un Promise.all
    // verían ambas "no hay término todavía" y crearían un duplicado.
    if (catFila.familia) {
      for (const f of grupo.filas) {
        await enseñarDiccionario({ descripcion: f.muestra, clasificacionCodigo: catFila.familia, companyId }, { userId });
      }
    }
    for (const f of grupo.filas) olvidarRecomendacion('clasificacion', ambitoIA, f.norm);
    await decHook.refresh?.();
    showToast?.(`✓ ${n} descripciones → ${catFila.nombre}`, 'green');
  });

  const noSonInsumoEnLote = conGuard(async () => {
    const elegidas = enPantalla.filter(f => marcadas.has(f.norm) && f.estado !== 'decididas');
    if (!elegidas.length) return;
    const n = await decidirEnLote(elegidas.map(f => decisionNoInsumo(f, { companyId })), { userId });
    setMarcadas(new Set());
    await decHook.refresh?.();
    showToast?.(`✓ ${n} marcadas como «no es un insumo» — no vuelven a preguntarse`, 'green');
  });

  const crearEnCatalogo = conGuard(async (fila, campos) => {
    const creado = await agregarAlCatalogoYDecidir(fila, { ...campos, companyId, userId });
    if (campos.familia) {
      await enseñarDiccionario({ descripcion: fila.muestra, clasificacionCodigo: campos.familia, companyId }, { userId });
    }
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
        descripcion: f.muestra, unidad: [...(f.unidades || [])][0] || '', candidatos: OPCIONES_CLASIFICACION,
      });
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
      });
      return 'recomendada';
    },
  }), [pendientesTotal, ambitoIA, aceptar]);

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
  // Solo las que siguen pendientes: una recomendación sobre algo ya decidido
  // no es nada que revisar (y se olvida sola al aceptar).
  const nRecomendadasIA = filas.filter(f => f.estado !== 'decididas' && recsIA[f.norm]).length;

  return (
    <>
      <ClasificacionDatalist id={listId} opciones={OPCIONES_CLASIFICACION} />
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

        {nMarcadas > 0 && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', background: 'var(--bg-s)', borderRadius: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12 }}>{nMarcadas} marcadas</strong>
            <button className="btn btn-sm" onClick={noSonInsumoEnLote}>✗ No son insumos del catálogo</button>
            <button className="btn btn-sm" onClick={() => setMarcadas(new Set())}>Desmarcar</button>
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
            recIA={recsIA[f.norm] || null}
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

      {altaDe && <AltaEnCatalogo fila={altaDe} listId={listId} onCancel={() => setAltaDe(null)} onGuardar={crearEnCatalogo} />}
    </>
  );
}

/**
 * Una fila de la bandeja. Va en su propio componente para que el test de
 * montaje pueda renderizar la rama «ya decidida» sin poder hacer clic en el
 * filtro: es donde un `f.decision.decision` sobre un null explotaría en la obra
 * y pasaría el green gate en verde.
 */
function FilaBandeja({ f, activa, catFila, listId, recIA = null, onAceptarIA, onDescartarIA, marcada, onFocus, onMarcar, onAceptar, onFalta, onNoInsumo, onDeshacer }) {
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
        {f.estado !== 'decididas' && (
          <input type="checkbox" checked={marcada} onChange={onMarcar} style={{ marginTop: 3 }} />
        )}
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.muestra}</div>
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
                  opciones={OPCIONES_CLASIFICACION}
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

              {/* Lo que dejó el recorrido con IA. Se muestra APARTE del
                  desplegable a propósito: si se metiera solo en el campo,
                  «Aceptar» guardaría una elección que nadie hizo — que es
                  justo lo que había que corregir. */}
              {recIA?.codigo && (
                <RecomendacionIA
                  titulo={<>Clasificarlo como <strong>{recIA.nombre || etiquetaCategoria(recIA.codigo)}</strong></>}
                  confianza={recIA.confianza}
                  razonamiento={recIA.razonamiento}
                  onAceptar={() => onAceptarIA?.(recIA)}
                  onDescartar={() => onDescartarIA?.()}
                />
              )}

              <AyudaClasificacionIA
                descripcion={f.muestra}
                unidad={[...(f.unidades || [])][0] || ''}
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
function AltaEnCatalogo({ fila, listId, onCancel, onGuardar }) {
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
            opciones={OPCIONES_CLASIFICACION}
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
          <AyudaClasificacionIA descripcion={fila?.muestra} unidad={unidad} onElegir={setFamilia} />
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
