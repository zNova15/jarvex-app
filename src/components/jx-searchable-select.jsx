// ═══════════════════════════════════════════════════════════════════
// JARVEX — SearchableSelect
//
// Dropdown con input de búsqueda arriba. Reemplaza al <select> nativo
// cuando hay muchas opciones (ej: lista de personal, materiales,
// proveedores). Mantiene el mismo look-and-feel de la clase .fi.
//
// Uso:
//   <SearchableSelect
//     value={form.responsable_id}
//     onChange={v => setForm({ ...form, responsable_id: v })}
//     options={[{ value: 'a', label: 'Pedro' }, ...]}
//     placeholder="— Selecciona —"
//   />
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { createPortal } from "react-dom";

const { useState, useEffect, useRef, useMemo, useLayoutEffect, useCallback } = React;

function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '— Selecciona —',
  emptyText = 'Sin resultados',
  className,
  style,
  fontSize,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  // El dropdown se renderiza vía portal a <body> con position:fixed para que
  // NO lo recorte ningún ancestro con overflow (ej. el wrapper overflowX:auto
  // de las tablas de lote en almacén/EPP/herramientas, o el propio .modal con
  // overflow-y:auto). Anclamos por getBoundingClientRect del botón trigger.
  const [coords, setCoords] = useState(null); // { left, top, bottom, width, openUp }
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);

  const recompute = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const espacioAbajo = vh - r.bottom;
    // Si abajo no caben ~220px y arriba hay más espacio, abrimos hacia arriba.
    const openUp = espacioAbajo < 220 && r.top > espacioAbajo;
    setCoords({ left: r.left, top: r.top, bottom: r.bottom, width: r.width, openUp });
  }, []);

  const selected = useMemo(
    () => options.find(o => String(o.value ?? '') === String(value ?? '')),
    [options, value]
  );
  const labelMostrado = selected?.label || placeholder;

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(o => String(o.label ?? '').toLowerCase().includes(q));
  }, [options, search]);

  // Posicionar el dropdown al abrir (antes del paint para evitar parpadeo).
  useLayoutEffect(() => {
    if (open) recompute();
    else setCoords(null);
  }, [open, recompute]);

  // Re-anclar en scroll (de cualquier ancestro, capture) y resize mientras
  // está abierto, para que el dropdown fixed siga al botón.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => recompute();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, recompute]);

  // Focus al abrir
  useEffect(() => {
    if (open && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Click outside cierra. El dropdown vive en un portal a <body>, así que el
  // contains() del container NO lo cubre — chequeamos también el dropdownRef.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      const inContainer = containerRef.current && containerRef.current.contains(e.target);
      const inDropdown = dropdownRef.current && dropdownRef.current.contains(e.target);
      if (!inContainer && !inDropdown) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  // Esc cierra
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setSearch('');
    }
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      // Saltar opciones disabled (ej. capítulos no elegibles).
      const primera = filtered.find(o => !o.disabled);
      if (!primera) return;
      onChange(primera.value);
      setOpen(false);
      setSearch('');
    }
  };

  const baseFontSize = fontSize ?? 13;

  return (
    <div ref={containerRef} style={{ position: 'relative', ...(style || {}) }} className={className}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className="fi"
        style={{
          width: '100%',
          textAlign: 'left',
          cursor: disabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 6,
          fontSize: baseFontSize,
          color: selected ? 'var(--tp)' : 'var(--tm)',
          opacity: disabled ? 0.6 : 1,
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {labelMostrado}
        </span>
        <span style={{ color: 'var(--tm)', fontSize: 10, flexShrink: 0 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && coords && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            left: coords.left,
            width: coords.width,
            // Hacia abajo: justo bajo el botón. Hacia arriba: sobre el botón.
            ...(coords.openUp
              ? { bottom: Math.max(8, (window.innerHeight || 0) - coords.top + 4) }
              : { top: coords.bottom + 4 }),
            background: 'var(--bg-c)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 3000,
            maxHeight: 320,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
          <div style={{ padding: 6, borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              className="fi"
              placeholder="Buscar…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{ width: '100%', fontSize: 12 }}
              autoComplete="off"
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: 260 }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '14px 10px', fontSize: 11.5, color: 'var(--tm)', textAlign: 'center' }}>
                {emptyText}
              </div>
            ) : (
              filtered.map((o, i) => {
                const esActivo = String(o.value ?? '') === String(value ?? '');
                // disabled: visible (da contexto, ej. capítulos del árbol de
                // partidas) pero no clickeable ni elegible con Enter.
                if (o.disabled) {
                  return (
                    <div key={(o.value ?? '') + '-' + i}
                      style={{ width: '100%', padding: '7px 10px', textAlign: 'left', color: 'var(--tm)',
                        borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600,
                        fontFamily: 'inherit', cursor: 'default', opacity: 0.75 }}>
                      {o.label}
                    </div>
                  );
                }
                return (
                  <button
                    key={(o.value ?? '') + '-' + i}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                      setSearch('');
                    }}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      textAlign: 'left',
                      background: esActivo ? 'rgba(242,183,5,0.14)' : 'transparent',
                      color: esActivo ? 'var(--amber, #F2B705)' : 'var(--tp)',
                      border: 'none',
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: esActivo ? 600 : 400,
                      fontFamily: 'inherit',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => {
                      if (!esActivo) e.currentTarget.style.background = 'var(--tint-neutral)';
                    }}
                    onMouseLeave={e => {
                      if (!esActivo) e.currentTarget.style.background = 'transparent';
                    }}>
                    {o.label}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

Object.assign(window, { SearchableSelect });
export { SearchableSelect };
