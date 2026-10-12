# Diretrizes de saída em português do Brasil (pt-BR)

Este arquivo traz orientações específicas para gerar o conteúdo do grafo de conhecimento em português do Brasil.

## Convenções de tags

Use tags em minúsculas, separadas por hífen. Termos técnicos consagrados ficam em inglês; tags descritivas vão em português:

| Padrão | Tags recomendadas |
|---------|-----------------|
| Arquivo de ponto de entrada | `ponto-de-entrada`, `barrel`, `exports` |
| Funções utilitárias | `utilitario`, `helpers`, `comum` |
| Handlers de API | `api-handler`, `controller`, `endpoint` |
| Modelos de dados | `modelo-de-dados`, `entidade`, `schema` |
| Arquivos de teste | `teste`, `teste-unitario`, `teste-de-integracao` |
| Configuração | `configuracao`, `build-system`, `settings` |
| Infraestrutura | `infraestrutura`, `deploy`, `container` |
| Documentação | `documentacao`, `guia`, `referencia`, `adr` |

**Estratégia mista:** mantenha em inglês os termos técnicos sem tradução estabelecida (`middleware`, `api-handler`, `pushdown`); use português nas tags descritivas. Evite acentos nas tags para facilitar a busca (`configuracao`, não `configuração`); nos resumos, use a grafia correta com acentos.

## Estilo dos resumos

Escreva resumos de 1 a 2 frases que:
- Descrevam o **propósito** e o **papel** do item no projeto
- Usem voz ativa, começando pelo verbo no presente ("Fornece...", "Trata...", "Gerencia...", "Converte...")
- Não repitam o nome do arquivo

**Exemplos:**
- Bom: "Fornece helpers de formatação de datas e sanitização de strings usados em toda a camada de API."
- Ruim: "O arquivo utils contém funções utilitárias."

## Termos técnicos

Mantenha estes termos em inglês (sem tradução):
- `middleware`, `hook`, `barrel`, `entry-point`
- `ORM`, `REST API`, `CI/CD`, `CRUD`
- `singleton`, `factory`, `observer`
- `interceptor`, `guard`, `trait`, `crate`, `pushdown`, `spill`

Prefira o termo usual no Brasil quando ele existir: "consulta" (query), "esquema" ou `schema`, "fila" (queue), "camada" (layer), "implantação" ou deploy, "teste" (test).

## Nomes de camadas

Use nomes de camada em português:
- `Camada de API`, `Camada de Serviço`, `Camada de Dados`, `Camada de Interface`
- `Infraestrutura`, `Configuração`, `Documentação`
- `Camada de Utilitários`, `Camada de Middleware`, `Camada de Testes`
