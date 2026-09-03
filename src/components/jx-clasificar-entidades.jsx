// ═══════════════════════════════════════════════════════════════════
// JARVEX — Revisión del catálogo de empresas (mig 172).
//
// De 17 companies activas en producción, solo DOS son empresas propias del
// grupo: dos son consorcios y trece son proveedores que Captura Mágica creó
// sola al leer una factura. Esta pantalla las separa.
//
// POR QUÉ ES UNA PANTALLA Y NO UN UPDATE MASIVO: dos de las companies se
// llaman "CONSORCIO …" y NO son consorcios del grupo (CONSORCIO ESPERANZA,
// CONSORCIO SAMADAY: proveedores). Cualquier reclasificación por nombre las
// rompería. La heurística sugiere — con la evidencia a la vista — y una
// persona decide.
//
// La lógica de sugerencia vive en src/lib/clasificacion-entidad.js, con tests.
// Acá solo está la interacción y la escritura.
//
// Usa Modal / JxIcon (globales).
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { revisarCatalogo, pendientesDeVincular, TIPOS_ENTIDAD, TIPO_ENTIDAD_LBL } from "../lib/clasificacion-entidad.js";
const { useState: uSK, useMemo: uMK, useRef: uRK } = React;

const BADGE = { propia: 'b-green', consorcio: 'b-amber', tercero: 'b-gray' };

export function ClasificarEntidadesModal({ companies, obras, consorcios, movs, userId, showToast, onClose }) {
  // Conteo de movimientos por empresa: es lo que le dice a quien revisa cuánta
  // contabilidad hay detrás de cada fila antes de tocarla.
  const movsPorCompany = uMK(() => {
    const m = {};
    (movs || []).forEach(x => { if (!x?.deleted_at) m[x.company_id] = (m[x.company_id] || 0) + 1; });
    return m;
  }, [movs]);

  const { filas, resumen } = uMK(
    () => revisarCatalogo({ companies, obras, movsPorCompany }),
    [companies, obras, movsPorCompany]);

  // Arranca con las sugerencias precargadas; el usuario corrige lo que quiera.
  const [decisiones, setDecisiones] = uSK(() =>
    Object.fromEntries(filas.map(f => [f.company.id, f.sugerido])));
  // Para las marcadas como consorcio: a qué obra se vinculan.
  const [obraDe, setObraDe] = uSK(() =>
    Object.fromEntries(filas.filter(f => f.sugerido === 'consorcio')
      .map(f => [f.company.id, f.obrasEjecutora[0]?.id || ''])));
  const [aplicando, setAplicando] = uSK(false);

  const obrasVivas = uMK(() => (obras || []).filter(o => !o.deleted_at), [obras]);

  const pendientes = uMK(
    () => pendientesDeVincular(decisiones, { companies, obras, consorcios }),
    [decisiones, companies, obras, consorcios]);

  // Un consorcio sin obra quedaría invisible: fuera del catálogo de Empresas y
  // sin ficha en ninguna obra. Se bloquea antes de aplicar.
  const sinObra = pendientes.filter(p => !obraDe[p.company_id]);
  const cambios = filas.filter(f => decisiones[f.company.id] !== f.actual);

  // Guard SÍNCRONO: esto escribe en lote sobre Dexie y el guard por estado se
  // activa recién tras el primer await — un segundo click en esa ventana
  // duplicaría los consorcios creados (regla crítica 2).
  const enCursoRef = uRK(false);
  const aplicar = async () => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try { await aplicarInner(); } finally { enCursoRef.current = false; }
  };

  const aplicarInner = async () => {
    if (sinObra.length) {
      showToast?.('Elegí la obra de cada consorcio antes de aplicar.', 'red');
      return;
    }
    if (!cambios.length) { showToast?.('No hay cambios que aplicar.', 'amber'); return; }
    setAplicando(true);
    const now = new Date().toISOString();
    let nTipo = 0, nCons = 0;
    try {
      for (const f of cambios) {
        const c = f.company;
        const tipo = decisiones[c.id];
        await window.__db.companies.update(c.id, {
          tipo_entidad: tipo,
          updated_at: now, updated_by: userId,
          version: (c.version ?? 0) + 1,
          sync_status: c.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        nTipo++;

        // Marcar consorcio sin darle su obra lo dejaría sin ficha en ningún
        // lado, así que la fila de `consorcios` se crea en el mismo paso.
        if (tipo === 'consorcio') {
          const yaTiene = (consorcios || []).some(k => !k.deleted_at && k.company_id === c.id);
          const obraId = obraDe[c.id];
          if (!yaTiene && obraId) {
            const kid = window.__newId();
            await window.__db.consorcios.add({
              id: kid,
              obra_id: obraId,
              company_id: c.id,
              nombre: c.name || 'Consorcio',
              ruc: c.ruc || null,
              estado: 'activo',
              fecha_constitucion: null,
              created_at: now, updated_at: now,
              created_by: userId, updated_by: userId,
              version: 1, sync_status: 'pending_create',
              idempotency_key: `${userId}_consorcios_${kid}`,
            });
            // La obra queda declarada como ejecutada por consorcio. Su
            // ejecutora_company_id NO se toca: ya apunta a esta company, que es
            // el titular contable — el invariante de la mig 172.
            const obra = obrasVivas.find(o => o.id === obraId);
            if (obra && obra.ejecutora_tipo !== 'consorcio') {
              await window.__db.obras.update(obraId, {
                ejecutora_tipo: 'consorcio',
                updated_at: now, updated_by: userId,
                version: (obra.version ?? 0) + 1,
                sync_status: obra.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
              });
            }
            nCons++;
          }
        }

        try {
          await window.__logAudit?.({
            action: 'update', table: 'companies', recordId: c.id,
            oldData: { tipo_entidad: f.actual }, newData: { tipo_entidad: tipo },
            reason: 'Revisión de clasificación del catálogo (mig 172)',
          });
        } catch {}
      }
      for (const t of ['companies', 'consorcios', 'obras']) {
        try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {}
      }
      showToast?.(`${nTipo} empresa${nTipo === 1 ? '' : 's'} reclasificada${nTipo === 1 ? '' : 's'}` +
        (nCons ? ` · ${nCons} consorcio${nCons === 1 ? '' : 's'} vinculado${nCons === 1 ? '' : 's'} a su obra` : ''), 'green');
      onClose?.();
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    } finally {
      setAplicando(false);
    }
  };

  return (
    <Modal title="Revisar clasificación de empresas" icon="building" onClose={onClose} wide>
      <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 10, lineHeight: 1.5 }}>
        El catálogo mezcla empresas del grupo, consorcios y proveedores que aparecieron solos desde una factura.
        Abajo va una sugerencia por empresa <strong>con la evidencia en que se apoya</strong> — corregí lo que haga falta antes de aplicar.
        Reclasificar <strong>no mueve ningún movimiento contable</strong>: solo cambia dónde se administra cada empresa.
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, fontSize: 11 }}>
        <span className="badge b-green">Del grupo: {resumen.propia}</span>
        <span className="badge b-amber">Consorcios: {resumen.consorcio}</span>
        <span className="badge b-gray">Terceros: {resumen.tercero}</span>
        <span className="badge b-blue">Cambian: {cambios.length}</span>
      </div>

      <div style={{ overflowX: 'auto', maxHeight: '52vh', overflowY: 'auto' }}>
        <table className="tbl">
          <thead><tr>
            <th>Empresa</th>
            <th style={{ textAlign: 'right' }}>Movs.</th>
            <th>Por qué</th>
            <th>Clasificar como</th>
          </tr></thead>
          <tbody>
            {filas.map(f => {
              const c = f.company;
              const elegido = decisiones[c.id];
              const cambia = elegido !== f.actual;
              const necesitaObra = elegido === 'consorcio' &&
                !(consorcios || []).some(k => !k.deleted_at && k.company_id === c.id);
              return (
                <tr key={c.id} style={cambia ? { background: 'var(--bg-s)' } : undefined}>
                  <td className="col-p">
                    <strong>{c.name}</strong>
                    <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{c.ruc ? `RUC ${c.ruc}` : 'sin RUC'}</div>
                  </td>
                  <td className="col-m" style={{ textAlign: 'right' }}>{f.evidencia.movs || '—'}</td>
                  <td style={{ fontSize: 11, maxWidth: 280 }}>
                    <div>{f.motivo}</div>
                    {f.evidencia.obras.length > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--green)', marginTop: 2 }}
                        title={f.evidencia.obras.join('\n')}>
                        Ejecutora de: {f.evidencia.obras[0].slice(0, 42)}{f.evidencia.obras[0].length > 42 ? '…' : ''}
                      </div>
                    )}
                    <div style={{ marginTop: 3 }}>
                      <span className={`badge ${BADGE[f.actual]}`} style={{ fontSize: 9 }}>
                        hoy: {TIPO_ENTIDAD_LBL[f.actual]}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {TIPOS_ENTIDAD.map(t => (
                        <button key={t.v} type="button" title={t.desc}
                          className={`btn btn-xs ${elegido === t.v ? 'btn-amber' : 'btn-ghost'}`}
                          onClick={() => setDecisiones(d => ({ ...d, [c.id]: t.v }))}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    {necesitaObra && (
                      <div style={{ marginTop: 5 }}>
                        <select className="fi" style={{ fontSize: 11 }}
                          value={obraDe[c.id] || ''}
                          onChange={e => setObraDe(o => ({ ...o, [c.id]: e.target.value }))}>
                          <option value="">— ¿Qué obra ejecuta? —</option>
                          {obrasVivas.map(o => (
                            <option key={o.id} value={o.id}>{(o.nombre_obra || '').slice(0, 60)}</option>
                          ))}
                        </select>
                        {!obraDe[c.id] && (
                          <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 2 }}>
                            Un consorcio se administra desde su obra: sin obra quedaría invisible.
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost" disabled={aplicando} onClick={onClose}>Cancelar</button>
        <button className="btn btn-amber" disabled={aplicando || !cambios.length || sinObra.length > 0} onClick={aplicar}>
          <JxIcon name="check" size={13}/>
          {aplicando ? 'Aplicando…' : `Aplicar ${cambios.length} cambio${cambios.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </Modal>
  );
}
