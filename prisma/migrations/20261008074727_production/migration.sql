-- CreateEnum
CREATE TYPE "production_cost_kind" AS ENUM ('TAILOR', 'PAID', 'SALARIED');

-- CreateTable
CREATE TABLE "production_orders" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "doc_date" DATE NOT NULL,
    "title" VARCHAR(120),
    "notes" VARCHAR(500),
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "pieces" DECIMAL(14,3) NOT NULL,
    "material_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "labour_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "salaried_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "stock_cost" DECIMAL(14,2) NOT NULL,
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_outputs" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "production_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_materials" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "production_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_costs" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "kind" "production_cost_kind" NOT NULL,
    "description" VARCHAR(120) NOT NULL,
    "tailor_id" INTEGER,
    "qty" DECIMAL(14,3),
    "rate" DECIMAL(12,2),
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "payment_mode",
    "reference" VARCHAR(60),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "production_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_doc_no_key" ON "production_orders"("doc_no");

-- CreateIndex
CREATE INDEX "production_orders_doc_date_idx" ON "production_orders"("doc_date");

-- CreateIndex
CREATE INDEX "production_outputs_order_id_idx" ON "production_outputs"("order_id");

-- CreateIndex
CREATE INDEX "production_outputs_variant_id_idx" ON "production_outputs"("variant_id");

-- CreateIndex
CREATE INDEX "production_materials_order_id_idx" ON "production_materials"("order_id");

-- CreateIndex
CREATE INDEX "production_materials_variant_id_idx" ON "production_materials"("variant_id");

-- CreateIndex
CREATE INDEX "production_costs_order_id_idx" ON "production_costs"("order_id");

-- CreateIndex
CREATE INDEX "production_costs_tailor_id_idx" ON "production_costs"("tailor_id");

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_costs" ADD CONSTRAINT "production_costs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_costs" ADD CONSTRAINT "production_costs_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "tailors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Positive quantities / amounts; a tailor line needs the tailor and qty × rate; a paid line needs the mode.
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_ok" CHECK ("pieces" > 0 AND "material_cost" >= 0 AND "labour_cost" >= 0 AND "paid_cost" >= 0 AND "salaried_cost" >= 0 AND "stock_cost" >= 0);
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_qty_ok" CHECK ("qty" > 0 AND "unit_cost" >= 0);
ALTER TABLE "production_materials" ADD CONSTRAINT "production_materials_qty_ok" CHECK ("qty" > 0 AND "unit_cost" >= 0);
ALTER TABLE "production_costs" ADD CONSTRAINT "production_costs_ok" CHECK (
  "amount" > 0
  AND ("kind" <> 'TAILOR' OR ("tailor_id" IS NOT NULL AND "qty" > 0 AND "rate" >= 0))
  AND ("kind" <> 'PAID' OR "mode" IS NOT NULL)
);
