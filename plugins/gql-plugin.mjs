import fs from 'fs/promises';

/**
 * esbuild plugin for handling GraphQL files.
 * Automatically exports all named operations (queries, mutations) and fragments.
 */
export const gqlPlugin = {
  name: 'gql',
  setup(build) {
    build.onLoad({ filter: /\.gql$/ }, async (args) => {
      const contents = await fs.readFile(args.path, 'utf8');
      
      // Simple regex to find all named operations and fragments
      const operationRegex = /(query|mutation|fragment)\s+([a-zA-Z][a-zA-Z0-9_]*)/g;
      const matches = [...contents.matchAll(operationRegex)];
      
      const exports = matches
        .map(([, , name]) => `export const ${name} = doc;`)
        .join('\n');

      return {
        contents: `
          const doc = \`${contents}\`;
          ${exports}
          export default doc;
        `,
        loader: 'js',
      };
    });
  },
}; 