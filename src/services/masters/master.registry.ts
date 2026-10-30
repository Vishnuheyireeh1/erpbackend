import { prisma } from '../../config/prisma'
import type { Delegate } from '../../models/master.model'
import type { MasterKey } from '../../validators/master.validator'
import { categoryRules } from './category.rules'
import { masterUsage } from './master.usage'
import { productTypeRules } from './productType.rules'

type Data = Record<string, unknown>

/** Everything the generic master service needs to know about one master table. */
export type MasterConfig = {
  label: string // "Brand" — used in messages
  delegate: Delegate
  /** Text fields that must be unique (case-insensitive). */
  uniqueText: string[]
  /** Number fields that must be unique (e.g. tax rate). */
  uniqueNumber?: string[]
  /** Extra where-clause that scopes uniqueness (categories: same parent). */
  uniqueScope?: (data: Data) => Data
  orderBy: unknown
  include?: Data
  /** Business checks before create/update; throw ApiError to stop. */
  beforeSave?: (data: Data, id?: number) => Promise<void>
  /** Returns a reason if the row is still used somewhere (blocks delete). */
  inUse?: (id: number) => Promise<string | null>
}

const d = (delegate: unknown) => delegate as Delegate

// Delete-blocking checks live in master.usage.ts — add new modules there.
export const masterRegistry: Record<MasterKey, MasterConfig> = {
  productTypes: {
    label: 'Product type',
    delegate: d(prisma.productTypeMaster),
    uniqueText: ['name'],
    orderBy: [{ id: 'asc' }],
    include: { _count: { select: { products: true } } },
    beforeSave: productTypeRules.beforeSave,
    inUse: masterUsage.productTypes,
  },
  categories: {
    label: 'Category',
    delegate: d(prisma.category),
    uniqueText: ['name'],
    uniqueScope: (data) => ({ parentId: data.parentId ?? null }),
    orderBy: [{ name: 'asc' }],
    include: {
      parent: { select: { id: true, name: true } },
      _count: { select: { children: true } },
    },
    beforeSave: categoryRules.beforeSave,
    inUse: masterUsage.categories,
  },
  brands: {
    label: 'Brand',
    delegate: d(prisma.brand),
    inUse: masterUsage.brands,
    uniqueText: ['name'],
    orderBy: [{ name: 'asc' }],
  },
  units: {
    label: 'Unit',
    delegate: d(prisma.unit),
    inUse: masterUsage.units,
    uniqueText: ['name', 'code'],
    orderBy: [{ name: 'asc' }],
  },
  sizes: {
    label: 'Size',
    delegate: d(prisma.size),
    inUse: masterUsage.sizes,
    uniqueText: ['name'],
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  },
  colours: {
    label: 'Colour',
    delegate: d(prisma.colour),
    inUse: masterUsage.colours,
    uniqueText: ['name'],
    orderBy: [{ name: 'asc' }],
  },
  taxRates: {
    label: 'Tax rate',
    delegate: d(prisma.taxRate),
    inUse: masterUsage.taxRates,
    uniqueText: ['name'],
    uniqueNumber: ['rate'],
    orderBy: [{ rate: 'asc' }],
  },
}
