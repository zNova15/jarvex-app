// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL VISOR DE UN COMPROBANTE, EN LA MISMA VENTANA (22-set-2026).
//
// Gabriel: «los iconos de ojo que has colocado y que llevas colocando en
// otras secciones del programa son unos iconos de ojo que te llevan a abrir
// el navegador y allí te muestran los comprobantes, quiero los ojos como de
// "Movimientos Contables" que te abren el comprobante en una ventana en la
// misma aplicación.»
//
// Tenía razón: los ojos que se agregaron el 22-set en el Registro de Compras
// y Ventas y en Anticipos (y el que ya existía en Cotejo/Escáner) llamaban a
// `abrirUrlEvidencia`, que hace `window.open(...)` — una pestaña nueva del
// navegador. El de Movimientos Contables (`VisorEvidenciaModal`, en
// jx-contabilidad.jsx) y el del Libro Diario (copia local en jx-asientos.jsx)
// SIEMPRE abrieron en un modal, dentro de la app. Dos copias del mismo modal
// ya eran una señal; con un tercer y cuarto lugar pidiendo el mismo botón,
// tocaba compartirlo en vez de copiarlo otra vez.
//
// Firma la evidencia recién AL ABRIR — nunca de entrada: firmar de más fue lo
// que dejó a Movimientos sin ojos por minutos el 7-set-2026 (1.302 evidencias
// firmándose todas juntas). El ojo de cada fila aparece al instante; el
// archivo se resuelve en el único momento en que hace falta de verdad.
//
// `entry` acepta DOS formas, igual que en jx-contabilidad.jsx:
//   · { ev, mime, nombre }         — evidencia cruda: la URL se firma acá.
//   · { url, mime, nombre, _blob } — ya resuelta (la usa quien ya tenía el
//                                    objectURL armado, como la guía de
//                                    remisión).
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getEvidenciaSrc, precargarEvidencia } from "../lib/evidencias-url.js";

const { useState: uS, useEffect: uE, useRef: uR } = React;

const Icon = (props) => (window.JxIcon ? React.createElement(window.JxIcon, props) : null);

// Visor de PDF robusto: muchos PDFs viejos se subieron con content-type
// genérico (octet-stream) y el iframe directo mostraba un recuadro GRIS.
// Se re-tipa vía blob local (application/pdf) — el navegador siempre lo
// renderiza; si ni así, queda el aviso + "Abrir en nueva pestaña".
function PdfFrameComprobante({ url, nombre }) {
  const [src, setSrc] = uS(null);
  const [err, setErr] = uS(false);
  uE(() => {
    let obj = null, cancel = false;
    (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        obj = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
        if (cancel) { URL.revokeObjectURL(obj); obj = null; return; }
        setSrc(obj);
      } catch { if (!cancel) setErr(true); }
    })();
    return () => { cancel = true; if (obj) { try { URL.revokeObjectURL(obj); } catch {} } };
  }, [url]);
  if (err) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 10, color: 'var(--tm)' }}>
      <Icon name="file" size={40} />
      <div style={{ fontSize: 12 }}>No se pudo previsualizar {nombre || 'el PDF'} acá.</div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-amber btn-sm">Abrir en nueva pestaña</a>
    </div>
  );
  if (!src) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--tm)', fontSize: 12 }}>Cargando PDF…</div>;
  return <iframe src={src} title={nombre || 'PDF'} style={{ width: '100%', height: '70vh', border: 'none', background: 'white' }} />;
}

/** El modal en sí. Úsalo directo, o preferí `useVisorComprobante()` abajo. */
export function VisorComprobanteModal({ entry, onClose }) {
  const [url, setUrl] = uS(entry?.url || null);
  const [error, setError] = uS(false);
  const propioBlobRef = uR(null);   // objectURL creado ACÁ (hay que revocarlo)
  uE(() => {
    if (entry?.url) { setUrl(entry.url); return; }
    let cancel = false;
    (async () => {
      try {
        const src = await getEvidenciaSrc(entry?.ev);
        if (!src?.url) { if (!cancel) setError(true); return; }
        if (cancel) { if (src.isBlob) { try { URL.revokeObjectURL(src.url); } catch {} } return; }
        if (src.isBlob) propioBlobRef.current = src.url;
        setUrl(src.url);
      } catch { if (!cancel) setError(true); }
    })();
    return () => { cancel = true; };
  }, [entry]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Revocar SOLO lo que creó este visor. Un objectURL que llegó de afuera
  // (entry con `_blob`) lo sigue administrando quien lo creó.
  uE(() => () => {
    if (propioBlobRef.current) { try { URL.revokeObjectURL(propioBlobRef.current); } catch {} }
  }, []);
  const cerrar = () => {
    if (entry?._blob && entry?.url) { try { URL.revokeObjectURL(entry.url); } catch {} }
    onClose?.();
  };
  if (!window.Modal) return null;   // jx-modal.jsx (eager) todavía no cargó
  return (
    <window.Modal title={`Comprobante: ${entry?.nombre || ''}`} icon="eye" onClose={cerrar} wide elevated>
      <div style={{ minHeight: 480, maxHeight: '70vh', background: 'var(--bg-p)', borderRadius: 6, overflow: 'hidden' }}>
        {error ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'60vh', gap:8, color:'var(--tm)', fontSize:12 }}>
            <Icon name="file" size={40}/>
            <div>No se pudo abrir el archivo. Si acaba de subirse, probá en un minuto.</div>
          </div>
        ) : !url ? (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', color:'var(--tm)', fontSize:12 }}>
            Abriendo el comprobante…
          </div>
        ) : entry?.mime?.startsWith('image/') ? (
          <img src={url} alt={entry?.nombre || ''}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}/>
        ) : (
          <PdfFrameComprobante url={url} nombre={entry?.nombre} />
        )}
      </div>
      <div className="modal-actions">
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            <Icon name="external" size={12}/> Abrir en nueva pestaña
          </a>
        )}
        <button className="btn btn-amber btn-sm" onClick={cerrar}>Cerrar</button>
      </div>
    </window.Modal>
  );
}

/**
 * El ojo de una fila: aparece SOLO si hay archivo (`entry` viene de
 * `evidenciasDeComprobantes` / mapas equivalentes, que ya filtran lo que no
 * tiene nada que mostrar). Al pasar el mouse precarga la firma; al hacer
 * clic, abre el modal — nunca una pestaña nueva.
 */
export function OjoComprobante({ entry, onAbrir, titulo = 'Ver el comprobante cargado' }) {
  if (!entry) return null;
  return (
    <button
      className="btn btn-sm"
      style={{ padding: '2px 8px' }}
      title={`${titulo}${entry.nombre ? ` (${entry.nombre})` : ''}`}
      onMouseEnter={() => precargarEvidencia(entry.ev)}
      onClick={() => onAbrir(entry)}
    >
      <Icon name="eye" size={12} />
      {!window.JxIcon && '👁'}
    </button>
  );
}

/**
 * El hook chico que arma el par «abrir / modal» sin que cada pantalla repita
 * el `useState` + el render condicional. Uso:
 *
 *   const { abrirComprobante, visorModal } = useVisorComprobante();
 *   ...
 *   <OjoComprobante entry={ev} onAbrir={abrirComprobante} />
 *   ...
 *   {visorModal}
 */
export function useVisorComprobante() {
  const [entry, setEntry] = uS(null);
  return {
    entry,
    abrirComprobante: (e) => setEntry(e),
    visorModal: entry ? <VisorComprobanteModal entry={entry} onClose={() => setEntry(null)} /> : null,
  };
}
