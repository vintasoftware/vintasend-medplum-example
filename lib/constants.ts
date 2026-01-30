export const BOTS_SYSTEM = 'http://vintasend-medplum-example.com/bots';

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