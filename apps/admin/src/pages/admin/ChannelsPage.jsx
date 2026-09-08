import ChannelSetup from '../../components/channels/ChannelSetup';

export default function ChannelsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Channels</h1>
        <p className="text-muted-foreground">
          Launch for Leheriya: Shopify, Amazon, Myntra. Pick a channel, attach a warehouse, then save API keys. Extra marketplaces are not in the first tenant.
        </p>
      </div>
      <ChannelSetup />
    </div>
  );
}
