/**
 * SectorFieldsForm
 *
 * Renders the sector-specific custom fields for a contact form.
 * Groups fields visually by their `group` metadata.
 * Reads field definitions from useSectorFields and stores values in a
 * `custom_fields` JSONB map { [field.name]: value }.
 */
import type { SectorFieldDef } from '../hooks/useSectorFields';

interface Props {
  fields:       SectorFieldDef[];
  values:       Record<string, any>;
  onChange:     (name: string, value: any) => void;
  sectorColor?: string;
  readOnly?:    boolean;
}

export function SectorFieldsForm({ fields, values, onChange, sectorColor = '#29ABE2', readOnly = false }: Props) {
  if (!fields.length) return null;

  // Group fields
  const groups: Record<string, SectorFieldDef[]> = {};
  for (const f of fields) {
    const g = (f as any).group ?? 'Details';
    if (!groups[g]) groups[g] = [];
    groups[g].push(f);
  }

  const inputCls = `w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 transition-shadow ${readOnly ? 'bg-gray-50 text-gray-600' : 'bg-white hover:border-gray-300'}`;

  return (
    <div className="space-y-5">
      {Object.entries(groups).map(([groupName, groupFields]) => (
        <div key={groupName}>
          <p className="text-xs font-bold uppercase tracking-widest mb-3"
             style={{ color: sectorColor }}>
            {groupName}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {groupFields.map(field => (
              <div key={field.name} className={field.field_type === 'textarea' ? 'sm:col-span-2' : ''}>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {field.label}
                  {field.is_required && <span className="text-red-500 ml-0.5">*</span>}
                </label>

                {field.field_type === 'select' && (
                  <select
                    value={values[field.name] ?? ''}
                    onChange={e => onChange(field.name, e.target.value)}
                    disabled={readOnly}
                    required={field.is_required}
                    className={inputCls}
                    style={{ borderColor: values[field.name] ? sectorColor + '60' : undefined }}
                  >
                    <option value="">— Select —</option>
                    {(field.options ?? []).map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                )}

                {field.field_type === 'boolean' && (
                  <div className="flex items-center gap-3 h-10">
                    {['Yes', 'No'].map(opt => {
                      const val = opt === 'Yes';
                      const active = values[field.name] === val;
                      return (
                        <button key={opt} type="button"
                          onClick={() => !readOnly && onChange(field.name, val)}
                          className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all ${active ? 'text-white' : 'border-gray-200 text-gray-500 bg-white hover:bg-gray-50'}`}
                          style={active ? { background: sectorColor, borderColor: sectorColor } : {}}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}

                {field.field_type === 'textarea' && (
                  <textarea
                    value={values[field.name] ?? ''}
                    onChange={e => onChange(field.name, e.target.value)}
                    readOnly={readOnly}
                    required={field.is_required}
                    rows={3}
                    placeholder={(field as any).placeholder}
                    className={`${inputCls} resize-none`}
                    style={{ borderColor: values[field.name] ? sectorColor + '60' : undefined }}
                  />
                )}

                {!['select', 'boolean', 'textarea'].includes(field.field_type) && (
                  <input
                    type={
                      field.field_type === 'email'  ? 'email'  :
                      field.field_type === 'phone'  ? 'tel'    :
                      field.field_type === 'number' ? 'number' :
                      field.field_type === 'date'   ? 'date'   : 'text'
                    }
                    value={values[field.name] ?? ''}
                    onChange={e => onChange(field.name, e.target.value)}
                    readOnly={readOnly}
                    required={field.is_required}
                    placeholder={(field as any).placeholder}
                    className={inputCls}
                    style={{ borderColor: values[field.name] ? sectorColor + '60' : undefined }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Display-only version: renders values as labeled text pairs */
export function SectorFieldsDisplay({ fields, values, sectorColor = '#29ABE2' }: Omit<Props, 'onChange' | 'readOnly'>) {
  if (!fields.length) return null;

  const filled = fields.filter(f => values[f.name] !== undefined && values[f.name] !== '' && values[f.name] !== null);
  if (!filled.length) return null;

  const groups: Record<string, SectorFieldDef[]> = {};
  for (const f of filled) {
    const g = (f as any).group ?? 'Details';
    if (!groups[g]) groups[g] = [];
    groups[g].push(f);
  }

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([groupName, groupFields]) => (
        <div key={groupName}>
          <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: sectorColor }}>
            {groupName}
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {groupFields.map(f => (
              <div key={f.name}>
                <p className="text-xs text-gray-400">{f.label}</p>
                <p className="text-sm font-medium text-gray-900">
                  {f.field_type === 'boolean'
                    ? (values[f.name] === true || values[f.name] === 'true' ? 'Yes' : 'No')
                    : String(values[f.name])}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
