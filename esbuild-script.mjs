/* global console */
/* global process */
/* eslint no-console: "off" */
/*eslint no-process-exit: "off"*/

import botLayer from '@medplum/bot-layer/package.json' with { type: 'json' };
import { sentryEsbuildPlugin } from '@sentry/esbuild-plugin';
import esbuild from 'esbuild';
import fastGlob from 'fast-glob';
import { gqlPlugin } from './plugins/gql-plugin.mjs';

// Find all TypeScript files in your source directory
const entryPoints = fastGlob
  .sync(['./src/**/*.ts', './bots/**/*.ts', './lib/**/*.ts'])
  .filter((file) => !file.endsWith('test.ts'));

const botLayerDeps = Object.keys(botLayer.dependencies);

const plugins = [gqlPlugin];

// Only include Sentry plugin if environment variables are present
if (process.env.SENTRY_ORG && process.env.SENTRY_PROJECT && process.env.SENTRY_AUTH_TOKEN) {
  plugins.push(
    sentryEsbuildPlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ['dist/**/*.map'],
      },
    })
  );
}

// Add additional external packages
const additionalExternals = [
  'react-transition-group',
  'react-remove-scroll',
  'react-transition-group/*',
  'react-remove-scroll/*',
];

// Define the esbuild options
const esbuildOptions = {
  entryPoints: entryPoints,
  bundle: true, // Bundle imported functions
  outdir: './dist', // Output directory for compiled files
  platform: 'node', // or 'node', depending on your target platform
  plugins: plugins,
  loader: {
    '.ts': 'ts', // Load TypeScript files
  },
  resolveExtensions: ['.ts', '.js', '.json'],
  external: [...botLayerDeps, ...additionalExternals], // Add the additional externals here
  format: 'cjs', // Set output format as ECMAScript modules
  target: 'es2020', // Set the target ECMAScript version
  tsconfig: 'tsconfig.json',
  footer: { js: 'Object.assign(exports, module.exports);' }, // Required for VM Context Bots
  sourcemap: true,
};

// Build using esbuild
esbuild
  .build(esbuildOptions)
  .then(() => {
    console.log('Build completed successfully!');
  })
  .catch((error) => {
    console.error('Build failed:', JSON.stringify(error, null, 2));
    process.exit(1);
  });