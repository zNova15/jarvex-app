// ═══════════════════════════════════════════════════════════════════
// JARVEX — Quién es quién en un comprobante (Captura Mágica)
//
// Un comprobante tiene EMISOR (vende) y RECEPTOR (compra). Según cuál de
// los dos sea una empresa DEL GRUPO, la operación es otra cosa — y sobre
// todo, cambia qué se puede crear a partir del documento.
//
// El bug que originó esta lib (1-sep, reportado por Gabriel): al subir una
// factura donde NUESTRA empresa vendía a un cliente EXTERNO, la revisión
// ofrecía (a) dar de alta a nuestra propia empresa como PROVEEDOR y
// (b) crear al cliente externo como EMPRESA DEL GRUPO, con "crear nueva"
// ya pre-seleccionado. Incorporar al grupo una empresa que no manejamos
// ensucia la contabilidad consolidada e intercompany.
// ═══════════════════════════════════════════════════════════════════

export const OP_COMPRA = 'compra';                 // externo nos vende  → proveedor
export const OP_VENTA_EXTERNA = 'venta_externa';   // vendemos a un tercero → cliente
export const OP_INTERCO = 'interco';               // entre empresas nuestras
export const OP_AJENA = 'ajena';                   // ninguna de las dos es nuestra

export function clasificarPartes({ emisorEsNuestro, receptorEsNuestro } = {}) {
  if (emisorEsNuestro && receptorEsNuestro) return OP_INTERCO;
  if (emisorEsNuestro) return OP_VENTA_EXTERNA;
  if (receptorEsNuestro) return OP_COMPRA;
  return OP_AJENA;
}

// ¿Tiene sentido dar de alta al EMISOR como proveedor?
// Solo si no es nuestro: en una venta (o en un interco) el emisor somos
// nosotros, y un proveedor "JARVEX" es basura en el padrón.
export function permiteCrearProveedor(op) {
  return op === OP_COMPRA || op === OP_AJENA;
}

// ¿Tiene sentido dar de alta al RECEPTOR como empresa DEL GRUPO?
// Solo cuando ninguna de las dos partes se reconoció (OP_AJENA): ahí el
// receptor puede ser una empresa nuestra todavía no registrada. Si el emisor
// es nuestro, el receptor es un CLIENTE y no se incorpora al grupo.
export function permiteCrearEmpresaGrupo(op) {
  return op === OP_AJENA;
}

// La empresa del movimiento: en una venta es el emisor (nosotros); en una
// compra/ajena, el receptor (nosotros o la que se elija).
export function empresaDelMovimiento(op, { emisorCompanyId, receptorCompanyId } = {}) {
  return (op === OP_VENTA_EXTERNA || op === OP_INTERCO) ? (emisorCompanyId || null) : (receptorCompanyId || null);
}

// Etiquetas de la contraparte para la UI (a quién le compramos / vendemos).
export function etiquetaContraparte(op) {
  switch (op) {
    case OP_VENTA_EXTERNA: return { titulo: 'Cliente (comprador externo)', rol: 'cliente' };
    case OP_INTERCO:       return { titulo: 'Empresa compradora (tu grupo)', rol: 'empresa_grupo' };
    default:               return { titulo: 'Empresa compradora (tu grupo)', rol: 'empresa_grupo' };
  }
}
