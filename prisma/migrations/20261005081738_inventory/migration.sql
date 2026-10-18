-- CreateEnum
CREATE TYPE "movement_type" AS ENUM ('OPENING', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'PURCHASE', 'PURCHASE_RETURN', 'SALE', 'SALE_RETURN', 'JOB_CONSUMPTION', 'PRODUCTION_IN', 'PRODUCTION_OUT', 'CANCELLATION');

-- CreateEnum
CREATE TYPE "stock_document_kind" AS ENUM ('OPENING', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "stock_document_status" AS ENUM ('POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "adjustment_reason" AS ENUM ('OPENING', 'DAMAGED', 'LOST', 'FOUND', 'COUNT_CORRECTION', 'SAMPLE', 'OTHER');

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "avg_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
ADD COLUMN     "stock_qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN     "stock_value" DECIMAL(16,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "type" "movement_type" NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "value" DECIMAL(16,2) NOT NULL,
    "balance_qty" DECIMAL(14,3) NOT NULL,
    "balance_value" DECIMAL(16,2) NOT NULL,
    "ref_type" VARCHAR(20) NOT NULL,
    "ref_id" INTEGER NOT NULL,
    "ref_no" VARCHAR(30) NOT NULL,
    "note" VARCHAR(255),
    "movement_date" DATE NOT NULL,
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_documents" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "kind" "stock_document_kind" NOT NULL,
    "status" "stock_document_status" NOT NULL DEFAULT 'POSTED',
    "reason" "adjustment_reason" NOT NULL,
    "doc_date" DATE NOT NULL,
    "note" VARCHAR(500),
    "total_value" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "stock_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_document_lines" (
    "id" SERIAL NOT NULL,
    "document_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "value" DECIMAL(16,2) NOT NULL,

    CONSTRAINT "stock_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" VARCHAR(50),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" VARCHAR(50) NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "entity" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(40) NOT NULL,
    "summary" VARCHAR(255) NOT NULL,
    "details" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_variant_id_id_idx" ON "stock_movements"("variant_id", "id");

-- CreateIndex
CREATE INDEX "stock_movements_ref_type_ref_id_idx" ON "stock_movements"("ref_type", "ref_id");

-- CreateIndex
CREATE INDEX "stock_movements_movement_date_idx" ON "stock_movements"("movement_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_doc_no_key" ON "stock_documents"("doc_no");

-- CreateIndex
CREATE INDEX "stock_documents_kind_doc_date_idx" ON "stock_documents"("kind", "doc_date");

-- CreateIndex
CREATE INDEX "stock_document_lines_document_id_idx" ON "stock_document_lines"("document_id");

-- CreateIndex
CREATE INDEX "stock_document_lines_variant_id_idx" ON "stock_document_lines"("variant_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_at_idx" ON "audit_logs"("at");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "stock_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
