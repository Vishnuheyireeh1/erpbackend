-- Staff & payroll: what work each worker does (stitching + other work, per-piece rate), a note on changed
-- stitching pay, and monthly payslips (salary + per-piece work, advance cut, bonus, deduction).
-- AlterTable
ALTER TABLE "job_items" ADD COLUMN     "labour_note" VARCHAR(200);

-- AlterTable
ALTER TABLE "tailors" ADD COLUMN     "stitches" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "payslips" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "staff_id" INTEGER NOT NULL,
    "month" DATE NOT NULL,
    "doc_date" DATE NOT NULL,
    "salary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "advance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deduction_note" VARCHAR(200),
    "piece_earned" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "piece_pieces" INTEGER NOT NULL DEFAULT 0,
    "piece_before" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "piece_paid" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_paid" DECIMAL(14,2) NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "reference" VARCHAR(60),
    "notes" VARCHAR(255),
    "work" JSONB NOT NULL DEFAULT '[]',
    "salary_payment_id" INTEGER,
    "tailor_payment_id" INTEGER,
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tailor_works" (
    "tailor_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "tailor_works_pkey" PRIMARY KEY ("tailor_id","category_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payslips_doc_no_key" ON "payslips"("doc_no");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_salary_payment_id_key" ON "payslips"("salary_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_tailor_payment_id_key" ON "payslips"("tailor_payment_id");

-- CreateIndex
CREATE INDEX "payslips_staff_id_idx" ON "payslips"("staff_id");

-- CreateIndex
CREATE INDEX "payslips_month_idx" ON "payslips"("month");

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_salary_payment_id_fkey" FOREIGN KEY ("salary_payment_id") REFERENCES "salary_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tailor_payment_id_fkey" FOREIGN KEY ("tailor_payment_id") REFERENCES "tailor_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tailor_works" ADD CONSTRAINT "tailor_works_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "tailors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tailor_works" ADD CONSTRAINT "tailor_works_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "job_cost_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Existing workers keep stitching.
UPDATE "tailors" SET "stitches" = true;
