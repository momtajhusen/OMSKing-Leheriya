import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import api, { apiError } from '../../lib/api';
import { readAmazonCallback } from '../../lib/amazonAuth';

export default function AmazonAuthCallbackPage() {
  const { search } = useLocation();
  const navigate = useNavigate();
  const sent = useRef(false);
  const [result, setResult] = useState({ kind: 'working', message: 'Connecting Amazon…' });

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const read = readAmazonCallback(search);
    if (read.kind !== 'ready') {
      setResult({ kind: 'failed', message: read.message });
      return;
    }
    api.post('/channels/amazon/authorize', read.body)
      .then(({ data }) => setResult({ kind: 'done', message: data.message || 'Amazon connected' }))
      .catch((err) => setResult({ kind: 'failed', message: apiError(err, 'Amazon could not be connected') }));
  }, [search]);

  const Icon = result.kind === 'done' ? CheckCircle2 : result.kind === 'failed' ? XCircle : Loader2;
  const tone = result.kind === 'done' ? 'text-emerald-500' : result.kind === 'failed' ? 'text-destructive' : 'animate-spin text-muted-foreground';

  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icon className={`h-5 w-5 ${tone}`} aria-hidden="true" />
            Authorize with Amazon
          </CardTitle>
          <CardDescription>
            {result.kind === 'done'
              ? 'Amazon is connected in Live mode. Orders and listings sync from Amazon India.'
              : 'Amazon sent you back to OMSKing.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className={`text-sm ${result.kind === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{result.message}</p>
          {result.kind !== 'working' && (
            <Button size="sm" onClick={() => navigate('/channels')}>
              Back to Channels
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
