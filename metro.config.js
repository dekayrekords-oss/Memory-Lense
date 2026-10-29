const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// three's CJS entry (build/three.cjs) calls process.emitWarning at load,
// which does not exist in React Native — the module throws
// "undefined is not a function" and takes the whole route down
// (@react-three/fiber does require('three')). Resolve every `three`
// import to the ESM build instead: no shim, no warning, one instance.
// (resolveRequest, not alias: Metro's alias is only a fallback and the
// plain `three` package resolves successfully to the broken CJS entry.)
const THREE_ESM = path.join(
  __dirname,
  'node_modules/three/build/three.module.js',
);
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') {
    return { filePath: THREE_ESM, type: 'sourceFile' };
  }
  if (upstreamResolve) {
    return upstreamResolve(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
