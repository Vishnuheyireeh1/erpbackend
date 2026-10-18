-- AlterTable
ALTER TABLE "job_materials" ADD COLUMN     "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hsn_code" VARCHAR(8),
ADD COLUMN     "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "included" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "returned_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN     "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxable" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sales_return_lines" ADD COLUMN     "job_material_id" INTEGER,
ALTER COLUMN "sales_line_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN     "job_id" INTEGER,
ALTER COLUMN "invoice_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "stitching_jobs" ADD COLUMN     "returned_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "job_materials_variant_id_idx" ON "job_materials"("variant_id");

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "stitching_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_job_material_id_fkey" FOREIGN KEY ("job_material_id") REFERENCES "job_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Old "charged material" rows become SOLD lines (no GST on them then); charge 0 = included in stitching.
UPDATE "job_materials" SET "included" = false, "rate" = ROUND("charge" / NULLIF("qty", 0), 2), "amount" = "charge", "taxable" = "charge" WHERE "charge" > 0;
ALTER TABLE "job_materials" DROP COLUMN "charge";

-- A return is against exactly one counter bill or one job; a return line against one bill line or one job item.
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_one_target" CHECK (("invoice_id" IS NULL) <> ("job_id" IS NULL));
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_one_target" CHECK (("sales_line_id" IS NULL) <> ("job_material_id" IS NULL));
ALTER TABLE "job_materials" ADD CONSTRAINT "job_materials_returned_within" CHECK ("returned_qty" >= 0 AND "returned_qty" <= "qty");
