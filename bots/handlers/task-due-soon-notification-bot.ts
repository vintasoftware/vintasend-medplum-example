import { BotEvent, MedplumClient } from '@medplum/core';
import { sendTaskDueSoonEmail } from '../services/emails/send-task-due-soon-email';

/**
 * Medplum Bot: Task Due Soon Notification
 * 
 * This bot runs periodically (every 5 minutes) to check for tasks that are
 * due in approximately 24-25 hours and schedules email notifications to be
 * sent 24 hours before the task due date.
 * 
 * The bot uses VintaSend's scheduled messages (sendAfter) to ensure
 * notifications are sent at the appropriate time.
 * 
 * Cron: 5 * * * * (every 5 minutes)
 */

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  console.log('[TaskDueSoonNotificationBot] Starting periodic check for tasks due in ~24 hours');

  const appBaseUrl = process.env.APP_BASE_URL || 'https://vintasend-medplum-example.com';
  const secrets = event.secrets;
  const sendgridConfig = {
    SENDGRID_API_KEY: secrets.SENDGRID_API_KEY.valueString || '',
    SENDGRID_FROM_EMAIL: secrets.SENDGRID_FROM_EMAIL.valueString || '',
    SENDGRID_FROM_NAME: secrets.SENDGRID_FROM_NAME.valueString || 'Medplum Notifications',
  };

  // Calculate the time window: 24-25 hours from now
  // We use a 1-hour window to catch tasks that will be due soon
  const now = new Date();
  const windowStart = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000); // 25 hours from now

  try {
    // Search for tasks that:
    // 1. Have an owner (assigned to someone)
    // 2. Are not completed or cancelled
    // 3. Have a due date (restriction.period.end) within the 24-25 hour window
    const searchResults = await medplum.search('Task', {
      'owner:missing': 'false',
      'status:not': 'completed,cancelled,failed,rejected,entered-in-error',
      // FHIR date search uses the format: ge (greater or equal) and lt (less than)
      'restriction-date': `ge${windowStart.toISOString()}&restriction-date=lt${windowEnd.toISOString()}`,
    });

    const tasks = searchResults.entry?.map((e) => e.resource) || [];
    
    console.log(`[TaskDueSoonNotificationBot] Found ${tasks.length} tasks due in the next 24-25 hours`);

    if (tasks.length === 0) {
      console.log('[TaskDueSoonNotificationBot] No tasks to process');
      return { message: 'No tasks to process', processedTasks: 0 };
    }

    // Process each task and schedule notifications
    const results = await Promise.allSettled(
      tasks.map(async (task) => {
        if (!task || task.resourceType !== 'Task') {
          console.warn('[TaskDueSoonNotificationBot] Skipping invalid task resource:', task);
          return { status: 'skipped', reason: 'Invalid task resource' };
        }
        try {
          console.log(`[TaskDueSoonNotificationBot] Processing task: ${task.id}`);
          await sendTaskDueSoonEmail(medplum, task, appBaseUrl, sendgridConfig);
          return { taskId: task.id, status: 'success' };
        } catch (error) {
          console.error(`[TaskDueSoonNotificationBot] Error processing task ${task.id}:`, error);
          return { taskId: task.id, status: 'error', error: String(error) };
        }
      })
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(
      `[TaskDueSoonNotificationBot] Completed. Successful: ${successful}, Failed: ${failed}, Total: ${tasks.length}`
    );

    return {
      message: 'Task due soon notifications processed',
      processedTasks: tasks.length,
      successful,
      failed,
      results: results.map((r) =>
        r.status === 'fulfilled' ? r.value : { status: 'rejected', reason: r.reason }
      ),
    };
  } catch (error) {
    console.error('[TaskDueSoonNotificationBot] Error during execution:', error);
    throw error;
  }
}
