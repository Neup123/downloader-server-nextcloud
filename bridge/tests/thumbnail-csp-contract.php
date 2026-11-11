<?php
declare(strict_types=1);

// Standalone Nextcloud CSP contract, runnable without a server installation.
namespace OCP\EventDispatcher {
    class Event {}
    interface IEventListener {
        public function handle(Event $event): void;
    }
}

namespace OCP {
    interface IRequest {
        public function getMethod(): string;
        public function getHeader(string $name): string;
    }
}

namespace OCP\AppFramework\Http {
    class ContentSecurityPolicy {
        /** @var array<array{string, string}> */
        private array $mutations = [];

        public function addAllowedImageDomain(string $domain): self {
            $this->mutations[] = ['addAllowedImageDomain', $domain];
            return $this;
        }

        public function mutations(): array {
            return $this->mutations;
        }

        public function __call(string $method, array $arguments): self {
            $this->mutations[] = [$method, (string)($arguments[0] ?? '')];
            return $this;
        }
    }
}

namespace OCP\Security\CSP {
    class AddContentSecurityPolicyEvent extends \OCP\EventDispatcher\Event {
        public array $policies = [];

        public function addPolicy(\OCP\AppFramework\Http\ContentSecurityPolicy $policy): void {
            $this->policies[] = $policy;
        }
    }
}

namespace {
    use OCA\DownloaderBridge\Listener\ThumbnailContentSecurityPolicyListener;
    use OCP\EventDispatcher\Event;
    use OCP\IRequest;
    use OCP\Security\CSP\AddContentSecurityPolicyEvent;

    require_once dirname(__DIR__) . '/lib/Listener/ThumbnailContentSecurityPolicyListener.php';

    $application = file_get_contents(dirname(__DIR__) . '/lib/AppInfo/Application.php');
    if ($application === false) {
        throw new RuntimeException('Application registration not readable');
    }

    $registered = (bool)preg_match(
        '/registerEventListener\(\s*AddContentSecurityPolicyEvent::class\s*,\s*ThumbnailContentSecurityPolicyListener::class\s*\)/',
        $application,
    );

    $request = new class implements IRequest {
        public string $method = 'GET';
        public string $accept = 'text/html,application/xhtml+xml';

        public function getMethod(): string {
            return $this->method;
        }

        public function getHeader(string $name): string {
            return strtolower($name) === 'accept' ? $this->accept : '';
        }
    };

    $listener = new ThumbnailContentSecurityPolicyListener($request);
    $htmlEvent = new AddContentSecurityPolicyEvent();
    $listener->handle($htmlEvent);

    $request->method = 'POST';
    $postEvent = new AddContentSecurityPolicyEvent();
    $listener->handle($postEvent);

    $request->method = 'GET';
    $request->accept = 'application/json';
    $apiEvent = new AddContentSecurityPolicyEvent();
    $listener->handle($apiEvent);

    $request->accept = 'text/html';
    $wrongEvent = new Event();
    $listener->handle($wrongEvent);

    echo json_encode([
        'registered' => $registered,
        'policy_count' => count($htmlEvent->policies),
        'policy_class' => isset($htmlEvent->policies[0]) ? get_class($htmlEvent->policies[0]) : null,
        'mutations' => $htmlEvent->policies[0]->mutations() ?? [],
        'post_policy_count' => count($postEvent->policies),
        'api_policy_count' => count($apiEvent->policies),
    ], JSON_THROW_ON_ERROR), "\n";
}
