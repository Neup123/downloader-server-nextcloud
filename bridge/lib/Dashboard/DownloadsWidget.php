<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\Dashboard;

use OCA\DownloaderBridge\AppInfo\Application;
use OCP\Dashboard\IWidget;
use OCP\Dashboard\IConditionalWidget;
use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IUserSession;
use OCP\Util;

/**
 * Nextcloud UI-only integration. This class neither executes downloads nor
 * reads file bytes. It hides the widget from users without ExApp entitlement.
 */
final class DownloadsWidget implements IWidget, IConditionalWidget {
    public function __construct(
        private IAppConfig $appConfig,
        private IGroupManager $groupManager,
        private IUserSession $userSession,
    ) {
    }

    public function isEnabled(): bool {
        $uid = $this->userSession->getUser()?->getUID();
        if ($uid === null || $uid === '') {
            return false;
        }
        $appid = 'downloader-server-nextcloud';
        $users = $this->ids($this->appConfig->getValueString($appid, 'allowed_users', '', lazy: true));
        if (in_array($uid, $users, true)) {
            return true;
        }
        $groups = $this->ids($this->appConfig->getValueString($appid, 'allowed_groups', '', lazy: true));
        foreach ($groups as $group) {
            if ($this->groupManager->isInGroup($uid, $group)) {
                return true;
            }
        }
        return false;
    }

    /** @return string[] */
    private function ids(string $value): array {
        $parts = preg_split('/[,\r\n]+/', $value) ?: [];
        return array_values(array_filter(array_map('trim', $parts), static fn (string $part): bool => $part !== ''));
    }

    public function getId(): string {
        return 'downloader_bridge';
    }

    public function getTitle(): string {
        return 'My downloads';
    }

    public function getOrder(): int {
        return 40;
    }

    public function getIconClass(): string {
        return 'icon-download';
    }

    public function getUrl(): ?string {
        return null;
    }

    public function load(): void {
        Util::addScript(Application::APP_ID, 'dashboard', 'dashboard');
    }
}
