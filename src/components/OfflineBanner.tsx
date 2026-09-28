import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';
import { onPendingWritesChange, pendingWriteCount } from '../store/useData';

export function OfflineBanner() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [pending, setPending] = useState(0);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const off = onPendingWritesChange(() => setPending(pendingWriteCount()));
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      off();
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 bg-amber-500/95 px-3 py-1.5 text-xs font-medium text-white">
      <CloudOff className="h-3.5 w-3.5 shrink-0" />
      <span>
        You're offline. Your edits stay on this device and are sent when you're back online{pending ? ` (${pending} waiting)` : ''}. Keep this tab open until then.
      </span>
    </div>
  );
}
