<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\Listener;

use OCA\DownloaderBridge\AppInfo\Application;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/** @template-implements IEventListener<BeforeTemplateRenderedEvent> */
final class AssetsListener implements IEventListener {
    public function handle(Event $event): void {
        if (!$event instanceof BeforeTemplateRenderedEvent) {
            return;
        }
        // The early Files hook needs its native locale catalog registered first.
        // addInitScript does not substitute for addTranslations.
        Util::addTranslations(Application::APP_ID);
        Util::addInitScript(Application::APP_ID, 'bridge');
    }
}
