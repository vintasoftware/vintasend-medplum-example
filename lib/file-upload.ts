import { MedplumClient } from '@medplum/core';
import { Binary, Media, Reference, Task, TaskInput } from '@medplum/fhirtypes';

export interface FileUploadResult {
  binary: Binary;
  media: Media;
}

/**
 * Uploads a file to Medplum and creates both Binary and Media resources.
 *
 * The Binary resource stores the actual file content, while the Media resource
 * provides metadata and a reference to the Binary resource.
 *
 * @param medplum - The Medplum client instance
 * @param file - The file to upload (File from browser or Buffer from Node.js)
 * @param filename - The name of the file
 * @param contentType - The MIME type of the file (e.g., 'application/pdf', 'image/jpeg')
 * @returns An object containing both the Binary and Media resources
 *
 * @example
 * const result = await uploadFileToMedplum(
 *   medplum,
 *   fileFromInput,
 *   'document.pdf',
 *   'application/pdf'
 * );
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
  // Include the binaryId in identifiers so VintaSend can properly reconstruct the attachment
  const media = await medplum.createResource<Media>({
    resourceType: 'Media',
    status: 'completed',
    content: {
      contentType,
      url: `Binary/${binary.id}`,
      title: filename,
    },
    identifier: [
      {
        system: 'http://vintasend.com/fhir/binary-id',
        value: binary.id,
      },
    ],
  });

  return { binary, media };
}

/**
 * Attaches a Media resource to a Task by adding it to the task's input array.
 *
 * This function follows the FHIR Task resource specification, where attachments
 * are stored in the task.input array with a specific type code.
 *
 * @param medplum - The Medplum client instance
 * @param task - The Task resource to attach the file to
 * @param mediaReference - A reference to the Media resource (e.g., { reference: 'Media/123' })
 * @returns The updated Task resource with the attachment added
 *
 * @example
 * const updatedTask = await attachFileToTask(
 *   medplum,
 *   task,
 *   { reference: 'Media/abc-123' }
 * );
 */
export async function attachFileToTask(
  medplum: MedplumClient,
  task: Task,
  mediaReference: Reference<Media>
): Promise<Task> {
  // Initialize input array if it doesn't exist
  const currentInputs = task.input || [];

  // Create new input entry for the attachment
  const attachmentInput: TaskInput = {
    type: {
      coding: [
        {
          system: 'http://your-app-url.com/task-input-types',
          code: 'attachment',
          display: 'File Attachment',
        },
      ],
    },
    valueReference: mediaReference,
  };

  // Update the task with the new attachment
  const updatedTask = await medplum.updateResource<Task>({
    ...task,
    input: [...currentInputs, attachmentInput],
  });

  return updatedTask;
}

/**
 * Retrieves all Media resources attached to a Task.
 *
 * This function filters the task's input array for entries with the 'attachment' type
 * and fetches the corresponding Media resources.
 *
 * @param medplum - The Medplum client instance
 * @param task - The Task resource to get attachments from
 * @returns An array of Media resources attached to the task
 *
 * @example
 * const attachments = await getTaskAttachments(medplum, task);
 * console.log(`Task has ${attachments.length} attachments`);
 */
export async function getTaskAttachments(
  medplum: MedplumClient,
  task: Task
): Promise<Media[]> {
  // Return empty array if task has no inputs
  if (!task.input || task.input.length === 0) {
    return [];
  }

  // Filter inputs for attachment types
  const attachmentInputs = task.input.filter((input) => {
    const coding = input.type?.coding?.[0];
    return coding?.code === 'attachment' && input.valueReference?.reference;
  });

  // Fetch all Media resources
  const mediaPromises = attachmentInputs.map(async (input): Promise<Media | null> => {
    const reference = input.valueReference?.reference;
    if (!reference) {
      return null;
    }

    try {
      // Parse reference string (e.g., "Media/123")
      const [resourceType, id] = reference.split('/');
      if (resourceType !== 'Media' || !id) {
        console.error(`[getTaskAttachments] Invalid reference format: ${reference}`);
        return null;
      }

      return await medplum.readResource('Media', id);
    } catch (error) {
      console.error(`[getTaskAttachments] Failed to fetch Media resource: ${reference}`, error);
      return null;
    }
  });

  const mediaResources = await Promise.all(mediaPromises);

  // Filter out null values (failed fetches)
  return mediaResources.filter((media): media is Media => media !== null);
}

/**
 * Gets the Binary content from a Media resource.
 *
 * This utility function extracts the file data from the Binary resource
 * referenced by a Media resource.
 *
 * @param medplum - The Medplum client instance
 * @param media - The Media resource containing the reference to the Binary
 * @returns The Binary resource with file content
 *
 * @example
 * const binary = await getBinaryFromMedia(medplum, media);
 * console.log(`File size: ${binary.data?.length} bytes`);
 */
export async function getBinaryFromMedia(
  medplum: MedplumClient,
  media: Media
): Promise<Binary | null> {
  const binaryUrl = media.content?.url;
  if (!binaryUrl) {
    console.error('[getBinaryFromMedia] Media resource has no content URL');
    return null;
  }

  try {
    // Handle signed URLs (external storage) vs FHIR references
    if (binaryUrl.startsWith('http://') || binaryUrl.startsWith('https://')) {
      // For signed URLs, fetch content directly from the URL
      const response = await fetch(binaryUrl);
      if (!response.ok) {
        console.error(`[getBinaryFromMedia] Failed to fetch from signed URL: ${response.status} ${response.statusText}`);
        return null;
      }

      // Convert response to base64-encoded data
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const base64Data = buffer.toString('base64');

      // Extract Binary ID from URL for the resource ID
      const urlParts = binaryUrl.split('?')[0].split('/');
      const binaryId = urlParts[urlParts.length - 1];

      // Return a Binary-like object with the fetched data
      return {
        resourceType: 'Binary',
        id: binaryId,
        contentType: media.content?.contentType || 'application/octet-stream',
        data: base64Data,
      } as Binary;
    } else {
      // Parse FHIR reference (e.g., "Binary/123")
      const [resourceType, id] = binaryUrl.split('/');
      if (resourceType !== 'Binary' || !id) {
        console.error(`[getBinaryFromMedia] Invalid Binary reference: ${binaryUrl}`);
        return null;
      }

      return await medplum.readResource('Binary', id);
    }
  } catch (error) {
    console.error(`[getBinaryFromMedia] Failed to fetch Binary resource: ${binaryUrl}`, error);
    return null;
  }
}
