import crypto from 'node:crypto';
import type { PaymentProviderAdapter, NormalizedPaymentEvent, CreateSubscriptionInput, ProviderSubscriptionResult } from '../payment.interface';
import type { InitiatePaymentInput, PaymentInitiateResult, Currency } from '@crm/shared';

// Stripe — global card payments. Best for international customers paying in USD/EUR/GBP.
// Also handles recurring subscriptions natively.
export class StripeAdapter implements PaymentProviderAdapter {
  readonly name = 'stripe' as const;
  readonly supportedCurrencies: Currency[] = ['USD', 'GBP', 'EUR', 'AED', 'SAR'];
  readonly supportsRecurring = true;
  readonly supportsRefunds = true;

  private secretKey: string;
  private webhookSecret: string;
  private baseUrl = 'https://api.stripe.com/v1';

  constructor(config: Record<string, string>) {
    this.secretKey = config.secretKey;
    this.webhookSecret = config.webhookSecret;
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<PaymentInitiateResult> {
    const session = await this.fetch('/checkout/sessions', 'POST', {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.amount,
          product_data: { name: input.description },
        },
        quantity: 1,
      }],
      customer_email: input.customerEmail,
      client_reference_id: input.orderId,
      success_url: `${input.redirectUrl}?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.redirectUrl}?status=cancelled`,
      metadata: input.metadata ?? {},
    });

    return {
      paymentId: session.payment_intent,
      status: 'pending',
      redirectUrl: session.url,
      checkoutToken: session.id,
    };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscriptionResult> {
    // Create or retrieve customer
    const customers = await this.fetch(
      `/customers?email=${encodeURIComponent(input.customerEmail)}&limit=1`,
      'GET',
    );

    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const customer = await this.fetch('/customers', 'POST', {
        email: input.customerEmail,
        name: input.customerName,
        metadata: { tenantId: input.metadata?.tenantId },
      });
      customerId = customer.id;
    }

    const priceId = process.env[`STRIPE_PRICE_${input.planId.toUpperCase()}_${input.billingCycle.toUpperCase()}`];
    if (!priceId) throw new Error(`No Stripe price ID configured for plan ${input.planId} ${input.billingCycle}`);

    const subscription = await this.fetch('/subscriptions', 'POST', {
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: input.trialDays,
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
      metadata: input.metadata ?? {},
    });

    return {
      providerSubscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    await this.fetch(`/subscriptions/${providerSubscriptionId}`, 'DELETE', {
      cancel_at_period_end: true,
    });
  }

  async refund(providerPaymentId: string, amount?: number): Promise<void> {
    await this.fetch('/refunds', 'POST', {
      payment_intent: providerPaymentId,
      ...(amount ? { amount } : {}),
    });
  }

  verifyWebhook(payload: unknown, headers: Record<string, string>, secret: string): boolean {
    const sig = headers['stripe-signature'];
    if (!sig) return false;
    try {
      const parts = sig.split(',');
      const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
      const receivedSig = parts.find((p) => p.startsWith('v1='))?.slice(3);
      if (!timestamp || !receivedSig) return false;
      const expected = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(`${timestamp}.${JSON.stringify(payload)}`)
        .digest('hex');
      return crypto.timingSafeEqual(Buffer.from(receivedSig), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  normalizeWebhookEvent(payload: unknown): NormalizedPaymentEvent {
    const p = payload as any;
    const type: string = p.type ?? '';
    const obj = p.data?.object ?? {};

    const statusMap: Record<string, NormalizedPaymentEvent['status']> = {
      'payment_intent.succeeded': 'succeeded',
      'payment_intent.payment_failed': 'failed',
      'payment_intent.processing': 'processing',
      'charge.refunded': 'refunded',
      'invoice.paid': 'succeeded',
      'invoice.payment_failed': 'failed',
    };

    return {
      providerPaymentId: obj.id ?? obj.payment_intent,
      orderId: obj.client_reference_id ?? obj.metadata?.orderId ?? '',
      status: statusMap[type] ?? 'pending',
      amount: obj.amount_received ?? obj.amount_paid ?? obj.amount ?? 0,
      currency: (obj.currency?.toUpperCase() ?? 'USD') as Currency,
      fee: obj.balance_transaction?.fee,
      net: obj.balance_transaction?.net,
    };
  }

  private async fetch(path: string, method: string, body?: unknown): Promise<any> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };

    if (body && method !== 'GET') {
      init.body = flattenToFormData(body as Record<string, unknown>);
    }

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, init);
    const data = await res.json();
    if (!res.ok) throw new Error(`Stripe error ${res.status}: ${data.error?.message}`);
    return data;
  }
}

function flattenToFormData(obj: Record<string, unknown>, prefix = ''): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v !== null && v !== undefined) {
      if (typeof v === 'object' && !Array.isArray(v)) {
        const nested = flattenToFormData(v as Record<string, unknown>, key);
        for (const [nk, nv] of new URLSearchParams(nested)) {
          params.set(nk, nv);
        }
      } else {
        params.set(key, String(v));
      }
    }
  }
  return params.toString();
}
