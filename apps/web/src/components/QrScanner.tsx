import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff } from 'lucide-react';
import { Button, Notice } from './ui';

/**
 * Camera QR scanner for the operator web portal. Uses the native
 * BarcodeDetector where the browser has one, otherwise decodes frames with
 * jsQR. Every decoded token is sent to the server, which verifies the
 * signature — the browser never decides validity.
 */
export const QrScanner: React.FC<{ onScan: (token: string) => Promise<void>; paused?: boolean }> = ({ onScan, paused }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const lastRef = useRef<{ token: string; at: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    const Detector = (window as any).BarcodeDetector;
    const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        timer = window.setInterval(async () => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || busyRef.current || paused || video.readyState < 2) return;
          let token: string | null = null;
          if (detector) {
            const codes = await detector.detect(video).catch(() => []);
            token = codes[0]?.rawValue ?? null;
          } else {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            token = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          if (!token) return;
          // ignore the same code re-detected within 4 s
          if (lastRef.current && lastRef.current.token === token && Date.now() - lastRef.current.at < 4000) return;
          lastRef.current = { token, at: Date.now() };
          busyRef.current = true;
          try {
            await onScan(token);
          } finally {
            busyRef.current = false;
          }
        }, 250);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Camera unavailable');
        setActive(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active, onScan, paused]);

  return (
    <div>
      {error && <Notice tone="warn">Camera error: {error}. Allow camera access (HTTPS or localhost is required by browsers).</Notice>}
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video mb-3">
        <video ref={videoRef} className={`w-full h-full object-cover ${active ? '' : 'hidden'}`} muted playsInline />
        {!active && <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Camera off</div>}
        {active && <div className="absolute inset-8 border-2 border-teal-400/70 rounded-xl pointer-events-none" />}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <Button tone={active ? 'ghost' : 'primary'} onClick={() => setActive((a) => !a)}>
        {active ? <><CameraOff className="w-3.5 h-3.5" /> Stop camera</> : <><Camera className="w-3.5 h-3.5" /> Start camera scanner</>}
      </Button>
    </div>
  );
};
