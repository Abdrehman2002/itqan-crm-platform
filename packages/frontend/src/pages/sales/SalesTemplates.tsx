import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { INVOICE_TEMPLATES } from './types';
import { CheckCircle2 } from 'lucide-react';

const ACCENT_BG: Record<string, string> = {
  '#2563eb':'bg-blue-600','#0f172a':'bg-slate-900','#4f46e5':'bg-indigo-600',
  '#f97316':'bg-orange-500','#d97706':'bg-amber-600','#0d9488':'bg-teal-600',
  '#9333ea':'bg-purple-600','#0284c7':'bg-sky-600',
};
const ACCENT_TEXT: Record<string, string> = {
  '#2563eb':'text-blue-600','#0f172a':'text-slate-900','#4f46e5':'text-indigo-600',
  '#f97316':'text-orange-500','#d97706':'text-amber-600','#0d9488':'text-teal-600',
  '#9333ea':'text-purple-600','#0284c7':'text-sky-600',
};

export function SalesTemplates() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState('tpl-classic');

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Invoice Templates</h1>
          <p className="text-sm text-gray-500 mt-0.5">Choose a sector template. Customise further in the Builder.</p>
        </div>
        <button onClick={() => navigate(`/sales/invoices/new?template=${selected}`)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
          Use Selected Template
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {INVOICE_TEMPLATES.map(tpl => {
          const isSelected = selected === tpl.id;
          const bg = ACCENT_BG[tpl.accentColor] ?? 'bg-blue-600';
          const tx = ACCENT_TEXT[tpl.accentColor] ?? 'text-blue-600';
          return (
            <button key={tpl.id} onClick={() => setSelected(tpl.id)}
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
    </div>
  );
}
