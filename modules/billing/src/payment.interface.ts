import type {
  InitiatePaymentInput,
  PaymentInitiateResult,
  Payment,
  PaymentProvider,
  Currency,
} from '@crm/shared';

// Every payment provider must implement this interface.
// Business logic never touches provider SDKs directly — only this contract.
export interface PaymentProviderAdapter {
  readonly name: PaymentProvider;
  readonly supportedCurrencies: Currency[];
  readonly supportsRecurring: boolean;         // can it handle subscriptions natively?
  readonly supportsRefunds: boolean;

  // Initiate a one-time payment (returns redirect URL or QR for wallet payments)
  initiatePayment(input: InitiatePaymentInput): Promise<PaymentInitiateResult>;

  // Verify and normalize an inbound webhook payload
  verifyWebhook(payload: unknown, headers: Record<string, string>, secret: string): boolean;
  normalizeWebhookEvent(payload: unknown): NormalizedPaymentEvent;

  // Optional: create a recurring subscription at the provider level
  createSubscription?(input: CreateSubscriptionInput): Promise<ProviderSubscriptionResult>;
  cancelSubscription?(providerSubscriptionId: string): Promise<void>;

  // Refund a completed payment
  refund?(providerPaymentId: string, amount?: number): Promise<void>;

  // Get current payment status from provider (polling fallback)
  getPaymentStatus?(providerPaymentId: string): Promise<Payment['status']>;
}

export interface NormalizedPaymentEvent {
  providerPaymentId: string;
  orderId: string;              // maps back to our invoice/order reference
  status: Payment['status'];
  amount: number;
  currency: Currency;
  fee?: number;
  net?: number;                 // amount - fee, populated when the adapter reports it (Stripe balance_transaction)
  metadata?: Record<string, unknown>;
}

export interface CreateSubscriptionInput extends InitiatePaymentInput {
  planId: string;
  billingCycle: 'monthly' | 'annual';
  trialDays?: number;
}

export interface ProviderSubscriptionResult {
  providerSubscriptionId: string;
  status: string;
  currentPeriodEnd: Date;
}
