// ═══════════════════════════════════════════════════════════════════
// JARVEX — Los bloques de la PANTALLA PRINCIPAL (tanda 2D).
//
// Vive fuera del componente por la misma razón que `desglose-obra.js`: para
// que un test pueda atarlo al menú real. Un bloque que apunte a una página
// inexistente no rompe el build ni falla en pantalla — simplemente no lleva a
// ningún lado, y el usuario se queda mirando una tarjeta muerta en la primera
// pantalla de la app. El test de este archivo lo detecta.
//
// `entradas` = páginas candidatas EN ORDEN. La pantalla usa la primera que el
// rol pueda abrir, y si no puede abrir ninguna no muestra el bloque. Es una
// lista porque el mismo bloque tiene distinta puerta según quién mire: la
// contadora entra a Configuración por 'configuracion' (ajustes) y el admin por
// 'usuarios'.
//
// TODAS las entradas son del plano GENERAL a propósito: la pantalla principal
// no tiene obra activa, así que no puede llevar a una página de plano obra
// (caería en el workspace de una obra cualquiera, o en vacío).
//
// Puro: sin React, sin Dexie.
// ═══════════════════════════════════════════════════════════════════

export const BLOQUES_INICIO = [
  {
    id: 'trabajos', titulo: 'Trabajos', icon: 'hardHat', color: 'var(--amber)',
    desc: 'Obras, supervisiones y bienes/servicios. Entrá a uno para ver su desglose completo.',
    entradas: ['trabajos'],
  },
  {
    id: 'empresas', titulo: 'Empresas', icon: 'building', color: 'var(--purple)',
    desc: 'Las empresas del grupo, los consorcios y los terceros, cada una con su ficha.',
    entradas: ['empresas'],
  },
  {
    id: 'contabilidad', titulo: 'Contabilidad', icon: 'dollar', color: 'var(--green)',
    desc: 'El resumen de la contabilidad de cada entidad —empresas y trabajos— y los libros del grupo.',
    // OJO: 'movimientos-contables' NO va acá aunque sea del área. Es una
    // página DUAL (existe en el plano obra y en el general) y `planoDe` la da
    // como 'obra': navegar ahí desde el Inicio metía al usuario en el
    // workspace de una obra cualquiera. Lo detectó el test de este archivo.
    // No hace falta: las dos entradas de abajo comparten el módulo de
    // permisos ('Movs. Contables'), así que quien ve una ve las otras.
    entradas: ['contabilidad', 'cont-dashboard'],
  },
  {
    id: 'licitaciones', titulo: 'Licitaciones', icon: 'chart', color: 'var(--blue)',
    desc: 'Plantel profesional para postular y los trabajos a los que nos presentamos.',
    entradas: ['profesionales'],
  },
  {
    id: 'config', titulo: 'Configuración', icon: 'settings', color: 'var(--tm)',
    desc: 'Usuarios, roles y permisos, solicitudes, auditoría y ajustes del sistema.',
    entradas: ['usuarios', 'configuracion'],
  },
];

// Atajos que no son un bloque del grupo pero se usan todo el día. Van como
// chips debajo, para no inflar la fila de bloques con cosas de otro nivel.
export const ATAJOS_INICIO = [
  { id: 'captura-magica', label: 'Captura Mágica', icon: 'upload' },
  { id: 'busqueda', label: 'Búsqueda global', icon: 'search' },
  { id: 'dashboard-ejecutivo', label: 'Dashboard ejecutivo', icon: 'dashboard' },
  { id: 'alertas', label: 'Alertas', icon: 'bell' },
];

/**
 * Los bloques que este usuario ve, ya resueltos a su página de entrada.
 * @param canSee (pageId) => boolean — el MISMO gate del sidebar.
 */
export function bloquesVisibles(canSee) {
  const ver = typeof canSee === 'function' ? canSee : () => true;
  return BLOQUES_INICIO
    .map(b => ({ ...b, entrada: b.entradas.find(id => ver(id)) || null }))
    .filter(b => b.entrada);
}

/** Los atajos que este usuario ve. */
export function atajosVisibles(canSee) {
  const ver = typeof canSee === 'function' ? canSee : () => true;
  return ATAJOS_INICIO.filter(a => ver(a.id));
}
