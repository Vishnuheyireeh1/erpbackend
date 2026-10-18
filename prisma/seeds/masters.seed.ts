import { prisma } from '../../src/config/prisma'
import { brands, categoryTree, colours, sizes, taxRates, units } from './masters.data'

// Adds sample masters. Safe to re-run: existing rows are skipped, never changed.
export async function seedMasters() {
  await prisma.brand.createMany({ data: brands.map((name) => ({ name })), skipDuplicates: true })
  await prisma.unit.createMany({ data: units, skipDuplicates: true })
  await prisma.size.createMany({ data: sizes, skipDuplicates: true })
  await prisma.colour.createMany({ data: colours, skipDuplicates: true })
  await prisma.taxRate.createMany({ data: taxRates, skipDuplicates: true })

  // Categories: parent first, then its subcategories (null parent isn't covered by the unique index).
  for (const [parentName, childNames] of Object.entries(categoryTree)) {
    const parent =
      (await prisma.category.findFirst({ where: { name: parentName, parentId: null } })) ??
      (await prisma.category.create({ data: { name: parentName } }))

    await prisma.category.createMany({
      data: childNames.map((name) => ({ name, parentId: parent.id })),
      skipDuplicates: true,
    })
  }

  const [c, b, u, s, col, t] = await Promise.all([
    prisma.category.count(),
    prisma.brand.count(),
    prisma.unit.count(),
    prisma.size.count(),
    prisma.colour.count(),
    prisma.taxRate.count(),
  ])
  console.log(
    `[seed] Masters ready — categories ${c}, brands ${b}, units ${u}, sizes ${s}, colours ${col}, tax rates ${t}.`,
  )
}
