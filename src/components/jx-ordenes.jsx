// ═══════════════════════════════════════════════════════════════════
// JARVEX — ÓRDENES DE COMPRA Y DE SERVICIO (tanda 5, B2 + B3).
//
// Gabriel, 4-sep-2026, probando la tanda 3 en producción:
//   «no encuentro las órdenes de compra ni las de servicio, y las necesito
//    para respaldar las compras de la obra actual».
//
// POR QUÉ ESTA PANTALLA EXISTE SI YA HAY UNA DE ÓRDENES DE COMPRA:
// `jx-compras.jsx` tiene el circuito de LOGÍSTICA — requisición → OC →
// recepción — y vive dentro del desglose de un trabajo. Está bien donde
// está, pero es un flujo de almacén: se entra por «pedir material», no por
// «respaldar una factura». Gabriel fue a buscarlas a la CONTABILIDAD, que es
// donde se necesita el papel, y ahí no había nada.
//
// Esto es el REGISTRO DOCUMENTAL de la empresa: todas sus órdenes emitidas
// (de compra y de servicio), y la puerta para emitir las que faltan. Las dos
// pantallas leen la MISMA tabla `ordenes_compra`.
//
// LA PESTAÑA QUE JUSTIFICA LA TANDA — «Sin respaldo»:
// medido el 4-sep contra producción, con el umbral de S/ 2.000 que propuso
// Gabriel, 200 de 1.205 comprobantes de compra (el 17% de los papeles)
// concentran S/ 3,91 M — el 97% del dinero. Emitirlas de a una a mano es
// inviable; emitirlas en lote, con la grilla editable antes de confirmar, es
// una tarde. Al emitir se llena `accounting_movements.orden_compra_id`, que
// existe desde la mig 041 con 0 de 1.378 filas usadas.
//
// EL GUARD SÍNCRONO de emitir() no es decorativo: es la regla crítica #2 del
// CLAUDE.md. Un doble click en «Emitir 200 órdenes» con el guard por estado
// duplica el lote entero.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  TIPO_ORDEN_LABEL, textosDeTipo, proximoCodigo, totalesDesdeItems,
  comprobantesSinOrden, agruparPorEmpresa, resumenRespaldo,
  borradorDesdeMovimiento, recalcularBorrador, ordenarParaEmitir,
  UMBRAL_POR_DEFECTO,
  nuevaOrdenBorrador, numerarOrden, pasosDeOrden, estaNumerada,
  formatearCodigo,
} from "../lib/ordenes.js";
import { filtroInicialEmpresa, setEmpresaActivaId } from "../lib/empresa-activa.js";
import { useEmpresaBloqueada } from "../hooks/useEmpresaActiva.js";
import { titularContableDeObra } from "../lib/consorcio.js";
import { itemsDeFactura } from "../lib/cruce-recepcion.js";
import {
  abastecimientoDeObra, buscarEnPresupuesto, buscarComprasDelGrupo, mapeoImplicito,
} from "../lib/abastecimiento.js";
import { resolverMapeos } from "../lib/mapeo-insumos.js";

const { useState: uS, useMemo: uM, useEffect: uE, useRef: uR } = React;
const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);
const Modal = (p) => (window.Modal ? <window.Modal {...p} /> : null);

const cantF = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSk = (n) => {
  const v = Number(n || 0);
  if (v >= 1e6) return 'S/ ' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return 'S/ ' + (v / 1e3).toFixed(0) + 'K';
  return 'S/ ' + v.toFixed(0);
};

const ESTADO_BADGE = {
  borrador: 'b-gray', por_confirmar: 'b-amber', firmada: 'b-blue', enviada: 'b-blue',
  aceptada: 'b-green', recibida_parcial: 'b-amber', recibida: 'b-green',
  anulada: 'b-red', cancelada: 'b-red',
};
const ESTADO_LABEL = {
  borrador: 'Borrador', por_confirmar: 'Por confirmar', firmada: 'Firmada', enviada: 'Enviada',
  aceptada: 'Aceptada', recibida_parcial: 'Recibida parcial', recibida: 'Recibida',
  anulada: 'Anulada', cancelada: 'Anulada',
};
const ANULADA = new Set(['anulada', 'cancelada']);

function OrdenesPage({ showToast }) {
  const toast = showToast || window.__showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol || '';
  const userId = auth?.profile?.id ?? 'offline';
  const isAdmin = rol === 'admin';
  const canEmitir = isAdmin || rol === 'contador' || rol === 'gerente'
    || (window.__hasPerm?.(rol, 'Órdenes de Compra', 'w') ?? false);

  const { data: companies } = window.__hooks.useCompanies();
  const { data: movs } = window.__hooks.useAccountingMovements();
  const { data: obras } = window.__hooks.useObras();
  const { data: cfg } = window.__hooks.useAppConfig();
  const { data: consorcios } = window.__hooks.useConsorcios();
  const { data: insumosPartida } = window.__hooks.useInsumosPartida(window.__plano === 'obra' ? (window.__getObraActivaId?.() || null) : null);
  const { data: insumoMapeos } = window.__hooks.useInsumoMapeos();
  const resolverConfig = window.__hooks.resolverConfig;

  // ── Estado (TODOS los hooks antes de cualquier return: regla #3) ──
  const [ordenes, setOrdenes] = uS([]);
  const [proveedores, setProveedores] = uS([]);
  const [tab, setTab] = uS('emitidas');
  // Dentro de la contabilidad de UNA empresa el selector queda CLAVADO: es la
  // regla de la tanda 2G («netamente y exclusivamente de esa empresa
  // seleccionada»), y una orden mal atribuida se numera en la serie de otro RUC.
  const empresaFija = useEmpresaBloqueada();
  // ÁMBITO DE OBRA (tanda 6). La misma pantalla, abierta desde el workspace de
  // un trabajo, es «las órdenes que respaldan las compras de ESTA obra».
  // No se acota la EMPRESA junto con la obra a propósito: en Miraflores, de
  // 460 comprobantes solo 112 son del titular (CONSORCIO EL INCA) — el resto
  // es la cadena intercompany, y fijar el titular escondería 3 de cada 4.
  // Mismo criterio que Movimientos de esta obra (docs/tanda-2-navegacion.md B1).
  const enObra = window.__plano === 'obra';
  const obraScopeId = enObra ? (() => { try { return window.__getObraActivaId?.() || null; } catch { return null; } })() : null;
  // Dentro de una obra el filtro arranca en TODAS: acotar además por la
  // empresa activa (que puede ser vieja, de la última vez que se entró a un
  // panel de empresa) escondería la mayor parte de la obra sin decir por qué.
  const [filtroEmpresaRaw, setFiltroEmpresa] = uS(() => (enObra ? 'todas' : filtroInicialEmpresa('todas')));
  const filtroEmpresa = empresaFija || filtroEmpresaRaw;
  const [filtroTipo, setFiltroTipo] = uS('todos');
  const [busqueda, setBusqueda] = uS('');
  const [verAnuladas, setVerAnuladas] = uS(false);
  const [borradores, setBorradores] = uS([]);
  const [emitiendo, setEmitiendo] = uS(false);
  const [progreso, setProgreso] = uS(null);
  const [detalle, setDetalle] = uS(null);
  const [detalleItems, setDetalleItems] = uS([]);
  const emitiendoRef = uR(false);
  // ── LA ORDEN QUE NACE ANTES DEL COMPROBANTE (tanda 7, entrega 6c) ──
  //
  // Gabriel, 6-set-2026, después de probar la primera versión: «¿qué pasa si
  // quiero emitir ahorita mismo una orden de compra o una orden de servicio a
  // un tercero, a una empresa que tal vez aún no está dentro del sistema?
  // ¿Cómo lo hago? En esta sección no me permite».
  //
  // Tenía razón: la primera versión SOLO se llenaba viniendo de Abastecimiento,
  // o sea que sin obra y sin presupuesto no había forma de emitir nada. Y el
  // caso más común de una EMPRESA (sin obra) es justamente ése: comprarle a un
  // tercero. Ahora el formulario se abre vacío y se llena a mano; Abastecimiento
  // pasó a ser una AYUDA que agrega líneas, no la puerta de entrada.
  //
  // Su regla, textual: «centrarnos en que una empresa emita una orden de compra
  // o de servicios. Cualquier empresa, la de nuestro grupo o una de terceros. Y
  // en el caso de la obra, lo mismo prácticamente, pero con la ayuda de tener
  // el inventario de las empresas del grupo, y teniendo a la mano también qué
  // es lo que necesita [la obra]».
  const ordenVacia = () => ({
    companyId: '', tipo: 'compra', igvPct: 18,
    // A quién se le compra. Tres formas, porque las tres pasan:
    //   'grupo'      — otra empresa nuestra
    //   'registrado' — un proveedor que ya está en el sistema
    //   'nuevo'      — uno que NO está: se escribe a mano acá mismo
    provModo: 'nuevo', provCompanyId: '', provId: '',
    provNombre: '', provRuc: '', provDireccion: '',
    fecha: '', fechaEntrega: '', lugarEntrega: '', condicionPago: '',
    titulo: '', notas: '', obraId: '', obraDescripcion: '',
    guardarProveedor: false,
  });
  const [nueva, setNueva] = uS(ordenVacia);
  const [lineas, setLineas] = uS([]);
  const setNu = (patch) => setNueva(n => ({ ...n, ...patch }));
  // El ayudante de la obra: 'necesita' (presupuesto) | 'grupo' (stock) | null
  const [ayuda, setAyuda] = uS(null);
  const [verMov, setVerMov] = uS(null);   // id del comprobante a mirar desde «Sin respaldo»
  // ── EL AYUDANTE DE DOS BLOQUES ──────────────────────────────────
  // A la izquierda lo que la obra NECESITA (presupuesto); a la derecha lo que
  // las empresas del grupo YA COMPRARON (texto crudo de las facturas). Ninguna
  // de las dos depende del mapeo: el mapeo es lo que sale de usarlas.
  const [buscaNec, setBuscaNec] = uS('');
  const [buscaGrupo, setBuscaGrupo] = uS('');
  const [lineaFoco, setLineaFoco] = uS(null);   // línea a la que se le asigna el origen
  const creandoRef = uR(false);

  const umbral = uM(() => {
    const v = Number(resolverConfig?.(cfg, 'orden_umbral_monto', UMBRAL_POR_DEFECTO));
    return Number.isFinite(v) && v > 0 ? v : UMBRAL_POR_DEFECTO;
  }, [cfg, resolverConfig]);

  const recargarOrdenes = React.useCallback(async () => {
    try {
      const all = await window.__db.ordenes_compra.toArray();
      setOrdenes(all.filter(o => !o.deleted_at));
    } catch { setOrdenes([]); }
  }, []);

  uE(() => {
    recargarOrdenes();
    window.__db.proveedores.toArray().then(p => setProveedores(p.filter(x => !x.deleted_at))).catch(() => {});
    const on = (e) => { if (!e?.detail?.tabla || e.detail.tabla === 'ordenes_compra') recargarOrdenes(); };
    window.addEventListener('jx_data_changed', on);
    window.addEventListener('jx_sync_pull', recargarOrdenes);
    return () => {
      window.removeEventListener('jx_data_changed', on);
      window.removeEventListener('jx_sync_pull', recargarOrdenes);
    };
  }, [recargarOrdenes]);

  const companyId = filtroEmpresa === 'todas' ? null : filtroEmpresa;
  const lookupCompany = React.useCallback((id) => (companies || []).find(c => c.id === id) || null, [companies]);
  const lookupProv = React.useCallback((id) => (proveedores || []).find(p => p.id === id) || null, [proveedores]);
  const lookupObra = React.useCallback((id) => (obras || []).find(o => o.id === id) || null, [obras]);

  // ── QUIÉN EMITE NO SE PREGUNTA: SE SABE ─────────────────────────
  //
  // Gabriel, 6-set-2026: «empresa que emite la orden, esto de aquí no debería
  // estar preguntándome porque es muy obvio. Si yo ingreso a órdenes de compra
  // desde JARVEX, la empresa que emite obviamente es JARVEX y debería estar
  // limitado a que yo lo haga con JARVEX».
  //
  // Y dentro de una obra, la que emite es la que EJECUTA: «aquí lo que me
  // debería salir es que la orden la está emitiendo la entidad que está
  // ejecutando esta obra, que en este caso es CONSORCIO EL INCA, y eso debería
  // estar bloqueado».
  //
  // Tiene razón por partida doble: además de ser obvio, dejarlo abierto
  // permitía numerar una orden en la serie de OTRO RUC, que es un error que
  // después no se arregla.
  const titularObra = uM(
    () => (obraScopeId ? titularContableDeObra(lookupObra(obraScopeId), consorcios || []) : null),
    [obraScopeId, obras, consorcios] // eslint-disable-line react-hooks/exhaustive-deps
  );
  // La empresa emisora queda FIJA cuando el ámbito la determina.
  const emisoraFija = empresaFija || titularObra || null;

  // «Sin respaldo» sigue el mismo criterio que la pestaña de una empresa: son
  // los comprobantes de ESA empresa. Dentro de una obra, los de su ejecutora —
  // que es lo que Gabriel esperaba ver y no veía (le salían los de GASOMI
  // emitidos por JHEENSEG, que no le tocan a EL INCA respaldar).
  const companyIdRespaldo = emisoraFija || companyId;

  const resumen = uM(
    () => resumenRespaldo(movs || [], ordenes, { umbral, companyId: companyIdRespaldo, obraId: obraScopeId }),
    [movs, ordenes, umbral, companyIdRespaldo, obraScopeId]
  );

  // ── Pestaña 1: las emitidas ─────────────────────────────────────
  const emitidas = uM(() => {
    let f = (ordenes || []).filter(o => !o.deleted_at);
    if (companyId) f = f.filter(o => o.company_id === companyId);
    if (obraScopeId) f = f.filter(o => o.obra_id === obraScopeId);
    if (filtroTipo !== 'todos') f = f.filter(o => (o.tipo || 'compra') === filtroTipo);
    if (!verAnuladas) f = f.filter(o => !ANULADA.has(o.estado));
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(o =>
        (o.codigo || '').toLowerCase().includes(q) ||
        (o.proveedor_nombre || '').toLowerCase().includes(q) ||
        (o.titulo || '').toLowerCase().includes(q));
    }
    return f.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  }, [ordenes, companyId, obraScopeId, filtroTipo, verAnuladas, busqueda]);

  // ── Pestaña 2: lo que falta respaldar ───────────────────────────
  const pendientes = uM(
    () => comprobantesSinOrden(movs || [], ordenes, { umbral, companyId: companyIdRespaldo, obraId: obraScopeId }),
    [movs, ordenes, umbral, companyIdRespaldo, obraScopeId]
  );
  const gruposPendientes = uM(
    () => agruparPorEmpresa(pendientes, companies || []),
    [pendientes, companies]
  );

  // Los borradores se arman al entrar a la pestaña y se conservan mientras se
  // editan: recalcularlos en cada render tiraría abajo lo que la contadora
  // acaba de escribir en la grilla.
  const prepararBorradores = () => {
    const b = pendientes.slice(0, 400).map(m => borradorDesdeMovimiento(m, {
      company: lookupCompany(m.company_id),
      proveedor: lookupProv(m.proveedor_id),
      obra: lookupObra(m.obra_id),
    }));
    setBorradores(b);
  };

  uE(() => {
    if (tab === 'respaldo' && borradores.length === 0 && pendientes.length > 0) prepararBorradores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pendientes.length]);

  // ── LO QUE LLEGA DE ABASTECIMIENTO ──────────────────────────────
  // Ya NO es la puerta: es una de las formas de llenar las líneas. Se lee UNA
  // vez y se limpia el buzón, para que volver a esta pantalla más tarde no
  // reviva un pedido que ya se emitió.
  uE(() => {
    const p = window.__pedidoAbastecimiento;
    if (!p || !p.lineas?.length) return;
    delete window.__pedidoAbastecimiento;
    setTab('nueva');
    setNueva(n => ({
      ...n,
      companyId: p.titular_id || n.companyId,
      obraId: p.obra_id || '',
      obraDescripcion: p.obra_nombre || '',
      fecha: n.fecha || (window.__fecha?.hoyLocal?.() || ''),
      // Viene de un solo proveedor por vez; si trae varios, se toma el primero
      // y las demás líneas quedan igual para que la persona decida.
      provModo: 'grupo',
      provCompanyId: p.lineas[0]?.company_id || '',
    }));
    setLineas(p.lineas.map(l => ({
      key: window.__newId(),
      descripcion: l.nombre, unidad: l.unidad || 'UND',
      cantidad: l.cantidad, precio_unitario: '',
      insumo_codigo: l.insumo_codigo || null,
      origen_company_id: l.company_id || null,
      tope: l.topeDisponible ?? null,
    })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── EL EDITOR DE LÍNEAS ─────────────────────────────────────────
  // El cuadro de abastecimiento alimenta el bloque izquierdo: trae de una vez
  // cuánto pide el presupuesto, cuánto compró la ejecutora y cuánto falta.
  const abastecimiento = uM(() => (obraScopeId ? abastecimientoDeObra({
    insumosPartida: insumosPartida || [],
    movs: movs || [],
    mapeos: resolverMapeos(insumoMapeos || []),
    titularId: titularObra,
    companies: companies || [],
    ordenes,
  }) : { filas: [], resumen: {} }), [obraScopeId, insumosPartida, movs, insumoMapeos, titularObra, companies, ordenes]);

  const sugNecesita = uM(
    () => (obraScopeId ? buscarEnPresupuesto(abastecimiento.filas, buscaNec, { limite: 10 }) : []),
    [obraScopeId, abastecimiento, buscaNec]
  );
  const sugGrupo = uM(() => buscarComprasDelGrupo({
    movs: movs || [], texto: buscaGrupo, companies: companies || [],
    titularId: titularObra, obraId: obraScopeId, limite: 10,
  }), [movs, buscaGrupo, companies, titularObra, obraScopeId]);

  const lineaVacia = () => ({
    key: window.__newId(), descripcion: '', unidad: 'UND',
    cantidad: '', precio_unitario: '', insumo_codigo: null,
    origen_company_id: null, tope: null,
    // Las dos mitades del mapeo implícito: de qué insumo del presupuesto sale
    // la línea, y contra qué descripción de compra se la está cruzando.
    insumo_nombre: null, insumo_unidad: null, origen_descripcion: null, origen_unidad: null,
  });
  const addLinea = () => setLineas(ls => [...ls, lineaVacia()]);
  const setLinea = (key, patch) => setLineas(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const delLinea = (key) => setLineas(ls => ls.filter(l => l.key !== key));
  const addLineas = (nuevas) => setLineas(ls => [...ls, ...nuevas.map(n => ({ ...lineaVacia(), ...n, key: window.__newId() }))]);

  const totalesNueva = uM(() => {
    const items = lineas.map(l => ({ cantidad: l.cantidad, precio_unitario: l.precio_unitario }));
    return totalesDesdeItems(items, { igvPct: Number(nueva.igvPct) });
  }, [lineas, nueva.igvPct]);

  const proveedorDeNueva = uM(() => {
    if (nueva.provModo === 'grupo') {
      const c = lookupCompany(nueva.provCompanyId);
      return { id: null, nombre: c?.name || c?.legal_name || '', ruc: c?.ruc || '', direccion: c?.address || '' };
    }
    if (nueva.provModo === 'registrado') {
      const pv = lookupProv(nueva.provId);
      return { id: nueva.provId || null, nombre: pv?.razon_social || pv?.nombre || '', ruc: pv?.ruc || '', direccion: pv?.direccion || '' };
    }
    return { id: null, nombre: nueva.provNombre.trim(), ruc: nueva.provRuc.trim(), direccion: nueva.provDireccion.trim() };
  }, [nueva, companies, proveedores]);

  const faltaNueva = uM(() => {
    const f = [];
    if (!(emisoraFija || nueva.companyId)) f.push('la empresa que emite');
    if (!proveedorDeNueva.nombre) f.push('a quién se le compra');
    const vivas = lineas.filter(l => String(l.descripcion || '').trim() && Number(l.cantidad) > 0);
    if (!vivas.length) f.push('al menos una línea con descripción y cantidad');
    else if (vivas.some(l => !(Number(l.precio_unitario) > 0))) f.push('el precio de cada línea');
    return f;
  }, [nueva, proveedorDeNueva, lineas, emisoraFija]);

  const limpiarNueva = () => { setNueva(ordenVacia()); setLineas([]); setAyuda(null); };

  // ── CREAR LA ORDEN ──────────────────────────────────────────────
  //
  // Guard SÍNCRONO (regla crítica #2): confirmar consume un correlativo, y un
  // doble click dejaría dos órdenes numeradas para el mismo pedido.
  const crearOrden = async ({ numerar }) => {
    if (creandoRef.current) return;
    if (!canEmitir) { toast('No tienes permiso para emitir órdenes', 'red'); return; }
    if (faltaNueva.length) { toast('Falta ' + faltaNueva.join(', '), 'amber'); return; }

    const emisoraId = emisoraFija || nueva.companyId;
    const company = lookupCompany(emisoraId);
    const hoy = nueva.fecha || window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10);
    const anio = Number(String(hoy).slice(0, 4));
    const items = lineas
      .filter(l => String(l.descripcion || '').trim() && Number(l.cantidad) > 0)
      .map(l => ({
        nombre: l.descripcion.trim(), unidad: l.unidad || 'UND',
        cantidad: Number(l.cantidad), precio_unitario: Number(l.precio_unitario),
        insumo_codigo: l.insumo_codigo || null,
        company_id: l.origen_company_id || null,
      }));

    if (numerar) {
      const { correlativo } = proximoCodigo(ordenes, { company, tipo: nueva.tipo, anio });
      const cod = formatearCodigo(correlativo, { company, tipo: nueva.tipo, anio });
      if (!window.confirm(
        `Emitir ${cod} a ${proveedorDeNueva.nombre}?\n\n${items.length} línea(s) · ${fmtS(totalesNueva.total)}\n\n`
        + `Ese número queda tomado en la serie de ${company?.name || 'la empresa'} y no se libera aunque después se anule.`
      )) return;
    }

    creandoRef.current = true;
    try {
      const now = new Date().toISOString();
      // Un proveedor nuevo se guarda en el catálogo SOLO si se pidió: no
      // ensuciamos la lista de 378 proveedores con cada nombre tipeado a mano.
      let provId = proveedorDeNueva.id;
      if (nueva.provModo === 'nuevo' && nueva.guardarProveedor && proveedorDeNueva.nombre) {
        try {
          provId = window.__newId();
          await window.__db.proveedores.add({
            id: provId, razon_social: proveedorDeNueva.nombre, ruc: proveedorDeNueva.ruc || null,
            direccion: proveedorDeNueva.direccion || null, estado: 'activo',
            created_by: userId, updated_by: userId, created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_prov_${provId}`,
          });
          setProveedores(ps => [...ps, { id: provId, razon_social: proveedorDeNueva.nombre, ruc: proveedorDeNueva.ruc }]);
        } catch (e) { console.warn('[ordenes] no se pudo guardar el proveedor:', e); provId = null; }
      }

      const { fila, items: filasItems } = nuevaOrdenBorrador({
        companyId: emisoraId,
        tipo: nueva.tipo,
        obraId: nueva.obraId || obraScopeId || null,
        proveedor: { ...proveedorDeNueva, id: provId },
        items,
        igvPct: Number(nueva.igvPct),
        fecha: hoy,
        fechaEntrega: nueva.fechaEntrega || null,
        lugarEntrega: nueva.lugarEntrega || null,
        condicionPago: nueva.condicionPago || null,
        titulo: nueva.titulo || null,
        obraDescripcion: nueva.obraDescripcion || lookupObra(nueva.obraId || obraScopeId)?.nombre_obra || null,
        observaciones: nueva.notas || null,
      });

      const definitiva = numerar ? numerarOrden({ ...fila }, ordenes, { company, anio }) : fila;
      const ocId = window.__newId();
      await window.__db.ordenes_compra.add({
        ...definitiva, id: ocId,
        created_by: userId, updated_by: userId, created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_oc_${ocId}`,
      });
      for (const l of filasItems) {
        const itemId = window.__newId();
        await window.__db.oc_items.add({
          ...l, id: itemId, orden_compra_id: ocId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_oc_item_${itemId}`,
        });
      }
      // ── EL MAPEO QUE SALE DE REGALO ─────────────────────────────
      // Gabriel: «el mapeo lo vamos a lograr aquí cuando la contadora lo haga
      // manualmente». Cada línea que cruza un insumo del presupuesto con una
      // compra real ES una decisión de mapeo, y se guarda sola. Nadie se
      // sienta a mapear 1.875 descripciones: se aprenden trabajando.
      let aprendidos = 0;
      for (const l of lineas) {
        const fila = mapeoImplicito({
          descripcionCompra: l.origen_descripcion,
          insumoCodigo: l.insumo_codigo,
          unidadCompra: l.origen_unidad,
          unidadInsumo: l.insumo_unidad,
        });
        if (!fila) continue;
        try {
          const mid = window.__newId();
          await window.__db.insumo_mapeo.add({
            ...fila, id: mid, demo: false,
            created_by: userId, updated_by: userId, created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_mapeo_${mid}`,
          });
          aprendidos++;
        } catch (e) { console.warn('[ordenes] no se pudo guardar el mapeo aprendido:', e); }
      }

      await recargarOrdenes();
      limpiarNueva();
      toast(numerar ? `Orden ${definitiva.codigo} emitida` : 'Borrador guardado (todavía sin número)', 'green');
      if (aprendidos) toast(`${aprendidos} equivalencia(s) aprendida(s) para el mapeo`, 'blue');
      if (numerar) setTab('emitidas');
    } catch (e) {
      console.error('[ordenes] no se pudo crear la orden:', e);
      toast('No se pudo crear la orden: ' + (e.message || e), 'red');
    } finally { creandoRef.current = false; }
  };

  const actualizarBorrador = (idx, patch) => {
    setBorradores(bs => bs.map((b, i) => {
      if (i !== idx) return b;
      const next = { ...b, ...patch };
      return ('total' in patch || 'igvPct' in patch) ? recalcularBorrador(next) : next;
    }));
  };

  const seleccionados = uM(() => borradores.filter(b => b.incluir), [borradores]);
  const montoSeleccionado = uM(
    () => seleccionados.reduce((s, b) => s + Number(b.total || 0), 0),
    [seleccionados]
  );

  // ── LA EMISIÓN EN LOTE ──────────────────────────────────────────
  //
  // Una orden = una fila en `ordenes_compra` + un `oc_items` + el
  // `orden_compra_id` del comprobante. Los tres en la misma pasada: si se
  // escribiera la orden y no el movimiento, el comprobante volvería a
  // aparecer en esta lista y se emitiría dos veces.
  //
  // El correlativo se calcula sobre un acumulador LOCAL (`emitidasAhora`) y
  // no releyendo Dexie en cada vuelta: en un lote de 200, releer daría el
  // mismo número dos veces hasta que la escritura anterior se vea.
  //
  // 🔴 Bloqueante B-3 (tanda 5, cerrado en la tanda 7): `seleccionados` hereda
  // el orden de `pendientes` (por MONTO — correcto para MIRAR la lista), pero
  // recorrerlo así al EMITIR repartía la OC-001 al comprobante más caro, no
  // al más antiguo. `ordenarParaEmitir()` recorre por fecha ascendente SOLO
  // acá, en el momento de pedir los correlativos — la grilla que ve la
  // contadora sigue mostrando lo caro primero, que es donde sirve mirar.
  const emitirLote = async () => {
    if (emitiendoRef.current) return;
    if (!seleccionados.length) { toast('No hay comprobantes seleccionados', 'amber'); return; }
    if (!canEmitir) { toast('No tenés permiso para emitir órdenes', 'red'); return; }
    const sinEmpresa = seleccionados.filter(b => !b.company_id);
    if (sinEmpresa.length) { toast(`${sinEmpresa.length} comprobante(s) sin empresa emisora — no se pueden numerar`, 'red'); return; }
    if (!window.confirm(`Emitir ${seleccionados.length} órdenes por ${fmtS(montoSeleccionado)}?\n\nCada comprobante queda atado a su orden.`)) return;

    emitiendoRef.current = true;
    setEmitiendo(true);
    const porFecha = ordenarParaEmitir(seleccionados);
    setProgreso({ hechas: 0, total: porFecha.length });
    const emitidasAhora = [...ordenes];
    let ok = 0; const errores = [];

    try {
      for (const b of porFecha) {
        try {
          const company = lookupCompany(b.company_id);
          const anio = b.fecha ? Number(String(b.fecha).slice(0, 4)) : new Date().getFullYear();
          const { correlativo, codigo } = proximoCodigo(emitidasAhora, { company, tipo: b.tipo, anio });
          const ocId = window.__newId();
          const now = new Date().toISOString();
          const obra = lookupObra(b.obra_id);
          const T = textosDeTipo(b.tipo);

          const fila = {
            id: ocId,
            codigo, correlativo, anio,
            tipo: b.tipo,
            company_id: b.company_id,
            obra_id: b.obra_id || null,
            trabajo_id: b.trabajo_id || null,
            proveedor_id: b.proveedor_id || null,
            proveedor_nombre: b.proveedor_nombre || null,
            proveedor_ruc: b.proveedor_ruc || null,
            proveedor_direccion: b.proveedor_direccion || null,
            fecha: b.fecha || now.slice(0, 10),
            fecha_entrega: null,
            moneda: 'PEN',
            condicion_pago: b.condicion_pago || null,
            estado: 'recibida',   // el bien/servicio YA se recibió: la orden es el respaldo de algo que pasó
            titulo: b.titulo || null,
            obra_descripcion: b.obra_descripcion || obra?.nombre_obra || null,
            contrato_ref: null,
            ejecutor_ref: null,
            igv_pct: Number(b.igvPct ?? 18),
            monto_subtotal: Number(b.valorVenta || 0),
            monto_igv: Number(b.igv || 0),
            monto_total: Number(b.total || 0),
            accounting_movement_id: b.movimiento_id,
            emitida_retroactiva: true,
            observaciones: `Respaldo retroactivo del comprobante ${b.documento || ''}`.trim(),
            created_by: userId, updated_by: userId,
            created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_oc_${ocId}`,
          };

          await window.__db.ordenes_compra.add(fila);
          // Las líneas REALES del comprobante, no un «Insumos y materiales»
          // genérico: `borradorDesdeMovimiento` ya las sacó de `items_factura`
          // y `repartirSobreItems` las cuadró contra el total emitido.
          const lineas = (b.lineas?.length ? b.lineas : [{
            nombre: b.descripcion || 'Insumos y materiales',
            unidad: b.unidad || T.unidadPorDefecto,
            cantidad: Number(b.cantidad || 1),
            subtotal: Number(b.valorVenta || 0),
          }]);
          for (const l of lineas) {
            const liId = window.__newId();
            const cant = Number(l.cantidad || 1) || 1;
            const sub = Number(l.subtotal ?? (cant * Number(l.precio_unitario || 0)));
            await window.__db.oc_items.add({
              id: liId,
              orden_compra_id: ocId,
              tipo_insumo: l.tipo_insumo || (b.tipo === 'servicio' ? 'servicio' : 'material'),
              material_id: null, insumo_id: null, insumo_pendiente_id: null,
              insumo_codigo: null, proveedor_company_id: null,
              nombre: l.nombre, nombre_libre: l.nombre,
              unidad: l.unidad || T.unidadPorDefecto,
              cantidad: cant,
              cantidad_recibida: cant,
              precio_unitario: Number((sub / cant).toFixed(6)),
              subtotal: sub,
              created_at: now, updated_at: now,
              version: 1, sync_status: 'pending_create', last_synced_at: null,
              idempotency_key: `${userId}_oc_item_${liId}`,
            });
          }

          // El otro lado del vínculo. Sin esto la factura sigue "sin respaldo".
          const mv = await window.__db.accounting_movements.get(b.movimiento_id);
          if (mv) {
            await window.__db.accounting_movements.update(b.movimiento_id, {
              orden_compra_id: ocId,
              updated_at: now, updated_by: userId,
              version: (mv.version ?? 0) + 1,
              sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
            });
          }

          emitidasAhora.push(fila);
          ok++;
          setProgreso({ hechas: ok, total: porFecha.length });
        } catch (e) {
          errores.push(`${b.documento || b.movimiento_id}: ${e.message || e}`);
        }
      }

      try {
        await window.__logAudit?.({
          action: 'create', table: 'ordenes_compra', recordId: null,
          newData: { emitidas: ok, monto: montoSeleccionado },
          reason: `Emisión masiva de respaldo — ${ok} órdenes por ${fmtS(montoSeleccionado)} (umbral S/ ${umbral})`,
        });
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_compra' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      await recargarOrdenes();
      setBorradores([]);
      if (errores.length) {
        console.warn('[órdenes] errores de emisión', errores);
        toast(`${ok} órdenes emitidas · ${errores.length} con error (ver consola)`, 'amber');
      } else {
        toast(`✓ ${ok} órdenes emitidas · ${fmtS(montoSeleccionado)} respaldados`, 'green');
      }
      setTab('emitidas');
    } finally {
      emitiendoRef.current = false;
      setEmitiendo(false);
      setProgreso(null);
    }
  };

  // ── PDF ─────────────────────────────────────────────────────────
  const descargarPdf = async (o) => {
    try {
      const items = await window.__db.oc_items.where('orden_compra_id').equals(o.id).filter(x => !x.deleted_at).toArray();
      window.__pdfs?.generateOrdenPdf?.(o, items, {
        company: lookupCompany(o.company_id) || {},
        obra: lookupObra(o.obra_id),
        proveedor: lookupProv(o.proveedor_id),
      });
    } catch (e) { toast('Error generando el PDF: ' + (e.message || e), 'red'); }
  };

  const verDetalle = async (o) => {
    try {
      const items = await window.__db.oc_items.where('orden_compra_id').equals(o.id).filter(x => !x.deleted_at).toArray();
      setDetalleItems(items);
      setDetalle(o);
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const anular = async (o) => {
    const motivo = window.prompt(`Motivo de anulación de ${o.codigo}:`);
    if (!motivo || motivo.trim().length < 5) { toast('Motivo requerido (mín. 5 caracteres)', 'red'); return; }
    try {
      const now = new Date().toISOString();
      await window.__db.ordenes_compra.update(o.id, {
        estado: 'anulada', motivo_anulacion: motivo.trim(), anulado_por: userId, anulado_at: now,
        updated_at: now, updated_by: userId,
        version: (o.version ?? 0) + 1,
        sync_status: o.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      // El comprobante vuelve a quedar sin respaldo — que es la verdad.
      if (o.accounting_movement_id) {
        const mv = await window.__db.accounting_movements.get(o.accounting_movement_id);
        if (mv && mv.orden_compra_id === o.id) {
          await window.__db.accounting_movements.update(mv.id, {
            orden_compra_id: null,
            updated_at: now, updated_by: userId,
            version: (mv.version ?? 0) + 1,
            sync_status: mv.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
          });
        }
      }
      try { await window.__logAudit?.({ action: 'update', table: 'ordenes_compra', recordId: o.id, oldData: { estado: o.estado }, newData: { estado: 'anulada', motivo }, reason: `Anulación ${o.codigo}: ${motivo}` }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'ordenes_compra' } })); } catch {}
      await recargarOrdenes();
      toast(`${o.codigo} anulada`, 'amber');
    } catch (e) { toast('Error: ' + (e.message || e), 'red'); }
  };

  const empresasConMovs = uM(() => {
    const ids = new Set((movs || []).map(m => m.company_id).filter(Boolean));
    (ordenes || []).forEach(o => { if (o.company_id) ids.add(o.company_id); });
    return (companies || []).filter(c => !c.deleted_at && ids.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [companies, movs, ordenes]);

  const Banner = window.EmpresaActivaBanner;
  const obraScope = obraScopeId ? lookupObra(obraScopeId) : null;

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div>
          <div className="pg-title">Órdenes de compra y servicio</div>
          <div className="pg-sub">
            {emitidas.length} órdenes · {fmtSk(emitidas.reduce((s, o) => s + Number(o.monto_total || 0), 0))}
            {obraScope ? ' · esta obra' : (companyId ? ` · ${lookupCompany(companyId)?.name || ''}` : ' · todo el grupo')}
          </div>
        </div>
      </div>

      {/* EL CARTEL DE LA OBRA (tanda 6). Hermano del de empresa y del de
          Movimientos de esta obra: sin él, una lista más corta de lo normal no
          tendría explicación — y no habría forma de salir del ámbito. */}
      {obraScope && (
        <div className="card card-p" style={{
          marginBottom: 12, borderLeft: '3px solid var(--amber)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <JxIcon name="hardHat" size={16} color="var(--amber)" />
          <div style={{ flex: 1, minWidth: 200, fontSize: 12, color: 'var(--ts)' }}>
            Las órdenes que respaldan las compras de <strong style={{ color: 'var(--tp)' }}>{obraScope.nombre_obra}</strong>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
              Cada orden la numera la empresa que la emite (OC-001-2026 por RUC), pero aquí solo se ven
              las de este trabajo — incluidas las de las otras empresas del grupo que le compran.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('ordenes', 'general')}
            title="Salir del ámbito de la obra y ver las órdenes de todo el grupo">
            Ver las de todo el grupo →
          </button>
        </div>
      )}

      {!obraScope && Banner && <Banner onSalir={() => { setFiltroEmpresa('todas'); setBorradores([]); }} />}

      {/* ── LA BARRA DEL RESPALDO ───────────────────────────────────
          El número que Gabriel fue a buscar y no estaba: cuánto del dinero
          por encima del umbral tiene un papel que lo respalde. */}
      <div className="card card-p" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 2 }}>
              Respaldo de compras por encima de {fmtS(resumen.umbral)}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
              {resumen.respaldados} de {resumen.sobreUmbral} comprobantes tienen orden ·{' '}
              <strong style={{ color: resumen.sinRespaldo ? 'var(--amber)' : 'var(--green)' }}>
                {fmtS(resumen.montoSinRespaldo)} sin respaldo
              </strong>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: resumen.pctRespaldado >= 90 ? 'var(--green)' : 'var(--amber)' }}>
              {resumen.pctRespaldado.toFixed(0)}%
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>del monto respaldado</div>
          </div>
        </div>
        <div style={{ height: 6, background: 'var(--bg-c2)', borderRadius: 3, marginTop: 10, overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(100, resumen.pctRespaldado)}%`, height: '100%',
            background: resumen.pctRespaldado >= 90 ? 'var(--green)' : 'var(--amber)',
          }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${tab === 'emitidas' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('emitidas')}>
          Emitidas ({emitidas.length})
        </button>
        <button className={`btn btn-sm ${tab === 'respaldo' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('respaldo')}>
          Sin respaldo ({resumen.sinRespaldo})
        </button>
        {/* La puerta que faltaba: una orden que nace ANTES del comprobante. */}
        <button className={`btn btn-sm ${tab === 'nueva' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setTab('nueva')}>
          Nueva orden{lineas.length ? ` (${lineas.length})` : ''}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <select className="fi" value={filtroEmpresa} disabled={!!empresaFija}
          title={empresaFija ? 'Estás dentro de la contabilidad de esta empresa: son SUS órdenes.' : undefined}
          onChange={e => {
            setFiltroEmpresa(e.target.value);
            // Dentro de una obra, filtrar por empresa es UN FILTRO de esta
            // pantalla, no entrar a la contabilidad de esa empresa. Sin este
            // corte, elegir JARVEX acá dejaba el contexto pegado y el menú
            // entero pasaba a ser el de JARVEX al salir del trabajo.
            if (!enObra) setEmpresaActivaId(e.target.value === 'todas' ? null : e.target.value);
            setBorradores([]);
          }} style={{ minWidth: 220 }}>
          {!empresaFija && <option value="todas">Todas las empresas</option>}
          {empresasConMovs.filter(c => !empresaFija || c.id === empresaFija)
            .map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {tab === 'emitidas' && (
          <>
            <select className="fi" value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)} style={{ minWidth: 160 }}>
              <option value="todos">Compra y servicio</option>
              <option value="compra">Solo órdenes de compra</option>
              <option value="servicio">Solo órdenes de servicio</option>
            </select>
            <div className="search-bar" style={{ flex: '1 1 180px' }}>
              <JxIcon name="search" size={14} color="var(--tm)" />
              <input placeholder="Buscar código, proveedor o rubro…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            </div>
            <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--tm)' }}>
              <input type="checkbox" checked={verAnuladas} onChange={e => setVerAnuladas(e.target.checked)} /> ver anuladas
            </label>
          </>
        )}
      </div>

      {/* ═══ NUEVA ORDEN — la que nace antes del comprobante (tanda 7) ═══ */}
      {tab === 'nueva' ? (
        <div>
          {/* ── LA CABECERA: quién emite, a quién, y con qué condiciones ── */}
          <div className="card card-p" style={{ marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <label>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>Empresa que EMITE la orden *</div>
                {emisoraFija ? (
                  <div className="fi" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, opacity: 0.85 }}
                    title={obraScopeId
                      ? 'La orden la emite la empresa que ejecuta esta obra. No se elige: si se numerara en la serie de otra, sería un error que después no se arregla.'
                      : 'Estás dentro de la contabilidad de esta empresa: la orden es suya.'}>
                    <JxIcon name="lock" size={12} />
                    <b>{lookupCompany(emisoraFija)?.name || lookupCompany(emisoraFija)?.legal_name || '—'}</b>
                  </div>
                ) : (
                  <select className="fi" style={{ width: '100%' }} value={nueva.companyId}
                    onChange={e => setNu({ companyId: e.target.value })}>
                    <option value="">— Elige la empresa —</option>
                    {(companies || []).filter(c => !c.deleted_at).map(c => (
                      <option key={c.id} value={c.id}>{c.name || c.legal_name}</option>
                    ))}
                  </select>
                )}
              </label>
              <label>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>Tipo</div>
                <select className="fi" style={{ width: '100%' }} value={nueva.tipo} onChange={e => setNu({ tipo: e.target.value })}>
                  <option value="compra">Orden de Compra</option>
                  <option value="servicio">Orden de Servicio</option>
                </select>
              </label>
              <label>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>Fecha</div>
                <input className="fi" type="date" style={{ width: '100%' }} value={nueva.fecha}
                  onChange={e => setNu({ fecha: e.target.value })} />
              </label>
              <label>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>IGV %</div>
                <input className="fi" type="number" min="0" max="18" step="any" style={{ width: '100%' }}
                  value={nueva.igvPct} onChange={e => setNu({ igvPct: e.target.value })} />
              </label>
            </div>

            {/* A QUIÉN SE LE COMPRA. Las tres formas, porque las tres pasan —
                y la tercera es la que faltaba: un tercero que NO está cargado. */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>¿A quién se le compra? *</span>
                {[['nuevo', 'Escribirlo (no está en el sistema)'], ['registrado', 'Un proveedor ya cargado'], ['grupo', 'Una empresa del grupo']].map(([v, lbl]) => (
                  <button key={v} className={`btn btn-sm ${nueva.provModo === v ? 'btn-amber' : 'btn-ghost'}`}
                    onClick={() => setNu({ provModo: v })}>{lbl}</button>
                ))}
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
                {nueva.provModo === 'grupo' && (
                  <select className="fi" style={{ minWidth: 280 }} value={nueva.provCompanyId}
                    onChange={e => setNu({ provCompanyId: e.target.value })}>
                    <option value="">— Elige la empresa —</option>
                    {(companies || []).filter(c => !c.deleted_at && c.id !== (emisoraFija || nueva.companyId)).map(c => (
                      <option key={c.id} value={c.id}>{c.name || c.legal_name}</option>
                    ))}
                  </select>
                )}
                {nueva.provModo === 'registrado' && (
                  <select className="fi" style={{ minWidth: 320 }} value={nueva.provId}
                    onChange={e => setNu({ provId: e.target.value })}>
                    <option value="">— Elige el proveedor —</option>
                    {[...(proveedores || [])]
                      .sort((a, b) => String(a.razon_social || a.nombre || '').localeCompare(String(b.razon_social || b.nombre || '')))
                      .map(pv => <option key={pv.id} value={pv.id}>{pv.razon_social || pv.nombre}{pv.ruc ? ` · ${pv.ruc}` : ''}</option>)}
                  </select>
                )}
                {nueva.provModo === 'nuevo' && (
                  <>
                    <label>
                      <div style={{ fontSize: 11, color: 'var(--tm)' }}>Razón social *</div>
                      <input className="fi" style={{ minWidth: 260 }} value={nueva.provNombre}
                        onChange={e => setNu({ provNombre: e.target.value })} placeholder="DISTRIBUIDORA ... SAC" />
                    </label>
                    <label>
                      <div style={{ fontSize: 11, color: 'var(--tm)' }}>RUC</div>
                      <input className="fi" style={{ width: 140 }} value={nueva.provRuc}
                        onChange={e => setNu({ provRuc: e.target.value })} placeholder="20512345678" />
                    </label>
                    <label>
                      <div style={{ fontSize: 11, color: 'var(--tm)' }}>Dirección</div>
                      <input className="fi" style={{ minWidth: 220 }} value={nueva.provDireccion}
                        onChange={e => setNu({ provDireccion: e.target.value })} />
                    </label>
                    <label style={{ fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 5, color: 'var(--tm)', paddingBottom: 6 }}>
                      <input type="checkbox" checked={nueva.guardarProveedor}
                        onChange={e => setNu({ guardarProveedor: e.target.checked })} />
                      guardarlo en el catálogo
                    </label>
                  </>
                )}
              </div>
            </div>

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--tm)' }}>Condiciones y datos del documento (opcional)</summary>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
                <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Título / rubro</div>
                  <input className="fi" style={{ width: '100%' }} value={nueva.titulo} onChange={e => setNu({ titulo: e.target.value })} /></label>
                <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Fecha de entrega</div>
                  <input className="fi" type="date" style={{ width: '100%' }} value={nueva.fechaEntrega} onChange={e => setNu({ fechaEntrega: e.target.value })} /></label>
                <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Lugar de entrega</div>
                  <input className="fi" style={{ width: '100%' }} value={nueva.lugarEntrega} onChange={e => setNu({ lugarEntrega: e.target.value })} /></label>
                <label><div style={{ fontSize: 11, color: 'var(--tm)' }}>Condición de pago</div>
                  <input className="fi" style={{ width: '100%' }} value={nueva.condicionPago} onChange={e => setNu({ condicionPago: e.target.value })} placeholder="Contado / 30 días" /></label>
                <label style={{ gridColumn: '1 / -1' }}><div style={{ fontSize: 11, color: 'var(--tm)' }}>Notas para el proveedor</div>
                  <input className="fi" style={{ width: '100%' }} value={nueva.notas} onChange={e => setNu({ notas: e.target.value })} /></label>
              </div>
              <p style={{ fontSize: 11, color: 'var(--tm)', margin: '8px 0 0' }}>
                El PDF sale con el logo, el RUC y la numeración de la empresa que emite.
              </p>
            </details>
          </div>

          {/* ── LOS AYUDANTES DE LA OBRA ─────────────────────────────
              Solo dentro de un trabajo, y solo como ATAJOS: agregan líneas al
              mismo formulario de arriba. Sin obra no hay presupuesto contra
              qué comparar, y la orden se llena a mano — que es el caso normal
              de una empresa comprándole a un tercero. */}
          {/* ══ LOS DOS BLOQUES DE AYUDA ══════════════════════════════
              A la izquierda lo que la obra NECESITA; a la derecha lo que las
              empresas del grupo YA COMPRARON. Ninguno depende del mapeo — el
              mapeo es lo que se GENERA al cruzarlos, que es exactamente lo que
              pidió la jefa de contabilidad. */}
          <div style={{ display: 'grid', gridTemplateColumns: obraScopeId ? 'repeat(auto-fit, minmax(320px, 1fr))' : '1fr', gap: 12, marginBottom: 12 }}>
            {obraScopeId && (
              <div className="card" style={{ overflow: 'hidden' }}>
                <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)' }}>
                  <b style={{ fontSize: 12.5 }}>Qué necesita la obra</b>
                  <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>Del presupuesto. Al elegir uno se agrega al detalle, y ahí puedes cambiarle el nombre, la cantidad y el precio.</div>
                  <input className="fi" style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                    placeholder="Buscar en el presupuesto: cemento, fierro, tubería…"
                    value={buscaNec} onChange={e => setBuscaNec(e.target.value)} />
                </div>
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  {sugNecesita.length === 0 ? (
                    <div style={{ padding: 14, fontSize: 11.5, color: 'var(--tm)', textAlign: 'center' }}>
                      {buscaNec ? 'Nada del presupuesto coincide con eso.' : 'Escribe qué estás buscando.'}
                    </div>
                  ) : sugNecesita.map(f => (
                    <div key={f.codigo} style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11.5, fontWeight: 600 }}>{f.nombre}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                          necesita {cantF(f.necesita)} {f.unidad}
                          {f.yaComprado > 0 && <> · ya compró {cantF(f.yaComprado)}</>}
                          {' · '}<b style={{ color: f.falta > 0 ? 'var(--red)' : 'var(--green)' }}>falta {cantF(f.falta)}</b>
                        </div>
                      </div>
                      <button className="btn btn-xs btn-amber" title="Agregar al detalle de la orden"
                        onClick={() => {
                          const k = window.__newId();
                          setLineas(ls => [...ls, {
                            ...lineaVacia(), key: k,
                            descripcion: f.nombre, unidad: f.unidad || 'UND',
                            cantidad: f.falta > 0 ? f.falta : '',
                            insumo_codigo: f.codigo, insumo_nombre: f.nombre, insumo_unidad: f.unidad,
                          }]);
                          setLineaFoco(k);
                        }}>+ agregar</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '9px 12px', borderBottom: '1px solid var(--border)' }}>
                <b style={{ fontSize: 12.5 }}>Qué tienen las empresas del grupo</b>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  Busca sobre lo que dicen las facturas, sin necesitar el mapeo.
                  {lineaFoco ? ' Al elegir uno se enlaza con la línea marcada.' : ' Marca una línea del detalle para enlazarla.'}
                </div>
                <input className="fi" style={{ width: '100%', marginTop: 6, fontSize: 12 }}
                  placeholder="Buscar en las compras: cemento, fierro, tubo…"
                  value={buscaGrupo} onChange={e => setBuscaGrupo(e.target.value)} />
              </div>
              <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                {sugGrupo.length === 0 ? (
                  <div style={{ padding: 14, fontSize: 11.5, color: 'var(--tm)', textAlign: 'center' }}>
                    {buscaGrupo ? 'Ninguna empresa del grupo tiene algo así disponible.' : 'Escribe qué estás buscando.'}
                  </div>
                ) : sugGrupo.map((g, i) => (
                  <div key={i} style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                      {g.descripcion}
                      {g.obraVinculada && <span className="badge b-blue" style={{ marginLeft: 5, fontSize: 9 }}>ya vinculado a esta obra</span>}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      {g.porEmpresa.map(e => (
                        <button key={e.company_id || 'sin'} className="btn btn-xs btn-ghost"
                          title={`Comprado ${cantF(e.comprado)}${e.vendido ? ` · vendido ${cantF(e.vendido)}` : ''}`}
                          onClick={() => {
                            if (!lineaFoco) { toast('Marca primero la línea del detalle a la que enlazar esto', 'amber'); return; }
                            setLinea(lineaFoco, {
                              origen_company_id: e.company_id,
                              origen_descripcion: g.descripcion,
                              origen_unidad: g.unidad || null,
                              tope: e.disponible,
                            });
                            setNu({ provModo: 'grupo', provCompanyId: e.company_id });
                          }}>
                          <b>{cantF(e.disponible)}</b>&nbsp;{(e.nombre || '').slice(0, 18)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── LAS LÍNEAS ───────────────────────────────────────────── */}
          <div className="card" style={{ overflow: 'hidden', marginBottom: 12 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>{textosDeTipo(nueva.tipo).detalle}</b>
              <button className="btn btn-sm" onClick={addLinea}><JxIcon name="plus" size={13} /> Agregar línea</button>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--tm)' }}>
                Valor de venta <b style={{ color: 'var(--tp)' }}>{fmtS(totalesNueva.valorVenta)}</b>
                {' · '}IGV {fmtS(totalesNueva.igv)}
                {' · '}Total <b style={{ color: 'var(--tp)' }}>{fmtS(totalesNueva.total)}</b>
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th style={{ minWidth: 240 }}>{textosDeTipo(nueva.tipo).columnaDescripcion}</th>
                  <th style={{ width: 90 }}>Unidad</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Cantidad</th>
                  <th style={{ width: 120, textAlign: 'right' }}>Precio unit.</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Subtotal</th>
                  <th style={{ width: 40 }}></th>
                </tr></thead>
                <tbody>
                  {lineas.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--tm)' }}>
                      Sin líneas todavía. Pulsa «Agregar línea» y escribe qué estás comprando.
                    </td></tr>
                  ) : lineas.map(l => (
                    <tr key={l.key}
                      style={lineaFoco === l.key ? { outline: '2px solid var(--amber)', outlineOffset: -2 } : undefined}
                      onClick={() => setLineaFoco(l.key)}>
                      <td>
                        <input className="fi" style={{ width: '100%' }} value={l.descripcion}
                          placeholder="CEMENTO PORTLAND TIPO I 42.5 kg"
                          onFocus={() => setLineaFoco(l.key)}
                          onChange={e => setLinea(l.key, { descripcion: e.target.value })} />
                        <div style={{ fontSize: 10.5, color: 'var(--tm)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {l.insumo_codigo && <span title="Insumo del presupuesto">📋 {l.insumo_codigo}</span>}
                          {l.origen_company_id && (
                            <span title={l.origen_descripcion || ''}>
                              📦 {lookupCompany(l.origen_company_id)?.name || 'del grupo'}
                              {l.tope != null ? ` · tiene ${cantF(l.tope)}` : ''}
                            </span>
                          )}
                          {l.insumo_codigo && l.origen_descripcion && (
                            <span style={{ color: 'var(--green)' }} title="Al emitir, esta equivalencia queda aprendida para las próximas facturas">
                              ✓ el mapeo queda aprendido
                            </span>
                          )}
                          {lineaFoco === l.key && !l.origen_descripcion && (
                            <span style={{ color: 'var(--amber)' }}>← elige a la derecha quién lo tiene</span>
                          )}
                        </div>
                      </td>
                      <td><input className="fi" style={{ width: '100%' }} value={l.unidad}
                        onChange={e => setLinea(l.key, { unidad: e.target.value })} /></td>
                      <td><input className="fi" type="number" min="0" step="any" style={{ width: '100%', textAlign: 'right' }}
                        value={l.cantidad} onChange={e => setLinea(l.key, { cantidad: e.target.value })} /></td>
                      <td><input className="fi" type="number" min="0" step="any" style={{ width: '100%', textAlign: 'right' }}
                        value={l.precio_unitario} placeholder="0.00"
                        onChange={e => setLinea(l.key, { precio_unitario: e.target.value })} /></td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {fmtS(Number(l.cantidad || 0) * Number(l.precio_unitario || 0))}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button className="btn btn-xs btn-ghost" title="Quitar la línea" onClick={() => delLinea(l.key)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card card-p" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn btn-sm" onClick={limpiarNueva}>Limpiar</button>
            <button className="btn btn-sm" disabled={!!faltaNueva.length} onClick={() => crearOrden({ numerar: false })}>
              Guardar como borrador
            </button>
            <button className="btn btn-amber btn-sm" disabled={!!faltaNueva.length || !canEmitir}
              onClick={() => crearOrden({ numerar: true })}>
              <JxIcon name="check" size={14} /> Confirmar y numerar
            </button>
            {faltaNueva.length > 0 && (
              <span style={{ fontSize: 11.5, color: 'var(--amber)' }}>Falta {faltaNueva.join(', ')}.</span>
            )}
            {!faltaNueva.length && (
              <span style={{ fontSize: 11.5, color: 'var(--tm)' }}>
                El número se asigna al confirmar: un borrador que se abandona no deja huecos en la numeración.
              </span>
            )}
          </div>
        </div>
      ) : tab === 'emitidas' ? (
        emitidas.length === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="package" size={40} color="var(--tm)" />
            <p>No hay órdenes emitidas en esta vista.</p>
            {resumen.sinRespaldo > 0 && (
              <button className="btn btn-amber btn-sm" onClick={() => setTab('respaldo')}>
                Hay {resumen.sinRespaldo} comprobantes sin respaldo — emitirlas
              </button>
            )}
          </div>
        ) : (
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th>N°</th><th>Tipo</th><th>Empresa que emite</th><th>Proveedor</th>
                  <th>Fecha</th><th style={{ textAlign: 'right' }}>Importe total</th>
                  <th>Estado</th><th style={{ textAlign: 'center' }}>Acciones</th>
                </tr></thead>
                <tbody>
                  {emitidas.map(o => {
                    const anulada = ANULADA.has(o.estado);
                    return (
                      <tr key={o.id} style={anulada ? { opacity: 0.6 } : undefined}>
                        <td className="col-m" style={{ fontFamily: 'monospace', fontWeight: 700 }}>
                          {o.codigo || '—'}
                          {o.emitida_retroactiva && <div style={{ fontSize: 9.5, color: 'var(--tm)', fontFamily: 'inherit' }}>respaldo retroactivo</div>}
                        </td>
                        <td>
                          <span className={`badge ${(o.tipo || 'compra') === 'servicio' ? 'b-purple' : 'b-blue'}`}>
                            {(o.tipo || 'compra') === 'servicio' ? 'Servicio' : 'Compra'}
                          </span>
                        </td>
                        <td className="col-p" style={{ maxWidth: 200, fontSize: 11.5 }}>{lookupCompany(o.company_id)?.name || '—'}</td>
                        <td className="col-p" style={{ maxWidth: 200, fontSize: 11.5 }}>
                          {o.proveedor_nombre || lookupProv(o.proveedor_id)?.razon_social || '—'}
                          {o.titulo && <div style={{ fontSize: 10, color: 'var(--tm)' }}>{o.titulo}</div>}
                        </td>
                        <td className="col-m">{o.fecha || '—'}</td>
                        <td className="col-num" style={{ textAlign: 'right', fontWeight: 700, color: 'var(--blue)' }}>{fmtS(o.monto_total)}</td>
                        <td><span className={`badge ${ESTADO_BADGE[o.estado] || 'b-gray'}`}>{ESTADO_LABEL[o.estado] || o.estado}</span></td>
                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-xs" title="Ver detalle" onClick={() => verDetalle(o)}><JxIcon name="eye" size={11} /></button>
                          <button className="btn btn-ghost btn-xs" title="Descargar el PDF con la marca de la empresa" onClick={() => descargarPdf(o)} style={{ marginLeft: 4 }}><JxIcon name="download" size={11} /></button>
                          {canEmitir && !anulada && (
                            <button className="btn btn-red btn-xs" title="Anular (con motivo)" onClick={() => anular(o)} style={{ marginLeft: 4 }}><JxIcon name="x" size={11} /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        // ── PESTAÑA «SIN RESPALDO» ────────────────────────────────
        pendientes.length === 0 ? (
          <div className="card card-p empty-state">
            <JxIcon name="checkCircle" size={40} color="var(--green)" />
            <p>Todos los comprobantes por encima de {fmtS(umbral)} tienen su orden.</p>
          </div>
        ) : (
          <>
            <div className="card card-p" style={{ marginBottom: 12, background: 'var(--tint-neutral)' }}>
              <div style={{ fontSize: 12, color: 'var(--ts)', lineHeight: 1.55 }}>
                Cada fila genera <strong>una orden</strong> atada a ese comprobante. Revisa el
                nombre de lo comprado, el tipo y el monto antes de emitir — después la orden
                queda ligada a la factura y solo se puede anular con motivo.
                {gruposPendientes.length > 1 && (
                  <> Hay <strong>{gruposPendientes.length} empresas</strong> emitiendo: cada una numera su propia serie.</>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setBorradores(bs => bs.map(b => ({ ...b, incluir: true })))}>Marcar todas</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setBorradores(bs => bs.map(b => ({ ...b, incluir: false })))}>Desmarcar todas</button>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 12, color: 'var(--tm)' }}>
                {seleccionados.length} seleccionadas · <strong style={{ color: 'var(--amber)' }}>{fmtS(montoSeleccionado)}</strong>
              </div>
              {canEmitir && (
                <button className="btn btn-amber btn-sm" disabled={emitiendo || !seleccionados.length} onClick={emitirLote}>
                  <JxIcon name="check" size={13} />
                  {emitiendo
                    ? `Emitiendo ${progreso?.hechas ?? 0}/${progreso?.total ?? 0}…`
                    : `Emitir ${seleccionados.length} órdenes`}
                </button>
              )}
            </div>

            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead><tr>
                    <th style={{ width: 32 }}></th>
                    <th style={{ width: 128 }}>Comprobante</th>
                    <th style={{ width: 170 }}>Proveedor</th>
                    <th style={{ minWidth: 240 }}>Qué se compró (editable)</th>
                    <th style={{ width: 108 }}>Tipo</th>
                    <th style={{ width: 92 }}>IGV</th>
                    <th style={{ width: 140, textAlign: 'right' }}>Importe total</th>
                  </tr></thead>
                  <tbody>
                    {borradores.map((b, idx) => (
                      <tr key={b.movimiento_id} style={b.incluir ? undefined : { opacity: 0.45 }}>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={!!b.incluir} onChange={e => actualizarBorrador(idx, { incluir: e.target.checked })} />
                        </td>
                        <td className="col-m" style={{ fontSize: 10.5 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {/* El ojo que pidió Gabriel: ver de qué factura se
                                está hablando sin salir de la pantalla. */}
                            <button className="btn btn-xs btn-ghost" title="Ver el comprobante"
                              onClick={() => setVerMov(b.movimiento_id)}>
                              <JxIcon name="eye" size={13} />
                            </button>
                            <span style={{ fontFamily: 'monospace' }}>{b.documento || '—'}</span>
                          </div>
                          <div style={{ color: 'var(--tm)' }}>{b.fecha || ''}</div>
                        </td>
                        <td style={{ maxWidth: 170, fontSize: 10.5 }}>
                          <div style={{ fontWeight: 600 }}>{b.proveedor_nombre || '—'}</div>
                          <div style={{ color: 'var(--tm)' }}>emite: {lookupCompany(b.company_id)?.name || '⚠ sin empresa'}</div>
                        </td>
                        <td>
                          <input className="fi" style={{ fontSize: 11, width: '100%' }} value={b.descripcion || ''}
                            onChange={e => actualizarBorrador(idx, { descripcion: e.target.value })} />
                          {b.lineas?.length > 1 && (
                            <div style={{ fontSize: 9.5, color: 'var(--tm)', marginTop: 2 }}>
                              {b.lineas.length} líneas de la factura — van todas al detalle de la orden
                            </div>
                          )}
                          {b.lineas?.length === 1 && b.lineas[0].cantidad > 1 && (
                            <div style={{ fontSize: 9.5, color: 'var(--tm)', marginTop: 2 }}>
                              {Number(b.lineas[0].cantidad).toLocaleString('es-PE')} {b.lineas[0].unidad}
                            </div>
                          )}
                        </td>
                        <td>
                          <select className="fi" style={{ fontSize: 11 }} value={b.tipo}
                            onChange={e => actualizarBorrador(idx, { tipo: e.target.value, unidad: textosDeTipo(e.target.value).unidadPorDefecto })}>
                            <option value="compra">Compra</option>
                            <option value="servicio">Servicio</option>
                          </select>
                        </td>
                        <td>
                          <select className="fi" style={{ fontSize: 11, width: '100%' }} value={String(b.igvPct)}
                            onChange={e => actualizarBorrador(idx, { igvPct: Number(e.target.value) })}>
                            <option value="18">18%</option>
                            <option value="0">Sin IGV</option>
                          </select>
                        </td>
                        <td>
                          <input className="fi" type="number" min="0" step="0.01"
                            style={{ fontSize: 11, textAlign: 'right', width: '100%' }}
                            value={b.total} onChange={e => actualizarBorrador(idx, { total: e.target.value })} />
                          <div style={{ fontSize: 9.5, color: 'var(--tm)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {fmtS(b.valorVenta)} + {fmtS(b.igv)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {pendientes.length > borradores.length && (
              <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 8 }}>
                Mostrando las {borradores.length} más caras de {pendientes.length}. Emitidas éstas, aparecen las siguientes.
              </div>
            )}
          </>
        )
      )}

      {/* ── EL COMPROBANTE, VISTO DESDE «SIN RESPALDO» ────────────
          Gabriel: «me gustaría que esté el ojito que me permita abrir y ver
          de qué factura estamos hablando». Muestra lo que la factura DICE —
          sus ítems— que es justo lo que la columna de al lado no mostraba. */}
      {verMov && (() => {
        const mv = (movs || []).find(m => m.id === verMov);
        if (!mv) return null;
        const items = itemsDeFactura(mv);
        return (
          <Modal title={`${mv.category || 'Comprobante'} ${mv.document_number || ''}`.trim()} icon="file" size="lg" onClose={() => setVerMov(null)}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: 12 }}>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Proveedor</div><b>{mv.third_party_name || '—'}</b>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{mv.third_party_ruc || ''}</div></div>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Cargado en el libro de</div><b>{lookupCompany(mv.company_id)?.name || '—'}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Fecha</div><b>{mv.date || '—'}</b></div>
              <div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Importe</div><b>{fmtS(mv.amount)}</b>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{mv.currency || 'PEN'}</div></div>
            </div>
            {mv.obra_id && (
              <p style={{ fontSize: 11.5, color: 'var(--tm)', margin: '0 0 10px' }}>
                Vinculado a <b>{lookupObra(mv.obra_id)?.nombre_obra?.slice(0, 70) || 'una obra'}</b>.
              </p>
            )}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 12 }}>
                Lo que dice la factura
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table className="tbl" style={{ fontSize: 11.5 }}>
                  <thead><tr><th>Descripción</th><th style={{ width: 90, textAlign: 'right' }}>Cantidad</th><th style={{ width: 70 }}>Unidad</th><th style={{ width: 110, textAlign: 'right' }}>P. unitario</th></tr></thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: 14, color: 'var(--tm)' }}>
                        Este comprobante no tiene el detalle cargado.
                      </td></tr>
                    ) : items.map((it, i) => (
                      <tr key={i}>
                        <td className="col-p">{it.descripcion || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{Number(it.cantidad || 0).toLocaleString('es-PE')}</td>
                        <td>{it.unidad || '—'}</td>
                        <td style={{ textAlign: 'right' }}>{fmtS(it.precio_unitario)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Modal>
        );
      })()}

      {detalle && (
        <Modal title={`${TIPO_ORDEN_LABEL[detalle.tipo || 'compra']} ${detalle.codigo || ''}`} icon="package"
          onClose={() => { setDetalle(null); setDetalleItems([]); }} wide>
          <div className="g2">
            <div><label className="flabel">Empresa que emite</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{lookupCompany(detalle.company_id)?.name || '—'}</div></div>
            <div><label className="flabel">Proveedor</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{detalle.proveedor_nombre || lookupProv(detalle.proveedor_id)?.razon_social || '—'}</div></div>
            <div><label className="flabel">Fecha</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{detalle.fecha || '—'}</div></div>
            <div><label className="flabel">Estado</label><div className="fi" style={{ background: 'var(--bg-c2)' }}>{ESTADO_LABEL[detalle.estado] || detalle.estado}</div></div>
            {detalle.obra_descripcion && (
              <div style={{ gridColumn: '1/-1' }}><label className="flabel">Obra</label><div className="fi" style={{ background: 'var(--bg-c2)', height: 'auto', minHeight: 34, whiteSpace: 'normal' }}>{detalle.obra_descripcion}</div></div>
            )}
          </div>
          <div style={{ marginTop: 14, overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="tbl" style={{ fontSize: 11 }}>
              <thead><tr>
                <th>#</th><th>{textosDeTipo(detalle.tipo).columnaDescripcion}</th>
                <th>Unidad</th><th style={{ textAlign: 'right' }}>Cant.</th>
                <th style={{ textAlign: 'right' }}>P. Unit.</th><th style={{ textAlign: 'right' }}>Importe</th>
              </tr></thead>
              <tbody>
                {detalleItems.map((it, i) => (
                  <tr key={it.id}>
                    <td>{i + 1}</td>
                    <td>{it.nombre || it.nombre_libre || '—'}</td>
                    <td>{it.unidad || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{Number(it.cantidad || 0).toFixed(2)}</td>
                    <td style={{ textAlign: 'right' }}>{fmtS(it.precio_unitario)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtS(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={5} style={{ textAlign: 'right', padding: '6px 12px' }}>Valor de venta:</td><td style={{ textAlign: 'right' }}>{fmtS(detalle.monto_subtotal)}</td></tr>
                <tr><td colSpan={5} style={{ textAlign: 'right', padding: '6px 12px' }}>IGV ({Number(detalle.igv_pct ?? 18)}%):</td><td style={{ textAlign: 'right' }}>{fmtS(detalle.monto_igv)}</td></tr>
                <tr style={{ background: 'rgba(242,183,5,0.15)', fontWeight: 700 }}>
                  <td colSpan={5} style={{ textAlign: 'right', padding: '8px 12px' }}>{textosDeTipo(detalle.tipo).total}:</td>
                  <td style={{ textAlign: 'right', color: 'var(--amber)' }}>{fmtS(detalle.monto_total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={() => { setDetalle(null); setDetalleItems([]); }}>Cerrar</button>
            <button className="btn btn-amber" onClick={() => descargarPdf(detalle)}><JxIcon name="download" size={13} />Descargar PDF</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

Object.assign(window, { OrdenesPage });
export { OrdenesPage };
