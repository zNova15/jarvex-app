// ═══════════════════════════════════════════════════════════════════
// JARVEX — La EMPRESA ACTIVA, reactiva (tanda 2G).
//
// `src/lib/empresa-activa.js` guarda el id y avisa por evento; esto es el
// hook que hace que una pantalla ya abierta se entere. Hermano de
// `useObraActiva`.
//
// POR QUÉ EXISTE APARTE del cartel (`jx-empresa-banner.jsx`): las pantallas
// contables no solo tienen que MOSTRAR el contexto, tienen que OBEDECERLO.
// Gabriel, 3-sep-2026:
//
//   «Aquí no va a estar que cambio un filtro y voy a ir a otra empresa, sino
//    netamente y exclusivamente de esa empresa seleccionada.»
//
// Con `filtroInicialEmpresa` la pantalla ARRANCABA en la empresa, pero el
// selector seguía abierto: dos clicks y estabas viendo otra sin haber salido
// del contexto —el menú, el cartel y el título seguían diciendo la primera—.
// `useEmpresaBloqueada()` es lo que cierra esa puerta.
// ═══════════════════════════════════════════════════════════════════
import React from 'react';
import { getEmpresaActivaId, EMPRESA_ACTIVA_EVENT } from '../lib/empresa-activa.js';

/** El id de la empresa activa, o null. Reactivo. */
export function useEmpresaActivaId() {
  const [id, setId] = React.useState(() => getEmpresaActivaId());
  React.useEffect(() => {
    const on = (e) => setId(e?.detail?.id ?? getEmpresaActivaId());
    window.addEventListener(EMPRESA_ACTIVA_EVENT, on);
    return () => window.removeEventListener(EMPRESA_ACTIVA_EVENT, on);
  }, []);
  return id;
}

/**
 * ¿El selector de empresa de esta pantalla tiene que estar CLAVADO?
 *
 * Devuelve el id cuando hay contexto de empresa (y entonces el <select> va
 * `disabled` mostrando esa empresa), o null cuando se mira el grupo entero.
 *
 * Uso, dos líneas por pantalla:
 *     const empresaFija = useEmpresaBloqueada();
 *     …
 *     <select disabled={!!empresaFija} value={empresaFija || filtro} …>
 */
export function useEmpresaBloqueada() {
  const id = useEmpresaActivaId();
  // DENTRO DE UNA OBRA MANDA LA OBRA. El contexto de empresa persiste en
  // localStorage (sobrevive al F5, como la obra activa), así que sin este
  // corte una empresa activa vieja se colaba en el workspace de un trabajo:
  // abrías "Movimientos de esta obra" o "Planillas" desde el menú de la obra
  // y te los acotaba a una empresa que no venías mirando. Los dos contextos
  // no se cruzan: el plano lo decide jx-app y lo publica en window.__plano
  // antes de renderizar la página.
  if (typeof window !== 'undefined' && window.__plano === 'obra') return null;
  return id;
}
