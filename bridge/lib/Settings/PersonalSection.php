<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\Settings;

use OCP\IURLGenerator;
use OCP\Settings\IIconSection;

/** Native entry in Nextcloud's Personal settings sidebar. */
final class PersonalSection implements IIconSection {
    public function __construct(private IURLGenerator $urls) {}

    public function getIcon(): string {
        return $this->urls->imagePath('core', 'actions/download.svg');
    }

    public function getID(): string {
        return 'downloader';
    }

    public function getName(): string {
        return 'Downloader';
    }

    public function getPriority(): int {
        return 60;
    }
}
