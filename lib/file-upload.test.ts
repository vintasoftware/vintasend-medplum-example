// @ts-nocheck - MockClient type compatibility with MedplumClient
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockClient } from '@medplum/mock';
import type { MedplumClient } from '@medplum/core';
import type { Binary, Media, Task } from '@medplum/fhirtypes';
import {
  uploadFileToMedplum,
  attachFileToTask,
  getTaskAttachments,
  getBinaryFromMedia,
} from './file-upload';

describe('File Upload Utilities', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
  });

  // Note: MockClient is compatible at runtime
  const asMedplum = (): MedplumClient => medplum as unknown as MedplumClient;

  describe('uploadFileToMedplum', () => {
    it('should upload file and create Binary/Media resources', async () => {
      const fileContent = Buffer.from('test file content');
      const filename = 'test.pdf';
      const contentType = 'application/pdf';

      const result = await uploadFileToMedplum(medplum as unknown as MedplumClient, fileContent, filename, contentType);

      expect(result).toBeDefined();
      expect(result.binary).toBeDefined();
      expect(result.media).toBeDefined();
      expect(result.media.resourceType).toBe('Media');
      expect(result.media.status).toBe('completed');
      expect(result.media.content?.contentType).toBe(contentType);
      expect(result.media.content?.title).toBe(filename);
      expect(result.media.content?.url).toContain('Binary/');
    });

    it('should handle different file types', async () => {
      const testCases = [
        { filename: 'image.jpg', contentType: 'image/jpeg' },
        { filename: 'document.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { filename: 'spreadsheet.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      ];

      for (const { filename, contentType } of testCases) {
        const fileContent = Buffer.from(`content of ${filename}`);
        const result = await uploadFileToMedplum(medplum as unknown as MedplumClient, fileContent, filename, contentType);

        expect(result.media.content?.contentType).toBe(contentType);
        expect(result.media.content?.title).toBe(filename);
      }
    });
  });

  describe('attachFileToTask', () => {
    it('should attach media to task', async () => {
      // Create a test task
      const task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: 'Test task',
      });

      // Create a test media resource
      const media = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: 'application/pdf',
          url: 'Binary/test-123',
          title: 'test.pdf',
        },
      });

      const mediaReference = { reference: `Media/${media.id}` };
      const updatedTask = await attachFileToTask(medplum as unknown as MedplumClient, task, mediaReference);

      expect(updatedTask.input).toBeDefined();
      expect(updatedTask.input?.length).toBe(1);
      expect(updatedTask.input?.[0].type?.coding?.[0]?.code).toBe('attachment');
      expect(updatedTask.input?.[0].valueReference?.reference).toBe(mediaReference.reference);
    });

    it('should preserve existing task inputs when adding attachment', async () => {
      // Create a task with existing input
      const task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: 'Test task',
        input: [
          {
            type: { text: 'Other Input' },
            valueString: 'existing value',
          },
        ],
      });

      const media = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: 'application/pdf',
          url: 'Binary/test-456',
          title: 'test2.pdf',
        },
      });

      const mediaReference = { reference: `Media/${media.id}` };
      const updatedTask = await attachFileToTask(medplum as unknown as MedplumClient, task, mediaReference);

      expect(updatedTask.input?.length).toBe(2);
      expect(updatedTask.input?.[0].valueString).toBe('existing value');
      expect(updatedTask.input?.[1].valueReference?.reference).toBe(mediaReference.reference);
    });

    it('should handle task without existing inputs', async () => {
      const task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: 'Test task without inputs',
      });

      const media = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: 'image/jpeg',
          url: 'Binary/test-789',
          title: 'image.jpg',
        },
      });

      const mediaReference = { reference: `Media/${media.id}` };
      const updatedTask = await attachFileToTask(medplum as unknown as MedplumClient, task, mediaReference);

      expect(updatedTask.input).toBeDefined();
      expect(updatedTask.input?.length).toBe(1);
    });
  });

  describe('getTaskAttachments', () => {
    it('should retrieve all Media resources attached to a task', async () => {
      // Create multiple media resources
      const media1 = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: 'application/pdf',
          url: 'Binary/doc1',
          title: 'document1.pdf',
        },
      });

      const media2 = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: 'image/jpeg',
          url: 'Binary/img1',
          title: 'image1.jpg',
        },
      });

      // Create task with attachments
      const task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: 'Test task with attachments',
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

      const attachments = await getTaskAttachments(medplum as unknown as MedplumClient, task);

      expect(attachments).toBeDefined();
      expect(attachments.length).toBe(2);
      expect(attachments[0].id).toBe(media1.id);
      expect(attachments[1].id).toBe(media2.id);
    });

    it('should return empty array for task with no inputs', async () => {
      const task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: 'Task without inputs',
      });

      const attachments = await getTaskAttachments(medplum as unknown as MedplumClient, task);

      expect(attachments).toBeDefined();
      expect(attachments.length).toBe(0);
    });

    it('should filter out non-attachment inputs', async () => {
      const media = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: 'application/pdf',
          url: 'Binary/doc2',
          title: 'document2.pdf',
        },
      });

      const task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: 'Test task with mixed inputs',
        input: [
          {
            type: { text: 'Other Input' },
            valueString: 'not an attachment',
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
            valueReference: { reference: `Media/${media.id}` },
          },
        ],
      });

      const attachments = await getTaskAttachments(medplum as unknown as MedplumClient, task);

      expect(attachments.length).toBe(1);
      expect(attachments[0].id).toBe(media.id);
    });

    it('should handle invalid media references gracefully', async () => {
      const task = await medplum.createResource<Task>({
        resourceType: 'Task',
        status: 'requested',
        intent: 'order',
        description: 'Task with invalid reference',
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
            valueReference: { reference: 'Media/nonexistent-id' },
          },
        ],
      });

      // Mock console.error to prevent test output pollution
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const attachments = await getTaskAttachments(medplum as unknown as MedplumClient, task);

      // Should filter out failed fetches
      expect(attachments.length).toBe(0);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('getBinaryFromMedia', () => {
    it('should fetch Binary resource from Media reference', async () => {
      const binary = await medplum.createResource<Binary>({
        resourceType: 'Binary',
        contentType: 'application/pdf',
        data: Buffer.from('test binary content').toString('base64'),
      });

      const media = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: 'application/pdf',
          url: `Binary/${binary.id}`,
          title: 'test.pdf',
        },
      });

      const result = await getBinaryFromMedia(medplum as unknown as MedplumClient, media);

      expect(result).toBeDefined();
      expect(result?.id).toBe(binary.id);
      expect(result?.contentType).toBe('application/pdf');
    });

    it('should return null for media without content URL', async () => {
      const media = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {} as any,
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await getBinaryFromMedia(medplum as unknown as MedplumClient, media);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[getBinaryFromMedia] Media resource has no content URL'
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle invalid Binary reference format', async () => {
      const media = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: 'application/pdf',
          url: 'InvalidFormat',
          title: 'test.pdf',
        },
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await getBinaryFromMedia(medplum as unknown as MedplumClient, media);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should handle non-existent Binary resource', async () => {
      const media = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: 'application/pdf',
          url: 'Binary/nonexistent-binary-id',
          title: 'test.pdf',
        },
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await getBinaryFromMedia(medplum as unknown as MedplumClient, media);

      expect(result).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
