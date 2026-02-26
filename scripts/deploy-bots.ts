import { ContentType, getReferenceString, MedplumClient, WithId } from '@medplum/core';
import { Bot, Bundle, BundleEntry, ProjectSetting, Questionnaire } from '@medplum/fhirtypes';
import { execSync } from 'child_process';
import fs from 'fs';
import { BotDescription, BOTS } from '../bots/index.js';
import { BOTS_SYSTEM } from '../lib/constants.js';
import { getMedplumClient } from './client.js';

const GIT_CURRENT_COMMIT_SHA_SECRET_NAME = 'GIT_CURRENT_COMMIT_SHA';

async function readBotFiles(description: BotDescription, medplum: MedplumClient) {
  const distFile = fs.readFileSync(`dist/bots/handlers/${description.name}.js`, 'utf-8');

  const [sourceCodeAttachment, executableCodeAttachment] = await Promise.all([
    medplum.createAttachment({
      data: distFile,
      contentType: 'application/javascript',
    }),
    medplum.createAttachment({
      data: distFile,
      contentType: 'application/javascript',
    }),
  ]);

  return { sourceCodeAttachment, executableCodeAttachment };
}

async function generateBundle(medplum: MedplumClient): Promise<Bundle> {
  const bundle: Bundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: (
      await Promise.all(
        BOTS.map(async (botDescription): Promise<BundleEntry[]> => {
          const botName = botDescription.name;
          const botReferencePlaceholder = `$bot-${botName}-reference`;
          const botIdPlaceholder = `$bot-${botName}-id`;
          const results: BundleEntry[] = [];
          const { cronString, timeout, runAsUser, criteria, extension } = botDescription;

          const { executableCodeAttachment, sourceCodeAttachment } = await readBotFiles(botDescription, medplum);

          results.push({
            request: { method: 'PUT', url: botReferencePlaceholder },
            resource: {
              resourceType: 'Bot',
              id: botIdPlaceholder,
              identifier: [{ system: BOTS_SYSTEM, value: botName }],
              name: botName,
              runtimeVersion: 'awslambda',
              sourceCode: sourceCodeAttachment,
              executableCode: executableCodeAttachment,
              runAsUser: runAsUser ?? false,
              ...(cronString && { cronString }),
              ...(timeout && { timeout }),
            },
          });

          if (criteria) {
            results.push({
              request: {
                method: 'PUT',
                url: `Subscription?url=${botReferencePlaceholder}`,
              },
              resource: {
                resourceType: 'Subscription',
                status: 'active',
                reason: `${botName}-subscription`,
                criteria,
                extension: extension ?? [],
                channel: {
                  endpoint: botReferencePlaceholder,
                  type: 'rest-hook',
                  payload: 'application/fhir+json',
                },
              },
            });
          }

          return results;
        })
      )
    ).flat(),
  };

  return bundle;
}

function getCurrentGitCommitSha(): string {
  const sha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();

  if (!/^[0-9a-fA-F]{40}$/.test(sha)) {
    throw new Error(`Invalid git commit sha resolved from repository: "${sha}"`);
  }

  return sha.toLowerCase();
}

async function upsertCurrentGitCommitShaSecret(medplum: MedplumClient, projectId: string): Promise<void> {
  const projectResult = await medplum.get(`admin/projects/${projectId}`);
  const existingSecrets: ProjectSetting[] = projectResult.project?.secret ?? [];
  const currentGitCommitSha = getCurrentGitCommitSha();

  const updatedSecrets = existingSecrets.filter((secret) => secret.name !== GIT_CURRENT_COMMIT_SHA_SECRET_NAME);
  updatedSecrets.push({
    name: GIT_CURRENT_COMMIT_SHA_SECRET_NAME,
    valueString: currentGitCommitSha,
  });

  await medplum.post(`admin/projects/${projectId}/secrets`, updatedSecrets);
}

async function deployBots(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('\nUploading bots...\n');

  const medplum = await getMedplumClient();

  const profile = await medplum.getProfile();
  const projectId = profile?.meta?.project;

  if (!projectId) {
    throw new Error('Could not resolve Medplum project id from current profile');
  }

  await upsertCurrentGitCommitShaSecret(medplum, projectId);

  const questionnaires: Questionnaire[] = [];

  const bundleData = await generateBundle(medplum);

  let transactionString = JSON.stringify(bundleData);
  const botEntries: BundleEntry[] =
    (bundleData as Bundle).entry?.filter((e) => e.resource?.resourceType === 'Bot') || [];
  const botIds: Record<string, string> = {};

  for (const botDescription of BOTS) {
    const botName = botDescription.name;

    let existingBot = await medplum.searchOne('Bot', { name: botName });
    if (!existingBot) {
      const createBotUrl = new URL(`admin/projects/${projectId as string}/bot`, medplum.getBaseUrl());
      existingBot = (await medplum.post(createBotUrl, {
        name: botName,
      })) as WithId<Bot>;
    }

    if (!existingBot) {
      throw new Error(`Bot ${botName} not found`);
    }

    const botMembership = await medplum.searchOne('ProjectMembership', { user: getReferenceString(existingBot) });
    if (botMembership && botMembership.admin !== botDescription.needsAdminMembership) {
      await medplum.post(`admin/projects/${projectId as string}/members/${botMembership.id}`, {
        ...botMembership,
        admin: botDescription.needsAdminMembership,
      });
    }

    botIds[botName] = existingBot.id as string;

    // Replace the Bot id placeholder in the bundle
    transactionString = transactionString
      .replaceAll(`$bot-${botName}-reference`, getReferenceString(existingBot))
      .replaceAll(`$bot-${botName}-id`, existingBot.id as string);
  }

  for (const questionnaire of questionnaires) {
    transactionString = transactionString.replaceAll(
      `$${questionnaire.name}`,
      getReferenceString(questionnaire) as string
    );
  }

  // eslint-disable-next-line no-console
  console.log('\nUploading bots bundle...\n');

  // Execute the transaction to upload / update the bot
  const transaction = JSON.parse(transactionString);

  const batchResponse = await medplum.executeBatch(transaction);
  // await medplum.executeBatch(transaction);

  const errors = batchResponse.entry?.filter((e) => !['200', '201'].includes(e.response?.status ?? ''));
  if (errors && errors.length > 0) {
    throw new Error(`${JSON.stringify(errors, null, 2)}`);
  }

  // Deploy the bots
  for (const entry of botEntries) {
    const botName = (entry?.resource as Bot)?.name as string;

    // eslint-disable-next-line no-console
    console.log(`Deploying ${botName}...`);

    await medplum.post(medplum.fhirUrl('Bot', botIds[botName], '$deploy'));
  }

  // eslint-disable-next-line no-console
  console.log('\nAll bots deployed!\n');
}

// eslint-disable-next-line no-console
deployBots().catch(console.error);
