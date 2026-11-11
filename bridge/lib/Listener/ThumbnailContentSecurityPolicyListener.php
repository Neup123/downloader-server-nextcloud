<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\Listener;

use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IRequest;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;

/** @template-implements IEventListener<AddContentSecurityPolicyEvent> */
final class ThumbnailContentSecurityPolicyListener implements IEventListener {
    public function __construct(private IRequest $request) {
    }

    public function handle(Event $event): void {
        if (!$event instanceof AddContentSecurityPolicyEvent) {
            return;
        }

        // AssetsListener injects the dialog into other apps' rendered pages, not
        // only downloader_bridge controllers. Restrict this contribution to
        // document navigations, never API responses or other request methods.
        if ($this->request->getMethod() !== 'GET'
            || stripos($this->request->getHeader('Accept'), 'text/html') === false) {
            return;
        }

        // yt-dlp entries can use an open-ended set of extractor CDN hosts.
        // A fixed hostname list would break otherwise valid gallery/channel
        // thumbnails. HTTPS images only; all other CSP directives are untouched.
        $policy = new ContentSecurityPolicy();
        $policy->addAllowedImageDomain('https:');
        $event->addPolicy($policy);
    }
}
