import { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import clsx from 'clsx';

interface ProjectImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  containerClassName?: string;
  iconClassName?: string;
}

export function ProjectImage({
  src,
  alt,
  className = 'h-full w-full object-cover',
  containerClassName = 'flex h-24 w-28 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 relative',
  iconClassName = 'h-10 w-10 text-slate-400',
}: ProjectImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setError(false);

    if (!src) return;

    const img = new Image();
    img.src = src;
    img.onload = () => setLoaded(true);
    img.onerror = () => setError(true);
  }, [src]);

  if (!src || error) {
    return (
      <div className={containerClassName}>
        <Building2 className={iconClassName} />
      </div>
    );
  }

  return (
    <div className={containerClassName}>
      {/* Show placeholder icon while image is loading */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 animate-pulse">
          <Building2 className={clsx(iconClassName, 'opacity-40')} />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={clsx(
          className,
          'transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  );
}
