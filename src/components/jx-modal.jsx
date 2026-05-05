// Modal compartido — extraído de jx-almacen.jsx para que pueda cargarse
// eager (~200B) y permitir que jx-almacen pase a lazy. Decenas de páginas
// usan <Modal> sin importarlo, vía window.Modal global.
import React from "react";

function Modal({ title, icon, onClose, children, wide }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 700 } : {}}>
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
