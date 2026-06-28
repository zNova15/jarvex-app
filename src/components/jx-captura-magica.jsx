import React from "react";
import {
  clasificarInsumo, TIPO_INSUMO_LABEL, TIPO_INSUMO_BADGE, TIPO_INSUMO_TABLA,
} from "../lib/insumo-clasificador.js";
import { epppTipo } from "../lib/epp-utils.js";
import { normalizarRuc, normalizarComprobante } from "../lib/doc-id.js";
const { useState: uSCM, useMemo: uMCM, useEffect: uECM, useRef: uRCM } = React;

// ╔════════════════════════════════════════════════════════════╗
// ║  CAPTURA MÁGICA — bandeja IA de comprobantes               ║
// ╚════════════════════════════════════════════════════════════╝
// Flujo:
//  1. Usuario arrastra/sube PDFs o fotos de facturas/boletas/NC.
//  2. Cada archivo se manda a /api/captura-magica → Claude Sonnet Vision
//     devuelve JSON estructurado (emisor, receptor, items, totales).
//  3. Pantalla de revisión side-by-side: PDF preview | JSON editable.
//  4. Match contra DB:
//        · proveedor por RUC (emisor) → existe / crear nuevo
//        · empresa por RUC (receptor) → match con companies del grupo
//        · obra → solo aparecen las que ejecuta esa empresa
//        · items → fuzzy match con materiales existentes (sugiere crear nuevos)
//  5. Confirmar → inserta:
//        · proveedor (si nuevo)
//        · accounting_movement tipo='cost' (con company_id, obra_id, doc, monto)
//        · materiales nuevos (con stock_actual=cantidad)
//        · movimientos_materiales (entrada por cada item)
//        · evidencia (PDF/imagen guardada en Dexie blob)
//        · audit_log

// ── Helpers ──────────────────────────────────────────────────
const fmtCurMagic = (n, cur = 'PEN') => {
  const sym = cur === 'USD' ? 'USD ' : 'S/ ';
  return sym + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_BYTES = 6 * 1024 * 1024; // 6 MB binario (queda ~8 MB en base64)

const TIPO_DOC_MAP = {
  factura: { label: 'Factura', acc: 'factura' },
  boleta: { label: 'Boleta', acc: 'boleta' },
  nota_credito: { label: 'Nota de Crédito', acc: 'nota_credito' },
  nota_debito: { label: 'Nota de Débito', acc: 'nota_debito' },
  recibo: { label: 'Recibo Honorarios', acc: 'recibo' },
  otro: { label: 'Otro', acc: 'otro' },
};

// Normaliza string para fuzzy match.
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Score de similitud simple: % de palabras compartidas.
function fuzzyScore(a, b) {
  const A = new Set(norm(a).split(' ').filter(w => w.length > 2));
  const B = new Set(norm(b).split(' ').filter(w => w.length > 2));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

// Convierte File → base64 string (sin prefijo data:...).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const m = String(result).match(/^data:[^;]+;base64,(.*)$/);
      resolve(m ? m[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Estado de cada item en la bandeja
const ESTADOS = {
  pendiente:   { label: 'Pendiente', color: 'b-gray',   icon: 'inbox' },
  procesando:  { label: 'Procesando', color: 'b-blue',  icon: 'refresh' },
  revisar:     { label: 'Listo para revisar', color: 'b-amber', icon: 'eye' },
  confirmado:  { label: 'Confirmado', color: 'b-green', icon: 'checkCircle' },
  error:       { label: 'Error', color: 'b-red',        icon: 'alertCircle' },
  duplicado:   { label: 'Duplicado', color: 'b-yellow', icon: 'alert' },
};

// ─── PANTALLA PRINCIPAL ──────────────────────────────────────
function CapturaMagicaPage({ showToast }) {
  const auth = window.__useAuth?.();
  const myRol = auth?.profile?.rol;
  const isAdmin = myRol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = isAdmin || (window.__hasPerm?.(myRol, 'Captura Mágica', 'w') ?? false);

  const { data: companies } = window.__hooks?.useCompanies?.() || { data: [] };
  const { data: obras } = window.__hooks?.useObras?.() || { data: [] };
  const { data: movs } = window.__hooks?.useAccountingMovements?.() || { data: [] };

  // [items] cada item = { id, file, name, status, base64, mimeType, parsed, error, review }
  // Se persisten en Dexie (tabla captura_magica_pending) hasta que el usuario
  // confirma o descarta — sobreviven navegación entre pestañas, recargas, y
  // cierre del browser.
  const [items, setItems] = uSCM([]);
  const [reviewing, setReviewing] = uSCM(null);
  // Cuando una factura recién registrada coincide con ingresos del almacén
  // marcados como pendiente_sustento del mismo proveedor, abrimos un modal
  // para que la contadora elija cuáles vincular. Se setea al final del
  // confirmarItem si hay matches.
  const [vincularPendientesModal, setVincularPendientesModal] = uSCM(null);
  const [proveedoresDB, setProveedoresDB] = uSCM([]);
  const [materialesDB, setMaterialesDB] = uSCM([]);
  // OCs activas (estados: por_confirmar | firmada | enviada | aceptada |
  // recibida_parcial) con sus items, para sugerir vinculación de facturas.
  const [ocsActivasDB, setOcsActivasDB] = uSCM([]); // [{ oc, items: [oc_items], company, proveedor }]
  const [cadenasActivasDB, setCadenasActivasDB] = uSCM([]); // cadenas en borrador o confirmadas (no facturadas/cerradas)
  const [restored, setRestored] = uSCM(false);
  const fileInputRef = uRCM(null);

  // ── Persistencia en Dexie ───────────────────────────────────
  const saveItemToDB = async (item) => {
    if (!item) return;
    try {
      // No persistimos confirmados (los borramos al confirmar)
      if (item.status === 'confirmado') return;
      const { file, ...rest } = item;
      await window.__db.captura_magica_pending.put({
        ...rest,
        // file_blob: persistimos el blob para reconstruir File luego
        file_blob: file || null,
        file_name: item.name,
        updated_at: new Date().toISOString(),
        created_at: item.created_at || new Date().toISOString(),
      });
    } catch (e) { console.warn('[captura-magica] saveItem', e); }
  };

  const deleteItemFromDB = async (id) => {
    try { await window.__db.captura_magica_pending.delete(id); } catch {}
  };

  // Cargar proveedores, materiales, e items pendientes al montar
  uECM(() => {
    let mounted = true;
    const cargar = async () => {
      try {
        const [p, m, pending, ocsAll, ocItemsAll, cadenas] = await Promise.all([
          window.__db.proveedores.filter(x => !x.deleted_at).toArray(),
          window.__db.materiales.filter(x => !x.deleted_at).toArray(),
          window.__db.captura_magica_pending.toArray(),
          // OCs en estados activos (esperando ser cubiertas por facturas)
          window.__db.ordenes_compra.filter(o => !o.deleted_at && [
            'por_confirmar', 'firmada', 'enviada', 'aceptada', 'recibida_parcial'
          ].includes(o.estado)).toArray(),
          window.__db.oc_items.filter(it => !it.deleted_at).toArray(),
          // Cadenas activas para detección intercompany
          window.__db.trazabilidad_cadenas.filter(c => !c.deleted_at && c.estado !== 'cerrada').toArray(),
        ]);
        if (!mounted) return;
        setProveedoresDB(p);
        setMaterialesDB(m);
        setCadenasActivasDB(cadenas);
        // Indexar oc_items por oc_id
        const itemsPorOc = {};
        ocItemsAll.forEach(it => {
          if (!itemsPorOc[it.orden_compra_id]) itemsPorOc[it.orden_compra_id] = [];
          itemsPorOc[it.orden_compra_id].push(it);
        });
        // Construir el array de OCs activas con sus items
        setOcsActivasDB(ocsAll.map(oc => ({ oc, items: itemsPorOc[oc.id] || [] })));
        // Reconstruir File desde blob persistido. Items que quedaron en
        // 'procesando' al cerrar la pestaña vuelven a 'pendiente' para
        // reintentar; el efecto de abajo los reprocesa.
        const restoredItems = (pending || []).map(it => {
          let file = null;
          if (it.file_blob instanceof Blob) {
            file = new File([it.file_blob], it.file_name || 'comprobante', { type: it.mimeType || 'application/pdf' });
          }
          const status = it.status === 'procesando' ? 'pendiente' : it.status;
          return { ...it, file, status };
        }).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        // MERGE, no reemplazo ciego: esta pestaña es la ÚNICA escritora de
        // captura_magica_pending y la persistencia estado→Dexie es asíncrona,
        // así que el estado en memoria siempre está al menos tan fresco como
        // el snapshot. Reemplazar a ciegas pisaba resultados recién llegados
        // de requests en vuelo (cargar() corre con cada jx_data_changed): la
        // fila volvía a 'pendiente' SIN parsed y, con reprocesoHecho=true y
        // enVuelo ya limpio, nadie la reprocesaba ('pendiente' no tiene botón
        // de reintento) → atascada hasta remontar la pestaña. Regla: para ids
        // ya en estado gana el estado; Dexie solo aporta ids que faltan.
        setItems(prev => {
          if (!prev.length) return restoredItems;
          const byId = new Map(prev.map(x => [x.id, x]));
          return restoredItems.map(r => byId.get(r.id) || r);
        });
        setRestored(true);
        // Re-procesar los que quedaron pendientes (sin parsed): UNA sola vez
        // (cargar() también corre con cada jx_data_changed — sin el guard se
        // re-disparaban los mismos archivos), EN SERIE (la ráfaga paralela
        // agotaba el rate limit de la API → 429) y con el ref fresco (el
        // closure del primer render tiene los catálogos vacíos).
        if (!reprocesoHecho.current) {
          reprocesoHecho.current = true;
          // Ceder un macrotask ANTES de la primera llamada del loop: React 19
          // batchea los setState de arriba y los commitea en una tarea aparte.
          // Sin este yield, el PRIMER item evalúa procesarItemRef.current
          // antes del re-render → closure pre-cargar con proveedoresDB/
          // materialesDB/ocsActivasDB/cadenasActivasDB vacíos (proveedor y
          // materiales sin matchear, sin sugerencia de OC/cadena). Los items
          // siguientes no lo necesitan (el await de la red deja commitear).
          // Si el orden de tareas no ayudara, es inocuo: queda como estaba.
          await new Promise(res => setTimeout(res, 0));
          for (const it of restoredItems) {
            // Si el componente se desmontó (navegación a otra pestaña), cortar:
            // los setItems serían no-op y el efecto de persistencia ya no corre
            // → cada request restante sería API gastada cuyo resultado se pierde
            // (y al volver se reprocesa igual). El remount retoma la cola con
            // un reprocesoHecho fresco.
            if (!mounted) break;
            if (it.status === 'pendiente' && it.file && !it.parsed) {
              await procesarItemRef.current(it.id, it.file);
            }
          }
        }
      } catch (e) {
        console.error('[captura-magica] carga DB', e);
        try { window.__showToast?.('Error cargando bandeja Captura Mágica: ' + (e.message || e), 'red'); } catch {}
        setRestored(true);
      }
    };
    cargar();
    const onCh = () => cargar();
    window.addEventListener('jx_data_changed', onCh);
    return () => { mounted = false; window.removeEventListener('jx_data_changed', onCh); };
  }, []);

  // Cuando el state items cambia, sincronizar en Dexie (después del primer load)
  uECM(() => {
    if (!restored) return;
    items.forEach(it => { saveItemToDB(it); });
  }, [items, restored]);

  // ── Drop zone handlers ──────────────────────────────────────
  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const nuevos = [];
    for (const f of files) {
      if (!ALLOWED_MIME.includes(f.type)) {
        showToast(`"${f.name}": tipo no soportado (solo PDF, JPG, PNG, WEBP)`, 'red');
        continue;
      }
      if (f.size > MAX_FILE_BYTES) {
        showToast(`"${f.name}": muy grande (máx 6 MB)`, 'red');
        continue;
      }
      nuevos.push({
        id: window.__newId(),
        file: f,
        name: f.name,
        size: f.size,
        mimeType: f.type,
        status: 'pendiente',
        base64: null,
        parsed: null,
        error: null,
        review: null,
        created_at: new Date().toISOString(),
      });
    }
    if (nuevos.length) {
      setItems(prev => [...nuevos, ...prev]);
      // Procesar cada uno (en serie para no saturar API)
      for (const it of nuevos) {
        await procesarItem(it.id, it.file);
      }
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  };
  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };

  // ── Llamada al endpoint ─────────────────────────────────────
  // Guard anti-duplicado: ids con request en vuelo (el listener de
  // jx_data_changed re-ejecuta cargar() y sin esto re-disparaba el MISMO
  // archivo en paralelo → ráfaga de 429 de la API).
  const enVuelo = uRCM(new Set());
  // Reproceso de pendientes restaurados: solo en el primer cargar() del mount.
  const reprocesoHecho = uRCM(false);
  const procesarItem = async (id, file) => {
    if (enVuelo.current.has(id)) return;
    enVuelo.current.add(id);
    setItems(prev => prev.map(x => x.id === id ? { ...x, status: 'procesando' } : x));
    try {
      const base64 = await fileToBase64(file);
      const { apiFetch } = await import('../lib/api-client');
      const resp = await apiFetch('/api/captura-magica', {
        method: 'POST',
        timeout: 90000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: base64, mimeType: file.type }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || data.detail || `HTTP ${resp.status}`);
      }
      const ext = data.extracted || {};
      // Detectar duplicado: mismo emisor RUC + serie_correlativo, NORMALIZADOS
      // (la foto y el XML de SUNAT traen el RUC/serie en formatos distintos → si
      // comparáramos exacto, el re-import digital de una factura ya subida como
      // foto se colaría como movimiento nuevo). Requiere RUC para no falsos +.
      const rucEmisorN = normalizarRuc(ext.emisor?.ruc);
      const compN = normalizarComprobante(ext.serie_correlativo);
      const dup = (rucEmisorN && compN) ? (movs || []).find(m =>
        !m.deleted_at &&
        normalizarRuc(m.third_party_ruc) === rucEmisorN &&
        normalizarComprobante(m.document_number) === compN
      ) : null;
      setItems(prev => prev.map(x => x.id === id ? {
        ...x,
        base64,
        parsed: ext,
        status: dup ? 'duplicado' : 'revisar',
        review: buildInitialReview(ext, companies, obras, proveedoresDB, materialesDB, ocsActivasDB, cadenasActivasDB),
        duplicate_of: dup?.id || null,
      } : x));
    } catch (e) {
      setItems(prev => prev.map(x => x.id === id ? {
        ...x, status: 'error', error: e.message || String(e),
      } : x));
    } finally {
      enVuelo.current.delete(id);
    }
  };
  // El restore al montar corre con el closure del PRIMER render (obras/
  // companies/proveedores aún vacíos) → el review salía con obra_id '' y
  // proveedor sin matchear. El ref siempre apunta a la versión fresca.
  const procesarItemRef = uRCM(null);
  // (declarado acá pero usado por el efecto de carga de arriba vía closure)

  procesarItemRef.current = procesarItem;

  // ── Build review state desde el JSON extraído ───────────────
  const buildInitialReview = (ext, companies, obras, proveedoresDB, materialesDB, ocsActivasDB, cadenasActivasDB) => {
    if (!ext) return null;
    // Emisor: puede ser proveedor externo O empresa nuestra (intercompany)
    const ruc = ext.emisor?.ruc || '';
    const rucN = normalizarRuc(ruc);   // matchear por RUC normalizado (no por formato/nombre)
    const proveedorMatch = rucN ? proveedoresDB.find(p => normalizarRuc(p.ruc) === rucN) : null;
    const emisorCompanyMatch = rucN ? (companies || []).find(c => normalizarRuc(c.ruc) === rucN && c.status === 'activa' && !c.deleted_at) : null;
    // Receptor (empresa del grupo)
    const rucRec = ext.receptor?.documento || '';
    const rucRecN = normalizarRuc(rucRec);
    const companyMatch = rucRecN ? (companies || []).find(c => normalizarRuc(c.ruc) === rucRecN && c.status === 'activa') : null;
    // Si emisor es nuestra empresa Y receptor es nuestra empresa → operación intercompany.
    const esIntercompany = !!(emisorCompanyMatch && companyMatch);
    // Si no hay match pero la factura sí tiene datos del receptor, autoseteamos
    // el modo "Crear nueva" pre-rellenado para que el usuario solo confirme.
    const hayDatosReceptor = !!(rucRec || ext.receptor?.razon_social_o_nombre);
    const autoCrearNueva = hayDatosReceptor && !companyMatch;
    // Obra: el contador siempre opera dentro de una obra. No hay selector
    // en la UI — se asume la obra activa del contexto. Fallback: primera
    // obra visible (si nunca se eligió ninguna).
    let obraSugerida = '';
    const obrasVisibles = (obras || []).filter(o => !o.deleted_at);
    const obraActivaId = (typeof window !== 'undefined' && window.__getObraActivaId)
      ? window.__getObraActivaId()
      : null;
    // OJO: NO validar contra `obras` del closure — en el primer render (y en
    // el restore del mount) el hook todavía no cargó y obras=[] anulaba un id
    // PERFECTAMENTE válido → "No hay obra activa" con obra activa. El id de
    // localStorage es la fuente de verdad; si la obra fue borrada, el selector
    // del modal de revisión permite corregirlo.
    if (obraActivaId) {
      obraSugerida = obraActivaId;
    } else if (obrasVisibles.length > 0) {
      obraSugerida = obrasVisibles[0].id;
    }
    // Items: match con materiales existentes
    const items = (ext.items || []).map((it, idx) => {
      const candidatos = materialesDB
        .map(m => ({ m, score: fuzzyScore(it.descripcion, m.nombre_material) }))
        .filter(x => x.score >= 0.5)
        .sort((a, b) => b.score - a.score);
      const top = candidatos[0];
      // Clasificar el insumo en uno de los 4 grupos: material / herramienta
      // / epp / maquinaria / servicio. Esto define en qué tabla se va a
      // crear el catálogo si el contador marca "Crear materiales".
      const tipoInsumo = clasificarInsumo(it.descripcion || '');
      return {
        ...it,
        idx,
        material_id: top ? top.m.id : '',
        accion_material: top ? 'usar_existente' : 'crear_nuevo',
        unidad: it.unidad || top?.m.unidad || 'und',
        tipo_insumo: tipoInsumo,
      };
    });
    return {
      tipo_documento: ext.tipo_documento || 'factura',
      serie_correlativo: ext.serie_correlativo || '',
      fecha_emision: ext.fecha_emision || new Date().toISOString().slice(0,10),
      moneda: ext.moneda || 'PEN',
      // Proveedor
      proveedor_id: proveedorMatch?.id || '',
      proveedor_accion: proveedorMatch ? 'usar_existente' : 'crear_nuevo',
      proveedor_ruc: ruc,
      proveedor_razon_social: ext.emisor?.razon_social || '',
      proveedor_direccion: ext.emisor?.direccion || '',
      // Receptor
      company_id: companyMatch?.id || '',
      company_accion: autoCrearNueva ? 'crear_nueva' : 'usar_existente',
      receptor_documento: rucRec,
      receptor_razon_social: ext.receptor?.razon_social_o_nombre || '',
      // Form pre-rellenado para "crear nueva empresa" con los datos del receptor
      nueva_company_ruc: rucRec || '',
      nueva_company_name: ext.receptor?.razon_social_o_nombre || '',
      nueva_company_legal: ext.receptor?.razon_social_o_nombre || '',
      nueva_company_direccion: ext.receptor?.direccion || '',
      nueva_company_rol: 'origen',
      nueva_company_rubro: 'distribuidora_materiales',
      // Obra / destino de la compra: la obra activa por defecto; el usuario puede elegir
      // otra obra o "Gastos Generales de la Empresa" ('__empresa__') en el selector.
      obra_id: obraSugerida,
      obra_destino: obraSugerida || '',
      // Items
      items,
      // Totales
      subtotal: Number(ext.totales?.subtotal || 0),
      igv: Number(ext.totales?.igv || 0),
      total: Number(ext.totales?.total || 0),
      observaciones: ext.observaciones || '',
      confianza: ext.confianza || 'media',
      // La IA a veces marca mal "fecha futura" (su 'hoy' interno no es el real,
      // p.ej. dice que el 17/05 es futuro estando en junio). Recalculamos la
      // advertencia de fecha en el cliente, que sí tiene la fecha real del SO.
      advertencias: (() => {
        const hoy = new Date().toISOString().slice(0, 10);
        const fe = ext.fecha_emision || hoy;
        const base = (ext.advertencias || []).filter(a => !/futur|posterior a la fecha|adelant/i.test(String(a)));
        if (fe > hoy) base.unshift(`La fecha de emisión (${fe}) es posterior a hoy (${hoy}); verificá si es correcta.`);
        return base;
      })(),
      // La CREACIÓN de insumos NO la hace el contador: queda para el almacenero
      // en "Compras pendientes" (ahí decide crear o vincular). Acá solo se marca
      // la factura como pendiente de recepción. Si el comprobante NO es de almacén
      // (combustible, servicios, fletes), el contador desactiva ese checkbox.
      crear_materiales_catalogo: false,
      genera_recepcion_almacen: true,
      metodo_pago: null,
      payment_status: 'pending',
      // Legacy: si llega un payload viejo lo respetamos pero la UI ya no
      // expone este flag — los movimientos de inventario los crea el
      // almacenero al confirmar recepción, no la captura mágica.
      crear_movimiento_materiales: false,
      // ── Detección de OC relacionada ─────────────────────────
      // Buscamos entre las OCs activas (por_confirmar/firmada/enviada/...)
      // candidatos cuyos items hagan match fuzzy con los items de la factura.
      // Filtramos por:
      //  · empresa receptora (company_id) si fue identificada
      //  · proveedor (oc.proveedor_id == proveedor matched por RUC)
      // Para cada candidata, calculamos cuántos items de la factura matchean
      // con oc_items. Si match_count >= 1 y al menos 50% de los items, es candidata.
      ...(() => {
        const ocsRelacionadas = (ocsActivasDB || []).map(({ oc, items: ocItems }) => {
          // Filtros previos: empresa o proveedor coincide
          let scoreFiltro = 0;
          if (companyMatch && oc.obra_id) {
            // La OC pertenece a una obra cuya ejecutora es la empresa receptora — fuerte
            const obraOC = (obras || []).find(o => o.id === oc.obra_id);
            if (obraOC && (obraOC.ejecutora_company_id === companyMatch.id ||
              (obraOC.ejecutora_tipo === 'consorcio' && (obraOC.consorcio_miembros||[]).some(m => m.company_id === companyMatch.id)))) {
              scoreFiltro += 0.5;
            }
          }
          if (proveedorMatch && oc.proveedor_id === proveedorMatch.id) {
            scoreFiltro += 0.5;
          }
          // Si no hay match ni de empresa ni de proveedor, descartar (no es candidata fuerte)
          if (scoreFiltro === 0) return null;
          // Match items: por cada item de la factura, busco match con oc_items
          const matches = (ext.items || []).map((fItem, fIdx) => {
            const candidatos = (ocItems || []).map(ocIt => {
              // Comparar por descripción (oc_items tiene nombre_libre o por material_id)
              const ocNombre = ocIt.material_id
                ? (materialesDB.find(m => m.id === ocIt.material_id)?.nombre_material || ocIt.nombre_libre || '')
                : (ocIt.nombre_libre || '');
              return { ocIt, score: fuzzyScore(fItem.descripcion, ocNombre) };
            }).filter(x => x.score >= 0.55).sort((a, b) => b.score - a.score);
            return candidatos[0] ? { factura_idx: fIdx, oc_item: candidatos[0].ocIt, score: candidatos[0].score } : null;
          }).filter(Boolean);
          if (matches.length === 0) return null;
          return {
            oc_id: oc.id,
            oc_codigo: oc.codigo,
            oc_estado: oc.estado,
            oc_total: oc.monto_total,
            proveedor_id: oc.proveedor_id,
            score_filtro: scoreFiltro,
            matches,
            ratio: matches.length / Math.max(1, (ext.items || []).length),
          };
        }).filter(Boolean).sort((a, b) => (b.score_filtro + b.ratio) - (a.score_filtro + a.ratio));

        // Tomamos la mejor candidata (si existe). El usuario podrá descartarla.
        const mejorOC = ocsRelacionadas[0] || null;
        return {
          // null si no hay candidata; objeto si hay
          oc_match: mejorOC,
          oc_match_alternativas: ocsRelacionadas.slice(1, 4), // hasta 3 alternativas
          // Por default: si la mejor candidata cubre ≥70% de items, sugerir vinculación
          vincular_a_oc: mejorOC && mejorOC.ratio >= 0.7 ? mejorOC.oc_id : null,
        };
      })(),
      // ── Detección INTERCOMPANY ──────────────────────────────
      // Si emisor y receptor son ambas nuestras empresas, es trazabilidad interna.
      es_intercompany: esIntercompany,
      emisor_company_id: emisorCompanyMatch?.id || null,
      // Cadenas candidatas: aquellas con un paso seller=emisor → buyer=receptor sin facturar.
      ...(() => {
        if (!esIntercompany) return { cadena_candidatas: [], vincular_a_cadena_step: null };
        const candidatas = (cadenasActivasDB || []).filter(c => {
          if (c.deleted_at || c.estado === 'cerrada') return false;
          const eslabones = c.eslabones || [];
          for (let i = 0; i < eslabones.length - 1; i++) {
            if (eslabones[i].company_id === emisorCompanyMatch.id &&
                eslabones[i + 1].company_id === companyMatch.id) {
              return true;
            }
          }
          return false;
        }).map(c => {
          const eslabones = c.eslabones || [];
          let stepIdx = -1;
          for (let i = 0; i < eslabones.length - 1; i++) {
            if (eslabones[i].company_id === emisorCompanyMatch.id &&
                eslabones[i + 1].company_id === companyMatch.id) {
              stepIdx = i; break;
            }
          }
          return {
            chain_id: c.id,
            item_nombre: c.item_nombre,
            cantidad: c.cantidad,
            unidad: c.unidad,
            estado: c.estado,
            paso_idx: stepIdx,
            paso_total: Math.max(0, eslabones.length - 1),
          };
        });
        return {
          cadena_candidatas: candidatas,
          vincular_a_cadena_step: candidatas[0] ? { chain_id: candidatas[0].chain_id, paso_idx: candidatas[0].paso_idx } : null,
        };
      })(),
    };
  };

  // ── Confirmar e insertar en DB ──────────────────────────────
  const enProcesoRef = uRCM(new Set());   // ids de items en confirmación (anti doble-submit)
  const confirmarItem = async (id) => {
    const it = items.find(x => x.id === id);
    if (!it || !it.review) return;
    let r = it.review;
    // Destino de la compra: la OBRA elegida en el selector (r.obra_destino), o "Gastos
    // Generales de la Empresa" ('__empresa__') → sin obra (gasto de la empresa). Si la obra
    // elegida ya no existe, cae a "sin obra" (queda solo en contabilidad).
    {
      const dest = r.obra_destino;
      if (dest === '__empresa__') {
        r = { ...r, obra_id: '' };
      } else {
        const valida = dest && (obras || []).some(o => o.id === dest && !o.deleted_at);
        r = { ...r, obra_id: valida ? dest : '' };
      }
    }

    // ¿VENTA o COMPRA? Si el EMISOR de la factura es UNA DE NUESTRAS empresas afiliadas,
    // la emitimos nosotros como vendedores → VENTA. Si la emite una distribuidora/proveedor
    // externo → COMPRA (le compramos). Captura Mágica ya matcheó el emisor (r.emisor_company_id).
    const esVenta = !!r.emisor_company_id;

    // Validaciones
    if (esVenta) {
      // VENTA: la empresa es el EMISOR (ya matcheado, nuestra). El receptor es el cliente
      // (puede ser externo) → no exigimos "empresa compradora del grupo".
    } else if (r.company_accion === 'crear_nueva') {
      if (!r.nueva_company_name?.trim()) { showToast('Falta nombre de la empresa nueva', 'red'); return; }
    } else if (!r.company_id) {
      showToast('Falta empresa compradora del grupo', 'red'); return;
    }
    if (!r.serie_correlativo) { showToast('Falta serie-correlativo', 'red'); return; }
    if (!(Number(r.total) > 0)) { showToast('El total debe ser mayor a 0', 'red'); return; }

    // ── Guard anti-duplicado de comprobante (COMPRAS) ──
    // Re-chequea FRESCO contra la BD: `movs` puede estar desactualizado y, al
    // importar un lote de SUNAT, dos archivos pueden ser el mismo comprobante o
    // una factura ya subida como foto. Si ya existe el movimiento (mismo emisor +
    // serie-correlativo NORMALIZADOS), NO crea otro → evita los dos movimientos.
    if (!esVenta) {
      const compN = normalizarComprobante(r.serie_correlativo);
      const rucN = normalizarRuc(r.proveedor_ruc);
      if (compN && rucN) {
        const dupMov = (await window.__db.accounting_movements
          .filter(m => !m.deleted_at &&
            normalizarComprobante(m.document_number) === compN &&
            normalizarRuc(m.third_party_ruc) === rucN)
          .toArray())[0];
        if (dupMov) {
          setItems(prev => prev.map(x => x.id === id ? { ...x, status: 'duplicado', duplicate_of: dupMov.id } : x));
          showToast(`Ya existe el comprobante ${r.serie_correlativo} de ese proveedor (${dupMov.date || 's/fecha'} · S/ ${Number(dupMov.amount || 0).toLocaleString('es-PE')}). No se creó un duplicado — descartá este archivo.`, 'red');
          return;
        }
      }
    }

    // Obra: se pre-popula con la obra activa del contexto. Si el usuario
    // explícitamente la deja en "Sin obra (gasto general)", interpretamos
    // que es un gasto contable puro y los items NO se insertan en almacén
    // (aunque los checkboxes estén marcados). Solo avisamos por toast.
    const algunItemRealAlmacen = (r.items || []).some(it =>
      it.tipo_insumo && it.tipo_insumo !== 'servicio'
    );
    if (algunItemRealAlmacen && (r.crear_materiales_catalogo || r.genera_recepcion_almacen) && !r.obra_id) {
      if (r.obra_destino === '__empresa__') {
        // Elección deliberada: gasto general de la empresa → no es un descuido.
        showToast('Gasto general de la empresa: los items quedan solo en contabilidad (sin almacén de obra).', 'blue');
      } else {
        showToast('Sin obra: los items quedaron solo en contabilidad, no se crearon en almacén.', 'orange');
      }
    }

    const now = new Date().toISOString();
    let proveedorIdFinal = r.proveedor_id;
    let companyIdFinal = r.company_id;

    // Guard anti doble-submit: si este item ya se está confirmando, no lo
    // proceses otra vez (evitaba el race que creó empresas/proveedores duplicados).
    if (enProcesoRef.current.has(id)) return;
    enProcesoRef.current.add(id);
    try {
      // 0) Crear empresa del grupo si nueva. El review se arma al EXTRAER la
      // factura: si otra factura ya creó esa empresa (mismo RUC) en el ínterin,
      // el review sigue diciendo "crear nueva". Acá re-chequeamos contra Dexie
      // FRESCO por RUC y REUSAMOS la existente en vez de duplicarla (companies no
      // tiene unique(ruc) en el server, así que duplicaba libremente).
      if (esVenta) {
        // VENTA: la empresa del movimiento es NUESTRO emisor (ya existe en companies).
        companyIdFinal = r.emisor_company_id;
      } else if (r.company_accion === 'crear_nueva') {
        // RUC normalizado (solo dígitos): el dedup compara por DOCUMENTO, no por nombre
        // (el bug de Gasomi: mismo RUC, nombre MAYÚS vs minús → 2 empresas).
        const rucC = normalizarRuc(r.nueva_company_ruc);
        const yaExiste = rucC
          ? (await window.__db.companies.filter(c => !c.deleted_at && normalizarRuc(c.ruc) === rucC).toArray())
              .sort((a, b) => (a.status === 'activa' ? -1 : 1) - (b.status === 'activa' ? -1 : 1))[0]
          : null;
        if (yaExiste) { companyIdFinal = yaExiste.id; }
        else {
        const cid = window.__newId();
        await window.__db.companies.add({
          id: cid,
          name: r.nueva_company_name.trim(),
          legal_name: r.nueva_company_legal?.trim() || r.nueva_company_name.trim(),
          ruc: rucC || null,
          company_type: 'comercial',
          status: 'activa',
          rubro: r.nueva_company_rubro || null,
          rol_grupo: r.nueva_company_rol || 'origen',
          regimen_tributario: 'RG',
          margen_objetivo_pct: null,
          direccion: r.nueva_company_direccion || null,
          notas: 'Creada automáticamente desde Captura Mágica',
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create',
          // Determinístico por RUC: si dos capturas/dispositivos crean la misma
          // empresa (race que el dedup por RUC fresco no alcanzó), el UNIQUE de
          // companies.idempotency_key del server rechaza la 2ª y NO duplica. Antes
          // embebía el id nuevo (`_company_${cid}`) → nunca deduplicaba (bug de las
          // 3 TEATINO MARTINEZ). Sin RUC, cae al key por instancia.
          idempotency_key: rucC ? `company_ruc_${rucC}` : `${userId}_company_${cid}`,
        });
        try { await window.__logAudit?.({ action:'insert', table:'companies', recordId: cid,
          newData: { name: r.nueva_company_name, ruc: r.nueva_company_ruc, rol_grupo: r.nueva_company_rol },
          reason:'Captura mágica · empresa nueva del grupo' }); } catch {}
        companyIdFinal = cid;
        }
      }

      // 1) Crear proveedor si nuevo (mismo dedup por RUC fresco que la empresa).
      //    Solo en COMPRAS: en una venta el "emisor" es nuestra empresa, no un proveedor.
      if (!esVenta && r.proveedor_accion === 'crear_nuevo') {
        const rucP = normalizarRuc(r.proveedor_ruc);
        const provExiste = rucP
          ? (await window.__db.proveedores.filter(p => !p.deleted_at && normalizarRuc(p.ruc) === rucP).toArray())[0]
          : null;
        if (provExiste) { proveedorIdFinal = provExiste.id; }
        else {
        if (!r.proveedor_razon_social?.trim()) {
          showToast('Falta razón social del proveedor', 'red'); return;
        }
        const pid = window.__newId();
        await window.__db.proveedores.add({
          id: pid,
          razon_social: r.proveedor_razon_social.trim(),
          ruc: rucP || null,
          direccion: r.proveedor_direccion || null,
          estado: 'activo',
          tipo_proveedor: 'proveedor',
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create',
          // Determinístico por RUC: el UNIQUE(ruc) y el idempotency_key del server
          // (+ reconciliarProveedorDuplicado en 23505) deduplican aunque dos capturas
          // offline creen el mismo proveedor. Sin RUC, cae al key por instancia.
          idempotency_key: rucP ? `prov_ruc_${rucP}` : `${userId}_prov_${pid}`,
        });
        try { await window.__logAudit?.({ action:'insert', table:'proveedores', recordId: pid,
          newData: { ruc: r.proveedor_ruc, razon: r.proveedor_razon_social }, reason:'Captura mágica · crear proveedor' }); } catch {}
        proveedorIdFinal = pid;
        }
      }

      // 2) Crear insumos nuevos en su tabla correspondiente, SIN stock.
      //    El movimiento de ingreso al almacén lo crea el almacenero
      //    cuando confirme la recepción física.
      //    Cada item tiene un `tipo_insumo` que define en qué tabla va:
      //      'material'    → materiales
      //      'herramienta' → herramientas
      //      'epp'         → epps
      //      'maquinaria'  → activos_pesados
      //      'servicio'    → no se crea (combustible, fletes, etc.)
      const materialesCreados = [];
      const movsMatCreados = []; // queda vacío — el almacenero los crea

      if (!esVenta && r.crear_materiales_catalogo && r.obra_id) {
        for (const it of r.items) {
          if (it.accion_material !== 'crear_nuevo') continue;
          if (!it.descripcion?.trim()) continue;
          const tipo = it.tipo_insumo || clasificarInsumo(it.descripcion);
          const tablaDestino = TIPO_INSUMO_TABLA[tipo];
          if (!tablaDestino) {
            // Servicio / gasto: no se crea en inventario, solo se registra
            // como costo en el accounting_movement.
            continue;
          }
          try {
            const newId = window.__newId();
            const nombre = it.descripcion.trim().slice(0, 120);
            const precio = Number(it.precio_unitario) || 0;
            const idemKey = `${userId}_${tipo}_${newId}`;
            const baseCommon = {
              id: newId,
              obra_id: r.obra_id,
              unidad: it.unidad || 'und',
              estado: 'activo',
              created_by: userId, updated_by: userId,
              created_at: now, updated_at: now,
              version: 1, sync_status: 'pending_create',
              idempotency_key: idemKey,
            };

            if (tipo === 'material') {
              await window.__db.materiales.add({
                ...baseCommon,
                nombre_material: nombre,
                categoria: 'Otro',
                stock_inicial: 0, stock_actual: 0, stock_minimo: 0,
                precio_unitario_estimado: precio,
                alerta: 'sin_stock',
                proveedor_principal_id: proveedorIdFinal || null,
              });
            } else if (tipo === 'herramienta') {
              await window.__db.herramientas.add({
                ...baseCommon,
                nombre_herramienta: nombre,
                tipo: 'manual',
                marca: null, modelo: null,
                costo_referencial: precio || null,
                disponible: false, // sin stock — espera recepción
                ubicacion_actual: 'pendiente',
                estado_actual: 'nuevo',
                proveedor_principal_id: proveedorIdFinal || null,
              });
            } else if (tipo === 'epp') {
              const tipoEppDetectado = epppTipo(it.descripcion) || { tipo: 'Otro', vida_util_dias: null };
              await window.__db.epps.add({
                ...baseCommon,
                nombre_epp: nombre,
                tipo_epp: tipoEppDetectado.tipo || 'Otro',
                vida_util_dias: tipoEppDetectado.vida_util_dias || null,
                stock_inicial: 0, stock_actual: 0, stock_minimo: 0,
                precio_unitario_estimado: precio,
                alerta: 'sin_stock',
                proveedor_principal_id: proveedorIdFinal || null,
              });
            } else if (tipo === 'maquinaria') {
              await window.__db.activos_pesados.add({
                ...baseCommon,
                codigo: `MAQ-${newId.slice(0, 6).toUpperCase()}`,
                nombre,
                tipo: 'maquinaria',
                marca: null, modelo: null, anio: null, placa: null, serie: null,
                costo_adquisicion: precio || null,
                fecha_adquisicion: r.fecha_emision || null,
                estado: 'activo',
                hm_acumuladas: 0,
                company_id: companyIdFinal,
                obra_actual_id: r.obra_id,
              });
            }
            // Vincular el item al id recién creado para que la recepción
            // (vía Compras Pendientes) sepa a qué registro pertenece.
            it.material_id = newId;
            materialesCreados.push({ id: newId, tipo, tabla: tablaDestino });
            try { await window.__logAudit?.({
              action: 'insert', table: tablaDestino, recordId: newId,
              newData: { nombre, tipo, sin_stock: true },
              reason: `Captura mágica · ${tipo} nuevo (sin stock)`,
            }); } catch {}
          } catch (e) {
            console.warn('[captura magica · crear insumo]', e?.message);
          }
        }
      }

      // 3) Accounting movement (cost) + posible vinculación con OC
      const accId = window.__newId();
      const tipoAcc = TIPO_DOC_MAP[r.tipo_documento]?.acc || 'factura';
      // COMPRA: tercero = proveedor (emisor externo), type=cost. VENTA: tercero = receptor
      // (cliente), type=income, company = nuestro emisor. La venta NO genera recepción de almacén.
      const claseFinal = esVenta ? 'venta' : 'compra';
      const typeFinal = esVenta ? 'income' : 'cost';
      const terceroNombre = esVenta ? (r.receptor_razon_social || null) : (r.proveedor_razon_social || null);
      const terceroRuc = esVenta ? (r.receptor_documento || null) : (r.proveedor_ruc || null);
      const docLabel = TIPO_DOC_MAP[r.tipo_documento]?.label || 'Factura';
      await window.__db.accounting_movements.add({
        id: accId,
        company_id: companyIdFinal,
        obra_id: r.obra_id || null,
        clase: claseFinal,
        // Operación interna del grupo (emisor Y receptor son empresas nuestras): debe
        // marcarse SIEMPRE, no solo si se vinculó a una cadena de trazabilidad. Si no,
        // una venta intercompany sin cadena se cuenta como ingreso real (infla ventas).
        is_intercompany: !!r.es_intercompany,
        related_company_id: r.es_intercompany ? (r.company_id || null) : null,
        date: r.fecha_emision,
        type: typeFinal,
        category: docLabel,
        description: `${docLabel} ${r.serie_correlativo} · ${terceroNombre || ''}`,
        amount: Number(r.total) || 0,
        currency: r.moneda || 'PEN',
        third_party_name: terceroNombre,
        third_party_ruc: terceroRuc,
        // Nuevos: método y estado de pago (registrados desde la UI).
        // Si el contador no eligió, usamos defaults razonables.
        metodo_pago: r.metodo_pago || null,
        payment_status: r.payment_status || 'pending',
        // Recepción de almacén: solo en COMPRAS con obra (una venta no ingresa al almacén).
        recepcion_status: (!esVenta && r.genera_recepcion_almacen && r.obra_id && r.items?.length > 0)
          ? 'pendiente_recepcion'
          : 'no_aplica',
        document_type: tipoAcc,
        document_number: r.serie_correlativo,
        proveedor_id: proveedorIdFinal || null,
        // Si el usuario eligió vincular a una OC, lo registramos en el mov contable
        orden_compra_id: r.vincular_a_oc || null,
        notas: JSON.stringify({
          captura_magica: true,
          confianza: r.confianza,
          advertencias: r.advertencias,
          subtotal: r.subtotal, igv: r.igv,
          materiales_creados: materialesCreados.length,
          movs_creados: movsMatCreados.length,
          oc_vinculada: r.vincular_a_oc || null,
          // Persistimos los items detectados con sus material_id (los
          // recién creados ya tienen el id). El almacenero los usa para
          // pre-llenar el modal de ingreso cuando confirma la recepción.
          items_factura: (r.items || []).map(it => ({
            material_id: it.material_id || null,
            descripcion: it.descripcion || it.nombre || '',
            unidad: it.unidad || 'und',
            cantidad: Number(it.cantidad) || 0,
            precio_unitario: Number(it.precio_unitario) || 0,
            tipo_insumo: it.tipo_insumo || 'material',
            // 'destino' (obra/empresa) lo clasifica el contador en "Insumos Comprados".
          })),
        }),
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create',
        idempotency_key: `${userId}_acc_${accId}`,
      });
      try { await window.__logAudit?.({ action:'insert', table:'accounting_movements', recordId: accId,
        newData: { tipo: r.tipo_documento, doc: r.serie_correlativo, total: r.total, oc: r.vincular_a_oc },
        reason:'Captura mágica · ingreso comprobante' + (r.vincular_a_oc ? ' (vinculado a OC)' : '') }); } catch {}

      // 3.5) VINCULAR A OC: actualizar cantidad_recibida en oc_items + recalcular estado
      if (r.vincular_a_oc && r.oc_match) {
        try {
          // 3.5.a) Crear recepción formal (uno solo por confirmación)
          const recepcionId = window.__newId();
          await window.__db.recepciones.add({
            id: recepcionId,
            orden_compra_id: r.vincular_a_oc,
            fecha: r.fecha_recepcion || r.fecha_emision || now.slice(0, 10),
            guia_remision: r.guia_remision || null,
            factura_ref: r.serie_correlativo || null,
            accounting_movement_id: accId,
            observaciones: `Recepción por factura ${r.serie_correlativo || ''} (Captura Mágica)`.trim(),
            created_by: userId, updated_by: userId,
            created_at: now, updated_at: now,
            version: 1, sync_status: 'pending_create', last_synced_at: null,
            idempotency_key: `${userId}_rec_${recepcionId}`,
            deleted_at: null,
          });

          // Para cada match (factura_idx → oc_item), sumar la cantidad de la
          // factura a cantidad_recibida del oc_item correspondiente + crear recepcion_item.
          const diffsPrecio = []; // se acumulan diferencias significativas para audit
          for (const m of r.oc_match.matches) {
            const facturaItem = r.items[m.factura_idx];
            if (!facturaItem) continue;
            const ocItem = await window.__db.oc_items.get(m.oc_item.id);
            if (!ocItem) continue;
            const recibidaPrev = Number(ocItem.cantidad_recibida || 0);
            const cantNueva = Number(facturaItem.cantidad || 0);
            const ocPU = Number(ocItem.precio_unitario || 0);
            const facPU = Number(facturaItem.precio_unitario || 0);
            const pct = ocPU > 0 && facPU > 0 ? ((facPU - ocPU) / ocPU) * 100 : 0;
            if (Math.abs(pct) >= 5) {
              diffsPrecio.push({ material_id: ocItem.material_id, ocPU, facPU, pct: +pct.toFixed(2) });
            }
            await window.__db.oc_items.update(m.oc_item.id, {
              cantidad_recibida: recibidaPrev + cantNueva,
              updated_at: now,
              version: (ocItem.version || 0) + 1,
              sync_status: ocItem.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
            });
            // Crear recepcion_item ligando este oc_item con la cantidad recibida
            const recItemId = window.__newId();
            await window.__db.recepcion_items.add({
              id: recItemId,
              recepcion_id: recepcionId,
              oc_item_id: m.oc_item.id,
              material_id: ocItem.material_id || null,
              cantidad_recibida: cantNueva,
              precio_unitario_factura: facPU || null,
              diferencia_precio_pct: Math.abs(pct) >= 1 ? +pct.toFixed(2) : null,
              observaciones: Math.abs(pct) >= 5 ? `Precio distinto a OC (${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)` : null,
              created_by: userId, updated_by: userId,
              created_at: now, updated_at: now,
              version: 1, sync_status: 'pending_create', last_synced_at: null,
              idempotency_key: `${userId}_recit_${recItemId}`,
              deleted_at: null,
            });
          }
          if (diffsPrecio.length > 0) {
            try { await window.__logAudit?.({ action:'price_diff', table:'recepciones', recordId: recepcionId,
              newData: { diffs: diffsPrecio, factura: r.serie_correlativo, oc_id: r.vincular_a_oc },
              reason:`${diffsPrecio.length} ítem(s) con diferencia de precio ≥5% entre OC y factura` }); } catch {}
          }
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'recepciones' } })); } catch {}
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'recepcion_items' } })); } catch {}
          // Recalcular estado de la OC: si todos los items tienen
          // cantidad_recibida >= cantidad → estado = 'recibida' (Comprada).
          // Si al menos uno tiene cantidad_recibida > 0 pero no todo cubierto
          // → 'recibida_parcial' (Comprada parcial).
          const todosOcItems = await window.__db.oc_items
            .where('orden_compra_id').equals(r.vincular_a_oc)
            .filter(x => !x.deleted_at)
            .toArray();
          const todosCubiertos = todosOcItems.every(it => Number(it.cantidad_recibida || 0) >= Number(it.cantidad || 0));
          const algunoConRecepcion = todosOcItems.some(it => Number(it.cantidad_recibida || 0) > 0);
          const ocOriginal = await window.__db.ordenes_compra.get(r.vincular_a_oc);
          if (ocOriginal) {
            const nuevoEstadoOC = todosCubiertos ? 'recibida'
              : algunoConRecepcion ? 'recibida_parcial'
              : ocOriginal.estado;
            if (nuevoEstadoOC !== ocOriginal.estado) {
              await window.__db.ordenes_compra.update(r.vincular_a_oc, {
                estado: nuevoEstadoOC,
                updated_at: now,
                version: (ocOriginal.version || 0) + 1,
                sync_status: ocOriginal.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
              });
              try { await window.__logAudit?.({ action:'update', table:'ordenes_compra', recordId: r.vincular_a_oc,
                oldData:{ estado: ocOriginal.estado }, newData:{ estado: nuevoEstadoOC, factura: r.serie_correlativo },
                reason:`OC ${ocOriginal.codigo} → ${nuevoEstadoOC} por factura vinculada via Captura Mágica` }); } catch {}
              try { window.dispatchEvent(new CustomEvent('jarvex_new_notif', {
                detail: {
                  tipo: 'oc_actualizada',
                  titulo: `OC ${ocOriginal.codigo} → ${nuevoEstadoOC === 'recibida' ? 'Comprada' : 'Comprada parcial'}`,
                  descripcion: `Factura ${r.serie_correlativo} cubrió ${r.oc_match.matches.length}/${todosOcItems.length} items`,
                }
              })); } catch {}
            }
          }
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'ordenes_compra' } })); } catch {}
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'oc_items' } })); } catch {}
        } catch (e) {
          console.warn('[captura-magica] vincular OC', e);
          showToast('Factura registrada, pero hubo un problema actualizando la OC: ' + (e.message || e), 'amber');
        }
      }

      // 4) Evidencia (PDF/imagen) — guardada en accounting_movements y, si hay
      // OC vinculada, también ligada a ordenes_compra para que sea visible
      // desde la vista de la OC (no solo desde Captura Mágica).
      try {
        const evId = window.__newId();
        await window.__saveEvidenciaLocal?.({
          id: evId,
          obra_id: r.obra_id || null,
          tipo_evidencia: 'comprobante_captura',
          modulo_relacionado: 'accounting_movements',
          registro_relacionado_id: accId,
          nombre_archivo: it.name,
          mime_type: it.mimeType,
          blob: it.file,
          fecha: r.fecha_emision,
          observaciones: `Captura Mágica · ${r.serie_correlativo}`,
          created_by: userId,
        });
        if (r.vincular_a_oc) {
          // Segunda fila en evidencias apuntando a la OC. Reutilizamos el MISMO
          // blob_id (= evId) para no duplicar el archivo en IndexedDB.
          const evIdOC = window.__newId();
          await window.__db.evidencias.put({
            id: evIdOC,
            obra_id: r.obra_id || null,
            tipo_evidencia: 'comprobante_captura',
            modulo_relacionado: 'ordenes_compra',
            registro_relacionado_id: r.vincular_a_oc,
            nombre_archivo: it.name,
            mime_type: it.mimeType,
            tamano_bytes: it.file?.size || 0,
            url_archivo: null,
            local_path_temporal: `idb://evidencias_blobs/${evId}`,
            blob_ref: evId, // referencia al blob compartido
            subido_por: userId,
            fecha: r.fecha_emision || new Date().toISOString().slice(0, 10),
            observaciones: `Factura ${r.serie_correlativo} (vinculada via Captura Mágica)`,
            sync_status: 'pending_create',
            upload_retries: 0,
            created_by: userId,
            created_at: now, updated_at: now,
          });
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'evidencias' } })); } catch {}
        }
      } catch (e) { console.warn('[captura-magica] evidencia', e); }

      // 4.5) VINCULAR A CADENA DE TRAZABILIDAD (operación intercompany).
      // Si el user marcó vincular_a_cadena_step, marcamos la factura interna
      // borrador correspondiente como "recibida" y archivamos la evidencia
      // contra la cadena.
      if (r.es_intercompany && r.vincular_a_cadena_step?.chain_id) {
        try {
          const facMod = await import('../lib/facturas-internas.js');
          const todasFacturas = await facMod.listarFacturasDeCadena(r.vincular_a_cadena_step.chain_id);
          const pasoTarget = todasFacturas.find(p => p.step === r.vincular_a_cadena_step.paso_idx);
          if (pasoTarget?.income?.id) {
            await facMod.marcarFacturaRecibida(pasoTarget.income.id, userId, accId);
          }
          // Etiquetar el accounting_movement creado como vinculado a cadena
          await window.__db.accounting_movements.update(accId, {
            chain_id: r.vincular_a_cadena_step.chain_id,
            chain_step_index: r.vincular_a_cadena_step.paso_idx,
            is_intercompany: true,
            updated_at: now,
            sync_status: 'pending_update',
          });
          try { await window.__logAudit?.({ action:'update', table:'trazabilidad_cadenas', recordId: r.vincular_a_cadena_step.chain_id,
            newData: { paso_recibido: r.vincular_a_cadena_step.paso_idx, factura: r.serie_correlativo, accounting_movement_id: accId },
            reason:`Factura ${r.serie_correlativo} vinculada a paso ${r.vincular_a_cadena_step.paso_idx + 1} de cadena via Captura Mágica` }); } catch {}
          try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'trazabilidad_cadenas' } })); } catch {}
          showToast(`✓ Paso ${r.vincular_a_cadena_step.paso_idx + 1} de la cadena marcado como recibido`, 'green');
        } catch (e) {
          console.warn('[captura-magica] vincular cadena', e);
          showToast('Factura registrada, pero falló la vinculación a la cadena: ' + (e.message || e), 'amber');
        }
      }

      // Marca como confirmado y borra de Dexie (el usuario ya lo procesó)
      setItems(prev => prev.map(x => x.id === id ? { ...x, status: 'confirmado', accId } : x));
      deleteItemFromDB(id);
      // Refrescar proveedores/materiales/OCs locales
      try {
        const [p, m, ocsAll, ocItemsAll] = await Promise.all([
          window.__db.proveedores.filter(x => !x.deleted_at).toArray(),
          window.__db.materiales.filter(x => !x.deleted_at).toArray(),
          window.__db.ordenes_compra.filter(o => !o.deleted_at && [
            'por_confirmar', 'firmada', 'enviada', 'aceptada', 'recibida_parcial'
          ].includes(o.estado)).toArray(),
          window.__db.oc_items.filter(it => !it.deleted_at).toArray(),
        ]);
        setProveedoresDB(p);
        setMaterialesDB(m);
        const itemsPorOc = {};
        ocItemsAll.forEach(it => {
          if (!itemsPorOc[it.orden_compra_id]) itemsPorOc[it.orden_compra_id] = [];
          itemsPorOc[it.orden_compra_id].push(it);
        });
        setOcsActivasDB(ocsAll.map(oc => ({ oc, items: itemsPorOc[oc.id] || [] })));
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      showToast(`✓ Comprobante ${r.serie_correlativo} registrado`, 'green');

      // ── Detección de ingresos pendientes de sustento ──
      // Si el almacenero registró ingresos del MISMO proveedor sin factura
      // (pendiente_sustento=true) en esta obra, le ofrecemos a la contadora
      // vincularlos a esta factura recién creada — así cumple el flujo
      // inverso almacén → contabilidad sin duplicar movimientos.
      try {
        if (proveedorIdFinal && r.obra_id) {
          const candidatos = await window.__db.movimientos_materiales
            .where('obra_id').equals(r.obra_id)
            .filter(mm =>
              mm.tipo_movimiento === 'entrada' &&
              mm.pendiente_sustento === true &&
              !mm.accounting_movement_id &&
              mm.proveedor_id === proveedorIdFinal
            )
            .toArray();
          if (candidatos.length > 0) {
            candidatos.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
            setVincularPendientesModal({
              accId,
              accDoc: r.serie_correlativo,
              accFecha: r.fecha_emision,
              proveedorNombre: r.proveedor_razon_social || '—',
              candidatos,
            });
          }
        }
      } catch (e) {
        console.warn('[captura-magica] detección pendientes:', e?.message);
      }

      setReviewing(null);
    } catch (e) {
      showToast('Error al registrar: ' + (e.message || e), 'red');
    } finally {
      enProcesoRef.current.delete(id);
    }
  };

  // Vincular movimientos pendientes seleccionados a la factura recién creada.
  // Actualiza accounting_movement_id + pendiente_sustento=false en batch.
  const vincularPendientesAFactura = async (accId, movIds) => {
    if (!movIds.length) { setVincularPendientesModal(null); return; }
    try {
      const userId = window.__currentUserId || 'contador';
      const now = new Date().toISOString();
      for (const movId of movIds) {
        const mov = await window.__db.movimientos_materiales.get(movId);
        if (!mov) continue;
        await window.__db.movimientos_materiales.update(movId, {
          accounting_movement_id: accId,
          pendiente_sustento: false,
          updated_at: now,
          updated_by: userId,
          version: (mov.version ?? 0) + 1,
          sync_status: mov.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        try { await window.__logAudit?.({ action:'update', table:'movimientos_materiales', recordId: movId, newData:{ accounting_movement_id: accId }, reason:`Captura mágica · vinculado a factura ${accId}` }); } catch {}
      }
      // La factura pasa a 'parcial' (la almacenera la cerrará completa después).
      const factura = await window.__db.accounting_movements.get(accId);
      if (factura && (factura.recepcion_status === 'pendiente_recepcion' || !factura.recepcion_status)) {
        await window.__db.accounting_movements.update(accId, {
          recepcion_status: 'parcial',
          updated_at: now, updated_by: userId,
          version: (factura.version ?? 0) + 1,
          sync_status: factura.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
      }
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'movimientos_materiales' } })); } catch {}
      try { window.dispatchEvent(new Event('online')); } catch {}
      showToast(`✓ ${movIds.length} ingreso(s) vinculado(s) a la factura`, 'green');
      setVincularPendientesModal(null);
    } catch (e) {
      showToast('Error al vincular: ' + (e.message || e), 'red');
    }
  };

  const descartarItem = (id) => {
    setItems(prev => prev.filter(x => x.id !== id));
    deleteItemFromDB(id);
  };

  const reviewItem = items.find(x => x.id === reviewing);

  const stats = uMCM(() => {
    const r = { total: items.length, pendiente:0, procesando:0, revisar:0, confirmado:0, error:0, duplicado:0 };
    items.forEach(it => { r[it.status] = (r[it.status]||0) + 1; });
    return r;
  }, [items]);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">✨ Captura Mágica</div>
          <div className="pg-sub">Subí PDFs o fotos de facturas/boletas. La IA extrae proveedor, items y totales · {stats.total} archivo(s)</div>
        </div>
        {(() => {
          // La obra destino sigue SIEMPRE a la obra activa del header — acá
          // se recuerda visiblemente a cuál se está importando.
          const activaId = window.__getObraActivaId?.();
          const obraActiva = (obras || []).find(o => o.id === activaId && !o.deleted_at);
          return obraActiva ? (
            <span className="badge b-green" title="Los comprobantes confirmados asignan materiales e ingresos de almacén a esta obra. Para cambiarla, usá el selector de obra activa (arriba a la derecha)." style={{ maxWidth: 360, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              📍 Importando a: {obraActiva.nombre_obra}
            </span>
          ) : (
            <span className="badge b-amber" title="Sin obra activa, los comprobantes quedan solo en contabilidad (sin catálogo ni ingreso de almacén).">
              ⚠ Sin obra activa — solo contabilidad
            </span>
          );
        })()}
      </div>

      <div className="card card-p" style={{ marginBottom:14, background:'rgba(155,89,182,0.06)', border:'1px solid rgba(155,89,182,0.25)', fontSize:12, color:'var(--ts)' }}>
        <strong style={{ color:'#9B59B6' }}>ℹ Cómo funciona:</strong> Arrastrá tus comprobantes (PDF o foto) y Claude AI los lee. Después revisás
        el JSON extraído, confirmás la empresa compradora, y el sistema crea automáticamente:
        proveedor (si es nuevo), movimiento contable de costo, materiales nuevos, movimientos de inventario y guarda el archivo como evidencia.
        Todo se asigna a la <strong>obra activa</strong> seleccionada arriba a la derecha.
      </div>

      {/* ── DROP ZONE ─────────────────────────────────────────── */}
      {canWrite ? (
        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onClick={()=>fileInputRef.current?.click()}
          style={{
            border:'2px dashed var(--border)', borderRadius:12, padding:'40px 30px', textAlign:'center',
            background:'rgba(255,255,255,0.02)', cursor:'pointer', marginBottom:18,
            transition:'background 0.2s',
          }}
          onDragEnter={(e)=>{ e.preventDefault(); e.currentTarget.style.background = 'rgba(155,89,182,0.08)'; }}
          onDragLeave={(e)=>{ e.preventDefault(); e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
        >
          <JxIcon name="upload" size={38} color="var(--amber)"/>
          <div style={{ fontSize:14, fontWeight:700, marginTop:10, color:'var(--tp)' }}>
            Arrastrá facturas aquí o click para seleccionar
          </div>
          <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:5 }}>
            PDF · JPG · PNG · WEBP — máx 6 MB cada uno · podés subir varios a la vez
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,image/jpeg,image/png,image/webp"
            style={{ display:'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
        </div>
      ) : (
        <div className="card card-p" style={{ background:'rgba(243,156,18,0.08)', border:'1px solid rgba(243,156,18,0.3)', marginBottom:18, fontSize:12.5, color:'var(--amber)' }}>
          👁️ Tu rol tiene acceso de solo lectura para Captura Mágica. Podés revisar facturas pero no adjuntar nuevas ni confirmarlas.
        </div>
      )}

      {/* ── LISTA DE ITEMS ────────────────────────────────────── */}
      {items.length === 0 ? (
        <div className="card card-p empty-state">
          <JxIcon name="inbox" size={36} color="var(--tm)"/>
          <p>No hay archivos en la bandeja. Subí tu primer comprobante arriba.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Archivo</th><th>Estado</th>
                <th>Tipo · Serie</th><th>Emisor</th>
                <th style={{ textAlign:'right' }}>Total</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {items.map(it => {
                  const est = ESTADOS[it.status] || ESTADOS.pendiente;
                  const r = it.review;
                  return (
                    <tr key={it.id}>
                      <td className="col-p">
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <JxIcon name={it.mimeType.includes('pdf') ? 'file' : 'camera'} size={13} color="var(--tm)"/>
                          <div>
                            <div style={{ fontSize:12, fontWeight:600 }}>{it.name}</div>
                            <div style={{ fontSize:10, color:'var(--tm)' }}>{(it.size/1024).toFixed(0)} KB</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`badge ${est.color}`}>
                          <JxIcon name={est.icon} size={10}/> {est.label}
                        </span>
                        {it.error && <div style={{ fontSize:10, color:'var(--red)', marginTop:3, maxWidth:180 }}>{it.error}</div>}
                        {it.status === 'duplicado' && <div style={{ fontSize:10, color:'var(--amber)', marginTop:3 }}>Ya existe en la DB</div>}
                      </td>
                      <td>
                        {r ? (
                          <>
                            <div style={{ fontSize:11.5 }}>{TIPO_DOC_MAP[r.tipo_documento]?.label || '?'}</div>
                            <div style={{ fontSize:10, color:'var(--tm)' }}>{r.serie_correlativo || '—'}</div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ fontSize:11 }}>
                        {r ? (
                          <>
                            <div>{r.proveedor_razon_social?.slice(0,30) || '—'}</div>
                            <div style={{ fontSize:10, color:'var(--tm)' }}>RUC: {r.proveedor_ruc || '—'}</div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ textAlign:'right', fontWeight:700 }} className="col-num">
                        {r ? fmtCurMagic(r.total, r.moneda) : '—'}
                      </td>
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        {(it.status === 'revisar' || it.status === 'duplicado') && (
                          <button className="btn btn-amber btn-xs" onClick={()=>setReviewing(it.id)}>
                            <JxIcon name="eye" size={11}/> Revisar
                          </button>
                        )}
                        {it.status === 'confirmado' && (
                          <span style={{ fontSize:11, color:'var(--green)' }}>✓ Insertado</span>
                        )}
                        {it.status === 'error' && (
                          <button className="btn btn-ghost btn-xs" onClick={()=>procesarItem(it.id, it.file)}>
                            <JxIcon name="refresh" size={11}/> Reintentar
                          </button>
                        )}
                        <button className="btn btn-ghost btn-xs" onClick={()=>descartarItem(it.id)} style={{ marginLeft:4 }} title="Descartar">
                          <JxIcon name="x" size={11}/>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODAL DE REVISIÓN ─────────────────────────────────── */}
      {reviewItem && reviewItem.review && (
        <ReviewModal
          item={reviewItem}
          companies={companies || []}
          obras={obras || []}
          proveedoresDB={proveedoresDB}
          materialesDB={materialesDB}
          ocsActivasDB={ocsActivasDB}
          onChange={(newReview) => setItems(prev => prev.map(x => x.id === reviewItem.id ? { ...x, review: newReview } : x))}
          onConfirm={() => confirmarItem(reviewItem.id)}
          onClose={() => setReviewing(null)}
        />
      )}

      {/* Modal post-creación: vincular ingresos pendientes a esta factura */}
      {vincularPendientesModal && (
        <VincularPendientesModal
          data={vincularPendientesModal}
          materialesDB={materialesDB}
          onClose={() => setVincularPendientesModal(null)}
          onConfirm={(movIds) => vincularPendientesAFactura(vincularPendientesModal.accId, movIds)}/>
      )}
    </div>
  );
}

// ─── Modal: vincular ingresos pendientes a la factura recién creada ───
// Aparece automáticamente al confirmar un comprobante si el almacenero
// había registrado ingresos del MISMO proveedor sin factura. La contadora
// elige cuáles vincular (checkbox por defecto todos marcados) — los movs
// pasan a accounting_movement_id=accId + pendiente_sustento=false.
function VincularPendientesModal({ data, materialesDB, onClose, onConfirm }) {
  const [seleccionados, setSeleccionados] = uSCM(() => new Set(data.candidatos.map(c => c.id)));
  const [saving, setSaving] = uSCM(false);

  const toggle = (id) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const matName = (id) => materialesDB.find(m => m.id === id)?.nombre_material || '—';

  const submit = async () => {
    setSaving(true);
    try { await onConfirm(Array.from(seleccionados)); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ background:'rgba(0,0,0,0.7)' }}>
      <div className="modal" onClick={e=>e.stopPropagation()} style={{ maxWidth:680, width:'92%', maxHeight:'88vh', display:'flex', flexDirection:'column' }}>
        <div className="modal-hd">
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>🔗 Vincular ingresos pendientes</div>
            <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:3, lineHeight:1.5 }}>
              El almacenero registró estos ingresos sin factura del proveedor <strong>{data.proveedorNombre}</strong>.
              Marcá los que correspondan a la factura <strong>{data.accDoc}</strong> que acabás de registrar.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div style={{ overflowY:'auto', padding:'12px 16px', flex:1 }}>
          {data.candidatos.length === 0 ? (
            <div style={{ textAlign:'center', color:'var(--tm)', padding:20 }}>Sin pendientes.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {data.candidatos.map(mov => {
                const checked = seleccionados.has(mov.id);
                return (
                  <label key={mov.id} style={{
                    display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
                    background: checked ? 'rgba(46,204,113,0.08)' : 'rgba(0,0,0,0.15)',
                    border: checked ? '1px solid rgba(46,204,113,0.35)' : '1px solid rgba(255,255,255,0.04)',
                    borderRadius:6, cursor:'pointer', fontSize:12,
                  }}>
                    <input type="checkbox" checked={checked} onChange={()=>toggle(mov.id)}/>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, color:'var(--tp)' }}>{matName(mov.material_id)}</div>
                      <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2 }}>
                        {mov.fecha} · {mov.cantidad} {mov.unidad}
                        {mov.observaciones_almacen && <> · <em>"{mov.observaciones_almacen}"</em></>}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Saltar — no vincular</button>
          <button className="btn btn-amber" onClick={submit} disabled={saving || seleccionados.size === 0}>
            {saving ? 'Vinculando…' : `Vincular ${seleccionados.size} ingreso(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL DE REVISIÓN ───────────────────────────────────────
function ReviewModal({ item, companies, obras, proveedoresDB, materialesDB, ocsActivasDB, onChange, onConfirm, onClose }) {
  // La obra destino SIGUE a la obra activa del header (decisión de producto:
  // todos los módulos operan sobre la obra activa). Al abrir el modal,
  // sincronizar el review con la obra activa actual — cubre reviews viejos
  // con obra_id '' y reviews procesados cuando otra obra estaba activa.
  uECM(() => {
    const rr = item?.review;
    if (!rr) return;
    const activa = window.__getObraActivaId?.();
    const valida = activa && (obras || []).some(o => o.id === activa && !o.deleted_at);
    const destino = valida ? activa : '';
    const patch = {};
    if (rr.obra_id !== destino) patch.obra_id = destino;
    // Backward-compat: reviews VIEJOS (sin obra_destino, hechos antes del selector) →
    // sembrar la obra activa, que era su destino por defecto. `== null` preserva un ''
    // elegido a propósito por el usuario ("Sin obra").
    if (rr.obra_destino == null) patch.obra_destino = destino;
    if (Object.keys(patch).length) onChange({ ...rr, ...patch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);
  const r = item.review;
  // Destino resuelto (obra real o '' si "Gastos Generales Empresa"/"Sin obra") — para que
  // el resumen de abajo NO use r.obra_id (que solo se recalcula al confirmar) y no mienta.
  const obraDestinoResuelta = r.obra_destino === '__empresa__'
    ? ''
    : (r.obra_destino && (obras || []).some(o => o.id === r.obra_destino && !o.deleted_at) ? r.obra_destino : '');
  const upd = (patch) => onChange({ ...r, ...patch });
  const [previewUrl, setPreviewUrl] = uSCM(null);

  uECM(() => {
    if (!item.file) return;
    const url = URL.createObjectURL(item.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file]);

  // Companies del grupo (filtro: activas)
  const companiesActivas = uMCM(() => companies.filter(c => c.status === 'activa' && !c.deleted_at), [companies]);
  // Obras de la empresa receptora
  const obrasDeEmpresa = uMCM(() => {
    if (!r.company_id) return [];
    return obras.filter(o => {
      if (o.deleted_at) return false;
      if (o.ejecutora_company_id === r.company_id) return true;
      if (o.ejecutora_tipo === 'consorcio' && Array.isArray(o.consorcio_miembros)) {
        return o.consorcio_miembros.some(m => m.company_id === r.company_id);
      }
      return false;
    });
  }, [obras, r.company_id]);

  const updateItem = (idx, patch) => {
    const newItems = r.items.map((it, i) => i === idx ? { ...it, ...patch } : it);
    upd({ items: newItems });
  };

  // Recalcula total al editar items
  const recalcular = () => {
    const sub = r.items.reduce((s, it) => s + (Number(it.cantidad)||0) * (Number(it.precio_unitario)||0), 0);
    const igv = +(sub * 0.18).toFixed(2);
    upd({ subtotal: sub, igv, total: sub + igv });
  };

  const isImage = item.mimeType.startsWith('image/');
  const isPdf = item.mimeType === 'application/pdf';

  const confianzaColor = r.confianza === 'alta' ? 'var(--green)' : r.confianza === 'baja' ? 'var(--red)' : 'var(--amber)';

  return (
    <div className="overlay" onClick={(e)=> e.target === e.currentTarget && onClose()}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.65)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:9999, padding:20 }}>
      <div className="card" style={{ width:'100%', maxWidth:1280, maxHeight:'94vh', display:'flex', flexDirection:'column', background:'#1A2333', border:'1px solid var(--border)', borderRadius:12 }}>
        <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <JxIcon name="eye" size={16} color="var(--amber)"/>
            <div>
              <div style={{ fontSize:14, fontWeight:700 }}>Revisar: {item.name}</div>
              <div style={{ fontSize:11, color:'var(--tm)' }}>
                Confianza IA: <span style={{ color: confianzaColor, fontWeight:600 }}>{r.confianza?.toUpperCase()}</span>
                {r.advertencias?.length > 0 && ` · ⚠ ${r.advertencias.length} advertencia(s)`}
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><JxIcon name="x" size={13}/></button>
        </div>

        {item.duplicate_of && (
          <div style={{ background:'rgba(241,196,15,0.1)', borderBottom:'1px solid rgba(241,196,15,0.3)', padding:'10px 18px', fontSize:12, color:'var(--amber)' }}>
            ⚠ DUPLICADO: ya existe un movimiento contable con este RUC y serie-correlativo (mismo comprobante, quizás subido antes como foto). <strong>No se creará un segundo movimiento</strong> — descartá este archivo. Si de verdad es distinto, corregí el RUC o la serie-correlativo.
          </div>
        )}

        {r.advertencias?.length > 0 && (
          <div style={{ background:'rgba(231,76,60,0.07)', borderBottom:'1px solid rgba(231,76,60,0.2)', padding:'10px 18px', fontSize:11.5, color:'var(--red)' }}>
            <strong>Advertencias IA:</strong> {r.advertencias.join(' · ')}
          </div>
        )}

        <div style={{ flex:1, display:'grid', gridTemplateColumns:'1fr 1.2fr', minHeight:0 }}>
          {/* IZQUIERDA: PREVIEW */}
          <div style={{ borderRight:'1px solid var(--border)', overflow:'auto', background:'#0E1620', display:'flex', alignItems:'center', justifyContent:'center', padding:8 }}>
            {isImage && previewUrl && (
              <img src={previewUrl} alt={item.name} style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }}/>
            )}
            {isPdf && previewUrl && (
              <iframe src={previewUrl} title={item.name} style={{ width:'100%', height:'100%', minHeight:500, border:'none' }}/>
            )}
          </div>

          {/* DERECHA: FORMULARIO */}
          <div style={{ overflow:'auto', padding:'14px 18px' }}>
            {/* HEADER doc */}
            <div className="g2" style={{ marginBottom:10 }}>
              <div>
                <label className="flabel">Tipo doc</label>
                <select className="fi" value={r.tipo_documento} onChange={e=>upd({ tipo_documento: e.target.value })}>
                  {Object.entries(TIPO_DOC_MAP).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="flabel">Serie - Correlativo</label>
                <input className="fi" value={r.serie_correlativo} onChange={e=>upd({ serie_correlativo: e.target.value })}/>
              </div>
              <div>
                <label className="flabel">Fecha emisión</label>
                <input className="fi" type="date" value={r.fecha_emision} onChange={e=>upd({ fecha_emision: e.target.value })}/>
              </div>
              <div>
                <label className="flabel">Moneda</label>
                <select className="fi" value={r.moneda} onChange={e=>upd({ moneda: e.target.value })}>
                  <option value="PEN">S/ (PEN)</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className="flabel">Método de pago</label>
                <select className="fi" value={r.metodo_pago || ''} onChange={e=>upd({ metodo_pago: e.target.value || null })}>
                  <option value="">— Seleccionar —</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia bancaria</option>
                  <option value="yape">Yape</option>
                  <option value="plin">Plin</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="cheque">Cheque</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="flabel">Estado del pago</label>
                <select className="fi" value={r.payment_status || 'pending'} onChange={e=>upd({ payment_status: e.target.value })}>
                  <option value="paid">Pagado</option>
                  <option value="pending">Pendiente</option>
                  <option value="credit">Crédito (plazo)</option>
                </select>
              </div>
            </div>

            {/* PROVEEDOR (emisor) */}
            <div style={{ marginTop:8, padding:'10px 12px', background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.2)', borderRadius:8 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--blue)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>Proveedor (emisor)</div>
              <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                <button type="button" className={`btn btn-xs ${r.proveedor_accion === 'usar_existente' ? 'btn-amber' : 'btn-ghost'}`}
                  onClick={()=>upd({ proveedor_accion:'usar_existente' })}>Usar existente</button>
                <button type="button" className={`btn btn-xs ${r.proveedor_accion === 'crear_nuevo' ? 'btn-amber' : 'btn-ghost'}`}
                  onClick={()=>upd({ proveedor_accion:'crear_nuevo' })}>Crear nuevo</button>
              </div>
              {r.proveedor_accion === 'usar_existente' ? (
                <select className="fi" value={r.proveedor_id||''} onChange={e=>{
                  const p = proveedoresDB.find(x => x.id === e.target.value);
                  upd({ proveedor_id: e.target.value, proveedor_ruc: p?.ruc || r.proveedor_ruc, proveedor_razon_social: p?.razon_social || r.proveedor_razon_social });
                }}>
                  <option value="">— Seleccionar —</option>
                  {proveedoresDB.map(p => <option key={p.id} value={p.id}>{p.razon_social} {p.ruc ? `· ${p.ruc}` : ''}</option>)}
                </select>
              ) : (
                <div className="g2">
                  <div><label className="flabel">RUC</label><input className="fi" maxLength={11} value={r.proveedor_ruc||''} onChange={e=>upd({ proveedor_ruc: e.target.value.replace(/\D/g,'').slice(0,11) })}/></div>
                  <div><label className="flabel">Razón social *</label><input className="fi" value={r.proveedor_razon_social||''} onChange={e=>upd({ proveedor_razon_social: e.target.value })}/></div>
                  <div style={{ gridColumn:'1/-1' }}><label className="flabel">Dirección</label><input className="fi" value={r.proveedor_direccion||''} onChange={e=>upd({ proveedor_direccion: e.target.value })}/></div>
                </div>
              )}
            </div>

            {/* INTERCOMPANY — operación entre nuestras empresas */}
            {r.es_intercompany && (
              <div style={{ marginTop:10, padding:'12px 14px', background:'rgba(52,152,219,0.07)', border:'1px solid rgba(52,152,219,0.4)', borderRadius:8 }}>
                <div style={{ fontSize:11.5, fontWeight:700, color:'#3498DB', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6 }}>
                  🔗 OPERACIÓN INTERCOMPANY DETECTADA
                </div>
                <div style={{ fontSize:12.5, color:'var(--ts)', lineHeight:1.5 }}>
                  El emisor y el receptor de esta factura son ambas <strong>empresas tuyas</strong>. Es una operación interna del grupo.
                  {r.cadena_candidatas?.length > 0 ? (
                    <> Detecté <strong>{r.cadena_candidatas.length} cadena(s)</strong> de trazabilidad pendientes que coinciden con este movimiento. ¿Querés vincular esta factura a una?</>
                  ) : (
                    <> No encontré ninguna cadena de trazabilidad pendiente que coincida. La factura quedará registrada igual, pero conviene crear primero la cadena en Trazabilidad.</>
                  )}
                </div>
                {r.cadena_candidatas?.length > 0 && (
                  <div style={{ marginTop:8 }}>
                    <select className="fi" style={{ fontSize:11, maxWidth:480 }}
                      value={r.vincular_a_cadena_step ? `${r.vincular_a_cadena_step.chain_id}::${r.vincular_a_cadena_step.paso_idx}` : ''}
                      onChange={e => {
                        const v = e.target.value;
                        if (!v) { upd({ vincular_a_cadena_step: null }); return; }
                        const [chain_id, paso_idx] = v.split('::');
                        upd({ vincular_a_cadena_step: { chain_id, paso_idx: Number(paso_idx) } });
                      }}>
                      <option value="">— No vincular a ninguna cadena —</option>
                      {r.cadena_candidatas.map(cc => (
                        <option key={cc.chain_id + '_' + cc.paso_idx} value={`${cc.chain_id}::${cc.paso_idx}`}>
                          {cc.item_nombre} ({cc.cantidad} {cc.unidad}) · paso {cc.paso_idx + 1}/{cc.paso_total} · {cc.estado}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {r.vincular_a_cadena_step && (
                  <div style={{ marginTop:6, fontSize:10.5, color:'var(--tm)' }}>
                    Al confirmar: el paso correspondiente de la cadena se marcará como <strong>recibido</strong> y la factura quedará archivada como evidencia.
                  </div>
                )}
              </div>
            )}

            {/* OC RELACIONADA — sugerencia de vinculación */}
            {r.oc_match && (
              <div style={{ marginTop:10, padding:'12px 14px', background:'rgba(155,89,182,0.07)', border:'1px solid rgba(155,89,182,0.35)', borderRadius:8 }}>
                <div style={{ fontSize:11.5, fontWeight:700, color:'#9B59B6', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6, display:'flex', alignItems:'center', gap:6 }}>
                  🔗 OC RELACIONADA DETECTADA
                </div>
                <div style={{ fontSize:12.5, color:'var(--ts)', lineHeight:1.5 }}>
                  Detecté que esta factura podría corresponder a la <strong>OC {r.oc_match.oc_codigo}</strong> ({r.oc_match.oc_estado.replace('_', ' ')}, total {fmtCurMagic(r.oc_match.oc_total, r.moneda)}).
                  Coinciden <strong>{r.oc_match.matches.length} de {r.items.length}</strong> items ({Math.round(r.oc_match.ratio * 100)}%).
                  ¿Querés vincular esta compra a esa OC?
                </div>
                <div style={{ marginTop:8, display:'flex', gap:8, alignItems:'center' }}>
                  <button type="button"
                    className={`btn btn-sm ${r.vincular_a_oc === r.oc_match.oc_id ? 'btn-amber' : 'btn-ghost'}`}
                    onClick={()=>upd({ vincular_a_oc: r.oc_match.oc_id })}>
                    ✓ Sí, vincular
                  </button>
                  <button type="button"
                    className={`btn btn-sm ${!r.vincular_a_oc ? 'btn-amber' : 'btn-ghost'}`}
                    onClick={()=>upd({ vincular_a_oc: null })}>
                    ✕ No, registrar como compra independiente
                  </button>
                  {r.oc_match_alternativas?.length > 0 && (
                    <select className="fi" style={{ fontSize:11, maxWidth:240 }}
                      value={r.vincular_a_oc || ''}
                      onChange={e=>upd({ vincular_a_oc: e.target.value || null })}>
                      <option value={r.oc_match.oc_id}>OC {r.oc_match.oc_codigo} (mejor match)</option>
                      <option value="">— No vincular —</option>
                      {r.oc_match_alternativas.map(alt => (
                        <option key={alt.oc_id} value={alt.oc_id}>
                          OC {alt.oc_codigo} ({Math.round(alt.ratio * 100)}% items)
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {r.vincular_a_oc && (
                  <>
                    <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                      <div>
                        <label className="flabel" style={{ fontSize:10.5 }}>Guía de remisión (opcional)</label>
                        <input className="fi" placeholder="Ej: T001-001234"
                          value={r.guia_remision || ''}
                          onChange={e=>upd({ guia_remision: e.target.value })}/>
                      </div>
                      <div>
                        <label className="flabel" style={{ fontSize:10.5 }}>Fecha de recepción</label>
                        <input className="fi" type="date"
                          value={r.fecha_recepcion || r.fecha_emision || ''}
                          onChange={e=>upd({ fecha_recepcion: e.target.value })}/>
                      </div>
                    </div>
                    {/* Diferencias de precio detectadas */}
                    {(() => {
                      if (!r.oc_match?.matches) return null;
                      const diffs = r.oc_match.matches.map(m => {
                        const facItem = r.items[m.factura_idx];
                        if (!facItem) return null;
                        const ocPU = Number(m.oc_item.precio_unitario || 0);
                        const facPU = Number(facItem.precio_unitario || 0);
                        if (ocPU <= 0 || facPU <= 0) return null;
                        const pct = ((facPU - ocPU) / ocPU) * 100;
                        if (Math.abs(pct) < 1) return null; // < 1% = ruido
                        return {
                          nombre: facItem.descripcion || m.oc_item.material_id,
                          ocPU, facPU, pct,
                          alto: Math.abs(pct) > 5,
                        };
                      }).filter(Boolean);
                      if (!diffs.length) return null;
                      const algunoAlto = diffs.some(d => d.alto);
                      return (
                        <div style={{ marginTop:10, padding:'8px 10px', background: algunoAlto ? 'rgba(231,76,60,0.10)' : 'rgba(242,183,5,0.10)', border:`1px solid ${algunoAlto ? 'rgba(231,76,60,0.4)' : 'rgba(242,183,5,0.4)'}`, borderRadius:6, fontSize:11 }}>
                          <div style={{ fontWeight:700, color: algunoAlto ? 'var(--red)' : 'var(--amber)', marginBottom:4 }}>
                            ⚠ {diffs.length} ítem(s) con precio distinto al de la OC
                          </div>
                          <ul style={{ margin:0, paddingLeft:16, color:'var(--ts)' }}>
                            {diffs.map((d, i) => (
                              <li key={i} style={{ marginBottom:2 }}>
                                <strong>{d.nombre}</strong> · OC: {fmtCurMagic(d.ocPU, r.moneda)} → Factura: {fmtCurMagic(d.facPU, r.moneda)}
                                <span style={{ marginLeft:6, color: d.pct > 0 ? 'var(--red)' : 'var(--green)', fontWeight:600 }}>
                                  ({d.pct > 0 ? '+' : ''}{d.pct.toFixed(1)}%)
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })()}
                    <div style={{ marginTop:8, fontSize:10.5, color:'var(--tm)' }}>
                      Al confirmar: se sumarán las cantidades de la factura a las cantidades recibidas de la OC,
                      se creará una <strong>recepción formal</strong> con la guía y fecha indicadas, y la factura
                      quedará disponible como evidencia desde la OC.
                      Si quedan items sin cubrir → "comprada parcial". Si todos están cubiertos → "comprada".
                    </div>
                  </>
                )}
              </div>
            )}

            {/* RECEPTOR (empresa del grupo) + obra */}
            <div style={{ marginTop:10, padding:'10px 12px', background:'rgba(46,204,113,0.06)', border:'1px solid rgba(46,204,113,0.2)', borderRadius:8 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--green)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>Empresa compradora (tu grupo)</div>
              {r.receptor_documento && !companiesActivas.find(c => c.ruc === r.receptor_documento) && r.company_accion !== 'crear_nueva' && (
                <div style={{ fontSize:11, color:'var(--red)', marginBottom:6 }}>⚠ El RUC en la factura ({r.receptor_documento}) no coincide con ninguna de tus empresas.</div>
              )}
              {r.company_accion === 'crear_nueva' && r.receptor_documento && !companiesActivas.find(c => c.ruc === r.receptor_documento) && (
                <div style={{ fontSize:11, color:'var(--amber)', marginBottom:6 }}>
                  💡 RUC nuevo detectado en la factura — autocompletamos los datos. Verificá <strong>rol</strong> y <strong>rubro</strong> abajo, o usá SUNAT para más info.
                </div>
              )}
              <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                <button type="button" className={`btn btn-xs ${r.company_accion !== 'crear_nueva' ? 'btn-amber' : 'btn-ghost'}`}
                  onClick={()=>upd({ company_accion:'usar_existente' })}>Usar existente</button>
                <button type="button" className={`btn btn-xs ${r.company_accion === 'crear_nueva' ? 'btn-amber' : 'btn-ghost'}`}
                  onClick={()=>upd({
                    company_accion:'crear_nueva',
                    company_id:'',
                    nueva_company_ruc: r.receptor_documento || '',
                    nueva_company_name: r.receptor_razon_social || '',
                    nueva_company_legal: r.receptor_razon_social || '',
                    nueva_company_rol: 'origen',
                    nueva_company_rubro: 'distribuidora_materiales',
                  })}>+ Crear nueva</button>
              </div>
              {r.company_accion !== 'crear_nueva' ? (
                <div>
                  <label className="flabel">Empresa *</label>
                  <select className="fi" value={r.company_id||''} onChange={e=>upd({ company_id: e.target.value })}>
                    <option value="">— Seleccionar —</option>
                    {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name} {c.ruc ? `· ${c.ruc}` : ''}</option>)}
                  </select>
                </div>
              ) : (
                <div className="g2">
                  <div>
                    <label className="flabel">RUC *</label>
                    <div style={{ display:'flex', gap:6 }}>
                      <input className="fi" maxLength={11} value={r.nueva_company_ruc||''} onChange={e=>upd({ nueva_company_ruc: e.target.value.replace(/\D/g,'').slice(0,11) })}/>
                      <button type="button" className="btn btn-ghost btn-sm"
                        disabled={!/^\d{11}$/.test(r.nueva_company_ruc||'')}
                        title="Buscar datos en SUNAT"
                        onClick={async () => {
                          try {
                            const data = await window.__identity.consultarRUC(r.nueva_company_ruc);
                            upd({
                              nueva_company_legal: data.razonSocial || r.nueva_company_legal || '',
                              nueva_company_name: r.nueva_company_name || data.razonSocial || '',
                              nueva_company_direccion: data.direccion || r.nueva_company_direccion || '',
                              nueva_company_rubro: data.rubroSugerido || r.nueva_company_rubro || 'distribuidora_materiales',
                            });
                          } catch (e) { /* ignore */ }
                        }}>
                      <JxIcon name="search" size={11}/>SUNAT</button>
                    </div>
                  </div>
                  <div>
                    <label className="flabel">Nombre comercial *</label>
                    <input className="fi" value={r.nueva_company_name||''} onChange={e=>upd({ nueva_company_name: e.target.value })} placeholder="Ej: Constructora Nova"/>
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label className="flabel">Razón social</label>
                    <input className="fi" value={r.nueva_company_legal||''} onChange={e=>upd({ nueva_company_legal: e.target.value })}/>
                  </div>
                  <div style={{ gridColumn:'1/-1' }}>
                    <label className="flabel">Dirección fiscal</label>
                    <input className="fi" value={r.nueva_company_direccion||''} onChange={e=>upd({ nueva_company_direccion: e.target.value })}/>
                  </div>
                  <div>
                    <label className="flabel">Rol en el grupo</label>
                    <select className="fi" value={r.nueva_company_rol||'origen'} onChange={e=>upd({ nueva_company_rol: e.target.value })}>
                      <option value="origen">Origen / Compradora primaria</option>
                      <option value="intermediaria">Intermediaria</option>
                      <option value="ejecutora">Ejecutora (consorcio)</option>
                      <option value="mixta">Mixta</option>
                    </select>
                  </div>
                  <div>
                    <label className="flabel">Rubro</label>
                    <select className="fi" value={r.nueva_company_rubro||'distribuidora_materiales'} onChange={e=>upd({ nueva_company_rubro: e.target.value })}>
                      <option value="distribuidora_materiales">Distribuidora de Materiales</option>
                      <option value="ferreteria">Ferretería</option>
                      <option value="importadora_acero">Importadora · Acero</option>
                      <option value="importadora_cemento">Importadora · Cemento</option>
                      <option value="importadora_general">Importadora · General</option>
                      <option value="transporte">Transporte / Flete</option>
                      <option value="alquiler_maquinaria">Alquiler de Maquinaria</option>
                      <option value="mano_obra">Mano de Obra / Subcontratos</option>
                      <option value="ejecutora_obra">Ejecutora de Obra</option>
                      <option value="contratista_general">Contratista General</option>
                      <option value="otro">Otro</option>
                    </select>
                  </div>
                  <div style={{ gridColumn:'1/-1', fontSize:11, color:'var(--tm)' }}>
                    Esta empresa se creará al confirmar.
                  </div>
                </div>
              )}
              {/* Destino de la compra (en AMBOS modos: empresa existente o nueva). El
                  usuario elige a qué OBRA va, o si es Gasto General de la Empresa. */}
              <label className="flabel" style={{ marginTop: 10, display: 'block' }}>Destino de la compra *</label>
              <select className="fi" value={r.obra_destino ?? ''} onChange={e => upd({ obra_destino: e.target.value })}>
                <option value="">— Sin obra (solo contabilidad) —</option>
                <option value="__empresa__">🏢 Gastos Generales de la Empresa</option>
                <optgroup label="Obras">
                  {(obras || []).filter(o => !o.deleted_at).map(o => <option key={o.id} value={o.id}>🏗 {o.nombre_obra}{o.cui ? ` · CUI ${o.cui}` : ''}</option>)}
                </optgroup>
              </select>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--tm)' }}>
                {r.obra_destino === '__empresa__'
                  ? '🏢 Gasto general de la empresa — no entra a ninguna obra ni al almacén de obra.'
                  : r.obra_destino
                    ? '🏗 Va a esta obra: aparece en su Conciliación de Insumos y, si marcás recepción, en su almacén.'
                    : '⚠ Sin obra: la factura queda solo en contabilidad (sin almacén ni conciliación).'}
              </div>
            </div>

            {/* ITEMS */}
            <div style={{ marginTop:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--amber)', textTransform:'uppercase', letterSpacing:'.05em' }}>
                  Ítems ({r.items.length})
                </div>
                <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                  <label style={{ fontSize:11, color:'var(--tm)', display:'flex', alignItems:'center', gap:4 }}
                    title="Si está marcado, esta factura aparece en 'Compras pendientes' del almacenero, que decide allí crear el insumo nuevo o vincularlo a uno existente cuando confirme la recepción física.">
                    <input type="checkbox" checked={r.genera_recepcion_almacen !== false} onChange={e=>upd({ genera_recepcion_almacen: e.target.checked })}/>
                    Genera ingreso al almacén (esperar recepción física)
                  </label>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={recalcular}>↻ Recalcular total</button>
                </div>
              </div>
              {/* La columna "Material" (crear/vincular insumo) se quitó a propósito:
                  ese trabajo es del ALMACENERO en "Compras pendientes". El contador
                  solo verifica descripción, tipo, cantidad y precio. */}
              <div style={{ overflow:'auto', maxHeight:460, border:'1px solid var(--border)', borderRadius:6 }}>
                <table className="tbl" style={{ fontSize:12 }}>
                  <thead><tr>
                    <th style={{ minWidth:300 }}>Descripción</th>
                    <th style={{ width:130 }}>Tipo</th>
                    <th style={{ textAlign:'right', width:90 }}>Cant</th>
                    <th style={{ width:70 }}>Unid</th>
                    <th style={{ textAlign:'right', width:100 }}>P.Unit</th>
                    <th style={{ textAlign:'right', width:100 }}>Subt</th>
                  </tr></thead>
                  <tbody>
                    {r.items.map((it, i) => (
                      <tr key={i}>
                        <td><input className="fi" style={{ fontSize:12, padding:'6px 8px' }} value={it.descripcion||''} onChange={e=>updateItem(i, { descripcion: e.target.value })}/></td>
                        <td>
                          {/* Tipo de insumo: la IA pre-clasifica por nombre,
                              el contador puede corregir si es necesario. */}
                          <select style={{ fontSize:11, padding:'5px 6px' }} className="fi"
                            value={it.tipo_insumo || 'material'}
                            onChange={e => updateItem(i, { tipo_insumo: e.target.value })}>
                            <option value="material">Material</option>
                            <option value="herramienta">Herramienta</option>
                            <option value="epp">EPP</option>
                            <option value="maquinaria">Maquinaria</option>
                            <option value="emergencia">Emergencia</option>
                            <option value="servicio">Servicio/Gasto</option>
                          </select>
                        </td>
                        <td><input className="fi" type="number" step="0.01" style={{ fontSize:12, padding:'6px 8px', width:80, textAlign:'right' }} value={it.cantidad ?? ''} onChange={e=>updateItem(i, { cantidad: e.target.value })}/></td>
                        <td><input className="fi" style={{ fontSize:12, padding:'6px 8px', width:60 }} value={it.unidad||''} onChange={e=>updateItem(i, { unidad: e.target.value })}/></td>
                        <td><input className="fi" type="number" step="0.01" style={{ fontSize:12, padding:'6px 8px', width:90, textAlign:'right' }} value={it.precio_unitario ?? ''} onChange={e=>updateItem(i, { precio_unitario: e.target.value })}/></td>
                        <td style={{ textAlign:'right' }}>{((Number(it.cantidad)||0) * (Number(it.precio_unitario)||0)).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* TOTALES */}
            <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              <div><label className="flabel">Subtotal</label><input className="fi" type="number" step="0.01" value={r.subtotal} onChange={e=>upd({ subtotal: e.target.value })}/></div>
              <div><label className="flabel">IGV</label><input className="fi" type="number" step="0.01" value={r.igv} onChange={e=>upd({ igv: e.target.value })}/></div>
              <div><label className="flabel">Total *</label><input className="fi" type="number" step="0.01" value={r.total} onChange={e=>upd({ total: e.target.value })} style={{ fontWeight:700 }}/></div>
            </div>

            <div style={{ marginTop:10 }}>
              <label className="flabel">Observaciones</label>
              <textarea className="fi" rows={2} value={r.observaciones||''} onChange={e=>upd({ observaciones: e.target.value })}/>
            </div>
          </div>
        </div>

        <div style={{ padding:'12px 18px', borderTop:'1px solid var(--border)', display:'flex', justifyContent:'space-between', gap:10 }}>
          <div style={{ fontSize:11, color:'var(--tm)' }}>
            Al confirmar se crea: {r.proveedor_accion === 'crear_nuevo' && '1 proveedor + '}1 movimiento contable
            {r.crear_materiales_catalogo && obraDestinoResuelta ? ` + ${r.items.filter(i=>i.accion_material==='crear_nuevo').length} material(es) en catálogo (sin stock)` : ''}
            {r.genera_recepcion_almacen && obraDestinoResuelta && r.items?.length > 0 ? ` + 1 recepción pendiente para almacén` : ''}
            {' + 1 evidencia.'}
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-amber btn-sm" onClick={onConfirm}>
              <JxIcon name="check" size={12}/> Confirmar e insertar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CapturaMagicaPage });
