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
  },
];