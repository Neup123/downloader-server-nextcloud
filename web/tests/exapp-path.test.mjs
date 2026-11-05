import test from 'node:test';
import assert from 'node:assert/strict';
import { exappRoot } from '../src/exapp-path.ts';

test('AppAPI subpath is resolved independently from search and hash fragments', () => {
  assert.equal(
    exappRoot('/index.php/apps/app_api/exapps/downloader-server-nextcloud/'),
    '/index.php/apps/app_api/exapps/downloader-server-nextcloud'
  );
  assert.equal(
    exappRoot('/index.php/apps/app_api/exapps/downloader-server-nextcloud'),
    '/index.php/apps/app_api/exapps/downloader-server-nextcloud'
  );
  assert.equal(exappRoot('/'), '');
});
test('reject unsafe or non-absolute app paths', () => {
  assert.throws(() => exappRoot('relative'));
  assert.throws(() => exappRoot('/path\\\\escaped'));
});
