import { formatHumanName } from '@medplum/core';
import { HumanName } from '@medplum/fhirtypes';
import { PREFERRED_NAME_EXTENSION_URL } from './extensions';

export function getPreferredName(name: HumanName | undefined): string | undefined {
  if (!name) return;
  const preferredName = name?.extension?.find(
    (extension) => extension.url === PREFERRED_NAME_EXTENSION_URL
  )?.valueString;
  return preferredName;
}

export function formatNameWithPreferredName(name: HumanName | undefined) {
  const preferredName = getPreferredName(name);
  if (!preferredName) return formatHumanName(name);
  const given = name?.given?.join(' ');
  const familyName = name?.family;

  return `${given} (${preferredName}) ${familyName}`;
}
