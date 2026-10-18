-- CreateEnum
CREATE TYPE "enrolment_status" AS ENUM ('STUDYING', 'COMPLETED', 'DROPPED');

-- CreateTable
CREATE TABLE "courses" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 3,
    "fee" DECIMAL(12,2) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batches" (
    "id" SERIAL NOT NULL,
    "course_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "timing" VARCHAR(60),
    "start_date" DATE NOT NULL,
    "teacher_id" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "students" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(20),
    "guardian_phone" VARCHAR(20),
    "address" VARCHAR(255),
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrolments" (
    "id" SERIAL NOT NULL,
    "student_id" INTEGER NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "joined_on" DATE NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "status" "enrolment_status" NOT NULL DEFAULT 'STUDYING',
    "notes" VARCHAR(255),
    "created_by" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrolments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_receipts" (
    "id" SERIAL NOT NULL,
    "doc_no" VARCHAR(30) NOT NULL,
    "enrolment_id" INTEGER NOT NULL,
    "doc_date" DATE NOT NULL,
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

    CONSTRAINT "fee_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_name_key" ON "courses"("name");

-- CreateIndex
CREATE INDEX "batches_course_id_idx" ON "batches"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "students_code_key" ON "students"("code");

-- CreateIndex
CREATE INDEX "students_name_idx" ON "students"("name");

-- CreateIndex
CREATE INDEX "students_phone_idx" ON "students"("phone");

-- CreateIndex
CREATE INDEX "enrolments_batch_id_idx" ON "enrolments"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrolments_student_id_batch_id_key" ON "enrolments"("student_id", "batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_receipts_doc_no_key" ON "fee_receipts"("doc_no");

-- CreateIndex
CREATE INDEX "fee_receipts_enrolment_id_idx" ON "fee_receipts"("enrolment_id");

-- CreateIndex
CREATE INDEX "fee_receipts_doc_date_idx" ON "fee_receipts"("doc_date");

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batches" ADD CONSTRAINT "batches_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_enrolment_id_fkey" FOREIGN KEY ("enrolment_id") REFERENCES "enrolments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "courses" ADD CONSTRAINT "courses_ok" CHECK ("fee" >= 0 AND "months" > 0);
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_fee_ok" CHECK ("fee" >= 0);
ALTER TABLE "fee_receipts" ADD CONSTRAINT "fee_receipts_amount_ok" CHECK ("amount" > 0);
