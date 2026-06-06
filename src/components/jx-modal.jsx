// Modal compartido — extraído de jx-almacen.jsx para que pueda cargarse
// eager (~200B) y permitir que jx-almacen pase a lazy. Decenas de páginas
// usan <Modal> sin importarlo, vía window.Modal global.
import React from "react";

function Modal({ title, icon, onClose, children, wide, size }) {
  // OJO: .modal tiene width: min(600px, 95vw), así que setear solo maxWidth NO
  // ensancha (el width 600 ya manda). Hay que pisar `width`.
  const sz = size || (wide ? 'wide' : null);
  const wStyle = sz === 'xl' ? { width: 'min(1120px, 96vw)', maxWidth: 'none' }
    : sz === 'wide' ? { width: 'min(880px, 95vw)', maxWidth: 'none' }
    : {};
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxHeight: '92vh', ...wStyle }}>
        <div className="modal-hd">
          <div className="modal-hd-left">
            {icon && (
              <div style={{ width:32, height:32, borderRadius:8, background:'rgba(242,183,5,.12)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <JxIcon name={icon} size={15} color="var(--amber)" />
              </div>
            )}
            <span>{title}</span>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon"><JxIcon name="x" size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

Object.assign(window, { Modal });
