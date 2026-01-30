# Building Email Notifications for Task Assignments in Medplum with VintaSend

## Introduction

In this tutorial, we'll walk through implementing an email notification system for task assignments in a Medplum healthcare application. When a practitioner is assigned a task, they'll automatically receive an email with all the relevant details. 

We'll be using [VintaSend](https://github.com/vintasoftware/vintasend), a powerful notification framework, along with [VintaSend-Medplum](https://github.com/vintasoftware/vintasend-medplum), which provides Medplum-specific adapters for the VintaSend framework.

> **Note**: This project is based on the [Medplum Provider example application](https://github.com/medplum/medplum-provider/), which provides a comprehensive starter template for building healthcare applications with Medplum. We've extended it with VintaSend integration to demonstrate email notifications and file attachment capabilities.

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
import { getNotificationService, SendGridConfig } from '../../../lib/notification-service';
import { formatPatientNameWithPreferredName } from '../../../lib/patients';

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

    // eslint-disable-next-line no-console
    console.log('[sendTaskAssignmentEmail] Email sent successfully to:', referenceString);
  } catch (error) {
    // eslint-disable-next-line no-console
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
    const appBaseUrl = process.env.APP_BASE_URL || 'https://your-app-url.com';

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

## Advanced: File Attachments for Task Notifications

One of VintaSend's powerful features is built-in attachment management. Files are stored efficiently in Medplum as FHIR Binary resources with automatic deduplication, and can be easily attached to email notifications.

In this section, we'll implement:
- ✅ File upload utilities for tasks
- ✅ FHIR-compliant file storage (Binary/Media resources)
- ✅ Automatic email attachment inclusion
- ✅ File deduplication via checksums
- ✅ Support for multiple file types

### Why Use VintaSend for Attachments?

**📎 Automatic Deduplication**
- Files with identical content stored once via checksum
- Multiple notifications can reference the same file
- Reduces storage costs

**🔒 FHIR-Native Storage**
- Files stored as Binary resources
- Metadata stored as Media resources
- Full FHIR compliance and access control

**📧 Email Provider Agnostic**
- Works with SendGrid, AWS SES, or any adapter
- Attachment handling abstracted from email provider
- Easy to switch providers without code changes

### Prerequisites

- Completed the basic task assignment tutorial
- VintaSend and VintaSend-Medplum installed
- Understanding of FHIR Binary and Media resources

### Step 1: Understanding FHIR File Storage

FHIR provides two resource types for handling files:

1. **Binary Resource**: Stores the actual file content
   - Contains raw file data (base64 encoded or direct binary)
   - Has minimal metadata (content type, data)
   - Used as the storage layer

2. **Media Resource**: Provides file metadata and references
   - Links to a Binary resource via `content.url`
   - Contains rich metadata (title, creation date, subject, etc.)
   - Used as the presentation/reference layer

**Why use both?**

Using Binary + Media follows FHIR best practices:
- **Separation of concerns**: Data storage (Binary) vs metadata (Media)
- **Reusability**: Multiple Media resources can reference the same Binary
- **Deduplication**: VintaSend automatically detects duplicate files via checksum
- **Access control**: Fine-grained permissions on Media without exposing Binary directly

**Example FHIR Resources**:

```json
// Binary resource (stores file content)
{
  "resourceType": "Binary",
  "id": "example-pdf-123",
  "contentType": "application/pdf",
  "data": "JVBERi0xLjQKJcOkw7zDtsOfCjIgMC..." // base64 encoded PDF
}

// Media resource (provides metadata)
{
  "resourceType": "Media",
  "id": "example-media-456",
  "status": "completed",
  "content": {
    "contentType": "application/pdf",
    "url": "Binary/example-pdf-123",
    "title": "Lab Results.pdf"
  }
}

// Task with attachment (references Media)
{
  "resourceType": "Task",
  "id": "example-task-789",
  "status": "requested",
  "input": [
    {
      "type": {
        "coding": [{
          "system": "http://vintasend-medplum-example.com/task-input-types",
          "code": "attachment",
          "display": "File Attachment"
        }]
      },
      "valueReference": {
        "reference": "Media/example-media-456"
      }
    }
  ]
}
```

### Step 2: Create File Upload Utilities

Create [lib/file-upload.ts](lib/file-upload.ts):

```typescript
import { MedplumClient } from '@medplum/core';
import { Binary, Media, Reference, Task, TaskInput } from '@medplum/fhirtypes';

export interface FileUploadResult {
  binary: Binary;
  media: Media;
}

/**
 * Uploads a file to Medplum and creates both Binary and Media resources.
 */
export async function uploadFileToMedplum(
  medplum: MedplumClient,
  file: File | Buffer,
  filename: string,
  contentType: string
): Promise<FileUploadResult> {
  // Create Binary resource to store the file content
  const binary = await medplum.createBinary(file, filename, contentType);

  // Create Media resource as metadata wrapper
  const media = await medplum.createResource<Media>({
    resourceType: 'Media',
    status: 'completed',
    content: {
      contentType,
      url: `Binary/${binary.id}`,
      title: filename,
    },
  });

  return { binary, media };
}

/**
 * Attaches a Media resource to a Task by adding it to the task's input array.
 */
export async function attachFileToTask(
  medplum: MedplumClient,
  task: Task,
  mediaReference: Reference<Media>
): Promise<Task> {
  const currentInputs = task.input || [];

  const attachmentInput: TaskInput = {
    type: {
      coding: [
        {
          system: 'http://vintasend-medplum-example.com/task-input-types',
          code: 'attachment',
          display: 'File Attachment',
        },
      ],
    },
    valueReference: mediaReference,
  };

  const updatedTask = await medplum.updateResource<Task>({
    ...task,
    input: [...currentInputs, attachmentInput],
  });

  return updatedTask;
}

/**
 * Retrieves all Media resources attached to a Task.
 */
export async function getTaskAttachments(
  medplum: MedplumClient,
  task: Task
): Promise<Media[]> {
  if (!task.input || task.input.length === 0) {
    return [];
  }

  const attachmentInputs = task.input.filter((input) => {
    const coding = input.type?.coding?.[0];
    return coding?.code === 'attachment' && input.valueReference?.reference;
  });

  const mediaPromises = attachmentInputs.map(async (input): Promise<Media | null> => {
    const reference = input.valueReference?.reference;
    if (!reference) return null;

    try {
      const [resourceType, id] = reference.split('/');
      if (resourceType !== 'Media' || !id) return null;

      return await medplum.readResource('Media', id);
    } catch (error) {
      console.error(`Failed to fetch Media: ${reference}`, error);
      return null;
    }
  });

  const mediaResources = await Promise.all(mediaPromises);
  return mediaResources.filter((media): media is Media => media !== null);
}

/**
 * Gets the Binary content from a Media resource.
 */
export async function getBinaryFromMedia(
  medplum: MedplumClient,
  media: Media
): Promise<Binary | null> {
  const binaryUrl = media.content?.url;
  if (!binaryUrl) return null;

  try {
    const [resourceType, id] = binaryUrl.split('/');
    if (resourceType !== 'Binary' || !id) return null;

    return await medplum.readResource('Binary', id);
  } catch (error) {
    console.error(`Failed to fetch Binary: ${binaryUrl}`, error);
    return null;
  }
}
```

**Key Points:**

- **`uploadFileToMedplum`**: Creates both Binary and Media resources in a single operation
- **`attachFileToTask`**: Adds attachment to task's `input` array following FHIR standards
- **`getTaskAttachments`**: Retrieves all Media resources attached to a task
- **`getBinaryFromMedia`**: Utility to fetch the actual file content from a Media reference

### Step 3: Configure File Upload Constraints

Update [lib/constants.ts](lib/constants.ts) to add file upload configuration:

```typescript
/**
 * Task attachment configuration
 */
export const TASK_ATTACHMENT_INPUT_TYPE = {
  system: 'http://vintasend-medplum-example.com/task-input-types',
  code: 'attachment',
  display: 'File Attachment',
};

/**
 * Maximum file size for attachments (10MB)
 */
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

/**
 * Allowed file types for task attachments
 */
export const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];
```

**Configuration Explained:**

1. **`TASK_ATTACHMENT_INPUT_TYPE`**: FHIR coding system for identifying task attachments
   - Uses a custom system URL for your application
   - Code `'attachment'` indicates this input is a file attachment
   - Display name for human readability

2. **`MAX_ATTACHMENT_SIZE`**: 10MB limit (10 * 1024 * 1024 bytes)
   - Prevents excessive storage usage
   - SendGrid has a 30MB total attachment limit per email
   - Adjust based on your needs and email provider limits

3. **`ALLOWED_FILE_TYPES`**: Whitelist of MIME types
   - **Documents**: PDF, Word, Excel
   - **Images**: JPEG, PNG, GIF, WebP
   - **Text**: Plain text, CSV
   - Add more types as needed (e.g., `'video/mp4'`, `'audio/mpeg'`)

**Why restrict file types?**

- **Security**: Prevent malicious file uploads (executables, scripts)
- **Compatibility**: Ensure files can be previewed/opened by recipients
- **Storage optimization**: Exclude large video/audio files unless needed
- **Compliance**: Meet healthcare regulations (e.g., only allow approved formats)

### Validation Best Practices

When implementing file upload UI, always validate:

```typescript
function validateFile(file: File): string | null {
  // Check file size
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return `File too large. Maximum size is ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB`;
  }

  // Check file type
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return `File type ${file.type} is not allowed`;
  }

  return null; // No errors
}
```

### Next Steps

Now that we have the foundation for file attachments:
- ✅ FHIR Binary and Media resources explained
- ✅ File upload utilities created
- ✅ File constraints configured

Next, we'll build the React UI for file uploads and integrate with task forms.

---

### Step 4: Build File Upload UI Components

Now let's create the React components that allow users to upload files and attach them to tasks.

#### 4.1: Create the File Upload Component

Create [src/components/tasks/TaskFileUpload.tsx](src/components/tasks/TaskFileUpload.tsx):

```typescript
import { useState, useCallback } from 'react';
import { useMedplum } from '@medplum/react';
import { FileInput, Group, Text, Alert, Progress } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { JSX } from 'react';
import type { Media } from '@medplum/fhirtypes';
import { uploadFileToMedplum } from '../../../lib/file-upload';
import { MAX_ATTACHMENT_SIZE, ALLOWED_FILE_TYPES } from '../../../lib/constants';

export interface TaskFileUploadProps {
  onFileUploaded: (media: Media) => void;
  disabled?: boolean;
}

export function TaskFileUpload({ onFileUploaded, disabled = false }: TaskFileUploadProps): JSX.Element {
  const medplum = useMedplum();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      const maxSizeMB = MAX_ATTACHMENT_SIZE / (1024 * 1024);
      return `File size exceeds maximum allowed size of ${maxSizeMB}MB`;
    }

    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return `File type "${file.type}" is not allowed. Allowed types: PDF, images, Word documents, Excel spreadsheets, text files.`;
    }

    return null;
  };

  const handleFileChange = useCallback(
    async (file: File | null) => {
      if (!file) return;

      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);
      setUploading(true);
      setUploadProgress(0);

      try {
        // Simulate progress
        const progressInterval = setInterval(() => {
          setUploadProgress((prev) => Math.min(prev + 10, 90));
        }, 100);

        const { media } = await uploadFileToMedplum(medplum, file, file.name, file.type);

        clearInterval(progressInterval);
        setUploadProgress(100);

        onFileUploaded(media);

        setTimeout(() => {
          setUploadProgress(0);
          setUploading(false);
        }, 500);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to upload file');
        setUploading(false);
        setUploadProgress(0);
      }
    },
    [medplum, onFileUploaded]
  );

  return (
    <div>
      <FileInput
        label="Attach File"
        placeholder="Click to select file"
        accept={ALLOWED_FILE_TYPES.join(',')}
        onChange={handleFileChange}
        disabled={disabled || uploading}
        clearable
      />

      {uploading && (
        <Group mt="xs">
          <Progress value={uploadProgress} style={{ flex: 1 }} />
          <Text size="xs" c="dimmed">
            {uploadProgress}%
          </Text>
        </Group>
      )}

      {error && (
        <Alert icon={<IconAlertCircle size={16} />} title="Upload Error" color="red" mt="xs">
          {error}
        </Alert>
      )}

      <Text size="xs" c="dimmed" mt="xs">
        Maximum file size: {MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB. Allowed types: PDF, images, Word, Excel, text files.
      </Text>
    </div>
  );
}
```

**Component Features:**

1. **File Validation**: Checks size and type before upload
2. **Progress Indicator**: Shows upload progress to user
3. **Error Handling**: Displays clear error messages
4. **Disabled State**: Can be disabled during form submission
5. **User Feedback**: Shows allowed file types and size limits

#### 4.2: Create the Attachment List Component

Create [src/components/tasks/TaskAttachmentList.tsx](src/components/tasks/TaskAttachmentList.tsx):

```typescript
import { useMedplum } from '@medplum/react';
import type { Media } from '@medplum/fhirtypes';
import { Badge, Group, ActionIcon, Text, Stack, Paper, Tooltip } from '@mantine/core';
import { IconDownload, IconX, IconFile, IconFileText, IconPhoto } from '@tabler/icons-react';
import type { JSX } from 'react';

export interface TaskAttachmentListProps {
  attachments: Media[];
  onRemove?: (mediaId: string) => void;
  readOnly?: boolean;
}

export function TaskAttachmentList({ 
  attachments, 
  onRemove, 
  readOnly = false 
}: TaskAttachmentListProps): JSX.Element {
  const medplum = useMedplum();

  if (attachments.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        No attachments
      </Text>
    );
  }

  const getFileIcon = (contentType?: string): JSX.Element => {
    if (!contentType) return <IconFile size={20} />;
    if (contentType.startsWith('image/')) return <IconPhoto size={20} />;
    if (contentType.includes('pdf') || contentType.includes('document')) {
      return <IconFileText size={20} />;
    }
    return <IconFile size={20} />;
  };

  const handleDownload = async (media: Media): Promise<void> => {
    if (!media.content?.url) return;

    try {
      const binaryId = media.content.url.split('/')[1];
      const url = `${medplum.getBaseUrl()}fhir/R4/Binary/${binaryId}`;
      
      const link = document.createElement('a');
      link.href = url;
      link.download = media.content.title || 'download';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to download file:', error);
    }
  };

  return (
    <Stack gap="xs">
      {attachments.map((media) => (
        <Paper key={media.id} p="sm" withBorder>
          <Group justify="space-between">
            <Group gap="sm">
              {getFileIcon(media.content?.contentType)}
              <div>
                <Text size="sm" fw={500}>
                  {media.content?.title || 'Untitled'}
                </Text>
                <Badge size="xs" variant="outline">
                  {media.content?.contentType || 'Unknown type'}
                </Badge>
              </div>
            </Group>

            <Group gap="xs">
              <Tooltip label="Download file">
                <ActionIcon
                  variant="subtle"
                  color="blue"
                  onClick={() => handleDownload(media)}
                  aria-label="Download file"
                >
                  <IconDownload size={18} />
                </ActionIcon>
              </Tooltip>

              {!readOnly && onRemove && (
                <Tooltip label="Remove attachment">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => onRemove(media.id as string)}
                    aria-label="Remove attachment"
                  >
                    <IconX size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
```

**Component Features:**

1. **File Icons**: Different icons for images, documents, and generic files
2. **Download**: Click to download any attachment
3. **Remove**: Option to remove attachments (when not read-only)
4. **Metadata Display**: Shows filename and file type
5. **Responsive Layout**: Clean card-based design

#### 4.3: Integrate with Task Creation Form

Update [src/components/tasks/NewTaskModal.tsx](src/components/tasks/NewTaskModal.tsx) to include file uploads:

```typescript
// Add imports
import type { Media } from '@medplum/fhirtypes';
import { TaskFileUpload } from './TaskFileUpload';
import { TaskAttachmentList } from './TaskAttachmentList';
import { TASK_ATTACHMENT_INPUT_TYPE } from '../../../lib/constants';

// Add state for attachments
const [attachments, setAttachments] = useState<Media[]>([]);

// Add handler functions
const handleFileUploaded = (media: Media): void => {
  setAttachments((prev) => [...prev, media]);
};

const handleRemoveAttachment = (mediaId: string): void => {
  setAttachments((prev) => prev.filter((m) => m.id !== mediaId));
};

// Update task creation to include attachments
const newTask: Task = {
  resourceType: 'Task',
  // ... other fields ...
  input: attachments.map((media) => ({
    type: {
      coding: [TASK_ATTACHMENT_INPUT_TYPE],
      text: 'File Attachment',
    },
    valueReference: createReference(media),
  })),
};

// Add to form UI (in the description section)
<Box>
  <Text size="sm" fw={500} mb="xs">
    Attachments
  </Text>
  <Stack gap="sm">
    <TaskFileUpload onFileUploaded={handleFileUploaded} disabled={isSubmitting} />
    {attachments.length > 0 && (
      <TaskAttachmentList attachments={attachments} onRemove={handleRemoveAttachment} />
    )}
  </Stack>
</Box>
```

**Integration Highlights:**

1. **State Management**: Track uploaded Media resources in component state
2. **FHIR Compliance**: Store attachments in `task.input` array following FHIR standards
3. **User Experience**: Upload → Preview → Remove workflow
4. **Form Reset**: Clear attachments when modal closes

### How It Works: The Upload Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User selects file in TaskFileUpload component           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Validate file type and size                             │
│    - Check against ALLOWED_FILE_TYPES                       │
│    - Check against MAX_ATTACHMENT_SIZE                      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Upload to Medplum via uploadFileToMedplum()             │
│    - Create Binary resource (stores file content)           │
│    - Create Media resource (stores metadata)                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Add Media to attachments array via handleFileUploaded() │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Display in TaskAttachmentList (with download/remove)    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. On task creation, add to task.input array               │
│    - Each attachment becomes a TaskInput entry              │
│    - Type: TASK_ATTACHMENT_INPUT_TYPE coding                │
│    - Value: Reference to Media resource                     │
└─────────────────────────────────────────────────────────────┘
```

### Testing Your File Upload UI

Try these scenarios to verify everything works:

1. **Upload valid file**: Select a PDF or image → Should upload successfully
2. **Upload invalid type**: Select .exe file → Should show error message
3. **Upload large file**: Select 15MB file → Should show size error
4. **Multiple files**: Upload 2-3 files → All should appear in list
5. **Remove file**: Click X on attachment → Should disappear from list
6. **Download file**: Click download icon → Should download file
7. **Create task**: Upload files and create task → Attachments saved in task.input

### UI Best Practices

**Accessibility:**
- Use proper ARIA labels on action icons
- Provide keyboard navigation support
- Show clear error messages

**User Feedback:**
- Display upload progress
- Show file validation errors immediately
- Confirm successful uploads visually

**Performance:**
- Validate before upload (don't upload invalid files)
- Show loading states during upload
- Optimize large images before upload (future enhancement)

### Summary

Phase 2 complete! You now have:
- ✅ File upload component with validation
- ✅ Attachment list with download/remove
- ✅ Integration with task creation form
- ✅ FHIR-compliant storage in task.input

Next, we'll integrate these attachments with email notifications so files are automatically included when task assignment emails are sent.

---

### Step 5: Add Attachment Support to Email Notifications

Now that we have the UI for uploading files to tasks, let's integrate those attachments with our email notification system so that files are automatically included when task assignment emails are sent.

#### 5.1: Add Attachment Conversion Function

First, we need to add a function that converts FHIR Media/Binary resources to the format expected by VintaSend for email attachments.

Update [lib/notification-service.ts](lib/notification-service.ts) to import the file upload utilities:

```typescript
import type { Media } from '@medplum/fhirtypes';
import { getBinaryFromMedia } from './file-upload';
```

Then add the `convertMediaToAttachment` function after the `getUserById` function:

```typescript
/**
 * Converts a Media resource to VintaSend attachment format.
 * 
 * Fetches the Binary resource referenced by the Media and extracts the file data,
 * then returns it in the format expected by VintaSend for email attachments.
 * 
 * @param medplum - The Medplum client instance
 * @param media - The Media resource containing the file metadata
 * @returns A NotificationAttachmentUpload object with file, filename, and contentType
 * 
 * @example
 * const attachment = await convertMediaToAttachment(medplum, media);
 * // { file: Buffer, filename: 'document.pdf', contentType: 'application/pdf' }
 */
export async function convertMediaToAttachment(
  medplum: MedplumClient,
  media: Media
): Promise<{
  file: Buffer;
  filename: string;
  contentType: string;
} | null> {
  try {
    // Fetch Binary resource from media.content.url
    const binary = await getBinaryFromMedia(medplum, media);
    
    if (!binary) {
      console.error('[convertMediaToAttachment] Failed to fetch Binary resource for Media:', media.id);
      return null;
    }

    // Extract file data - Binary.data is base64-encoded
    let file: Buffer;
    if (binary.data) {
      // If data is embedded in the Binary resource as base64
      file = Buffer.from(binary.data, 'base64');
    } else {
      // If Binary is stored externally, we need to fetch it via URL
      // This is handled by getBinaryFromMedia
      console.error('[convertMediaToAttachment] Binary resource has no data:', binary.id);
      return null;
    }

    // Return in VintaSend NotificationAttachmentUpload format
    return {
      file,
      filename: media.content?.title || 'attachment',
      contentType: media.content?.contentType || 'application/octet-stream',
    };
  } catch (error) {
    console.error('[convertMediaToAttachment] Error converting Media to attachment:', error);
    return null;
  }
}
```

**How it works:**

1. **Fetch Binary**: Retrieves the Binary resource from the Media reference
2. **Extract Content**: Decodes the base64-encoded file data into a Buffer
3. **Format for VintaSend**: Returns a `NotificationAttachmentUpload` object with `file`, `filename`, and `contentType`
4. **Error Handling**: Returns `null` if conversion fails (which we filter out later)

Also update the `TaskAssignmentContextGenerator` to accept and return `attachmentCount`:

```typescript
class TaskAssignmentContextGenerator implements ContextGenerator {
  async generate({
    userId,
    taskTitle,
    taskDescription,
    taskIsUrgent,
    taskLink,
    requesterName,
    attachmentCount,
  }: {
    userId: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    requesterName: string;
    attachmentCount?: number;
  }): Promise<{
    firstName: string;
    taskTitle: string;
    taskDescription: string;
    taskIsUrgent: boolean;
    taskLink: string;
    requesterName: string;
    attachmentCount: number;
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
      attachmentCount: attachmentCount || 0,
    };
  }
}
```

#### 5.2: Update Task Assignment Email Service

Now let's update the task assignment email service to retrieve attachments from tasks and include them in the email notification.

Update [bots/services/emails/send-task-assignment-email.ts](bots/services/emails/send-task-assignment-email.ts):

```typescript
import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { MedplumSingleton } from '../../../lib/medplum-singleton';
import { getNotificationService, SendGridConfig, convertMediaToAttachment } from '../../../lib/notification-service';
import { formatPatientNameWithPreferredName } from '../../../lib/patients';
import { getTaskAttachments } from '../../../lib/file-upload';
```

Then update the notification creation logic to include attachments:

```typescript
// Retrieve task attachments
const taskAttachments = await getTaskAttachments(medplum, task);

console.log(`[sendTaskAssignmentEmail] Found ${taskAttachments.length} attachments for task ${task.id}`);

// Convert to VintaSend attachment format
const attachmentPromises = taskAttachments.map((media) => convertMediaToAttachment(medplum, media));
const attachmentResults = await Promise.all(attachmentPromises);

// Filter out null values (failed conversions)
const attachments = attachmentResults.filter((attachment): attachment is NonNullable<typeof attachment> => 
  attachment !== null
);

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
    attachmentCount: attachments.length, // NEW: Pass attachment count to template
  },
  sendAfter: new Date(),
  bodyTemplate: 'emails/task-assignment/body.html.pug',
  subjectTemplate: 'emails/task-assignment/subject.txt.pug',
  attachments, // NEW: Add attachments to the notification
  extraParams: {},
});
```

**Key changes:**

1. **Retrieve Attachments**: Use `getTaskAttachments` to get all Media resources from `task.input`
2. **Convert to VintaSend Format**: Map each Media to an attachment object with `convertMediaToAttachment`
3. **Filter Failures**: Remove any null results from failed conversions
4. **Pass to VintaSend**: Include `attachments` array and `attachmentCount` in notification
5. **Logging**: Added console logs for debugging attachment processing

#### 5.3: Update Email Template

Finally, let's update the email template to inform users when attachments are included.

Update [notification-templates/emails/task-assignment/body.html.pug](notification-templates/emails/task-assignment/body.html.pug):

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
    
    if attachmentCount > 0
      p
        strong Attachments:
        |  #{attachmentCount} file(s) attached
      p Files are attached to this email for your reference.
    
    if taskIsUrgent
      p
        strong URGENT

    p
      a(href=taskLink) View Task

    p Please review the task details and take appropriate action.
```

**Template changes:**

- **Conditional Display**: Only show attachment info when `attachmentCount > 0`
- **Count Display**: Shows how many files are attached
- **User Guidance**: Informs users that files are attached to the email

### How It Works: The Complete Email Attachment Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Task created with attachments via UI                    │
│    - Files stored as Binary resources                       │
│    - Media resources reference Binaries                     │
│    - Task.input array contains Media references             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Task assignment bot triggered                           │
│    - Bot detects task.owner assignment                      │
│    - Calls sendTaskAssignmentEmail()                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Retrieve attachments from task                          │
│    - getTaskAttachments() filters task.input               │
│    - Fetches all Media resources with type 'attachment'     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Convert Media to VintaSend attachment format            │
│    - convertMediaToAttachment() for each Media              │
│    - Fetches Binary resource and extracts file data         │
│    - Converts base64 to Buffer                              │
│    - Returns { filename, content, contentType }             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. VintaSend processes attachments                         │
│    - MedplumAttachmentManager handles deduplication         │
│    - Stores attachments as Binary resources (if not exists) │
│    - Links to Communication resource                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Email adapter attaches files                            │
│    - SendGrid adapter receives attachment data              │
│    - Converts to SendGrid attachment format                 │
│    - Includes in email payload                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Email sent with attachments                             │
│    - Recipient receives email with files attached           │
│    - Template shows attachment count                        │
│    - Files ready to download from email                     │
└─────────────────────────────────────────────────────────────┘
```

### Testing Email Attachments

After recompiling your templates and deploying your bots, test the attachment functionality:

1. **Compile templates:**
   ```bash
   npm run compile-templates
   ```

2. **Deploy bots:**
   ```bash
   npm run bots:deploy
   ```

3. **Create a task with attachments:**
   - Upload a PDF file when creating a task
   - Assign the task to a practitioner
   - Check the practitioner's email

4. **Verify the email:**
   - Email should show "1 file(s) attached"
   - Email should have the PDF attached
   - Attachment should be downloadable

5. **Test multiple attachments:**
   - Upload 2-3 files to a task
   - Verify all files are attached to the email

6. **Test without attachments:**
   - Create a task without files
   - Email should not mention attachments
   - Email should send normally

### Benefits of This Approach

**✅ FHIR-Compliant Storage**
- All files stored as proper FHIR Binary/Media resources
- Full audit trail through FHIR resource history
- Compatible with existing Medplum security and access controls

**✅ Automatic Deduplication**
- VintaSend's MedplumAttachmentManager prevents duplicate storage
- Same file attached to multiple emails only stored once
- Uses checksums to identify identical files

**✅ Provider-Agnostic**
- Attachment handling abstracted from email provider
- Easy to switch from SendGrid to AWS SES or other providers
- No provider-specific code in your application logic

**✅ Type-Safe Implementation**
- TypeScript ensures correct file handling
- Compile-time checks for attachment structure
- IDE autocomplete for attachment properties

**✅ Robust Error Handling**
- Failed attachment conversions don't break email sending
- Logging at each step for debugging
- Graceful degradation (email sends without failed attachments)

### Common Issues and Solutions

**Issue: Attachments not appearing in emails**

Solution: Check the logs for attachment conversion errors. Common causes:
- Binary resource not found (invalid Media reference)
- Binary has no data field (external storage not configured)
- File conversion failed (corrupt file or unsupported format)

**Issue: Email fails to send with large attachments**

Solution: SendGrid has a 30MB total attachment limit per email:
- Reduce MAX_ATTACHMENT_SIZE to prevent individual files being too large
- Consider adding validation for total attachment size
- For large files, include download links instead of attaching

**Issue: Attachment filename shows as "attachment"**

Solution: Ensure Media.content.title is set during upload:
```typescript
const media = await medplum.createResource<Media>({
  resourceType: 'Media',
  status: 'completed',
  content: {
    contentType,
    url: `Binary/${binary.id}`,
    title: filename, // ← Make sure this is set
  },
});
```

### Summary

Phase 3 complete! You now have:
- ✅ Attachment conversion from FHIR Media/Binary to VintaSend format
- ✅ Automatic attachment retrieval for task assignments
- ✅ Email templates showing attachment information
- ✅ End-to-end file attachment workflow

Files are now automatically attached to task assignment emails, providing recipients with all necessary context and documentation directly in their inbox.

---

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

Create [bots/services/emails/schedule-task-due-soon-email.ts](bots/services/emails/schedule-task-due-soon-email.ts):

```typescript
import { MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { MedplumSingleton } from '../../../lib/medplum-singleton';
import { getNotificationService, SendGridConfig } from '../../../lib/notification-service';
import {
  assertTaskOwnerReference,
  getValidTaskDueDate,
  parseOwnerReference,
  computeReminderTime,
} from '../../shared/task-due-soon-helpers';

export async function scheduleTaskDueSoonEmail(
  medplum: MedplumClient,
  task: Task,
  taskLinkBaseUrl: string,
  sendgridConfig: SendGridConfig
) {
  /* sends a task due soon reminder email to a practitioner 24 hours before the task is due */

  const ownerRef = assertTaskOwnerReference(task);
  const parsedOwner = parseOwnerReference(ownerRef);
  if (!parsedOwner) {
    return;
  }

  const dueDate = getValidTaskDueDate(task);

  if (!task.id) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Task has no id');
    throw new Error('Task must have an id to send task due soon email');
  }

  const sendAfter = computeReminderTime(dueDate, 24);
  if (!sendAfter) {
    return;
  }

  MedplumSingleton.setInstance(medplum);
  const vintasend = getNotificationService(medplum, sendgridConfig);

  const taskTitle = task.code?.text || task.description || 'Task';
  const taskLink = `${taskLinkBaseUrl}/Task/${task.id}`;
  const taskIsUrgent = task.priority === 'urgent';
  const formattedDueDate = dueDate.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  try {
    await vintasend.createNotification({
      userId: ownerRef,
      notificationType: 'EMAIL' as const,
      title: 'Task Due Soon Reminder',
      contextName: 'taskDueSoon' as const,
      contextParameters: {
        userId: ownerRef,
        taskTitle,
        taskDescription: task.description || '',
        taskIsUrgent,
        taskLink,
        dueDate: formattedDueDate,
      },
      sendAfter,
      bodyTemplate: 'emails/task-due-soon/body.html.pug',
      subjectTemplate: 'emails/task-due-soon/subject.txt.pug',
      extraParams: {},
    });

    // eslint-disable-next-line no-console
    console.log(
      `[scheduleTaskDueSoonEmail] Email scheduled for ${sendAfter.toISOString()} to: ${ownerRef} for task due on ${dueDate.toISOString()}`
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[scheduleTaskDueSoonEmail] Error creating/sending notification:', error);
    throw error;
  }
}
```

**Key Points:**
- Uses helper functions from `task-due-soon-helpers.ts` for validation and date calculations
- `assertTaskOwnerReference` validates and returns the owner reference
- `parseOwnerReference` validates the reference format and filters out Group assignments
- `getValidTaskDueDate` validates the due date and returns a Date object
- `computeReminderTime` calculates when to send the reminder (24 hours before) and validates it's in the future
- The `sendAfter` parameter tells VintaSend when to send the notification
- The notification is stored with status `pending` until `sendAfter` time
- Context is fetched at send-time, not when scheduled

### Step 4: Create the Subscription Bot for Task Due Soon

Create [bots/handlers/task-due-soon-notification-bot.ts](bots/handlers/task-due-soon-notification-bot.ts):

```typescript
import { BotEvent, MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { scheduleTaskDueSoonEmail } from '../services/emails/schedule-task-due-soon-email';
import { buildSendGridConfig } from '../../lib/notification-service';
import { getTaskDueSoonSchedulingReason } from '../shared/task-due-soon-helpers';

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
  const result = getTaskDueSoonSchedulingReason(task);

  switch (result.kind) {
    case 'invalidResource':
      console.warn('[TaskDueSoonNotificationBot] Invalid task resource received');
      return { message: 'Invalid task resource' };
    case 'noDueDate':
      console.log(`[TaskDueSoonNotificationBot] Task ${task?.id} has no due date, skipping`);
      return { message: 'No due date set', taskId: task?.id };
    case 'invalidDueDate':
      console.warn(
        `[TaskDueSoonNotificationBot] Task ${task?.id} has invalid due date: ${result.dueDate}, skipping`
      );
      return { message: 'Invalid due date', taskId: task?.id, dueDate: result.dueDate };
    case 'finalState':
      console.log(
        `[TaskDueSoonNotificationBot] Task ${task?.id} is in final state (${result.status}), skipping`
      );
      return { message: `Task in final state: ${result.status}`, taskId: task?.id };
    case 'noOwner':
      console.log(`[TaskDueSoonNotificationBot] Task ${task?.id} has no owner, skipping`);
      return { message: 'No owner assigned', taskId: task?.id };
    case 'tooSoon':
      console.log(
        `[TaskDueSoonNotificationBot] Task ${task?.id} is due in ${result.hoursUntilDue.toFixed(
          2
        )} hours (less than 24), skipping`
      );
      return {
        message: 'Due date is less than 24 hours away',
        taskId: task?.id,
        hoursUntilDue: result.hoursUntilDue,
      };
    case 'ok':
      break;
  }

  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    console.error('[TaskDueSoonNotificationBot] APP_BASE_URL environment variable is not set');
    throw new Error('APP_BASE_URL must be configured');
  }

  const sendgridConfig = buildSendGridConfig(event);

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
      `[TaskDueSoonNotificationBot] Scheduling notification for task ${task.id}, due in ${hoursUntilDue.toFixed(
        2
      )} hours`
    );
    await scheduleTaskDueSoonEmail(medplum, task, appBaseUrl, sendgridConfig);

    return {
      message: 'Notification scheduled successfully',
      taskId: task.id,
      dueDate: task.restriction?.period?.end,
      hoursUntilDue: result.hoursUntilDue.toFixed(2),
    };
  } catch (error) {
    console.error(`[TaskDueSoonNotificationBot] Error scheduling notification for task ${task.id}:`, error);
    throw error;
  }
}
```

**Key Differences from Task Assignment Bot:**
- **Uses Helper Function**: Uses `getTaskDueSoonSchedulingReason` to consolidate validation logic
- **Structured Validation**: All validation checks return specific error kinds via discriminated union
- **Invalid Date Handling**: Detects and skips tasks with invalid due dates
- **Required Configuration**: Throws if `APP_BASE_URL` is not configured (fails fast)
- **Scheduling**: Uses `sendAfter` to schedule the notification for 24 hours before due date

### Step 5: Create the Send Pending Notifications Bot

VintaSend stores scheduled notifications with a `pending` status. We need a periodic bot to actually send them when their `sendAfter` time arrives.

Create [bots/handlers/send-pending-notifications-bot.ts](bots/handlers/send-pending-notifications-bot.ts):

```typescript
import { BotEvent, MedplumClient } from '@medplum/core';
import { MedplumSingleton } from '../../lib/medplum-singleton';
import { getNotificationService, buildSendGridConfig } from '../../lib/notification-service';

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
  
  const sendgridConfig = buildSendGridConfig(event);

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
    name: 'task-due-notification-bot',
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

1. **Task Created/Updated with Due Date**
   - A Task is created or updated with `restriction.period.end` set to a future date
   - Task is assigned to a practitioner via `owner` reference
   - The subscription criteria `Task?owner:missing=false` matches this event

2. **Subscription Triggers Bot**
   - Medplum evaluates the subscription and triggers `task-due-notification-bot`
   - The bot receives the Task resource as `event.input`

3. **Validation**
   - Bot checks if task has a due date, owner, and is not in a final state
   - Calculates hours until due date
   - Only proceeds if task is due more than 24 hours from now

4. **Notification Scheduled**
   - Bot calls `scheduleTaskDueSoonEmail()`
   - `scheduleTaskDueSoonEmail()` calls `vintasend.createNotification()`
   - VintaSend creates a FHIR `Communication` resource with:
     - Status: `pending`
     - `sendAfter`: Set to 24 hours before task due date
     - Context parameters stored in the Communication resource

5. **Waiting Period**
   - Notification sits in the database with `pending` status
   - Task details, user data, etc. can change during this time

6. **Send Time Arrives**
   - `send-pending-notifications-bot` runs every 5 minutes via cron
   - Calls `vintasend.sendPendingNotifications()`
   - VintaSend finds all notifications where `sendAfter <= now` and status is `pending`

7. **Context Generation (Fresh Data!)**
   - For each pending notification, VintaSend calls the context generator
   - `TaskDueSoonContextGenerator.generate()` fetches current user data
   - If the user's name changed since scheduling, the new name is used
   - This ensures all data in the email is current

8. **Template Rendering**
   - Pug templates are rendered with fresh context
   - Email HTML and subject are generated

9. **Email Sent**
   - SendGrid adapter sends the email
   - `Communication` resource status updated to `sent`
   - Timestamp recorded in `sent` field

10. **Error Handling**
    - If sending fails, status is set to `failed`
    - Error details stored in the Communication resource
    - Failed notifications remain in the database for manual review or retry

### Benefits of This Approach

✅ **Always Current Data**: Context fetched at send-time, not schedule-time  
✅ **Event-Driven**: Notifications scheduled immediately when tasks are created/updated  
✅ **Efficient**: Only processes relevant tasks via subscription criteria, no unnecessary searches  
✅ **Scheduled Delivery**: Emails sent within 5 minutes of scheduled time (based on cron frequency)  
✅ **Audit Trail**: Every notification stored as a FHIR `Communication` resource  
✅ **Status Tracking**: Monitor pending, sent, and failed notifications  
✅ **Scalable**: Works with any number of scheduled notifications  
✅ **Flexible**: Easy to add more notification types (appointment reminders, etc.)  
✅ **No Duplicate Notifications**: Each task triggers the bot once per create/update event  

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
