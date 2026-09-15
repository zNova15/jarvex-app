// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL CATÁLOGO (tanda 14, entrega 2). Pestaña de Análisis de Insumos,
// gate admin/gerente heredado del panel.
//
// Es la puerta de entrada del catálogo canónico: acá se importa
// «Categorizacion Simple.xlsx», se ve qué quedó cargado, se corrige lo que el
// archivo dejó mal y se dice qué categoría de una empresa equivale a cuál de
// otra. Sin esta pantalla el catálogo sería una tabla que nadie puede tocar.
//
// TRES COSAS QUE ESTA PANTALLA TIENE QUE HACER BIEN, Y POR QUÉ
//
// 1. EL ÁMBITO (mig 193). Gabriel: «la categorización pueda ser independiente
//    en cada entidad, para que cada empresa vaya manejando una base de datos, y
//    a la vez tener una base de datos general». El selector de arriba elige
//    entre el catálogo GENERAL del grupo y el de cada entidad. Parado en una
//    entidad se ve lo suyo MÁS el general; corregir algo que venía del general
//    NO lo cambia para todos: le hace a esa entidad su propia copia.
//
// 2. CORREGIR EN LOTE. Gabriel, sobre el xlsx: «no es que esté perfecto, hace
//    falta una revisión». Son 444 filas. Revisar de a una no se hace nunca;
//    marcar veinte y decir «todas estas son ferretería» sí. Sin esto, importar
//    y corregir serían dos promesas y solo la primera se cumpliría.
//
// 3. LAS EQUIVALENCIAS DE CATEGORÍAS. Solo se pregunta por las familias PROPIAS
//    —las que una entidad escribió a su manera—; si dos usan las del grupo, ya
//    coinciden y no hay nada que decidir. «Es propia y no equivale a ninguna»
//    también es respuesta y también se recuerda.
//
// LA IMPORTACIÓN MUESTRA EL DIFF ANTES DE ESCRIBIR: si el archivo viene
// recortado o con una familia renombrada, hay que poder verlo ANTES. Lo que
// falta no se borra, se desactiva, y solo si se marca la casilla.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { parseExcelFile } from "../lib/excel.js";
import {
  parseCatalogoXlsx, resolverCatalogo, resumenDiff, contarPorFamilia,
  etiquetaFamilia, tipoInsumoDe, categoriaItemDe, esFamiliaCanonica,
  familiasPropias, equivalenciasDe, matrizCategorias,
  entidadesConCatalogo, revisarCategoriasCatalogo,
} from "../lib/catalogo-canonico.js";
import {
  // listarCategoriasDisponibles: la base COMPLETA (incluida sin_clasificar),
  // para PanelClasificaciones — necesita poder resolver filas viejas que ya
  // quedaron así. categoriasParaElegir: la misma base MENOS sin_clasificar,
  // para los selectores donde se ELIGE una categoría (ver su comentario).
  listarCategoriasDisponibles, categoriasParaElegir, etiquetaCategoria, bandaConfianza,
  terminosDeClasificacion, normIUPC,
} from "../lib/indices-unificados-iupc.js";
import {
  crearClasificacion, editarClasificacion,
  agregarTermino, quitarTermino, codigoSugerido, validarClasificacion,
  eliminarClasificacion, aplicarFusion,
} from "../lib/clasificaciones-db.js";
import { planBaja, planFusion, parecidasEntreSi } from "../lib/fusion-clasificaciones.js";
import { buscarClasificaciones, cuantasEnDiccionario } from "../lib/buscar-clasificacion.js";
import {
  previsualizarImportacion, aplicarImportacion, corregirFactor,
  corregirEnLote, adoptarEnEntidad, decidirEquivalencia,
  moverDeFamilia, descartarRecomendaciones,
} from "../lib/catalogo-canonico-db.js";
import { getCurrentMode } from "../lib/app-mode-core.js";
import { agruparDescripciones, resolverCategorias } from "../lib/bandeja-categorizacion.js";
import { BandejaCategorizacionTab } from "./jx-bandeja-categorizacion.jsx";
import { PanelAuditoriaDiccionario } from "./jx-auditoria-diccionario.jsx";
import { SelectorClasificacion, ClasificacionDatalist } from "./jx-selector-clasificacion.jsx";
import { enseñarDiccionario } from "../lib/clasificaciones-db.js";

const { useState: uS, useMemo: uM, useRef: uR, useId: uId } = React;

// El orden en que conviene despachar la reclasificación: de lo que el estándar
// reconoce mejor a lo que apenas intuye. No hay lote para las bandas flojas a
// propósito — esas se miran de a una.
const BANDAS_LOTE = [
  ['alta', 'coincidencia alta'],
  ['media', 'coincidencia media'],
];
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const TIPO_DESTINO = {
  material: 'Materiales', herramienta: 'Herramientas', epp: 'EPP',
  maquinaria: 'Maquinaria', servicio: 'Servicio / gasto',
};
const BADGE_DESTINO = {
  material: 'b-gray', herramienta: 'b-blue', epp: 'b-amber',
  maquinaria: 'b-red', servicio: 'b-purple',
};
const ETIQUETA_FACTOR = {
  tabla: { txt: 'norma', color: 'b-green' },
  descripcion: { txt: 'del nombre', color: 'b-green' },
  supuesto: { txt: 'supuesto', color: 'b-amber' },
  manual: { txt: 'tuyo', color: 'b-blue' },
};
const UNIDADES_SUGERIDAS = ['und', 'm', 'm2', 'm3', 'kg', 'bolsa', 'gal', 'par', 'juego', 'rollo', 'caja', 'p2', 'var', 'glb', 'mes', 'dia', 'hm'];

const num = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 3 });

function CatalogoCanonicoTab({ showToast, empresaFija = null, vistaInicial = 'clasificaciones', compras = [] }) {
  const catHook = window.__hooks.useCatalogoInsumos();
  const disgHook = window.__hooks.useCatalogoDisgregacion();
  const eqHook = window.__hooks.useCatalogoFamiliaMapeo();
  const compHook = window.__hooks.useCompanies();
  const decHook = window.__hooks.useInsumoCategorias();
  const auth = window.__useAuth ? window.__useAuth() : {};
  const userId = auth?.profile?.id || null;

  // '' = catálogo general del grupo. Con `empresaFija` (tanda 18, entrega C:
  // se entró por el bloque de una empresa, o se la eligió arriba) el ámbito lo
  // manda la pantalla y el selector de acá queda clavado: un selector adentro
  // de otro que dicen cosas distintas es la forma más rápida de mirar el
  // catálogo equivocado.
  const [ambito, setAmbito] = uS(() => empresaFija || '');
  const [busca, setBusca] = uS('');
  const [famSel, setFamSel] = uS('todas');
  const [tipoSel, setTipoSel] = uS('todos');
  const [verInactivos, setVerInactivos] = uS(false);
  const [soloDudosos, setSoloDudosos] = uS(false);
  const [limite, setLimite] = uS(80);
  const [marcados, setMarcados] = uS({});      // id → true
  const [famLote, setFamLote] = uS('');
  const [uniLote, setUniLote] = uS('');
  const [leido, setLeido] = uS(null);
  const [diff, setDiff] = uS(null);
  const [desactivar, setDesactivar] = uS(false);
  const [leyendo, setLeyendo] = uS(false);
  const [factorEdit, setFactorEdit] = uS({});
  const [eqElegida, setEqElegida] = uS({});    // familia local → slug canónico
  const clasHook = window.__hooks.useClasificaciones();
  const terHook = window.__hooks.useClasificacionTerminos();
  // Las opciones que se OFRECEN en los selectores con búsqueda de esta
  // pantalla (14-sep-2026): la base IUPC/Servicios/Complementarias + las
  // clasificaciones propias que Gabriel ya creó, MENOS `sin_clasificar`
  // (ver categoriasParaElegir). Un solo <datalist> compartido — ver el
  // encabezado de jx-selector-clasificacion.jsx.
  const opcionesClasificacion = uM(() => categoriasParaElegir(clasHook.data || []), [clasHook.data]);
  const listId = uId();
  // Catálogo = las CLASIFICACIONES y su diccionario. La lista plana de los 483
  // insumos queda como segunda vista: con ese volumen, buscar y corregir en
  // lote sigue siendo la forma más rápida de arreglar muchas filas a la vez.
  // 'lista' era la pestaña «📋 Insumos y servicios», que se fue el 15-set. El
  // alias cae a 'clasificaciones' en vez de dejar la pantalla en blanco: hay
  // navegaciones guardadas (y memoria muscular) que todavía la piden por
  // nombre, y una vista que no existe no dibuja NADA — ni un cartel.
  const [vista, setVista] = uS(() => (vistaInicial === 'lista' ? 'clasificaciones' : vistaInicial));
  const [catOverride, setCatOverride] = uS({});// id → codigo categoria sugerida editada
  const [recMarcadas, setRecMarcadas] = uS({});
  // Anti doble-click (regla crítica de la casa): ref SÍNCRONO. Un doble tap no
  // puede escribir el catálogo dos veces.
  const enCursoRef = uR(false);
  const inputRef = uR(null);

  const companyId = empresaFija || ambito || null;

  // Entidades que pueden tener catálogo propio: las del grupo y los consorcios
  // ejecutores. Un tercero no arma catálogo — le compramos, no lo administramos.
  // La entidad FIJADA desde arriba entra siempre, aunque no sea propia ni
  // consorcio: un selector deshabilitado y en blanco parece un error.
  const entidades = uM(() => (compHook.data || [])
    .filter(c => !c.deleted_at
      && (['propia', 'consorcio'].includes(c.tipo_entidad || 'propia') || c.id === empresaFija))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es')),
  [compHook.data, empresaFija]);
  const nombreDe = uM(() => new Map(entidades.map(c => [c.id, c.name])), [entidades]);

  const crudo = uM(() => catHook.data || [], [catHook.data]);
  const conCatalogo = uM(() => new Map(entidadesConCatalogo(crudo).map(e => [e.company_id, e.n])), [crudo]);

  const equivalencias = uM(() => equivalenciasDe(eqHook.data || [], companyId), [eqHook.data, companyId]);
  const todas = uM(() => resolverCatalogo(crudo, { companyId }), [crudo, companyId]);
  const activas = uM(() => todas.filter(r => r.activo !== false), [todas]);
  const familias = uM(() => contarPorFamilia(crudo, { companyId }), [crudo, companyId]);
  const inactivas = todas.length - activas.length;

  const propias = uM(
    () => (companyId ? familiasPropias(crudo, eqHook.data || [], companyId) : []),
    [crudo, eqHook.data, companyId],
  );
  const matriz = uM(() => matrizCategorias(crudo, eqHook.data || []), [crudo, eqHook.data]);

  // La revisión recommendativa: recomendaciones oficiales IUPC / INEI.
  // 100% de cobertura predictiva con bandas de probabilidad.
  const codigosPropios = uM(
    () => new Set((clasHook.data || []).filter(c => !c.deleted_at).map(c => c.codigo)),
    [clasHook.data],
  );
  const revision = uM(
    () => revisarCategoriasCatalogo(activas, { terminosCustom: terHook.data || null, codigosPropios }),
    [activas, terHook.data, codigosPropios],
  );
  const idsRec = uM(() => Object.keys(recMarcadas).filter(k => recMarcadas[k]), [recMarcadas]);

  // La recomendación de cada fila, para poder decirlo EN LA FILA y no sólo en
  // un panel arriba de todo. Pedido de Gabriel (13-set): «quiero igual un
  // botón de sugerencia si se piensa que algún insumo o servicio está mal
  // clasificado». El panel de lote sigue existiendo para despachar de a
  // muchas; esto es para cuando estás mirando una.
  const recPorId = uM(
    () => new Map(revision.recomendaciones.map(r => [r.id, r])),
    [revision],
  );

  // ── CUÁNTOS NOMBRES DE FACTURA FALTAN RECONOCER ──────────────────
  // 🔴 EL NÚMERO QUE CONFUNDÍA (13-set-2026). Gabriel: «en Lista completa me
  // salen 484 … pero en categorizar me salen 723 por decidir. Eso no lo
  // entiendo». Son dos universos distintos y hasta hoy vivían en dos pestañas
  // distintas sin decir nunca cómo se relacionan:
  //   · 484 = los insumos y servicios QUE LA ENTIDAD TIENE, cada uno con su
  //     clasificación. Es el vocabulario.
  //   · 723 = las formas distintas en que esos insumos aparecen ESCRITOS en
  //     las facturas de la entidad (medido: 732 descripciones distintas en las
  //     887 líneas de compra de GASOMI; el grupo entero tiene 2.220). Cada una
  //     se pega a uno de los 484 —o crea uno nuevo— y deja de preguntarse.
  // Nunca van a ser el mismo número: un insumo se escribe de cinco maneras.
  // Ahora las dos listas son VISTAS DE UNA MISMA SECCIÓN y el encabezado lo
  // explica con los dos contadores al lado.
  //
  // El conteo es barato a propósito (agrupar + resolver decisiones, sin correr
  // el motor de propuestas): se calcula en cada render para pintar la pestaña,
  // y el trabajo caro sólo ocurre cuando se entra a la vista.
  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
  const porReconocer = uM(() => {
    const enAlcance = companyId
      ? (compras || []).filter(c => c.companyId === companyId)
      : (compras || []);
    const descripciones = agruparDescripciones(enAlcance);
    if (!descripciones.length) return { total: 0, pendientes: 0, decididas: 0 };
    const decididas = resolverCategorias(decHook.data || [], { companyId, demo: esPrueba });
    let pend = 0;
    for (const d of descripciones) if (!decididas.get(d.norm)) pend += 1;
    return { total: descripciones.length, pendientes: pend, decididas: descripciones.length - pend };
  }, [compras, companyId, decHook.data, esPrueba]);

  // Lo que la app aprendió sola más lo que se escribió a mano: es el número de
  // la pestaña de Auditoría (tanda 5). La base oficial no cuenta acá — viaja
  // en el bundle, no se audita ni se toca.
  const terminosPropios = uM(
    () => (terHook.data || []).filter(t => t && !t.deleted_at && !!t.demo === esPrueba),
    [terHook.data, esPrueba],
  );

  const visibles = uM(() => {
    const q = busca.trim().toLowerCase();
    return (verInactivos ? todas : activas)
      .filter(r => famSel === 'todas' || r.familia === famSel)
      .filter(r => tipoSel === 'todos' || r.tipo === tipoSel)
      .filter(r => !soloDudosos || recPorId.has(r.id))
      .filter(r => !q || String(r.nombre || '').toLowerCase().includes(q))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }, [todas, activas, verInactivos, famSel, tipoSel, busca, soloDudosos, recPorId]);

  const disgregacion = uM(() => {
    const porPadre = new Map();
    for (const d of (disgHook.data || [])) {
      if (!d || d.deleted_at || d.activo === false) continue;
      if ((d.company_id || null) !== companyId) continue;
      if (!porPadre.has(d.padre_norm)) {
        porPadre.set(d.padre_norm, { nombre: d.padre_nombre, unidad: d.padre_unidad, hijos: [] });
      }
      porPadre.get(d.padre_norm).hijos.push(d);
    }
    return [...porPadre.values()];
  }, [disgHook.data, companyId]);

  const resumen = uM(() => (diff ? resumenDiff(diff) : null), [diff]);
  const idsMarcados = uM(() => Object.keys(marcados).filter(k => marcados[k]), [marcados]);
  const refrescar = async () => { await catHook.refresh?.(); await disgHook.refresh?.(); await eqHook.refresh?.(); };

  // ── Leer el archivo (NO escribe: solo calcula el diff) ────────────
  const elegirArchivo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLeyendo(true);
    try {
      const parsed = await parseExcelFile(file);
      const r = parseCatalogoXlsx(parsed.sheets || []);
      if (!r.insumos.length && !r.disgregacion.length) {
        showToast?.('El archivo no trae ninguna hoja INSUMOS, SERVICIOS ni DISGREGADOS.', 'error');
        setLeido(null); setDiff(null);
        return;
      }
      setLeido(r);
      setDiff(await previsualizarImportacion(r.insumos, { companyId }));
      setDesactivar(false);
    } catch (err) {
      showToast?.(`No se pudo leer el archivo: ${err?.message || err}`, 'error');
    } finally {
      setLeyendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const aplicar = async () => {
    if (enCursoRef.current || !diff || !leido) return;
    enCursoRef.current = true;
    try {
      const hecho = await aplicarImportacion(diff, leido.disgregacion, { userId, desactivarAusentes: desactivar, companyId });
      await refrescar();
      setLeido(null); setDiff(null);
      showToast?.(
        `Catálogo actualizado: ${hecho.altas} nuevos, ${hecho.cambios} corregidos`
        + (hecho.reactivados ? `, ${hecho.reactivados} reactivados` : '')
        + (hecho.desactivados ? `, ${hecho.desactivados} desactivados` : '')
        + '.', 'success');
    } catch (err) {
      showToast?.(`No se pudo aplicar: ${err?.message || err}`, 'error');
    } finally {
      enCursoRef.current = false;
    }
  };

  // ── Corregir en lote ─────────────────────────────────────────────
  // Parado en una entidad, corregir una fila que viene del GENERAL no cambia el
  // catálogo de todos: le hace a esa entidad su propia copia con el cambio.
  const corregirLote = async (cambios) => {
    if (enCursoRef.current || !idsMarcados.length) return;
    enCursoRef.current = true;
    try {
      const porId = new Map(todas.map(r => [r.id, r]));
      const suyas = idsMarcados.filter(id => (porId.get(id)?.company_id || null) === companyId);
      const heredadas = idsMarcados.filter(id => (porId.get(id)?.company_id || null) !== companyId);
      let n = await corregirEnLote(suyas, cambios, { userId });
      for (const id of heredadas) {
        if (await adoptarEnEntidad(id, companyId, cambios, { userId })) n++;
      }
      await refrescar();
      setMarcados({}); setFamLote(''); setUniLote('');
      showToast?.(
        `${n} ${n === 1 ? 'corregido' : 'corregidos'}`
        + (heredadas.length ? ` (${heredadas.length} quedaron como versión propia de esta entidad)` : '')
        + '.', 'success');
    } catch (err) {
      showToast?.(`No se pudo corregir: ${err?.message || err}`, 'error');
    } finally {
      enCursoRef.current = false;
    }
  };

  const aceptarMovidas = async () => {
    if (enCursoRef.current || !idsRec.length) return;
    enCursoRef.current = true;
    try {
      const recs = revision.recomendaciones
        .filter(r => recMarcadas[r.id])
        .map(r => ({
          ...r,
          familiaSugerida: catOverride[r.id] || r.familiaSugerida || r.categoriaSugerida,
        }));
      const n = await moverDeFamilia(recs, { userId });
      // Cada aceptación (tal cual la propuesta, o con la categoría que se
      // eligió en su lugar) enseña al diccionario — pedido de Gabriel, 14-sep.
      // SECUENCIAL: enseñarDiccionario lee-antes-de-escribir; dos filas con
      // la misma descripción normalizada bajo un Promise.all duplicarían el
      // término en vez de que la segunda vea el que acaba de crear la primera.
      for (const r of recs) {
        await enseñarDiccionario({ descripcion: r.nombre, clasificacionCodigo: r.familiaSugerida, companyId }, { userId });
      }
      await refrescar(); setRecMarcadas({}); setCatOverride({});
      showToast?.(`${n} ${n === 1 ? 'insumo reclasificado' : 'insumos reclasificados'} exitosamente.`, 'success');
    } catch (err) { showToast?.(`No se pudo reclasificar: ${err?.message || err}`, 'error'); }
    finally { enCursoRef.current = false; }
  };

  const aceptarUna = async (r) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try {
      const destino = catOverride[r.id] || r.familiaSugerida || r.categoriaSugerida;
      const n = await moverDeFamilia([{ ...r, familiaSugerida: destino }], { userId });
      await enseñarDiccionario({ descripcion: r.nombre, clasificacionCodigo: destino, companyId }, { userId });
      await refrescar();
      showToast?.(`✓ «${r.nombre}» clasificado como ${etiquetaCategoria(destino)}`, 'success');
    } catch (err) { showToast?.(`No se pudo reclasificar: ${err?.message || err}`, 'error'); }
    finally { enCursoRef.current = false; }
  };

  const descartarMovidas = async (ids) => {
    if (enCursoRef.current || !ids.length) return;
    enCursoRef.current = true;
    try {
      const n = await descartarRecomendaciones(ids, { userId });
      await refrescar(); setRecMarcadas({});
      showToast?.(`${n} ${n === 1 ? 'quedó' : 'quedaron'} donde ${n === 1 ? 'estaba' : 'estaban'}. No se vuelve a proponer.`, 'success');
    } catch (err) { showToast?.(`No se pudo guardar: ${err?.message || err}`, 'error'); }
    finally { enCursoRef.current = false; }
  };

  const guardarFactor = async (d) => {
    const v = factorEdit[d.id];
    if (v == null || v === '') return;
    await corregirFactor(d.id, v, { userId });
    await disgHook.refresh?.();
    setFactorEdit(p => { const n = { ...p }; delete n[d.id]; return n; });
    showToast?.('Factor guardado. Desde ahora manda el tuyo.', 'success');
  };

  const guardarEquivalencia = async (familiaLocal, decision) => {
    if (enCursoRef.current) return;
    const canonica = eqElegida[familiaLocal] || null;
    if (decision === 'mapeada' && !canonica) { showToast?.('Elige a qué categoría del grupo equivale.', 'error'); return; }
    enCursoRef.current = true;
    try {
      await decidirEquivalencia(companyId, familiaLocal, { familiaCanonica: canonica, decision, userId });
      await eqHook.refresh?.();
      setEqElegida(p => { const n = { ...p }; delete n[familiaLocal]; return n; });
      showToast?.(decision === 'mapeada'
        ? `«${familiaLocal}» queda como ${etiquetaFamilia(canonica)}. No se vuelve a preguntar.`
        : `«${familiaLocal}» queda como categoría propia de esta entidad.`, 'success');
    } catch (err) {
      showToast?.(`No se pudo guardar: ${err?.message || err}`, 'error');
    } finally {
      enCursoRef.current = false;
    }
  };

  const etiquetaAmbito = companyId ? (nombreDe.get(companyId) || 'esta entidad') : 'el grupo';

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <ClasificacionDatalist id={listId} opciones={opcionesClasificacion} />

      {/* ── El ámbito ───────────────────────────────────────────── */}
      <div className="card card-p" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 300 }}>
          <label className="flabel" style={{ fontSize: 10.5 }}>Catálogo de</label>
          <select className="fi" style={{ width: '100%', fontSize: 12 }} value={companyId || ''}
            disabled={!!empresaFija}
            title={empresaFija ? 'El ámbito lo fija el selector de arriba de la pantalla.' : undefined}
            onChange={e => { setAmbito(e.target.value); setMarcados({}); setFamSel('todas'); setLeido(null); setDiff(null); }}>
            {!empresaFija && <option value="">📚 General del grupo</option>}
            {entidades.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{conCatalogo.get(c.id) ? ` · ${conCatalogo.get(c.id)} propios` : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ts)', flex: 1, minWidth: 260, lineHeight: 1.5 }}>
          {companyId
            ? <>Estás viendo lo de <strong>{etiquetaAmbito}</strong> más el catálogo general como base. Lo que corrijas acá queda <strong>solo para esta entidad</strong>: el general no se mueve.</>
            : <>Es la <strong>base común</strong> del programa. Cada empresa o consorcio puede tener después la suya, y la suya manda sobre ésta.</>}
        </div>
      </div>

      {/* ── Qué es esto ─────────────────────────────────────────── */}
      <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6 }}>
        Es la lista contra la que la app propone <strong>nombres, unidades y familias</strong> cuando
        das de alta un insumo o armas una orden. Sale de tu archivo{' '}
        <code>Categorizacion Simple.xlsx</code>, se puede volver a importar cuando lo corrijas
        —actualiza, no duplica— y lo que edites aquí a mano ya no lo pisa ninguna importación.
        <strong> Importar no categoriza nada por su cuenta:</strong> carga los nombres con la familia
        que tenga el archivo, tal cual. Lo que esté mal se corrige acá, y para eso están las casillas
        de la izquierda: marcas varias filas y les cambias la familia de una sola vez.
      </div>

      {/* ── Importar ────────────────────────────────────────────── */}
      <div className="card card-p">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={elegirArchivo}
            style={{ fontSize: 11.5 }} disabled={leyendo} />
          {leyendo && <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Leyendo el archivo…</span>}
          {!leido && !leyendo && (
            <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
              Se importa al catálogo de <strong>{etiquetaAmbito}</strong>. Elige el xlsx y te muestro qué cambiaría <strong>antes</strong> de escribir nada.
            </span>
          )}
        </div>

        {leido && resumen && (
          <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
              El archivo trae {leido.insumos.length} filas{leido.disgregacion.length
                ? ` y ${leido.disgregacion.length} equivalencias de disgregación` : ''}.
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, marginBottom: 8 }}>
              <span><strong style={{ color: 'var(--green)' }}>{resumen.altas}</strong> nuevos</span>
              <span><strong style={{ color: 'var(--amber)' }}>{resumen.cambios}</strong> con algo distinto</span>
              <span><strong>{resumen.iguales}</strong> ya estaban igual</span>
              {resumen.reactivar > 0 && <span><strong>{resumen.reactivar}</strong> vuelven a activarse</span>}
              {resumen.ausentes > 0 && (
                <span><strong style={{ color: 'var(--red)' }}>{resumen.ausentes}</strong> están cargados y el archivo ya no los trae</span>
              )}
            </div>

            {resumen.cambios > 0 && (
              <details style={{ fontSize: 11.5, marginBottom: 8 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--tm)' }}>Ver qué cambia en los {resumen.cambios}</summary>
                <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 6 }}>
                  {diff.cambios.slice(0, 200).map(c => (
                    <div key={c.norm} style={{ padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                      <strong>{c.nombre}</strong>{' '}
                      {c.difs.map(d => (
                        <span key={d.campo} style={{ color: 'var(--tm)' }}>
                          · {d.campo}: «{String(d.antes) || '—'}» → «{String(d.ahora) || '—'}»
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {leido.avisos.length > 0 && (
              <div className="card card-p" style={{ background: 'var(--amber-l)', fontSize: 11.5, marginBottom: 8 }}>
                {leido.avisos.slice(0, 12).map((a, i) => <div key={i}>⚠️ {a}</div>)}
                {leido.avisos.length > 12 && <div style={{ color: 'var(--tm)' }}>…y {leido.avisos.length - 12} avisos más.</div>}
              </div>
            )}

            {resumen.ausentes > 0 && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, marginBottom: 8, cursor: 'pointer' }}
                title="Nunca se borran: quedan desactivados y se pueden volver a activar reimportando.">
                <input type="checkbox" checked={desactivar} onChange={e => setDesactivar(e.target.checked)} />
                Desactivar los {resumen.ausentes} que el archivo ya no trae
                <span style={{ color: 'var(--tm)' }}>— déjalo sin marcar si importaste solo una parte de la hoja.</span>
              </label>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-amber btn-sm" onClick={aplicar} disabled={!resumen.hayCambios && !leido.disgregacion.length}>
                {resumen.hayCambios ? `Aplicar al catálogo de ${etiquetaAmbito}` : 'Nada que cambiar'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setLeido(null); setDiff(null); }}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Vacío ───────────────────────────────────────────────── */}
      {todas.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="package" size={40} color="var(--tm)" />
          <p>Todavía no hay catálogo cargado para {etiquetaAmbito}. Importa <code>Categorizacion Simple.xlsx</code> con el
            botón de arriba: son 444 insumos en 10 familias, 34 servicios y la disgregación del acero.</p>
        </div>
      ) : (
        <>
          {/* ── QUÉ ES CADA NÚMERO ──────────────────────────────────
              Sin esto, «484» y «723» son dos cifras que no cierran y parecen
              un error. Con esto son las dos mitades del mismo trabajo. */}
          <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6, borderLeft: '3px solid var(--blue)' }}>
            Esta es la <strong>única sección donde se clasifican los insumos y servicios</strong> de {etiquetaAmbito}.
            Tiene dos mitades y cada una cuenta cosas distintas:
            <div style={{ marginTop: 6, color: 'var(--tm)' }}>
              · <strong>{activas.length}</strong> insumos y servicios que la entidad tiene, cada uno con su clasificación
              (el <em>vocabulario</em>).<br />
              · <strong>{porReconocer.pendientes}</strong> formas de escribirlos que aparecen en las facturas y todavía no
              están pegadas a ninguno de esos {activas.length} (los <em>alias</em>).
              {porReconocer.total > 0 && <> Van {porReconocer.decididas} de {porReconocer.total} reconocidas.</>}
            </div>
            <div style={{ marginTop: 6, color: 'var(--tm)' }}>
              Nunca van a ser el mismo número: el mismo cemento se factura de cinco maneras distintas. Reconocer un
              nombre lo pega a un insumo que ya existe —o da de alta uno nuevo— y no se vuelve a preguntar.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className={`btn btn-sm ${vista === 'clasificaciones' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => setVista('clasificaciones')}>🗂 Clasificaciones y diccionario</button>
            <button className={`btn btn-sm ${vista === 'reconocer' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => setVista('reconocer')}>
              📥 Nombres de factura por reconocer ({porReconocer.pendientes})
            </button>
            {/* La cuarta vista (tanda 5): lo que la app aprendió sola, en una
                sola lista que se puede filtrar y revisar en bloque. Ver el
                encabezado de jx-auditoria-diccionario.jsx. */}
            <button className={`btn btn-sm ${vista === 'auditoria' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => setVista('auditoria')}>
              🔍 Auditoría del diccionario ({terminosPropios.length})
            </button>
          </div>

          {vista === 'auditoria' && (
            <PanelAuditoriaDiccionario
              terminos={terHook.data || []}
              opciones={opcionesClasificacion}
              esPrueba={esPrueba}
              userId={userId}
              showToast={showToast}
              refrescar={async () => { await terHook.refresh?.(); }}
            />
          )}

          {vista === 'reconocer' && (
            <BandejaCategorizacionTab
              compras={compras} showToast={showToast}
              empresaFija={companyId || null} ambitoExterno
            />
          )}

          {vista === 'clasificaciones' && (
            <PanelClasificaciones
              activas={activas}
              propias={clasHook.data || []}
              terminos={terHook.data || []}
              revision={revision}
              companyId={companyId}
              userId={userId}
              equivalencias={equivalencias}
              decisiones={decHook.data || []}
              insumosCrudos={crudo}
              opciones={opcionesClasificacion}
              listId={listId}
              corregir={corregirLote}
              marcados={marcados}
              setMarcados={setMarcados}
              showToast={showToast}
              refrescar={async () => { await Promise.all([refrescar?.(), clasHook.refresh?.(), terHook.refresh?.(), decHook.refresh?.()]); }}
            />
          )}

        </>
      )}

      {/* ── Equivalencias de categorías de esta entidad ─────────── */}
      {companyId && propias.length > 0 && (
        <div className="card card-p">
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
            Categorías propias de {etiquetaAmbito}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ts)', marginBottom: 8, lineHeight: 1.55 }}>
            Estas categorías no son de las del grupo. Dile a cuál equivalen y se hace el match con las
            demás empresas: lo que aquí se llama de una forma y en otra empresa de otra pasa a ser la
            misma cosa. Solo se pregunta por éstas — las que ya usan el vocabulario del grupo
            coinciden solas y no dan trabajo.
          </div>
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <tbody>
              {propias.map(f => (
                <tr key={f.familia_local}>
                  <td><strong>{f.familia_local}</strong> <span style={{ color: 'var(--tm)' }}>· {f.n} {f.n === 1 ? 'insumo' : 'insumos'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {f.decision === 'mapeada'
                      ? <span className="badge b-green" style={{ fontSize: 9 }}>= {etiquetaFamilia(f.familia_canonica)}</span>
                      : f.decision === 'propia'
                        ? <span className="badge b-gray" style={{ fontSize: 9 }}>propia, no equivale a ninguna</span>
                        : <span className="badge b-amber" style={{ fontSize: 9 }}>sin decidir</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <SelectorClasificacion
                      listId={listId}
                      opciones={opcionesClasificacion}
                      value={eqElegida[f.familia_local] || ''}
                      onChange={cod => setEqElegida(p => ({ ...p, [f.familia_local]: cod }))}
                      permitirVacio
                      placeholder="— equivale a —"
                      style={{ fontSize: 11, width: 190 }}
                    />
                    <button className="btn btn-xs btn-amber" style={{ marginLeft: 4 }}
                      disabled={!eqElegida[f.familia_local]}
                      onClick={() => guardarEquivalencia(f.familia_local, 'mapeada')}>Guardar</button>
                    <button className="btn btn-xs btn-ghost" style={{ marginLeft: 4 }}
                      onClick={() => guardarEquivalencia(f.familia_local, 'propia')}>Es propia</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── La matriz del grupo ─────────────────────────────────── */}
      {matriz.filas.length > 0 && (
        <div className="card card-p">
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Cómo le dice cada uno a lo mismo</div>
          <div style={{ fontSize: 11.5, color: 'var(--ts)', marginBottom: 8, lineHeight: 1.55 }}>
            Por cada categoría del grupo, con qué nombre la maneja cada entidad. Es la correlación que
            deja comparar lo que compró una con lo que compró otra.
          </div>
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <thead>
              <tr><th>Categoría del grupo</th><th>Insumos</th><th>Quién la usa, y cómo la llama</th></tr>
            </thead>
            <tbody>
              {matriz.filas.map(f => (
                <tr key={f.slug}>
                  <td><strong>{f.label}</strong></td>
                  <td style={{ fontFamily: 'monospace' }}>{f.n}</td>
                  <td>
                    {[...f.entidades.entries()].map(([cid, locales]) => (
                      <span key={String(cid)} style={{ marginRight: 10, color: 'var(--ts)' }}>
                        {cid ? (nombreDe.get(cid) || 'entidad') : 'General'}
                        {locales.some(l => !esFamiliaCanonica(l)) && <span style={{ color: 'var(--tm)' }}> («{locales.filter(l => !esFamiliaCanonica(l)).join('», «')}»)</span>}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {matriz.sinMapear.length > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 8 }}>
              ◆ {matriz.sinMapear.length} {matriz.sinMapear.length === 1 ? 'categoría propia todavía no equivale' : 'categorías propias todavía no equivalen'} a
              ninguna del grupo — entra al catálogo de esa entidad para decidirlo.
            </div>
          )}
        </div>
      )}

      {/* ── Disgregación ────────────────────────────────────────── */}
      {disgregacion.length > 0 && (
        <div className="card card-p">
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Disgregación</div>
          <div style={{ fontSize: 11.5, color: 'var(--ts)', marginBottom: 8, lineHeight: 1.55 }}>
            Lo que el presupuesto pide en una unidad y el mercado vende en otra. El factor sale de la
            norma o del propio nombre; si dice <span className="badge b-amber" style={{ fontSize: 8.5 }}>supuesto</span> o
            está vacío, escríbelo tú — lo tuyo manda y no se vuelve a proponer.
          </div>
          {disgregacion.map(g => (
            <div key={g.nombre} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, marginBottom: 4 }}>
                <strong>{g.nombre}</strong> <span style={{ color: 'var(--tm)' }}>se pide en {g.unidad || '—'} y se compra como:</span>
              </div>
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <tbody>
                  {g.hijos.map(d => (
                    <tr key={d.id}>
                      <td>{d.hijo_nombre}</td>
                      <td style={{ fontFamily: 'monospace' }}>{d.hijo_unidad || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {d.factor != null
                          ? <>1 {d.hijo_unidad || 'und'} = <strong>{num(d.factor)}</strong> {g.unidad}</>
                          : <span style={{ color: 'var(--red)' }}>sin factor</span>}
                        {d.factor_fuente && ETIQUETA_FACTOR[d.factor_fuente] && (
                          <span className={`badge ${ETIQUETA_FACTOR[d.factor_fuente].color}`} style={{ fontSize: 8.5, marginLeft: 6 }}>
                            {ETIQUETA_FACTOR[d.factor_fuente].txt}
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--tm)', fontSize: 11 }}>{d.nota || ''}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input className="fi" type="number" step="0.001" style={{ width: 90, fontSize: 11 }}
                          placeholder={d.factor != null ? num(d.factor) : 'factor'}
                          value={factorEdit[d.id] ?? ''}
                          onChange={e => setFactorEdit(p => ({ ...p, [d.id]: e.target.value }))} />
                        {factorEdit[d.id] != null && factorEdit[d.id] !== '' && (
                          <button className="btn btn-xs btn-amber" style={{ marginLeft: 4 }} onClick={() => guardarFactor(d)}>Guardar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// EL PANEL DE CLASIFICACIONES Y SU DICCIONARIO (pedido de Gabriel, 13-set)
//
// «Catálogo debería tener la clasificación que tenemos junto al diccionario de
//  muestras de enlaces. Aquí podríamos crear nuevas clasificaciones y agregar
//  un diccionario de qué insumos irían a la nueva clasificación. Además
//  recuerda que tenemos clasificación de insumos y también quiero una de
//  servicios.»
//
// Los insumos del catálogo NO viven en una lista plana aparte: viven ADENTRO de
// su clasificación. Y las recomendaciones dejaron de ser un panel gigante
// arriba de todo —que era lo que no se entendía, y con 389 filas no se
// resolvía nunca— para ser, dentro de cada clasificación, «estos parecen ser
// de acá»: doce candidatos sí se despachan.
// ═══════════════════════════════════════════════════════════════════
/**
 * BUSCAR UN INSUMO SIN SABER SU CLASIFICACIÓN (tanda 9, 15-set-2026).
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────
 * Es lo ÚNICO que la pestaña «📋 Insumos y servicios» hacía y no se podía
 * hacer en ningún otro lado. Gabriel la pidió sacar dos veces —«esta pestaña
 * está por las puras, no hace nada»— y tenía razón en casi todo:
 *   · su panel de recomendaciones ya vive DENTRO de cada clasificación
 *     («estos N insumos parecen ser de acá»);
 *   · sus filtros por familia son la lista de la izquierda;
 *   · y su botón de desactivar no se usó NUNCA: medido el 15-set, 0 de 729
 *     insumos desactivados.
 * Lo que sí se perdía al borrarla era esto: encontrar un insumo por su nombre
 * cuando no se sabe en qué clasificación cayó, y corregirlo ahí mismo. Por eso
 * la pestaña se fue y su única función propia se quedó, en el lugar donde la
 * pregunta se hace.
 *
 * Ocupa el panel derecho mientras no hay ninguna clasificación elegida — que
 * antes decía «elegí una de la izquierda» y no hacía nada más.
 */
function BuscadorInsumos({ activas, opciones, listId, revision, marcados, setMarcados, corregir, onIrA, equivalencias }) {
  const [q, setQ] = uS('');
  const [soloDudosos, setSoloDudosos] = uS(false);
  const [famLote, setFamLote] = uS('');
  const [uniLote, setUniLote] = uS('');

  const recPorId = uM(
    () => new Map((revision?.recomendaciones || []).map(r => [r.id, r])),
    [revision],
  );

  // Buscar por PALABRAS sueltas y en cualquier orden: «tubo 2» tiene que
  // encontrar «TUBO PVC-U 2" C-7.5». Un `includes` de la frase entera no lo
  // hace, y es exactamente cómo se busca un insumo cuando no se recuerda el
  // nombre completo (que es siempre).
  const toks = uM(() => normIUPC(q).split(' ').filter(Boolean), [q]);
  const resultados = uM(() => {
    if (!toks.length && !soloDudosos) return [];
    return (activas || [])
      .filter(r => !soloDudosos || recPorId.has(r.id))
      .filter(r => {
        if (!toks.length) return true;
        const n = normIUPC(r.nombre);
        return toks.every(t => n.includes(t));
      })
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'))
      .slice(0, 120);
  }, [activas, toks, soloDudosos, recPorId]);

  const ids = uM(() => Object.keys(marcados || {}).filter(k => marcados[k]), [marcados]);

  // «Aceptar la del estándar» NO es un lote a una misma clasificación: a cada
  // insumo le corresponde la SUYA. Se despacha de a una porque `corregir`
  // trabaja sobre lo marcado, y marcar de a uno es la única forma de que cada
  // fila termine donde el estándar dijo para ella.
  const corregirCadaUnaALaSuya = async (lista) => {
    for (const id of lista) {
      const rec = recPorId.get(id);
      if (!rec?.familiaSugerida) continue;
      setMarcados?.({ [id]: true });
      // eslint-disable-next-line no-await-in-loop
      await corregir({ familia: rec.familiaSugerida, revisado: true });
    }
    setMarcados?.({});
  };
  const togglear = (id) => setMarcados?.(p => {
    const n = { ...p };
    if (n[id]) delete n[id]; else n[id] = true;
    return n;
  });

  const nDudosos = revision?.recomendaciones?.length || 0;

  return (
    <div className="card card-p" style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>🔎 Buscar un insumo o servicio</div>
      <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
        Para cuando no sabés en qué clasificación quedó. Escribí parte del nombre — las palabras pueden ir
        en cualquier orden — y corregí su clasificación o su unidad acá mismo. O elegí una clasificación de la
        izquierda para ver su diccionario y todo lo que tiene adentro.
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="fi" style={{ flex: 1, minWidth: 200, fontSize: 12 }}
          placeholder="cemento, tubo 2, guante…" value={q} onChange={e => setQ(e.target.value)} />
        {nDudosos > 0 && (
          <label style={{ fontSize: 11, color: 'var(--ts)', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
            title="Los que el estándar IUPC clasificaría distinto de como están hoy.">
            <input type="checkbox" checked={soloDudosos} onChange={e => setSoloDudosos(e.target.checked)} />
            ⚠ Solo los que parecen mal clasificados ({nDudosos})
          </label>
        )}
      </div>

      {/* 🔴 EL LOTE SE DESPACHA POR BANDA DE CONFIANZA, Y NO HAY «MARCAR TODAS».
          Es una decisión de producto de Gabriel (regla 8 del CLAUDE.md):
          reclasificar 450 insumos de un click con un clasificador que a veces
          se equivoca es exactamente lo que no se quiere. Vivía en la pestaña
          «Insumos y servicios»; se mudó acá con ella, porque sacar la pestaña
          no era motivo para perder la forma de despachar. */}
      {soloDudosos && nDudosos > 0 && corregir && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5 }}>
          <span style={{ color: 'var(--tm)' }}>Marcar por confianza:</span>
          {BANDAS_LOTE.map(([slug, etiqueta]) => {
            const dela = (revision?.recomendaciones || []).filter(r => r.banda === slug);
            if (!dela.length) return null;
            return (
              <button key={slug} className="btn btn-xs btn-ghost"
                onClick={() => setMarcados?.(p2 => {
                  const n2 = { ...p2 };
                  for (const r of dela) n2[r.id] = true;
                  return n2;
                })}>
                Marcar las {dela.length} de {etiqueta}
              </button>
            );
          })}
          <button className="btn btn-xs btn-ghost" title="Están bien donde están: no vuelven a proponerse."
            onClick={() => {
              const todos = (revision?.recomendaciones || []).map(r => r.id);
              if (todos.length) { setMarcados?.(Object.fromEntries(todos.map(i => [i, true]))); corregir({ revisado: true }); }
            }}>
            Están bien así
          </button>
        </div>
      )}

      {ids.length > 0 && corregir && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '6px 8px', background: 'var(--tint-neutral)', borderRadius: 6 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600 }}>{ids.length} marcado{ids.length === 1 ? '' : 's'}:</span>
          <SelectorClasificacion listId={listId} opciones={opciones} value={famLote} onChange={setFamLote}
            placeholder="mandarlos a…" style={{ fontSize: 11, height: 24, width: 190 }} />
          <button className="btn btn-xs btn-amber" disabled={!famLote}
            onClick={() => { corregir({ familia: famLote, revisado: true }); setFamLote(''); }}>
            Cambiar clasificación
          </button>
          <input className="fi" style={{ width: 90, fontSize: 11, height: 24 }} placeholder="unidad"
            value={uniLote} onChange={e => setUniLote(e.target.value)} />
          <button className="btn btn-xs btn-amber" disabled={!uniLote.trim()}
            onClick={() => { corregir({ unidad: uniLote.trim() }); setUniLote(''); }}>
            Cambiar unidad
          </button>
          {ids.some(i => recPorId.has(i)) && (
            <button className="btn btn-xs btn-green"
              title="A cada una, la clasificación que propone el estándar para ELLA (no todas a la misma)."
              onClick={() => corregirCadaUnaALaSuya(ids)}>
              Aceptar la del estándar en cada una
            </button>
          )}
          <button className="btn btn-xs btn-ghost" onClick={() => setMarcados?.({})}>Desmarcar</button>
        </div>
      )}

      {!toks.length && !soloDudosos ? (
        <div style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic' }}>
          Escribí algo para buscar entre los {activas.length} insumos y servicios de la entidad.
        </div>
      ) : resultados.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic' }}>
          Ningún insumo coincide con «{q.trim()}».
        </div>
      ) : (
        <div style={{ maxHeight: 460, overflowY: 'auto' }}>
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <tbody>
              {resultados.map(r => {
                const rec = recPorId.get(r.id);
                return (
                  <tr key={r.id}>
                    <td style={{ width: 24 }}>
                      <input type="checkbox" checked={!!marcados?.[r.id]} onChange={() => togglear(r.id)} />
                    </td>
                    <td>
                      {r.nombre}
                      {/* El aviso de la vieja pestaña, en el único lugar donde
                          ahora se puede encontrar el insumo por su nombre. */}
                      {rec && (
                        <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 1 }}>
                          ⚠ el estándar diría {etiquetaCategoria(rec.familiaSugerida)} ({Math.round((rec.score || 0) * 100)}%)
                          {corregir && (
                            <button className="btn btn-xs btn-ghost" style={{ marginLeft: 4, padding: '0 4px', minWidth: 0 }}
                              onClick={() => { setMarcados?.({ [r.id]: true }); corregir({ familia: rec.familiaSugerida, revisado: true }); }}>
                              cambiar
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ fontFamily: 'monospace', color: 'var(--tm)', whiteSpace: 'nowrap' }}>{r.unidad || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-xs btn-ghost" title="Ver esta clasificación"
                        onClick={() => onIrA?.(r.familia)}>
                        {etiquetaCategoria(r.familia)}
                      </button>
                    </td>
                    <td style={{ color: 'var(--tm)' }}>{categoriaItemDe(r, equivalencias)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {resultados.length >= 120 && (
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>
              Se muestran los primeros 120 — afiná la búsqueda.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PanelClasificaciones({ activas, propias, terminos, revision, companyId, userId, equivalencias, decisiones = [], insumosCrudos = null, opciones = [], listId = null, corregir = null, marcados = {}, setMarcados = null, showToast, refrescar }) {
  const [arbol, setArbol] = uS('insumo');
  const [sel, setSel] = uS(null);
  const [busca, setBusca] = uS('');
  // Buscar TAMBIÉN por el diccionario (tanda 8). Apagada por defecto y a
  // pedido: «quisiera un pequeño check a marcar puesto que solo lo requeriría
  // en ciertas circunstancias» — ver el encabezado de buscar-clasificacion.js.
  const [enDicc, setEnDicc] = uS(false);
  const [nuevoTermino, setNuevoTermino] = uS('');
  const [creando, setCreando] = uS(null);
  // La baja/fusión de una clasificación propia: { codigo, hacia } mientras se
  // decide. El plan se recalcula en cada render — nunca se escribe sin verlo.
  const [baja, setBaja] = uS(null);
  const enCursoRef = uR(false);

  const todasCats = uM(() => listarCategoriasDisponibles(propias), [propias]);

  // Cuántos insumos del catálogo caen hoy en cada clasificación.
  const porCodigo = uM(() => {
    const m = new Map();
    for (const r of activas) {
      const k = r.familia || 'sin_clasificar';
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  }, [activas]);

  // El diccionario completo de cada clasificación, calculado UNA vez: la tabla
  // de la izquierda lo pide para cada fila y son 90+ filas.
  const diccPorCodigo = uM(() => {
    const m = new Map();
    for (const c of todasCats) m.set(c.codigo, terminosDeClasificacion(c.codigo, terminos));
    return m;
  }, [todasCats, terminos]);

  // Las recomendaciones, agrupadas por el destino que proponen.
  const candidatosPorCodigo = uM(() => {
    const m = new Map();
    for (const r of (revision?.recomendaciones || [])) {
      if (!m.has(r.familiaSugerida)) m.set(r.familiaSugerida, []);
      m.get(r.familiaSugerida).push(r);
    }
    return m;
  }, [revision]);

  // Las del árbol elegido. Las complementarias («servicios en general»,
  // «administrativos») viven del lado de los insumos, como en el resto de la app.
  const delArbol = uM(
    () => todasCats.filter(c => (c.arbol === arbol) || (arbol === 'insumo' && c.arbol === 'complementaria')),
    [todasCats, arbol],
  );

  const visibles = uM(
    () => buscarClasificaciones({ q: busca, cats: delArbol, diccPorCodigo, enDiccionario: enDicc }),
    [delArbol, busca, diccPorCodigo, enDicc],
  );

  // EL EMPUJÓN: «clavos» no nombra ninguna clasificación pero está en el
  // diccionario de 3. Sin esto la lista queda vacía y no dice por qué — que es
  // exactamente lo que le pasó a Gabriel el 15-set.
  const nEnDicc = uM(
    () => (enDicc ? 0 : cuantasEnDiccionario({ q: busca, cats: delArbol, diccPorCodigo })),
    [enDicc, busca, delArbol, diccPorCodigo],
  );

  // Dos propias que se llaman casi igual: el síntoma de haberle aceptado a la
  // IA la misma clasificación nueva tres veces. Se avisa y se ofrece fusionar.
  const paresParecidos = uM(() => parecidasEntreSi(delArbol), [delArbol]);

  const cat = uM(() => todasCats.find(c => c.codigo === sel) || null, [todasCats, sel]);
  const dicc = cat ? (diccPorCodigo.get(cat.codigo) || []) : [];
  const insumosDe = cat ? (porCodigo.get(cat.codigo) || []) : [];
  const candidatosDe = cat ? (candidatosPorCodigo.get(cat.codigo) || []) : [];

  // Un término no puede estar en dos clasificaciones a la vez: si ya está, se
  // dice dónde, en vez de crear un duplicado que después pelea consigo mismo.
  const yaEnBase = (norm) => {
    for (const [cod, lista] of diccPorCodigo.entries()) {
      if (lista.some(t => normIUPC(t.termino) === norm)) return etiquetaCategoria(cod);
    }
    return null;
  };

  const conGuard = (fn) => async (...a) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try { await fn(...a); } catch (e) { showToast?.('No se pudo: ' + (e?.message || e), 'error'); }
    finally { enCursoRef.current = false; }
  };

  const addTermino = conGuard(async () => {
    if (!cat || !nuevoTermino.trim()) return;
    const r = await agregarTermino(
      { termino: nuevoTermino, clasificacionCodigo: cat.codigo, companyId },
      { userId, yaEnBase });
    if (!r.ok) { showToast?.(r.motivo, 'error'); return; }
    setNuevoTermino('');
    await refrescar();
    showToast?.(`✓ «${r.fila.termino}» agregado al diccionario de ${etiquetaCategoria(cat.codigo)}`, 'green');
  });

  const delTermino = conGuard(async (t) => {
    if (!t.id) return;
    await quitarTermino(t.id, { userId });
    await refrescar();
    showToast?.(`«${t.termino}» sacado del diccionario`, 'green');
  });

  const traerAca = conGuard(async (r) => {
    await corregirEnLote([r.id], { familia: cat.codigo }, { userId });
    await enseñarDiccionario({ descripcion: r.nombre, clasificacionCodigo: cat.codigo, companyId }, { userId });
    await refrescar();
    showToast?.(`✓ «${r.nombre}» pasó a ${etiquetaCategoria(cat.codigo)}`, 'green');
  });

  const guardarNueva = conGuard(async () => {
    const err = validarClasificacion(creando, propias);
    if (err) { showToast?.(err, 'error'); return; }
    const cod = creando.codigo;
    await crearClasificacion({ ...creando, companyId }, { userId });
    setCreando(null);
    await refrescar();
    setSel(cod);
    showToast?.(`✓ Clasificación «${cod}» creada. Agregale términos al diccionario.`, 'green');
  });

  // ── ELIMINAR Y FUSIONAR (tanda 8) ───────────────────────────────
  //
  // «Desactivar» era la única salida y dejaba los insumos apuntando a un
  // código muerto: la pantalla los mostraba como «sin clasificar» y el error
  // no se podía deshacer. Ahora hay dos caminos honestos, y la pantalla dice
  // CUÁL corresponde antes de tocar nada:
  //   · la creada por error, que no usa nadie → se borra y listo;
  //   · la que ya tiene contenido → hay que decir a dónde se va ese contenido,
  //     y eso es la MISMA operación que fusionar dos que quedaron repetidas.
  //
  // Los planes se calculan sobre el catálogo CRUDO (todas las entidades) y no
  // sobre el del ámbito actual: la clasificación desaparece para todos, así que
  // una fila de otra empresa que la use tiene que mudarse igual. Dejarla
  // apuntando a un código borrado es justo el bug que esto viene a cerrar.
  const insumosParaPlan = insumosCrudos || activas;

  const planDeBaja = uM(
    () => (baja?.codigo
      ? planBaja({ codigo: baja.codigo, cats: todasCats, insumos: insumosParaPlan, terminos, decisiones })
      : null),
    [baja, todasCats, insumosParaPlan, terminos, decisiones],
  );

  const planDeFusion = uM(
    () => ((baja?.codigo && baja?.hacia)
      ? planFusion({ desde: baja.codigo, hacia: baja.hacia, cats: todasCats, insumos: insumosParaPlan, terminos, decisiones })
      : null),
    [baja, todasCats, insumosParaPlan, terminos, decisiones],
  );

  const borrarVacia = conGuard(async () => {
    const fila = (propias || []).find(c => c.codigo === baja?.codigo && !c.deleted_at);
    if (!fila || !planDeBaja?.vacia) return;
    if (typeof confirm === 'function'
      && !confirm(`Se elimina «${planDeBaja.cat.nombre}». No la usa nada todavía, así que no se mueve ningún insumo.\n\n¿Seguir?`)) return;
    await eliminarClasificacion(fila.id, { userId });
    if (sel === baja.codigo) setSel(null);
    setBaja(null);
    await refrescar();
    showToast?.(`«${planDeBaja.cat.nombre}» eliminada.`, 'green');
  });

  const fusionar = conGuard(async () => {
    const plan = planDeFusion;
    if (!plan?.ok) { if (plan?.error) showToast?.(plan.error, 'error'); return; }
    if (typeof confirm === 'function' && !confirm(
      `Todo lo de «${plan.desde.nombre}» pasa a «${plan.hacia.nombre}» y la primera se elimina.\n\n`
      + (plan.resumen.length ? `${plan.resumen.join('\n')}\n\n` : '')
      + '¿Seguir?')) return;
    const hecho = await aplicarFusion(plan, { userId });
    if (sel === plan.desde.codigo) setSel(plan.hacia.codigo);
    setBaja(null);
    await refrescar();
    showToast?.(`✓ «${plan.desde.nombre}» se fusionó con «${plan.hacia.nombre}»`
      + (hecho?.insumos ? ` · ${hecho.insumos} ${hecho.insumos === 1 ? 'insumo movido' : 'insumos movidos'}` : ''), 'green');
  });

  // Las tres capas, cada una con su cartelito (tanda 1): la LEY (INEI / base de
  // servicios) no se toca; lo que escribiste a mano manda sobre ella; lo que
  // aprendió de una decisión —o peor, de un recorrido con IA— es provisional y
  // tiene que verse como tal, porque es justo lo que hay que auditar.
  const ORIGEN_BADGE = {
    inei: ['b-blue', 'INEI'], base: ['b-blue', 'base'],
    manual: ['b-green', 'tuyo'],
    decision: ['b-amber', 'aprendido'],
    ia: ['b-purple', 'de la IA'],
  };
  const ES_PROPIO = new Set(['manual', 'decision', 'ia']);
  const BADGE_BANDA_CAND = { alta: 'b-green', media: 'b-blue', baja: 'b-amber', rara: 'b-purple' };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6 }}>
        Ésta es <strong>la clasificación</strong> con la que trabaja toda la app, y el <strong>diccionario</strong>{' '}
        que la alimenta: los términos con los que cada cosa aparece escrita en las facturas. Lo que agregues acá
        es lo que después usa «Categorizar» para recomendar — y le <strong>gana</strong> a la base oficial, porque
        es una corrección deliberada sobre ella.
        <div style={{ marginTop: 4, color: 'var(--tm)' }}>
          La base oficial (los códigos del IUPC del INEI y el árbol de servicios) viene con la app y no se edita:
          es la norma. Lo que crees vos se suma encima y queda marcado{' '}
          <span className="badge b-green" style={{ fontSize: 9 }}>tuyo</span>.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn btn-sm ${arbol === 'insumo' ? 'btn-blue' : 'btn-ghost'}`}
          onClick={() => { setArbol('insumo'); setSel(null); }}>🧱 Insumos</button>
        <button className={`btn btn-sm ${arbol === 'servicio' ? 'btn-blue' : 'btn-ghost'}`}
          onClick={() => { setArbol('servicio'); setSel(null); }}>🛠 Servicios</button>
        <input className="fi" style={{ fontSize: 12, minWidth: 180, flex: 1 }}
          placeholder={enDicc ? 'Buscar por nombre o por una palabra de la factura…' : 'Buscar clasificación…'}
          value={busca} onChange={e => setBusca(e.target.value)} />
        <label style={{ fontSize: 11, color: 'var(--ts)', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
          title="Busca también adentro del diccionario: escribí «llave» y te dice en qué índice del IUPC cae, con el término de la norma que lo respalda.">
          <input type="checkbox" checked={enDicc} onChange={e => setEnDicc(e.target.checked)} />
          📖 Buscar en el diccionario
        </label>
        <button className="btn btn-amber btn-sm"
          onClick={() => setCreando({ codigo: '', nombre: '', arbol, gasto: '' })}>+ Nueva clasificación</button>
      </div>

      {/* EL EMPUJÓN. Sin esto, buscar «clavos» devolvía una lista vacía sin
          decir nunca que la palabra SÍ está — en el diccionario, no en el
          nombre. Es el reporte de Gabriel del 15-set. */}
      {nEnDicc > 0 && (
        <div className="card card-p" style={{ fontSize: 11.5, borderLeft: '3px solid var(--blue)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            «<strong>{busca.trim()}</strong>» no es el nombre de {visibles.length === 0 ? 'ninguna clasificación' : 'las que ves'}, pero está
            en el <strong>diccionario</strong> de {nEnDicc} {nEnDicc === 1 ? 'clasificación' : 'clasificaciones'}.
          </span>
          <button className="btn btn-xs btn-blue" onClick={() => setEnDicc(true)}>Buscar en el diccionario</button>
        </div>
      )}

      {/* Dos propias que se llaman casi igual. Pasa cuando se le acepta a la IA
          la misma clasificación nueva en dos filas distintas — el caso que
          Gabriel anticipó: «¿qué pasa si creo varias y podríamos convertirla
          en una?». Se avisa acá y se resuelve con la fusión de abajo. */}
      {paresParecidos.length > 0 && (
        <div className="card card-p" style={{ fontSize: 11.5, borderLeft: '3px solid var(--amber)' }}>
          ⚠ Hay {paresParecidos.length === 1 ? 'un par de clasificaciones tuyas que se llaman casi igual' : `${paresParecidos.length} pares de clasificaciones tuyas que se llaman casi igual`}:
          <div style={{ color: 'var(--tm)', marginTop: 3 }}>
            {paresParecidos.slice(0, 4).map((p, i) => (
              <div key={i}>
                «{p.a.nombre}» y «{p.b.nombre}»{' '}
                <button className="btn btn-xs btn-ghost"
                  onClick={() => { setSel(p.a.codigo); setBaja({ codigo: p.a.codigo, hacia: p.b.codigo }); }}>
                  Fusionar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {creando && (
        <div className="card card-p" style={{ borderLeft: '3px solid var(--amber)', display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
            Nueva clasificación de {creando.arbol === 'servicio' ? 'servicios' : 'insumos'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 2, minWidth: 190 }}>
              <label className="flabel" style={{ fontSize: 10.5 }}>Nombre</label>
              <input className="fi" style={{ width: '100%' }} value={creando.nombre} autoFocus
                onChange={e => setCreando(p => ({
                  ...p, nombre: e.target.value,
                  codigo: p.codigoTocado ? p.codigo : codigoSugerido(e.target.value, p.arbol),
                }))} />
            </div>
            <div style={{ flex: 1, minWidth: 130 }}>
              <label className="flabel" style={{ fontSize: 10.5 }}>Código</label>
              <input className="fi" style={{ width: '100%', fontFamily: 'monospace' }} value={creando.codigo}
                onChange={e => setCreando(p => ({ ...p, codigo: e.target.value.trim(), codigoTocado: true }))} />
            </div>
            <div style={{ flex: 1, minWidth: 150 }}>
              <label className="flabel" style={{ fontSize: 10.5 }}>Cómo lo agrupa contabilidad</label>
              <select className="fi" style={{ width: '100%' }} value={creando.gasto}
                onChange={e => setCreando(p => ({ ...p, gasto: e.target.value }))}>
                <option value="">— según el árbol —</option>
                {['materiales', 'herramientas', 'maquinaria', 'epp', 'servicios', 'gastos_generales', 'otros']
                  .map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>
            El código es con lo que se guarda cada insumo. No puede pisar uno de la base oficial
            (01…95 del IUPC, S01…S13 de servicios) — por eso se propone con prefijo.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setCreando(null)}>Cancelar</button>
            <button className="btn btn-amber btn-sm" onClick={guardarNueva}>Crear</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="card card-p" style={{ flex: '1 1 320px', minWidth: 290, maxHeight: 620, overflowY: 'auto' }}>
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 6 }}>
            {visibles.length} clasificaciones · {arbol === 'insumo' ? 'IUPC del Estado + complementarias' : 'árbol de servicios'}
            {enDicc && busca.trim() && <> · buscando también en el <strong>diccionario</strong></>}
          </div>
          {visibles.length === 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic' }}>
              Ninguna clasificación coincide con «{busca.trim()}».
              {!enDicc && ' Probá marcar «📖 Buscar en el diccionario»: la palabra puede estar adentro de la norma sin ser el nombre del índice.'}
            </div>
          )}
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <tbody>
              {visibles.map(c => {
                const n = (porCodigo.get(c.codigo) || []).length;
                const nd = (diccPorCodigo.get(c.codigo) || []).length;
                const nc = (candidatosPorCodigo.get(c.codigo) || []).length;
                return (
                  <tr key={c.codigo} onClick={() => setSel(c.codigo)}
                    style={{ cursor: 'pointer', background: sel === c.codigo ? 'var(--bg-c2)' : undefined }}>
                    <td style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{c.codigo}</td>
                    <td>
                      {c.nombre}
                      {c.propia && <span className="badge b-green" style={{ marginLeft: 4, fontSize: 8.5 }}>tuyo</span>}
                      {/* POR QUÉ SALIÓ ESTA FILA. Cuando la búsqueda entró por
                          el diccionario, el nombre no explica nada: lo que la
                          trajo fue «Clavo de calamina», y eso es exactamente lo
                          que se está yendo a buscar («guiarme de la ley»). */}
                      {c.terminos?.length > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--tm)', marginTop: 1 }}>
                          📖 {c.terminos.map(t => t.termino).join(' · ')}
                          {c.nCoincidencias > c.terminos.length ? ` +${c.nCoincidencias - c.terminos.length}` : ''}
                        </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', color: 'var(--tm)' }}>
                      {n > 0 && <span title="insumos del catálogo acá adentro">{n} 📦</span>}
                      {nd > 0 && <span style={{ marginLeft: 6 }} title="términos en su diccionario">{nd} 📖</span>}
                      {nc > 0 && (
                        <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 8.5 }}
                          title="candidatos que parecen ser de acá">+{nc}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ flex: '2 1 400px', minWidth: 300, display: 'grid', gap: 10 }}>
          {!cat ? (
            <BuscadorInsumos
              activas={activas} opciones={opciones} listId={listId}
              revision={revision} marcados={marcados} setMarcados={setMarcados}
              corregir={corregir} onIrA={setSel} equivalencias={equivalencias}
            />
          ) : (
            <>
              <div className="card card-p">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>{etiquetaCategoria(cat.codigo)}</div>
                  {cat.propia && (
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button className="btn btn-xs btn-ghost"
                        onClick={() => setBaja(b => (b?.codigo === cat.codigo ? null : { codigo: cat.codigo, hacia: '' }))}>
                        Eliminar o fusionar
                      </button>
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
                  Va a <strong>{TIPO_DESTINO[cat.tipo] || cat.tipo}</strong> · contabilidad la agrupa
                  como <strong>{cat.gasto || (cat.arbol === 'servicio' ? 'servicios' : '—')}</strong>
                </div>

                {/* LA BAJA, CON SU PLAN A LA VISTA. Nunca se borra a ciegas:
                    primero se dice qué apunta a esta clasificación y a dónde va
                    a parar. Si no la usa nadie, el botón de eliminar alcanza. */}
                {baja?.codigo === cat.codigo && planDeBaja && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    {!planDeBaja.ok ? (
                      <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>{planDeBaja.error}</div>
                    ) : planDeBaja.vacia ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5 }}>
                        <span>No la usa nada todavía: se puede eliminar sin mover nada.</span>
                        <button className="btn btn-xs btn-red" onClick={borrarVacia}>Eliminar</button>
                        <button className="btn btn-xs btn-ghost" onClick={() => setBaja(null)}>Cancelar</button>
                      </div>
                    ) : (
                      <div style={{ display: 'grid', gap: 6, fontSize: 11.5 }}>
                        <div>
                          Esto lo usan{' '}
                          <strong>{planDeBaja.nInsumos}</strong> {planDeBaja.nInsumos === 1 ? 'insumo' : 'insumos'},{' '}
                          <strong>{planDeBaja.nTerminos}</strong> {planDeBaja.nTerminos === 1 ? 'término' : 'términos'} del diccionario y{' '}
                          <strong>{planDeBaja.nDecisiones}</strong> {planDeBaja.nDecisiones === 1 ? 'decisión ya tomada' : 'decisiones ya tomadas'}.
                          {' '}Para eliminarla hay que decir <strong>a dónde se van</strong>.
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ color: 'var(--tm)' }}>Mandar todo a:</span>
                          <select className="fi" style={{ fontSize: 11.5, maxWidth: 320 }} value={baja.hacia || ''}
                            onChange={e => setBaja(b => ({ ...b, hacia: e.target.value }))}>
                            <option value="">— elegí una clasificación —</option>
                            {delArbol.filter(c => c.codigo !== cat.codigo && c.codigo !== 'sin_clasificar')
                              .map(c => <option key={c.codigo} value={c.codigo}>{c.label}</option>)}
                          </select>
                          <button className="btn btn-xs btn-amber" disabled={!planDeFusion?.ok} onClick={fusionar}>
                            Fusionar y eliminar
                          </button>
                          <button className="btn btn-xs btn-ghost" onClick={() => setBaja(null)}>Cancelar</button>
                        </div>
                        {planDeFusion && !planDeFusion.ok && (
                          <div style={{ color: 'var(--amber)' }}>{planDeFusion.error}</div>
                        )}
                        {planDeFusion?.ok && planDeFusion.resumen.length > 0 && (
                          <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--tm)' }}>
                            {planDeFusion.resumen.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="card card-p">
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
                  📖 Diccionario ({dicc.length} {dicc.length === 1 ? 'término' : 'términos'})
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <input className="fi" style={{ flex: 1, fontSize: 12 }}
                    placeholder="Agregar término: cómo lo escriben en las facturas…"
                    value={nuevoTermino} onChange={e => setNuevoTermino(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addTermino(); }} />
                  <button className="btn btn-amber btn-sm" disabled={!nuevoTermino.trim()} onClick={addTermino}>Agregar</button>
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {dicc.length === 0 && (
                    <span style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic' }}>
                      Sin términos todavía. Agregá los nombres con los que aparece en las facturas y
                      «Categorizar» va a reconocerlo solo.
                    </span>
                  )}
                  {dicc.map((t, i) => {
                    const par = ORIGEN_BADGE[t.origen] || ['b-gray', t.origen];
                    return (
                      <span key={`${t.termino}-${i}`} className="badge b-gray"
                        style={{ fontSize: 11, padding: '3px 7px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {t.termino}
                        <span className={`badge ${par[0]}`} style={{ fontSize: 8 }}>{par[1]}</span>
                        {ES_PROPIO.has(t.origen) && (
                          <button className="btn btn-xs btn-ghost" style={{ padding: '0 3px', minWidth: 0 }}
                            title="Sacar del diccionario" onClick={() => delTermino(t)}>✕</button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>

              {candidatosDe.length > 0 && (
                <div className="card card-p" style={{ borderLeft: '3px solid var(--amber)' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                    {candidatosDe.length} {candidatosDe.length === 1 ? 'insumo parece ser' : 'insumos parecen ser'} de acá
                  </div>
                  <table className="tbl" style={{ fontSize: 11.5 }}>
                    <tbody>
                      {candidatosDe.slice(0, 40).map(r => (
                        <tr key={r.id}>
                          <td>{r.nombre}</td>
                          <td style={{ color: 'var(--tm)', whiteSpace: 'nowrap' }}>hoy en {etiquetaCategoria(r.familia)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <span className={`badge ${BADGE_BANDA_CAND[r.banda] || 'b-gray'}`}>
                              {Math.round(r.score * 100)}%
                            </span>
                          </td>
                          <td><button className="btn btn-xs btn-green" onClick={() => traerAca(r)}>Traer acá</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="card card-p">
                <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
                  📦 {insumosDe.length} {insumosDe.length === 1 ? 'insumo' : 'insumos'} en esta clasificación
                </div>
                {insumosDe.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic' }}>Todavía no hay ninguno acá.</div>
                ) : (
                  <table className="tbl" style={{ fontSize: 11.5 }}>
                    <tbody>
                      {insumosDe.slice(0, 60).map(r => (
                        <tr key={r.id}>
                          <td>{r.nombre}</td>
                          <td style={{ fontFamily: 'monospace', color: 'var(--tm)' }}>{r.unidad || '—'}</td>
                          <td style={{ color: 'var(--tm)' }}>{categoriaItemDe(r, equivalencias)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {insumosDe.length > 60 && (
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6 }}>
                    …y {insumosDe.length - 60} más. Para verlos todos y editarlos en lote, andá a «Lista completa».
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CatalogoCanonicoTab });
export { CatalogoCanonicoTab };
