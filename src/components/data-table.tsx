"use client";

import { useMemo } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const NO_COLUMN_FILTERS: ColumnFiltersState = [];
const NO_SORTING: SortingState = [];

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  globalFilter?: string;
  columnFilters?: ColumnFiltersState;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  pageSize?: number;
  emptyMessage?: string;
  getRowId?: (row: TData) => string;
  scrollAreaClassName?: string;
}

export function DataTable<TData>({
  columns,
  data,
  globalFilter = "",
  columnFilters = NO_COLUMN_FILTERS,
  sorting = NO_SORTING,
  onSortingChange,
  pageSize = 25,
  emptyMessage = "No rows match the current filter.",
  getRowId,
  scrollAreaClassName,
}: DataTableProps<TData>) {
  const state = useMemo(
    () => ({ globalFilter, columnFilters, sorting }),
    [columnFilters, globalFilter, sorting]
  );

  const table = useReactTable({
    data,
    columns,
    state,
    onSortingChange: onSortingChange
      ? (updater) =>
          onSortingChange(
            typeof updater === "function" ? updater(sorting) : updater
          )
      : undefined,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;
  const totalRows = table.getFilteredRowModel().rows.length;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageCount = table.getPageCount();

  const firstRow = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min((pageIndex + 1) * pageSize, totalRows);

  return (
    <>
      <div className={cn("overflow-auto", scrollAreaClassName)}>
        <Table className="text-ui">
          <TableHeader className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="bg-[#1a1b1b] text-label uppercase tracking-[0.08em] text-muted-foreground hover:bg-[#1a1b1b]"
              >
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const direction = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className="h-auto px-5 py-2.5 font-medium"
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "-mx-1 flex items-center gap-1.5 rounded-[2px] px-1 py-0.5 uppercase tracking-[0.08em] transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                            direction && "text-foreground"
                          )}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {direction === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : direction === "desc" ? (
                            <ArrowDown className="h-3 w-3" />
                          ) : (
                            <ChevronsUpDown className="h-3 w-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="px-5 py-2.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={columns.length}
                  className="px-5 py-12 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-caption text-muted-foreground">
            <span className="tnum">
              {firstRow}&ndash;{lastRow}
            </span>{" "}
            of <span className="tnum">{totalRows}</span>
          </p>
          <div className="flex items-center gap-2">
            <span className="text-caption text-muted-foreground">
              Page <span className="tnum">{pageIndex + 1}</span> of{" "}
              <span className="tnum">{pageCount}</span>
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
