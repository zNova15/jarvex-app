import React from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  generarAsientosBatch, explicarDescuadre,
  ESTADOS_CUENTA, cumpleEstadoCuenta, contarEstadosDeCuenta,
} from "../lib/asientos";
import { describirIgv, igvDestacable } from "../lib/igv-desglose.js";
import {
  nombreDeCuenta, cuenta as cuentaPcge, buscarCuentas, hijosDe, cuentaMadreDe, NIVEL_MAXIMO,
} from "../lib/pcge.js";
import { fijarCuentaManual } from "../lib/cuenta-manual-db.js";
import { opcionesContrapartida, avisoEfectivoSobreUmbral, CAJA } from "../lib/contrapartida.js";
import { opcionesDestino, nombreDestino, contrapartidaDeDestino } from "../lib/destino-asiento.js";
import { avisoPeriodoCerrado } from "../lib/periodo-contable.js";
import { cargarBancarizados } from "../lib/bancarizado-db.js";
import { crearResolvedorDeFamilia, cuentasDeComprobante } from "../lib/cuenta-de-comprobante.js";
import { armarConsecuencias } from "../lib/consecuencias-correccion.js";
import { corregirClasificaciones } from "../lib/correccion-causa-db.js";
import { VentanaConsecuencias } from "./jx-ventana-consecuencias.jsx";
import { getEvidenciaSrc } from "../lib/evidencias-url.js";
import { fmtFechaLarga, ymdDe } from "../lib/fecha.js";
import { filtroInicialEmpresa } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;

// Visor de PDF robusto (copia local del patrón de jx-contabilidad): PDFs
// subidos con content-type genérico se re-tipan vía blob para que el iframe
// siempre los renderice.
function PdfFrameLD({ url, nombre }) {
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
      <div style={{ fontSize: 12 }}>No se pudo previsualizar {nombre || 'el PDF'} acá.</div>
      <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-amber btn-sm">Abrir en nueva pestaña</a>
    </div>
  );
  if (!src) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--tm)', fontSize: 12 }}>Cargando PDF…</div>;
  return <iframe src={src} title={nombre || 'PDF'} style={{ width: '100%', height: '70vh', border: 'none', background: 'white' }} />;
}

// ─── Helpers ─────────────────────────────────────────────────
const fmtS = (n) =>
  'S/ ' + Number(n || 0).toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// new Date('YYYY-MM-DD') = medianoche UTC → en Perú mostraba el día ANTERIOR
// en toda la columna Fecha del Libro Diario. fmtFechaLarga parte el string.
const fmtDate = (d) => fmtFechaLarga(d);

const MESES = [
  { v: 'all', label: 'Todo el año' },
  { v: '01', label: 'Enero' }, { v: '02', label: 'Febrero' },
  { v: '03', label: 'Marzo' }, { v: '04', label: 'Abril' },
  { v: '05', label: 'Mayo' },  { v: '06', label: 'Junio' },
  { v: '07', label: 'Julio' }, { v: '08', label: 'Agosto' },
  { v: '09', label: 'Septiembre' }, { v: '10', label: 'Octubre' },
  { v: '11', label: 'Noviembre' },  { v: '12', label: 'Diciembre' },
];

const TIPO_FILTRO = [
  { v: 'all',     label: 'Todos los asientos' },
  { v: 'income',  label: 'Solo ingresos' },
  { v: 'cost',    label: 'Solo costos' },
  { v: 'expense', label: 'Solo gastos' },
];

const TIPO_BADGE = { income: 'b-green', cost: 'b-red', expense: 'b-amber' };
const ROLES_CATALOGO = ['admin', 'gerente', 'contador'];
const TIPO_LABEL = { income: 'Ingreso', cost: 'Costo', expense: 'Gasto' };

// Lookup de cuentas PCGE para mostrar nombre legible. Desde el 17-set sale del
// PLAN OFICIAL entero (1.792 cuentas generadas del PDF del MEF) y no de las 52
// escritas a mano que había antes: cualquier cuenta que el asiento usara y no
// estuviera en esa lista corta se mostraba sin nombre. `nombreDeCuenta` sube
// por todos los niveles hasta dar con un ancestro que exista, así que una
// cuenta de cinco dígitos siempre dice algo.
const cuentaNombre = (codigo) => nombreDeCuenta(codigo);

/**
 * Cómo se supo a qué cuenta iba este asiento, dicho en la propia fila.
 *
 * Solo aparece cuando hay algo que mirar: si la cuenta salió del catálogo de
 * la empresa —o sea, si una persona ya decidió qué es ese insumo— no lleva
 * badge. Lo que sí se avisa es lo que la máquina dedujo del texto y, sobre
 * todo, lo que NO pudo deducir.
 */
function BadgeCuenta({ cuentas }) {
  const c = cuentas || {};
  const badges = [];
  const B = (clase, texto, titulo) => (
    <span key={texto} className={`badge ${clase}`} style={{ fontSize: 10 }} title={titulo}>{texto}</span>
  );

  if (c.provisional) {
    badges.push(B('b-red', '⚠ cuenta por definir',
      (c.detalle?.[0]?.porque || 'No se pudo deducir la cuenta de este comprobante.')
      + ' Está puesta en una cuenta provisional para que el asiento cuadre; elegí la correcta.'));
  } else if (c.manual) {
    badges.push(B('b-green', '✎ cuenta a mano', 'La cuenta la eligió una persona. Manda sobre lo que deduzca la app, hasta que alguien la vuelva a automático.'));
  } else if (c.confianza === 'baja') {
    badges.push(B('b-amber', 'cuenta deducida (poco segura)',
      'La cuenta salió de clasificar el texto de los ítems y la coincidencia fue floja. Vale la pena mirarla.'));
  } else if (c.confianza === 'media') {
    badges.push(B('b-amber', 'cuenta deducida', 'La cuenta salió de clasificar el texto de los ítems del comprobante.'));
  }

  if (c.partida) {
    const detalle = (c.detalle || [])
      .map(d => `${d.cuenta} ${nombreDeCuenta(d.cuenta)} — ${fmtS(d.importe)}${d.familias?.length ? ` (${d.familias.join(', ')})` : ''}`)
      .join('\n');
    badges.push(B('b-blue', `partido en ${c.detalle?.length || 2}`,
      'El comprobante tiene cosas de naturalezas distintas y va a más de una cuenta:\n' + detalle));
  }

  // ── LOS BADGES DE LA CONTRAPARTIDA (17-set) ──────────────────────
  // Son una pregunta distinta de la cuenta de gasto: el gasto puede estar
  // perfecto y la plata salir de una cuenta que no puede ser.
  const cp = c.contrapartida || {};
  if (c.contrapartidaManual) {
    badges.push(B('b-green', '✎ contrapartida a mano',
      'La cuenta de caja/banco/por pagar la eligió una persona, en vez de derivarla del método de pago.'));
  } else if (cp.porDefinir) {
    badges.push(B('b-red', '⚠ contrapartida por definir',
      (cp.porque || 'No se sabe de dónde salió la plata.')
      + ' Está puesta en la cuenta genérica 10 para que el asiento cuadre; elegí de qué cuenta salió.'));
  } else if (cp.origen === 'constancia') {
    badges.push(B('b-green', 'plata por el banco',
      'La contrapartida salió de la constancia de transferencia o depósito cargada en el comprobante.'));
  } else if (cp.origen === 'detraccion') {
    badges.push(B('b-amber', 'banco (por la detracción)', cp.porque || ''));
  }

  if (cp.aviso) {
    badges.push(B('b-red', '⚠ efectivo sobre el umbral', cp.aviso));
  }

  // ── EL BADGE DEL DESTINO (18-set) ────────────────────────────────
  // Tercera pregunta del mismo asiento: qué se compró (cuenta), de dónde salió
  // la plata (contrapartida) y PARA QUÉ fue (destino). `null` en una venta,
  // que no lleva asiento de destino.
  const cd = c.destino;
  if (cd) {
    if (cd.manual) {
      badges.push(B('b-green', `✎ destino ${cd.cuenta}`,
        `${cd.nombre}. Lo eligió una persona; la contrapartida (${cd.contrapartida}) sale sola de esa decisión.`));
    } else if (cd.porDefinir) {
      badges.push(B('b-red', '⚠ destino por definir',
        'No se sabe para qué fue esta plata: el comprobante no está vinculado a una obra '
        + 'ni marcado como gasto general. Sin destino no hay costo por obra ni Estado de '
        + 'Resultados por función.'));
    } else if (cd.confianza === 'baja') {
      // La 91 de contabilidad neta: un punto de partida, no una deducción.
      // El «?» es para que no se confunda con el 92/94 que sí salen del dato.
      badges.push(B('b-amber', `destino ${cd.cuenta} ?`,
        `${cd.nombre}. ${cd.porque}`));
    } else {
      badges.push(B('b-amber', `destino ${cd.cuenta}`,
        `${cd.nombre}. ${cd.porque} Se puede cambiar.`));
    }
  }

  if (c.revisar && !c.provisional) {
    badges.push(B('b-amber', 'revisar',
      (c.detalle || []).map(d => d.porque).filter(Boolean).join('\n')
      || 'Hay algo en este comprobante que conviene mirar a mano.'));
  }

  return badges.length ? <>{badges}</> : null;
}

/**
 * Buscador de cuenta del PCGE.
 *
 * Es el mismo problema que el del Plan de Cuentas pero al revés: allá se
 * navega el árbol, acá hay que encontrar UNA cuenta entre 1.792 sin perder de
 * vista el comprobante que se está mirando. Por eso arranca mostrando las
 * SUGERIDAS —lo que la app dedujo, y las hermanas de la que ya está puesta— y
 * el buscador es para cuando ninguna sirve.
 */
// `resolver` y `buscar` existen por el ELEMENTO 9: sus cuentas (90…97) no están
// en el catálogo del PCGE —la norma no las define— así que `cuentaPcge('92')`
// da null y `buscarCuentas('92')` no la encuentra. Sin estos dos huecos, el
// campo de destino mostraría la cuenta elegida en blanco. Los demás selectores
// siguen usando el catálogo, que es el default.
function SelectorCuenta({
  valor, sugeridas = [], onElegir, placeholder, autoFocus, bloqueada = null,
  resolver = cuentaPcge, buscar = null,
}) {
  // `bloqueada` = { codigo, motivo }: la cuenta no se puede elegir y se
  // muestra apagada con el motivo, tanto en las sugeridas como en el
  // buscador. No se esconde a propósito: escondida, alguien la busca entre
  // las 1.792 y la pone sin enterarse de por qué no estaba.
  const estaBloqueada = (codigo) => !!bloqueada
    && (codigo === bloqueada.codigo || String(codigo).startsWith(bloqueada.codigo));
  const [q, setQ] = uS('');
  const resultados = uM(() => {
    const t = q.trim();
    if (!t) return [];
    if (buscar) return buscar(t);
    return buscarCuentas(t, { nivelMax: NIVEL_MAXIMO }).slice(0, 40);
  }, [q, buscar]);

  const elegida = valor ? resolver(valor) : null;

  return (
    <div>
      {elegida && (
        <div style={{ marginBottom: 8, padding: '7px 10px', borderRadius: 6, background: 'rgba(46,204,113,.10)', fontSize: 12.5 }}>
          <strong className="col-m">{elegida.codigo}</strong> {elegida.nombre}
          <button className="btn btn-ghost btn-xs" style={{ float: 'right' }}
            onClick={() => onElegir(null)} title="Quitar esta cuenta y volver a la automática">✕</button>
        </div>
      )}

      <div className="search-bar" style={{ marginBottom: 8 }}>
        {window.JxIcon ? <window.JxIcon name="search" size={13} color="var(--tm)"/> : null}
        <input
          autoFocus={autoFocus}
          placeholder={placeholder || 'Buscar por código (63) o por nombre (transporte, alquiler…)'}
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <div style={{ maxHeight: 210, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
        {!q.trim() && sugeridas.length > 0 && (
          <div style={{ padding: '5px 9px', fontSize: 10.5, color: 'var(--tm)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
            Sugeridas para este comprobante
          </div>
        )}
        {(q.trim() ? resultados : sugeridas).map(c => {
          const veda = estaBloqueada(c.codigo);
          return (
          <div
            key={c.codigo}
            onClick={() => { if (!veda) onElegir(c.codigo); }}
            title={veda ? bloqueada.motivo : undefined}
            style={{
              padding: '6px 10px', cursor: veda ? 'not-allowed' : 'pointer', fontSize: 12.5,
              borderBottom: '1px solid var(--border)',
              opacity: veda ? 0.6 : 1,
              background: valor === c.codigo ? 'rgba(242,183,5,.12)' : undefined,
            }}
          >
            <span className="col-m" style={{ fontWeight: 600 }}>{veda ? '⛔ ' : ''}{c.codigo}</span>{' '}
            <span>{c.nombre}</span>
            {(veda ? bloqueada.motivo : c.porque) && (
              <div style={{ color: veda ? 'var(--red)' : 'var(--tm)', fontSize: 11.5, lineHeight: 1.4 }}>
                {veda ? bloqueada.motivo : c.porque}
              </div>
            )}
          </div>
          );
        })}
        {q.trim() && resultados.length === 0 && (
          <div style={{ padding: 14, textAlign: 'center', color: 'var(--tm)', fontSize: 12.5 }}>
            Ninguna cuenta del PCGE coincide con «{q}».
          </div>
        )}
        {!q.trim() && sugeridas.length === 0 && (
          <div style={{ padding: 14, textAlign: 'center', color: 'var(--tm)', fontSize: 12.5 }}>
            Escribí para buscar entre las 1.792 cuentas del plan.
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Corregir la cuenta de un asiento.
 *
 * Lo que se guarda NO es el asiento: es la decisión sobre el movimiento
 * (`cuenta_pcge` y `cuenta_pcge_contrapartida`). El asiento se sigue derivando
 * —importe, fecha, IGV— y ahora respeta lo que se elija acá.
 */
function ModalCuenta({
  asiento, movimiento, hermanos = [], familiaDe = null, bancarizadoIds = null, movsVivos = [],
  puedeReclasificar = false, userId, onClose, showToast,
}) {
  const cuentasAsiento = asiento?.cuentas || {};
  const deducida = cuentasAsiento.detalle?.[0]?.cuenta || null;

  const [cuenta, setCuenta] = uS(movimiento?.cuenta_pcge || null);
  const [contra, setContra] = uS(movimiento?.cuenta_pcge_contrapartida || null);
  const [destino, setDestino] = uS(movimiento?.cuenta_pcge_destino || null);
  const [aplicarATodos, setAplicarATodos] = uS(false);
  const [guardando, setGuardando] = uS(false);
  // El escape del período ya presentado. Nace apagado a propósito: la
  // contadora tiene que leer qué está por hacer antes de poder hacerlo.
  const [forzarCerrado, setForzarCerrado] = uS(false);
  const enCursoRef = uR(false);
  // ── LA VENTANA DE CONSECUENCIAS (tanda 3 del destino) ─────────────
  // Dos pasos: el formulario de siempre, y —solo si hay algo que decir— la
  // ventana con lo que el cambio arrastra. `seleccion` es lo que la contadora
  // marca en ella: qué clasificaciones corregir, si corregir el tipo, y si
  // acepta mover meses ya presentados.
  const [paso, setPaso] = uS('editar');
  const [seleccion, setSeleccion] = uS(null);

  // Las sugeridas: lo que la app dedujo para ESTE comprobante, y las hermanas
  // de esa cuenta. Es lo que se quiere el 90 % de las veces — corregir de 602 a
  // 603, no buscar una cuenta de otro elemento.
  const sugeridas = uM(() => {
    const out = [];
    const vistos = new Set();
    const agregar = (codigo, porque) => {
      if (!codigo || vistos.has(codigo)) return;
      const c = cuentaPcge(codigo);
      if (!c) return;
      vistos.add(codigo);
      out.push({ ...c, porque });
    };
    for (const d of cuentasAsiento.detalle || []) {
      agregar(d.cuenta, d.porque || (cuentasAsiento.provisional ? 'La que está puesta provisionalmente.' : 'La que dedujo la app.'));
    }
    // Las hermanas: mismas primeras dos cifras.
    const madre = deducida ? cuentaMadreDe(deducida) : null;
    if (madre) for (const h of hijosDe(madre.codigo)) agregar(h.codigo, '');
    return out;
  }, [cuentasAsiento, deducida]);

  // ── LAS OPCIONES DE CONTRAPARTIDA SE REDUCEN SEGÚN EL COMPROBANTE ──
  // Pedido de Gabriel (17-set): «toda compra mayor a 2 mil soles está sujeta a
  // bancarización, por lo tanto eso no puede ser a efectivo y las opciones se
  // reducen a transferencias, depósitos o contrarrestar con alguna factura».
  // Un comprobante pendiente ofrece la deuda primero; uno pagado, el banco;
  // una venta, la cuenta por cobrar. La caja aparece apagada cuando la ley la
  // prohíbe, con el motivo escrito.
  const opciones = uM(() => opcionesContrapartida(movimiento || {}), [movimiento]);
  const cajaProhibida = uM(() => opciones.some(o => o.prohibida), [opciones]);
  // El escape: si la compra se pagó en efectivo DE VERDAD —pasa, y es una
  // infracción de quien pagó, no de quien asienta— el libro tiene que poder
  // decirlo. Lo que no puede es decirlo en silencio.
  const [admiteEfectivo, setAdmiteEfectivo] = uS(false);
  const motivoVeda = uM(
    () => opciones.find(o => o.prohibida)?.cuando || '',
    [opciones],
  );

  const contrapartidasSugeridas = uM(
    () => opciones
      .map(c => ({ ...cuentaPcge(c.codigo), porque: c.cuando, prohibida: c.prohibida }))
      .filter(c => c.codigo),
    [opciones],
  );

  // La consecuencia tributaria, cuando la contrapartida elegida es la caja en
  // una compra que estaba sujeta a bancarización.
  const avisoEfectivo = uM(
    () => avisoEfectivoSobreUmbral(movimiento || {}, contra),
    [movimiento, contra],
  );

  // ── EL DESTINO: PARA QUÉ FUE LA PLATA (tanda 1 del destino) ───────
  // La cuenta de arriba dice QUÉ se compró; ésta dice PARA QUÉ. Son preguntas
  // distintas y por eso son dos campos: dos facturas de combustible idénticas
  // —una del generador de la obra, otra de la camioneta— llevan la MISMA
  // cuenta 6032 y destinos distintos (92 contra 95).
  const cuentaNaturaleza = cuenta || cuentasAsiento.detalle?.[0]?.cuenta || '';
  const destinosSugeridos = uM(
    () => opcionesDestino(movimiento || {}, { cuentaOrigen: cuentaNaturaleza }),
    [movimiento, cuentaNaturaleza],
  );
  // El elemento 9 no vive en el catálogo del PCGE: el selector necesita saber
  // resolver y buscar sobre ESTAS once opciones, no sobre las 1.792.
  const resolverDest = uM(
    () => (codigo) => (nombreDestino(codigo) ? { codigo, nombre: nombreDestino(codigo) } : null),
    [],
  );
  const buscarDest = uM(() => (texto) => {
    const t = texto.trim().toLowerCase();
    return destinosSugeridos.filter(
      o => o.codigo.startsWith(t) || o.nombre.toLowerCase().includes(t),
    );
  }, [destinosSugeridos]);
  const destinoAsiento = cuentasAsiento.destino || null;
  // El aviso del mes ya declarado. Es del COMPROBANTE, no de lo que se cambie:
  // tocar cualquier cosa de un mes presentado tiene la misma consecuencia.
  const avisoCerrado = uM(() => avisoPeriodoCerrado(movimiento || {}), [movimiento]);

  // Lo que la ventana necesita para simular. Se arma con lo que está en el
  // formulario AHORA: si la contadora vuelve y cambia la cuenta, la ventana se
  // recalcula con la nueva.
  const argsConsecuencias = {
    mov: movimiento || {},
    cambios: { cuenta, contrapartida: contra, destino },
    familiaDe,
    bancarizadoIds,
    movs: movsVivos,
    hermanos: aplicarATodos ? hermanos : [],
    puedeReclasificar,
  };
  const consecuencias = uM(
    () => (paso === 'consecuencias' ? armarConsecuencias({ ...argsConsecuencias, seleccion }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paso, seleccion, movimiento, cuenta, contra, destino, familiaDe, bancarizadoIds, movsVivos, hermanos, aplicarATodos, puedeReclasificar],
  );

  // El texto de auditoría: lo que se hizo, dicho entero. Es lo que alguien va
  // a buscar dentro de un año para entender por qué la cuenta cambió.
  const motivoDe = (c) => {
    const doc = movimiento?.document_number || 'el comprobante';
    const partes = [];
    // Si se eligió la caja en una compra sujeta a bancarización, la
    // auditoría tiene que decir que se hizo a sabiendas: esa decisión le
    // cuesta a la empresa el crédito fiscal y la deducción del gasto.
    if (avisoEfectivo) {
      partes.push(`se declara pago en EFECTIVO pese a la bancarización en ${doc} (pierde crédito fiscal y deducción, art. 8 Ley 28194)`);
    }
    if (c?.correcciones?.length) {
      partes.push('se corrigió la clasificación de '
        + c.correcciones.map(x => `«${x.descripcion}» (${x.familiaAntes || 'sin familia'} → ${x.familia})`).join(', '));
    }
    if (c?.escribir && 'tipo' in c.escribir && c.cambioDeTipo) {
      partes.push(`pasa de ${c.cambioDeTipo.de === 'cost' ? 'costo' : 'gasto'} a ${c.cambioDeTipo.a === 'cost' ? 'costo' : 'gasto'}`);
    }
    if (c?.alcance?.cambian?.length) {
      partes.push(`mueve ${c.alcance.cambian.length} comprobante(s) más`
        + (c.alcance.cerrados ? `, ${c.alcance.cerrados} de meses ya presentados, aceptado a sabiendas` : ''));
    }
    return partes.length ? `Libro Diario · ${doc}: ${partes.join(' · ')}` : '';
  };

  // Escribe todo lo decidido: primero la CAUSA (la clasificación), después el
  // comprobante, después los del mismo proveedor. En ese orden porque si la
  // clasificación no se graba, el comprobante no puede quedar «saliendo solo»
  // de una corrección que no existe: ahí se le fija la cuenta a mano.
  const ejecutar = async (c) => {
    const avisos = [];
    let escribir = c.escribir;

    if (c.correcciones.length) {
      const r = await corregirClasificaciones(c.correcciones, {
        companyId: movimiento?.company_id || null, userId, documento: movimiento?.document_number || '',
      });
      if (r.fallaron.length) {
        avisos.push(`no se pudo corregir la clasificación de «${r.fallaron[0].descripcion}»: ${r.fallaron[0].error}`);
        if (!escribir.cuenta && cuenta) escribir = { ...escribir, cuenta };
      }
    }

    const motivo = motivoDe(c);
    const r = await fijarCuentaManual(asiento.movimiento_id, escribir, {
      userId, motivo, forzarPeriodoCerrado: forzarCerrado,
    });
    if (!r.ok) { showToast?.(r.error, 'red'); return false; }

    // Los del mismo proveedor, cada uno con su plan. Sin el escape del
    // candado: forzar un mes presentado se pide comprobante por comprobante,
    // y los de meses cerrados ni siquiera llegan acá (`planDeHermanos`).
    let okHermanos = 0;
    const fallaronHermanos = [];
    for (const p of c.hermanos.planes) {
      // eslint-disable-next-line no-await-in-loop
      const rh = await fijarCuentaManual(p.id, p.cambios, {
        userId,
        motivo: `Libro Diario · misma corrección que ${movimiento?.document_number || 'otro comprobante'} del mismo proveedor`,
      });
      if (rh.ok) okHermanos++; else fallaronHermanos.push(rh.error);
    }
    if (fallaronHermanos.length) avisos.push(`${fallaronHermanos.length} del mismo proveedor no se corrigieron: ${fallaronHermanos[0]}`);

    const partes = [];
    if (c.correcciones.length) partes.push(`clasificación corregida (${c.correcciones.length})`);
    if (escribir.cuenta) partes.push(`cuenta ${escribir.cuenta}`);
    else if (c.salesola && !avisos.length) partes.push(`la ${cuenta} sale sola`);
    if (escribir.destino) partes.push(`destino ${escribir.destino}`);
    if ('tipo' in escribir && c.cambioDeTipo) partes.push(c.cambioDeTipo.a === 'cost' ? 'ahora es costo' : 'ahora es gasto');
    if (okHermanos) partes.push(`${okHermanos} más del mismo proveedor`);
    if (c.alcance.cambian.length) partes.push(`${c.alcance.cambian.length} comprobante(s) se movieron solos`);

    if (avisos.length) showToast?.(`Guardado, con avisos: ${avisos.join(' · ')}`, 'amber');
    else if (r.vuelveAAutomatico && !partes.length) showToast?.('✓ Vuelve a la cuenta que deduce la app.', 'green');
    else showToast?.(`✓ ${partes.join(' · ') || 'Guardado'}.`, 'green');
    return true;
  };

  // Guard SÍNCRONO: el doble clic acá escribiría dos versiones del mismo
  // movimiento y dejaría el sync en reintento.
  const guardar = async () => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setGuardando(true);
    try {
      // En el primer paso, se mira si hay algo que decir. Si no hay, se guarda
      // directo: una ventana que sale siempre se cierra sin leer.
      const c = paso === 'consecuencias'
        ? consecuencias
        : armarConsecuencias({ ...argsConsecuencias, seleccion: null });
      if (paso === 'editar' && c.hayQueDecir) {
        setSeleccion(c.seleccion);
        setPaso('consecuencias');
        return;
      }
      if (await ejecutar(c)) onClose();
    } catch (e) {
      showToast?.('No se pudo guardar: ' + (e?.message || e), 'red');
    } finally {
      setGuardando(false);
      enCursoRef.current = false;
    }
  };

  const sinCambios = (cuenta || null) === (movimiento?.cuenta_pcge || null)
    && (contra || null) === (movimiento?.cuenta_pcge_contrapartida || null)
    && (destino || null) === (movimiento?.cuenta_pcge_destino || null);

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={paso === 'consecuencias' ? { width: 'min(720px, 95vw)' } : { maxWidth: 620 }}>
        <div className="modal-hd">
          <div className="modal-hd-left">
            {paso === 'consecuencias' ? 'Antes de guardar: qué arrastra este cambio' : 'Corregir la cuenta'}
          </div>
          <button className="btn btn-ghost btn-xs" onClick={onClose}>
            {window.JxIcon ? <window.JxIcon name="x" size={13}/> : '✕'}
          </button>
        </div>

        <div style={{ fontSize: 12.5, color: 'var(--tm)', marginBottom: 12, lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--ts)' }}>{asiento.glosa}</strong><br/>
          {fmtDate(asiento.fecha)} · {fmtS(asiento.sumDebe)}
          {cuentasAsiento.provisional && (
            <div style={{ color: 'var(--red)', marginTop: 4 }}>
              ⚠ {cuentasAsiento.detalle?.[0]?.porque || 'No se pudo deducir la cuenta de este comprobante.'}
            </div>
          )}
          {cuentasAsiento.partida && (
            <div style={{ color: 'var(--amber)', marginTop: 4 }}>
              Este comprobante está repartido en {cuentasAsiento.detalle.length} cuentas
              ({cuentasAsiento.detalle.map(d => d.cuenta).join(', ')}). Elegir una lo manda
              ENTERO a esa cuenta y se pierde el reparto.
            </div>
          )}
        </div>

        {/* EL MES QUE YA SE LE PRESENTÓ A SUNAT.
            No es una pared —Gabriel: «bloquearlo, pero no por completo, en
            caso muy raro que se quiera cambiar un dato de un comprobante
            antiguo se podría»— pero el escape hay que pedirlo leyendo lo que
            se está por hacer, y queda en auditoría. */}
        {avisoCerrado && (
          <div style={{
            marginBottom: 12, padding: '9px 11px', borderRadius: 6, fontSize: 12, lineHeight: 1.45,
            background: forzarCerrado ? 'rgba(242,183,5,.12)' : 'rgba(231,76,60,.10)',
            color: forzarCerrado ? 'var(--amber)' : 'var(--red)',
          }}>
            🔒 {avisoCerrado}
            {!forzarCerrado ? (
              <div style={{ marginTop: 6 }}>
                <button className="btn btn-ghost btn-xs" onClick={() => setForzarCerrado(true)}
                  title="Modificar igual un comprobante de un período ya declarado">
                  Modificarlo igual →
                </button>
              </div>
            ) : (
              <div style={{ marginTop: 4 }}>
                Se va a modificar igual. La auditoría va a decir que se hizo a sabiendas.
              </div>
            )}
          </div>
        )}

        {paso === 'consecuencias' && (
          <VentanaConsecuencias
            c={consecuencias}
            seleccion={seleccion}
            setSeleccion={setSeleccion}
            cuentaElegida={cuenta}
            moneda={movimiento?.currency || 'PEN'}
          />
        )}

        {paso === 'editar' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <label className="flabel">
              Cuenta del {asiento.type === 'income' ? 'ingreso' : 'gasto'}
            </label>
            <SelectorCuenta
              valor={cuenta}
              sugeridas={sugeridas}
              onElegir={setCuenta}
              autoFocus
            />
          </div>

          <div>
            <label className="flabel">Contrapartida (de dónde salió o entró la plata)</label>
            {!cuentasAsiento.contrapartidaManual && cuentasAsiento.contrapartida?.porque && (
              <div style={{
                fontSize: 11.5, lineHeight: 1.45, marginBottom: 7,
                color: cuentasAsiento.contrapartida.porDefinir ? 'var(--red)' : 'var(--tm)',
              }}>
                {cuentasAsiento.contrapartida.porDefinir ? '⚠ ' : ''}
                {cuentasAsiento.contrapartida.porque}
              </div>
            )}
            <SelectorCuenta
              valor={contra}
              sugeridas={contrapartidasSugeridas}
              onElegir={setContra}
              placeholder="Buscar la cuenta de caja, banco o por pagar…"
              bloqueada={cajaProhibida && !admiteEfectivo ? { codigo: CAJA, motivo: motivoVeda } : null}
            />
            {cajaProhibida && !admiteEfectivo && (
              <button
                className="btn btn-ghost btn-xs"
                style={{ marginTop: 6 }}
                onClick={() => setAdmiteEfectivo(true)}
                title="Habilitar la caja igual, asumiendo la consecuencia tributaria">
                Se pagó en efectivo igual →
              </button>
            )}
            {avisoEfectivo && (
              <div style={{
                marginTop: 7, padding: '8px 10px', borderRadius: 6, fontSize: 11.5, lineHeight: 1.45,
                background: 'rgba(231,76,60,.10)', color: 'var(--red)',
              }}>
                ⚠ {avisoEfectivo}
              </div>
            )}
          </div>

          {/* EL DESTINO — la mitad que faltaba del asiento.
              Solo en los egresos: una venta no se traslada por la 79, se
              cierra contra el resultado. Por eso acá no aparece el campo en
              vez de aparecer vacío y sin poder llenarse. */}
          {destinoAsiento && (
            <div>
              <label className="flabel">Destino (para qué fue esa plata)</label>
              {!destinoAsiento.manual && destinoAsiento.porque && (
                <div style={{ fontSize: 11.5, lineHeight: 1.45, marginBottom: 7, color: 'var(--tm)' }}>
                  {destinoAsiento.porque}
                </div>
              )}
              {!destinoAsiento.manual && destinoAsiento.porDefinir && (
                <div style={{ fontSize: 11.5, lineHeight: 1.45, marginBottom: 7, color: 'var(--red)' }}>
                  ⚠ No se puede deducir para qué fue: el comprobante no está vinculado
                  a una obra ni marcado como gasto general. Sin destino, el asiento
                  queda a medias.
                </div>
              )}
              <SelectorCuenta
                valor={destino}
                sugeridas={destinosSugeridos}
                onElegir={setDestino}
                resolver={resolverDest}
                buscar={buscarDest}
                placeholder="Buscar el destino (92, administración, ventas…)"
              />
              {/* La otra pata, dicha antes de guardar. Es lo que evita que
                  alguien crea que tiene que escribir dos cuentas. */}
              {(destino || destinoAsiento.cuenta) && (() => {
                const c = contrapartidaDeDestino(destino || destinoAsiento.cuenta, cuentaNaturaleza);
                if (!c.cuenta) return null;
                return (
                  <div style={{
                    marginTop: 7, padding: '8px 10px', borderRadius: 6, fontSize: 11.5, lineHeight: 1.45,
                    background: 'rgba(46,204,113,.10)',
                  }}>
                    El asiento de destino sale solo:{' '}
                    <strong className="col-m">{destino || destinoAsiento.cuenta}</strong> al debe contra{' '}
                    <strong className="col-m">{c.cuenta}</strong> al haber.
                    <div style={{ color: 'var(--tm)', marginTop: 2 }}>{c.porque}</div>
                  </div>
                );
              })()}
              {/* El aviso del costo atrapado: mandar al inventario algo que ya
                  se consumió no baja el resultado del período, y la empresa
                  termina pagando más renta de la que debe. */}
              {destino && destinosSugeridos.find(o => o.codigo === destino)?.avisa && (
                <div style={{
                  marginTop: 7, padding: '8px 10px', borderRadius: 6, fontSize: 11.5, lineHeight: 1.45,
                  background: 'rgba(242,183,5,.12)', color: 'var(--amber)',
                }}>
                  ⚠ {destinosSugeridos.find(o => o.codigo === destino).porque}
                </div>
              )}
            </div>
          )}

          {/* LOS OTROS DEL MISMO PROVEEDOR.
              Es lo que hace usable la pila de «cuentas por definir»: son 345 en
              producción y se repiten por proveedor —treinta facturas del mismo
              grifo son todas 603—. De a una serían treinta decisiones idénticas.
              Solo se ofrecen los que están en el MISMO estado (sin cuenta a
              mano): pisar una decisión que otro ya tomó, en lote y sin verla,
              sería el peor botón de la app. */}
          {hermanos.length > 0 && (cuenta || contra) && (
            <label style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer',
              padding: '9px 11px', borderRadius: 6, background: 'rgba(242,183,5,.10)', fontSize: 12.5,
            }}>
              <input type="checkbox" checked={aplicarATodos} style={{ marginTop: 2 }}
                onChange={e => setAplicarATodos(e.target.checked)} />
              <span>
                Aplicar también a los otros <strong>{hermanos.length}</strong> comprobantes
                de <strong>{movimiento?.third_party_name || 'este proveedor'}</strong> que
                siguen sin cuenta definida, en el período que estás viendo.
                <div style={{ color: 'var(--tm)', fontSize: 11.5, marginTop: 2 }}>
                  No toca los que ya tienen una cuenta puesta a mano, ni los de meses ya
                  presentados: el escape del candado vale para este comprobante, no para el lote.
                </div>
              </span>
            </label>
          )}

          <div style={{ fontSize: 11.5, color: 'var(--tm)', lineHeight: 1.5 }}>
            La línea del IGV no se toca acá: sale del desglose real del comprobante.
            Si el IGV está mal, lo que está mal es el comprobante.
          </div>
        </div>
        )}

        {paso === 'editar' ? (
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button
            className="btn btn-sm"
            onClick={() => { setCuenta(null); setContra(null); setDestino(null); }}
            disabled={!cuenta && !contra && !destino}
            title="Borrar las cuentas elegidas a mano y dejar que la app las deduzca">
            Volver a automático
          </button>
          <button
            className="btn btn-amber btn-sm"
            onClick={guardar}
            disabled={guardando || sinCambios || (!!avisoCerrado && !forzarCerrado)}
            title={avisoCerrado && !forzarCerrado ? avisoCerrado : undefined}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
        ) : (
        <div className="modal-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setPaso('editar')} disabled={guardando}>
            ← Volver
          </button>
          <button
            className="btn btn-amber btn-sm"
            onClick={guardar}
            disabled={guardando || !consecuencias
              || (consecuencias.requiereAceptarCerrados && !seleccion?.aceptaCerrados)}
            title={consecuencias?.requiereAceptarCerrados && !seleccion?.aceptaCerrados
              ? 'Marcá que entendés que se mueven comprobantes de meses ya presentados, o dejá la clasificación sin corregir'
              : undefined}>
            {guardando ? 'Guardando…' : 'Confirmar y guardar'}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}

// ╔════════════════════════════════════════════════════════════╗
// ║  LIBRO DIARIO                                              ║
// ╚════════════════════════════════════════════════════════════╝
function LibroDiarioPage({ showToast }) {
  const { data: companies } = (window.__hooks?.useCompanies?.() ?? { data: [] });
  const { data: movs } = (window.__hooks?.useAccountingMovements?.() ?? { data: [] });

  const ahora = new Date();
  // 'all' es el "sin filtro" de ESTA pantalla (no 'todas').
  const [empresaIdRaw, setEmpresaId] = uS(() => filtroInicialEmpresa('all'));
  // ÁMBITO, no filtro: con una empresa activa esta pantalla es la contabilidad
  // de ESA empresa y el selector va clavado (Gabriel: «netamente y
  // exclusivamente de esa empresa seleccionada»).
  const empresaFija = useEmpresaBloqueada();
  const empresaId = empresaFija || empresaIdRaw;
  const [anio, setAnio] = uS(String(ahora.getFullYear()));
  const [mes, setMes] = uS('all');
  const [tipoFiltro, setTipoFiltro] = uS('all');
  // Herramienta de descuadre + visor de comprobantes (pedido contadoras 31-ago).
  const [soloDescuadrados, setSoloDescuadrados] = uS(false);
  const [estadoCuenta, setEstadoCuenta] = uS('todas');
  const [evPorMov, setEvPorMov] = uS(() => new Map());   // mov_id → evidencia (cruda)
  const [visor, setVisor] = uS(null);                    // { url, mime, nombre, _blob }
  const [editando, setEditando] = uS(null);              // el asiento cuya cuenta se está corrigiendo

  // Quién corrige. La cuenta manual le gana a la app para siempre, así que
  // lleva firma (mig 220).
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id ?? null;
  const rolActual = auth?.profile?.rol || '';
  const puedeCorregir = rolActual === 'admin'
    || (window.__hasPerm?.(rolActual, 'Libro Diario', 'w') ?? false);
  // Quién puede corregir la CAUSA (la clasificación del insumo) desde la
  // ventana de consecuencias. Es el espejo de la RLS de `catalogo_insumos` e
  // `insumo_categoria` (has_role admin/gerente/contador): la matriz de
  // permisos del Libro Diario se puede configurar, la RLS no, y una escritura
  // que el servidor rechaza queda rebotando en el sync para siempre.

  // Años disponibles a partir de los movimientos
  const aniosDisp = uM(() => {
    const set = new Set();
    (movs || []).forEach(m => {
      const y = ymdDe(m.date || m.created_at).slice(0, 4);
      if (y) set.add(y);
    });
    set.add(String(ahora.getFullYear()));
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [movs]);

  // Movimientos filtrados por empresa + período + tipo
  const movsFiltrados = uM(() => {
    return (movs || []).filter(m => {
      if (m.deleted_at) return false;
      if (m.payment_status === 'cancelled') return false;
      if (empresaId !== 'all' && m.company_id !== empresaId) return false;
      if (tipoFiltro !== 'all' && m.type !== tipoFiltro) return false;
      // Por string: con new Date('2026-01-01') el asiento caía en 2025.
      const ymd = ymdDe(m.date || m.created_at);
      if (!ymd) return false;
      if (ymd.slice(0, 4) !== String(anio)) return false;
      if (mes !== 'all' && ymd.slice(5, 7) !== mes) return false;
      return true;
    });
  }, [movs, empresaId, anio, mes, tipoFiltro]);

  // ── DE DÓNDE SALE LA CUENTA DE CADA ASIENTO (17-set-2026) ──────────
  // Hasta hoy salía de `mapTypeToCategoria(type, category)`, y `category` NO
  // es la naturaleza del gasto: contiene el tipo de documento ('Factura' en
  // 1.710 de 1.742 movimientos). Ningún regex coincidía, así que TODO caía al
  // default y el libro decía 60 en cada costo, 65 en cada gasto y 70 en cada
  // venta. Ése es el «solo un ejemplo de los diferentes fallos» que
  // reportaron las contadoras con la F055-6246 de MARVISUR.
  //
  // Ahora sale de lo que se COMPRÓ: los ítems del comprobante, clasificados
  // con el catálogo de la empresa primero y con el IUPC después, y traducidos
  // a cuenta por `pcge-puente.js`.
  //
  // El resolvedor se arma UNA vez con lo que hay en Dexie y se le inyecta al
  // generador. `generarAsientosBatch` sigue sin importar nada de esto: es una
  // lib pura y el diccionario de 938 términos no tiene por qué viajar en su
  // chunk.
  const { data: catalogoInsumos } = (window.__hooks?.useCatalogoInsumos?.() ?? { data: [] });
  const { data: insumoCategorias } = (window.__hooks?.useInsumoCategorias?.() ?? { data: [] });
  const { data: terminosCustom } = (window.__hooks?.useClasificacionTerminos?.() ?? { data: [] });

  // El resolvedor va aparte del reparto porque la ventana de consecuencias
  // (tanda 3 del destino) lo necesita crudo: simula la corrección envolviéndolo,
  // y tiene que ser EL MISMO que dibuja el libro para que lo que la ventana
  // anuncia sea lo que el libro va a mostrar.
  const familiaDe = uM(() => crearResolvedorDeFamilia({
    catalogo: catalogoInsumos || [],
    alias: insumoCategorias || [],
    terminosCustom: terminosCustom || [],
    companyId: empresaId !== 'all' ? empresaId : null,
  }), [catalogoInsumos, insumoCategorias, terminosCustom, empresaId]);
  const repartoDe = uM(
    () => (mov) => cuentasDeComprobante(mov, { familiaDe }),
    [familiaDe],
  );
  // Todos los comprobantes vivos, sin el filtro de período: corregir la
  // clasificación de un insumo mueve facturas de cualquier mes, y el bloque C
  // tiene que poder decir cuáles (el 94 % son de meses ya presentados).
  const movsVivos = uM(
    () => (movs || []).filter(m => !m.deleted_at && m.payment_status !== 'cancelled'),
    [movs],
  );

  // ── LA EVIDENCIA BANCARIA QUE EL ASIENTO IGNORABA (17-set) ─────────
  // Las constancias de transferencia y los depósitos multi-factura ya estaban
  // cargados en la app; el generador nunca los miraba y deducía la
  // contrapartida solo de `metodo_pago`, que dice 'efectivo' en 1.617 de 1.742
  // movimientos porque es el valor con el que nace la captura. Con esto, una
  // factura con su constancia se asienta contra el banco sola.
  const [bancarizadoIds, setBancarizadoIds] = uS(() => new Set());
  uE(() => {
    let vivo = true;
    const cargar = () => cargarBancarizados(window.__db)
      .then(s => { if (vivo) setBancarizadoIds(s); })
      .catch(() => {});
    cargar();
    // Si se carga una constancia mientras la pantalla está abierta, el asiento
    // tiene que cambiar solo: es el mismo evento que usa el resto de la app.
    const onCambio = () => cargar();
    window.addEventListener('jx_data_changed', onCambio);
    return () => { vivo = false; window.removeEventListener('jx_data_changed', onCambio); };
  }, []);

  // Asientos generados al vuelo
  const asientosTodos = uM(
    () => generarAsientosBatch(movsFiltrados, { repartoDe, bancarizadoIds }),
    [movsFiltrados, repartoDe, bancarizadoIds],
  );
  const descuadrados = uM(() => asientosTodos.filter(a => !a.cuadra), [asientosTodos]);

  // ── FILTRO POR ESTADO DE LA CUENTA (pedido de Gabriel, 17-set) ─────
  // Sin esto, los asientos con la cuenta sin definir quedan mezclados entre
  // los buenos y hay que ir a buscarlos badge por badge. Son 345 de 1.742 en
  // producción: una lista por la que se puede pasar de a tandas, pero solo si
  // se la puede aislar.
  const cuentasPorEstado = uM(() => contarEstadosDeCuenta(asientosTodos), [asientosTodos]);
  const asientosPorCuenta = uM(
    () => (estadoCuenta === 'todas' ? asientosTodos : asientosTodos.filter(a => cumpleEstadoCuenta(a, estadoCuenta))),
    [asientosTodos, estadoCuenta],
  );

  // Vista: con "solo descuadrados" activo, la tabla, los totales y los exports
  // muestran únicamente los asientos con Δ propio — así la contadora aísla el
  // problema en un click (herramienta de descuadre, 31-ago). Los dos filtros se
  // combinan: «por definir Y descuadrado» es una pregunta legítima.
  const asientos = uM(
    () => (soloDescuadrados ? asientosPorCuenta.filter(a => !a.cuadra) : asientosPorCuenta),
    [asientosPorCuenta, soloDescuadrados]
  );
  const movsById = uM(() => new Map(movsFiltrados.map(m => [m.id, m])), [movsFiltrados]);

  /**
   * Los OTROS comprobantes del mismo proveedor que siguen sin cuenta definida.
   *
   * Se acota a lo que está a la vista (empresa + período + filtros): ofrecer
   * corregir 300 comprobantes de golpe, de meses que no se están mirando, es
   * un botón que nadie debería tocar. Y se excluyen los que YA tienen cuenta a
   * mano: pisar en lote una decisión que otro tomó, sin verla, sería peor que
   * no tener el botón.
   */
  const hermanosDe = (asiento) => {
    const propio = movsById.get(asiento?.movimiento_id);
    const ruc = String(propio?.third_party_ruc || '').replace(/\D/g, '');
    if (!propio || !ruc) return [];
    const mismoEstado = new Set(
      asientosTodos.filter(a => cumpleEstadoCuenta(a, 'por_definir')).map(a => a.movimiento_id),
    );
    return movsFiltrados.filter(m =>
      m.id !== propio.id
      && String(m.third_party_ruc || '').replace(/\D/g, '') === ruc
      && !m.cuenta_pcge
      && mismoEstado.has(m.id));
  };

  // Se calcula una vez por asiento abierto: la ventana de consecuencias
  // re-simula cuando esta lista cambia, y rearmarla en cada render del libro
  // la haría re-simular sin motivo (~140 ms con la base de producción).
  const hermanosEditando = uM(
    () => (editando ? hermanosDe(editando) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editando, movsById, asientosTodos, movsFiltrados],
  );

  // Totales globales — SOLO S/ (hallazgo inspección 1-sep): los asientos en
  // USD se sumaban como si fueran soles en totales/PDF/Excel. Cada asiento
  // cuadra internamente, así que la herramienta de descuadre nunca podía
  // verlo. Sin tipo de cambio no hay conversión honesta: lo extranjero se
  // separa y se informa aparte, sin mezclar monedas.
  const totales = uM(() => {
    let totDebe = 0, totHaber = 0, lineas = 0;
    const extranjeras = new Map();   // 'USD' → { debe, asientos }
    asientos.forEach(a => {
      const cur = movsById.get(a.movimiento_id)?.currency || 'PEN';
      if (cur !== 'PEN') {
        const e = extranjeras.get(cur) || { debe: 0, asientos: 0 };
        a.partidas.forEach(p => { e.debe += p.debe; lineas += 1; });
        e.asientos += 1;
        extranjeras.set(cur, e);
        return;
      }
      a.partidas.forEach(p => {
        totDebe += p.debe;
        totHaber += p.haber;
        lineas += 1;
      });
    });
    return {
      totDebe: Math.round(totDebe * 100) / 100,
      totHaber: Math.round(totHaber * 100) / 100,
      lineas,
      cuadra: Math.abs(totDebe - totHaber) < 0.05,
      extranjeras: [...extranjeras.entries()].map(([cur, e]) => ({ cur, debe: Math.round(e.debe * 100) / 100, asientos: e.asientos })),
    };
  }, [asientos, movsById]);

  // Comprobante adjunto por movimiento (el mismo material que Movimientos
  // muestra con el ojo 👁): factura/imagen guardada por Captura Mágica.
  // Se guarda la evidencia CRUDA y la URL se resuelve recién al hacer click
  // (evita crear cientos de signed URLs/objectURLs que nadie abre).
  uE(() => {
    let cancel = false;
    const ids = new Set(movsFiltrados.map(m => m.id));
    const cargar = async () => {
      try {
        const evs = await window.__db.evidencias
          .filter(e => e.modulo_relacionado === 'accounting_movements' && !e.deleted_at
            && e.registro_relacionado_id && ids.has(e.registro_relacionado_id)
            && e.tipo_evidencia !== 'bancarizacion' && e.tipo_evidencia !== 'constancia_detraccion')
          .toArray();
        // Gana la ya subida; entre iguales, la más nueva (patrón de jx-contabilidad).
        const rank = (ev) => (ev.url_archivo && (ev.sync_status === 'uploaded' || ev.sync_status === 'synced')) ? 0 : 1;
        evs.sort((a, b) => (rank(a) - rank(b)) || (b.created_at || '').localeCompare(a.created_at || ''));
        const map = new Map();
        for (const ev of evs) if (!map.has(ev.registro_relacionado_id)) map.set(ev.registro_relacionado_id, ev);
        if (!cancel) setEvPorMov(map);
      } catch {}
    };
    cargar();
    const onChange = (e) => {
      const t = e?.detail?.tabla || e?.detail?.table;
      if (!t || t === 'evidencias') cargar();
    };
    window.addEventListener('jx_data_changed', onChange);
    return () => { cancel = true; window.removeEventListener('jx_data_changed', onChange); };
  }, [movsFiltrados]);

  // objectURL del visor vigente: se revoca al cerrar Y al desmontar la página
  // (sin el cleanup de unmount, navegar con el visor abierto fugaba el blob).
  const visorBlobRef = uR(null);
  uE(() => () => {
    if (visorBlobRef.current) { try { URL.revokeObjectURL(visorBlobRef.current); } catch {} }
  }, []);

  const abrirComprobante = async (movId) => {
    const ev = evPorMov.get(movId);
    if (!ev) return;
    try {
      const src = await getEvidenciaSrc(ev);
      if (!src?.url) { showToast?.('El archivo aún no está disponible (¿todavía subiendo?)', 'amber'); return; }
      // Fallback crudo de getEvidenciaSrc (url_archivo sin firmar = sin señal /
      // API caída): el visor mostraría un recuadro roto — mejor avisar.
      if (!src.isBlob && ev.url_archivo && src.url === ev.url_archivo) {
        showToast?.('Sin conexión con el servidor — el comprobante se abre cuando vuelva la señal.', 'amber');
        return;
      }
      visorBlobRef.current = src.isBlob ? src.url : null;
      setVisor({ url: src.url, mime: ev.mime_type || 'application/pdf', nombre: ev.nombre_archivo || 'comprobante', _blob: !!src.isBlob });
    } catch (e) {
      showToast?.('No se pudo abrir el comprobante: ' + (e.message || e), 'red');
    }
  };
  const cerrarVisor = () => {
    // El objectURL se creó solo para este visor — revocarlo al cerrar (sin
    // esto cada apertura de un comprobante local quedaba fugada en memoria).
    if (visor?._blob) { try { URL.revokeObjectURL(visor.url); } catch {} }
    visorBlobRef.current = null;
    setVisor(null);
  };

  const empresaActual = uM(() => {
    if (empresaId === 'all') return null;
    return (companies || []).find(c => c.id === empresaId);
  }, [companies, empresaId]);

  // ─── Periodo legible ───────────────────────────────────────
  const periodoLabel = uM(() => {
    const m = MESES.find(x => x.v === mes);
    return mes === 'all'
      ? `Año ${anio}`
      : `${m?.label || mes} ${anio}`;
  }, [anio, mes]);

  // ─── Exportar PDF ──────────────────────────────────────────
  const exportarPDF = () => {
    try {
      if (asientos.length === 0) {
        showToast?.('No hay asientos para exportar', 'amber');
        return;
      }
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = 297;
      // Vista parcial marcada: sin esto, un export con "Solo descuadrados"
      // activo parecía un Libro Diario completo.
      // Lo exportado es lo que se ve. Si el papel no dice con qué filtro
      // salió, alguien lo va a leer como el libro completo del mes.
      const filtroTxt = (soloDescuadrados ? ' — SOLO DESCUADRADOS' : '')
        + (estadoCuenta !== 'todas' ? ' — ' + (ESTADOS_CUENTA.find(e => e.v === estadoCuenta)?.label || estadoCuenta).toUpperCase() : '');
      const periodoTxt = periodoLabel + filtroTxt;

      // Header
      doc.setFillColor(14, 22, 32);
      doc.rect(0, 0, pageWidth, 26, 'F');
      doc.setTextColor(242, 183, 5);
      doc.setFontSize(15);
      doc.setFont('helvetica', 'bold');
      doc.text('JARVEX', 14, 12);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(empresaActual?.name || 'Todas las empresas', 14, 18);
      if (empresaActual?.ruc) doc.text(`RUC: ${empresaActual.ruc}`, 14, 22);

      doc.setFontSize(13);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(242, 183, 5);
      doc.text('LIBRO DIARIO', pageWidth - 14, 12, { align: 'right' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(255, 255, 255);
      doc.text(`Período: ${periodoTxt}`, pageWidth - 14, 18, { align: 'right' });
      doc.setFontSize(8);
      doc.setTextColor(220, 220, 220);
      doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, pageWidth - 14, 23, { align: 'right' });
      doc.setTextColor(0, 0, 0);

      // Construir filas (una por partida, agrupadas)
      const body = [];
      asientos.forEach((a, idx) => {
        // Solo ASCII: jsPDF con helvetica estándar (WinAnsi) corrompe ⚠ y Δ.
        const marcas = (a.extorno ? ' [NC extorno]' : '') + (!a.cuadra ? ` [DESCUADRE ${fmtS(Math.abs(a.delta))}]` : '');
        a.partidas.forEach((p, j) => {
          body.push([
            j === 0 ? String(idx + 1) : '',
            j === 0 ? fmtDate(a.fecha) : '',
            j === 0 ? (a.glosa.slice(0, 60) + marcas) : '',
            p.cuenta,
            p.descripcion.slice(0, 40),
            p.debe !== 0 ? fmtS(p.debe) : '',
            p.haber !== 0 ? fmtS(p.haber) : '',
          ]);
        });
      });

      // Fila total
      body.push([
        '', '', { content: totales.extranjeras.length ? 'TOTALES (solo S/)' : 'TOTALES', styles: { fontStyle: 'bold', halign: 'right' } },
        '', '',
        { content: fmtS(totales.totDebe), styles: { fontStyle: 'bold', halign: 'right', fillColor: [235, 240, 245] } },
        { content: fmtS(totales.totHaber), styles: { fontStyle: 'bold', halign: 'right', fillColor: [235, 240, 245] } },
      ]);

      autoTable(doc, {
        startY: 30,
        head: [['N°', 'Fecha', 'Glosa', 'Cuenta', 'Descripción', 'Debe', 'Haber']],
        body,
        headStyles: { fillColor: [28, 45, 64], textColor: 255, fontSize: 9 },
        bodyStyles: { fontSize: 7.5 },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: {
          0: { cellWidth: 12, halign: 'center' },
          1: { cellWidth: 22 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 16, halign: 'center' },
          4: { cellWidth: 70 },
          5: { cellWidth: 26, halign: 'right' },
          6: { cellWidth: 26, halign: 'right' },
        },
        margin: { left: 10, right: 10 },
      });

      // Footer
      const pages = doc.internal.getNumberOfPages();
      const ph = doc.internal.pageSize.getHeight();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(128, 128, 128);
        doc.text(`Libro Diario · ${periodoTxt}`, 14, ph - 8);
        doc.text(`Página ${i} de ${pages}`, pageWidth - 14, ph - 8, { align: 'right' });
      }

      const fname = `LibroDiario_${(empresaActual?.name || 'todas').replace(/\s+/g, '-')}_${anio}-${mes}${soloDescuadrados ? '_solo-descuadrados' : ''}${estadoCuenta !== 'todas' ? '_' + estadoCuenta : ''}.pdf`;
      doc.save(fname);
      showToast?.('PDF generado', 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  // ─── Exportar Excel ────────────────────────────────────────
  const exportarExcel = () => {
    try {
      if (asientos.length === 0) {
        showToast?.('No hay asientos para exportar', 'amber');
        return;
      }
      if (!window.__reports?.generateExcel) {
        showToast?.('Excel no disponible', 'red');
        return;
      }
      const columnas = ['N°', 'Fecha', 'Glosa', 'Tipo', 'Cuenta', 'Nombre cuenta', 'Descripción', 'Debe', 'Haber', 'Δ asiento'];
      const filas = [];
      asientos.forEach((a, idx) => {
        a.partidas.forEach((p, j) => {
          filas.push([
            j === 0 ? (idx + 1) : '',
            j === 0 ? fmtDate(a.fecha) : '',
            j === 0 ? a.glosa : '',
            j === 0 ? ((TIPO_LABEL[a.type] || a.type) + (a.extorno ? ' (NC extorno)' : '')) : '',
            p.cuenta,
            cuentaNombre(p.cuenta),
            p.descripcion,
            p.debe !== 0 ? p.debe : '',
            p.haber !== 0 ? p.haber : '',
            // Δ del PROPIO asiento (herramienta de descuadre): las contadoras
            // revisan el cuadre en Excel — con esta columna el culpable salta solo.
            j === 0 && !a.cuadra ? a.delta : '',
          ]);
        });
      });
      filas.push(['', '', '', '', '', '', totales.extranjeras.length ? 'TOTALES (solo S/)' : 'TOTALES', totales.totDebe, totales.totHaber, '']);

      window.__reports.generateExcel({
        // Máx 31 chars de sheetName en xlsx — 'DESC' marca la vista parcial.
        sheetName: `Libro Diario ${anio}${soloDescuadrados ? ' DESC' : ''}${estadoCuenta !== 'todas' ? ' ' + estadoCuenta.slice(0, 8) : ''}`,
        columnas,
        filas,
        filename: `LibroDiario_${(empresaActual?.name || 'todas').replace(/\s+/g, '-')}_${anio}-${mes}${soloDescuadrados ? '_solo-descuadrados' : ''}${estadoCuenta !== 'todas' ? '_' + estadoCuenta : ''}.xlsx`,
      });
      showToast?.('Excel generado', 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="page-wrap">
      {/* Cartel de contexto: esta pantalla puede estar acotada a UNA empresa
          (tanda 2F). Sin él, la lista se ve más corta y nadie sabe por qué. */}
      {window.EmpresaActivaBanner ? <window.EmpresaActivaBanner onSalir={() => setEmpresaId('all')}/> : null}
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Libro Diario</div>
          <div className="pg-sub">
            Asientos contables generados automáticamente desde los movimientos · PCGE Perú
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportarPDF} title="Exportar PDF">
            {window.JxIcon ? <window.JxIcon name="download" size={13}/> : null}PDF
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportarExcel} title="Exportar Excel">
            {window.JxIcon ? <window.JxIcon name="download" size={13}/> : null}Excel
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="card card-p" style={{ marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Empresa</label>
            <select className="fi" value={empresaId} onChange={e => setEmpresaId(e.target.value)} style={{ width: '100%' }}
              disabled={!!empresaFija}
              title={empresaFija ? 'Estás dentro de la contabilidad de esta empresa: es SU libro diario.' : undefined}>
              {!empresaFija && <option value="all">Todas las empresas</option>}
              {(companies || []).filter(c => !c.deleted_at && (!empresaFija || c.id === empresaFija)).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Año</label>
            <select className="fi" value={anio} onChange={e => setAnio(e.target.value)} style={{ width: '100%' }}>
              {aniosDisp.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Mes</label>
            <select className="fi" value={mes} onChange={e => setMes(e.target.value)} style={{ width: '100%' }}>
              {MESES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Tipo de asiento</label>
            <select className="fi" value={tipoFiltro} onChange={e => setTipoFiltro(e.target.value)} style={{ width: '100%' }}>
              {TIPO_FILTRO.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Estado de la cuenta</label>
            <select className="fi" value={estadoCuenta} onChange={e => setEstadoCuenta(e.target.value)} style={{ width: '100%' }}
              title="Aísla los asientos según cuánto se le puede creer a su cuenta. «Por definir» son los que no se pudieron deducir de los ítems del comprobante.">
              {ESTADOS_CUENTA.map(e => (
                <option key={e.v} value={e.v}>
                  {e.label}{e.v !== 'todas' ? ` (${cuentasPorEstado[e.v] || 0})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: descuadrados.length ? 'var(--red)' : 'var(--tm)', cursor: 'pointer', paddingBottom: 8 }}
              title="Mostrar solo los asientos cuyo propio debe ≠ haber — ahí vive el descuadre del total">
              <input type="checkbox" checked={soloDescuadrados} onChange={e => setSoloDescuadrados(e.target.checked)} />
              Solo descuadrados{descuadrados.length ? ` (${descuadrados.length})` : ''}
            </label>
          </div>
        </div>
      </div>

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <div className="card card-p" style={{ borderLeft: '3px solid var(--blue)' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Movimientos</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ts)', marginTop: 4 }}>
            {(soloDescuadrados || estadoCuenta !== 'todas')
              ? `${asientos.length} de ${movsFiltrados.length}`
              : movsFiltrados.length}
          </div>
        </div>
        <div className="card card-p" style={{ borderLeft: '3px solid var(--amber)' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}># Asientos</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ts)', marginTop: 4 }}>{asientos.length}</div>
        </div>
        <div className="card card-p" style={{ borderLeft: '3px solid var(--green)' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Total Debe</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--green)', marginTop: 4 }}>{fmtS(totales.totDebe)}</div>
        </div>
        <div className="card card-p" style={{ borderLeft: '3px solid var(--red)' }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Total Haber</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--red)', marginTop: 4 }}>{fmtS(totales.totHaber)}</div>
          {totales.extranjeras.map(e => (
            <div key={e.cur} style={{ fontSize: 10.5, color: 'var(--amber)', marginTop: 3 }}
              title="Sin tipo de cambio no se pueden sumar con los S/. Cada asiento cuadra en su propia moneda.">
              + {e.asientos} asiento{e.asientos === 1 ? '' : 's'} en {e.cur} ({e.cur === 'USD' ? 'US$ ' : ''}{e.debe.toLocaleString('es-PE', { minimumFractionDigits: 2 })}) aparte
            </div>
          ))}
        </div>
        <div className="card card-p"
          style={{ borderLeft: `3px solid ${totales.cuadra ? 'var(--green)' : 'var(--red)'}`, cursor: descuadrados.length ? 'pointer' : 'default' }}
          title={descuadrados.length ? 'Click: ver solo los asientos descuadrados' : 'Todos los asientos cuadran'}
          onClick={() => { if (descuadrados.length) setSoloDescuadrados(v => !v); }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Cuadre</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: totales.cuadra ? 'var(--green)' : 'var(--red)', marginTop: 4 }}>
            {totales.cuadra ? 'OK' : `Δ ${fmtS(Math.abs(totales.totDebe - totales.totHaber))}`}
          </div>
          {descuadrados.length > 0 && (
            <div style={{ fontSize: 10.5, color: 'var(--red)', marginTop: 3 }}>
              {descuadrados.length} asiento{descuadrados.length > 1 ? 's' : ''} descuadrado{descuadrados.length > 1 ? 's' : ''} — {soloDescuadrados ? 'viéndolos' : 'click para verlos'}
            </div>
          )}
        </div>
        {/* La pila de cuentas sin definir. Mismo patrón que la tarjeta de
            cuadre: el número se ve sin buscarlo y se entra de un click. */}
        <div className="card card-p"
          style={{
            borderLeft: `3px solid ${cuentasPorEstado.por_definir ? 'var(--amber)' : 'var(--green)'}`,
            cursor: cuentasPorEstado.por_definir ? 'pointer' : 'default',
          }}
          title={cuentasPorEstado.por_definir
            ? 'Click: ver solo los asientos cuya cuenta no se pudo deducir del comprobante'
            : 'Todos los asientos del período tienen su cuenta determinada'}
          onClick={() => {
            if (!cuentasPorEstado.por_definir) return;
            setEstadoCuenta(v => (v === 'por_definir' ? 'todas' : 'por_definir'));
          }}>
          <div style={{ fontSize: 11, color: 'var(--tm)', textTransform: 'uppercase' }}>Cuentas por definir</div>
          <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: cuentasPorEstado.por_definir ? 'var(--amber)' : 'var(--green)' }}>
            {cuentasPorEstado.por_definir || 'OK'}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
            {cuentasPorEstado.por_definir
              ? (estadoCuenta === 'por_definir' ? 'viéndolas' : 'click para verlas')
              : 'todas deducidas o puestas a mano'}
          </div>
        </div>
      </div>

      {/* Tabla de asientos */}
      {asientos.length === 0 ? (
        <div className="card card-p empty-state">
          <p style={{ color: (asientosTodos.length > 0 && (soloDescuadrados || estadoCuenta !== 'todas')) ? 'var(--green)' : 'var(--tm)' }}>
            {asientosTodos.length === 0
              ? 'No hay movimientos en el período seleccionado. Registra movimientos contables y los asientos se generarán automáticamente.'
              : soloDescuadrados
                ? '✓ Ningún asiento descuadrado en este filtro — todos cuadran.'
                : estadoCuenta === 'por_definir'
                  ? '✓ Ningún asiento con la cuenta sin definir en este período — todas se dedujeron del comprobante o se pusieron a mano.'
                  : `✓ Ningún asiento en «${ESTADOS_CUENTA.find(e => e.v === estadoCuenta)?.label || estadoCuenta}» en este período.`}
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>N°</th>
                  <th style={{ width: 90 }}>Fecha</th>
                  <th>Glosa</th>
                  <th style={{ width: 70 }}>Cuenta</th>
                  <th>Descripción</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Debe</th>
                  <th style={{ textAlign: 'right', width: 110 }}>Haber</th>
                </tr>
              </thead>
              <tbody>
                {asientos.map((a, idx) => (
                  <React.Fragment key={a.movimiento_id || idx}>
                    {a.partidas.map((p, j) => {
                    const isFirst = j === 0;
                    const isLast = j === a.partidas.length - 1;
                    return (
                      <tr
                        key={`${a.movimiento_id}-${j}`}
                        style={{
                          borderTop: isFirst ? '2px solid var(--bg-s)' : 'none',
                          borderBottom: (isLast && a.cuadra) ? '1px solid var(--bg-s)' : 'none',
                          background: !a.cuadra ? 'rgba(231,76,60,0.05)' : undefined,
                        }}
                      >
                        <td style={{ fontWeight: isFirst ? 700 : 400, color: isFirst ? 'var(--ts)' : 'transparent' }}>
                          {isFirst ? (idx + 1) : ''}
                        </td>
                        <td className="col-m">{isFirst ? fmtDate(a.fecha) : ''}</td>
                        <td>
                          {isFirst && (
                            <>
                              <strong style={{ fontSize: 12 }}>{a.glosa}</strong>
                              <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                <span className={`badge ${TIPO_BADGE[a.type] || 'b-gray'}`} style={{ fontSize: 10 }}>
                                  {TIPO_LABEL[a.type] || a.type}
                                </span>
                                {(movsById.get(a.movimiento_id)?.currency || 'PEN') !== 'PEN' && (
                                  <span className="badge b-blue" style={{ fontSize: 10 }}
                                    title="Asiento en moneda extranjera: sus montos están en la moneda del comprobante y NO se suman con los totales en S/.">
                                    {movsById.get(a.movimiento_id)?.currency}
                                  </span>
                                )}
                                {a.extorno && (
                                  <span className="badge b-amber" style={{ fontSize: 10 }} title="Nota de crédito / monto negativo asentado como extorno (debe↔haber invertidos)">
                                    ↩ NC · extorno
                                  </span>
                                )}
                                {!a.cuadra && (
                                  <span className="badge b-red" style={{ fontSize: 10 }} title="Este asiento no cuadra: su propio debe ≠ haber">
                                    Δ {fmtS(Math.abs(a.delta))}
                                  </span>
                                )}
                                {/* IGV: solo se avisa cuando NO es el 18 % general — o sea,
                                    cuando la tasa del comprobante es otra (comida al 10 %,
                                    exonerados) o cuando hubo que estimarla. */}
                                {a.desglose && igvDestacable(a.desglose) && (
                                  <span
                                    className={`badge ${a.desglose.origen === 'estimado' ? 'b-amber' : 'b-blue'}`}
                                    style={{ fontSize: 10 }}
                                    title={a.desglose.origen === 'estimado'
                                      ? 'El comprobante no trae base e IGV: se estimó al 18 %. Corregí el movimiento si la tasa era otra.'
                                      : `Base ${fmtS(Math.abs(a.desglose.subtotal))} + IGV ${fmtS(Math.abs(a.desglose.igv))} tomados del comprobante`}>
                                    IGV {describirIgv(a.desglose)}
                                  </span>
                                )}
                                {/* DE DÓNDE SALIÓ LA CUENTA. Solo se avisa cuando hay algo
                                    que mirar: lo que el catálogo resolvió no lleva badge,
                                    porque ya lo decidió una persona. Un asiento provisional
                                    con cara de definitivo es exactamente lo que hizo que
                                    nadie revisara las 1.742 filas que decían 60. */}
                                {a.cuentas && <BadgeCuenta cuentas={a.cuentas}/>}
                                {puedeCorregir && a.movimiento_id && (
                                  <button className="btn btn-ghost btn-xs" style={{ padding: '0 5px' }}
                                    title="Corregir la cuenta de este asiento"
                                    onClick={() => setEditando(a)}>
                                    {window.JxIcon ? <window.JxIcon name="edit" size={11}/> : '✎'}
                                  </button>
                                )}
                                {evPorMov.has(a.movimiento_id) && (
                                  <button className="btn btn-ghost btn-xs" style={{ padding: '0 5px', color: 'var(--blue, #3498DB)' }}
                                    title="Ver el comprobante adjunto (factura/imagen)"
                                    onClick={() => abrirComprobante(a.movimiento_id)}>
                                    {window.JxIcon ? <window.JxIcon name="eye" size={11}/> : '👁'}
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </td>
                        <td className="col-m" style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {p.cuenta}
                        </td>
                        <td style={{ fontSize: 12 }}>
                          {p.descripcion}
                          <div style={{ fontSize: 10, color: 'var(--tm)' }}>{cuentaNombre(p.cuenta)}</div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: p.debe !== 0 ? 700 : 400, color: p.debe !== 0 ? 'var(--green)' : 'var(--tm)' }} className="col-num">
                          {p.debe !== 0 ? fmtS(p.debe) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: p.haber !== 0 ? 700 : 400, color: p.haber !== 0 ? 'var(--red)' : 'var(--tm)' }} className="col-num">
                          {p.haber !== 0 ? fmtS(p.haber) : '—'}
                        </td>
                      </tr>
                    );
                    })}
                    {!a.cuadra && (
                      <tr style={{ background: 'rgba(231,76,60,0.10)', borderBottom: '1px solid var(--bg-s)' }}>
                        <td colSpan={7} style={{ fontSize: 11.5, color: 'var(--red)', padding: '6px 12px' }}>
                          ⚠ {explicarDescuadre(a, movsById.get(a.movimiento_id))}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'var(--bg-s)', fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: 'right', padding: '10px 12px' }}>{totales.extranjeras.length ? 'TOTALES (solo S/):' : 'TOTALES:'}</td>
                  <td style={{ textAlign: 'right', color: 'var(--green)' }} className="col-num">{fmtS(totales.totDebe)}</td>
                  <td style={{ textAlign: 'right', color: 'var(--red)' }} className="col-num">{fmtS(totales.totHaber)}</td>
                </tr>
                {!totales.cuadra && (
                  <tr style={{ background: 'rgba(231,76,60,0.08)' }}>
                    <td colSpan={5} style={{ textAlign: 'right', padding: '8px 12px', color: 'var(--red)' }}>
                      ⚠ Diferencia (debe ≠ haber):
                    </td>
                    <td colSpan={2} style={{ textAlign: 'right', color: 'var(--red)', fontWeight: 700 }}>
                      {fmtS(Math.abs(totales.totDebe - totales.totHaber))}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Visor del comprobante (mismo material que el ojo 👁 de Movimientos) */}
      {visor && window.Modal && (
        <window.Modal title={`Comprobante: ${visor.nombre}`} icon="eye" onClose={cerrarVisor} wide>
          <div style={{ textAlign: 'center' }}>
            {visor.mime?.startsWith('image/') ? (
              <img src={visor.url} alt={visor.nombre} style={{ maxWidth: '100%', maxHeight: '70vh', borderRadius: 8 }} />
            ) : (
              <PdfFrameLD url={visor.url} nombre={visor.nombre} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <a href={visor.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Abrir en pestaña</a>
            <button className="btn btn-amber btn-sm" onClick={cerrarVisor}>Cerrar</button>
          </div>
        </window.Modal>
      )}

      {editando && (
        <ModalCuenta
          asiento={editando}
          movimiento={movsById.get(editando.movimiento_id) || null}
          hermanos={hermanosEditando}
          familiaDe={familiaDe}
          bancarizadoIds={bancarizadoIds}
          movsVivos={movsVivos}
          puedeReclasificar={ROLES_CATALOGO.includes(rolActual)}
          userId={userId}
          showToast={showToast}
          onClose={() => setEditando(null)}
        />
      )}
    </div>
  );
}

// Registro global
window.LibroDiarioPage = LibroDiarioPage;
export { LibroDiarioPage };
export default LibroDiarioPage;
