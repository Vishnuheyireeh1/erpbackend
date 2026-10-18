-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'DIRECT_EXPENSE', 'INDIRECT_EXPENSE');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "notes" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "doc_date" DATE NOT NULL,
    "narration" VARCHAR(255) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "status" "doc_status" NOT NULL DEFAULT 'POSTED',
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_by" VARCHAR(50),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" SERIAL NOT NULL,
    "entry_id" INTEGER NOT NULL,
    "account_code" VARCHAR(20) NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" VARCHAR(120),
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_name_key" ON "ledger_accounts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_doc_no_key" ON "journal_entries"("doc_no");

-- CreateIndex
CREATE INDEX "journal_entries_doc_date_idx" ON "journal_entries"("doc_date");

-- CreateIndex
CREATE INDEX "journal_lines_entry_id_idx" ON "journal_lines"("entry_id");

-- CreateIndex
CREATE INDEX "journal_lines_account_code_idx" ON "journal_lines"("account_code");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Journal rules: amounts never negative, a line is either debit or credit, entry total positive.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_amounts_chk" CHECK (debit >= 0 AND credit >= 0 AND (debit = 0) <> (credit = 0));
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_total_chk" CHECK (total > 0);
