-- Additional charges on a brand order piece (Sarifal, Interlock …): qty × rate, billed with the piece.
-- CreateTable
CREATE TABLE "brand_order_charges" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "qty" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "rate" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "brand_order_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_order_charges_item_id_idx" ON "brand_order_charges"("item_id");

-- AddForeignKey
ALTER TABLE "brand_order_charges" ADD CONSTRAINT "brand_order_charges_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "brand_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
