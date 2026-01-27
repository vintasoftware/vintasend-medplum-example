import { MedplumClient } from '@medplum/core';
import type { ContextGenerator } from 'vintasend';
import { VintaSendFactory } from 'vintasend';
import { MedplumSingleton } from './medplum-singleton';
import { formatPatientNameWithPreferredName } from './patients';
import * as compiledTemplates from '../compiled-notification-templates.json';
import { MedplumNotificationBackend, MedplumAttachmentManager, PugInlineEmailTemplateRendererFactory, MedplumLogger } from 'vintasend-medplum';
import { SendgridNotificationAdapterFactory } from 'vintasend-sendgrid';


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

class TaskAssignmentContextGenerator implements ContextGenerator {
  async generate({
    userId,
    taskTitle,
    taskDescription,
    taskIsUrgent,
    taskLink,
    requesterName,
  }: {
    userId: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    requesterName: string;
  }): Promise<{
    firstName: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    requesterName: string;
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
  inboxMessage: new InboxMessageContextGenerator(),
} as const;

export type NotificationTypeConfig = {
  ContextMap: typeof contextGeneratorsMap;
  NotificationIdType: string;
  UserIdType: string;
};

export function getNotificationService(medplum: MedplumClient) {
  const backend = new MedplumNotificationBackend<NotificationTypeConfig>(medplum)
  const templateRenderer = new PugInlineEmailTemplateRendererFactory<NotificationTypeConfig>().create(compiledTemplates);
  const adapter = new SendgridNotificationAdapterFactory<NotificationTypeConfig>().create(
    templateRenderer,
    false,
    {
      apiKey: process.env.SENDGRID_API_KEY || '',
      fromEmail: process.env.SENDGRID_FROM_EMAIL || '',
      fromName: process.env.SENDGRID_FROM_NAME,
    }
  );
  return new VintaSendFactory<NotificationTypeConfig>().create(
    [adapter],
    backend,
    new MedplumLogger(),
    contextGeneratorsMap,
    undefined,
    new MedplumAttachmentManager(medplum),
  );
}