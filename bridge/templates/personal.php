<?php
declare(strict_types=1);
/** @var array $_ */
?>
<section class="section" id="downloader-personal-settings">
    <?php if (!$_['entitled']): ?>
        <h2>Downloader</h2>
        <p><?php p($l->t('Downloader is not enabled for this account.')); ?></p>
    <?php else: ?>
        <div id="downloader-settings-app" aria-label="<?php p($l->t('Downloader personal settings')); ?>">
            <h2>Downloader</h2>
            <p><?php p($l->t('Loading your own download preferences…')); ?></p>
        </div>
    <?php endif; ?>
</section>
