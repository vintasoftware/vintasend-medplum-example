import { MedplumClient } from '@medplum/core';
import { config } from 'dotenv';

// Load environment variables from .env file
config();

export async function getMedplumClient() {
  const medplum = new MedplumClient({
    clientId: process.env.MEDPLUM_CLIENT_ID,
  });

  await medplum.startClientLogin(
    process.env.MEDPLUM_CLIENT_ID as string,
    process.env.MEDPLUM_CLIENT_SECRET as string
  );

  return medplum;
}