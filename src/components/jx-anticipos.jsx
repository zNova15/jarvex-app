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
import { evidenciasDeComprobantes } from "../lib/evidencia-de-comprobante.js";
import { getEvidenciaSrc, abrirUrlEvidencia, precargarEvidencia } from "../lib/evidencias-url.js";

const { useState: uS, useMemo: uM, useRef: uR, useEffect: uE } = React;

// ── EL 👁 Y EL PEDIDO DE CORRECCIÓN (22-set-2026) ──────────────────
//
// EL PEDIDO (Gabriel, textual): «Con respecto a los anticipos, en la sección de
// inventario también me gustaría tener el ojo para visualizar, y en el caso de
// las asistentes que ellas puedan requerir un cambio. […] vi una factura que
// estaba en 0 […] y cuando verifiqué dicha factura tenía más de 10 mil dólares
// en anticipo, pero no se guardó bien […] quise realizar el cambio o
// solicitarlo y no deja.»
//
// Las dos mitades del agujero, y por qué eran una sola pantalla sin salida:
//   1. El importe de una factura en cero está en el PDF y nada más. Este panel
//      pide escribirlo y no daba forma de MIRARLO: había que salir a
//      Movimientos, buscar el comprobante y volver.
//   2. La ayudante de contabilidad NO edita movimientos existentes a propósito
//      (`canEditExisting` en jx-contabilidad.jsx). Su camino es «Solicitar
//      cambio»… que vivía SOLO en Movimientos Contables. Desde acá quedaba sin
//      ninguno de los dos: ni corregir ni pedir.
//
// Por qué el 👁 abre el archivo y no navega a Movimientos (que es la regla del
// 4-sep, «una sola forma de mirar un comprobante»): ésta es una pantalla de
// REVISIÓN —se compara la lista de propuestas contra los papeles, uno tras
// otro— y salir de ella pierde el anticipo abierto y los montos a medio
// escribir. Es el mismo trato que el cotejo, el escáner y el Registro de
// Compras y Ventas: el ojo abre el PDF en una pestaña aparte y la lista queda
// donde estaba. El ↗ sigue estando para ir a la fila completa.
//
// Solo se importan las libs puras del visor: traerse el botón de
// `jx-cotejo-sunat.jsx` metería esa pantalla entera en el chunk de la ficha de
// empresa, que es de donde cuelga este panel.

/** Botón chico: abre el comprobante de un movimiento. Nada si no hay archivo. */
function OjoFactura({ entry, showToast }) {
  if (!entry) return null;
  const abrir = async () => {
    try {
      const src = await getEvidenciaSrc(entry.ev);
      if (!src?.url) { showToast?.('No se pudo abrir el archivo. Si acaba de subirse, probá en un minuto.', 'red'); return; }
      await abrirUrlEvidencia(src.url);
    } catch (e) {
      showToast?.('No se pudo abrir el comprobante: ' + (e?.message || e), 'red');
    }
  };
  return (
    <button className="btn btn-xs" style={{ padding: '1px 6px' }}
      title={`Ver el comprobante cargado (${entry.nombre})`}
      onMouseEnter={() => precargarEvidencia(entry.ev)}
      onClick={abrir}>
      {typeof window !== 'undefined' && window.JxIcon
        ? React.createElement(window.JxIcon, { name: 'eye', size: 11 })
        : '👁'}
    </button>
  );
}

const fmtMonto = (n, moneda = 'PEN') =>
  `${moneda === 'USD' ? 'USD ' : moneda === 'PEN' ? 'S/ ' : `${moneda} `}${Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtFecha = (f) => (f ? String(f).split('-').reverse().join('/') : '—');

function PanelAnticipos({ movs, aplicaciones, companyId = null, demo = false, userId = null, onCambio, onIrAFactura = null, showToast: showToastProp = null }) {
  const [abierto, setAbierto] = uS(null);      // id del anticipo expandido
  const [montos, setMontos] = uS({});          // facturaId → monto escrito a mano
  const [msg, setMsg] = uS('');
  // El movimiento para el que se está pidiendo una corrección (null = ninguno).
  const [pedirCambio, setPedirCambio] = uS(null);
  const showToast = showToastProp || (typeof window !== 'undefined' ? window.__showToast : null) || (() => {});
  // Anti doble-click (regla crítica 2 del CLAUDE.md): ref SÍNCRONO. Un doble
  // tap en «Aplicar» no puede consumir el anticipo dos veces.
  const enCursoRef = uR(false);

  // Se calcula DURANTE el render (useMemo), no en un efecto: así el test de
  // montaje ve el panel dibujado de verdad — renderToString no corre efectos.
  const panel = uM(
    () => panelAnticipos(movs || [], aplicaciones || [], { companyId, demo }),
    [movs, aplicaciones, companyId, demo],
  );

  // ── El archivo de cada comprobante del panel ──────────────────────
  // El anticipo mismo, lo ya aplicado y lo propuesto: todo lo que tiene una
  // fila con un número al lado. Se piden SOLO metadatos (la lib no firma nada);
  // la URL se firma al hacer clic en el ojo.
  const idsConPapel = uM(() => {
    const ids = new Set();
    for (const a of panel.filas || []) {
      if (a.id) ids.add(a.id);
      // OJO: en una aplicación ya guardada la factura es `factura_movimiento_id`
      // (es la columna de la tabla); en una propuesta es `facturaId`. No son el
      // mismo vocabulario y confundirlos deja la fila sin ojo, en silencio.
      for (const ap of a.aplicaciones || []) if (ap.factura_movimiento_id) ids.add(ap.factura_movimiento_id);
      for (const p of a.propuestas || []) if (p.facturaId) ids.add(p.facturaId);
    }
    return [...ids].sort();
  }, [panel]);
  const claveIds = idsConPapel.join(',');
  const [evidencias, setEvidencias] = uS(() => new Map());
  uE(() => {
    let cancel = false;
    (async () => {
      const m = await evidenciasDeComprobantes(claveIds ? claveIds.split(',') : []);
      if (!cancel) setEvidencias(m);
    })();
    return () => { cancel = true; };
  }, [claveIds]);

  const movDe = (id) => (movs || []).find(m => m.id === id) || null;

  /**
   * Abre el modal de «Solicitar cambio» sobre el comprobante de una fila.
   *
   * Es el MISMO modal de Movimientos Contables (`window.RequestChangeModal`,
   * expuesto por jx-solicitudes al arrancar — no se importa dinámicamente:
   * regla 1 del CLAUDE.md). La solicitud queda en Solicitudes con su motivo y
   * la aprueba la Contadora Jefe o el admin, igual que cualquier otra.
   */
  const abrirPedido = (movId) => {
    const mov = movDe(movId);
    if (!mov) { showToast('Ese comprobante no está cargado en esta PC — sincronizá y probá de nuevo.', 'amber'); return; }
    if (!window.RequestChangeModal) {
      showToast('El módulo de solicitudes no cargó — recargá la página (Ctrl+Shift+R)', 'red');
      return;
    }
    setPedirCambio(mov);
  };

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
    // Solo las que anuló una nota de crédito. El filtro era «todo lo que no
    // pide monto» y desde que las facturas en cero traen su importe leído del
    // detalle (15-set) eso habría metido las dos señales en el mismo botón.
    const listas = (ant.propuestas || []).filter(p => p.origen === 'nota_credito' && p.monto > 0);
    if (!listas.length) return;
    await aplicarEnLote(listas.map(p => aplicacionNueva(ant, {
      facturaId: p.facturaId, monto: p.monto, motivo: p.motivo, fuente: 'manual',
    })), { userId });
    setMsg('');
    onCambio?.();
  });

  /**
   * Las facturas que vinieron en CERO y cuyo importe se pudo leer de su propio
   * detalle (ver `valorDeItems`). Son 16 en KOPLAST: de a una eran 16 PDFs
   * abiertos para escribir un número que la app ya tenía.
   *
   * 🔴 PIDE CONFIRMACIÓN Y DICE EL TOTAL. El importe es una LECTURA del
   * detalle, no una prueba dura como la nota de crédito: antes de escribir
   * plata en 16 filas hay que poder ver cuánta es. Cada fila se puede editar
   * antes, y quitar después.
   */
  const aplicarLasDeDetalle = conGuard(async (ant, listas) => {
    const filas = (listas || []).filter(p => p.monto > 0);
    if (!filas.length) return;
    const total = filas.reduce((acc, p) => acc + Number(p.monto || 0), 0);
    const ok = typeof confirm !== 'function' || confirm(
      `Se van a aplicar ${filas.length} facturas contra este anticipo por ${fmtMonto(total, ant.moneda)} en total.\n\n`
      + 'El importe de cada una sale del DETALLE de la propia factura (vino en cero porque el descuento '
      + 'del anticipo ya estaba aplicado). Revisalo contra el PDF si alguna te hace ruido: cada línea se '
      + 'puede quitar después.\n\n¿Seguir?');
    if (!ok) return;
    await aplicarEnLote(filas.map(p => aplicacionNueva(ant, {
      facturaId: p.facturaId, monto: Number(p.monto), motivo: p.motivo, fuente: 'manual',
    })), { userId });
    setMontos({});
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
                <div style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>
                    {a.proveedorNombre}
                    <span style={{ color: 'var(--tm)', fontWeight: 400 }}> · {a.documento} · {fmtFecha(a.fecha)}</span>
                  </span>
                  <AccionesDeFila
                    movId={a.id} doc={a.documento}
                    entry={evidencias.get(a.id)} showToast={showToast}
                    onIrAFactura={onIrAFactura} onPedirCambio={abrirPedido}
                  />
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
                onAplicarLasDeDetalle={aplicarLasDeDetalle}
                onQuitar={quitar}
                evidencias={evidencias}
                showToast={showToast}
                onIrAFactura={onIrAFactura}
                onPedirCambio={abrirPedido}
              />
            )}
          </div>
        ))}
      </div>

      {/* ── EL PEDIDO DE CORRECCIÓN ────────────────────────────────
          El mismo modal de Movimientos Contables, con los campos acotados a lo
          que se corrige DESDE ACÁ: el importe (la factura en cero), su moneda,
          la fecha y el número. No se ofrecen los campos de vinculación ni los
          de bancarización — ésos se piden desde Movimientos, que es donde se
          ven; un desplegable con veinte campos en una pantalla de anticipos
          invita a elegir el que no era. */}
      {pedirCambio && window.RequestChangeModal && React.createElement(window.RequestChangeModal, {
        table: 'accounting_movements',
        record: pedirCambio,
        recordLabel: `${pedirCambio.document_number || 'comprobante'} · ${fmtMonto(pedirCambio.amount, pedirCambio.currency)} · ${pedirCambio.third_party_name || ''}`,
        fields: [
          { key: 'amount', label: 'Importe del comprobante', type: 'number' },
          { key: 'currency', label: 'Moneda' },
          { key: 'date', label: 'Fecha', type: 'date' },
          { key: 'document_number', label: 'N° de documento' },
        ],
        showToast,
        onClose: () => setPedirCambio(null),
      })}
    </div>
  );
}

/**
 * Los botones que acompañan a un comprobante: ver el papel, ir a su fila,
 * pedir que lo corrijan. Uno solo por fila, siempre en el mismo orden.
 *
 * El ojo aparece SOLO si hay archivo cargado (si no, el mapa no trae la
 * entrada): un ojo que después dice «no hay nada» enseña a no hacerle caso.
 * El ✎ está para todos y no solo para la ayudante: cualquiera puede querer
 * dejar el pedido por escrito en vez de corregir de memoria, y quien SÍ puede
 * editar tiene el ↗ al lado para hacerlo directo.
 */
function AccionesDeFila({ movId, doc, entry, showToast, onIrAFactura, onPedirCambio }) {
  // Sin id no hay a qué apuntar: pasa con una aplicación cuyo comprobante no
  // está cargado en esta PC («(comprobante no cargado)» en la fila).
  if (!movId) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <OjoFactura entry={entry} showToast={showToast} />
      {onIrAFactura && (
        <button className="btn btn-xs" style={{ padding: '1px 6px' }}
          title="Abrir este comprobante en Movimientos Contables (con su bancarización, su guía y su recepción)"
          onClick={() => onIrAFactura(movId, doc)}>↗</button>
      )}
      {onPedirCambio && (
        <button className="btn btn-xs" style={{ padding: '1px 6px' }}
          title="Pedir que corrijan este comprobante (por ejemplo, el importe que quedó en cero). Lo aprueba la Contadora Jefe o el admin."
          onClick={() => onPedirCambio(movId)}>✎</button>
      )}
    </span>
  );
}

/**
 * El detalle de UN anticipo. En su propio componente para que el test de
 * montaje pueda renderizarlo sin poder hacer clic en «Ver el detalle»: es
 * donde un `ap.motivo` sobre un null explotaría en la obra y pasaría el green
 * gate en verde.
 */
function DetalleAnticipo({ a, montos, setMontos, onAplicar, onAplicarLasAnuladas, onAplicarLasDeDetalle, onQuitar,
                           evidencias = null, showToast = null, onIrAFactura = null, onPedirCambio = null }) {
  // Los tres botones de cada factura del detalle. `evidencias` puede no venir
  // (un test que monta este componente suelto): entonces no hay ojo y ya.
  const acciones = (movId, doc) => (
    <AccionesDeFila
      movId={movId} doc={doc}
      entry={evidencias?.get?.(movId)} showToast={showToast}
      onIrAFactura={onIrAFactura} onPedirCambio={onPedirCambio}
    />
  );
  // 🔴 LAS DOS SEÑALES NO SE MEZCLAN EN EL MISMO BOTÓN (15-set-2026). Hasta
  // hoy el filtro era «todo lo que no pide monto», y con las facturas en cero
  // trayendo su importe leído del detalle habrían entrado ahí: el botón diría
  // «nota de crédito» y aplicaría otra cosa. Se filtra por `origen`.
  // `origen` lo pone `proponerAplicaciones`; una propuesta armada por un caller
  // viejo no lo trae, y ahí vale la regla de antes: con importe y sin pedirlo,
  // es una anulada. Sin este resguardo un fixture sin el campo nuevo cambiaba
  // de rama y dejaba de ofrecer el botón.
  const esAnulada = (p) => p.origen === 'nota_credito' || (!p.origen && !p.pideMonto && p.monto > 0);
  const anuladas = (a.propuestas || []).filter(p => esAnulada(p) && p.monto > 0);
  const conDetalle = (a.propuestas || []).filter(p => p.origen === 'detalle' && p.monto > 0);
  // Lo que se va a aplicar de cada fila: lo escrito a mano si lo hay, si no lo
  // propuesto. Una sola forma de leerlo, para que el botón de lote y el de la
  // fila apliquen SIEMPRE el mismo número.
  const montoDe = (p) => {
    const escrito = montos[p.facturaId];
    const n = Number(String(escrito ?? '').replace(',', '.'));
    return (escrito !== undefined && escrito !== '' && Number.isFinite(n) && n > 0) ? n : p.monto;
  };
  // `manuales` es nuevo (13-set): un `a` armado a mano (tests, o un caller
  // viejo) puede no traerlo — sin este resguardo, `undefined.length` tumbaba
  // la pantalla entera apenas se abría un anticipo (la clase de bug que este
  // archivo existe para atajar, ver anticipos-panel.test.jsx).
  const manuales = a.manuales || [];
  return (
    <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid var(--border)' }}>
      {a.aplicaciones.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 3 }}>Ya aplicado</div>
          {a.aplicaciones.map(ap => (
            <div key={ap.id} style={{ fontSize: 11.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '2px 0' }}>
              <span style={{ minWidth: 120 }}>{ap.facturaDocumento}</span>
              {acciones(ap.factura_movimiento_id, ap.facturaDocumento)}
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
            {conDetalle.length > 0 && (
              <button className="btn btn-xs btn-amber" onClick={() => onAplicarLasDeDetalle(a, conDetalle.map(p => ({ ...p, monto: montoDe(p) })))}>
                Aplicar las {conDetalle.length} con el importe de su detalle
              </button>
            )}
          </div>
          {a.propuestas.map(p => (
            <div key={p.facturaId} style={{ fontSize: 11.5, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '3px 0' }}>
              <span style={{ minWidth: 120 }}>{p.documento}</span>
              {/* Acá es donde más falta hacía: el importe que se pide escribir
                  está en el PDF que abre este ojo. */}
              {acciones(p.facturaId, p.documento)}
              <span style={{ color: 'var(--tm)' }}>{fmtFecha(p.fecha)}</span>
              {/* TRES CASOS, TRES TRATOS:
                  · nota de crédito → monto fijo: el comprobante se anuló por ese
                    importe exacto y no hay nada que escribir;
                  · factura en cero CON detalle → campo PRELLENADO con lo que suman
                    sus líneas, editable: el número ya no hay que buscarlo, pero es
                    una lectura y quien decide tiene que poder corregirla;
                  · sin detalle → campo vacío, como antes: ahí el dato de verdad
                    solo está en el PDF. */}
              {esAnulada(p) ? (
                <strong>{fmtMonto(p.monto, p.moneda)}</strong>
              ) : (
                <input
                  className="fi"
                  style={{ width: 130, fontSize: 11.5, height: 24 }}
                  placeholder={`monto en ${a.moneda}`}
                  value={montos[p.facturaId] ?? (p.monto > 0 ? String(p.monto) : '')}
                  onChange={e => setMontos(m => ({ ...m, [p.facturaId]: e.target.value }))}
                />
              )}
              <span style={{ color: 'var(--tm)', fontSize: 10.5, flex: 1, minWidth: 220 }}>{p.motivo}</span>
              <button className="btn btn-xs btn-green" onClick={() => onAplicar(a, p)}>Aplicar</button>
            </div>
          ))}
        </div>
      ) : manuales.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
          No hay más facturas de este proveedor contra las cuales aplicar el anticipo.
          {!a.cerrado && (
            <> Si faltan comprobantes por cargar, el saldo de arriba todavía no está cerrado —
            comparalo contra SUNAT en Libros Electrónicos.</>
          )}
        </div>
      ) : null}

      {/* ── APLICAR OTRA FACTURA, A MANO ────────────────────────────────
          Gabriel, 13-set: «quiero ir consumiendo los montos de los anticipos.
          […] realicé un pago de un anticipo de 80 mil dólares, pero las
          facturas son 8 de 10 mil dólares — iría consumiendo con diferentes
          facturas esos 80 mil, hasta cubrir todo ese monto». Las propuestas de
          arriba solo cubren dos señales automáticas (NC que anula, factura en
          cero); una entrega normal, a precio completo, la elige el analista
          acá — factura por factura, hasta que el saldo llegue a cero. */}
      {manuales.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 3 }}>
            Aplicar otra factura a este anticipo
          </div>
          <AplicarManual a={a} manuales={manuales} montos={montos} setMontos={setMontos} onAplicar={onAplicar}
            acciones={acciones} />
        </div>
      )}
    </div>
  );
}

/**
 * El picker manual de UNA aplicación: elegir la factura entre las candidatas
 * que la app no propuso sola, y el monto (prellenado con el total de la
 * factura — editable, porque un anticipo puede cubrir solo PARTE de una
 * entrega). Reusa `onAplicar` sin cambios: el mismo handler que las
 * propuestas automáticas, con `{ facturaId, monto, motivo }`.
 *
 * La selección se DERIVA de `manuales` en vez de guardarse aparte con un
 * efecto: apenas se aplica, esa factura sale de `manuales` (se recalcula
 * solo, como el resto del panel) y el picker vuelve a "— Elegí una factura —"
 * sin que haga falta resetear nada a mano.
 */
function AplicarManual({ a, manuales, montos, setMontos, onAplicar, acciones = null }) {
  const [elegidoIdCrudo, setElegidoId] = uS('');
  const elegido = manuales.find(c => c.id === elegidoIdCrudo) || null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <select className="fi" style={{ fontSize: 11.5, height: 26, maxWidth: 300 }}
        value={elegido ? elegidoIdCrudo : ''}
        onChange={e => {
          const id = e.target.value;
          setElegidoId(id);
          const c = manuales.find(x => x.id === id);
          // Prellenar con el total de la factura — la persona lo baja si el
          // anticipo cubre solo una parte de la entrega.
          if (c && montos[id] == null) setMontos(m => ({ ...m, [id]: String(c.monto) }));
        }}>
        <option value="">— Elegí una factura —</option>
        {manuales.map(c => (
          <option key={c.id} value={c.id}>{c.documento || '(s/doc)'} · {fmtFecha(c.fecha)} · {fmtMonto(c.monto, c.moneda)}</option>
        ))}
      </select>
      {elegido && (
        <>
          {/* Mirar la factura elegida ANTES de aplicarla: el monto viene
              prellenado con su total y bajarlo exige ver la entrega. */}
          {acciones?.(elegido.id, elegido.documento)}
          <input className="fi" type="number" step="0.01"
            style={{ width: 130, fontSize: 11.5, height: 26 }}
            placeholder={`monto en ${a.moneda}`}
            value={montos[elegido.id] ?? ''}
            onChange={e => setMontos(m => ({ ...m, [elegido.id]: e.target.value }))}
          />
          <button className="btn btn-xs btn-green"
            onClick={() => onAplicar(a, { facturaId: elegido.id, monto: elegido.monto, motivo: 'Aplicación manual' })}>
            Aplicar
          </button>
        </>
      )}
    </div>
  );
}

export { PanelAnticipos, DetalleAnticipo };
export default PanelAnticipos;
