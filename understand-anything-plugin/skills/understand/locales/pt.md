# Guia de saída em português (Portuguese)

Este arquivo contém as diretrizes de idioma para gerar o conteúdo do grafo de conhecimento em português.

## Convenções de tags

Use tags em português ou termos técnicos consagrados em inglês:

| Padrão | Tags recomendadas |
|--------|-------------------|
| Ponto de entrada | `ponto-de-entrada`, `barrel`, `exports` ou `entry-point` |
| Funções utilitárias | `utilitarios`, `helpers`, `common` ou `utility` |
| Handlers de API | `api-handler`, `controlador`, `endpoint` |
| Modelos de dados | `modelo-de-dados`, `entity`, `schema` ou `data-model` |
| Arquivos de teste | `testes`, `unit-test`, `test` |
| Arquivos de configuração | `configuracao`, `build-system`, `settings` ou `configuration` |
| Infraestrutura | `infraestrutura`, `deployment`, `conteinerizacao` ou `infrastructure` |
| Documentação | `documentacao`, `guia`, `documentation` |

**Estratégia mista:** mantenha em inglês os termos técnicos consagrados (por exemplo, `middleware`, `api-handler`) e escreva em português as tags descritivas.

## Estilo dos resumos

Escreva resumos de 1 a 2 frases em português:
- Descreva o **propósito** e o **papel** do arquivo
- Use voz ativa ("fornece...", "processa...", "gerencia...")
- Evite repetir o nome do arquivo

**Exemplos:**
- Bom: "Fornece funções auxiliares para formatação de datas e sanitização de strings, amplamente usadas na camada de API."
- Ruim: "O arquivo utils contém funções utilitárias."

## Termos técnicos

Recomenda-se manter os termos a seguir em inglês (não há tradução consagrada):
- `middleware`, `hook`, `barrel`, `entry-point`
- `ORM`, `REST API`, `CI/CD`, `CRUD`
- `singleton`, `factory`, `observer`
- `interceptor`, `guard`, `deploy`, `build`

## Nomes de camadas

Use nomes de camada em português:
- `Camada de API`, `Camada de Serviços`, `Camada de Dados`, `Camada de UI`
- `Infraestrutura`, `Configuração`, `Documentação`
- `Camada de Utilitários`, `Camada de Middleware`, `Camada de Testes`

Ou mantenha os nomes em inglês (conforme a convenção da equipe):
- `API Layer`, `Service Layer`, `Data Layer`
