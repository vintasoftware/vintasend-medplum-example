<h1 align="center">Medplum Provider with VintaSend Integration</h1>
<p align="center">A healthcare application demonstrating email notifications and file attachments using VintaSend and Medplum.</p>
<p align="center">
<a href="https://github.com/medplum/medplum-hello-world/blob/main/LICENSE.txt">
    <img src="https://img.shields.io/badge/license-Apache-blue.svg" />
  </a>
</p>

This application is based on [Medplum Provider](https://github.com/medplum/medplum-provider) and extends it with a comprehensive email notification system built using [VintaSend](https://github.com/vintasoftware/vintasend) and [VintaSend-Medplum](https://github.com/vintasoftware/vintasend-medplum).

## Key Features

### 🔔 Email Notifications with VintaSend

- **Automated Task Assignment Emails**: Practitioners receive email notifications when assigned tasks
- **Priority-Based Notifications**: Urgent tasks trigger special "URGENT" email subject lines
- **Personalized Content**: Emails include practitioner names, task details, and requester information
- **FHIR-Native Storage**: All notifications stored as FHIR `Communication` resources for full auditability
- **Flexible Email Providers**: Mailgun integration with easy adapter swapping

### 📎 File Attachment Management

- **FHIR-Compliant Storage**: Files stored as `Binary` and `Media` resources following FHIR standards
- **Automatic Deduplication**: Files with identical content stored once via checksum
- **Email Attachments**: Files attached to tasks are automatically included in notification emails
- **Type & Size Validation**: Support for PDFs, images, Office documents with configurable size limits
- **Download & Preview**: UI for managing file attachments on tasks

### 🏥 Healthcare Workflows

The application demonstrates the following core workflows:

- **Task Creation and Assignment** with email notifications and file attachments
- Visit documentation
- Appointment scheduling
- Patient registration/onboarding
- Lab orders
- Ordering medications
- Claim creation and billing
- Patient/Provider Messaging

### 🛠️ Technical Implementation

- [Medplum React Components](https://storybook.medplum.com/?path=/docs/medplum-introduction--docs) for healthcare UI
- [Medplum GraphQL](https://graphiql.medplum.com/) queries for linked resources
- [VintaSend](https://github.com/vintasoftware/vintasend) notification framework
- [VintaSend-Medplum](https://github.com/vintasoftware/vintasend-medplum) FHIR adapters
- Medplum Bots with FHIR Subscriptions for automated workflows
- Pug templates compiled to JSON for email rendering

### Getting Started

#### Prerequisites

- Node.js 18+ and npm installed
- A [Medplum project](https://www.medplum.com/docs/tutorials/register) to store your data
- A [Mailgun account](https://mailgun.com/) with API key for email delivery

#### Installation

[Fork](https://github.com/medplum/medplum-provider/fork) and clone the repo.

Install the dependencies:

```bash
npm install
```

#### Environment Configuration

Create a `.env` file in the root directory with the following variables:

```bash
# Medplum Configuration
MEDPLUM_BASE_URL=https://api.medplum.com
MEDPLUM_CLIENT_ID=your-client-id-here
MEDPLUM_CLIENT_SECRET=your-client-secret-here

# Mailgun Configuration
MAILGUN_API_KEY=your-mailgun-api-key-here
MAILGUN_DOMAIN=yourdomain.com
MAILGUN_FROM_EMAIL=noreply@yourdomain.com
MAILGUN_FROM_NAME=BYour App Namea

# Application Configuration
PROVIDER_APP_BASE_URL=https://your-app-url.com
```

> **Note**: Copy `.env.example` to `.env` and fill in your actual values. Never commit `.env` to version control.

#### Build and Deploy Bots

Compile notification templates and build bots:

```bash
npm run bots:build
```

Deploy bots to Medplum (creates bots and subscriptions):

```bash
npm run bots:deploy
```

#### Run the Application

Start the development server:

```bash
npm run dev
```

The app should run on `http://localhost:3000/`

### Project Structure

```
bots/
  task-assignment-bot.ts          # Main bot triggered by task assignments
  services/
    emails/
      send-task-assignment-email.ts  # Email notification service
lib/
  notification-service.ts          # VintaSend configuration
  file-upload.ts                   # File attachment utilities
  medplum-singleton.ts             # Shared Medplum client
  patients.ts                      # Name formatting helpers
notification-templates/
  emails/
    task-assignment/
      body.html.pug                # Email body template
      subject.txt.pug              # Email subject template
src/
  components/
    tasks/
      TaskFileUpload.tsx           # File upload component
      TaskAttachmentList.tsx       # Attachment list component
```

### How It Works

#### Task Assignment Workflow

1. **Task Created/Updated**: A practitioner is assigned to a FHIR `Task` resource
2. **Subscription Triggers**: Medplum subscription evaluates criteria (`Task?owner:exists=true`)
3. **Bot Executes**: Task assignment bot runs automatically
4. **Data Enrichment**: Service fetches practitioner details, task attachments, and requester info
5. **Email Sent**: VintaSend renders Pug templates and sends email via Mailgun
6. **Notification Stored**: Email record saved as FHIR `Communication` resource

#### File Attachment Workflow

1. **File Upload**: User uploads file via `TaskFileUpload` component
2. **FHIR Storage**: File stored as `Binary` resource, metadata as `Media` resource
3. **Task Association**: Media reference added to task's `input` array
4. **Email Inclusion**: Attachments automatically included in notification emails
5. **Deduplication**: Identical files (by checksum) stored only once

### Learn More

For a comprehensive tutorial on implementing email notifications and file attachments, see:
- [TUTORIAL_EMAIL_NOTIFICATIONS.md](TUTORIAL_EMAIL_NOTIFICATIONS.md) - Complete walkthrough with code examples

### About Medplum

[Medplum](https://www.medplum.com/) is an open-source, API-first EHR. Medplum makes it easy to build healthcare apps quickly with less code.

Medplum supports self-hosting and provides a [hosted service](https://app.medplum.com/).

- Read our [documentation](https://www.medplum.com/docs)
- Browse our [react component library](https://storybook.medplum.com/)
- Join our [Discord](https://discord.gg/medplum)

### About VintaSend

[VintaSend](https://github.com/vintasoftware/vintasend) is a flexible TypeScript notification framework designed for transactional notifications in modern applications.

**Key Benefits:**
- 📦 Database-backed notification management with full audit trail
- 📅 Smart scheduling with context fetched at send-time
- 📎 File attachment support with automatic deduplication
- 🔧 Modular architecture - swap databases, email providers, or template engines independently
- 🏥 Healthcare-ready with FHIR compliance via VintaSend-Medplum

Learn more:
- [VintaSend Documentation](https://github.com/vintasoftware/vintasend)
- [VintaSend-Medplum Adapters](https://github.com/vintasoftware/vintasend-medplum)

## License

Apache 2.0 - See [LICENSE](LICENSE.txt) for details.
