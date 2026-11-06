<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\BackgroundJob;

use OCP\Activity\IManager;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use OCP\Config\IUserConfig;
use OCP\IAppConfig;
use OCP\IGroupManager;

/**
 * Metadata-to-Activity UI hook, not a downloader.
 * Nextcloud owns both source (per-user ExApp preferences) and Activity storage.
 * No media files, WebDAV requests or downloader tokens enter PHP.
 */
final class ActivitySync extends TimedJob {
    private const APP = 'downloader-server-nextcloud';
    private const ACTIVITY_APP = 'downloader_bridge';

    public function __construct(
        ITimeFactory $time,
        private IUserConfig $userConfig,
        private IAppConfig $appConfig,
        private IGroupManager $groupManager,
        private IManager $activity,
    ) {
        parent::__construct($time);
        $this->setInterval(180);
        $this->setAllowParallelRuns(false);
    }

    protected function run($argument): void {
        foreach ($this->userConfig->getUserIds(self::APP) as $uid) {
            if (!$this->isEntitled($uid)) {
                continue;
            }
            $raw = $this->userConfig->getValueString(
                $uid, self::APP, 'download_search_index', '[]', lazy: true,
            );
            $jobs = json_decode($raw, true);
            if (!is_array($jobs) || count($jobs) > 100) {
                continue;
            }
            $old = json_decode($this->userConfig->getValueString(
                $uid, self::APP, 'activity_seen', '{}', lazy: true,
            ), true);
            if (!is_array($old)) {
                $old = [];
            }
            $seen = $old;
            foreach ($jobs as $job) {
                if (!is_array($job) || !is_string($job['id'] ?? null)) {
                    continue;
                }
                $id = $job['id'];
                $status = $job['status'] ?? '';
                if (!in_array($status, ['completed', 'failed', 'cancelled'], true)
                    || ($old[$id] ?? null) === $status) {
                    continue;
                }
                $title = (string)($job['title'] ?? 'Download');
                $filenames = $job['files'] ?? [];
                if (is_array($filenames) && count($filenames) > 0 && is_string($filenames[0])) {
                    $title = $filenames[0];
                }
                $event = $this->activity->generateEvent();
                $event->setApp(self::ACTIVITY_APP)
                    ->setType('downloader_bridge_download')
                    ->setAffectedUser($uid)
                    ->setAuthor($uid)
                    ->setSubject('download_' . $status, ['title' => mb_substr($title, 0, 180)])
                    ->setObject('download', $id, mb_substr($title, 0, 180));
                $this->activity->publish($event);
                $seen[$id] = $status;
            }
            if ($seen !== $old) {
                $this->userConfig->setValueString(
                    $uid, self::APP, 'activity_seen',
                    json_encode(array_slice($seen, -100, null, true), JSON_UNESCAPED_UNICODE),
                    lazy: true,
                );
            }
        }
    }

    private function isEntitled(string $uid): bool {
        $list = (string)$this->appConfig->getValueString(self::APP, 'allowed_users', '', lazy: true);
        $users = array_map('trim', preg_split('/[,\r\n]+/', $list) ?: []);
        if (in_array($uid, $users, true)) {
            return true;
        }
        $list = (string)$this->appConfig->getValueString(self::APP, 'allowed_groups', '', lazy: true);
        foreach (array_filter(array_map('trim', preg_split('/[,\r\n]+/', $list) ?: [])) as $group) {
            if ($this->groupManager->isInGroup($uid, $group)) {
                return true;
            }
        }
        return false;
    }
}
