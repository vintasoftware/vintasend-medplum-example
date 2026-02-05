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
    name: 'task-assignment-email-bot',
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
    name: 'task-due-soon-notification-bot',
    needsAdminMembership: true,
    runAsUser: true,
    criteria: 'Task',
    extension: [
      {
        url: 'https://medplum.com/fhir/StructureDefinition/fhir-path-criteria-expression',
        valueString: '%previous.id.exists().not() or %previous.owner.exists().not() or %previous.restriction.period.exists().not() or %current.owner.exists().not() or %current.restriction.period.exists().not() or (%previous.restriction.period.end != %current.restriction.period.end) or (%previous.owner.reference != %current.owner.reference)',
      },
    ],
  },
  {
    name: 'send-pending-notifications-bot',
    needsAdminMembership: true,
    runAsUser: true,
    cronString: '*/5 * * * *', // Run every 5 minutes
    timeout: 300, // 5 minutes timeout
  },
];
