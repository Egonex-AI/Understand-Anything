# Hướng dẫn xuất nội dung tiếng Việt (Vietnamese)

Tệp này cung cấp hướng dẫn dành riêng cho tiếng Việt khi tạo nội dung đồ thị tri thức.

## Quy ước đặt thẻ

Dùng thẻ tiếng Việt hoặc thuật ngữ kỹ thuật tiếng Anh phổ biến:

| Mẫu | Thẻ gợi ý |
|---------|---------|
| Tệp điểm vào | `điểm-vào`, `barrel`, `exports` hoặc `entry-point` |
| Hàm tiện ích | `tiện-ích`, `helpers`, `utility` |
| Trình xử lý API | `api-handler`, `controller`, `endpoint` |
| Mô hình dữ liệu | `mô-hình-dữ-liệu`, `entity`, `schema` hoặc `data-model` |
| Tệp kiểm thử | `kiểm-thử`, `unit-test`, `test` |
| Tệp cấu hình | `cấu-hình`, `build-system`, `configuration` |
| Hạ tầng | `hạ-tầng`, `deployment`, `infrastructure` |
| Tài liệu | `tài-liệu`, `guide`, `documentation` |

**Chiến lược kết hợp:** giữ nguyên tiếng Anh cho thuật ngữ kỹ thuật phổ biến (`middleware`, `api-handler`...); có thể dùng tiếng Việt cho các thẻ mang tính mô tả.

## Phong cách tóm tắt

Viết tóm tắt 1-2 câu bằng tiếng Việt:
- Mô tả **mục đích** và **vai trò** của tệp
- Dùng câu chủ động ("Cung cấp...", "Xử lý...", "Quản lý...")
- Tránh lặp lại tên tệp

**Ví dụ:**
- Tốt: "Cung cấp các hàm tiện ích định dạng ngày và làm sạch chuỗi được dùng trong toàn bộ tầng API."
- Chưa tốt: "Tệp utils chứa các hàm tiện ích."

## Thuật ngữ kỹ thuật

Giữ nguyên tiếng Anh cho các thuật ngữ sau (khi không có bản dịch chuẩn):
- `middleware`, `hook`, `barrel`, `entry-point`
- `ORM`, `REST API`, `CI/CD`, `CRUD`
- `singleton`, `factory`, `observer`
- `interceptor`, `guard`

## Tên tầng

Dùng tên tầng tiếng Việt:
- `Tầng API`, `Tầng dịch vụ`, `Tầng dữ liệu`, `Tầng giao diện`
- `Hạ tầng`, `Cấu hình`, `Tài liệu`
- `Tầng tiện ích`, `Tầng middleware`, `Tầng kiểm thử`

Hoặc giữ nguyên tiếng Anh (theo quy ước của nhóm):
- `API Layer`, `Service Layer`, `Data Layer`
