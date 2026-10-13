import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeFeatureGates } from './runtime-feature-gates.mjs';

// MIXDOG_FEATURE_* overrides win over every stored toggle, so a developer
// environment that sets one must not decide what these gates report.
const OVERRIDES = [
  'MIXDOG_FEATURE_WEB_SEARCH',
  'MIXDOG_FEATURE_MEMORY',
  'MIXDOG_FEATURE_GIT',
  'MIXDOG_FEATURE_OFFICE',
  'MIXDOG_FEATURE_MEDIA',
];

function withoutFeatureOverrides(t) {
  const saved = OVERRIDES.map((name) => [name, process.env[name]]);
  for (const name of OVERRIDES) delete process.env[name];
  t.after(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

const installed = {
  builtins: { git: { installed: true }, memory: { installed: true }, tidy: { installed: true } },
};

test('gates read the live config, so a toggle takes effect without rebuilding them', (t) => {
  withoutFeatureOverrides(t);
  let config = { ...installed };
  const gates = createRuntimeFeatureGates({
    getConfig: () => config,
    getToolProfile: () => 'interactive',
  });

  assert.equal(gates.tidyToolEnabledFn(), true);
  assert.equal(gates.featureDisallowedTools().includes('tidy'), false);

  config = { ...config, modules: { tidy: { enabled: false } } };

  assert.equal(gates.tidyToolEnabledFn(), false);
  assert.equal(gates.featureDisallowedTools().includes('tidy'), true);
});

test('the git gate needs no install marker on any tool profile', (t) => {
  withoutFeatureOverrides(t);
  let toolProfile = 'interactive';
  const gates = createRuntimeFeatureGates({
    getConfig: () => ({ builtins: {} }),
    getToolProfile: () => toolProfile,
  });

  // Not installed: the git tool is still offered; only GitHub stays gated.
  assert.equal(gates.gitToolsEnabledFn(), true);
  assert.equal(gates.featureDisallowedTools().includes('git'), false);
  assert.equal(gates.featureDisallowedTools().includes('github'), true);

  toolProfile = 'headless';

  assert.equal(gates.gitToolsEnabledFn(), true);
  assert.equal(gates.featureDisallowedTools().includes('git'), false);
});

test('an uninstalled built-in stays inactive and is denied at the session surface', (t) => {
  withoutFeatureOverrides(t);
  const gates = createRuntimeFeatureGates({
    getConfig: () => ({ builtins: {} }),
    getToolProfile: () => 'interactive',
  });

  assert.equal(gates.memoryToolsEnabledFn(), false);
  assert.equal(gates.localProviderEnabledFn(), false);
  for (const denied of ['memory', 'recall', 'github']) {
    assert.equal(gates.featureDisallowedTools().includes(denied), true);
  }
  // Module-level features keep their enabled-by-default answer.
  assert.equal(gates.recapEnabledFn(), true);
  assert.equal(gates.webSearchEnabled(), true);
});
