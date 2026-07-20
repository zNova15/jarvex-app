// ═══════════════════════════════════════════════════════════════════
// JARVEX — Botón "?" de AYUDA del Header (pedido de Gabriel, jul 2026).
//
// Un solo botón global (arriba a la derecha, junto al badge de sync) que
// muestra la ayuda de la SECCIÓN ACTIVA, personalizada por el ROL del
// usuario. El contenido vive en lib/ayuda-contenido.js — para agregar o
// actualizar ayuda NO se toca este componente.
// ═══════════════════════════════════════════════════════════════════
import React from 'react';
import { ayudaDe } from '../lib/ayuda-contenido.js';

const { useState, useEffect } = React;

export default function BotonAyuda({ page, rol }) {
  const [open, setOpen] = useState(false);

  // Cerrar al navegar a otra sección (la ayuda es de la sección activa).
  useEffect(() => { setOpen(false); }, [page]);
  // Cerrar con Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const info = ayudaDe(page, rol);

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ghost btn-icon" aria-label="Ayuda de esta sección"
        title={`Ayuda: ${info.titulo}`}
        onClick={() => setOpen(o => !o)}
        style={{ fontWeight: 800, fontSize: 13.5, color: open ? 'var(--amber)' : 'var(--tm)', width: 30, height: 30, borderRadius: '50%', border: '1px solid var(--border)' }}>
        ?
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 190, background: 'rgba(0,0,0,0.35)' }}/>
          <div role="dialog" aria-label={`Ayuda: ${info.titulo}`}
            style={{ position: 'absolute', top: 38, right: 0, width: 'min(440px, calc(100vw - 24px))', maxHeight: '72vh', overflow: 'auto',
              background: 'var(--bg-c)', border: '1px solid var(--border)', borderRadius: 12,
              boxShadow: '0 12px 40px rgba(0,0,0,0.55)', zIndex: 200, padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>💡</span>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--tp)', flex: 1 }}>{info.titulo}</div>
              <button className="btn btn-ghost btn-icon" aria-label="Cerrar ayuda" onClick={() => setOpen(false)} style={{ fontSize: 14, color: 'var(--tm)' }}>✕</button>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ts)', lineHeight: 1.55 }}>{info.que}</div>
            {info.como.length > 0 && (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm)', letterSpacing: '.05em', textTransform: 'uppercase', margin: '12px 0 6px' }}>¿Cómo se usa?</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {info.como.map((c, i) => (
                    <li key={i} style={{ fontSize: 12, color: 'var(--ts)', lineHeight: 1.5 }}>{c}</li>
                  ))}
                </ul>
              </>
            )}
            {info.notaRol && (
              <div style={{ marginTop: 12, padding: '9px 11px', borderRadius: 8, background: 'rgba(242,183,5,0.08)', border: '1px solid rgba(242,183,5,0.30)', fontSize: 12, color: 'var(--ts)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--amber)' }}>Para tu rol: </strong>{info.notaRol}
              </div>
            )}
            {info.notaRolGeneral && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--tm)', lineHeight: 1.5 }}>{info.notaRolGeneral}</div>
            )}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 10.5, color: 'var(--tm)' }}>
              Esta ayuda se actualiza junto con cada mejora de la app.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
