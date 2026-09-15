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
import { mapearInsumoConIA, notaDeIA, esDecisionDeIA } from "../lib/ia-insumos.js";
import { modelosDe } from "../lib/modelos-ia-config.js";
import { UMBRAL_BARRIDO_IA } from "../lib/barrido-ia.js";
import { guardarRecomendacion, olvidarRecomendacion } from "../lib/barrido-store.js";
import { BarridoIA, RecomendacionIA, SelloIA, useBarridoIA } from "./jx-barrido-ia.jsx";
import { titularContableDeObra } from "../lib/consorcio.js";
import { TIPO_TRABAJO_LBL } from "../lib/tipos-trabajo.js";

const { useState: uS, useMemo: uM, useRef: uR, useCallback: uC } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const SearchableSelect = (p) => (window.SearchableSelect ? <window.SearchableSelect {...p} /> : null);

/**
 * "🤖 Preguntale a la IA" para MAPEAR (14-sep-2026, pedido de Gabriel: la
 * misma ayuda de clasificación y correlaciones, pero para este módulo).
 *
 * Acá no se clasifica nada: los dos lados YA tienen clasificación y la
 * pregunta es de equivalencia entre el catálogo de la empresa y el
 * presupuesto del trabajo ("Fierro corrugado 1/2" ↔ "ACERO CORRUGADO
 * fy=4200 Ø 1/2"). "No está en este presupuesto" es una respuesta válida.
 *
 * Nunca decide sola: deja el insumo elegido en el selector y la decisión
 * sigue siendo tocar "Es este".
 */
function AyudaMapeoIA({ fila, candidatosIA, obraId, onElegir, modeloTexto = null }) {
  const [res, setRes] = uS(null);
  const [cargando, setCargando] = uS(false);
  const [error, setError] = uS(null);
  const [candidatos, setCandidatos] = uS([]);

  const preguntar = async () => {
    if (cargando) return;
    setCargando(true); setError(null); setRes(null);
    try {
      // Los candidatos se arman ACÁ, recién al tocar el botón: hacerlo en un
      // memo de la fila tokenizaba el presupuesto entero por cada una de las
      // 60 filas en pantalla, aunque nadie preguntara nada.
      const lista = candidatosIA(fila);
      setCandidatos(lista);
      if (!lista.length) { setError('No hay insumos del presupuesto contra los que preguntar.'); return; }
      const r = await mapearInsumoConIA({
        insumo: fila.nombre,
        unidad: fila.unidad || '',
        clasificacion: fila.clasificacionNombre || '',
        candidatos: lista,
        obraId,
        modeloTexto,
      });
      setRes({
        codigo: r?.result?.codigo_sugerido || null,
        confianza: r?.confianza,
        razonamiento: r?.razonamiento || '',
        cached: !!r?._cached,
      });
    } catch (e) {
      setError(e?.message || 'No se pudo consultar la IA.');
    } finally {
      setCargando(false);
    }
  };

  const destino = res?.codigo ? candidatos.find(c => c.codigo === res.codigo) : null;

  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className="btn btn-xs btn-ghost" disabled={cargando} onClick={preguntar}>
        {cargando ? '🤖 Pensando…' : '🤖 Preguntale a la IA'}
      </button>
      {error && <span style={{ color: 'var(--red)', fontSize: 10.5, marginLeft: 6 }}>{error}</span>}
      {res && (
        <div style={{
          marginTop: 4, padding: '5px 8px', fontSize: 10.5, borderRadius: 5, maxWidth: 520,
          background: destino ? 'rgba(58,163,255,.08)' : 'rgba(231,76,60,.08)',
          border: `1px solid ${destino ? 'rgba(58,163,255,.3)' : 'rgba(231,76,60,.3)'}`,
        }}>
          {destino ? (
            <>
              🤖 Sugiere <strong>{destino.nombre}</strong>
              <span className="badge b-blue" style={{ marginLeft: 4, fontSize: 9 }}>
                {Math.round((res.confianza || 0) * 100)}%
              </span>
            </>
          ) : (
            <>🤖 <strong>No encontró un equivalente</strong> en este presupuesto</>
          )}
          {res.cached && <span style={{ color: 'var(--tm)' }}> · ya preguntada</span>}
          <div style={{ color: 'var(--tm)', marginTop: 2 }}>{res.razonamiento}</div>
          {destino && (
            <button type="button" className="btn btn-xs btn-blue" style={{ marginTop: 4 }}
              onClick={() => onElegir(destino.codigo)}>
              Usar este insumo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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
  // 🔴 EL MISMO ÁMBITO QUE CLASIFICAR (15-set): mapear iba siempre en 'auto'
  // —la cadena de gratuitos de OpenRouter, la que devolvió 429 durante horas el
  // 15-set— aunque el admin hubiera elegido un modelo. Clasificar, correlacionar
  // y mapear son tres preguntas del mismo módulo: una sola elección.
  const { data: cfgIA } = window.__hooks?.useAppConfig?.() || { data: [] };
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

  // Las propuestas de IA se guardan por OBRA: los códigos del presupuesto son
  // de un trabajo, así que la misma fila en otra obra es otra pregunta.
  const ambitoIA = obraId || 'sin-obra';
  const { recomendaciones: recsIA } = useBarridoIA('mapeo', ambitoIA);

  const visibles = uM(() => {
    const t = busca.trim().toLowerCase();
    return filas.filter(f => {
      if (t && !String(f.nombre || '').toLowerCase().includes(t)) return false;
      if (filtro === 'ia') return f.estado !== 'decididas' && f.estado !== 'sin_clasificar' && !!recsIA[f.norm];
      if (filtro === 'pendientes') return f.estado !== 'decididas' && f.estado !== 'sin_clasificar';
      return f.estado === filtro;
    });
  }, [filas, filtro, busca, recsIA]);

  const enPantalla = uM(() => visibles.slice(0, limite), [visibles, limite]);

  const opcionesPresupuesto = uM(() => presupuesto.map(p => ({
    value: p.codigo,
    label: `${p.nombre} — ${cant(p.cantidad)} ${p.unidad} · ${p.clasificacionNombre}`,
  })), [presupuesto]);

  // Los candidatos que ve la IA, en este orden: lo que el motor local ya
  // puntuó, después los de la MISMA clasificación (donde casi siempre está),
  // y al final los que comparten alguna palabra. Tope 50: mandarle un
  // presupuesto de miles de líneas no mejora la respuesta, y llenar con
  // filas al azar solo invita a que elija cualquiera.
  const candidatosIA = uC((f) => {
    const vistos = new Set();
    const out = [];
    const push = (p) => {
      if (!p || vistos.has(p.codigo) || out.length >= 50) return;
      vistos.add(p.codigo);
      out.push({ codigo: p.codigo, nombre: p.nombre, unidad: p.unidad, clasificacion: p.clasificacionNombre });
    };
    for (const c of (f?.sug?.candidatos || [])) push(porCodigo.get(c?.cat?.codigo));
    for (const p of presupuesto) if (p.clasificacion && p.clasificacion === f?.clasificacion) push(p);
    const tok = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter(t => t.length > 2);
    const propios = new Set(tok(f?.nombre));
    if (propios.size) for (const p of presupuesto) if (tok(p.nombre).some(t => propios.has(t))) push(p);
    return out;
  }, [presupuesto, porCodigo]);

  // ── Acciones ─────────────────────────────────────────────────────
  // Mismo criterio que la bandeja: con `{ silencioso: true }` de último
  // argumento (el barrido de IA), el error se relanza en vez de tragarse —
  // así ejecutarBarridoIA lo cuenta como error del ítem y no como aplicado.
  const conGuard = (fn) => async (...args) => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    const opts = args[args.length - 1];
    const silencioso = !!(opts && typeof opts === 'object' && opts.silencioso);
    try { await fn(...args); }
    catch (e) { if (silencioso) throw e; showToast?.('Error: ' + (e?.message || e), 'red'); }
    finally { guardandoRef.current = false; }
  };

  const insumoElegidoDe = (f) => {
    const cod = elegido[f.norm] || f.sug?.candidatos?.[0]?.cat?.codigo || null;
    return cod ? porCodigo.get(cod) || null : null;
  };

  // `codigoOverride`: para el barrido de IA, que decide programáticamente sin
  // pasar por el estado `elegido` (evita la carrera de leer un state recién
  // seteado en el mismo tick — setElegido() es async). `silencioso`: sin
  // toast — el barrido recorre cientos de filas y muestra su propio progreso.
  // `desdeIA`: la confianza de la recomendación, cuando lo que se acepta salió
  // del recorrido con IA. Deja la marca «Recomendado por IA» en `nota`.
  const aceptar = conGuard(async (f, codigoOverride = null, { silencioso = false, desdeIA = null } = {}) => {
    const destino = codigoOverride ? (porCodigo.get(codigoOverride) || null) : insumoElegidoDe(f);
    if (!destino) { if (!silencioso) showToast?.('Elegí primero el insumo del presupuesto.', 'amber'); return; }
    const fac = factorPropuesto(f, destino);
    await decidirMapeo(decisionDeMapeo(f, destino, {
      obraId, companyId,
      factor: fac?.factor ?? null, factorFuente: fac?.fuente ?? null,
      score: f.sug?.candidatos?.[0]?.score ?? null,
      nota: desdeIA != null ? notaDeIA(desdeIA) : null,
    }), { userId });
    olvidarRecomendacion('mapeo', ambitoIA, f.norm);
    await mapHook.refresh?.();
    if (!silencioso) showToast?.(`✓ «${f.nombre}» → ${destino.nombre}`, 'green');
  });

  const noEsta = conGuard(async (f) => {
    await decidirMapeo(decisionNoEsta(f, { obraId, companyId }), { userId });
    olvidarRecomendacion('mapeo', ambitoIA, f.norm);
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
    for (const f of conPropuesta) olvidarRecomendacion('mapeo', ambitoIA, f.norm);
    await mapHook.refresh?.();
    showToast?.(`✓ ${n} insumos mapeados de una`, 'green');
  });

  // ── El recorrido completo con IA (14-sep) ─────────────────────────
  // «Lo mismo para mapeo»: recorre TODOS los pendientes del trabajo elegido
  // (no solo los que ya tenían candidato local) y deja la propuesta al lado
  // de cada fila, para aceptarla mirándola. Conservador con el "no encontró
  // equivalente": solo propone cuando la IA SÍ da un código — un "no está"
  // mal puesto esconde un mapeo real.
  const pendientesMapeo = uM(
    () => filas.filter(f => f.estado !== 'decididas' && f.estado !== 'sin_clasificar'),
    [filas],
  );
  const modeloTextoIA = uM(() => modelosDe(cfgIA || [], 'clasificacion').texto, [cfgIA]);

  const construirBarrido = uC((modo) => ({
    items: pendientesMapeo,
    procesarItem: async (f) => {
      const lista = candidatosIA(f);
      if (!lista.length) return 'saltada';
      const r = await mapearInsumoConIA({
        insumo: f.nombre, unidad: f.unidad || '', clasificacion: f.clasificacionNombre || '',
        candidatos: lista, obraId, modeloTexto: modeloTextoIA,
      });
      const cod = r?.result?.codigo_sugerido;
      if (!cod) return 'saltada';
      const conf = r.confianza || 0;
      if (modo === 'aplicar') {
        if (conf < UMBRAL_BARRIDO_IA) return 'saltada';
        await aceptar(f, cod, { silencioso: true, desdeIA: conf });
        return 'aplicada';
      }
      guardarRecomendacion('mapeo', ambitoIA, f.norm, {
        codigo: cod, nombre: porCodigo.get(cod)?.nombre || cod,
        confianza: conf, razonamiento: r.razonamiento || '',
      });
      return 'recomendada';
    },
  }), [pendientesMapeo, candidatosIA, obraId, ambitoIA, porCodigo, aceptar]);

  // ── Render ───────────────────────────────────────────────────────
  const sinPresupuesto = !!obraId && !ipsHook.loading && presupuesto.length === 0;
  const nRecomendadasIA = pendientesMapeo.filter(f => recsIA[f.norm]).length;

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
                <div style={{ marginTop: 10 }}>
                  <BarridoIA
                    seccion="mapeo"
                    ambito={ambitoIA}
                    etiqueta="lo pendiente"
                    cantidadPendiente={pendientesMapeo.length}
                    cantidadRecomendadas={nRecomendadasIA}
                    construir={construirBarrido}
                    onVerRecomendadas={() => setFiltro('ia')}
                  />
                </div>
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
                  {(nRecomendadasIA > 0 || filtro === 'ia') && (
                    <button className={`btn btn-sm ${filtro === 'ia' ? 'btn-amber' : 'btn-ghost'}`}
                      title="Lo que dejó propuesto el recorrido con IA. Se aceptan de a una, mirándolas."
                      onClick={() => setFiltro('ia')}>
                      🤖 Recomendadas por IA ({nRecomendadasIA})
                    </button>
                  )}
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
                    candidatosIA={candidatosIA}
                    modeloTexto={modeloTextoIA}
                    obraId={obraId}
                    recIA={recsIA[f.norm] || null}
                    onAceptarIA={(rec) => aceptar(f, rec.codigo, { desdeIA: rec.confianza })}
                    onDescartarIA={() => olvidarRecomendacion('mapeo', ambitoIA, f.norm)}
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
function FilaMapeo({ f, opciones, candidatosIA, obraId, recIA = null, onAceptarIA, onDescartarIA, elegido, onElegir, destino, onAceptar, onNoEsta, onDeshacer, modeloTexto = null }) {
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
            {esDecisionDeIA(f.decision) && <SelloIA titulo={f.decision?.nota} />}
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
            {/* Lo que dejó el recorrido con IA. Va APARTE del desplegable a
                propósito: meterlo adentro haría que «Aceptar» guardara una
                elección que nadie hizo. */}
            {recIA?.codigo && (
              <RecomendacionIA
                titulo={<>Mapearlo a <strong>{recIA.nombre || recIA.codigo}</strong></>}
                confianza={recIA.confianza}
                razonamiento={recIA.razonamiento}
                onAceptar={() => onAceptarIA?.(recIA)}
                onDescartar={() => onDescartarIA?.()}
              />
            )}
            <div style={{ maxWidth: 460, marginTop: 5 }}>
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
            {candidatosIA && <AyudaMapeoIA fila={f} candidatosIA={candidatosIA} obraId={obraId} onElegir={onElegir} modeloTexto={modeloTexto} />}
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
