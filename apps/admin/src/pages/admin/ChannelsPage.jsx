import ChannelSetup from '../../components/channels/ChannelSetup';

export default function ChannelsPage() {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-bold">Channels</h1>
        <p className="text-muted-foreground">
          Every channel’s keys belong to this company. Another company’s Super Admin cannot see or reuse them. Orders, listings and stock from each API show on the same screens.
        </p>
      </div>
      <ChannelSetup />
    </div>
  );
}
