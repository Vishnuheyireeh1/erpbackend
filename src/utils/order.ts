import { z } from 'zod'

// List order picked on screen (every dated list): newest first (default) or oldest first. Excel follows the same order.
export const orderField = z.enum(['newest', 'oldest']).default('newest')
export type ListOrder = z.infer<typeof orderField>
export const sortDir = (order?: ListOrder): 'asc' | 'desc' => (order === 'oldest' ? 'asc' : 'desc')
// [{ docDate: dir }, { id: dir }] — the usual order of a document list.
export const byDate = <K extends string = 'docDate'>(order?: ListOrder, key = 'docDate' as K) =>
  [{ [key]: sortDir(order) }, { id: sortDir(order) }] as [Record<K, 'asc' | 'desc'>, { id: 'asc' | 'desc' }]
