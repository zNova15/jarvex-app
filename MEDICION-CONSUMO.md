# Medición de consumo — línea base y bitácora

Sirve para proyectar si el plan **Free** de Supabase (5 GB de egress/mes) alcanza
después de los arreglos del 9/10-set, o si hay que quedarse en Pro (USD 25/mes).

Contexto: [[jarvex-corte-egress-9sep]]. El 9-set el egress agotado cortó el
servicio entero. Los arreglos (migración 204 + cursor compuesto + techo de pull)
ya están en producción. Falta saber **cuánto consume la app ya arreglada**.

## Cómo medir (la fuente autoritativa)

El número que manda es el del panel, no una estimación:
**Dashboard → organización → Usage → Egress** (`/dashboard/org/_/usage`).

Ahí se lee "Used in period" contra el techo del plan. El ciclo de facturación
actual va del **26-ago al 26-set**. Ese panel refresca cada hora.

⚠️ El egress **no se puede consultar por API ni por SQL**. La documentación de
Supabase lo dice explícitamente sobre los logs: *"These logs currently do not
include response byte data"*. Por eso la bitácora de abajo usa un PROXY
(llamadas y filas servidas), que sirve para detectar una anomalía, no para
dar GB exactos.

## Línea base — 10-set-2026, 01:06 (hora de Perú)

Tomada con los tres arreglos ya en producción (`8166a6d`).

| Métrica | Valor |
|---|---|
| Llamadas acumuladas (rol `authenticated`) | 6.362.909 |
| Filas servidas acumuladas (rol `authenticated`) | 6.187.532 |
| Movimientos contables | 1.424 |
| Evidencias | 1.808 |
| Movimientos de almacén | 1.974 |

`pg_stat_statements` acumula desde el **26-abr-2026** (136 días), así que estos
totales son históricos, no diarios. Lo que importa es el **delta** entre
mediciones, no el número absoluto.

## Bitácora

| Fecha/hora | Llamadas | Filas | Δ llamadas | Δ horas | Llamadas/h | Egress del panel |
|---|---|---|---|---|---|---|
| 10-set 01:06 | 6.362.909 | 6.187.532 | — (base) | — | — | (anotar) |

## Consulta para la siguiente medición

```sql
select
  now() as medido_en,
  (select sum(calls) from pg_stat_statements s join pg_roles r on r.oid=s.userid where r.rolname='authenticated') as llamadas,
  (select sum(rows)  from pg_stat_statements s join pg_roles r on r.oid=s.userid where r.rolname='authenticated') as filas;
```

## Qué buscar

- **Llamadas por hora estable** → el sync está sano; proyectar el egress del panel
  a fin de ciclo y decidir Free vs Pro con ese número.
- **Un salto brusco sin más gente usando la app** → una tabla volvió a bajarse
  entera. El techo de pull debería avisarlo primero (modal de sincronización →
  «Un pull está trayendo demasiado de golpe»), pero esto lo confirma del lado
  del servidor.
- **Ojo con el falso positivo:** `pg_stat_statements` registra también las
  consultas internas de PostgREST (introspección de esquema, `pg_timezone_names`).
  Esas NO son egress — no salen a internet. Al comparar, mirar solo el rol
  `authenticated`, que es el del tráfico real de la app.
