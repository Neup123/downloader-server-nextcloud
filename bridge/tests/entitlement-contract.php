<?php
declare(strict_types=1);

// Execute the native bridge's production entitlement policy without booting
// Nextcloud. JSON in on STDIN; no credentials, network or DB needed.
require_once dirname(__DIR__) . '/lib/EntitlementPolicy.php';

use OCA\DownloaderBridge\EntitlementPolicy;

$fixtures = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
if (!is_array($fixtures)) {
    throw new RuntimeException('Fixture list required');
}
$output = [];
foreach ($fixtures as $item) {
    if (!is_array($item)) {
        throw new RuntimeException('Invalid fixture');
    }
    $userGroups = $item['user_groups'] ?? [];
    $membershipUnavailable = $item['membership_unavailable'] ?? false;
    $output[] = EntitlementPolicy::allows(
        $item['user_id'],
        $item['allowed_users'],
        $item['allowed_groups'],
        static function (string $uid, string $group) use ($userGroups, $membershipUnavailable): bool {
            if ($membershipUnavailable) {
                throw new RuntimeException('Group directory unavailable');
            }
            return in_array($group, $userGroups, true);
        },
    );
}
echo json_encode($output, JSON_THROW_ON_ERROR), "\n";
