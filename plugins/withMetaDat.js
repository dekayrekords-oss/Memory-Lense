const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

// Memory Lens — Meta Wearables DAT native config.
//
// Values come from app.json `extra.metaDat`:
//   { appId, clientToken, appLinkURLScheme, associatedDomain }
//
// iOS: Info.plist carries the toolkit configuration (app ID + client
// token), the universal-link scheme, background modes, and the
// associated domain for the registration callback, per Meta's iOS
// integration guide. DAT's Swift Package itself is added in Xcode
// (CocoaPods cannot consume it) — see modules/meta-dat/README.md.
//
// Android: the DAT reads its application ID from the
// com.meta.wearable.mwdat.APPLICATION_ID manifest meta-data; analytics
// are opted out by default (com.meta.wearable.mwdat.ANALYTICS_OPT_OUT).

function metaDatConfig(config) {
  const extra = config.extra && typeof config.extra === 'object' ? config.extra : {};
  const meta =
    extra.metaDat && typeof extra.metaDat === 'object' ? extra.metaDat : {};
  return {
    appId: typeof meta.appId === 'string' ? meta.appId : '',
    clientToken: typeof meta.clientToken === 'string' ? meta.clientToken : '',
    appLinkURLScheme:
      typeof meta.appLinkURLScheme === 'string'
        ? meta.appLinkURLScheme
        : 'memorylens',
    associatedDomain:
      typeof meta.associatedDomain === 'string' ? meta.associatedDomain : '',
  };
}

const withMetaDat = (config) => {
  const meta = metaDatConfig(config);

  config = withInfoPlist(config, (c) => {
    c.modResults.MetaAppID = meta.appId;
    c.modResults.ClientToken = meta.clientToken;
    c.modResults.AppLinkURLScheme = meta.appLinkURLScheme;
    const modes = new Set(c.modResults.UIBackgroundModes ?? []);
    modes.add('bluetooth-central');
    modes.add('audio');
    c.modResults.UIBackgroundModes = [...modes];
    if (meta.associatedDomain) {
      c.modResults['com.apple.developer.associated-domains'] = [
        `applinks:${meta.associatedDomain}`,
      ];
    }
    return c;
  });

  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) {
      app['meta-data'] = [
        ...(app['meta-data'] ?? []),
        {
          $: {
            'android:name': 'com.meta.wearable.mwdat.APPLICATION_ID',
            'android:value': meta.appId,
          },
        },
        {
          $: {
            'android:name': 'com.meta.wearable.mwdat.ANALYTICS_OPT_OUT',
            'android:value': 'true',
          },
        },
      ];
    }
    return c;
  });

  return config;
};

module.exports = withMetaDat;
