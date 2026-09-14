// ═══════════════════════════════════════════════════════════════════
// JARVEX — Botón + progreso del "recorrido completo con IA" (14-sep-2026).
// Un solo componente para las tres secciones (clasificar, correlacionar,
// mapear) — ver el encabezado de src/lib/barrido-ia.js.
// ═══════════════════════════════════════════════════════════════════
import React from "react";

const { useState: uS, useRef: uR } = React;

/**
 * `cantidadPendiente`: lo que hay para recorrer AHORA (solo para el número
 * del botón antes de arrancar — el recorrido real lo decide `onEjecutar`).
 * `onEjecutar({ onProgreso, debeCancelar })`: hace el trabajo (normalmente
 * un solo `await ejecutarBarridoIA(...)`) y devuelve su estado final.
 */
function BarridoIA({ etiqueta, cantidadPendiente, onEjecutar, disabled = false }) {
  const [estado, setEstado] = uS(null); // null = todavía no se corrió
  const cancelarRef = uR(false);
  // Anti-doble-click (regla crítica 2 del CLAUDE.md): el guard por ESTADO
  // (`estado?.activo`) tiene carrera — se activa recién tras el primer
  // `await` de `onEjecutar`, y dos clics en esa ventana lanzarían dos
  // barridos concurrentes peleando por los mismos `decidiendoRef`/
  // `guardandoRef` de la pantalla. El ref síncrono corta el segundo click
  // en el mismo tick, antes de que exista ningún `await` de por medio.
  const corriendoRef = uR(false);

  const empezar = async () => {
    if (corriendoRef.current) return;
    corriendoRef.current = true;
    cancelarRef.current = false;
    setEstado({ activo: true, i: 0, total: cantidadPendiente, aplicadas: 0, saltadas: 0, errores: 0 });
    let final = null;
    try {
      final = await onEjecutar({
        onProgreso: (p) => setEstado(e => ({ ...e, ...p, activo: true })),
        debeCancelar: () => cancelarRef.current,
      });
    } finally {
      corriendoRef.current = false;
      setEstado(e => ({ ...(final || e), activo: false }));
    }
  };

  if (!estado) {
    return (
      <button type="button" className="btn btn-sm btn-blue" disabled={disabled || !cantidadPendiente} onClick={empezar}
        title={!cantidadPendiente ? 'No hay nada pendiente para recorrer' : `Le pregunta a la IA una por una a las ${cantidadPendiente} pendientes y aplica sola las que salgan con confianza alta`}>
        🤖 Recorrer {etiqueta} con IA ({cantidadPendiente})
      </button>
    );
  }

  return (
    <div className="card card-p" style={{ borderLeft: '3px solid var(--blue)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 12.5 }}>
          {estado.activo ? `🤖 Recorriendo ${etiqueta}… ${estado.i} de ${estado.total}` : '🤖 Barrido terminado'}
        </strong>
        {estado.activo ? (
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => { cancelarRef.current = true; }}>
            Cancelar
          </button>
        ) : (
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setEstado(null)}>Cerrar</button>
        )}
      </div>
      <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--bg-s)', marginTop: 6 }}>
        <div style={{ width: `${estado.total ? Math.min(100, (estado.i / estado.total) * 100) : 0}%`, background: 'var(--blue)', transition: 'width .2s' }} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 6 }}>
        ✓ <strong>{estado.aplicadas}</strong> aplicadas · <strong>{estado.saltadas}</strong> quedaron para revisar a mano (confianza baja)
        {estado.errores > 0 && <> · ⚠ {estado.errores} con error</>}
        {estado.cancelado && <> · cancelado — lo aplicado hasta acá queda guardado</>}
      </div>
    </div>
  );
}

Object.assign(window, { BarridoIA });
export { BarridoIA };
