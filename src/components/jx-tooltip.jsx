import React from "react";

// ═══════════════════════════════════════════════════════════════════
// JARVEX — Tooltip contextual con icono (?)
//
// Uso:
//   <Tooltip text="Explicación del campo">
//     <label>Campo complejo</label>
//   </Tooltip>
//
// O standalone (icono ?):
//   <TooltipIcon text="Qué es esto..."/>
// ═══════════════════════════════════════════════════════════════════

export function Tooltip({ children, text, placement = 'top' }) {
  if (!text) return children;
  return (
    <span className="jx-tt-wrap">
      {children}
      <span className={`jx-tt jx-tt-${placement}`} role="tooltip">{text}</span>
    </span>
  );
}

export function TooltipIcon({ text, placement = 'top', size = 12 }) {
  if (!text) return null;
  return (
    <span className="jx-tt-wrap" style={{ display:'inline-flex', alignItems:'center', marginLeft:6 }}>
      <span
        className="jx-tt-icon"
        style={{
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          width: size + 4, height: size + 4,
          borderRadius:'50%',
          background:'rgba(155,89,182,0.15)',
          color:'#9B59B6',
          fontSize: size, fontWeight:700,
          cursor:'help',
          lineHeight: 1,
          border:'1px solid rgba(155,89,182,0.3)',
        }}>?</span>
      <span className={`jx-tt jx-tt-${placement}`} role="tooltip">{text}</span>
    </span>
  );
}

// Helper para envolver labels de fields complejos:
// <FieldLabel text="Campo" hint="Explicación..."/>
export function FieldLabel({ text, hint, required }) {
  return (
    <label className="flabel" style={{ display:'inline-flex', alignItems:'center' }}>
      {text}{required && ' *'}
      {hint && <TooltipIcon text={hint}/>}
    </label>
  );
}

// Registro global (en window) para uso en componentes JSX legacy
if (typeof window !== 'undefined') {
  window.JxTooltip = Tooltip;
  window.JxTooltipIcon = TooltipIcon;
  window.JxFieldLabel = FieldLabel;
}

export default Tooltip;
