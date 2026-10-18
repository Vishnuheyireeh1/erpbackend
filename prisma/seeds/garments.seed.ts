import { prisma } from '../../src/config/prisma'

// Common garment templates (SRS 7.1). Fields are editable in the app; prices start at 0 for the shop to fill.
const garments: { name: string; fields: string[] }[] = [
  { name: 'Blouse', fields: ['Length', 'Shoulder', 'Upper bust', 'Bust', 'Under bust', 'Waist', 'Armhole', 'Sleeve length', 'Sleeve round', 'Front neck', 'Back neck', 'Point'] },
  { name: 'Churidar', fields: ['Top length', 'Shoulder', 'Bust', 'Waist', 'Hip', 'Armhole', 'Sleeve length', 'Sleeve round', 'Front neck', 'Back neck', 'Slit', 'Pant length', 'Thigh', 'Knee', 'Ankle'] },
  { name: 'Salwar', fields: ['Top length', 'Shoulder', 'Bust', 'Waist', 'Hip', 'Armhole', 'Sleeve length', 'Sleeve round', 'Front neck', 'Back neck', 'Salwar length', 'Bottom round'] },
  { name: 'Kurti', fields: ['Length', 'Shoulder', 'Bust', 'Waist', 'Hip', 'Armhole', 'Sleeve length', 'Sleeve round', 'Front neck', 'Back neck', 'Slit'] },
  { name: 'Pant', fields: ['Length', 'Waist', 'Hip', 'Thigh', 'Knee', 'Bottom', 'Crotch'] },
  { name: 'Dress / Gown', fields: ['Full length', 'Shoulder', 'Bust', 'Waist', 'Hip', 'Armhole', 'Sleeve length', 'Sleeve round', 'Front neck', 'Back neck'] },
  { name: 'Shirt', fields: ['Length', 'Shoulder', 'Chest', 'Waist', 'Hip', 'Sleeve length', 'Cuff', 'Collar'] },
  { name: 'Alteration', fields: [] },
  { name: 'Custom', fields: [] },
]

// Safe to re-run: existing garment types are left as they are.
export async function seedGarments() {
  await prisma.garmentType.createMany({
    data: garments.map((g, i) => ({ name: g.name, fields: g.fields, sortOrder: (i + 1) * 10 })),
    skipDuplicates: true,
  })
  console.log(`[seed] Garment types ready — ${await prisma.garmentType.count()}.`)
}
