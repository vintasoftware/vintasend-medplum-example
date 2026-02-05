import { MedplumClient } from '@medplum/core';

export async function getUserById(medplum: MedplumClient, referenceString: string) {
  if (!referenceString) {
    // eslint-disable-next-line no-console
    console.error('[getUserById] referenceString is null/undefined/empty!');
    throw new Error('The "id" parameter cannot be null, undefined, or an empty string.');
  }

  const [resourceType, id] = referenceString.split('/');

  if (!id) {
    // eslint-disable-next-line no-console
    console.error('[getUserById] ID extracted from referenceString is empty!');
    throw new Error('The "id" parameter cannot be null, undefined, or an empty string.');
  }

  return medplum.readResource(resourceType as 'Patient' | 'Practitioner', id);
}
