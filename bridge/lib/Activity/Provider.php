<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\Activity;

use OCP\Activity\IEvent;
use OCP\Activity\IProvider;
use OCP\Activity\Exceptions\UnknownActivityException;
use OCP\IURLGenerator;

/**
 * Formats stored Activity records. This bridge does not download anything.
 */
final class Provider implements IProvider {
    public function __construct(private IURLGenerator $urls) {}

    public function parse($language, IEvent $event, ?IEvent $previousEvent = null) {
        if ($event->getApp() !== 'downloader_bridge'
            || $event->getType() !== 'downloader_bridge_download') {
            throw new UnknownActivityException();
        }
        $subject = $event->getSubject();
        $label = match ($subject) {
            'download_completed' => 'Download completed',
            'download_failed' => 'Download failed',
            'download_cancelled' => 'Download cancelled',
            default => 'Download updated',
        };
        $params = $event->getSubjectParameters();
        $title = is_string($params['title'] ?? null) ? $params['title'] : 'Download';
        $event->setParsedSubject($label . ': ' . mb_substr($title, 0, 180));
        $event->setLink($this->urls->getAbsoluteURL(
            '/apps/downloader_bridge/library?job='
            . rawurlencode((string)$event->getObjectId()),
        ));
        $event->setIcon($this->urls->imagePath('core', 'actions/download.svg'));
        return $event;
    }
}
