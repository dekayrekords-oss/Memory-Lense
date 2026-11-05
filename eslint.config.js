// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // R3F three.js intrinsics (mesh, boxGeometry, …) are not DOM elements;
    // the React unknown-property rule cannot see them. Scoped to the 3D view.
    files: ['src/components/StepModelView.tsx'],
    rules: {
      'react/no-unknown-property': 'off',
    },
  },
]);
