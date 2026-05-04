import React from "react";
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
  const isAdmin = auth?.profile?.rol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';

  const { data: companies } = window.__hooks?.useCompanies?.() || { data: [] };
  const { data: obras } = window.__hooks?.useObras?.() || { data: [] };
  const { data: movs } = window.__hooks?.useAccountingMovements?.() || { data: [] };

  // [items] cada item = { id, file, name, status, base64, mimeType, parsed, error, review }
  const [items, setItems] = uSCM([]);
  const [reviewing, setReviewing] = uSCM(null); // id del item siendo revisado
  const [proveedoresDB, setProveedoresDB] = uSCM([]);
  const [materialesDB, setMaterialesDB] = uSCM([]);
  const fileInputRef = uRCM(null);

  // Cargar proveedores y materiales
  uECM(() => {
    let mounted = true;
    const cargar = async () => {
      try {
        const [p, m] = await Promise.all([
          window.__db.proveedores.filter(x => !x.deleted_at).toArray(),
          window.__db.materiales.filter(x => !x.deleted_at).toArray(),
        ]);
        if (!mounted) return;
        setProveedoresDB(p);
        setMaterialesDB(m);
      } catch (e) { console.error('[captura-magica] carga DB', e); }
    };
    cargar();
    const onCh = () => cargar();
    window.addEventListener('jx_data_changed', onCh);
    return () => { mounted = false; window.removeEventListener('jx_data_changed', onCh); };
  }, []);

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
  const procesarItem = async (id, file) => {
    setItems(prev => prev.map(x => x.id === id ? { ...x, status: 'procesando' } : x));
    try {
      const base64 = await fileToBase64(file);
      const resp = await fetch('/api/captura-magica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: base64, mimeType: file.type }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || data.detail || `HTTP ${resp.status}`);
      }
      const ext = data.extracted || {};
      // Detectar duplicado: mismo emisor RUC + serie_correlativo
      const dup = (movs || []).find(m =>
        !m.deleted_at &&
        (m.third_party_ruc === ext.emisor?.ruc) &&
        (m.document_number === ext.serie_correlativo)
      );
      setItems(prev => prev.map(x => x.id === id ? {
        ...x,
        base64,
        parsed: ext,
        status: dup ? 'duplicado' : 'revisar',
        review: buildInitialReview(ext, companies, obras, proveedoresDB, materialesDB),
        duplicate_of: dup?.id || null,
      } : x));
    } catch (e) {
      setItems(prev => prev.map(x => x.id === id ? {
        ...x, status: 'error', error: e.message || String(e),
      } : x));
    }
  };

  // ── Build review state desde el JSON extraído ───────────────
  const buildInitialReview = (ext, companies, obras, proveedoresDB, materialesDB) => {
    if (!ext) return null;
    // Emisor (proveedor)
    const ruc = ext.emisor?.ruc || '';
    const proveedorMatch = ruc ? proveedoresDB.find(p => p.ruc === ruc) : null;
    // Receptor (empresa del grupo)
    const rucRec = ext.receptor?.documento || '';
    const companyMatch = rucRec ? (companies || []).find(c => c.ruc === rucRec && c.status === 'activa') : null;
    // Obra: si la company tiene 1 obra activa, autoseleccionar
    let obraSugerida = '';
    if (companyMatch) {
      const obrasCo = (obras || []).filter(o => !o.deleted_at && (
        o.ejecutora_company_id === companyMatch.id ||
        (o.ejecutora_tipo === 'consorcio' && (o.consorcio_miembros||[]).some(m => m.company_id === companyMatch.id))
      ));
      if (obrasCo.length === 1) obraSugerida = obrasCo[0].id;
    }
    // Items: match con materiales existentes
    const items = (ext.items || []).map((it, idx) => {
      const candidatos = materialesDB
        .map(m => ({ m, score: fuzzyScore(it.descripcion, m.nombre_material) }))
        .filter(x => x.score >= 0.5)
        .sort((a, b) => b.score - a.score);
      const top = candidatos[0];
      return {
        ...it,
        idx,
        material_id: top ? top.m.id : '',
        accion_material: top ? 'usar_existente' : 'crear_nuevo',
        unidad: it.unidad || top?.m.unidad || 'und',
        // sugerencia de stock_minimo / partida_id si existe
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
      company_id: companyMatch?.id || (companies?.[0]?.id || ''),
      receptor_documento: rucRec,
      receptor_razon_social: ext.receptor?.razon_social_o_nombre || '',
      // Obra
      obra_id: obraSugerida,
      // Items
      items,
      // Totales
      subtotal: Number(ext.totales?.subtotal || 0),
      igv: Number(ext.totales?.igv || 0),
      total: Number(ext.totales?.total || 0),
      observaciones: ext.observaciones || '',
      confianza: ext.confianza || 'media',
      advertencias: ext.advertencias || [],
      // Material commit options
      crear_movimiento_materiales: true, // si true, además del cost crea entradas de inventario
    };
  };

  // ── Confirmar e insertar en DB ──────────────────────────────
  const confirmarItem = async (id) => {
    const it = items.find(x => x.id === id);
    if (!it || !it.review) return;
    const r = it.review;

    // Validaciones
    if (r.company_accion === 'crear_nueva') {
      if (!r.nueva_company_name?.trim()) { showToast('Falta nombre de la empresa nueva', 'red'); return; }
    } else if (!r.company_id) {
      showToast('Falta empresa compradora del grupo', 'red'); return;
    }
    if (!r.serie_correlativo) { showToast('Falta serie-correlativo', 'red'); return; }
    if (!(Number(r.total) > 0)) { showToast('El total debe ser mayor a 0', 'red'); return; }

    const now = new Date().toISOString();
    let proveedorIdFinal = r.proveedor_id;
    let companyIdFinal = r.company_id;

    try {
      // 0) Crear empresa del grupo si nueva
      if (r.company_accion === 'crear_nueva') {
        const cid = window.__newId();
        await window.__db.companies.add({
          id: cid,
          name: r.nueva_company_name.trim(),
          legal_name: r.nueva_company_legal?.trim() || r.nueva_company_name.trim(),
          ruc: r.nueva_company_ruc || null,
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
          idempotency_key: `${userId}_company_${cid}`,
        });
        try { await window.__logAudit?.({ action:'insert', table:'companies', recordId: cid,
          newData: { name: r.nueva_company_name, ruc: r.nueva_company_ruc, rol_grupo: r.nueva_company_rol },
          reason:'Captura mágica · empresa nueva del grupo' }); } catch {}
        companyIdFinal = cid;
      }

      // 1) Crear proveedor si nuevo
      if (r.proveedor_accion === 'crear_nuevo') {
        if (!r.proveedor_razon_social?.trim()) {
          showToast('Falta razón social del proveedor', 'red'); return;
        }
        const pid = window.__newId();
        await window.__db.proveedores.add({
          id: pid,
          razon_social: r.proveedor_razon_social.trim(),
          ruc: r.proveedor_ruc || null,
          direccion: r.proveedor_direccion || null,
          estado: 'activo',
          tipo_proveedor: 'proveedor',
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create',
          idempotency_key: `${userId}_prov_${pid}`,
        });
        try { await window.__logAudit?.({ action:'insert', table:'proveedores', recordId: pid,
          newData: { ruc: r.proveedor_ruc, razon: r.proveedor_razon_social }, reason:'Captura mágica · crear proveedor' }); } catch {}
        proveedorIdFinal = pid;
      }

      // 2) Crear materiales nuevos + movimientos_materiales
      const materialesCreados = [];
      const movsMatCreados = [];
      if (r.crear_movimiento_materiales && r.obra_id) {
        for (const it of r.items) {
          let matId = it.material_id;
          if (it.accion_material === 'crear_nuevo') {
            if (!it.descripcion?.trim()) continue;
            matId = window.__newId();
            await window.__db.materiales.add({
              id: matId,
              obra_id: r.obra_id,
              nombre_material: it.descripcion.trim().slice(0, 120),
              unidad: it.unidad || 'und',
              categoria: 'Otro',
              stock_inicial: Number(it.cantidad) || 0,
              stock_actual: Number(it.cantidad) || 0,
              stock_minimo: 0,
              precio_unitario_estimado: Number(it.precio_unitario) || 0,
              alerta: 'ok',
              estado: 'activo',
              proveedor_principal_id: proveedorIdFinal || null,
              created_by: userId, updated_by: userId,
              created_at: now, updated_at: now,
              version: 1, sync_status: 'pending_create',
              idempotency_key: `${userId}_mat_${matId}`,
            });
            materialesCreados.push(matId);
            try { await window.__logAudit?.({ action:'insert', table:'materiales', recordId: matId,
              newData: { nombre: it.descripcion, stock_inicial: it.cantidad }, reason:'Captura mágica · material nuevo' }); } catch {}
          } else if (matId) {
            // Sumar al stock_actual
            const mat = await window.__db.materiales.get(matId);
            if (mat) {
              await window.__db.materiales.update(matId, {
                stock_actual: (Number(mat.stock_actual) || 0) + (Number(it.cantidad) || 0),
                updated_at: now, updated_by: userId,
                version: (mat.version || 0) + 1,
                sync_status: mat.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
              });
            }
          }
          // Movimiento de materiales (entrada)
          if (matId) {
            const movId = window.__newId();
            await window.__db.movimientos_materiales.add({
              id: movId,
              obra_id: r.obra_id,
              material_id: matId,
              fecha: r.fecha_emision,
              hora: '12:00',
              tipo_movimiento: 'entrada',
              cantidad: Number(it.cantidad) || 0,
              unidad: it.unidad || 'und',
              proveedor_id: proveedorIdFinal || null,
              documento_asociado: r.serie_correlativo,
              precio_unitario_real: Number(it.precio_unitario) || 0,
              observaciones: 'Captura Mágica IA',
              created_by: userId, updated_by: userId,
              created_at: now, updated_at: now,
              version: 1, sync_status: 'pending_create',
              idempotency_key: `${userId}_movmat_${movId}`,
            });
            movsMatCreados.push(movId);
          }
        }
      }

      // 3) Accounting movement (cost)
      const accId = window.__newId();
      const tipoAcc = TIPO_DOC_MAP[r.tipo_documento]?.acc || 'factura';
      await window.__db.accounting_movements.add({
        id: accId,
        company_id: companyIdFinal,
        obra_id: r.obra_id || null,
        date: r.fecha_emision,
        type: 'cost',
        category: TIPO_DOC_MAP[r.tipo_documento]?.label || 'Factura',
        description: `${TIPO_DOC_MAP[r.tipo_documento]?.label || 'Factura'} ${r.serie_correlativo} · ${r.proveedor_razon_social}`,
        amount: Number(r.total) || 0,
        currency: r.moneda || 'PEN',
        third_party_name: r.proveedor_razon_social || null,
        third_party_ruc: r.proveedor_ruc || null,
        payment_status: 'pending',
        document_type: tipoAcc,
        document_number: r.serie_correlativo,
        proveedor_id: proveedorIdFinal || null,
        notas: JSON.stringify({
          captura_magica: true,
          confianza: r.confianza,
          advertencias: r.advertencias,
          subtotal: r.subtotal, igv: r.igv,
          materiales_creados: materialesCreados.length,
          movs_creados: movsMatCreados.length,
        }),
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create',
        idempotency_key: `${userId}_acc_${accId}`,
      });
      try { await window.__logAudit?.({ action:'insert', table:'accounting_movements', recordId: accId,
        newData: { tipo: r.tipo_documento, doc: r.serie_correlativo, total: r.total }, reason:'Captura mágica · ingreso comprobante' }); } catch {}

      // 4) Evidencia (PDF/imagen)
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
      } catch (e) { console.warn('[captura-magica] evidencia', e); }

      // Marca como confirmado
      setItems(prev => prev.map(x => x.id === id ? { ...x, status: 'confirmado', accId } : x));
      // Refrescar proveedores/materiales locales
      try {
        const [p, m] = await Promise.all([
          window.__db.proveedores.filter(x => !x.deleted_at).toArray(),
          window.__db.materiales.filter(x => !x.deleted_at).toArray(),
        ]);
        setProveedoresDB(p); setMaterialesDB(m);
      } catch {}
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail:{ tabla:'accounting_movements' } })); } catch {}
      showToast(`✓ Comprobante ${r.serie_correlativo} registrado`, 'green');
      setReviewing(null);
    } catch (e) {
      showToast('Error al registrar: ' + (e.message || e), 'red');
    }
  };

  const descartarItem = (id) => {
    setItems(prev => prev.filter(x => x.id !== id));
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
      </div>

      <div className="card card-p" style={{ marginBottom:14, background:'rgba(155,89,182,0.06)', border:'1px solid rgba(155,89,182,0.25)', fontSize:12, color:'var(--ts)' }}>
        <strong style={{ color:'#9B59B6' }}>ℹ Cómo funciona:</strong> Arrastrá tus comprobantes (PDF o foto) y Claude AI los lee. Después revisás
        el JSON extraído, confirmás con qué empresa y obra se asocia, y el sistema crea automáticamente:
        proveedor (si es nuevo), movimiento contable de costo, materiales nuevos, movimientos de inventario y guarda el archivo como evidencia.
      </div>

      {/* ── DROP ZONE ─────────────────────────────────────────── */}
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
          onChange={(newReview) => setItems(prev => prev.map(x => x.id === reviewItem.id ? { ...x, review: newReview } : x))}
          onConfirm={() => confirmarItem(reviewItem.id)}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}

// ─── MODAL DE REVISIÓN ───────────────────────────────────────
function ReviewModal({ item, companies, obras, proveedoresDB, materialesDB, onChange, onConfirm, onClose }) {
  const r = item.review;
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
            ⚠ DUPLICADO: ya existe un movimiento contable con este RUC y serie-correlativo. Si confirmás creará otro registro.
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

            {/* RECEPTOR (empresa del grupo) + obra */}
            <div style={{ marginTop:10, padding:'10px 12px', background:'rgba(46,204,113,0.06)', border:'1px solid rgba(46,204,113,0.2)', borderRadius:8 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--green)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>Empresa compradora (tu grupo)</div>
              {r.receptor_documento && !companiesActivas.find(c => c.ruc === r.receptor_documento) && r.company_accion !== 'crear_nueva' && (
                <div style={{ fontSize:11, color:'var(--red)', marginBottom:6 }}>⚠ El RUC en la factura ({r.receptor_documento}) no coincide con ninguna de tus empresas.</div>
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
                <div className="g2">
                  <div>
                    <label className="flabel">Empresa *</label>
                    <select className="fi" value={r.company_id||''} onChange={e=>upd({ company_id: e.target.value, obra_id:'' })}>
                      <option value="">— Seleccionar —</option>
                      {companiesActivas.map(c => <option key={c.id} value={c.id}>{c.name} {c.ruc ? `· ${c.ruc}` : ''}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="flabel">Obra (opcional)</label>
                    <select className="fi" value={r.obra_id||''} onChange={e=>upd({ obra_id: e.target.value })}>
                      <option value="">— Sin obra (gasto general) —</option>
                      {obrasDeEmpresa.map(o => <option key={o.id} value={o.id}>{o.nombre_obra}</option>)}
                    </select>
                  </div>
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
                    Esta empresa se creará al confirmar. Como aún no tiene obras asignadas, el dropdown de obra abajo aparecerá vacío.
                  </div>
                </div>
              )}
            </div>

            {/* ITEMS */}
            <div style={{ marginTop:10 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--amber)', textTransform:'uppercase', letterSpacing:'.05em' }}>
                  Ítems ({r.items.length})
                </div>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <label style={{ fontSize:11, color:'var(--tm)', display:'flex', alignItems:'center', gap:4 }}>
                    <input type="checkbox" checked={r.crear_movimiento_materiales} onChange={e=>upd({ crear_movimiento_materiales: e.target.checked })}/>
                    Crear materiales + entradas en inventario
                  </label>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={recalcular}>↻ Recalcular total</button>
                </div>
              </div>
              <div style={{ overflow:'auto', maxHeight:280, border:'1px solid var(--border)', borderRadius:6 }}>
                <table className="tbl" style={{ fontSize:11 }}>
                  <thead><tr>
                    <th style={{ minWidth:200 }}>Descripción</th>
                    <th>Material</th>
                    <th style={{ textAlign:'right' }}>Cant</th>
                    <th>Unid</th>
                    <th style={{ textAlign:'right' }}>P.Unit</th>
                    <th style={{ textAlign:'right' }}>Subt</th>
                  </tr></thead>
                  <tbody>
                    {r.items.map((it, i) => (
                      <tr key={i}>
                        <td><input className="fi" style={{ fontSize:11, padding:'4px 6px' }} value={it.descripcion||''} onChange={e=>updateItem(i, { descripcion: e.target.value })}/></td>
                        <td>
                          <select style={{ fontSize:10, padding:'3px 4px', maxWidth:160 }} className="fi"
                            value={it.accion_material === 'crear_nuevo' ? '__new__' : (it.material_id || '__none__')}
                            onChange={e=>{
                              const v = e.target.value;
                              if (v === '__new__') updateItem(i, { accion_material:'crear_nuevo', material_id:'' });
                              else if (v === '__none__') updateItem(i, { accion_material:'usar_existente', material_id:'' });
                              else updateItem(i, { accion_material:'usar_existente', material_id: v });
                            }}>
                            <option value="__new__">+ Crear nuevo</option>
                            <option value="__none__">— No vincular —</option>
                            {materialesDB.map(m => <option key={m.id} value={m.id}>{m.nombre_material?.slice(0,30)}</option>)}
                          </select>
                        </td>
                        <td><input className="fi" type="number" step="0.01" style={{ fontSize:11, padding:'4px 6px', width:70, textAlign:'right' }} value={it.cantidad ?? ''} onChange={e=>updateItem(i, { cantidad: e.target.value })}/></td>
                        <td><input className="fi" style={{ fontSize:11, padding:'4px 6px', width:50 }} value={it.unidad||''} onChange={e=>updateItem(i, { unidad: e.target.value })}/></td>
                        <td><input className="fi" type="number" step="0.01" style={{ fontSize:11, padding:'4px 6px', width:80, textAlign:'right' }} value={it.precio_unitario ?? ''} onChange={e=>updateItem(i, { precio_unitario: e.target.value })}/></td>
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
            {r.crear_movimiento_materiales && r.obra_id ? ` + ${r.items.length} entrada(s) de inventario` : ''} + 1 evidencia.
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
