<h1 align="center">Understand Anything</h1>

<p align="center">
  <strong>Transformez n'importe quel codebase, base de connaissances ou documentation en graphe de connaissances interactif que vous pouvez explorer, rechercher et interroger.</strong>
  <br />
  <em>Fonctionne avec Claude Code, Codex, Cursor, Copilot, Gemini CLI, et plus encore.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Lum1104%2FUnderstand-Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a> | <a href="README.fr-FR.md">Français</a>
</p>

<p align="center">
  <a href="#-demarrage-rapide"><img src="https://img.shields.io/badge/D%C3%A9marrage_Rapide-blue" alt="Démarrage rapide" /></a>
  <a href="https://github.com/Lum1104/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="Licence : MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="#mistral-vibe-cli"><img src="https://img.shields.io/badge/Vibe_CLI-7c3aed" alt="Vibe CLI" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/Site-d4a574" alt="Site" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/D%C3%A9mo-00c853" alt="Démo en direct" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — Transformez n'importe quel codebase en graphe de connaissances interactif" width="800" />
</p>

<p align="center">
  <strong>💬 <a href="https://discord.gg/pydat66RY">Rejoignez la communauté Discord &rarr;</a></strong>
  <br />
  <em>Posez vos questions, partagez ce que vous avez construit et obtenez de l'aide auprès de la communauté.</em>
</p>

---

**Vous venez de rejoindre une nouvelle équipe. Le codebase compte 200 000 lignes de code. Par où commencer ?**

Understand Anything est un [plugin Claude Code](https://code.claude.com/docs/en/plugins-reference#plugins-reference) qui analyse votre projet avec un pipeline multi-agent, construit un graphe de connaissances de chaque fichier, fonction, classe et dépendance, puis vous fournit un tableau de bord interactif pour tout explorer visuellement. Arrêtez de lire le code à l'aveugle. Commencez à voir la vue d'ensemble.

> **L'objectif n'est pas de produire un graphe qui vous impressionne par la complexité de votre codebase : c'est de créer un graphe qui vous apprend discrètement comment chaque élément s'assemble.**

---

## ✨ Fonctionnalités

> [!NOTE]
> **Vous voulez éviter la lecture ?** Essayez la [démo en direct](https://understand-anything.com/demo/) sur notre [site](https://understand-anything.com/) : un tableau de bord entièrement interactif que vous pouvez déplacer, zoomer, rechercher et explorer directement dans votre navigateur.

### Explorer le graphe structurel

Naviguez dans votre codebase sous forme de graphe de connaissances interactif : chaque fichier, fonction et classe est un nœud sur lequel vous pouvez cliquer, que vous pouvez rechercher et explorer. Sélectionnez n'importe quel nœud pour voir des résumés en langage clair, ses relations et des visites guidées.

### Comprendre la logique métier

Basculez vers la vue domaine et voyez comment votre code correspond aux processus métier réels : domaines, flux et étapes disposés sous forme de graphe horizontal.

### Analyser des bases de connaissances

Pointez `/understand-knowledge` vers un [wiki LLM suivant le modèle de Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) et obtenez un graphe de connaissances force-directed avec clustering communautaire. Le parseur déterministe extrait les wikilinks et catégories depuis `index.md`, puis les agents LLM découvrent les relations implicites, extraient les entités et font remonter les affirmations : votre wiki devient un graphe navigable d'idées interconnectées.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 Visites guidées</h3>
      <p>Parcours de l'architecture générés automatiquement, ordonnés par dépendance. Apprenez le codebase dans le bon ordre.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Recherche floue et sémantique</h3>
      <p>Trouvez n'importe quoi par nom ou par sens. Recherchez « quelles parties gèrent l'authentification ? » et obtenez des résultats pertinents dans tout le graphe.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Analyse d'impact des diffs</h3>
      <p>Voyez quelles parties du système vos changements affectent avant de commit. Comprenez les effets en cascade dans tout le codebase.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 UI adaptative selon le profil</h3>
      <p>Le tableau de bord ajuste son niveau de détail selon votre profil : développeur junior, PM ou utilisateur avancé.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ Visualisation par couches</h3>
      <p>Regroupement automatique par couche d'architecture : API, Service, Data, UI, Utility, avec une légende codée par couleur.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Concepts de langage</h3>
      <p>12 patterns de programmation (génériques, closures, décorateurs, etc.) expliqués en contexte partout où ils apparaissent.</p>
    </td>
  </tr>
</table>

---

## 🚀 Démarrage rapide

### 1. Installer le plugin

```bash
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### 2. Analyser votre codebase

```bash
/understand
```

Un pipeline multi-agent scanne votre projet, extrait chaque fichier, fonction, classe et dépendance, puis construit un graphe de connaissances enregistré dans `.understand-anything/knowledge-graph.json`.

**Sortie localisée :** utilisez `--language` pour générer du contenu dans votre langue préférée :

```bash
# Générer du contenu en chinois (descriptions des nœuds du graphe de connaissances et UI du tableau de bord)
/understand --language zh

# Langues prises en charge : en (par défaut), zh, zh-TW, ja, ko, ru
```

Le paramètre `--language` affecte :
- Les résumés et descriptions des nœuds dans le graphe de connaissances
- Les libellés, boutons et infobulles de l'UI du tableau de bord
- Les explications des visites guidées

### 3. Explorer le tableau de bord

```bash
/understand-dashboard
```

Un tableau de bord web interactif s'ouvre avec votre codebase visualisé sous forme de graphe : codé par couleur selon la couche d'architecture, recherchable et cliquable. Sélectionnez n'importe quel nœud pour voir son code, ses relations et une explication en langage clair.

### 4. Continuer à apprendre

```bash
# Poser n'importe quelle question sur le codebase
/understand-chat How does the payment flow work?

# Analyser l'impact de vos changements actuels
/understand-diff

# Explorer en profondeur un fichier ou une fonction précise
/understand-explain src/auth/login.ts

# Générer un guide d'onboarding pour les nouveaux membres de l'équipe
/understand-onboard

# Extraire les connaissances métier (domaines, flux, étapes)
/understand-domain

# Analyser une base de connaissances de type wiki LLM selon le modèle de Karpathy
/understand-knowledge ~/path/to/wiki

# Relancer à tout moment : incrémental par défaut (réanalyse seulement les fichiers modifiés)
/understand

# Mise à jour automatique à chaque commit via un hook post-commit
/understand --auto-update

# Limiter l'analyse à un sous-dossier (pour les gros monorepos)
/understand src/frontend
```

---

## 🌐 Installation multi-plateforme

Understand-Anything fonctionne sur plusieurs plateformes de codage IA.

### Claude Code (natif)

```bash
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### Installation en une ligne (Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI)

**macOS / Linux :**
```bash
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash
# ou ignorez l'invite en passant directement la plateforme :
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash -s codex
```

**Windows (PowerShell) :**
```powershell
iwr -useb https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.ps1 | iex
```

L'installateur clone le dépôt dans `~/.understand-anything/repo` et crée les bons liens symboliques pour la plateforme choisie. Redémarrez ensuite votre CLI/IDE.

- Valeurs `<platform>` prises en charge : `gemini`, `codex`, `opencode`, `pi`, `openclaw`, `antigravity`, `vibe`, `vscode`, `hermes`, `cline`, `kimi`
- Mettre à jour plus tard : `./install.sh --update`
- Désinstaller : `./install.sh --uninstall <platform>`

### Cursor

Cursor découvre automatiquement le plugin via `.cursor-plugin/plugin.json` lorsque ce dépôt est cloné. Aucune installation manuelle n'est nécessaire : clonez simplement le dépôt et ouvrez-le dans Cursor.

Si la découverte automatique ne fonctionne pas, installez-le manuellement : ouvrez **Cursor Settings → Plugins**, collez `https://github.com/Lum1104/Understand-Anything` dans le champ de recherche, puis ajoutez-le depuis là.

### VS Code + GitHub Copilot

VS Code avec GitHub Copilot (v1.108+) découvre automatiquement le plugin via `.copilot-plugin/plugin.json` lorsque ce dépôt est cloné. Aucune installation manuelle n'est nécessaire : clonez simplement le dépôt et ouvrez-le dans VS Code.

Pour les skills personnels (disponibles dans tous les projets), exécutez le script `install.sh` ci-dessus avec la plateforme `vscode`.

### Copilot CLI

```bash
copilot plugin install Lum1104/Understand-Anything:understand-anything-plugin
```

### Compatibilité des plateformes

| Plateforme | Statut | Méthode d'installation |
|----------|--------|----------------|
| Claude Code | ✅ Natif | Marketplace de plugins |
| Cursor | ✅ Pris en charge | Découverte automatique |
| VS Code + GitHub Copilot | ✅ Pris en charge | Découverte automatique |
| Copilot CLI | ✅ Pris en charge | Installation du plugin |
| Codex | ✅ Pris en charge | `install.sh codex` |
| OpenCode | ✅ Pris en charge | `install.sh opencode` |
| OpenClaw | ✅ Pris en charge | `install.sh openclaw` |
| Antigravity | ✅ Pris en charge | `install.sh antigravity` |
| Gemini CLI | ✅ Pris en charge | `install.sh gemini` |
| Pi Agent | ✅ Pris en charge | `install.sh pi` |
| Vibe CLI | ✅ Pris en charge | `install.sh vibe` |
| Hermes | ✅ Pris en charge | `install.sh hermes` |
| Cline | ✅ Pris en charge | `install.sh cline` |
| KIMI CLI | ✅ Pris en charge | `install.sh kimi` |

---

## 📦 Partager le graphe avec votre équipe

Le graphe n'est qu'un fichier JSON : **committez-le une fois, et vos coéquipiers évitent le pipeline**. Utile pour l'onboarding, les revues de PR et la documentation-as-code.

> **Exemple :** [GoogleCloudPlatform/microservices-demo (fork)](https://github.com/Lum1104/microservices-demo) — référence Go / Java / Python / Node avec un graphe committé.

**À commit :** tout ce qui se trouve dans `.understand-anything/`, *sauf* `intermediate/` et `diff-overlay.json` (ce sont des fichiers de travail locaux).

```gitignore
.understand-anything/intermediate/
.understand-anything/diff-overlay.json
```

**Le garder à jour :** activez `/understand --auto-update` : un hook post-commit met à jour le graphe de façon incrémentale afin que chaque commit arrive avec un graphe correspondant. Vous pouvez aussi relancer `/understand` manuellement avant les releases.

**Graphes volumineux (10 Mo+) :** suivez-les avec **git-lfs**.

```bash
git lfs install
git lfs track ".understand-anything/*.json"
git add .gitattributes .understand-anything/
```

---

## 🔧 Sous le capot

### Hybride Tree-sitter + LLM

L'analyse statique et les LLM font chacun ce qu'ils font le mieux :

- **Tree-sitter (déterministe)** — parse le code source en arbre syntaxique concret et extrait des faits structurels : imports, exports, définitions de fonctions/classes, sites d'appel, héritage. Pré-résolu dans un `importMap` pendant la phase de scan et transmis aux analyseurs de fichiers afin qu'ils n'aient pas à redériver les imports depuis le code source. Même entrée → même sortie, à chaque exécution. Alimente aussi la détection de changements basée sur les empreintes pour les mises à jour incrémentales.
- **LLM (sémantique)** — lit la structure parsée avec le code source original pour produire ce que les parseurs ne peuvent pas fournir : résumés en langage clair, tags, assignations de couches d'architecture, mapping des domaines métier, visites guidées, annotations de concepts de langage.

Cette séparation explique pourquoi le graphe est reproductible côté structurel (le même code produit toujours les mêmes arêtes) tout en capturant l'intention côté sémantique (à quoi sert un fichier, et pas seulement ce qu'il importe).

### Pipeline multi-agent

La commande `/understand` orchestre 5 agents spécialisés, et `/understand-domain` en ajoute un 6e :

| Agent | Rôle |
|-------|------|
| `project-scanner` | Découvrir les fichiers, détecter les langages et frameworks |
| `file-analyzer` | Extraire fonctions, classes et imports ; produire les nœuds et arêtes du graphe |
| `architecture-analyzer` | Identifier les couches d'architecture |
| `tour-builder` | Générer des visites guidées d'apprentissage |
| `graph-reviewer` | Valider l'exhaustivité du graphe et son intégrité référentielle (s'exécute inline par défaut ; utilisez `--review` pour une revue LLM complète) |
| `domain-analyzer` | Extraire les domaines métier, flux et étapes de processus (utilisé par `/understand-domain`) |
| `article-analyzer` | Extraire les entités, affirmations et relations implicites depuis les articles de wiki (utilisé par `/understand-knowledge`) |

Les analyseurs de fichiers s'exécutent en parallèle (jusqu'à 5 en concurrence, 20 à 30 fichiers par lot). Les mises à jour incrémentales sont prises en charge : seuls les fichiers modifiés depuis la dernière exécution sont réanalysés.

---

## 🎥 Communauté

Une présentation créée par la communauté, réalisée par **Better Stack**.

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Présentation communautaire par Better Stack — regarder sur YouTube" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">Regarder sur YouTube &rarr;</a></em>
</p>

Vous avez créé une vidéo, un article de blog ou un tutoriel ? Ouvrez une issue ou une PR : nous serons ravis de le mettre en avant ici.

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Voici comment démarrer :

1. Forkez le dépôt
2. Créez une branche de fonctionnalité (`git checkout -b feature/my-feature`)
3. Lancez les tests (`pnpm --filter @understand-anything/core test`)
4. Committez vos changements et ouvrez une pull request

Veuillez ouvrir une issue avant les changements majeurs afin que nous puissions discuter de l'approche.

---

<p align="center">
  <strong>Arrêtez de lire le code à l'aveugle. Commencez à tout comprendre.</strong>
</p>

## Historique des étoiles

<a href="https://www.star-history.com/?repos=Lum1104%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&legend=top-left" />
   <img alt="Graphique d'historique des étoiles" src="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>Merci à toutes celles et ceux qui l'ont utilisé et qui ont contribué : savoir que cela fait gagner du temps aux gens est ce qui a rendu ce projet utile.</em>
</p>

<p align="center">
  Licence MIT &copy; <a href="https://github.com/Lum1104">Lum1104</a>
</p>
