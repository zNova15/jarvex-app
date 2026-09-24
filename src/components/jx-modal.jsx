// Modal compartido — extraído de jx-almacen.jsx para que pueda cargarse
// eager (~200B) y permitir que jx-almacen pase a lazy. Decenas de páginas
// usan <Modal> sin importarlo, vía window.Modal global.
import React from "react";
import { createRoot } from "react-dom/client";

function Modal({ title, icon, onClose, children, wide, size, closeOnOverlay = true, elevated = false }) {
  // OJO: .modal tiene width: min(600px, 95vw), así que setear solo maxWidth NO
  // ensancha (el width 600 ya manda). Hay que pisar `width`.
  const sz = size || (wide ? 'wide' : null);
  const wStyle = sz === 'xl' ? { width: 'min(1120px, 96vw)', maxWidth: 'none' }
    : sz === 'wide' ? { width: 'min(880px, 95vw)', maxWidth: 'none' }
    : {};
  // `elevated`: para un modal que puede abrirse DESDE DENTRO de otro modal ya
  // abierto (el visor de un comprobante, llamado desde «Editar Movimiento» o
  // desde una fila del escáner de incoherencias). Sin esto, dos .overlay con
  // el mismo z-index se apilan por orden de aparición en el DOM y el visor
  // podía terminar pintado DETRÁS del modal que lo abrió (23-set-2026).
  return (
    <div className={elevated ? 'overlay overlay-visor' : 'overlay'} onClick={e => {
      if (closeOnOverlay !== false && e.target === e.currentTarget) onClose?.();
    }}>
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

// ── Aviso de POSIBLE DUPLICADO (24-set-2026) ────────────────────────
// Reemplaza al window.confirm() del almacén: el confirm nativo no deja mostrar
// QUÉ se registró antes, CUÁNDO ni QUIÉN, que es justo lo que la persona
// necesita para decidir ("¿esto ya lo subí?"). Vive acá (módulo eager) y se
// expone en window para que almacén, EPP y herramientas lo usen sin importar
// nada — importarlo desde varios módulos lazy crearía un chunk compartido.
//
//   const seguir = await window.__avisoDuplicado({
//     titulo, intro, grupos: [{ titulo, filas: ['…', '…'] }], pregunta,
//     textoSi, textoNo,
//   });
//
// Devuelve true SOLO si eligió registrar igual. El botón destacado (y Esc /
// clic afuera) es el que NO registra: ante la duda, no duplicar.
function AvisoDuplicado({ titulo, intro, grupos, pregunta, textoSi, textoNo, onResolver }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onResolver(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResolver]);
  return (
    <div className="overlay overlay-visor" onClick={e => { if (e.target === e.currentTarget) onResolver(false); }}>
      <div className="modal" role="alertdialog" aria-modal="true" style={{ maxHeight: '92vh', borderColor: 'var(--border-a)' }}>
        <div className="modal-hd">
          <div className="modal-hd-left">
            <div style={{ width:32, height:32, borderRadius:8, background:'var(--amber-l)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:17 }}>⚠</div>
            <span>{titulo || 'Posible duplicado'}</span>
          </div>
        </div>
        {intro && <p style={{ fontSize:13.5, color:'var(--ts)', lineHeight:1.5, marginBottom:14 }}>{intro}</p>}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {(grupos || []).map((g, i) => (
            <div key={i} style={{ background:'var(--bg-c2)', border:'1px solid var(--border-h)', borderRadius:10, padding:'10px 12px' }}>
              <div style={{ fontWeight:700, fontSize:13.5, color:'var(--tp)', marginBottom:(g.filas || []).length ? 6 : 0 }}>{g.titulo}</div>
              {(g.filas || []).map((f, j) => (
                <div key={j} style={{ fontSize:12.5, color:'var(--ts)', lineHeight:1.55 }}>• {f}</div>
              ))}
            </div>
          ))}
        </div>
        {pregunta && <p style={{ fontSize:13.5, color:'var(--tp)', fontWeight:600, marginTop:14 }}>{pregunta}</p>}
        <div className="modal-actions" style={{ flexWrap:'wrap' }}>
          <button className="btn btn-ghost" onClick={() => onResolver(true)}>{textoSi || 'Sí, registrar de todos modos'}</button>
          <button className="btn btn-amber" autoFocus onClick={() => onResolver(false)}>{textoNo || 'No, ya estaba registrado'}</button>
        </div>
      </div>
    </div>
  );
}

function avisoDuplicado(props = {}) {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let listo = false;
    const onResolver = (valor) => {
      if (listo) return;
      listo = true;
      resolve(!!valor);
      // Desmontar fuera del handler de React en curso.
      setTimeout(() => { try { root.unmount(); } catch {} host.remove(); }, 0);
    };
    root.render(<AvisoDuplicado {...props} onResolver={onResolver} />);
  });
}

Object.assign(window, { Modal, __avisoDuplicado: avisoDuplicado });
