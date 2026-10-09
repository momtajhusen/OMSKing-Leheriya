import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import PageLoader from '../../components/ui/PageLoader';
import { PlatformPage, PlatformSheet } from '../../components/platform/PlatformChrome';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Pagination, { PAGE_SIZE } from '../../components/ui/Pagination';

const BANDS = {
  'under-500': 'Under 500',
  '500-2000': '500 – 2,000',
  '2000-10000': '2,000 – 10,000',
  '10000-plus': '10,000+',
};

export default function DemoRequestsPage() {
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/demo-requests', { params: { page, limit: PAGE_SIZE } })
      .then(({ data }) => {
        setRows(data.data || []);
        setTotal(data.meta?.total || 0);
      })
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <PageLoader label="Loading demo requests…" />;

  return (
    <PlatformPage
      title="Demo requests"
      subtitle="People who asked for a walkthrough. This list does not create a merchant login."
    >
      <PlatformSheet>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Volume</TableHead>
              <TableHead>Channels</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">No demo requests yet.</TableCell>
              </TableRow>
            )}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <p className="font-medium">{row.company}</p>
                  <p className="text-xs text-muted-foreground">{row.city || '—'} · {new Date(row.createdAt).toLocaleString()}</p>
                </TableCell>
                <TableCell>
                  <p>{row.name}</p>
                  <p className="text-xs text-muted-foreground">{row.email}</p>
                  <p className="text-xs text-muted-foreground">{row.phone}</p>
                </TableCell>
                <TableCell>{BANDS[row.monthlyOrders] || row.monthlyOrders}</TableCell>
                <TableCell>{(row.channels || []).join(', ')}</TableCell>
                <TableCell className="max-w-[16rem] whitespace-normal text-sm">{row.message || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />
      </PlatformSheet>
    </PlatformPage>
  );
}
