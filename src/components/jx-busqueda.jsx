import React from "react";
const { useState: uSB, useEffect: uEB, useRef: uRB, useMemo: uMB } = React;

// ── Helpers ──────────────────────────────────────────────────────────────────
const RECENT_KEY = 'jarvex_busquedas_recientes';

function normalize(s) {
  if (s == null) return '';
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function matchTerm(haystack, needle) {
  // Devuelve "score" (mayor = mejor match) o 0 si no match.
  // Para cada palabra de needle: debe estar contenida en haystack.
  const h = normalize(haystack);
  const n = normalize(needle);
  if (!n || !h) return 0;
  if (h === n) return 100;
  if (h.startsWith(n)) return 80;
  if (h.includes(n)) return 60;
  // Match por palabras (todas deben aparecer)
  const words = n.split(' ').filter(Boolean);
  if (words.length > 1 && words.every(w => h.includes(w))) return 40;
  return 0;
}

function bestScore(fields, q) {
  let best = 0;
  for (const f of fields) {
    const s = matchTerm(f, q);
    if (s > best) best = s;
  }
  return best;
}

// Mapeo tabla → ruta (page) para navegación
const NAV_PAGE = {
  obras: 'obras',
  personal: 'personal',
  materiales: 'materiales',
  herramientas: 'herramientas',
  proveedores: 'proveedores',
  partidas: 'partidas',
  requisiciones: 'requisiciones',
  ordenes_compra: 'ordenes-compra',
  valorizaciones: 'valorizaciones',
  subcontratistas: 'subcontratistas',
  subcontratos: 'subcontratos',
  accounting_movements: 'movimientos-contables',
  incidencias: 'incidencias',
  companies: 'empresas',
};

const CAT_LABEL = {
  obras: 'Obras',
  personal: 'Personal',
  materiales: 'Materiales',
  herramientas: 'Herramientas',
  proveedores: 'Proveedores',
  partidas: 'Partidas',
  requisiciones: 'Requisiciones',
  ordenes_compra: 'Órdenes de compra',
  valorizaciones: 'Valorizaciones',
  subcontratistas: 'Subcontratistas',
  subcontratos: 'Subcontratos',
  accounting_movements: 'Movimientos contables',
  incidencias: 'Incidencias',
  companies: 'Empresas',
};

const CAT_ICON = {
  obras: 'building',
  personal: 'users',
  materiales: 'package',
  herramientas: 'tool',
  proveedores: 'truck',
  partidas: 'layers',
  requisiciones: 'clipboard',
  ordenes_compra: 'inbox',
  valorizaciones: 'dollar',
  subcontratistas: 'users',
  subcontratos: 'file',
  accounting_movements: 'dollar',
  incidencias: 'alert',
  companies: 'building',
};

const CAT_COLOR = {
  obras: '#3498DB',
  personal: '#2ECC71',
  materiales: '#F2B705',
  herramientas: '#F28C28',
  proveedores: '#9B59B6',
  partidas: '#1ABC9C',
  requisiciones: '#E67E22',
  ordenes_compra: '#34495E',
  valorizaciones: '#27AE60',
  subcontratistas: '#8E44AD',
  subcontratos: '#16A085',
  accounting_movements: '#D35400',
  incidencias: '#E74C3C',
  companies: '#3498DB',
};

// Carga segura: si la tabla no existe (o Dexie falla), devuelve []
async function safeAll(tabla) {
  try {
    const t = window.__db?.[tabla];
    if (!t) return [];
    const rows = await t.toArray();
    return rows.filter(r => r && !r.deleted_at);
  } catch (e) {
    return [];
  }
}

// ── Builders por tabla ───────────────────────────────────────────────────────
function buildObra(o, q, ctx) {
  const score = bestScore([o.nombre_obra, o.codigo, o.codigo_obra, o.ubicacion, o.direccion], q);
  if (!score) return null;
  return {
    id: o.id, tabla: 'obras', score,
    title: o.nombre_obra || '(obra sin nombre)',
    subtitle: [o.codigo || o.codigo_obra, o.ubicacion || o.direccion, o.estado].filter(Boolean).join(' · '),
  };
}

function buildPersonal(p, q, ctx) {
  const fullName = `${p.nombres || ''} ${p.apellidos || ''}`.trim() || p.nombre || '';
  const score = bestScore([fullName, p.nombres, p.apellidos, p.dni, p.cargo], q);
  if (!score) return null;
  const obra = ctx.obrasById.get(p.obra_id);
  return {
    id: p.id, tabla: 'personal', score,
    title: fullName || '(personal sin nombre)',
    subtitle: [p.dni && `DNI: ${p.dni}`, p.cargo, obra && `Obra: ${obra.nombre_obra}`].filter(Boolean).join(' · '),
  };
}

function buildMaterial(m, q, ctx) {
  const score = bestScore([m.nombre_material, m.codigo_s10, m.codigo, m.categoria], q);
  if (!score) return null;
  const obra = ctx.obrasById.get(m.obra_id);
  return {
    id: m.id, tabla: 'materiales', score,
    title: m.nombre_material || '(material)',
    subtitle: [m.codigo_s10 || m.codigo, m.categoria, obra && `Obra: ${obra.nombre_obra}`].filter(Boolean).join(' · '),
  };
}

function buildHerramienta(h, q, ctx) {
  const score = bestScore([h.nombre_herramienta, h.codigo_herramienta, h.codigo, h.marca], q);
  if (!score) return null;
  const obra = ctx.obrasById.get(h.obra_id);
  return {
    id: h.id, tabla: 'herramientas', score,
    title: h.nombre_herramienta || '(herramienta)',
    subtitle: [h.codigo_herramienta || h.codigo, h.marca, obra && `Obra: ${obra.nombre_obra}`].filter(Boolean).join(' · '),
  };
}

function buildProveedor(p, q) {
  const score = bestScore([p.razon_social, p.nombre_comercial, p.ruc], q);
  if (!score) return null;
  return {
    id: p.id, tabla: 'proveedores', score,
    title: p.razon_social || p.nombre_comercial || '(proveedor)',
    subtitle: [p.ruc && `RUC: ${p.ruc}`, p.nombre_comercial].filter(Boolean).join(' · '),
  };
}

function buildPartida(p, q, ctx) {
  const score = bestScore([p.codigo_delfin, p.codigo, p.nombre_partida, p.descripcion], q);
  if (!score) return null;
  const obra = ctx.obrasById.get(p.obra_id);
  return {
    id: p.id, tabla: 'partidas', score,
    title: p.nombre_partida || p.descripcion || '(partida)',
    subtitle: [p.codigo_delfin || p.codigo, obra && `Obra: ${obra.nombre_obra}`].filter(Boolean).join(' · '),
  };
}

function buildRequisicion(r, q, ctx) {
  const score = bestScore([r.codigo, r.numero, r.descripcion, r.notas], q);
  if (!score) return null;
  const obra = ctx.obrasById.get(r.obra_id);
  return {
    id: r.id, tabla: 'requisiciones', score,
    title: r.codigo || r.numero || '(requisición)',
    subtitle: [r.descripcion || r.notas, r.estado, obra && `Obra: ${obra.nombre_obra}`].filter(Boolean).join(' · '),
  };
}

function buildOC(o, q, ctx) {
  const score = bestScore([o.codigo, o.numero, o.descripcion, o.notas], q);
  if (!score) return null;
  const obra = ctx.obrasById.get(o.obra_id);
  const prov = ctx.provById.get(o.proveedor_id);
  return {
    id: o.id, tabla: 'ordenes_compra', score,
    title: o.codigo || o.numero || '(OC)',
    subtitle: [o.descripcion || o.notas, prov && prov.razon_social, obra && `Obra: ${obra.nombre_obra}`].filter(Boolean).join(' · '),
  };
}

function buildValorizacion(v, q, ctx) {
  const numStr = v.numero != null ? `Valorización N° ${v.numero}` : '';
  const score = bestScore([numStr, String(v.numero || ''), v.observaciones, v.notas, v.factura_numero], q);
  if (!score) return null;
  const obra = ctx.obrasById.get(v.obra_id);
  const period = (v.periodo_anio && v.periodo_mes) ? `${v.periodo_mes}/${v.periodo_anio}` : null;
  return {
    id: v.id, tabla: 'valorizaciones', score,
    title: numStr || `Valorización ${v.id?.slice?.(0, 8) || ''}`,
    subtitle: [period, v.estado, v.observaciones, obra && `Obra: ${obra.nombre_obra}`].filter(Boolean).join(' · '),
  };
}

function buildSubcontratista(s, q) {
  const score = bestScore([s.razon_social, s.nombre_comercial, s.ruc], q);
  if (!score) return null;
  return {
    id: s.id, tabla: 'subcontratistas', score,
    title: s.razon_social || s.nombre_comercial || '(subcontratista)',
    subtitle: [s.ruc && `RUC: ${s.ruc}`, s.estado].filter(Boolean).join(' · '),
  };
}

function buildSubcontrato(c, q, ctx) {
  const score = bestScore([c.codigo, c.numero, c.objeto, c.alcance], q);
  if (!score) return null;
  const obra = ctx.obrasById.get(c.obra_id);
  const subc = ctx.subcById.get(c.subcontratista_id);
  return {
    id: c.id, tabla: 'subcontratos', score,
    title: c.codigo || c.numero || '(subcontrato)',
    subtitle: [c.objeto || c.alcance, subc && subc.razon_social, obra && `Obra: ${obra.nombre_obra}`].filter(Boolean).join(' · '),
  };
}

function buildAcct(m, q, ctx) {
  const score = bestScore([m.description, m.document_number], q);
  if (!score) return null;
  const company = ctx.companyById.get(m.company_id);
  return {
    id: m.id, tabla: 'accounting_movements', score,
    title: m.description || '(movimiento)',
    subtitle: [m.document_number, m.type, m.date, company && company.name].filter(Boolean).join(' · '),
  };
}

function buildIncidencia(i, q, ctx) {
  const score = bestScore([i.titulo, i.descripcion], q);
  if (!score) return null;
  const obra = ctx.obrasById.get(i.obra_id);
  return {
    id: i.id, tabla: 'incidencias', score,
    title: i.titulo || (i.descripcion ? i.descripcion.slice(0, 60) : '(incidencia)'),
    subtitle: [i.estado, obra && `Obra: ${obra.nombre_obra}`].filter(Boolean).join(' · '),
  };
}

function buildCompany(c, q) {
  const score = bestScore([c.name, c.legal_name, c.ruc], q);
  if (!score) return null;
  return {
    id: c.id, tabla: 'companies', score,
    title: c.name || c.legal_name || '(empresa)',
    subtitle: [c.ruc && `RUC: ${c.ruc}`, c.legal_name && c.legal_name !== c.name ? c.legal_name : null, c.company_type].filter(Boolean).join(' · '),
  };
}

// ── Navegación ───────────────────────────────────────────────────────────────
function navegarA(tabla, recordId) {
  const page = NAV_PAGE[tabla];
  if (!page) return;
  try { window.location.hash = '#/' + page; } catch { /* noop */ }
  try {
    window.dispatchEvent(new CustomEvent('jx_navigate', { detail: { page, recordId } }));
  } catch { /* noop */ }
}

// ── Búsquedas recientes ──────────────────────────────────────────────────────
function loadRecientes() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, 10) : [];
  } catch { return []; }
}
function saveReciente(q) {
  if (!q || q.length < 2) return;
  try {
    const cur = loadRecientes().filter(x => x !== q);
    cur.unshift(q);
    localStorage.setItem(RECENT_KEY, JSON.stringify(cur.slice(0, 10)));
  } catch { /* noop */ }
}

// ── Página principal ─────────────────────────────────────────────────────────
function BusquedaGlobalPage() {
  const [query, setQuery] = uSB('');
  const [debounced, setDebounced] = uSB('');
  const [resultados, setResultados] = uSB(null); // { porCategoria, total, ordenCats }
  const [loading, setLoading] = uSB(false);
  const [recientes, setRecientes] = uSB(loadRecientes());
  const [expandido, setExpandido] = uSB({}); // tabla → bool (override)
  const inputRef = uRB(null);
  const cacheRef = uRB({ key: null, data: null });

  // Autofocus
  uEB(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce 250ms
  uEB(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Búsqueda
  uEB(() => {
    let cancelled = false;
    const run = async () => {
      const q = debounced;
      if (q.length < 2) {
        setResultados(null);
        setLoading(false);
        return;
      }
      // Cache simple por query
      if (cacheRef.current.key === q && cacheRef.current.data) {
        setResultados(cacheRef.current.data);
        return;
      }
      setLoading(true);

      const [
        obras, personal, materiales, herramientas, proveedores, partidas,
        requisiciones, ordenes_compra, valorizaciones, subcontratistas,
        subcontratos, accounting_movements, incidencias, companies,
      ] = await Promise.all([
        safeAll('obras'), safeAll('personal'), safeAll('materiales'), safeAll('herramientas'),
        safeAll('proveedores'), safeAll('partidas'), safeAll('requisiciones'), safeAll('ordenes_compra'),
        safeAll('valorizaciones'), safeAll('subcontratistas'), safeAll('subcontratos'),
        safeAll('accounting_movements'), safeAll('incidencias'), safeAll('companies'),
      ]);

      if (cancelled) return;

      const ctx = {
        obrasById: new Map(obras.map(o => [o.id, o])),
        provById: new Map(proveedores.map(p => [p.id, p])),
        subcById: new Map(subcontratistas.map(s => [s.id, s])),
        companyById: new Map(companies.map(c => [c.id, c])),
      };

      const porCategoria = {};
      const push = (cat, item) => {
        if (!item) return;
        if (!porCategoria[cat]) porCategoria[cat] = [];
        porCategoria[cat].push(item);
      };

      obras.forEach(o => push('obras', buildObra(o, q, ctx)));
      personal.forEach(p => push('personal', buildPersonal(p, q, ctx)));
      materiales.forEach(m => push('materiales', buildMaterial(m, q, ctx)));
      herramientas.forEach(h => push('herramientas', buildHerramienta(h, q, ctx)));
      proveedores.forEach(p => push('proveedores', buildProveedor(p, q)));
      partidas.forEach(p => push('partidas', buildPartida(p, q, ctx)));
      requisiciones.forEach(r => push('requisiciones', buildRequisicion(r, q, ctx)));
      ordenes_compra.forEach(o => push('ordenes_compra', buildOC(o, q, ctx)));
      valorizaciones.forEach(v => push('valorizaciones', buildValorizacion(v, q, ctx)));
      subcontratistas.forEach(s => push('subcontratistas', buildSubcontratista(s, q)));
      subcontratos.forEach(c => push('subcontratos', buildSubcontrato(c, q, ctx)));
      accounting_movements.forEach(m => push('accounting_movements', buildAcct(m, q, ctx)));
      incidencias.forEach(i => push('incidencias', buildIncidencia(i, q, ctx)));
      companies.forEach(c => push('companies', buildCompany(c, q)));

      // Ordenar dentro de cada categoría por score desc, luego longitud asc
      let total = 0;
      Object.keys(porCategoria).forEach(cat => {
        porCategoria[cat].sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return (a.title || '').length - (b.title || '').length;
        });
        total += porCategoria[cat].length;
      });

      // Orden de categorías: por max score
      const ordenCats = Object.keys(porCategoria).sort((a, b) => {
        const ma = porCategoria[a][0]?.score || 0;
        const mb = porCategoria[b][0]?.score || 0;
        if (mb !== ma) return mb - ma;
        return porCategoria[b].length - porCategoria[a].length;
      });

      const data = { porCategoria, total, ordenCats };
      cacheRef.current = { key: q, data };
      setResultados(data);
      setLoading(false);
      saveReciente(q);
      setRecientes(loadRecientes());
    };
    run();
    return () => { cancelled = true; };
  }, [debounced]);

  // Atajo: Enter abre el primer resultado
  const onInputKeyDown = (e) => {
    if (e.key === 'Enter' && resultados && resultados.total > 0) {
      e.preventDefault();
      const firstCat = resultados.ordenCats[0];
      const first = resultados.porCategoria[firstCat]?.[0];
      if (first) navegarA(first.tabla, first.id);
    }
  };

  const totalCats = resultados ? resultados.ordenCats.length : 0;
  const totalRes = resultados ? resultados.total : 0;

  return (
    <div className="page-wrap">
      <div className="pg-hd">
        <div>
          <div className="pg-title">Búsqueda global</div>
          <div className="pg-sub">Encuentra cualquier registro en JARVEX</div>
        </div>
      </div>

      {/* Barra de búsqueda */}
      <div className="card card-p" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <JxIcon name="search" size={20} color="var(--tm)" />
          <input
            ref={inputRef}
            className="fi"
            style={{ fontSize: 16, padding: '14px 16px', flex: 1 }}
            placeholder="Buscar en todo JARVEX..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            autoFocus
          />
          {query && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
              <JxIcon name="x" size={14} /> Limpiar
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--tm)' }}>
          Enter para abrir el primer resultado · Busca obras, personal, materiales, herramientas, proveedores, partidas, OC, requisiciones, valorizaciones, subcontratos, movimientos contables, incidencias, empresas.
        </div>
      </div>

      {/* Cards totales */}
      {resultados && (
        <div className="g3" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <div className="kpi-card">
            <div style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 500 }}>Resultados</div>
            <div className="kpi-val">{totalRes}</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>coincidencias para "{debounced}"</div>
          </div>
          <div className="kpi-card">
            <div style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 500 }}>Categorías</div>
            <div className="kpi-val">{totalCats}</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>módulos con coincidencia</div>
          </div>
          <div className="kpi-card">
            <div style={{ fontSize: 11.5, color: 'var(--tm)', fontWeight: 500 }}>Estado</div>
            <div className="kpi-val" style={{ fontSize: 18 }}>{loading ? 'Buscando…' : 'Listo'}</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>{loading ? 'consultando IndexedDB' : 'todas las tablas escaneadas'}</div>
          </div>
        </div>
      )}

      {/* Empty state: query < 2 chars */}
      {(!debounced || debounced.length < 2) && (
        <div style={{ display: 'grid', gap: 12 }}>
          {query.length > 0 && query.length < 2 && (
            <div className="card card-p empty-state">
              <JxIcon name="search" size={32} color="var(--tm)" />
              <p>Escribe al menos 2 caracteres para buscar.</p>
            </div>
          )}
          {recientes.length > 0 && query.length === 0 && (
            <div className="card card-p">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--tp)' }}>Búsquedas recientes</div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { localStorage.removeItem(RECENT_KEY); setRecientes([]); }}
                >
                  <JxIcon name="trash" size={12} /> Limpiar
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {recientes.map((r, i) => (
                  <button
                    key={r + '_' + i}
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setQuery(r); inputRef.current?.focus(); }}
                  >
                    <JxIcon name="search" size={12} /> {r}
                  </button>
                ))}
              </div>
            </div>
          )}
          {query.length === 0 && recientes.length === 0 && (
            <div className="card card-p empty-state">
              <JxIcon name="search" size={40} color="var(--tm)" />
              <p>Empieza a escribir para buscar en todo JARVEX.</p>
            </div>
          )}
        </div>
      )}

      {/* Resultados */}
      {resultados && totalRes === 0 && !loading && (
        <div className="card card-p empty-state">
          <JxIcon name="search" size={36} color="var(--tm)" />
          <p>Sin coincidencias para "{debounced}".</p>
          <p style={{ fontSize: 12, color: 'var(--tm)', marginTop: 4 }}>
            Prueba con otras palabras, parte del nombre, código o RUC.
          </p>
        </div>
      )}

      {resultados && totalRes > 0 && (
        <div style={{ display: 'grid', gap: 14 }}>
          {resultados.ordenCats.map(cat => {
            const items = resultados.porCategoria[cat];
            const color = CAT_COLOR[cat] || 'var(--amber)';
            const isLarge = items.length > 5;
            const isOpen = expandido[cat] !== undefined ? expandido[cat] : !isLarge;
            const visible = isOpen ? items : items.slice(0, 5);
            return (
              <div key={cat} className="card card-p" style={{ borderLeft: `3px solid ${color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: color + '1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <JxIcon name={CAT_ICON[cat] || 'list'} size={15} color={color} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--tp)' }}>
                        {CAT_LABEL[cat] || cat} <span style={{ color: 'var(--tm)', fontWeight: 500 }}>({items.length})</span>
                      </div>
                    </div>
                  </div>
                  {isLarge && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setExpandido(s => ({ ...s, [cat]: !isOpen }))}
                    >
                      <JxIcon name={isOpen ? 'chevD' : 'chevR'} size={12} />
                      {isOpen ? ' Colapsar' : ` Ver ${items.length - 5} más`}
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {visible.map(it => (
                    <div
                      key={cat + '_' + it.id}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', borderRadius: 8,
                        background: 'var(--bg-c2, rgba(255,255,255,0.02))',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <JxIcon name={CAT_ICON[cat] || 'list'} size={14} color={color} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tp)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {it.title}
                        </div>
                        {it.subtitle && (
                          <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {it.subtitle}
                          </div>
                        )}
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => navegarA(cat, it.id)}
                      >
                        Abrir <JxIcon name="chevR" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

window.BusquedaGlobalPage = BusquedaGlobalPage;
Object.assign(window, { BusquedaGlobalPage });
