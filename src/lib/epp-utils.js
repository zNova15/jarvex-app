// ══════════════════════════════════════════════════════════════════════════
//  EPP — Utilidades de vida útil y vencimientos
//  Extraídas de jx-ssoma.jsx para poder testearlas y reusarlas.
// ══════════════════════════════════════════════════════════════════════════

// Catálogo de EPP con vidas útiles referenciales para obra peruana.
// (R.M. 050-2013-TR exige cambio anual para cascos / chalecos / arnés.)
export const CATALOGO_EPP = [
  { tipo: 'Casco',              vida_util_dias: 365, costo_ref: 25 },
  { tipo: 'Chaleco reflectivo', vida_util_dias: 365, costo_ref: 18 },
  { tipo: 'Guantes',            vida_util_dias: 15,  costo_ref: 8 },
  { tipo: 'Botas de seguridad', vida_util_dias: 180, costo_ref: 80 },
  { tipo: 'Lentes',             vida_util_dias: 90,  costo_ref: 12 },
  { tipo: 'Mascarilla',         vida_util_dias: 1,   costo_ref: 2 },
  { tipo: 'Arnés',              vida_util_dias: 365, costo_ref: 150 },
  { tipo: 'Auriculares',        vida_util_dias: 365, costo_ref: 35 },
  { tipo: 'Tapones',            vida_util_dias: 30,  costo_ref: 3 },
  { tipo: 'Otro',               vida_util_dias: null, costo_ref: 0 },
];

// Devuelve la entrada del catálogo para un tipo, o null si no se encuentra.
export const epppTipo = (t) => CATALOGO_EPP.find(c => c.tipo === t) || null;

// Texto humano para una vida útil dada en días.
//  < 7 días  → "N día(s)"
//  < 30 días → "N sem"
//  < 365 días → "N meses"
//  ≥ 365 días → "N año(s)"
export const epppVidaTexto = (dias) => {
  if (dias == null) return '—';
  if (dias < 7) return `${dias} día${dias !== 1 ? 's' : ''}`;
  if (dias < 30) return `${Math.round(dias/7)} sem`;
  if (dias < 365) return `${Math.round(dias/30)} meses`;
  return `${(dias/365).toFixed(0)} año${dias >= 730 ? 's' : ''}`;
};

// Suma `dias` días a una fecha ISO 'YYYY-MM-DD' devolviendo otra ISO.
// Si la fecha o los días son nulos, devuelve null.
export const sumarDiasISO = (iso, dias) => {
  if (!iso || dias == null) return null;
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
};

// Detecta si un nombre de material corresponde a un EPP (Equipo de
// Protección Personal). Misma regex que usa el importador Excel para
// clasificar como 'seguridad'. Reusable desde cualquier modal.
const EPP_NAME_RE = /casco|chaleco|guante|extintor|arn[ée]s|botas?|lentes|m[áa]scara|mascarilla|tapones|protecci[óo]n|proteccion|respirador|auriculares|protector auditivo|epp/i;

export function detectarEPP(nombre) {
  if (!nombre || typeof nombre !== 'string') return null;
  if (!EPP_NAME_RE.test(nombre)) return null;
  // Devuelve el tipo del catálogo más probable
  const s = nombre.toLowerCase();
  if (/casco/.test(s))                 return 'Casco';
  if (/chaleco/.test(s))               return 'Chaleco reflectivo';
  if (/guante/.test(s))                return 'Guantes';
  if (/bota/.test(s))                  return 'Botas de seguridad';
  if (/lentes|gafas/.test(s))          return 'Lentes';
  if (/mascarilla|m[áa]scara/.test(s)) return 'Mascarilla';
  if (/arn[ée]s/.test(s))              return 'Arnés';
  if (/auriculares|protector auditivo/.test(s)) return 'Auriculares';
  if (/tapones/.test(s))               return 'Tapones';
  return 'Otro';
}

export function esProbablementeEPP(nombre) {
  return detectarEPP(nombre) !== null;
}
