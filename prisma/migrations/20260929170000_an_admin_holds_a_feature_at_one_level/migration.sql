-- An admin holds a feature at ONE level. The key was (adminId, featureKey, level), so READ and
-- WRITE could both be stored for one feature and every reader had to decide that WRITE wins.
-- The permissions screen now saves a whole admin in one request, one row per feature.
--
-- The data move: where both levels are held, the READ row goes and the WRITE row stays — the
-- same answer every reader already gave, so nobody's access changes. Then the key narrows.

DELETE FROM "AdminFeaturePermission" AS r
USING "AdminFeaturePermission" AS w
WHERE r."adminId" = w."adminId"
  AND r."featureKey" = w."featureKey"
  AND r."level" = 'READ'
  AND w."level" = 'WRITE';

ALTER TABLE "AdminFeaturePermission" DROP CONSTRAINT "AdminFeaturePermission_pkey";
ALTER TABLE "AdminFeaturePermission" ADD CONSTRAINT "AdminFeaturePermission_pkey" PRIMARY KEY ("adminId", "featureKey");
