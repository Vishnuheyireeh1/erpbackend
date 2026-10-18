-- CreateEnum
CREATE TYPE "ExpenseKind" AS ENUM ('INDIRECT', 'DIRECT');

-- CreateEnum
CREATE TYPE "MoneyMoveKind" AS ENUM ('DEPOSIT', 'WITHDRAW', 'OWNER_IN', 'OWNER_OUT', 'OTHER_INCOME');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "kind" "ExpenseKind" NOT NULL DEFAULT 'INDIRECT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "doc_date" DATE NOT NULL,
    "category_id" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "paid_to" VARCHAR(120),
    "reference" VARCHAR(60),
    "notes" VARCHAR(255),
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "money_movements" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "doc_date" DATE NOT NULL,
    "kind" "MoneyMoveKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "mode" "payment_mode" NOT NULL,
    "reference" VARCHAR(60),
    "notes" VARCHAR(255),
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "money_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_tallies" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "expected" DECIMAL(14,2) NOT NULL,
    "counted" DECIMAL(14,2) NOT NULL,
    "difference" DECIMAL(14,2) NOT NULL,
    "note" VARCHAR(255),
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_tallies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_key" ON "expense_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_doc_no_key" ON "expenses"("doc_no");

-- CreateIndex
CREATE INDEX "expenses_doc_date_idx" ON "expenses"("doc_date");

-- CreateIndex
CREATE INDEX "expenses_category_id_idx" ON "expenses"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "money_movements_doc_no_key" ON "money_movements"("doc_no");

-- CreateIndex
CREATE INDEX "money_movements_doc_date_idx" ON "money_movements"("doc_date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_tallies_date_key" ON "cash_tallies"("date");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_amount_positive" CHECK ("amount" > 0);
-- Deposit / withdraw always go through the bank side.
ALTER TABLE "money_movements" ADD CONSTRAINT "money_movements_transfer_mode" CHECK ("kind" NOT IN ('DEPOSIT', 'WITHDRAW') OR "mode" <> 'CASH');

INSERT INTO "expense_categories" ("name", "kind", "sort_order") VALUES
  ('Rent', 'INDIRECT', 10), ('Electricity', 'INDIRECT', 20), ('Water', 'INDIRECT', 30), ('Telephone / internet', 'INDIRECT', 40),
  ('Tea / snacks', 'INDIRECT', 50), ('Staff welfare', 'INDIRECT', 60), ('Repairs / maintenance', 'INDIRECT', 70),
  ('Stationery / printing', 'INDIRECT', 80), ('Advertising', 'INDIRECT', 90), ('Bank charges', 'INDIRECT', 100),
  ('Transport / freight', 'DIRECT', 110), ('Packing material', 'DIRECT', 120), ('Other', 'INDIRECT', 200)
ON CONFLICT ("name") DO NOTHING;
