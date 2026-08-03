'use client';

/**
 * The one table in the app.
 *
 * Every operational surface here is a grid of records that a person needs to
 * sort and scan — provider reliability, spend per ASIN, the review queue — and
 * hand-rolled `<table>` markup gave each of them slightly different alignment,
 * different empty states and no sorting at all. AG Grid supplies one behaviour
 * for all of them.
 *
 * It is themed through the Theming API rather than the legacy stylesheets so
 * the grid reads from the same swatch variables as the rest of the app; the
 * point is that it should not look like a third-party widget dropped into the
 * page.
 */

import { AllCommunityModule, ModuleRegistry, colorSchemeDark, themeQuartz } from 'ag-grid-community';
import type { CellStyle, ColDef, GridOptions } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { useMemo } from 'react';

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * Values are lifted from the Webflow swatch set rather than referenced as
 * `var(--swatch--*)`: AG Grid derives dozens of shades from these at runtime
 * (hover, selection, borders) using colour maths that needs real values, not
 * custom-property references.
 */
const theme = themeQuartz.withPart(colorSchemeDark).withParams({
  backgroundColor: '#181715',
  foregroundColor: '#e8e8e3',
  borderColor: '#393632',
  chromeBackgroundColor: '#141310',
  headerBackgroundColor: '#141310',
  headerTextColor: '#938f8a',
  headerFontSize: 11,
  headerFontWeight: 400,
  oddRowBackgroundColor: 'transparent',
  rowHoverColor: 'rgba(57, 54, 50, 0.45)',
  selectedRowBackgroundColor: 'rgba(57, 54, 50, 0.6)',
  fontFamily: 'Khteka, Helvetica Neue, Helvetica, sans-serif',
  fontSize: 14,
  cellHorizontalPadding: 18,
  rowVerticalPaddingScale: 1.2,
  wrapperBorderRadius: 4,
  borderRadius: 3,
  spacing: 7,
});

/** Small-caps mono, matching `.u-text-mono` — used for IDs and codes.
 *  Typed as the plain style object rather than the wider `cellStyle` union so
 *  callers can spread it to add a property. */
export const monoCell: CellStyle = {
  fontFamily: 'Suisse Mono, monospace',
  fontSize: '12px',
  letterSpacing: '0.02em',
};

export type DataTableProps<T> = {
  rows: T[] | null;
  columns: ColDef<T>[];
  /** Shown in place of the grid when `rows` is an empty array. */
  emptyMessage?: string;
  /** Grid body height. Rows scroll inside this rather than growing the page. */
  height?: number | string;
  /** Escape hatch for per-table options; merged last so it always wins. */
  gridOptions?: GridOptions<T>;
};

export default function DataTable<T>({
  rows,
  columns,
  emptyMessage = 'Nothing here yet',
  height = 'auto',
  gridOptions,
}: DataTableProps<T>) {
  const defaultColDef = useMemo<ColDef<T>>(
    () => ({
      sortable: true,
      resizable: true,
      // Filters are off by default: these tables are short and the page
      // already has purpose-built filter controls above them, so the header
      // menus would be a second, competing way to do the same thing.
      filter: false,
      suppressHeaderMenuButton: true,
      flex: 1,
      minWidth: 110,
    }),
    [],
  );

  if (rows === null) {
    return <div className="app_skeleton" style={{ height: typeof height === 'number' ? height : '18rem' }} />;
  }

  if (rows.length === 0) {
    return (
      <div className="app_empty">
        <div className="u-text-style-h5 u-text-trim-off">{emptyMessage}</div>
      </div>
    );
  }

  // `domLayout: autoHeight` makes the grid grow to its content, so short
  // tables have no dead space and no inner scrollbar.
  const autoHeight = height === 'auto';

  return (
    <div style={autoHeight ? undefined : { height }}>
      <AgGridReact<T>
        theme={theme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={defaultColDef}
        domLayout={autoHeight ? 'autoHeight' : 'normal'}
        animateRows={false}
        suppressCellFocus
        {...gridOptions}
      />
    </div>
  );
}
