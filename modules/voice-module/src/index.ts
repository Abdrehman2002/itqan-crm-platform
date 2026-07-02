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
    // permissionKey — see CRM module for rationale. Voice bot pages are
    // separate from human voice calls: bot admin (config/history) requires
    // voicebot:read; agent voice calls require voice:read.
    { path: '/voice',              label: 'Voice Calls',    icon: 'Phone',     permissionKey: 'voice:read'    },
    { path: '/voice/analytics',    label: 'Call Analytics', icon: 'BarChart2', permissionKey: 'analytics:read' },
    { path: '/voice-bot',          label: 'Voice Bot',      icon: 'Bot',       permissionKey: 'voicebot:read' },
    { path: '/voice-bot/calls',    label: 'Bot Calls',      icon: 'List',      permissionKey: 'voicebot:read' },
    { path: '/voice-bot/tickets',  label: 'Bot Tickets',    icon: 'LifeBuoy',  permissionKey: 'voicebot:read' },
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
