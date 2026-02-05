import { Task } from '@medplum/fhirtypes';

export type TaskFinalStatus = 'completed' | 'cancelled' | 'failed' | 'rejected' | 'entered-in-error';

export type TaskDueSoonCheck =
  | { kind: 'ok' }
  | { kind: 'invalidResource' }
  | { kind: 'noDueDate' }
  | { kind: 'invalidDueDate'; dueDate: string }
  | { kind: 'finalState'; status: string }
  | { kind: 'noOwner' }
  | { kind: 'tooSoon'; hoursUntilDue: number };

const FINAL_STATES: readonly TaskFinalStatus[] = [
  'completed',
  'cancelled',
  'failed',
  'rejected',
  'entered-in-error',
] as const;

export function getTaskDueSoonSchedulingReason(task: Task | undefined): TaskDueSoonCheck {
  if (!task || task.resourceType !== 'Task') {
    return { kind: 'invalidResource' };
  }

  if (task.status && FINAL_STATES.includes(task.status as TaskFinalStatus)) {
    return { kind: 'finalState', status: task.status };
  }

  return { kind: 'ok' };
}

export function computeReminderTime(dueDate: Date, hoursBefore: number): Date | null {
  const sendAfter = new Date(dueDate.getTime() - hoursBefore * 60 * 60 * 1000);
  if (sendAfter <= new Date()) {
    // eslint-disable-next-line no-console
    console.log('[TaskDueSoonHelper] Reminder time is in the past or within window, skipping');
    return null;
  }
  return sendAfter;
}
