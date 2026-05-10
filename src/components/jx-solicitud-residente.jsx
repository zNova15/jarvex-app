import React from "react";
import { asistenteSolicitudMaterialesAI } from "../lib/asistente-solicitud-ai.js";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

// ═══════════════════════════════════════════════════════════════════
// JARVEX — Solicitud de Materiales (Residente / Maestro de obra)
// ═══════════════════════════════════════════════════════════════════
// El residente carga semanalmente lo que necesita. El sistema:
//   1. Compara cantidad solicitada vs stock actual
//   2. Si stock suficiente → genera nada (anota la salida planificada)
//   3. Si stock < solicitado → genera REQUISICIÓN automática con
//      la diferencia (delta = solicitado - stock_actual)
//      la prioridad se calcula según gravedad del faltante
// ═══════════════════════════════════════════════════════════════════

const fmtN = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 2 });

const JxIcon = (props) => {
  const I = window.JxIcon;
  return I ? <I {...props}/> : null;
};

function SolicitudResidentePage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id || 'offline';
  const userName = `${auth?.profile?.nombres || ''} ${auth?.profile?.apellidos || ''}`.trim() || auth?.profile?.email || 'Residente';

  const [obraId, setObraId] = uS(null);
  const [fechaCreacion, setFechaCreacion] = uS(() => new Date().toISOString().slice(0, 10));
  const [fechaNecesidad, setFechaNecesidad] = uS(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  // Solicitante: por default el usuario logueado, pero editable
  // (ej: el residente carga la solicitud por pedido del maestro de obra).
  const [solicitanteNombre, setSolicitanteNombre] = uS(userName);
  const [descripcion, setDescripcion] = uS('');
  const [items, setItems] = uS([{ id: 1, material_id: '', material_nombre: '', cantidad: '', unidad: '', notas: '' }]);
  const [previewing, setPreviewing] = uS(false);
  const [submitBusy, setSubmitBusy] = uS(false);
  // Última requisición creada (para botones "Ir a requisición" / "Generar OC")
  const [ultimaReq, setUltimaReq] = uS(null);
  // Asistente IA: descripción libre del residente → solicitud estructurada
  const [aiPrompt, setAiPrompt] = uS('');
  const [aiBusy, setAiBusy] = uS(false);
  const [aiResult, setAiResult] = uS(null);
  const [aiPriority, setAiPriority] = uS('normal');

  // Sanea el nombre del material: quita cantidad/unidad redundantes que la
  // IA pudiera meter en el campo nombre. Ej: "Cemento Sol × 200 bls" → "Cemento Sol",
  // "Fierro 1/2 (50 kg)" → "Fierro 1/2".
  const sanearNombreItem = (nombre) => {
    if (!nombre) return '';
    return String(nombre)
      .replace(/\s*[×x]\s*\d+(\.\d+)?\s*(bls|kg|m2|m3|m|und|gal|hr|pza|pza?s)?\b/gi, '')
      .replace(/\s*[\(\[]\s*\d+(\.\d+)?\s*(bls|kg|m2|m3|m|und|gal|hr|pza|pza?s)?\s*[\)\]]/gi, '')
      .replace(/\s*[-–—]\s*\d+(\.\d+)?\s*(bls|kg|m2|m3|m|und|gal|hr|pza|pza?s)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Detecta menciones a "el maestro de obra Juan Pérez" / "el residente X solicitó"
  // dentro del texto y devuelve el nombre del solicitante real, o null.
  const detectarSolicitanteEnTexto = (texto) => {
    if (!texto) return null;
    const t = String(texto);
    const patrones = [
      /(?:el\s+|la\s+)?maestro\s+de?\s*obra\s+(?:llamad[oa]\s+)?([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/i,
      /(?:el\s+|la\s+)?capataz\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/i,
      /(?:el\s+|la\s+)?ingenier[oa]\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/i,
      /(?:el\s+|la\s+)?residente\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2})/i,
      /solicit[óa]\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,2})/i,
    ];
    // Prefijos de cargo (los devolvemos en el resultado)
    const cargoPrefijo = (regex) => {
      const m = t.match(regex);
      if (!m) return null;
      const nombre = m[1]?.trim();
      if (!nombre) return null;
      const lower = m[0].toLowerCase();
      if (lower.includes('maestro')) return `Maestro de obra ${nombre}`;
      if (lower.includes('capataz')) return `Capataz ${nombre}`;
      if (lower.includes('ingenier')) return `Ing. ${nombre}`;
      if (lower.includes('residente')) return `Residente ${nombre}`;
      return nombre;
    };
    for (const p of patrones) {
      const r = cargoPrefijo(p);
      if (r) return r;
    }
    return null;
  };

  // Obra activa
  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      try {
        const obras = await window.__db.obras.toArray();
        const stored = window.__getObraActivaId?.();
        const a = (stored && obras.find(o => o.id === stored && !o.deleted_at)) || obras.find(o => !o.deleted_at);
        if (a && !cancelled) { setObraId(a.id); return; }
      } catch {}
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    const onChange = () => { attempts = 0; find(); };
    window.addEventListener('obra_activa_change', onChange);
    return () => { cancelled = true; window.removeEventListener('obra_activa_change', onChange); };
  }, []);

  const { data: materiales } = window.__hooks.useMateriales(obraId);

  // Lookup de materiales para autocompletar
  const matsByName = uM(() => {
    const m = new Map();
    (materiales || []).filter(x => !x.deleted_at).forEach(x => {
      m.set((x.nombre_material || '').toLowerCase(), x);
    });
    return m;
  }, [materiales]);

  const matsArr = uM(() => (materiales || []).filter(x => !x.deleted_at), [materiales]);

  // Validar items y proyectar stock
  const proyeccion = uM(() => {
    return items
      .filter(it => it.material_id && Number(it.cantidad) > 0)
      .map(it => {
        const mat = matsArr.find(m => m.id === it.material_id);
        if (!mat) return null;
        const solicitado = Number(it.cantidad) || 0;
        const stock = Number(mat.stock_actual || 0);
        const minimo = Number(mat.stock_minimo || 0);
        const stockTrasUsar = stock - solicitado;
        const faltante = Math.max(0, solicitado - stock);
        const cubreSinTocarMin = stockTrasUsar >= minimo;
        const status = faltante > 0 ? 'faltante'
                     : !cubreSinTocarMin ? 'baja_a_minimo'
                     : 'suficiente';
        return {
          ...it,
          mat,
          solicitado,
          stockActual: stock,
          stockMinimo: minimo,
          stockTrasUsar,
          faltante,
          status,
        };
      })
      .filter(Boolean);
  }, [items, matsArr]);

  const stats = uM(() => ({
    total: proyeccion.length,
    suficientes: proyeccion.filter(p => p.status === 'suficiente').length,
    bajaMin: proyeccion.filter(p => p.status === 'baja_a_minimo').length,
    faltantes: proyeccion.filter(p => p.status === 'faltante').length,
    requisicionItems: proyeccion.filter(p => p.status !== 'suficiente'),
    suficientesItems: proyeccion.filter(p => p.status === 'suficiente'),
  }), [proyeccion]);

  const addItem = () => setItems(prev => [...prev, { id: Date.now(), material_id: '', material_nombre: '', cantidad: '', unidad: '', notas: '' }]);
  const removeItem = (id) => setItems(prev => prev.length === 1 ? prev : prev.filter(it => it.id !== id));
  const updateItem = (id, patch) => setItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));

  // ── Asistente IA ────────────────────────────────────────────
  // Política auto-apply: confianza ≥0.85 sin advertencias críticas → aplica
  // directo al form. Sino, muestra panel de revisión.
  const aplicarAuto = (sug) => {
    if (!sug || !Array.isArray(sug.result?.items)) return false;
    const conf = Number(sug.confianza || 0);
    const advCriticas = (sug.advertencias || []).some(a => /no encontr|inv[aá]lid|critic/i.test(String(a)));
    return conf >= 0.85 && !advCriticas && sug.result.items.length > 0;
  };

  const aplicarSugerenciaIA = (sug, textoOriginal) => {
    if (!sug?.result) return;
    // Volcar items al form. El nombre del material va SOLO con el nombre,
    // la cantidad va en su columna y la unidad en la suya — no las
    // mezclamos aunque la IA las haya devuelto pegadas.
    const nuevosItems = sug.result.items.map((it, i) => {
      const matCatalogo = it.material_id ? matsArr.find(m => m.id === it.material_id) : null;
      const nombreLimpio = sanearNombreItem(matCatalogo?.nombre_material || it.nombre_match || '');
      return {
        id: Date.now() + i,
        material_id: it.material_id || '',
        material_nombre: nombreLimpio,
        cantidad: String(it.cantidad ?? ''),
        unidad: matCatalogo?.unidad || it.unidad || '',
        notas: [it.notas, it.accion === 'crear_nuevo' ? '⚠ Material nuevo (no en catálogo)' : null].filter(Boolean).join(' · '),
      };
    });
    if (nuevosItems.length === 0) return;
    setItems(nuevosItems);
    if (sug.result.descripcion_estructurada && !descripcion.trim()) {
      setDescripcion(sug.result.descripcion_estructurada);
    }
    if (sug.result.fecha_necesidad_sugerida) {
      const f = sug.result.fecha_necesidad_sugerida;
      if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
        const hoy = new Date().toISOString().slice(0,10);
        if (f >= hoy) setFechaNecesidad(f);
      }
    }
    if (sug.result.prioridad_sugerida) setAiPriority(sug.result.prioridad_sugerida);
    // Si la IA detectó que la solicitud venía de otra persona (campo
    // explícito del LLM) o si el regex local lo detecta del texto, y
    // el usuario NO había editado el campo Solicitante, lo seteamos.
    if (solicitanteNombre === userName) {
      const detectadoIA = sug.result?.solicitante_detectado;
      const detectadoRegex = textoOriginal ? detectarSolicitanteEnTexto(textoOriginal) : null;
      const detectado = detectadoIA || detectadoRegex;
      if (detectado && detectado !== userName) {
        setSolicitanteNombre(detectado);
      }
    }
  };

  const generarConIA = async () => {
    if (!obraId) { showToast('Cargando obra activa…', 'amber'); return; }
    if (!aiPrompt.trim() || aiPrompt.trim().length < 5) {
      showToast('Escribí qué necesitás (mín 5 caracteres)', 'red');
      return;
    }
    setAiBusy(true);
    setAiResult(null);
    try {
      // Catálogo de materiales de la obra (para matching)
      const materialesObra = matsArr.map(m => ({
        id: m.id,
        nombre_material: m.nombre_material,
        unidad: m.unidad,
        stock_actual: m.stock_actual,
        stock_minimo: m.stock_minimo,
        categoria: m.categoria,
        precio_unitario_estimado: m.precio_unitario_estimado,
      }));

      // Histórico: últimas 8 solicitudes con sus items
      let historico = [];
      let partidasObra = [];
      let proveedores = [];
      let nombreObra = '';
      try {
        const reqs = await window.__db.requisiciones
          .where('obra_id').equals(obraId)
          .filter(r => !r.deleted_at)
          .toArray();
        const recientes = reqs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).slice(0, 8);
        for (const r of recientes) {
          const its = await window.__db.requisicion_items
            .where('requisicion_id').equals(r.id)
            .filter(x => !x.deleted_at)
            .toArray();
          historico.push({
            descripcion: r.descripcion || r.notas || '',
            items: its.map(it => ({
              material_id: it.material_id,
              nombre_match: it.descripcion || matsArr.find(m => m.id === it.material_id)?.nombre_material || '',
              cantidad: it.cantidad,
              unidad: it.unidad,
            })),
          });
        }
        // Partidas
        const ps = await window.__db.partidas.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray();
        partidasObra = ps.slice(0, 50).map(p => ({ id: p.id, codigo_delfin: p.codigo_delfin, nombre_partida: p.nombre_partida }));
        // Proveedores
        const provs = await window.__db.proveedores.filter(p => !p.deleted_at && p.estado !== 'inactivo').toArray();
        proveedores = provs.slice(0, 30).map(p => ({ id: p.id, razon_social: p.razon_social, ruc: p.ruc }));
        // Obra
        const obra = await window.__db.obras.get(obraId);
        nombreObra = obra?.nombre_obra || '';
      } catch (e) { /* ignore — el asistente igual puede trabajar sin contexto extra */ }

      const sug = await asistenteSolicitudMaterialesAI({
        descripcion: aiPrompt.trim(),
        materiales_obra: materialesObra,
        historico_solicitudes: historico,
        partidas_obra: partidasObra,
        proveedores,
        fecha_actual: new Date().toISOString().slice(0, 10),
        nombre_obra: nombreObra,
      });
      setAiResult(sug);
      try {
        await window.__logAudit?.({
          action: 'insert', table: 'audit', recordId: 'asistente-solicitud-mat',
          newData: {
            confianza: sug.confianza,
            items_count: sug.result.items.length,
            descripcion_input: aiPrompt.slice(0, 100),
            obra_id: obraId,
          },
          reason: `IA Asistente Solicitud · ${sug.result.items.length} items · confianza ${(sug.confianza*100).toFixed(0)}%`,
        });
      } catch {}

      if (aplicarAuto(sug)) {
        aplicarSugerenciaIA(sug, aiPrompt);
        showToast(`✓ ${sug.result.items.length} items generados por IA (${(sug.confianza*100).toFixed(0)}% confianza)`, 'green');
        setAiPrompt('');
      } else {
        // Mantener el panel visible para que el usuario revise
        showToast(`Generado con confianza ${(sug.confianza*100).toFixed(0)}% — revisar antes de aplicar`, 'amber');
      }
    } catch (e) {
      showToast('Asistente IA: ' + (e.message || e), 'red');
    } finally {
      setAiBusy(false);
    }
  };

  const handleMaterialChange = (rowId, value) => {
    const limpio = sanearNombreItem(value);
    const mat = matsByName.get(limpio.toLowerCase()) || matsByName.get(value.toLowerCase());
    if (mat) {
      // Auto-popular unidad cuando se selecciona un material del catálogo
      updateItem(rowId, { material_id: mat.id, material_nombre: mat.nombre_material, unidad: mat.unidad || '' });
    } else {
      updateItem(rowId, { material_id: '', material_nombre: limpio });
    }
  };

  const handleSubmit = async () => {
    if (!obraId) { showToast('Selecciona una obra activa', 'red'); return; }
    if (!descripcion.trim()) { showToast('Descripción de la solicitud requerida', 'red'); return; }
    const validos = items.filter(it => it.material_id && Number(it.cantidad) > 0);
    if (!validos.length) { showToast('Agrega al menos un material', 'red'); return; }

    setSubmitBusy(true);
    try {
      const now = new Date().toISOString();
      // Crear SIEMPRE una requisición — el almacenero la necesita para
      // preparar entrega aunque haya stock. Antes este else-branch solo
      // disparaba una notificación in-memory que se perdía → el almacenero
      // nunca se enteraba de la solicitud.
      const stockSuficiente = stats.requisicionItems.length === 0;
      const reqId = window.__newId();
      const reqsObra = await window.__db.requisiciones.where('obra_id').equals(obraId).filter(r=>!r.deleted_at).toArray();
      const sigNum = (reqsObra.length || 0) + 1;
      const codigo = `REQ-${new Date().getFullYear()}-${String(sigNum).padStart(4, '0')}`;
      const prioridad = stats.faltantes > 0 ? 'urgente' : (stockSuficiente ? 'normal' : 'alta');
      const estado = stockSuficiente ? 'aprobada' : 'pendiente_aprobacion';
      const solicitanteFinal = solicitanteNombre?.trim() || userName;
      const fechaFinal = fechaCreacion || now.slice(0,10);

      const notasReq = stockSuficiente
        ? `${solicitanteFinal !== userName ? `Solicitado por ${solicitanteFinal}, cargado por ${userName}. ` : `Cargado por ${userName}. `}Stock suficiente — lista para entrega.`
        : `${solicitanteFinal !== userName ? `Solicitado por ${solicitanteFinal}, cargado por ${userName}. ` : `Cargado por ${userName}. `}${stats.faltantes > 0 ? `${stats.faltantes} item(s) sin stock suficiente.` : ''} ${stats.bajaMin > 0 ? `${stats.bajaMin} item(s) bajarían al stock mínimo.` : ''}`.trim();

      await window.__db.requisiciones.add({
        id: reqId, obra_id: obraId,
        codigo, fecha: fechaFinal,
        descripcion: descripcion,
        prioridad,
        estado,
        solicitante_id: userId,
        solicitante_nombre: solicitanteFinal,
        fecha_necesidad: fechaNecesidad,
        notas: notasReq,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_requisiciones_${reqId}`,
      });

      // Items de la requisición. Si hay faltante, sale el cálculo de
      // "cuánto pedir al proveedor". Si stock alcanza, agrega solo lo
      // que el residente pidió, para que el almacenero sepa cuánto
      // entregar.
      const itemsParaCrear = stockSuficiente
        ? stats.suficientesItems
        : stats.requisicionItems;

      for (const p of itemsParaCrear) {
        const cantPedir = stockSuficiente
          ? p.solicitado
          : (p.faltante > 0
              ? p.faltante + Math.max(0, p.stockMinimo - 0)
              : Math.max(0, p.stockMinimo * 2 - p.stockActual));
        const itemId = window.__newId();
        const itemForm = items.find(it => it.material_id === p.mat.id);
        const unidadFinal = itemForm?.unidad?.trim() || p.mat.unidad;
        await window.__db.requisicion_items.add({
          id: itemId, requisicion_id: reqId,
          material_id: p.mat.id,
          descripcion: sanearNombreItem(p.mat.nombre_material),
          unidad: unidadFinal,
          cantidad: cantPedir,
          precio_estimado: Number(p.mat.precio_unitario_estimado || 0),
          notas: stockSuficiente
            ? [itemForm?.notas || null, `Solicitado ${p.solicitado} · stock OK`].filter(Boolean).join(' · ')
            : [
                itemForm?.notas || null,
                p.status === 'faltante'
                  ? `Solicitado ${p.solicitado}, en stock ${p.stockActual}, falta ${p.faltante}`
                  : `Solicitado ${p.solicitado}, en stock ${p.stockActual}, bajaría a ${p.stockTrasUsar} (mín ${p.stockMinimo})`,
              ].filter(Boolean).join(' · '),
          created_at: now, updated_at: now,
          sync_status: 'pending_create',
          idempotency_key: `${userId}_req_items_${itemId}`,
        });
      }

      try { await window.__logAudit?.({
        action:'insert', table:'requisiciones', recordId:reqId,
        newData:{ codigo, items: itemsParaCrear.length, solicitante: solicitanteFinal, estado },
        reason:`Solicitud · ${descripcion}`,
      }); } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'requisiciones' } })); } catch {}
      try { window.dispatchEvent(new CustomEvent('jarvex_new_notif', {
        detail: {
          tipo: 'requisicion',
          titulo: stockSuficiente
            ? `Solicitud ${codigo} lista para entrega`
            : `Requisición ${codigo} (${prioridad})`,
          descripcion: stockSuficiente
            ? `${itemsParaCrear.length} ítems con stock OK · solicitó ${solicitanteFinal}`
            : `${stats.requisicionItems.length} ítems sin stock · solicitó ${solicitanteFinal}`,
        }
      })); } catch {}

      const toastMsg = stockSuficiente
        ? `✓ Solicitud ${codigo} registrada · ${itemsParaCrear.length} ítems listos para entrega`
        : `✓ Requisición ${codigo} creada · ${stats.requisicionItems.length} ítem(s) requieren compra`;
      showToast(toastMsg, stockSuficiente ? 'green' : 'amber');
      setUltimaReq({ id: reqId, codigo, prioridad, items: itemsParaCrear.length, estado });

      // Limpiar form (manteniendo el solicitante por si carga otra solicitud seguida)
      setItems([{ id: 1, material_id: '', material_nombre: '', cantidad: '', unidad: '', notas: '' }]);
      setDescripcion('');
      setPreviewing(false);
    } catch (e) {
      showToast('Error: ' + (e.message || e), 'red');
    } finally {
      setSubmitBusy(false);
    }
  };

  if (!obraId) {
    return (
      <div className="page-wrap">
        <div className="empty-state">
          <JxIcon name="hardHat" size={32} color="var(--tm)"/>
          <p>Cargando obra activa…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Solicitud de Materiales</div>
          <div className="pg-sub">El residente carga lo que necesita · sistema proyecta stock y crea requisición si falta</div>
        </div>
      </div>

      <div className="card card-p" style={{ marginBottom:14, background:'rgba(155,89,182,0.06)', border:'1px solid rgba(155,89,182,0.2)' }}>
        <div style={{ display:'flex', gap:10, alignItems:'flex-start', fontSize:12.5, color:'var(--ts)' }}>
          <JxIcon name="info" size={14} color="#9B59B6"/>
          <div>
            <strong style={{ color:'#9B59B6' }}>¿Cómo funciona?</strong> Carga los materiales que necesitarás esta semana. El sistema:
            <ul style={{ margin:'6px 0 0', paddingLeft:18, fontSize:11.5, color:'var(--tm)', lineHeight:1.6 }}>
              <li><strong>Stock suficiente</strong> → no hace nada (sale del almacén normal)</li>
              <li><strong>Bajaría al mínimo</strong> → crea requisición de prioridad ALTA con buffer</li>
              <li><strong>Falta stock</strong> → crea requisición URGENTE con la diferencia + buffer</li>
            </ul>
          </div>
        </div>
      </div>

      {/* ── Asistente IA (Captura por descripción libre) ──────── */}
      <div className="card card-p" style={{ marginBottom:14, background:'rgba(155,89,182,0.07)', border:'1px solid rgba(155,89,182,0.3)' }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10, marginBottom:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:16 }}>✨</span>
            <div>
              <div style={{ fontSize:13, fontWeight:700, color:'#9B59B6' }}>Asistente IA · Generar solicitud por descripción</div>
              <div style={{ fontSize:11, color:'var(--tm)' }}>Describí qué necesitás en lenguaje natural — la IA arma los items, cantidades y prioridad.</div>
            </div>
          </div>
          {aiResult && (
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              onClick={()=>{ setAiResult(null); setAiPrompt(''); }}
              title="Cerrar panel del asistente">
              ✕
            </button>
          )}
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
          <textarea className="fi" rows={2}
            value={aiPrompt}
            onChange={e=>setAiPrompt(e.target.value)}
            placeholder='Ej: "Para vaciado de losa nivel 3 esta semana — necesito cemento, fierro 1/2 y 5/8, agregados, alambre #16 y triplay para encofrado."'
            style={{ flex:1, fontSize:12.5 }}
            disabled={aiBusy}/>
          <button className="btn btn-amber btn-sm"
            onClick={generarConIA}
            disabled={aiBusy || aiPrompt.trim().length < 5}
            style={{ minWidth:140, alignSelf:'stretch' }}>
            {aiBusy ? '⏳ Generando…' : '✨ Generar'}
          </button>
        </div>

        {/* Panel de revisión cuando confianza < 0.85 (auto-apply ya volcó al form en confianza alta) */}
        {aiResult && !aplicarAuto(aiResult) && (
          <div style={{ marginTop:10, padding:'10px 12px', background:'rgba(255,255,255,0.04)', borderRadius:8, border:'1px solid var(--border)' }}>
            <div style={{ fontSize:11, color: 'var(--amber)', fontWeight:600, marginBottom:6 }}>
              ⚠ Revisar antes de aplicar — confianza {(aiResult.confianza*100).toFixed(0)}%
            </div>
            {aiResult.razonamiento && (
              <div style={{ fontSize:11, color:'var(--ts)', marginBottom:8 }}>{aiResult.razonamiento}</div>
            )}
            {aiResult.advertencias?.length > 0 && (
              <div style={{ fontSize:10.5, color:'var(--amber)', marginBottom:8 }}>
                {aiResult.advertencias.map((a, i) => <div key={i}>• {a}</div>)}
              </div>
            )}
            <div style={{ marginTop:6, marginBottom:8, fontSize:11, color:'var(--tm)' }}>
              <strong>Items propuestos ({aiResult.result.items.length}):</strong>
            </div>
            <div style={{ overflowX:'auto', maxHeight:220 }}>
              <table className="tbl" style={{ fontSize:11 }}>
                <thead><tr>
                  <th>Material</th><th>Cant</th><th>Unid</th><th>Acción</th><th>Conf</th>
                </tr></thead>
                <tbody>
                  {aiResult.result.items.map((it, i) => (
                    <tr key={i}>
                      <td style={{ maxWidth:240 }}>{it.nombre_match}</td>
                      <td style={{ textAlign:'right' }}>{it.cantidad}</td>
                      <td>{it.unidad}</td>
                      <td>
                        <span className={`badge ${it.accion === 'crear_nuevo' ? 'b-amber' : 'b-green'}`} style={{ fontSize:10 }}>
                          {it.accion === 'crear_nuevo' ? 'Nuevo' : 'Existe'}
                        </span>
                      </td>
                      <td style={{ fontSize:10, color:'var(--tm)' }}>{Math.round((it.confianza_item || 0) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop:10, display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={()=>{ setAiResult(null); }}>
                Descartar
              </button>
              <button className="btn btn-amber btn-sm" onClick={()=>{ aplicarSugerenciaIA(aiResult, aiPrompt); setAiResult(null); setAiPrompt(''); showToast('Items aplicados al form', 'green'); }}>
                <JxIcon name="check" size={12}/> Aplicar al form
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Encabezado de la solicitud */}
      <div className="card card-p" style={{ marginBottom:14 }}>
        <div className="g2">
          <div style={{ gridColumn:'1/-1' }}>
            <label className="flabel">Descripción de la solicitud *</label>
            <input className="fi" value={descripcion} onChange={e=>setDescripcion(e.target.value)} placeholder="Ej: Materiales para vaciado de losa nivel 3 - Semana 18"/>
          </div>
          <div>
            <label className="flabel" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <span>Solicitante</span>
              {solicitanteNombre !== userName && (
                <button type="button" className="btn btn-ghost btn-xs"
                  title="Volver a mi nombre (usuario actual)"
                  onClick={()=>setSolicitanteNombre(userName)}
                  style={{ fontSize:10 }}>↺ Soy yo</button>
              )}
            </label>
            <input className="fi" value={solicitanteNombre}
              onChange={e=>setSolicitanteNombre(e.target.value)}
              placeholder="Ej: Maestro de obra Juan Pérez"/>
            <div style={{ fontSize:10, color:'var(--tm)', marginTop:3 }}>
              {solicitanteNombre === userName
                ? `Sos vos — editá si la solicitud viene de otra persona`
                : `Usuario que carga el sistema: ${userName}`}
            </div>
          </div>
          <div>
            <label className="flabel">Fecha de creación</label>
            <input className="fi" type="date" value={fechaCreacion}
              max={new Date().toISOString().slice(0,10)}
              onChange={e=>setFechaCreacion(e.target.value)}/>
          </div>
          <div>
            <label className="flabel">Fecha en que se necesita *</label>
            <input className="fi" type="date" value={fechaNecesidad}
              min={fechaCreacion}
              onChange={e=>setFechaNecesidad(e.target.value)}/>
          </div>
        </div>
      </div>

      {/* Items de la solicitud */}
      <div className="card card-p" style={{ marginBottom:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
          <div style={{ fontSize:12.5, fontWeight:700, color:'var(--ts)' }}>Materiales solicitados</div>
          <button className="btn btn-amber btn-sm" onClick={addItem}>
            <JxIcon name="plus" size={11}/> Agregar item
          </button>
        </div>
        <div style={{ overflow:'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th style={{ minWidth:280 }}>Material</th>
              <th style={{ minWidth:100 }}>Cantidad</th>
              <th style={{ minWidth:60 }}>Unidad</th>
              <th style={{ minWidth:80 }}>Stock</th>
              <th style={{ minWidth:80 }}>Estado</th>
              <th style={{ minWidth:200 }}>Notas</th>
              <th></th>
            </tr></thead>
            <tbody>
              {items.map(it => {
                const proj = proyeccion.find(p => p.id === it.id);
                const mat = it.material_id ? matsArr.find(m => m.id === it.material_id) : null;
                return (
                  <tr key={it.id}>
                    <td>
                      <input className="fi" list={`mats-${it.id}`}
                        value={it.material_nombre}
                        onChange={e=>handleMaterialChange(it.id, e.target.value)}
                        placeholder="Empieza a escribir..."/>
                      <datalist id={`mats-${it.id}`}>
                        {matsArr.map(m => <option key={m.id} value={m.nombre_material}/>)}
                      </datalist>
                    </td>
                    <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad} onChange={e=>updateItem(it.id, { cantidad: e.target.value })}/></td>
                    <td>
                      <input className="fi" style={{ fontSize:11, padding:'4px 6px', minWidth:60 }}
                        value={it.unidad || mat?.unidad || ''}
                        onChange={e=>updateItem(it.id, { unidad: e.target.value })}
                        placeholder="bls/kg/m..."/>
                    </td>
                    <td style={{ textAlign:'right' }}>{mat ? `${fmtN(mat.stock_actual)} (mín ${fmtN(mat.stock_minimo)})` : '—'}</td>
                    <td>
                      {proj && (
                        <span className={`badge ${proj.status === 'suficiente' ? 'b-green' : proj.status === 'baja_a_minimo' ? 'b-amber' : 'b-red'}`}>
                          {proj.status === 'suficiente' ? '✓ OK' : proj.status === 'baja_a_minimo' ? '⚠ Mínimo' : '✗ Falta'}
                        </span>
                      )}
                    </td>
                    <td><input className="fi" value={it.notas} onChange={e=>updateItem(it.id, { notas: e.target.value })} placeholder="opcional"/></td>
                    <td>
                      <button className="btn btn-ghost btn-xs" onClick={()=>removeItem(it.id)} disabled={items.length === 1}>
                        <JxIcon name="trash" size={11}/>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Banner post-submit: a dónde fue la solicitud + acceso directo */}
      {ultimaReq && (
        <div className="card card-p" style={{ marginBottom:14, background:'rgba(46,204,113,0.07)', border:'1px solid rgba(46,204,113,0.3)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
            <div style={{ flex:1, minWidth:240 }}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--green)' }}>
                ✓ Requisición {ultimaReq.codigo} creada
              </div>
              <div style={{ fontSize:11.5, color:'var(--ts)', marginTop:4 }}>
                Está en estado <strong>pendiente de aprobación</strong> con prioridad <strong style={{ textTransform:'uppercase' }}>{ultimaReq.prioridad}</strong>.
                El admin/jefe de compras la verá en <strong>Requisiciones</strong> y podrá generar la Orden de Compra.
              </div>
            </div>
            <button className="btn btn-amber btn-sm"
              onClick={()=>{ try { window.location.hash = '#/requisiciones'; } catch {} }}>
              Ir a Requisiciones <JxIcon name="chevR" size={11}/>
            </button>
            <button className="btn btn-ghost btn-sm" onClick={()=>setUltimaReq(null)}>Cerrar</button>
          </div>
          <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:8, lineHeight:1.5 }}>
            <strong>Flujo:</strong> Solicitud → <strong>Requisición</strong> (acá quedó) → aprobación → <strong>Orden de Compra</strong> (botón "OC" en cada requisición) → imprimir y firmar → enviar al proveedor.
          </div>
        </div>
      )}

      {/* Resumen de proyección */}
      {proyeccion.length > 0 && (
        <div className="card card-p" style={{ marginBottom:14, background:'rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize:12.5, fontWeight:700, color:'var(--ts)', marginBottom:10 }}>Proyección sobre stock actual</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12 }}>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--blue)' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>SOLICITADOS</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--blue)' }}>{stats.total}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--green)' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>STOCK SUFICIENTE</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--green)' }}>{stats.suficientes}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--amber)' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>BAJARÁ AL MÍNIMO</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--amber)' }}>{stats.bajaMin}</div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--red)' }}>
              <div style={{ fontSize:11, color:'var(--tm)' }}>SIN STOCK</div>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--red)' }}>{stats.faltantes}</div>
            </div>
          </div>
          {stats.requisicionItems.length > 0 && (
            <div style={{ marginTop:12, padding:'10px 14px', background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.3)', borderRadius:8, fontSize:12.5, color:'var(--ts)' }}>
              <strong style={{ color:'var(--amber)' }}>Al enviar</strong> se generará una requisición de prioridad{' '}
              <strong>{stats.faltantes > 0 ? 'URGENTE' : 'ALTA'}</strong> con {stats.requisicionItems.length} ítem(s) para reponer stock.
            </div>
          )}
          {stats.requisicionItems.length === 0 && (
            <div style={{ marginTop:12, padding:'10px 14px', background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.3)', borderRadius:8, fontSize:12.5, color:'var(--ts)' }}>
              <strong style={{ color:'var(--green)' }}>✓ Stock suficiente</strong> para todos los ítems. No se generará requisición.
            </div>
          )}
        </div>
      )}

      <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
        <button className="btn btn-ghost" onClick={()=>{
          setItems([{ id: 1, material_id: '', material_nombre: '', cantidad: '', notas: '' }]);
          setDescripcion('');
        }}>
          Limpiar
        </button>
        <button
          className="btn btn-amber"
          disabled={submitBusy || proyeccion.length === 0 || !descripcion.trim()}
          onClick={handleSubmit}>
          <JxIcon name="check" size={13}/>
          {stats.requisicionItems.length > 0 ? 'Enviar y crear requisición' : 'Confirmar solicitud'}
        </button>
      </div>
    </div>
  );
}

Object.assign(window, { SolicitudResidentePage });
export default SolicitudResidentePage;
