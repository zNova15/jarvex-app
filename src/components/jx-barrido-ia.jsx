// ═══════════════════════════════════════════════════════════════════
// JARVEX — Botón + progreso del "recorrido completo con IA" (14-sep-2026).
// Un solo componente para las tres secciones (clasificar, correlacionar,
// mapear) — ver el encabezado de src/lib/barrido-ia.js.
//
// Este componente NO es dueño de nada: el recorrido vive en
// `src/lib/barrido-store.js` (fuera de React) y acá solo se dibuja. Por eso
// cambiar de pestaña ya no lo corta, y al volver la barra sigue donde estaba.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  arrancarBarrido, cancelarBarrido, cerrarBarrido, estadoBarrido, barridoActivo,
  suscribir, leerRecomendaciones, limpiarRecomendaciones,
} from "../lib/barrido-store.js";

const { useState: uS, useEffect: uE, useMemo: uM, useRef: uR, useCallback: uC } = React;

/**
 * Lo que necesita una pantalla para dibujar su recorrido: el estado (o null)
 * y las recomendaciones pendientes de ese ámbito, redibujándose solas cuando
 * el recorrido —que corre afuera— avanza.
 */
function useBarridoIA(seccion, ambito) {
  const [tic, setTic] = uS(0);
  uE(() => suscribir(seccion, () => setTic(t => t + 1)), [seccion]);
  const estado = estadoBarrido(seccion);
  const recomendaciones = uM(
    () => leerRecomendaciones(seccion, ambito),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seccion, ambito, tic],
  );
  const activo = !!estado?.activo;
  return { estado, recomendaciones, activo, tic };
}

/**
 * `construir(modo)` devuelve `{ items, procesarItem }` — lo que hay que
 * recorrer y qué hacer con cada uno. Se llama al apretar el botón, así que
 * ve la lista de ese momento.
 * `onVerRecomendadas()`: opcional, para que el cartel pueda llevar al filtro
 * «solo las recomendadas por IA» de la pantalla.
 */
function BarridoIA({ seccion, ambito = null, etiqueta, cantidadPendiente, construir, onVerRecomendadas, disabled = false }) {
  const { estado, recomendaciones } = useBarridoIA(seccion, ambito);
  const [modo, setModo] = uS('recomendar');
  // Anti-doble-click (regla crítica 2 del CLAUDE.md): el guard por ESTADO se
  // activa recién tras el primer `await`, y dos clics en esa ventana lanzarían
  // dos recorridos. El ref síncrono corta el segundo en el mismo tick.
  const arrancandoRef = uR(false);

  const nRecomendadas = Object.keys(recomendaciones || {}).length;

  const empezar = uC(() => {
    if (arrancandoRef.current || barridoActivo(seccion)) return;
    arrancandoRef.current = true;
    try {
      const { items, procesarItem } = construir(modo) || {};
      if (!items?.length || !procesarItem) return;
      arrancarBarrido({ seccion, ambito, etiqueta, items, procesarItem, modo })
        .catch(() => { /* el cartel ya muestra el corte; no hay a quién relanzarlo */ })
        .finally(() => { arrancandoRef.current = false; });
    } finally {
      // Si `construir` tiró o no había nada, el ref se suelta acá mismo; si
      // arrancó, lo suelta el `.finally` de arriba.
      if (!barridoActivo(seccion)) arrancandoRef.current = false;
    }
  }, [seccion, ambito, etiqueta, modo, construir]);

  // ── Sin recorrido en curso ni terminado: el botón y el modo ──────
  if (!estado) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm btn-blue" disabled={disabled || !cantidadPendiente} onClick={empezar}
          title={!cantidadPendiente ? 'No hay nada pendiente para recorrer'
            : `Le pregunta a la IA una por una a las ${cantidadPendiente} pendientes${modo === 'aplicar' ? ' y guarda sola las de confianza alta' : ' y deja la propuesta al lado de cada fila, para que la mires vos'}`}>
          🤖 Recorrer {etiqueta} con IA ({cantidadPendiente})
        </button>
        <SelectorModo modo={modo} setModo={setModo} />
        {nRecomendadas > 0 && (
          <RecomendacionesListas
            n={nRecomendadas} seccion={seccion} ambito={ambito} onVer={onVerRecomendadas}
          />
        )}
      </div>
    );
  }

  // ── Corriendo o terminado ────────────────────────────────────────
  const pctFilas = estado.total ? Math.min(100, (estado.i / estado.total) * 100) : 0;
  return (
    <div className="card card-p" style={{ borderLeft: '3px solid var(--blue)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12.5 }}>
          {estado.activo
            ? `🤖 Recorriendo ${estado.etiqueta || etiqueta}… ${estado.i} de ${estado.total}`
            : '🤖 Recorrido terminado'}
        </strong>
        {estado.activo ? (
          <>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => cancelarBarrido(seccion)}>
              Cancelar
            </button>
            <span style={{ fontSize: 10.5, color: 'var(--tm)' }}>
              Podés cambiar de pestaña: sigue corriendo y la sesión no se cierra mientras tanto.
            </span>
          </>
        ) : (
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => cerrarBarrido(seccion)}>Cerrar</button>
        )}
      </div>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--bg-s)', marginTop: 6 }}>
        <div style={{ width: `${pctFilas}%`, background: 'var(--blue)', transition: 'width .2s' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6 }}>
        {estado.modo === 'aplicar'
          ? <>✓ <strong>{estado.aplicadas}</strong> guardadas solas</>
          : <>🤖 <strong>{estado.recomendadas}</strong> con propuesta lista para revisar</>}
        {' '}· <strong>{estado.saltadas}</strong> sin propuesta clara (quedan para mirar a mano)
        {estado.errores > 0 && <> · ⚠ {estado.errores} con error</>}
        {estado.cancelado && <> · cancelado — lo hecho hasta acá queda</>}
      </div>
      {estado.cortado && (
        <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4 }}>
          ⚠ Se cortó solo después de varios errores seguidos{estado.ultimoError ? `: ${estado.ultimoError}` : ''}.
          {' '}Revisá la conexión (o volvé a entrar si venció la sesión) y tocá el botón otra vez: lo ya
          preguntado no se vuelve a pagar.
        </div>
      )}
      {!estado.activo && nRecomendadas > 0 && (
        <div style={{ marginTop: 8 }}>
          <RecomendacionesListas n={nRecomendadas} seccion={seccion} ambito={ambito} onVer={onVerRecomendadas} />
        </div>
      )}
    </div>
  );
}

/**
 * El modo. Por defecto RECOMENDAR — la corrección del 14-sep: la IA propone,
 * la persona acepta. «Aplicar» queda disponible («me gustaría que la dejes,
 * por si acaso») pero hay que elegirlo, y dice con todas las letras que
 * guarda sin que nadie mire.
 */
function SelectorModo({ modo, setModo }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 10.5, color: 'var(--tm)' }}>
      <button type="button" className={`btn btn-xs ${modo === 'recomendar' ? 'btn-blue' : 'btn-ghost'}`}
        onClick={() => setModo('recomendar')}
        title="La IA deja su propuesta al lado de cada fila y vos aceptás. Nada se guarda solo.">
        Solo recomendar
      </button>
      <button type="button" className={`btn btn-xs ${modo === 'aplicar' ? 'btn-amber' : 'btn-ghost'}`}
        onClick={() => setModo('aplicar')}
        title="Guarda sola las de confianza alta (75% o más), sin que nadie las mire antes.">
        Aplicar sin revisar
      </button>
    </span>
  );
}

function RecomendacionesListas({ n, seccion, ambito, onVer }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
      <span className="badge b-blue">🤖 {n} recomendadas por IA</span>
      {onVer && <button type="button" className="btn btn-xs btn-ghost" onClick={onVer}>Ver solo esas</button>}
      <button type="button" className="btn btn-xs btn-ghost"
        title="Las borra de la pantalla. No deshace nada de lo que ya aceptaste."
        onClick={() => limpiarRecomendaciones(seccion, ambito)}>
        Descartar
      </button>
    </span>
  );
}

/**
 * El bloque azul que muestra UNA recomendación de la IA al lado de su fila.
 * Igual en las tres secciones: qué propone, con cuánta confianza, por qué, y
 * dos botones — aceptar (lo guarda una persona) o descartar.
 */
function RecomendacionIA({ titulo, confianza, razonamiento, onAceptar, onDescartar, textoAceptar = 'Aceptar esta' }) {
  const pct = Math.round((confianza || 0) * 100);
  return (
    <div style={{
      marginTop: 5, padding: '5px 8px', fontSize: 10.5, borderRadius: 5, maxWidth: 520,
      background: 'rgba(58,163,255,.08)', border: '1px solid rgba(58,163,255,.35)',
    }} onClick={e => e.stopPropagation()}>
      <span className="badge b-blue" style={{ fontSize: 9 }}>🤖 Recomendado por IA</span>
      <span style={{ marginLeft: 6 }}>{titulo}</span>
      <span className="badge b-gray" style={{ marginLeft: 4, fontSize: 9 }}>{pct}%</span>
      {razonamiento && <div style={{ color: 'var(--tm)', marginTop: 2 }}>{razonamiento}</div>}
      <div style={{ display: 'flex', gap: 5, marginTop: 4 }}>
        {onAceptar && (
          <button type="button" className="btn btn-xs btn-green"
            onClick={(e) => { e.stopPropagation(); onAceptar(); }}>{textoAceptar}</button>
        )}
        {onDescartar && (
          <button type="button" className="btn btn-xs btn-ghost"
            onClick={(e) => { e.stopPropagation(); onDescartar(); }}>Descartar</button>
        )}
      </div>
    </div>
  );
}

/** El sello de las filas YA decididas que salieron de una propuesta de IA. */
function SelloIA({ titulo }) {
  return (
    <span className="badge b-blue" style={{ marginLeft: 6, fontSize: 9 }}
      title={titulo || 'Esta decisión se aceptó desde una recomendación de la IA.'}>
      🤖 Recomendado por IA
    </span>
  );
}

Object.assign(window, { BarridoIA, RecomendacionIA, SelloIA });
export { BarridoIA, RecomendacionIA, SelloIA, useBarridoIA };
