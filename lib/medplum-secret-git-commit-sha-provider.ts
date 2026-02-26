import { MedplumClient } from '@medplum/core';
import type { ProjectSetting } from '@medplum/fhirtypes';
import type { BaseGitCommitShaProvider } from 'vintasend';

const GIT_CURRENT_COMMIT_SHA_SECRET_NAME = 'GIT_CURRENT_COMMIT_SHA';

type ProjectAdminResponse = {
  project?: {
    secret?: ProjectSetting[];
  };
};

export class MedplumSecretGitCommitShaProvider implements BaseGitCommitShaProvider {
  constructor(private readonly medplum: MedplumClient) {}

  private async getCurrentProjectSecrets(medplum: MedplumClient): Promise<ProjectSetting[]> {
    const profile = await medplum.getProfile();
    const projectId = profile?.meta?.project;

    if (!projectId) {
      // eslint-disable-next-line no-console
      console.warn('[GitCommitShaProvider] No Medplum project id found in profile; returning empty secrets');
      return [];
    }

    const projectDetails = await medplum.get<ProjectAdminResponse>(`admin/projects/${projectId}`);
    return projectDetails.project?.secret ?? [];
  }

  async getCurrentGitCommitSha(): Promise<string | null> {
    try {
      const secrets = await this.getCurrentProjectSecrets(this.medplum);
      const gitCommitSha = secrets.find((secret) => secret.name === GIT_CURRENT_COMMIT_SHA_SECRET_NAME)?.valueString;

      if (!gitCommitSha?.trim()) {
        // eslint-disable-next-line no-console
        console.warn(
          `[GitCommitShaProvider] Secret ${GIT_CURRENT_COMMIT_SHA_SECRET_NAME} not found or empty`,
        );
      } else {
        // eslint-disable-next-line no-console
        console.info(`[GitCommitShaProvider] Resolved gitCommitSha=${gitCommitSha.trim()}`);
      }

      return gitCommitSha?.trim() || null;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[GitCommitShaProvider] Failed to resolve git commit SHA from Medplum secret', error);
      return null;
    }
  }
}
