'use client';

/**
 * ASIN index — every listing this system has produced imagery for.
 *
 * The entry point to the per-ASIN report. Everything else in the app is
 * organised by run, which is how the pipeline works; a seller owns listings,
 * not runs.
 */

import type { ColDef } from 'ag-grid-community';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/app/AppShell';
import DataTable, { monoCell } from '@/components/app/DataTable';
import { ApiError, api, type AsinListItem } from '@/lib/api';

export default function AsinIndexPage() {
  const [rows, setRows] = useState<AsinListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    api
      .asins()
      .then((r) => setRows(r.items))
      .catch((e: ApiError) => {
        setError(e.message);
        setRows([]);
      });
  }, []);

  const columns = useMemo<ColDef<AsinListItem>[]>(
    () => [
      { field: 'asin', headerName: 'ASIN', flex: 2, minWidth: 190, cellStyle: monoCell },
      { field: 'modules', headerName: 'Modules', maxWidth: 150 },
      { field: 'runs', headerName: 'Attempts', maxWidth: 150 },
      {
        field: 'last_seen',
        headerName: 'Last activity',
        flex: 1.4,
        valueFormatter: (p) => (p.value ? String(p.value).slice(0, 19).replace('T', ' ') : '—'),
      },
    ],
    [],
  );

  return (
    <AppShell>
      <header className="app_head">
        <div>
          <div className="u-text-mono u-text-style-xsmall" style={{ opacity: 0.5 }}>
            LISTINGS
          </div>
          <h1 className="u-text-style-h2 u-text-trim-off" style={{ marginTop: '0.6rem' }}>
            ASIN reports
          </h1>
          <p className="u-text-style-small u-max-width-60ch" style={{ opacity: 0.5, marginTop: '0.7rem' }}>
            Every product this system has generated A+ imagery for. Open one to see the
            current state of each module, what is blocking publication, and what is
            weakest across the set.
          </p>
        </div>
      </header>

      {error ? (
        <div className="app_error">
          <div className="u-text-mono u-text-style-xsmall">ERROR</div>
          <div className="u-text-style-small">{error}</div>
        </div>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        emptyMessage="No listings yet — generate something first"
        gridOptions={{
          onRowClicked: (e) => e.data && router.push(`/asin/${encodeURIComponent(e.data.asin)}`),
          rowStyle: { cursor: 'pointer' },
        }}
      />
    </AppShell>
  );
}
