import { MedplumClient } from '@medplum/core';
import { Bot, Subscription } from '@medplum/fhirtypes';
import { getMedplumClient } from './client';

/**
 * Sets up a subscription that triggers the task assignment email bot
 * when a Task is created or updated with an owner assigned.
 * 
 * This script should be run during environment setup/deployment to ensure
 * the subscription exists in your Medplum project.
 * 
 * Usage:
 *   ts-node scripts/setup-task-assignment-subscription.ts
 */

async function setupTaskAssignmentSubscription() {
  // Initialize Medplum client
  const medplum = await getMedplumClient();

  try {
    await medplum.startClientLogin(
      process.env.MEDPLUM_CLIENT_ID!,
      process.env.MEDPLUM_CLIENT_SECRET!
    );

    console.log('✅ Successfully authenticated with Medplum');

    // Upsert the bot (create if not exists, update if exists)
    const botCode = 'task-assignment-email-bot';
    const bot = await medplum.upsertResource<Bot>(
      {
        resourceType: 'Bot',
        identifier: [
          {
            system: 'https://your-domain.com/bot-identifier',
            value: botCode,
          },
        ],
        name: 'Task Assignment Email Bot',
        description: 'Sends email notifications when tasks are assigned to practitioners',
      },
      'identifier=' + botCode
    );
    console.log(`✅ Bot ready: ${bot.id} (${bot.name})`);

    // Upsert the subscription (create if not exists, update if exists)
    const subscriptionCriteria = 'Task?owner:exists=true';
    const subscription = await medplum.upsertResource<Subscription>(
      {
        resourceType: 'Subscription',
        status: 'active',
        reason: 'Trigger email notification when a task is assigned',
        criteria: subscriptionCriteria,
        channel: {
          type: 'rest-hook',
          endpoint: `Bot/${bot.id}`,
        },
        extension: [
          {
            url: 'https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction',
            valueCode: 'create',
          },
          {
            url: 'https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction',
            valueCode: 'update',
          },
        ],
      },
      `criteria=${encodeURIComponent(subscriptionCriteria)}`
    );
    console.log(`✅ Subscription ready: ${subscription.id}`)

    console.log('\n📋 Subscription Details:');
    console.log(`   ID: ${subscription.id}`);
    console.log(`   Status: ${subscription.status}`);
    console.log(`   Criteria: ${subscription.criteria}`);
    console.log(`   Bot: ${bot.id} (${bot.name})`);
    console.log(`   Triggers: Task create, update (when owner exists)`);

    console.log('\n✅ Setup complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Deploy your bot code: npm run bots:deploy');
    console.log('   2. Test by creating/updating a Task with an owner');
    console.log('   3. Check bot logs in Medplum console for execution details');
  } catch (error) {
    console.error('❌ Error setting up subscription:', error);
    throw error;
  }
}

// Run the setup
setupTaskAssignmentSubscription()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
