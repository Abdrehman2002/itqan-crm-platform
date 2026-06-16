import crypto from 'node:crypto';
import type { PaymentProviderAdapter, NormalizedPaymentEvent } from '../payment.interface';
import type { InitiatePaymentInput, PaymentInitiateResult, Currency } from '@crm/shared';

// Wise (formerly TransferWise) — best for international B2B payments and
// cross-border USD/GBP → PKR transfers. Used when customers want to pay
// from outside Pakistan or companies doing international SaaS billing.
export class WiseAdapter implements PaymentProviderAdapter {
  readonly name = 'wise' as const;
  readonly supportedCurrencies: Currency[] = ['USD', 'GBP', 'EUR', 'PKR', 'AED', 'SAR'];
  readonly supportsRecurring = false;   // Wise doesn't have native recurring; we handle via cron
  readonly supportsRefunds = true;

  private apiKey: string;
  private profileId: string;           // Wise Business profile ID
  private webhookSecret: string;
  private baseUrl: string;

  constructor(config: Record<string, string>) {
    this.apiKey = config.apiKey;
    this.profileId = config.profileId;
    this.webhookSecret = config.webhookSecret;
    // Use sandbox URL in non-production
    this.baseUrl = config.sandbox === 'true'
      ? 'https://api.sandbox.transferwise.tech'
      : 'https://api.wise.com';
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<PaymentInitiateResult> {
    // Wise payment link flow:
    // 1. Create a quote for the amount
    // 2. Create a payment link the customer can pay via Wise balance or bank transfer

    const quoteRes = await this.fetch('/v3/quotes', 'POST', {
      sourceCurrency: input.currency,
      targetCurrency: input.currency,
      sourceAmount: input.amount / 100,   // Wise uses decimal amounts
      payOut: 'BALANCE',
    });

    const linkRes = await this.fetch('/v2/payment-links', 'POST', {
      profileId: this.profileId,
      amount: {
        value: input.amount / 100,
        currency: input.currency,
      },
      description: input.description,
      reference: input.orderId,
      expiryDate: new Date(Date.now() + 7 * 86_400_000).toISOString().split('T')[0], // 7 days
      notificationUrl: input.webhookUrl,
      returnUrl: input.redirectUrl,
    });

    // Also provide bank transfer details as fallback for customers without Wise accounts
    const bankDetails = this.getBankTransferDetails(input.currency, input.orderId);

    return {
      paymentId: linkRes.id,
      status: 'pending',
      redirectUrl: linkRes.url,
      bankDetails,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    };
  }

  // Wise-specific: get our own bank account details so customers can wire money
  private getBankTransferDetails(currency: Currency, reference: string) {
    const accounts: Record<string, object> = {
      USD: {
        bankName: 'Wise (via US ACH)',
        accountTitle: 'Your CRM Platform Inc.',
        accountNumber: process.env.WISE_USD_ACCOUNT_NUMBER ?? '',
        routingNumber: process.env.WISE_USD_ROUTING ?? '',
        reference,
      },
      GBP: {
        bankName: 'Wise (UK)',
        accountTitle: 'Your CRM Platform Ltd.',
        accountNumber: process.env.WISE_GBP_ACCOUNT_NUMBER ?? '',
        iban: process.env.WISE_GBP_IBAN ?? '',
        reference,
      },
      PKR: {
        bankName: 'Wise (via Pakistan)',
        accountTitle: 'Your CRM Platform',
        accountNumber: process.env.WISE_PKR_ACCOUNT_NUMBER ?? '',
        iban: process.env.WISE_PKR_IBAN ?? '',
        reference,
      },
    };
    return (accounts[currency] ?? accounts.USD) as any;
  }

  verifyWebhook(payload: unknown, headers: Record<string, string>, secret: string): boolean {
    const signature = headers['x-signature-sha256'];
    if (!signature) return false;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  normalizeWebhookEvent(payload: unknown): NormalizedPaymentEvent {
    const p = payload as any;
    const eventType: string = p.event_type ?? '';

    // Wise webhook events: balances#credit, transfers#state-change, payment-links#payment
    let status: NormalizedPaymentEvent['status'] = 'pending';
    if (eventType.includes('payment') && p.data?.status === 'COMPLETED') status = 'succeeded';
    if (p.data?.status === 'FAILED' || p.data?.status === 'CANCELLED') status = 'failed';

    return {
      providerPaymentId: String(p.data?.id ?? ''),
      orderId: p.data?.reference ?? '',
      status,
      amount: Math.round((p.data?.amount?.value ?? 0) * 100),
      currency: (p.data?.amount?.currency ?? 'USD') as Currency,
    };
  }

  async refund(providerPaymentId: string): Promise<void> {
    // Wise refunds are done manually through the dashboard or via transfer back
    // For now, log the request — in production you'd initiate a transfer back
    throw new Error('Wise refunds must be initiated manually via Wise dashboard or a reverse transfer');
  }

  private async fetch(path: string, method: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Wise API error ${res.status}: ${JSON.stringify(data)}`);
    return data;
  }
}
