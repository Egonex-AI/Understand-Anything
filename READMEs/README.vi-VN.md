<h1 align="center">Understand Anything</h1>

<p align="center">
  <strong>Biến bất kỳ codebase, cơ sở kiến thức, hoặc tài liệu nào thành đồ thị tri thức tương tác mà bạn có thể khám phá, tìm kiếm và đặt câu hỏi.</strong>
  <br />
  <em>Hỗ trợ Claude Code, Codex, Cursor, Copilot, Gemini CLI, v.v.</em>
</p>

<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ko-KR.md">한국어</a> | <a href="README.es-ES.md">Español</a> | <a href="README.tr-TR.md">Türkçe</a> | <a href="README.ru-RU.md">Русский</a> | <a href="README.vi-VN.md">Tiếng Việt</a>
</p>

---

**Bạn vừa tham gia một đội mới. Codebase 200.000 dòng. Bắt đầu từ đâu?**

Understand Anything là một Plugin Claude Code phân tích dự án của bạn bằng pipeline đa-agent, xây dựng đồ thị tri thức của mọi tệp, hàm, lớp và phụ thuộc, sau đó cung cấp cho bạn một dashboard tương tác để khám phá trực quan. Thôi đọc code mù — hãy nhìn thấy bức tranh toàn cảnh.

> **Mục tiêu không phải là một đồ thị gây ấn tượng về codebase phức tạp của bạn — mà là một đồ thị lặng lẽ dạy bạn mỗi phần kết nối như thế nào.**

---

## Tính năng

- **Khám phá đồ thị cấu trúc** — Điều hướng codebase dưới dạng đồ thị tri thức tương tác
- **Hiểu logic nghiệp vụ** — Chuyển sang chế độ domain để xem code ánh xạ đến quy trình nghiệp vụ thực tế
- **Phân tích cơ sở kiến thức** — Chỉ `/understand-knowledge` vào wiki LLM theo mẫu Karpathy để có đồ thị kiến thức với phân cụm cộng đồng
- **Hướng dẫn tự động** — Các phần đi tự động qua kiến trúc, sắp xếp theo phụ thuộc
- **Tìm kiếm mờ & ngữ nghĩa** — Tìm bất kỳ thứ gì theo tên hoặc ý nghĩa
- **Phân tích tác động diff** — Xem phần nào của hệ thống bị ảnh hưởng trước khi commit
- **UI thích ứng theo vai trò** — Dashboard điều chỉnh chi tiết dựa trên vai trò của bạn
- **Trực quan hóa tầng kiến trúc** — Phân nhóm tự động theo tầng kiến trúc
- **Khái niệm ngôn ngữ** — 12 mẫu lập trình được giải thích trong ngữ cảnh

---

## Cài đặt nhanh

### 1. Cài đặt plugin

```bash
/plugin marketplace add Lum1104/Understand-Anything
/plugin install understand-anything
```

### 2. Phân tích codebase

```bash
/understand
```

Một pipeline đa-agent quét dự án, trích xuất mọi tệp, hàm, lớp và phụ thuộc, sau đó xây dựng đồ thị tri thức lưu tại `.understand-anything/knowledge-graph.json`.

**Đầu ra đa ngôn ngữ:** Dùng `--language` để tạo nội dung bằng ngôn ngữ ưa thích:

```bash
# Tạo nội dung tiếng Việt
/understand --language vi

# Các ngôn ngữ hỗ trợ: en (mặc định), zh, zh-TW, ja, ko, ru, vi
```

### 3. Khám phá dashboard

```bash
/understand-dashboard
```

Một dashboard web tương tác mở ra với codebase của bạn được trực quan hóa dưới dạng đồ thị — mã màu theo tầng kiến trúc, có thể tìm kiếm và nhấp chuột.

---

## Cài đặt đa nền tảng

### Câu lệnh một dòng (Codex / OpenCode / OpenClaw / Antigravity / Gemini CLI / Pi Agent / Vibe CLI / VS Code Copilot / Hermes / Cline / KIMI CLI / Trae)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
iwr -useb https://raw.githubusercontent.com/Lum1104/Understand-Anything/main/install.ps1 | iex
```

Trình cài đặt clone repo về `~/.understand-anything/repo` và tạo các symlink phù hợp cho nền tảng đã chọn.

---

## Chia sẻ đồ thị với đội

Đồ thị chỉ là JSON — **commit một lần, đồng đội bỏ qua pipeline**. Tốt cho onboarding, review PR, và docs-as-code.

**Cần commit:** mọi thứ trong `.understand-anything/` *trừ* `intermediate/` và `diff-overlay.json`.

```gitignore
.understand-anything/intermediate/
.understand-anything/diff-overlay.json
```

---

## Công nghệ

### Tree-sitter + LLM kết hợp

Phân tích tĩnh và LLM mỗi bên làm những gì họ giỏi nhất:

- **Tree-sitter (xác định)** — phân tích source thành AST và trích xuất cấu trúc: imports, exports, hàm/lớp, call sites. Cùng input → cùng output, mọi lần chạy.
- **LLM (ngữ nghĩa)** — đọc cấu trúc đã parse cùng source gốc để tạo những gì parser không thể: tóm tắt tiếng Anh, thẻ, phân tầng kiến trúc, hướng dẫn, khái niệm ngôn ngữ.

### Pipeline đa-agent

`/understand` điều phối 5 agent chuyên biệt, `/understand-domain` thêm agent thứ 6:

| Agent | Vai trò |
|-------|---------|
| `project-scanner` | Khám phá tệp, phát hiện ngôn ngữ và framework |
| `file-analyzer` | Trích xuất hàm, lớp, imports; tạo node và edge đồ thị |
| `architecture-analyzer` | Xác định các tầng kiến trúc |
| `tour-builder` | Tạo các phần hướng dẫn học tập |
| `graph-reviewer` | Xác thực độ đầy đủ và toàn vẹn của đồ thị |
| `domain-analyzer` | Trích xuất domain nghiệp vụ, luồng và bước |

Các file analyzer chạy song song (tối đa 5 concurrent, 20-30 tệp mỗi batch). Hỗ trợ cập nhật tăng dần — chỉ phân tích lại các tệp đã thay đổi.

---

## Đóng góp

Đóng góp được hoan nghênh!

1. Fork repository
2. Tạo branch tính năng (`git checkout -b feature/my-feature`)
3. Chạy tests (`pnpm --filter @understand-anything/core test`)
4. Commit thay đổi và mở pull request

---

<p align="center">
  <strong>Thôi đọc code mù. Hãy hiểu mọi thứ.</strong>
</p>

<p align="center">
  MIT License &copy; <a href="https://github.com/Lum1104">Lum1104</a>
</p>
