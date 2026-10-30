import { prisma } from '../../config/prisma'

// "Is this master row still used?" checks — they block deletes.
// Each new module that references a master adds its count here.

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function usedBy(n: number, word: string) {
  return n > 0 ? `it is used by ${plural(n, word)}` : null
}

export const masterUsage = {
  productTypes: async (id: number) => usedBy(await prisma.product.count({ where: { productTypeId: id } }), 'product'),
  async categories(id: number) {
    const [children, products] = await Promise.all([
      prisma.category.count({ where: { parentId: id } }),
      prisma.product.count({ where: { categoryId: id } }),
    ])
    if (children > 0) return `it has ${children} subcategor${children === 1 ? 'y' : 'ies'}`
    return usedBy(products, 'product')
  },
  brands: async (id: number) => usedBy(await prisma.product.count({ where: { brandId: id } }), 'product'),
  units: async (id: number) => usedBy(await prisma.product.count({ where: { unitId: id } }), 'product'),
  taxRates: async (id: number) => usedBy(await prisma.product.count({ where: { taxRateId: id } }), 'product'),
  sizes: async (id: number) =>
    usedBy(await prisma.productVariant.count({ where: { sizeId: id } }), 'product variant'),
  colours: async (id: number) =>
    usedBy(await prisma.productVariant.count({ where: { colourId: id } }), 'product variant'),
}
