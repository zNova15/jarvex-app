// Componente de controles de paginación para tablas grandes.
// Se usa al pie de cualquier tabla que renderice listas con > 50 items.
//
// Props:
//   page, pageSize, totalPages, total, setPage, setPageSize, options?
//
// Uso típico:
//   <TablePagination
//     page={page} pageSize={pageSize} totalPages={totalPages} total={total}
//     setPage={setPage} setPageSize={setPageSize}
//   />

import React from "react";

const DEFAULT_OPTIONS = [25, 50, 100, 200];

function TablePagination({
  page, pageSize, totalPages, total,
  setPage, setPageSize,
  options = DEFAULT_OPTIONS,
}) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: 10, padding: '8px 12px', borderTop: '1px solid var(--border)',
      fontSize: 11.5, color: 'var(--tm)', flexWrap: 'wrap',
    }}>
      <div>
        Mostrando <strong style={{ color: 'var(--tp)' }}>{start}–{end}</strong> de <strong style={{ color: 'var(--tp)' }}>{total}</strong>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>Por página:</span>
        <select className="fi" style={{ width: 80, padding: '4px 6px', fontSize: 11 }}
          value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
          {options.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className="btn btn-ghost btn-xs" disabled={page === 1}
          onClick={() => setPage(page - 1)} title="Anterior">‹</button>
        <span style={{ minWidth: 80, textAlign: 'center' }}>
          Pág. <strong style={{ color: 'var(--tp)' }}>{page}</strong> / {totalPages}
        </span>
        <button className="btn btn-ghost btn-xs" disabled={page === totalPages}
          onClick={() => setPage(page + 1)} title="Siguiente">›</button>
      </div>
    </div>
  );
}

Object.assign(window, { TablePagination });
export { TablePagination };
