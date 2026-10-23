/**
 * Dynamic Expo config = app.json + native Firebase phone sign-in when its
 * config files are supplied at build time:
 *
 *   GOOGLE_SERVICES_JSON=./firebase/google-services.json \
 *   GOOGLE_SERVICE_INFO_PLIST=./firebase/GoogleService-Info.plist \
 *   npx expo prebuild   (or an EAS build with these as file secrets)
 *
 * Without them the app reports that phone sign-in is unavailable in that build
 * (no fake codes). Expo Go never contains the native Firebase module.
 *
 * Always applied: the iOS 27 UIScene life cycle, and the pod settings React
 * Native Firebase needs (it is autolinked even without config files).
 */
module.exports = ({ config }) => {
  const androidFile = process.env.GOOGLE_SERVICES_JSON;
  const iosFile = process.env.GOOGLE_SERVICE_INFO_PLIST;
  return {
    ...config,
    android: { ...config.android, ...(androidFile ? { googleServicesFile: androidFile } : {}) },
    ios: { ...config.ios, ...(iosFile ? { googleServicesFile: iosFile } : {}) },
    plugins: [
      ...(config.plugins ?? []),
      ...(androidFile || iosFile ? ['@react-native-firebase/app', '@react-native-firebase/auth'] : []),
      // React Native Firebase on iOS needs static frameworks.
      ['expo-build-properties', { ios: { useFrameworks: 'static' } }],
      './plugins/with-rnfb-pods',
      './plugins/with-ios-scene-lifecycle',
    ],
  };
};
