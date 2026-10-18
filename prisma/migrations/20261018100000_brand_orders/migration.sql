-- Brand orders: another brand's order stitched with their label; pieces billed per delivery (bills come next).
-- CreateEnum
CREATE TYPE "brand_order_status" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "brand_piece_stage" AS ENUM ('IN_WORK', 'READY', 'DELIVERED');

-- CreateTable
CREATE TABLE "brand_orders" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "brand_id" INTEGER NOT NULL,
    "brand_name" VARCHAR(120) NOT NULL,
    "their_order_no" VARCHAR(40),
    "doc_date" DATE NOT NULL,
    "expected_date" DATE NOT NULL,
    "label_note" VARCHAR(300),
    "notes" VARCHAR(1000),
    "status" "brand_order_status" NOT NULL DEFAULT 'OPEN',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "brand_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_order_items" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "garment_type_id" INTEGER NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "end_customer" VARCHAR(120),
    "qty" INTEGER NOT NULL DEFAULT 1,
    "charge_rate" DECIMAL(12,2) NOT NULL,
    "brand_cloth" BOOLEAN NOT NULL DEFAULT false,
    "measurements" JSONB NOT NULL DEFAULT '{}',
    "instructions" VARCHAR(1000),
    "tailor_id" INTEGER,
    "labour_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "stage" "brand_piece_stage" NOT NULL DEFAULT 'IN_WORK',
    "ready_on" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "brand_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_order_materials" (
    "id" SERIAL NOT NULL,
    "order_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "variant_id" INTEGER NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "hsn_code" VARCHAR(8),
    "qty" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "charged" BOOLEAN NOT NULL DEFAULT true,
    "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_order_materials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brand_orders_doc_no_key" ON "brand_orders"("doc_no");

-- CreateIndex
CREATE INDEX "brand_orders_brand_id_idx" ON "brand_orders"("brand_id");

-- CreateIndex
CREATE INDEX "brand_orders_status_expected_date_idx" ON "brand_orders"("status", "expected_date");

-- CreateIndex
CREATE INDEX "brand_orders_doc_date_idx" ON "brand_orders"("doc_date");

-- CreateIndex
CREATE INDEX "brand_order_items_order_id_idx" ON "brand_order_items"("order_id");

-- CreateIndex
CREATE INDEX "brand_order_items_tailor_id_idx" ON "brand_order_items"("tailor_id");

-- CreateIndex
CREATE INDEX "brand_order_materials_order_id_idx" ON "brand_order_materials"("order_id");

-- CreateIndex
CREATE INDEX "brand_order_materials_item_id_idx" ON "brand_order_materials"("item_id");

-- CreateIndex
CREATE INDEX "brand_order_materials_variant_id_idx" ON "brand_order_materials"("variant_id");

-- AddForeignKey
ALTER TABLE "brand_orders" ADD CONSTRAINT "brand_orders_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "partner_brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_items" ADD CONSTRAINT "brand_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "brand_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_items" ADD CONSTRAINT "brand_order_items_garment_type_id_fkey" FOREIGN KEY ("garment_type_id") REFERENCES "garment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_items" ADD CONSTRAINT "brand_order_items_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "tailors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_materials" ADD CONSTRAINT "brand_order_materials_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "brand_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_materials" ADD CONSTRAINT "brand_order_materials_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "brand_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_order_materials" ADD CONSTRAINT "brand_order_materials_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

