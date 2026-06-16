export type Currency = 'USD' | 'PKR' | 'GBP' | 'EUR' | 'AED' | 'SAR';

export type PaymentProvider =
  | 'stripe'        // Card (global)
  | 'wise'          // Wise (international transfers, great for cross-border PKR→USD)
  | 'jazzcash'      // Pakistan mobile wallet (Jazz subscribers)
  | 'easypaisa'     // Pakistan mobile wallet (Telenor subscribers)
  | 'raast'         // SBP's instant payment system (Pakistan interbank)
  | 'payfast'       // Pakistan payment gateway (cards + wallets)
  | 'bank_transfer' // Manual bank transfer (generic)
  | 'paypal';       // PayPal

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'cancelled'
  | 'requires_action';  // 3DS or OTP pending

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'cancelled'
  | 'unpaid';

export type BillingCycle = 'monthly' | 'annual';

export interface PlanPricing {
  plan: string;
  billingCycle: BillingCycle;
  currency: Currency;
  amount: number;           // in smallest unit (paisa for PKR, cents for USD)
  displayAmount: number;    // human-readable (e.g. 2999 PKR)
}

// All plans priced in PKR and USD
export const PLAN_PRICING: PlanPricing[] = [
  // USD pricing
  { plan: 'starter',      billingCycle: 'monthly', currency: 'USD', amount: 2900,    displayAmount: 29 },
  { plan: 'starter',      billingCycle: 'annual',  currency: 'USD', amount: 27840,   displayAmount: 278.4 },
  { plan: 'professional', billingCycle: 'monthly', currency: 'USD', amount: 7900,    displayAmount: 79 },
  { plan: 'professional', billingCycle: 'annual',  currency: 'USD', amount: 75840,   displayAmount: 758.4 },
  { plan: 'enterprise',   billingCycle: 'monthly', currency: 'USD', amount: 0,       displayAmount: 0 }, // custom
  // PKR pricing (for Pakistan-based customers)
  { plan: 'starter',      billingCycle: 'monthly', currency: 'PKR', amount: 799900,  displayAmount: 7999 },
  { plan: 'starter',      billingCycle: 'annual',  currency: 'PKR', amount: 7679040, displayAmount: 76790 },
  { plan: 'professional', billingCycle: 'monthly', currency: 'PKR', amount: 2199900, displayAmount: 21999 },
  { plan: 'professional', billingCycle: 'annual',  currency: 'PKR', amount: 21119040,displayAmount: 211190 },
];

export interface Subscription {
  id: string;
  tenantId: string;
  plan: string;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  currency: Currency;
  amount: number;
  provider: PaymentProvider;
  providerSubscriptionId?: string;  // Stripe subscription ID, etc.
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Invoice {
  id: string;
  tenantId: string;
  subscriptionId: string;
  invoiceNumber: string;        // INV-2024-001
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  currency: Currency;
  subtotal: number;
  tax: number;
  taxRate: number;              // e.g. 0.18 for GST 18%
  total: number;
  provider: PaymentProvider;
  providerInvoiceId?: string;
  paidAt?: Date;
  dueAt: Date;
  lineItems: InvoiceLineItem[];
  billingDetails: BillingDetails;
  createdAt: Date;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  total: number;
}

export interface BillingDetails {
  name: string;
  email: string;
  phone?: string;
  address?: {
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode?: string;
    country: string;             // ISO 3166-1 alpha-2
  };
  taxId?: string;               // NTN for Pakistan, GST number, etc.
  ntn?: string;                 // National Tax Number (Pakistan)
}

export interface Payment {
  id: string;
  tenantId: string;
  invoiceId?: string;
  provider: PaymentProvider;
  providerPaymentId: string;    // Stripe charge ID, JazzCash transaction ID, etc.
  status: PaymentStatus;
  currency: Currency;
  amount: number;
  fee?: number;                 // provider fee
  net?: number;                 // amount after fee
  failureReason?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// What the adapter gets when initiating a payment
export interface InitiatePaymentInput {
  amount: number;
  currency: Currency;
  description: string;
  customerEmail: string;
  customerName: string;
  customerPhone?: string;
  orderId: string;             // our invoice/reference ID
  redirectUrl: string;         // where to send user after payment
  webhookUrl: string;
  metadata?: Record<string, string>;
}

// What every payment adapter returns
export interface PaymentInitiateResult {
  paymentId: string;           // provider-assigned transaction ID
  status: PaymentStatus;
  redirectUrl?: string;        // send user here to complete payment
  checkoutToken?: string;      // for embedded checkout flows
  qrCode?: string;             // for JazzCash/Easypaisa QR payments
  bankDetails?: BankTransferDetails;
  expiresAt?: Date;
}

export interface BankTransferDetails {
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban?: string;
  swiftCode?: string;
  routingNumber?: string;
  reference: string;           // must include in transfer description
}
