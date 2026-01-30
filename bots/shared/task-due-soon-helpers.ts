import { Task } from '@medplum/fhirtypes';

export type TaskFinalStatus = 'completed' | 'cancelled' | 'failed' | 'rejected' | 'entered-in-error';

export type TaskDueSoonCheck =
  | { kind: 'ok'; hoursUntilDue: number }
  | { kind: 'invalidResource' }
  | { kind: 'noDueDate' }
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

export function getHoursUntil(date: string | Date): number {
  const target = new Date(date);
  const now = new Date();
  return (target.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export function getTaskDueSoonSchedulingReason(task: Task | undefined): TaskDueSoonCheck {
  if (!task || task.resourceType !== 'Task') {
    return { kind: 'invalidResource' };
  }

  const dueDate = task.restriction?.period?.end;
  if (!dueDate) {
    return { kind: 'noDueDate' };
  }

  if (task.status && FINAL_STATES.includes(task.status as TaskFinalStatus)) {
    return { kind: 'finalState', status: task.status };
  }

  if (!task.owner) {
    return { kind: 'noOwner' };
  }

  const hoursUntilDue = getHoursUntil(dueDate);
  if (hoursUntilDue < 24) {
    return { kind: 'tooSoon', hoursUntilDue };
  }

  return { kind: 'ok', hoursUntilDue };
}

export function assertTaskOwnerReference(task: Task): string {
  const reference = task.owner?.reference;
  if (!reference) {
    // eslint-disable-next-line no-console
    console.error('[TaskDueSoonHelper] Task has no owner reference');
    throw new Error('Task must have an owner reference');
  }
  return reference;
}

export function getValidTaskDueDate(task: Task): Date {
  const raw = task.restriction?.period?.end;
  if (!raw) {
    // eslint-disable-next-line no-console
    console.error('[TaskDueSoonHelper] Task has no due date');
    throw new Error('Task must have a due date (restriction.period.end)');
  }

  const dueDate = new Date(raw);
  if (Number.isNaN(dueDate.getTime())) {
    // eslint-disable-next-line no-console
    console.error('[TaskDueSoonHelper] Task has invalid due date:', raw);
    throw new Error('Task must have a valid due date (restriction.period.end)');
  }
  return dueDate;
}

export function parseOwnerReference(
  referenceString: string
): { resourceType: string; id: string } | null {
  if (!referenceString.includes('/')) {
    // eslint-disable-next-line no-console
    console.error('[TaskDueSoonHelper] Invalid referenceString format:', referenceString);
    return null;
  }
  const [resourceType, id] = referenceString.split('/');
  if (!resourceType || !id) {
    // eslint-disable-next-line no-console
    console.error('[TaskDueSoonHelper] Invalid referenceString components:', referenceString);
    return null;
  }
  if (resourceType === 'Group') {
    // eslint-disable-next-line no-console
    console.log('[TaskDueSoonHelper] Task assigned to Group, skipping email notification');
    return null;
  }
  return { resourceType, id };
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
