import { BotEvent, MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { scheduleTaskDueSoonEmail } from '../services/emails/schedule-task-due-soon-email';
import { buildMailgunConfig } from '../../lib/notification-service';
import { getTaskDueSoonSchedulingReason } from '../shared/task-due-soon-helpers';
import { MedplumSingleton } from '../../lib/medplum-singleton';

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

  // DEBUG: Log every time bot is triggered
  console.log(`[TaskDueSoonNotificationBot] Bot triggered for task ${task?.id}, due date: ${task.restriction?.period?.end}, version: ${task.meta?.versionId}`);

  const result = getTaskDueSoonSchedulingReason(task);

  // Set Medplum instance in singleton for use in other modules (e.g. context generators)
  MedplumSingleton.setInstance(medplum);

  switch (result.kind) {
    case 'invalidResource':
      console.warn('[TaskDueSoonNotificationBot] Invalid task resource received');
      return { message: 'Invalid task resource' };
    case 'finalState':
      console.log(
        `[TaskDueSoonNotificationBot] Task ${task?.id} is in final state (${result.status}), skipping`
      );
      return { message: `Task in final state: ${result.status}`, taskId: task?.id };
    case 'ok':
      break;
  }

  const appBaseUrl = event.secrets.PROVIDER_APP_BASE_URL?.valueString;
  if (!appBaseUrl) {
    console.error('[TaskDueSoonNotificationBot] PROVIDER_APP_BASE_URL secret is not set');
    throw new Error('PROVIDER_APP_BASE_URL must be configured in bot secrets');
  }

  const mailgunConfig = buildMailgunConfig(event);

  try {
    console.log(
      `[TaskDueSoonNotificationBot] Scheduling notification for task ${task.id} hours`
    );
    await scheduleTaskDueSoonEmail(medplum, task, appBaseUrl, mailgunConfig);

    return {
      message: 'Notification scheduled successfully',
      taskId: task.id,
      dueDate: task.restriction?.period?.end,
    };
  } catch (error) {
    console.error(`[TaskDueSoonNotificationBot] Error scheduling notification for task ${task.id}:`, error);
    throw error;
  }
}

