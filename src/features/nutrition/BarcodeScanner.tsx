import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/Sheet';
import { db } from '../../db/db';
import type { Food } from '../../db/types';
import { lookupBarcode, type OffFood } from '../../lib/openFoodFacts';
import { useOnline } from '../../pwa/platform';

type Found = Food | OffFood;

interface Detector {
  detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

/**
 * Scan a product barcode with the camera. Uses the browser's BarcodeDetector where it
 * exists (Android/Chrome) and a lazily-loaded JS decoder elsewhere (iPhone Safari has none).
 * Foods you've scanned before are found offline; new ones come from Open Food Facts.
 */
export function BarcodeScanner({ onFound, onClose }: { onFound: (f: Found) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const online = useOnline();
  const [status, setStatus] = useState<'starting' | 'scanning' | 'looking' | 'notfound' | 'error'>('starting');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const done = useRef(false);

  async function resolve(raw: string) {
    if (done.current) return;
    const clean = raw.replace(/\D/g, '');
    if (clean.length < 6) return;
    done.current = true;
    setCode(clean);
    setStatus('looking');
    const local = (await db.foods.where('barcode').equals(clean).toArray()).find((f) => f.deletedAt === null);
    if (local) return onFound(local);
    if (!navigator.onLine) {
      setStatus('notfound');
      setMessage('You’re offline and this product isn’t in your foods yet.');
      return;
    }
    try {
      const f = await lookupBarcode(clean);
      if (f) return onFound(f);
      setStatus('notfound');
      setMessage('Product not found in the online database.');
    } catch {
      setStatus('notfound');
      setMessage('Couldn’t reach the online database.');
    }
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    let raf = 0;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
        if (cancelled || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        setStatus('scanning');
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        if (BD) {
          const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] });
          const tick = async () => {
            if (cancelled || done.current || !video.current) return;
            try {
              const [hit] = await detector.detect(video.current);
              if (hit) return void resolve(hit.rawValue);
            } catch {
              /* frame not ready */
            }
            raf = requestAnimationFrame(() => void tick());
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const { BarcodeFormat, DecodeHintType } = await import('@zxing/library');
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128]);
          const reader = new BrowserMultiFormatReader(hints);
          if (cancelled || !video.current) return;
          const controls = await reader.decodeFromVideoElement(video.current, (result) => {
            if (result) void resolve(result.getText());
          });
          stopZxing = () => controls.stop();
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
          setMessage('Camera unavailable. Allow camera access in Settings, or type the barcode below.');
        }
      }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Sheet title="Scan barcode" onClose={onClose}>
      <div className="scanner">
        <video ref={video} playsInline muted autoPlay />
        <div className="scanner-frame" aria-hidden="true" />
        <span className="scanner-status">
          {status === 'starting' && 'Starting camera…'}
          {status === 'scanning' && 'Point at the barcode'}
          {status === 'looking' && `Looking up ${code}…`}
          {(status === 'notfound' || status === 'error') && (message ?? '')}
        </span>
      </div>
      <form
        className="barcode-manual"
        onSubmit={(e) => {
          e.preventDefault();
          done.current = false;
          void resolve(code);
        }}
      >
        <div className="input-wrap">
          <input inputMode="numeric" placeholder="Or type the barcode number" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-label="Barcode number" />
        </div>
        <button className="btn" disabled={code.length < 6}>
          Look up
        </button>
      </form>
      {status === 'notfound' && (
        <Link to={`/nutrition/foods/new?barcode=${code}`} className="btn btn-primary btn-block">
          <Icon name="plus" /> Add it as a new food
        </Link>
      )}
      {!online && status !== 'notfound' && <p className="faint" style={{ fontSize: 13 }}>Offline: only products you’ve scanned before can be found.</p>}
    </Sheet>
  );
}
