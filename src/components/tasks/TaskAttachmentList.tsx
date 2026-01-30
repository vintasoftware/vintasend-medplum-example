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

/**
 * Displays a list of file attachments for a task.
 * Allows downloading and optionally removing attachments.
 */
export function TaskAttachmentList({ attachments, onRemove, readOnly = false }: TaskAttachmentListProps): JSX.Element {
  const medplum = useMedplum();

  if (attachments.length === 0) {
    return (
      <Text size="sm" color="dimmed">
        No attachments
      </Text>
    );
  }

  const getFileIcon = (contentType?: string): JSX.Element => {
    if (!contentType) {
      return <IconFile size={20} />;
    }

    if (contentType.startsWith('image/')) {
      return <IconPhoto size={20} />;
    }

    if (contentType.includes('pdf') || contentType.includes('document') || contentType.includes('text')) {
      return <IconFileText size={20} />;
    }

    return <IconFile size={20} />;
  };

  const formatFileSize = (url?: string): string => {
    // In a real implementation, you might fetch the binary to get the actual size
    // For now, we'll just return a placeholder
    return 'Unknown size';
  };

  const handleDownload = async (media: Media): Promise<void> => {
    if (!media.content?.url) {
      return;
    }

    try {
      // Extract Binary ID from the URL (format: "Binary/{id}")
      const binaryId = media.content.url.split('/')[1];
      const binary = await medplum.readResource('Binary', binaryId);

      // Create a download link using Binary resource URL
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

  const handleRemove = (mediaId: string): void => {
    if (onRemove) {
      onRemove(mediaId);
    }
  };

  return (
    <Stack gap="xs">
      {attachments.map((media) => (
        <Paper key={media.id} p="sm" withBorder>
          <Group justify="space-between">
            <Group gap="sm" style={{ flex: 1, minWidth: 0 }}>
              {getFileIcon(media.content?.contentType)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500} truncate="end" title={media.content?.title || 'Untitled'}>
                  {media.content?.title || 'Untitled'}
                </Text>
                <Group gap="xs">
                  <Badge size="xs" variant="outline">
                    {media.content?.contentType || 'Unknown type'}
                  </Badge>
                  <Text size="xs" color="dimmed">
                    {formatFileSize(media.content?.url)}
                  </Text>
                </Group>
              </div>
            </Group>

            <Group gap="xs" style={{ flexShrink: 0 }}>
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
                    onClick={() => handleRemove(media.id as string)}
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
