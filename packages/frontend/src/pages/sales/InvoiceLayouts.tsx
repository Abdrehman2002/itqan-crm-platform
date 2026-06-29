import { formatCurrency, getStatusColor, type Invoice, type InvoiceLayout, type SalesSettings } from './types';

interface LayoutProps {
  inv: Invoice;
  accent: string;
  settings?: SalesSettings;
}

// ── CLASSIC: centered logo + traditional dark-header table ────────────────────
function ClassicLayout({ inv, accent, settings }: LayoutProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-8">
      <div className="flex flex-col items-center text-center mb-8 pb-6 border-b border-gray-200">
        <div
          className="w-16 h-16 rounded-xl flex items-center justify-center text-white font-bold text-2xl mb-3"
          style={{ backgroundColor: accent }}
        >
          {(settings?.companyName?.[0] ?? inv.contactName?.[0] ?? '?').toUpperCase()}
        </div>
        {settings?.companyName && <div className="text-lg font-bold text-gray-900">{settings.companyName}</div>}
        <div className="text-xs uppercase tracking-widest text-gray-400 mt-1">Invoice</div>
        <div className="text-3xl font-black mt-1" style={{ color: accent }}>{inv.number}</div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8">
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Billed To</div>
          <div className="font-semibold text-gray-900">{inv.contactName}</div>
          <div className="text-sm text-gray-500">{inv.contactCompany}</div>
          <div className="text-sm text-gray-500">{inv.contactEmail}</div>
          {inv.contactBillingAddress && (
            <div className="text-sm text-gray-500">{inv.contactBillingAddress.line1}, {inv.contactBillingAddress.city}, {inv.contactBillingAddress.country}</div>
          )}
        </div>
        <div className="text-right space-y-1">
          <div className="text-sm text-gray-500">Issue: <span className="text-gray-900 font-medium">{new Date(inv.issueDate).toLocaleDateString()}</span></div>
          <div className="text-sm text-gray-500">Due: <span className="text-gray-900 font-medium">{new Date(inv.dueDate).toLocaleDateString()}</span></div>
          {inv.poReference && <div className="text-sm text-gray-500">PO: <span className="text-gray-900 font-medium">{inv.poReference}</span></div>}
          <div className="mt-2">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(inv.status)}`}>{inv.status}</span>
          </div>
        </div>
      </div>

      <table className="w-full text-sm mb-6">
        <thead>
          <tr className="bg-gray-900 text-white">
            <th className="text-left px-4 py-2.5 rounded-l-lg text-xs">Description</th>
            <th className="text-center px-4 py-2.5 text-xs">Qty</th>
            <th className="text-right px-4 py-2.5 text-xs">Unit Price</th>
            <th className="text-right px-4 py-2.5 text-xs">Tax</th>
            <th className="text-right px-4 py-2.5 rounded-r-lg text-xs">Total</th>
          </tr>
        </thead>
        <tbody>
          {(inv.lineItems ?? []).map((li: any) => (
            <tr key={li.id} className="border-b border-gray-100">
              <td className="px-4 py-3 text-gray-800">{li.description}</td>
              <td className="px-4 py-3 text-center text-gray-600">{li.quantity}</td>
              <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(li.unit_price ?? li.unitPrice, inv.currency)}</td>
              <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(li.tax_amount ?? li.taxAmount, inv.currency)}</td>
              <td className="px-4 py-3 text-right font-medium text-gray-900">{formatCurrency(li.total, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Totals inv={inv} accent={accent} />
      {inv.notes && <div className="mt-6 text-sm text-gray-500"><div className="font-semibold text-gray-700 mb-1">Notes</div><p>{inv.notes}</p></div>}
    </div>
  );
}

// ── MINIMAL: left-aligned, single column, no borders ──────────────────────────
function MinimalLayout({ inv, accent, settings }: LayoutProps) {
  return (
    <div className="bg-white rounded-xl p-10" style={{ borderTop: `4px solid ${accent}` }}>
      <div className="flex items-baseline justify-between mb-10">
        <div>
          <div className="text-2xl font-light tracking-tight text-gray-900">{settings?.companyName ?? 'Invoice'}</div>
          <div className="text-xs uppercase tracking-[0.3em] text-gray-400 mt-1">Statement of Charges</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-widest text-gray-400">No.</div>
          <div className="text-xl font-mono" style={{ color: accent }}>{inv.number}</div>
        </div>
      </div>

      <div className="space-y-1 mb-10 text-sm">
        <div className="text-gray-400">Billed to</div>
        <div className="font-medium text-gray-900">{inv.contactName}</div>
        {inv.contactCompany && <div className="text-gray-600">{inv.contactCompany}</div>}
        {inv.contactEmail && <div className="text-gray-500">{inv.contactEmail}</div>}
        {inv.contactBillingAddress && (
          <div className="text-gray-500">{inv.contactBillingAddress.line1}, {inv.contactBillingAddress.city}, {inv.contactBillingAddress.country}</div>
        )}
      </div>

      <div className="flex gap-8 mb-8 text-sm">
        <div><div className="text-gray-400 text-xs uppercase tracking-wide">Issued</div><div className="text-gray-900">{new Date(inv.issueDate).toLocaleDateString()}</div></div>
        <div><div className="text-gray-400 text-xs uppercase tracking-wide">Due</div><div className="text-gray-900">{new Date(inv.dueDate).toLocaleDateString()}</div></div>
        {inv.poReference && <div><div className="text-gray-400 text-xs uppercase tracking-wide">PO</div><div className="text-gray-900">{inv.poReference}</div></div>}
        <div><div className="text-gray-400 text-xs uppercase tracking-wide">Status</div>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(inv.status)}`}>{inv.status}</span>
        </div>
      </div>

      <table className="w-full text-sm mb-6">
        <thead>
          <tr style={{ borderBottom: `1px solid ${accent}` }}>
            <th className="text-left py-2 text-xs uppercase tracking-wide text-gray-400 font-medium">Item</th>
            <th className="text-right py-2 text-xs uppercase tracking-wide text-gray-400 font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(inv.lineItems ?? []).map((li: any) => (
            <tr key={li.id} className="border-b border-gray-50">
              <td className="py-3 text-gray-800">
                <div>{li.description}</div>
                <div className="text-xs text-gray-400 mt-0.5">{li.quantity} × {formatCurrency(li.unit_price ?? li.unitPrice, inv.currency)}</div>
              </td>
              <td className="py-3 text-right text-gray-900">{formatCurrency(li.total, inv.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Totals inv={inv} accent={accent} />
      {inv.notes && <div className="mt-8 pt-6 border-t border-gray-100 text-sm text-gray-500"><p>{inv.notes}</p></div>}
    </div>
  );
}

// ── CONSULTING: large header with tagline, two-column items table ─────────────
function ConsultingLayout({ inv, accent, settings }: LayoutProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-10 py-8 text-white" style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}dd 100%)` }}>
        <div className="flex justify-between items-start">
          <div>
            <div className="text-3xl font-bold tracking-tight">{settings?.companyName ?? 'Consulting Group'}</div>
            <div className="text-sm text-white/80 mt-1 italic">Trusted advisory · Strategic counsel</div>
            {settings?.companyEmail && <div className="text-xs text-white/70 mt-2">{settings.companyEmail}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-widest text-white/70">Statement</div>
            <div className="text-2xl font-bold mt-1">{inv.number}</div>
            <div className="mt-2 inline-block px-3 py-1 bg-white/20 rounded text-xs uppercase tracking-wide">{inv.status}</div>
          </div>
        </div>
      </div>

      <div className="px-10 py-8">
        <div className="grid grid-cols-3 gap-6 mb-8 pb-6 border-b border-gray-200">
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Client</div>
            <div className="font-semibold text-gray-900">{inv.contactName}</div>
            <div className="text-sm text-gray-600">{inv.contactCompany}</div>
            <div className="text-sm text-gray-500">{inv.contactEmail}</div>
            {inv.contactBillingAddress && (
              <div className="text-sm text-gray-500 mt-1">{inv.contactBillingAddress.line1}<br/>{inv.contactBillingAddress.city}, {inv.contactBillingAddress.country}</div>
            )}
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Engagement</div>
            <div className="text-sm text-gray-600">Issue: <span className="text-gray-900">{new Date(inv.issueDate).toLocaleDateString()}</span></div>
            <div className="text-sm text-gray-600">Due: <span className="text-gray-900">{new Date(inv.dueDate).toLocaleDateString()}</span></div>
            {inv.poReference && <div className="text-sm text-gray-600">Ref: <span className="text-gray-900">{inv.poReference}</span></div>}
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Amount Due</div>
            <div className="text-3xl font-bold" style={{ color: accent }}>{formatCurrency(inv.amountDue, inv.currency)}</div>
            <div className="text-xs text-gray-500 mt-1">{inv.currency}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          {(inv.lineItems ?? []).map((li: any) => (
            <div key={li.id} className="border border-gray-200 rounded-lg p-4" style={{ borderLeftWidth: '3px', borderLeftColor: accent }}>
              <div className="font-medium text-gray-900 text-sm">{li.description}</div>
              <div className="flex justify-between mt-3 text-xs text-gray-500">
                <span>{li.quantity} × {formatCurrency(li.unit_price ?? li.unitPrice, inv.currency)}</span>
                <span className="font-semibold text-gray-900">{formatCurrency(li.total, inv.currency)}</span>
              </div>
            </div>
          ))}
        </div>

        <Totals inv={inv} accent={accent} />
        {inv.notes && (
          <div className="mt-6 p-4 rounded-lg text-sm" style={{ backgroundColor: `${accent}10` }}>
            <div className="font-semibold text-gray-700 mb-1">Engagement Notes</div>
            <p className="text-gray-600">{inv.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Totals({ inv, accent }: { inv: Invoice; accent: string }) {
  return (
    <div className="flex justify-end">
      <div className="w-64 space-y-2 text-sm">
        <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatCurrency(inv.subtotal, inv.currency)}</span></div>
        <div className="flex justify-between text-gray-600"><span>Tax</span><span>{formatCurrency(inv.totalTax, inv.currency)}</span></div>
        <div className="flex justify-between font-bold text-gray-900 text-base border-t border-gray-200 pt-2">
          <span>Total</span><span style={{ color: accent }}>{formatCurrency(inv.total, inv.currency)}</span>
        </div>
        {inv.amountPaid > 0 && <div className="flex justify-between text-green-600"><span>Paid</span><span>-{formatCurrency(inv.amountPaid, inv.currency)}</span></div>}
        {inv.amountDue > 0 && (
          <div className="flex justify-between font-bold text-red-600 text-base border-t border-gray-200 pt-2">
            <span>Balance Due</span><span>{formatCurrency(inv.amountDue, inv.currency)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function InvoiceLayoutView({ layout, ...props }: LayoutProps & { layout: InvoiceLayout }) {
  if (layout === 'minimal') return <MinimalLayout {...props} />;
  if (layout === 'consulting') return <ConsultingLayout {...props} />;
  return <ClassicLayout {...props} />;
}
