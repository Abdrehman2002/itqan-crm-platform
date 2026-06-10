import { useRef, useState } from 'react';
import { Phone, PhoneOff, Loader2 } from 'lucide-react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { api } from '../services/api';

type Status = 'idle' | 'connecting' | 'live' | 'error';

/**
 * Floating "Call Nadia" button. Clicking it asks the backend to dispatch the
 * LiveKit voice agent into a fresh room and returns a join token; the browser
 * then connects directly to LiveKit (mic up, agent audio down).
 */
export function CallWidget() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const roomRef = useRef<Room | null>(null);
  const elsRef = useRef<HTMLMediaElement[]>([]);

  function cleanup() {
    try { roomRef.current?.disconnect(); } catch { /* noop */ }
    roomRef.current = null;
    elsRef.current.forEach((el) => { try { el.remove(); } catch { /* noop */ } });
    elsRef.current = [];
  }

  async function start() {
    setStatus('connecting');
    setError('');
    try {
      const res = await api.post('/api/v1/voice/web-call', {});
      const { url, token } = res.data.data;

      const room = new Room({ adaptiveStream: true });
      roomRef.current = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          el.autoplay = true;
          (el as HTMLMediaElement).style.display = 'none';
          document.body.appendChild(el);
          elsRef.current.push(el as HTMLMediaElement);
          (el as HTMLAudioElement).play?.().catch(() => { /* will play on gesture */ });
        }
      });
      room.on(RoomEvent.Disconnected, () => { cleanup(); setStatus('idle'); });

      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      setStatus('live');
    } catch (e: any) {
      setError(e?.response?.data?.error?.message || e?.message || 'Could not start the call.');
      setStatus('error');
      cleanup();
    }
  }

  function end() {
    cleanup();
    setStatus('idle');
  }

  const base: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 999,
    padding: '12px 18px', fontWeight: 600, color: '#fff', cursor: 'pointer',
    boxShadow: '0 6px 18px rgba(0,0,0,.22)', fontSize: 14,
  };

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 9999 }}>
      {status === 'error' && (
        <div style={{ marginBottom: 8, background: '#fee2e2', color: '#991b1b',
          padding: '6px 10px', borderRadius: 8, fontSize: 12, maxWidth: 260 }}>
          {error}
        </div>
      )}

      {(status === 'idle' || status === 'error') && (
        <button onClick={start} style={{ ...base, background: '#16a34a' }} title="Call Nadia">
          <Phone size={18} /> Call Nadia
        </button>
      )}
      {status === 'connecting' && (
        <button disabled style={{ ...base, background: '#64748b', cursor: 'default' }}>
          <Loader2 size={18} className="animate-spin" /> Connecting…
        </button>
      )}
      {status === 'live' && (
        <button onClick={end} style={{ ...base, background: '#dc2626' }} title="End call">
          <PhoneOff size={18} /> End call — Nadia is live
        </button>
      )}
    </div>
  );
}
