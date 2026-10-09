import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import EmptyState from '../../components/ui/EmptyState';
import { PhoneOff, Truck } from 'lucide-react';

export default function NdrPage() {
  const navigate = useNavigate();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">NDR</h1>
        <p className="text-muted-foreground">
          Non-delivery reports — failed attempts, phone / address fix, reattempt or RTO.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>NDR queue</CardTitle>
          <CardDescription>
            NDR comes from the courier's tracking feed. Amazon and Myntra handle NDR for their own couriers in the seller panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<PhoneOff className="h-7 w-7 text-muted-foreground" />}
            title="No NDR feed connected"
            description="Failed deliveries will list here once a courier account (Shopify orders) is connected with tracking webhooks. Orders cancelled after dispatch already show on RTO."
            action={(
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => navigate('/settings')}>
                  <Truck className="mr-2 h-4 w-4" />
                  Courier settings
                </Button>
                <Button variant="outline" onClick={() => navigate('/rto')}>Open RTO</Button>
              </div>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
