import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'

type Data = Record<string, unknown>

// A type's kind can't change while products use it — their stock / bills were made under the old kind.
export const productTypeRules = {
  async beforeSave(data: Data, id?: number) {
    if (id === undefined) return
    const current = await prisma.productTypeMaster.findUnique({ where: { id }, select: { kind: true } })
    if (!current || current.kind === data.kind) return
    const used = await prisma.product.count({ where: { productTypeId: id } })
    if (used > 0) throw ApiError.conflict(`"How it works" can't change — ${used} product${used === 1 ? ' uses' : 's use'} this type. Add a new type instead.`)
  },
}
