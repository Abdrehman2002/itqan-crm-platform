export { DatabaseClient } from './database/client';
export { EventBus, CRM_EVENTS } from './events/event-bus';
export { ModuleRegistry } from './modules/module-registry';
export { TenantService } from './tenant/tenant.service';
export { logger } from './config/logger';
export { buildRedisClient } from './config/redis';
export type { RedisClient } from './config/redis';
export { EmailService } from './email.service';
export type { SendEmailOpts, SendResult } from './email.service';

export { SmsService } from './sms.service';
export type { SendSmsOpts, SendSmsResult } from './sms.service';
