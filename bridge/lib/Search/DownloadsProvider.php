<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge\Search;

use OCP\Config\IUserConfig;
use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IUser;
use OCP\IURLGenerator;
use OCP\Search\IProvider;
use OCP\Search\ISearchQuery;
use OCP\Search\SearchResult;
use OCP\Search\SearchResultEntry;

/**
 * Native unified-search UI adapter. It reads current-user metadata only.
 * No downloading, WebDAV, file access or core API token is present in PHP.
 * Nextcloud's existing Files search handles delivered file contents/names.
 */
final class DownloadsProvider implements IProvider {
    private const APP = 'downloader-server-nextcloud';

    public function __construct(
        private IUserConfig $userConfig,
        private IAppConfig $appConfig,
        private IGroupManager $groupManager,
        private IURLGenerator $urlGenerator,
    ) {
    }

    public function getId(): string {
        return 'downloader_bridge_jobs';
    }

    public function getName(): string {
        return 'Downloads';
    }

    public function getOrder(string $route, array $routeParameters): ?int {
        return 40;
    }

    public function search(IUser $user, ISearchQuery $query): SearchResult {
        $uid = $user->getUID();
        if (!$this->entitled($uid)) {
            return SearchResult::complete('Downloads', []);
        }
        // The AppAPI preferences_ex interface writes lazy user config under
        // the ExApp ID using Nextcloud's standard IUserConfig storage.
        $json = $this->userConfig->getValueString(
            $uid, self::APP, 'download_search_index', '[]', lazy: true,
        );
        $items = json_decode($json, true);
        if (!is_array($items)) {
            return SearchResult::complete('Downloads', []);
        }
        $term = trim($query->getTerm());
        if ($term === '') {
            return SearchResult::complete('Downloads', []);
        }
        $limit = max(1, min(50, $query->getLimit()));
        $results = [];
        foreach ($items as $item) {
            if (!is_array($item) || !is_string($item['id'] ?? null)) {
                continue;
            }
            $title = (string)($item['title'] ?? 'Download');
            $status = (string)($item['status'] ?? '');
            $engine = (string)($item['engine'] ?? '');
            $filenames = array_filter($item['files'] ?? [], 'is_string');
            $haystack = implode(' ', [$title, $status, $engine, ...$filenames]);
            if (mb_stripos($haystack, $term) === false) {
                continue;
            }
            $filename = count($filenames) > 0 ? implode(', ', array_slice($filenames, 0, 2)) : $title;
            $subline = trim($status . ' · ' . $engine . ' · ' . $filename);
            $route = '/apps/downloader_bridge/library?job='
                . rawurlencode($item['id']);
            $url = $this->urlGenerator->getAbsoluteURL($route);
            $results[] = new SearchResultEntry(
                '', $filename, mb_substr($subline, 0, 250), $url, 'icon-download',
            );
            if (count($results) >= $limit) {
                break;
            }
        }
        return SearchResult::complete('Downloads', $results);
    }

    private function entitled(string $uid): bool {
        if ($uid === '') {
            return false;
        }
        $users = $this->ids($this->appConfig->getValueString(self::APP, 'allowed_users', '', lazy: true));
        if (in_array($uid, $users, true)) {
            return true;
        }
        foreach ($this->ids($this->appConfig->getValueString(self::APP, 'allowed_groups', '', lazy: true)) as $group) {
            if ($this->groupManager->isInGroup($uid, $group)) {
                return true;
            }
        }
        return false;
    }

    /** @return string[] */
    private function ids(string $value): array {
        return array_values(array_filter(
            array_map('trim', preg_split('/[,\r\n]+/', $value) ?: []),
            static fn (string $part): bool => $part !== '',
        ));
    }
}
