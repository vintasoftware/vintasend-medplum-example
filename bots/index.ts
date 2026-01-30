import { Extension } from '@medplum/fhirtypes';

export interface BotDescription {
  name: string;
  criteria?: string;
  extension?: Extension[];
  needsAdminMembership?: boolean;
  runAsUser?: boolean;
  timeout?: number;
  cronString?: string;
}

export const BOTS: BotDescription[] = [
  {
    name: 'send-task-assignment-email',
    needsAdminMembership: true,
    runAsUser: true,
    criteria: 'Task?owner:missing=false',
    extension: [
      {
        url: 'https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction',
        valueCode: 'create',
      },
      {
        url: 'https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction',
        valueCode: 'update',
      },
    ],
  },
  {
    name: 'task-due-notification-bot',
    needsAdminMembership: true,
    runAsUser: true,
    cronString: '*/5 * * * *', // Run every 5 minutes
    timeout: 300, // 5 minutes timeout
  },
  {
    name: 'send-pending-notifications-bot',
    needsAdminMembership: true,
    runAsUser: true,
    cronString: '*/5 * * * *', // Run every 5 minutes
    timeout: 300, // 5 minutes timeout
  },
];