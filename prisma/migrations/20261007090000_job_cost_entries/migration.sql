-- CreateEnum
CREATE TYPE "CostPaidBy" AS ENUM ('SALARIED', 'PAID');


-- CreateTable
CREATE TABLE "job_cost_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "default_paid_by" "CostPaidBy" NOT NULL DEFAULT 'PAID',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "job_cost_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_cost_entries" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "job_item_id" INTEGER,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "date" DATE NOT NULL,
    "description" VARCHAR(200),
    "qty" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "paid_by" "CostPaidBy" NOT NULL,
    "mode" "payment_mode",
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_cost_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_cost_defaults" (
    "garment_type_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "garment_cost_defaults_pkey" PRIMARY KEY ("garment_type_id","category_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_cost_categories_name_key" ON "job_cost_categories"("name");

-- CreateIndex
CREATE INDEX "job_cost_entries_job_id_idx" ON "job_cost_entries"("job_id");

-- CreateIndex
CREATE INDEX "job_cost_entries_date_idx" ON "job_cost_entries"("date");

-- AddForeignKey
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "stitching_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "job_cost_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_job_item_id_fkey" FOREIGN KEY ("job_item_id") REFERENCES "job_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_cost_defaults" ADD CONSTRAINT "garment_cost_defaults_garment_type_id_fkey" FOREIGN KEY ("garment_type_id") REFERENCES "garment_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "garment_cost_defaults" ADD CONSTRAINT "garment_cost_defaults_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "job_cost_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Cost types (editable in the app). Tailor fee is per garment line, so it is not a type here.
INSERT INTO "job_cost_categories" ("name", "default_paid_by", "sort_order") VALUES
  ('Cutting master', 'SALARIED', 10), ('Hand work', 'SALARIED', 20), ('Embroidery', 'PAID', 30), ('Lining', 'PAID', 40),
  ('Buttons / zip', 'PAID', 50), ('Lace / border', 'PAID', 60), ('Transport', 'PAID', 70), ('Other', 'PAID', 80)
ON CONFLICT ("name") DO NOTHING;

-- Old cost amounts typed on jobs become dated cost entries (kind → type of the same name, else Other).
INSERT INTO "job_cost_entries" ("job_id", "category_id", "date", "description", "qty", "rate", "amount", "paid_by", "created_by")
SELECT c."job_id",
       COALESCE((SELECT k."id" FROM "job_cost_categories" k WHERE lower(k."name") = lower(c."kind")),
                (SELECT k."id" FROM "job_cost_categories" k WHERE k."name" = CASE WHEN c."kind" = 'Cutting' THEN 'Cutting master' ELSE 'Other' END)),
       j."doc_date", COALESCE(c."description", c."kind"), 1, c."cost", c."cost", 'PAID', 'migration'
FROM "job_costs" c JOIN "stitching_jobs" j ON j."id" = c."job_id" WHERE c."cost" > 0;
DELETE FROM "job_costs" WHERE "charge" = 0;
ALTER TABLE "job_costs" DROP COLUMN "cost";

ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_amount_ok" CHECK ("amount" >= 0 AND "qty" > 0 AND "rate" >= 0);
ALTER TABLE "job_cost_entries" ADD CONSTRAINT "job_cost_entries_mode_when_paid" CHECK ("paid_by" = 'SALARIED' OR "mode" IS NOT NULL OR "created_by" = 'migration');
