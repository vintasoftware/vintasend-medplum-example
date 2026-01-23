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

**📧 Medplum Email Integration**
- Uses Medplum's built-in email API
- No additional email provider configuration needed
- Inherits Medplum's email delivery infrastructure

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
npm install vintasend vintasend-medplum
```

Update your [package.json](package.json):

```json
{
  "dependencies": {
    "vintasend": "^0.4.3",
    "vintasend-medplum": "^0.4.5"
  }
}
```

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
  MedplumNotificationAdapterFactory, 
  PugInlineEmailTemplateRendererFactory, 
  MedplumLogger 
} from 'vintasend-medplum';

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
  const adapter = new MedplumNotificationAdapterFactory<NotificationTypeConfig>()
    .create(medplum, templateRenderer, false);
    
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
   - **Backend**: Stores notification data in Medplum
   - **Template Renderer**: Renders Pug templates
   - **Adapter**: Handles email sending through Medplum
   - **Logger**: Logs notification events
   - **Attachment Manager**: Handles file attachments (if needed)

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

## Step 10: Using the Service

To use this in your Medplum bot or application:

```typescript
import { BotEvent, MedplumClient } from '@medplum/core';
import { Task } from '@medplum/fhirtypes';
import { sendTaskAssignmentEmail } from './bots/services/emails/send-task-assignment-email';

export async function handler(medplum: MedplumClient, event: BotEvent): Promise<any> {
  const task = event.input as Task;
  
  // Send email when task is assigned
  if (task.owner?.reference) {
    await sendTaskAssignmentEmail(
      medplum, 
      task, 
      'https://your-app-url.com'
    );
  }
  
  return task;
}
```

## How It Works: The Full Flow

Let's trace through what happens when a task is assigned:

1. **Task Created**: A FHIR `Task` resource is created or updated with an `owner`
2. **Bot Triggered**: Your Medplum bot is triggered (via subscription or direct call)
3. **Service Called**: `sendTaskAssignmentEmail()` is invoked
4. **Validation**: The service validates the task has an owner and isn't assigned to a Group
5. **Data Enrichment**: 
   - Fetches the requester's name
   - Builds the task link
   - Determines if the task is urgent
6. **Notification Created**: VintaSend's `createNotification()` is called with:
   - User ID (the FHIR reference)
   - Context parameters (taskTitle, taskDescription, etc.)
   - Template paths
7. **Context Generation**: The `TaskAssignmentContextGenerator` runs:
   - Fetches the recipient's user record from Medplum
   - Extracts their first name (respecting preferred names)
   - Merges with the provided parameters
8. **Template Rendering**: Pug templates are rendered with the enriched context
9. **Email Sent**: The email is sent via Medplum's email adapter
10. **Notification Stored**: VintaSend stores the notification record in Medplum for auditing

## Benefits of This Approach

✅ **Type-Safe**: TypeScript ensures your context parameters match your templates  
✅ **Testable**: Each component can be tested in isolation  
✅ **Maintainable**: Templates are separate from logic  
✅ **Extensible**: Easy to add new notification types  
✅ **FHIR-Native**: Integrates seamlessly with Medplum's FHIR data model  
✅ **Auditable**: All notifications are stored as FHIR resources  

## Next Steps

Now that you have task assignment emails working, you can:

1. **Add More Notification Types**: Create context generators for appointment reminders, lab results, etc.
2. **Add SMS Support**: VintaSend supports multiple channels
3. **Customize Templates**: Add branding, better styling, or more dynamic content
4. **Add Preferences**: Let users opt-in/out of certain notifications
5. **Add Scheduling**: Use `sendAfter` to schedule reminder emails

## Troubleshooting

**Templates not compiling?**
- Ensure `vintasend-medplum` is installed
- Check that template paths match exactly

**Emails not sending?**
- Verify Medplum email configuration
- Check bot logs for errors
- Ensure the user has a valid email address in their FHIR resource

**Context data missing?**
- Verify the context generator is fetching data correctly
- Check that FHIR resources have the expected fields

## Conclusion

You now have a robust, production-ready email notification system for your Medplum application! This architecture scales well as you add more notification types and channels.

The combination of VintaSend and Medplum provides a powerful foundation for healthcare communications that respect FHIR standards while remaining developer-friendly.

## Resources

- [VintaSend Documentation](https://github.com/vintasoftware/vintasend)
- [VintaSend-Medplum Documentation](https://github.com/vintasoftware/vintasend-medplum)
- [Medplum Documentation](https://www.medplum.com/docs)
- [Medplum Bots](https://www.medplum.com/docs/bots)
- [FHIR Task Resource](https://www.hl7.org/fhir/task.html)
