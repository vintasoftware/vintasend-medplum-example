import { useState, useCallback, useRef } from 'react';
import { useMedplum } from '@medplum/react';
import { Button, Group, Text, Alert, Progress } from '@mantine/core';
import { IconUpload, IconAlertCircle } from '@tabler/icons-react';
import type { JSX } from 'react';
import { uploadFileToMedplum } from '../../../lib/file-upload';
import { MAX_ATTACHMENT_SIZE, ALLOWED_FILE_TYPES } from '../../../lib/constants';
import type { Media } from '@medplum/fhirtypes';

export interface TaskFileUploadProps {
  onFileUploaded: (media: Media) => void;
  disabled?: boolean;
}

/**
 * Component for uploading files to attach to tasks.
 * Validates file type and size before uploading to Medplum.
 */
export function TaskFileUpload({ onFileUploaded, disabled = false }: TaskFileUploadProps): JSX.Element {
  const medplum = useMedplum();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const validateFile = (file: File): string | null => {
    // Check file size
    if (file.size > MAX_ATTACHMENT_SIZE) {
      const maxSizeMB = MAX_ATTACHMENT_SIZE / (1024 * 1024);
      return `File size exceeds maximum allowed size of ${maxSizeMB}MB`;
    }

    // Check file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return `File type "${file.type}" is not allowed. Allowed types: PDF, images, Word documents, Excel spreadsheets, text files.`;
    }

    return null;
  };

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);
      setUploading(true);
      setUploadProgress(0);

      try {
        // Simulate progress (in a real implementation, you might use XMLHttpRequest for actual progress)
        const progressInterval = setInterval(() => {
          setUploadProgress((prev) => Math.min(prev + 10, 90));
        }, 100);

        const { media } = await uploadFileToMedplum(medplum, file, file.name, file.type);

        clearInterval(progressInterval);
        setUploadProgress(100);

        // Call the callback with the uploaded media
        onFileUploaded(media);

        // Reset state after a short delay
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
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_FILE_TYPES.join(',')}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
      
      <Button
        leftSection={<IconUpload size={16} />}
        variant="light"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || uploading}
        loading={uploading}
        fullWidth
      >
        {uploading ? 'Uploading...' : 'Choose File to Attach'}
      </Button>

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
        Maximum file size: {MAX_ATTACHMENT_SIZE / (1024 * 1024)}MB. Allowed types: PDF, images, Word, Excel, text
        files.
      </Text>
    </div>
  );
}
