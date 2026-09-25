// Filtros de ORDEN y FECHAS de los registros de movimientos (materiales,
// herramientas, EPP, insumos de emergencia). Pedido de Gabriel el 24-set-2026:
// no se podía ordenar de lo más antiguo a lo más reciente ni acotar por fechas.
// La lógica vive en src/lib/registro-movimientos.js (pura, con tests); esto es
// solo la barra. Se importa estático desde módulos lazy: es un componente hoja,
// sin efectos al cargar (no hay riesgo de la regla 1 del CLAUDE.md).
import React from "react";
import {
  ORDENES_REGISTRO, ORDEN_REGISTRO_LABEL, PRESETS_RANGO, PRESET_RANGO_LABEL,
  rangoDePreset, filtrarPorRango, ordenarMovimientos,
} from "../lib/registro-movimientos.js";

const hoyLocal = () => window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10);

/**
 * Estado + aplicación de los filtros. Devuelve la lista ya ordenada y acotada
 * por fechas, más lo que la barra necesita. Se llama ANTES de cualquier early
 * return del componente (regla 3).
 */
export function useFiltrosRegistro(movs, ordenInicial = 'fecha_desc') {
  const [orden, setOrden] = React.useState(ordenInicial);
  const [preset, setPreset] = React.useState('todo');
  const [personalizado, setPersonalizado] = React.useState({ desde: '', hasta: '' });
  const rango = React.useMemo(() => rangoDePreset(preset, hoyLocal(), personalizado), [preset, personalizado]);
  const lista = React.useMemo(
    () => ordenarMovimientos(filtrarPorRango((movs || []).filter(m => !m.deleted_at), rango), orden),
    [movs, rango, orden],
  );
  const activo = orden !== ordenInicial || preset !== 'todo';
  const limpiar = () => { setOrden(ordenInicial); setPreset('todo'); setPersonalizado({ desde: '', hasta: '' }); };
  return { lista, orden, setOrden, preset, setPreset, personalizado, setPersonalizado, rango, activo, limpiar };
}

/** La barra: orden + rango de fechas (+ desde/hasta si es personalizado). */
export function FiltrosRegistro({ f, total, visibles }) {
  const selStyle = { width: 'auto', minWidth: 170, fontSize: 12.5, padding: '5px 8px' };
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tm)' }}>
        Orden
        <select className="fi" style={selStyle} value={f.orden} onChange={e => f.setOrden(e.target.value)}
          title="«Últimos cargados» pone arriba lo que se REGISTRÓ más recientemente, aunque su fecha sea de hace días.">
          {ORDENES_REGISTRO.map(o => <option key={o} value={o}>{ORDEN_REGISTRO_LABEL[o]}</option>)}
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--tm)' }}>
        Fechas
        <select className="fi" style={selStyle} value={f.preset} onChange={e => f.setPreset(e.target.value)}
          title="Filtra por la FECHA DEL MOVIMIENTO (no por cuándo se cargó).">
          {PRESETS_RANGO.map(p => <option key={p} value={p}>{PRESET_RANGO_LABEL[p]}</option>)}
        </select>
      </label>
      {f.preset === 'personalizado' && (
        <>
          <input className="fi" type="date" style={{ ...selStyle, minWidth: 0 }} value={f.personalizado.desde}
            onChange={e => f.setPersonalizado(p => ({ ...p, desde: e.target.value }))} aria-label="Desde" />
          <span style={{ fontSize: 12, color: 'var(--tm)' }}>a</span>
          <input className="fi" type="date" style={{ ...selStyle, minWidth: 0 }} value={f.personalizado.hasta}
            onChange={e => f.setPersonalizado(p => ({ ...p, hasta: e.target.value }))} aria-label="Hasta" />
        </>
      )}
      {f.activo && (
        <button className="btn btn-sm btn-ghost" onClick={f.limpiar}>✕ Quitar orden y fechas</button>
      )}
      {typeof total === 'number' && typeof visibles === 'number' && visibles !== total && (
        <span style={{ fontSize: 11.5, color: 'var(--tm)', marginLeft: 'auto' }}>
          Mostrando {visibles.toLocaleString('es-PE')} de {total.toLocaleString('es-PE')}
        </span>
      )}
    </div>
  );
}
