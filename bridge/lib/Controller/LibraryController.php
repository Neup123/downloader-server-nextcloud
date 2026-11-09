<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\Controller;

use OCA\DownloaderBridge\AppInfo\Application;
use OCA\DownloaderBridge\EntitlementPolicy;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUserSession;
use OCP\Util;

/**
 * A normal Nextcloud page and route. All download data is loaded later via the
 * ExApp's owner-authenticated API; this controller never receives a Core token.
 */
final class LibraryController extends Controller {
    public function __construct(
        IRequest $request,
        private IAppConfig $appConfig,
        private IGroupManager $groupManager,
        private IUserSession $userSession,
    ) {
        parent::__construct(Application::APP_ID, $request);
    }

    #[NoAdminRequired]
    #[NoCSRFRequired]
    public function index(): TemplateResponse {
        $uid = $this->userSession->getUser()?->getUID() ?? '';
        $entitled = EntitlementPolicy::allows(
            $uid,
            $this->appConfig->getValueString('downloader-server-nextcloud', 'allowed_users', '', lazy: true),
            $this->appConfig->getValueString('downloader-server-nextcloud', 'allowed_groups', '', lazy: true),
            fn (string $user, string $group): bool => $this->groupManager->isInGroup($user, $group),
        );
        if ($entitled) {
            Util::addScript(Application::APP_ID, 'library');
        }
        return new TemplateResponse(Application::APP_ID, 'library', ['entitled' => $entitled]);
    }
}
