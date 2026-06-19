import { useState, useCallback, useEffect } from 'react';
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay,
  PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDraggable, useDroppable } from '@dnd-kit/core'; // useDraggable for palette, useDroppable for canvas zone
import { Save, Trash2, Eye, X, AlignLeft, AlignCenter, AlignRight, Loader2, GripVertical } from 'lucide-react';
import { v4 as uuid } from 'uuid';

type ElementType =
  | 'logo' | 'company_info' | 'client_info' | 'invoice_details'
  | 'line_items' | 'totals' | 'payment_info' | 'notes' | 'terms'
  | 'signature' | 'custom_text' | 'divider' | 'spacer';

interface ElementProps {
  alignment: 'left' | 'center' | 'right';
  fontSize: number;
  color: string;
  customText?: string;
}

interface BuilderEl {
  id: string;
  type: ElementType;
  label: string;
  props: ElementProps;
}

const DEFAULT_PROPS: ElementProps = { alignment: 'left', fontSize: 14, color: '#111827' };

const PALETTE: { type: ElementType; label: string; icon: string }[] = [
  { type: 'logo',            label: 'Company Logo',     icon: '🖼️' },
  { type: 'company_info',    label: 'Company Info',     icon: '🏢' },
  { type: 'client_info',     label: 'Client Info',      icon: '👤' },
  { type: 'invoice_details', label: 'Invoice Details',  icon: '📋' },
  { type: 'line_items',      label: 'Line Items Table',  icon: '📊' },
  { type: 'totals',          label: 'Totals',           icon: '💰' },
  { type: 'payment_info',    label: 'Payment Info',     icon: '🏦' },
  { type: 'notes',           label: 'Notes',            icon: '📝' },
  { type: 'terms',           label: 'Terms & Conditions', icon: '📄' },
  { type: 'signature',       label: 'Signature',        icon: '✍️' },
  { type: 'custom_text',     label: 'Custom Text',      icon: 'T'  },
  { type: 'divider',         label: 'Divider',          icon: '—'  },
  { type: 'spacer',          label: 'Spacer',           icon: '⬜' },
];

function getAlignClass(a: 'left' | 'center' | 'right') {
  return a === 'center' ? 'text-center' : a === 'right' ? 'text-right' : 'text-left';
}

function renderPreview(el: BuilderEl): React.ReactNode {
  const align = getAlignClass(el.props.alignment);
  const style = { fontSize: el.props.fontSize, color: el.props.color };

  switch (el.type) {
    case 'logo':
      return (
        <div className={align}>
          <div className="w-14 h-14 bg-blue-100 rounded flex items-center justify-center text-blue-600 font-bold text-lg inline-flex">LOGO</div>
        </div>
      );
    case 'company_info':
      return (
        <div className={align} style={style}>
          <div className="font-bold">My Company Inc</div>
          <div className="text-gray-500" style={{ fontSize: el.props.fontSize - 2 }}>123 Business Ave · billing@company.com</div>
        </div>
      );
    case 'client_info':
      return (
        <div className={align} style={style}>
          <div className="text-xs text-gray-400 uppercase font-semibold mb-1">Billed To</div>
          <div className="font-bold">Client Name</div>
          <div className="text-gray-500" style={{ fontSize: el.props.fontSize - 2 }}>client@example.com</div>
        </div>
      );
    case 'invoice_details':
      return (
        <div className={`flex gap-6 ${el.props.alignment === 'right' ? 'justify-end' : el.props.alignment === 'center' ? 'justify-center' : ''}`} style={style}>
          <div><div className="text-xs text-gray-400">Invoice #</div><div className="font-bold">INV-0001</div></div>
          <div><div className="text-xs text-gray-400">Due Date</div><div className="font-bold">30 Jun 2026</div></div>
        </div>
      );
    case 'line_items':
      return (
        <div className="text-xs w-full" style={{ fontSize: el.props.fontSize - 2 }}>
          <div className="grid grid-cols-4 gap-2 bg-gray-900 text-white rounded px-2 py-1 mb-1">
            <span>Description</span><span className="text-center">Qty</span><span className="text-right">Price</span><span className="text-right">Total</span>
          </div>
          <div className="grid grid-cols-4 gap-2 px-2 py-0.5 text-gray-700">
            <span>Service item</span><span className="text-center">1</span><span className="text-right">$500</span><span className="text-right">$500</span>
          </div>
        </div>
      );
    case 'totals':
      return (
        <div className={`${el.props.alignment === 'right' ? 'ml-auto' : el.props.alignment === 'center' ? 'mx-auto' : ''} w-48`} style={style}>
          <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>$1,000</span></div>
          <div className="flex justify-between text-gray-600"><span>Tax (8%)</span><span>$80</span></div>
          <div className="flex justify-between font-bold border-t pt-1 mt-1"><span>Total</span><span>$1,080</span></div>
        </div>
      );
    case 'payment_info':
      return (
        <div className={align} style={style}>
          <div className="font-semibold mb-1">Bank Details</div>
          <div className="text-gray-700">Chase Bank — ACC ****4321</div>
        </div>
      );
    case 'notes':
      return <div className={`${align} italic text-gray-500`} style={style}>Thank you for your business!</div>;
    case 'terms':
      return <div className={`${align} text-gray-400`} style={style}>Payment due within 30 days.</div>;
    case 'signature':
      return (
        <div className={align}>
          <div className="inline-flex flex-col items-start gap-1">
            <div className="w-24 border-b-2 border-gray-400" />
            <div className="text-xs text-gray-400">Authorised Signature</div>
          </div>
        </div>
      );
    case 'custom_text':
      return <div className={align} style={style}>{el.props.customText || 'Your custom text here…'}</div>;
    case 'divider':
      return <div className="w-full border-t border-gray-300" style={{ borderColor: el.props.color }} />;
    case 'spacer':
      return <div className="w-full h-6 bg-gray-50 border border-dashed border-gray-200 rounded" />;
    default:
      return null;
  }
}

function PaletteItem({ type, label, icon }: { type: ElementType; label: string; icon: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette-${type}`, data: { type, source: 'palette' } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      className={`flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg cursor-grab text-sm hover:border-blue-400 select-none transition-all ${isDragging ? 'opacity-40' : ''}`}>
      <span className="text-base leading-none">{icon}</span>
      <span className="text-gray-700">{label}</span>
    </div>
  );
}

function CanvasElement({ el, selected, onSelect, onRemove }: {
  el: BuilderEl; selected: boolean; onSelect: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: el.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      className={`relative group border rounded-lg p-3 transition-all ${selected ? 'border-blue-500 shadow-md bg-blue-50/30' : 'border-gray-200 hover:border-gray-400 bg-white'} ${isDragging ? 'opacity-40 shadow-xl' : ''}`}>
      {/* Drag handle */}
      <div {...attributes} {...listeners}
        className="absolute left-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 hover:!opacity-80 cursor-grab text-gray-400 touch-none">
        <GripVertical size={14} />
      </div>
      <div className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide pl-4">{el.label}</div>
      {renderPreview(el)}
      <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onRemove(); }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// Full-page preview modal
function PreviewModal({ elements, onClose }: { elements: BuilderEl[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <span className="font-semibold text-gray-900">Invoice Preview</span>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50">Print / Save PDF</button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700"><X size={18} /></button>
          </div>
        </div>
        <div id="invoice-preview-print" className="p-10 space-y-5">
          {elements.map(el => (
            <div key={el.id}>{renderPreview(el)}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Template name dialog
function SaveDialog({ onSave, onClose, loading }: {
  onSave: (name: string, isDefault: boolean) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [name, setName] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-2xl w-96 p-6">
        <div className="text-base font-semibold mb-4">Save Template</div>
        <label className="block text-sm text-gray-600 mb-1">Template name</label>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && name.trim() && onSave(name.trim(), isDefault)}
          className="w-full border rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="e.g. Standard Invoice" />
        <label className="flex items-center gap-2 text-sm text-gray-600 mb-5 cursor-pointer">
          <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} />
          Set as default template
        </label>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">Cancel</button>
          <button disabled={!name.trim() || loading} onClick={() => onSave(name.trim(), isDefault)}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_CANVAS: BuilderEl[] = [
  { id: uuid(), type: 'logo',            label: 'Company Logo',     props: { ...DEFAULT_PROPS } },
  { id: uuid(), type: 'invoice_details', label: 'Invoice Details',  props: { ...DEFAULT_PROPS } },
  { id: uuid(), type: 'client_info',     label: 'Client Info',      props: { ...DEFAULT_PROPS } },
  { id: uuid(), type: 'line_items',      label: 'Line Items Table', props: { ...DEFAULT_PROPS, fontSize: 12 } },
  { id: uuid(), type: 'totals',          label: 'Totals',           props: { ...DEFAULT_PROPS, alignment: 'right' } },
  { id: uuid(), type: 'payment_info',    label: 'Payment Info',     props: { ...DEFAULT_PROPS } },
  { id: uuid(), type: 'notes',           label: 'Notes',            props: { ...DEFAULT_PROPS, fontSize: 12 } },
  { id: uuid(), type: 'terms',           label: 'Terms & Conditions', props: { ...DEFAULT_PROPS, fontSize: 11 } },
];

export function SalesBuilder() {
  const [elements, setElements] = useState<BuilderEl[]>(DEFAULT_CANVAS);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<ElementType | null>(null);
  const [isOver, setIsOver] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [savedTemplates, setSavedTemplates] = useState<{ id: string; name: string }[]>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const { setNodeRef: setCanvasRef } = useDroppable({ id: 'canvas' });

  useEffect(() => {
    fetch('/api/v1/sales/templates', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.data && setSavedTemplates(d.data.filter((t: any) => t.type === 'builder')))
      .catch(() => {});
  }, []);

  const updateSelected = useCallback((patch: Partial<ElementProps>) => {
    setElements(prev => prev.map(el =>
      el.id === selected ? { ...el, props: { ...el.props, ...patch } } : el
    ));
  }, [selected]);

  const onDragStart = useCallback((e: DragStartEvent) => {
    const d = e.active.data.current as any;
    if (d.source === 'palette') setActiveDragType(d.type);
    setIsOver(false);
  }, []);

  const onDragOver = useCallback(() => setIsOver(true), []);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    setIsOver(false); setActiveDragType(null);
    const d = e.active.data.current as any;
    if (d?.source === 'palette' && d.type && e.over?.id === 'canvas') {
      // Drop from palette onto canvas
      const def = PALETTE.find(p => p.type === d.type);
      if (def) setElements(prev => [...prev, { id: uuid(), type: d.type, label: def.label, props: { ...DEFAULT_PROPS } }]);
    } else if (e.active.id !== e.over?.id && e.over) {
      // Reorder within canvas
      setElements(prev => {
        const oldIdx = prev.findIndex(el => el.id === e.active.id);
        const newIdx = prev.findIndex(el => el.id === e.over!.id);
        if (oldIdx !== -1 && newIdx !== -1) return arrayMove(prev, oldIdx, newIdx);
        return prev;
      });
    }
  }, []);

  const loadTemplate = (id: string) => {
    fetch(`/api/v1/sales/templates`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const tpl = d?.data?.find((t: any) => t.id === id);
        if (tpl?.layout) { setElements(tpl.layout); setSelected(null); }
      })
      .catch(() => {});
  };

  const handleSave = async (name: string, isDefault: boolean) => {
    setSaving(true);
    try {
      const res = await fetch('/api/v1/sales/templates', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, layout: elements, isDefault }),
      });
      const data = await res.json();
      if (res.ok) {
        setSavedTemplates(prev => [{ id: data.data.id, name }, ...prev]);
        setShowSaveDialog(false);
        setSavedMsg('Saved!');
        setTimeout(() => setSavedMsg(''), 2500);
      }
    } finally {
      setSaving(false);
    }
  };

  const selectedEl = elements.find(e => e.id === selected);

  return (
    <>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
        <div className="flex h-full overflow-hidden" style={{ height: 'calc(100vh - 0px)' }}>
          {/* Palette */}
          <aside className="w-52 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Elements</div>
              <div className="text-xs text-gray-400 mt-0.5">Drag onto canvas</div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {PALETTE.map(item => <PaletteItem key={item.type} {...item} />)}
            </div>
            {savedTemplates.length > 0 && (
              <div className="border-t border-gray-200 p-3">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Load Saved</div>
                <div className="space-y-1">
                  {savedTemplates.slice(0, 5).map(t => (
                    <button key={t.id} onClick={() => loadTemplate(t.id)}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-blue-50 hover:text-blue-700 text-gray-700 truncate">
                      {t.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* Canvas */}
          <div className="flex-1 overflow-y-auto p-6 bg-gray-100" onClick={() => setSelected(null)}>
            <div className="max-w-2xl mx-auto">
              <div className="flex justify-between items-center mb-4">
                <div className="text-sm text-gray-500">{elements.length} element{elements.length !== 1 ? 's' : ''}</div>
                <div className="flex gap-2">
                  <button onClick={() => setShowPreview(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 bg-white">
                    <Eye size={14} /> Preview
                  </button>
                  <button onClick={() => setShowSaveDialog(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
                    <Save size={14} /> {savedMsg || 'Save Template'}
                  </button>
                </div>
              </div>
              <div ref={setCanvasRef}
                className={`min-h-96 rounded-xl border-2 border-dashed p-6 space-y-3 transition-colors ${isOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white'}`}>
                {elements.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-400 text-sm gap-2">
                    <span className="text-3xl">📋</span>
                    <span>Drag elements here to build your invoice layout</span>
                  </div>
                )}
                <SortableContext items={elements.map(e => e.id)} strategy={verticalListSortingStrategy}>
                  {elements.map(el => (
                    <CanvasElement key={el.id} el={el} selected={selected === el.id}
                      onSelect={() => setSelected(el.id)}
                      onRemove={() => { setElements(prev => prev.filter(e => e.id !== el.id)); setSelected(null); }} />
                  ))}
                </SortableContext>
              </div>
            </div>
          </div>

          {/* Properties panel */}
          <aside className="w-56 shrink-0 border-l border-gray-200 bg-white flex flex-col">
            <div className="px-4 py-3 border-b border-gray-200">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Properties</div>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {selectedEl ? (
                <div className="space-y-5">
                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1">Element</div>
                    <div className="text-sm font-semibold text-gray-900">{selectedEl.label}</div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">Alignment</div>
                    <div className="flex gap-1">
                      {(['left','center','right'] as const).map(a => (
                        <button key={a} onClick={() => updateSelected({ alignment: a })}
                          className={`flex-1 flex items-center justify-center py-1.5 border rounded transition-colors ${selectedEl.props.alignment === a ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 hover:border-gray-400 text-gray-500'}`}>
                          {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-1 flex justify-between">
                      <span>Font Size</span><span className="text-gray-700">{selectedEl.props.fontSize}px</span>
                    </div>
                    <input type="range" min={9} max={24} value={selectedEl.props.fontSize}
                      onChange={e => updateSelected({ fontSize: Number(e.target.value) })}
                      className="w-full accent-blue-600" />
                  </div>

                  <div>
                    <div className="text-xs font-medium text-gray-500 mb-2">Color</div>
                    <div className="flex items-center gap-2">
                      <input type="color" value={selectedEl.props.color}
                        onChange={e => updateSelected({ color: e.target.value })}
                        className="w-8 h-8 rounded border border-gray-200 cursor-pointer p-0.5" />
                      <span className="text-xs text-gray-500 font-mono">{selectedEl.props.color}</span>
                    </div>
                  </div>

                  {selectedEl.type === 'custom_text' && (
                    <div>
                      <div className="text-xs font-medium text-gray-500 mb-1">Content</div>
                      <textarea rows={4} value={selectedEl.props.customText ?? ''}
                        onChange={e => updateSelected({ customText: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                  )}

                  <button onClick={() => { setElements(prev => prev.filter(e => e.id !== selectedEl.id)); setSelected(null); }}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700">
                    <Trash2 size={13} /> Remove Element
                  </button>
                </div>
              ) : (
                <div className="text-xs text-gray-400 text-center mt-8">Select an element to edit its properties</div>
              )}
            </div>
          </aside>
        </div>

        <DragOverlay>
          {activeDragType && (
            <div className="bg-white border-2 border-blue-400 rounded-lg px-4 py-2 shadow-lg text-sm font-medium text-blue-700">
              {PALETTE.find(p => p.type === activeDragType)?.label}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {showPreview && <PreviewModal elements={elements} onClose={() => setShowPreview(false)} />}
      {showSaveDialog && <SaveDialog onSave={handleSave} onClose={() => setShowSaveDialog(false)} loading={saving} />}
    </>
  );
}
