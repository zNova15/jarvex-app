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
import { supabase } from "../lib/supabase";
import { RUBROS, rubroLabel } from "../lib/rubros.js";

// ── Configuración del portal (SOLO ADMIN, pedido de Gabriel 31-ago) ──
// Acceso rápido sin abrir el form completo de cada Empresa ni el dashboard de
// Supabase: (1) cambiar el PIN de la cuenta campo@ (usa el endpoint admin
// set_password ya existente); (2) elegir qué empresas salen en el torpedo y
// su rubro, inline con guardado inmediato.
function ConfigPortalAdmin({ empresasTodas, companiesHook, showToast }) {
  const [abierto, setAbierto] = uS(false);
  const [pin, setPin] = uS('');
  const [pin2, setPin2] = uS('');
  const guardandoRef = uR(false);   // anti doble-click (regla crítica 2)
  const [busyPin, setBusyPin] = uS(false);

  const cambiarPin = async () => {
    if (guardandoRef.current) return;
    const p = pin.trim();
    // PIN NUMÉRICO de 4 a 8 dígitos (pedido 31-ago: 4 para mayor rapidez).
    if (!/^\d{4,8}$/.test(p)) { showToast?.('El PIN debe ser numérico, de 4 a 8 dígitos.', 'red'); return; }
    if (p !== pin2.trim()) { showToast?.('Los PIN no coinciden.', 'red'); return; }
    guardandoRef.current = true;
    setBusyPin(true);
    try {
      const perfilCampo = await window.__db.profiles.filter(pr => pr.email === 'campo@jarvex.pe').first();
      if (!perfilCampo?.id) throw new Error('No encuentro la cuenta campo@jarvex.pe (¿ya está creada y sincronizada?)');
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Sesión vencida — volvé a loguearte.');
      const resp = await fetch('/api/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'set_password', user_id: perfilCampo.id, password: p }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || data.detail || `HTTP ${resp.status}`);
      try { await window.__logAudit?.({ action: 'update', table: 'auth.users', recordId: perfilCampo.id, reason: 'PIN del portal de campo cambiado desde Configuración del portal' }); } catch {}
      setPin(''); setPin2('');
      showToast?.('✓ PIN actualizado — repartí el nuevo. Los teléfonos ya logueados siguen hasta que se les cierre la sesión por inactividad.', 'green');
    } catch (e) {
      showToast?.('No se pudo cambiar el PIN: ' + (e.message || e), 'red');
    } finally {
      guardandoRef.current = false;
      setBusyPin(false);
    }
  };

  const actualizarEmpresa = async (id, patch) => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    try {
      await companiesHook.update(id, patch);
      showToast?.('✓ Guardado (sincroniza solo)', 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    } finally {
      guardandoRef.current = false;
    }
  };

  return (
    <div className="card card-p" style={{ background: 'rgba(155,89,182,0.06)', border: '1px solid rgba(155,89,182,0.3)' }}>
      <div className="frow-sb" style={{ cursor: 'pointer' }} onClick={() => setAbierto(a => !a)}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>⚙️ Configuración del portal (admin / contadora jefe)</div>
        <span style={{ color: 'var(--tm)', fontSize: 11 }}>{abierto ? '▲ ocultar' : '▼ abrir'}</span>
      </div>
      {abierto && (
        <div style={{ marginTop: 10, display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>🔑 PIN de acceso del personal de campo</div>
            <div className="g2">
              <input className="fi" type="password" inputMode="numeric" maxLength={8} placeholder="Nuevo PIN (4 a 8 dígitos)" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 16 }} />
              <input className="fi" type="password" inputMode="numeric" maxLength={8} placeholder="Repetir PIN" value={pin2} onChange={e => setPin2(e.target.value.replace(/\D/g, ''))} style={{ fontSize: 16 }} />
            </div>
            <button className="btn btn-amber btn-sm" style={{ marginTop: 8 }} disabled={busyPin} onClick={cambiarPin}>
              {busyPin ? 'Cambiando…' : 'Cambiar PIN'}
            </button>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 5 }}>
              PIN numérico de 4 a 8 dígitos. Rotalo cuando alguien deje la obra — con 4 es rapidísimo de tipear pero fácil de adivinar; usá más dígitos si podés.
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>🧾 Empresas del torpedo (qué ve el personal y con qué rubro)</div>
            <div style={{ display: 'grid', gap: 5 }}>
              {empresasTodas.map(c => (
                <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', background: 'var(--tint-neutral)', borderRadius: 5 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1, minWidth: 180, fontSize: 12 }}>
                    <input type="checkbox" checked={c.mostrar_torpedo !== false}
                      onChange={e => actualizarEmpresa(c.id, { mostrar_torpedo: e.target.checked })} />
                    <strong>{c.name}</strong>
                    <span style={{ color: 'var(--tm)', fontFamily: 'monospace', fontSize: 11 }}>{c.ruc || '—'}</span>
                  </label>
                  <select className="fi" style={{ maxWidth: 240, fontSize: 12, padding: '4px 8px' }} value={c.rubro || 'otro'}
                    onChange={e => actualizarEmpresa(c.id, { rubro: e.target.value })}>
                    {RUBROS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
                  </select>
                </div>
              ))}
              {empresasTodas.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic' }}>Sin empresas activas.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const FI16 = { fontSize: 16 };
const MAX_FOTOS_CAMPO = 3;
// Actualizar en cada deploy que toque este portal (ver sello en el header).
const PORTAL_BUILD = 'v4 · 31-ago';

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
        ? <img src={url} alt={file?.name || 'foto'} style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
        : <span style={{ width: 76, height: 76, borderRadius: 8, border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>📷</span>}
      <button onClick={onQuitar} title="Quitar foto"
        style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', border: 'none', background: 'var(--red)', color: '#fff', fontSize: 11, lineHeight: '20px', padding: 0, cursor: 'pointer' }}>✕</button>
    </span>
  );
}

// ── Estado de las subidas de ESTE dispositivo (agregado 31-ago) ───────
// La subida real es en 2 pasos (archivo al Storage + fila a la BD) y puede
// fallar CALLADA (sin señal, RLS, app cerrada a mitad). Antes el portal decía
// "guardada" y nadie sabía si la foto llegó de verdad — caso real: la prueba
// de Gabriel del 31-ago nunca apareció en el servidor y no había dónde verlo.
// Acá se listan las que aún no subieron, con su motivo, y un reintento manual.
function EstadoSubidasCampo({ showToast }) {
  const [filas, setFilas] = uS([]);
  const reintentandoRef = uR(false);   // anti doble-tap (regla crítica 2)

  uE(() => {
    let cancel = false;
    const cargar = async () => {
      try {
        // Estados de EvidenceUploader: 'pending_upload' (en cola) / 'failed'
        // (agotó reintentos) / 'uploaded' (ya está en el servidor).
        const rows = await window.__db.evidencias
          .filter(e => e.tipo_evidencia === 'factura_campo' && e.demo !== true && !e.deleted_at
            && (e.sync_status === 'pending_upload' || e.sync_status === 'failed'))
          .toArray();
        rows.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        if (!cancel) setFilas(rows);
      } catch {}
    };
    cargar();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'evidencias') cargar();
    };
    window.addEventListener('jx_data_changed', onChange);
    window.addEventListener('jx_sync_pull', cargar);
    const iv = setInterval(cargar, 10000);   // la cola corre en fondo cada 45s
    return () => { cancel = true; clearInterval(iv); window.removeEventListener('jx_data_changed', onChange); window.removeEventListener('jx_sync_pull', cargar); };
  }, []);

  const reintentar = async () => {
    if (reintentandoRef.current) return;
    reintentandoRef.current = true;
    try {
      for (const ev of filas) {
        if (ev.sync_status === 'failed') {
          await window.__db.evidencias.update(ev.id, { sync_status: 'pending_upload', upload_retries: 0 });
        }
      }
      await uploadPendingEvidencias();
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'evidencias', source: 'captura-campo-retry' } })); } catch {}
      showToast?.('Reintento lanzado — si hay señal, en unos segundos se actualiza la lista.', 'amber');
    } catch (e) {
      showToast?.('No se pudo reintentar: ' + (e.message || e), 'red');
    } finally {
      reintentandoRef.current = false;
    }
  };

  if (!filas.length) return null;
  return (
    <div className="card card-p" style={{ background: 'rgba(230,126,34,0.08)', border: '1px solid rgba(230,126,34,0.35)' }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--amber)' }}>
        ⬆ {filas.length} foto(s) de este teléfono aún NO llegan al servidor
      </div>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {filas.map(ev => (
          <div key={ev.id} style={{ fontSize: 11.5, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
            <div style={{ fontWeight: 600 }}>
              {String(ev.created_at || '').slice(0, 16).replace('T', ' ')} · {ev.nombre_archivo}
              <span className={`badge ${ev.sync_status === 'failed' ? 'b-red' : 'b-amber'}`} style={{ marginLeft: 6, fontSize: 9 }}>
                {ev.sync_status === 'failed' ? 'falló' : 'en cola'}
              </span>
            </div>
            {ev._last_error && <div style={{ color: 'var(--red)', marginTop: 2 }}>{ev._last_error}</div>}
          </div>
        ))}
      </div>
      <button className="btn btn-amber btn-sm" style={{ marginTop: 8 }} onClick={reintentar}>🔄 Reintentar ahora</button>
      <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 5 }}>
        Dejá la app abierta con señal hasta que esta caja desaparezca — ahí ya están en el servidor y contabilidad las ve.
      </div>
    </div>
  );
}

function CapturaCampoPage({ showToast }) {
  const auth = window.__useAuth ? window.__useAuth() : null;
  const userId = auth?.profile?.id || null;
  const rol = auth?.profile?.rol || null;
  const companiesHook = window.__hooks.useCompanies();

  // ¿Es la cuenta COMPARTIDA de campo (entró con PIN, sin cuenta real)?
  // Desde fuera no sabemos quién es → se le PREGUNTA el nombre (obligatorio).
  // Con una cuenta real, ya se sabe quién es → no se pregunta nada.
  const esCuentaCampo = rol === 'campo';
  const identidadReal = auth?.profile?.nombre || auth?.profile?.full_name || auth?.profile?.email || 'usuario del sistema';

  const [quien, setQuien] = uS('');         // solo se usa con la cuenta de campo
  const [comentario, setComentario] = uS('');
  const [fotos, setFotos] = uS([]);
  const [torpedoAbierto, setTorpedoAbierto] = uS(false);   // tabla de RUCs desplegable (pedido 31-ago)
  const enviandoRef = uR(false);            // anti doble-tap (regla crítica 2)
  const [enviando, setEnviando] = uS(false);

  // Todas las activas (para el panel de config del admin)…
  const empresasTodas = uM(() =>
    (companiesHook.data || [])
      .filter(c => !c.deleted_at && (c.status ? c.status === 'activa' : true))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [companiesHook.data]);
  // …y las elegidas por el admin para el torpedo (mig 156; tolerante a filas
  // viejas sin la columna: se muestran).
  const empresas = uM(() => empresasTodas.filter(c => c.mostrar_torpedo !== false), [empresasTodas]);

  const recibirFotos = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) setFotos(prev => [...prev, ...files].slice(0, MAX_FOTOS_CAMPO));
    e.target.value = '';
  };

  const enviar = async () => {
    if (enviandoRef.current) return;
    if (esCuentaCampo && !quien.trim()) { showToast?.('Escribí tu nombre (quién sube la foto)', 'red'); return; }
    if (!fotos.length) { showToast?.('Tomá o elegí al menos una foto del comprobante', 'red'); return; }
    enviandoRef.current = true;
    setEnviando(true);
    // Quién sube: con cuenta de campo, el nombre tecleado; con cuenta real, su
    // identidad del sistema (ya se sabe quién es — no se le preguntó).
    const quienSube = esCuentaCampo ? quien.trim() : identidadReal;
    const esPrueba = (() => { try { return getCurrentMode() === 'prueba'; } catch { return false; } })();
    try {
      const obs = `📸 Captura de campo · De: ${quienSube}${esCuentaCampo ? '' : ' (usuario del sistema)'}`
        + (comentario.trim() ? ` · ${comentario.trim()}` : '');
      // Guardar quitando cada foto ya persistida: si algo falla a mitad, un
      // reintento NO re-guarda las que ya entraron (evita duplicados).
      let pendientes = [...fotos];
      for (const f of fotos) {
        await window.__saveEvidenciaLocal({
          id: window.__newId(),
          // SIN obra (pedido 31-ago): la asigna contabilidad al registrarla en
          // Captura Mágica. El archivo va a la carpeta 'captura-campo/' del
          // bucket (EvidenceUploader usa esa carpeta cuando obra_id es null).
          obra_id: null,
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
    // page-wrap = EL contenedor con scroll de toda página (bug real 31-ago:
    // sin él la página no deslizaba ni en PC ni en el teléfono).
    <div className="page-wrap">
    <div style={{ display: 'grid', gap: 12, maxWidth: 640, margin: '0 auto' }}>
      <div className="card card-p" style={{ background: 'rgba(242,183,5,0.06)', border: '1px solid rgba(242,183,5,0.25)' }}>
        <div className="frow-sb">
          <div style={{ fontSize: 14.5, fontWeight: 800 }}>📸 Guardar factura de una compra</div>
          {/* Sello de versión: la PWA cachea builds viejos — con esto se ve al
              instante si un teléfono corre la versión actual (gotcha deploy). */}
          <span style={{ fontSize: 9.5, color: 'var(--tm)' }}>{PORTAL_BUILD}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ts)', marginTop: 4, lineHeight: 1.6 }}>
          Sacale foto al comprobante APENAS te lo den — así no se pierde. Contabilidad la revisa y la registra después; no tenés que llenar nada más.
        </div>
      </div>

      <EstadoSubidasCampo showToast={showToast} />

      {(rol === 'admin' || rol === 'contador') && (
        <ConfigPortalAdmin empresasTodas={empresasTodas} companiesHook={companiesHook} showToast={showToast} />
      )}

      {/* LA ACCIÓN PRINCIPAL PRIMERO (pedido 31-ago): sacar la foto es a lo que
          viene el trabajador — botones grandes arriba, los datos después. */}
      <div className="card card-p">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="btn btn-amber" style={{ ...btnFoto, flex: 1, justifyContent: 'center', opacity: fotos.length >= MAX_FOTOS_CAMPO ? 0.5 : 1 }}>
            📷 Tomar foto
            <input type="file" accept="image/*" capture="environment" disabled={fotos.length >= MAX_FOTOS_CAMPO} onChange={recibirFotos} style={{ display: 'none' }} />
          </label>
          <label className="btn btn-ghost" style={{ ...btnFoto, flex: 1, justifyContent: 'center', opacity: fotos.length >= MAX_FOTOS_CAMPO ? 0.5 : 1 }}>
            🖼️ Galería
            <input type="file" accept="image/*" multiple disabled={fotos.length >= MAX_FOTOS_CAMPO} onChange={recibirFotos} style={{ display: 'none' }} />
          </label>
        </div>
        {fotos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {fotos.map((f, i) => <ThumbFotoCampo key={i} file={f} onQuitar={() => setFotos(prev => prev.filter((_, j) => j !== i))} />)}
          </div>
        )}

        {/* El nombre SOLO se pregunta desde la cuenta de campo (PIN): ahí no
            sabemos quién es. Con una cuenta real ya se sabe — no se pregunta. */}
        {!esCuentaCampo && (
          <div style={{ fontSize: 11.5, color: 'var(--tm)', margin: '10px 0 6px' }}>
            Subís como <strong style={{ color: 'var(--ts)' }}>{identidadReal}</strong> — contabilidad verá que fuiste vos.
          </div>
        )}
        {/* SOLO lo esencial (pedido 31-ago): quién sube + comentario opcional.
            Obra y empresa las asigna CONTABILIDAD al registrarla en Captura
            Mágica — este portal es velocidad pura. */}
        {esCuentaCampo && (
          <div style={{ marginTop: 10 }}>
            <label className="flabel">¿Quién sube la foto? *</label>
            <input className="fi" style={FI16} value={quien} onChange={e => setQuien(e.target.value)} placeholder="Tu nombre y apellido" />
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <label className="flabel">Comentario (opcional)</label>
          <input className="fi" style={FI16} value={comentario} onChange={e => setComentario(e.target.value)} placeholder="Ej. compra de urgencia de cemento" />
        </div>

        <div style={{ marginTop: 14 }}>
          <button className="btn btn-amber" disabled={enviando} onClick={enviar} style={{ padding: '12px 20px', fontSize: 14.5, width: '100%', justifyContent: 'center' }}>
            <JxIcon name="check" size={14} /> {enviando ? 'Guardando…' : `Guardar factura${fotos.length > 1 ? `s (${fotos.length})` : ''}`}
          </button>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 6 }}>
            Sin señal también funciona: la foto queda guardada en el teléfono y sube sola al recuperar internet.
          </div>
        </div>
      </div>

      {/* Torpedo de RUCs DESPLEGABLE (pedido 31-ago): botón grande, la tabla
          solo se abre cuando el trabajador la necesita — la acción principal
          (sacar la foto) queda arriba y a un tap. */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <button onClick={() => setTorpedoAbierto(a => !a)}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tp)', fontSize: 13, fontWeight: 700 }}>
          <span>🧾 ¿A qué RUC pido la factura? <span style={{ color: 'var(--tm)', fontWeight: 400, fontSize: 11 }}>({empresas.length} empresas)</span></span>
          <span style={{ color: 'var(--amber)', fontSize: 12 }}>{torpedoAbierto ? '▲ Cerrar' : '▼ Ver tabla'}</span>
        </button>
        {torpedoAbierto && (
          <>
            <div style={{ padding: '0 14px 6px', fontSize: 11, color: 'var(--tm)' }}>Dictale al proveedor el RUC de la empresa del grupo según el rubro de la compra.</div>
            <div style={{ overflow: 'auto' }}>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead><tr><th>Empresa</th><th>RUC</th><th>Rubro / úsala para…</th></tr></thead>
                <tbody>
                  {empresas.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td style={{ fontFamily: 'monospace' }}>{c.ruc || '—'}</td>
                      <td style={{ color: 'var(--ts)' }}>{rubroLabel(c.rubro)}</td>
                    </tr>
                  ))}
                  {empresas.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--tm)', fontStyle: 'italic' }}>Sin empresas cargadas aún (se descargan al tener señal).</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

    </div>
    </div>
  );
}

Object.assign(window, { CapturaCampoPage });
export { CapturaCampoPage };
