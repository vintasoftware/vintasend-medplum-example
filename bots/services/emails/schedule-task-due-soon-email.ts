import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { getNotificationService, SendGridConfig } from '../../../lib/notification-service';
import { computeReminderTime } from '../../shared/task-due-soon-helpers';

export async function scheduleTaskDueSoonEmail(
  medplum: MedplumClient,
  task: Task,
  taskLinkBaseUrl: string,
  sendgridConfig: SendGridConfig
) {
  /* sends a task due soon reminder email to a practitioner 24 hours before the task is due */

  if (!task.id) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Task has no id');
    throw new Error('Task must have an id to send task due soon email');
  }

  // Parse due date for scheduling
  let dueDateObj: Date | undefined = undefined;
  if (task.restriction?.period?.end) {
    dueDateObj = new Date(task.restriction.period.end);
  }
  if (!dueDateObj) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Task has no valid due date');
    return;
  }
  const sendAfter = computeReminderTime(dueDateObj, 24);
  if (!sendAfter) {
    return;
  }

  const vintasend = getNotificationService(medplum, sendgridConfig);

  try {
    await vintasend.createNotification({
      userId: task.owner?.reference || '',
      notificationType: 'EMAIL' as const,
      title: 'Task Due Soon Reminder',
      contextName: 'taskDueSoon' as const,
      contextParameters: {
        taskId: task.id,
        taskLinkBaseUrl: taskLinkBaseUrl,
      },
      sendAfter,
      bodyTemplate: 'emails/task-due-soon/body.html.pug',
      subjectTemplate: 'emails/task-due-soon/subject.txt.pug',
      extraParams: {},
    });

    // eslint-disable-next-line no-console
    console.log(
      `[scheduleTaskDueSoonEmail] Email scheduled for ${sendAfter.toISOString()} to: ${task.owner?.reference} for task due on ${dueDateObj.toISOString()}`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Error creating/sending notification:', error);
    throw error;
  }
}

