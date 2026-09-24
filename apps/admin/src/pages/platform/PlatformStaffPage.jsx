import { useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import api, { apiError } from '../../lib/api';
import { ROLE_LABELS } from '../../constants/roles';
import { PlatformPage, PlatformSheet } from '../../components/platform/PlatformChrome';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import PageLoader from '../../components/ui/PageLoader';

export default function PlatformStaffPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/users')
      .then(({ data }) => setRows(data.data || []))
      .catch((err) => toast.error(apiError(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoader label="Loading platform staff..." />;

  return (
    <PlatformPage
      title="Platform staff"
      subtitle="SaaS operators on the OMSKing platform tenant — not merchant packing users."
    >
      <PlatformSheet>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last login</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.email}</TableCell>
                <TableCell><Badge variant="outline">{ROLE_LABELS[row.role] || row.role}</Badge></TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell>{row.lastLogin === 'Never' ? 'Never' : new Date(row.lastLogin).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </PlatformSheet>
    </PlatformPage>
  );
}
