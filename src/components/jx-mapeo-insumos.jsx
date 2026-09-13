// ═══════════════════════════════════════════════════════════════════
// JARVEX — MAPEO AL PRESUPUESTO. Pestaña de Análisis de Insumos, gate
// admin/gerente heredado del panel.
//
// ── QUÉ PREGUNTA AHORA, Y POR QUÉ CAMBIÓ (13-set-2026) ────────────
// Antes preguntaba «¿qué código del presupuesto de esta obra es esta
// DESCRIPCIÓN DE FACTURA?» — 2.220 descripciones distintas en el grupo, una
// pantalla que no se termina, y encima mezclaba lo que se COMPRÓ con lo que el
// presupuesto PIDE.
//
// Gabriel: «esta sección debería ser súper sencilla en realidad. Para empezar
// debería detectar si el consorcio ejecutor ya clasificó los insumos y
// servicios del presupuesto en base a la ley de clasificaciones […] Con los
// insumos y servicios del presupuesto que tenga clasificados solo se comparará
// con los insumos y servicios ya clasificados de la empresa. Se avisa aquí
// cuánto porcentaje falta clasificar del trabajo elegido y pues de la empresa
// misma […] Aquí no se vincula las compras ni nada de eso, solo se mapea.»
//
// Entonces ahora es entre CATÁLOGOS: los insumos y servicios de la empresa
// contra los del presupuesto del trabajo. Las compras no aparecen. La cadena
// hasta la factura sale sola por el otro lado: `insumo_categoria` (mig 195)
// pega cada descripción a un insumo de la empresa, y de ahí acá.
//
// ── TRES COSAS QUE ESTA PANTALLA TIENE QUE HACER BIEN ─────────────
// 1. DECIR CUÁNTO FALTA CLASIFICAR DE LOS DOS LADOS, arriba de todo y antes de
//    pedir una sola decisión. Si el presupuesto está sin clasificar, mapear es
//    imposible y la pantalla tiene que decirlo en vez de mostrar una lista
//    vacía que parece un error.
// 2. PREFERIR LA MISMA CLASIFICACIÓN. Es lo que la hace corta: un guante
//    compite contra los de [83], no contra los 97 códigos de tubería. Pero es
//    preferencia y no muro —ver `proponerParaInsumo`—: los dos lados clasifican
//    por caminos distintos y cuando discrepan hay que decirlo, no esconder el
//    candidato.
// 3. LA VISTA INVERSA. «De las 434 cosas que la obra necesita, ¿cuáles ya sé
//    quién me las vende?» es la pregunta que de verdad importa después, y es
//    la que habilita todo lo que Gabriel quiere hacer con esto más adelante.
//
// La lógica vive en `mapeo-trabajo.js` (pura, con tests) y la escritura en
// `mapeo-trabajo-db.js`. Acá solo está la pantalla.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getCurrentMode } from "../lib/app-mode-core.js";
import {
  presupuestoDelTrabajo, catalogoDeLaEmpresa, resumenClasificacion,
  resolverMapeosTrabajo, indiceDelPresupuesto, filasDeMapeoTrabajo,
  resumenAvanceMapeo, cobertura, decisionDeMapeo, decisionNoEsta,
  factorPropuesto, bandaDe, ESTADOS_MAPEO,
} from "../lib/mapeo-trabajo.js";
import { decidirMapeo, decidirMapeoEnLote, reabrirMapeo } from "../lib/mapeo-trabajo-db.js";
import { etiquetaCategoria } from "../lib/indices-unificados-iupc.js";
import { titularContableDeObra } from "../lib/consorcio.js";
import { TIPO_TRABAJO_LBL } from "../lib/tipos-trabajo.js";

const { useState: uS, useMemo: uM, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const SearchableSelect = (p) => (window.SearchableSelect ? <window.SearchableSelect {...p} /> : null);

const cant = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const soles = (n) => `S/ ${Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;
const pct = (n) => `${Number(n || 0).toFixed(0)}%`;

const ETIQUETA_FUENTE = {
  tabla: { txt: 'norma', color: 'b-green', ayuda: 'Sale de una tabla técnica (kg/m del acero, kg por bolsa).' },
  descripcion: { txt: 'del nombre', color: 'b-green', ayuda: 'El propio nombre dice el largo o la presentación.' },
  supuesto: { txt: 'supuesto', color: 'b-amber', ayuda: 'Valor comercial asumido. Revisalo antes de aceptar.' },
  manual: { txt: 'tuyo', color: 'b-blue', ayuda: 'Lo escribiste vos.' },
};

/** Una barra de «cuánto está clasificado». Es lo primero que se pidió ver. */
function BarraClasificacion({ titulo, resumen, ayuda, accion }) {
  const ok = resumen.total > 0 && resumen.faltan === 0;
  return (
    <div style={{ flex: 1, minWidth: 250 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12.5 }}>{titulo}</strong>
        <span style={{ fontSize: 16, fontWeight: 700, color: ok ? 'var(--green)' : 'var(--amber)' }}>
          {pct(resumen.pct)}
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
          {resumen.clasificados} de {resumen.total} clasificados
        </span>
      </div>
      <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-s)', marginTop: 5 }}>
        <div style={{ width: `${Math.min(100, resumen.pct)}%`, background: ok ? 'var(--green)' : 'var(--amber)' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>
        {resumen.faltan > 0
          ? <>Faltan <strong>{resumen.faltan}</strong>. {ayuda}{accion}</>
          : <>Todo clasificado.</>}
      </div>
    </div>
  );
}

function MapeoInsumosTab({ showToast, empresaFija = null }) {
  const obrasHook = window.__hooks.useObras();
  const consorciosHook = window.__hooks.useConsorcios();
  const catHook = window.__hooks.useCatalogoInsumos();
  const terHook = window.__hooks.useClasificacionTerminos();
  const mapHook = window.__hooks.useInsumoTrabajoMapeos();
  const compHook = window.__hooks.useCompanies();
  const auth = window.__useAuth ? window.__useAuth() : {};
  const userId = auth?.profile?.id || null;
  const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();

  const [obraSel, setObraId] = uS('');
  const [filtro, setFiltro] = uS('pendientes');
  const [busca, setBusca] = uS('');
  const [vista, setVista] = uS('empresa');      // 'empresa' | 'cobertura'
  const [elegido, setElegido] = uS({});          // norm → insumo_codigo elegido a mano
  const [limite, setLimite] = uS(60);
  // Anti doble-click (regla crítica 2 del CLAUDE.md): ref SÍNCRONO. Un doble
  // tap en «Es este» no puede escribir la misma decisión dos veces.
  const guardandoRef = uR(false);

  const obras = uM(() => (obrasHook.data || []).filter(o => !o.deleted_at), [obrasHook.data]);
  // La obra por defecto se DERIVA en el render, no se setea en un efecto: así
  // no hay un primer pintado con el selector vacío, y el test de montaje ve la
  // tabla de verdad (renderToString no corre efectos).
  const obraId = obraSel || obras[0]?.id || '';
  const obra = uM(() => obras.find(o => o.id === obraId) || null, [obras, obraId]);

  const ipsHook = window.__hooks.useInsumosPartida(obraId);
  const terminosCustom = terHook?.data || null;

  // Quién ejecuta este trabajo: el consorcio si lo hay, si no la empresa
  // titular. Se muestra porque es de QUIÉN se espera que haya clasificado el
  // presupuesto — «detectar si el consorcio ejecutor ya clasificó».
  const ejecutoraId = uM(
    () => titularContableDeObra(obra, consorciosHook.data || []),
    [obra, consorciosHook.data],
  );
  const nombreDe = uM(
    () => new Map((compHook.data || []).filter(c => !c.deleted_at).map(c => [c.id, c.name])),
    [compHook.data],
  );

  // El ámbito de la EMPRESA cuyos insumos se mapean lo manda la pantalla de
  // arriba. Sin empresa elegida se mapea el catálogo general del grupo.
  const companyId = empresaFija || null;

  const presupuesto = uM(
    () => (obraId && !ipsHook.loading ? presupuestoDelTrabajo(ipsHook.data || [], { terminosCustom }) : []),
    [obraId, ipsHook.data, ipsHook.loading, terminosCustom],
  );
  const catalogo = uM(
    () => catalogoDeLaEmpresa(catHook.data || [], { companyId }),
    [catHook.data, companyId],
  );

  const resPresupuesto = uM(() => resumenClasificacion(presupuesto), [presupuesto]);
  const resEmpresa = uM(() => resumenClasificacion(catalogo), [catalogo]);

  const { prep, porCodigo } = uM(() => indiceDelPresupuesto(presupuesto), [presupuesto]);
  const decisiones = uM(
    () => resolverMapeosTrabajo(mapHook.data || [], { obraId, companyId, demo: esPrueba }),
    [mapHook.data, obraId, companyId, esPrueba],
  );
  const filas = uM(
    () => filasDeMapeoTrabajo(catalogo, { prep, porCodigo, decisiones }),
    [catalogo, prep, porCodigo, decisiones],
  );
  const avance = uM(() => resumenAvanceMapeo(filas), [filas]);
  const cob = uM(
    () => cobertura(presupuesto, (mapHook.data || []).filter(m => m.obra_id === obraId && !!m.demo === esPrueba)),
    [presupuesto, mapHook.data, obraId, esPrueba],
  );

  const visibles = uM(() => {
    const t = busca.trim().toLowerCase();
    return filas.filter(f => {
      if (t && !String(f.nombre || '').toLowerCase().includes(t)) return false;
      if (filtro === 'pendientes') return f.estado !== 'decididas' && f.estado !== 'sin_clasificar';
      return f.estado === filtro;
    });
  }, [filas, filtro, busca]);

  const enPantalla = uM(() => visibles.slice(0, limite), [visibles, limite]);

  const opcionesPresupuesto = uM(() => presupuesto.map(p => ({
    value: p.codigo,
    label: `${p.nombre} — ${cant(p.cantidad)} ${p.unidad} · ${p.clasificacionNombre}`,
  })), [presupuesto]);

  // ── Acciones ─────────────────────────────────────────────────────
  const conGuard = (fn) => async (...args) => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    try { await fn(...args); }
    catch (e) { showToast?.('Error: ' + (e?.message || e), 'red'); }
    finally { guardandoRef.current = false; }
  };

  const insumoElegidoDe = (f) => {
    const cod = elegido[f.norm] || f.sug?.candidatos?.[0]?.cat?.codigo || null;
    return cod ? porCodigo.get(cod) || null : null;
  };

  const aceptar = conGuard(async (f) => {
    const destino = insumoElegidoDe(f);
    if (!destino) { showToast?.('Elegí primero el insumo del presupuesto.', 'amber'); return; }
    const fac = factorPropuesto(f, destino);
    await decidirMapeo(decisionDeMapeo(f, destino, {
      obraId, companyId,
      factor: fac?.factor ?? null, factorFuente: fac?.fuente ?? null,
      score: f.sug?.candidatos?.[0]?.score ?? null,
    }), { userId });
    await mapHook.refresh?.();
    showToast?.(`✓ «${f.nombre}» → ${destino.nombre}`, 'green');
  });

  const noEsta = conGuard(async (f) => {
    await decidirMapeo(decisionNoEsta(f, { obraId, companyId }), { userId });
    await mapHook.refresh?.();
    showToast?.('✓ Marcado: no está en este presupuesto — no se vuelve a preguntar', 'green');
  });

  const deshacer = conGuard(async (f) => {
    await reabrirMapeo(f.norm, { obraId, companyId });
    await mapHook.refresh?.();
    showToast?.('Decisión deshecha — vuelve a la lista', 'green');
  });

  const aceptarLasPropuestas = conGuard(async () => {
    const conPropuesta = filas.filter(f => f.estado === 'propuesto');
    if (!conPropuesta.length) return;
    const cuerpos = conPropuesta.map(f => {
      const destino = porCodigo.get(f.sug.candidatos[0].cat.codigo);
      const fac = factorPropuesto(f, destino);
      return decisionDeMapeo(f, destino, {
        obraId, companyId,
        factor: fac?.factor ?? null, factorFuente: fac?.fuente ?? null,
        score: f.sug.candidatos[0].score,
      });
    });
    const n = await decidirMapeoEnLote(cuerpos, { userId });
    await mapHook.refresh?.();
    showToast?.(`✓ ${n} insumos mapeados de una`, 'green');
  });

  // ── Render ───────────────────────────────────────────────────────
  const sinPresupuesto = !!obraId && !ipsHook.loading && presupuesto.length === 0;

  return (
    <>
      <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6 }}>
        Acá se dice <strong>qué insumo del presupuesto de un trabajo es cada insumo de la empresa</strong>.
        Es un mapeo entre catálogos: <strong>no se vinculan compras ni facturas</strong>.
        Solo se comparan los que están clasificados de los dos lados, y cada uno solo contra los de su
        <strong> misma clasificación</strong> — por eso la lista es corta y las propuestas se entienden.
      </div>

      {/* ── El trabajo ───────────────────────────────────────────── */}
      <div className="card card-p" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 2, minWidth: 260 }}>
          <label style={{ fontSize: 11, color: 'var(--tm)' }}>Trabajo</label>
          <select className="fi" value={obraId} onChange={e => { setObraId(e.target.value); setElegido({}); }}>
            {!obras.length && <option value="">— no hay trabajos cargados —</option>}
            {obras.map(o => (
              <option key={o.id} value={o.id}>
                {o.nombre_obra}{o.tipo_trabajo ? ` · ${TIPO_TRABAJO_LBL[o.tipo_trabajo] || o.tipo_trabajo}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 220, fontSize: 11.5, color: 'var(--tm)' }}>
          {ejecutoraId
            ? <>Lo ejecuta <strong>{nombreDe.get(ejecutoraId) || 'una entidad del grupo'}</strong>.</>
            : <>Sin ejecutora asignada.</>}
          <div>
            Mapeando los insumos de{' '}
            <strong>{companyId ? (nombreDe.get(companyId) || 'esta entidad') : 'el catálogo general del grupo'}</strong>.
          </div>
        </div>
      </div>

      {sinPresupuesto ? (
        <div className="card card-p" style={{ color: 'var(--amber)', fontSize: 12 }}>
          ⚠ Este trabajo no tiene presupuesto cargado. Sin presupuesto no hay contra qué mapear:
          cargalo desde Gestión de Obra → Partidas.
        </div>
      ) : (
        <>
          {/* ── CUÁNTO FALTA CLASIFICAR, DE LOS DOS LADOS ────────── */}
          <div className="card card-p">
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
              Antes de mapear: ¿está clasificado?
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <BarraClasificacion
                titulo="Insumos del presupuesto de este trabajo"
                resumen={resPresupuesto}
                ayuda="Se clasifican solos con el estándar; los que no reconoce se resuelven agregando su término al diccionario."
                accion={null}
              />
              <BarraClasificacion
                titulo="Insumos y servicios de la empresa"
                resumen={resEmpresa}
                ayuda="Se clasifican en "
                accion={
                  <button className="btn btn-xs" style={{ padding: '0 6px' }}
                    onClick={() => {
                      window.__analisisInsumosIntent = { ...(window.__analisisInsumosIntent || {}), tab: 'catalogo', vista: 'lista' };
                      window.__navTo?.('analisis-insumos', 'general');
                    }}>
                    Clasificación → Insumos y servicios
                  </button>
                }
              />
            </div>
            {resPresupuesto.faltan > 0 && (
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 8 }}>
                Los {resPresupuesto.faltan} del presupuesto que el estándar no reconoce quedan afuera de la
                comparación hasta que se los clasifique — no se inventan.
              </div>
            )}
          </div>

          {/* ── Las dos vistas ───────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`btn btn-sm ${vista === 'empresa' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => setVista('empresa')}>
              🏢 Insumos de la empresa ({filas.length})
            </button>
            <button className={`btn btn-sm ${vista === 'cobertura' ? 'btn-amber' : 'btn-ghost'}`}
              onClick={() => setVista('cobertura')}>
              🎯 Qué necesita el trabajo ({cob.conCobertura}/{cob.total})
            </button>
          </div>

          {vista === 'cobertura' ? (
            <div className="card card-p">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>{pct(cob.pct)}</div>
                <div style={{ fontSize: 12, color: 'var(--ts)' }}>
                  de lo que este trabajo necesita ya tiene quién se lo provea —{' '}
                  <strong>{cob.conCobertura}</strong> de {cob.total} insumos del presupuesto
                </div>
              </div>
              <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-s)', margin: '6px 0 10px' }}>
                <div style={{ width: `${Math.min(100, cob.pct)}%`, background: 'var(--green)' }} />
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 11.5, width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Insumo del presupuesto</th>
                      <th style={{ textAlign: 'left' }}>Clasificación</th>
                      <th style={{ textAlign: 'right' }}>Cantidad</th>
                      <th style={{ textAlign: 'right' }}>Costo</th>
                      <th style={{ textAlign: 'left' }}>Quién lo cubre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cob.filas.slice(0, 200).map(f => (
                      <tr key={f.codigo}>
                        <td>{f.nombre}</td>
                        <td style={{ color: 'var(--tm)' }}>{f.clasificacionNombre}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{cant(f.cantidad)} {f.unidad}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{soles(f.costo)}</td>
                        <td>
                          {f.cubiertoPor.length
                            ? f.cubiertoPor.map(m => m.muestra).join(' · ')
                            : <span style={{ color: 'var(--tm)', fontStyle: 'italic' }}>nadie todavía</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {cob.filas.length > 200 && (
                  <div style={{ padding: 10, fontSize: 11, color: 'var(--tm)' }}>
                    …y {cob.filas.length - 200} insumos más del presupuesto.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* ── Avance ───────────────────────────────────────── */}
              <div className="card card-p">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{pct(avance.pct)}</div>
                  <div style={{ fontSize: 12, color: 'var(--ts)' }}>
                    de los insumos que SE PUEDEN decidir ya están decididos —{' '}
                    <strong>{avance.decididas}</strong> de {avance.total - avance.sinClasificar}
                  </div>
                </div>
                <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-s)', marginTop: 6 }}>
                  <div style={{ width: `${Math.min(100, avance.pct)}%`, background: 'var(--green)' }} />
                </div>
                <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--tm)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                  <span>✓ mapeados: <strong>{avance.mapeadas}</strong></span>
                  <span>✗ no están en este presupuesto: <strong>{avance.noEstan}</strong></span>
                  <span>· con propuesta: <strong>{avance.propuesto}</strong></span>
                  <span>· dudosas: <strong>{avance.revisar}</strong></span>
                  <span>· sin nada parecido: <strong>{avance.sinCandidato}</strong></span>
                  {avance.sinClasificar > 0 && (
                    <span title="No entran a la comparación hasta que se los clasifique.">
                      · falta clasificarlos: <strong>{avance.sinClasificar}</strong>
                    </span>
                  )}
                </div>
                {avance.propuesto > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-sm btn-green" onClick={aceptarLasPropuestas}>
                      Aceptar las {avance.propuesto} propuestas de coincidencia alta
                    </button>
                    <span style={{ fontSize: 11, color: 'var(--tm)', marginLeft: 8 }}>
                      Solo las que el motor propuso sin ambigüedad. Las dudosas se miran de a una.
                    </span>
                  </div>
                )}
              </div>

              {/* ── Filtros ──────────────────────────────────────── */}
              <div className="card card-p">
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <label style={{ fontSize: 11, color: 'var(--tm)' }}>Buscar</label>
                    <input className="fi" value={busca} onChange={e => setBusca(e.target.value)}
                      placeholder="cemento, tubería, guantes…" />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {ESTADOS_MAPEO.map(([k, lbl]) => {
                    const n = k === 'pendientes'
                      ? filas.filter(f => f.estado !== 'decididas' && f.estado !== 'sin_clasificar').length
                      : filas.filter(f => f.estado === k).length;
                    return (
                      <button key={k} className={`btn btn-sm ${filtro === k ? 'btn-amber' : 'btn-ghost'}`}
                        onClick={() => setFiltro(k)}>
                        {lbl} ({n})
                      </button>
                    );
                  })}
                </div>

                {!visibles.length && (
                  <div style={{ color: 'var(--tm)', fontSize: 12, padding: 12 }}>
                    {filas.length ? 'Nada acá con ese filtro.' : 'Esta empresa todavía no tiene insumos en su catálogo.'}
                  </div>
                )}

                {enPantalla.map(f => (
                  <FilaMapeo
                    key={f.norm}
                    f={f}
                    opciones={opcionesPresupuesto}
                    elegido={elegido[f.norm] || ''}
                    onElegir={(cod) => setElegido(e => ({ ...e, [f.norm]: cod }))}
                    destino={insumoElegidoDe(f)}
                    onAceptar={() => aceptar(f)}
                    onNoEsta={() => noEsta(f)}
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
            </>
          )}
        </>
      )}
    </>
  );
}

/**
 * Una fila. En su propio componente para que el test de montaje pueda
 * renderizar la rama «ya decidida» sin poder hacer clic en el filtro: es donde
 * un `f.decision.decision` sobre un null explotaría en la obra y pasaría el
 * green gate en verde.
 */
function FilaMapeo({ f, opciones, elegido, onElegir, destino, onAceptar, onNoEsta, onDeshacer }) {
  const cand = f?.sug?.candidatos?.[0] || null;
  const banda = cand ? bandaDe(cand.score) : null;
  const fac = destino ? factorPropuesto(f, destino) : null;
  const et = fac?.fuente ? ETIQUETA_FUENTE[fac.fuente] : null;

  return (
    <div style={{ borderTop: '1px solid var(--border)', padding: '9px 8px', display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{f.nombre}</div>
        <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
          {f.unidad || 'sin unidad'} · {f.clasificacionNombre}
          {f.tipo === 'servicio' && <span className="badge b-purple" style={{ marginLeft: 6, fontSize: 9 }}>servicio</span>}
        </div>

        {f.estado === 'decididas' ? (
          <div style={{ fontSize: 11.5, marginTop: 4 }}>
            {f.decision?.decision === 'mapeado'
              ? <>→ <strong>{f.presupuesto?.nombre || f.decision.insumo_nombre || '(insumo del presupuesto)'}</strong>
                  {f.decision.factor ? <span className="badge b-gray" style={{ marginLeft: 6 }}>× {cant(f.decision.factor)} {f.decision.unidad_destino}</span> : null}</>
              : <span style={{ color: 'var(--tm)' }}>✗ No está en el presupuesto de este trabajo</span>}
          </div>
        ) : f.estado === 'sin_clasificar' ? (
          <div style={{ fontSize: 11.5, marginTop: 4, color: 'var(--tm)' }}>
            <em>Falta clasificarlo.</em> Hasta que tenga clasificación no puede compararse con el presupuesto.
          </div>
        ) : (
          <div style={{ marginTop: 5 }}>
            {cand ? (
              <div style={{ fontSize: 11.5, marginBottom: 4 }}>
                → <strong>{cand.cat.nombre}</strong>
                <span className={`badge ${banda.color}`} style={{ marginLeft: 6 }}>
                  {banda.label} ({Math.round(cand.score * 100)}%)
                </span>
                {/* Los dos lados clasifican por caminos distintos —la empresa
                    guarda lo que alguien decidió, el presupuesto se deriva del
                    estándar— y cuando discrepan hay que decirlo, no esconderlo
                    ni descartar el candidato. */}
                {cand.otraClasificacion && (
                  <span className="badge b-amber" style={{ marginLeft: 6 }}
                    title="El insumo de la empresa y el del presupuesto están en clasificaciones distintas. Puede ser el mismo y estar mal clasificado uno de los dos: mirá antes de aceptar.">
                    otra clasificación{cand.clasificacionCandidato ? `: ${etiquetaCategoria(cand.clasificacionCandidato)}` : ''}
                  </span>
                )}
                {cand.motivos?.length > 0 && (
                  <span style={{ color: 'var(--tm)', marginLeft: 6, fontSize: 10.5 }}>
                    ({cand.motivos.slice(0, 3).join(', ')})
                  </span>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, marginBottom: 4, color: 'var(--tm)' }}>
                <em>Nada parecido en este presupuesto.</em> Elegilo a mano si igual está, o marcá que no está.
              </div>
            )}
            <div style={{ maxWidth: 460 }}>
              {SearchableSelect ? (
                <SearchableSelect
                  value={elegido || cand?.cat?.codigo || ''}
                  onChange={onElegir}
                  options={opciones}
                  placeholder="— Buscá el insumo del presupuesto —"
                  fontSize={11.5}
                />
              ) : (
                <select className="fi" style={{ fontSize: 11.5 }} value={elegido || cand?.cat?.codigo || ''}
                  onChange={e => onElegir(e.target.value)}>
                  <option value="">— Buscá el insumo del presupuesto —</option>
                  {opciones.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
            {destino && fac && fac.factor && fac.factor !== 1 && (
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
                Conversión: 1 {f.unidad} = {cant(fac.factor)} {destino.unidad}
                {et && <span className={`badge ${et.color}`} style={{ marginLeft: 6 }} title={et.ayuda}>{et.txt}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {f.estado === 'decididas' ? (
          <button className="btn btn-sm" onClick={onDeshacer}>Deshacer</button>
        ) : f.estado === 'sin_clasificar' ? null : (
          <>
            <button className="btn btn-sm btn-green" disabled={!destino} onClick={onAceptar}>Es este</button>
            <button className="btn btn-sm" onClick={onNoEsta}>No está</button>
          </>
        )}
      </div>
    </div>
  );
}

export { MapeoInsumosTab, FilaMapeo };
export default MapeoInsumosTab;
