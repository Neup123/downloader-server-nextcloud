<?php
declare(strict_types=1);

// CI-only executable bridge contract: read JSON status samples from STDIN,
// answer using exactly the class ActivitySync loads in production.
require_once dirname(__DIR__) . '/lib/JobStateContract.php';

use OCA\DownloaderBridge\JobStateContract;

$samples = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
if (!is_array($samples)) {
    throw new RuntimeException('Expected an array of status samples');
}

echo json_encode([
    'all' => JobStateContract::ALL,
    'terminal' => JobStateContract::TERMINAL,
    'checks' => array_map(
        static fn (mixed $state): bool => JobStateContract::isTerminal($state),
        $samples,
    ),
], JSON_THROW_ON_ERROR), "\n";
