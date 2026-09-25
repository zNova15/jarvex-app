// ═══════════════════════════════════════════════════════════════════
// JARVEX — IMPUTAR LO YA COMPRADO AL PRESUPUESTO (ronda 3, tanda 3.2).
//
// Hasta la tanda 3.1 esto era una pestaña DENTRO del Simulador de Órdenes
// («🧾 Imputar lo ya comprado»). Gabriel lo marcó como una de las siete
// pestañas «que no son del simulador» (doc §15.1 punto 6): acá se contesta
// «¿a qué línea del presupuesto corresponde esta compra?», que es una
// pregunta previa y distinta a «¿cuándo conviene pedir?». Por eso tiene su
// propia sección de Logística.
//
// El motor que arma la bandeja y el que escribe la imputación son los de
// siempre — `src/lib/simulador-imputacion.js`, sin tocar — esta pantalla es
// la que antes vivía dentro de `jx-simulador-ordenes.jsx` como `ImputarVista`
// / `FilaImputar`, con lo que era del ESCENARIO (qué resta el almacén,
// «Personalizado por insumo») dejado allá: imputar una fila no depende de
// qué escenario esté mirando Gabriel, es un hecho que se guarda en la base y
// vale para todos.
//
// ── QUÉ SE ESCRIBE ────────────────────────────────────────────────
// `imputar()` escribe DIRECTO en `oc_items` o en la tabla de almacén que
// corresponda (`materiales`, `herramientas`, `epps`): `imputacion`,
// `insumo_codigo`, `factor_presupuesto`. Nada se imputa solo — la sugerencia
// 🔎 la decide la persona — y no hay «aceptar todas» (ver el encabezado de
// `simulador-imputacion.js`): una imputación equivocada resta el insumo
// equivocado, y eso pide dos veces uno y deja corto el otro.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  catalogoDelPresupuesto, existenciasDelAlmacen, bandejaImputacion, parcheImputacion,
  factorPropuesto, IMPUTACION_LABEL, TABLAS_ALMACEN,
} from "../lib/simulador-imputacion.js";
import { leerCompras } from "../lib/simulador-escenarios.js";

const { useState: uS, useMemo: uM, useRef: uR, useEffect: uE } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const soles = (n) => `S/ ${num(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cant = (n) => num(n).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const pct = (f) => `${Math.round(num(f) * 100)}%`;

// ── LA BANDEJA, TAL COMO ESTABA DENTRO DEL SIMULADOR ──────────────
// `ImputarVista` y `FilaImputar` son las mismas que armó la tanda 2.5; lo
// único que se les sacó es lo del ESCENARIO (la nota de qué resta el
// almacén, y el picker «Personalizado por insumo», que se quedaron en
// `jx-simulador-ordenes.jsx`, dentro de «⚙ Ajustes finos»): imputar una fila
// no depende de qué escenario esté mirando Gabriel.
// ═══════════════════════════════════════════════════════════════════

const DATALIST_PRESUPUESTO = 'jx-sim-presupuesto';
const FILAS_POR_TANDA = 40;
const COLOR_IMPUTACION = { pendiente: 'var(--amber)', insumo: 'var(--green)', sobre: 'var(--blue)', fuera: 'var(--tm)' };

// El texto del datalist empieza por el código: «210020001 · CEMENTO … [bol]».
const opcionDe = (e) => `${e.codigo} · ${e.esSobre ? 'SOBRE · ' : ''}${e.nombre} [${e.unidad || '—'}]`;
const codigoDeTexto = (t) => String(t || '').split(' · ')[0].trim();

function ImputarVista({ bandeja, catalogo, compras, imputando, onImputar, cargandoAlmacen, ladoInicial = 'ordenes' }) {
  const [lado, setLado] = React.useState(ladoInicial);
  const [filtro, setFiltro] = React.useState('pendientes');
  const [busca, setBusca] = React.useState('');
  const [tope, setTope] = React.useState(FILAS_POR_TANDA);
  React.useEffect(() => { setTope(FILAS_POR_TANDA); }, [lado, filtro, busca]);

  const filas = React.useMemo(() => {
    if (!bandeja) return [];
    const base = lado === 'ordenes' ? bandeja.ordenes : bandeja.almacen;
    const q = busca.trim().toLowerCase();
    return base.filter(f => (filtro === 'todas' || f.estado === 'pendiente')
      && (!q || String(f.nombre).toLowerCase().includes(q) || String(f.ordenCodigo || '').toLowerCase().includes(q)));
  }, [bandeja, lado, filtro, busca]);

  if (!bandeja) {
    return <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Armando la bandeja…</div>;
  }
  const r = bandeja.resumen;

  return (
    <div>
      <datalist id={DATALIST_PRESUPUESTO}>
        {catalogo.insumos.map(e => <option key={e.codigo} value={opcionDe(e)} />)}
        {lado === 'ordenes' && catalogo.sobres.map(e => <option key={e.codigo} value={opcionDe(e)} />)}
      </datalist>

      <div className="card card-p" style={{ marginBottom: 12 }}>
        <b>Para que el plan no vuelva a pedir lo que ya se compró</b>, cada línea de orden y cada ítem del almacén
        tiene que decir a qué línea del presupuesto corresponde.
        <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
          La sugerencia 🔎 es solo eso: la decidís vos. Nada se imputa solo y no hay «aceptar todas», porque una
          imputación equivocada resta el insumo equivocado. Lo que no está en el presupuesto (los estudios del
          documento de trabajo, útiles de oficina) se marca como tal, y deja de figurar como «no se sabe».
          Queda guardado en la base: lo ve el resto del equipo y vale para todos los escenarios.
        </p>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
        <button className={`btn btn-sm ${lado === 'ordenes' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setLado('ordenes')}>
          Órdenes ya emitidas · {r.ordenes.pendiente} sin imputar de {r.ordenes.total}
        </button>
        <button className={`btn btn-sm ${lado === 'almacen' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setLado('almacen')}>
          Almacén de la obra · {r.almacen.pendiente} sin imputar de {r.almacen.total}
        </button>
        <span style={{ flex: 1 }} />
        <select className="fi" style={{ maxWidth: 170 }} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="pendientes">Solo sin imputar</option>
          <option value="todas">Todas</option>
        </select>
        <input className="fi" style={{ maxWidth: 220 }} placeholder="Buscar…" value={busca} onChange={e => setBusca(e.target.value)} />
      </div>

      {lado === 'almacen' && (
        <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '0 0 10px' }}>
          Qué resta el almacén (todo lo que entró, solo lo que hay hoy, nada, o insumo por insumo) se elige en el
          Simulador de Órdenes, dentro de «⚙ Ajustes finos». Si una orden recibida y un ítem del almacén son el mismo
          insumo, manda el almacén: lo que llegó ya está en sus entradas y la orden no se suma encima.
        </p>
      )}

      {lado === 'almacen' && cargandoAlmacen && (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Leyendo el almacén de la obra…</div>
      )}
      {!filas.length && !(lado === 'almacen' && cargandoAlmacen) && (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>
          {filtro === 'pendientes' ? '✓ No queda nada sin imputar de este lado.' : 'No hay filas.'}
        </div>
      )}
      <div style={{ display: 'grid', gap: 8 }}>
        {filas.slice(0, tope).map(f => (
          <FilaImputar key={`${f.tabla}:${f.id}`} f={f} catalogo={catalogo} compras={compras}
            ocupado={imputando === `${f.tabla}:${f.id}`} onImputar={onImputar} />
        ))}
      </div>
      {filas.length > tope && (
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setTope(t => t + FILAS_POR_TANDA)}>
            Ver {Math.min(FILAS_POR_TANDA, filas.length - tope)} más (quedan {filas.length - tope})
          </button>
        </div>
      )}
    </div>
  );
}

function FilaImputar({ f, catalogo, compras, ocupado, onImputar }) {
  const esOrden = f.fuente === 'orden';
  const sug = f.sugerencia;
  const [texto, setTexto] = React.useState('');
  const [factor, setFactor] = React.useState('');
  const [abierta, setAbierta] = React.useState(false);

  const elegido = catalogo.porCodigo.get(codigoDeTexto(texto)) || null;
  const elegir = (e) => {
    setTexto(opcionDe(e));
    setAbierta(true);
    if (e.esSobre) { setFactor(''); return; }
    const fp = factorPropuesto(f.unidad, e, { compras });
    setFactor(fp.factor != null ? String(fp.factor) : '');
  };
  const confirmar = () => {
    if (!elegido) return;
    onImputar(f, elegido.esSobre
      ? { tipo: 'sobre', codigo: elegido.codigo }
      : { tipo: 'insumo', codigo: elegido.codigo, factor: Number(factor) });
  };

  const meta = esOrden
    ? `${f.ordenCodigo} · ${cant(f.cantidad)} ${f.unidad || ''} · ${soles(f.monto)}${f.proveedor ? ` · ${f.proveedor}` : ''}`
    : `${TABLAS_ALMACEN[f.tabla]?.label || f.tabla} · entraron ${cant(f.entradas)} ${f.unidad || ''} · hay ${cant(f.stock)}`;

  return (
    <div className="card card-p" style={{ borderLeft: `3px solid ${COLOR_IMPUTACION[f.estado]}`, opacity: ocupado ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, overflowWrap: 'anywhere' }}>{f.nombre || '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>{meta}</div>
        </div>
        <span style={{ fontSize: 11, color: COLOR_IMPUTACION[f.estado], fontWeight: 600 }}>{IMPUTACION_LABEL[f.estado]}</span>
      </div>

      {f.estado !== 'pendiente' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
          {f.estado === 'fuera'
            ? <span style={{ color: 'var(--tm)' }}>No corresponde a ninguna línea del presupuesto: no resta nada.</span>
            : (
              <span>
                → {f.estado === 'sobre' ? 'sobre ' : ''}<b>{f.destino?.nombre || f.insumo_codigo}</b>
                {f.destino?.unidad ? ` [${f.destino.unidad}]` : ''}
                {f.estado === 'insumo' && num(f.factor) > 0 && num(f.factor) !== 1 && ` · 1 ${f.unidad || 'u'} = ${cant(f.factor)} ${f.destino?.unidad || ''}`}
                {f.estado === 'insumo' && !f.destino && <span style={{ color: 'var(--amber)' }}> · ⚠ ese código ya no está en el presupuesto</span>}
              </span>
            )}
          <button className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => onImputar(f, { tipo: null })}>Deshacer</button>
        </div>
      )}

      {f.estado === 'pendiente' && (
        <div style={{ marginTop: 6, display: 'grid', gap: 6 }}>
          {sug && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
              <span>
                🔎 Sugerido: {sug.tipo === 'sobre' ? 'sobre ' : ''}<b>{sug.nombre}</b> [{sug.unidad || '—'}]
                {sug.score != null && <span style={{ color: 'var(--tm)' }}> · {pct(sug.score)}</span>}
                {sug.tipo === 'insumo' && sug.factor != null && sug.factor !== 1 && <span style={{ color: 'var(--tm)' }}> · {sug.motivoFactor}</span>}
              </span>
              {(sug.tipo === 'sobre' || sug.factor != null) ? (
                <button className="btn btn-sm btn-green" disabled={ocupado}
                  onClick={() => onImputar(f, sug.tipo === 'sobre'
                    ? { tipo: 'sobre', codigo: sug.codigo }
                    : { tipo: 'insumo', codigo: sug.codigo, factor: sug.factor })}>
                  ✓ Es este
                </button>
              ) : (
                <button className="btn btn-sm btn-ghost" disabled={ocupado} title={sug.motivoFactor}
                  onClick={() => elegir(catalogo.porCodigo.get(sug.codigo))}>
                  Es este — falta el factor
                </button>
              )}
            </div>
          )}
          {f.alternativas?.length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', fontSize: 11 }}>
              <span style={{ color: 'var(--tm)' }}>{sug ? 'O alguno de estos:' : '¿Es alguno de estos?'}</span>
              {f.alternativas.slice(0, 4).map(a => (
                <button key={a.codigo} className="btn btn-sm btn-ghost" style={{ fontSize: 11, padding: '1px 6px' }}
                  disabled={ocupado} onClick={() => elegir(catalogo.porCodigo.get(a.codigo))}>
                  {a.nombre} [{a.unidad}]
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input className="fi" style={{ flex: '1 1 260px', minWidth: 0, fontSize: 12 }} list={DATALIST_PRESUPUESTO}
              placeholder={esOrden ? 'Buscar insumo o sobre del presupuesto…' : 'Buscar insumo del presupuesto…'}
              value={texto}
              onChange={e => {
                setTexto(e.target.value);
                const e2 = catalogo.porCodigo.get(codigoDeTexto(e.target.value));
                if (e2) elegir(e2);
              }} />
            {abierta && elegido && !elegido.esSobre && (
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11.5 }}
                title="Cuántas unidades del presupuesto trae UNA unidad de esta fila. Un tubo de 6 m contra metros = 6.">
                1 {f.unidad || 'u'} =
                <input className="fi" type="number" min="0" step="any" style={{ width: 80, fontSize: 12 }}
                  value={factor} onChange={e => setFactor(e.target.value)} />
                {elegido.unidad}
              </label>
            )}
            {abierta && elegido && (
              <button className="btn btn-sm btn-amber" disabled={ocupado || (!elegido.esSobre && !(Number(factor) > 0))} onClick={confirmar}>
                Imputar
              </button>
            )}
            <button className="btn btn-sm btn-ghost" disabled={ocupado} onClick={() => onImputar(f, { tipo: 'fuera' })}
              title="No corresponde a ninguna línea del presupuesto. Deja de contarse como «no se sabe».">
              {esOrden ? 'Fuera del presupuesto' : 'No está en el presupuesto'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LA PÁGINA
// ═══════════════════════════════════════════════════════════════════

const TABLAS_ALMACEN_OBRA = ['materiales', 'herramientas', 'epps', 'movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp'];

// `ladoInicial` existe para poder abrir la pantalla directo en un lado (mismo
// patrón que `vistaInicial` en el Simulador de Órdenes): sin esto, el lado
// «Almacén de la obra» no lo mira ningún test hasta producción, porque un
// click no se puede simular sobre HTML ya renderizado a texto.
function ImputarComprasPage({ showToast, ladoInicial = 'ordenes' }) {
  const toast = showToast || window.__showToast || (() => {});

  // ── Regla de hooks: TODOS antes de cualquier early return (React #310) ──
  const auth = window.__useAuth?.();
  const autorId = auth?.profile?.id ?? null;

  const obrasHook = window.__hooks.useObras();
  const obras = uM(() => (obrasHook.data || []).filter(o => !o.deleted_at), [obrasHook.data]);
  const [obraId, setObraId] = uS(() => {
    try { return window.__getObraActivaId?.() || ''; } catch { return ''; }
  });
  uE(() => {
    if (!obraId && obras.length) {
      const guardada = window.__getObraActivaId?.();
      const a = (guardada && obras.find(o => o.id === guardada)) || obras[0];
      if (a) setObraId(a.id);
    }
  }, [obras, obraId]);

  const ipHook = window.__hooks.useInsumosPartida(obraId);
  const catalogoPres = uM(() => catalogoDelPresupuesto(ipHook.data || []), [ipHook.data]);
  // Cómo se compra cada insumo (unidad, lote, colchón): de la OBRA, no del
  // escenario (mismo dato que usa el Simulador). Solo se LEE acá: el factor
  // de conversión que propone `factorPropuesto` no se guarda desde esta
  // pantalla.
  const compras = uM(() => (obraId ? leerCompras(obraId) : {}), [obraId]);

  const [ordenes, setOrdenes] = uS([]);
  const [ocItems, setOcItems] = uS([]);
  const [almacenCrudo, setAlmacenCrudo] = uS(null);
  const [recalcN, setRecalcN] = uS(0);
  const imputarRef = uR(false);
  const [imputando, setImputando] = uS(null);

  // Las órdenes ya emitidas y sus ítems, de TODA la empresa (se filtran por
  // obra abajo): no hay hook de `oc_items`, así que van de Dexie.
  uE(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const [o, i] = await Promise.all([
          window.__db.ordenes_compra.toArray(),
          window.__db.oc_items.toArray(),
        ]);
        if (!vivo) return;
        setOrdenes(o.filter(x => !x.deleted_at));
        setOcItems(i.filter(x => !x.deleted_at));
      } catch {
        if (vivo) { setOrdenes([]); setOcItems([]); }
      }
    };
    cargar();
    const on = (e) => {
      const t = e?.detail?.tabla;
      if (!t || ['ordenes_compra', 'oc_items'].includes(t)) cargar();
    };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', cargar);
    return () => {
      vivo = false;
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', cargar);
    };
  }, [recalcN]);

  // El almacén de la obra: es donde de verdad quedó lo comprado (en
  // Miraflores entraron 3.140 bolsas de cemento y las órdenes explican 2.250).
  uE(() => {
    let vivo = true;
    if (!obraId) { setAlmacenCrudo(null); return undefined; }
    const cargar = async () => {
      try {
        const [mat, her, epp, mm, mh, me] = await Promise.all(TABLAS_ALMACEN_OBRA.map(t => (
          window.__db[t] ? window.__db[t].where('obra_id').equals(obraId).toArray() : Promise.resolve([])
        )));
        if (vivo) setAlmacenCrudo({ mat, her, epp, mm, mh, me });
      } catch {
        if (vivo) setAlmacenCrudo({ mat: [], her: [], epp: [], mm: [], mh: [], me: [] });
      }
    };
    cargar();
    const on = (e) => { const t = e?.detail?.tabla; if (!t || TABLAS_ALMACEN_OBRA.includes(t)) cargar(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', cargar);
    return () => {
      vivo = false;
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', cargar);
    };
  }, [obraId, recalcN]);

  const almacenFilas = uM(() => (almacenCrudo ? existenciasDelAlmacen({
    materiales: almacenCrudo.mat, herramientas: almacenCrudo.her, epps: almacenCrudo.epp,
    movMateriales: almacenCrudo.mm, movHerramientas: almacenCrudo.mh, movEpp: almacenCrudo.me,
    obraId,
  }) : []), [almacenCrudo, obraId]);

  const ordenesObra = uM(() => ordenes.filter(o => !obraId || o.obra_id === obraId), [ordenes, obraId]);

  const bandeja = uM(() => {
    if (!obraId) return null;
    return bandejaImputacion({ ordenes: ordenesObra, ocItems, almacen: almacenFilas, catalogo: catalogoPres, compras });
  }, [obraId, ordenesObra, ocItems, almacenFilas, catalogoPres, compras]);

  // ── Imputar una fila (misma lógica de la tanda 2.5) ───────────────
  // El parche sale SOLO de `parcheImputacion`, que respeta el CHECK de la
  // mig 229: Dexie no lo valida y una fila mal formada rebotaría en el push
  // (regla 9 de CLAUDE.md). El guard es un ref síncrono (regla 2): dos clics
  // seguidos no escriben dos veces.
  const imputar = async (fila, decision) => {
    if (imputarRef.current) return;
    const r = parcheImputacion(decision, { permiteSobre: fila.fuente === 'orden', catalogo: catalogoPres });
    if (!r.ok) { toast(r.motivo, 'amber'); return; }
    const tabla = window.__db?.[fila.tabla];
    if (!tabla) { toast('No se encontró la tabla local', 'red'); return; }
    imputarRef.current = true;
    setImputando(`${fila.tabla}:${fila.id}`);
    try {
      const fresca = await tabla.get(fila.id);
      if (!fresca) { toast('Esa fila ya no existe', 'red'); return; }
      const now = new Date().toISOString();
      await tabla.update(fila.id, {
        ...r.patch,
        updated_at: now,
        // `oc_items` no tiene columnas de autor: mandarla rechaza el push entero.
        ...(fila.tabla !== 'oc_items' ? { updated_by: autorId } : {}),
        version: (fresca.version ?? 0) + 1,
        sync_status: fresca.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      const destino = r.patch.insumo_codigo ? catalogoPres.porCodigo.get(r.patch.insumo_codigo) : null;
      try {
        await window.__logAudit?.({
          action: 'update', table: fila.tabla, recordId: fila.id,
          oldData: { imputacion: fresca.imputacion ?? null, insumo_codigo: fresca.insumo_codigo ?? null, factor_presupuesto: fresca.factor_presupuesto ?? null },
          newData: r.patch,
          reason: r.patch.imputacion
            ? `Imputar lo ya comprado: «${fila.nombre}» imputada ${r.patch.imputacion === 'fuera' ? 'fuera del presupuesto' : `a ${destino?.nombre || r.patch.insumo_codigo}`}`
            : `Imputar lo ya comprado: se deshizo la imputación de «${fila.nombre}»`,
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: fila.tabla } })); } catch {}
      toast(r.patch.imputacion
        ? `✓ ${IMPUTACION_LABEL[r.patch.imputacion]}${destino ? `: ${destino.nombre}` : ''}`
        : 'Imputación deshecha', 'green');
    } catch (e) {
      console.warn('[imputar-compras] error al imputar', e);
      toast(`No se pudo guardar: ${e?.message || e}`, 'red');
    } finally {
      imputarRef.current = false;
      setImputando(null);
    }
  };

  const cargando = obrasHook.loading || ipHook.loading;

  if (!obraId) {
    return window.SinObraEmpty ? <window.SinObraEmpty icon="link" /> : <div className="card card-p">Elegí un trabajo.</div>;
  }

  return (
    <div className="page-wrap">
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <select className="fi" style={{ maxWidth: 360 }} value={obraId} onChange={e => setObraId(e.target.value)}>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre_obra || o.nombre}</option>)}
          </select>
          <button className="btn btn-sm btn-amber" style={{ marginLeft: 'auto' }}
            onClick={() => { setRecalcN(n => n + 1); toast('Vuelto a leer las órdenes y el almacén', 'green'); }}
            title="Vuelve a leer las órdenes y el almacén de esta obra.">
            <JxIcon name="refresh" size={13} /> Actualizar
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '10px 0 0' }}>
          Cada línea de orden y cada ítem del almacén tiene que decir a qué línea del presupuesto corresponde, para
          que el <b>Simulador de Órdenes</b> no vuelva a pedir lo que ya se compró. Lo que imputes acá queda guardado
          en la base: lo ve el resto del equipo y vale para todos los escenarios.
        </p>
      </div>

      {cargando ? (
        <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Cargando el presupuesto…</div>
      ) : (
        <ImputarVista
          bandeja={bandeja}
          catalogo={catalogoPres}
          compras={compras}
          imputando={imputando}
          onImputar={imputar}
          cargandoAlmacen={!almacenCrudo}
          ladoInicial={ladoInicial}
        />
      )}
    </div>
  );
}

window.ImputarComprasPage = ImputarComprasPage;
export { ImputarComprasPage };
export default ImputarComprasPage;
