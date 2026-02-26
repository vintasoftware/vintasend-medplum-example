import { MedplumClient } from '@medplum/core';
import type { BotEvent } from '@medplum/core';
import { type BaseGitCommitShaProvider, VintaSendFactory } from 'vintasend';
import * as compiledTemplates from '../compiled-notification-templates.json';
import {
  MedplumNotificationBackend,
  MedplumAttachmentManager,
  PugInlineEmailTemplateRendererFactory,
  MedplumLogger,
} from 'vintasend-medplum';
import { MailgunAdapterFactory } from 'vintasend-mailgun';
import {
  TaskAssignmentContextGenerator,
  TaskDueSoonContextGenerator,
} from './notification-context-generators';
import { MedplumSecretGitCommitShaProvider } from './medplum-secret-git-commit-sha-provider';

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

export type MailgunConfig = {
  MAILGUN_API_KEY: string;
  MAILGUN_DOMAIN: string;
  MAILGUN_FROM_EMAIL: string;
  MAILGUN_FROM_NAME: string;
};

export type GitCommitShaConfig = {
  GIT_CURRENT_COMMIT_SHA?: string;
};

/**
 * Helper function to build MailgunConfig from bot event secrets
 * Reduces duplication across bot handlers
 * Throws if required secrets (API key or from email) are missing
 */
export function buildMailgunConfig(event: BotEvent): MailgunConfig {
  const apiKey = event.secrets.MAILGUN_API_KEY?.valueString;
  const fromEmail = event.secrets.MAILGUN_FROM_EMAIL?.valueString;
  const fromName = event.secrets.MAILGUN_FROM_NAME?.valueString || 'Medplum Notifications';
  const domain = event.secrets.MAILGUN_DOMAIN?.valueString;

  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.error('[buildMailgunConfig] MAILGUN_API_KEY secret is missing or empty');
    throw new Error('MAILGUN_API_KEY must be configured in bot secrets');
  }

  if (!domain) {
    // eslint-disable-next-line no-console
    console.error('[buildMailgunConfig] MAILGUN_DOMAIN secret is missing or empty');
    throw new Error('MAILGUN_DOMAIN must be configured in bot secrets');
  }

  if (!fromEmail) {
    // eslint-disable-next-line no-console
    console.error('[buildMailgunConfig] MAILGUN_FROM_EMAIL secret is missing or empty');
    throw new Error('MAILGUN_FROM_EMAIL must be configured in bot secrets');
  }

  return {
    MAILGUN_API_KEY: apiKey,
    MAILGUN_FROM_EMAIL: fromEmail,
    MAILGUN_FROM_NAME: fromName,
    MAILGUN_DOMAIN: domain,
  };
}

export function buildGitCommitShaConfig(event: BotEvent): GitCommitShaConfig {
  const gitCurrentCommitSha = event.secrets.GIT_CURRENT_COMMIT_SHA?.valueString?.trim();
  return {
    GIT_CURRENT_COMMIT_SHA: gitCurrentCommitSha || undefined,
  };
}

export function getNotificationService(
  medplum: MedplumClient,
  mailgunConfig: MailgunConfig,
  gitCommitShaConfig?: GitCommitShaConfig,
) {
  const backend = new MedplumNotificationBackend<NotificationTypeConfig>(medplum);
  const logger = new MedplumLogger();
  const templateRenderer = new PugInlineEmailTemplateRendererFactory<NotificationTypeConfig>().create(
    compiledTemplates
  );
  const adapter = new MailgunAdapterFactory<NotificationTypeConfig>().create(templateRenderer, false, {
    apiKey: mailgunConfig.MAILGUN_API_KEY || '',
    domain: mailgunConfig.MAILGUN_DOMAIN || '',
    fromEmail: mailgunConfig.MAILGUN_FROM_EMAIL || '',
    fromName: mailgunConfig.MAILGUN_FROM_NAME,
  });
  const gitCommitShaProvider: BaseGitCommitShaProvider =
    gitCommitShaConfig?.GIT_CURRENT_COMMIT_SHA
      ? {
          getCurrentGitCommitSha: () => gitCommitShaConfig.GIT_CURRENT_COMMIT_SHA as string,
        }
      : new MedplumSecretGitCommitShaProvider(medplum);

  return new VintaSendFactory<NotificationTypeConfig>().create({
    adapters: [adapter],
    backend,
    logger,
    contextGeneratorsMap,
    attachmentManager: new MedplumAttachmentManager(medplum),
    gitCommitShaProvider,
  });
}
