-- 118: REPARACIÓN de datos — fotos de avance huérfanas.
-- useOfflineData.create() pisaba el id que le pasaba el caller con un newId()
-- propio; el reporte del ingeniero enlazaba sus fotos al id DESCARTADO →
-- 67 evidencias foto_avance apuntando a un avance_obra inexistente (invisibles
-- en el visor). El código ya se corrigió (create honra fields.id); esto re-ata
-- las históricas: mismo autor + misma obra + misma fecha de reporte, y entre
-- varios avances de ese día se elige el de created_at más cercano (la foto se
-- graba segundos después de su línea de avance).

WITH huerfanas AS (
  SELECT e.id AS evid_id, e.obra_id, e.fecha,
         COALESCE(e.subido_por, e.created_by) AS autor, e.created_at
  FROM evidencias e
  WHERE e.tipo_evidencia = 'foto_avance'
    AND e.modulo_relacionado = 'avance_obra'
    AND NOT EXISTS (SELECT 1 FROM avance_obra a WHERE a.id::text = e.registro_relacionado_id)
),
mejor AS (
  SELECT h.evid_id, a.id AS avance_id,
         ROW_NUMBER() OVER (
           PARTITION BY h.evid_id
           ORDER BY ABS(EXTRACT(EPOCH FROM (a.created_at - h.created_at))) ASC
         ) AS rk
  FROM huerfanas h
  JOIN avance_obra a
    ON a.obra_id = h.obra_id
   AND a.fecha = h.fecha
   AND a.responsable_id = h.autor
   AND a.deleted_at IS NULL
)
UPDATE evidencias e
SET registro_relacionado_id = m.avance_id::text,
    updated_at = now()
FROM mejor m
WHERE e.id = m.evid_id AND m.rk = 1;
