# Hướng dẫn Xuất bản tiếng Việt

Tệp này cung cấp hướng dẫn riêng cho từng ngôn ngữ khi tạo nội dung đồ thị tri thức bằng tiếng Việt.

## Quy ước Thẻ

Sử dụng thẻ viết thường, nối bằng dấu gạch ngang bằng tiếng Việt hoặc thuật ngữ kỹ thuật phổ biến bằng tiếng Anh:

| Mẫu | Thẻ đề xuất |
|---------|---------|
| Tệp điểm vào | `diem-vao`, `barrel`, `xuat-khau` |
| Hàm tiện ích | `tien-ich`, `helpers`, `utility` |
| Xử lý API | `xu-ly-api`, `controller`, `endpoint` |
| Mô hình dữ liệu | `mo-hinh-du-lieu`, `entity`, `schema` |
| Tệp kiểm thử | `kiem-thu`, `unit-test`, `test` |
| Tệp cấu hình | `cau-hinh`, `build-system`, `configuration` |
| Hạ tầng | `ha-tang`, `deployment`, `infrastructure` |
| Tài liệu | `tai-lieu`, `guide`, `documentation` |

**Chiến lược pha trộn:** Giữ nguyên các thuật ngữ kỹ thuật phổ biến bằng tiếng Anh (`middleware`, `api-handler`, v.v.), các thẻ mô tả có thể dùng tiếng Việt.

## Phong cách Tóm tắt

Viết tóm tắt 1-2 câu bằng tiếng Việt:
- Mô tả **mục đích** và **vai trò** trong dự án
- Dùng giọng chủ động ("Cung cấp...", "Xử lý...", "Quản lý...")
- Tránh lặp lại tên tệp

**Ví dụ:**
- Tốt: "Cung cấp các hàm trợ giúp định dạng ngày tháng và làm sạch chuỗi được sử dụng xuyên suốt tầng API."
- Tệ: "Tệp utils chứa các hàm tiện ích."

## Thuật ngữ Kỹ thuật

Giữ nguyên các thuật ngữ sau bằng tiếng Anh (không có bản dịch chuẩn):
- `middleware`, `hook`, `barrel`, `entry-point`
- `ORM`, `REST API`, `CI/CD`, `CRUD`
- `singleton`, `factory`, `observer`
- `interceptor`, `guard`

## Tên Tầng Kiến trúc

Sử dụng tên tầng tiếng Việt hoặc giữ tiếng Anh (tùy theo thói quen nhóm):
- `Tầng API`, `Tầng Dịch vụ`, `Tầng Dữ liệu`, `Tầng UI`
- `Hạ tầng`, `Cấu hình`, `Tài liệu`
- `Tầng Tiện ích`, `Tầng Trung gian`, `Tầng Kiểm thử`

Hoặc giữ tiếng Anh:
- `API Layer`, `Service Layer`, `Data Layer`, `UI Layer`
