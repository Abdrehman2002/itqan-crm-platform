export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ApiMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;    // first 8 chars shown in UI
  keyHash: string;      // bcrypt hash stored
  scopes: ApiScope[];
  rateLimit?: number;   // override per-key rate limit
  expiresAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
}

export type ApiScope =
  | 'contacts:read'
  | 'contacts:write'
  | 'deals:read'
  | 'deals:write'
  | 'activities:read'
  | 'activities:write'
  | 'voice:read'
  | 'voice:write'
  | 'analytics:read'
  | 'webhooks:manage'
  | 'admin:read'
  | 'admin:write'
  | 'tickets:read'
  | 'tickets:write';

export interface Webhook {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  secret: string;       // HMAC signing secret
  events: string[];     // subscribed event types
  isActive: boolean;
  headers?: Record<string, string>;
  retryPolicy: WebhookRetryPolicy;
  createdAt: Date;
}

export interface WebhookRetryPolicy {
  maxRetries: number;   // default 3
  backoffMs: number;    // default 1000
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  tenantId: string;
  event: string;
  payload: Record<string, unknown>;
  statusCode?: number;
  response?: string;
  attempts: number;
  succeeded: boolean;
  createdAt: Date;
}
