/**
 * React Native Firebase is autolinked whether or not Firebase config files are
 * supplied, and its pods refuse to install unless Swift Package Manager is
 * disabled for them (static frameworks are set via expo-build-properties).
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const LINE = '$RNFirebaseDisableSPM = true';

module.exports = function withRnfbPods(config) {
  return withDangerousMod(config, [
    'ios',
    (c) => {
      const podfile = path.join(c.modRequest.platformProjectRoot, 'Podfile');
      const src = fs.readFileSync(podfile, 'utf8');
      if (!src.includes(LINE)) fs.writeFileSync(podfile, `${LINE}\n${src}`);
      return c;
    },
  ]);
};
