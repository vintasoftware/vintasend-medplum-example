import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import {
  type GitCommitShaConfig,
  getNotificationService,
  MailgunConfig,
  type NotificationTypeConfig,
} from '../../../lib/notification-service';
import { computeReminderTime } from '../../shared/task-due-soon-helpers';
import type { DatabaseNotification } from 'vintasend';

const NOTIFICATION_EXTENSION_URL = 'http://vintasend-medplum-example.com/fhir/StructureDefinition/task-due-soon-notification-id';

async function cancelExistingNotificationIfAny(
  medplum: MedplumClient,
  task: Task,
  mailgunConfig: MailgunConfig,
  gitCommitShaConfig?: GitCommitShaConfig,
): Promise<void> {
  const notificationIdExtension = task.extension?.find(
    (ext) => ext.url === NOTIFICATION_EXTENSION_URL
  );
  const existingNotificationId = notificationIdExtension?.valueString;

  if (!notificationIdExtension) {
    // eslint-disable-next-line no-console
    console.log('[scheduleTaskDueSoonEmail] No existing notification to cancel for task', task.id);
    return;
  }

  if (!existingNotificationId) {
    // eslint-disable-next-line no-console
    console.warn(
      `[scheduleTaskDueSoonEmail] Extension found but valueString is empty for task ${task.id}. Extension:`,
      JSON.stringify(notificationIdExtension)
    );
    // Clean up the invalid extension
    await medplum.updateResource({
      ...task,
      extension: (task.extension || []).filter(
        (ext) => ext.url !== NOTIFICATION_EXTENSION_URL
      ),
    });
    return;
  }

  const vintasend = getNotificationService(medplum, mailgunConfig, gitCommitShaConfig);
  try {
    const existingNotification = await vintasend.getNotification(existingNotificationId, false);
    if (existingNotification && existingNotification.status === 'PENDING_SEND') {
      await vintasend.cancelNotification(existingNotificationId);
      // eslint-disable-next-line no-console
      console.log(`[scheduleTaskDueSoonEmail] Cancelled notification ${existingNotificationId}`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Error cancelling notification:', error);
  }

  // Remove the notification extension from the task
  await medplum.updateResource({
    ...task,
    extension: (task.extension || []).filter(
      (ext) => ext.url !== NOTIFICATION_EXTENSION_URL
    ),
  });
}

function isDatabaseNotification(
  notification: DatabaseNotification<NotificationTypeConfig> | unknown
): notification is DatabaseNotification<NotificationTypeConfig> {
  return (
    (notification as DatabaseNotification<NotificationTypeConfig>).userId !== undefined
  );
}

export async function scheduleTaskDueSoonEmail(
  medplum: MedplumClient,
  task: Task,
  taskLinkBaseUrl: string,
  mailgunConfig: MailgunConfig,
  gitCommitShaConfig?: GitCommitShaConfig,
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
    // Cancel existing notification if due date is removed
    await cancelExistingNotificationIfAny(medplum, task, mailgunConfig, gitCommitShaConfig);
    return;
  }

  // due date is less than 24 hours away, no need to schedule
  const now = new Date();
  const hoursUntilDue = (dueDateObj.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilDue < 24) {
    // eslint-disable-next-line no-console
    console.log(
      `[scheduleTaskDueSoonEmail] Task due date is less than 24 hours away (${hoursUntilDue.toFixed(
        2
      )} hours), skipping scheduling`
    );
    // Cancel existing notification if due date is too soon
    await cancelExistingNotificationIfAny(medplum, task, mailgunConfig, gitCommitShaConfig);
    return;
  }

  // Check if task has an owner
  if (!task.owner?.reference) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Task has no owner. Canceling any existing notification if any.');
    // Cancel existing notification if owner is removed
    await cancelExistingNotificationIfAny(medplum, task, mailgunConfig, gitCommitShaConfig);
    return;
  }

  const sendAfter = computeReminderTime(dueDateObj, 24);
  if (!sendAfter) {
    return;
  }

  const vintasend = getNotificationService(medplum, mailgunConfig, gitCommitShaConfig);

  try {
    // Check if task has an existing notification ID stored as an extension
    const notificationIdExtension = task.extension?.find(
      (ext) => ext.url === NOTIFICATION_EXTENSION_URL
    );
    const existingNotificationId = notificationIdExtension?.valueString;

    if (existingNotificationId) {
      // Try to get and update the existing notification
      const existingNotification = await vintasend.getNotification(existingNotificationId, false);

      if (existingNotification && existingNotification.status === 'PENDING_SEND') {
        const ownerChanged = isDatabaseNotification(existingNotification) && existingNotification.userId !== task.owner.reference;
        const sendAfterChanged = existingNotification.sendAfter?.getTime() !== sendAfter.getTime();

        if (ownerChanged || sendAfterChanged) {
          // Update existing notification with new sendAfter date and/or owner
          await vintasend.updateNotification(existingNotificationId, {
            userId: task.owner.reference,
            sendAfter,
            contextParameters: {
              taskId: task.id,
              taskLinkBaseUrl: taskLinkBaseUrl,
            },
          });

          // eslint-disable-next-line no-console
          console.log(
            `[scheduleTaskDueSoonEmail] Updated existing notification ${existingNotificationId} with new schedule: ${sendAfter.toISOString()} for task due on ${dueDateObj.toISOString()}${ownerChanged ? `, owner changed to ${task.owner.reference}` : ''}`
          );
          return;
        }

        // Nothing changed, keep the existing notification
        return;
      }
    }

    // Create new notification if none exists or if the old one was already sent
    const notification = await vintasend.createNotification({
      userId: task.owner.reference,
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

    // Store the notification ID in the task as an extension (only for new notifications)
    await medplum.updateResource({
      ...task,
      extension: [
        ...(task.extension || []).filter(
          (ext) => ext.url !== NOTIFICATION_EXTENSION_URL
        ),
        {
          url: NOTIFICATION_EXTENSION_URL,
          valueString: notification.id as string,
        },
      ],
    });

    // eslint-disable-next-line no-console
    console.log(
      `[scheduleTaskDueSoonEmail] New email scheduled for ${sendAfter.toISOString()} to: ${task.owner.reference} for task due on ${dueDateObj.toISOString()}, notification ID: ${notification.id}`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Error creating/updating notification:', error);
    throw error;
  }
}

