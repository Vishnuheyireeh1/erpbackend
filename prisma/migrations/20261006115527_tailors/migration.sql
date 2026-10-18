-- CreateEnum
CREATE TYPE "TailorPayType" AS ENUM ('PIECE', 'SALARY');

-- CreateTable
CREATE TABLE "tailors" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20),
    "speciality" VARCHAR(120),
    "pay_type" "TailorPayType" NOT NULL DEFAULT 'PIECE',
    "opening_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tailors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "garment_types" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "default_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "default_labour" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "garment_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tailor_rates" (
    "tailor_id" INTEGER NOT NULL,
    "garment_type_id" INTEGER NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "tailor_rates_pkey" PRIMARY KEY ("tailor_id","garment_type_id")
);

-- CreateTable
CREATE TABLE "customer_measurements" (
    "id" SERIAL NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "garment_type_id" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "notes" VARCHAR(500),
    "taken_on" DATE NOT NULL,
    "created_by" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tailors_code_key" ON "tailors"("code");

-- CreateIndex
CREATE INDEX "tailors_name_idx" ON "tailors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "garment_types_name_key" ON "garment_types"("name");

-- CreateIndex
CREATE INDEX "customer_measurements_customer_id_garment_type_id_taken_on_idx" ON "customer_measurements"("customer_id", "garment_type_id", "taken_on");

-- AddForeignKey
ALTER TABLE "tailor_rates" ADD CONSTRAINT "tailor_rates_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "tailors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tailor_rates" ADD CONSTRAINT "tailor_rates_garment_type_id_fkey" FOREIGN KEY ("garment_type_id") REFERENCES "garment_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_measurements" ADD CONSTRAINT "customer_measurements_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_measurements" ADD CONSTRAINT "customer_measurements_garment_type_id_fkey" FOREIGN KEY ("garment_type_id") REFERENCES "garment_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
