// T-Bridge (app.kopru) paket görünürlüğü: Android 11+ <queries>. Ana uygulama manifestine eklenir
// (yerel modülün kendi manifesti de ekler; birleşme zararsızdır). android/ üretilen klasör olduğundan prebuild'de yeniden uygulanır.
const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withBridgeQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const m = cfg.modResults.manifest;
    m.queries = m.queries || [];
    const has = m.queries.some((q) => (q.package || []).some((p) => p.$['android:name'] === 'app.kopru'));
    if (!has) {
      if (m.queries.length === 0) m.queries.push({});
      m.queries[0].package = m.queries[0].package || [];
      m.queries[0].package.push({ $: { 'android:name': 'app.kopru' } });
    }
    return cfg;
  });
};
