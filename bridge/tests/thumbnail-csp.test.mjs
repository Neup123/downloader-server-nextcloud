import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const contractPath = fileURLToPath(new URL('./thumbnail-csp-contract.php', import.meta.url));
const contract = JSON.parse(execFileSync('php', [contractPath], {encoding: 'utf8'}));

test('bridge registers the Nextcloud default-policy event listener', () => {
  assert.equal(contract.registered, true);
});

test('HTML document navigation contributes the documented CSP policy once', () => {
  assert.equal(contract.policy_count, 1);
  assert.equal(contract.policy_class, 'OCP\\AppFramework\\Http\\ContentSecurityPolicy');
});

test('image policy adds HTTPS scheme only and never modifies another CSP directive', () => {
  assert.deepEqual(contract.mutations, [['addAllowedImageDomain', 'https:']]);
  assert.deepEqual(contract.mutations.filter(([name]) => name !== 'addAllowedImageDomain'), []);
});

test('non-HTML and non-GET requests are not given the image policy', () => {
  assert.equal(contract.post_policy_count, 0);
  assert.equal(contract.api_policy_count, 0);
});
