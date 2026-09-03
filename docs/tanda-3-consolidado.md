# JARVEX — Tanda 3 de 3: consolidado real (requiere la tanda 1 aplicada primero)

## Dependencia
Esta tanda necesita que la entidad `consorcio` ya exista como libro contable independiente (RUC propio, EE.FF. propios) — ver tanda 1. No empezar esta tanda antes de que la 1 esté migrada y verificada.

## Contexto base
El bloque "Contabilidad y Tesorería" ya lista pantallas de "Intercompany" y "Consolidado". Verificar primero si hoy hacen eliminaciones reales o si solo suman resultados de cada empresa.

## Qué debe hacer el consolidado
- El resumen macro del grupo debe ser un consolidado contable real, con eliminaciones intercompañía — no un tablero de indicadores lado a lado.
- El perímetro de eliminación no es solo empresa-contra-empresa: también hay que eliminar las transacciones entre una empresa del grupo y un consorcio en el que participa (ej.: una empresa intermediaria que le vende material al consorcio ejecutor). Si el consolidado actual solo contempla empresa-contra-empresa, hay que ampliarlo para incluir consorcio como contraparte eliminable.
- Caso de referencia real para probar: cadena de venta A → B → consorcio ejecutor, donde A y B son empresas del grupo — el consolidado no debe contar el mismo material tres veces.

## Verificación antes de dar por cerrado
Correr el consolidado sobre un caso con al menos una cadena de venta intercompañía (empresa → empresa → consorcio) y confirmar que el resultado consolidado no duplica ingreso ni costo.
