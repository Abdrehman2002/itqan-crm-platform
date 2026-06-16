import crypto from 'node:crypto';
import type { PaymentProviderAdapter, NormalizedPaymentEvent } from '../payment.interface';
import type { InitiatePaymentInput, PaymentInitiateResult, Currency } from '@crm/shared';

// Raast — State Bank of Pakistan's instant payment infrastructure.
// Real-time interbank transfers, 24/7, near-zero cost.
// Works with all Pakistani banks (HBL, UBL, MCB, Meezan, Bank Alfalah, etc.)
// Customers pay via their banking app by scanning QR or sending to IBAN/alias.
// Integration: via PSP (Payment Service Provider) that has Raast membership.
// Common PSPs: 1LINK, Finja, NayaPay, Faysal Bank.
// This adapter integrates via 1LINK's Raast API (most common for merchants).
export class RaastAdapter implements PaymentProviderAdapter {
  readonly name = 'raast' as const;
  readonly supportedCurrencies: Currency[] = ['PKR'];
  readonly supportsRecurring = false;
  readonly supportsRefunds = true;  // Raast supports R2R (Raast-to-Raast) reversals

  private clientId: string;
  private clientSecret: string;
  private merchantIban: string;   // merchant's Raast IBAN (starts with PK)
  private merchantAlias: string;  // Raast ID alias (phone or CNIC-based)
  private baseUrl: string;

  constructor(config: Record<string, string>) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.merchantIban = config.merchantIban;     // e.g. PK36MEZN0001100123456789
    this.merchantAlias = config.merchantAlias;   // e.g. +923001234567 or CNIC alias
    this.baseUrl = config.sandbox === 'true'
      ? 'https://sandbox.1link.net.pk/raast/v1'
      : 'https://api.1link.net.pk/raast/v1';
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<PaymentInitiateResult> {
    if (input.currency !== 'PKR') throw new Error('Raast only supports PKR');

    const token = await this.getAccessToken();

    const amount = input.amount / 100;  // PKR decimal

    // Create a Raast payment request — generates a QR code and deep link
    const res = await fetch(`${this.baseUrl}/payment/request`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        merchantId: this.clientId,
        amount: amount.toFixed(2),
        currency: 'PKR',
        reference: input.orderId,
        description: input.description.slice(0, 100),
        merchantIban: this.merchantIban,
        merchantAlias: this.merchantAlias,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        callbackUrl: input.webhookUrl,
        expiryMinutes: 60,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(`Raast error: ${data.message ?? JSON.stringify(data)}`);

    return {
      paymentId: data.paymentRequestId,
      status: 'pending',
      // Deep link opens the user's bank app (HBL Konnect, MCB Mobile, etc.)
      redirectUrl: data.deepLink,
      // QR code PNG base64 — render in frontend for in-person or desktop payments
      qrCode: data.qrCodeBase64,
      // Also provide manual bank transfer details for users without Raast
      bankDetails: {
        bankName: 'Raast (via any Pakistani bank)',
        accountTitle: process.env.RAAST_ACCOUNT_TITLE ?? 'Your CRM Platform',
        accountNumber: this.merchantAlias,
        iban: this.merchantIban,
        reference: input.orderId,
      },
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }

  verifyWebhook(payload: unknown, headers: Record<string, string>, secret: string): boolean {
    const signature = headers['x-raast-signature'];
    if (!signature) return false;
    const body = JSON.stringify(payload);
    const expected = crypto.createHmac('sha256', this.clientSecret).update(body).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  }

  normalizeWebhookEvent(payload: unknown): NormalizedPaymentEvent {
    const p = payload as any;

    const statusMap: Record<string, NormalizedPaymentEvent['status']> = {
      COMPLETED: 'succeeded',
      SETTLED: 'succeeded',
      FAILED: 'failed',
      EXPIRED: 'failed',
      PENDING: 'pending',
      PROCESSING: 'processing',
      REVERSED: 'refunded',
    };

    return {
      providerPaymentId: p.paymentId ?? p.transactionId,
      orderId: p.reference ?? p.merchantReference,
      status: statusMap[p.status] ?? 'pending',
      amount: Math.round(parseFloat(p.amount ?? '0') * 100),
      currency: 'PKR',
      metadata: {
        senderIban: p.senderIban,
        senderAlias: p.senderAlias,
        bankName: p.senderBank,
        rrn: p.rrn,                    // Raast Reference Number (for reconciliation)
        settlementDate: p.settlementDate,
      },
    };
  }

  async refund(providerPaymentId: string, amount?: number): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${this.baseUrl}/payment/${providerPaymentId}/reverse`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: amount ? (amount / 100).toFixed(2) : undefined }),
    });
    if (!res.ok) throw new Error(`Raast refund failed: ${await res.text()}`);
  }

  private async getAccessToken(): Promise<string> {
    const res = await fetch(`${this.baseUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Raast auth failed: ${data.error}`);
    return data.access_token;
  }
}
