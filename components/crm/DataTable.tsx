"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export interface ColumnDef<T> {
  id: string;
  header: string;
  cell: (info: { row: { original: T } }) => React.ReactNode;
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[];
  data: TData[];
}

export function DataTable<TData>({ columns, data }: DataTableProps<TData>) {
  const [page, setPage] = useState(0);
  const pageSize = 10;
  
  const pageCount = Math.ceil(data.length / pageSize);
  const currentData = data.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="space-y-4">
      <div className="glass-panel overflow-hidden border border-border-subtle">
        <div className="w-full overflow-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-text-muted uppercase bg-surface-elevated/50 border-b border-border-subtle">
              <tr>
                {columns.map((col) => (
                  <th key={col.id} className="px-6 py-4 font-medium whitespace-nowrap">
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {currentData.length > 0 ? (
                currentData.map((row, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-surface-elevated/30 transition-colors group"
                  >
                    {columns.map((col) => (
                      <td key={col.id} className="px-6 py-4">
                        {col.cell({ row: { original: row } })}
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-24 text-center text-text-muted">
                    No results found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Pagination Controls */}
      <div className="flex items-center justify-end space-x-2 py-4">
        <button
          className="p-2 border border-border-strong rounded-md text-text-secondary hover:bg-surface-elevated disabled:opacity-50 transition"
          onClick={() => setPage(p => Math.max(0, p - 1))}
          disabled={page === 0}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm text-text-secondary px-2">
          Page {pageCount > 0 ? page + 1 : 0} of {pageCount}
        </span>
        <button
          className="p-2 border border-border-strong rounded-md text-text-secondary hover:bg-surface-elevated disabled:opacity-50 transition"
          onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
          disabled={page >= pageCount - 1 || pageCount === 0}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
