-- Product types the shop can add itself; each works like one of the built-in kinds.
CREATE TABLE "product_types" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "kind" "product_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "product_types_name_key" ON "product_types"("name");

-- The five types the ERP had so far.
INSERT INTO "product_types" ("name", "kind", "updated_at") VALUES
  ('Ready-made', 'READY_MADE', CURRENT_TIMESTAMP),
  ('Own-made', 'FINISHED', CURRENT_TIMESTAMP),
  ('Raw material', 'RAW_MATERIAL', CURRENT_TIMESTAMP),
  ('Accessory', 'ACCESSORY', CURRENT_TIMESTAMP),
  ('Service', 'SERVICE', CURRENT_TIMESTAMP);

-- Existing products → the type matching their kind.
ALTER TABLE "products" ADD COLUMN "product_type_id" INTEGER;
UPDATE "products" p SET "product_type_id" = t."id" FROM "product_types" t WHERE t."kind" = p."type";
CREATE INDEX "products_product_type_id_idx" ON "products"("product_type_id");
ALTER TABLE "products" ADD CONSTRAINT "products_product_type_id_fkey" FOREIGN KEY ("product_type_id") REFERENCES "product_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
