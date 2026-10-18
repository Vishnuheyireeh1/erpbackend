-- Brand delivery bills, brand payments and the brand's own cloth register.
-- CreateEnum
CREATE TYPE "brand_doc_status" AS ENUM ('POSTED', 'CANCELLED');

-- AlterTable
ALTER TABLE "brand_order_items" ADD COLUMN     "bill_id" INTEGER;

-- CreateTable
CREATE TABLE "brand_bills" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "order_id" INTEGER NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "brand_name" VARCHAR(120) NOT NULL,
    "brand_gstin" VARCHAR(15),
    "doc_date" DATE NOT NULL,
    "tax_mode" "tax_mode" NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "gross_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cgst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "status" "brand_doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "brand_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_bill_lines" (
    "id" SERIAL NOT NULL,
    "bill_id" INTEGER NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "end_customer" VARCHAR(120),
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(10) NOT NULL DEFAULT 'NOS',
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "brand_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_payments" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "reference" VARCHAR(60),
    "notes" VARCHAR(255),
    "status" "brand_doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "brand_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_cloth_entries" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "description" VARCHAR(120) NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit" VARCHAR(10) NOT NULL DEFAULT 'm',
    "notes" VARCHAR(255),
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_cloth_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_bills_doc_no_key" ON "brand_bills"("doc_no");

-- CreateIndex
CREATE INDEX "brand_bills_brand_id_doc_date_idx" ON "brand_bills"("brand_id", "doc_date");

-- CreateIndex
CREATE INDEX "brand_bills_order_id_idx" ON "brand_bills"("order_id");

-- CreateIndex
CREATE INDEX "brand_bills_doc_date_idx" ON "brand_bills"("doc_date");

-- CreateIndex
CREATE INDEX "brand_bill_lines_bill_id_idx" ON "brand_bill_lines"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_payments_doc_no_key" ON "brand_payments"("doc_no");

-- CreateIndex
CREATE INDEX "brand_payments_brand_id_doc_date_idx" ON "brand_payments"("brand_id", "doc_date");

-- CreateIndex
CREATE INDEX "brand_payments_doc_date_idx" ON "brand_payments"("doc_date");

-- CreateIndex
CREATE INDEX "brand_cloth_entries_order_id_idx" ON "brand_cloth_entries"("order_id");

-- CreateIndex
CREATE INDEX "brand_cloth_entries_brand_id_idx" ON "brand_cloth_entries"("brand_id");

-- CreateIndex
CREATE INDEX "brand_order_items_bill_id_idx" ON "brand_order_items"("bill_id");

-- AddForeignKey
ALTER TABLE "brand_bills" ADD CONSTRAINT "brand_bills_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "brand_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_bills" ADD CONSTRAINT "brand_bills_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "partner_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_bill_lines" ADD CONSTRAINT "brand_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "brand_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_payments" ADD CONSTRAINT "brand_payments_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "partner_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_cloth_entries" ADD CONSTRAINT "brand_cloth_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "brand_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_cloth_entries" ADD CONSTRAINT "brand_cloth_entries_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "partner_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_items" ADD CONSTRAINT "brand_order_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "brand_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

