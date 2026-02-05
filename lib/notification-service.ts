import { MedplumClient } from '@medplum/core';
import type { BotEvent } from '@medplum/core';
import { VintaSendFactory } from 'vintasend';
import * as compiledTemplates from '../compiled-notification-templates.json';
import {
  MedplumNotificationBackend,
  MedplumAttachmentManager,
  PugInlineEmailTemplateRendererFactory,
  MedplumLogger,
} from 'vintasend-medplum';
import { SendgridNotificationAdapterFactory } from 'vintasend-sendgrid';
import {
  TaskAssignmentContextGenerator,
  TaskDueSoonContextGenerator,
} from './notification-context-generators';

// context map for generating the context of each notification
export const contextGeneratorsMap = {
  taskAssignment: new TaskAssignmentContextGenerator(),
  taskDueSoon: new TaskDueSoonContextGenerator(),
} as const;

export type NotificationTypeConfig = {
  ContextMap: typeof contextGeneratorsMap;
  NotificationIdType: string;
  UserIdType: string;
};

export type SendGridConfig = {
  SENDGRID_API_KEY: string;
  SENDGRID_FROM_EMAIL: string;
  SENDGRID_FROM_NAME: string;
};

/**
 * Helper function to build SendGridConfig from bot event secrets
 * Reduces duplication across bot handlers
 * Throws if required secrets (API key or from email) are missing
 */
export function buildSendGridConfig(event: BotEvent): SendGridConfig {
  const apiKey = event.secrets.SENDGRID_API_KEY?.valueString;
  const fromEmail = event.secrets.SENDGRID_FROM_EMAIL?.valueString;
  const fromName = event.secrets.SENDGRID_FROM_NAME?.valueString || 'Medplum Notifications';

  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.error('[buildSendGridConfig] SENDGRID_API_KEY secret is missing or empty');
    throw new Error('SENDGRID_API_KEY must be configured in bot secrets');
  }

  if (!fromEmail) {
    // eslint-disable-next-line no-console
    console.error('[buildSendGridConfig] SENDGRID_FROM_EMAIL secret is missing or empty');
    throw new Error('SENDGRID_FROM_EMAIL must be configured in bot secrets');
  }

  return {
    SENDGRID_API_KEY: apiKey,
    SENDGRID_FROM_EMAIL: fromEmail,
    SENDGRID_FROM_NAME: fromName,
  };
}

export function getNotificationService(medplum: MedplumClient, sendgridConfig: SendGridConfig) {
  const backend = new MedplumNotificationBackend<NotificationTypeConfig>(medplum);
  const templateRenderer = new PugInlineEmailTemplateRendererFactory<NotificationTypeConfig>().create(
    compiledTemplates
  );
  const adapter = new SendgridNotificationAdapterFactory<NotificationTypeConfig>().create(templateRenderer, false, {
    apiKey: sendgridConfig.SENDGRID_API_KEY || '',
    fromEmail: sendgridConfig.SENDGRID_FROM_EMAIL || '',
    fromName: sendgridConfig.SENDGRID_FROM_NAME,
  });
  return new VintaSendFactory<NotificationTypeConfig>().create(
    [adapter],
    backend,
    new MedplumLogger(),
    contextGeneratorsMap,
    undefined,
    new MedplumAttachmentManager(medplum)
  );
}
