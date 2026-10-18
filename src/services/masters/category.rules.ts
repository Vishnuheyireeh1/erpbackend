import { prisma } from '../../config/prisma'
import { ApiError } from '../../utils/ApiError'

// Categories are two levels only: main category → subcategory.
export const categoryRules = {
  async beforeSave(data: Record<string, unknown>, id?: number) {
    const parentId = data.parentId as number | null
    if (parentId === null) return

    if (id !== undefined && parentId === id) {
      throw ApiError.badRequest("A category can't be its own parent")
    }

    const parent = await prisma.category.findUnique({ where: { id: parentId } })
    if (!parent) throw ApiError.badRequest('Selected main category no longer exists')
    if (parent.parentId !== null) {
      throw ApiError.badRequest('Pick a main category as the parent (only 2 levels allowed)')
    }

    // A main category that already has subcategories can't itself become a subcategory.
    if (id !== undefined) {
      const children = await prisma.category.count({ where: { parentId: id } })
      if (children > 0) {
        throw ApiError.badRequest(
          `This category has ${children} subcategories, so it must stay a main category`,
        )
      }
    }
  }
}
