-- Additional charges: quantity and rate on the bill; a usual rate on the garment type.
-- AlterTable
ALTER TABLE "job_costs" ADD COLUMN     "qty" DECIMAL(10,2) NOT NULL DEFAULT 1,
ADD COLUMN     "rate" DECIMAL(12,2);

-- Garment types' charge lists: names → { name, rate } (no usual rate yet).
UPDATE "garment_types" g
SET "charges" = (SELECT jsonb_agg(jsonb_build_object('name', e, 'rate', 0)) FROM jsonb_array_elements_text(g."charges") e)
WHERE jsonb_typeof(g."charges") = 'array' AND jsonb_array_length(g."charges") > 0 AND jsonb_typeof(g."charges" -> 0) = 'string';
