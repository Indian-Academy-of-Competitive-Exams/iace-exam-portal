const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// The tokens are authored at 16px to the rem; NativeWind's default of 14 shrinks a 44px target to 38.5.
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
