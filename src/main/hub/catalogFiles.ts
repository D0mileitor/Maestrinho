/// <reference types="vite/client" />
// Partituras prontas embutidas no app: todo .json de exemplos/partituras entra no bundle no build.
// Para incluir uma nova, basta salvar o arquivo na pasta (formato em CatalogFileSchema, src/shared/hub.ts).

/** Conteúdo cru de cada arquivo, pelo caminho; o HubCatalog valida tudo antes de usar. */
export const CATALOG_FILES: Readonly<Record<string, unknown>> = import.meta.glob('../../../exemplos/partituras/*.json', {
  eager: true,
  import: 'default'
})
