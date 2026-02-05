import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { getNotificationService, SendGridConfig } from '../../../lib/notification-service';
import { getTaskAttachments } from '../../../lib/file-upload';

export async function sendTaskAssignmentEmail(
  medplum: MedplumClient,
  task: Task,
  taskLinkBaseUrl: string,
  sendgridConfig: SendGridConfig
) {
  /* sends a task assignment email to a practitioner */

  if (!task.owner?.reference) {
    // eslint-disable-next-line no-console
    console.error('[sendTaskAssignmentEmail] Task has no owner reference');
    throw new Error('Task must have an owner reference');
  }

  const referenceString = task.owner.reference;

  // Validate format (should be "ResourceType/id")
  if (!referenceString.includes('/')) {
    // eslint-disable-next-line no-console
    console.error('[sendTaskAssignmentEmail] Invalid referenceString format:', referenceString);
    throw new Error(`Invalid referenceString format: ${referenceString}`);
  }

  // Skip sending email if task is assigned to a Group
  const [resourceType] = referenceString.split('/');
  if (resourceType === 'Group') {
    // eslint-disable-next-line no-console
    console.log('[sendTaskAssignmentEmail] Task assigned to Group, skipping email notification');
    return;
  }

  const vintasend = getNotificationService(medplum, sendgridConfig);

  try {
    if (!task.id) {
      // eslint-disable-next-line no-console
      console.error('[sendTaskAssignmentEmail] Task has no id');
      throw new Error('Task must have an id to send task assignment email');
    }

    // Retrieve task attachments
    const taskAttachments = await getTaskAttachments(medplum, task);

    // eslint-disable-next-line no-console
    console.log(`[sendTaskAssignmentEmail] Found ${taskAttachments.length} attachments for task ${task.id}`);

    // Convert Media resources to VintaSend attachment references
    // Use fileId to reference existing Media resources instead of re-uploading
    const attachments = taskAttachments
      .filter((media) => media.id) // Only include media with IDs
      .map((media) => ({
        fileId: media.id as string,
        description: media.content?.title,
      }));

    // eslint-disable-next-line no-console
    console.log(`[sendTaskAssignmentEmail] Prepared ${attachments.length} attachment references`);

    await vintasend.createNotification({
      userId: referenceString,
      notificationType: 'EMAIL' as const,
      title: 'Task Assignment',
      contextName: 'taskAssignment' as const,
      contextParameters: {
        taskId: task.id,
        taskLinkBaseUrl,
      },
      sendAfter: new Date(),
      bodyTemplate: 'emails/task-assignment/body.html.pug',
      subjectTemplate: 'emails/task-assignment/subject.txt.pug',
      attachments, // Add attachments to the notification
      extraParams: {},
    });

    // eslint-disable-next-line no-console
    console.log('[sendTaskAssignmentEmail] Email sent successfully to:', referenceString);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[sendTaskAssignmentEmail] Error creating/sending notification:', error);
    throw error;
  }
}
