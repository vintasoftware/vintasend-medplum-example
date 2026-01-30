import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { MedplumSingleton } from '../../../lib/medplum-singleton';
import { getNotificationService, SendGridConfig, convertMediaToAttachment } from '../../../lib/notification-service';
import { formatPatientNameWithPreferredName } from '../../../lib/patients';
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

  MedplumSingleton.setInstance(medplum);
  const vintasend = getNotificationService(medplum, sendgridConfig);

  try {
    const taskTitle = task.code?.text || task.description || 'New Task';

    if (!task.id) {
      // eslint-disable-next-line no-console
      console.error('[sendTaskAssignmentEmail] Task has no id');
      throw new Error('Task must have an id to send task assignment email');
    }

    const taskLink = `${taskLinkBaseUrl}/Task/${task.id}`;
    const taskIsUrgent = task.priority === 'urgent';

    let requesterName = 'someone';
    if (task.requester?.reference) {
      try {
        const requester = await medplum.readReference(task.requester);
        if ('name' in requester && requester.name && Array.isArray(requester.name)) {
          requesterName = formatPatientNameWithPreferredName(requester.name[0]);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('[sendTaskAssignmentEmail] Error fetching requester:', error);
      }
    }

    // Retrieve task attachments
    const taskAttachments = await getTaskAttachments(medplum, task);
    
    // eslint-disable-next-line no-console
    console.log(`[sendTaskAssignmentEmail] Found ${taskAttachments.length} attachments for task ${task.id}`);

    // Convert to VintaSend attachment format
    const attachmentPromises = taskAttachments.map((media) => convertMediaToAttachment(medplum, media));
    const attachmentResults = await Promise.all(attachmentPromises);
    
    // Filter out null values (failed conversions)
    const attachments = attachmentResults.filter((attachment): attachment is NonNullable<typeof attachment> => 
      attachment !== null
    );

    // eslint-disable-next-line no-console
    console.log(`[sendTaskAssignmentEmail] Successfully converted ${attachments.length} attachments`);

    await vintasend.createNotification({
      userId: referenceString,
      notificationType: 'EMAIL' as const,
      title: 'Task Assignment',
      contextName: 'taskAssignment' as const,
      contextParameters: {
        userId: referenceString,
        taskTitle,
        taskDescription: task.description || '',
        taskIsUrgent,
        taskLink,
        requesterName,
        attachmentCount: attachments.length,
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
