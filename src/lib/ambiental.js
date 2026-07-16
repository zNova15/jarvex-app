// ═══════════════════════════════════════════════════════════════════
// JARVEX — Gestión Ambiental (ISO 14001 / reglamento ambiental).
//
// La ing. ambiental guarda evidencia por CATEGORÍA fija × MES; la matriz de
// cumplimiento mensual se arma sola (qué categorías tienen evidencia cada mes
// y cuáles no) — el formato que piden los auditores. La categoría
// "capacitacion" se AUTOCOMPLETA con las charlas ambientales realizadas
// (charlas_plan) y las inducciones ambientales, además de registros manuales.
// Funciones PURAS y testeables; la UI vive en jx-ambiental.jsx.
// ═══════════════════════════════════════════════════════════════════

export const CATEGORIAS_AMBIENTALES = [
  { key: 'residuos', label: 'Manejo de residuos', icon: 'package', hint: 'Manifiestos, disposición final, segregación' },
  { key: 'monitoreo_agua', label: 'Monitoreo de agua', icon: 'chart', hint: 'Informes de laboratorio, puntos de control' },
  { key: 'monitoreo_aire', label: 'Monitoreo de aire', icon: 'chart', hint: 'Material particulado, emisiones' },
  { key: 'monitoreo_ruido', label: 'Monitoreo de ruido', icon: 'chart', hint: 'Mediciones diurnas/nocturnas' },
  // exigibleMensual:false → no aparece en "pendientes del mes": los permisos no
  // generan evidencia nueva cada mes y un mes sin incidentes es el caso feliz.
  { key: 'permisos', label: 'Permisos y licencias', icon: 'file', hint: 'Autorizaciones, licencias, compromisos del IGA', exigibleMensual: false },
  { key: 'incidentes', label: 'Incidentes ambientales', icon: 'alert', hint: 'Derrames, hallazgos, acciones correctivas (solo si ocurren)', exigibleMensual: false },
  { key: 'capacitacion', label: 'Capacitación / charlas', icon: 'users', hint: 'Se autocompleta con charlas ambientales realizadas e inducciones' },
  { key: 'inspecciones', label: 'Inspecciones ambientales', icon: 'checkCircle', hint: 'Recorridos, checklists de campo' },
];
export const CATEGORIA_AMBIENTAL_KEYS = CATEGORIAS_AMBIENTALES.map(c => c.key);

/** 'YYYY-MM' del string fecha 'YYYY-MM-DD' (o null). */
export const mesDe = (fecha) => (fecha && /^\d{4}-\d{2}/.test(String(fecha)) ? String(fecha).slice(0, 7) : null);

/** Últimos n meses terminando en `hasta` ('YYYY-MM-DD' o 'YYYY-MM') → ['YYYY-MM', …] ascendente. */
export function mesesRango(hasta, n = 6) {
  const base = String(hasta).slice(0, 7);
  const [y, m] = base.split('-').map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Matriz de cumplimiento mensual. PURA.
 * @param registros  ambiental_registros [{categoria, fecha}]
 * @param charlasAmbientales  charlas_plan área ambiental REALIZADAS [{fecha}]
 * @param induccionesAmbientales  inducciones tipo ambiental [{fecha}]
 * @param meses  ['YYYY-MM', …]
 * @returns { celdas: Map('cat|mes' → count), porCategoria: [{key,label,total,meses:[{mes,n,ok}]}], pendientesMesActual: [labels] }
 */
export function matrizCumplimiento({ registros = [], charlasAmbientales = [], induccionesAmbientales = [], meses = [] } = {}) {
  const celdas = new Map();
  const add = (cat, mes, n = 1) => {
    if (!mes || !CATEGORIA_AMBIENTAL_KEYS.includes(cat)) return;
    const k = `${cat}|${mes}`;
    celdas.set(k, (celdas.get(k) || 0) + n);
  };
  for (const r of registros) add(r.categoria, mesDe(r.fecha));
  for (const c of charlasAmbientales) add('capacitacion', mesDe(c.fecha));
  for (const i of induccionesAmbientales) add('capacitacion', mesDe(i.fecha));

  const porCategoria = CATEGORIAS_AMBIENTALES.map(c => {
    const filas = meses.map(mes => {
      const n = celdas.get(`${c.key}|${mes}`) || 0;
      return { mes, n, ok: n > 0 };
    });
    return { key: c.key, label: c.label, total: filas.reduce((s, f) => s + f.n, 0), meses: filas };
  });

  const mesActual = meses[meses.length - 1];
  const pendientesMesActual = CATEGORIAS_AMBIENTALES
    .filter(c => c.exigibleMensual !== false && mesActual && !(celdas.get(`${c.key}|${mesActual}`) > 0))
    .map(c => c.label);

  return { celdas, porCategoria, pendientesMesActual };
}
