import ChannelSetup from '../../components/channels/ChannelSetup';

export default function ChannelsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-2">Channels</h1>
        <p className="text-muted-foreground">
          Every channel’s keys belong to this company. Another company’s Super Admin cannot see or reuse them. Orders, listings and stock from each API show on the same screens.
        </p>
      </div>
      <ChannelSetup />
    </div>
  );
}
