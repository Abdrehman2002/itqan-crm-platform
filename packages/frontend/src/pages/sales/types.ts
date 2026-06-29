export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'partial' | 'paid' | 'overdue' | 'cancelled';
export type PaymentMode = 'bank_transfer' | 'cash' | 'cheque' | 'card' | 'upi' | 'custom';

export interface BillingAddress {
  line1: string; line2?: string; city: string; state: string; country: string; postalCode: string;
}

export interface BillingContact {
  id: string; name: string; email: string; phone?: string; company?: string;
  currency: string; taxId?: string; billingAddress: BillingAddress; createdAt?: string;
}

export interface TaxRate   { id: string; name: string; rate: number; isDefault: boolean; }
export interface BankAccount { id: string; bankName: string; accountName: string; accountNumber: string; ifsc?: string; swift?: string; iban?: string; isDefault: boolean; }
export interface PaymentModeConfig { id: string; name: string; type: PaymentMode; details?: string; }

export interface LineItem {
  id: string; description: string; quantity: number; unitPrice: number;
  taxRate: number; taxAmount: number; total: number;
}

export interface InvoicePayment {
  id: string; invoiceId: string; amount: number; paymentDate: string;
  modeName: string; bankAccountName?: string; reference?: string; notes?: string;
}

export interface Invoice {
  id: string; number: string; status: InvoiceStatus;
  billingContactId?: string;
  contactName?: string; contactEmail?: string; contactCompany?: string;
  contactBillingAddress?: BillingAddress;
  issueDate: string; dueDate: string; poReference?: string; currency: string;
  templateId: string; subtotal: number; totalTax: number; total: number;
  amountPaid: number; amountDue: number;
  lineItems?: LineItem[]; payments?: InvoicePayment[];
  notes?: string; terms?: string; createdAt: string; updatedAt?: string;
}

export interface SalesSettings {
  invoicePrefix: string; nextInvoiceNumber: number; defaultCurrency: string;
  defaultPaymentTerms: number; taxRates: TaxRate[]; bankAccounts: BankAccount[];
  paymentModes: PaymentModeConfig[]; smtpConfigured: boolean;
  companyName?: string; companyEmail?: string; companyPhone?: string;
  companyAddress?: BillingAddress; logoUrl?: string;
}

export interface DashboardStats {
  totalReceivable: number; overdueAmount: number; paidThisMonth: number; draftAmount: number;
  invoicesByStatus: Record<InvoiceStatus, number>;
  agingBuckets: { label: string; amount: number; count: number }[];
  topCustomers: { contactId: string; name: string; amount: number; invoiceCount: number }[];
  topDefaulters: { contactId: string; name: string; amount: number; invoiceCount: number }[];
  monthlyRevenue: { month: string; invoiced: number; collected: number }[];
}

export const CURRENCIES = [
  { code: 'PKR', name: 'Pakistani Rupee',    symbol: 'Rs'   },
  { code: 'USD', name: 'US Dollar',          symbol: '$'    },
  { code: 'GBP', name: 'British Pound',      symbol: '£'    },
  { code: 'EUR', name: 'Euro',               symbol: '€'    },
  { code: 'AED', name: 'UAE Dirham',         symbol: 'د.إ'  },
  { code: 'SAR', name: 'Saudi Riyal',        symbol: '﷼'    },
];

export const INVOICE_TEMPLATES = [
  { id: 'tpl-classic',      name: 'Classic Professional', sector: 'General Business',       accentColor: '#2563eb' },
  { id: 'tpl-minimal',      name: 'Minimal Modern',       sector: 'Freelance / Creative',   accentColor: '#0f172a' },
  { id: 'tpl-consulting',   name: 'Consulting Statement', sector: 'Consulting / Legal',      accentColor: '#4f46e5' },
  { id: 'tpl-retail',       name: 'Retail / Product',     sector: 'Retail / E-commerce',    accentColor: '#f97316' },
  { id: 'tpl-construction', name: 'Construction',         sector: 'Construction / RE',      accentColor: '#d97706' },
  { id: 'tpl-medical',      name: 'Medical',              sector: 'Healthcare',             accentColor: '#0d9488' },
  { id: 'tpl-agency',       name: 'Digital Agency',       sector: 'Marketing / Agency',     accentColor: '#9333ea' },
  { id: 'tpl-logistics',    name: 'Logistics / Freight',  sector: 'Logistics / Transport',  accentColor: '#0284c7' },
];

export function formatCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
}

export function getStatusColor(status: InvoiceStatus) {
  const map: Record<InvoiceStatus, string> = {
    draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700',
    viewed: 'bg-indigo-100 text-indigo-700', partial: 'bg-yellow-100 text-yellow-700',
    paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-400',
  };
  return map[status];
}

export const DEFAULT_SETTINGS: SalesSettings = {
  invoicePrefix: 'INV-', nextInvoiceNumber: 1, defaultCurrency: 'USD',
  defaultPaymentTerms: 30, smtpConfigured: false,
  taxRates: [
    { id: 'tx-001', name: 'No Tax',  rate: 0,  isDefault: false },
    { id: 'tx-002', name: 'Tax 10%', rate: 10, isDefault: true  },
    { id: 'tx-003', name: 'VAT 20%', rate: 20, isDefault: false },
    { id: 'tx-004', name: 'GST 18%', rate: 18, isDefault: false },
  ],
  bankAccounts: [],
  paymentModes: [
    { id: 'pm-001', name: 'Bank Transfer', type: 'bank_transfer' },
    { id: 'pm-002', name: 'Cash',          type: 'cash' },
    { id: 'pm-003', name: 'Cheque',        type: 'cheque' },
    { id: 'pm-004', name: 'Credit Card',   type: 'card' },
    { id: 'pm-005', name: 'UPI / PayNow',  type: 'upi' },
  ],
};
