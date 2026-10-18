-- Partner brands Sairandhri stitches for (their label on the garment) — master list for brand orders.
-- CreateTable
CREATE TABLE "partner_brands" (
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
    "gst_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_brands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_brands_code_key" ON "partner_brands"("code");

-- CreateIndex
CREATE UNIQUE INDEX "partner_brands_gstin_key" ON "partner_brands"("gstin");

-- CreateIndex
CREATE INDEX "partner_brands_name_idx" ON "partner_brands"("name");
