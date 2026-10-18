-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
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

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "customer_id" INTEGER,
    "customer_name" VARCHAR(120) NOT NULL,
    "customer_phone" VARCHAR(20),
    "customer_gstin" VARCHAR(15),
    "doc_date" DATE NOT NULL,
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "tax_mode" "tax_mode" NOT NULL,
    "gross_total" DECIMAL(14,2) NOT NULL,
    "discount_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxable_total" DECIMAL(14,2) NOT NULL,
    "cgst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "grand_total" DECIMAL(14,2) NOT NULL,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "returned_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cash_tendered" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "change_returned" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_lines" (
    "id" SERIAL NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "hsn_code" VARCHAR(8),
    "qty" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "gst_rate" DECIMAL(5,2) NOT NULL,
    "taxable" DECIMAL(14,2) NOT NULL,
    "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "returned_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_receipts" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "customer_id" INTEGER,
    "doc_date" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" VARCHAR(255),
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "customer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_tenders" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" VARCHAR(60),

    CONSTRAINT "receipt_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt_allocations" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "invoice_id" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "receipt_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_returns" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "customer_id" INTEGER,
    "invoice_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "taxable_total" DECIMAL(14,2) NOT NULL,
    "tax_total" DECIMAL(14,2) NOT NULL,
    "grand_total" DECIMAL(14,2) NOT NULL,
    "refund_mode" "payment_mode",
    "refund_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_return_lines" (
    "id" SERIAL NOT NULL,
    "return_id" INTEGER NOT NULL,
    "sales_line_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "taxable" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "sales_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_code_key" ON "customers"("code");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_phone_idx" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_doc_no_key" ON "sales_invoices"("doc_no");

-- CreateIndex
CREATE INDEX "sales_invoices_doc_date_idx" ON "sales_invoices"("doc_date");

-- CreateIndex
CREATE INDEX "sales_invoices_customer_id_idx" ON "sales_invoices"("customer_id");

-- CreateIndex
CREATE INDEX "sales_invoices_status_idx" ON "sales_invoices"("status");

-- CreateIndex
CREATE INDEX "sales_lines_invoice_id_idx" ON "sales_lines"("invoice_id");

-- CreateIndex
CREATE INDEX "sales_lines_variant_id_idx" ON "sales_lines"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_receipts_doc_no_key" ON "customer_receipts"("doc_no");

-- CreateIndex
CREATE INDEX "customer_receipts_customer_id_doc_date_idx" ON "customer_receipts"("customer_id", "doc_date");

-- CreateIndex
CREATE INDEX "customer_receipts_doc_date_idx" ON "customer_receipts"("doc_date");

-- CreateIndex
CREATE INDEX "receipt_tenders_receipt_id_idx" ON "receipt_tenders"("receipt_id");

-- CreateIndex
CREATE INDEX "receipt_allocations_receipt_id_idx" ON "receipt_allocations"("receipt_id");

-- CreateIndex
CREATE INDEX "receipt_allocations_invoice_id_idx" ON "receipt_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_returns_doc_no_key" ON "sales_returns"("doc_no");

-- CreateIndex
CREATE INDEX "sales_returns_doc_date_idx" ON "sales_returns"("doc_date");

-- CreateIndex
CREATE INDEX "sales_return_lines_return_id_idx" ON "sales_return_lines"("return_id");

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_receipts" ADD CONSTRAINT "customer_receipts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_tenders" ADD CONSTRAINT "receipt_tenders_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "customer_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "customer_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt_allocations" ADD CONSTRAINT "receipt_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sales_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
