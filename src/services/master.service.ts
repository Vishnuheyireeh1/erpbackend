import * as masterModel from '../models/master.model'
import { ApiError } from '../utils/ApiError'
import type { ListQuery, MasterKey } from '../validators/master.validator'
import { masterRegistry, type MasterConfig } from './masters/master.registry'

type Data = Record<string, unknown>

export function buildWhere(key: MasterKey, query: ListQuery): Data {
  const where: Data = {}
  if (query.search) where.name = { contains: query.search, mode: 'insensitive' }
  if (query.status !== 'all') where.isActive = query.status === 'active'
  if (key === 'categories' && query.parentId !== undefined) {
    where.parentId = query.parentId === 'root' ? null : query.parentId
  }
  return where
}

// Blocks duplicates like "Silk" vs "silk" (and same tax rate twice).
async function assertUnique(config: MasterConfig, data: Data, id?: number) {
  const scope = config.uniqueScope?.(data) ?? {}
  const notSelf = id !== undefined ? { NOT: { id } } : {}

  for (const field of config.uniqueText) {
    const where = { ...scope, ...notSelf, [field]: { equals: data[field], mode: 'insensitive' } }
    if (await masterModel.findFirst(config.delegate, where)) {
      throw ApiError.conflict(`${config.label} with this ${field} already exists`)
    }
  }
  for (const field of config.uniqueNumber ?? []) {
    const where = { ...notSelf, [field]: data[field] }
    if (await masterModel.findFirst(config.delegate, where)) {
      throw ApiError.conflict(`${config.label} with this ${field} already exists`)
    }
  }
}

async function getOrThrow(config: MasterConfig, id: number) {
  const row = await masterModel.findById(config.delegate, id)
  if (!row) throw ApiError.notFound(`${config.label} not found`)
  return row
}

export async function list(key: MasterKey, query: ListQuery) {
  const config = masterRegistry[key]
  const { items, total } = await masterModel.list(config.delegate, {
    where: buildWhere(key, query),
    orderBy: config.orderBy,
    include: config.include,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  })
  return { items, total, page: query.page, pageSize: query.pageSize }
}

// Active rows only, id + name — for dropdowns in other modules.
export async function options(key: MasterKey, query: ListQuery) {
  const config = masterRegistry[key]
  const where = { ...buildWhere(key, { ...query, status: 'active' }) }
  const { items } = await masterModel.list(config.delegate, {
    where,
    orderBy: config.orderBy,
    include: config.include,
    skip: 0,
    take: 500,
  })
  return items
}

export async function create(key: MasterKey, data: Data) {
  const config = masterRegistry[key]
  await config.beforeSave?.(data)
  await assertUnique(config, data)
  return masterModel.create(config.delegate, data, config.include)
}

export async function update(key: MasterKey, id: number, data: Data) {
  const config = masterRegistry[key]
  await getOrThrow(config, id)
  await config.beforeSave?.(data, id)
  await assertUnique(config, data, id)
  return masterModel.update(config.delegate, id, data, config.include)
}

// Hard delete — refused while anything still uses the row (no silent data loss).
export async function remove(key: MasterKey, id: number) {
  const config = masterRegistry[key]
  const row = await getOrThrow(config, id)
  const reason = await config.inUse?.(id)
  if (reason) {
    throw ApiError.conflict(`Can't delete "${String(row.name)}" because ${reason}`)
  }
  await masterModel.remove(config.delegate, id)
}
