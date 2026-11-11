<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;
use OCA\DownloaderBridge\Listener\AssetsListener;
use OCA\DownloaderBridge\Listener\ThumbnailContentSecurityPolicyListener;
use OCA\DownloaderBridge\Dashboard\DownloadsWidget;
use OCA\DownloaderBridge\BackgroundJob\ActivitySync;
use OCP\BackgroundJob\IJobList;
use OCA\DownloaderBridge\Search\DownloadsProvider;

/** UI integration only: never run engines or perform file deliveries in PHP. */
final class Application extends App implements IBootstrap {
    public const APP_ID = 'downloader_bridge';

    public function __construct() {
        parent::__construct(self::APP_ID);
    }

    public function register(IRegistrationContext $context): void {
        $context->registerEventListener(BeforeTemplateRenderedEvent::class, AssetsListener::class);
        $context->registerEventListener(AddContentSecurityPolicyEvent::class, ThumbnailContentSecurityPolicyListener::class);
        $context->registerDashboardWidget(DownloadsWidget::class);
        $context->registerSearchProvider(DownloadsProvider::class);
    }

    public function boot(IBootContext $context): void {
        $context->getServerContainer()->get(IJobList::class)->add(ActivitySync::class);
    }
}
