import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { MedplumSingleton } from '../../../lib/medplum-singleton';
import { getNotificationService, SendGridConfig } from '../../../lib/notification-service';

export async function scheduleTaskDueSoonEmail(
  medplum: MedplumClient, 
  task: Task, taskLinkBaseUrl: string, 
  sendgridConfig: SendGridConfig
) {
  /* sends a task due soon reminder email to a practitioner 24 hours before the task is due */

  if (!task.owner?.reference) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Task has no owner reference');
    throw new Error('Task must have an owner reference');
  }

  if (!task.restriction?.period?.end) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Task has no due date');
    throw new Error('Task must have a due date (restriction.period.end)');
  }

  const dueDate = new Date(task.restriction.period.end);
  if (Number.isNaN(dueDate.getTime())) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Task has invalid due date:', task.restriction.period.end);
    throw new Error('Task must have a valid due date (restriction.period.end)');
  }

  const referenceString = task.owner.reference;

  // Validate format (should be "ResourceType/id")
  if (!referenceString.includes('/')) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Invalid referenceString format:', referenceString);
    throw new Error(`Invalid referenceString format: ${referenceString}`);
  }

  // Skip sending email if task is assigned to a Group
  const [resourceType] = referenceString.split('/');
  if (resourceType === 'Group') {
    // eslint-disable-next-line no-console
    console.log('[scheduleTaskDueSoonEmail] Task assigned to Group, skipping email notification');
    return;
  }

  MedplumSingleton.setInstance(medplum);
  const vintasend = getNotificationService(medplum, sendgridConfig);

  try {
    const taskTitle = task.code?.text || task.description || 'Task';

    if (!task.id) {
      // eslint-disable-next-line no-console
      console.error('[scheduleTaskDueSoonEmail] Task has no id');
      throw new Error('Task must have an id to send task due soon email');
    }

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

    // Schedule notification to be sent 24 hours before due date
    const sendAfter = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);

    // Only schedule if sendAfter is in the future
    if (sendAfter <= new Date()) {
      // eslint-disable-next-line no-console
      console.log('[scheduleTaskDueSoonEmail] Task due date is within 24 hours or past, skipping scheduled notification');
      return;
    }

    await vintasend.createNotification({
      userId: referenceString,
      notificationType: 'EMAIL' as const,
      title: 'Task Due Soon Reminder',
      contextName: 'taskDueSoon' as const,
      contextParameters: {
        userId: referenceString,
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
      `[scheduleTaskDueSoonEmail] Email scheduled for ${sendAfter.toISOString()} to: ${referenceString} for task due on ${dueDate.toISOString()}`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Error creating/sending notification:', error);
    throw error;
  }
}
