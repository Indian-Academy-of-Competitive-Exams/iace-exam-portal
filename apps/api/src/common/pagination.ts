import { type Paginated, type PaginationQuery } from '@iace/contracts';

export function pageArgs(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function paged<T>(query: PaginationQuery, items: T[], total: number): Paginated<T> {
  return { items, page: query.page, pageSize: query.pageSize, total };
}
