import { useEffect, useState } from 'react';
import Button from './Button';

export const PAGE_SIZE = 25;

export function useClientPage(rows, limit = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const list = rows || [];
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / limit) || 1);
  const stamp = `${total}:${list[0]?.id || list[0]?.orderNo || ''}`;
  useEffect(() => { setPage(1); }, [stamp]);
  const safe = Math.min(page, pages);
  const start = (safe - 1) * limit;
  return { page: safe, setPage, total, limit, rows: list.slice(start, start + limit) };
}

export default function Pagination({ page = 1, total = 0, limit = PAGE_SIZE, onPage }) {
  const pages = Math.max(1, Math.ceil(total / limit) || 1);
  if (total <= limit) return null;
  const safe = Math.min(Math.max(1, page), pages);
  const from = (safe - 1) * limit + 1;
  const to = Math.min(total, safe * limit);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--color-border-premium))] pt-3 text-sm">
      <span className="text-muted-foreground">{from}–{to} of {total}</span>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={safe <= 1} onClick={() => onPage(safe - 1)}>
          Previous
        </Button>
        <span className="text-muted-foreground">Page {safe} of {pages}</span>
        <Button type="button" variant="outline" size="sm" disabled={safe >= pages} onClick={() => onPage(safe + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
