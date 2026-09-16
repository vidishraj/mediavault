import { useEffect, useState } from 'react';
import { Banner } from './Banner';
import { messageForError } from '@/lib/messages';

/**
 * A persistent strip shown whenever the browser reports no connection, so
 * "offline" is a first-class state the user always sees, not something they only
 * discover when an action fails. Driven by real online/offline events, never by
 * inspecting an error string.
 */
export function OfflineBanner() {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  if (online) return null;
  return <Banner message={messageForError('offline')} />;
}
