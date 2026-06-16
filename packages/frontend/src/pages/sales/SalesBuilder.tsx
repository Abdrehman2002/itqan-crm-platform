import { useState, useCallback } from 'react';
import { DndContext, DragEndEvent, DragStartEvent, DragOverlay, useDraggable, useDroppable, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { Save, Trash2, Eye } from 'lucide-react';
import { v4 as uuid } from 'uuid';

type ElementType = 'logo'|'company_info'|'client_info'|'invoice_details'|'line_items'|'totals'|'payment_info'|'notes'|'terms'|'signature'|'custom_text'|'divider'|'spacer';
interface BuilderEl { id: string; type: ElementType; label: string; }

const PALETTE: { type: ElementType; label: string; icon: string }[] = [
  { type:'logo',           label:'Company Logo',    icon:'🖼️' },
  { type:'company_info',   label:'Company Info',    icon:'🏢' },
  { type:'client_info',    label:'Client Info',     icon:'👤' },
  { type:'invoice_details',label:'Invoice Details', icon:'📋' },
  { type:'line_items',     label:'Line Items Table',icon:'📊' },
  { type:'totals',         label:'Totals',          icon:'💰' },
  { type:'payment_info',   label:'Payment Info',    icon:'🏦' },
  { type:'notes',          label:'Notes',           icon:'📝' },
  { type:'terms',          label:'Terms & Conditions',icon:'📄'},
  { type:'signature',      label:'Signature',       icon:'✍️' },
  { type:'custom_text',    label:'Custom Text',     icon:'T'  },
  { type:'divider',        label:'Divider',         icon:'—'  },
  { type:'spacer',         label:'Spacer',          icon:'⬜' },
];

const PREVIEW: Record<ElementType, React.ReactNode> = {
  logo:           <div className="w-14 h-14 bg-blue-100 rounded flex items-center justify-center text-blue-600 font-bold text-lg">LOGO</div>,
  company_info:   <div className="text-sm"><div className="font-bold">My Company Inc</div><div className="text-gray-500 text-xs">123 Business Ave · billing@company.com</div></div>,
  client_info:    <div className="text-sm"><div className="text-xs text-gray-400 uppercase font-semibold mb-1">Billed To</div><div className="font-bold">Client Name</div><div className="text-gray-500 text-xs">client@example.com</div></div>,
  invoice_details:<div className="text-sm flex gap-6"><div><div className="text-xs text-gray-400">Invoice #</div><div className="font-bold">INV-0001</div></div><div><div className="text-xs text-gray-400">Due Date</div><div className="font-bold">30 Jun 2026</div></div></div>,
  line_items:     <div className="text-xs w-full"><div className="grid grid-cols-4 gap-2 bg-gray-900 text-white rounded px-2 py-1 mb-1"><span>Description</span><span className="text-center">Qty</span><span className="text-right">Price</span><span className="text-right">Total</span></div><div className="grid grid-cols-4 gap-2 px-2 py-0.5 text-gray-700"><span>Service item</span><span className="text-center">1</span><span className="text-right">$500</span><span className="text-right">$500</span></div></div>,
  totals:         <div className="text-sm ml-auto w-40"><div className="flex justify-between text-gray-600"><span>Subtotal</span><span>$1,000</span></div><div className="flex justify-between font-bold border-t pt-1 mt-1"><span>Total</span><span>$1,080</span></div></div>,
  payment_info:   <div className="text-xs text-gray-700"><div className="font-semibold mb-1">Bank Details</div><div>Chase Bank — ACC ****4321</div></div>,
  notes:          <div className="text-xs text-gray-500 italic">Thank you for your business!</div>,
  terms:          <div className="text-xs text-gray-400">Payment due within 30 days.</div>,
  signature:      <div className="flex flex-col items-start gap-1"><div className="w-24 border-b-2 border-gray-400" /><div className="text-xs text-gray-400">Authorised Signature</div></div>,
  custom_text:    <div className="text-sm text-gray-700">Your custom text here…</div>,
  divider:        <div className="w-full border-t border-gray-300" />,
  spacer:         <div className="w-full h-6 bg-gray-50 border border-dashed border-gray-200 rounded" />,
};

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

function CanvasElement({ el, selected, onSelect, onRemove }: { el: BuilderEl; selected: boolean; onSelect: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: el.id, data: { source: 'canvas' } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes}
      onClick={e => { e.stopPropagation(); onSelect(); }}
      className={`relative group cursor-grab border rounded-lg p-3 transition-all ${selected ? 'border-blue-500 shadow-md bg-blue-50/30' : 'border-gray-200 hover:border-gray-400 bg-white'} ${isDragging ? 'opacity-40' : ''}`}>
      <div className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">{el.label}</div>
      {PREVIEW[el.type]}
      <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onRemove(); }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-opacity">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

const DEFAULT_CANVAS: BuilderEl[] = [
  { id: uuid(), type: 'logo',            label: 'Company Logo' },
  { id: uuid(), type: 'invoice_details', label: 'Invoice Details' },
  { id: uuid(), type: 'client_info',     label: 'Client Info' },
  { id: uuid(), type: 'line_items',      label: 'Line Items Table' },
  { id: uuid(), type: 'totals',          label: 'Totals' },
  { id: uuid(), type: 'payment_info',    label: 'Payment Info' },
  { id: uuid(), type: 'notes',           label: 'Notes' },
  { id: uuid(), type: 'terms',           label: 'Terms & Conditions' },
];

export function SalesBuilder() {
  const [elements, setElements] = useState<BuilderEl[]>(DEFAULT_CANVAS);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeDragType, setActiveDragType] = useState<ElementType | null>(null);
  const [isOver, setIsOver] = useState(false);
  const [saved, setSaved] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { setNodeRef: setCanvasRef } = useDroppable({ id: 'canvas' });

  const onDragStart = useCallback((e: DragStartEvent) => {
    const d = e.active.data.current as any;
    if (d.source === 'palette') setActiveDragType(d.type);
    setIsOver(false);
  }, []);

  const onDragOver = useCallback(() => setIsOver(true), []);

  const onDragEnd = useCallback((e: DragEndEvent) => {
    setIsOver(false); setActiveDragType(null);
    const d = e.active.data.current as any;
    if (d.source === 'palette' && d.type && e.over?.id === 'canvas') {
      const def = PALETTE.find(p => p.type === d.type);
      if (def) setElements(prev => [...prev, { id: uuid(), type: d.type, label: def.label }]);
    }
  }, []);

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="flex flex-1 h-full overflow-hidden">
        {/* Palette */}
        <aside className="w-52 shrink-0 border-r border-gray-200 bg-gray-50 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Elements</div>
            <div className="text-xs text-gray-400 mt-0.5">Drag onto canvas</div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {PALETTE.map(item => <PaletteItem key={item.type} {...item} />)}
          </div>
        </aside>

        {/* Canvas */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-100" onClick={() => setSelected(null)}>
          <div className="max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-4">
              <div className="text-sm text-gray-500">{elements.length} element{elements.length !== 1 ? 's' : ''}</div>
              <div className="flex gap-2">
                <button className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700 bg-white">
                  <Eye size={14} /> Preview
                </button>
                <button onClick={save} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
                  <Save size={14} /> {saved ? 'Saved!' : 'Save Layout'}
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
              {elements.map(el => (
                <CanvasElement key={el.id} el={el} selected={selected === el.id}
                  onSelect={() => setSelected(el.id)}
                  onRemove={() => { setElements(prev => prev.filter(e => e.id !== el.id)); setSelected(null); }} />
              ))}
            </div>
          </div>
        </div>

        {/* Properties */}
        <aside className="w-52 shrink-0 border-l border-gray-200 bg-white flex flex-col">
          <div className="px-4 py-3 border-b border-gray-200">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Properties</div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selected ? (() => {
              const el = elements.find(e => e.id === selected);
              if (!el) return null;
              return (
                <div className="space-y-4">
                  <div><div className="text-xs font-medium text-gray-500 mb-1">Element</div><div className="text-sm font-semibold text-gray-900">{el.label}</div></div>
                  <div><div className="text-xs font-medium text-gray-500 mb-1">Type</div><div className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">{el.type}</div></div>
                  <div className="space-y-1"><div className="text-xs font-medium text-gray-500">Alignment</div>
                    <div className="flex gap-1">{['L','C','R'].map(a => <button key={a} className="flex-1 text-xs border border-gray-200 rounded py-1 hover:border-blue-400 hover:text-blue-600">{a}</button>)}</div>
                  </div>
                  <div className="space-y-1"><div className="text-xs font-medium text-gray-500">Font Size</div><input type="range" min={10} max={24} defaultValue={14} className="w-full" /></div>
                  <button onClick={() => { setElements(prev => prev.filter(e => e.id !== el.id)); setSelected(null); }}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700">
                    <Trash2 size={13} /> Remove
                  </button>
                </div>
              );
            })() : <div className="text-xs text-gray-400 text-center mt-8">Select an element to edit its properties</div>}
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
  );
}
