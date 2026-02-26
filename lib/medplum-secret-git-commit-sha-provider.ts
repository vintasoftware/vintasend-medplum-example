import { MedplumClient } from '@medplum/core';
import type { ProjectSetting } from '@medplum/fhirtypes';
import type { BaseGitCommitShaProvider } from 'vintasend';
import { MedplumSingleton } from './medplum-singleton';

const GIT_CURRENT_COMMIT_SHA_SECRET_NAME = 'GIT_CURRENT_COMMIT_SHA';

type ProjectAdminResponse = {
  project?: {
    secret?: ProjectSetting[];
  };
};

export class MedplumSecretGitCommitShaProvider implements BaseGitCommitShaProvider {
  private async getCurrentProjectSecrets(medplum: MedplumClient): Promise<ProjectSetting[]> {
    const profile = await medplum.getProfile();
    const projectId = profile?.meta?.project;

    if (!projectId) {
      return [];
    }

    const projectDetails = await medplum.get<ProjectAdminResponse>(`admin/projects/${projectId}`);
    return projectDetails.project?.secret ?? [];
  }

  async getCurrentGitCommitSha(): Promise<string | null> {
    try {
      const medplum = MedplumSingleton.getInstance();
      const secrets = await this.getCurrentProjectSecrets(medplum);
      const gitCommitSha = secrets.find((secret) => secret.name === GIT_CURRENT_COMMIT_SHA_SECRET_NAME)?.valueString;

      return gitCommitSha?.trim() || null;
    } catch {
      return null;
    }
  }
}
