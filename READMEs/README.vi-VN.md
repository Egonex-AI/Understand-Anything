<h1 align="center">Understand Anything</h1>

<p align="center">
  <strong>Biến mọi codebase, cơ sở tri thức hay tài liệu thành đồ thị tri thức tương tác bạn có thể khám phá, tìm kiếm và đặt câu hỏi.</strong>
  <br />
  <em>Hoạt động với Claude Code, Codex, Cursor, Copilot, Gemini CLI, và nhiều hơn nữa.</em>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/23482" target="_blank"><img src="https://trendshift.io/api/badge/repositories/23482" alt="Lum1104%2FUnderstand-Anything | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a> | <strong>Tiếng Việt</strong>
</p>

<p align="center">
  <a href="#-bắt-đầu-nhanh"><img src="https://img.shields.io/badge/Quick_Start-blue" alt="Bắt đầu nhanh" /></a>
  <a href="https://github.com/Lum1104/Understand-Anything/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="License: MIT" /></a>
  <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-8A2BE2" alt="Claude Code" /></a>
  <a href="#codex"><img src="https://img.shields.io/badge/Codex-000000" alt="Codex" /></a>
  <a href="#vs-code--github-copilot"><img src="https://img.shields.io/badge/Copilot-24292e" alt="Copilot" /></a>
  <a href="#copilot-cli"><img src="https://img.shields.io/badge/Copilot_CLI-24292e" alt="Copilot CLI" /></a>
  <a href="#gemini-cli"><img src="https://img.shields.io/badge/Gemini_CLI-4285F4" alt="Gemini CLI" /></a>
  <a href="#opencode"><img src="https://img.shields.io/badge/OpenCode-38bdf8" alt="OpenCode" /></a>
  <a href="#mistral-vibe-cli"><img src="https://img.shields.io/badge/Vibe_CLI-7c3aed" alt="Vibe CLI" /></a>
  <a href="#trae"><img src="https://img.shields.io/badge/Trae-7e22ce" alt="Trae" /></a>
  <a href="https://understand-anything.com"><img src="https://img.shields.io/badge/Homepage-d4a574" alt="Trang chủ" /></a>
  <a href="https://understand-anything.com/demo/"><img src="https://img.shields.io/badge/Live_Demo-00c853" alt="Demo trực tiếp" /></a>
</p>

<p align="center">
  <img src="../assets/hero.png" alt="Understand Anything — Biến mọi codebase thành đồ thị tri thức tương tác" width="800" />
</p>

<p align="center">
  <strong>💬 <a href="https://discord.gg/pydat66RY">Tham gia cộng đồng Discord &rarr;</a></strong>
  <br />
  <em>Đặt câu hỏi, chia sẻ những gì bạn đã xây dựng, nhận trợ giúp từ cộng đồng.</em>
</p>

---

**Bạn vừa gia nhập một nhóm mới. Codebase có 200.000 dòng code. Bạn bắt đầu từ đâu?**

Understand Anything là một [plugin cho Claude Code](https://code.claude.com/docs/en/plugins-reference#plugins-reference) phân tích dự án của bạn bằng pipeline đa tác nhân, xây dựng đồ thị tri thức của mọi tệp, hàm, lớp và phụ thuộc, sau đó cung cấp một dashboard tương tác để bạn khám phá trực quan. Ngừng đọc code mù quáng. Bắt đầu thấy bức tranh tổng thể.

> **Mục tiêu không phải là một đồ thị khiến bạn choáng ngợp vì codebase phức tạp thế nào — mà là một đồ thị âm thầm dạy bạn cách mọi mảnh ghép khớp với nhau.**

---

## ✨ Tính năng

> [!NOTE]
> **Muốn bỏ qua phần đọc?** Hãy thử [bản demo trực tiếp](https://understand-anything.com/demo/) trên [trang chủ](https://understand-anything.com/) của chúng tôi — một dashboard tương tác đầy đủ bạn có thể kéo, phóng to, tìm kiếm và khám phá ngay trong trình duyệt.

### Khám phá đồ thị cấu trúc

Duyệt codebase của bạn như một đồ thị tri thức tương tác — mọi tệp, hàm và lớp là một nút bạn có thể nhấp, tìm kiếm và khám phá. Chọn bất kỳ nút nào để xem tóm tắt, quan hệ và các hành trình hướng dẫn.

### Hiểu logic nghiệp vụ

Chuyển sang chế độ xem miền (domain view) và thấy cách code của bạn ánh xạ tới các quy trình nghiệp vụ thực tế — các miền, luồng và bước được trình bày dưới dạng đồ thị ngang.

### Phân tích cơ sở tri thức

Trỏ `/understand-knowledge` vào một [wiki LLM kiểu Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) và nhận đồ thị tri thức dạng force-directed với phân cụm cộng đồng. Trình phân tích tất định trích xuất wikilink và danh mục từ `index.md`, sau đó các tác nhân LLM khám phá quan hệ ngầm, trích xuất thực thể và làm rõ các tuyên bố — biến wiki của bạn thành một đồ thị điều hướng được của các ý tưởng kết nối với nhau.

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>🧭 Hành trình hướng dẫn</h3>
      <p>Tự động tạo các bài hướng dẫn kiến trúc, được sắp xếp theo phụ thuộc. Học codebase theo đúng thứ tự.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🔍 Tìm kiếm Fuzzy & Semantic</h3>
      <p>Tìm mọi thứ theo tên hoặc theo ý nghĩa. Tìm kiếm "phần nào xử lý auth?" và nhận kết quả phù hợp trên toàn đồ thị.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>📊 Phân tích tác động Diff</h3>
      <p>Xem những phần nào của hệ thống bị ảnh hưởng bởi thay đổi của bạn trước khi commit. Hiểu các hiệu ứng lan truyền khắp codebase.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🎭 Giao diện thích ứng theo vai trò</h3>
      <p>Dashboard tự động điều chỉnh mức độ chi tiết dựa trên bạn là ai — dev mới, PM, hay người dùng cao cấp.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🏗️ Trực quan hóa lớp</h3>
      <p>Tự động nhóm theo lớp kiến trúc — API, Service, Data, UI, Utility — với chú thích màu sắc.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📚 Khái niệm ngôn ngữ</h3>
      <p>12 mẫu lập trình (generics, closures, decorators, v.v.) được giải thích trong ngữ cảnh nơi chúng xuất hiện.</p>
    </td>
  </tr>
</table>

---

## 🚀 Bắt đầu nhanh

### 1. Cài đặt plugin

```bash
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### 2. Phân tích codebase của bạn

```bash
/understand
```

Pipeline đa tác nhân quét dự án của bạn, trích xuất mọi tệp, hàm, lớp và phụ thuộc, sau đó xây dựng đồ thị tri thức được lưu vào `.understand-anything/knowledge-graph.json`.

**Đầu ra bản địa hóa:** Sử dụng `--language` để tạo nội dung bằng ngôn ngữ bạn muốn:

```bash
# Tạo nội dung tiếng Việt
/understand --language vi

# Các ngôn ngữ hỗ trợ: en (mặc định), vi, zh, zh-TW, ja, ko, ru
```

Tham số `--language` ảnh hưởng đến:
- Tóm tắt và mô tả nút trong đồ thị tri thức
- Nhãn, nút bấm và chú thích trên Dashboard UI
- Giải thích hành trình hướng dẫn

### 3. Khám phá dashboard

```bash
/understand-dashboard
```

Một dashboard web tương tác hiện ra với codebase được trực quan hóa dưới dạng đồ thị — tô màu theo lớp kiến trúc, có thể tìm kiếm và nhấp vào. Chọn bất kỳ nút nào để xem code, quan hệ và giải thích tự nhiên của nó.

### 4. Tiếp tục học

```bash
# Hỏi bất kỳ điều gì về codebase
/understand-chat Luồng thanh toán hoạt động thế nào?

# Phân tích tác động của các thay đổi hiện tại
/understand-diff

# Đi sâu vào một tệp hoặc hàm cụ thể
/understand-explain src/auth/login.ts

# Tạo hướng dẫn onboarding cho thành viên mới
/understand-onboard

# Trích xuất kiến thức miền nghiệp vụ (domains, flows, steps)
/understand-domain

# Phân tích cơ sở tri thức wiki LLM kiểu Karpathy
/understand-knowledge ~/path/to/wiki

# Chạy lại bất kỳ lúc nào — mặc định tăng dần (chỉ phân tích lại các tệp đã thay đổi)
/understand

# Tự động cập nhật sau mỗi commit qua post-commit hook
/understand --auto-update

# Giới hạn phạm vi vào một thư mục con (cho monorepo lớn)
/understand src/frontend
```

---

## 🌐 Cài đặt đa nền tảng

Understand-Anything hoạt động trên nhiều nền tảng AI coding.

### Claude Code (Bản địa)

```bash
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### Cài đặt một dòng (Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI / Trae)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash
# hoặc bỏ qua lời nhắc bằng cách truyền nền tảng:
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash -s codex
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.ps1 | iex
```

Trình cài đặt clone repo vào `~/.understand-anything/repo` và tạo symlink phù hợp cho nền tảng đã chọn. Khởi động lại CLI/IDE sau đó.

- Các giá trị `<platform>` được hỗ trợ: `gemini`, `codex`, `opencode`, `pi`, `openclaw`, `antigravity`, `vibe`, `vscode`, `hermes`, `cline`, `kimi`, `trae`
- Cập nhật sau: `./install.sh --update`
- Gỡ cài đặt: `./install.sh --uninstall <platform>`

### Cursor

Cursor tự động phát hiện plugin qua `.cursor-plugin/plugin.json` khi repo này được clone. Không cần cài đặt thủ công — chỉ cần clone và mở trong Cursor.

Nếu tự động phát hiện không hoạt động, hãy cài đặt thủ công: mở **Cursor Settings → Plugins**, dán `https://github.com/Lum1104/Understand-Anything` vào ô tìm kiếm và thêm từ đó.

### VS Code + GitHub Copilot

VS Code với GitHub Copilot (v1.108+) tự động phát hiện plugin qua `.copilot-plugin/plugin.json` khi repo này được clone. Không cần cài đặt thủ công — chỉ cần clone và mở trong VS Code.

Để sử dụng skill cá nhân (khả dụng trên mọi dự án), chạy `install.sh` ở trên với nền tảng `vscode`.

### Copilot CLI

```bash
copilot plugin install Lum1104/Understand-Anything:understand-anything-plugin
```

### Tương thích nền tảng

| Nền tảng | Trạng thái | Phương thức cài đặt |
|----------|------------|---------------------|
| Claude Code | ✅ Bản địa | Plugin marketplace |
| Cursor | ✅ Hỗ trợ | Tự động phát hiện |
| VS Code + GitHub Copilot | ✅ Hỗ trợ | Tự động phát hiện |
| Copilot CLI | ✅ Hỗ trợ | Plugin install |
| Codex | ✅ Hỗ trợ | `install.sh codex` |
| OpenCode | ✅ Hỗ trợ | `install.sh opencode` |
| OpenClaw | ✅ Hỗ trợ | `install.sh openclaw` |
| Antigravity | ✅ Hỗ trợ | `install.sh antigravity` |
| Gemini CLI | ✅ Hỗ trợ | `install.sh gemini` |
| Pi Agent | ✅ Hỗ trợ | `install.sh pi` |
| Vibe CLI | ✅ Hỗ trợ | `install.sh vibe` |
| Hermes | ✅ Hỗ trợ | `install.sh hermes` |
| Cline | ✅ Hỗ trợ | `install.sh cline` |
| KIMI CLI | ✅ Hỗ trợ | `install.sh kimi` |
| Trae | ✅ Hỗ trợ | `install.sh trae` |

---

## 📦 Chia sẻ đồ thị với nhóm

Đồ thị chỉ là JSON — **commit một lần, đồng đội bỏ qua pipeline**. Rất hữu ích cho onboarding, đánh giá PR và docs-as-code.

> **Ví dụ:** [GoogleCloudPlatform/microservices-demo (fork)](https://github.com/Lum1104/microservices-demo) — Go / Java / Python / Node tham khảo kèm đồ thị đã commit.

**Nên commit những gì:** mọi thứ trong `.understand-anything/` *ngoại trừ* `intermediate/` và `diff-overlay.json` (đó là dữ liệu tạm địa phương).

```gitignore
.understand-anything/intermediate/
.understand-anything/diff-overlay.json
```

**Giữ nó luôn mới:** bật `/understand --auto-update` — một post-commit hook cập nhật dần đồ thị để mỗi commit luôn đi kèm đồ thị tương ứng. Hoặc chạy lại `/understand` thủ công trước các bản phát hành.

**Đồ thị lớn (10 MB+):** theo dõi với **git-lfs**.

```bash
git lfs install
git lfs track ".understand-anything/*.json"
git add .gitattributes .understand-anything/
```

---

## 🔧 Bên trong

### Kết hợp Tree-sitter + LLM

Phân tích mã tĩnh và LLM làm điều mỗi bên làm tốt nhất:

- **Tree-sitter (tất định)** — phân tích mã nguồn thành cây cú pháp cụ thể và trích xuất các sự kiện cấu trúc: import, export, định nghĩa hàm/lớp, vị trí gọi, kế thừa. Được giải trước thành `importMap` trong giai đoạn quét và truyền cho file-analyzer để chúng không phải suy lại import từ mã nguồn. Cùng đầu vào → cùng đầu ra, mỗi lần chạy. Cũng hỗ trợ phát hiện thay đổi dựa trên vân tay (fingerprint) cho cập nhật tăng dần.
- **LLM (ngữ nghĩa)** — đọc cấu trúc đã phân tích cùng với mã nguồn gốc để tạo ra những thứ trình phân tích không thể: tóm tắt tiếng Việt tự nhiên, thẻ, gán lớp kiến trúc, ánh xạ miền nghiệp vụ, hành trình hướng dẫn, đánh dấu khái niệm ngôn ngữ.

Sự tách biệt này là lý do đồ thị có thể tái tạo được về mặt cấu trúc (cùng code luôn cho cùng các cạnh) trong khi vẫn nắm bắt được ý định về mặt ngữ nghĩa (một tệp *dùng để làm gì*, không chỉ nó import cái gì).

### Đường ống đa tác nhân

Lệnh `/understand` điều phối 5 tác nhân chuyên biệt và `/understand-domain` thêm tác nhân thứ 6:

| Tác nhân | Vai trò |
|----------|---------|
| `project-scanner` | Khám phá tệp, phát hiện ngôn ngữ và framework |
| `file-analyzer` | Trích xuất hàm, lớp, import; tạo nút và cạnh đồ thị |
| `architecture-analyzer` | Xác định lớp kiến trúc |
| `tour-builder` | Tạo hành trình học có hướng dẫn |
| `graph-reviewer` | Kiểm tra tính đầy đủ và toàn vẹn tham chiếu của đồ thị (chạy nội tuyến mặc định; dùng `--review` để LLM đánh giá đầy đủ) |
| `domain-analyzer` | Trích xuất miền nghiệp vụ, luồng và bước xử lý (được dùng bởi `/understand-domain`) |
| `article-analyzer` | Trích xuất thực thể, tuyên bố và quan hệ ngầm từ bài viết wiki (được dùng bởi `/understand-knowledge`) |

Các file-analyzer chạy song song (tối đa 5 đồng thời, 20-30 tệp mỗi đợt). Hỗ trợ cập nhật tăng dần — chỉ phân tích lại các tệp đã thay đổi kể từ lần chạy trước.

---

## 🎥 Cộng đồng

Một bài hướng dẫn từ cộng đồng bởi **Better Stack**.

<p align="center">
  <a href="https://www.youtube.com/watch?v=VmIUXVlt7_I"><img src="https://img.youtube.com/vi/VmIUXVlt7_I/maxresdefault.jpg" alt="Bài hướng dẫn từ cộng đồng bởi Better Stack — xem trên YouTube" width="480" /></a>
  <br />
  <em><a href="https://www.youtube.com/watch?v=VmIUXVlt7_I">Xem trên YouTube &rarr;</a></em>
</p>

Đã làm video, bài blog hay hướng dẫn? Mở issue hoặc PR — rất vui được giới thiệu ở đây.

---

## 🤝 Đóng góp

Mọi đóng góp đều được chào đón! Đây là cách bắt đầu:

1. Fork repository
2. Tạo feature branch (`git checkout -b feature/my-feature`)
3. Chạy kiểm thử (`pnpm --filter @understand-anything/core test`)
4. Commit thay đổi và mở pull request

Vui lòng mở issue trước cho các thay đổi lớn để chúng ta có thể thảo luận về hướng tiếp cận.

---

<p align="center">
  <strong>Đừng đọc code mù quáng. Hãy bắt đầu hiểu mọi thứ.</strong>
</p>

## Star History

<a href="https://www.star-history.com/?repos=Lum1104%2FUnderstand-Anything&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Lum1104/Understand-Anything&type=date&legend=top-left" />
 </picture>
</a>

<p align="center">
  <em>Cảm ơn tất cả những ai đã sử dụng và đóng góp — biết rằng điều này giúp mọi người tiết kiệm thời gian là điều khiến nó đáng được xây dựng.</em>
</p>

<p align="center">
  Giấy phép MIT &copy; <a href="https://github.com/Lum1104">Lum1104</a>
</p>
