-- Sales bill numbers used to be counted under their letters (e.g. "SDB:2026-27"). They now count under the
-- fixed series key "SALE", so the letters can be changed without restarting the numbers.
UPDATE "counters" c
SET "key" = 'SALE:' || substr(c."key", length(p.prefix) + 2)
FROM (SELECT COALESCE((SELECT "value"->>'billPrefix' FROM "app_settings" WHERE "key" = 'business.profile'), 'INV') AS prefix) p
WHERE c."key" LIKE p.prefix || ':%'
  AND NOT EXISTS (SELECT 1 FROM "counters" x WHERE x."key" = 'SALE:' || substr(c."key", length(p.prefix) + 2));
