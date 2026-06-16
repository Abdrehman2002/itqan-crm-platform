import crypto from 'node:crypto';
import type { PaymentProviderAdapter, NormalizedPaymentEvent } from '../payment.interface';
import type { InitiatePaymentInput, PaymentInitiateResult, Currency } from '@crm/shared';

// JazzCash — Pakistan's largest mobile wallet (Jazz/Warid subscribers).
// Supports: mobile account payments, MIGS card payments, QR codes.
// All amounts are in PKR paisa (1 PKR = 100 paisa).
// Docs: https://sandbox.jazzcash.com.pk/
export class JazzCashAdapter implements PaymentProviderAdapter {
  readonly name = 'jazzcash' as const;
  readonly supportedCurrencies: Currency[] = ['PKR'];
  readonly supportsRecurring = false;
  readonly supportsRefunds = false;  // JazzCash refunds are manual

  private merchantId: string;
  private password: string;
  private integrityKey: string;
  private baseUrl: string;

  constructor(config: Record<string, string>) {
    this.merchantId = config.merchantId;
    this.password = config.password;
    this.integrityKey = config.integrityKey;
    this.baseUrl = config.sandbox === 'true'
      ? 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform'
      : 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform';
  }

  async initiatePayment(input: InitiatePaymentInput): Promise<PaymentInitiateResult> {
    if (input.currency !== 'PKR') {
      throw new Error('JazzCash only supports PKR');
    }

    const txnDateTime = formatJazzCashDate(new Date());
    const txnExpiryDateTime = formatJazzCashDate(new Date(Date.now() + 3600_000)); // 1 hour
    const txnRefNumber = `T${input.orderId.replace(/-/g, '').slice(0, 14)}`;
    const txnAmount = String(input.amount); // in paisa

    // Hash: integrityKey&Amount&Currency&DateTime&ExpiryDateTime&MerchantId&Password&TxnRefNo
    const hashString = [
      this.integrityKey,
      txnAmount,
      'PKR',
      txnDateTime,
      txnExpiryDateTime,
      this.merchantId,
      this.password,
      txnRefNumber,
    ].join('&');

    const secureHash = crypto
      .createHmac('sha256', this.integrityKey)
      .update(hashString)
      .digest('hex')
      .toUpperCase();

    // JazzCash uses an HTML form POST — we generate the URL + params
    // so the frontend can redirect the user
    const params = new URLSearchParams({
      pp_Version: '1.1',
      pp_TxnType: 'MWALLET',
      pp_Language: 'EN',
      pp_MerchantID: this.merchantId,
      pp_Password: this.password,
      pp_TxnRefNo: txnRefNumber,
      pp_Amount: txnAmount,
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: txnDateTime,
      pp_BillReference: input.orderId,
      pp_Description: input.description.slice(0, 50),
      pp_TxnExpiryDateTime: txnExpiryDateTime,
      pp_ReturnURL: input.redirectUrl,
      pp_SecureHash: secureHash,
      ppmpf_1: input.customerEmail.slice(0, 30),
      ppmpf_2: input.customerPhone?.replace(/\D/g, '') ?? '',
      ppmpf_3: '',
      ppmpf_4: '',
      ppmpf_5: '',
    });

    return {
      paymentId: txnRefNumber,
      status: 'pending',
      redirectUrl: `${this.baseUrl}?${params.toString()}`,
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }

  verifyWebhook(payload: unknown, headers: Record<string, string>, secret: string): boolean {
    const p = payload as Record<string, string>;
    if (!p.pp_SecureHash) return false;

    // Reconstruct hash from response fields (exclude pp_SecureHash itself)
    const fields = Object.keys(p)
      .filter((k) => k !== 'pp_SecureHash' && p[k])
      .sort()
      .map((k) => p[k]);

    const hashString = [this.integrityKey, ...fields].join('&');
    const expected = crypto
      .createHmac('sha256', this.integrityKey)
      .update(hashString)
      .digest('hex')
      .toUpperCase();

    return crypto.timingSafeEqual(
      Buffer.from(p.pp_SecureHash.toUpperCase()),
      Buffer.from(expected),
    );
  }

  normalizeWebhookEvent(payload: unknown): NormalizedPaymentEvent {
    const p = payload as Record<string, string>;

    // JazzCash response codes: 000 = success, 001 = paid, others = failed
    const succeeded = p.pp_ResponseCode === '000' || p.pp_ResponseCode === '001';
    const status: NormalizedPaymentEvent['status'] = succeeded ? 'succeeded' : 'failed';

    return {
      providerPaymentId: p.pp_TxnRefNo,
      orderId: p.pp_BillReference,
      status,
      amount: parseInt(p.pp_Amount ?? '0'),
      currency: 'PKR',
      metadata: {
        responseCode: p.pp_ResponseCode,
        responseMessage: p.pp_ResponseMessage,
        mobileNumber: p.pp_MobileNumber,
        bankTransactionId: p.pp_BankTxnRefNo,
      },
    };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<'pending' | 'succeeded' | 'failed'> {
    // JazzCash doesn't have a status inquiry API in basic integration
    // Enhanced integration (requires JazzCash approval) supports status checks
    return 'pending';
  }
}

function formatJazzCashDate(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}
