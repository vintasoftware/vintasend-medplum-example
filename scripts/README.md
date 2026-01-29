# Scripts

This directory contains automation scripts for setting up and managing your Medplum environment.

## setup-task-assignment-subscription.ts

Creates or updates the FHIR Subscription that triggers the task assignment email bot.

### What it does:

1. **Authenticates** with Medplum using client credentials
2. **Creates/finds** the Task Assignment Email Bot resource
3. **Creates/updates** a Subscription with criteria: `Task?owner:exists=true`
4. **Configures** the subscription to trigger on Task create and update events

### Prerequisites:

Create a `.env` file with your Medplum credentials:

```bash
MEDPLUM_BASE_URL=https://api.medplum.com
MEDPLUM_CLIENT_ID=your-client-id
MEDPLUM_CLIENT_SECRET=your-client-secret
APP_BASE_URL=https://your-app-url.com
```

### Usage:

```bash
npm run setup:subscription
```

### Expected Output:

```
✅ Successfully authenticated with Medplum
✅ Found existing bot: abc-123
✅ Updated subscription: def-456

📋 Subscription Details:
   ID: def-456
   Status: active
   Criteria: Task?owner:exists=true
   Bot: abc-123 (Task Assignment Email Bot)
   Triggers: Task create, update (when owner exists)

✅ Setup complete!

📝 Next steps:
   1. Deploy your bot code: npm run bots:deploy
   2. Test by creating/updating a Task with an owner
   3. Check bot logs in Medplum console for execution details

✨ Script completed successfully
```

### When to run:

- **Initial setup**: When first deploying your application
- **After bot changes**: If you modify the bot or subscription criteria
- **Environment changes**: When setting up a new environment (dev, staging, prod)
- **CI/CD**: Include in your deployment pipeline

### Idempotent Design:

This script is safe to run multiple times. It will:
- Use existing Bot if found (by identifier)
- Update existing Subscription if found (by identifier)
- Create new resources only if they don't exist

### Troubleshooting:

**Authentication Error:**
```
❌ Error setting up subscription: Authentication failed
```
- Verify your `MEDPLUM_CLIENT_ID` and `MEDPLUM_CLIENT_SECRET` in `.env`
- Ensure the client has permission to create Bot and Subscription resources

**Resource Creation Failed:**
```
❌ Error creating Bot: Forbidden
```
- Check that your client has the necessary permissions in Medplum
- You may need to grant `Bot` and `Subscription` resource creation permissions

**Subscription Not Triggering:**
- Verify the bot code is deployed: `npm run bots:deploy`
- Check subscription status in Medplum console (should be "active")
- Review bot logs for execution errors
- Ensure Task resources have the `owner` field populated

### FHIR Resources Created:

#### Bot Resource:
```json
{
  "resourceType": "Bot",
  "identifier": [
    {
      "system": "https://your-domain.com/bot-identifier",
      "value": "task-assignment-email-bot"
    }
  ],
  "name": "Task Assignment Email Bot",
  "description": "Sends email notifications when tasks are assigned to practitioners"
}
```

#### Subscription Resource:
```json
{
  "resourceType": "Subscription",
  "identifier": [
    {
      "system": "https://your-domain.com/subscription-identifier",
      "value": "task-assignment-email-subscription"
    }
  ],
  "status": "active",
  "reason": "Trigger email notification when a task is assigned",
  "criteria": "Task?owner:exists=true",
  "channel": {
    "type": "rest-hook",
    "endpoint": "Bot/bot-id-here"
  },
  "extension": [
    {
      "url": "https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction",
      "valueCode": "create"
    },
    {
      "url": "https://medplum.com/fhir/StructureDefinition/subscription-supported-interaction",
      "valueCode": "update"
    }
  ]
}
```

### Understanding the Subscription:

- **criteria**: `Task?owner:exists=true` matches any Task with an owner
- **channel.type**: `rest-hook` invokes a bot endpoint
- **channel.endpoint**: Points to the Bot resource
- **extension**: Specifies to trigger on both create and update operations

### Testing the Subscription:

After running the setup, test it by creating a Task:

```typescript
const task = await medplum.createResource({
  resourceType: 'Task',
  status: 'requested',
  intent: 'order',
  code: { text: 'Test task' },
  owner: { reference: 'Practitioner/123' }, // This triggers the subscription
  requester: { reference: 'Practitioner/456' },
});
```

Check the bot logs in Medplum console to verify execution.
