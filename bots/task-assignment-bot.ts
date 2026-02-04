import { BotEvent, MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { sendTaskAssignmentEmail } from './services/emails/send-task-assignment-email';
import { buildSendGridConfig } from '../lib/notification-service';

/**
 * Medplum Bot: Task Assignment Email Notification
 *
 * This bot is triggered by a subscription when a Task is created or updated
 * with an owner. It sends an email notification to the assigned practitioner.
 *
 * Subscription Criteria: Task?owner:exists=true
 * Triggers: create, update
 */

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<Task> {
  const task = event.input as Task;
  const sendGridVariables = buildSendGridConfig(event);

  console.log(`[TaskAssignmentBot] Processing task: ${task.id}`);
  console.log(`[TaskAssignmentBot] Owner: ${task.owner?.reference}`);

  // Only send email if task has an owner
  if (task.owner?.reference) {
    const appBaseUrl = event.secrets.PROVIDER_APP_BASE_URL?.valueString;
    if (!appBaseUrl) {
      console.error('[TaskAssignmentBot] PROVIDER_APP_BASE_URL secret is not set');
      throw new Error('PROVIDER_APP_BASE_URL must be configured in bot secrets');
    }

    try {
      await sendTaskAssignmentEmail(medplum, task, appBaseUrl, sendGridVariables);
      console.log(`[TaskAssignmentBot] Email notification sent successfully for task: ${task.id}`);
    } catch (error) {
      console.error(`[TaskAssignmentBot] Failed to send email for task: ${task.id}`, error);
      // Don't throw - we don't want the subscription to fail
      // The notification will be logged in Medplum as failed
    }
  } else {
    console.log(`[TaskAssignmentBot] Task ${task.id} has no owner, skipping email notification`);
  }

  // Return the task unchanged
  return task;
}
