/**
 * BulkUploadModal
 *
 * A reusable CSV bulk-upload modal that posts the file as multipart to a
 * caller-supplied `/bulk` endpoint and renders inserted-count + per-row errors
 * coming back from the server.
 *
 * Designed to pair with the POST /api/v1/{resource}/bulk endpoints in
 *   - routes/contacts.ts
 *   - routes/companies.ts
 *   - routes/settings.ts  (team/bulk)
 *
 * Unlike ContactImportModal (which parses on the client and ships a JSON
 * blob to /import), this modal is dumb on purpose: the server owns parsing,
 * validation, and the response shape — so adding a new bulk endpoint is just
 * a matter of dropping in a new <BulkUploadModal endpoint=... columns=... />.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Upload, FileText, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { api } from '../services/api';

export interface BulkUploadColumn {
  key:      string;          // CSV column header (lower-case)
  label:    string;          // Human-readable name
  required?: boolean;
  hint?:    string;          // Format hint (e.g. "13 digits — Pakistani CNIC")
}

interface ServerResult {
  inserted: number;
  failed:   { row: number; errors: string[] }[];
}

interface Props {
  /** API endpoint, e.g. "/api/v1/contacts/bulk" */
  endpoint:        string;
  /** Title shown at the top of the modal, e.g. "Bulk Upload Contacts" */
  title:           string;
  /** Column spec rendered as format guidance + used for the sample template */
  columns:         BulkUploadColumn[];
  /** Sample data rows used by the "Download template" button */
  sampleRows:      Record<string, string>[];
  /** React-query keys to invalidate on success */
  invalidateKeys?: string[][];
  /** Called once the user clicks Done */
  onClose:         () => void;
}

export function BulkUploadModal({
  endpoint, title, columns, sampleRows, invalidateKeys = [], onClose,
}: Props) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ServerResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async (f: File) => {
      const fd = new FormData();
      fd.append('file', f, f.name);
      // Override the JSON default — the multipart boundary is set by the browser.
      const res = await api.post(endpoint, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.data as ServerResult;
    },
    onSuccess: (data) => {
      setResult(data);
      setServerError(null);
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key });
    },
    onError: (err: any) => {
      setServerError(err?.response?.data?.error?.message ?? err?.message ?? 'Upload failed');
    },
  });

  const pickFile = useCallback((f: File | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.csv')) {
      setServerError('Only .csv files are supported');
      return;
    }
    setServerError(null);
    setFile(f);
  }, []);

  const downloadTemplate = () => {
    const header = columns.map((c) => c.key).join(',');
    const rows = sampleRows.map((r) =>
      columns.map((c) => {
        const v = r[c.key] ?? '';
        // Quote values containing commas or quotes (RFC 4180 minimum)
        return /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
      }).join(','),
    );
    const csv = [header, ...rows].join('\n') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${title.toLowerCase().replace(/\s+/g, '_')}_template.csv`;
    a.click();
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setServerError(null);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="font-semibold text-gray-900">{title}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {result
                ? `Imported ${result.inserted} of ${result.inserted + result.failed.length} rows`
                : 'Upload a CSV file — first row must be the header'}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {!result ? (
            <>
              {/* Format spec */}
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-600 mb-2">Required CSV columns</p>
                <div className="space-y-1.5">
                  {columns.map((c) => (
                    <div key={c.key} className="flex items-start gap-2 text-xs">
                      <code className="font-mono bg-white border border-gray-200 rounded px-1.5 py-0.5 text-gray-700 shrink-0">
                        {c.key}
                      </code>
                      <div className="min-w-0">
                        <span className="text-gray-700">{c.label}</span>
                        {c.required && <span className="text-red-500 ml-1">*</span>}
                        {c.hint && <p className="text-gray-400 mt-0.5">{c.hint}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={downloadTemplate}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-brand-600 hover:underline"
                >
                  <FileText className="w-3.5 h-3.5" /> Download template CSV
                </button>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]); }}
                onClick={() => document.getElementById('bulk-csv-input')?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                  dragging ? 'border-brand-400 bg-brand-50'
                           : 'border-gray-200 hover:border-brand-300 hover:bg-gray-50'
                }`}
              >
                <Upload className={`w-10 h-10 mx-auto mb-2 ${dragging ? 'text-brand-500' : 'text-gray-300'}`} />
                {file ? (
                  <>
                    <p className="text-sm font-medium text-gray-700">{file.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{(file.size / 1024).toFixed(1)} KB · click to change</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-gray-700">Drop your CSV here, or click to browse</p>
                    <p className="text-xs text-gray-400 mt-1">Max 5 MB · UTF-8 CSV</p>
                  </>
                )}
                <input
                  id="bulk-csv-input"
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
              </div>

              {serverError && (
                <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 px-3 py-2 rounded-lg">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{serverError}</span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Result */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-50 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-green-700">{result.inserted}</p>
                  <p className="text-xs text-green-600 mt-1">Inserted</p>
                </div>
                <div className="bg-amber-50 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-amber-700">{result.failed.length}</p>
                  <p className="text-xs text-amber-600 mt-1">Failed</p>
                </div>
              </div>

              {result.failed.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500">Row errors (showing all {result.failed.length}):</p>
                  <div className="max-h-64 overflow-y-auto space-y-1 pr-1">
                    {result.failed.map((e, i) => (
                      <div key={i} className="text-xs text-red-700 bg-red-50 px-3 py-1.5 rounded-lg">
                        <span className="font-semibold">Row {e.row}:</span>{' '}
                        {e.errors.join('; ')}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.inserted > 0 && (
                <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-xl p-3">
                  <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  {result.inserted} record{result.inserted !== 1 ? 's' : ''} added successfully.
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex gap-2">
          {!result ? (
            <>
              <button onClick={onClose}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={() => file && uploadMutation.mutate(file)}
                disabled={!file || uploadMutation.isPending}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {uploadMutation.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading…</>
                  : 'Upload CSV'}
              </button>
            </>
          ) : (
            <>
              <button onClick={reset}
                className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">
                Upload another
              </button>
              <button onClick={onClose}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm hover:bg-brand-700">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
