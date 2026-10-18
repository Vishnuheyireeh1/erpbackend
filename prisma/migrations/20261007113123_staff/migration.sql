-- CreateEnum
CREATE TYPE "StaffDept" AS ENUM ('WORKSHOP', 'SHOP');

-- CreateTable
CREATE TABLE "staff" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20),
    "address" VARCHAR(255),
    "role" VARCHAR(60) NOT NULL,
    "dept" "StaffDept" NOT NULL DEFAULT 'SHOP',
    "salary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "join_date" DATE,
    "notes" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salary_payments" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "staff_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
    "month" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "reference" VARCHAR(60),
    "notes" VARCHAR(255),
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "salary_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_code_key" ON "staff"("code");

-- CreateIndex
CREATE INDEX "staff_name_idx" ON "staff"("name");

-- CreateIndex
CREATE UNIQUE INDEX "salary_payments_doc_no_key" ON "salary_payments"("doc_no");

-- CreateIndex
CREATE INDEX "salary_payments_staff_id_idx" ON "salary_payments"("staff_id");

-- CreateIndex
CREATE INDEX "salary_payments_doc_date_idx" ON "salary_payments"("doc_date");

-- CreateIndex
CREATE INDEX "salary_payments_month_idx" ON "salary_payments"("month");

-- AddForeignKey
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff" ADD CONSTRAINT "staff_salary_ok" CHECK ("salary" >= 0);
ALTER TABLE "salary_payments" ADD CONSTRAINT "salary_payments_ok" CHECK ("amount" > 0 AND EXTRACT(DAY FROM "month") = 1);
