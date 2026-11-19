import { useEffect } from 'react';
import { useRouteError } from 'react-router-dom';
import { isChunkLoadError, reloadOnceForChunk } from './lazyWithReload';

/** Router errorElement: recover from chunk misses that slip past lazy(). */
export default function ChunkLoadErrorPage() {
  const error = useRouteError();
  const chunkMiss = isChunkLoadError(error);

  useEffect(() => {
    if (chunkMiss) reloadOnceForChunk();
  }, [chunkMiss]);

  if (chunkMiss) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">Updating the app…</p>
        <p className="text-xs text-muted-foreground">A newer build is live. Reloading once.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-lg font-semibold">Unexpected Application Error!</p>
      <p className="max-w-lg text-sm text-muted-foreground">{String(error?.message || error || 'Something went wrong')}</p>
      <button
        type="button"
        className="rounded-lg border px-3 py-1.5 text-sm"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}
