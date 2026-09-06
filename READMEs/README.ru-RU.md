<h1 align="center">Understand Anything</h1>

<p align="center">
  <strong>Превращай любую кодовую базу, базу знаний или документацию в интерактивный граф знаний, который можно исследовать, искать в нём и задавать вопросы.</strong>
  <br />
  <em>Работает с Claude Code, Codex, Cursor, Copilot, Gemini CLI и другими.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Understand Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a>
</p>

<p align="center">
  <a href="#-быстрый-старт"><img src="https://img.shields.io/badge/Быстрый_старт-blue" alt="Quick Start" /></a>
  <a href="https://github.com/Egonex-AI/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/Лицензия-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/Сайт-d4a574" alt="Homepage" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/Демо-00c853" alt="Live Demo" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — Превратите любую кодовую базу в интерактивный граф знаний" width="800" />
</p>

<p align="center">
  <strong>An open-source project from <a href="https://github.com/Egonex-AI">Egonex</a></strong>
  <br />
  <em>Originally created by <a href="https://github.com/Lum1104">Lum1104</a>.</em>
</p>

---

**Вы только что присоединились к новой команде. Кодовая база — 200 000 строк. С чего вообще начинать?**

Understand Anything — это [плагин для Claude Code](https://code.claude.com/docs/en/plugins-reference#plugins-reference), который анализирует ваш проект с помощью мультиагентного пайплайна, строит граф знаний из всех файлов, функций, классов и зависимостей, а затем предоставляет интерактивную панель, чтобы исследовать всё это визуально. Хватит читать код вслепую. Пора увидеть общую картину.

> **Цель — не граф, который поражает сложностью вашей кодовой базы, а граф, который ненавязчиво объясняет, как все части складываются вместе.**

---

## ✨ Возможности

> [!NOTE]
> **Хотите пропустить чтение?** Попробуйте [живое демо](https://understand-anything.com/demo/) на нашем [сайте](https://understand-anything.com/) — полностью интерактивная панель, по которой можно перемещаться, масштабировать, искать и исследовать прямо в браузере.

### Исследуйте структурный граф

Перемещайтесь по своему коду как по интерактивному графу знаний — каждый файл, функция и класс является узлом, который можно кликнуть, найти и изучить. Выберите любой узел, чтобы увидеть понятные описания, связи и пошаговые обзоры.

### Понимайте бизнес-логику

Переключитесь на доменное представление и увидите, как ваш код отображается на реальные бизнес-процессы — домены, потоки и шаги, выстроенные в виде горизонтального графа.

### Анализируйте базы знаний

Направьте `/understand-knowledge` на [LLM-вики в стиле Карпати](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) и получите force-directed граф знаний с кластеризацией по сообществам. Детерминированный парсер извлекает wikilinks и категории из `index.md`, а LLM-агенты находят неявные связи, извлекают сущности и выявляют утверждения — превращая вашу вики в навигируемый граф взаимосвязанных идей.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 Пошаговые обзоры</h3>
      <p>Автоматически создаваемые экскурсии по архитектуре, упорядоченные по зависимостям. Изучайте кодовую базу в правильном порядке.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Нечёткий и семантический поиск</h3>
      <p>Находите что угодно по имени или по смыслу. Поищите «какие части отвечают за авторизацию?» и получите релевантные результаты по всему графу.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Анализ влияния изменений</h3>
      <p>Смотрите, какие части системы затрагивают ваши изменения, ещё до коммита. Понимайте каскадные эффекты по всей кодовой базе.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 UI, адаптирующийся к роли</h3>
      <p>Панель подстраивает уровень детализации под пользователя — junior-разработчика, PM или продвинутого пользователя.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ Визуализация слоёв</h3>
      <p>Автоматическая группировка по архитектурным слоям — API, Service, Data, UI, Utility — с цветовой легендой.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Концепции языка</h3>
      <p>12 шаблонов программирования (дженерики, замыкания, декораторы и т.д.) объясняются в контексте там, где они встречаются.</p>
    </td>
  </tr>
</table>

---

## 🚀 Быстрый старт

### 1. Установите плагин

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

> **Используете локальную модель?** Для приватных или корпоративных сценариев направьте свою платформу на локального провайдера моделей, например [Ollama](https://docs.ollama.com/integrations) — следуйте его руководству по интеграции, чтобы сменить провайдера модели.

### 2. Проанализируйте кодовую базу

```bash
/understand
```

Мультиагентный пайплайн сканирует ваш проект, извлекает каждый файл, функцию, класс и зависимость, а затем строит граф знаний и сохраняет его в `.ua/knowledge-graph.json`. (Проекты, в которых уже есть каталог `.understand-anything/`, продолжают использовать его — при наличии он остаётся каталогом данных, поэтому ничего мигрировать не нужно.)

> **Обратите внимание на расход токенов:** Первый запуск `/understand` анализирует всю кодовую базу и может потреблять значительное количество токенов на больших проектах. Рекомендуем запускать его с тарифным планом / подпиской на токены или использовать локальную модель (см. выше) для инициализации. Последующие запуски по умолчанию инкрементальны — повторно анализируются только изменённые файлы — поэтому расходуют гораздо меньше токенов.

**Локализованный вывод:** используйте `--language`, чтобы генерировать контент на нужном языке:

```bash
# Генерация контента на русском (описания узлов графа знаний и UI панели)
/understand --language ru

# Поддерживаемые языки: en (по умолчанию), zh, zh-TW, ja, ko, ru
```

Параметр `--language` влияет на:
- Резюме и описания узлов в графе знаний
- Подписи, кнопки и подсказки UI панели
- Объяснения в пошаговых обзорах

### 3. Откройте панель

```bash
/understand-dashboard
```

Открывается интерактивная веб-панель с визуализацией вашей кодовой базы в виде графа — с цветовой кодировкой по архитектурным слоям, поиском и кликабельными узлами. Выберите любой узел, чтобы увидеть его код, связи и описание простым языком.

### 4. Продолжайте учиться

```bash
# Задайте любой вопрос о кодовой базе
/understand-chat How does the payment flow work?

# Проанализируйте влияние ваших текущих изменений
/understand-diff

# Подробно разберитесь с конкретным файлом или функцией
/understand-explain src/auth/login.ts

# Сгенерируйте онбординг-гайд для новых членов команды
/understand-onboard

# Извлеките знания о бизнес-доменах (домены, потоки, шаги)
/understand-domain

# Проанализируйте LLM-вики в стиле Карпати
/understand-knowledge ~/path/to/wiki

# Перезапускайте когда угодно — по умолчанию инкрементально (только изменённые файлы)
/understand

# Установите post-commit хук для автоматических инкрементальных обновлений
/understand --auto-update

# Огромный монорепозиторий? Ограничьте анализ подкаталогом
/understand src/frontend
```

---

## 🌐 Установка на разных платформах

Understand-Anything работает с несколькими платформами AI-разработки.

### Claude Code (нативно)

```bash
/plugin marketplace add Egonex-AI/Understand-Anything
/plugin install understand-anything
```

### Установка одной командой (Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI / Nanobot / Kiro)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash
# или передайте платформу, чтобы пропустить интерактивный выбор:
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s codex
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.ps1 | iex
```

Установщик клонирует репозиторий в `~/.understand-anything/repo` и создаёт нужные симлинки для выбранной платформы. После установки перезапустите свой CLI/IDE.

> **Как вызывать skills:** префикс вызова зависит от платформы. Большинство платформ используют слэш-команды (`/understand`), но **Codex использует `$`** — вводите `$understand`, а не `/understand`. Если ни один префикс не распознаётся, просто попросите обычным языком: *«Используй skill understand, чтобы проанализировать этот проект»*.

- Поддерживаемые значения `<platform>`: `gemini`, `codex`, `opencode`, `pi`, `openclaw`, `antigravity`, `vibe`, `vscode`, `hermes`, `cline`, `kimi`, `nanobot`, `kiro`
- Обновление: `./install.sh --update`
- Удаление: `./install.sh --uninstall <platform>`

### Cursor

Cursor автоматически обнаруживает плагин через `.cursor-plugin/plugin.json` при клонировании этого репозитория. Ручная установка не требуется — просто склонируйте и откройте в Cursor.

Если автообнаружение не сработало, установите вручную: откройте **Cursor Settings → Plugins**, вставьте `https://github.com/Egonex-AI/Understand-Anything` в поле поиска и добавьте оттуда.

### VS Code + GitHub Copilot

VS Code с GitHub Copilot (v1.108+) автоматически обнаруживает плагин через `.copilot-plugin/plugin.json` при клонировании этого репозитория. Ручная установка не требуется — просто склонируйте и откройте в VS Code.

Для персональных skills (доступных во всех проектах) запустите `install.sh` выше с платформой `vscode`.

### Copilot CLI

```bash
copilot plugin install Egonex-AI/Understand-Anything:understand-anything-plugin
```

### Kiro CLI / IDE

```bash
curl -fsSL https://raw.githubusercontent.com/Egonex-AI/Understand-Anything/main/install.sh | bash -s kiro
```

После установки:
- **Kiro CLI**: `kiro-cli chat --agent understand "Проанализируй этот проект"`
- **Kiro IDE**: skills симлинкуются в `~/.kiro/skills/`, а агент `understand` записывается в `~/.kiro/agents/understand.json`, поэтому оба становятся доступны после перезапуска IDE.

Для персональных skills (доступных во всех проектах) запустите `install.sh` выше с платформой `kiro`.

### Совместимость с платформами

| Платформа | Статус | Способ установки |
|----------|--------|----------------|
| Claude Code | ✅ Нативно | Marketplace плагинов |
| Cursor | ✅ Поддерживается | Автообнаружение |
| VS Code + GitHub Copilot | ✅ Поддерживается | Автообнаружение |
| Copilot CLI | ✅ Поддерживается | Установка плагина |
| Codex | ✅ Поддерживается | `install.sh codex` |
| OpenCode | ✅ Поддерживается | `install.sh opencode` |
| OpenClaw | ✅ Поддерживается | `install.sh openclaw` |
| Antigravity | ✅ Поддерживается | `install.sh antigravity` |
| Gemini CLI | ✅ Поддерживается | `install.sh gemini` |
| Pi Agent | ✅ Поддерживается | `install.sh pi` |
| Vibe CLI | ✅ Поддерживается | `install.sh vibe` |
| Hermes | ✅ Поддерживается | `install.sh hermes` |
| Cline | ✅ Поддерживается | `install.sh cline` |
| KIMI CLI | ✅ Поддерживается | `install.sh kimi` |
| Nanobot | ✅ Поддерживается | `install.sh nanobot` |
| Kiro CLI / IDE | ✅ Поддерживается | `install.sh kiro` |

---

## 📦 Поделитесь графом с командой

Граф — это просто JSON. **Зафиксируйте его один раз, и коллеги смогут пропустить весь пайплайн.** Полезно для онбординга, ревью PR и подхода docs-as-code.

> **Пример:** [GoogleCloudPlatform/microservices-demo (форк)](https://github.com/GoogleCloudPlatform/microservices-demo) — мультиязыковой проект (Go / Java / Python / Node) с уже зафиксированным графом.

**Что коммитить:** всё содержимое `.ua/`, *кроме* `intermediate/`, `diff-overlay.json` и `.trash-*/` (это локальные временные файлы). (Устаревшие проекты используют `.understand-anything/` — подставьте это имя каталога ниже, если присутствует именно он.)

```gitignore
.ua/intermediate/
.ua/diff-overlay.json
.ua/.trash-*/
```

**Держите граф в актуальном состоянии:** включите `/understand --auto-update` — post-commit хук будет инкрементально обновлять граф, так что каждый коммит сопровождается соответствующим графом. Либо запускайте `/understand` вручную перед релизами.

**Большие графы (10 МБ+):** храните через **git-lfs**.

```bash
git lfs install
git lfs track ".ua/*.json"
git add .gitattributes .ua/
```

### Просмотр панели без Claude Code

Как только граф сгенерирован и закоммичен, любой участник команды может открыть его одной командой — без Claude Code, без LLM, без API-ключа. Нужен только Node.js (>= 18):

```bash
npx https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/understand-anything-viewer.tgz /path/to/analyzed/project
```

В терминале выводится URL с токеном (`http://127.0.0.1:5173/?token=…`), и полностью интерактивная панель открывается в браузере. Каталог проекта (по умолчанию — текущий каталог) должен содержать закоммиченный каталог с данными (`.ua/` или устаревший `.understand-anything/`). Всё раздаётся только для чтения с локального диска — никаких обращений к LLM, никакие данные не покидают вашу машину.

Работаете из клона репозитория? `pnpm install && pnpm --filter @understand-anything/core build`, затем `GRAPH_DIR=/path/to/analyzed/project pnpm dev:dashboard` — то же самое через dev-сервер Vite.

---

## 🔧 Под капотом

### Гибрид Tree-sitter + LLM

Детерминированную работу делает статический анализ, семантическое понимание — LLM:

- **Tree-sitter (детерминированно)** — парсит исходный код в конкретное синтаксическое дерево и извлекает структурные факты: import'ы, export'ы, определения функций/классов, точки вызова, наследование. На фазе сканирования заранее разрешается в `importMap` и передаётся file-analyzer'ам, чтобы они не выводили import'ы из исходника заново. Одинаковый ввод всегда даёт одинаковый вывод; это же лежит в основе fingerprint'ов для инкрементальных обновлений.
- **LLM (семантически)** — читает разобранную структуру вместе с исходным текстом и производит то, что не способны парсеры: понятные человеку резюме, теги, назначение архитектурных слоёв, отображение бизнес-доменов, ведомые туры, заметки о концепциях языка.

Именно благодаря этому разделению граф воспроизводим со стороны структуры (один и тот же код всегда даёт одни и те же рёбра) и одновременно улавливает намерение со стороны семантики (для *чего* существует файл, а не только что он импортирует).

### Мультиагентный пайплайн

Команда `/understand` оркестрирует 5 специализированных агентов, а `/understand-domain` добавляет шестого:

| Агент | Роль |
|-------|------|
| `project-scanner` | Обнаружение файлов, определение языков и фреймворков |
| `file-analyzer` | Извлечение функций, классов, импортов; создание узлов и рёбер графа |
| `architecture-analyzer` | Определение архитектурных слоёв |
| `tour-builder` | Генерация пошаговых обучающих обзоров |
| `graph-reviewer` | Проверка полноты и целостности ссылок графа (по умолчанию выполняется inline; используйте `--review` для полного ревью с участием LLM) |
| `domain-analyzer` | Извлечение бизнес-доменов, потоков и шагов процессов (используется командой `/understand-domain`) |
| `article-analyzer` | Извлечение сущностей, утверждений и неявных связей из статей вики (используется командой `/understand-knowledge`) |

Анализаторы файлов работают параллельно (до 5 одновременно, 20–30 файлов на батч). Поддерживаются инкрементальные обновления — повторно анализируются только файлы, изменившиеся с прошлого запуска.

---

## 🎥 Сообщество

Обзорное видео от сообщества, созданное **Better Stack**.

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Обзорное видео от сообщества Better Stack — нажмите, чтобы посмотреть на YouTube" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">Смотреть на YouTube &rarr;</a></em>
</p>

Сделали видео, статью или руководство? Откройте issue или PR — с удовольствием добавим сюда.

---

## 🤝 Вклад в проект

Будем рады вашим контрибьюшенам! Как начать:

1. Сделайте форк репозитория
2. Создайте ветку для фичи (`git checkout -b feature/my-feature`)
3. Запустите тесты (`pnpm --filter @understand-anything/core test`)
4. Закоммитьте изменения и откройте pull request

Для крупных изменений сначала откройте issue, чтобы можно было обсудить подход.

---

<p align="center">
  <strong>Хватит читать код вслепую. Начните понимать всё.</strong>
</p>

## История звёзд

<a href="https://www.star-history.com/?repos=Egonex-AI%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Egonex-AI/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>Спасибо всем, кто пользовался проектом и вкладывался в него — знание того, что это экономит людям время, и было главной причиной, ради которой стоило его делать.</em>
</p>

<p align="center">
  MIT License &copy; Yuxiang Lin and Infinite Universe, Inc.
</p>
