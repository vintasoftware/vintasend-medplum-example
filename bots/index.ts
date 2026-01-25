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
];