# Tanda 9 — El IGV que a veces ya está, la serie de cada empresa, y las órdenes de servicio

Feedback de Gabriel del **7-set-2026**, después de probar la tanda 8 en staging.
Confirmó los puntos 1, 2 y 3 y abrió siete cosas nuevas.

---

## 1. «Los precios que escribo ya incluyen IGV»

> «me ha pasado que a veces hay facturas donde te las generan con costo sin IGV
> y se lo agregan al final, y en otras ocasiones colocan los precios con IGV y
> simplemente al final sale el desagregado.»

Las dos son verdad y las dos aparecen en producción. Lo que no puede pasar es
que la app asuma una mientras la persona tipea la otra: ahí el total sale 18 %
corrido y nadie se entera hasta que el proveedor reclama.

`src/lib/precios-igv.js`:

| modo | qué es el precio tipeado | cómo salen los totales |
|---|---|---|
| sin IGV (por defecto) | valor de venta unitario | `valorVenta = Σ(c×p)`, `total = valorVenta × (1+t)` |
| con IGV | precio de venta unitario | `total = Σ(c×p)`, `valorVenta = total / (1+t)` |

**Cuando el precio ya trae IGV, el total manda.** Es el número que la persona
tiene en el papel. Despejar hacia atrás deja un valor de venta con decimales
raros y está bien; hacerlo al revés —redondear el unitario neto y multiplicar—
descuadra el total por céntimos, y esos céntimos son justo los que la contadora
tiene que explicar.

**Lo que se GUARDA es siempre valor de venta**, marque quien sea el checkbox.
De ahí comen el inventario, el abastecimiento y el historial de precios: si la
mitad de las líneas estuvieran con IGV, comparar dos compras del mismo insumo
dependería de cómo estaba el checkbox ese día. Queda `precio_ingresado` al lado
para poder explicar de dónde salió el número.

Está en los tres lugares: **Nueva orden**, **el buzón al facturar** y **Captura
Mágica**.

### Un segundo error que apareció al tocarlo

El botón «Recalcular» de Captura Mágica tenía el **18 % hardcodeado**. En
producción hay 54 comprobantes al 10/10,5 % (la tasa de comida: 8 % IGV + 2 %
IPM) y 58 sin IGV. Ahora, si el comprobante ya trae su desglose, ésa es la tasa
que se usa; recién si no lo trae se cae al 18 %. Mismo criterio que
`igv-desglose.js`.

---

## 2. La serie y el correlativo

> «El correlativo quiero que me recomiendes cómo debería ser […] ¿o es que
> acaso eso se ve cuando se configure bien el sistema de la SUNAT de cada
> empresa?»

**Las dos cosas, y en este orden.**

- La **SERIE** la asigna SUNAT y no cambia. Va guardada por empresa
  (`companies.serie_factura`, mig 187), se escribe una vez en su ficha.
- El **CORRELATIVO** lo lleva el **contribuyente**, no SUNAT: SUNAT solo valida
  que no se repita y que no salte hacia atrás. Así que la app lo puede saber
  **hoy**, sin certificado ni clave SOL, mirando lo que esa empresa ya emitió.

`src/lib/serie-comprobante.js` lo **deriva**, no lo guarda. Un contador en una
columna se desincroniza el día que alguien carga a mano una factura vieja, o que
dos dispositivos offline emiten a la vez — y un correlativo repetido es un
rechazo de SUNAT que después hay que anular con nota de crédito. Derivarlo no
puede desincronizarse: si el comprobante existe, el número está tomado.

Dos cercos:

- **Por serie, no por empresa.** F001 y B001 corren a la vez y cada una lleva su
  cuenta; mezclarlas daría un número ya usado en la otra.
- **Solo las ventas.** Las compras también tienen `document_number` —el de la
  factura del proveedor— y contarlas haría que el correlativo de JARVEX salte al
  de la ferretería.

La pantalla dice **de dónde salió** el número («la última que emitió fue la 7 de
3 registradas, así que le toca la 8») en vez de mostrarlo pelado: un correlativo
que no se puede explicar no se puede defender. Y si se tipea uno ya usado, avisa
antes de emitir.

---

## 3. Órdenes de servicio de primera clase

> «nos hemos centrado mucho en las Órdenes de Compra que esta sección parece que
> no tuviera para Órdenes de Servicio.»

El tipo **sí existía** desde la mig 179, pero era el segundo de cuatro `<select>`
apretados arriba y todo lo de abajo hablaba de compras. Un campo que decide el
título del documento, la serie (OC/OS), la unidad por defecto y qué ayuda tiene
sentido no puede estar entre la fecha y el IGV.

Ahora es lo primero de la pantalla, en dos botones grandes. Y arrastra:

- la unidad por defecto de las líneas nuevas (`SERV` vs `UND`);
- **qué necesita la obra**: medido contra producción el 7-set, `insumos_partida`
  tiene exactamente tres tipos — `material` (2.958), `mano_obra` (2.287) y
  `equipo` (1.477). En una orden de servicio se muestran mano de obra y equipos;
  en una de compra, materiales. Con **«ver todo el presupuesto»** siempre a un
  clic, porque el tipo lo cargó otra persona y puede estar mal puesto.

---

## 4. El bloque del grupo, por empresa

> «me gustaría que se pudiera mostrar por bloque (opción seleccionable) de tal
> manera que me salgan el bloque de cemento que compró GASOMI (aunque sean con
> diferentes nombres), y un desplegable de detalles, como la fecha de las
> facturas […] y también el precio unitario.»

En producción el mismo cemento está escrito de cuatro formas, y la lista salía
con las cuatro sueltas. Para decidir a quién comprarle eso está al revés: la
pregunta es «¿cuánto cemento tiene GASOMI?».

`ofertaPorEmpresa()` **pivotea**: no cambia un solo número. Cada línea abre su
detalle con las facturas de compra — fecha, comprobante, cantidad y precio
unitario. Solo las **compras**: a cuánto se lo vendió a otro es su margen, y no
es asunto de quien arma la orden.

**Las descripciones NO se fusionan entre sí.** Siguen listadas una por una
dentro de cada empresa, porque decir que cuatro nombres son el mismo insumo es
una decisión de mapeo y la toma una persona. El total por empresa viaja como
`disponibleBusqueda` — «de lo que buscaste», no «de este insumo».

---

## 5. Cada empresa nombra sus insumos como quiere

> «¿Es automático el autoguardado en la base de datos para que luego me la
> recomiende en otra ocasión? Ese autoguardado se llevaría para la base de datos
> de la empresa a la que se le emite la orden.»

**Sí, y ya lo era**: al confirmar la orden, sus líneas quedan en `oc_items` y el
corpus del autocompletado las lee la próxima vez. Lo que faltaba es la segunda
mitad.

No hay «base de datos por empresa» ni hace falta inventarla: cada entrada del
corpus ya sabe **quién vendió** eso, y `buscarDescripcion` acepta un
`proveedorId` que sube al tope el vocabulario de esa empresa. GASOMI ve primero
«CEMENTO SOL TIPO I» y JHEENSEG primero «CEMENTO INKA X 42.5 KG», sobre el mismo
corpus.

Se hizo así y no con listas separadas porque un corpus separado envejece: una
descripción nueva de GASOMI habría que copiarla a mano a las demás el día que
alguien más se la compra. Un solo corpus con preferencia no tiene ese problema, y
sigue mostrando lo de las otras más abajo — que es lo correcto cuando la empresa
recién arranca y su lista propia está vacía.

⚠️ En una compra a un **tercero** no se le atribuye vocabulario a nadie:
`company_id` es quien COMPRÓ, y usarlo diría lo contrario de la verdad. Solo en
las internas se sabe quién vendió (`related_company_id`).

---

## 6. Pedir más de lo que hay, y el stock negativo

> «no es que la orden no se pueda emitir, se emitirá, pero nos arrojará un aviso
> […] en el inventario de la empresa que emitió la factura se mostrará que
> tienen un stock negativo.»

Tres momentos, ninguno bloquea:

1. **Al armar la orden** — aviso con cuánto le falta a esa empresa según sus
   facturas. **Solo con empresas del grupo**: de un tercero no sabemos qué stock
   tiene, y avisar «la ferretería no tiene 500 kg de clavos» sería inventar un
   dato.
2. **Al facturar en el buzón** — el aviso que ya existía.
3. **En el inventario de la empresa** — el saldo ya se pintaba en rojo, pero
   entre 400 insumos tres en rojo no se encuentran scrolleando. Ahora hay un
   contador, un filtro «N en rojo» y una badge por fila.

**Un saldo negativo no es un error de la app**: es un hecho que hay que ver, con
tres causas reales — se facturó lo que todavía no se compró, la compra está en
otra empresa del grupo, o está escrita con otro nombre y sin mapear. Redondear a
cero taparía las tres.

---

## 7. El PDF se llamaba igual

> «los nombres que se generan con las órdenes de compra, quiero que sean
> distintos pues se me han generado pero con nombres igual al descargar el PDF.»

Dos choques, los dos reales:

1. El correlativo es **por empresa** (mig 179): JARVEX y GASOMI tienen las dos su
   `OC-001-2026`, y el archivo se llamaba `OC_OC-001-2026.pdf` en ambas.
2. Un **borrador** no tiene código, así que todos caían en `OC_sin-codigo.pdf`.

Ahora entra la empresa (su prefijo de documento, su nombre corto o su RUC) y,
sin código, la fecha más un trozo del id. `nombreArchivoOrden()` es pura y
testeada.

---

## 8. El diseño de los documentos, por empresa

> «quisiera que se pueda personalizar y pueda incluso ser distinto para cada
> empresa del grupo.»

`companies.doc_color` y `doc_pie` (mig 187), editables en la ficha de la empresa
junto al logo. El PDF de la orden ya los usa.

**Se personaliza la marca, no la estructura.** Un documento contable tiene
bloques obligatorios —RUC, numeración, desglose de IGV, firmas— y dejar moverlos
termina en un papel que SUNAT no acepta. Un hex mal escrito cae al color de
siempre en vez de romper el PDF.

---

## Lo que NO entra acá: la emisión electrónica

La factura del buzón nace como **borrador**. Que ese número exista para SUNAT es
otro camino, y son cuatro pasos que dependen de la **clave SOL de cada empresa**:

1. **Certificado digital tributario** (`.pfx`) de esa empresa, comprado a una
   entidad acreditada por INDECOPI. Uno por RUC.
2. **Usuario secundario SOL** con el perfil de facturación electrónica, creado
   desde SUNAT Operaciones en Línea con la clave SOL del titular.
3. **Homologación**: SUNAT exige un juego de pruebas antes de habilitar
   producción.
4. **Cargarlo en JARVEX**: la pantalla de Configuración SUNAT ya existe
   (`jx-config-sunat.jsx`) y cifra el certificado con AES-GCM en el dispositivo.

Los tres primeros son trámite ante SUNAT, no código. El cuarto es la pantalla que
ya está. Lo que falta en la app es conectar el envío (`sunat-sender.js`,
`sunat-ubl.js` y `sunat-signer.js` están escritos) a esta pantalla — y eso es una
tanda propia, porque un XML mal firmado que se manda a producción no se
desmanda.

---

## Archivos

| archivo | qué |
|---|---|
| `supabase/migrations/187_series_y_tema_por_empresa.sql` | serie por empresa + color y pie de sus documentos |
| `src/lib/precios-igv.js` | el toggle «ya incluyen IGV», en los tres lugares |
| `src/lib/serie-comprobante.js` | la serie es de la empresa; el correlativo se deriva |
| `src/lib/abastecimiento.js` | `ofertaPorEmpresa()` + el detalle de facturas |
| `src/lib/sugerir-descripcion.js` | vocabulario por empresa (`proveedorId`) |
| `src/lib/ordenes-recibidas.js` | `lineasQueExcedenElStock()` + IGV en el borrador |
| `src/lib/inventario-empresa.js` | `saldosNegativos()` / `tieneSaldoNegativo()` |
| `src/lib/ordenes.js` | `nombreArchivoOrden()` |
| `src/lib/contabilidad-pdfs.js` | color y pie por empresa; nombre único |
| `src/components/jx-ordenes.jsx` | tipo prominente, IGV, bloque por empresa, avisos, modal xl |
| `src/components/jx-captura-magica.jsx` | IGV incluido + la tasa real en «Recalcular» |
| `src/components/jx-empresa-detalle.jsx` | los insumos en rojo |
| `src/components/jx-contabilidad.jsx` | serie, color y pie en la ficha de la empresa |
