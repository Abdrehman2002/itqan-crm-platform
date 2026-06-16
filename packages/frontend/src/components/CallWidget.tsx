import { useRef, useState } from 'react';
import { Phone, PhoneOff, Loader2, AlertCircle, Headphones, TrendingUp, ChevronUp } from 'lucide-react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { api } from '../services/api';

type Status = 'idle' | 'connecting' | 'live' | 'error';
type AgentKey = 'nadia' | 'sara' | 'zara';

interface AgentDef {
  key: AgentKey;
  label: string;
  tagline: string;
  color: string;
  icon: typeof Phone;
}

const AGENTS: AgentDef[] = [
  { key: 'nadia', label: 'Complaints (Nadia)', tagline: 'File a complaint',     color: '#dc2626', icon: AlertCircle },
  { key: 'sara',  label: 'Support (Sara)',     tagline: 'Product & FAQ',         color: '#16a34a', icon: Headphones },
  { key: 'zara',  label: 'Sales (Zara)',       tagline: 'New loan / account',    color: '#2563eb', icon: TrendingUp },
];

/**
 * Floating multi-agent call widget. Idle state shows a menu of agents
 * (Nadia / Sara / Zara). Picking one asks the backend to dispatch that
 * specific LiveKit agent into a fresh room.
 */
export function CallWidget() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AgentDef | null>(null);
  const roomRef = useRef<Room | null>(null);
  const elsRef = useRef<HTMLMediaElement[]>([]);

  function cleanup() {
    try { roomRef.current?.disconnect(); } catch { /* noop */ }
    roomRef.current = null;
    elsRef.current.forEach((el) => { try { el.remove(); } catch { /* noop */ } });
    elsRef.current = [];
  }

  async function start(agent: AgentDef) {
    setMenuOpen(false);
    setActiveAgent(agent);
    setStatus('connecting');
    setError('');
    try {
      const res = await api.post('/api/v1/voice/web-call', { agentName: agent.key });
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
      room.on(RoomEvent.Disconnected, () => { cleanup(); setStatus('idle'); setActiveAgent(null); });

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
    setActiveAgent(null);
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
          padding: '6px 10px', borderRadius: 8, fontSize: 12, maxWidth: 280 }}>
          {error}
        </div>
      )}

      {/* Agent picker menu — opens upward */}
      {menuOpen && (status === 'idle' || status === 'error') && (
        <div style={{
          marginBottom: 10, background: '#fff', borderRadius: 14,
          boxShadow: '0 12px 30px rgba(0,0,0,.18)', padding: 8,
          minWidth: 260, display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ padding: '8px 12px 4px', fontSize: 11, fontWeight: 700,
            color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Pick an assistant
          </div>
          {AGENTS.map((a) => {
            const Icon = a.icon;
            return (
              <button key={a.key} onClick={() => start(a)} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 10, border: 0,
                background: 'transparent', cursor: 'pointer', textAlign: 'left',
                transition: 'background .15s',
              }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#f1f5f9'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 999, background: a.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                }}>
                  <Icon size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{a.label}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{a.tagline}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Main button */}
      {(status === 'idle' || status === 'error') && (
        <button
          onClick={() => setMenuOpen((v) => !v)}
          style={{ ...base, background: '#0f172a' }}
          title="Call an assistant"
        >
          <Phone size={18} />
          {menuOpen ? 'Close' : 'Call assistant'}
          <ChevronUp size={16} style={{ transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
        </button>
      )}
      {status === 'connecting' && (
        <button disabled style={{ ...base, background: '#64748b', cursor: 'default' }}>
          <Loader2 size={18} className="animate-spin" />
          Connecting to {activeAgent?.label ?? '…'}
        </button>
      )}
      {status === 'live' && activeAgent && (
        <button onClick={end} style={{ ...base, background: activeAgent.color }} title="End call">
          <PhoneOff size={18} />
          End call — {activeAgent.label} is live
        </button>
      )}
    </div>
  );
}
