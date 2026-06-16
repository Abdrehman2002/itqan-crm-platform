/**
 * Voice Platform Module
 *
 * Adds AI-powered voice calling to the platform.
 * Requires the `voiceBot` feature flag and at least the `starter` plan.
 *
 * Bundles: Voice Calls list, Voice Analytics, Live Call Stream.
 * Requires a connected telephony provider (Twilio / Vonage / SIP).
 */

import type { FastifyInstance } from 'fastify';
import type { PlatformModule, ModuleContext } from '@crm/shared';
import { logger } from '@crm/core/config/logger';

export class VoicePlatformModule implements PlatformModule {
  readonly id = 'voice';
  readonly label = 'Voice';
  readonly icon = 'Phone';
  readonly requiredPlan = 'starter' as const;

  readonly navItems = [
    { path: '/voice',              label: 'Voice Calls',    icon: 'Phone'     },
    { path: '/voice/analytics',    label: 'Call Analytics', icon: 'BarChart2' },
    { path: '/voice-bot',          label: 'Voice Bot',      icon: 'Bot'       },
    { path: '/voice-bot/calls',    label: 'Bot Calls',      icon: 'List'      },
    { path: '/voice-bot/tickets',  label: 'Bot Tickets',    icon: 'LifeBuoy'  },
  ];

  async onLoad(_ctx: ModuleContext): Promise<void> {
    logger.info('Voice Platform Module loaded');
  }

  async onUnload(): Promise<void> {
    logger.info('Voice Platform Module unloaded');
  }

  async registerRoutes(fastify: FastifyInstance, prefix: string): Promise<void> {
    logger.info(`Voice routes registered under ${prefix}`);
  }
}
