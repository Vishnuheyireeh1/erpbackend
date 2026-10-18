-- CreateTable
CREATE TABLE "tailor_payments" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "tailor_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
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

    CONSTRAINT "tailor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tailor_payments_doc_no_key" ON "tailor_payments"("doc_no");

-- CreateIndex
CREATE INDEX "tailor_payments_tailor_id_doc_date_idx" ON "tailor_payments"("tailor_id", "doc_date");

-- CreateIndex
CREATE INDEX "tailor_payments_doc_date_idx" ON "tailor_payments"("doc_date");

-- AddForeignKey
ALTER TABLE "tailor_payments" ADD CONSTRAINT "tailor_payments_tailor_id_fkey" FOREIGN KEY ("tailor_id") REFERENCES "tailors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
