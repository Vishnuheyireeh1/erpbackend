-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'CUTTING', 'STITCHING', 'TRIAL', 'READY', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "receipt_allocations" ADD COLUMN     "job_id" INTEGER,
ALTER COLUMN "invoice_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sales_returns" ADD COLUMN     "bill_cleared" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "credit_used" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "stitching_jobs" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "customer_name" VARCHAR(120) NOT NULL,
    "customer_phone" VARCHAR(20),
    "doc_date" DATE NOT NULL,
    "expected_date" DATE NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "parent_job_id" INTEGER,
    "tax_mode" "tax_mode" NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "charge_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "internal_notes" VARCHAR(1000),
    "delivered_at" TIMESTAMP(3),
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "stitching_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_items" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "garment_type_id" INTEGER NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "charge_rate" DECIMAL(12,2) NOT NULL,
    "tailor_id" INTEGER,
    "labour_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "measurements" JSONB NOT NULL DEFAULT '{}',
    "instructions" VARCHAR(1000),
    "own_fabric" BOOLEAN NOT NULL DEFAULT false,
    "image_path" VARCHAR(200),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "job_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_materials" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "charge" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_costs" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "description" VARCHAR(200),
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "charge" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "job_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_status_logs" (
    "id" SERIAL NOT NULL,
    "job_id" INTEGER NOT NULL,
    "from_status" "JobStatus",
    "to_status" "JobStatus" NOT NULL,
    "note" VARCHAR(255),
    "by" VARCHAR(50) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_status_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_allocations" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "invoice_id" INTEGER,
    "job_id" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stitching_jobs_doc_no_key" ON "stitching_jobs"("doc_no");

-- CreateIndex
CREATE INDEX "stitching_jobs_customer_id_idx" ON "stitching_jobs"("customer_id");

-- CreateIndex
CREATE INDEX "stitching_jobs_status_expected_date_idx" ON "stitching_jobs"("status", "expected_date");

-- CreateIndex
CREATE INDEX "stitching_jobs_doc_date_idx" ON "stitching_jobs"("doc_date");

-- CreateIndex
CREATE INDEX "job_items_job_id_idx" ON "job_items"("job_id");

-- CreateIndex
CREATE INDEX "job_items_tailor_id_idx" ON "job_items"("tailor_id");

-- CreateIndex
CREATE INDEX "job_materials_job_id_idx" ON "job_materials"("job_id");

-- CreateIndex
CREATE INDEX "job_costs_job_id_idx" ON "job_costs"("job_id");

-- CreateIndex
CREATE INDEX "job_status_logs_job_id_idx" ON "job_status_logs"("job_id");

-- CreateIndex
CREATE INDEX "credit_allocations_return_id_idx" ON "credit_allocations"("return_id");

-- CreateIndex
CREATE INDEX "credit_allocations_invoice_id_idx" ON "credit_allocations"("invoice_id");

-- CreateIndex
CREATE INDEX "credit_allocations_job_id_idx" ON "credit_allocations"("job_id");

-- CreateIndex
CREATE INDEX "receipt_allocations_job_id_idx" ON "receipt_allocations"("job_id");

-- AddForeignKey
ALTER TABLE "stitching_jobs" ADD CONSTRAINT "stitching_jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stitching_jobs" ADD CONSTRAINT "stitching_jobs_parent_job_id_fkey" FOREIGN KEY ("parent_job_id") REFERENCES "stitching_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "stitching_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_garment_type_id_fkey" FOREIGN KEY ("garment_type_id") REFERENCES "garment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_items" ADD CONSTRAINT "job_items_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "tailors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_materials" ADD CONSTRAINT "job_materials_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "stitching_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_materials" ADD CONSTRAINT "job_materials_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_costs" ADD CONSTRAINT "job_costs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "stitching_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_status_logs" ADD CONSTRAINT "job_status_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "stitching_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "stitching_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "stitching_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A receipt / credit allocation points at exactly one sales bill OR one stitching job.
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_one_target" CHECK (("invoice_id" IS NULL) <> ("job_id" IS NULL));
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_one_target" CHECK (("invoice_id" IS NULL) <> ("job_id" IS NULL));
ALTER TABLE "credit_allocations" ADD CONSTRAINT "credit_allocations_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_credit_within" CHECK ("credit_used" >= 0 AND "bill_cleared" >= 0 AND "credit_used" <= "grand_total" - "refund_amount" - "bill_cleared");
ALTER TABLE "stitching_jobs" ADD CONSTRAINT "stitching_jobs_paid_within" CHECK ("paid_amount" >= 0);

-- Existing returns: the part that cleared their own bill (earlier rows counted the whole value against the bill).
UPDATE "sales_returns" r SET "bill_cleared" = CASE
    WHEN r."refund_mode" IS NOT NULL THEN r."grand_total" - r."refund_amount"
    ELSE LEAST(r."grand_total", GREATEST(0, i."grand_total" - i."paid_amount" - (i."returned_amount" - r."grand_total")))
  END
FROM "sales_invoices" i WHERE i."id" = r."invoice_id";
UPDATE "sales_invoices" i SET "returned_amount" = COALESCE((
  SELECT SUM(r."bill_cleared") FROM "sales_returns" r WHERE r."invoice_id" = i."id" AND r."status" = 'POSTED'), 0);
