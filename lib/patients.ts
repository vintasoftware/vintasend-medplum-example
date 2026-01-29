import { formatHumanName } from '@medplum/core';
import { HumanName } from '@medplum/fhirtypes';
import { PREFERRED_NAME_EXTENSION_URL } from './extensions';

export function getPatientPreferredName(patientName: HumanName | undefined): string | undefined {
  if (!patientName) return;
  const preferredName = patientName?.extension?.find(
    (extension) => extension.url === PREFERRED_NAME_EXTENSION_URL
  )?.valueString;
  return preferredName;
}

export function formatPatientNameWithPreferredName(patientName: HumanName | undefined) {
  const preferredName = getPatientPreferredName(patientName);
  if (!preferredName) return formatHumanName(patientName);
  const given = patientName?.given?.join(' ');
  const familyName = patientName?.family;

  return `${given} (${preferredName}) ${familyName}`;
}