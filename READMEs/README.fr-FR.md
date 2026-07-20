<h1 align="center">Understand Anything</h1>

<p align="center">
  <strong>Transformez n'importe quelle base de code, base de connaissances ou documentation en un graphe de connaissances interactif que vous pouvez explorer, rechercher et interroger.</strong>
  <br />
  <em>Fonctionne avec Claude Code, Codex, Cursor, Copilot, Gemini CLI, et plus encore.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Lum1104%2FUnderstand-Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a> | <strong>Français</strong>
</p>

<p align="center">
  <a href="#-démarrage-rapide"><img src="https://img.shields.io/badge/Démarrage_Rapide-blue" alt="Démarrage Rapide" /></a>
  <a href="https://github.com/Lum1104/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="#mistral-vibe-cli"><img src="https://img.shields.io/badge/Vibe_CLI-7c3aed" alt="Vibe CLI" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/Site_Web-d4a574" alt="Site Web" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/Démo_Live-00c853" alt="Démo Live" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — Transformez n'importe quelle base de code en graphe de connaissances interactif" width="800" />
</p>

<p align="center">
  <strong>💬 <a href="https://discord.gg/pydat66RY">Rejoignez la communauté Discord &rarr;</a></strong>
  <br />
  <em>Posez vos questions, partagez vos réalisations, obtenez de l'aide de la communauté.</em>
</p>

---

**Vous venez de rejoindre une nouvelle équipe. La base de code fait 200 000 lignes. Par où commencer ?**

Understand Anything est un [Plugin Claude Code](https://code.claude.com/docs/en/plugins-reference#plugins-reference) qui analyse votre projet avec un pipeline multi-agents, construit un graphe de connaissances de chaque fichier, fonction, classe et dépendance, puis vous offre un tableau de bord interactif pour tout explorer visuellement. Fini de lire le code à l'aveugle. Commencez à voir l'ensemble du tableau.

> **L'objectif n'est pas un graphe qui vous impressionne par la complexité de votre base de code — c'est un graphe qui vous apprend silencieusement comment chaque pièce s'emboîte.**

---

## ✨ Fonctionnalités

> [!NOTE]
> **Vous préférez ne pas tout lire ?** Essayez la [démo live](https://understand-anything.com/demo/) sur notre [site web](https://understand-anything.com/) — un tableau de bord entièrement interactif que vous pouvez faire glisser, zoomer, rechercher et explorer directement dans votre navigateur.

### Explorer le graphe structurel

Naviguez dans votre base de code comme un graphe de connaissances interactif — chaque fichier, fonction et classe est un nœud sur lequel vous pouvez cliquer, rechercher et explorer. Sélectionnez n'importe quel nœud pour voir des résumés en langage naturel, les relations et des visites guidées.

### Comprendre la logique métier

Basculez vers la vue domaine et visualisez comment votre code correspond aux processus métier réels — domaines, flux et étapes présentés sous forme de graphe horizontal.

### Analyser les bases de connaissances

Pointez `/understand-knowledge` vers un [wiki LLM de style Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) et obtenez un graphe de connaissances à forces dirigées avec regroupement communautaire. L'analyseur déterministe extrait les wikiliens et catégories depuis `index.md`, puis les agents LLM découvrent les relations implicites, extraient les entités et font remonter les affirmations — transformant votre wiki en un graphe navigable d'idées interconnectées.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 Visites Guidées</h3>
      <p>Parcours auto-générés de l'architecture, ordonnés par dépendance. Apprenez la base de code dans le bon ordre.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Recherche Floue & Sémantique</h3>
      <p>Trouvez n'importe quoi par nom ou par signification. Cherchez « quelles parties gèrent l'auth ? » et obtenez des résultats pertinents dans le graphe.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Analyse d'Impact de Diff</h3>
      <p>Voyez quelles parties du système vos modifications affectent avant de faire un commit. Comprenez les effets en cascade dans la base de code.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 Interface Adaptée au Persona</h3>
      <p>Le tableau de bord ajuste son niveau de détail selon qui vous êtes — développeur junior, chef de projet ou utilisateur avancé.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ Visualisation en Couches</h3>
      <p>Regroupement automatique par couche architecturale — API, Service, Données, UI, Utilitaire — avec légende colorée.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Concepts du Langage</h3>
      <p>12 patterns de programmation (génériques, closures, décorateurs, etc.) expliqués en contexte partout où ils apparaissent.</p>
    </td>
  </tr>
</table>

---

## 🚀 Démarrage Rapide

### 1. Installer le plugin

```bash
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### 2. Analyser votre base de code

```bash
/understand
```

Un pipeline multi-agents scanne votre projet, extrait chaque fichier, fonction, classe et dépendance, puis construit un graphe de connaissances sauvegardé dans `.understand-anything/knowledge-graph.json`.

**Sortie localisée :** Utilisez `--language` pour générer le contenu dans votre langue préférée :

```bash
# Générer du contenu en chinois (描述 et Dashboard UI)
/understand --language zh

# Langues supportées : en (par défaut), zh, zh-TW, ja, ko, ru
```

Le paramètre `--language` affecte :
- Les résumés et descriptions des nœuds dans le graphe de connaissances
- Les libellés, boutons et infobulles de l'interface du tableau de bord
- Les explications des visites guidées

### 3. Explorer le tableau de bord

```bash
/understand-dashboard
```

Un tableau de bord web interactif s'ouvre avec votre base de code visualisée sous forme de graphe — codé par couleur selon la couche architecturale, consultable et cliquable. Sélectionnez n'importe quel nœud pour voir son code, ses relations et une explication en langage naturel.

### 4. Continuer à apprendre

```bash
# Posez n'importe quelle question sur la base de code
/understand-chat Comment fonctionne le flux de paiement ?

# Analysez l'impact de vos modifications actuelles
/understand-diff

# Approfondissez un fichier ou une fonction spécifique
/understand-explain src/auth/login.ts

# Générez un guide d'intégration pour les nouveaux membres de l'équipe
/understand-onboard

# Extrayez la connaissance du domaine métier (domaines, flux, étapes)
/understand-domain

# Analysez une base de connaissances wiki de style Karpathy
/understand-knowledge ~/chemin/vers/wiki

# Relancez à tout moment — incrémental par défaut (réanalyse uniquement les fichiers modifiés)
/understand

# Mise à jour automatique à chaque commit via un hook post-commit
/understand --auto-update

# Limitez à un sous-répertoire (pour les grands monorepos)
/understand src/frontend
```

---

## 🌐 Installation Multi-Plateforme

Understand-Anything fonctionne sur plusieurs plateformes d'IA de codage.

### Claude Code (Natif)

```bash
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### Installation en une ligne (Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI)

**macOS / Linux :**
```bash
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash
# ou ignorez l'invite en passant la plateforme :
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash -s codex
```

**Windows (PowerShell) :**
```powershell
iwr -useb https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.ps1 | iex
```

L'installateur clone le dépôt dans `~/.understand-anything/repo` et crée les bons liens symboliques pour la plateforme choisie. Redémarrez votre CLI/IDE ensuite.

- Valeurs `<platform>` supportées : `gemini`, `codex`, `opencode`, `pi`, `openclaw`, `antigravity`, `vibe`, `vscode`, `hermes`, `cline`, `kimi`
- Mise à jour ultérieure : `./install.sh --update`
- Désinstallation : `./install.sh --uninstall <platform>`

### Cursor

Cursor auto-découvre le plugin via `.cursor-plugin/plugin.json` lorsque ce dépôt est cloné. Aucune installation manuelle n'est nécessaire — clonez simplement et ouvrez dans Cursor.

Si l'auto-découverte ne fonctionne pas, installez-le manuellement : ouvrez **Cursor Settings → Plugins**, collez `https://github.com/Lum1104/Understand-Anything` dans le champ de recherche, et ajoutez-le depuis là.

### VS Code + GitHub Copilot

VS Code avec GitHub Copilot (v1.108+) auto-découvre le plugin via `.copilot-plugin/plugin.json` lorsque ce dépôt est cloné. Aucune installation manuelle n'est nécessaire — clonez simplement et ouvrez dans VS Code.

Pour les compétences personnelles (disponibles dans tous les projets), exécutez `install.sh` ci-dessus avec la plateforme `vscode`.

### Copilot CLI

```bash
copilot plugin install Lum1104/Understand-Anything:understand-anything-plugin
```

### Compatibilité des Plateformes

| Plateforme | Statut | Méthode d'installation |
|----------|--------|-------------------|
| Claude Code | ✅ Natif | Marketplace de plugins |
| Cursor | ✅ Supporté | Auto-découverte |
| VS Code + GitHub Copilot | ✅ Supporté | Auto-découverte |
| Copilot CLI | ✅ Supporté | Installation de plugin |
| Codex | ✅ Supporté | `install.sh codex` |
| OpenCode | ✅ Supporté | `install.sh opencode` |
| OpenClaw | ✅ Supporté | `install.sh openclaw` |
| Antigravity | ✅ Supporté | `install.sh antigravity` |
| Gemini CLI | ✅ Supporté | `install.sh gemini` |
| Pi Agent | ✅ Supporté | `install.sh pi` |
| Vibe CLI | ✅ Supporté | `install.sh vibe` |
| Hermes | ✅ Supporté | `install.sh hermes` |
| Cline | ✅ Supporté | `install.sh cline` |
| KIMI CLI | ✅ Supporté | `install.sh kimi` |

---

## 📦 Partager le Graphe avec Votre Équipe

Le graphe n'est que du JSON — **committez-le une fois, et vos coéquipiers n'ont plus besoin de lancer le pipeline**. Idéal pour l'intégration de nouveaux membres, les revues de PR et la documentation-as-code.

> **Exemple :** [GoogleCloudPlatform/microservices-demo (fork)](https://github.com/Lum1104/microservices-demo) — référence Go / Java / Python / Node avec un graphe commité.

**Quoi committer :** tout ce qui se trouve dans `.understand-anything/` *sauf* `intermediate/` et `diff-overlay.json` (ce sont des fichiers de travail locaux).

```gitignore
.understand-anything/intermediate/
.understand-anything/diff-overlay.json
```

**Gardez-le à jour :** activez `/understand --auto-update` — un hook post-commit met à jour incrémentalement le graphe afin que chaque commit arrive avec un graphe correspondant. Ou relancez `/understand` manuellement avant les releases.

**Grands graphes (10 Mo+) :** suivez avec **git-lfs**.

```bash
git lfs install
git lfs track ".understand-anything/*.json"
git add .gitattributes .understand-anything/
```

---

## 🔧 Sous le Capot

### Hybride Tree-sitter + LLM

L'analyse statique et les LLM font ce que chacun fait le mieux :

- **Tree-sitter (déterministe)** — analyse la source en un arbre syntaxique concret et extrait les faits structurels : imports, exports, définitions de fonctions/classes, sites d'appel, héritage. Pré-résolu en `importMap` pendant la phase de scan et transmis aux analyseurs de fichiers pour qu'ils ne re-dérivent pas les imports depuis la source. Même entrée → même sortie, à chaque exécution. Alimente également la détection de changements basée sur les empreintes pour les mises à jour incrémentielles.
- **LLM (sémantique)** — lit la structure analysée aux côtés de la source originale pour produire ce que les parseurs ne peuvent pas : résumés en langage naturel, tags, affectations de couche architecturale, mapping de domaine métier, visites guidées, callouts de concepts de langage.

Ce découpage explique pourquoi le graphe est reproductible côté structurel (le même code donne toujours les mêmes arêtes) tout en capturant l'intention côté sémantique (ce à quoi sert un fichier, pas seulement ce qu'il importe).

### Pipeline Multi-Agents

La commande `/understand` orchestre 5 agents spécialisés, et `/understand-domain` en ajoute un 6ème :

| Agent | Rôle |
|-------|------|
| `project-scanner` | Découvrir les fichiers, détecter les langages et frameworks |
| `file-analyzer` | Extraire les fonctions, classes, imports ; produire des nœuds et arêtes de graphe |
| `architecture-analyzer` | Identifier les couches architecturales |
| `tour-builder` | Générer des visites guidées d'apprentissage |
| `graph-reviewer` | Valider la complétude du graphe et l'intégrité référentielle (s'exécute en ligne par défaut ; utilisez `--review` pour une revue LLM complète) |
| `domain-analyzer` | Extraire les domaines métier, flux et étapes de processus (utilisé par `/understand-domain`) |
| `article-analyzer` | Extraire les entités, affirmations et relations implicites des articles wiki (utilisé par `/understand-knowledge`) |

Les analyseurs de fichiers s'exécutent en parallèle (jusqu'à 5 simultanément, 20-30 fichiers par batch). Supporte les mises à jour incrémentielles — réanalyse uniquement les fichiers qui ont changé depuis la dernière exécution.

---

## 🎥 Communauté

Un tutoriel réalisé par la communauté par **Better Stack**.

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Tutoriel communautaire par Better Stack — regarder sur YouTube" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">Regarder sur YouTube &rarr;</a></em>
</p>

Vous avez réalisé une vidéo, un article de blog ou un tutoriel ? Ouvrez une issue ou une PR — nous serons ravis de le mettre en avant ici.

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Voici comment commencer :

1. Forkez le dépôt
2. Créez une branche de fonctionnalité (`git checkout -b feature/ma-fonctionnalite`)
3. Lancez les tests (`pnpm --filter @understand-anything/core test`)
4. Committez vos modifications et ouvrez une pull request

Veuillez ouvrir une issue d'abord pour les changements majeurs afin que nous puissions discuter de l'approche.

---

<p align="center">
  <strong>Fini de lire le code à l'aveugle. Commencez à tout comprendre.</strong>
</p>

## Historique des Étoiles

<a href="https://www.star-history.com/?repos=Lum1104%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>Merci à tous ceux qui ont utilisé et contribué — savoir que cela fait gagner du temps aux gens est ce qui valait la peine de construire ça.</em>
</p>

<p align="center">
  Licence MIT &copy; <a href="https://github.com/Lum1104">Lum1104</a>
</p>
