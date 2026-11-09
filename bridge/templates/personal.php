<?php
declare(strict_types=1);
/** @var array $_ */
?>
<section class="section" id="downloader-personal-settings">
    <?php if (!$_['entitled']): ?>
        <h2>Downloader</h2>
        <p>Downloader is not enabled for this account.</p>
    <?php else: ?>
        <div id="downloader-settings-app" aria-label="Downloader personal settings">
            <h2>Downloader</h2>
            <p>Loading your own download preferences…</p>
        </div>
    <?php endif; ?>
</section>
