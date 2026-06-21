// Estructura de carpetas en Drive por OBRA. Idempotente (busca-o-crea).
import { asegurarCarpeta } from './drive.js';

// Subcarpetas estándar donde se guarda información delicada de cada obra.
export const SUBCARPETAS_OBRA = [
  'Facturas',
  'Evidencias de Movimientos de Insumos',
  'Reportes Diarios',
  'Fotos de Avance',
  'Documentos',
];

/**
 * Crea (idempotente) la estructura de una obra dentro de la carpeta raíz:
 *   <Obra>/
 *     Facturas/
 *     Evidencias de Movimientos de Insumos/
 *     Reportes Diarios/  → Fotos/
 *     Fotos de Avance/
 *     Documentos/
 * @returns {Promise<{ obraId:string, carpetas:Record<string,string> }>}
 */
export async function estructuraObra(drive, rootId, obraNombre) {
  if (!rootId) throw new Error('estructuraObra: falta rootId (la carpeta compartida raíz)');
  if (!obraNombre) throw new Error('estructuraObra: falta el nombre de la obra');
  const obra = await asegurarCarpeta(drive, obraNombre, rootId);
  const carpetas = { Obra: obra.id };
  for (const nombre of SUBCARPETAS_OBRA) {
    const f = await asegurarCarpeta(drive, nombre, obra.id);
    carpetas[nombre] = f.id;
  }
  // Fotos anidadas dentro de Reportes Diarios.
  const fotosRep = await asegurarCarpeta(drive, 'Fotos', carpetas['Reportes Diarios']);
  carpetas['Reportes Diarios/Fotos'] = fotosRep.id;
  return { obraId: obra.id, carpetas };
}

/**
 * Carpeta destino del reporte diario de un ingeniero en una fecha:
 *   Reportes Diarios/<fecha>/<ingeniero>/   (subí las fotos ahí dentro).
 * @returns {Promise<string>} id de la carpeta del ingeniero ese día
 */
export async function carpetaReporteDiario(drive, reportesDiariosId, fecha, ingeniero) {
  const dia = await asegurarCarpeta(drive, fecha, reportesDiariosId);
  const ing = await asegurarCarpeta(drive, ingeniero || 'sin-nombre', dia.id);
  return ing.id;
}
