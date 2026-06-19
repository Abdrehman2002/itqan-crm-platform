import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, Trash2, Star, FileText, Layout, Copy, CheckCircle2, Loader2, X } from 'lucide-react';
import { INVOICE_TEMPLATES } from './types';

// ── Preset gallery (hardcoded sector themes) ──────────────────────────────────

const ACCENT_BG: Record<string, string> = {
  '#2563eb': 'bg-blue-600', '#0f172a': 'bg-slate-900', '#4f46e5': 'bg-indigo-600',
  '#f97316': 'bg-orange-500', '#d97706': 'bg-amber-600', '#0d9488': 'bg-teal-600',
  '#9333ea': 'bg-purple-600', '#0284c7': 'bg-sky-600',
};
const ACCENT_TEXT: Record<string, string> = {
  '#2563eb': 'text-blue-600', '#0f172a': 'text-slate-900', '#4f46e5': 'text-indigo-600',
  '#f97316': 'text-orange-500', '#d97706': 'text-amber-600', '#0d9488': 'text-teal-600',
  '#9333ea': 'text-purple-600', '#0284c7': 'text-sky-600',
};

// ── Merge field reference ─────────────────────────────────────────────────────

interface MergeField { field: string; description: string; }

const MERGE_FIELDS_FALLBACK: MergeField[] = [
  { field: '{{invoice_number}}',   description: 'Invoice number, e.g. INV-0042' },
  { field: '{{issue_date}}',       description: 'Date the invoice was issued' },
  { field: '{{due_date}}',         description: 'Payment due date' },
  { field: '{{currency}}',         description: 'Currency code, e.g. GBP' },
  { field: '{{subtotal}}',         description: 'Subtotal before tax' },
  { field: '{{tax}}',              description: 'Total tax amount' },
  { field: '{{total}}',            description: 'Grand total' },
  { field: '{{notes}}',            description: 'Invoice notes' },
  { field: '{{terms}}',            description: 'Payment terms' },
  { field: '{{client_name}}',      description: 'Billing contact name' },
  { field: '{{client_email}}',     description: 'Billing contact email' },
  { field: '{{client_company}}',   description: 'Billing contact company' },
  { field: '{{client_address}}',   description: 'Billing contact address' },
  { field: '{{company_name}}',     description: 'Your company name' },
  { field: '{{company_email}}',    description: 'Your company email' },
  { field: '{{company_address}}',  description: 'Your company address' },
  { field: '{{line_items_table}}', description: 'Full line items table' },
  { field: '{{po_reference}}',     description: 'Purchase order reference number' },
];

function MergeFieldRow({ field, description }: MergeField) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(field);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex items-center gap-3 py-1.5 group">
      <code className="text-xs bg-gray-100 text-blue-700 px-2 py-0.5 rounded font-mono flex-shrink-0">{field}</code>
      <span className="text-xs text-gray-500 flex-1">{description}</span>
      <button onClick={copy} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity" title="Copy">
        {copied ? <CheckCircle2 size={13} className="text-green-500" /> : <Copy size={13} />}
      </button>
    </div>
  );
}

// ── Saved templates list (builder + docx) ─────────────────────────────────────

interface SavedTemplate {
  id: string; name: string; type: 'builder' | 'docx';
  file_name?: string; is_default: boolean; created_at: string;
}

function SavedTemplateRow({ tpl, onDelete, onSetDefault }: {
  tpl: SavedTemplate;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${tpl.type === 'docx' ? 'bg-orange-50 text-orange-500' : 'bg-blue-50 text-blue-500'}`}>
        {tpl.type === 'docx' ? <FileText size={16} /> : <Layout size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate flex items-center gap-1.5">
          {tpl.name}
          {tpl.is_default && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">Default</span>}
        </div>
        <div className="text-xs text-gray-400">{tpl.type === 'docx' ? tpl.file_name : 'Builder layout'} · {new Date(tpl.created_at).toLocaleDateString()}</div>
      </div>
      <div className="flex gap-1">
        {!tpl.is_default && (
          <button onClick={onSetDefault} title="Set as default" className="p-1.5 text-gray-400 hover:text-amber-500 rounded-lg hover:bg-amber-50 transition-colors">
            <Star size={14} />
          </button>
        )}
        <button onClick={onDelete} title="Delete" className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SalesTemplates() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'presets' | 'saved' | 'upload'>('presets');
  const [selectedPreset, setSelectedPreset] = useState('tpl-classic');
  const [mergeFields, setMergeFields] = useState<MergeField[]>(MERGE_FIELDS_FALLBACK);
  const [savedTemplates, setSavedTemplates] = useState<SavedTemplate[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/v1/sales/templates/merge-fields', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.data && setMergeFields(d.data))
      .catch(() => {});
  }, []);

  const loadSaved = () => {
    setLoadingSaved(true);
    fetch('/api/v1/sales/templates', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => setSavedTemplates(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingSaved(false));
  };

  useEffect(() => { if (activeTab === 'saved') loadSaved(); }, [activeTab]);

  const handleUpload = async (file: File) => {
    if (!file.name.endsWith('.docx') && !file.name.endsWith('.html')) {
      setUploadError('Only .docx and .html files are supported.');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/v1/sales/templates/upload?name=${encodeURIComponent(file.name.replace(/\.[^.]+$/, ''))}`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        setSavedTemplates(prev => [data.data, ...prev]);
        setActiveTab('saved');
      } else {
        setUploadError(data.error ?? 'Upload failed');
      }
    } catch {
      setUploadError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/v1/sales/templates/${id}`, { method: 'DELETE', credentials: 'include' });
    setSavedTemplates(prev => prev.filter(t => t.id !== id));
  };

  const handleSetDefault = async (id: string) => {
    await fetch(`/api/v1/sales/templates/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDefault: true }),
    });
    setSavedTemplates(prev => prev.map(t => ({ ...t, is_default: t.id === id })));
  };

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Invoice Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Choose a preset, build a custom layout, or upload your own template.</p>
        </div>
        <button onClick={() => navigate('/sales/builder')}
          className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 flex items-center gap-2">
          <Layout size={14} /> Open Builder
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['presets', 'saved', 'upload'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize rounded-t-lg transition-colors -mb-px ${activeTab === tab ? 'border border-b-white border-gray-200 text-blue-600 bg-white' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab === 'saved' ? 'Saved Templates' : tab === 'upload' ? 'Upload Template' : 'Preset Gallery'}
          </button>
        ))}
      </div>

      {/* Preset Gallery */}
      {activeTab === 'presets' && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 mb-6">
            {INVOICE_TEMPLATES.map(tpl => {
              const isSelected = selectedPreset === tpl.id;
              const bg = ACCENT_BG[tpl.accentColor] ?? 'bg-blue-600';
              const tx = ACCENT_TEXT[tpl.accentColor] ?? 'text-blue-600';
              return (
                <button key={tpl.id} onClick={() => setSelectedPreset(tpl.id)}
                  className={`relative text-left rounded-xl border-2 transition-all overflow-hidden bg-white hover:shadow-md ${isSelected ? 'border-blue-600 shadow-lg shadow-blue-100' : 'border-gray-200'}`}>
                  {isSelected && (
                    <div className="absolute top-2 right-2 z-10">
                      <CheckCircle2 size={20} className="text-blue-600 fill-white" />
                    </div>
                  )}
                  <div className={`${bg} h-36 p-4 flex flex-col justify-between`}>
                    <div className="flex justify-between items-start">
                      <div className="w-8 h-8 bg-white/20 rounded" />
                      <div className="text-right">
                        <div className="w-12 h-1.5 bg-white/60 rounded mb-1 ml-auto" />
                        <div className="w-16 h-2.5 bg-white rounded" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="w-full h-1 bg-white/30 rounded" />
                      <div className="w-3/4 h-1 bg-white/30 rounded" />
                      <div className="w-full h-1 bg-white/30 rounded" />
                    </div>
                  </div>
                  <div className="p-4">
                    <div className={`text-xs font-semibold uppercase tracking-wide ${tx} mb-1`}>{tpl.sector}</div>
                    <div className="font-semibold text-gray-900 text-sm">{tpl.name}</div>
                  </div>
                </button>
              );
            })}
          </div>
          <button onClick={() => navigate(`/sales/invoices/new?template=${selectedPreset}`)}
            className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
            Use Selected Template →
          </button>
        </div>
      )}

      {/* Saved Templates */}
      {activeTab === 'saved' && (
        <div>
          {loadingSaved ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : savedTemplates.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Layout size={36} className="mx-auto mb-3 opacity-30" />
              <div className="text-sm">No saved templates yet.</div>
              <div className="text-xs mt-1">Use the Builder to design and save one, or upload a DOCX file.</div>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {savedTemplates.map(tpl => (
                <SavedTemplateRow key={tpl.id} tpl={tpl}
                  onDelete={() => handleDelete(tpl.id)}
                  onSetDefault={() => handleSetDefault(tpl.id)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Upload */}
      {activeTab === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Drop zone */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Upload your template file</h3>
            <p className="text-xs text-gray-500 mb-4">
              Supported formats: <strong>.docx</strong> (Word) and <strong>.html</strong>. Add merge fields (e.g. <code className="bg-gray-100 px-1 rounded text-blue-700 font-mono text-xs">{"{{invoice_number}}"}</code>) to your file where you want data to appear.
            </p>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleUpload(f); }}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 bg-gray-50'}`}>
              {uploading ? (
                <div className="flex flex-col items-center gap-2 text-gray-500">
                  <Loader2 size={28} className="animate-spin text-blue-500" />
                  <span className="text-sm">Uploading…</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <Upload size={28} />
                  <div className="text-sm font-medium text-gray-700">Drop your file here</div>
                  <div className="text-xs">or click to browse · .docx or .html · max 10 MB</div>
                </div>
              )}
            </div>
            <input ref={fileRef} type="file" accept=".docx,.html" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
            {uploadError && (
              <div className="mt-3 flex items-center gap-2 text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">
                <X size={14} /> {uploadError}
              </div>
            )}
          </div>

          {/* Merge fields reference */}
          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-1">Available merge fields</h3>
            <p className="text-xs text-gray-500 mb-3">Copy and paste these into your Word or HTML file. They will be replaced with real values when an invoice is generated.</p>
            <div className="bg-gray-50 rounded-xl border border-gray-200 px-4 py-2 max-h-80 overflow-y-auto divide-y divide-gray-100">
              {mergeFields.map(f => <MergeFieldRow key={f.field} {...f} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
