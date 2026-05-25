const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

// Exclude test files from Metro's module graph so Expo Router does not
// treat *.test.tsx as routes, and Metro does not try to bundle
// @testing-library/react-native (which imports Node's `console`).
config.resolver.blockList = [
  /.*\.test\.(t|j)sx?$/,
  /.*\.spec\.(t|j)sx?$/,
  /.*\/__tests__\/.*/,
  /.*\/test\/.*/,
]

module.exports = withNativeWind(config, { input: './src/global.css' })
