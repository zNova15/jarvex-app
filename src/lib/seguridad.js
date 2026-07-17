// ═══════════════════════════════════════════════════════════════════
// JARVEX — Seguridad (SSOMA): SCTR y planificador de charlas.
// Funciones PURAS y testeables (la UI vive en jx-seguridad.jsx).
// ═══════════════════════════════════════════════════════════════════
import { parseFechaMigracion } from './migracion-parser.js';

/**
 * Estado del SCTR de un trabajador según su vencimiento.
 * @param venc 'YYYY-MM-DD' | null  @param hoy 'YYYY-MM-DD'
 * @returns 'sin' | 'vencido' | 'por_vencer' (≤30 días) | 'vigente'
 */
export function estadoSctr(venc, hoy) {
  if (!venc) return 'sin';
  const v = String(venc).slice(0, 10);
  const h = String(hoy).slice(0, 10);
  if (v < h) return 'vencido';
  // días de diferencia por Date.UTC (strings YYYY-MM-DD → sin líos de TZ)
  const [vy, vm, vd] = v.split('-').map(Number);
  const [hy, hm, hd] = h.split('-').map(Number);
  const dias = Math.round((Date.UTC(vy, vm - 1, vd) - Date.UTC(hy, hm - 1, hd)) / 86400000);
  return dias <= 30 ? 'por_vencer' : 'vigente';
}

// ── Import de cronograma de charlas desde Excel ──────────────────────
// Las ingenieras arman su cronograma en Excel con columnas tipo:
//   Fecha | Tema | Área | Expositor | Notas  (nombres flexibles)
// parseExcelFile (lib/excel) devuelve rows como objetos {header: valor}.

const ALIAS = {
  fecha: ['fecha', 'dia', 'día', 'date', 'fecha programada', 'fecha charla'],
  tema: ['tema', 'charla', 'titulo', 'título', 'tema de charla', 'contenido', 'descripcion', 'descripción'],
  area: ['area', 'área', 'tipo', 'gestion', 'gestión'],
  expositor: ['expositor', 'responsable', 'encargado', 'dicta', 'facilitador', 'ponente'],
  notas: ['notas', 'observaciones', 'obs', 'comentarios', 'detalle'],
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Dos pasadas: nombres PRIMARIOS exactos primero, alias débiles después — un
// Excel 'Fecha | Tipo | Área' no debe mapear area→'Tipo' tapando a 'Área'.
const PRIMARIOS = { fecha: ['fecha'], tema: ['tema'], area: ['area'], expositor: ['expositor'], notas: ['notas'] };
function mapHeaders(headers) {
  const out = {};
  for (const fuentes of [PRIMARIOS, ALIAS]) {
    for (const h of headers || []) {
      const n = norm(h);
      for (const [campo, aliases] of Object.entries(fuentes)) {
        if (!out[campo] && aliases.includes(n)) out[campo] = h;
      }
    }
  }
  return out;
}

/**
 * Fecha flexible → 'YYYY-MM-DD' o null. DELEGA en parseFechaMigracion
 * (lib/migracion-parser), que ya maneja la TRAMPA de Excel: sheet_to_json con
 * raw:false entrega las celdas-fecha como 'M/D/YY' (US), no dd/mm — un parser
 * day-first intercambiaba mes y día en silencio (review Fase 2). También cubre
 * Date, seriales de Excel y VALIDA rangos (mes 1-12, día 1-31 → si no, null).
 */
export function parseFechaFlexible(v) {
  return parseFechaMigracion(v);
}

function areaDeTexto(v, areaDefault) {
  const n = norm(v);
  if (n.includes('ambient')) return 'ambiental';
  if (n.includes('social') || n.includes('comunid')) return 'social';
  if (n.includes('segur') || n.includes('ssoma') || n.includes('sst')) return 'seguridad';
  return areaDefault;
}

/**
 * Convierte filas del Excel en charlas planificadas. PURA.
 * @returns { charlas: [{fecha, tema, area, expositor, notas}], errores: [string] }
 */
export function parseCharlasExcel({ headers = [], rows = [], areaDefault = 'seguridad' } = {}) {
  const map = mapHeaders(headers);
  const errores = [];
  if (!map.fecha || !map.tema) {
    return { charlas: [], errores: [`No encuentro las columnas mínimas: ${!map.fecha ? 'Fecha' : ''} ${!map.tema ? 'Tema' : ''}`.trim() + '. Encabezados leídos: ' + (headers || []).join(', ')] };
  }
  const charlas = [];
  rows.forEach((r, i) => {
    const tema = String(r[map.tema] ?? '').trim();
    const fecha = parseFechaFlexible(r[map.fecha]);
    if (!tema && !fecha) return; // fila vacía
    if (!tema) { errores.push(`Fila leída #${i + 1}: sin tema`); return; }
    if (!fecha) { errores.push(`Fila leída #${i + 1}: fecha inválida ("${r[map.fecha]}")`); return; }
    charlas.push({
      fecha, tema,
      area: map.area ? areaDeTexto(r[map.area], areaDefault) : areaDefault,
      expositor: map.expositor ? String(r[map.expositor] ?? '').trim() || null : null,
      notas: map.notas ? String(r[map.notas] ?? '').trim() || null : null,
    });
  });
  return { charlas, errores };
}
