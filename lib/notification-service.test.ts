// @ts-nocheck - MockClient type compatibility with MedplumClient
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockClient } from '@medplum/mock';
import type { Binary, Media } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import { getBinaryFromMedia } from './file-upload';

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
async function convertMediaToAttachment(
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

describe('convertMediaToAttachment', () => {
  let medplum: MockClient;

  beforeEach(() => {
    medplum = new MockClient();
  });

  it('should convert Media resource to VintaSend attachment format', async () => {
    // Create a binary resource with base64 data
    const binaryContent = Buffer.from('test file content');
    const binary = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'application/pdf',
      data: binaryContent.toString('base64'),
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

    const result = await convertMediaToAttachment(medplum, media);

    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    expect(result?.filename).toBe('test-document.pdf');
    expect(result?.contentType).toBe('application/pdf');
    expect(result?.file).toBeInstanceOf(Buffer);
    expect(result?.file.toString()).toBe('test file content');
  });

  it('should handle different file types correctly', async () => {
    const testCases = [
      {
        contentType: 'image/jpeg',
        filename: 'photo.jpg',
        content: 'jpeg image data',
      },
      {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filename: 'document.docx',
        content: 'word document data',
      },
      {
        contentType: 'text/plain',
        filename: 'notes.txt',
        content: 'plain text content',
      },
    ];

    for (const testCase of testCases) {
      const binary = await medplum.createResource<Binary>({
        resourceType: 'Binary',
        contentType: testCase.contentType,
        data: Buffer.from(testCase.content).toString('base64'),
      });

      const media = await medplum.createResource<Media>({
        resourceType: 'Media',
        status: 'completed',
        content: {
          contentType: testCase.contentType,
          url: `Binary/${binary.id}`,
          title: testCase.filename,
        },
      });

      const result = await convertMediaToAttachment(medplum, media);

      expect(result?.filename).toBe(testCase.filename);
      expect(result?.contentType).toBe(testCase.contentType);
      expect(result?.file.toString()).toBe(testCase.content);
    }
  });

  it('should use default filename when Media has no title', async () => {
    const binary = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'application/pdf',
      data: Buffer.from('content').toString('base64'),
    });

    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'application/pdf',
        url: `Binary/${binary.id}`,
        // No title provided
      },
    });

    const result = await convertMediaToAttachment(medplum, media);

    expect(result?.filename).toBe('attachment');
  });

  it('should use default contentType when Media has no contentType', async () => {
    const binary = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'application/octet-stream',
      data: Buffer.from('content').toString('base64'),
    });

    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        url: `Binary/${binary.id}`,
        title: 'file.bin',
        // No contentType provided
      },
    });

    const result = await convertMediaToAttachment(medplum, media);

    expect(result?.contentType).toBe('application/octet-stream');
  });

  it('should return null when Binary resource cannot be fetched', async () => {
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

    const result = await convertMediaToAttachment(medplum, media);

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('should return null when Media has no content URL', async () => {
    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      // No content object
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await convertMediaToAttachment(medplum, media);

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[getBinaryFromMedia] Media resource has no content URL'
    );

    consoleErrorSpy.mockRestore();
  });

  it('should return null when Binary has no data field', async () => {
    const binary = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'application/pdf',
      // No data field
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

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await convertMediaToAttachment(medplum, media);

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[convertMediaToAttachment] Binary resource has no data:',
      binary.id
    );

    consoleErrorSpy.mockRestore();
  });

  it('should handle base64 decoding correctly', async () => {
    const originalContent = 'Hello, World! This is a test file with special characters: @#$%^&*()';
    const binary = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'text/plain',
      data: Buffer.from(originalContent).toString('base64'),
    });

    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'text/plain',
        url: `Binary/${binary.id}`,
        title: 'test.txt',
      },
    });

    const result = await convertMediaToAttachment(medplum, media);

    expect(result?.file.toString()).toBe(originalContent);
  });

  it('should handle large files', async () => {
    // Create a 1MB file
    const largeContent = Buffer.alloc(1024 * 1024, 'a');
    const binary = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'application/octet-stream',
      data: largeContent.toString('base64'),
    });

    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'application/octet-stream',
        url: `Binary/${binary.id}`,
        title: 'large-file.bin',
      },
    });

    const result = await convertMediaToAttachment(medplum, media);

    expect(result).toBeDefined();
    expect(result?.file.length).toBe(1024 * 1024);
  });

  it('should handle binary content with special characters in filename', async () => {
    const binary = await medplum.createResource<Binary>({
      resourceType: 'Binary',
      contentType: 'application/pdf',
      data: Buffer.from('content').toString('base64'),
    });

    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'application/pdf',
        url: `Binary/${binary.id}`,
        title: 'test document (v2) [final].pdf',
      },
    });

    const result = await convertMediaToAttachment(medplum, media);

    expect(result?.filename).toBe('test document (v2) [final].pdf');
  });

  it('should handle conversion errors gracefully', async () => {
    // Create media with invalid Binary URL format
    const media = await medplum.createResource<Media>({
      resourceType: 'Media',
      status: 'completed',
      content: {
        contentType: 'application/pdf',
        url: 'InvalidFormat/NoSlash',
        title: 'test.pdf',
      },
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await convertMediaToAttachment(medplum, media);

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
