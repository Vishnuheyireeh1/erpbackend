-- Usual additional charges per garment (Lining ₹100 …), filled on the bill when the garment is chosen.
ALTER TABLE "garment_types" ADD COLUMN "charges" JSONB NOT NULL DEFAULT '[]';
