// ═══════════════════════════════════════════════════════════════════
// JARVEX — CONSOLIDADO CONTABLE DEL GRUPO (tanda 3).
//
// Qué pedía la tanda 3 (docs/tanda-3-consolidado.md): que el resumen macro
// del grupo sea un consolidado contable REAL, con eliminaciones
// intercompañía, y que el perímetro de eliminación incluya al CONSORCIO como
// contraparte (no solo empresa-contra-empresa). Caso de referencia: la cadena
// A → B → consorcio ejecutor no puede contar el mismo material tres veces.
//
// ── LO QUE HACÍA LA PANTALLA ANTES, Y POR QUÉ NO ALCANZABA ─────────
// El Consolidado sumaba por separado los `income` marcados is_intercompany y
// los `cost` marcados is_intercompany, y restaba cada bolsa de su lado. Eso
// NO es una eliminación: una eliminación es un PAR (el ingreso del vendedor
// contra el costo del comprador). Medido en producción el 3-sep-2026:
//
//   · ingresos internos  S/ 2.402.475,52  (111 movimientos)
//   · costos internos    S/ 2.301.917,84  ( 95 movimientos)
//
// El error concreto que eso produce: 12 de esos ingresos SÍ tenían su costo
// espejo cargado (las facturas E001-133 a E001-144 de SALAZAR CERQUIN RUTH a
// CHUSAAC / ESPERANZA / SAMADAY, S/ 72.408), pero al espejo le faltaba el
// flag `is_intercompany`. Resultado: se eliminaba el ingreso del vendedor y
// el costo del comprador se contaba como COSTO EXTERNO DEL GRUPO. La utilidad
// consolidada salía S/ 72.408 por debajo de la real y la pantalla no daba
// ninguna señal. Emparejar por documento lo cierra sin tocar un solo dato.
//
// Los otros 4 ingresos sin par (dos facturas de JARVEX a EL INCA y dos notas
// de crédito) no tienen espejo en NINGÚN libro. Ahí el número del grupo está
// bien igual —lo que no existe no hay que eliminarlo— pero el libro del
// comprador está incompleto: nunca registró esa compra. Eso es un aviso para
// la contadora, no un ajuste del consolidado, y así se presenta.
//
// ── LAS TRES REGLAS DE ESTE ARCHIVO ───────────────────────────────
//
// 1. PERÍMETRO EXPLÍCITO. Se consolidan los libros de las entidades DEL
//    GRUPO, y el archivo dice de dónde salió cada una (catálogo, titular de
//    consorcio, socio de consorcio, o evidencia). Los libros de un tercero
//    (una municipalidad cliente) no entran al consolidado del grupo.
//    EL CATÁLOGO MANDA sobre la evidencia (decisión de Gabriel, 3-sep-2026):
//    si una empresa está marcada 'tercero', queda AFUERA por más facturas
//    marcadas "interna" que tenga encima. Caso real: CONSORCIO ESPERANZA y
//    CONSORCIO SAMADAY —consorcios que terminaron su obra— se tratan como
//    terceros para no arrastrar la migración de sus socias. Lo que NO cede
//    ante el catálogo son los hechos duros: ser titular o socia de un
//    consorcio del grupo (una fila de `consorcios`/`consorcio_socios` es una
//    afirmación, no una casilla marcada al vuelo en una factura).
//
// 2. SE ELIMINA DE A PARES. Un movimiento interno solo se elimina contra su
//    espejo. Lo que no encuentra espejo NO se esconde: sale por
//    `sinEspejo`, con entidad, documento e importe, para que la contadora
//    sepa qué libro le falta cargar.
//
// 3. LA CONTRAPARTE SE RESUELVE, NO SE ASUME. Vale `related_company_id`, y
//    si no está, el RUC contra el catálogo. Así una venta a un consorcio del
//    grupo se elimina aunque nadie haya marcado la casilla — que es el
//    agujero que la tanda 3 tenía que cerrar.
//
// Puro: sin React, sin Dexie, sin imports.
// ═══════════════════════════════════════════════════════════════════

/** Por qué una entidad está dentro del perímetro de consolidación. */
export const MOTIVO = {
  CATALOGO:  'catalogo',        // companies.tipo_entidad = propia | consorcio
  TITULAR:   'titular_consorcio', // es el titular contable de un consorcio
  SOCIO:     'socio_consorcio',   // es socia de un consorcio del grupo
  EVIDENCIA: 'evidencia',       // las contadoras ya la tratan como interna
};

export const MOTIVO_LABEL = {
  [MOTIVO.CATALOGO]:  'Del catálogo',
  [MOTIVO.TITULAR]:   'Titular de consorcio',
  [MOTIVO.SOCIO]:     'Socia de consorcio',
  [MOTIVO.EVIDENCIA]: 'Por evidencia (falta clasificarla)',
};

const vivos = (arr) => (Array.isArray(arr) ? arr.filter(x => x && !x.deleted_at) : []);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * RUC utilizable como identificador de contraparte.
 * Solo 11 dígitos (RUC peruano). Se descartan a propósito los placeholders
 * como el '00000000' de la company "General": si se aceptara, cualquier
 * movimiento sin RUC caería sobre esa empresa y se eliminaría solo.
 */
export function rucValido(ruc) {
  return /^\d{11}$/.test(String(ruc || '').trim());
}

/**
 * El perímetro de consolidación: qué entidades del grupo se consolidan y por
 * qué. `movs` es opcional y solo se usa para el motivo 'evidencia'.
 *
 * @returns {{
 *   ids: Set<string>,
 *   entidades: Array<{id,nombre,ruc,tipo_entidad,motivo}>,
 *   porRuc: Map<string,string>,
 *   aClasificar: Array<{id,nombre,ruc,tipo_entidad,motivo}>,
 * }}
 */
export function perimetroGrupo({ companies = [], consorcios = [], socios = [], movs = [] } = {}) {
  const comps = vivos(companies);
  const byId = new Map(comps.map(c => [c.id, c]));
  const motivos = new Map();   // id → motivo (gana el primero que lo mete)

  const meter = (id, motivo) => {
    if (!id || !byId.has(id) || motivos.has(id)) return;
    motivos.set(id, motivo);
  };

  // 1) Catálogo: propias y consorcios. El default de tipo_entidad es 'propia'
  //    (así quedó la mig 172 y así lo lee contabilidad-entidades.js).
  for (const c of comps) {
    const t = c.tipo_entidad || 'propia';
    if (t === 'propia' || t === 'consorcio') meter(c.id, MOTIVO.CATALOGO);
  }

  // 2) Titulares contables de consorcios y sus socias. Un consorcio del grupo
  //    puede estar mal clasificado como 'tercero' en el catálogo y su fila de
  //    `consorcios` seguir siendo la verdad — pasó con EL INCA hasta el 3-sep.
  for (const co of vivos(consorcios)) meter(co.company_id, MOTIVO.TITULAR);
  const idsConsorcio = new Set(vivos(consorcios).map(co => co.company_id).filter(Boolean));
  for (const s of vivos(socios)) meter(s.company_id, MOTIVO.SOCIO);

  // 3) Evidencia: si ya hay movimientos marcados is_intercompany contra una
  //    entidad que el catálogo todavía no clasificó, las contadoras la están
  //    tratando como interna. Se respeta la práctica y se lista aparte para
  //    que alguien la clasifique.
  //    PERO una casilla marcada en una factura NO revierte una decisión del
  //    catálogo: si `tipo_entidad` dice 'tercero', la entidad queda AFUERA y
  //    sus operaciones "internas" pasan a `terceros` para que la pantalla las
  //    muestre (son ingresos externos del grupo, no eliminaciones).
  const terceroMarcadoInterno = new Set();
  for (const m of movs || []) {
    if (!m || m.deleted_at || m.is_intercompany !== true) continue;
    for (const id of [m.company_id, m.related_company_id]) {
      if (!id || !byId.has(id) || motivos.has(id)) continue;
      if ((byId.get(id).tipo_entidad || 'propia') === 'tercero') { terceroMarcadoInterno.add(id); continue; }
      meter(id, MOTIVO.EVIDENCIA);
    }
  }

  const entidades = [...motivos.entries()].map(([id, motivo]) => {
    const c = byId.get(id);
    return {
      id,
      nombre: c?.name || '(entidad sin nombre)',
      ruc: c?.ruc || null,
      tipo_entidad: c?.tipo_entidad || 'propia',
      esConsorcio: idsConsorcio.has(id) || (c?.tipo_entidad === 'consorcio'),
      motivo,
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre));

  const porRuc = new Map();
  for (const e of entidades) {
    if (rucValido(e.ruc)) porRuc.set(String(e.ruc).trim(), e.id);
  }

  // Índice de las entidades de AFUERA. Sirve para lo contrario del perímetro:
  // saber que una contraparte está identificada y NO es del grupo, para que el
  // flag `is_intercompany` de una factura no la meta al consolidado por la
  // ventana (ver esInterna).
  const fueraIds = new Set();
  const fueraPorRuc = new Map();
  for (const c of comps) {
    if (motivos.has(c.id)) continue;
    fueraIds.add(c.id);
    if (rucValido(c.ruc)) fueraPorRuc.set(String(c.ruc).trim(), c.id);
  }

  return {
    ids: new Set(motivos.keys()),
    entidades,
    porRuc,
    fueraIds,
    fueraPorRuc,
    // Las que entraron SOLO por evidencia: el catálogo todavía no las
    // clasificó. Es trabajo pendiente de una persona, no un bug del cálculo.
    aClasificar: entidades.filter(e => e.motivo === MOTIVO.EVIDENCIA),
    // Terceros del catálogo que TIENEN operaciones marcadas como internas.
    // Están afuera a propósito (el catálogo manda); la pantalla lo dice para
    // que nadie crea que la casilla "interna" quedó haciendo algo.
    terceros: [...terceroMarcadoInterno].map(id => {
      const c = byId.get(id);
      return { id, nombre: c?.name || '(entidad sin nombre)', ruc: c?.ruc || null };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre)),
  };
}

/**
 * A quién le vendió / a quién le compró este movimiento, si es alguien del
 * perímetro. Devuelve el id de la entidad o null.
 */
export function contraparteInterna(mov, perimetro) {
  if (!mov || !perimetro) return null;
  const rel = mov.related_company_id;
  if (rel && perimetro.ids.has(rel)) return rel;
  const ruc = String(mov.third_party_ruc || '').trim();
  if (rucValido(ruc)) {
    const id = perimetro.porRuc.get(ruc);
    if (id && id !== mov.company_id) return id;
  }
  return null;
}

/**
 * La contraparte de este movimiento, cuando es una entidad IDENTIFICADA que
 * está FUERA del perímetro. Devuelve su id o null.
 *
 * Es la pieza que hace que el catálogo mande: un proveedor cualquiera (RUC que
 * no está en `companies`) devuelve null —ahí no sabemos nada y el flag de la
 * contadora sigue valiendo—, pero una empresa cargada y clasificada 'tercero'
 * devuelve su id, y eso desarma el flag.
 */
export function contraparteFuera(mov, perimetro) {
  if (!mov || !perimetro) return null;
  const rel = mov.related_company_id;
  if (rel && perimetro.fueraIds?.has(rel)) return rel;
  const ruc = String(mov.third_party_ruc || '').trim();
  if (rucValido(ruc)) {
    const id = perimetro.fueraPorRuc?.get(ruc);
    if (id && id !== mov.company_id) return id;
  }
  return null;
}

/**
 * ¿Este movimiento es una operación INTERNA del grupo?
 * Su dueño tiene que estar en el perímetro (si no, no se consolida) y la
 * contraparte también.
 *
 * El flag `is_intercompany` alcanza por sí solo MIENTRAS la contraparte no
 * esté identificada como alguien de afuera. Si el catálogo dice que la
 * contraparte es un tercero, gana el catálogo: si no, marcar ESPERANZA como
 * tercero no serviría de nada —sus 35 facturas seguirían saliendo del ingreso
 * externo por el flag, y el grupo mostraría S/214.071 de venta que no cuenta
 * en ningún lado (ni eliminada contra un libro del grupo, ni facturada a un
 * cliente). Ese es el "duplicar/triplicar" al revés: hacer desaparecer plata.
 */
export function esInterna(mov, perimetro) {
  if (!mov || !perimetro?.ids.has(mov.company_id)) return false;
  if (contraparteInterna(mov, perimetro) != null) return true;
  if (mov.is_intercompany === true) return contraparteFuera(mov, perimetro) == null;
  return false;
}

/** Bucket contable de un movimiento: 'ingresos' | 'costos' | 'gastos'. */
function bucketDe(mov) {
  if (mov.type === 'income') return 'ingresos';
  if (mov.type === 'expense') return 'gastos';
  return 'costos';
}

/** Clave de emparejamiento de reserva: mismo documento y mismo importe. */
function claveDocumento(mov) {
  const doc = String(mov.document_number || '').trim().toUpperCase();
  if (!doc) return null;
  return `${doc}|${r2(mov.amount)}`;
}

/**
 * Empareja las operaciones internas: el ingreso del vendedor contra el costo
 * del comprador.
 *
 * Dos pasadas, en este orden:
 *   1. `related_movement_id` — el vínculo explícito. Lo escribe SIEMPRE el
 *      lado del comprador (jx-contabilidad no lo pone mutuo a propósito: el
 *      par mutuo con dos filas pending_create se trababa en el gate de FK del
 *      push). Por eso se busca desde el costo hacia el ingreso, no al revés.
 *   2. Mismo número de documento + mismo importe + contraparte coherente.
 *      Recupera las 12 facturas de RUTH cuyo espejo existe pero quedó sin el
 *      flag `is_intercompany`.
 *
 * Lo que sobra son huérfanas: se informan, no se esconden.
 */
export function emparejarInternas(internas) {
  const lista = Array.isArray(internas) ? internas : [];
  const ingresos = lista.filter(m => m.type === 'income');
  // Un interno nunca debería ser 'expense' (clasificacion-contable.js lo
  // fuerza a 'cost'), pero si una fila vieja quedó así entra igual: dejarla
  // afuera la contaría de un solo lado, que es justo el error a corregir.
  const egresos  = lista.filter(m => m.type !== 'income');

  const pares = [];
  const usadoIngreso = new Set();
  const usadoEgreso = new Set();

  const porId = new Map(ingresos.map(m => [m.id, m]));

  // ── Pasada 1: vínculo explícito ──────────────────────────────────
  for (const eg of egresos) {
    const ing = eg.related_movement_id ? porId.get(eg.related_movement_id) : null;
    if (!ing || usadoIngreso.has(ing.id)) continue;
    usadoIngreso.add(ing.id);
    usadoEgreso.add(eg.id);
    pares.push({ ingreso: ing, egreso: eg, via: 'related_movement_id' });
  }

  // ── Pasada 2: mismo documento e importe ──────────────────────────
  const porClave = new Map();
  for (const eg of egresos) {
    if (usadoEgreso.has(eg.id)) continue;
    const k = claveDocumento(eg);
    if (!k) continue;
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k).push(eg);
  }
  for (const ing of ingresos) {
    if (usadoIngreso.has(ing.id)) continue;
    const k = claveDocumento(ing);
    if (!k) continue;
    const candidatos = porClave.get(k) || [];
    const eg = candidatos.find(e => !usadoEgreso.has(e.id) && e.company_id !== ing.company_id);
    if (!eg) continue;
    usadoIngreso.add(ing.id);
    usadoEgreso.add(eg.id);
    pares.push({ ingreso: ing, egreso: eg, via: 'documento' });
  }

  const huerfanas = [
    ...ingresos.filter(m => !usadoIngreso.has(m.id)),
    ...egresos.filter(m => !usadoEgreso.has(m.id)),
  ];

  return { pares, huerfanas };
}

/**
 * Aristas del grupo: quién le facturó a quién y por cuánto, a partir de los
 * pares eliminados. Es la materia prima de la matriz y de las cadenas.
 */
export function aristasDePares(pares) {
  const mapa = new Map();
  for (const p of pares || []) {
    const vendedor = p.ingreso?.company_id || null;
    const comprador = p.egreso?.company_id || null;
    if (!vendedor || !comprador) continue;
    const k = `${vendedor}→${comprador}`;
    if (!mapa.has(k)) mapa.set(k, { vendedor, comprador, monto: 0, nPares: 0 });
    const a = mapa.get(k);
    a.monto = r2(a.monto + num(p.ingreso.amount));
    a.nPares++;
  }
  return [...mapa.values()].sort((a, b) => b.monto - a.monto);
}

/**
 * Las cadenas de reventa dentro del grupo: A → B → consorcio ejecutor.
 * Es el caso de referencia del documento de la tanda 3 — el que no puede
 * contar el mismo material tres veces.
 *
 * Devuelve solo los caminos de 3 nodos o más (2 facturaciones internas
 * encadenadas); un A → B suelto no es una cadena, es una venta.
 */
export function cadenasInternas(aristas) {
  const arr = Array.isArray(aristas) ? aristas : [];
  const salientes = new Map();
  const compradores = new Set();
  for (const a of arr) {
    if (!salientes.has(a.vendedor)) salientes.set(a.vendedor, []);
    salientes.get(a.vendedor).push(a);
    compradores.add(a.comprador);
  }

  const cadenas = [];
  // Los orígenes son los que venden sin haber comprado dentro del grupo: ahí
  // es donde el material entró de verdad al perímetro.
  const origenes = [...salientes.keys()].filter(id => !compradores.has(id));

  const caminar = (nodo, camino, montos, visitados) => {
    const sigue = salientes.get(nodo) || [];
    if (sigue.length === 0) {
      if (camino.length >= 3) {
        cadenas.push({
          nodos: [...camino],
          tramos: montos.map((m, i) => ({ vendedor: camino[i], comprador: camino[i + 1], monto: m })),
          facturadoInterno: r2(montos.reduce((s, m) => s + m, 0)),
          ultimoTramo: r2(montos[montos.length - 1] || 0),
        });
      }
      return;
    }
    for (const a of sigue) {
      if (visitados.has(a.comprador)) continue;   // corta ciclos A→B→A
      visitados.add(a.comprador);
      caminar(a.comprador, [...camino, a.comprador], [...montos, a.monto], visitados);
      visitados.delete(a.comprador);
    }
  };

  for (const o of origenes) caminar(o, [o], [], new Set([o]));

  return cadenas.sort((a, b) => b.facturadoInterno - a.facturadoInterno);
}

/**
 * EL CONSOLIDADO. Una moneda por vez (mezclar soles con dólares da un número
 * que no es plata de nadie), sin anulados — mismo criterio que el resto del
 * bloque contable.
 *
 * @returns {{
 *   perimetro, moneda,
 *   libros:       {ingresos,costos,gastos,utilidad,margen,nMovs},
 *   eliminaciones:{ingresos,costos,total,nPares,descuadrados},
 *   consolidado:  {ingresos,costos,gastos,utilidad,margen},
 *   sinEspejo:    {ingresos,costos,neto,nMovs,movimientos:[]},
 *   conciliacion: {desdeLibros,margenParesDescuadrados,internasSinEspejo,haciaConsolidado},
 *   fueraDePerimetro: {ingresos,costos,gastos,nMovs,entidades:[]},
 *   aristas, cadenas, otrasMonedas, anulados,
 * }}
 */
export function consolidar({
  companies = [], consorcios = [], socios = [], movs = [],
  moneda = 'PEN', demo = false,
} = {}) {
  const perimetro = perimetroGrupo({ companies, consorcios, socios, movs });
  const nombreDe = (id) => perimetro.entidades.find(e => e.id === id)?.nombre
    || vivos(companies).find(c => c.id === id)?.name
    || '(sin nombre)';

  const libros = { ingresos: 0, costos: 0, gastos: 0, nMovs: 0 };
  const fuera  = { ingresos: 0, costos: 0, gastos: 0, nMovs: 0, ids: new Set() };
  const internas = [];
  // Marcadas "interna" con la contraparte identificada como TERCERO: no se
  // eliminan (cuentan como operación externa) y van a la pantalla con nombre y
  // documento, porque la casilla marcada dice otra cosa.
  const contraTercero = [];
  const otrasMonedas = new Map();
  let anulados = 0;

  for (const m of movs || []) {
    if (!m || m.deleted_at) continue;
    if (!!m.demo !== !!demo) continue;
    if (m.payment_status === 'cancelled') { anulados++; continue; }
    const cur = m.currency || 'PEN';
    if (cur !== moneda) { otrasMonedas.set(cur, (otrasMonedas.get(cur) || 0) + 1); continue; }

    const a = num(m.amount);
    const bucket = bucketDe(m);

    // Los libros de un tercero (una municipalidad cliente cargada en la app)
    // no son del grupo: no se consolidan. Se cuentan aparte para que nadie
    // vea "faltar" movimientos sin explicación.
    if (!perimetro.ids.has(m.company_id)) {
      fuera[bucket] += a; fuera.nMovs++;
      if (m.company_id) fuera.ids.add(m.company_id);
      continue;
    }

    libros[bucket] += a; libros.nMovs++;
    if (esInterna(m, perimetro)) { internas.push(m); continue; }
    if (m.is_intercompany === true) {
      const idFuera = contraparteFuera(m, perimetro);
      if (idFuera) contraTercero.push({ mov: m, idFuera });
    }
  }

  const { pares, huerfanas } = emparejarInternas(internas);

  const elim = { ingresos: 0, costos: 0 };
  for (const p of pares) {
    elim.ingresos += num(p.ingreso.amount);
    elim.costos   += num(p.egreso.amount);
  }

  // Las huérfanas se sacan igual del externo: una venta a una empresa del
  // grupo no es un ingreso del grupo, tenga espejo cargado o no. El número
  // del consolidado queda bien; lo que está incompleto es el libro del otro
  // lado, y eso se informa aparte.
  const huerf = { ingresos: 0, costos: 0, gastos: 0 };
  for (const m of huerfanas) huerf[bucketDe(m)] += num(m.amount);

  const consolidado = {
    ingresos: r2(libros.ingresos - elim.ingresos - huerf.ingresos),
    costos:   r2(libros.costos   - elim.costos   - huerf.costos),
    gastos:   r2(libros.gastos   - huerf.gastos),
  };
  consolidado.utilidad = r2(consolidado.ingresos - consolidado.costos - consolidado.gastos);
  consolidado.margen = consolidado.ingresos > 0
    ? Math.round((consolidado.utilidad / consolidado.ingresos) * 1000) / 10 : 0;

  const libAcum = {
    ingresos: r2(libros.ingresos), costos: r2(libros.costos), gastos: r2(libros.gastos),
    nMovs: libros.nMovs,
  };
  libAcum.utilidad = r2(libAcum.ingresos - libAcum.costos - libAcum.gastos);
  libAcum.margen = libAcum.ingresos > 0
    ? Math.round((libAcum.utilidad / libAcum.ingresos) * 1000) / 10 : 0;

  const aristas = aristasDePares(pares).map(a => ({
    ...a, vendedorNombre: nombreDe(a.vendedor), compradorNombre: nombreDe(a.comprador),
  }));

  const cadenas = cadenasInternas(aristas).map(c => ({
    ...c,
    nombres: c.nodos.map(nombreDe),
    tramos: c.tramos.map(t => ({
      ...t, vendedorNombre: nombreDe(t.vendedor), compradorNombre: nombreDe(t.comprador),
    })),
  }));

  // Un par bien cargado tiene el mismo importe de los dos lados. Si difiere,
  // el margen que sobra no se elimina contra nada y se va a la utilidad
  // consolidada sin ser plata que el grupo le ganó a nadie de afuera.
  const paresDescuadrados = pares
    .filter(p => r2(p.ingreso.amount) !== r2(p.egreso.amount))
    .map(p => ({
      documento: p.ingreso.document_number || p.egreso.document_number || '—',
      vendedor: nombreDe(p.ingreso.company_id),
      comprador: nombreDe(p.egreso.company_id),
      montoIngreso: r2(p.ingreso.amount),
      montoEgreso: r2(p.egreso.amount),
      diferencia: r2(num(p.ingreso.amount) - num(p.egreso.amount)),
    }))
    .sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia));

  const margenParesDescuadrados = r2(elim.ingresos - elim.costos);
  const internasSinEspejo = r2(huerf.ingresos - huerf.costos - huerf.gastos);

  // Las que quedaron afuera por decisión del catálogo, agrupadas por tercero.
  const ct = { ingresos: 0, costos: 0 };
  const ctPorEntidad = new Map();
  for (const { mov, idFuera } of contraTercero) {
    const monto = num(mov.amount);
    if (mov.type === 'income') ct.ingresos += monto; else ct.costos += monto;
    if (!ctPorEntidad.has(idFuera)) {
      ctPorEntidad.set(idFuera, { id: idFuera, nombre: nombreDe(idFuera), nMovs: 0, monto: 0 });
    }
    const e = ctPorEntidad.get(idFuera);
    e.nMovs++; e.monto = r2(e.monto + monto);
  }

  return {
    perimetro, moneda,
    libros: libAcum,
    eliminaciones: {
      ingresos: r2(elim.ingresos),
      costos: r2(elim.costos),
      total: r2(elim.ingresos + elim.costos),
      nPares: pares.length,
      porVinculo: pares.filter(p => p.via === 'related_movement_id').length,
      porDocumento: pares.filter(p => p.via === 'documento').length,
      descuadrados: paresDescuadrados,
    },
    consolidado,
    // De los libros al consolidado, paso a paso. La identidad
    //   libros.utilidad − margenParesDescuadrados − internasSinEspejo
    //   = consolidado.utilidad
    // es lo que hace auditable el número: si no cierra, el cálculo miente.
    conciliacion: {
      desdeLibros: libAcum.utilidad,
      margenParesDescuadrados,
      internasSinEspejo,
      haciaConsolidado: consolidado.utilidad,
    },
    // Operaciones internas cuyo espejo NO existe en ningún libro. El total del
    // grupo está bien igual (lo que no existe no hay que eliminarlo); lo que
    // falta es la carga del otro lado, y por eso van con nombre y documento.
    sinEspejo: {
      ingresos: r2(huerf.ingresos),
      costos: r2(huerf.costos + huerf.gastos),
      neto: internasSinEspejo,
      nMovs: huerfanas.length,
      movimientos: huerfanas
        .map(m => ({
          id: m.id,
          fecha: m.date || null,
          entidad: nombreDe(m.company_id),
          contraparte: m.third_party_name
            || (m.related_company_id ? nombreDe(m.related_company_id) : '—'),
          documento: m.document_number || '—',
          tipo: m.type === 'income' ? 'ingreso' : 'egreso',
          monto: r2(m.amount),
        }))
        .sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto)),
    },
    // Operaciones marcadas como internas cuya contraparte el catálogo llama
    // TERCERO. No se eliminan: cuentan como ingreso/costo externo del grupo.
    // Si alguna de esas entidades sí es del grupo, la corrección es marcarla
    // en Empresas — no tocar factura por factura.
    contraTerceros: {
      ingresos: r2(ct.ingresos),
      costos: r2(ct.costos),
      nMovs: contraTercero.length,
      entidades: [...ctPorEntidad.values()].sort((a, b) => b.monto - a.monto),
      movimientos: contraTercero
        .map(({ mov, idFuera }) => ({
          id: mov.id,
          fecha: mov.date || null,
          entidad: nombreDe(mov.company_id),
          contraparte: nombreDe(idFuera) || mov.third_party_name || '—',
          documento: mov.document_number || '—',
          tipo: mov.type === 'income' ? 'ingreso' : 'egreso',
          monto: r2(mov.amount),
        }))
        .sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto)),
    },
    fueraDePerimetro: {
      ingresos: r2(fuera.ingresos), costos: r2(fuera.costos), gastos: r2(fuera.gastos),
      nMovs: fuera.nMovs,
      entidades: [...fuera.ids].map(id => ({
        id, nombre: vivos(companies).find(c => c.id === id)?.name || '(sin nombre)',
      })).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    },
    aristas,
    cadenas,
    anulados,
    otrasMonedas: [...otrasMonedas.entries()]
      .map(([m2, n]) => ({ moneda: m2, movs: n }))
      .sort((x, y) => y.movs - x.movs),
  };
}
