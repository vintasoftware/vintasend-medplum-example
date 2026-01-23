import { MedplumClient } from '@medplum/core';

export class MedplumSingleton {
  private static instance: MedplumClient;

  private constructor() {}

  public static getInstance(): MedplumClient {
    if (!MedplumSingleton.instance) {
      throw new Error('MedplumClient instance not set. Please set it before using.');
    }
    return MedplumSingleton.instance;
  }

  public static setInstance(medplum: MedplumClient): void {
    MedplumSingleton.instance = medplum;
  }
}