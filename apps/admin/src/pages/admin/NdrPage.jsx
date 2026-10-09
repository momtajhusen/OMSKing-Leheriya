import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Badge from '../../components/ui/Badge';
import EmptyState from '../../components/ui/EmptyState';
import PageLoader from '../../components/ui/PageLoader';
import { PhoneOff, RefreshCw } from 'lucide-react';
import Pagination, { PAGE_SIZE } from '../../components/ui/Pagination';

export default function NdrPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const { data } = await api.get('/ndr', { params: { page, limit: PAGE_SIZE } });
      setRows(data.data || []);
      setTotal(data.meta?.total || 0);
    } catch (err) {
      toast.error(apiError(err, 'Could not load NDR'));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    load();
  }, [page]);

  const draft = (row) => drafts[row.orderNo] || { phone: row.phone || '', address: row.address || '' };

  const reattempt = async (row) => {
    const next = draft(row);
    setBusy(row.orderNo);
    try {
      await api.post(`/ndr/${encodeURIComponent(row.orderNo)}/reattempt`, next);
      toast.success(`${row.orderNo} reattempt stays on the same order`);
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Reattempt failed'));
    } finally {
      setBusy('');
    }
  };

  const toRto = async (row) => {
    setBusy(row.orderNo);
    try {
      await api.post(`/ndr/${encodeURIComponent(row.orderNo)}/rto`);
      toast.success(`${row.orderNo} marked RTO. No new order was created.`);
      await load();
    } catch (err) {
      toast.error(apiError(err, 'Could not mark RTO'));
    } finally {
      setBusy('');
    }
  };

  if (!loaded) return <PageLoader label="Loading NDR..." />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold mb-2">NDR</h1>
          <p className="text-muted-foreground">
            Failed delivery on the same Master Order. Fix the phone or address, then reattempt or send it to RTO.
          </p>
        </div>
        <div className="flex gap-2">
        <Button variant="outline" disabled={busy === 'poll'} onClick={async () => {
          setBusy('poll');
          try {
            const { data } = await api.post('/ndr/poll');
            toast.success(data.message || 'Tracking checked');
            await load();
          } catch (err) {
            toast.error(apiError(err, 'Delhivery tracking was not checked'));
          } finally {
            setBusy('');
          }
        }}>
          Check Delhivery
        </Button>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>NDR queue ({rows.length})</CardTitle>
          <CardDescription>
            Shopify parcels come from Delhivery tracking. Amazon and Myntra keep NDR in their own courier.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              icon={<PhoneOff className="h-7 w-7 text-muted-foreground" />}
              title="No open NDR"
              description="A failed delivery scan on a Delhivery AWB will list here. It does not create a new order."
              action={<Button variant="outline" onClick={() => navigate('/rto')}>Open RTO</Button>}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-[880px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>AWB</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const form = draft(row);
                    const closed = row.status === 'rto';
                    return (
                      <TableRow key={row.orderNo}>
                        <TableCell className="font-medium">
                          <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/orders/${encodeURIComponent(row.orderNo)}`)}>
                            {row.orderNo}
                          </button>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{row.awb || '—'}</TableCell>
                        <TableCell>{row.attempt}</TableCell>
                        <TableCell className="max-w-[220px] text-sm">{row.reason}</TableCell>
                        <TableCell>
                          <Input
                            value={form.phone}
                            disabled={closed}
                            onChange={(event) => setDrafts((prev) => ({ ...prev, [row.orderNo]: { ...form, phone: event.target.value } }))}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={form.address}
                            disabled={closed}
                            onChange={(event) => setDrafts((prev) => ({ ...prev, [row.orderNo]: { ...form, address: event.target.value } }))}
                          />
                        </TableCell>
                        <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                        <TableCell>
                          {closed ? (
                            <Badge variant="secondary">Sent to RTO</Badge>
                          ) : (
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" disabled={busy === row.orderNo} onClick={() => reattempt(row)}>Reattempt</Button>
                              <Button size="sm" variant="outline" disabled={busy === row.orderNo} onClick={() => toRto(row)}>Send to RTO</Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
