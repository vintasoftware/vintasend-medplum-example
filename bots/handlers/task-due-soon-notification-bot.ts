import { BotEvent, MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { scheduleTaskDueSoonEmail } from '../services/emails/schedule-task-due-soon-email';

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

  if (!task || task.resourceType !== 'Task') {
    console.warn('[TaskDueSoonNotificationBot] Invalid task resource received');
    return { message: 'Invalid task resource' };
  }

  console.log(`[TaskDueSoonNotificationBot] Processing task: ${task.id}`);

  const appBaseUrl = process.env.APP_BASE_URL || 'https://vintasend-medplum-example.com';
  const secrets = event.secrets;
  const sendgridConfig = {
    SENDGRID_API_KEY: secrets.SENDGRID_API_KEY.valueString || '',
    SENDGRID_FROM_EMAIL: secrets.SENDGRID_FROM_EMAIL.valueString || '',
    SENDGRID_FROM_NAME: secrets.SENDGRID_FROM_NAME.valueString || 'Medplum Notifications',
  };

  // Check if task has a due date
  const dueDate = task.restriction?.period?.end;
  if (!dueDate) {
    console.log(`[TaskDueSoonNotificationBot] Task ${task.id} has no due date, skipping`);
    return { message: 'No due date set', taskId: task.id };
  }

  // Check if task is in a final state (completed, cancelled, etc.)
  const finalStates = ['completed', 'cancelled', 'failed', 'rejected', 'entered-in-error'];
  if (task.status && finalStates.includes(task.status)) {
    console.log(`[TaskDueSoonNotificationBot] Task ${task.id} is in final state (${task.status}), skipping`);
    return { message: `Task in final state: ${task.status}`, taskId: task.id };
  }

  // Check if task has an owner
  if (!task.owner) {
    console.log(`[TaskDueSoonNotificationBot] Task ${task.id} has no owner, skipping`);
    return { message: 'No owner assigned', taskId: task.id };
  }

  // Calculate if the due date is more than 24 hours away
  const now = new Date();
  const dueDateTime = new Date(dueDate);
  const hoursUntilDue = (dueDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntilDue < 24) {
    console.log(
      `[TaskDueSoonNotificationBot] Task ${task.id} is due in ${hoursUntilDue.toFixed(2)} hours (less than 24), skipping`
    );
    return { message: 'Due date is less than 24 hours away', taskId: task.id, hoursUntilDue };
  }

  try {
    // Schedule the notification to be sent 24 hours before the due date
    console.log(
      `[TaskDueSoonNotificationBot] Scheduling notification for task ${task.id}, due in ${hoursUntilDue.toFixed(2)} hours`
    );
    await scheduleTaskDueSoonEmail(medplum, task, appBaseUrl, sendgridConfig);

    return {
      message: 'Notification scheduled successfully',
      taskId: task.id,
      dueDate,
      hoursUntilDue: hoursUntilDue.toFixed(2),
    };
  } catch (error) {
    console.error(`[TaskDueSoonNotificationBot] Error scheduling notification for task ${task.id}:`, error);
    throw error;
  }
}
