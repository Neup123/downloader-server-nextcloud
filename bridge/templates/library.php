<?php
declare(strict_types=1);

/** @var array $_ */
?>
<div id="downloader-library" class="app-content">
    <?php if (!$_['entitled']): ?>
        <main class="downloader-library-locked">
            <h1>Downloader</h1>
            <p>Downloads are not enabled for your account. Ask your Nextcloud administrator for access.</p>
        </main>
    <?php else: ?>
        <main id="downloader-library-app" aria-label="My downloads">
            <h1>My downloads</h1>
            <p>Loading your download history…</p>
        </main>
    <?php endif; ?>
</div>
