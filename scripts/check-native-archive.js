const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ignore = require('ignore');

const root = path.resolve(__dirname, '..');
const rules = ignore().add(fs.readFileSync(path.join(root, '.easignore'), 'utf8'));
const source = 'modules/tdesk-bridge/android/src/main/java/expo/modules/tdeskbridge/TDeskBridgeModule.kt';
assert.ok(fs.existsSync(path.join(root, source)), 'Native bridge source is missing.');
assert.equal(rules.ignores(source), false, 'EAS archive excludes the native bridge. Anchor generated /android/ at the project root.');
assert.equal(rules.ignores('android/app/build/output.apk'), true, 'Generated Android output must stay outside EAS archives.');
assert.equal(rules.ignores('modules/tdesk-bridge/android/build/generated/file'), true);
assert.equal(rules.ignores('.env'), true);
assert.equal(rules.ignores('private.pem'), true);
const config = JSON.parse(execFileSync(process.execPath,
  [path.join(root, 'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking.js'), 'resolve', '--platform', 'android', '--json'],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const bridge = config.modules.find(module => module.packageName === 'tdesk-bridge');
assert.ok(bridge?.modules.includes('expo.modules.tdeskbridge.TDeskBridgeModule'), 'Expo does not autolink the native bridge.');
assert.ok(bridge.projects.some(project => fs.existsSync(project.sourceDir)), 'Native Android source directory is missing.');
console.log('native archive/autolinking checks OK');
