// ═══════════════════════════════════════════════════════════════════
// JARVEX — Foto de catálogo por insumo (thumbnail + adjuntar en la fila)
//
// Patrón compartido para catálogos que no tienen foto en su formulario
// (Insumos de Emergencia, Maquinaria): un thumbnail en la fila + botón de
// cámara que adjunta la foto DIRECTO (sin pasar por el modal de edición).
// La foto se guarda como evidencia (window.__saveEvidenciaLocal) con el
// tipo_evidencia del catálogo, igual que foto_material / foto_herramienta.
//
// El permiso para adjuntar es el de EVIDENCIAS (no el del catálogo): un
// almacenero puede ponerle foto a una máquina sin poder editar sus specs.
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { getEvidenciaSrc } from "../lib/evidencias-url.js";

const { useState: uS, useEffect: uE } = React;

/** Map(registro_relacionado_id → { url, isRemote }) de las fotos de un tipo
 *  de evidencia. obraId=null → todas las obras (catálogos globales como
 *  Activos Pesados, que se mueven entre obras). Escucha jx_data_changed. */
export function useFotosEvidencias(obraId, tipoEvidencia) {
  const [fotosMap, setFotosMap] = uS(() => new Map());
  uE(() => {
    let cancelled = false;
    // Lote VIGENTE de blob URLs. cargar() corre en cada jx_data_changed:
    // creamos el lote nuevo, publicamos el map, y recién ahí revocamos el
    // lote anterior (revocar antes rompería los <img> todavía montados).
    let urlsVigentes = [];
    const cargar = async () => {
      try {
        const base = obraId
          ? window.__db.evidencias.where('obra_id').equals(obraId)
          : window.__db.evidencias;
        const evidencias = await base
          .filter(e => e.tipo_evidencia === tipoEvidencia && !e.deleted_at && e.registro_relacionado_id)
          .toArray();
        // La más reciente por registro
        evidencias.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        const map = new Map();
        const urlsNuevas = [];
        for (const ev of evidencias) {
          if (map.has(ev.registro_relacionado_id)) continue;
          // Blob local si existe; si no, signed URL del bucket privado (la
          // url_archivo cruda NO sirve en un bucket privado → imagen rota).
          const src = await getEvidenciaSrc(ev);
          if (src?.url) {
            if (src.isBlob) urlsNuevas.push(src.url);
            map.set(ev.registro_relacionado_id, { url: src.url, isRemote: !src.isBlob });
          }
        }
        if (cancelled) { urlsNuevas.forEach(u => { try { URL.revokeObjectURL(u); } catch {} }); return; }
        setFotosMap(map);
        const viejas = urlsVigentes;
        urlsVigentes = urlsNuevas;
        viejas.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
      } catch (e) { console.warn('[fotos ' + tipoEvidencia + ']', e?.message || e); }
    };
    cargar();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'evidencias') cargar();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jarvex_master_updated', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jx_data_changed', onChange);
      window.removeEventListener('jarvex_master_updated', onChange);
      urlsVigentes.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    };
  }, [obraId, tipoEvidencia]);
  return fotosMap;
}

/** Thumbnail 32px + botón cámara para adjuntar/reemplazar la foto del insumo
 *  directo desde la fila. `foto` viene del Map de useFotosEvidencias. */
export function FotoInsumoCell({ obraId, tipoEvidencia, modulo, registroId, nombre, foto, canFoto, userId, showToast }) {
  const [busy, setBusy] = uS(false);

  const adjuntar = async (file) => {
    if (!file || busy) return;
    // Sin obra no hay dónde subirla: el path de Storage es {obra_id}/… y el
    // RLS rechazaría 'null/…' (quedaría en FAILED tras 5 reintentos).
    if (!obraId) { showToast?.('Asigná el registro a una obra antes de adjuntar la foto', 'red'); return; }
    if (!file.type?.startsWith('image/')) { showToast?.('Solo se permiten imágenes', 'red'); return; }
    if (file.size > 8 * 1024 * 1024) { showToast?.('La foto supera los 8 MB', 'red'); return; }
    setBusy(true);
    try {
      await window.__saveEvidenciaLocal?.({
        id: window.__newId(),
        obra_id: obraId,
        tipo_evidencia: tipoEvidencia,
        modulo_relacionado: modulo,
        registro_relacionado_id: registroId,
        nombre_archivo: file.name || `${tipoEvidencia}_${registroId}.jpg`,
        mime_type: file.type || 'image/jpeg',
        blob: file,
        observaciones: `Foto referencial · ${nombre || ''}`,
        fecha: new Date().toISOString().slice(0, 10),
        created_by: userId || null,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias' } })); } catch {}
      showToast?.('Foto guardada', 'green');
    } catch (e) {
      showToast?.('Error con la foto: ' + (e?.message || e), 'red');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
      {foto?.url ? (
        <img src={foto.url} alt="foto"
             style={{ width:32, height:32, objectFit:'cover', borderRadius:4, border:'1px solid var(--bd)', flexShrink:0, cursor:'pointer' }}
             onClick={(e) => { e.stopPropagation(); window.open(foto.url, '_blank'); }}
             title="Click para ampliar"/>
      ) : (
        <span style={{ width:32, height:32, borderRadius:4, background:'rgba(255,255,255,0.04)', border:'1px dashed var(--bd)', display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}
              title="Sin foto">
          <JxIcon name="image" size={12} color="var(--tm)"/>
        </span>
      )}
      {canFoto && (
        <label className="btn btn-ghost btn-xs" style={{ cursor: busy ? 'wait' : 'pointer', padding:'2px 6px' }}
               title={foto?.url ? 'Reemplazar foto' : 'Adjuntar foto'}
               onClick={(e) => e.stopPropagation()}>
          <JxIcon name="camera" size={11}/>
          <input type="file" accept="image/*" capture="environment" style={{ display:'none' }} disabled={busy}
                 onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; adjuntar(f); }}/>
        </label>
      )}
    </div>
  );
}
