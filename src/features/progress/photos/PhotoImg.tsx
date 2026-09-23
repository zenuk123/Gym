import { Icon } from '../../../components/Icon';
import { usePhotoUrl } from './photoStore';

export function PhotoImg({ id, which = 'thumb', alt, className }: { id: string; which?: 'thumb' | 'full'; alt: string; className?: string }) {
  const { url, missing } = usePhotoUrl(id, which);
  if (url) return <img src={url} alt={alt} className={className} draggable={false} />;
  return (
    <div className={`photo-missing ${className ?? ''}`} role="img" aria-label={missing ? `${alt} (not on this device)` : `${alt} loading`}>
      {missing && (
        <>
          <Icon name="cloudOff" />
          <small>Not on this device</small>
        </>
      )}
    </div>
  );
}
