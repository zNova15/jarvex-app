// ═══════════════════════════════════════════════════════════════════
// JARVEX — Modal de detalle de sincronización
//
// Surge al click del badge cuando hay registros FAILED o pending. Es la
// respuesta del consejo a la mentira histórica de "Sincronizado":
// el usuario debe poder ver QUÉ no se subió y reintentar.
//
// Estados que muestra:
//   - FAILED: agrupados por tabla, con código + descripción + error +
//     veces que se intentó. Botón "Reintentar todos".
//   - PENDING: contadores por tabla, con botón "Sincronizar ahora".
//
// El modal solo se monta cuando `open=true`, así no consume Dexie en
// cada render.
// ═══════════════════════════════════════════════════════════════════
import React from 'react';
import {
  getFailedDetails, retryAllFailed, getPendingCount, getFailedCount,
  syncAll, forceFullResync, getSyncHealth,
} from '../sync/SyncEngine';
import { migrarEvidenciasHeic } from '../lib/migrar-heic';
import { optimizarImagenEvidencia } from '../lib/optimizar-imagen';
import { supabase } from '../lib/supabase';
import { db } from '../db/jarvex.db';

const { useState, useEffect } = React;

const JxIcon = (props) => (window.JxIcon ? <window.JxIcon {...props}/> : null);

// Traduce el error técnico del server a un mensaje entendible + qué hacer.
// `regla` (opcional) viene de getFailedDetails y trae el campo/valor concretos
// que incumplen la regla, ya parseados → permite decir EXACTAMENTE qué corregir.
function mensajeAmigable(code, error, regla) {
  const m = String(error || '').toLowerCase();
  if (code === 'PGRST204' || /could not find the .* column/.test(m))
    return 'El servidor no reconoce una columna que el programa quiso guardar (esquema desactualizado). Suele resolverse al recargar la página; si persiste, avisá.';
  if (/pgrst301|jwt expired|jwt is expired/.test(m + code))
    return 'Tu sesión expiró en ese momento — el registro se reintenta solo con la sesión renovada. Si sigue acá, tocá "Reintentar todos" o recargá la página.';
  if (/row-level security|violates row-level security|insufficient_privilege|42501/.test(m + code))
    return 'Permisos (RLS): tu rol no puede guardar este registro en el servidor. Avisale al admin; si sos admin, revisá las políticas de la tabla.';
  if (/violates check constraint/.test(m) && /stock/.test(m))
    return 'El movimiento dejaría el stock en negativo, lo que no está permitido. Revisá el archivo: probablemente falta una entrada previa o la cantidad de la salida está mal.';
  if (/violates check constraint/.test(m) && /alerta/.test(m))
    return 'Valor de "alerta" no permitido para ese insumo.';
  // Mensaje PRECISO cuando pudimos identificar el campo y el valor que falla.
  if (regla && regla.campoHumano) {
    const v = (regla.valor === null || regla.valor === undefined || regla.valor === '')
      ? '(vacío)' : `“${regla.valor}”`;
    if (regla.regla === 'check')
      return `El campo «${regla.campoHumano}» tiene un valor que el servidor no acepta: ${v}.`
        + (regla.validos ? ` Valores válidos: ${regla.validos}.` : ' Corregí ese campo y reintentá.');
    if (regla.regla === 'not_null')
      return `Falta completar «${regla.campoHumano}»: es obligatorio y llegó vacío.`;
    if (regla.regla === 'fk')
      return `El «${regla.campoHumano}» referenciado (${v}) todavía no está en el servidor. Reintentá: al subir primero ese registro, este entra solo.`;
    if (regla.regla === 'unique')
      return `Ya existe otro registro con el mismo «${regla.campoHumano}» (${v}).`;
  }
  if (/violates check constraint/.test(m))
    return 'Un valor del registro no cumple una regla del servidor (CHECK). Revisá los datos del archivo.';
  if (code === '23503' || /foreign key|violates foreign key/.test(m))
    return 'Falta el registro relacionado (p. ej. el insumo del movimiento todavía no está en el servidor). Reintentá: al subir primero el insumo, el movimiento entra solo.';
  if (code === '23505' || /duplicate key|already exists/.test(m))
    return 'Registro duplicado: ya existe en el servidor (no se vuelve a crear).';
  if (code === '23502' || /null value in column|not-null/.test(m))
    return 'Falta un dato obligatorio en el registro.';
  return error || 'Error desconocido';
}

export default function SyncDetailModal({ open, onClose, showToast }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState([]);
  const [pending, setPending] = useState(0);
  const [failedTotal, setFailedTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  // Verificación de integridad (local vs servidor) — bajo demanda (hace red).
  const [health, setHealth] = useState(null);        // null | [] | [{...}]
  const [verificando, setVerificando] = useState(false);
  // Fase 3 consumo: migración one-shot de fotos HEIC antiguas (solo admin).
  const [migrandoHeic, setMigrandoHeic] = useState(false);
  const [heicMsg, setHeicMsg] = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const [det, p, f] = await Promise.all([
        getFailedDetails(),
        getPendingCount(),
        getFailedCount(),
      ]);
      setFailed(det);
      setPending(p);
      setFailedTotal(f);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    reload();
  }, [open]);

  if (!open) return null;

  const handleRetryAll = async () => {
    setBusy(true);
    try {
      const res = await retryAllFailed();
      if (showToast) showToast(`Reintentando ${res.total} registros…`, 'amber');
      // Esperar un par de segundos a que el sync corra y refrescar
      setTimeout(async () => { await reload(); setBusy(false); }, 3500);
    } catch (e) {
      if (showToast) showToast(`Error: ${e.message || e}`, 'red');
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      await syncAll();
      await reload();
      if (showToast) showToast('Sincronización forzada completada', 'green');
    } catch (e) {
      if (showToast) showToast(`Error: ${e.message || e}`, 'red');
    } finally {
      setBusy(false);
    }
  };

  const handleVerificar = async () => {
    setVerificando(true);
    try {
      const h = await getSyncHealth();
      setHealth(h);
      const faltantes = h.filter(x => x.faltan > 0);
      if (showToast) {
        if (faltantes.length === 0 && h.every(x => x.error == null))
          showToast('✓ Todo lo del servidor está en este dispositivo.', 'green');
        else if (faltantes.length)
          showToast(`⚠ Faltan datos por descargar en ${faltantes.length} sección(es) — tocá "Forzar resync completo".`, 'amber');
      }
    } catch (e) {
      if (showToast) showToast(`Error al verificar: ${e.message || e}`, 'red');
    } finally {
      setVerificando(false);
    }
  };

  const handleFullResync = async () => {
    if (!confirm(
      'SINCRONIZACIÓN COMPLETA\n\n' +
      'Esto borra el rastro de "última sincronización" y vuelve a descargar todo desde el servidor. ' +
      'Cualquier registro que esté en este dispositivo pero ya NO esté en el servidor (porque otro usuario lo eliminó) se quitará de acá.\n\n' +
      'NO toca lo que tengas pendiente de subir — eso se preserva.\n\n' +
      '¿Continuar?'
    )) return;
    setBusy(true);
    try {
      await forceFullResync();
      if (showToast) showToast('Resync forzado en proceso — recargá en unos segundos para ver cambios', 'amber');
      // Reload counters tras 4s para mostrar el resultado.
      setTimeout(async () => { await reload(); setBusy(false); }, 4000);
    } catch (e) {
      if (showToast) showToast(`Error: ${e.message || e}`, 'red');
      setBusy(false);
    }
  };

  // Fase 3 consumo — convierte las fotos .heic viejas del server a JPEG 1920px
  // (mismo estándar que la captura actual), re-apunta la fila y borra el
  // original. Solo admin. Necesita un navegador que decodifique HEIC (Safari).
  const handleMigrarHeic = async () => {
    if (!confirm(
      'CONVERTIR FOTOS HEIC ANTIGUAS\n\n' +
      'Busca en el servidor las fotos .heic de iPhone subidas antes de la conversión automática ' +
      '(hoy no se ven en las PC), las convierte a JPEG (1920px, el mismo estándar actual) y ' +
      'REEMPLAZA el archivo original por el JPEG.\n\n' +
      'Requiere un navegador que lea HEIC (Safari en Mac o iPhone). En Chrome no rompe nada: ' +
      'las fotos que no pueda leer se saltan y se avisa al final.\n\n¿Continuar?'
    )) return;
    setMigrandoHeic(true);
    setHeicMsg('Buscando fotos HEIC…');
    try {
      const r = await migrarEvidenciasHeic({
        supabase, db, optimizar: optimizarImagenEvidencia,
        onProgress: (msg) => setHeicMsg(msg),
      });
      const resumen = r.total === 0
        ? '✓ No quedan fotos HEIC por convertir.'
        : `✓ ${r.convertidas} convertidas (${r.mbAhorrados} MB recuperados)`
          + (r.noDecodificadas ? ` · ${r.noDecodificadas} necesitan Safari` : '')
          + (r.errores ? ` · ${r.errores} con error` : '')
          + (r.sinBorrarOriginal ? ` · ${r.sinBorrarOriginal} convertidas sin poder borrar el original` : '');
      setHeicMsg(resumen);
      if (showToast) showToast(resumen, r.errores ? 'amber' : 'green');
    } catch (e) {
      setHeicMsg(`Error: ${e.message || e}`);
      if (showToast) showToast(`Error al migrar HEIC: ${e.message || e}`, 'red');
    } finally {
      setMigrandoHeic(false);
    }
  };

  const esAdmin = (typeof window !== 'undefined' && window.__currentRol) === 'admin';

  return (
    <div onClick={e => e.target === e.currentTarget && !busy && onClose()}
         style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div className="card" style={{ background:'var(--bg-s)', maxWidth:760, width:'100%', maxHeight:'88vh', display:'flex', flexDirection:'column', borderRadius:10 }}>
        <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)' }}>Estado de sincronización</div>
            <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:3 }}>
              {failedTotal > 0
                ? <><strong style={{ color:'var(--red)' }}>{failedTotal} con error</strong> · {pending} pendientes</>
                : pending > 0
                  ? <><strong style={{ color:'var(--amber)' }}>{pending} pendientes</strong> de subir al servidor</>
                  : 'Todo sincronizado'}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onClose}>✕</button>
        </div>

        <div style={{ flex:1, overflowY:'auto', padding:'14px 18px' }}>
          {loading ? (
            <div style={{ textAlign:'center', color:'var(--tm)', padding:30 }}>Cargando…</div>
          ) : failed.length === 0 && pending === 0 ? (
            <div style={{ textAlign:'center', padding:30, color:'var(--green)' }}>
              <div style={{ fontSize:40 }}>✓</div>
              <div style={{ fontSize:14, fontWeight:600, marginTop:8 }}>Todos los registros están sincronizados.</div>
              <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:6 }}>No hay nada pendiente ni con error.</div>
            </div>
          ) : (
            <>
              {failed.length > 0 && (
                <div className="card card-p" style={{ marginBottom:14, background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.25)' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--red)', marginBottom:8 }}>
                    ⚠ {failedTotal} registros no se pudieron subir
                  </div>
                  <div style={{ fontSize:11.5, color:'var(--ts)', lineHeight:1.6, marginBottom:10 }}>
                    Estos datos están guardados en tu dispositivo pero <strong>NO están en el servidor</strong>. Otros usuarios no los pueden ver. Causas típicas: error de permisos (RLS), schema desactualizado en server, conflicto temporal. Click en "Reintentar todos" para volver a intentar — si la causa fue temporal, se resuelve solo.
                  </div>
                  {failed.map((g) => (
                    <details key={g.tabla} style={{ marginBottom:8 }}>
                      <summary style={{ cursor:'pointer', padding:'6px 0', fontSize:12, color:'var(--tp)', fontWeight:600 }}>
                        {g.label} · <span style={{ color:'var(--red)' }}>{g.count}</span> registros
                      </summary>
                      <div style={{ marginLeft:14, marginTop:6, maxHeight:200, overflowY:'auto', fontSize:11 }}>
                        {g.rows.map(r => (
                          <div key={r.id} style={{ padding:'6px 8px', background:'rgba(0,0,0,0.18)', borderRadius:4, marginBottom:4 }}>
                            <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                              <span style={{ fontWeight:600 }}>{r.nombre || r.codigo}</span>
                              {r.isRLS && <span style={{ fontSize:9, padding:'1px 5px', borderRadius:3, background:'rgba(239,68,68,0.18)', color:'var(--red)' }}>RLS</span>}
                            </div>
                            {r.descripcion && r.descripcion !== r.nombre && <div style={{ color:'var(--ts)', marginTop:2 }}>{r.descripcion}</div>}
                            <div style={{ color:'var(--amber)', fontSize:11, marginTop:3 }}>{mensajeAmigable(r.errorCode, r.error, r.regla)}</div>
                            <details style={{ marginTop:3 }}>
                              <summary style={{ cursor:'pointer', color:'var(--tm)', fontSize:9.5 }}>Detalle técnico</summary>
                              <div style={{ color:'var(--tm)', fontSize:10, marginTop:2 }}>
                                {r.errorCode && <span style={{ fontFamily:'monospace' }}>[{r.errorCode}]</span>} {r.error}
                                {r.errorDetails && <div style={{ marginTop:2 }}>{r.errorDetails}</div>}
                                {r.errorHint && <div style={{ marginTop:2, fontStyle:'italic' }}>💡 {r.errorHint}</div>}
                              </div>
                            </details>
                          </div>
                        ))}
                        {g.count > g.rows.length && (
                          <div style={{ color:'var(--tm)', marginTop:4, fontSize:10 }}>… y {g.count - g.rows.length} más</div>
                        )}
                      </div>
                    </details>
                  ))}
                </div>
              )}

              {pending > 0 && (
                <div className="card card-p" style={{ background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.25)' }}>
                  <div style={{ fontSize:13, fontWeight:700, color:'var(--amber)', marginBottom:8 }}>
                    ⏳ {pending} registros esperando subir
                  </div>
                  <div style={{ fontSize:11.5, color:'var(--ts)', lineHeight:1.6 }}>
                    Los datos están en tu dispositivo y se subirán automáticamente en el próximo ciclo de sincronización (≤30 segundos), o cuando recuperes señal. Si querés forzar la subida ahora, click en "Sincronizar ahora".
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── VERIFICACIÓN DE INTEGRIDAD (local vs servidor) ── */}
          <div className="card card-p" style={{ marginTop:14, background:'rgba(59,130,246,0.06)', border:'1px solid rgba(59,130,246,0.25)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--blue)' }}>
                🔎 Verificación con el servidor
              </div>
              <button className="btn btn-ghost btn-sm" disabled={verificando || busy} onClick={handleVerificar}
                style={{ fontSize:11.5, color:'var(--blue)' }}>
                <JxIcon name="refresh" size={12}/> {verificando ? 'Verificando…' : 'Verificar ahora'}
              </button>
            </div>
            <div style={{ fontSize:11.5, color:'var(--ts)', lineHeight:1.6, marginTop:6 }}>
              Compara lo que tenés en <strong>este dispositivo</strong> contra lo que hay en el <strong>servidor</strong>.
              Sirve para confirmar que estás viendo <strong>todo</strong> lo subido (facturas, evidencias, movimientos) y detectar si te falta descargar algo.
            </div>

            {health && (
              <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:5 }}>
                {health.map(h => {
                  const faltan = h.faltan;
                  const sinSubir = h.sinSubir;
                  const estado = h.error ? 'error' : (faltan > 0 || sinSubir > 0) ? 'alerta' : 'ok';
                  const color = estado === 'error' ? 'var(--tm)' : estado === 'alerta' ? 'var(--red)' : 'var(--green)';
                  const icono = estado === 'error' ? '—' : estado === 'alerta' ? '⚠' : '✓';
                  return (
                    <div key={h.tabla} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8,
                      padding:'6px 9px', background:'rgba(0,0,0,0.16)', borderRadius:5, fontSize:11.5 }}>
                      <span style={{ color:'var(--tp)', fontWeight:600, flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{h.label}</span>
                      {h.error ? (
                        <span style={{ color:'var(--tm)', fontSize:10.5 }}>{h.error}</span>
                      ) : (
                        <span style={{ color:'var(--tm)', fontSize:10.5, whiteSpace:'nowrap' }}>
                          acá <strong style={{ color:'var(--ts)' }}>{h.local}</strong> · servidor <strong style={{ color:'var(--ts)' }}>{h.server}</strong>
                          {faltan > 0 && <strong style={{ color:'var(--red)' }}> · faltan {faltan}</strong>}
                          {sinSubir > 0 && <strong style={{ color:'var(--amber)' }}> · {sinSubir} sin subir</strong>}
                        </span>
                      )}
                      <span style={{ color, fontWeight:700, width:16, textAlign:'center' }}>{icono}</span>
                    </div>
                  );
                })}
                {health.some(h => h.faltan > 0) && (
                  <div style={{ fontSize:11.5, color:'var(--red)', lineHeight:1.6, marginTop:4 }}>
                    ⚠ A este dispositivo le faltan datos que sí están en el servidor. Tocá <strong>"Forzar resync completo"</strong> abajo para descargarlos. Si tras eso sigue faltando, avisá.
                  </div>
                )}
                {health.some(h => h.sinSubir > 0) && (
                  <div style={{ fontSize:11.5, color:'var(--amber)', lineHeight:1.6, marginTop:4 }}>
                    ⚠ Hay comprobantes/evidencias que <strong>todavía no terminaron de subir</strong> desde este dispositivo (los demás aún no los ven). Tocá <strong>"Reintentar todos"</strong> o esperá al próximo ciclo; si quedan con error, revisá el detalle arriba.
                  </div>
                )}
                {health.every(h => h.error == null && !(h.faltan > 0) && !(h.sinSubir > 0)) && (
                  <div style={{ fontSize:11.5, color:'var(--green)', lineHeight:1.6, marginTop:4 }}>
                    ✓ Estás viendo todo lo que hay en el servidor y todo lo tuyo ya subió.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── MANTENIMIENTO (solo admin): migrar fotos HEIC antiguas ── */}
          {esAdmin && (
            <div className="card card-p" style={{ marginTop:14, background:'rgba(168,85,247,0.06)', border:'1px solid rgba(168,85,247,0.25)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--tp)' }}>
                  🧹 Mantenimiento: fotos HEIC antiguas
                </div>
                <button className="btn btn-ghost btn-sm" disabled={migrandoHeic || busy} onClick={handleMigrarHeic}
                  style={{ fontSize:11.5 }}>
                  {migrandoHeic ? 'Convirtiendo…' : 'Convertir a JPEG'}
                </button>
              </div>
              <div style={{ fontSize:11.5, color:'var(--ts)', lineHeight:1.6, marginTop:6 }}>
                Convierte las fotos <strong>.heic de iPhone</strong> subidas antes de la conversión automática
                (no se ven en las PC y ocupan ~20× más espacio) a JPEG estándar, y reemplaza el original.
                Correlo desde <strong>Safari</strong> (Mac o iPhone) — Chrome no puede leer HEIC.
              </div>
              {heicMsg && (
                <div style={{ fontSize:11.5, color:'var(--tp)', marginTop:8, fontWeight:600 }}>{heicMsg}</div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding:'12px 18px', borderTop:'1px solid var(--border)', display:'flex', gap:8, justifyContent:'space-between', alignItems:'center', flexWrap:'wrap' }}>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={handleFullResync}
            title="Recovery: vuelve a descargar todo desde el server. Útil si este dispositivo ve cosas que ya fueron borradas en otro."
            style={{ fontSize:11.5, color:'var(--amber)' }}
          >
            <JxIcon name="refresh" size={12}/> Forzar resync completo
          </button>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost" disabled={busy} onClick={onClose}>Cerrar</button>
            {failedTotal > 0 && (
              <button className="btn btn-amber" disabled={busy} onClick={handleRetryAll}>
                <JxIcon name="refresh" size={13}/> {busy ? 'Reintentando…' : `Reintentar todos (${failedTotal})`}
              </button>
            )}
            {pending > 0 && failedTotal === 0 && (
              <button className="btn btn-amber" disabled={busy} onClick={handleSyncNow}>
                <JxIcon name="refresh" size={13}/> {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
