const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

const REACT_QUERY = '@tanstack/react-query';
const APP_ORIGIN = path.join(__dirname, 'package.json');

// app-kit's copy pairs with the web's React, and a second copy is a second QueryClient context.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isReactQuery = moduleName === REACT_QUERY || moduleName.startsWith(`${REACT_QUERY}/`);
  const from = isReactQuery ? { ...context, originModulePath: APP_ORIGIN } : context;
  return context.resolveRequest(from, moduleName, platform);
};

// The tokens are authored at 16px to the rem; NativeWind's default of 14 shrinks a 44px target to 38.5.
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
