// ═══════════════════════════════════════════════════════════════════
// JARVEX — Contenido del botón "?" de AYUDA (pedido de Gabriel, jul 2026).
//
// UN SOLO lugar con la explicación de cada sección: qué es, cómo se usa y
// notas por ROL. El botón vive en el Header (components/jx-ayuda.jsx) y
// resuelve por el id de página de la navegación (lib/nav-planos / sidebar).
//
// ⚠ REGLA DE MANTENIMIENTO: cada vez que se agregue una sección o cambie el
// comportamiento de una existente (nuevos botones, reglas, flujos), ACTUALIZÁ
// su entrada acá en el mismo commit. Esta ayuda es el onboarding de los
// usuarios nuevos — si miente, confunde más de lo que ayuda.
// ═══════════════════════════════════════════════════════════════════

// Notas generales por rol (se muestran en TODAS las secciones, arriba de la
// nota específica si la hay).
const ROL_GENERAL = {
  ingeniero_residente: 'Tu vista es netamente TÉCNICA: partidas, avance, cronograma, incidencias, personal obrero y subcontratos. Almacén, dinero y los módulos de especialistas no aparecen en tu menú — el avance de los especialistas lo ves resumido en tu Panel.',
  almacenero: 'Tu día a día vive en el grupo "Control de Almacén". Registrá cada entrada/salida el mismo día que ocurre — el candado cronológico rechaza salidas con fecha en la que no había stock.',
  ayudante_contador: 'Podés registrar y subir documentos contables. Lo ya registrado (bancarizaciones, estados de pago) no se cambia solo: usá el botón "Solicitar" y el admin o la Contadora Jefe lo aplican.',
  contador: 'Como Contadora Jefe ves y editás todo lo contable de todas las empresas y obras, incluida la bandeja "Sin clasificar" y las solicitudes de cambio de las asistentes.',
  prevencionista: 'Tu foco: SSOMA (charlas, IPERC, inducciones, inspecciones, SCTR en consulta) y tu reporte diario. Los EPP los ves en CONSULTA para cuadrar con la almacenera (ella registra entradas/salidas y entregas). En Personal creás obreros (directos o de subcontrato) y podés SOLICITAR subcontratos nuevos.',
  ing_ambiental: 'Tu foco: Gestión Ambiental y tu reporte diario de especialidad con evidencias.',
  ing_calidad: 'Tu foco: Gestión de Calidad (certificados vs expediente) y tu reporte diario de especialidad.',
  ing_social: 'Tu foco: Gestión Social (compromisos, quejas, padrón) y tu reporte diario de especialidad.',
};

// dueño: rol(es) que más usan la sección — se resalta en la ventana.
const AYUDA = {
  // ── GENERAL ──────────────────────────────────────────────────────
  'inicio': {
    titulo: 'Inicio',
    que: 'El punto de partida: elegís tu obra de trabajo y entrás a las secciones desde los bloques. Solo ves los bloques que tu rol puede usar.',
    como: [
      'Elegí la obra en "Obra de trabajo" — los bloques "de obra" trabajan sobre ella.',
      'Los bloques de "General" (Reportes, Captura Mágica, Empresas…) cruzan todas las obras.',
      'Si te falta un bloque que necesitás, pedile acceso al administrador.',
    ],
  },
  'captura-magica': {
    titulo: 'Captura Mágica',
    que: 'Subís fotos o PDFs de comprobantes (facturas, guías) y la IA extrae los datos para registrarlos como movimientos contables sin tipear.',
    como: [
      'Arrastrá o seleccioná los archivos; revisá lo que la IA leyó antes de confirmar.',
      'El DESTINO es obligatorio: una obra específica, Gastos Generales, Contabilidad Neta u "No sé" (la Contadora Jefe lo clasifica después).',
      'Facturas en soles > S/ 2,000 entran como "Pendiente" y pasan a "Pagado" solas cuando se sube su bancarización completa.',
      'DETRACCIÓN (SPOT): si la factura la tiene, la IA la detecta y te propone el %, el monto y el código — corregilo si hace falta antes de confirmar (el neto a pagar al proveedor se calcula solo). El depósito lo registrás después en Movimientos Contables.',
      'RECIBOS POR HONORARIOS: la IA los reconoce (emisor persona natural) y te deja elegir/confirmar el TRABAJADOR; al confirmar se crea el pago del trabajador con el recibo ya adjunto, listo para que subas el voucher en Pagos. No crea proveedor ni movimiento de compra.',
      'RxH · RETENCIÓN Y MONTO EDITABLE: el pago al trabajador es el NETO (honorarios − retención de renta). En la revisión tenés los campos Honorarios (bruto), Retención y Neto a pagar — todos EDITABLES: si el OCR leyó mal el monto, corregilo ahí antes de confirmar (el neto se recalcula solo al cambiar bruto o retención). El recibo NO lleva IGV.',
      'RECIBO DE UN TRABAJADOR NO REGISTRADO: si no aparece en la lista, tocá "➕ Crear trabajador nuevo" — pide solo lo básico (nombres, apellidos, DNI, cargo, y teléfono/correo opcionales), pre-llenado desde el recibo (el DNI sale del RUC). El CARGO es obligatorio; el resto se puede completar después. Al confirmar, en un paso se crea el trabajador Y su pago. Si subís varios recibos de la misma persona, se crea UNA sola vez (dedup por DNI).',
      'NOTAS DE CRÉDITO/DÉBITO: la IA las reconoce y detecta qué factura modifican. La nota de CRÉDITO se registra RESTANDO (baja el costo del proveedor o las ventas) y queda vinculada a la factura original; la de DÉBITO suma. No piden bancarización ni recepción de almacén.',
      'OPERACIONES ENTRE EMPRESAS DEL GRUPO (INTERCO): si el emisor Y el receptor son empresas nuestras, al confirmar la VENTA JARVEX crea SOLA la COMPRA espejo en la empresa compradora (marcada 🔁 AUTO en Contabilidad) — así la operación interna nunca queda a medias. Si esa compra ya existe (subida a mano), NO la duplica. Y si más tarde subís el comprobante real de esa compra, la app te avisa que la contraparte era automática y te deja REEMPLAZARLA por el tuyo.',
      '"Genera ingreso al almacén": se marca solo cuando corresponde — en compras de bienes viene activado (aparece en Compras Pendientes del almacenero); en recibos por honorarios, notas de crédito/débito y ventas ni siquiera se muestra (no tienen nada que ver con el almacén).',
      'Si la fecha de la factura es anterior al inicio de la obra elegida, la app te lo advierte (no bloquea).',
    ],
    rol: { ayudante_contador: 'Evitá el doble registro: si el comprobante ya existe (misma serie y RUC), la app lo detecta y no lo duplica.' },
  },
  'proveedores': { titulo: 'Proveedores', que: 'Directorio de proveedores del grupo: RUC, contacto y su historial de compras.', como: ['Creá el proveedor una sola vez y reutilizalo en compras y captura mágica.', 'El RUC correcto es clave: con él se cruzan facturas, guías y trazabilidad.'] },
  'dashboard': { titulo: 'Dashboard', que: 'Visión general de la operación: indicadores de obras, stock y contabilidad en un vistazo.', como: ['Usalo como resumen diario; cada tarjeta te lleva a su sección para el detalle.'] },
  'obras': { titulo: 'Obras / Proyectos', que: 'Catálogo de obras del grupo: datos generales, fecha de inicio, estado y avance.', como: ['La FECHA DE INICIO importa: la app la usa para advertir facturas anteriores al arranque de la obra.', 'Cerrá las obras terminadas para sacarlas de los selectores.'] },
  'reportes': {
    titulo: 'Reportes',
    que: 'Reportes ejecutivos de la operación y la configuración del ENVÍO POR EMAIL (diario, semanal y mensual).',
    como: [
      'En "Envío por email" hay 3 pestañas: Diario, Semanal y Mensual — cada una con su interruptor, su hora (Perú), su día y sus DESTINATARIOS propios (los correos que quieras).',
      'El correo llega con resumen ejecutivo, tops de materiales con barras, ranking de ingenieros, especialidades y contabilidad, legible desde el teléfono.',
      'El reporte mensual es el más detallado: incluye top proveedores y avance físico por obra.',
      'El envío es automático (cada hora se revisa qué toca y se despacha por Gmail) — si un reporte no llega, revisá que la pestaña esté ACTIVA y con destinatarios.',
    ],
  },
  'busqueda': { titulo: 'Búsqueda Global', que: 'Buscador que cruza todos los módulos: materiales, movimientos, facturas, personal, etc.', como: ['Escribí cualquier dato (nombre, serie de factura, DNI) y saltá directo al registro.'] },

  // ── ALMACÉN ──────────────────────────────────────────────────────
  'materiales': {
    titulo: 'Materiales',
    que: 'Catálogo e inventario de materiales de la obra: stock actual, stock mínimo y alertas de reposición.',
    como: [
      'El stock NO se edita a mano: se mueve registrando entradas/salidas en "Mov. de Materiales".',
      'Definí stock mínimo para que la app te avise cuándo reponer (alerta "reponer"/"crítico").',
      '"Recalcular stocks" reconcilia el stock guardado con el historial de movimientos si algo no cuadra (ahora también disponible para el almacén, no solo admin). No toca los movimientos, solo el número de stock.',
      'DESAJUSTE POR SINCRONIZACIÓN: si registraste una entrada pero al sacar te dice "sin stock", suele ser que el número guardado no reflejó ese movimiento todavía. La app ahora se apoya en los MOVIMIENTOS (no solo en el número guardado) para no bloquearte una salida legítima, y te avisa del desajuste — tocá "Recalcular stocks" para corregir el número.',
    ],
    rol: { almacenero: 'Si ves stock que no cuadra: primero "Recalcular stocks" (reconcilia con los movimientos). Si aun así no coincide con lo FÍSICO, avisá — puede faltar registrar un movimiento o ser un tema de inventario real.' },
  },
  'mov-materiales': {
    titulo: 'Movimientos de Materiales',
    que: 'El registro de TODAS las entradas, salidas, devoluciones y mermas de materiales — es lo que mueve el stock.',
    como: [
      'Registrá el movimiento con la FECHA REAL en que ocurrió.',
      'BÚSQUEDA POR PALABRAS: el buscador exige TODAS las palabras que escribís, en cualquier orden — "Tubo 1/2" encuentra "TUBO PVC SAP 1/2\\"" aunque no estén juntas. Sirve para acotar rápido (nombre del insumo, documento, responsable, frente o almacén).',
      'HISTORIAL DE UN INSUMO: desde Almacén (Materiales), el botón 📜 de cada material te trae acá con la búsqueda ya cargada con su nombre — ves de una todas sus entradas y salidas.',
      'La app rechaza salidas con fecha en la que no había stock suficiente (candado cronológico) — suele significar que falta registrar una entrada previa.',
      'ANTI-DUPLICADOS: si registrás un movimiento idéntico a uno de las últimas horas, la app te avisa antes de guardar — si solo estabas verificando, cancelá: el anterior ya quedó guardado.',
      'COMPROBANTE DE UN INGRESO: en la última columna, un ingreso sin factura muestra 🔎 (buscar comprobante), 📎 (adjuntar foto) y 📩 (avisar a contabilidad). Con 🔎 la app busca las facturas que cuadran por insumo, fecha y cantidad — elegís la correcta y queda vinculada (verás la referencia sin montos). "✓ Factura" = ya vinculado.',
      'CONSULTAS CON CONTABILIDAD (💬 arriba): si no encontrás el comprobante, "Preguntar a contabilidad" abre un hilo con la referencia exacta del ingreso (sin montos); contabilidad responde Sí / Parcial / No / Otra fecha. El número en el botón son las consultas que te toca responder a vos.',
      'Si un registro queda "con error de sincronización", abrí el detalle y tocá "Reintentar todos".',
    ],
  },
  'herramientas': { titulo: 'Herramientas', que: 'Inventario de herramientas por almacén y por condición (nuevo/bueno/regular/reparación/baja).', como: ['El stock por almacén manda: la salida valida contra el almacén de origen elegido.', 'La condición se registra al sacar y al devolver cada herramienta.'] },
  'mov-herramientas': { titulo: 'Movimientos de Herramientas', que: 'Entradas, salidas y devoluciones de herramientas, con responsable y condición.', como: ['Elegí el almacén de origen correcto — la columna STOCK muestra lo disponible en ese almacén.', 'Al devolver, registrá la condición real (sirve para el historial de estado).'] },
  'caja-chica': { titulo: 'Caja Chica', que: 'Control de gastos menores de la obra: aperturas, gastos y rendiciones.', como: ['Registrá cada gasto con su comprobante; rendí la caja al cerrarla.'] },
  'ubicaciones': { titulo: 'Ubicaciones de Obra', que: 'Los almacenes y puntos de acopio de la obra donde vive el stock.', como: ['Creá las ubicaciones antes de mover stock — cada movimiento indica de/hacia qué almacén va.'] },
  'compras-pendientes': { titulo: 'Vinculación de Compras', que: 'Une las compras registradas por contabilidad con los ingresos físicos al almacén.', como: ['Revisá las compras pendientes y vinculalas con su entrada de materiales.', 'Así el costo contable y el stock físico cuentan la misma historia.'] },
  'evidencias': {
    titulo: 'Evidencias',
    que: 'La galería de archivos de la obra: fotos de movimientos, firmas de EPP, formatos, actas y documentos.',
    como: [
      'Cada rol ve SOLO lo pertinente a su función; lo contable (facturas, guías, bancarizaciones, detracciones) es exclusivo de contabilidad y admin.',
      'Lo que subís vos siempre lo ves, aunque sea de otro ámbito.',
      'Ordená la galería con las pestañas de categoría y el selector "Tipo" (muestra cada tipo con su cantidad — útil cuando hay decenas de firmas EPP).',
      'Subí archivos con "Subir Archivo" eligiendo el tipo correcto — de eso depende quién puede verlo.',
    ],
    rol: {
      almacenero: 'Ves lo de almacén, EPP y asistencia. Las guías de remisión y facturas son de contabilidad — no aparecen acá.',
      contador: 'Ves también todo lo contable: facturas, comprobantes, bancarizaciones, guías, recibos, pagos y constancias de detracción.',
      ayudante_contador: 'Ves también todo lo contable: facturas, comprobantes, bancarizaciones, guías, recibos, pagos y constancias de detracción.',
    },
  },
  'plantillas': { titulo: 'Plantillas', que: 'Formatos descargables de la obra (actas, formatos de registro) listos para imprimir o firmar.', como: ['Descargá la plantilla, completala/firmala y subila como evidencia del tipo que corresponda.'] },

  // ── COMPRAS / LOGÍSTICA ──────────────────────────────────────────
  'solicitud-residente': { titulo: 'Solicitud de Insumos', que: 'El pedido técnico de materiales del frente/residente hacia logística.', como: ['Pedí lo que la obra necesita con cantidades y fecha requerida.', 'Logística lo convierte en requisición u orden de compra — acá no se maneja dinero.'] },
  'requisiciones': { titulo: 'Requisiciones', que: 'Consolidación de solicitudes en pedidos formales de compra.', como: ['Agrupá solicitudes, definí cantidades finales y pasalas a cotización u orden de compra.'] },
  'ordenes-compra': { titulo: 'Órdenes de Compra', que: 'Las OC emitidas a proveedores, con sus ítems, montos y recepciones.', como: ['Emití la OC al proveedor elegido y registrá las recepciones contra ella.', 'La OC firmada se puede subir como evidencia (tipo "OC Firmada").'] },

  // ── MAQUINARIA ───────────────────────────────────────────────────
  'activos-pesados': { titulo: 'Equipos Pesados', que: 'Registro de maquinaria: horómetros, combustible y movimientos de equipos.', como: ['Registrá horas máquina y consumos por equipo — alimentan los costos de la obra.'] },
  'mantenimiento-programado': { titulo: 'Mantenimiento Programado', que: 'Plan de mantenimientos de la maquinaria con alertas por horómetro o fecha.', como: ['Programá el mantenimiento y registrá cuando se ejecute; la app avisa los vencidos.'] },

  // ── DIRECCIÓN ────────────────────────────────────────────────────
  'dashboard-ejecutivo': { titulo: 'Dashboard Ejecutivo', que: 'Vista de dirección: todas las obras en una pantalla (avance, costos, alertas).', como: ['Usalo para la foto semanal del grupo; cada obra linkea a su detalle.'] },
  'kpis-obra': { titulo: 'KPIs por Obra', que: 'Indicadores comparables entre obras: avance físico, consumo, cumplimiento.', como: ['Compará obras entre sí para detectar desvíos temprano.'] },
  'cumplimiento-cronograma': { titulo: 'Cumplimiento de Cronograma', que: 'Qué tan al día va cada obra contra su cronograma planificado.', como: ['Revisá los frentes atrasados y bajá al detalle de partidas.'] },
  'alertas': { titulo: 'Centro de Alertas', que: 'Todas las alertas del sistema en un solo lugar: stock crítico, vencimientos, incidencias.', como: ['Entrá a cada alerta para resolverla en su módulo de origen.'] },

  // ── FRENTE / TÉCNICO ─────────────────────────────────────────────
  'dashboard-tecnico': { titulo: 'Dashboard Técnico', que: 'Resumen del frente del ingeniero: sus partidas, avance y pendientes.', como: ['Es tu página de arranque: de acá saltás a reportar avance o pedir insumos.'] },
  'mis-partidas': { titulo: 'Partidas del Proyecto', que: 'Las partidas asignadas a tu frente con su avance y metrado.', como: ['Revisá el % de avance de cada partida — se actualiza con tus reportes diarios.'] },
  'cronograma-frente': { titulo: 'Cronograma de mis Partidas', que: 'Fechas planificadas de tus partidas.', como: ['Compará lo planificado contra tu avance real para anticipar atrasos.'] },
  'salidas-frente': {
    titulo: 'Vinculación de Insumos',
    que: 'Vincula las salidas de almacén con las partidas donde realmente se usaron — así el control de consumo por partida es real.',
    como: [
      'La 💡 te SUGIERE la partida que presupuesta cada material: confirmala con un clic, o elegí otra con el buscador.',
      'EN LOTE: marcá varias salidas con su casilla ☑ y vinculalas todas a una partida de un solo golpe; repetí por grupo ("estas 3 a esta partida, estas 2 a esta otra").',
      '"✨ Aplicar sugerencias" vincula automáticamente todas las pendientes que tengan sugerencia.',
      'Si te equivocaste, en "Registro de vinculaciones" pedís el cambio y lo aprueba el admin.',
    ],
  },
  'reporte-diario': { titulo: 'Reporte Diario', que: 'Tu reporte de avance del día: partidas trabajadas, metrados y fotos.', como: ['Reportá el mismo día con fotos; si es atrasado, requiere motivo y aprobación del admin.', 'Al llegar al 100% la partida se marca terminada sola.'] },
  'mis-reportes': { titulo: 'Mis Reportes', que: 'El historial de tus reportes diarios enviados.', como: ['Revisá el estado de cada reporte (aprobado/observado) y sus fotos.'] },
  'borradores-reporte': { titulo: 'Borradores', que: 'Reportes a medio llenar que guardaste para completar después.', como: ['Retomá el borrador y envialo — no cuenta como reporte hasta enviarlo.'] },
  'plan-real': { titulo: 'Plan vs Real', que: 'Comparación de tu avance real contra lo planificado.', como: ['Identificá las partidas con desvío y explicalo en tu reporte.'] },
  'emitir-alerta': { titulo: 'Emitir Alerta', que: 'Canal para reportar problemas del frente que necesitan atención (falta de material, interferencias).', como: ['Emití la alerta con detalle y foto; llega al Centro de Alertas de dirección.'] },
  'vinculacion-salidas': { titulo: 'Vinculación de Salidas', que: 'Asocia salidas de almacén con partidas ejecutadas.', como: ['Mantené las salidas vinculadas para que el costo por partida sea confiable.'] },

  // ── GESTIÓN DE OBRA ──────────────────────────────────────────────
  'dashboard-gestion': { titulo: 'Dashboard de Gestión', que: 'El tablero de la obra: avance físico, costos, incidencias y stock crítico.', como: ['Es la home del residente/supervisión: cada tarjeta baja al módulo respectivo.'] },
  'panel-residente': {
    titulo: 'Panel del Residente',
    que: 'La vista de control del residente: quién reportó hoy (ingenieros de frente y especialistas), el avance de los especialistas en los últimos 7 días y accesos a su gestión.',
    como: [
      'La tabla muestra por responsable si presentó su reporte de HOY.',
      'La columna "Últimos 7 días" resume cuántos días reportó cada especialista (SSOMA, Ambiental, Calidad, Social) y su último reporte — seguimiento de solo lectura, sin entrar a sus módulos.',
    ],
  },
  'importar': { titulo: 'Importar Presupuesto', que: 'Carga del presupuesto de obra (partidas + insumos) desde Excel.', como: ['Importá la estructura una vez; después trabajá versiones en vez de re-importar.'] },
  'partidas': { titulo: 'Partidas', que: 'La estructura del presupuesto de obra: partidas, metrados y precios.', como: ['Asigná partidas a frentes para que los ingenieros reporten sobre ellas.'] },
  'control-consumo': { titulo: 'Control de Consumo', que: 'Consumo real de insumos contra lo presupuestado por partida.', como: ['Los desvíos fuertes ameritan revisar salidas mal vinculadas o mermas.'] },
  'insumos': { titulo: 'Insumos por Partida', que: 'El detalle de insumos que compone cada partida del presupuesto.', como: ['Es la base del control de consumo: mantenelo fiel al expediente.'] },
  'versiones': { titulo: 'Versiones de Presupuesto', que: 'Historial de versiones del presupuesto (original, modificados).', como: ['Creá una versión nueva ante un adicional o deductivo — no pises la original.'] },
  'cronograma': { titulo: 'Cronograma / Gantt', que: 'La programación de la obra en Gantt.', como: ['Mantené fechas reales: alimentan el cumplimiento y los dashboards.'] },
  'avance': { titulo: 'Avance de Obra', que: 'El avance físico consolidado por partida y por frente, con evidencias.', como: ['Se alimenta de los reportes diarios aprobados de los ingenieros.'] },
  'aprobaciones-reporte': { titulo: 'Aprobación de Frentes', que: 'Cola de reportes diarios pendientes de aprobación.', como: ['Aprobá u observá con comentario; lo observado vuelve al ingeniero.'] },
  'rendimiento-ingenieros': { titulo: 'Rendimiento de Ingenieros', que: 'Ranking de reportes y avance por ingeniero.', como: ['Úsalo como termómetro de reportería, no como única vara de desempeño.'] },
  'comparativo': { titulo: 'Planificado vs Real', que: 'Curvas de avance planificado contra real de la obra.', como: ['El cruce de curvas te dice si la obra se adelanta o atrasa.'] },
  'costos': { titulo: 'Costos', que: 'Costos reales de la obra por categoría y partida.', como: ['Cruzalo con Control de Consumo para explicar los desvíos.'] },
  'valorizaciones': { titulo: 'Valorizaciones', que: 'Las valorizaciones mensuales de la obra (avance económico a cobrar).', como: ['Generá la valorización del periodo desde el avance aprobado.'] },
  'subcontratistas': { titulo: 'Subcontratistas', que: 'Directorio de subcontratistas de la obra.', como: ['Registralos acá para poder asignarles personal y subcontratos.'] },
  'subcontratos': { titulo: 'Subcontratos', que: 'Los contratos con subcontratistas: alcance, monto y avance.', como: ['El personal de un subcontratista aparece en Personal bajo la categoría "Subcontratos".'] },
  'subcontrato-valorizaciones': { titulo: 'Valorizaciones de Subcontrato', que: 'Avance económico a pagar a cada subcontratista.', como: ['Valorizá contra el avance real verificado del subcontrato.'] },
  'incidencias': { titulo: 'Incidencias', que: 'Registro de problemas de la obra: seguridad, calidad, stock, equipos.', como: ['La app también crea incidencias automáticas (p. ej. conflictos de stock al sincronizar) — revisalas y cerralas con su solución.'] },
  'movimientos-insumos': { titulo: 'Movimientos de Insumos', que: 'Vista consolidada de los movimientos de insumos de la obra.', como: ['Filtrá por insumo o fecha para auditar el flujo completo.'] },

  // ── CONTABILIDAD (obra y general) ────────────────────────────────
  'movimientos-contables': {
    titulo: 'Movimientos Contables',
    que: 'Todas las compras y ventas del grupo: facturas, estados de pago y bancarizaciones.',
    como: [
      'Filtrá por OBRA y por EMPRESA con dos desplegables SEPARADOS que se combinan (ej. obra Miraflores + empresa GASOMI a la vez), más compra/venta, estado, EMISOR y RECEPTOR, o buscá por texto.',
      'FACTURAS INTERCO: también se les puede pedir "Solicitar cambio" (p. ej. corregir la OBRA a la que se vinculó). Al aprobarse, el cambio de vinculación se aplica a la factura Y a su compra espejo automática, para que ambos lados queden consistentes.',
      '🏷 INSUMOS PARA VENTA (botón arriba): los ítems facturados que NUNCA ingresaron a obra se pueden separar para venderlos. Flujo con doble control: 1) "💬 Comprobar" le pregunta a almacén si el insumo va a ingresar; 2) con la respuesta "No", la Contadora Jefe o un Admin lo SEPARA (queda en el pool "Disponibles para venta" con su costo de compra como referencia); 3) al emitir la factura de venta, se vincula desde el pool → trazabilidad compra→venta. "↩" devuelve un ítem separado por error.',
      'FILTRO POR PERÍODO (📅): elegí un MES puntual (ej. "Junio 2026" — solo aparecen los meses que tienen comprobantes) o "Personalizado…" para un rango de fechas a medida. Al filtrar, arriba sale el RESUMEN del período: cuántos comprobantes y el total de Ventas y Compras (anulados excluidos; las notas de crédito restan). "✕ Quitar filtro" vuelve a todo el período.',
      'Facturas en soles > S/ 2,000 exigen bancarización: subila con el botón "Subir" de la fila (👁 "Ver" abre la constancia).',
      'Tres formas de bancarizar: Pago exacto (1 voucher = la factura), Pago en partes (varios vouchers a 1 factura) y Voucher multi-factura (1 depósito cubre varias facturas del mismo pagador→cobrador, con control de saldo).',
      'Cuando la cobertura llega al 100%, la factura pasa sola a "Pagado".',
      'DETRACCIÓN (SPOT): las facturas con detracción muestran su desglose (detracción y neto a pagar). Registrá el depósito con "Registrar depósito" subiendo la constancia del Banco de la Nación — queda "depositada". Si la IA no la detectó, con "＋ Detracción" la registrás a mano (sirve para compras y ventas).',
      'RECEPCIÓN EN ALMACÉN: cada factura de compra muestra un semáforo de si sus insumos llegaron — ✅ Recibido, 🟡 Parcial, ⏳ Sin confirmar, ❌ No recibido, o 🏢 Consumo empresa/general. Con el botón "🔎 ¿llegó?" (en las que faltan confirmar) la app te muestra los ingresos de almacén que cuadran por insumo/fecha/cantidad y los vinculás en 1 clic ("Sí, este"). La almacenera hace lo mismo desde su lado. Así sabés cuáles fueron a la obra y cuáles son consumo de empresa u otra obra.',
      'CONSULTAS CON ALMACÉN (💬 arriba): desde "🔎 ¿llegó?" podés "Preguntar a almacén" por una línea puntual (queda un hilo con la referencia exacta, sin montos); la almacenera responde Sí / Parcial / No / Otra fecha. El número en el botón son las consultas que te toca responder.',
      'REPORTE DE RECEPCIÓN (📊 arriba): resume, por insumo y por factura, cuánto de lo FACTURADO llegó a la obra, cuánto FALTA y cuánto es consumo de EMPRESA o gasto general (no fue a obra). Respeta el filtro de ámbito (obra/empresa) de arriba. Se alimenta de las vinculaciones que hacen los 🔎 ¿llegó? / buscar comprobante.',
      'El botón "Duplicados" detecta y fusiona comprobantes registrados dos veces.',
    ],
    rol: {
      ayudante_contador: 'Una vez subida una bancarización queda fija: para cambiarla (constancia, tipo o montos) usá "Solicitar cambio" y lo aplica el admin o la Contadora Jefe. Antes de cada subida verás una ventana de confirmación — revisá monto y archivo ahí. La DETRACCIÓN sí la registrás vos: en la fila subís la constancia del depósito (Banco de la Nación) y queda "depositada".',
      contador: 'Con "Cambiar" podés reemplazar la constancia y con la ✕ de cada pago registrado eliminarlo (libera saldo de voucher) para rehacer la bancarización con el tipo correcto. La bandeja "Sin clasificar" te muestra las facturas que las asistentes marcaron como "No sé".',
      admin: 'Igual que la Contadora Jefe: "Cambiar", ✕ en pagos registrados, bandeja "Sin clasificar" y edición de la vinculación (obra / Gastos Generales / Contabilidad Neta) desde Editar Movimiento.',
    },
  },
  'conciliacion-insumos': { titulo: 'Conciliación de Insumos', que: 'Cruce entre lo comprado (facturas) y lo ingresado al almacén.', como: ['Las diferencias señalan compras sin ingreso o ingresos sin factura.'] },
  'pagos': {
    titulo: 'Pagos',
    que: 'Los pagos al PERSONAL y a subcontratos: sueldos de planilla, recibos por honorarios y sus transferencias parciales, con historial por cada persona.',
    como: [
      'Definí la FORMA DE PAGO de cada trabajador (planilla / RxH / otro) y tocá 💸 Pagar para crear el compromiso del período.',
      'PESTAÑA 📄 RECIBOS: todos los pagos en una sola lista estilo facturas, filtrable por EMPRESA pagadora, MES, forma de pago y búsqueda por palabras (trabajador, concepto, serie). Arriba ves el total acordado y pagado del filtro — ideal para ver, por ejemplo, "los recibos de Junio de CONSORCIO EL INCA".',
      'EMPRESA PAGADORA: los recibos nuevos de Captura Mágica ya la traen sola (el receptor del recibo). Los pagos VIEJOS nacieron sin empresa — el botón "⚠ N sin empresa — clasificar" te los muestra y les asignás la suya con el selector de la fila (una sola vez).',
      'Dentro del pago todo va separadito: 1️⃣ el DOCUMENTO del pago (recibo por honorarios o boleta/planilla firmada) y 2️⃣ cada TRANSFERENCIA con su constancia adjunta.',
      'Solo aparece personal ACTIVO y que no sea de subcontratos: a la gente de un subcontrato le paga su subcontratista — el pago va al SUBCONTRATO en su pestaña (los subcontratistas sin contrato formal también aparecen ahí).',
      'El historial por persona (con Σ total pagado) queda como base de datos de todo lo pagado; el personal inactivado conserva su historial en la sección de abajo.',
      'Los recibos por honorarios subidos por Captura Mágica ya crean acá el pago del trabajador con su recibo adjunto — solo te falta agregar la(s) transferencia(s)/voucher(s) hasta cubrir el total.',
      'Si una persona tiene muchos pagos, se muestran los primeros 3 y un botón "▾ +N más" que despliega TODOS (y "▲ ver menos" los colapsa).',
      'EVITÁ DUPLICAR: un recibo por honorarios subido por Captura Mágica YA crea el pago acá — para pagarlo, abrí ese pago desde su chip y agregá la transferencia. Si tocás "💸 Pagar" y la persona ya tiene pagos sin completar, la app te avisa (no crees uno nuevo para el mismo recibo).',
    ],
    rol: { ayudante_contador: 'Podés registrar pagos y subir recibos por honorarios y constancias. Los recibos y constancias son material contable: solo contabilidad y admin los ven en Evidencias.' },
  },
  'cont-dashboard': { titulo: 'Dashboard Contable', que: 'Resumen financiero del grupo: ingresos, egresos y pendientes por empresa.', como: [
    'Es la portada de contabilidad; cada indicador baja a su libro o listado.',
    'INGRESOS SIN SUSTENTO: cuando almacén registra un material sin factura, aparece acá para vincularlo. Al tocar "Vincular factura", arriba salen las 🎯 SUGERENCIAS: las facturas que CUADRAN con ese ingreso (mismo insumo, fecha cercana, cantidad parecida) con su % de coincidencia, el ítem exacto de la factura y el porqué — elegí la correcta con un click y el ítem queda marcado como recibido. Abajo está el resto de facturas del proveedor (con sus ítems visibles) para elegir a mano si ninguna sugerencia aplica.',
  ] },
  'empresas': { titulo: 'Empresas', que: 'Las entidades legales del grupo (ejecutoras y proveedoras internas).', como: ['El RUC y la clase de cada empresa alimentan el cruce INTERCO y los filtros de emisor/receptor.'] },
  'guias-remision': { titulo: 'Guías de Remisión', que: 'Las guías de remisión electrónicas vinculadas a las facturas y al traslado de materiales.', como: ['Se cargan principalmente por Captura Mágica y quedan vinculadas a su factura.', 'Su PDF es material contable: solo contabilidad y admin lo ven en Evidencias.'] },
  'intercompany': { titulo: 'Operaciones entre Empresas', que: 'Las operaciones INTERCO: ventas/compras entre empresas del propio grupo.', como: ['Editá los movimientos INTERCO desde acá (en Movimientos aparecen bloqueados).'] },
  'trazabilidad': { titulo: 'Trazabilidad de Cadenas', que: 'Sigue la cadena de un insumo o dinero a través de las empresas del grupo.', como: ['Útil para sustentar el recorrido proveedor → interco → obra.'] },
  'compras-categoria': { titulo: 'Compras por Categoría', que: 'Las compras agrupadas por categoría de gasto.', como: ['Sirve para ver en qué se va la plata por rubro y por periodo.'] },
  'ordenes-intercompany': { titulo: 'Órdenes Intercompany', que: 'Órdenes de venta/compra entre empresas del grupo.', como: ['Generalas para respaldar el flujo INTERCO antes de facturar.'] },
  'consolidado': { titulo: 'Consolidado', que: 'Los números del grupo consolidados (eliminando el efecto INTERCO).', como: ['Es la vista "de verdad" del grupo: sin dobles conteos entre empresas.'] },
  'cuentas-bancarias': { titulo: 'Cuentas Bancarias', que: 'Las cuentas del grupo y sus movimientos bancarios.', como: ['Mantené los saldos al día para que el flujo de caja sea confiable.'] },
  'flujo-caja': { titulo: 'Flujo de Caja / Pagos', que: 'Entradas y salidas de dinero por empresa, con cronograma de pagos.', como: ['Programá los pagos por vencer y marcalos al ejecutarlos.'] },
  'flujo-proyectado': { titulo: 'Flujo de Caja Proyectado', que: 'La proyección de caja de las próximas semanas por empresa.', como: ['Se alimenta del cronograma de pagos y las cobranzas esperadas.'] },
  'plan-cuentas': { titulo: 'Plan de Cuentas (PCGE)', que: 'El plan contable general empresarial usado para clasificar asientos.', como: ['La IA sugiere la cuenta PCGE al categorizar; corregila si no aplica.'] },
  'libro-diario': { titulo: 'Libro Diario / Asientos', que: 'Los asientos contables generados por los movimientos.', como: ['Revisá que cada movimiento relevante tenga su asiento bien clasificado.'] },
  'balance-general': { titulo: 'Balance General', que: 'La foto de activos, pasivos y patrimonio por empresa.', como: ['Elegí empresa y periodo; los números salen de los asientos registrados.'] },
  'estado-resultados': { titulo: 'Estado de Resultados', que: 'Ingresos, costos y gastos del periodo por empresa.', como: ['Compará contra el periodo anterior con "Comparativo Periodos".'] },
  'comprobantes': { titulo: 'Comprobantes Electrónicos SUNAT', que: 'Los comprobantes electrónicos emitidos/recibidos consultados contra SUNAT.', como: ['Validá el estado del comprobante (aceptado/anulado) antes de contabilizarlo.'] },
  'libros-electronicos': { titulo: 'Libros Electrónicos PLE / PDT', que: 'Generación de los libros electrónicos para SUNAT.', como: ['Generá el PLE del periodo cerrado y presentalo según cronograma SUNAT.'] },
  'config-sunat': { titulo: 'Configuración SUNAT', que: 'Credenciales y parámetros de conexión con SUNAT.', como: ['Solo el admin debería tocar esto; un dato mal puesto rompe las consultas.'] },
  'comparativo-periodos': { titulo: 'Comparativo de Periodos', que: 'Compara los números contables entre dos periodos.', como: ['Ideal para detectar saltos raros de un mes a otro.'] },

  // ── SSOMA / ESPECIALIDADES ───────────────────────────────────────
  'reporte-especialidad': { titulo: 'Reporte Diario de Especialidad', que: 'El reporte diario del especialista (seguridad, ambiental, calidad, social) con actividades y fotos.', como: ['Reportá cada día con evidencias — tu bloque de Inicio muestra SOLO tu especialidad.'] },
  'charlas-plan': { titulo: 'Planificador de Charlas', que: 'La programación semanal/mensual de charlas de seguridad.', como: ['Planificá los temas y marcá las dictadas con su asistencia.'] },
  'sctr-personal': {
    titulo: 'SCTR del Personal',
    que: 'El control de pólizas SCTR en dos ventanas: DOCUMENTOS (el trámite completo, subido con IA) y TRABAJADORES (quién tiene SCTR, con qué póliza y hasta cuándo).',
    como: [
      'DOCUMENTOS (Contadora Jefe/admin): subí el PDF del trámite COMPLETO (cotización + constancia + pago + factura juntos) — la IA lo separa en 4 documentos, lee los asegurados y la vigencia, y te muestra la lista para CORROBORAR antes de vincular.',
      'Al confirmar, los trabajadores corroborados quedan con su vencimiento, aseguradora y póliza de un solo golpe.',
      'TRABAJADORES: el semáforo muestra vencidos, sin SCTR y por vencer — cada fila con aseguradora/póliza y vencimiento. También se puede cargar el SCTR de una persona a mano.',
      'La subida (documentos o carga manual) es SOLO de la Contadora Jefe y el admin.',
    ],
    rol: { prevencionista: 'Consultás los vencimientos para avisar a tiempo y en Documentos ves SOLO el certificado/constancia (la cotización, el pago y la factura son del área contable).' },
  },
  'inducciones': { titulo: 'Inducciones', que: 'Registro de inducciones de seguridad del personal nuevo con su ficha firmada.', como: ['Subí la ficha de inducción firmada como evidencia de cada trabajador.'] },
  'charlas-seguridad': { titulo: 'Charlas de 5 minutos', que: 'El registro diario de charlas de seguridad con asistencia.', como: ['Registrá la charla del día con tema y asistentes.'] },
  'iperc': { titulo: 'IPERC', que: 'Matriz de identificación de peligros y evaluación de riesgos por actividad.', como: ['Mantené la matriz al día cuando cambien las actividades del frente.'] },
  'epps-inventario': {
    titulo: 'EPPs (inventario)', que: 'La BASE DE DATOS de equipos de protección personal: catálogo, stock y accesos rápidos a su historial — manejo igual que Materiales.',
    como: [
      'Igual que materiales: el stock se mueve con entregas y reposiciones, no a mano.',
      '👷 POR TRABAJADOR: el botón "Por trabajador" abre la ventana para revisar, organizar y filtrar los EPPs entregados a CADA persona — resumen por trabajador (entregas, unidades, última entrega) y su detalle con filtro por EPP.',
      'HISTORIAL DE UN EPP: el botón 📜 de cada fila te lleva a "Mov. de EPPs" con la búsqueda ya cargada con ese EPP.',
      '"Movimientos" (arriba) abre el historial completo, igual que "Mov. de Materiales".',
    ],
    rol: { prevencionista: 'Lo ves en CONSULTA: las entradas y salidas las registra la almacenera — tu rol es verificar y cuadrar con ella.' },
  },
  'mov-epp': {
    titulo: 'Movimientos de EPPs',
    que: 'El historial completo de entregas y entradas de EPP — espejo de "Mov. de Materiales".',
    como: [
      'BÚSQUEDA POR PALABRAS: cada palabra debe coincidir, en cualquier orden — buscá por EPP, trabajador, motivo, almacén o frente (ej. "guantes juan").',
      'Filtrá por tipo con los botones: Entradas (compras), Entregas (salidas a trabajadores) o Devoluciones.',
      'Llegás acá pre-filtrado desde el 📜 de un EPP del inventario o desde "Ver en Movimientos" de la ventana Por trabajador.',
    ],
  },
  'epp': {
    titulo: 'Entregas de EPP', que: 'La entrega de EPPs al personal con firma digital del trabajador, y las entradas (compras) al inventario.',
    como: [
      'Registrá la entrega y capturá la FIRMA del trabajador — queda como evidencia (tipo "Firma EPP").',
      '¿Te equivocaste en una cantidad o fecha? Usá el botón de alerta (⚠) de la fila: pedís el cambio o la ELIMINACIÓN del registro y el admin lo aprueba desde Solicitudes — el stock se reajusta solo.',
    ],
    rol: { prevencionista: 'Lo ves en CONSULTA: las entregas las registra la almacenera; vos verificás a quién se entregó y cuadrás con ella.' },
  },
  'insumos-persona': { titulo: 'Insumos por Persona', que: 'Qué EPPs/insumos tiene asignados cada trabajador.', como: ['Consultalo antes de reponer: muestra la última entrega de cada ítem.'] },
  'inspecciones-seguridad': { titulo: 'Inspecciones', que: 'Inspecciones de seguridad programadas y sus hallazgos.', como: ['Registrá hallazgos con foto y hacé seguimiento hasta cerrarlos.'] },
  'capacitaciones': { titulo: 'Capacitaciones', que: 'Las capacitaciones del personal y su asistencia.', como: ['Registrá cada capacitación con sus asistentes y evidencia.'] },
  'insumos-emergencia': { titulo: 'Insumos de Emergencia', que: 'Stock de emergencia (botiquines, extintores) con control de vencimientos.', como: ['Las salidas también respetan el candado cronológico de fechas.'] },
  'gestion-ambiental': { titulo: 'Gestión Ambiental', que: 'Registros ambientales ISO 14001: monitoreos, residuos, evidencias.', como: ['Cargá los registros del plan de manejo ambiental con su evidencia.'] },
  'gestion-calidad': { titulo: 'Gestión de Calidad', que: 'Certificados de calidad de insumos contra el expediente técnico.', como: ['Verificá cada insumo crítico: certificado presente y vigente.'] },
  'gestion-social': { titulo: 'Gestión Social', que: 'La relación con la comunidad: compromisos, quejas/reclamos y padrón de actores.', como: ['Registrá cada compromiso y dale seguimiento hasta cumplirlo.'] },

  // ── RRHH ─────────────────────────────────────────────────────────
  'personal': {
    titulo: 'Personal',
    que: 'El padrón del personal de la obra con su CATEGORÍA: Personal Obrero, Profesionales, Subcontratos (por subcontratista) y Otros.',
    como: [
      'Filtrá por categoría con el selector; la categoría se deriva sola del cargo/subcontratista.',
      'Los roles con scope (seguridad/almacenera/residente) crean SOLO personal obrero — directo (Peón/Oficial/Operario/Maestro/Capataz) o de subcontrato (eligiendo el subcontratista). Los profesionales y "Otros" los registra el admin.',
      'Si el subcontrato aún no existe, usá "Solicitar subcontrato": el admin lo aprueba y lo crea, y después le vinculás el personal.',
      'Inactivá al personal que cesa (estado inactivo/retirado) — deja de ofrecerse en Pagos y demás módulos, pero conserva su historial.',
    ],
    rol: { ingeniero_residente: 'Ves y gestionás SOLO Personal Obrero y de Subcontratos — los profesionales y "Otros" están fuera de tu alcance.' },
  },
  'frentes': { titulo: 'Frentes de Trabajo', que: 'Los frentes de la obra y qué personal/partidas tiene cada uno.', como: ['Asigná ingenieros y partidas a cada frente para ordenar la reportería.'] },
  'asistencia': { titulo: 'Asistencia', que: 'El control diario de asistencia del personal, con foto/lista.', como: ['Registrá la asistencia del día; la foto de la lista queda como evidencia.'] },
  'personal-contratos': { titulo: 'Contratos Laborales', que: 'Los contratos del personal y sus vigencias.', como: ['Cargá el contrato firmado y su vigencia para el control de vencimientos.'] },
  'planillas': { titulo: 'Planillas / Sueldos', que: 'El cálculo y pago de planillas del personal.', como: ['Generá la planilla del periodo y registrá los pagos con constancia.'] },
  'cts': { titulo: 'CTS', que: 'El control de depósitos CTS del personal.', como: ['Calculá y registrá los depósitos semestrales con su constancia.'] },
  'gratificaciones': { titulo: 'Gratificaciones', que: 'El cálculo de gratificaciones de julio y diciembre.', como: ['Generá el cálculo del periodo y registrá el pago.'] },
  'plame': { titulo: 'PLAME / T-Registro', que: 'La información para las declaraciones laborales SUNAT.', como: ['Mantené el T-Registro al día con altas y bajas del personal.'] },

  // ── ADMINISTRACIÓN ───────────────────────────────────────────────
  'usuarios': {
    titulo: 'Usuarios',
    que: 'La gestión de cuentas: crear usuarios, asignarles rol y obras.',
    como: [
      'Al crear un usuario definí email, contraseña (mín. 8), ROL y al menos 1 obra (salvo admin).',
      'El usuario solo ve datos de sus obras asignadas — "Editar obras" para cambiarlas después.',
      '"Cambiar rol" actualiza también el rol en sus obras asignadas.',
    ],
  },
  'roles': { titulo: 'Roles y Permisos', que: 'La matriz de qué módulos ve y edita cada rol.', como: ['Cambiá con cuidado: un permiso de más expone información sensible.'] },
  'solicitudes': {
    titulo: 'Solicitudes',
    que: 'La bandeja de solicitudes de cambio que envían los usuarios: cambios de campos, eliminaciones de movimientos, vinculación de facturas, bancarizaciones equivocadas, subcontratos nuevos.',
    como: [
      'La mayoría se APLICA SOLA al aprobar: cantidades y eliminaciones de movimientos (recalculan stock/consumo), la vinculación de facturas (obra / Gastos Generales / Contabilidad Neta), la eliminación de bancarizaciones (borra partes/constancias, libera vouchers y devuelve la factura a Pendiente si queda descubierta) y la eliminación de DETRACCIONES (borra la constancia y deja la factura sin detracción).',
      'Las marcadas "acción manual del admin" son descriptivas: hacé el cambio en su módulo y aprobá como acuse.',
      'Usá el buscador y los filtros (chips por PERSONA y menú por TIPO) para no perder ninguna: la bandeja mezcla las solicitudes de almacén, obra y contabilidad de todos los usuarios.',
      'Al enviar: los campos que se eligen de una lista (ej. la vinculación de una factura) se mandan de una — no hay pantalla de "confirmar". Solo el texto libre pide revisar el cambio antes de enviarlo.',
    ],
  },
  'configuracion': { titulo: 'Configuración', que: 'Parámetros generales de la app.', como: ['Tras cada actualización de la app, cerrá y reabrila para tomar la versión nueva.'] },
  'conflictos': { titulo: 'Conflictos de Sincronización', que: 'Registros donde dos dispositivos editaron lo mismo sin conexión.', como: ['Elegí qué versión gana; el resto de dispositivos se actualiza solo.'] },
  'audit-log': { titulo: 'Auditoría', que: 'El registro de quién hizo qué y cuándo en toda la app.', como: ['Buscá por usuario, tabla o registro para reconstruir cualquier cambio.'] },
};

const FALLBACK = {
  titulo: 'Esta sección',
  que: 'Sección de JARVEX. Aún no tiene ayuda detallada escrita.',
  como: ['Explorá con confianza: casi todo se registra con el botón principal de la esquina superior.', 'Si algo no queda claro, avisale al administrador para que sumemos la ayuda de esta sección.'],
};

/**
 * Ayuda de una página para un rol.
 * @returns {{ titulo, que, como: string[], notaRol: string|null, notaRolGeneral: string|null }}
 */
export function ayudaDe(pageId, rol) {
  const base = AYUDA[pageId] || FALLBACK;
  return {
    titulo: base.titulo,
    que: base.que,
    como: base.como || [],
    notaRol: (base.rol && rol && base.rol[rol]) || null,
    notaRolGeneral: (rol && ROL_GENERAL[rol]) || null,
  };
}

export { AYUDA };
