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
  decisionDeCatalogo, decisionNoInsumo, familiaComercialDe, ESTADOS,
} from "../lib/bandeja-categorizacion.js";
import {
  decidir, decidirEnLote, agregarAlCatalogoYDecidir, reabrir, enseñarALaContadora,
} from "../lib/bandeja-categorizacion-db.js";
import {
  FAMILIAS_CATALOGO, etiquetaFamilia, equivalenciasDe,
} from "../lib/catalogo-canonico.js";

const { useState: uS, useMemo: uM, useRef: uR, useEffect: uE } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const soles = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;

const COLOR_ESTADO = {
  propuesto: 'b-green', revisar: 'b-amber', falta: 'b-blue', decididas: 'b-gray',
};

function BandejaCategorizacionTab({ compras, showToast, empresaFija = null }) {
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

  const empresas = uM(() => (compHook.data || []).filter(c => !c.deleted_at), [compHook.data]);
  const companyId = empresaFija || entidad || null;

  // `equivalenciasDe` (familia local → familia del grupo) es la forma que
  // espera `familiaEfectiva`; `resolverEquivalencias` devuelve las filas
  // crudas con clave «empresa|familia» y no sirve para esto.
  const equivalencias = uM(() => equivalenciasDe(eqHook.data || [], companyId), [eqHook.data, companyId]);

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
      if (filtro === 'pendientes') return f.estado !== 'decididas';
      return f.estado === filtro;
    });
  }, [filas, filtro, busca]);

  const enPantalla = uM(() => visibles.slice(0, limite), [visibles, limite]);

  // El cursor no puede quedar fuera de la lista cuando se filtra o se decide.
  uE(() => { setCursor(c => Math.min(c, Math.max(0, enPantalla.length - 1))); }, [enPantalla.length]);

  const catalogoDe = (fila) => {
    const cod = fila?.sug?.candidatos?.[0]?.cat?.codigo;
    return cod ? porId.get(cod) : null;
  };

  // ── Acciones ─────────────────────────────────────────────────────
  const conGuard = (fn) => async (...args) => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    try { await fn(...args); }
    catch (e) { showToast?.('Error: ' + (e.message || e), 'red'); }
    finally { guardandoRef.current = false; }
  };

  const aceptar = conGuard(async (fila) => {
    const cand = fila?.sug?.candidatos?.[0];
    const catFila = catalogoDe(fila);
    if (!cand || !catFila) return;
    await decidir(decisionDeCatalogo(fila, catFila, {
      factor: cand.factor?.factor ?? null,
      factorFuente: cand.factor?.fuente ?? null,
      score: cand.score, companyId,
    }), { userId });
    await enseñarALaContadora([{ fila, catalogoFila: catFila }], { userId, equivalencias });
    await decHook.refresh?.();
    showToast?.(`✓ ${catFila.nombre} — vale para todas las facturas que digan lo mismo`, 'green');
  });

  const noEsInsumo = conGuard(async (fila) => {
    await decidir(decisionNoInsumo(fila, { companyId }), { userId });
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
    setAltaDe(null);
    await Promise.all([catHook.refresh?.(), decHook.refresh?.()]);
    showToast?.(`✓ «${creado.nombre}» agregado al catálogo y mapeado`, 'green');
  });

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

  return (
    <>
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
          <div style={{ minWidth: 220, flex: 1 }}>
            <label style={{ fontSize: 11, color: 'var(--tm)' }}>Compras de</label>
            <select className="fi" value={companyId || ''} disabled={!!empresaFija}
              title={empresaFija ? 'El ámbito lo fija el selector de arriba de la pantalla.' : undefined}
              onChange={e => { setEntidad(e.target.value); setCursor(0); }}>
              {!empresaFija && <option value="">Todo el grupo ({(compras || []).length} líneas)</option>}
              {empresas.map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 240, flex: 2 }}>
            <label style={{ fontSize: 11, color: 'var(--tm)' }}>Buscar en las descripciones</label>
            <input className="fi" value={busca} onChange={e => { setBusca(e.target.value); setCursor(0); }} placeholder="cemento, fierro, tubo…" />
          </div>
        </div>

        {/* El avance se mide en PLATA: decidir las 20 más caras vale más que
            decidir 200 de la cola, y el número tiene que decir eso. */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{avance.pct.toFixed(0)}%</div>
          <div style={{ fontSize: 12, color: 'var(--ts)' }}>
            del gasto ya categorizado — <strong>{avance.decididas}</strong> de {avance.total} descripciones
            {' '}({soles(avance.plataDecidida)} de {soles(avance.totalPlata)})
          </div>
        </div>
        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-s)', marginTop: 6 }}>
          <div style={{ width: `${Math.min(100, avance.pct)}%`, background: 'var(--green)' }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--tm)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span>✓ en el catálogo: <strong>{avance.enCatalogo}</strong> ({soles(avance.plataEnCatalogo)})</span>
          <span>✗ no son insumo: <strong>{avance.noInsumo}</strong> ({soles(avance.plataNoInsumo)})</span>
          <span>· con propuesta: <strong>{avance.propuesto}</strong> ({soles(avance.plataPropuesto)})</span>
          <span>· dudosas: <strong>{avance.revisar}</strong> ({soles(avance.plataRevisar)})</span>
          <span>· faltan en el catálogo: <strong>{avance.falta}</strong> ({soles(avance.plataFalta)})</span>
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
          {ESTADOS.map(([k, lbl]) => (
            <button key={k} className={`btn btn-sm ${filtro === k ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => { setFiltro(k); setCursor(0); }}>
              {lbl} ({k === 'pendientes' ? avance.total - avance.decididas
                : k === 'decididas' ? avance.decididas
                : k === 'propuesto' ? avance.propuesto
                : k === 'revisar' ? avance.revisar : avance.falta})
            </button>
          ))}
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
            marcada={marcadas.has(f.norm)}
            onFocus={() => setCursor(i)}
            onMarcar={() => setMarcadas(m => {
              const s = new Set(m); if (s.has(f.norm)) s.delete(f.norm); else s.add(f.norm); return s;
            })}
            onAceptar={() => aceptar(f)}
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

      {altaDe && <AltaEnCatalogo fila={altaDe} onCancel={() => setAltaDe(null)} onGuardar={crearEnCatalogo} />}
    </>
  );
}

/**
 * Una fila de la bandeja. Va en su propio componente para que el test de
 * montaje pueda renderizar la rama «ya decidida» sin poder hacer clic en el
 * filtro: es donde un `f.decision.decision` sobre un null explotaría en la obra
 * y pasaría el green gate en verde.
 */
function FilaBandeja({ f, activa, catFila, marcada, onFocus, onMarcar, onAceptar, onFalta, onNoInsumo, onDeshacer }) {
  const cand = f.sug?.candidatos?.[0];
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
            {f.provs.size > 0 && <> · {[...f.provs].slice(0, 2).join(', ')}{f.provs.size > 2 ? ` +${f.provs.size - 2}` : ''}</>}
            {f.unidades.size > 0 && <> · {[...f.unidades].join('/')}</>}
            {/* Los dólares se VEN con su marcador y NO se suman al total
                (decisión de Gabriel del 7-set, la misma de «Sin respaldo»). */}
            {[...f.monedas].some(m => m !== 'PEN') && (
              <span className="badge b-amber" style={{ marginLeft: 6 }}>en dólares</span>
            )}
          </div>

          {f.estado === 'decididas' ? (
            <div style={{ fontSize: 11.5, marginTop: 4 }}>
              {f.decision?.decision === 'catalogo'
                ? <>→ <strong>{f.cat?.nombre || '(insumo del catálogo)'}</strong>
                    {f.decision.familia && <span className="badge b-gray" style={{ marginLeft: 6 }}>{etiquetaFamilia(f.decision.familia)}</span>}</>
                : <span style={{ color: 'var(--tm)' }}>✗ No es un insumo del catálogo</span>}
            </div>
          ) : cand ? (
            <div style={{ fontSize: 11.5, marginTop: 4 }}>
              → {catFila?.nombre}
              <span className={`badge ${COLOR_ESTADO[f.estado]}`} style={{ marginLeft: 6 }}>
                {f.estado === 'propuesto' ? `${(cand.score * 100).toFixed(0)}%` : `dudosa ${(cand.score * 100).toFixed(0)}%`}
              </span>
              {catFila?.familia && <span className="badge b-gray" style={{ marginLeft: 4 }}>{etiquetaFamilia(catFila.familia)}</span>}
              {cand.motivos?.length > 0 && (
                <span style={{ color: 'var(--tm)', marginLeft: 6 }}>({cand.motivos.slice(0, 3).join(', ')})</span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--tm)' }}>
              Sin candidato en el catálogo.
            </div>
          )}
        </div>

        <div style={{ fontSize: 12, fontFamily: 'monospace', minWidth: 84, textAlign: 'right' }}>{soles(f.importe)}</div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {f.estado === 'decididas' ? (
            <button className="btn btn-sm" onClick={onDeshacer}>Deshacer</button>
          ) : (
            <>
              {cand && <button className="btn btn-sm btn-green" onClick={onAceptar}>Aceptar</button>}
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
 * factura en mayúsculas, unidad de la factura, familia de la misma regla que
 * usa el motor para puntuar— porque si hubiera que escribir tres campos desde
 * cero nadie lo usaría y las 120 descripciones sin candidato se quedarían sin
 * respuesta. Todo es corregible antes de guardar.
 */
function AltaEnCatalogo({ fila, onCancel, onGuardar }) {
  const [nombre, setNombre] = uS(() => (fila.muestra || '').trim().toUpperCase().replace(/\s+/g, ' '));
  const [familia, setFamilia] = uS(() => familiaComercialDe(fila.muestra));
  const [unidad, setUnidad] = uS(() => [...(fila.unidades || [])][0] || 'und');
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
        <div style={{ flex: 2, minWidth: 180 }}>
          <label style={{ fontSize: 11, color: 'var(--tm)' }}>Familia</label>
          <select className="fi" value={familia} onChange={e => setFamilia(e.target.value)}>
            {FAMILIAS_CATALOGO.map(f => <option key={f.slug} value={f.slug}>{f.label}</option>)}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 110 }}>
          <label style={{ fontSize: 11, color: 'var(--tm)' }}>Unidad</label>
          <input className="fi" value={unidad} onChange={e => setUnidad(e.target.value)} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--tm)' }}>
        De la factura: «{fila.muestra}» — {fila.veces} {fila.veces === 1 ? 'vez' : 'veces'}, {soles(fila.importe)}.
      </div>
    </div>
  );
  const pie = (
    <>
      <button className="btn btn-sm" onClick={onCancel}>Cancelar</button>
      <button className="btn btn-sm btn-green" disabled={!nombre.trim()}
        onClick={() => onGuardar(fila, { nombre, familia, unidad })}>
        Agregar al catálogo
      </button>
    </>
  );
  const pieEnvuelto = (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>{pie}</div>
  );
  if (!Modal) {
    // Sin el modal global (tests de montaje) igual se renderiza el cuerpo: si
    // acá adentro hubiera un TDZ, tiene que explotar en el gate y no en la obra.
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
