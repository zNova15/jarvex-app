// ═══════════════════════════════════════════════════════════════════
// JARVEX — RECOMENDADOR DE ACTIVOS FIJOS, la pantalla (tanda 7).
//
// El criterio vive en src/lib/recomendador-activos.js (puro, 59 tests). Acá
// solo se pinta y se acepta.
//
// 🔴 REGLA DE ORO, pedida por Gabriel: nada se consolida solo. Cada fila la
// acepta una persona. «Obviamente, como recomendación, y sin llegar a
// consolidarlo, sin que se acepte por parte de una contadora.»
//
// Archivo aparte con import estático desde jx-activos-fijos.jsx: no crea chunk.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  candidatosActivo, candidatosPorEmpresa, claveLinea,
  umbralActivoFijo, CAJON_LABEL,
} from "../lib/recomendador-activos.js";

const { useState, useMemo } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);

const fmt = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @param movs        accounting_movements
 * @param activos     activos_fijos ya cargados (para no reproponer)
 * @param companyId   la empresa seleccionada en la pantalla
 * @param periodo     el ejercicio
 * @param onAceptar   (candidato) => Promise — crea la fila en activos_fijos
 */
function RecomendadorActivosModal({
  movs, activos, companies, activosPesados, companyId, periodo,
  onClose, onAceptar, puedeEditar, showToast,
}) {
  const [ocupado, setOcupado] = useState(null);
  const [aceptados, setAceptados] = useState(() => new Set());

  const umbral = umbralActivoFijo(Number(periodo));

  // Ya cargados: por línea de factura (mig 182) y también por comprobante,
  // para los activos que se registraron antes de que existiera el índice.
  const yaCargados = useMemo(() => {
    const s = new Set();
    for (const a of activos || []) {
      if (a.deleted_at || !a.accounting_movement_id) continue;
      if (a.accounting_item_idx != null) s.add(claveLinea(a.accounting_movement_id, a.accounting_item_idx));
    }
    for (const k of aceptados) s.add(k);
    return s;
  }, [activos, aceptados]);

  const candidatos = useMemo(
    () => candidatosActivo(movs || [], { companyId, yaCargados }),
    [movs, companyId, yaCargados]
  );
  const porEmpresa = useMemo(() => candidatosPorEmpresa(movs || [], { yaCargados }), [movs, yaCargados]);

  const nombre = (id) => (companies || []).find(c => c.id === id)?.name || '—';

  // «Hay N en otras empresas»: sin esto, la moto SSENDA cargada en MIGUEL
  // ANGEL JULCA SALAZAR es invisible para siempre desde JARVEX.
  const enOtras = useMemo(() => {
    const out = [];
    for (const [cid, n] of porEmpresa) {
      if (cid === companyId) continue;
      out.push({ cid, n, nombre: nombre(cid) });
    }
    return out.sort((a, b) => b.n - a.n);
  }, [porEmpresa, companyId, companies]);

  // Equipos pesados sin costo: los que este panel puede completar.
  const pesadosSinCosto = useMemo(
    () => (activosPesados || []).filter(a => !a.deleted_at && a.costo_adquisicion == null),
    [activosPesados]
  );

  const aceptar = async (c) => {
    if (!puedeEditar || ocupado) return;
    setOcupado(claveLinea(c.movimiento_id, c.item_idx));
    try {
      await onAceptar(c);
      setAceptados(prev => new Set(prev).add(claveLinea(c.movimiento_id, c.item_idx)));
      showToast?.('Agregado al registro de activos fijos', 'green');
    } catch (e) {
      showToast?.('No se pudo agregar: ' + (e.message || e), 'red');
    } finally { setOcupado(null); }
  };

  return (
    <Modal title="Qué de lo comprado parece activo fijo" icon="tool" size="xl" onClose={onClose}>
      <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--blue)', fontSize: 11.5, color: 'var(--ts)' }}>
        Esto es una <strong>recomendación</strong>: se lee lo que compró {companyId ? nombre(companyId) : 'la empresa'} y
        se propone qué parece un bien que dura. <strong>Nada entra al registro hasta que lo aceptes.</strong>
        {umbral ? <> El umbral de 1/4 de UIT del {periodo} es {fmt(umbral)}, pero <strong>no es el filtro</strong>:
          por debajo también se puede activar, y es lo que decidiste para las máquinas.</> : null}
      </div>

      {enOtras.length > 0 && (
        <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)', fontSize: 11.5 }}>
          <strong>Hay candidatos en otras empresas:</strong>{' '}
          {enOtras.map(e => `${e.nombre} (${e.n})`).join(' · ')}.
          <div style={{ color: 'var(--tm)', marginTop: 3 }}>
            Cambiá la empresa arriba para verlos. Un bien puede estar cargado a nombre de quien no esperabas.
          </div>
        </div>
      )}

      {pesadosSinCosto.length > 0 && (
        <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--purple)', fontSize: 11.5 }}>
          <strong>{pesadosSinCosto.length} equipo(s) en Equipos Pesados sin costo de adquisición:</strong>{' '}
          {pesadosSinCosto.slice(0, 4).map(a => a.nombre).join(' · ')}
          {pesadosSinCosto.length > 4 ? '…' : ''}.
          <div style={{ color: 'var(--tm)', marginTop: 3 }}>
            Si alguno es de los de abajo, aceptalo acá y quedan enlazados: así no se registran dos veces.
          </div>
        </div>
      )}

      {!companyId ? (
        <div className="card card-p empty-state">
          <JxIcon name="building" size={34} color="var(--tm)" />
          <p>Elegí una empresa arriba para ver qué compró.</p>
        </div>
      ) : candidatos.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="checkCircle" size={34} color="var(--green)" />
          <p>No queda nada por revisar en {nombre(companyId)}: todo lo que parecía activo ya está en el registro.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, maxHeight: '56vh', overflowY: 'auto' }}>
          {candidatos.map(c => {
            const k = claveLinea(c.movimiento_id, c.item_idx);
            const total = (c.precio_unitario || 0) * (c.cantidad || 1);
            return (
              <div key={k} className="card card-p" style={{ border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 260 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--tp)' }}>{c.descripcion}</div>
                    <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 3 }}>
                      {c.documento || '—'} · {c.fecha || '—'} ·{' '}
                      {c.cantidad || 1} {c.unidad || 'und'} × <strong style={{ color: 'var(--tp)' }}>{fmt(c.precio_unitario)}</strong>
                      {(c.cantidad || 1) > 1 ? <> · total {fmt(total)}</> : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ts)', marginTop: 4 }}>
                      {c.motivo}
                      {c.confianza === 'media' && <span className="badge b-gray" style={{ marginLeft: 5, fontSize: 9 }}>señal débil</span>}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 4 }}>
                      Propuesta: cuenta <strong>{c.cuenta}</strong> · depreciación <strong>{c.tasa}%</strong>
                      {umbral != null && (
                        <> · {c.precio_unitario >= umbral
                          ? 'por encima de 1/4 UIT'
                          : 'por debajo de 1/4 UIT (se puede activar igual)'}</>
                      )}
                    </div>
                    {/* 🔴 El aviso que evita contar la misma plata dos veces. */}
                    {c.yaEsCostoDeObra && (
                      <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 5 }}>
                        ⚠ Esta compra ya está cargada como <strong>costo de una obra</strong>. Si además la activas,
                        los mismos soles cuentan dos veces: en el margen de la obra y como bien depreciable.
                        Hay que sacarla del costo.
                      </div>
                    )}
                  </div>
                  {puedeEditar && (
                    <button className="btn btn-amber btn-sm" disabled={ocupado === k}
                      onClick={() => aceptar(c)} style={{ flexShrink: 0 }}
                      title="Crear la fila en el registro de activos fijos con estos datos">
                      {ocupado === k ? 'Agregando…' : '+ Es activo'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 12 }}>
        Solo se listan los que parecen <strong>{CAJON_LABEL.activo_uso.toLowerCase()}</strong>. Lo que se consume
        (servicios, EPP, thinner), lo que no es un bien (anticipos, copias, alojamiento) y el material de obra a
        granel quedan fuera a propósito.
      </div>
    </Modal>
  );
}

Object.assign(window, { RecomendadorActivosModal });
export { RecomendadorActivosModal };
