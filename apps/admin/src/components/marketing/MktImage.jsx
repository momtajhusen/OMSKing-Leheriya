import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { IMAGE_SIZES, MARKETING_IMAGES, imageSources } from '../../constants/marketingImages';
import useMarketingImageStore from '../../stores/marketingImageStore';
import { mediaUrl } from '../account/ProfilePhoto';
import { cn } from '../../lib/utils';

const ASPECT = { landscape: 'aspect-[3/2]', square: 'aspect-square', portrait: 'aspect-[2/3]' };

export default function MktImage({ name, className, aspectClassName, imgClassName, priority = false }) {
  const spec = MARKETING_IMAGES[name];
  const size = IMAGE_SIZES[spec.size];
  const uploaded = useMarketingImageStore((state) => state.images[name]);
  const status = useMarketingImageStore((state) => state.status);
  const load = useMarketingImageStore((state) => state.load);
  const sources = imageSources(name, mediaUrl(uploaded?.url));
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const waiting = status === 'idle' || status === 'loading';
  const missing = index >= sources.length;

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [sources[0]]);

  return (
    <figure
      data-image={name}
      className={cn('mkt-image group/img relative isolate overflow-hidden rounded-3xl bg-emerald-50', aspectClassName || ASPECT[spec.size], className)}
    >
      {!waiting && !missing && (
        <img
          key={sources[index]}
          src={sources[index]}
          alt={uploaded?.alt || spec.alt}
          width={size.width}
          height={size.height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((current) => current + 1)}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition duration-700 ease-out group-hover/img:scale-[1.03]',
            loaded ? 'opacity-100' : 'opacity-0',
            imgClassName
          )}
        />
      )}
      {!waiting && missing && (
        <div className="mkt-image-fallback absolute inset-0 flex items-center justify-center p-4">
          <div data-image-label className="relative flex max-w-full flex-col items-center gap-1 rounded-2xl bg-white/10 px-4 py-3 text-center text-white ring-1 ring-white/20 backdrop-blur-sm">
            <ImageIcon className="h-5 w-5 text-lime-200" aria-hidden="true" />
            <p className="max-w-full break-all font-mono text-xs font-bold sm:text-sm">{name}.png</p>
            <p className="text-[11px] text-emerald-50/80">{size.width} × {size.height} px · {size.label}</p>
          </div>
        </div>
      )}
    </figure>
  );
}
