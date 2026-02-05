
import type { ContextGenerator } from 'vintasend';
import { MedplumSingleton } from '../medplum-singleton';
import { formatNameWithPreferredName } from '../patients';
import { getUserById } from '../get-user-by-id';

export type TaskDueSoonContextInput = {
  taskId: string;
  taskLinkBaseUrl: string;
};

export type TaskDueSoonContextOutput = {
  firstName: string;
  taskTitle: string;
  taskDescription: string;
  taskIsUrgent: boolean;
  taskLink: string;
  dueDate: string;
};

export class TaskDueSoonContextGenerator implements ContextGenerator {
  async generate(input: TaskDueSoonContextInput): Promise<TaskDueSoonContextOutput> {
    const medplum = MedplumSingleton.getInstance();
    // Fetch the task
    const task = await medplum.readResource('Task', input.taskId);
    if (!task) {
      throw new Error(`Task with id ${input.taskId} not found`);
    }

    // Get owner
    let firstName = 'Practitioner';
    if (task.owner?.reference) {
      const user = await getUserById(medplum, task.owner.reference);
      firstName = formatNameWithPreferredName(user.name?.[0]) ?? 'Practitioner';
    }

    // Task details
    const taskTitle = task.code?.text || task.description || 'Task';
    const taskDescription = task.description || '';
    const taskIsUrgent = task.priority === 'urgent';

    // Due date
    let dueDate = '';
    if (task.executionPeriod?.end) {
      const date = new Date(task.executionPeriod.end);
      dueDate = date.toLocaleString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    // Task link
    const taskLink = `${input.taskLinkBaseUrl}/Task/${task.id}`;

    return {
      firstName,
      taskTitle,
      taskDescription,
      taskIsUrgent,
      taskLink,
      dueDate,
    };
  }
}
