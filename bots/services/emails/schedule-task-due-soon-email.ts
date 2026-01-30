import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { MedplumSingleton } from '../../../lib/medplum-singleton';
import { getNotificationService, SendGridConfig } from '../../../lib/notification-service';
import {
  assertTaskOwnerReference,
  getValidTaskDueDate,
  parseOwnerReference,
  computeReminderTime,
} from '../../shared/task-due-soon-helpers';

export async function scheduleTaskDueSoonEmail(
  medplum: MedplumClient,
  task: Task,
  taskLinkBaseUrl: string,
  sendgridConfig: SendGridConfig
) {
  /* sends a task due soon reminder email to a practitioner 24 hours before the task is due */

  const ownerRef = assertTaskOwnerReference(task);
  const parsedOwner = parseOwnerReference(ownerRef);
  if (!parsedOwner) {
    return;
  }

  const dueDate = getValidTaskDueDate(task);

  if (!task.id) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Task has no id');
    throw new Error('Task must have an id to send task due soon email');
  }

  const sendAfter = computeReminderTime(dueDate, 24);
  if (!sendAfter) {
    return;
  }

  MedplumSingleton.setInstance(medplum);
  const vintasend = getNotificationService(medplum, sendgridConfig);

  const taskTitle = task.code?.text || task.description || 'Task';
  const taskLink = `${taskLinkBaseUrl}/Task/${task.id}`;
  const taskIsUrgent = task.priority === 'urgent';
  const formattedDueDate = dueDate.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  try {
    await vintasend.createNotification({
      userId: ownerRef,
      notificationType: 'EMAIL' as const,
      title: 'Task Due Soon Reminder',
      contextName: 'taskDueSoon' as const,
      contextParameters: {
        userId: ownerRef,
        taskTitle,
        taskDescription: task.description || '',
        taskIsUrgent,
        taskLink,
        dueDate: formattedDueDate,
      },
      sendAfter,
      bodyTemplate: 'emails/task-due-soon/body.html.pug',
      subjectTemplate: 'emails/task-due-soon/subject.txt.pug',
      extraParams: {},
    });

    // eslint-disable-next-line no-console
    console.log(
      `[scheduleTaskDueSoonEmail] Email scheduled for ${sendAfter.toISOString()} to: ${ownerRef} for task due on ${dueDate.toISOString()}`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Error creating/sending notification:', error);
    throw error;
  }
}

