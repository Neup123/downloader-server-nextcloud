<?php
declare(strict_types=1);

namespace OCA\DownloaderBridge;

/**
 * The native PHP bridge's entitlement policy. The ExApp's Python decision
 * remains the authoritative API gate; this helper only decides whether to
 * offer native Activity UI to a Nextcloud user.
 *
 * Keep in parity with nextcloud_exapp/user.py entitlement() using the
 * shared cross-language fixture test (tests/test_nextcloud_entitlement_contract.py).
 */
final class EntitlementPolicy {
    /** @return list<string> */
    private static function identifiers(string $value): array {
        $parts = preg_split('/[,\r\n]+/', $value) ?: [];
        $result = [];
        foreach ($parts as $part) {
            $id = trim($part);
            if ($id !== '') {
                $result[] = $id;
            }
        }
        return array_values(array_unique($result));
    }

    /**
     * @param callable(string,string):bool $isInGroup
     */
    public static function allows(
        string $uid,
        string $allowedUsers,
        string $allowedGroups,
        callable $isInGroup,
    ): bool {
        if ($uid === '') {
            return false;
        }
        if (in_array($uid, self::identifiers($allowedUsers), true)) {
            return true;
        }
        foreach (self::identifiers($allowedGroups) as $group) {
            try {
                if ($isInGroup($uid, $group)) {
                    return true;
                }
            } catch (\Throwable) {
                // Unknown directory membership is NOT an entitlement grant.
                return false;
            }
        }
        return false;
    }
}
