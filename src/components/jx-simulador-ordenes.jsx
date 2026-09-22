// ═══════════════════════════════════════════════════════════════════
// JARVEX — SIMULADOR DE ÓRDENES POR PRESUPUESTO (tanda 3: la pantalla).
//
// Diseño en `docs/plan-simulador-ordenes.md`. Las tandas 1 y 2 dejaron los
// dos motores puros (`simulador-ordenes.js` y `simulador-dotacion.js`) y la
// tanda 3 dejó el estado de la persona (`simulador-escenarios.js`). Acá NO
// hay lógica de negocio: hay una pantalla que junta esas tres cosas.
//
// ── LA PREGUNTA QUE CONTESTA ──────────────────────────────────────
// `abastecimiento` dice CUÁNTO falta. Ésta dice CUÁNDO conviene pedirlo y
// agrupado en qué orden: «Materiales — octubre 2026», «EPPs — primera
// dotación». Cada corrida se define por cuatro ejes (§3) y se guarda con
// nombre, para poder comparar «con el Gantt» contra «regularizando desde
// hoy» sin recalcular a mano.
//
// ── LO QUE ESTA PANTALLA NO HACE, A PROPÓSITO ─────────────────────
//  1. NO EMITE NADA. Aceptar una orden acá no escribe ni una fila: deja la
//     decisión guardada en el navegador. Convertirla en requisición y en
//     orden real es la tanda 4, y va a estar restringida a la entidad
//     ejecutora del trabajo (§7). Mientras eso no exista, el pie de la
//     pantalla lo dice con todas las letras en vez de ofrecer un botón que
//     no hace nada.
//  2. NO PROPONE MANO DE OBRA COMO ORDEN. La planilla no se compra (§5): va
//     en su propia pestaña, como número de referencia contra el padrón real,
//     y con la leyenda puesta.
//  3. NO MUESTRA LA COBERTURA CONTRA EL PRESUPUESTO TOTAL. En Miraflores el
//     47% es planilla: una barra contra los S/ 9,59 M nunca llegaría al 100%
//     y se leería como «vamos por la mitad». Va contra el comprable (§2).
//  4. NO INVENTA NÚMEROS QUE NO TIENE. Las 62 líneas ya ordenadas sin código
//     de insumo no se pueden descontar, y la pantalla lo dice arriba en vez
//     de dejar que el plan las pida de nuevo. Lo mismo con los sobres cuyo
//     consumo nadie informó: el techo se marca como «no firme».
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  simularOrdenes,
  ANCLAJES, ANCLAJE_LABEL, CRONOGRAMAS, CRONOGRAMA_LABEL,
  REPARTOS, REPARTO_LABEL, GRANULARIDADES,
  MOTIVO_PENDIENTE_LABEL, CATEGORIAS_SIMULADOR,
} from "../lib/simulador-ordenes.js";
import { CATEGORIA_SIMULADOR_LABEL, SUBCATEGORIA_LABEL } from "../lib/insumo-clasificador.js";
import { simularDotacion, planDeContratacion } from "../lib/simulador-dotacion.js";
import {
  PARAMS_DEFAULT, paramsDeMotor,
  nuevoEscenario, conParams,
  decidirPropuesta, decidirLinea, decidirPeriodo,
  editarLinea, limpiarEdicion, proveedorDePropuesta,
  decidirSobre, agregarLineaSobre, editarLineaSobre, quitarLineaSobre, proveedorDeSobre,
  aplicarEscenario, lineasAceptadas,
  leerEscenarios, guardarEscenario, borrarEscenario,
} from "../lib/simulador-escenarios.js";
import { titularContableDeObra } from "../lib/consorcio.js";
import { rubroLabel } from "../lib/rubros.js";

const { useState: uS, useMemo: uM, useRef: uR, useEffect: uE, useCallback: uC } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const soles = (n) => `S/ ${num(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const solesK = (n) => {
  const v = num(n);
  if (Math.abs(v) >= 1e6) return `S/ ${(v / 1e6).toLocaleString('es-PE', { maximumFractionDigits: 2 })} M`;
  if (Math.abs(v) >= 1e4) return `S/ ${Math.round(v / 1000).toLocaleString('es-PE')} k`;
  return soles(v);
};
const cant = (n) => num(n).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const pct = (f) => `${Math.round(num(f) * 100)}%`;

const COLOR_DECISION = { aceptada: 'var(--green)', rechazada: 'var(--red)', parcial: 'var(--blue)', pendiente: 'var(--tm)' };
const ESTADO_LABEL = { aceptada: 'Aceptada', rechazada: 'Rechazada', parcial: 'Parcial', pendiente: 'Sin decidir' };

// Cuántas líneas se dibujan de una orden antes de pedir «ver más». Una
// propuesta de materiales de Miraflores puede traer cientos: pintarlas todas
// cuelga la pestaña por un dato que nadie está mirando todavía.
const LINEAS_POR_TANDA = 40;

/**
 * El id del `<datalist>` de proveedores, que se dibuja UNA vez para toda la
 * pantalla.
 *
 * Medido el 22-set-2026: hay **549 proveedores en el catálogo + 28 empresas
 * del grupo = 577 candidatos**. Un `<select>` por línea serían 577 `<option>`
 * por fila — con 40 filas abiertas, 23.000 nodos de DOM para un dato que casi
 * nadie está mirando en ese momento. Un datalist único, compartido por todos
 * los inputs, cuesta 577 nodos en total y encima se filtra escribiendo, que es
 * como se busca entre 549 proveedores.
 *
 * Y se elige ARRIBA, en la orden, no línea por línea: una orden se le emite a
 * un proveedor (§6). La línea suelta se puede pisar igual, al corregirla.
 */
const DATALIST_PROVEEDORES = 'jx-sim-proveedores';

// ═══════════════════════════════════════════════════════════════════

// `vistaInicial` existe para poder abrir la pantalla directo en una pestaña
// (mismo patrón que jx-catalogo-canonico). Lo usa el test de pantalla: sin
// esto las tres pestañas de abajo no las mira nadie hasta producción.
function SimuladorOrdenesPage({ showToast, vistaInicial = 'ordenes' }) {
  const toast = showToast || window.__showToast || (() => {});

  // ── Regla de hooks: TODOS antes de cualquier early return (React #310) ──
  const obrasHook = window.__hooks.useObras();
  const compHook = window.__hooks.useCompanies();
  const consHook = window.__hooks.useConsorcios();

  const obras = uM(() => (obrasHook.data || []).filter(o => !o.deleted_at), [obrasHook.data]);
  const [obraId, setObraId] = uS(() => {
    try { return window.__getObraActivaId?.() || ''; } catch { return ''; }
  });

  const ipHook = window.__hooks.useInsumosPartida(obraId);
  const partidasHook = window.__hooks.usePartidas(obraId);
  const personalHook = window.__hooks.usePersonal(obraId);

  const [vista, setVista] = uS(vistaInicial);
  const [abiertos, setAbiertos] = uS(() => new Set());
  const [verMas, setVerMas] = uS({});          // propuesta id → cuántas líneas
  const [busca, setBusca] = uS('');
  const [soloPendientes, setSoloPendientes] = uS(false);
  const [editando, setEditando] = uS(null);    // ref de la línea en edición
  const [panelParams, setPanelParams] = uS(true);
  const [proveedores, setProveedores] = uS([]);
  const [ordenes, setOrdenes] = uS([]);
  const [ocItems, setOcItems] = uS([]);

  // ── Escenarios (localStorage, por obra) ───────────────────────────
  const [escenarios, setEscenarios] = uS([]);
  const [escenario, setEscenario] = uS(null);
  const escRef = uR(null);
  const exportRef = uR(false);

  uE(() => {
    if (!obraId && obras.length) {
      const guardada = window.__getObraActivaId?.();
      const a = (guardada && obras.find(o => o.id === guardada)) || obras[0];
      if (a) setObraId(a.id);
    }
  }, [obras, obraId]);

  // Los escenarios se leen al entrar y cuando se cambia de obra. Si no hay
  // ninguno se crea uno con los defaults: entrar y encontrar la pantalla
  // vacía pidiendo «creá un escenario» es una puerta cerrada de más.
  uE(() => {
    if (!obraId) { setEscenarios([]); setEscenario(null); escRef.current = null; return; }
    let lista = leerEscenarios(obraId);
    if (!lista.length) {
      const base = nuevoEscenario({ nombre: 'Escenario base', obraId, params: PARAMS_DEFAULT });
      lista = guardarEscenario(obraId, base);
    }
    setEscenarios(lista);
    setEscenario(lista[0]);
    escRef.current = lista[0];
    setAbiertos(new Set());
  }, [obraId]);

  // Las órdenes ya emitidas y sus ítems: es lo que evita pedir dos veces lo
  // que ya se pidió. No hay hook de `oc_items`, así que van de Dexie.
  uE(() => {
    let vivo = true;
    const cargar = async () => {
      try {
        const [o, i, pv] = await Promise.all([
          window.__db.ordenes_compra.toArray(),
          window.__db.oc_items.toArray(),
          window.__db.proveedores.toArray(),
        ]);
        if (!vivo) return;
        setOrdenes(o.filter(x => !x.deleted_at));
        setOcItems(i.filter(x => !x.deleted_at));
        setProveedores(pv.filter(x => !x.deleted_at));
      } catch { if (vivo) { setOrdenes([]); setOcItems([]); setProveedores([]); } }
    };
    cargar();
    const on = (e) => {
      const t = e?.detail?.tabla;
      if (!t || t === 'ordenes_compra' || t === 'oc_items' || t === 'proveedores') cargar();
    };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', cargar);
    return () => {
      vivo = false;
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', cargar);
    };
  }, []);

  const obra = uM(() => obras.find(o => o.id === obraId) || null, [obras, obraId]);
  const titularId = uM(() => titularContableDeObra(obra, consHook.data || []), [obra, consHook.data]);
  const titular = uM(() => (compHook.data || []).find(c => c.id === titularId) || null, [compHook.data, titularId]);

  const params = escenario?.params || PARAMS_DEFAULT;

  const ordenesObra = uM(
    () => ordenes.filter(o => !obraId || o.obra_id === obraId),
    [ordenes, obraId]
  );

  const plazo = uM(() => (obra?.fecha_inicio
    ? { inicio: obra.fecha_inicio, fin: obra.fecha_fin_estimada || obra.fecha_fin || null }
    : null), [obra]);

  // ── LA CORRIDA DE ÓRDENES ─────────────────────────────────────────
  // `mano_obra` se saca del filtro aunque esté tildada: la planilla no se
  // compra, y mezclarla acá la mostraría como algo que se le puede emitir a
  // un proveedor. Va por su propia pestaña (§5).
  const corrida = uM(() => {
    if (!obraId) return null;
    const motor = paramsDeMotor(params);
    return simularOrdenes({
      insumosPartida: ipHook.data || [],
      partidas: partidasHook.data || [],
      ...motor,
      categorias: motor.categorias.filter(c => c !== 'mano_obra'),
      plazo,
      ordenes: ordenesObra, ocItems,
    });
  }, [obraId, params, ipHook.data, partidasHook.data, plazo, ordenesObra, ocItems]);

  // ── LA CORRIDA DE MANO DE OBRA (referencia, nunca una orden) ──────
  const corridaMO = uM(() => {
    if (!obraId || vista !== 'dotacion') return null;
    const motor = paramsDeMotor(params);
    return simularOrdenes({
      insumosPartida: ipHook.data || [],
      partidas: partidasHook.data || [],
      ...motor,
      categorias: ['mano_obra'],
      plazo,
    });
  }, [obraId, params, ipHook.data, partidasHook.data, plazo, vista]);

  const dotacion = uM(() => {
    if (!corridaMO) return null;
    return simularDotacion({
      manoObra: corridaMO.manoObra,
      personal: personalHook.data || [],
      partidas: partidasHook.data || [],
      jornada: params.jornada,
      contarSubcontratos: params.contarSubcontratos,
    });
  }, [corridaMO, personalHook.data, partidasHook.data, params.jornada, params.contarSubcontratos]);

  const decorado = uM(
    () => aplicarEscenario(corrida || { propuestas: [], sobres: [] }, escenario),
    [corrida, escenario]
  );

  const entregable = uM(() => lineasAceptadas(decorado), [decorado]);

  // Los proveedores candidatos: las empresas del grupo primero (son las que
  // facturan adentro) y después el catálogo, alfabético.
  //
  // Las empresas traen `rubro`; los 549 del catálogo NO —`proveedores` no
  // tiene esa columna (verificado el 22-set-2026)—. Por eso acá no se ordena
  // por rubro: lo haría para 28 de 577 y parecería una recomendación cuando
  // en realidad no lo es. El matching del §6 (rubro + historial de precios)
  // es de la tanda 4, y va a necesitar esa columna o salir del historial.
  const candidatos = uM(() => {
    const grupo = [], catalogo = [];
    for (const c of (compHook.data || [])) {
      if (c.deleted_at) continue;
      grupo.push({ id: c.id, nombre: c.name || c.legal_name || '(sin nombre)', rubro: c.rubro || null, grupo: true });
    }
    for (const p of proveedores) {
      catalogo.push({ id: p.id, nombre: p.razon_social || p.nombre || '(sin nombre)', ruc: p.ruc || '', grupo: false });
    }
    const porNombre = (a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es');
    return [...grupo.sort(porNombre), ...catalogo.sort(porNombre)];
  }, [compHook.data, proveedores]);

  // Escribir el nombre tiene que poder resolverse al id. Si no está en la
  // lista se guarda igual, solo con el nombre: el catálogo no tiene a todos y
  // obligar a elegir dejaría sin proveedor justo a los casos nuevos.
  const resolverProveedor = uC((texto) => {
    const t = String(texto || '').trim();
    if (!t) return { id: null, nombre: '' };
    const hit = candidatos.find(c => c.nombre.toLowerCase() === t.toLowerCase());
    return hit ? { id: hit.id, nombre: hit.nombre } : { id: null, nombre: t };
  }, [candidatos]);

  const propuestasVisibles = uM(() => {
    const q = busca.trim().toLowerCase();
    return (decorado.propuestas || []).filter(p => {
      if (soloPendientes && p.estado !== 'pendiente' && p.estado !== 'parcial') return false;
      if (!q) return true;
      if (p.titulo.toLowerCase().includes(q)) return true;
      return p.lineas.some(l => `${l.nombre} ${l.insumo_codigo || ''}`.toLowerCase().includes(q));
    });
  }, [decorado.propuestas, busca, soloPendientes]);

  const porPeriodo = uM(() => {
    const m = new Map();
    for (const p of propuestasVisibles) {
      const g = m.get(p.periodo) || { periodo: p.periodo, etiqueta: p.etiquetaPeriodo, propuestas: [], monto: 0, aceptado: 0 };
      g.propuestas.push(p);
      g.monto += num(p.montoEditado);
      g.aceptado += num(p.montoAceptado);
      m.set(p.periodo, g);
    }
    return [...m.values()].sort((a, b) => (a.periodo < b.periodo ? -1 : 1));
  }, [propuestasVisibles]);

  // ── Mutaciones del escenario (se autoguardan) ─────────────────────
  // Autosave y no un botón «Guardar»: lo que se pierde acá son decisiones de
  // una por una, y perderlas por cerrar la pestaña obliga a rehacer el
  // trabajo entero. El botón que sí existe es «Guardar como…», que es otra
  // cosa: duplicar el escenario para comparar.
  const mutar = uC((fn) => {
    const actual = escRef.current;
    if (!actual) return;
    const nuevo = fn(actual);
    escRef.current = nuevo;
    setEscenario(nuevo);
    setEscenarios(guardarEscenario(obraId, nuevo));
  }, [obraId]);

  const cambiarParam = (patch) => mutar(e => conParams(e, patch));

  const toggleCategoria = (cat) => {
    const actuales = new Set(params.categorias);
    if (actuales.has(cat)) actuales.delete(cat); else actuales.add(cat);
    cambiarParam({ categorias: [...actuales] });
  };

  const elegirEscenario = (id) => {
    const e = escenarios.find(x => x.id === id);
    if (!e) return;
    escRef.current = e;
    setEscenario(e);
    setAbiertos(new Set());
  };

  const duplicarEscenario = () => {
    const base = escRef.current;
    if (!base) return;
    const nombre = (window.prompt?.('Nombre del escenario nuevo:', `${base.nombre} (copia)`) || '').trim();
    if (!nombre) return;
    const copia = { ...nuevoEscenario({ nombre, obraId, params: base.params }), decisiones: base.decisiones, ediciones: base.ediciones, sobres: base.sobres };
    const lista = guardarEscenario(obraId, copia);
    setEscenarios(lista);
    escRef.current = copia;
    setEscenario(copia);
    toast(`Escenario «${nombre}» creado`, 'green');
  };

  const renombrarEscenario = () => {
    const base = escRef.current;
    if (!base) return;
    const nombre = (window.prompt?.('Nuevo nombre:', base.nombre) || '').trim();
    if (!nombre) return;
    mutar(e => ({ ...e, nombre }));
  };

  const eliminarEscenario = () => {
    const base = escRef.current;
    if (!base) return;
    if (!window.confirm?.(`¿Borrar el escenario «${base.nombre}»? Se pierden sus decisiones y correcciones.`)) return;
    let lista = borrarEscenario(obraId, base.id);
    if (!lista.length) lista = guardarEscenario(obraId, nuevoEscenario({ nombre: 'Escenario base', obraId }));
    setEscenarios(lista);
    escRef.current = lista[0];
    setEscenario(lista[0]);
  };

  const toggleAbierto = (id) => setAbiertos(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // Anti doble-click (regla crítica 2): ref SÍNCRONO. La descarga arma un
  // Blob y dispara un click; dos clicks en la misma ventana bajan dos veces
  // el mismo archivo con nombres distintos.
  const exportarCsv = async () => {
    if (exportRef.current) return;
    if (!entregable.lineas.length) { toast('Todavía no hay ninguna línea aceptada', 'amber'); return; }
    exportRef.current = true;
    try {
      const cab = ['periodo', 'orden', 'categoria', 'codigo', 'descripcion', 'unidad', 'cantidad', 'precio_unitario', 'monto', 'proveedor', 'nota'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const filas = entregable.lineas.map(l => [
        l.etiquetaPeriodo, l.propuesta_id, SUBCATEGORIA_LABEL[l.subcategoria] || l.subcategoria,
        l.insumo_codigo || '', l.descripcion, l.unidad, l.cantidad, l.precio_unitario, l.monto,
        l.proveedor_nombre || '', l.nota || '',
      ].map(esc).join(';'));
      const csv = `﻿${cab.join(';')}\n${filas.join('\n')}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plan-ordenes-${(escenario?.nombre || 'escenario').replace(/[^\w-]+/g, '_')}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`${entregable.lineas.length} línea(s) exportadas`, 'green');
    } finally { exportRef.current = false; }
  };

  const cargando = obrasHook.loading || ipHook.loading || partidasHook.loading;
  const resumen = corrida?.resumen || null;
  const dec = decorado.resumen;

  if (!obraId) {
    return window.SinObraEmpty ? <window.SinObraEmpty icon="calendar" /> : <div className="card card-p">Elegí un trabajo.</div>;
  }

  return (
    <div>
      {/* ── ESCENARIO Y OBRA ───────────────────────────────────────── */}
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <select className="fi" style={{ maxWidth: 360 }} value={obraId} onChange={e => setObraId(e.target.value)}>
            {obras.map(o => <option key={o.id} value={o.id}>{o.nombre_obra || o.nombre}</option>)}
          </select>
          <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Escenario:</span>
          <select className="fi" style={{ maxWidth: 260 }} value={escenario?.id || ''} onChange={e => elegirEscenario(e.target.value)}>
            {escenarios.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <button className="btn btn-sm btn-ghost" onClick={duplicarEscenario} title="Copiar este escenario con sus decisiones, para comparar otra combinación">
            <JxIcon name="copy" size={13} /> Guardar como…
          </button>
          <button className="btn btn-sm btn-ghost" onClick={renombrarEscenario}><JxIcon name="edit" size={13} /> Renombrar</button>
          <button className="btn btn-sm btn-ghost" onClick={eliminarEscenario}><JxIcon name="trash" size={13} /> Borrar</button>
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => setPanelParams(v => !v)}>
            <JxIcon name={panelParams ? 'chevU' : 'chevD'} size={13} /> Parámetros
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '10px 0 0' }}>
          {titular
            ? <>Las órdenes de este trabajo las emite <b>{titular.name || titular.legal_name}</b> — la entidad que lo ejecuta.</>
            : <>⚠ Este trabajo no tiene una ejecutora declarada. El plan se arma igual, pero la orden solo la puede emitir la ejecutora: cargala en Consorcios.</>}
          {' '}Lo que decidas acá <b>queda guardado en este navegador</b> y no escribe nada todavía.
        </p>
      </div>

      {/* ── LOS CUATRO EJES DE LA CORRIDA (§3) ──────────────────────── */}
      {panelParams && (
        <div className="card card-p" style={{ marginBottom: 12, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <label style={{ display: 'block' }}>
              <span className="flabel">Desde cuándo se planifica</span>
              <select className="fi" value={params.anclaje} onChange={e => cambiarParam({ anclaje: e.target.value })}>
                {ANCLAJES.map(a => <option key={a} value={a}>{ANCLAJE_LABEL[a]}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span className="flabel">De dónde salen las fechas</span>
              <select className="fi" value={params.cronograma} onChange={e => cambiarParam({ cronograma: e.target.value })}>
                {CRONOGRAMAS.map(c => <option key={c} value={c}>{CRONOGRAMA_LABEL[c]}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span className="flabel">Cómo se reparte un tramo largo</span>
              <select className="fi" value={params.reparto} onChange={e => cambiarParam({ reparto: e.target.value })}>
                {REPARTOS.map(r => <option key={r} value={r}>{REPARTO_LABEL[r]}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span className="flabel">Período</span>
              <select className="fi" value={params.granularidad} onChange={e => cambiarParam({ granularidad: e.target.value })}>
                {GRANULARIDADES.map(g => <option key={g} value={g}>{g === 'mes' ? 'Mes a mes' : 'Semana a semana'}</option>)}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <span className="flabel">Pedir con cuántos días de anticipación</span>
              <input className="fi" type="number" min="0" max="365" value={params.anticipacionDias}
                onChange={e => cambiarParam({ anticipacionDias: e.target.value })} />
            </label>
            <label style={{ display: 'block' }}>
              <span className="flabel">Un tramo es «largo» a partir de</span>
              <input className="fi" type="number" min="1" value={params.umbralTramoLargoDias}
                onChange={e => cambiarParam({ umbralTramoLargoDias: e.target.value })} />
            </label>
          </div>

          <div>
            <span className="flabel">Qué se incluye</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {CATEGORIAS_SIMULADOR.filter(c => c !== 'mano_obra').map(c => (
                <button key={c} className={`btn btn-sm ${params.categorias.includes(c) ? 'btn-amber' : 'btn-ghost'}`}
                  onClick={() => toggleCategoria(c)}>
                  {CATEGORIA_SIMULADOR_LABEL[c]}
                </button>
              ))}
              <span style={{ fontSize: 11, color: 'var(--tm)', alignSelf: 'center', marginLeft: 6 }}>
                La mano de obra no se compra: va en su propia pestaña.
              </span>
            </div>
          </div>

          {/* El reparto por cuadrilla y el manual necesitan un dato que hoy no
              existe en ningún lado. El motor devuelve esas líneas por
              «Sin planificar» con su motivo — nunca un «parejo» de consuelo. */}
          {(params.reparto === 'cuadrilla' || params.reparto === 'manual') && (
            <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: 0 }}>
              ⚠ «{REPARTO_LABEL[params.reparto]}» necesita un dato que todavía no se carga en la app
              ({params.reparto === 'cuadrilla' ? 'cuántas personas entran y cuándo' : 'el reparto fijado partida por partida'}).
              Mientras no esté, esas líneas salen en <b>Sin planificar</b> con el motivo, en vez de repartirse a ojo.
            </p>
          )}
        </div>
      )}

      {/* ── LA COBERTURA, CONTRA EL COMPRABLE (§2) ──────────────────── */}
      {resumen && (
        <div className="card card-p" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Presupuesto comprable</div>
              <b style={{ fontSize: 16 }}>{solesK(resumen.montoComprable)}</b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                de {solesK(resumen.montoPresupuesto)} · {solesK(resumen.montoManoObra)} es planilla
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Planificado por el simulador</div>
              <b style={{ fontSize: 16 }}>{solesK(resumen.montoPlanificado)}</b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{resumen.propuestas} órdenes · {resumen.sobres} sobres</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Aceptado en este escenario</div>
              <b style={{ fontSize: 16, color: dec.montoAceptadoTotal > 0 ? 'var(--green)' : 'var(--tm)' }}>
                {solesK(dec.montoAceptadoTotal)}
              </b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                {dec.lineasAceptadas} línea(s) · {dec.ordenesAceptadas + dec.ordenesParciales} orden(es)
              </div>
            </div>
            {dec.desvio !== 0 && (
              <div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>Desvío sobre el expediente</div>
                <b style={{ fontSize: 16, color: dec.desvio > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {dec.desvio > 0 ? '+' : ''}{solesK(dec.desvio)}
                </b>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{dec.lineasEditadas} línea(s) corregidas a mano</div>
              </div>
            )}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--tm)' }}>
              <span>Cobertura del presupuesto comprable</span><span>{pct(resumen.cobertura)}</span>
            </div>
            <div style={{ marginTop: 4, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${Math.min(100, Math.round((resumen.montoComprable > 0 ? dec.montoAceptadoTotal / resumen.montoComprable : 0) * 100))}%`, background: 'var(--green)' }} />
              <div style={{ width: `${Math.max(0, Math.round(resumen.cobertura * 100) - Math.round((resumen.montoComprable > 0 ? dec.montoAceptadoTotal / resumen.montoComprable : 0) * 100))}%`, background: 'var(--amber)' }} />
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 4 }}>
              Verde = aceptado · ámbar = propuesto sin decidir. La barra va contra lo COMPRABLE, no contra el presupuesto
              total: la planilla no se cubre con órdenes.
            </div>
          </div>
        </div>
      )}

      {/* ── LO QUE NO SE PUEDE SABER, DICHO ─────────────────────────── */}
      {resumen && resumen.ocSinImputar.lineas > 0 && (
        <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)' }}>
          <b>{resumen.ocSinImputar.lineas} línea(s) ya ordenadas ({solesK(resumen.ocSinImputar.monto)}) no se pudieron descontar.</b>
          <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
            No tienen código de insumo, así que no hay contra qué línea del presupuesto restarlas. El plan de abajo
            puede estar pidiendo de nuevo algo que ya se pidió. El simulador prefiere decirlo antes que descontar
            a ojo — cuando esas órdenes tengan código imputado, el descuento empieza a funcionar solo.
          </p>
        </div>
      )}
      {resumen && resumen.descontado.insumos > 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '0 0 12px' }}>
          Ya se descontaron {resumen.descontado.insumos} insumo(s) por {solesK(resumen.descontado.monto)} que están en
          órdenes vivas: eso no se vuelve a pedir.
        </p>
      )}
      {resumen && resumen.anclaje === 'restante' && resumen.montoOmitidoPorPasado > 0 && (
        <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: '0 0 12px' }}>
          ⚠ Se dejaron afuera {solesK(resumen.montoOmitidoPorPasado)} de períodos ya vencidos. Con «Desde hoy» se
          arrastran al período actual en vez de desaparecer.
        </p>
      )}
      {resumen && resumen.anclaje === 'cero' && (
        <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: '0 0 12px' }}>
          ⚠ Estás en modo auditoría: se reconstruye qué DEBIÓ comprarse desde el inicio del expediente, sin restar
          nada de lo ya comprado. Sirve para revisar, no para emitir.
        </p>
      )}

      {/* ── PESTAÑAS ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {[
          ['ordenes', `📦 Órdenes propuestas (${decorado.propuestas.length})`],
          ['sobres', `🧧 Sobres sin detalle (${decorado.sobres.length})`],
          ['dotacion', '👷 Mano de obra (referencia)'],
          ['pendientes', `⚠ Sin planificar (${corrida?.pendientes.length || 0})`],
        ].map(([id, lbl]) => (
          <button key={id} className={`btn btn-sm ${vista === id ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setVista(id)}>{lbl}</button>
        ))}
      </div>

      {cargando && <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Cargando el presupuesto…</div>}

      {/* Los 577 proveedores, UNA sola vez para toda la pantalla. */}
      <datalist id={DATALIST_PROVEEDORES}>
        {candidatos.map(c => (
          <option key={c.id} value={c.nombre}>{c.grupo ? `empresa del grupo${c.rubro ? ` · ${rubroLabel(c.rubro)}` : ''}` : (c.ruc || 'proveedor')}</option>
        ))}
      </datalist>

      {/* ═══ ÓRDENES ═══════════════════════════════════════════════ */}
      {!cargando && vista === 'ordenes' && (
        <>
          <div className="card card-p" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <input className="fi" style={{ maxWidth: 280 }} placeholder="Buscar insumo, código o título…" value={busca} onChange={e => setBusca(e.target.value)} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} />
              Solo lo que falta decidir
            </label>
            <span style={{ fontSize: 11.5, color: 'var(--tm)', marginLeft: 'auto' }}>
              {dec.ordenesAceptadas} aceptadas · {dec.ordenesParciales} parciales · {dec.ordenesRechazadas} rechazadas · {dec.ordenesPendientes} sin decidir
            </span>
          </div>

          {porPeriodo.length === 0 ? (
            <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)', padding: 24 }}>
              {(corrida?.propuestas.length || 0) === 0
                ? 'El motor no armó ninguna orden con estos parámetros. Mirá «Sin planificar» para ver por qué.'
                : 'Ninguna orden coincide con el filtro.'}
            </div>
          ) : porPeriodo.map(g => (
            <div key={g.periodo} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <b style={{ fontSize: 14 }}>{g.etiqueta}</b>
                <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                  {g.propuestas.length} orden(es) · {solesK(g.monto)}
                  {g.aceptado > 0 && <span style={{ color: 'var(--green)' }}> · {solesK(g.aceptado)} aceptado</span>}
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button className="btn btn-sm btn-ghost" title="Aceptar todas las órdenes de este tramo"
                    onClick={() => mutar(e => decidirPeriodo(e, g.periodo, 'aceptada', decorado.propuestas))}>
                    <JxIcon name="check" size={12} /> Aceptar el tramo
                  </button>
                  <button className="btn btn-sm btn-ghost"
                    onClick={() => mutar(e => decidirPeriodo(e, g.periodo, 'rechazada', decorado.propuestas))}>
                    <JxIcon name="x" size={12} /> Rechazar
                  </button>
                  <button className="btn btn-sm btn-ghost"
                    onClick={() => mutar(e => decidirPeriodo(e, g.periodo, 'pendiente', decorado.propuestas))}>
                    Limpiar
                  </button>
                </div>
              </div>

              {g.propuestas.map(p => (
                <PropuestaCard
                  key={p.id} p={p}
                  abierta={abiertos.has(p.id)}
                  onToggle={() => toggleAbierto(p.id)}
                  onDecidir={(d) => mutar(e => decidirPropuesta(e, p.id, d))}
                  onDecidirLinea={(l, d) => mutar(e => decidirLinea(e, p.id, l, d))}
                  onEditar={(l, patch) => mutar(e => editarLinea(e, p.id, l, patch))}
                  onLimpiar={(l) => mutar(e => limpiarEdicion(e, p.id, l))}
                  onProveedorOrden={(texto) => {
                    const prov = resolverProveedor(texto);
                    mutar(e => proveedorDePropuesta(e, p.id, p.lineas, prov));
                  }}
                  resolverProveedor={resolverProveedor}
                  editando={editando} setEditando={setEditando}
                  tope={verMas[p.id] || LINEAS_POR_TANDA}
                  onVerMas={() => setVerMas(v => ({ ...v, [p.id]: (v[p.id] || LINEAS_POR_TANDA) + LINEAS_POR_TANDA }))}
                />
              ))}
            </div>
          ))}
        </>
      )}

      {/* ═══ SOBRES ════════════════════════════════════════════════ */}
      {!cargando && vista === 'sobres' && (
        <SobresVista
          sobres={decorado.sobres}
          resolverProveedor={resolverProveedor}
          onDecidir={(clave, d) => mutar(e => decidirSobre(e, clave, d))}
          onAgregar={(clave) => mutar(e => agregarLineaSobre(e, clave, { descripcion: '', unidad: 'und', cantidad: 1, precio: 0 }))}
          onEditar={(clave, id, patch) => mutar(e => editarLineaSobre(e, clave, id, patch))}
          onQuitar={(clave, id) => mutar(e => quitarLineaSobre(e, clave, id))}
          onProveedor={(clave, p) => mutar(e => proveedorDeSobre(e, clave, p))}
        />
      )}

      {/* ═══ MANO DE OBRA ══════════════════════════════════════════ */}
      {!cargando && vista === 'dotacion' && <DotacionVista d={dotacion} params={params} onParam={cambiarParam} />}

      {/* ═══ SIN PLANIFICAR ════════════════════════════════════════ */}
      {!cargando && vista === 'pendientes' && <PendientesVista pendientes={corrida?.pendientes || []} />}

      {/* ── EL PIE: qué pasa con lo aceptado ────────────────────────── */}
      <div className="card card-p" style={{ marginTop: 16, borderLeft: '3px solid var(--blue)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div>
            <b>{entregable.lineas.length} línea(s) aceptadas</b>
            {' '}por <b>{soles(dec.montoAceptadoTotal)}</b>
            {entregable.sinPrecio.length > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                ⚠ {entregable.sinPrecio.length} aceptada(s) sin precio: no se entregan hasta que alguien les ponga uno.
                Un monto inventado en una orden no lo vuelve a mirar nadie.
              </div>
            )}
            {dec.lineasSinProveedor > 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                {dec.lineasSinProveedor} aceptada(s) todavía sin proveedor elegido.
              </div>
            )}
          </div>
          <button className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto' }} onClick={exportarCsv}>
            <JxIcon name="download" size={13} /> Descargar el plan aceptado
          </button>
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '8px 0 0' }}>
          <b>Nada de esto es todavía un documento.</b> Convertir lo aceptado en requisiciones y en órdenes reales —solo
          a nombre de la entidad que ejecuta el trabajo— es el paso que sigue. Hasta entonces el escenario vive en este
          navegador: se puede volver a abrir, comparar contra otro y corregirlo sin que nadie más lo vea.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// UNA ORDEN PROPUESTA
// ═══════════════════════════════════════════════════════════════════

function PropuestaCard({ p, abierta, onToggle, onDecidir, onDecidirLinea, onEditar, onLimpiar, onProveedorOrden, resolverProveedor, editando, setEditando, tope, onVerMas }) {
  const visibles = abierta ? p.lineas.slice(0, tope) : [];
  // El proveedor de la orden es el que tienen TODAS sus líneas. Si hay más de
  // uno (porque alguien pisó una línea suelta) el campo queda vacío y se dice
  // abajo: mostrar uno de los dos haría creer que la orden va entera a él.
  const provsDistintos = [...new Set(p.lineas.map(l => l.proveedor_nombre || ''))];
  const provOrden = provsDistintos.length === 1 ? provsDistintos[0] : '';
  return (
    <div className="card" style={{ marginBottom: 8, borderLeft: `3px solid ${COLOR_DECISION[p.estado]}` }}>
      <div className="card-p" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', cursor: 'pointer' }} onClick={onToggle}>
        <JxIcon name={abierta ? 'chevD' : 'chevR'} size={14} />
        <div style={{ minWidth: 200 }}>
          <b>{p.titulo}</b>
          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
            {p.lineas.length} línea(s)
            {p.lineas.some(l => l.tramoLargo) && ' · con tramo largo repartido'}
            {p.lineas.some(l => l.arrastrado) && ' · incluye atrasado arrastrado'}
            {p.tieneMontoIncompleto && ' · hay líneas sin precio'}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <b>{soles(p.montoEditado)}</b>
          {p.desvio !== 0 && (
            <div style={{ fontSize: 10.5, color: p.desvio > 0 ? 'var(--red)' : 'var(--green)' }}>
              {p.desvio > 0 ? '+' : ''}{soles(p.desvio)} vs. expediente
            </div>
          )}
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: COLOR_DECISION[p.estado], minWidth: 84, textAlign: 'right' }}>
          {ESTADO_LABEL[p.estado]}
          {p.estado === 'parcial' && <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--tm)' }}>{p.lineasAceptadas}/{p.lineas.length}</div>}
        </span>
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <button className={`btn btn-sm ${p.decision === 'aceptada' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => onDecidir('aceptada')} title="Aceptar la orden entera">
            <JxIcon name="check" size={12} />
          </button>
          <button className={`btn btn-sm ${p.decision === 'rechazada' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => onDecidir('rechazada')} title="Rechazar la orden entera">
            <JxIcon name="x" size={12} />
          </button>
        </div>
      </div>

      {abierta && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '10px 12px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>Proveedor de esta orden:</span>
            <input className="fi" list={DATALIST_PROVEEDORES} style={{ maxWidth: 300, fontSize: 12, padding: '4px 8px' }}
              placeholder={provsDistintos.length > 1 ? `${provsDistintos.filter(Boolean).length} proveedores distintos` : 'Buscá por nombre…'}
              defaultValue={provOrden} key={`${p.id}|${provOrden}`}
              onChange={e => onProveedorOrden(e.target.value)} />
            <span style={{ fontSize: 11, color: 'var(--tm)' }}>
              Se aplica a las {p.lineas.length} líneas. Una línea suelta se pisa desde su ✎.
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Insumo</th>
                <th style={{ textAlign: 'right', width: 110 }}>Cantidad</th>
                <th style={{ textAlign: 'right', width: 110 }}>Precio</th>
                <th style={{ textAlign: 'right', width: 120 }}>Monto</th>
                <th style={{ width: 170 }}>Proveedor</th>
                <th style={{ width: 110 }}>Decisión</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map(l => (
                <LineaFila
                  key={l.ref} l={l}
                  enEdicion={editando === l.ref}
                  onEdicion={(v) => setEditando(v ? l.ref : null)}
                  onDecidir={(d) => onDecidirLinea(l, d)}
                  onEditar={(patch) => onEditar(l, patch)}
                  onLimpiar={() => onLimpiar(l)}
                  resolverProveedor={resolverProveedor}
                />
              ))}
            </tbody>
          </table>
          </div>
          {p.lineas.length > visibles.length && (
            <div style={{ padding: 8, textAlign: 'center' }}>
              <button className="btn btn-sm btn-ghost" onClick={onVerMas}>
                Ver más ({p.lineas.length - visibles.length} restantes)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LineaFila({ l, enEdicion, onEdicion, onDecidir, onEditar, onLimpiar, resolverProveedor }) {
  const color = COLOR_DECISION[l.decision];
  return (
    <tr style={{ opacity: l.decision === 'rechazada' ? 0.5 : 1 }}>
      <td className="col-p">
        {enEdicion ? (
          <input className="fi" style={{ fontSize: 12, padding: '3px 6px' }} value={l.nombre}
            onChange={e => onEditar({ nombre: e.target.value })} />
        ) : (
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{l.nombre}</div>
        )}
        <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
          {l.insumo_codigo || 'sin código'} · {l.unidad}
          {l.tramoLargo && <span title="Viene de una partida de tramo largo: esta cantidad es la parte que toca a este período"> · repartido</span>}
          {l.arrastrado && <span style={{ color: 'var(--amber)' }} title="Venía de un período ya vencido y se arrastró acá"> · atrasado</span>}
          {!l.montoConocido && <span style={{ color: 'var(--amber)' }}> · sin precio en el expediente</span>}
          {l.nombre !== l.nombreOriginal && <span style={{ color: 'var(--blue)' }}> · era «{l.nombreOriginal}»</span>}
        </div>
      </td>
      <td style={{ textAlign: 'right' }}>
        {enEdicion ? (
          <input className="fi" type="number" min="0" step="any" style={{ width: 92, padding: '3px 6px', fontSize: 12, textAlign: 'right' }}
            value={l.cantidad} onChange={e => onEditar({ cantidad: e.target.value })} />
        ) : cant(l.cantidad)}
      </td>
      <td style={{ textAlign: 'right' }}>
        {enEdicion ? (
          <input className="fi" type="number" min="0" step="any" style={{ width: 92, padding: '3px 6px', fontSize: 12, textAlign: 'right' }}
            value={l.precio_unitario ?? ''} placeholder="sin precio"
            onChange={e => onEditar({ precio_unitario: e.target.value })} />
        ) : (l.precio_unitario == null ? <span style={{ color: 'var(--amber)' }}>—</span> : cant(l.precio_unitario))}
        {l.precioOriginal != null && l.precio_unitario !== l.precioOriginal && (
          <div style={{ fontSize: 10, color: 'var(--tm)' }}>expediente: {cant(l.precioOriginal)}</div>
        )}
      </td>
      <td style={{ textAlign: 'right', fontWeight: 600 }}>
        {l.montoConocido ? soles(l.monto) : <span style={{ color: 'var(--amber)' }} title="El expediente no trae precio para esta línea">sin monto</span>}
        {l.desvio !== 0 && l.montoConocido && (
          <div style={{ fontSize: 10, color: l.desvio > 0 ? 'var(--red)' : 'var(--green)' }}>
            {l.desvio > 0 ? '+' : ''}{soles(l.desvio)}
          </div>
        )}
      </td>
      <td style={{ fontSize: 11.5 }}>
        {enEdicion ? (
          <input className="fi" list={DATALIST_PROVEEDORES} style={{ fontSize: 11.5, padding: '3px 6px' }}
            placeholder="solo para esta línea" defaultValue={l.proveedor_nombre || ''}
            onChange={e => {
              const prov = resolverProveedor(e.target.value);
              onEditar({ proveedor_id: prov.id, proveedor_nombre: prov.nombre || null });
            }} />
        ) : (l.proveedor_nombre || <span style={{ color: 'var(--tm)' }}>— sin proveedor —</span>)}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
          <button className={`btn btn-sm ${l.decision === 'aceptada' ? 'btn-amber' : 'btn-ghost'}`}
            style={{ padding: '2px 6px' }} title="Aceptar esta línea" onClick={() => onDecidir(l.decision === 'aceptada' ? 'pendiente' : 'aceptada')}>
            <JxIcon name="check" size={11} />
          </button>
          <button className={`btn btn-sm ${l.decision === 'rechazada' ? 'btn-amber' : 'btn-ghost'}`}
            style={{ padding: '2px 6px' }} title="Rechazar esta línea" onClick={() => onDecidir(l.decision === 'rechazada' ? 'pendiente' : 'rechazada')}>
            <JxIcon name="x" size={11} />
          </button>
          <button className={`btn btn-sm ${enEdicion ? 'btn-amber' : 'btn-ghost'}`} style={{ padding: '2px 6px' }}
            title="Corregir descripción, cantidad o precio" onClick={() => onEdicion(!enEdicion)}>
            <JxIcon name="edit" size={11} />
          </button>
          {l.editada && (
            <button className="btn btn-sm btn-ghost" style={{ padding: '2px 6px' }} title="Volver a los valores del expediente" onClick={onLimpiar}>
              <JxIcon name="refresh" size={11} />
            </button>
          )}
        </div>
        <div style={{ fontSize: 10, color, marginTop: 2 }}>
          {ESTADO_LABEL[l.decision]}{l.decisionHeredada && l.decision !== 'pendiente' ? ' (de la orden)' : ''}
        </div>
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SOBRES (§4.1): un techo de plata, no una lista de insumos
// ═══════════════════════════════════════════════════════════════════

function SobresVista({ sobres, resolverProveedor, onDecidir, onAgregar, onEditar, onQuitar, onProveedor }) {
  if (!sobres.length) {
    return (
      <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)', padding: 24 }}>
        Este presupuesto no tiene partidas-sobre con estos parámetros.
      </div>
    );
  }
  return (
    <>
      <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--blue)' }}>
        <b>Un sobre es un monto reservado sin decir qué se compra.</b>
        <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
          «HERRAMIENTAS MANUALES» y los globales sueltos (movilización, tijeral) no traen lista de insumos: el
          expediente aparta una plata y después se compra contra ella, como una caja chica con tope. Acá se le escribe
          la orden a mano —3 combas, 5 picos— y la pantalla muestra cuánto del sobre queda.
        </p>
      </div>
      {sobres.map(s => (
        <div key={s.clave} className="card" style={{ marginBottom: 10, borderLeft: `3px solid ${COLOR_DECISION[s.decision]}` }}>
          <div className="card-p" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <div style={{ minWidth: 220 }}>
              <b>{s.nombre}</b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                {s.unidad} · en {s.enPartidas} partida(s) · {SUBCATEGORIA_LABEL[s.subcategoria] || s.subcategoria}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Techo del sobre</div>
              <b>{soles(s.techo)}</b>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Escrito acá</div>
              <b>{soles(s.usado)}</b>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--tm)' }}>Queda</div>
              <b style={{ color: s.excedido ? 'var(--red)' : 'var(--green)' }}>{soles(s.restante)}</b>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button className={`btn btn-sm ${s.decision === 'aceptada' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => onDecidir(s.clave, s.decision === 'aceptada' ? 'pendiente' : 'aceptada')}>
                <JxIcon name="check" size={12} /> Aceptar
              </button>
              <button className={`btn btn-sm ${s.decision === 'rechazada' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => onDecidir(s.clave, s.decision === 'rechazada' ? 'pendiente' : 'rechazada')}>
                <JxIcon name="x" size={12} />
              </button>
            </div>
          </div>

          {!s.techoFirme && (
            <p style={{ fontSize: 11.5, color: 'var(--amber)', margin: '0 12px 10px' }}>
              ⚠ Nadie informó todavía cuánto de este sobre ya se gastó, así que «queda» se calcula contra el techo
              entero. Creerlo intacto cuando ya se usó la mitad es exactamente el doble gasto que hay que evitar.
            </p>
          )}
          {s.excedido && (
            <p style={{ fontSize: 11.5, color: 'var(--red)', margin: '0 12px 10px' }}>
              ⚠ Lo escrito se pasa del techo del sobre. No se bloquea —el expediente puede quedarse corto— pero queda dicho.
            </p>
          )}

          <div style={{ padding: '0 12px 12px' }}>
            {s.lineas.length > 0 && (
              <table className="tbl" style={{ marginBottom: 8 }}>
                <thead>
                  <tr>
                    <th>Qué se compra</th>
                    <th style={{ width: 80 }}>Unidad</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Cantidad</th>
                    <th style={{ width: 100, textAlign: 'right' }}>Precio</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Monto</th>
                    <th style={{ width: 40 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {s.lineas.map(l => (
                    <tr key={l.id}>
                      <td><input className="fi" style={{ fontSize: 12, padding: '3px 6px' }} placeholder="ej. 3 combas de 4 lb"
                        value={l.descripcion} onChange={e => onEditar(s.clave, l.id, { descripcion: e.target.value })} /></td>
                      <td><input className="fi" style={{ fontSize: 12, padding: '3px 6px' }} value={l.unidad}
                        onChange={e => onEditar(s.clave, l.id, { unidad: e.target.value })} /></td>
                      <td><input className="fi" type="number" min="0" step="any" style={{ fontSize: 12, padding: '3px 6px', textAlign: 'right' }}
                        value={l.cantidad} onChange={e => onEditar(s.clave, l.id, { cantidad: e.target.value })} /></td>
                      <td><input className="fi" type="number" min="0" step="any" style={{ fontSize: 12, padding: '3px 6px', textAlign: 'right' }}
                        value={l.precio} onChange={e => onEditar(s.clave, l.id, { precio: e.target.value })} /></td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{soles(l.monto)}</td>
                      <td>
                        <button className="btn btn-sm btn-ghost" style={{ padding: '2px 6px' }} onClick={() => onQuitar(s.clave, l.id)}>
                          <JxIcon name="trash" size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => onAgregar(s.clave)}>
                <JxIcon name="plus" size={12} /> Agregar una línea
              </button>
              <input className="fi" list={DATALIST_PROVEEDORES} style={{ maxWidth: 280, fontSize: 11.5, padding: '3px 6px' }}
                placeholder="Proveedor del sobre…" defaultValue={s.proveedor_nombre || ''}
                onChange={e => onProveedor(s.clave, resolverProveedor(e.target.value))} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MANO DE OBRA: los dos sentidos, SOLO como referencia (§5)
// ═══════════════════════════════════════════════════════════════════

function DotacionVista({ d, params, onParam }) {
  const plan = uM(() => (d ? planDeContratacion(d) : []), [d]);
  if (!d) return <div className="card card-p" style={{ textAlign: 'center', color: 'var(--tm)' }}>Calculando…</div>;

  const { resumen, periodos, cargos, padron, sinCargo } = d;
  return (
    <>
      <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--blue)' }}>
        <b>Esto NO genera ningún registro.</b>
        <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
          No da de alta a nadie, no le pide gente a RRHH y no emite ninguna orden: es el número de referencia para
          comparar lo que pide el cronograma contra la gente que hay. La oferta sale del <b>padrón</b> (cuánta gente
          está cargada), no de horas realmente trabajadas — la asistencia todavía no tiene filas contra las cuales medir.
        </p>
      </div>

      <div className="card card-p" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
        <label style={{ fontSize: 12 }}>
          <span className="flabel">Horas por día</span>
          <input className="fi" type="number" min="1" max="24" style={{ width: 80 }}
            value={params.jornada.horasPorDia}
            onChange={e => onParam({ jornada: { ...params.jornada, horasPorDia: e.target.value } })} />
        </label>
        <label style={{ fontSize: 12 }}>
          <span className="flabel">Rendimiento efectivo</span>
          <input className="fi" type="number" min="0.1" max="1" step="0.05" style={{ width: 80 }}
            value={params.jornada.factorEfectivo}
            onChange={e => onParam({ jornada: { ...params.jornada, factorEfectivo: e.target.value } })} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={params.contarSubcontratos}
            onChange={e => onParam({ contarSubcontratos: e.target.checked })} />
          Contar al personal de subcontrato
        </label>
        <span style={{ fontSize: 11, color: 'var(--tm)' }}>
          La capacidad se cuenta por días laborables reales de cada mes (lun-sáb), no con un «208 h/mes» fijo.
        </span>
      </div>

      <div className="card card-p" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 18 }}>
        <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>HH que pide el cronograma</div><b>{cant(resumen.hhRequeridas)}</b></div>
        <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>HH que rinde el padrón</div><b>{cant(resumen.hhDisponibles)}</b></div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--tm)' }}>Cobertura</div>
          <b style={{ color: resumen.cobertura >= 0.95 ? 'var(--green)' : 'var(--red)' }}>{pct(resumen.cobertura)}</b>
        </div>
        <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Personas en el padrón</div><b>{padron.total}</b></div>
      </div>

      {plan.length > 0 && (
        <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--red)' }}>
          <b>Falta gente para cumplir el cronograma.</b>
          <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '4px 0 8px' }}>
            En orden de urgencia. No es un semáforo: en Miraflores la brecha es de un orden de magnitud, no de ajuste fino.
          </p>
          <table className="tbl">
            <thead><tr><th>Período</th><th>Cargo</th><th style={{ textAlign: 'right' }}>Hay</th><th style={{ textAlign: 'right' }}>Faltan</th><th>Buscar desde</th></tr></thead>
            <tbody>
              {plan.slice(0, 40).map((r, i) => (
                <tr key={`${r.periodo}-${r.cargo}-${i}`}>
                  <td>{r.etiquetaPeriodo}</td>
                  <td>{r.label}</td>
                  <td style={{ textAlign: 'right' }}>{r.hayHoy}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>{r.faltan}</td>
                  <td style={{ fontSize: 11.5, color: 'var(--tm)' }}>{r.avisarDesde || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12, overflowX: 'auto' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Período</th><th style={{ textAlign: 'right' }}>Días útiles</th>
              <th style={{ textAlign: 'right' }}>HH pedidas</th><th style={{ textAlign: 'right' }}>Gente necesaria</th>
              <th style={{ textAlign: 'right' }}>Gente disponible</th><th style={{ textAlign: 'right' }}>Brecha</th>
              <th>Qué alcanza</th>
            </tr>
          </thead>
          <tbody>
            {periodos.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--tm)' }}>
                El presupuesto no tiene mano de obra fechada con estos parámetros.
              </td></tr>
            ) : periodos.map(p => (
              <tr key={p.periodo}>
                <td className="col-p">
                  <b>{p.etiquetaPeriodo}</b>
                  {p.periodoParcial && <div style={{ fontSize: 10, color: 'var(--tm)' }}>parcial: cuenta desde hoy</div>}
                </td>
                <td style={{ textAlign: 'right' }}>{p.diasLaborables}</td>
                <td style={{ textAlign: 'right' }}>{cant(p.hhRequeridas)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{cant(p.personasNecesarias)}</td>
                <td style={{ textAlign: 'right' }}>{p.personasDisponibles}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: p.brechaPersonas > 0 ? 'var(--red)' : 'var(--green)' }}>
                  {p.brechaPersonas > 0 ? `faltan ${Math.ceil(p.brechaPersonas)}` : 'cubierto'}
                </td>
                <td style={{ fontSize: 11.5 }}>
                  {p.alcanceDisponible
                    ? <>{p.resumenAlcance.completas} completas · {p.resumenAlcance.parciales} a medias · {p.resumenAlcance.sinGente} sin gente</>
                    : <span style={{ color: 'var(--tm)' }}>sin detalle por partida</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cargos.length > 0 && (
        <div className="card" style={{ marginBottom: 12, overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Cargo</th><th style={{ textAlign: 'right' }}>HH del presupuesto</th><th style={{ textAlign: 'right' }}>Monto</th><th style={{ textAlign: 'right' }}>En el padrón</th><th style={{ textAlign: 'right' }}>Peor brecha</th></tr></thead>
            <tbody>
              {cargos.map(c => (
                <tr key={c.cargo}>
                  <td className="col-p">{c.label}</td>
                  <td style={{ textAlign: 'right' }}>{cant(c.hhRequeridas)}</td>
                  <td style={{ textAlign: 'right' }}>{solesK(c.monto)}</td>
                  <td style={{ textAlign: 'right', color: c.enPadron === 0 ? 'var(--red)' : undefined }}>
                    {c.enPadron === 0 ? 'nadie' : c.enPadron}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {c.maxBrechaPersonas > 0
                      ? <span style={{ color: 'var(--red)' }}>faltan {Math.ceil(c.maxBrechaPersonas)} en {c.maxBrechaPeriodo}</span>
                      : <span style={{ color: 'var(--green)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(padron.sinEncajar.length > 0 || sinCargo.length > 0 || padron.sinFechaIngreso > 0) && (
        <div className="card card-p" style={{ borderLeft: '3px solid var(--amber)' }}>
          <b>Lo que quedó afuera de la cuenta, y por qué.</b>
          <ul style={{ fontSize: 12, color: 'var(--tm)', margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
            {padron.resumenSinEncajar.map(r => (
              <li key={r.motivo}><b>{r.personas}</b> persona(s): {r.label}.</li>
            ))}
            {padron.sinFechaIngreso > 0 && (
              <li><b>{padron.sinFechaIngreso}</b> sin fecha de ingreso cargada. Cuentan igual —están activas hoy—
                pero no se les puede decir desde cuándo.</li>
            )}
            {sinCargo.length > 0 && (
              <li><b>{sinCargo.length}</b> línea(s) de mano de obra ({cant(resumen.hhSinCargo)} HH) cuyo cargo no se
                reconoce. No se reparten entre los cargos conocidos: eso distorsionaría justo la brecha del peón,
                que es la que decide la contratación.</li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LO QUE NO SE PUDO PLANIFICAR — y el motivo de cada línea
// ═══════════════════════════════════════════════════════════════════

function PendientesVista({ pendientes }) {
  const porMotivo = uM(() => {
    const m = new Map();
    for (const p of pendientes) {
      const g = m.get(p.motivo) || { motivo: p.motivo, lineas: [], monto: 0 };
      g.lineas.push(p); g.monto += num(p.monto);
      m.set(p.motivo, g);
    }
    return [...m.values()].sort((a, b) => b.monto - a.monto);
  }, [pendientes]);

  if (!pendientes.length) {
    return (
      <div className="card card-p" style={{ textAlign: 'center', color: 'var(--green)', padding: 24 }}>
        Todas las líneas del presupuesto se pudieron ubicar en un período.
      </div>
    );
  }
  return (
    <>
      <div className="card card-p" style={{ marginBottom: 12, borderLeft: '3px solid var(--amber)' }}>
        <b>Estas líneas no entraron al plan, y acá está el motivo de cada una.</b>
        <p style={{ fontSize: 12, color: 'var(--tm)', margin: '6px 0 0' }}>
          El motor no las reparte «parejo» para que el total cierre: una línea que dice «no sé cuándo» se arregla; una
          repartida a ojo se pierde entre las buenas y nadie la vuelve a mirar.
        </p>
      </div>
      {porMotivo.map(g => (
        <div key={g.motivo} className="card" style={{ marginBottom: 10 }}>
          <div className="card-p" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <b>{MOTIVO_PENDIENTE_LABEL[g.motivo] || g.motivo}</b>
            <span style={{ fontSize: 11.5, color: 'var(--tm)', marginLeft: 'auto' }}>
              {g.lineas.length} línea(s) · {solesK(g.monto)}
            </span>
          </div>
          <div style={{ overflowX: 'auto', borderTop: '1px solid var(--border)' }}>
            <table className="tbl">
              <thead><tr><th>Insumo</th><th>Categoría</th><th style={{ textAlign: 'right' }}>Cantidad</th><th style={{ textAlign: 'right' }}>Monto</th></tr></thead>
              <tbody>
                {g.lineas.slice(0, 50).map((l, i) => (
                  <tr key={`${l.insumo_codigo || l.nombre}-${i}`}>
                    <td className="col-p">
                      <div style={{ fontSize: 12.5 }}>{l.nombre}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>{l.insumo_codigo || 'sin código'} · {l.unidad}</div>
                    </td>
                    <td style={{ fontSize: 11.5 }}>{SUBCATEGORIA_LABEL[l.subcategoria] || l.subcategoria}</td>
                    <td style={{ textAlign: 'right' }}>{cant(l.cantidad)}</td>
                    <td style={{ textAlign: 'right' }}>{soles(l.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {g.lineas.length > 50 && (
              <div style={{ padding: 8, fontSize: 11.5, color: 'var(--tm)', textAlign: 'center' }}>
                …y {g.lineas.length - 50} más con el mismo motivo.
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

window.SimuladorOrdenesPage = SimuladorOrdenesPage;
export { SimuladorOrdenesPage };
export default SimuladorOrdenesPage;
