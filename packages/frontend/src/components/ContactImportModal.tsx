/**
 * ContactImportModal
 *
 * Three-step CSV import flow:
 *   1. Upload — drag-and-drop or click to upload a .csv file
 *   2. Map    — map CSV columns → CRM fields with auto-detection
 *   3. Result — show imported / skipped / error counts
 */

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Upload, ChevronRight, CheckCircle2, AlertCircle,
  Loader2, FileText, RefreshCw,
} from 'lucide-react';
import { api } from '../services/api';

// ── CRM fields available for mapping ──────────────────────────────────────
const CRM_FIELDS = [
  { key: 'firstName',  label: 'First Name',  required: true },
  { key: 'lastName',   label: 'Last Name' },
  { key: 'email',      label: 'Email' },
  { key: 'phone',      label: 'Phone' },
  { key: 'mobile',     label: 'Mobile' },
  { key: 'jobTitle',   label: 'Job Title' },
  { key: 'status',     label: 'Status (lead/prospect/customer)' },
  { key: 'source',     label: 'Source' },
  { key: '__skip__',   label: '— Skip this column —' },
] as const;

// Auto-detect mapping from CSV header names
function autoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const rules: [RegExp, string][] = [
    [/first.?name|fname|given/i,      'firstName'],
    [/last.?name|lname|surname|family/i, 'lastName'],
    [/^name$/i,                        'firstName'],
    [/e.?mail/i,                       'email'],
    [/^phone|tel|telephone/i,          'phone'],
    [/mobile|cell/i,                   'mobile'],
    [/job.?title|position|role/i,      'jobTitle'],
    [/status/i,                        'status'],
    [/source|channel/i,                'source'],
  ];
  for (const h of headers) {
    let matched = '__skip__';
    for (const [re, field] of rules) {
      if (re.test(h)) { matched = field; break; }
    }
    map[h] = matched;
  }
  return map;
}

// Parse CSV text → { headers, rows }
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        result.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const vals = parseRow(l);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ''; });
      return obj;
    });

  return { headers, rows };
}

// ── Component ──────────────────────────────────────────────────────────────
type Step = 'upload' | 'map' | 'result';

interface Props { onClose: () => void }

export function ContactImportModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [step, setStep]       = useState<Step>('upload');
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders]   = useState<string[]>([]);
  const [rows, setRows]         = useState<Record<string, string>[]>([]);
  const [mapping, setMapping]   = useState<Record<string, string>>({});
  const [result, setResult]     = useState<{ imported: number; skipped: number; errors: any[] } | null>(null);

  const importMutation = useMutation({
    mutationFn: (body: { rows: typeof rows; mapping: typeof mapping }) =>
      api.post('/api/v1/contacts/import', body),
    onSuccess: (res) => {
      setResult(res.data.data);
      setStep('result');
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  const loadFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv')) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const { headers: h, rows: r } = parseCSV(e.target?.result as string);
      setHeaders(h);
      setRows(r);
      setMapping(autoMap(h));
      setStep('map');
    };
    reader.readAsText(file);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  }, [loadFile]);

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file);
  };

  const preview = rows.slice(0, 3);
  const mappedCRMFields = Object.values(mapping).filter((v) => v !== '__skip__');
  const hasFirstName = mappedCRMFields.includes('firstName');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">Import Contacts</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {step === 'upload' && 'Upload a CSV file to import contacts'}
              {step === 'map'    && `${rows.length} rows detected — map columns to CRM fields`}
              {step === 'result' && 'Import complete'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-50 shrink-0">
          {(['upload', 'map', 'result'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full text-xs font-semibold flex items-center justify-center transition-colors ${
                step === s ? 'bg-brand-600 text-white'
                : (step === 'map' && s === 'upload') || step === 'result'
                  ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
              }`}>{i + 1}</div>
              <span className={`text-xs capitalize ${step === s ? 'text-brand-700 font-medium' : 'text-gray-400'}`}>{s}</span>
              {i < 2 && <ChevronRight className="w-3 h-3 text-gray-300" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">

          {/* ── STEP 1: UPLOAD ── */}
          {step === 'upload' && (
            <div className="p-6 space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${
                  dragging ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-brand-300 hover:bg-gray-50'
                }`}
                onClick={() => document.getElementById('csv-input')?.click()}
              >
                <Upload className={`w-10 h-10 mx-auto mb-3 ${dragging ? 'text-brand-500' : 'text-gray-300'}`} />
                <p className="text-sm font-medium text-gray-700">Drop your CSV here, or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">Max 5 000 rows · UTF-8 CSV</p>
                <input id="csv-input" type="file" accept=".csv" className="hidden" onChange={onFileInput} />
              </div>

              {/* Template download */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-600 mb-2">Expected CSV columns (first row = header)</p>
                <code className="text-xs text-gray-500 font-mono">
                  First Name, Last Name, Email, Phone, Job Title, Status, Source
                </code>
                <button
                  className="mt-3 flex items-center gap-1.5 text-xs text-brand-600 hover:underline"
                  onClick={() => {
                    const csv = 'First Name,Last Name,Email,Phone,Mobile,Job Title,Status,Source\nJane,Doe,jane@example.com,+1234567890,,Sales Manager,lead,website\n';
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
                    a.download = 'contacts_template.csv';
                    a.click();
                  }}
                >
                  <FileText className="w-3.5 h-3.5" /> Download template
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: MAP ── */}
          {step === 'map' && (
            <div className="p-6 space-y-5">
              {/* Filename badge */}
              <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <span className="font-mono text-xs">{fileName}</span>
                <span className="text-gray-400">·</span>
                <span className="text-xs">{rows.length} rows</span>
                <button onClick={() => setStep('upload')} className="ml-auto text-xs text-brand-600 hover:underline flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Change file
                </button>
              </div>

              {/* Column mapping table */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Column mapping</p>
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">CSV Column</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Preview</th>
                        <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Maps to</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {headers.map((h) => (
                        <tr key={h} className={mapping[h] === '__skip__' ? 'opacity-40' : ''}>
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{h}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-400 max-w-[120px] truncate">
                            {preview.map((r) => r[h]).filter(Boolean).join(', ') || '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            <select
                              value={mapping[h] ?? '__skip__'}
                              onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                              className="w-full text-xs px-2 py-1.5 border border-gray-200 rounded-lg outline-none focus:border-brand-400"
                            >
                              {CRM_FIELDS.map((f) => (
                                <option key={f.key} value={f.key}>{f.label}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Validation hint */}
              {!hasFirstName && (
                <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  Map at least one column to <strong>First Name</strong> — rows without it will be skipped.
                </div>
              )}
            </div>
          )}

          {/* ── STEP 3: RESULT ── */}
          {step === 'result' && result && (
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-green-50 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-green-700">{result.imported}</p>
                  <p className="text-xs text-green-600 mt-1">Imported</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-amber-700">{result.skipped}</p>
                  <p className="text-xs text-amber-600 mt-1">Skipped</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-gray-700">{rows.length}</p>
                  <p className="text-xs text-gray-500 mt-1">Total rows</p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500">Row errors (first 20):</p>
                  {result.errors.map((e: any, i: number) => (
                    <div key={i} className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">
                      Row {e.row}: {e.reason}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-xl p-3">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                {result.imported > 0
                  ? `${result.imported} contact${result.imported !== 1 ? 's' : ''} added to your CRM. Duplicates were merged by email.`
                  : 'No new contacts were imported.'}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex gap-2">
          {step === 'upload' && (
            <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          )}

          {step === 'map' && (
            <>
              <button onClick={() => setStep('upload')}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Back
              </button>
              <button
                onClick={() => importMutation.mutate({ rows, mapping })}
                disabled={!hasFirstName || importMutation.isPending}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {importMutation.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Importing…</>
                  : `Import ${rows.length} contacts`}
              </button>
            </>
          )}

          {step === 'result' && (
            <button onClick={onClose}
              className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
