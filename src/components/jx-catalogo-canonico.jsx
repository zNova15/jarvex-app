// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL CATÁLOGO (tanda 14, entrega 2). Pestaña de Análisis de Insumos,
// gate admin/gerente heredado del panel.
//
// Es la puerta de entrada del catálogo canónico: acá se importa
// «Categorizacion Simple.xlsx», se ve qué quedó cargado y se corrige lo que el
// archivo dejó mal. Sin esta pantalla el catálogo sería una tabla que nadie
// puede tocar.
//
// LA IMPORTACIÓN MUESTRA EL DIFF ANTES DE ESCRIBIR. Son ~480 filas de una
// sola pasada: si el archivo viene recortado o con una familia renombrada, hay
// que poder verlo ANTES y no después. Por eso el botón que importa no escribe:
// calcula. El que escribe es el segundo, y dice exactamente cuántas altas,
// cuántos cambios y cuántas desapariciones va a aplicar.
//
// LO QUE FALTA NO SE BORRA. Un insumo que salió del archivo puede estar mapeado
// contra el presupuesto o ser el nombre de una línea de una orden ya emitida.
// Se DESACTIVA, y solo si se marca la casilla: importar media hoja no puede
// apagar la otra media en silencio.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { parseExcelFile } from "../lib/excel.js";
import {
  parseCatalogoXlsx, resolverCatalogo, resumenDiff, contarPorFamilia,
  etiquetaFamilia, tipoInsumoDe, categoriaItemDe,
} from "../lib/catalogo-canonico.js";
import {
  previsualizarImportacion, aplicarImportacion, corregirFactor,
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

const num = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 3 });

function CatalogoCanonicoTab({ showToast }) {
  const catHook = window.__hooks.useCatalogoInsumos();
  const disgHook = window.__hooks.useCatalogoDisgregacion();
  const auth = window.__useAuth ? window.__useAuth() : {};
  const userId = auth?.profile?.id || null;

  const [busca, setBusca] = uS('');
  const [famSel, setFamSel] = uS('todas');
  const [tipoSel, setTipoSel] = uS('todos');
  const [verInactivos, setVerInactivos] = uS(false);
  const [limite, setLimite] = uS(80);
  const [leido, setLeido] = uS(null);        // { insumos, disgregacion, avisos, ... }
  const [diff, setDiff] = uS(null);
  const [desactivar, setDesactivar] = uS(false);
  const [leyendo, setLeyendo] = uS(false);
  const [factorEdit, setFactorEdit] = uS({});
  // Anti doble-click (regla crítica de la casa): ref SÍNCRONO. Un doble tap en
  // «Aplicar» no puede escribir el catálogo dos veces.
  const aplicandoRef = uR(false);
  const inputRef = uR(null);

  const todas = uM(() => resolverCatalogo(catHook.data || []), [catHook.data]);
  const activas = uM(() => todas.filter(r => r.activo !== false), [todas]);
  const familias = uM(() => contarPorFamilia(todas), [todas]);
  const inactivas = todas.length - activas.length;

  const visibles = uM(() => {
    const q = busca.trim().toLowerCase();
    return (verInactivos ? todas : activas)
      .filter(r => famSel === 'todas' || r.familia === famSel)
      .filter(r => tipoSel === 'todos' || r.tipo === tipoSel)
      .filter(r => !q || String(r.nombre || '').toLowerCase().includes(q))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  }, [todas, activas, verInactivos, famSel, tipoSel, busca]);

  const disgregacion = uM(() => {
    const porPadre = new Map();
    for (const d of (disgHook.data || []).filter(r => !r.deleted_at && r.activo !== false)) {
      if (!porPadre.has(d.padre_norm)) {
        porPadre.set(d.padre_norm, { nombre: d.padre_nombre, unidad: d.padre_unidad, hijos: [] });
      }
      porPadre.get(d.padre_norm).hijos.push(d);
    }
    return [...porPadre.values()];
  }, [disgHook.data]);

  const resumen = uM(() => (diff ? resumenDiff(diff) : null), [diff]);

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
      setDiff(await previsualizarImportacion(r.insumos));
      setDesactivar(false);
    } catch (err) {
      showToast?.(`No se pudo leer el archivo: ${err?.message || err}`, 'error');
    } finally {
      setLeyendo(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const aplicar = async () => {
    if (aplicandoRef.current || !diff || !leido) return;
    aplicandoRef.current = true;
    try {
      const hecho = await aplicarImportacion(diff, leido.disgregacion, { userId, desactivarAusentes: desactivar });
      await catHook.refresh?.();
      await disgHook.refresh?.();
      setLeido(null); setDiff(null);
      showToast?.(
        `Catálogo actualizado: ${hecho.altas} nuevos, ${hecho.cambios} corregidos`
        + (hecho.reactivados ? `, ${hecho.reactivados} reactivados` : '')
        + (hecho.desactivados ? `, ${hecho.desactivados} desactivados` : '')
        + '.', 'success');
    } catch (err) {
      showToast?.(`No se pudo aplicar: ${err?.message || err}`, 'error');
    } finally {
      aplicandoRef.current = false;
    }
  };

  const guardarFactor = async (d) => {
    const v = factorEdit[d.id];
    if (v == null || v === '') return;
    await corregirFactor(d.id, v, { userId });
    await disgHook.refresh?.();
    setFactorEdit(p => { const n = { ...p }; delete n[d.id]; return n; });
    showToast?.('Factor guardado. Desde ahora manda el tuyo.', 'success');
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>

      {/* ── Qué es esto ─────────────────────────────────────────── */}
      <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6 }}>
        Es la lista contra la que la app propone <strong>nombres, unidades y familias</strong> cuando
        das de alta un insumo o armas una orden. Sale de tu archivo{' '}
        <code>Categorizacion Simple.xlsx</code>, se puede volver a importar cuando lo corrijas
        —actualiza, no duplica— y lo que edites aquí a mano ya no lo pisa ninguna importación.
        La familia comercial no reemplaza a nada: <strong>traduce</strong> a la tabla de inventario
        que le toca a cada cosa y a la categoría de gasto que ve contabilidad.
      </div>

      {/* ── Importar ────────────────────────────────────────────── */}
      <div className="card card-p">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" onChange={elegirArchivo}
            style={{ fontSize: 11.5 }} disabled={leyendo} />
          {leyendo && <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Leyendo el archivo…</span>}
          {!leido && !leyendo && (
            <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
              Elige el xlsx y te muestro qué cambiaría <strong>antes</strong> de escribir nada.
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
                {resumen.hayCambios ? 'Aplicar al catálogo' : 'Nada que cambiar'}
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
          <p>Todavía no hay catálogo cargado. Importa <code>Categorizacion Simple.xlsx</code> con el
            botón de arriba: son 444 insumos en 10 familias, 34 servicios y la disgregación del acero.</p>
        </div>
      ) : (
        <>
          {/* ── Familias ──────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`btn btn-xs ${famSel === 'todas' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => setFamSel('todas')}>Todas ({activas.length})</button>
            {familias.map(f => (
              <button key={f.slug} className={`btn btn-xs ${famSel === f.slug ? 'btn-amber' : 'btn-ghost'}`}
                onClick={() => setFamSel(f.slug)} title={`Va a ${TIPO_DESTINO[f.tipo]}`}>
                {f.label} ({f.n})
              </button>
            ))}
          </div>

          {/* ── Filtros ───────────────────────────────────────── */}
          <div className="card card-p" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
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

          {/* ── La lista ──────────────────────────────────────── */}
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="tbl" style={{ fontSize: 11.5 }}>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Unidad</th>
                  <th>Familia</th>
                  <th title="A qué inventario iría si se da de alta">Va a</th>
                  <th title="Cómo lo agrupa contabilidad">Categoría de gasto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibles.slice(0, limite).map(r => {
                  const destino = tipoInsumoDe(r);
                  return (
                    <tr key={r.id} style={r.activo === false ? { opacity: 0.5 } : undefined}>
                      <td>{r.nombre}</td>
                      <td style={{ fontFamily: 'monospace' }}>{r.unidad || '—'}</td>
                      <td>{etiquetaFamilia(r.familia)}</td>
                      <td><span className={`badge ${BADGE_DESTINO[destino] || 'b-gray'}`} style={{ fontSize: 9 }}>{TIPO_DESTINO[destino] || destino}</span></td>
                      <td style={{ color: 'var(--tm)' }}>{categoriaItemDe(r)}</td>
                      <td>
                        {r.origen === 'manual' && <span className="badge b-blue" style={{ fontSize: 8.5 }} title="Editado a mano: la importación no lo pisa.">tuyo</span>}
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
