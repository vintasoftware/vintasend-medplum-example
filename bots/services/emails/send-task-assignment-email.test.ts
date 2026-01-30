// @ts-nocheck - MockClient type compatibility with MedplumClient
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockClient } from '@medplum/mock';
import type { Task, Media, Binary, Practitioner } from '@medplum/fhirtypes';
import { sendTaskAssignmentEmail } from './send-task-assignment-email';
import type { SendGridConfig } from '../../../lib/notification-service';

// Mock the notification service
vi.mock('../../../lib/notification-service', async () => {
  const actual = await vi.importActual('../../../lib/notification-service');
  return {
    ...actual,
    getNotificationService: vi.fn(() => ({
      createNotification: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

// Mock the MedplumSingleton
vi.mock('../../../lib/medplum-singleton', () => ({
  MedplumSingleton: {
    setInstance: vi.fn(),
    getInstance: vi.fn(),
  },
}));

describe('sendTaskAssignmentEmail with Attachments', () => {
  let medplum: MockClient;
  let sendgridConfig: SendGridConfig;
  const taskLinkBaseUrl = 'https://example.com';

  beforeEach(() => {
    medplum = new MockClient();
    sendgridConfig = {
      SENDGRID_API_KEY: 'test-api-key',
      SENDGRID_FROM_EMAIL: 'noreply@example.com',
      SENDGRID_FROM_NAME: 'Test App',
    };
    vi.clearAllMocks();
  });

  it('should send email with single attachment', async () => {
    // Create a practitioner
    const practitioner = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ given: ['John'], family: 'Doe' }],
    });

    // Create a binary resource
    const binary = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'application/pdf',
      data: Buffer.from('test pdf content').toString('base64'),
    });

    // Create a media resource
    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'application/pdf',
        url: `Binary/${binary.id}`,
        title: 'test-document.pdf',
      },
    });

    // Create a task with attachment
    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      description: 'Test task with attachment',
      code: { text: 'Review Document' },
      owner: { reference: `Practitioner/${practitioner.id}` },
      priority: 'routine',
      input: [
        {
          type: {
            coding: [
              {
                system: 'http://your-app-url.com/task-input-types',
                code: 'attachment',
                display: 'File Attachment',
              },
            ],
          },
          valueReference: { reference: `Media/${media.id}` },
        },
      ],
    });

    const { getNotificationService } = await import('../../../lib/notification-service');
    const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
    (getNotificationService as any).mockReturnValue({
      createNotification: mockCreateNotification,
    });

    await sendTaskAssignmentEmail(medplum, task, taskLinkBaseUrl, sendgridConfig);

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateNotification.mock.calls[0][0];

    expect(callArgs.contextParameters.attachmentCount).toBe(1);
    expect(callArgs.attachments).toBeDefined();
    expect(callArgs.attachments.length).toBe(1);
    expect(callArgs.attachments[0].filename).toBe('test-document.pdf');
    expect(callArgs.attachments[0].contentType).toBe('application/pdf');
    expect(callArgs.attachments[0].file).toBeInstanceOf(Buffer);
  });

  it('should send email with multiple attachments', async () => {
    const practitioner = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ given: ['Jane'], family: 'Smith' }],
    });

    // Create multiple binary resources
    const binary1 = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'application/pdf',
      data: Buffer.from('pdf content').toString('base64'),
    });

    const binary2 = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'image/jpeg',
      data: Buffer.from('jpeg content').toString('base64'),
    });

    // Create multiple media resources
    const media1 = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'application/pdf',
        url: `Binary/${binary1.id}`,
        title: 'document.pdf',
      },
    });

    const media2 = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'image/jpeg',
        url: `Binary/${binary2.id}`,
        title: 'image.jpg',
      },
    });

    // Create task with multiple attachments
    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      description: 'Task with multiple attachments',
      code: { text: 'Review Files' },
      owner: { reference: `Practitioner/${practitioner.id}` },
      input: [
        {
          type: {
            coding: [
              {
                system: 'http://your-app-url.com/task-input-types',
                code: 'attachment',
                display: 'File Attachment',
              },
            ],
          },
          valueReference: { reference: `Media/${media1.id}` },
        },
        {
          type: {
            coding: [
              {
                system: 'http://your-app-url.com/task-input-types',
                code: 'attachment',
                display: 'File Attachment',
              },
            ],
          },
          valueReference: { reference: `Media/${media2.id}` },
        },
      ],
    });

    const { getNotificationService } = await import('../../../lib/notification-service');
    const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
    (getNotificationService as any).mockReturnValue({
      createNotification: mockCreateNotification,
    });

    await sendTaskAssignmentEmail(medplum, task, taskLinkBaseUrl, sendgridConfig);

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateNotification.mock.calls[0][0];

    expect(callArgs.contextParameters.attachmentCount).toBe(2);
    expect(callArgs.attachments).toBeDefined();
    expect(callArgs.attachments.length).toBe(2);
    expect(callArgs.attachments[0].filename).toBe('document.pdf');
    expect(callArgs.attachments[1].filename).toBe('image.jpg');
  });

  it('should send email without attachments for task with no files', async () => {
    const practitioner = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ given: ['Bob'], family: 'Johnson' }],
    });

    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      description: 'Task without attachments',
      code: { text: 'Simple Task' },
      owner: { reference: `Practitioner/${practitioner.id}` },
    });

    const { getNotificationService } = await import('../../../lib/notification-service');
    const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
    (getNotificationService as any).mockReturnValue({
      createNotification: mockCreateNotification,
    });

    await sendTaskAssignmentEmail(medplum, task, taskLinkBaseUrl, sendgridConfig);

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateNotification.mock.calls[0][0];

    expect(callArgs.contextParameters.attachmentCount).toBe(0);
    expect(callArgs.attachments).toBeDefined();
    expect(callArgs.attachments.length).toBe(0);
  });

  it('should handle attachment conversion failures gracefully', async () => {
    const practitioner = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ given: ['Alice'], family: 'Williams' }],
    });

    // Create media resource with invalid binary reference
    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'application/pdf',
        url: 'Binary/nonexistent-binary-id',
        title: 'invalid.pdf',
      },
    });

    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      description: 'Task with invalid attachment',
      code: { text: 'Test Task' },
      owner: { reference: `Practitioner/${practitioner.id}` },
      input: [
        {
          type: {
            coding: [
              {
                system: 'http://your-app-url.com/task-input-types',
                code: 'attachment',
                display: 'File Attachment',
              },
            ],
          },
          valueReference: { reference: `Media/${media.id}` },
        },
      ],
    });

    const { getNotificationService } = await import('../../../lib/notification-service');
    const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
    (getNotificationService as any).mockReturnValue({
      createNotification: mockCreateNotification,
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await sendTaskAssignmentEmail(medplum, task, taskLinkBaseUrl, sendgridConfig);

    // Email should still be sent, just without the failed attachment
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateNotification.mock.calls[0][0];

    expect(callArgs.contextParameters.attachmentCount).toBe(0);
    expect(callArgs.attachments.length).toBe(0);

    consoleErrorSpy.mockRestore();
  });

  it('should skip email for tasks assigned to groups', async () => {
    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      description: 'Task assigned to group',
      code: { text: 'Group Task' },
      owner: { reference: 'Group/test-group-123' },
    });

    const { getNotificationService } = await import('../../../lib/notification-service');
    const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
    (getNotificationService as any).mockReturnValue({
      createNotification: mockCreateNotification,
    });

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await sendTaskAssignmentEmail(medplum, task, taskLinkBaseUrl, sendgridConfig);

    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[sendTaskAssignmentEmail] Task assigned to Group, skipping email notification'
    );

    consoleLogSpy.mockRestore();
  });

  it('should handle urgent tasks with attachments', async () => {
    const practitioner = await medplum.createResource<Practitioner>({
      resourceType: 'Practitioner',
      name: [{ given: ['Charlie'], family: 'Brown' }],
    });

    const binary = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'application/pdf',
      data: Buffer.from('urgent document').toString('base64'),
    });

    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'application/pdf',
        url: `Binary/${binary.id}`,
        title: 'urgent.pdf',
      },
    });

    const task = await medplum.createResource<Task>({
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      description: 'Urgent task with attachment',
      code: { text: 'Urgent Review' },
      owner: { reference: `Practitioner/${practitioner.id}` },
      priority: 'urgent',
      input: [
        {
          type: {
            coding: [
              {
                system: 'http://your-app-url.com/task-input-types',
                code: 'attachment',
                display: 'File Attachment',
              },
            ],
          },
          valueReference: { reference: `Media/${media.id}` },
        },
      ],
    });

    const { getNotificationService } = await import('../../../lib/notification-service');
    const mockCreateNotification = vi.fn().mockResolvedValue(undefined);
    (getNotificationService as any).mockReturnValue({
      createNotification: mockCreateNotification,
    });

    await sendTaskAssignmentEmail(medplum, task, taskLinkBaseUrl, sendgridConfig);

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateNotification.mock.calls[0][0];

    expect(callArgs.contextParameters.taskIsUrgent).toBe(true);
    expect(callArgs.contextParameters.attachmentCount).toBe(1);
    expect(callArgs.attachments.length).toBe(1);
  });
});
