-- CreateEnum
CREATE TYPE "doc_status" AS ENUM ('POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "tax_mode" AS ENUM ('INTRA', 'INTER');

-- CreateEnum
CREATE TYPE "payment_mode" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "contact_person" VARCHAR(80),
    "phone" VARCHAR(20),
    "email" VARCHAR(120),
    "gstin" VARCHAR(15),
    "state_code" VARCHAR(2) NOT NULL DEFAULT '32',
    "address" VARCHAR(255),
    "city" VARCHAR(60),
    "pincode" VARCHAR(6),
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "supplier_invoice_no" VARCHAR(40) NOT NULL,
    "supplier_invoice_date" DATE NOT NULL,
    "doc_date" DATE NOT NULL,
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "tax_mode" "tax_mode" NOT NULL,
    "taxable_total" DECIMAL(14,2) NOT NULL,
    "cgst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_charges" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "returned_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxable" DECIMAL(14,2) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "returned_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "reference" VARCHAR(60),
    "notes" VARCHAR(255),
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" SERIAL NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "taxable_total" DECIMAL(14,2) NOT NULL,
    "tax_total" DECIMAL(14,2) NOT NULL,
    "grand_total" DECIMAL(14,2) NOT NULL,
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_lines" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "purchase_line_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "taxable" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "purchase_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_code_key" ON "suppliers"("code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_gstin_key" ON "suppliers"("gstin");

-- CreateIndex
CREATE INDEX "suppliers_name_idx" ON "suppliers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_doc_no_key" ON "purchase_invoices"("doc_no");

-- CreateIndex
CREATE INDEX "purchase_invoices_doc_date_idx" ON "purchase_invoices"("doc_date");

-- CreateIndex
CREATE INDEX "purchase_invoices_status_idx" ON "purchase_invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_supplier_id_supplier_invoice_no_key" ON "purchase_invoices"("supplier_id", "supplier_invoice_no");

-- CreateIndex
CREATE INDEX "purchase_lines_invoice_id_idx" ON "purchase_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "purchase_lines_variant_id_idx" ON "purchase_lines"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_doc_no_key" ON "supplier_payments"("doc_no");

-- CreateIndex
CREATE INDEX "supplier_payments_supplier_id_doc_date_idx" ON "supplier_payments"("supplier_id", "doc_date");

-- CreateIndex
CREATE INDEX "payment_allocations_payment_id_idx" ON "payment_allocations"("payment_id");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_doc_no_key" ON "purchase_returns"("doc_no");

-- CreateIndex
CREATE INDEX "purchase_returns_supplier_id_doc_date_idx" ON "purchase_returns"("supplier_id", "doc_date");

-- CreateIndex
CREATE INDEX "purchase_return_lines_return_id_idx" ON "purchase_return_lines"("return_id");

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "purchase_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
