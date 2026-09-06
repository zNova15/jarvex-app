# Los cercos de RLS — qué protege el servidor y qué todavía no

> 4-sep-2026. Cierra el 🔴 que la mig 175 dejó escrito ("las tablas HIJAS
> siguen con la mig 030 laxa"). Todo lo de aquí está medido contra producción
> con los JWT reales de los usuarios, no razonado en el aire.

## El problema, en una línea

Desde la mig 175 nadie veía una obra ajena **en ninguna pantalla**, pero el
servidor seguía entregando las **filas** de esa obra a quien las pidiera:

```
JWT real de la almacenera (designada solo a Miraflores), ANTES:
  obras visibles ..............    1   ← la 175 funcionaba
  accounting_movements ........ 1359   ← TODOS los del grupo
```

El filtro por obra era 100% del navegador. Con la sesión de cualquier usuario y
`curl` se bajaba la contabilidad, las guías y las evidencias del grupo entero.

## Cómo se cerró: tres cercos que se apilan

Un cerco es una policy **RESTRICTIVE**. Las PERMISSIVE se combinan con OR (por
eso la mig 030 abría todo); las RESTRICTIVE se combinan con **AND**. Entonces
no hace falta borrar ninguna policy vieja ni adivinar qué rol necesita qué: lo
de antes sigue valiendo, y encima hay que pasar el cerco.

| Cerco | Mig | Pregunta que hace | Alcance |
|---|---|---|---|
| **campo** | 155 / 167 | ¿eres la cuenta compartida del portal? | 99 tablas, las 4 operaciones |
| **obra** | **177** | ¿la fila es de una obra tuya? | 71 tablas con `obra_id`, las 4 operaciones |
| **módulo** | **178** | ¿tu rol tiene alguna pantalla que lea esta tabla? | 51 tablas, solo SELECT |

### Cerco de obra (177)

```sql
USING (obra_id IS NULL OR (SELECT es_rol_global()) OR obra_id IN (SELECT mis_obras()))
```

Dos escapes, los dos a propósito:

- **`obra_id IS NULL`** — las filas del GRUPO, que no cuelgan de ninguna obra:
  796 movimientos contables de empresa, 683 evidencias, 49 guías. Y las 20
  `factura_campo` del portal de captura, que nacen sin obra: sin este escape
  la cuenta `campo` dejaba de ver lo que ella misma sube.
- **`es_rol_global()`** — admin, gerente, contador, ayudante_contador, tesorero
  y licitaciones ven el grupo entero por definición. Espejo exacto de
  `ROLES_GLOBALES` en `src/lib/obras-asignadas.js`.

`mis_obras()` es "las designadas activas **+ las que creó**": el salvavidas del
creador, que antes vivía suelto dentro de la policy de `obras`, ahora es parte
de la definición y vale también para escribir en las tablas hijas.

Queda fuera `obra_usuarios`: la 175 ya le puso una policy pensada, y el cerco
le taparía al usuario sus propias designaciones dadas de baja.

**Rendimiento — la parte que no es cosmética.** `(SELECT es_rol_global())` en
vez de `es_rol_global()` convierte una llamada **por fila** en un InitPlan que
corre **una vez por consulta**. Medido sobre `insumos_partida` (6.722 filas)
con el JWT de un ingeniero:

```
sin cerco (hoy) ................... 359 ms
cerco con es_rol_global() suelto . 1019 ms
cerco con (SELECT …) .............. 158 ms   ← más rápido que antes
```

Es el mismo truco que ya usaban las policies viejas con `(SELECT auth.uid())`.

### Cerco de módulo (178)

Es el **espejo en el servidor** de `PULL_SCOPE_POR_ROL` (`src/sync/SyncEngine.js`),
la tabla que desde el 25-ago decide qué NO descarga cada rol porque no tiene
ninguna pantalla que lo lea. El mapa se generó del propio archivo, no se
transcribió.

> ⚠ **Espejo obligatorio:** si se toca `PULL_SCOPE_POR_ROL`, se toca la mig 178
> en el mismo commit. Si el cliente vuelve a bajar una tabla y el server la
> sigue negando, el usuario ve una lista vacía sin entender por qué.

Solo SELECT, nunca escritura: el SyncEngine garantiza que "el PUSH nunca se
filtra", y un cerco de INSERT/UPDATE rompería esa promesa.

## El bug que apareció al medir

Antes de escribir la 178 se preguntó a los datos si algún rol **escribe** en
una tabla que su propio cliente no descarga. De los 51 pares (tabla, rol), 50
dieron cero. El 51 no:

```
caja_chica_movimientos — creadas por rol almacenero: 39 de 56 (la última, 1-sep)
…y `PULL_SCOPE_POR_ROL.almacenero` la excluía del pull.
```

O sea: desde el 25-ago la almacenera cargaba caja chica, el push la subía —el
push nunca se filtra— pero **la vuelta estaba rota**. En su propio dispositivo
la seguía viendo porque Dexie guarda lo que ella misma escribió; en otro
dispositivo, o después de que el navegador limpie el caché, no veía ni lo suyo
ni los 17 movimientos que había cargado el admin.

Se corrigió en el cliente **antes** de escribir el cerco. Sin ese hallazgo, la
178 habría convertido un bug de sincronización en una negación dura del
servidor.

> **Regla que deja esto:** una tabla NO se excluye del pull de un rol que la
> ESCRIBE. Vale para cualquier tanda futura de ahorro de consumo.

## Resultado medido, después de aplicar

| | obras | movs contables | caja chica | mov. materiales | evidencias | pagos |
|---|---|---|---|---|---|---|
| admin / contadora | 2 | 1359 | 56 | 1958 | 1691 | 82 |
| ayudante contable | 2 | 1359 | 56 | 1958 | 1691 | 82 |
| almacenera | 1 | 1270 | **56** | 1958 | 224 | 0 |
| ingeniero de campo | 1 | **0** | 0 | 1958 | 224 | 0 |
| prevencionista | 1 | **0** | 0 | 1958 | 224 | 0 |
| cuenta `campo` | 0 | 0 | 0 | 0 | **20** | 0 |

Lo que un rol de obra dejó de ver es exactamente lo de "Obras San Marcos", que
está **terminada**: 89 movimientos contables, 48 evidencias, 8 guías, 4
ubicaciones, 1 frente, 1 consorcio. Las tablas pesadas (partidas 3.449,
insumos_partida 6.722, movimientos_materiales 1.958, personal 127) son 100%
Miraflores: nadie perdió una fila de su trabajo.

Las 20 vistas `v_*` no necesitaron nada: todas son `security_invoker=true`, o
sea que heredan el RLS de quien consulta. Los cercos las alcanzan solas.

## Lo que QUEDA ABIERTO (no está cerrado, y es la próxima tanda)

1. **🔴 `asistente_admin` e `ingeniero_residente` leen la contabilidad del
   grupo.** No tienen entrada en `PULL_SCOPE_POR_ROL` —se bajan todo— así que
   el cerco de módulo no los toca: siguen viendo los 1.270 movimientos que les
   deja la 177. Cerrarlo exige **decidir primero qué debe ver cada uno**, que
   es una decisión de Gabriel, no una lista que se pueda copiar.
2. **🟡 Las filas del grupo (`obra_id IS NULL`) las lee cualquier autenticado.**
   Un JWT válido sin fila en `profiles` ve 0 obras pero 796 movimientos
   contables de empresa. No hay hoy forma de conseguir ese JWT (el alta de
   usuarios pasa por `api/create-user`, solo admin), pero la dimensión
   **empresa** no tiene cerco propio: es la hermana que le falta a la de obra.
3. **🟡 El cerco del rol `campo` cuesta una llamada por fila.** El
   `EXPLAIN` mostró `Filter: (current_user_rol() IS DISTINCT FROM 'campo')`
   evaluado 6.722 veces en un solo SELECT — son los 359 ms de base. Envolverlo
   en `(SELECT …)` en las 99 tablas lo haría casi gratis, igual que en la 177.
   Es una mejora de rendimiento sobre policies de seguridad: su propia tanda,
   con su propia medición.
4. **⚙ Toggle manual de Gabriel:** *Leaked Password Protection* sigue apagado
   (Supabase → Authentication → Policies). No se puede activar por migración.

## Cómo volver atrás

Cada migración trae al final el SQL exacto de reversión, y las dos son
independientes: se puede revertir la 178 y dejar la 177, o al revés. Revertir
deja la app funcionando igual que antes — el filtro del cliente sigue en pie,
solo se pierde el respaldo del servidor.

## Cómo verificar cualquier afirmación de este documento

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<uuid del usuario>","role":"authenticated"}';
SELECT (SELECT count(*) FROM public.obras)                AS obras,
       (SELECT count(*) FROM public.accounting_movements) AS movs;
ROLLBACK;
```

Es la misma forma con la que se midió todo lo de arriba: no hace falta crear
usuarios de prueba ni adivinar, se suplanta al usuario real dentro de una
transacción que se descarta.
