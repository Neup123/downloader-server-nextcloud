<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\Settings;

use OCA\DownloaderBridge\AppInfo\Application;
use OCA\DownloaderBridge\EntitlementPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IUserSession;
use OCP\Settings\ISettings;
use OCP\Util;

/** The built-in Nextcloud personal preferences page hosts the entire form. */
final class PersonalSettings implements ISettings {
    public function __construct(
        private IAppConfig $appConfig,
        private IGroupManager $groupManager,
        private IUserSession $userSession,
    ) {}

    public function getForm(): TemplateResponse {
        $uid = $this->userSession->getUser()?->getUID() ?? '';
        $entitled = EntitlementPolicy::allows(
            $uid,
            $this->appConfig->getValueString('downloader-server-nextcloud', 'allowed_users', '', lazy: true),
            $this->appConfig->getValueString('downloader-server-nextcloud', 'allowed_groups', '', lazy: true),
            fn (string $user, string $group): bool => $this->groupManager->isInGroup($user, $group),
        );
        if ($entitled) {
            Util::addScript(Application::APP_ID, 'settings');
        }
        return new TemplateResponse(Application::APP_ID, 'personal', ['entitled' => $entitled], '');
    }

    public function getSection(): string {
        return 'downloader';
    }

    public function getPriority(): int {
        return 10;
    }
}
