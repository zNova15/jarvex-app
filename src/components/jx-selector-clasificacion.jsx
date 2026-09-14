// ═══════════════════════════════════════════════════════════════════
// JARVEX — Selector de clasificación con BÚSQUEDA (14-sep-2026).
//
// Reemplaza el <select> nativo de ~95 opciones (Insumos IUPC + Servicios +
// Complementarias + propias) que usaban `OpcionesCategoria` en
// jx-catalogo-canonico.jsx y jx-bandeja-categorizacion.jsx. Gabriel: «quiero
// que pueda escribir lo que busco y me salga rápidamente la clasificación
// que busco, en caso desee cambiar la clasificación de una sugerencia» —
// desplazar un <select> de 95 filas para corregir UNA sugerencia mal es
// exactamente lo que este componente evita.
//
// Usa <input list="…"> + <datalist>, el mismo patrón nativo que ya usa el
// formulario "Unir dos insumos manualmente" de Correlaciones — sin librería
// nueva, con el autocompletar y filtrado del propio navegador.
//
// RENDIMIENTO: el <datalist> con las ~95 opciones se renderiza UNA sola vez
// por pantalla (<ClasificacionDatalist>, arriba de todo) y cada fila solo
// pone un <input list={ID}> liviano. Con una tabla de 200 filas, repetir el
// datalist entero en cada una serían ~19.000 nodos <option> de más — la
// pantalla de "Insumos y servicios" ya tiene ese volumen de filas.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { normIUPC } from "../lib/indices-unificados-iupc.js";

const { useMemo: uM, useState: uS, useEffect: uE } = React;

/** El <datalist> compartido — montarlo UNA vez por pantalla, arriba de las filas. */
function ClasificacionDatalist({ id, opciones }) {
  return (
    <datalist id={id}>
      {opciones.map(o => <option key={o.codigo} value={o.label} />)}
    </datalist>
  );
}

/**
 * `listId`: el id del <ClasificacionDatalist> compartido de la pantalla.
 * `opciones`: el mismo array que recibió ese datalist (para resolver texto→código).
 * `value`: código actual. `onChange(codigo)`: se llama SOLO cuando el texto
 * escrito matchea una opción exacta (clic en la lista, o tipeo completo) —
 * nunca con un código a medio escribir.
 * `actualLabel`: si `value` no está entre `opciones` (p.ej. "sin_clasificar" o
 * vocabulario viejo), la etiqueta a mostrar igual — el campo no se ve vacío,
 * pero para cambiarlo hay que escribir y elegir una opción real de la lista.
 */
function SelectorClasificacion({
  listId, opciones, value, onChange, actualLabel = null,
  placeholder = 'Escribí para buscar…', disabled = false, style, className = 'fi',
  onClick, title,
}) {
  const porCodigo = uM(() => new Map(opciones.map(o => [o.codigo, o])), [opciones]);
  const porLabelNorm = uM(() => new Map(opciones.map(o => [normIUPC(o.label), o])), [opciones]);
  const actual = porCodigo.get(value);
  const labelActual = actual?.label ?? actualLabel ?? '';

  const [texto, setTexto] = uS(labelActual);
  // Si el valor cambia desde AFUERA (otra fila se aceptó, refrescó el hook…),
  // resincronizar el texto mostrado — si no, el input queda mostrando lo
  // último tipeado aunque el dato real ya haya cambiado.
  uE(() => { setTexto(labelActual); }, [labelActual]);

  const commit = (crudo) => {
    const hit = porLabelNorm.get(normIUPC(crudo));
    if (hit) {
      setTexto(hit.label);
      if (hit.codigo !== value) onChange?.(hit.codigo);
    } else {
      setTexto(labelActual); // no matchea ninguna opción real: se revierte
    }
  };

  return (
    <input
      className={className}
      style={style}
      list={listId}
      disabled={disabled}
      value={texto}
      placeholder={placeholder}
      title={title}
      onClick={onClick}
      onChange={e => setTexto(e.target.value)}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(e.target.value); e.target.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); setTexto(labelActual); e.target.blur(); }
      }}
    />
  );
}

Object.assign(window, { SelectorClasificacion, ClasificacionDatalist });
export { SelectorClasificacion, ClasificacionDatalist };
