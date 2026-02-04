import { BotEvent, MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { scheduleTaskDueSoonEmail } from '../services/emails/schedule-task-due-soon-email';
import { buildSendGridConfig } from '../../lib/notification-service';
import { getTaskDueSoonSchedulingReason } from '../shared/task-due-soon-helpers';

/**
 * Medplum Bot: Task Due Soon Notification
 *
 * This bot triggers on Task creation/update and schedules email notifications
 * to be sent 24 hours before the task due date.
 *
 * The bot uses VintaSend's scheduled messages (sendAfter) to ensure
 * notifications are sent at the appropriate time. The actual sending is
 * handled by the send-pending-notifications-bot.
 *
 * Subscription: Task (create/update)
 */

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const task = event.input as Task;
  const result = getTaskDueSoonSchedulingReason(task);

  switch (result.kind) {
    case 'invalidResource':
      console.warn('[TaskDueSoonNotificationBot] Invalid task resource received');
      return { message: 'Invalid task resource' };
    case 'noDueDate':
      console.log(`[TaskDueSoonNotificationBot] Task ${task?.id} has no due date, skipping`);
      return { message: 'No due date set', taskId: task?.id };
    case 'invalidDueDate':
      console.warn(
        `[TaskDueSoonNotificationBot] Task ${task?.id} has invalid due date: ${result.dueDate}, skipping`
      );
      return { message: 'Invalid due date', taskId: task?.id, dueDate: result.dueDate };
    case 'finalState':
      console.log(
        `[TaskDueSoonNotificationBot] Task ${task?.id} is in final state (${result.status}), skipping`
      );
      return { message: `Task in final state: ${result.status}`, taskId: task?.id };
    case 'noOwner':
      console.log(`[TaskDueSoonNotificationBot] Task ${task?.id} has no owner, skipping`);
      return { message: 'No owner assigned', taskId: task?.id };
    case 'tooSoon':
      console.log(
        `[TaskDueSoonNotificationBot] Task ${task?.id} is due in ${result.hoursUntilDue.toFixed(
          2
        )} hours (less than 24), skipping`
      );
      return {
        message: 'Due date is less than 24 hours away',
        taskId: task?.id,
        hoursUntilDue: result.hoursUntilDue,
      };
    case 'ok':
      break;
  }

  const appBaseUrl = event.secrets.PROVIDER_APP_BASE_URL?.valueString;
  if (!appBaseUrl) {
    console.error('[TaskDueSoonNotificationBot] PROVIDER_APP_BASE_URL secret is not set');
    throw new Error('PROVIDER_APP_BASE_URL must be configured in bot secrets');
  }

  const sendgridConfig = buildSendGridConfig(event);

  try {
    console.log(
      `[TaskDueSoonNotificationBot] Scheduling notification for task ${task.id}, due in ${result.hoursUntilDue.toFixed(
        2
      )} hours`
    );
    await scheduleTaskDueSoonEmail(medplum, task, appBaseUrl, sendgridConfig);

    return {
      message: 'Notification scheduled successfully',
      taskId: task.id,
      dueDate: task.restriction?.period?.end,
      hoursUntilDue: result.hoursUntilDue.toFixed(2),
    };
  } catch (error) {
    console.error(`[TaskDueSoonNotificationBot] Error scheduling notification for task ${task.id}:`, error);
    throw error;
  }
}

