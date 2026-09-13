// ═══════════════════════════════════════════════════════════════════
// JARVEX — ANTICIPOS A PROVEEDORES (mig 207). Panel del bloque Inventario de
// cada empresa.
//
// ── EL PEDIDO (Gabriel, 13-set-2026) ──────────────────────────────
// «En el inventario de las empresas (en este caso de GASOMI) puede ocurrir que
// tenemos anticipos. Estos hay que ubicarlos y vincularlos con la factura que
// anticipan su pago. Este caso pasa con KOPLAST. […] No olvides que los
// anticipos deberían identificarse.»
//
// Un anticipo es plata que YA salió y mercadería que todavía NO llegó: un
// activo exigible contra el proveedor. La app ya lo detectaba como TIPO de
// línea (badge morado en la ficha del insumo) pero no lo administraba — no
// había forma de decir cuánto llegó contra él ni cuánto queda a favor.
//
// ── LO QUE ESTA PANTALLA NO HACE: INVENTAR UN IMPORTE ─────────────
// Cuando el proveedor factura la entrega en CERO —porque el descuento del
// anticipo ya se aplicó adentro del comprobante, que es lo que Gabriel vio en
// KOPLAST— el total no dice cuánto valía la mercadería. Eso está en el PDF y
// lo escribe una persona. Proponer un número plausible ahí sería el mismo
// error que «sugerir sin clasificar»: un dato inventado se pierde entre los
// buenos y nadie lo vuelve a mirar.
//
// SÍ propone, con el motivo a la vista, las facturas que una nota de crédito
// anuló por completo: ésa es una señal dura —la factura se emitió a precio, se
// anuló entera y la mercadería se entregó igual— y trae su importe.
//
// NO se importa con `import()` dinámico: lo trae `jx-empresa-detalle.jsx` con
// un import estático y viaja en su mismo chunk (regla 1 del CLAUDE.md).
//
// La lógica vive en `src/lib/anticipos.js` (pura, con tests sobre los datos
// reales de KOPLAST) y la escritura en `src/lib/anticipos-db.js`.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { panelAnticipos, aplicacionNueva } from "../lib/anticipos.js";
import { aplicarAnticipo, aplicarEnLote, quitarAplicacion } from "../lib/anticipos-db.js";

const { useState: uS, useMemo: uM, useRef: uR } = React;

const fmtMonto = (n, moneda = 'PEN') =>
  `${moneda === 'USD' ? 'USD ' : moneda === 'PEN' ? 'S/ ' : `${moneda} `}${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (f) => (f ? String(f).split('-').reverse().join('/') : '—');

function PanelAnticipos({ movs, aplicaciones, companyId = null, demo = false, userId = null, onCambio }) {
  const [abierto, setAbierto] = uS(null);      // id del anticipo expandido
  const [montos, setMontos] = uS({});          // facturaId → monto escrito a mano
  const [msg, setMsg] = uS('');
  // Anti doble-click (regla crítica 2 del CLAUDE.md): ref SÍNCRONO. Un doble
  // tap en «Aplicar» no puede consumir el anticipo dos veces.
  const enCursoRef = uR(false);

  // Se calcula DURANTE el render (useMemo), no en un efecto: así el test de
  // montaje ve el panel dibujado de verdad — renderToString no corre efectos.
  const panel = uM(
    () => panelAnticipos(movs || [], aplicaciones || [], { companyId, demo }),
    [movs, aplicaciones, companyId, demo],
  );

  const conGuard = (fn) => async (...args) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try { await fn(...args); }
    catch (e) { setMsg('No se pudo guardar: ' + (e?.message || e)); }
    finally { enCursoRef.current = false; }
  };

  const aplicar = conGuard(async (ant, prop) => {
    const monto = Number(montos[prop.facturaId] ?? prop.monto) || 0;
    if (!(monto > 0)) {
      setMsg('Escribí cuánto de este anticipo cubre esa entrega — el importe está en el PDF de la factura.');
      return;
    }
    await aplicarAnticipo(aplicacionNueva(ant, {
      facturaId: prop.facturaId, monto, motivo: prop.motivo, fuente: 'manual',
    }), { userId });
    setMontos(m => { const n = { ...m }; delete n[prop.facturaId]; return n; });
    setMsg('');
    onCambio?.();
  });

  const aplicarLasAnuladas = conGuard(async (ant) => {
    const listas = (ant.propuestas || []).filter(p => !p.pideMonto && p.monto > 0);
    if (!listas.length) return;
    await aplicarEnLote(listas.map(p => aplicacionNueva(ant, {
      facturaId: p.facturaId, monto: p.monto, motivo: p.motivo, fuente: 'manual',
    })), { userId });
    setMsg('');
    onCambio?.();
  });

  const quitar = conGuard(async (id) => { await quitarAplicacion(id); onCambio?.(); });

  // Sin anticipos no hay nada que decir: el panel no se dibuja. La enorme
  // mayoría de las empresas del grupo no tiene ninguno.
  if (!panel.filas.length) return null;

  return (
    <div className="card card-p" style={{ marginBottom: 10, borderLeft: '3px solid var(--purple, #8b5cf6)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13, color: 'var(--purple, #8b5cf6)' }}>
          Anticipos a proveedores ({panel.filas.length})
        </strong>
        <span style={{ fontSize: 11.5, color: 'var(--tm)', flex: 1, minWidth: 240 }}>
          Plata que ya salió y mercadería que todavía no llegó. Vinculá cada anticipo con las facturas
          que cubre para saber cuánto queda a favor.
        </span>
      </div>

      {/* Los totales NO se suman entre monedas: un anticipo en dólares y uno
          en soles no se agregan en un solo número. */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8 }}>
        {panel.totales.map(t => (
          <div key={t.moneda} style={{ fontSize: 11.5 }}>
            <div style={{ color: 'var(--tm)' }}>{t.n} anticipo(s) en {t.moneda}</div>
            <div>
              anticipado <strong>{fmtMonto(t.anticipado, t.moneda)}</strong>
              {' · '}aplicado <strong>{fmtMonto(t.aplicado, t.moneda)}</strong>
              {' · '}
              <span style={{ color: t.saldo > 0.05 ? 'var(--amber)' : 'var(--green)' }}>
                saldo a favor <strong>{fmtMonto(t.saldo, t.moneda)}</strong>
              </span>
            </div>
          </div>
        ))}
      </div>

      {msg && <div style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 8 }}>{msg}</div>}

      <div style={{ marginTop: 10 }}>
        {panel.filas.map(a => (
          <div key={a.id} style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                  {a.proveedorNombre}
                  <span style={{ color: 'var(--tm)', fontWeight: 400 }}> · {a.documento} · {fmtFecha(a.fecha)}</span>
                </div>
                {a.descripcion && (
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>{a.descripcion}</div>
                )}
                <div style={{ display: 'flex', height: 7, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-s)', marginTop: 5, maxWidth: 320 }}>
                  <div style={{ width: `${Math.min(100, a.pct)}%`, background: a.cerrado ? 'var(--green)' : 'var(--purple, #8b5cf6)' }} />
                </div>
                <div style={{ fontSize: 11.5, marginTop: 4 }}>
                  {fmtMonto(a.monto, a.moneda)} anticipado · {fmtMonto(a.aplicado, a.moneda)} aplicado ·{' '}
                  <strong style={{ color: a.cerrado ? 'var(--green)' : 'var(--amber)' }}>
                    {a.cerrado ? 'cerrado' : `${fmtMonto(a.saldo, a.moneda)} a favor`}
                  </strong>
                  {a.excedido && (
                    <span className="badge b-red" style={{ marginLeft: 6 }}
                      title="Se aplicó más de lo que se anticipó: revisá los importes.">
                      aplicado de más
                    </span>
                  )}
                  {a.enOtraMoneda > 0 && (
                    <span className="badge b-amber" style={{ marginLeft: 6 }}
                      title="Hay aplicaciones cargadas en otra moneda: no se suman al saldo.">
                      {a.enOtraMoneda} en otra moneda
                    </span>
                  )}
                </div>
              </div>
              <button className="btn btn-sm" onClick={() => setAbierto(x => (x === a.id ? null : a.id))}>
                {abierto === a.id
                  ? 'Cerrar'
                  : `Ver el detalle · ${a.aplicaciones.length} aplicada(s), ${a.propuestas.length} propuesta(s)`}
              </button>
            </div>

            {abierto === a.id && (
              <DetalleAnticipo
                a={a}
                montos={montos}
                setMontos={setMontos}
                onAplicar={aplicar}
                onAplicarLasAnuladas={aplicarLasAnuladas}
                onQuitar={quitar}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * El detalle de UN anticipo. En su propio componente para que el test de
 * montaje pueda renderizarlo sin poder hacer clic en «Ver el detalle»: es
 * donde un `ap.motivo` sobre un null explotaría en la obra y pasaría el green
 * gate en verde.
 */
function DetalleAnticipo({ a, montos, setMontos, onAplicar, onAplicarLasAnuladas, onQuitar }) {
  const anuladas = (a.propuestas || []).filter(p => !p.pideMonto && p.monto > 0);
  return (
    <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
      {a.aplicaciones.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 3 }}>Ya aplicado</div>
          {a.aplicaciones.map(ap => (
            <div key={ap.id} style={{ fontSize: 11.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '2px 0' }}>
              <span style={{ minWidth: 120 }}>{ap.facturaDocumento}</span>
              <span style={{ color: 'var(--tm)' }}>{fmtFecha(ap.facturaFecha)}</span>
              <strong>{fmtMonto(ap.monto, ap.moneda)}</strong>
              {ap.motivo && <span style={{ color: 'var(--tm)', fontSize: 10.5 }}>{ap.motivo}</span>}
              <button className="btn btn-xs" onClick={() => onQuitar(ap.id)}>Quitar</button>
            </div>
          ))}
        </div>
      )}

      {a.propuestas.length > 0 ? (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 3, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            Lo que la app propone
            {anuladas.length > 0 && (
              <button className="btn btn-xs btn-green" onClick={() => onAplicarLasAnuladas(a)}>
                Aplicar las {anuladas.length} que una nota de crédito anuló
              </button>
            )}
          </div>
          {a.propuestas.map(p => (
            <div key={p.facturaId} style={{ fontSize: 11.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '3px 0' }}>
              <span style={{ minWidth: 120 }}>{p.documento}</span>
              <span style={{ color: 'var(--tm)' }}>{fmtFecha(p.fecha)}</span>
              {p.pideMonto ? (
                <input
                  className="fi"
                  style={{ width: 130, fontSize: 11.5, height: 24 }}
                  placeholder={`monto en ${a.moneda}`}
                  value={montos[p.facturaId] ?? ''}
                  onChange={e => setMontos(m => ({ ...m, [p.facturaId]: e.target.value }))}
                />
              ) : (
                <strong>{fmtMonto(p.monto, p.moneda)}</strong>
              )}
              <span style={{ color: 'var(--tm)', fontSize: 10.5, flex: 1, minWidth: 220 }}>{p.motivo}</span>
              <button className="btn btn-xs btn-green" onClick={() => onAplicar(a, p)}>Aplicar</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
          No hay más facturas de este proveedor contra las cuales aplicar el anticipo.
          {!a.cerrado && (
            <> Si faltan comprobantes por cargar, el saldo de arriba todavía no está cerrado —
            comparalo contra SUNAT en Libros Electrónicos.</>
          )}
        </div>
      )}
    </div>
  );
}

export { PanelAnticipos, DetalleAnticipo };
export default PanelAnticipos;
