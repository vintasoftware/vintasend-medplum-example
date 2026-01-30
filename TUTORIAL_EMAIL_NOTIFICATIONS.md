# Building Email Notifications for Task Assignments in Medplum with VintaSend

## Introduction

In this tutorial, we'll walk through implementing an email notification system for task assignments in a Medplum healthcare application. When a practitioner is assigned a task, they'll automatically receive an email with all the relevant details. 

We'll be using [VintaSend](https://github.com/vintasoftware/vintasend), a powerful notification framework, along with [VintaSend-Medplum](https://github.com/vintasoftware/vintasend-medplum), which provides Medplum-specific adapters for the VintaSend framework.

## Why VintaSend?

VintaSend is a flexible TypeScript package designed specifically for transactional notifications. Here's why it's a great choice:

**📦 Database-Backed Notification Management**
- All notifications are stored in your database, providing a complete audit trail
- Track notification status (pending, sent, failed) automatically
- Query past notifications easily for debugging or reporting

**📅 Smart Scheduling**
- Schedule notifications to send at a specific time in the future
- Context is fetched at send-time, ensuring data is always up-to-date
- No stale data - if a user's name changes, scheduled emails use the new name

**🎯 One-Off Notifications**
- Send emails to prospects or guests without requiring a user account
- Perfect for marketing, invitations, or external communications
- No need to create dummy user records

**📎 File Attachment Support**
- Attach files with automatic deduplication (same file stored once)
- Flexible storage backends (S3, Azure, GCS, local filesystem)
- Reuse files across multiple notifications

**🔧 Modular Architecture**
- Swap databases, email providers, or template engines independently
- No vendor lock-in - change your email provider without rewriting code
- Easy to test each component in isolation

**🏥 Healthcare-Ready**
- Designed with compliance and auditability in mind
- Integrates naturally with FHIR-based systems through VintaSend-Medplum

## Why VintaSend-Medplum?

VintaSend-Medplum brings VintaSend's notification capabilities to Medplum healthcare applications with full FHIR compliance:

**🏥 FHIR-Native Storage**
- Notifications stored as FHIR `Communication` resources
- File attachments stored as `Binary` and `Media` resources
- Seamlessly integrates with your existing Medplum data

**🔗 Healthcare Integration**
- Link notifications directly to `Patient` or `Practitioner` resources
- Search notifications using standard FHIR queries
- Works with Medplum's existing security and access controls

**📧 Flexible Email Providers**
- Use any email provider through VintaSend adapters (SendGrid, AWS SES, Medplum, etc.)
- Swap providers without changing your application code
- This tutorial uses SendGrid for reliable email delivery

**🎨 Pre-compiled Templates**
- Pug templates compiled to JSON at build time
- No file system access needed at runtime
- Perfect for serverless/bot environments

**✅ Production-Ready**
- Simple console logging for Medplum bots
- Status mapping to FHIR Communication statuses
- Automatic file deduplication via checksums

## Prerequisites

- A Medplum project set up and running
- Basic understanding of TypeScript and FHIR resources
- Node.js and npm installed

## What We'll Build

By the end of this tutorial, you'll have:
1. ✅ Email templates for task assignment notifications
2. ✅ A notification service configured with VintaSend
3. ✅ A bot service that sends emails when tasks are assigned
4. ✅ Support for personalized emails with user names
5. ✅ Priority handling for urgent tasks

## Step 1: Install Dependencies

First, let's add the VintaSend packages to our project:

```bash
npm install vintasend vintasend-medplum vintasend-sendgrid
```

Update your [package.json](package.json):

```json
{
  "dependencies": {
    "vintasend": "^0.4.3",
    "vintasend-medplum": "^0.4.5",
    "vintasend-sendgrid": "^0.4.3"
  }
}
```

We're using:
- `vintasend`: The core notification framework
- `vintasend-medplum`: Medplum-specific adapters for FHIR storage
- `vintasend-sendgrid`: SendGrid adapter for email delivery

## Step 2: Create Email Templates with Pug

VintaSend supports Pug templates for creating dynamic emails. Let's create templates for our task assignment emails.

### Email Body Template

Create [notification-templates/emails/task-assignment/body.html.pug](notification-templates/emails/task-assignment/body.html.pug):

```pug
doctype html
html
  head
    meta(charset='utf-8')
    style.
      body {
        white-space: pre-line;
      }
  body
    h1 Task Assigned

    p Hello #{firstName},

    p You have been assigned a new task by #{requesterName}.

    p
      strong Task:
      |  #{taskTitle}
    if taskDescription
      p
        strong Description:
        |  #{taskDescription}
    if taskIsUrgent
      p
        strong URGENT

    p
      a(href=taskLink) View Task

    p Please review the task details and take appropriate action.
```

### Email Subject Template

Create [notification-templates/emails/task-assignment/subject.txt.pug](notification-templates/emails/task-assignment/subject.txt.pug):

```pug
if taskIsUrgent
  | [URGENT] Task assigned to you: #{taskTitle}
else
  | Task assigned to you: #{taskTitle}
```

These templates use Pug syntax with dynamic variables like `#{firstName}`, `#{taskTitle}`, etc. The templates also handle conditional logic - for example, showing "URGENT" when the task has high priority.

## Step 3: Compile Templates

VintaSend-Medplum requires templates to be pre-compiled into a JSON file. Let's set up the compilation process.

Add these scripts to your [package.json](package.json):

```json
{
  "scripts": {
    "compile-templates": "compile-pug-templates ./notification-templates ./compiled-notification-templates.json",
    "bots:build": "npm run clean && npm run compile-templates && tsc && node --no-warnings esbuild-script.mjs",
    "bots:build:dev": "npm run clean && npm run compile-templates && node --no-warnings esbuild-script.mjs"
  }
}
```

The `compile-pug-templates` command comes from the `vintasend-medplum` package and will generate a [compiled-notification-templates.json](compiled-notification-templates.json) file.

## Step 4: Create the Medplum Singleton

To use the Medplum client across different parts of our notification system, we'll create a singleton pattern.

Create [lib/medplum-singleton.ts](lib/medplum-singleton.ts):

```typescript
import { MedplumClient } from '@medplum/core';

export class MedplumSingleton {
  private static instance: MedplumClient;

  private constructor() {}

  public static getInstance(): MedplumClient {
    if (!MedplumSingleton.instance) {
      throw new Error('MedplumClient instance not set. Please set it before using.');
    }
    return MedplumSingleton.instance;
  }

  public static setInstance(medplum: MedplumClient): void {
    MedplumSingleton.instance = medplum;
  }
}
```

This pattern ensures we have a single, shared instance of the MedplumClient throughout our notification system.

## Step 5: Create Helper Functions for Patient Names

Healthcare applications often need to handle patient and practitioner names with care. Let's create utilities for formatting names, including support for preferred names.

Create [lib/extensions.ts](lib/extensions.ts):

```typescript
export const PREFERRED_NAME_EXTENSION_URL = 'http://joinrewind.com/preferred-name';
```

Create [lib/patients.ts](lib/patients.ts):

```typescript
import { formatHumanName } from '@medplum/core';
import { HumanName } from '@medplum/fhirtypes';
import { PREFERRED_NAME_EXTENSION_URL } from './extensions';

export function getPatientPreferredName(patientName: HumanName | undefined): string | undefined {
  if (!patientName) return;
  const preferredName = patientName?.extension?.find(
    (extension) => extension.url === PREFERRED_NAME_EXTENSION_URL
  )?.valueString;
  return preferredName;
}

export function formatPatientNameWithPreferredName(patientName: HumanName | undefined) {
  const preferredName = getPatientPreferredName(patientName);
  if (!preferredName) return formatHumanName(patientName);
  const given = patientName?.given?.join(' ');
  const familyName = patientName?.family;

  return `${given} (${preferredName}) ${familyName}`;
}
```

These functions handle FHIR's `HumanName` structure and respect preferred names stored in FHIR extensions.

## Step 6: Configure the Notification Service

Now for the heart of our implementation - the notification service that integrates VintaSend with Medplum.

Create [lib/notification-service.ts](lib/notification-service.ts):

```typescript
import { MedplumClient } from '@medplum/core';
import type { ContextGenerator } from 'vintasend';
import { VintaSendFactory } from 'vintasend';
import { MedplumSingleton } from './medplum-singleton';
import { formatPatientNameWithPreferredName } from './patients';
import * as compiledTemplates from '../compiled-notification-templates.json';
import { 
  MedplumNotificationBackend, 
  MedplumAttachmentManager, 
  PugInlineEmailTemplateRendererFactory, 
  MedplumLogger 
} from 'vintasend-medplum';
import { SendgridNotificationAdapterFactory } from 'vintasend-sendgrid';

async function getUserById(medplum: MedplumClient, referenceString: string) {
  if (!referenceString) {
    console.error('[getUserById] referenceString is null/undefined/empty!');
    throw new Error('The "id" parameter cannot be null, undefined, or an empty string.');
  }

  const [resourceType, id] = referenceString.split('/');

  if (!id) {
    console.error('[getUserById] ID extracted from referenceString is empty!');
    throw new Error('The "id" parameter cannot be null, undefined, or an empty string.');
  }

  return medplum.readResource(resourceType as 'Patient' | 'Practitioner', id);
}

class TaskAssignmentContextGenerator implements ContextGenerator {
  async generate({
    userId,
    taskTitle,
    taskDescription,
    taskIsUrgent,
    taskLink,
    requesterName,
  }: {
    userId: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    requesterName: string;
  }): Promise<{
    firstName: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    requesterName: string;
  }> {
    const medplum = MedplumSingleton.getInstance();
    const user = await getUserById(medplum, userId);
    const firstName = formatPatientNameWithPreferredName(user.name?.[0]) ?? 'Practitioner';

    return {
      firstName,
      taskTitle,
      taskDescription,
      taskIsUrgent,
      taskLink,
      requesterName,
    };
  }
}

// Context map for generating the context of each notification
export const contextGeneratorsMap = {
  taskAssignment: new TaskAssignmentContextGenerator(),
  // Add more context generators here for other notification types
} as const;

export type NotificationTypeConfig = {
  ContextMap: typeof contextGeneratorsMap;
  NotificationIdType: string;
  UserIdType: string;
};

export function getNotificationService(medplum: MedplumClient) {
  const backend = new MedplumNotificationBackend<NotificationTypeConfig>(medplum)
  const templateRenderer = new PugInlineEmailTemplateRendererFactory<NotificationTypeConfig>()
    .create(compiledTemplates);
  const adapter = new SendgridNotificationAdapterFactory<NotificationTypeConfig>()
    .create(
      templateRenderer,
      false,
      {
        apiKey: process.env.SENDGRID_API_KEY || '',
        fromEmail: process.env.SENDGRID_FROM_EMAIL || '',
        fromName: process.env.SENDGRID_FROM_NAME,
      }
    );
    
  return new VintaSendFactory<NotificationTypeConfig>().create(
    [adapter],
    backend,
    new MedplumLogger(),
    contextGeneratorsMap,
    undefined,
    new MedplumAttachmentManager(medplum),
  );
}
```

### Understanding the Notification Service

This file does several important things:

1. **Context Generators**: The `TaskAssignmentContextGenerator` takes the raw notification parameters and enriches them with data from Medplum (like the user's first name). This separates data fetching logic from template rendering.

2. **Type Safety**: TypeScript types ensure that context parameters match what the templates expect.

3. **VintaSend Setup**: The `getNotificationService` function wires together all the VintaSend components:
   - **Backend**: Stores notification data in Medplum as FHIR `Communication` resources
   - **Template Renderer**: Renders Pug templates from the compiled JSON
   - **Adapter**: Handles email sending through SendGrid with API key authentication
   - **Logger**: Logs notification events for debugging
   - **Attachment Manager**: Handles file attachments stored as Medplum `Binary` resources (if needed)

4. **SendGrid Configuration**: The adapter requires three environment variables:
   - `SENDGRID_API_KEY`: Your SendGrid API key for authentication
   - `SENDGRID_FROM_EMAIL`: The verified sender email address
   - `SENDGRID_FROM_NAME`: Optional display name for the sender

## Step 7: Create the Task Assignment Email Service

Now let's create the bot service that will be called when a task is assigned.

Create [bots/services/emails/send-task-assignment-email.ts](bots/services/emails/send-task-assignment-email.ts):

```typescript
import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { MedplumSingleton } from '../../../lib/medplum-singleton';
import { getNotificationService } from '../../../lib/notification-service';
import { formatPatientNameWithPreferredName } from '../../../lib/patients';

export async function sendTaskAssignmentEmail(
  medplum: MedplumClient, 
  task: Task, 
  taskLinkBaseUrl: string
) {
  /* sends a task assignment email to a practitioner */

  if (!task.owner?.reference) {
    console.error('[sendTaskAssignmentEmail] Task has no owner reference');
    throw new Error('Task must have an owner reference');
  }

  const referenceString = task.owner.reference;

  // Validate format (should be "ResourceType/id")
  if (!referenceString.includes('/')) {
    console.error('[sendTaskAssignmentEmail] Invalid referenceString format:', referenceString);
    throw new Error(`Invalid referenceString format: ${referenceString}`);
  }

  // Skip sending email if task is assigned to a Group
  const [resourceType] = referenceString.split('/');
  if (resourceType === 'Group') {
    console.log('[sendTaskAssignmentEmail] Task assigned to Group, skipping email notification');
    return;
  }

  MedplumSingleton.setInstance(medplum);
  const vintasend = getNotificationService(medplum);

  try {
    const taskTitle = task.code?.text || task.description || 'New Task';
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
        console.error('[sendTaskAssignmentEmail] Error fetching requester:', error);
      }
    }

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
      },
      sendAfter: new Date(),
      bodyTemplate: 'emails/task-assignment/body.html.pug',
      subjectTemplate: 'emails/task-assignment/subject.txt.pug',
      extraParams: {},
    });

    console.log('[sendTaskAssignmentEmail] Email sent successfully to:', referenceString);
  } catch (error) {
    console.error('[sendTaskAssignmentEmail] Error creating/sending notification:', error);
    throw error;
  }
}
```

### Key Features

- **Validation**: Checks that the task has an owner before attempting to send
- **Group Handling**: Skips sending emails when tasks are assigned to Groups (not individual users)
- **Priority Support**: Detects urgent tasks and passes that information to the template
- **Error Handling**: Gracefully handles missing data and logs errors
- **Requester Info**: Fetches the name of the person who created the task for context

## Step 8: Set Up the Build Process

To deploy bots to Medplum, we need to bundle them properly. Create [esbuild-script.mjs](esbuild-script.mjs):

```javascript
import botLayer from '@medplum/bot-layer/package.json' with { type: 'json' };
import esbuild from 'esbuild';
import fastGlob from 'fast-glob';

// Find all TypeScript files
const entryPoints = fastGlob
  .sync(['./src/**/*.ts', './bots/**/*.ts', './lib/**/*.ts'])
  .filter((file) => !file.endsWith('test.ts'));

const botLayerDeps = Object.keys(botLayer.dependencies);

const additionalExternals = [
  'react-transition-group',
  'react-remove-scroll',
];

const esbuildOptions = {
  entryPoints: entryPoints,
  bundle: true,
  outdir: './dist',
  platform: 'node',
  loader: {
    '.ts': 'ts',
  },
  resolveExtensions: ['.ts', '.js', '.json'],
  external: [...botLayerDeps, ...additionalExternals],
  format: 'cjs',
  target: 'es2020',
  tsconfig: 'tsconfig.json',
  footer: { js: 'Object.assign(exports, module.exports);' },
  sourcemap: true,
};

esbuild
  .build(esbuildOptions)
  .then(() => {
    console.log('Build completed successfully!');
  })
  .catch((error) => {
    console.error('Build failed:', JSON.stringify(error, null, 2));
    process.exit(1);
  });
```

This script bundles all TypeScript files (including bots and lib files) into a format that Medplum can execute.

## Step 9: Build and Deploy

Now you're ready to build and deploy your bot!

### Build the bot:
```bash
npm run bots:build
```

This will:
1. Compile the Pug templates to JSON
2. Compile TypeScript to JavaScript  
3. Bundle everything with esbuild

### Deploy to Medplum:
```bash
npm run bots:deploy
```

(Note: You'll need to configure your deployment script based on your Medplum setup)

## Step 10: Create the Bot Handler

Create the main bot file that will be executed by the subscription at [bots/task-assignment-bot.ts](bots/task-assignment-bot.ts):

```typescript
import { BotEvent, MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { sendTaskAssignmentEmail } from './services/emails/send-task-assignment-email';

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

  console.log(`[TaskAssignmentBot] Processing task: ${task.id}`);
  console.log(`[TaskAssignmentBot] Owner: ${task.owner?.reference}`);

  // Only send email if task has an owner
  if (task.owner?.reference) {
    const appBaseUrl = process.env.APP_BASE_URL || 'https://your-app-url.com';

    try {
      await sendTaskAssignmentEmail(medplum, task, appBaseUrl);
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
```

## Step 11: Set Up the Subscription

To automatically trigger the bot when tasks are assigned, you need to create a FHIR Subscription resource in Medplum that links to your bot.

### Environment Configuration

First, create a [.env.example](.env.example) file with the necessary environment variables:

```bash
# Medplum Configuration
MEDPLUM_BASE_URL=https://api.medplum.com
MEDPLUM_CLIENT_ID=your-client-id-here
MEDPLUM_CLIENT_SECRET=your-client-secret-here

# SendGrid Configuration
SENDGRID_API_KEY=your-sendgrid-api-key-here
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_FROM_NAME=Your App Name

# Application Configuration
APP_BASE_URL=https://your-app-url.com
```

Copy this to `.env` and fill in your actual values:
```bash
cp .env.example .env
```

**Important**: Add `.env` to your `.gitignore` to keep secrets safe!

### Understanding Subscriptions

A Subscription in Medplum needs:
- **Criteria**: A FHIR search query that determines when to trigger
- **Channel**: Points to your bot via `Bot/{bot-id}`
- **Interactions**: Which events trigger the subscription (create, update, delete)
- **Status**: `active` - The subscription is live

When a matching resource event occurs, Medplum automatically:
1. Evaluates the subscription criteria
2. If matched, invokes the bot with the resource as input
3. The bot executes its logic (in our case, sending an email)

### Creating the Subscription

For our task assignment email notification, you'll need to create a subscription with:

- **Criteria**: `Task?owner:missing=false`
  - This triggers whenever a Task resource has an `owner` field
  - Matches both newly assigned tasks and tasks where ownership changes
- **Supported Interactions**: `create` and `update`
  - Sends notifications for new task assignments and reassignments
- **Channel Endpoint**: `Bot/{your-task-assignment-bot-id}`

There are several ways to create subscriptions in Medplum:
- Through the Medplum console UI
- Via the Medplum API programmatically
- As part of your deployment workflow

**In this project**, subscription creation is handled automatically as part of our bot deployment workflow. When you run `npm run bots:deploy`, the deployment process creates or updates the subscription with the criteria above, linked to the task assignment bot. This ensures the subscription is always in sync with your deployed bot code.

Here's an example of how we configure our bot and its subscription in our deployment configuration:

```typescript
// Example from our deployment configuration
const botConfig = {
  name: 'Task Assignment Email Bot',
  description: 'Sends email notifications when tasks are assigned to practitioners',
  source: './dist/bots/task-assignment-bot.js',
  subscription: {
    criteria: 'Task?owner:missing=false',
    reason: 'Trigger email notification when a task is assigned',
    supportedInteractions: ['create', 'update'],
  },
};
```

When the deployment runs, it:
1. Creates or updates the bot with the specified source code
2. Creates or updates the subscription with the given criteria
3. Links the subscription to the bot automatically
4. Sets the subscription status to `active`

This declarative approach means you never have to manually manage subscriptions - they're always kept in sync with your bot deployments.

You can check how our deploy configuration works in our [deploy-bots.ts script](https://github.com/vintasoftware/vintasend-medplum-example/blob/main/scripts/deploy-bots.ts).

## Step 12: Deploy Everything

Now deploy your complete setup:

```bash
# 1. Build the bot
npm run bots:build

# 2. Deploy the bot code (this also handles subscription creation)
npm run bots:deploy
```

The deployment process will:
- Upload the compiled bot code to Medplum
- Create or update the subscription linking to the bot
- Activate the subscription to start receiving Task events

## Step 13: Using the Service

The subscription is now active! The bot will automatically run when tasks are assigned. You can also call the service directly in your code:

```typescript
import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { sendTaskAssignmentEmail } from './bots/services/emails/send-task-assignment-email';

// Direct usage (if not using subscription)
export async function manualTaskAssignment(medplum: MedplumClient, task: Task) {
  await sendTaskAssignmentEmail(
    medplum, 
    task, 
    'https://your-app-url.com'
  );
}
```

### Testing the Integration

Create or update a Task with an owner to trigger the email:

```typescript
const task = await medplum.createResource({
  resourceType: 'Task',
  status: 'requested',
  intent: 'order',
  priority: 'routine', // or 'urgent' for urgent tasks
  code: {
    text: 'Review patient chart',
  },
  description: 'Please review the patient chart and update the care plan',
  owner: {
    reference: 'Practitioner/123', // The practitioner who will receive the email
  },
  requester: {
    reference: 'Practitioner/456', // Who requested the task
  },
});
```

The subscription will automatically:
1. Detect the Task creation
2. Trigger the bot
3. Send the email notification

### Monitoring

Check bot execution in the Medplum console:
- Navigate to **Bots** → **Task Assignment Email Bot**
- View execution logs to see successful runs or errors
- Check notification `Communication` resources for sent emails

## How It Works: The Full Flow

Let's trace through what happens when a task is assigned:

1. **Task Created**: A FHIR `Task` resource is created or updated with an `owner`
2. **Subscription Evaluates**: Medplum evaluates the subscription criteria (`Task?owner:exists=true`)
3. **Bot Triggered**: If criteria matches, the bot is invoked with the Task resource
4. **Service Called**: The bot handler calls `sendTaskAssignmentEmail()`
5. **Validation**: The service validates the task has an owner and isn't assigned to a Group
6. **Data Enrichment**: 
   - Fetches the requester's name
   - Builds the task link
   - Determines if the task is urgent
7. **Notification Created**: VintaSend's `createNotification()` is called with:
   - User ID (the FHIR reference)
   - Context parameters (taskTitle, taskDescription, etc.)
   - Template paths
8. **Context Generation**: The `TaskAssignmentContextGenerator` runs:
   - Fetches the recipient's user record from Medplum
   - Extracts their first name (respecting preferred names)
   - Merges with the provided parameters
9. **Template Rendering**: Pug templates are rendered with the enriched context
11. **Email Sent**: The email is sent via SendGrid's API
12. **Notification Stored**: VintaSend stores the notification record in Medplum as a FHIR `Communication` resource for auditing

## Benefits of This Approach

✅ **Type-Safe**: TypeScript ensures your context parameters match your templates  
✅ **Testable**: Each component can be tested in isolation  
✅ **Maintainable**: Templates are separate from logic  
✅ **Extensible**: Easy to add new notification types  
✅ **FHIR-Native**: Integrates seamlessly with Medplum's FHIR data model  
✅ **Auditable**: All notifications are stored as FHIR resources  

## Advanced: Scheduled Notifications with Task Due Soon Reminders

One of VintaSend's most powerful features is the ability to schedule notifications for future delivery. Instead of sending an email immediately, you can specify a `sendAfter` date and VintaSend will automatically send the notification at the right time.

In this section, we'll build a task reminder system that:
- ✅ Periodically checks for tasks due in 24 hours
- ✅ Schedules reminder emails to be sent exactly 24 hours before the due date
- ✅ Fetches fresh data at send-time (not when scheduled)
- ✅ Processes pending notifications automatically

### Why Use Scheduled Notifications?

**📅 Fresh Data at Send Time**
- Context is fetched when the notification is sent, not when it's scheduled
- If a user's name or task details change, the email will use the latest information
- No stale data issues

**⏰ Scheduled Delivery**
- Send reminders at scheduled times (24 hours before, 1 week before, etc.)
- Notifications sent within 5 minutes of the scheduled time (based on cron frequency)
- No need to manually track when to send each notification

**📋 Audit Trail**
- All notifications stored as FHIR `Communication` resources
- Track status changes (pending → sent/failed)
- Full history of scheduled and sent notifications

### Step 1: Create Task Due Soon Templates

First, let's create email templates for our task reminder notifications.

#### Email Body Template

Create [notification-templates/emails/task-due-soon/body.html.pug](notification-templates/emails/task-due-soon/body.html.pug):

```pug
doctype html
html
  head
    meta(charset='utf-8')
    style.
      body {
        white-space: pre-line;
      }
  body
    h1 Task Due Reminder

    p Hello #{firstName},

    p This is a reminder that you have a task that is due in approximately 24 hours.

    p
      strong Task:
      |  #{taskTitle}
    if taskDescription
      p
        strong Description:
        |  #{taskDescription}
    p
      strong Due Date:
      |  #{dueDate}
    if taskIsUrgent
      p
        strong URGENT

    p
      a(href=taskLink) View Task

    p Please make sure to complete this task before the due date.
```

#### Email Subject Template

Create [notification-templates/emails/task-due-soon/subject.txt.pug](notification-templates/emails/task-due-soon/subject.txt.pug):

```pug
if taskIsUrgent
  | [URGENT] Task due soon: #{taskTitle}
else
  | Reminder: Task due soon - #{taskTitle}
```

### Step 2: Add Context Generator for Task Due Soon

Update [lib/notification-service.ts](lib/notification-service.ts) to include a new context generator for task due reminders:

```typescript
class TaskDueSoonContextGenerator implements ContextGenerator {
  async generate({
    userId,
    taskTitle,
    taskDescription,
    taskIsUrgent,
    taskLink,
    dueDate,
  }: {
    userId: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    dueDate: string;
  }): Promise<{
    firstName: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    dueDate: string;
  }> {
    const medplum = MedplumSingleton.getInstance();
    const user = await getUserById(medplum, userId);
    const firstName = formatPatientNameWithPreferredName(user.name?.[0]) ?? 'Practitioner';

    return {
      firstName,
      taskTitle,
      taskDescription,
      taskIsUrgent,
      taskLink,
      dueDate,
    };
  }
}
```

Then add it to the context map:

```typescript
export const contextGeneratorsMap = {
  taskAssignment: new TaskAssignmentContextGenerator(),
  taskDueSoon: new TaskDueSoonContextGenerator(),
  // Add more context generators here for other notification types
} as const;
```

### Step 3: Create the Task Due Soon Email Service

Create [bots/services/emails/send-task-due-soon-email.ts](bots/services/emails/send-task-due-soon-email.ts):

```typescript
import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { MedplumSingleton } from '../../../lib/medplum-singleton';
import { getNotificationService, SendGridConfig } from '../../../lib/notification-service';

export async function sendTaskDueSoonEmail(
  medplum: MedplumClient, 
  task: Task, 
  taskLinkBaseUrl: string, 
  sendgridConfig: SendGridConfig
) {
  /* sends a task due soon reminder email to a practitioner 24 hours before the task is due */

  if (!task.owner?.reference) {
    console.error('[sendTaskDueSoonEmail] Task has no owner reference');
    throw new Error('Task must have an owner reference');
  }

  if (!task.restriction?.period?.end) {
    console.error('[sendTaskDueSoonEmail] Task has no due date');
    throw new Error('Task must have a due date (restriction.period.end)');
  }

  const referenceString = task.owner.reference;

  // Validate format (should be "ResourceType/id")
  if (!referenceString.includes('/')) {
    console.error('[sendTaskDueSoonEmail] Invalid referenceString format:', referenceString);
    throw new Error(`Invalid referenceString format: ${referenceString}`);
  }

  // Skip sending email if task is assigned to a Group
  const [resourceType] = referenceString.split('/');
  if (resourceType === 'Group') {
    console.log('[sendTaskDueSoonEmail] Task assigned to Group, skipping email notification');
    return;
  }

  MedplumSingleton.setInstance(medplum);
  const vintasend = getNotificationService(medplum, sendgridConfig);

  try {
    const taskTitle = task.code?.text || task.description || 'Task';

    if (!task.id) {
      console.error('[sendTaskDueSoonEmail] Task has no id');
      throw new Error('Task must have an id to send task due soon email');
    }

    const taskLink = `${taskLinkBaseUrl}/Task/${task.id}`;
    const taskIsUrgent = task.priority === 'urgent';
    const dueDate = new Date(task.restriction.period.end);
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
      console.log('[sendTaskDueSoonEmail] Task due date is within 24 hours or past, skipping');
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
      sendAfter, // 🔑 This is the key - schedule for future delivery
      bodyTemplate: 'emails/task-due-soon/body.html.pug',
      subjectTemplate: 'emails/task-due-soon/subject.txt.pug',
      extraParams: {},
    });

    console.log(
      `[sendTaskDueSoonEmail] Email scheduled for ${sendAfter.toISOString()} to: ${referenceString}`
    );
  } catch (error) {
    console.error('[sendTaskDueSoonEmail] Error creating/sending notification:', error);
    throw error;
  }
}
```

**Key Points:**
- The `sendAfter` parameter tells VintaSend when to send the notification
- We calculate it as 24 hours before the task's due date
- The notification is stored with status `pending` until `sendAfter` time
- Context is fetched at send-time, not when scheduled

### Step 4: Create the Periodic Bot to Check for Tasks Due Soon

Create [bots/handlers/task-due-soon-notification-bot.ts](bots/handlers/task-due-soon-notification-bot.ts):

```typescript
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
 * Cron: */5 * * * * (every 5 minutes)
 */

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  console.log('[TaskDueSoonNotificationBot] Starting periodic check for tasks due in ~24 hours');

  const appBaseUrl = process.env.APP_BASE_URL || 'https://your-app-url.com';
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
    
    console.log(`[TaskDueSoonNotificationBot] Found ${tasks.length} tasks due in 24-25 hours`);

    if (tasks.length === 0) {
      return { message: 'No tasks to process', processedTasks: 0 };
    }

    // Process each task and schedule notifications
    const results = await Promise.allSettled(
      tasks.map(async (task) => {
        if (!task || task.resourceType !== 'Task') {
          return { status: 'skipped', reason: 'Invalid task resource' };
        }
        try {
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
      `[TaskDueSoonNotificationBot] Completed. Success: ${successful}, Failed: ${failed}`
    );

    return {
      message: 'Task due soon notifications processed',
      processedTasks: tasks.length,
      successful,
      failed,
    };
  } catch (error) {
    console.error('[TaskDueSoonNotificationBot] Error during execution:', error);
    throw error;
  }
}
```

**Understanding the Time Window:**
- We check for tasks due in 24-25 hours (a 1-hour window)
- This prevents duplicate notifications if the bot runs multiple times
- Tasks are found only once, when they first enter this window

### Step 5: Create the Send Pending Notifications Bot

VintaSend stores scheduled notifications with a `pending` status. We need a periodic bot to actually send them when their `sendAfter` time arrives.

Create [bots/handlers/send-pending-notifications-bot.ts](bots/handlers/send-pending-notifications-bot.ts):

```typescript
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
 * Cron: */5 * * * * (every 5 minutes)
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
```

This bot:
- Runs every 5 minutes via cron schedule
- Calls `vintasend.sendPendingNotifications()` which:
  - Queries for all `Communication` resources with status `pending` and `sendAfter <= now`
  - Fetches fresh context data using the context generators
  - Renders templates with current data
  - Sends emails via SendGrid
  - Updates notification status to `sent` or `failed`

### Step 6: Configure Both Bots in the Deployment

Update [bots/index.ts](bots/index.ts) to include both new bots:

```typescript
export const BOTS: BotDescription[] = [
  {
    name: 'send-task-assignment-email',
    needsAdminMembership: true,
    runAsUser: true,
    criteria: 'Task?owner:missing=false',
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
  {
    name: 'task-due-soon-notification-bot',
    needsAdminMembership: true,
    runAsUser: true,
    cronString: '*/5 * * * *', // Run every 5 minutes
    timeout: 300, // 5 minutes timeout
  },
  {
    name: 'send-pending-notifications-bot',
    needsAdminMembership: true,
    runAsUser: true,
    cronString: '*/5 * * * *', // Run every 5 minutes
    timeout: 300, // 5 minutes timeout
  },
];
```

### Step 7: Build and Deploy

Build and deploy your bots:

```bash
# Compile templates and build bots
npm run bots:build

# Deploy to Medplum
npm run bots:deploy
```

### How the Scheduled Notification Flow Works

Here's the complete lifecycle of a scheduled task reminder:

1. **Task Created with Due Date**
   - A Task is created with `restriction.period.end` set to a future date
   - Task is assigned to a practitioner via `owner` reference

2. **Periodic Check (Every 5 Minutes)**
   - `task-due-soon-notification-bot` runs via cron
   - Searches for tasks with due dates in the 24-25 hour window
   - For each matching task, calls `sendTaskDueSoonEmail()`

3. **Notification Scheduled**
   - `sendTaskDueSoonEmail()` calls `vintasend.createNotification()`
   - VintaSend creates a FHIR `Communication` resource with:
     - Status: `pending`
     - `sendAfter`: Set to 24 hours before task due date
     - Context parameters stored in the Communication resource

4. **Waiting Period**
   - Notification sits in the database with `pending` status
   - Task details, user data, etc. can change during this time

5. **Send Time Arrives**
   - `send-pending-notifications-bot` runs every 5 minutes
   - Calls `vintasend.sendPendingNotifications()`
   - VintaSend finds all notifications where `sendAfter <= now` and status is `pending`

6. **Context Generation (Fresh Data!)**
   - For each pending notification, VintaSend calls the context generator
   - `TaskDueSoonContextGenerator.generate()` fetches current user data
   - If the user's name changed since scheduling, the new name is used
   - This ensures all data in the email is current

7. **Template Rendering**
   - Pug templates are rendered with fresh context
   - Email HTML and subject are generated

8. **Email Sent**
   - SendGrid adapter sends the email
   - `Communication` resource status updated to `sent`
   - Timestamp recorded in `sent` field

9. **Error Handling**
   - If sending fails, status is set to `failed`
   - Error details stored in the Communication resource
   - Failed notifications remain in the database for manual review or retry

### Benefits of This Approach

✅ **Always Current Data**: Context fetched at send-time, not schedule-time  
✅ **Scheduled Delivery**: Emails sent within 5 minutes of scheduled time (based on cron frequency)  
✅ **Audit Trail**: Every notification stored as a FHIR `Communication` resource  
✅ **Status Tracking**: Monitor pending, sent, and failed notifications  
✅ **Scalable**: Works with any number of scheduled notifications  
✅ **Flexible**: Easy to add more notification types (appointment reminders, etc.)  

### Testing Scheduled Notifications

To test the scheduled notification system:

1. **Create a Task with a Due Date**:
```typescript
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
tomorrow.setHours(14, 0, 0, 0); // 2 PM tomorrow

const task = await medplum.createResource({
  resourceType: 'Task',
  status: 'requested',
  intent: 'order',
  priority: 'routine',
  code: { text: 'Review lab results' },
  description: 'Review and approve patient lab results',
  owner: { reference: 'Practitioner/123' },
  restriction: {
    period: {
      end: tomorrow.toISOString(),
    },
  },
});
```

2. **Wait for the Periodic Bot to Run**:
   - Within 5 minutes, the `task-due-soon-notification-bot` should pick up the task
   - Check bot logs to confirm notification was scheduled

3. **Check the Communication Resource**:
```typescript
const communications = await medplum.search('Communication', {
  'status': 'pending',
  'subject': `Task/${task.id}`,
});
// Should show a pending notification with sendAfter timestamp
```

4. **Wait for Send Time**:
   - The `send-pending-notifications-bot` will send it when `sendAfter` time arrives
   - Check the practitioner's email inbox
   - Communication status should change to `sent`

### Customizing Send Times

You can easily adjust when reminders are sent:

```typescript
// Send 1 week before
const sendAfter = new Date(dueDate.getTime() - 7 * 24 * 60 * 60 * 1000);

// Send 2 hours before
const sendAfter = new Date(dueDate.getTime() - 2 * 60 * 60 * 1000);

// Send at a specific time on a specific date
const sendAfter = new Date('2026-02-15T10:00:00Z');
```

### Multiple Reminders for One Task

You can schedule multiple reminders for the same task:

```typescript
// Send 1 week before
await vintasend.createNotification({
  // ... notification config
  sendAfter: new Date(dueDate.getTime() - 7 * 24 * 60 * 60 * 1000),
  title: 'Task Due in 1 Week',
});

// Send 1 day before
await vintasend.createNotification({
  // ... notification config
  sendAfter: new Date(dueDate.getTime() - 24 * 60 * 60 * 1000),
  title: 'Task Due Tomorrow',
});

// Send on due date
await vintasend.createNotification({
  // ... notification config
  sendAfter: dueDate,
  title: 'Task Due Today',
});
```

## Next Steps

Now that you have both immediate and scheduled email notifications working, you can:

1. **Add More Notification Types**: Create context generators for appointment reminders, lab results, etc.
2. **Add SMS Support**: VintaSend supports multiple channels
3. **Customize Templates**: Add branding, better styling, or more dynamic content
4. **Add Preferences**: Let users opt-in/out of certain notifications
5. **Add Multiple Reminders**: Send notifications at different intervals (1 week, 1 day, 1 hour before)
6. **Add Escalation**: Send reminders to supervisors if tasks remain incomplete

## Troubleshooting

**Templates not compiling?**
- Ensure `vintasend-medplum` is installed
- Check that template paths match exactly

**Emails not sending?**
- Verify SendGrid API key is valid and has sending permissions
- Check that `SENDGRID_FROM_EMAIL` is a verified sender in SendGrid
- Review bot logs for SendGrid API errors
- Ensure the recipient's FHIR resource has a valid `telecom` entry with email

**Context data missing?**
- Verify the context generator is fetching data correctly
- Check that FHIR resources have the expected fields

## Conclusion

You now have a robust, production-ready email notification system for your Medplum application! This architecture scales well as you add more notification types and channels.

The combination of VintaSend and Medplum provides a powerful foundation for healthcare communications that respect FHIR standards while remaining developer-friendly.

## Resources

- [VintaSend Medplum Example App](https://github.com/vintasoftware/vintasend-medplum-example)
- [VintaSend Documentation](https://github.com/vintasoftware/vintasend)
- [VintaSend-Medplum Documentation](https://github.com/vintasoftware/vintasend-medplum)
- [Medplum Documentation](https://www.medplum.com/docs)
- [Medplum Bots](https://www.medplum.com/docs/bots)
- [FHIR Task Resource](https://www.hl7.org/fhir/task.html)
