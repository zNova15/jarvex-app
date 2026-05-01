import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE } = React;

// Iconos
const Icon = (props) => window.JxIcon ? <window.JxIcon {...props}/> : null;

// ─── Modal local ─────────────────────────────────────────────────────────
function Modal({ title, icon, onClose, children, wide }) {
  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { maxWidth: 900 } : {}}>
        <div className="modal-hd">
          <div className="modal-hd-left">
            {icon && <div style={{ width:32,height:32,borderRadius:8,background:'rgba(242,183,5,.12)',display:'flex',alignItems:'center',justifyContent:'center' }}><Icon name={icon} size={15} color="var(--amber)"/></div>}
            <span>{title}</span>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon"><Icon name="x" size={15}/></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────
const fmtCur = (n, currency = 'PEN') => {
  const symbol = currency === 'USD' ? 'USD ' : 'S/ ';
  return symbol + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const COMP_TYPES = [
  { v: '01', label: 'Factura electrónica',  serie_default: 'F001' },
  { v: '03', label: 'Boleta de venta',       serie_default: 'B001' },
  { v: '07', label: 'Nota de crédito',       serie_default: 'FC01' },
  { v: '08', label: 'Nota de débito',        serie_default: 'FD01' },
];

const COMP_STATUS_LABEL = {
  pendiente_emision: 'Pendiente',
  emitido: 'Emitido',
  rechazado: 'Rechazado',
  anulado: 'Anulado',
};
const COMP_STATUS_BADGE = {
  pendiente_emision: 'b-amber',
  emitido: 'b-green',
  rechazado: 'b-red',
  anulado: 'b-gray',
};

const MOTIVOS_NC = [
  { v: '01', label: 'Anulación de la operación' },
  { v: '02', label: 'Anulación por error en RUC' },
  { v: '03', label: 'Corrección por error en descripción' },
  { v: '06', label: 'Devolución total' },
  { v: '07', label: 'Devolución parcial' },
  { v: '13', label: 'Ajuste de operaciones' },
];
const MOTIVOS_ND = [
  { v: '01', label: 'Intereses por mora' },
  { v: '02', label: 'Aumento en el valor' },
  { v: '03', label: 'Penalidad' },
];

// Mapea document_type del movimiento contable → tipo SUNAT
const DOC2SUNAT = { factura: '01', boleta: '03', nota_credito: '07', nota_debito: '08' };

function inferComprobanteFromMov(m) {
  const tipo = DOC2SUNAT[m.document_type] || null;
  if (!tipo) return null;
  const docNum = String(m.document_number || '').trim();
  const match = docNum.match(/^([A-Z]{1,4}\d{1,3})[-\s]?(\d{1,8})$/i);
  const serie = match ? match[1].toUpperCase() : null;
  const correlativo = match ? parseInt(match[2], 10) : null;
  return {
    tipo,
    serie,
    correlativo,
    estado: m.comprobante_estado || (m.payment_status === 'cancelled' ? 'anulado' : (m.comprobante_xml ? 'emitido' : 'pendiente_emision')),
  };
}

// ─── Descarga de archivos ────────────────────────────────────────────────
function downloadXML(filename, xmlContent) {
  // SUNAT exige ISO-8859-1; convertimos best-effort. Si hay caracteres fuera de rango, fallback a utf-8.
  let blob;
  try {
    const bytes = new Uint8Array(xmlContent.length);
    for (let i = 0; i < xmlContent.length; i++) {
      const code = xmlContent.charCodeAt(i);
      if (code > 0xFF) throw new Error('out_of_range');
      bytes[i] = code;
    }
    blob = new Blob([bytes], { type: 'application/xml;charset=ISO-8859-1' });
  } catch {
    blob = new Blob([xmlContent], { type: 'application/xml;charset=utf-8' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ═══════════════════════════════════════════════════════════════════════
//  ComprobantesElectronicosPage
// ═══════════════════════════════════════════════════════════════════════
function ComprobantesElectronicosPage({ showToast }) {
  const auth = window.__useAuth?.();
  const isAdmin = auth?.profile?.rol === 'admin';
  const userId = auth?.profile?.id ?? 'offline';

  const { data: companies } = window.__hooks?.useCompanies?.() || { data: [] };
  const { data: movs } = window.__hooks?.useAccountingMovements?.() || { data: [] };

  // Proveedores como fuente de "clientes" (filtrar por tipo='cliente' si existe)
  const [provs, setProvs] = uS([]);
  uE(() => {
    const load = () => window.__db?.proveedores?.toArray().then(d => {
      setProvs((d || []).filter(x => !x.deleted_at));
    }).catch(() => setProvs([]));
    load();
    const onCh = () => load();
    window.addEventListener('jx_data_changed', onCh);
    return () => window.removeEventListener('jx_data_changed', onCh);
  }, []);

  const clientes = uM(() => provs.filter(p => !p.tipo_proveedor || /cliente/i.test(p.tipo_proveedor)), [provs]);

  // Filtros
  const [filtroEmpresa, setFiltroEmpresa] = uS('todas');
  const [filtroTipo, setFiltroTipo] = uS('todos');     // todos | 01 | 03 | 07 | 08
  const [filtroEstado, setFiltroEstado] = uS('todos'); // todos | pendiente_emision | emitido | anulado | rechazado
  const [busqueda, setBusqueda] = uS('');

  // Modal
  const [modal, setModal] = uS(null); // null | 'nuevo' | 'detalle'
  const [selMov, setSelMov] = uS(null);
  const [form, setForm] = uS({});

  // Construir lista visible: ingresos con document_type factura/boleta/NC/ND
  const comprobantes = uM(() => {
    if (!movs) return [];
    let f = movs.filter(m => m.type === 'income' && !m.deleted_at);
    f = f.map(m => {
      const inf = inferComprobanteFromMov(m);
      return inf ? { ...m, _comp: inf } : null;
    }).filter(Boolean);
    if (filtroEmpresa !== 'todas') f = f.filter(m => m.company_id === filtroEmpresa);
    if (filtroTipo !== 'todos') f = f.filter(m => m._comp.tipo === filtroTipo);
    if (filtroEstado !== 'todos') f = f.filter(m => m._comp.estado === filtroEstado);
    if (busqueda) {
      const q = busqueda.toLowerCase();
      f = f.filter(m =>
        (m.third_party_name || '').toLowerCase().includes(q) ||
        (m.document_number || '').toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q)
      );
    }
    return f.sort((a,b) => (b.date || '').localeCompare(a.date || ''));
  }, [movs, filtroEmpresa, filtroTipo, filtroEstado, busqueda]);

  // Para el correlativo sugerido en "nuevo"
  const sugerirCorrelativo = (companyId, serie) => {
    const usados = (movs || [])
      .filter(m => m.company_id === companyId && m.document_number && String(m.document_number).startsWith(serie))
      .map(m => {
        const r = String(m.document_number).match(/(\d+)$/);
        return r ? parseInt(r[1], 10) : 0;
      });
    return (usados.length ? Math.max(...usados) : 0) + 1;
  };

  // Empresa emisora (lookup)
  const lookupCompany = (id) => companies?.find(c => c.id === id);

  // ─── Crear comprobante ─────────────────────────────────────────────
  const openNuevo = () => {
    const companiesAct = (companies || []).filter(c => c.status === 'activa');
    if (!companiesAct.length) {
      showToast?.('Crea primero una empresa con RUC en Contabilidad', 'red');
      return;
    }
    const empresaDef = companiesAct[0];
    const tipo = '01';
    const meta = COMP_TYPES.find(t => t.v === tipo);
    setForm({
      company_id: empresaDef.id,
      tipo,
      serie: meta.serie_default,
      correlativo: sugerirCorrelativo(empresaDef.id, meta.serie_default),
      fecha: new Date().toISOString().slice(0, 10),
      vencimiento: new Date().toISOString().slice(0, 10),
      moneda: 'PEN',
      cliente_modo: 'manual', // 'manual' | 'lista'
      cliente_id: '',
      cliente_tipo_doc: '6',
      cliente_documento: '',
      cliente_razon_social: '',
      cliente_direccion: '',
      items: [{ descripcion: '', cantidad: 1, precio_unitario: 0, igv_pct: 18, tax_exemption_code: '10', unidad_medida: 'NIU' }],
      // Notas de crédito/débito
      motivo_codigo: '01',
      motivo_descripcion: '',
      doc_afectado_tipo: '01',
      doc_afectado_id: '',
      observaciones: '',
    });
    setModal('nuevo');
  };

  const onTipoChange = (nuevoTipo) => {
    const meta = COMP_TYPES.find(t => t.v === nuevoTipo);
    setForm(prev => ({
      ...prev,
      tipo: nuevoTipo,
      serie: meta.serie_default,
      correlativo: sugerirCorrelativo(prev.company_id, meta.serie_default),
      // Boleta: tipo doc cliente por default DNI
      cliente_tipo_doc: nuevoTipo === '03' ? '1' : '6',
    }));
  };

  const onEmpresaChange = (cid) => {
    setForm(prev => ({
      ...prev,
      company_id: cid,
      correlativo: sugerirCorrelativo(cid, prev.serie),
    }));
  };

  const onSerieChange = (serie) => {
    setForm(prev => ({
      ...prev,
      serie: serie.toUpperCase(),
      correlativo: sugerirCorrelativo(prev.company_id, serie.toUpperCase()),
    }));
  };

  const setItem = (idx, patch) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((it, i) => i === idx ? { ...it, ...patch } : it),
    }));
  };
  const addItem = () => setForm(prev => ({
    ...prev,
    items: [...prev.items, { descripcion: '', cantidad: 1, precio_unitario: 0, igv_pct: 18, tax_exemption_code: '10', unidad_medida: 'NIU' }],
  }));
  const delItem = (idx) => setForm(prev => ({
    ...prev,
    items: prev.items.length > 1 ? prev.items.filter((_, i) => i !== idx) : prev.items,
  }));

  // Totales en vivo del modal
  const totalesPreview = uM(() => {
    if (!form.items) return { total_gravado:0, total_igv:0, total_venta:0 };
    try {
      return window.__sunatUBL?.calcularTotalesIGV?.(form.items) || { total_gravado:0, total_igv:0, total_venta:0 };
    } catch { return { total_gravado:0, total_igv:0, total_venta:0 }; }
  }, [form.items]);

  // ─── Selección de cliente desde lista ─────────────────────────────
  const onClienteListaChange = (id) => {
    const p = provs.find(x => x.id === id);
    if (!p) {
      setForm(prev => ({ ...prev, cliente_id: '', cliente_documento: '', cliente_razon_social: '', cliente_direccion: '' }));
      return;
    }
    const ruc = p.ruc || '';
    const tipoDoc = ruc.length === 11 ? '6' : (ruc.length === 8 ? '1' : '6');
    setForm(prev => ({
      ...prev,
      cliente_id: id,
      cliente_tipo_doc: tipoDoc,
      cliente_documento: ruc,
      cliente_razon_social: p.razon_social || p.nombre || '',
      cliente_direccion: p.direccion || '',
    }));
  };

  // ─── Guardar comprobante (crea movimiento contable) ───────────────
  const guardarComprobante = async () => {
    if (!form.company_id) { showToast?.('Selecciona empresa emisora', 'red'); return; }
    if (!form.items?.length || !form.items.some(it => Number(it.cantidad) > 0 && Number(it.precio_unitario) >= 0)) {
      showToast?.('Agrega al menos un item con cantidad', 'red');
      return;
    }
    if (!form.cliente_documento?.trim() && form.tipo !== '03') {
      showToast?.('Documento del cliente requerido', 'red');
      return;
    }
    if ((form.tipo === '07' || form.tipo === '08') && !form.doc_afectado_id?.trim()) {
      showToast?.('Indica el comprobante afectado (Ej: F001-00000123)', 'red');
      return;
    }

    const tot = window.__sunatUBL.calcularTotalesIGV(form.items);
    const now = new Date().toISOString();
    const id = window.__newId();
    const correlStr = String(form.correlativo).padStart(8, '0');
    const docNumber = `${form.serie}-${correlStr}`;
    const tipoMeta = COMP_TYPES.find(t => t.v === form.tipo);
    const docTypeAcc = form.tipo === '01' ? 'factura'
                     : form.tipo === '03' ? 'boleta'
                     : form.tipo === '07' ? 'nota_credito'
                     : 'nota_debito';

    try {
      await window.__db.accounting_movements.add({
        id,
        company_id: form.company_id,
        date: form.fecha,
        type: 'income',
        category: tipoMeta.label,
        description: form.observaciones || (form.items[0]?.descripcion || tipoMeta.label),
        amount: tot.total_venta,
        currency: form.moneda || 'PEN',
        third_party_name: form.cliente_razon_social || null,
        third_party_ruc: form.cliente_documento || null,
        payment_status: 'pending',
        document_type: docTypeAcc,
        document_number: docNumber,
        file_url: null,
        is_intercompany: false,
        related_company_id: null,
        related_movement_id: null,
        notas: JSON.stringify({
          comprobante_electronico: true,
          tipo_sunat: form.tipo,
          serie: form.serie,
          correlativo: form.correlativo,
          moneda: form.moneda,
          items: form.items,
          cliente: {
            tipo_documento: form.cliente_tipo_doc,
            documento: form.cliente_documento,
            razon_social: form.cliente_razon_social,
            direccion: form.cliente_direccion,
          },
          motivo_codigo: form.motivo_codigo,
          motivo_descripcion: form.motivo_descripcion,
          doc_afectado_tipo: form.doc_afectado_tipo,
          doc_afectado_id: form.doc_afectado_id,
          estado_comprobante: 'pendiente_emision',
        }),
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_acc_mov_${id}`,
      });
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      showToast?.(`${tipoMeta.label} ${docNumber} registrada`, 'green');
      setModal(null);
    } catch (e) {
      showToast?.('Error al guardar: ' + (e.message || e), 'red');
    }
  };

  // ─── Generar XML para una fila ─────────────────────────────────────
  const buildEmisorFromCompany = (company) => {
    if (!company) return null;
    if (!company.ruc) return null;
    return {
      ruc: company.ruc,
      razon_social: company.legal_name || company.name,
      nombre_comercial: company.name,
      direccion: company.direccion || company.notas || '-',
      ubigeo: company.ubigeo || '150101',
      distrito: company.distrito || 'LIMA',
      provincia: company.provincia || 'LIMA',
      departamento: company.departamento || 'LIMA',
    };
  };

  const buildClienteFromMov = (m, meta) => {
    return {
      tipo_documento: meta?.cliente?.tipo_documento || '6',
      documento: meta?.cliente?.documento || m.third_party_ruc || '0',
      razon_social: meta?.cliente?.razon_social || m.third_party_name || 'CLIENTE VARIOS',
      direccion: meta?.cliente?.direccion || '-',
    };
  };

  const parseMeta = (m) => {
    if (!m.notas) return {};
    try { return JSON.parse(m.notas); } catch { return {}; }
  };

  const generarXMLDeFila = (m) => {
    const company = lookupCompany(m.company_id);
    if (!company?.ruc) {
      showToast?.('La empresa emisora no tiene RUC configurado', 'red');
      return;
    }
    const emisor = buildEmisorFromCompany(company);
    const meta = parseMeta(m);
    const cliente = buildClienteFromMov(m, meta);
    const items = meta.items?.length ? meta.items : [{
      descripcion: m.description || 'Servicio',
      cantidad: 1,
      precio_unitario: Number(m.amount || 0) / 1.18,
      igv_pct: 18,
      tax_exemption_code: '10',
      unidad_medida: 'NIU',
    }];
    const tipo = m._comp?.tipo;
    const correlNum = m._comp?.correlativo || 1;
    const correl = String(correlNum).padStart(8, '0');
    const serie = m._comp?.serie || (tipo === '03' ? 'B001' : 'F001');
    const comprobante = {
      serie,
      correlativo: correlNum,
      fecha_emision: m.date,
      hora_emision: '10:00:00',
      fecha_vencimiento: m.date,
      moneda: meta.moneda || m.currency || 'PEN',
      motivo_descripcion: meta.motivo_descripcion,
    };

    let xml = '';
    let filename = '';
    const ublRuc = company.ruc;
    const tag = tipo === '01' ? '01' : tipo === '03' ? '03' : tipo === '07' ? '07' : '08';
    filename = `${ublRuc}-${tag}-${serie}-${correl}.xml`;

    try {
      if (tipo === '01') xml = window.__sunatUBL.generateFacturaXML(comprobante, emisor, cliente, items);
      else if (tipo === '03') xml = window.__sunatUBL.generateBoletaXML(comprobante, emisor, cliente, items);
      else if (tipo === '07') xml = window.__sunatUBL.generateNotaCreditoXML(
        comprobante, emisor, cliente, items, meta.motivo_codigo || '01',
        { tipo: meta.doc_afectado_tipo || '01', serie_correlativo: meta.doc_afectado_id || '' }
      );
      else if (tipo === '08') xml = window.__sunatUBL.generateNotaDebitoXML(
        comprobante, emisor, cliente, items, meta.motivo_codigo || '01',
        { tipo: meta.doc_afectado_tipo || '01', serie_correlativo: meta.doc_afectado_id || '' }
      );
      else { showToast?.('Tipo de comprobante no soportado', 'red'); return; }

      // Validación rápida: parser nativo
      try {
        const dp = new DOMParser();
        const doc = dp.parseFromString(xml, 'text/xml');
        const err = doc.getElementsByTagName('parsererror');
        if (err && err.length) {
          showToast?.('XML mal formado — revisa datos del emisor/cliente', 'red');
          return;
        }
      } catch {}

      downloadXML(filename, xml);
      showToast?.(`XML descargado: ${filename}`, 'green');
    } catch (e) {
      showToast?.('Error generando XML: ' + (e.message || e), 'red');
    }
  };

  // ─── Marcar emitido / anular ───────────────────────────────────────
  const cambiarEstado = async (m, nuevoEstado) => {
    try {
      const meta = parseMeta(m);
      meta.estado_comprobante = nuevoEstado;
      meta.comprobante_electronico = true;
      const updates = {
        notas: JSON.stringify(meta),
        updated_at: new Date().toISOString(),
        updated_by: userId,
        version: (m.version ?? 0) + 1,
        sync_status: m.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      };
      if (nuevoEstado === 'anulado') updates.payment_status = 'cancelled';
      await window.__db.accounting_movements.update(m.id, updates);
      try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: 'accounting_movements' } })); } catch {}
      showToast?.(`Comprobante marcado como ${COMP_STATUS_LABEL[nuevoEstado]}`, nuevoEstado === 'anulado' ? 'amber' : 'green');
    } catch (e) {
      showToast?.('Error: ' + (e.message || e), 'red');
    }
  };

  const enviarOSE = (m) => {
    showToast?.('OSE no configurado — configurá en Admin > Integraciones SUNAT', 'amber');
  };

  // ─── KPIs simples arriba ───────────────────────────────────────────
  const kpis = uM(() => {
    const k = { pendientes: 0, emitidos: 0, anulados: 0, total_pen: 0 };
    comprobantes.forEach(m => {
      if (m._comp.estado === 'pendiente_emision') k.pendientes++;
      else if (m._comp.estado === 'emitido') k.emitidos++;
      else if (m._comp.estado === 'anulado') k.anulados++;
      if ((m.currency || 'PEN') === 'PEN') k.total_pen += Number(m.amount || 0);
    });
    return k;
  }, [comprobantes]);

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Comprobantes Electrónicos</div>
          <div className="pg-sub">SUNAT UBL 2.1 · Facturas, Boletas, Notas · {comprobantes.length} comprobantes</div>
        </div>
        <button className="btn btn-amber btn-sm" onClick={openNuevo}>
          <Icon name="plus" size={13}/>Nuevo Comprobante
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:10, marginBottom:14 }}>
        <div className="card card-p" style={{ padding:'10px 14px' }}>
          <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase' }}>Pendientes</div>
          <div style={{ fontSize:20, fontWeight:700, color:'var(--amber)' }}>{kpis.pendientes}</div>
        </div>
        <div className="card card-p" style={{ padding:'10px 14px' }}>
          <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase' }}>Emitidos</div>
          <div style={{ fontSize:20, fontWeight:700, color:'var(--green)' }}>{kpis.emitidos}</div>
        </div>
        <div className="card card-p" style={{ padding:'10px 14px' }}>
          <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase' }}>Anulados</div>
          <div style={{ fontSize:20, fontWeight:700, color:'var(--gray)' }}>{kpis.anulados}</div>
        </div>
        <div className="card card-p" style={{ padding:'10px 14px' }}>
          <div style={{ fontSize:10.5, color:'var(--tm)', textTransform:'uppercase' }}>Total PEN</div>
          <div style={{ fontSize:18, fontWeight:700 }}>{fmtCur(kpis.total_pen, 'PEN')}</div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:14 }}>
        <div className="search-bar" style={{ flex:'1 1 200px' }}>
          <Icon name="search" size={14} color="var(--tm)"/>
          <input placeholder="Buscar serie / cliente / descripción…" value={busqueda} onChange={e=>setBusqueda(e.target.value)}/>
        </div>
        <select className="fi" value={filtroEmpresa} onChange={e=>setFiltroEmpresa(e.target.value)} style={{ minWidth:160 }}>
          <option value="todas">Todas las empresas</option>
          {(companies || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="fi" value={filtroTipo} onChange={e=>setFiltroTipo(e.target.value)} style={{ minWidth:140 }}>
          <option value="todos">Todos los tipos</option>
          {COMP_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
        <select className="fi" value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{ minWidth:130 }}>
          <option value="todos">Todos los estados</option>
          <option value="pendiente_emision">Pendiente</option>
          <option value="emitido">Emitido</option>
          <option value="anulado">Anulado</option>
          <option value="rechazado">Rechazado</option>
        </select>
      </div>

      {/* Tabla */}
      {comprobantes.length === 0 ? (
        <div className="card card-p empty-state">
          <Icon name="file" size={40} color="var(--tm)"/>
          <p>No hay comprobantes registrados. Crea uno nuevo o registra ingresos con tipo "factura" / "boleta" en Contabilidad.</p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table className="tbl">
              <thead><tr>
                <th>Tipo</th>
                <th>Serie - Correlativo</th>
                <th>Fecha</th>
                <th>Empresa</th>
                <th>Cliente</th>
                <th style={{ textAlign:'right' }}>Monto</th>
                <th>Estado</th>
                <th style={{ textAlign:'center' }}>Acciones</th>
              </tr></thead>
              <tbody>
                {comprobantes.map(m => {
                  const c = lookupCompany(m.company_id);
                  const tipoLabel = COMP_TYPES.find(t => t.v === m._comp.tipo)?.label || m.document_type;
                  return (
                    <tr key={m.id}>
                      <td style={{ fontSize:11 }}>
                        <span className="badge b-blue">{m._comp.tipo}</span>
                        <div style={{ fontSize:10, color:'var(--tm)', marginTop:2 }}>{tipoLabel}</div>
                      </td>
                      <td className="col-m" style={{ fontWeight:600 }}>{m.document_number || '—'}</td>
                      <td className="col-m">{m.date}</td>
                      <td className="col-p">{c?.name || '—'}</td>
                      <td>
                        {m.third_party_name || '—'}
                        {m.third_party_ruc && <div style={{ fontSize:10, color:'var(--tm)' }}>{m.third_party_ruc}</div>}
                      </td>
                      <td style={{ textAlign:'right', fontWeight:700 }} className="col-num">{fmtCur(m.amount, m.currency)}</td>
                      <td>
                        <span className={`badge ${COMP_STATUS_BADGE[m._comp.estado] || 'b-gray'}`}>
                          {COMP_STATUS_LABEL[m._comp.estado] || m._comp.estado}
                        </span>
                      </td>
                      <td style={{ textAlign:'center', whiteSpace:'nowrap' }}>
                        <button className="btn btn-ghost btn-xs" title="Generar XML UBL" onClick={()=>generarXMLDeFila(m)}>
                          <Icon name="download" size={11}/>XML
                        </button>
                        <button className="btn btn-ghost btn-xs" title="Enviar a OSE" onClick={()=>enviarOSE(m)} style={{ marginLeft:4 }}>
                          <Icon name="upload" size={11}/>OSE
                        </button>
                        {m._comp.estado === 'pendiente_emision' && (
                          <button className="btn btn-green btn-xs" title="Marcar emitido (CDR del OSE recibido)" onClick={()=>cambiarEstado(m, 'emitido')} style={{ marginLeft:4 }}>
                            <Icon name="check" size={11}/>
                          </button>
                        )}
                        {isAdmin && m._comp.estado !== 'anulado' && (
                          <button className="btn btn-red btn-xs" title="Anular comprobante" onClick={()=>cambiarEstado(m, 'anulado')} style={{ marginLeft:4 }}>
                            <Icon name="x" size={11}/>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Nuevo Comprobante */}
      {modal === 'nuevo' && (
        <Modal title="Nuevo Comprobante Electrónico" icon="file" onClose={()=>setModal(null)} wide>
          <div className="g2">
            <div>
              <label className="flabel">Empresa emisora *</label>
              <select className="fi" value={form.company_id || ''} onChange={e=>onEmpresaChange(e.target.value)}>
                {(companies || []).filter(c => c.status === 'activa').map(c => (
                  <option key={c.id} value={c.id}>{c.name} {c.ruc ? `(${c.ruc})` : '(sin RUC!)'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="flabel">Tipo *</label>
              <select className="fi" value={form.tipo || '01'} onChange={e=>onTipoChange(e.target.value)}>
                {COMP_TYPES.map(t => <option key={t.v} value={t.v}>{t.v} - {t.label}</option>)}
              </select>
            </div>
            <div>
              {window.JxFieldLabel
                ? <window.JxFieldLabel text="Serie *" hint="4 caracteres. Factura: F001, F002... · Boleta: B001 · Guías: T001. La serie es independiente por tipo y debe estar autorizada en SUNAT SOL."/>
                : <label className="flabel">Serie *</label>}
              <input className="fi" value={form.serie || ''} onChange={e=>onSerieChange(e.target.value)} maxLength={4}/>
            </div>
            <div>
              {window.JxFieldLabel
                ? <window.JxFieldLabel text="Correlativo *" hint="Número secuencial sin saltos. SUNAT exige consecutivos: F001-1, F001-2... El sistema sugiere el siguiente. Si anulás necesitas registrar la anulación."/>
                : <label className="flabel">Correlativo *</label>}
              <input className="fi" type="number" min="1" value={form.correlativo || ''} onChange={e=>setForm({...form, correlativo: parseInt(e.target.value, 10) || 1})}/>
            </div>
            <div>
              <label className="flabel">Fecha emisión *</label>
              <input className="fi" type="date" value={form.fecha || ''} onChange={e=>setForm({...form, fecha: e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Vencimiento</label>
              <input className="fi" type="date" value={form.vencimiento || ''} onChange={e=>setForm({...form, vencimiento: e.target.value})}/>
            </div>
            <div>
              <label className="flabel">Moneda</label>
              <select className="fi" value={form.moneda || 'PEN'} onChange={e=>setForm({...form, moneda: e.target.value})}>
                <option value="PEN">S/ (PEN)</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label className="flabel">Cliente desde</label>
              <select className="fi" value={form.cliente_modo || 'manual'} onChange={e=>setForm({...form, cliente_modo: e.target.value, cliente_id: ''})}>
                <option value="manual">Ingreso manual</option>
                <option value="lista">Lista de clientes ({clientes.length})</option>
              </select>
            </div>

            {/* Datos del cliente */}
            {form.cliente_modo === 'lista' ? (
              <div style={{ gridColumn:'1/-1' }}>
                <label className="flabel">Cliente</label>
                <select className="fi" value={form.cliente_id || ''} onChange={e=>onClienteListaChange(e.target.value)}>
                  <option value="">— Seleccionar cliente —</option>
                  {clientes.map(p => <option key={p.id} value={p.id}>{p.razon_social || p.nombre} {p.ruc ? `· ${p.ruc}`:''}</option>)}
                </select>
              </div>
            ) : null}
            <div>
              <label className="flabel">Tipo doc. cliente</label>
              <select className="fi" value={form.cliente_tipo_doc || '6'} onChange={e=>setForm({...form, cliente_tipo_doc: e.target.value})}>
                <option value="6">RUC</option>
                <option value="1">DNI</option>
                <option value="4">Carnet de extranjería</option>
                <option value="7">Pasaporte</option>
                <option value="0">Sin documento</option>
              </select>
            </div>
            <div>
              <label className="flabel">Documento</label>
              <input className="fi" value={form.cliente_documento || ''} onChange={e=>setForm({...form, cliente_documento: e.target.value.replace(/\s/g,'')})}/>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Razón social / Nombre</label>
              <input className="fi" value={form.cliente_razon_social || ''} onChange={e=>setForm({...form, cliente_razon_social: e.target.value})}/>
            </div>
            <div style={{ gridColumn:'1/-1' }}>
              <label className="flabel">Dirección</label>
              <input className="fi" value={form.cliente_direccion || ''} onChange={e=>setForm({...form, cliente_direccion: e.target.value})}/>
            </div>

            {/* Notas crédito/débito */}
            {(form.tipo === '07' || form.tipo === '08') && (
              <>
                <div>
                  <label className="flabel">Motivo *</label>
                  <select className="fi" value={form.motivo_codigo || '01'} onChange={e=>setForm({...form, motivo_codigo: e.target.value})}>
                    {(form.tipo === '07' ? MOTIVOS_NC : MOTIVOS_ND).map(m => (
                      <option key={m.v} value={m.v}>{m.v} - {m.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="flabel">Doc. afectado tipo</label>
                  <select className="fi" value={form.doc_afectado_tipo || '01'} onChange={e=>setForm({...form, doc_afectado_tipo: e.target.value})}>
                    <option value="01">Factura</option>
                    <option value="03">Boleta</option>
                  </select>
                </div>
                <div style={{ gridColumn:'1/-1' }}>
                  <label className="flabel">Doc. afectado (Ej: F001-00000123) *</label>
                  <input className="fi" value={form.doc_afectado_id || ''} onChange={e=>setForm({...form, doc_afectado_id: e.target.value.toUpperCase()})}/>
                </div>
                <div style={{ gridColumn:'1/-1' }}>
                  <label className="flabel">Descripción del motivo</label>
                  <input className="fi" value={form.motivo_descripcion || ''} onChange={e=>setForm({...form, motivo_descripcion: e.target.value})}/>
                </div>
              </>
            )}
          </div>

          {/* Items */}
          <div style={{ marginTop:14 }}>
            <div className="frow-sb" style={{ marginBottom:6 }}>
              <strong>Items</strong>
              <button className="btn btn-ghost btn-xs" onClick={addItem}><Icon name="plus" size={11}/>Agregar item</button>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table className="tbl">
                <thead><tr>
                  <th style={{ width:'30%' }}>Descripción</th>
                  <th style={{ width:80 }}>U.M.</th>
                  <th style={{ width:80 }}>Cant.</th>
                  <th style={{ width:110 }}>P. Unit (sin IGV)</th>
                  <th style={{ width:80 }}>IGV %</th>
                  <th style={{ width:120 }}>Afectación</th>
                  <th style={{ width:100, textAlign:'right' }}>Subtotal</th>
                  <th style={{ width:40 }}></th>
                </tr></thead>
                <tbody>
                  {form.items?.map((it, i) => {
                    const cant = Number(it.cantidad) || 0;
                    const pu = Number(it.precio_unitario) || 0;
                    return (
                      <tr key={i}>
                        <td><input className="fi" value={it.descripcion} onChange={e=>setItem(i,{descripcion:e.target.value})}/></td>
                        <td><input className="fi" value={it.unidad_medida || 'NIU'} onChange={e=>setItem(i,{unidad_medida:e.target.value.toUpperCase()})}/></td>
                        <td><input className="fi" type="number" min="0" step="0.01" value={it.cantidad} onChange={e=>setItem(i,{cantidad:parseFloat(e.target.value)||0})}/></td>
                        <td><input className="fi" type="number" min="0" step="0.01" value={it.precio_unitario} onChange={e=>setItem(i,{precio_unitario:parseFloat(e.target.value)||0})}/></td>
                        <td><input className="fi" type="number" min="0" step="0.01" value={it.igv_pct ?? 18} onChange={e=>setItem(i,{igv_pct:parseFloat(e.target.value)||0})} disabled={it.tax_exemption_code !== '10'}/></td>
                        <td>
                          <select className="fi" value={it.tax_exemption_code || '10'} onChange={e=>setItem(i,{tax_exemption_code:e.target.value})}>
                            <option value="10">Gravado</option>
                            <option value="20">Exonerado</option>
                            <option value="30">Inafecto</option>
                          </select>
                        </td>
                        <td style={{ textAlign:'right', fontWeight:600 }}>{(cant*pu).toFixed(2)}</td>
                        <td><button className="btn btn-ghost btn-xs" onClick={()=>delItem(i)} disabled={form.items.length<=1}><Icon name="trash" size={11}/></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totales preview */}
          <div style={{ marginTop:12, padding:'10px 14px', background:'rgba(242,183,5,.05)', borderRadius:6, display:'flex', gap:18, flexWrap:'wrap', justifyContent:'flex-end' }}>
            <div><span style={{ fontSize:11, color:'var(--tm)' }}>Gravado:</span> <strong>{fmtCur(totalesPreview.total_gravado, form.moneda)}</strong></div>
            <div><span style={{ fontSize:11, color:'var(--tm)' }}>IGV (18%):</span> <strong>{fmtCur(totalesPreview.total_igv, form.moneda)}</strong></div>
            <div><span style={{ fontSize:11, color:'var(--tm)' }}>Total:</span> <strong style={{ color:'var(--amber)' }}>{fmtCur(totalesPreview.total_venta, form.moneda)}</strong></div>
          </div>

          <div style={{ marginTop:10 }}>
            <label className="flabel">Observaciones</label>
            <textarea className="fi" rows={2} value={form.observaciones || ''} onChange={e=>setForm({...form, observaciones: e.target.value})}/>
          </div>

          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancelar</button>
            <button className="btn btn-amber" onClick={guardarComprobante}>
              <Icon name="check" size={13}/>Registrar comprobante
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Registro global (convención del proyecto)
window.ComprobantesElectronicosPage = ComprobantesElectronicosPage;
Object.assign(window, { ComprobantesElectronicosPage });

export default ComprobantesElectronicosPage;
