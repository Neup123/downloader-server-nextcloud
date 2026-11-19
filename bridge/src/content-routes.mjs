/** Shared signed Nextcloud gateway + native plugin route contract. Not a Core UI. */
import contract from './content-routes.contract.json' with { type: 'json' };

export const DEFAULT_FOLDER = contract.default_folder;
export const CONTENT_ROUTES = Object.freeze(
  contract.categories.map(row => Object.freeze({
    id: row.id, label: row.label, subfolder: row.subfolder,
    source_kinds: Object.freeze([...row.source_kinds]),
  })),
);
export const SOURCE_KIND_TO_ROUTE = Object.freeze(Object.fromEntries(
  CONTENT_ROUTES.flatMap(row => row.source_kinds.map(kind => [kind, row.id])),
));
export const SUPPORTED_SOURCE_KINDS = Object.freeze(Object.keys(SOURCE_KIND_TO_ROUTE));
export function contentCategoryFor(kind, audioOnly = false) {
  if (!Object.hasOwn(SOURCE_KIND_TO_ROUTE, kind)) {
    throw new Error('Unsupported content type.');
  }
  return audioOnly ? 'audio' : SOURCE_KIND_TO_ROUTE[kind];
}
