-- Brand order lines without a garment ("Saree bleeding", "Fall & pico" …): garment is now optional.
-- AlterTable
ALTER TABLE "brand_order_items" ALTER COLUMN "garment_type_id" DROP NOT NULL;

-- Saved work charges (Masters → Work charges): name + usual amount to the brand + usual pay to the worker.
-- CreateTable
CREATE TABLE "work_charges" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "labour_rate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_charges_name_key" ON "work_charges"("name");
