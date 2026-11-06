<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCA\DownloaderBridge\Listener\AssetsListener;
use OCA\DownloaderBridge\Dashboard\DownloadsWidget;
use OCA\DownloaderBridge\Search\DownloadsProvider;

/** UI integration only: never run engines or perform file deliveries in PHP. */
final class Application extends App implements IBootstrap {
    public const APP_ID = 'downloader_bridge';

    public function __construct() {
        parent::__construct(self::APP_ID);
    }

    public function register(IRegistrationContext $context): void {
        $context->registerEventListener(BeforeTemplateRenderedEvent::class, AssetsListener::class);
        $context->registerDashboardWidget(DownloadsWidget::class);
        $context->registerSearchProvider(DownloadsProvider::class);
    }

    public function boot(IBootContext $context): void {
    }
}
