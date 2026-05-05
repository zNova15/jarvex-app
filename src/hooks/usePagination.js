// Hook de paginación para listas grandes (materiales, movimientos, etc.).
//
// Renderizar 500+ filas en el DOM hace que filtros/scroll laguen porque el
// browser GC de DOM nodes es caro. Con paginación a 50/100/200 items por
// página, la tabla queda fluida sin importar el tamaño total del dataset.
//
// Uso:
//   const { pagedItems, page, pageSize, totalPages, setPage, setPageSize, total }
//     = usePagination(filtered, 50);
//   ...
//   {pagedItems.map(...)}
//   <TablePagination {...{ page, pageSize, totalPages, total, setPage, setPageSize }}/>

import { useState, useMemo, useEffect } from 'react';

export function usePagination(items, defaultPageSize = 50) {
  const [page, setPageInner] = useState(1);
  const [pageSize, setPageSizeInner] = useState(defaultPageSize);

  // Si el array cambia y la página actual queda fuera de rango, volver a 1.
  // (ej: usuario filtra → quedan 10 items → página 5 ya no existe)
  const total = (items || []).length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > totalPages) setPageInner(1);
  }, [page, totalPages]);

  const pagedItems = useMemo(() => {
    if (!Array.isArray(items)) return [];
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize]);

  const setPage = (p) => setPageInner(Math.max(1, Math.min(totalPages, p)));
  const setPageSize = (s) => {
    setPageSizeInner(s);
    setPageInner(1);
  };

  return {
    pagedItems,
    page,
    pageSize,
    totalPages,
    total,
    setPage,
    setPageSize,
    nextPage: () => setPage(page + 1),
    prevPage: () => setPage(page - 1),
  };
}
