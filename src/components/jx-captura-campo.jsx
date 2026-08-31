// ═══════════════════════════════════════════════════════════════════
// JARVEX — Portal de captura rápida de facturas de CAMPO (mejora 2, sep-2026).
//
// Para el personal de obra (residentes, maestros, peones con el PIN de la
// cuenta compartida rol 'campo') Y como atajo para cualquier rol logueado:
// 1) Torpedo de RUCs: a qué empresa del grupo pedir la factura según el rubro
//    (la edita el admin en Empresas: rubro + estado activa).
// 2) Foto del comprobante (cámara directa o galería) + datos mínimos.
// 3) La foto viaja como evidencia tipo 'factura_campo' por el pipeline
//    offline-first de siempre (EvidenceUploader) — SIN llamar a la IA: el OCR
//    corre recién cuando contabilidad la abre en su bandeja de Captura Mágica.
//
// Seguridad: el rol campo solo puede esto (cerco RLS mig 155). La visibilidad
// de estas fotos es CONTABLE (evidencias-visibilidad + política del server).
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { uploadPendingEvidencias } from "../sync/EvidenceUploader.js";
import { getCurrentMode } from "../lib/app-mode-core.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const FI16 = { fontSize: 16 };
const MAX_FOTOS_CAMPO = 4;

// Miniatura + quitar (mismo patrón del Reporte Diario móvil).
function ThumbFotoCampo({ file, onQuitar }) {
  const [url, setUrl] = uS(null);
  uE(() => {
    let u = null;
    try { u = URL.createObjectURL(file); setUrl(u); } catch { setUrl(null); }
    return () => { if (u) { try { URL.revokeObjectURL(u); } catch {} } };
  }, [file]);
  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      {url
        ? <img src={url} alt={file?.name || 'foto'} style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--bd)', display: 'block' }} />
        : <span style={{ width: 76, height: 76, borderRadius: 8, border: '1px solid var(--bd)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>📷</span>}
      <button onClick={onQuitar} title="Quitar foto"
        style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'var(--red)', color: '#fff', fontSize: 11, lineHeight: '20px', padding: 0, cursor: 'pointer' }}>✕</button>
    </span>
  );
}

function CapturaCampoPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const rol = auth?.profile?.rol || null;
  const companiesHook = window.__hooks.useCompanies();
  const obrasHook = window.__hooks.useObras();

  // ¿Es la cuenta COMPARTIDA de campo (entró con PIN, sin cuenta real)?
  // Desde fuera no sabemos quién es → se le PREGUNTA el nombre (obligatorio).
  // Con una cuenta real, ya se sabe quién es → no se pregunta nada.
  const esCuentaCampo = rol === 'campo';
  const identidadReal = auth?.profile?.nombre || auth?.profile?.full_name || auth?.profile?.email || 'usuario del sistema';

  const [quien, setQuien] = uS('');         // solo se usa con la cuenta de campo
  const [obraId, setObraId] = uS('');
  const [empresaId, setEmpresaId] = uS('');
  const [comentario, setComentario] = uS('');
  const [fotos, setFotos] = uS([]);
  const enviandoRef = uR(false);            // anti doble-tap (regla crítica 2)
  const [enviando, setEnviando] = uS(false);

  const empresas = uM(() =>
    (companiesHook.data || [])
      .filter(c => !c.deleted_at && (c.status ? c.status === 'activa' : true)
        // El admin elige cuáles salen en el torpedo (checkbox en Empresas,
        // mig 156). Tolerante a filas viejas sin la columna: se muestran.
        && c.mostrar_torpedo !== false)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [companiesHook.data]);
  const obras = uM(() =>
    (obrasHook.data || []).filter(o => !o.deleted_at)
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''))),
    [obrasHook.data]);

  const recibirFotos = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) setFotos(prev => [...prev, ...files].slice(0, MAX_FOTOS_CAMPO));
    e.target.value = '';
  };

  const enviar = async () => {
    if (enviandoRef.current) return;
    if (esCuentaCampo && !quien.trim()) { showToast?.('Escribí tu nombre (quién sube la foto)', 'red'); return; }
    if (!obraId) { showToast?.('Elegí la obra de la compra', 'red'); return; }
    if (!fotos.length) { showToast?.('Tomá o elegí al menos una foto del comprobante', 'red'); return; }
    enviandoRef.current = true;
    setEnviando(true);
    // Quién sube: con cuenta de campo, el nombre tecleado; con cuenta real, su
    // identidad del sistema (ya se sabe quién es — no se le preguntó).
    const quienSube = esCuentaCampo ? quien.trim() : identidadReal;
    const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
    try {
      const emp = empresas.find(c => c.id === empresaId);
      const obs = `📸 Captura de campo · De: ${quienSube}${esCuentaCampo ? '' : ' (usuario del sistema)'}`
        + (emp ? ` · Compró: ${emp.name} (RUC ${emp.ruc || '—'})` : '')
        + (comentario.trim() ? ` · ${comentario.trim()}` : '');
      // Guardar quitando cada foto ya persistida: si algo falla a mitad, un
      // reintento NO re-guarda las que ya entraron (evita duplicados).
      let pendientes = [...fotos];
      for (const f of fotos) {
        await window.__saveEvidenciaLocal({
          id: window.__newId(),
          obra_id: obraId,
          tipo_evidencia: 'factura_campo',
          modulo_relacionado: 'captura_campo',
          registro_relacionado_id: null,
          nombre_archivo: f.name || 'factura.jpg',
          mime_type: f.type || '',
          blob: f,
          observaciones: obs,
          campo_revision: 'pendiente',
          created_by: userId,
          ...(esPrueba ? { demo: true } : {}),
        });
        pendientes = pendientes.filter(x => x !== f);
        setFotos(pendientes);
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias', source: 'captura-campo' } })); } catch {}
      // Empujar la subida YA si hay señal (si no, la cola offline la sube sola).
      try { uploadPendingEvidencias(); } catch {}
      showToast?.(`✓ ${fotos.length} foto(s) guardada(s)${esPrueba ? ' (modo prueba)' : ' — contabilidad las revisará'}. Podés seguir con tu día.`, 'green');
      setComentario('');
    } catch (e) {
      showToast?.('Error al guardar (las fotos ya guardadas se conservan): ' + (e.message || e), 'red');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const btnFoto = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '12px 16px', fontSize: 14, cursor: 'pointer' };

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
      <div className="card card-p" style={{ background: 'rgba(242,183,5,0.06)', border: '1px solid rgba(242,183,5,0.25)' }}>
        <div style={{ fontSize: 14.5, fontWeight: 800 }}>📸 Guardar factura de una compra</div>
        <div style={{ fontSize: 12, color: 'var(--ts)', marginTop: 4, lineHeight: 1.6 }}>
          Sacale foto al comprobante APENAS te lo den — así no se pierde. Contabilidad la revisa y la registra después; no tenés que llenar nada más.
        </div>
      </div>

      {/* Torpedo de RUCs: a nombre de qué empresa pedir la factura. */}
      <div className="card" style={{ overflow: 'auto' }}>
        <div style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 700 }}>🧾 ¿A qué RUC pido la factura?</div>
        <div style={{ padding: '0 12px 6px', fontSize: 11, color: 'var(--tm)' }}>Dictale al proveedor el RUC de la empresa del grupo según el rubro de la compra.</div>
        <table className="tbl" style={{ fontSize: 12 }}>
          <thead><tr><th>Empresa</th><th>RUC</th><th>Rubro / úsala para…</th></tr></thead>
          <tbody>
            {empresas.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td style={{ fontFamily: 'monospace' }}>{c.ruc || '—'}</td>
                <td style={{ color: 'var(--ts)' }}>{c.rubro || '—'}</td>
              </tr>
            ))}
            {empresas.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin empresas cargadas aún (se descargan al tener señal).</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card card-p">
        {/* El nombre SOLO se pregunta desde la cuenta de campo (PIN): ahí no
            sabemos quién es. Con una cuenta real ya se sabe — no se pregunta. */}
        {!esCuentaCampo && (
          <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 8 }}>
            Subís como <strong style={{ color: 'var(--ts)' }}>{identidadReal}</strong> — contabilidad verá que fuiste vos.
          </div>
        )}
        <div className="g2">
          {esCuentaCampo && (
            <div>
              <label className="flabel">¿Quién sube la foto? *</label>
              <input className="fi" style={FI16} value={quien} onChange={e => setQuien(e.target.value)} placeholder="Tu nombre y apellido" />
            </div>
          )}
          <div>
            <label className="flabel">Obra de la compra *</label>
            <select className="fi" style={FI16} value={obraId} onChange={e => setObraId(e.target.value)}>
              <option value="">— Elegir obra —</option>
              {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="g2" style={{ marginTop: 8 }}>
          <div>
            <label className="flabel">Empresa que compró (del torpedo)</label>
            <select className="fi" style={FI16} value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
              <option value="">— No sé / otra —</option>
              {empresas.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="flabel">Comentario (opcional)</label>
            <input className="fi" style={FI16} value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Ej. compra de urgencia de cemento" />
          </div>
        </div>

        <label className="flabel" style={{ marginTop: 10, display: 'block' }}>Foto del comprobante * (1 a {MAX_FOTOS_CAMPO})</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="btn btn-amber" style={{ ...btnFoto, opacity: fotos.length >= MAX_FOTOS_CAMPO ? 0.5 : 1 }}>
            📷 Tomar foto
            <input type="file" accept="image/*" capture="environment" disabled={fotos.length >= MAX_FOTOS_CAMPO} onChange={recibirFotos} style={{ display: 'none' }} />
          </label>
          <label className="btn btn-ghost" style={{ ...btnFoto, opacity: fotos.length >= MAX_FOTOS_CAMPO ? 0.5 : 1 }}>
            🖼️ Galería
            <input type="file" accept="image/*" multiple disabled={fotos.length >= MAX_FOTOS_CAMPO} onChange={recibirFotos} style={{ display: 'none' }} />
          </label>
        </div>
        {fotos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {fotos.map((f, i) => <ThumbFotoCampo key={i} file={f} onQuitar={() => setFotos(prev => prev.filter((_, j) => j !== i))} />)}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <button className="btn btn-amber" disabled={enviando} onClick={enviar} style={{ padding: '12px 20px', fontSize: 14.5 }}>
            <JxIcon name="check" size={14} /> {enviando ? 'Guardando…' : `Guardar factura${fotos.length > 1 ? `s (${fotos.length})` : ''}`}
          </button>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 6 }}>
            Sin señal también funciona: la foto queda guardada en el teléfono y sube sola al recuperar internet.
          </div>
        </div>
      </div>

    </div>
  );
}

Object.assign(window, { CapturaCampoPage });
export { CapturaCampoPage };
