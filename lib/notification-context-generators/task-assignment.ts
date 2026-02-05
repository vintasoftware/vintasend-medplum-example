
import type { ContextGenerator } from 'vintasend';
import { MedplumSingleton } from '../medplum-singleton';
import { formatNameWithPreferredName } from '../patients';
import { getUserById } from '../get-user-by-id';
import { getTaskAttachments } from '../file-upload';

export type TaskAssignmentContextInput = {
  taskId: string;
  taskLinkBaseUrl: string;
};

export type TaskAssignmentContextOutput = {
  firstName: string;
  taskTitle: string;
  taskDescription: string;
  taskIsUrgent: boolean;
  taskLink: string;
  requesterName: string;
  attachmentCount: number;
};


export class TaskAssignmentContextGenerator implements ContextGenerator {
  async generate(input: TaskAssignmentContextInput): Promise<TaskAssignmentContextOutput> {
    const medplum = MedplumSingleton.getInstance();
    // Fetch the task
    const task = await medplum.readResource('Task', input.taskId);
    if (!task) {
      throw new Error(`Task with id ${input.taskId} not found`);
    }

    // Find owner
    let firstName = 'Practitioner';
    let requesterName = '';
    if (task.owner?.reference) {
      const user = await getUserById(medplum, task.owner.reference);
      firstName = formatNameWithPreferredName(user.name?.[0]) ?? 'Practitioner';
    }

    // Find requester name
    if (task.requester?.reference) {
      const requester = await getUserById(medplum, task.requester.reference);
      requesterName = formatNameWithPreferredName(requester.name?.[0]) ?? '';
    }

    // Count attachments
    const attachmentCount = (await getTaskAttachments(medplum, task)).length;

    // Build task link (assuming a base URL is available via env or config)
    const taskLinkBaseUrl = input.taskLinkBaseUrl || '';
    const taskLink = taskLinkBaseUrl && task.id ? `${taskLinkBaseUrl}/Task/${task.id}` : '';

    return {
      firstName,
      taskTitle: task.code?.text || '',
      taskDescription: task.description || '',
      taskIsUrgent: !!task.priority && task.priority.toLowerCase() === 'stat',
      taskLink,
      requesterName,
      attachmentCount,
    };
  }
}
