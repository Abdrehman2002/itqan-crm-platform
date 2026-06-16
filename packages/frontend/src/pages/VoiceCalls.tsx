import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Bot, User, Mic, MicOff, Clock } from 'lucide-react';
import { api } from '../services/api';
import { formatDuration, formatDate } from '../utils/format';
import { useAuthStore } from '../store/auth.store';

type CallFilter = 'all' | 'inbound' | 'outbound';
type StatusFilter = 'all' | 'completed' | 'no-answer' | 'failed';

export function VoiceCalls() {
  const [callFilter, setCallFilter] = useState<CallFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedCall, setSelectedCall] = useState<any>(null);
  const [liveTranscript, setLiveTranscript] = useState<Array<{ speaker: string; text: string }>>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const { token } = useAuthStore();

  const { data: callsData, isLoading } = useQuery({
    queryKey: ['voice-calls', callFilter, statusFilter],
    queryFn: () =>
      api.get('/api/v1/voice/calls', {
        params: {
          direction: callFilter !== 'all' ? callFilter : undefined,
          status: statusFilter !== 'all' ? statusFilter : undefined,
        },
      }).then((r) => r.data),
    refetchInterval: 10_000,
  });

  const { data: analyticsData } = useQuery({
    queryKey: ['voice-analytics'],
    queryFn: () => api.get('/api/v1/voice/analytics').then((r) => r.data.data),
  });

  // Connect to live stream when a call is selected
  useEffect(() => {
    if (!selectedCall || selectedCall.status !== 'in-progress') return;

    const wsUrl = `${import.meta.env.VITE_WS_URL}/api/v1/voice/calls/${selectedCall.id}/stream?token=${token}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === 'transcript') {
        setLiveTranscript((prev) => [...prev, { speaker: data.speaker, text: data.text }]);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      setLiveTranscript([]);
    };
  }, [selectedCall?.id]);

  const initiateMutation = useMutation({
    mutationFn: (data: { contactId?: string; toNumber: string; fromNumber: string }) =>
      api.post('/api/v1/voice/calls/initiate', data),
  });

  const calls = callsData?.data ?? [];

  const getStatusIcon = (status: string, direction: string) => {
    if (status === 'no-answer' || status === 'failed') return <PhoneMissed className="w-4 h-4 text-red-500" />;
    if (direction === 'inbound') return <PhoneIncoming className="w-4 h-4 text-blue-500" />;
    return <PhoneOutgoing className="w-4 h-4 text-emerald-500" />;
  };

  return (
    <div className="flex h-full">
      {/* Call list */}
      <div className="w-1/2 border-r border-gray-100 flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-semibold text-gray-900">Voice Calls</h1>
            <button
              onClick={() => {
                const toNumber = prompt('Enter phone number to call:');
                if (toNumber) initiateMutation.mutate({ toNumber, fromNumber: '+1000000000' });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white text-sm rounded-lg hover:bg-brand-700"
            >
              <Phone className="w-4 h-4" />
              Initiate Call
            </button>
          </div>

          {/* Stats strip */}
          {analyticsData && (
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { label: 'Total', value: analyticsData.total_calls },
                { label: 'Bot handled', value: analyticsData.bot_handled },
                { label: 'Avg duration', value: `${analyticsData.avg_duration_seconds ?? 0}s` },
                { label: 'Minutes', value: analyticsData.total_minutes ?? 0 },
              ].map((s) => (
                <div key={s.label} className="bg-gray-50 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-gray-900">{s.value}</p>
                  <p className="text-xs text-gray-500">{s.label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-1">
            {(['all', 'inbound', 'outbound'] as CallFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setCallFilter(f)}
                className={`px-3 py-1 text-xs rounded-full capitalize transition-colors ${
                  callFilter === f ? 'bg-brand-100 text-brand-700 font-medium' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-gray-400 text-sm">Loading calls...</div>
          ) : calls.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No calls found</div>
          ) : (
            calls.map((call: any) => (
              <div
                key={call.id}
                onClick={() => setSelectedCall(call)}
                className={`p-4 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${
                  selectedCall?.id === call.id ? 'bg-brand-50 border-l-2 border-l-brand-500' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(call.status, call.direction)}
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {call.contact_name ?? call.from_number}
                      </p>
                      <p className="text-xs text-gray-500">{call.direction === 'inbound' ? call.from_number : call.to_number}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{formatDate(call.started_at)}</p>
                    {call.duration && (
                      <p className="text-xs text-gray-500 flex items-center gap-0.5 justify-end mt-0.5">
                        <Clock className="w-3 h-3" />
                        {formatDuration(call.duration)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {call.bot_handled && (
                    <span className="flex items-center gap-0.5 text-xs text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                      <Bot className="w-3 h-3" />
                      Bot
                    </span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    call.status === 'completed' ? 'bg-green-50 text-green-700' :
                    call.status === 'in-progress' ? 'bg-blue-50 text-blue-700 animate-pulse' :
                    'bg-red-50 text-red-700'
                  }`}>
                    {call.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Call detail panel */}
      <div className="w-1/2 flex flex-col">
        {selectedCall ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Call Detail</h2>
              <span className={`text-sm px-2 py-0.5 rounded-full ${
                selectedCall.status === 'completed' ? 'bg-green-100 text-green-700' :
                selectedCall.status === 'in-progress' ? 'bg-blue-100 text-blue-700 animate-pulse' :
                'bg-red-100 text-red-700'
              }`}>
                {selectedCall.status}
              </span>
            </div>

            {/* Live transcript */}
            {selectedCall.status === 'in-progress' && (
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Mic className="w-4 h-4 text-blue-600 animate-pulse" />
                  <span className="text-sm font-medium text-blue-700">Live Transcript</span>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {liveTranscript.map((line, i) => (
                    <div key={i} className={`flex gap-2 text-sm ${line.speaker === 'bot' ? 'text-violet-700' : 'text-gray-700'}`}>
                      {line.speaker === 'bot' ? <Bot className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <User className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                      <span>{line.text}</span>
                    </div>
                  ))}
                  {liveTranscript.length === 0 && <p className="text-blue-600 text-xs">Waiting for speech...</p>}
                </div>
              </div>
            )}

            {/* Recorded transcript */}
            {selectedCall.transcript && (
              <div className="bg-gray-50 rounded-xl p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Transcript</h3>
                <div className="space-y-2">
                  {selectedCall.transcript.map((line: any, i: number) => (
                    <div key={i} className="flex gap-2 text-sm">
                      {line.speaker === 'bot'
                        ? <Bot className="w-3.5 h-3.5 mt-0.5 text-violet-500 shrink-0" />
                        : <User className="w-3.5 h-3.5 mt-0.5 text-gray-500 shrink-0" />}
                      <div>
                        <span className="text-xs text-gray-400 mr-1">[{line.timestamp}s]</span>
                        <span className="text-gray-700">{line.text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Detected intent */}
            {selectedCall.bot_intent && (
              <div className="bg-violet-50 rounded-xl p-4">
                <h3 className="text-sm font-medium text-violet-700 mb-2">Bot Intent</h3>
                <p className="text-sm font-bold text-violet-900">{selectedCall.bot_intent}</p>
                {selectedCall.bot_entities && (
                  <div className="mt-2 space-y-1">
                    {Object.entries(selectedCall.bot_entities).map(([k, v]) => (
                      <div key={k} className="flex gap-2 text-xs">
                        <span className="text-violet-600 font-medium">{k}:</span>
                        <span className="text-violet-800">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <Phone className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Select a call to view details</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
