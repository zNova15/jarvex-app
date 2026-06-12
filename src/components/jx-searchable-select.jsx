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

const { useState, useEffect, useRef, useMemo } = React;

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
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);

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

  // Focus al abrir
  useEffect(() => {
    if (open && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Click outside cierra
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
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

      {open && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--bg-c, #1A2533)',
            border: '1px solid var(--bd, #2A3543)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            zIndex: 2000,
            maxHeight: 320,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}>
          <div style={{ padding: 6, borderBottom: '1px solid var(--bd, #2A3543)' }}>
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
                        borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 12, fontWeight: 600,
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
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: esActivo ? 600 : 400,
                      fontFamily: 'inherit',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => {
                      if (!esActivo) e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
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
        </div>
      )}
    </div>
  );
}

Object.assign(window, { SearchableSelect });
export { SearchableSelect };
