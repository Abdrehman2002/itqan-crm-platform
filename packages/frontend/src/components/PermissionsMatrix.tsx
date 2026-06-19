import { useState } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';

export type ActionType = 'read' | 'write' | 'danger';
export interface ModuleAction { key: string; label: string; type: ActionType; }
export interface ModuleDef    { key: string; label: string; icon: string; actions: ModuleAction[]; }

export const ACTION_STYLE: Record<ActionType, { bg: string; text: string; label: string }> = {
  read:   { bg: 'bg-blue-50',   text: 'text-blue-600',  label: 'read'   },
  write:  { bg: 'bg-green-50',  text: 'text-green-700', label: 'write'  },
  danger: { bg: 'bg-red-50',    text: 'text-red-600',   label: 'delete' },
};

const CHECK_STYLE: Record<ActionType, string> = {
  read:   'border-blue-500 bg-blue-500',
  write:  'border-green-500 bg-green-500',
  danger: 'border-red-500 bg-red-500',
};

export function PermissionsMatrix({
  modules, permissions, onChange, readOnly = false,
}: {
  modules: ModuleDef[];
  permissions: Record<string, boolean>;
  onChange?: (perms: Record<string, boolean>) => void;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (key: string, val: boolean) => {
    if (!readOnly) onChange?.({ ...permissions, [key]: val });
  };

  const toggleAll = (mod: ModuleDef, val: boolean) => {
    if (readOnly) return;
    const patch: Record<string, boolean> = {};
    mod.actions.forEach((a) => { patch[a.key] = val; });
    onChange?.({ ...permissions, ...patch });
  };

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <div className="flex items-center bg-gray-50 border-b border-gray-100 px-4 py-2.5 gap-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex-1">Module</span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions enabled</span>
      </div>

      {modules.filter((mod) => mod.actions?.length).map((mod, idx) => {
        const total   = mod.actions.length;
        const enabled = mod.actions.filter((a) => permissions[a.key]).length;
        const isOpen  = expanded[mod.key] ?? false;
        const allOn   = enabled === total;
        const noneOn  = enabled === 0;

        return (
          <div key={mod.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
            <div className="flex items-center gap-2 px-4 py-2.5">
              <button
                type="button"
                onClick={() => setExpanded((p) => ({ ...p, [mod.key]: !p[mod.key] }))}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <span className="text-base shrink-0">{mod.icon}</span>
                <span className="text-sm font-medium text-gray-700">{mod.label}</span>
                {isOpen
                  ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 ml-1 shrink-0" />
                  : <ChevronDown className="w-3.5 h-3.5 text-gray-400 ml-1 shrink-0" />}
              </button>

              <span className={`text-xs font-medium px-2 py-0.5 rounded-full shrink-0
                ${noneOn ? 'bg-gray-100 text-gray-400' : allOn ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-600'}`}>
                {noneOn ? 'None' : `${enabled} / ${total}`}
              </span>

              {!readOnly && (
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => toggleAll(mod, true)} disabled={allOn}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:border-green-400 hover:text-green-600 disabled:opacity-30 transition-colors">
                    All
                  </button>
                  <button type="button" onClick={() => toggleAll(mod, false)} disabled={noneOn}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:border-red-400 hover:text-red-500 disabled:opacity-30 transition-colors">
                    None
                  </button>
                </div>
              )}
            </div>

            {isOpen && (
              <div className="border-t border-gray-100 bg-gray-50/70 pb-1.5">
                <div className="grid gap-0 pl-10 pr-4">
                  {mod.actions.map((action) => {
                    const active = permissions[action.key] ?? false;
                    const style  = ACTION_STYLE[action.type];
                    return (
                      <label key={action.key}
                        className={`flex items-center gap-3 py-2 pr-2 ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}>
                        <button
                          type="button"
                          disabled={readOnly}
                          onClick={() => toggle(action.key, !active)}
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all
                            ${active ? CHECK_STYLE[action.type] : 'border-gray-300 bg-white'}
                            ${readOnly ? 'cursor-default' : 'cursor-pointer'}`}
                        >
                          {active && <Check className="w-2.5 h-2.5 text-white" />}
                        </button>
                        <span className="text-xs text-gray-600 flex-1">{action.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${style.bg} ${style.text}`}>
                          {style.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex-wrap">
        {(['read','write','danger'] as ActionType[]).map((t) => (
          <div key={t} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${ACTION_STYLE[t].bg} ${ACTION_STYLE[t].text}`}>
            <span className="font-semibold capitalize">{ACTION_STYLE[t].label}</span>
          </div>
        ))}
        <span className="text-xs text-gray-400 ml-1">Click a module row to expand individual actions</span>
      </div>
    </div>
  );
}
