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
  FAMILIAS_CATALOGO, familiasPropias, equivalenciasDe, matrizCategorias,
  entidadesConCatalogo,
} from "../lib/catalogo-canonico.js";
import {
  revisarCatalogo, etiquetaSubfamilia, sugerirSubfamilia, SUBFAMILIAS, SUBFAMILIAS_TECNICAS,
} from "../lib/catalogo-subfamilias.js";
import {
  previsualizarImportacion, aplicarImportacion, corregirFactor,
  corregirEnLote, adoptarEnEntidad, decidirEquivalencia,
  moverDeFamilia, descartarRecomendaciones, aceptarSubfamilias,
} from "../lib/catalogo-canonico-db.js";

const { useState: uS, useMemo: uM, useRef: uR } = React;
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

function CatalogoCanonicoTab({ showToast, empresaFija = null }) {
  const catHook = window.__hooks.useCatalogoInsumos();
  const disgHook = window.__hooks.useCatalogoDisgregacion();
  const eqHook = window.__hooks.useCatalogoFamiliaMapeo();
  const compHook = window.__hooks.useCompanies();
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
  const [subSel, setSubSel] = uS('todas');
  const [subLote, setSubLote] = uS('');
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

  // La revisión: qué subfamilia le toca a cada fila y cuáles parecen estar en
  // la familia equivocada. Se calcula al LEER —no se guarda nada hasta que
  // alguien acepta—, así que mejorar el vocabulario mejora todo el catálogo sin
  // migrar una fila.
  const revision = uM(() => revisarCatalogo(activas), [activas]);
  const subDe = uM(() => {
    const m = new Map();
    for (const r of activas) m.set(r.id, r.subfamilia || sugerirSubfamilia(r.nombre, r.familia)?.subfamilia || null);
    return m;
  }, [activas]);
  const subfamiliasPresentes = uM(
    () => [...revision.porSubfamilia.entries()].sort((a, b) => b[1] - a[1]),
    [revision.porSubfamilia],
  );
  const idsRec = uM(() => Object.keys(recMarcadas).filter(k => recMarcadas[k]), [recMarcadas]);

  const visibles = uM(() => {
    const q = busca.trim().toLowerCase();
    return (verInactivos ? todas : activas)
      .filter(r => famSel === 'todas' || r.familia === famSel)
      .filter(r => subSel === 'todas'
        || (subSel === '__sin__' ? !subDe.get(r.id) : subDe.get(r.id) === subSel))
      .filter(r => tipoSel === 'todos' || r.tipo === tipoSel)
      .filter(r => !q || String(r.nombre || '').toLowerCase().includes(q))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }, [todas, activas, verInactivos, famSel, subSel, subDe, tipoSel, busca]);

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
      const n = await moverDeFamilia(revision.recomendaciones.filter(r => recMarcadas[r.id]), { userId });
      await refrescar(); setRecMarcadas({});
      showToast?.(`${n} ${n === 1 ? 'insumo movido' : 'insumos movidos'} de familia.`, 'success');
    } catch (err) { showToast?.(`No se pudo mover: ${err?.message || err}`, 'error'); }
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

  const congelarSubfamilias = async () => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try {
      const n = await aceptarSubfamilias(revision.propuestas.filter(p => p.subfamilia && !p.familiaSugerida), { userId });
      await refrescar();
      showToast?.(`${n} subfamilias guardadas.`, 'success');
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
          {/* ── La revisión: lo que parece estar en otra familia ─ */}
          {revision.recomendaciones.length > 0 && (
            <div className="card card-p" style={{ borderLeft: '3px solid var(--amber)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>
                {revision.recomendaciones.length} {revision.recomendaciones.length === 1
                  ? 'insumo parece estar en otra familia' : 'insumos parecen estar en otra familia'}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ts)', marginBottom: 8, lineHeight: 1.55 }}>
                No son errores seguros: son propuestas. Solo se proponen cuando el nombre <em>empieza</em>{' '}
                diciendo otra cosa —si la pista está en un adjetivo del final no se pregunta, porque así
                un «pantalón con cinta reflectiva» terminaba en ferretería—. Lo que dejes donde está no
                se vuelve a proponer.
              </div>
              <table className="tbl" style={{ fontSize: 11.5 }}>
                <tbody>
                  {revision.recomendaciones.slice(0, 60).map(r => (
                    <tr key={r.id}>
                      <td style={{ width: 26 }}>
                        <input type="checkbox" checked={!!recMarcadas[r.id]}
                          onChange={e => setRecMarcadas(p => {
                            const n = { ...p };
                            if (e.target.checked) n[r.id] = true; else delete n[r.id];
                            return n;
                          })} />
                      </td>
                      <td>{r.nombre}</td>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--tm)' }}>
                        {etiquetaFamilia(r.familia)} → <strong style={{ color: 'var(--tp)' }}>{etiquetaFamilia(r.familiaSugerida)}</strong>
                      </td>
                      <td style={{ color: 'var(--tm)', fontSize: 11 }}>{r.motivo}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="btn btn-xs btn-ghost" onClick={() => descartarMovidas([r.id])}>Está bien así</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-amber btn-sm" disabled={!idsRec.length} onClick={aceptarMovidas}>
                  Mover {idsRec.length || ''} {idsRec.length === 1 ? 'insumo' : 'insumos'}
                </button>
                <button className="btn btn-ghost btn-sm" disabled={!idsRec.length}
                  onClick={() => descartarMovidas(idsRec)}>Dejar donde están</button>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setRecMarcadas(Object.fromEntries(revision.recomendaciones.map(r => [r.id, true])))}>
                  Marcar todas
                </button>
              </div>
            </div>
          )}

          {/* ── Familias ──────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`btn btn-xs ${famSel === 'todas' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => setFamSel('todas')}>Todas ({activas.length})</button>
            {familias.map(f => (
              <button key={f.slug} className={`btn btn-xs ${famSel === f.slug ? 'btn-amber' : 'btn-ghost'}`}
                onClick={() => setFamSel(f.slug)}
                title={f.propia ? 'Categoría propia de esta entidad: falta decir a cuál del grupo equivale.' : `Va a ${TIPO_DESTINO[f.tipo]}`}>
                {f.propia ? '◆ ' : ''}{f.label} ({f.n})
              </button>
            ))}
          </div>

          {/* ── Filtros ───────────────────────────────────────── */}
          <div className="card card-p" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 210 }}>
              <label className="flabel" style={{ fontSize: 10.5 }}>
                Subfamilia <span style={{ color: 'var(--tm)' }}>({subfamiliasPresentes.length} en uso)</span>
              </label>
              <select className="fi" style={{ width: '100%', fontSize: 12 }} value={subSel} onChange={e => setSubSel(e.target.value)}>
                <option value="todas">Todas</option>
                {subfamiliasPresentes.map(([k, n]) => (
                  <option key={k} value={k}>{etiquetaSubfamilia(k)} ({n})</option>
                ))}
                {revision.sinSubfamilia > 0 && <option value="__sin__">Sin subfamilia ({revision.sinSubfamilia})</option>}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="flabel" style={{ fontSize: 10.5 }}>Buscar</label>
              <input className="fi" style={{ width: '100%', fontSize: 12 }} value={busca}
                placeholder="nombre del insumo o servicio" onChange={e => setBusca(e.target.value)} />
            </div>
            <div>
              <label className="flabel" style={{ fontSize: 10.5 }}>Tipo</label>
              <select className="fi" style={{ fontSize: 12 }} value={tipoSel} onChange={e => setTipoSel(e.target.value)}>
                <option value="todos">Todo</option>
                <option value="insumo">Insumos</option>
                <option value="servicio">Servicios</option>
              </select>
            </div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} />
              Ver los desactivados{inactivas > 0 ? ` (${inactivas})` : ''}
            </label>
          </div>

          {/* ── Corregir en lote ──────────────────────────────── */}
          {idsMarcados.length > 0 && (
            <div className="card card-p" style={{ background: 'var(--amber-l)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, alignSelf: 'center' }}>
                {idsMarcados.length} {idsMarcados.length === 1 ? 'marcado' : 'marcados'}
              </div>
              <div>
                <label className="flabel" style={{ fontSize: 10.5 }}>Cambiar la familia a</label>
                <select className="fi" style={{ fontSize: 12 }} value={famLote} onChange={e => setFamLote(e.target.value)}>
                  <option value="">— elegir —</option>
                  {FAMILIAS_CATALOGO.map(f => <option key={f.slug} value={f.slug}>{f.label}</option>)}
                </select>
              </div>
              <button className="btn btn-amber btn-sm" disabled={!famLote} onClick={() => corregirLote({ familia: famLote })}>
                Aplicar familia
              </button>
              <div>
                <label className="flabel" style={{ fontSize: 10.5 }}>o la unidad a</label>
                <input className="fi" list="jx-unidades-cat" style={{ fontSize: 12, width: 110 }} value={uniLote}
                  placeholder="und, m, kg…" onChange={e => setUniLote(e.target.value)} />
                <datalist id="jx-unidades-cat">
                  {UNIDADES_SUGERIDAS.map(u => <option key={u} value={u} />)}
                </datalist>
              </div>
              <button className="btn btn-amber btn-sm" disabled={!uniLote.trim()} onClick={() => corregirLote({ unidad: uniLote.trim() })}>
                Aplicar unidad
              </button>
              <div>
                <label className="flabel" style={{ fontSize: 10.5 }}>o la subfamilia a</label>
                <select className="fi" style={{ fontSize: 12 }} value={subLote} onChange={e => setSubLote(e.target.value)}>
                  <option value="">— elegir —</option>
                  {[...SUBFAMILIAS.map(x => x.slug), ...Object.keys(SUBFAMILIAS_TECNICAS)]
                    .map(k => <option key={k} value={k}>{etiquetaSubfamilia(k)}</option>)}
                </select>
              </div>
              <button className="btn btn-amber btn-sm" disabled={!subLote} onClick={() => corregirLote({ subfamilia: subLote })}>
                Aplicar subfamilia
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => corregirLote({ activo: false })}>
                Desactivar
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setMarcados({})}>Desmarcar todo</button>
            </div>
          )}

          {revision.propuestas.some(p => p.subfamilia && !p.familiaSugerida) && (
            <div style={{ fontSize: 11.5, color: 'var(--ts)' }}>
              {revision.propuestas.filter(p => p.subfamilia && !p.familiaSugerida).length} subfamilias están
              PROPUESTAS (salen del nombre y se recalculan solas).{' '}
              <button className="btn btn-xs btn-ghost" onClick={congelarSubfamilias}>Confirmarlas todas</button>
            </div>
          )}

          {/* ── La lista ──────────────────────────────────────── */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input type="checkbox"
                      checked={visibles.length > 0 && visibles.slice(0, limite).every(r => marcados[r.id])}
                      onChange={e => {
                        const on = e.target.checked;
                        setMarcados(p => {
                          const n = { ...p };
                          for (const r of visibles.slice(0, limite)) { if (on) n[r.id] = true; else delete n[r.id]; }
                          return n;
                        });
                      }} />
                  </th>
                  <th>Nombre</th>
                  <th>Unidad</th>
                  <th>Familia</th>
                  <th title="El segundo nivel: dentro de la familia, qué clase de cosa es">Subfamilia</th>
                  <th title="A qué inventario iría si se da de alta">Va a</th>
                  <th title="Cómo lo agrupa contabilidad">Categoría de gasto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibles.slice(0, limite).map(r => {
                  const destino = tipoInsumoDe(r, equivalencias);
                  const propia = !esFamiliaCanonica(r.familia);
                  return (
                    <tr key={r.id} style={r.activo === false ? { opacity: 0.5 } : undefined}>
                      <td>
                        <input type="checkbox" checked={!!marcados[r.id]}
                          onChange={e => setMarcados(p => {
                            const n = { ...p };
                            if (e.target.checked) n[r.id] = true; else delete n[r.id];
                            return n;
                          })} />
                      </td>
                      <td>{r.nombre}</td>
                      <td style={{ fontFamily: 'monospace' }}>{r.unidad || '—'}</td>
                      <td title={propia ? 'Categoría propia de esta entidad' : undefined}>
                        {propia ? '◆ ' : ''}{etiquetaFamilia(r.familia)}
                      </td>
                      <td style={{ color: r.subfamilia ? undefined : 'var(--tm)' }}
                        title={r.subfamilia ? 'Confirmada' : 'Propuesta: se calcula del nombre y se puede cambiar.'}>
                        {subDe.get(r.id) ? etiquetaSubfamilia(subDe.get(r.id)) : '—'}
                        {!r.subfamilia && subDe.get(r.id) ? ' ·' : ''}
                      </td>
                      <td><span className={`badge ${BADGE_DESTINO[destino] || 'b-gray'}`} style={{ fontSize: 9 }}>{TIPO_DESTINO[destino] || destino}</span></td>
                      <td style={{ color: 'var(--tm)' }}>{categoriaItemDe(r, equivalencias)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {r.origen === 'manual' && <span className="badge b-blue" style={{ fontSize: 8.5 }} title="Editado a mano: la importación no lo pisa.">tuyo</span>}
                        {companyId && !r.company_id && <span className="badge b-gray" style={{ fontSize: 8.5 }} title="Viene del catálogo general del grupo.">del grupo</span>}
                        {r.activo === false && <span className="badge b-gray" style={{ fontSize: 8.5 }}>desactivado</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibles.length === 0 && (
              <div style={{ padding: 14, fontSize: 12, color: 'var(--tm)', fontStyle: 'italic' }}>
                Nada coincide con el filtro.
              </div>
            )}
            {visibles.length > limite && (
              <div style={{ padding: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setLimite(l => l + 200)}>
                  Ver más ({visibles.length - limite} restantes)
                </button>
              </div>
            )}
          </div>
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
                    <select className="fi" style={{ fontSize: 11 }} value={eqElegida[f.familia_local] || ''}
                      onChange={e => setEqElegida(p => ({ ...p, [f.familia_local]: e.target.value }))}>
                      <option value="">— equivale a —</option>
                      {FAMILIAS_CATALOGO.map(c => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                    </select>
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

Object.assign(window, { CatalogoCanonicoTab });
export { CatalogoCanonicoTab };
