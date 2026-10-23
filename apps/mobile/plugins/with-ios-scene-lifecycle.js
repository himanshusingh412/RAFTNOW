/**
 * iOS 27 SDK refuses to launch apps that don't adopt the UIScene life cycle
 * ("UIScene life cycle is required for apps built with this SDK"). Expo SDK 57
 * ships ExpoAppSceneDelegate for this, but the prebuild template doesn't wire
 * it in yet. This plugin:
 *   1. declares a UIApplicationSceneManifest pointing at EXExpoAppSceneDelegate;
 *   2. makes AppDelegate an ExpoReactNativeFactoryProvider and stops it creating
 *      the window itself (the scene delegate creates the window and starts RN).
 * Remove once `expo prebuild` generates this on its own.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const START_RN = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return c;
  });

  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') throw new Error('with-ios-scene-lifecycle expects a Swift AppDelegate');
    let src = c.modResults.contents;
    if (!src.includes('ExpoReactNativeFactoryProvider')) {
      src = src.replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    }
    if (START_RN.test(src)) {
      src = src.replace(START_RN, '\n    // The window and React Native are started by ExpoAppSceneDelegate (UIScene life cycle).\n');
    }
    if (!src.includes('ExpoReactNativeFactoryProvider') || src.includes('UIWindow(frame: UIScreen.main.bounds)')) {
      throw new Error('with-ios-scene-lifecycle: AppDelegate template changed; update the plugin');
    }
    c.modResults.contents = src;
    return c;
  });
};
