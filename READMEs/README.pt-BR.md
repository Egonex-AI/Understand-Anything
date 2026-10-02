<h1 align="center">Understand Anything</h1>

<p align="center">
  <strong>Transforme qualquer base de código, base de conhecimento ou documentação em um grafo de conhecimento interativo que você pode explorar, pesquisar e questionar.</strong>
  <br />
  <em>Funciona com Claude Code, Codex, Cursor, Copilot, Gemini CLI e muito mais.</em>
</p>

<p align="center">
  <strong>Understand Anything. <a href="https://egonex.ai">Understand Anyone.</a></strong>
  <br />
  <em>A IA deve ajudar as pessoas, não substituí-las.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Understand Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a> | <a href="README.pt-BR.md">Português</a>
</p>

<p align="center">
  <a href="#-início-rápido"><img src="https://img.shields.io/badge/Início_rápido-blue" alt="Quick Start" /></a>
  <a href="https://github.com/Egonex-AI/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/Licença-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="#mistral-vibe-cli"><img src="https://img.shields.io/badge/Vibe_CLI-7c3aed" alt="Vibe CLI" /></a>
  <a href="#trae"><img src="https://img.shields.io/badge/Trae-7e22ce" alt="Trae" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/Site-d4a574" alt="Homepage" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/Demo_ao_vivo-00c853" alt="Live Demo" /></a>
  <a href="https://egonex.ai"><img src="https://img.shields.io/badge/Understand_Anyone-egonex.ai-d4a574" alt="Understand Anyone" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — Transforme qualquer base de código em um grafo de conhecimento interativo" width="800" />
</p>

<p align="center">
  <strong>An open-source project from <a href="https://github.com/Egonex-AI">Egonex</a></strong>
  <br />
  <em>Originally created by <a href="https://github.com/Lum1104">Lum1104</a>.</em>
</p>

---

**Você acabou de entrar em um novo time. A base de código tem 200 mil linhas. Por onde começar?**

O Understand Anything é um [plugin do Claude Code](https://code.claude.com/docs/en/plugins-reference#plugins-reference) que analisa seu projeto com um pipeline multiagente, constrói um grafo de conhecimento com todos os arquivos, funções, classes e dependências e, então, oferece um dashboard interativo para explorar tudo visualmente. Pare de ler código no escuro. Comece a enxergar o panorama completo.

> **O objetivo não é um grafo que impressiona pela complexidade da sua base de código — é um grafo que ensina, discretamente, como cada peça se encaixa.**

---

## ✨ Recursos

> [!NOTE]
> **Quer pular a leitura?** Experimente a [demo ao vivo](https://understand-anything.com/demo/) no nosso [site](https://understand-anything.com/) — um dashboard totalmente interativo que você pode mover, ampliar, pesquisar e explorar direto no navegador.

### Explore o grafo estrutural

Navegue pela sua base de código como um grafo de conhecimento interativo — cada arquivo, função e classe é um nó em que você pode clicar, pesquisar e explorar. Selecione qualquer nó para ver resumos em linguagem simples, relações e tours guiados.

### Entenda a lógica de negócio

Alterne para a visão de domínio e veja como seu código se relaciona com processos de negócio reais — domínios, fluxos e etapas dispostos em um grafo horizontal.

### Analise bases de conhecimento

Aponte o `/understand-knowledge` para um [wiki de LLM no padrão Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) e obtenha um grafo de conhecimento force-directed com clusterização por comunidade. O parser determinístico extrai wikilinks e categorias do `index.md`; em seguida, agentes de LLM descobrem relações implícitas, extraem entidades e evidenciam afirmações — transformando seu wiki em um grafo navegável de ideias interconectadas.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 Tours guiados</h3>
      <p>Passo a passo da arquitetura gerado automaticamente e ordenado por dependência. Aprenda a base de código na ordem certa.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Busca aproximada e semântica</h3>
      <p>Encontre qualquer coisa por nome ou por significado. Busque "quais partes cuidam de autenticação?" e receba resultados relevantes em todo o grafo.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Análise de impacto de diff</h3>
      <p>Veja quais partes do sistema suas mudanças afetam antes de fazer o commit. Entenda os efeitos em cadeia pela base de código.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 UI adaptável ao perfil</h3>
      <p>O dashboard ajusta o nível de detalhe conforme quem está usando — pessoa dev júnior, PM ou usuário avançado.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ Visualização por camadas</h3>
      <p>Agrupamento automático por camada arquitetural — API, Serviço, Dados, UI, Utilitários — com legenda colorida.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Conceitos de linguagem</h3>
      <p>12 padrões de programação (generics, closures, decorators etc.) explicados no contexto em que aparecem.</p>
    </td>
  </tr>
</table>

---

## 🚀 Início rápido

### 1. Instale o plugin

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

> **Usa um modelo local?** Para cenários de privacidade ou corporativos, aponte sua plataforma para um provedor de modelo local como o [Ollama](https://docs.ollama.com/integrations) — siga o guia de integração deles para trocar o provedor de modelo.

### 2. Analise sua base de código

```bash
/understand
```

Um pipeline multiagente varre seu projeto, extrai todos os arquivos, funções, classes e dependências e então constrói um grafo de conhecimento salvo em `.ua/knowledge-graph.json`. (Projetos que já têm um diretório `.understand-anything/` continuam usando ele — quando presente, ele permanece o diretório de dados, então não é preciso migrar nada.)

> **Atenção ao consumo de tokens:** o `/understand` inicial analisa toda a sua base de código e pode consumir uma quantidade significativa de tokens em projetos grandes. Recomendamos executá-lo com um plano/assinatura de tokens, ou usar um modelo local (veja acima) para a inicialização. As execuções seguintes são incrementais por padrão — apenas os arquivos alterados são reanalisados —, então consomem muito menos tokens.

**Saída localizada:** use `--language` para gerar conteúdo no idioma da sua preferência:

```bash
# Gerar conteúdo em português do Brasil (descrições dos nós do grafo e UI do dashboard)
/understand --language pt

# Idiomas suportados: en (padrão), zh, zh-TW, ja, ko, ru, pt
```

Na **primeira execução** em um projeto — quando você não passa `--language` e nenhum idioma foi salvo ainda — o `/understand` detecta o idioma em que você está conversando. Se não for inglês, ele pede confirmação (ou uma troca) antes de gerar; conversas em inglês não são afetadas. Sua escolha é salva em `.ua/config.json` e reutilizada em todas as execuções seguintes.

O parâmetro `--language` afeta:
- Resumos e descrições dos nós no grafo de conhecimento
- Rótulos, botões e tooltips da UI do dashboard
- Explicações dos tours guiados

### 3. Explore o dashboard

```bash
/understand-dashboard
```

Um dashboard web interativo abre com sua base de código visualizada como um grafo — colorido por camada arquitetural, pesquisável e clicável. Selecione qualquer nó para ver seu código, suas relações e uma explicação em linguagem simples.

### 4. Continue aprendendo

```bash
# Pergunte qualquer coisa sobre a base de código
/understand-chat Como funciona o fluxo de pagamento?

# Analise o impacto das suas mudanças atuais
/understand-diff

# Aprofunde-se em um arquivo ou função específicos
/understand-explain src/auth/login.ts

# Gere um guia de onboarding para novas pessoas no time
/understand-onboard

# Extraia conhecimento de domínio de negócio (domínios, fluxos, etapas)
/understand-domain

# Analise uma base de conhecimento wiki de LLM no padrão Karpathy
/understand-knowledge ~/caminho/para/wiki

# Rode novamente quando quiser — incremental por padrão (só reanalisa arquivos alterados)
/understand

# Atualize automaticamente a cada commit via hook post-commit
/understand --auto-update

# Limite a análise a um subdiretório (para monorepos enormes)
/understand src/frontend
```

---

## 🌐 Instalação multiplataforma

O Understand-Anything funciona em várias plataformas de programação com IA.

### Claude Code (nativo)

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```


### Instalação em uma linha (Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI / Trae / Nanobot / Kiro)


**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash
# ou pule o prompt informando a plataforma:
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s codex
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.ps1 | iex
```

O instalador clona o repositório em `~/.understand-anything/repo` e cria os symlinks corretos para a plataforma escolhida. Reinicie sua CLI/IDE depois.

> **Sobre como invocar as skills:** o prefixo de invocação varia por plataforma. A maioria usa comandos de barra (`/understand`), mas o **Codex usa `$`** — digite `$understand`, não `/understand`. Se nenhum dos prefixos for reconhecido na sua plataforma, basta pedir em linguagem natural: *"Use a skill understand para analisar este projeto."*

- Valores de `<platform>` suportados: `gemini`, `codex`, `opencode`, `pi`, `openclaw`, `antigravity`, `vibe`, `vscode`, `hermes`, `cline`, `kimi`, `trae`, `nanobot`, `kiro`
- Atualizar depois: `./install.sh --update`
- Desinstalar: `./install.sh --uninstall <platform>`

### Cursor

O Cursor descobre o plugin automaticamente via `.cursor-plugin/plugin.json` quando este repositório é clonado. Não é preciso instalar nada manualmente — basta clonar e abrir no Cursor.

Se a descoberta automática não funcionar, instale manualmente: abra **Cursor Settings → Plugins**, cole `https://github.com/Egonex-AI/Understand-Anything` no campo de busca e adicione a partir dali.

### VS Code + GitHub Copilot

O VS Code com GitHub Copilot (v1.108+) descobre o plugin automaticamente via `.copilot-plugin/plugin.json` quando este repositório é clonado. Não é preciso instalar nada manualmente — basta clonar e abrir no VS Code.

Para skills pessoais (disponíveis em todos os projetos), execute o `install.sh` acima com a plataforma `vscode`.

### Copilot CLI

```bash
copilot plugin install Egonex-AI/Understand-Anything:understand-anything-plugin
```

### Kiro CLI / IDE

```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s kiro
```

Após a instalação:
- **Kiro CLI**: `kiro-cli chat --agent understand "Analise este projeto"`
- **Kiro IDE**: as skills são vinculadas por symlink em `~/.kiro/skills/` e o agente `understand` é gravado em `~/.kiro/agents/understand.json`, então ambos ficam disponíveis após reiniciar a IDE.

Para skills pessoais (disponíveis em todos os projetos), execute o `install.sh` acima com a plataforma `kiro`.

### Compatibilidade de plataformas

| Plataforma | Status | Método de instalação |
|----------|--------|----------------|
| Claude Code | ✅ Nativo | Marketplace de plugins |
| Cursor | ✅ Suportado | Descoberta automática |
| VS Code + GitHub Copilot | ✅ Suportado | Descoberta automática |
| Copilot CLI | ✅ Suportado | Instalação de plugin |
| Codex | ✅ Suportado | `install.sh codex` |
| OpenCode | ✅ Suportado | `install.sh opencode` |
| OpenClaw | ✅ Suportado | `install.sh openclaw` |
| Antigravity | ✅ Suportado | `install.sh antigravity` |
| Gemini CLI | ✅ Suportado | `install.sh gemini` |
| Pi Agent | ✅ Suportado | `install.sh pi` |
| Vibe CLI | ✅ Suportado | `install.sh vibe` |
| Hermes | ✅ Suportado | `install.sh hermes` |
| Cline | ✅ Suportado | `install.sh cline` |
| KIMI CLI | ✅ Suportado | `install.sh kimi` |
| Trae | ✅ Suportado | `install.sh trae` |
| Nanobot | ✅ Suportado | `install.sh nanobot` |
| Kiro CLI / IDE | ✅ Suportado | `install.sh kiro` |


---

## 📦 Compartilhe o grafo com seu time

O grafo é apenas JSON — **faça o commit uma vez e o time inteiro pula o pipeline**. Ótimo para onboarding, revisões de PR e docs-as-code.

> **Exemplo:** [GoogleCloudPlatform/microservices-demo](https://github.com/GoogleCloudPlatform/microservices-demo) — referência em Go / Java / Python / Node com um grafo commitado.

**O que commitar:** tudo em `.ua/` *exceto* `intermediate/` e `diff-overlay.json` (esses são rascunhos locais). (Projetos legados usam `.understand-anything/` — substitua o nome do diretório abaixo se for esse o presente.)

```gitignore
.ua/intermediate/
.ua/diff-overlay.json
```

**Mantenha atualizado:** habilite o `/understand --auto-update` — um hook post-commit aplica patches incrementais no grafo, de modo que cada commit chegue com um grafo correspondente. Ou rode `/understand` manualmente antes dos releases.

**Grafos grandes (10 MB+):** versione com **git-lfs**.

```bash
git lfs install
git lfs track ".ua/*.json"
git add .gitattributes .ua/
```

### Veja o dashboard sem o Claude Code

Depois que um grafo é gerado e commitado, qualquer pessoa do time pode abri-lo com um único comando — sem Claude Code, sem LLM, sem chave de API. Só é necessário Node.js (>= 18):

```bash
npx https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/understand-anything-viewer.tgz /caminho/para/projeto/analisado
```

O terminal imprime uma URL com token (`http://127.0.0.1:5173/?token=…`) e abre o dashboard interativo completo no seu navegador. O diretório do projeto (padrão: diretório atual) precisa conter o diretório de dados commitado (`.ua/` ou o legado `.understand-anything/`). Tudo é servido em modo somente leitura a partir do disco local — sem chamadas de LLM, nenhum dado sai da sua máquina.

Trabalhando a partir de um clone? `pnpm install && pnpm --filter @understand-anything/core build` e depois `GRAPH_DIR=/caminho/para/projeto/analisado pnpm dev:dashboard` fazem o mesmo via servidor de desenvolvimento do Vite.

---

## 🔧 Por baixo dos panos

### Híbrido tree-sitter + LLM

Análise estática e LLMs fazem, cada um, o que fazem de melhor:

- **Tree-sitter (determinístico)** — faz o parsing do código-fonte em uma árvore sintática concreta e extrai fatos estruturais: imports, exports, definições de funções/classes, pontos de chamada, herança. Tudo é pré-resolvido em um `importMap` durante a fase de varredura e passado aos file-analyzers, para que eles não precisem rederivar os imports do código-fonte. Mesma entrada → mesma saída, em toda execução. Também alimenta a detecção de mudanças por fingerprint usada nas atualizações incrementais.
- **LLM (semântico)** — lê a estrutura já parseada junto com o código-fonte original para produzir o que parsers não conseguem: resumos em linguagem simples, tags, atribuição de camadas arquiteturais, mapeamento de domínio de negócio, tours guiados e destaques de conceitos de linguagem.

Essa divisão é o motivo de o grafo ser reprodutível no lado estrutural (o mesmo código sempre gera as mesmas arestas) e, ao mesmo tempo, capturar intenção no lado semântico (para que um arquivo *serve*, não apenas o que ele importa).

### Pipeline multiagente

O comando `/understand` orquestra 5 agentes especializados, e o `/understand-domain` acrescenta um 6º:

| Agente | Papel |
|-------|------|
| `project-scanner` | Descobre arquivos, detecta linguagens e frameworks |
| `file-analyzer` | Extrai funções, classes e imports; produz nós e arestas do grafo |
| `architecture-analyzer` | Identifica camadas arquiteturais |
| `tour-builder` | Gera tours guiados de aprendizado |
| `graph-reviewer` | Valida a completude do grafo e a integridade referencial (roda inline por padrão; use `--review` para a revisão completa por LLM) |
| `domain-analyzer` | Extrai domínios de negócio, fluxos e etapas de processo (usado pelo `/understand-domain`) |
| `article-analyzer` | Extrai entidades, afirmações e relações implícitas de artigos de wiki (usado pelo `/understand-knowledge`) |

Os file-analyzers rodam em paralelo (até 5 simultâneos, 20-30 arquivos por lote). Há suporte a atualizações incrementais — só são reanalisados os arquivos que mudaram desde a última execução.

---

## 🎥 Comunidade

Um passo a passo feito pela comunidade, por **Better Stack**.

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Community walkthrough by Better Stack — watch on YouTube" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">Assista no YouTube &rarr;</a></em>
</p>

Fez um vídeo, post de blog ou tutorial? Abra uma issue ou PR — teremos prazer em destacá-lo aqui.

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Veja como começar:

1. Faça um fork do repositório
2. Crie uma branch de feature (`git checkout -b feature/minha-feature`)
3. Rode os testes (`pnpm --filter @understand-anything/core test`)
4. Faça o commit das suas mudanças e abra um pull request

Para mudanças grandes, abra uma issue primeiro para discutirmos a abordagem.

---

<p align="center">
  <strong>Pare de ler código no escuro. Comece a entender tudo.</strong>
</p>

## Histórico de estrelas

<a href="https://www.star-history.com/?repos=Egonex-AI%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>Obrigado a todas as pessoas que usaram e contribuíram — saber que isso economiza tempo de gente real é o que fez valer a pena construir.</em>
</p>

<p align="center">
  MIT License &copy; Yuxiang Lin and Infinite Universe, Inc.
</p>
