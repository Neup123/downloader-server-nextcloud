<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\Activity;

use OCP\Activity\ISetting;

/** The native Activity stream category for completed Downloader jobs. */
final class Setting implements ISetting {
    public function getIdentifier(): string { return 'downloader_bridge_download'; }
    public function getName(): string { return 'Downloads'; }
    public function getPriority(): int { return 35; }
    public function canChangeStream(): bool { return true; }
    public function isDefaultEnabledStream(): bool { return true; }
    public function canChangeMail(): bool { return false; }
    public function isDefaultEnabledMail(): bool { return false; }
}
