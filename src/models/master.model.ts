// Generic data access for the simple master tables (no business rules here).
// Each Prisma table delegate (prisma.brand, prisma.unit …) fits this shape.

type Args = Record<string, unknown>
export type Row = Record<string, unknown> & { id: number }

export type Delegate = {
  findMany(args: Args): Promise<Row[]>
  count(args: Args): Promise<number>
  findFirst(args: Args): Promise<Row | null>
  findUnique(args: Args): Promise<Row | null>
  create(args: Args): Promise<Row>
  update(args: Args): Promise<Row>
  delete(args: Args): Promise<Row>
}

export type ListOptions = {
  where: Args
  orderBy: unknown
  include?: Args
  skip: number
  take: number
}

export async function list(delegate: Delegate, opts: ListOptions) {
  const [items, total] = await Promise.all([
    delegate.findMany({
      where: opts.where,
      orderBy: opts.orderBy,
      include: opts.include,
      skip: opts.skip,
      take: opts.take,
    }),
    delegate.count({ where: opts.where }),
  ])
  return { items, total }
}

export function findById(delegate: Delegate, id: number, include?: Args) {
  return delegate.findUnique({ where: { id }, include })
}

export function findFirst(delegate: Delegate, where: Args) {
  return delegate.findFirst({ where })
}

export function create(delegate: Delegate, data: Args, include?: Args) {
  return delegate.create({ data, include })
}

export function update(delegate: Delegate, id: number, data: Args, include?: Args) {
  return delegate.update({ where: { id }, data, include })
}

export function remove(delegate: Delegate, id: number) {
  return delegate.delete({ where: { id } })
}
