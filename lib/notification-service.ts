import { MedplumClient } from '@medplum/core';
import type { BotEvent } from '@medplum/core';
import type { ContextGenerator } from 'vintasend';
import { VintaSendFactory } from 'vintasend';
import { MedplumSingleton } from './medplum-singleton';
import { formatPatientNameWithPreferredName } from './patients';
import * as compiledTemplates from '../compiled-notification-templates.json';
import {
  MedplumNotificationBackend,
  MedplumAttachmentManager,
  PugInlineEmailTemplateRendererFactory,
  MedplumLogger,
} from 'vintasend-medplum';
import { SendgridNotificationAdapterFactory } from 'vintasend-sendgrid';
import type { Media } from '@medplum/fhirtypes';
import { getBinaryFromMedia } from './file-upload';

async function getUserById(medplum: MedplumClient, referenceString: string) {
  if (!referenceString) {
    // eslint-disable-next-line no-console
    console.error('[getUserById] referenceString is null/undefined/empty!');
    throw new Error('The "id" parameter cannot be null, undefined, or an empty string.');
  }

  const [resourceType, id] = referenceString.split('/');

  if (!id) {
    // eslint-disable-next-line no-console
    console.error('[getUserById] ID extracted from referenceString is empty!');
    throw new Error('The "id" parameter cannot be null, undefined, or an empty string.');
  }

  return medplum.readResource(resourceType as 'Patient' | 'Practitioner', id);
}

/**
 * Converts a Media resource to VintaSend attachment format.
 * 
 * Fetches the Binary resource referenced by the Media and extracts the file data,
 * then returns it in the format expected by VintaSend for email attachments.
 * 
 * @param medplum - The Medplum client instance
 * @param media - The Media resource containing the file metadata
 * @returns A NotificationAttachmentUpload object with file, filename, and contentType
 * 
 * @example
 * const attachment = await convertMediaToAttachment(medplum, media);
 * // { file: Buffer, filename: 'document.pdf', contentType: 'application/pdf' }
 */
export async function convertMediaToAttachment(
  medplum: MedplumClient,
  media: Media
): Promise<{
  file: Buffer;
  filename: string;
  contentType: string;
} | null> {
  try {
    // Fetch Binary resource from media.content.url
    const binary = await getBinaryFromMedia(medplum, media);
    
    if (!binary) {
      console.error('[convertMediaToAttachment] Failed to fetch Binary resource for Media:', media.id);
      return null;
    }

    // Extract file data - Binary.data is base64-encoded
    let file: Buffer;
    if (binary.data) {
      // If data is embedded in the Binary resource as base64
      file = Buffer.from(binary.data, 'base64');
    } else {
      // If Binary is stored externally, we need to fetch it via URL
      // This is handled by getBinaryFromMedia
      console.error('[convertMediaToAttachment] Binary resource has no data:', binary.id);
      return null;
    }

    // Return in VintaSend NotificationAttachmentUpload format
    return {
      file,
      filename: media.content?.title || 'attachment',
      contentType: media.content?.contentType || 'application/octet-stream',
    };
  } catch (error) {
    console.error('[convertMediaToAttachment] Error converting Media to attachment:', error);
    return null;
  }
}

class TaskAssignmentContextGenerator implements ContextGenerator {
  async generate({
    userId,
    taskTitle,
    taskDescription,
    taskIsUrgent,
    taskLink,
    requesterName,
    attachmentCount,
  }: {
    userId: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    requesterName: string;
    attachmentCount?: number;
  }): Promise<{
    firstName: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    requesterName: string;
    attachmentCount: number;
  }> {
    const medplum = MedplumSingleton.getInstance();
    const user = await getUserById(medplum, userId);
    const firstName = formatPatientNameWithPreferredName(user.name?.[0]) ?? 'Practitioner';

    return {
      firstName,
      taskTitle,
      taskDescription,
      taskIsUrgent,
      taskLink,
      requesterName,
      attachmentCount: attachmentCount || 0,
    };
  }
}

class TaskDueSoonContextGenerator implements ContextGenerator {
  async generate({
    userId,
    taskTitle,
    taskDescription,
    taskIsUrgent,
    taskLink,
    dueDate,
  }: {
    userId: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    dueDate: string;
  }): Promise<{
    firstName: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    dueDate: string;
  }> {
    const medplum = MedplumSingleton.getInstance();
    const user = await getUserById(medplum, userId);
    const firstName = formatPatientNameWithPreferredName(user.name?.[0]) ?? 'Practitioner';

    return {
      firstName,
      taskTitle,
      taskDescription,
      taskIsUrgent,
      taskLink,
      dueDate,
    };
  }
}

class InboxMessageContextGenerator implements ContextGenerator {
  async generate({
    userId,
    sender,
    messageContent,
    messageTopic,
  }: {
    userId: string;
    sender: string;
    messageContent: string;
    messageTopic: string;
  }): Promise<{
    firstName: string;
    senderName: string;
    senderFirstName: string;
    messageContent: string;
    messageTopic: string;
  }> {
    const medplum = MedplumSingleton.getInstance();
    const user = await getUserById(medplum, userId);
    const firstName = formatPatientNameWithPreferredName(user.name?.[0]) ?? 'Practitioner';

    // Extract sender name from reference
    let senderName = 'Unknown';
    let senderFirstName = 'Unknown';
    try {
      const [senderResourceType, senderId] = sender.split('/');
      if (senderId) {
        const senderResource = await medplum.readResource(senderResourceType as 'Patient' | 'Practitioner', senderId);
        senderName = formatPatientNameWithPreferredName(senderResource.name?.[0]) ?? 'Unknown';
        senderFirstName = senderResource.name?.[0]?.given?.[0] || 'Unknown';
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[InboxMessageContextGenerator] Error fetching sender:', error);
    }

    return {
      firstName,
      senderName,
      senderFirstName,
      messageContent,
      messageTopic,
    };
  }
}

// context map for generating the context of each notification
export const contextGeneratorsMap = {
  taskAssignment: new TaskAssignmentContextGenerator(),
  taskDueSoon: new TaskDueSoonContextGenerator(),
  inboxMessage: new InboxMessageContextGenerator(),
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
