import { BotEvent, MedplumClient } from '@medplum/core';
import { MedplumSingleton } from '../../lib/medplum-singleton';
import { getNotificationService } from '../../lib/notification-service';

/**
 * Medplum Bot: Send Pending Notifications
 * 
 * This bot runs periodically (every 5 minutes) to process and send
 * all pending scheduled notifications that are due to be sent.
 * 
 * It uses VintaSend's notification service to check for notifications
 * where sendAfter <= current time and triggers their delivery.
 * 
 * Cron: 5 * * * * (every 5 minutes)
 */

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  console.log('[SendPendingNotificationsBot] Starting to process pending notifications');
  const secrets = event.secrets;
  const sendgridConfig = {
    SENDGRID_API_KEY: secrets.SENDGRID_API_KEY.valueString || '',
    SENDGRID_FROM_EMAIL: secrets.SENDGRID_FROM_EMAIL.valueString || '',
    SENDGRID_FROM_NAME: secrets.SENDGRID_FROM_NAME.valueString || 'Medplum Notifications',
  };

  try {
    MedplumSingleton.setInstance(medplum);
    const vintasend = getNotificationService(medplum, sendgridConfig);

    // Send all pending notifications that are ready to be sent
    const result = await vintasend.sendPendingNotifications();

    console.log('[SendPendingNotificationsBot] Completed processing pending notifications');
    console.log('[SendPendingNotificationsBot] Result:', JSON.stringify(result, null, 2));

    return {
      message: 'Pending notifications processed',
      result,
    };
  } catch (error) {
    console.error('[SendPendingNotificationsBot] Error processing pending notifications:', error);
    throw error;
  }
}
