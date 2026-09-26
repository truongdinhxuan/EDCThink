# Teams Webhook

Mỗi chức năng của app gửi tin vào Microsoft Teams qua **một Teams Workflow riêng**, tức là một HTTP POST URL riêng. Workflow tự đăng tin vào nhóm chat đã cấu hình bên trong nó, và Teams tự lưu lịch sử chạy. App không lưu nhật ký gửi, chỉ lưu kết quả của **lần gửi gần nhất** (các cột `last_*` trong `teams_webhooks`).

Chức năng hiện có: `ORDER_STATUS_CHANGED`. Mỗi lần đơn đổi trạng thái, kể cả lúc tạo đơn, app gửi 1 tin.

## URL Workflow là secret

Ai có URL đều đăng được tin vào nhóm chat, nên URL:

- chỉ nằm trong **Supabase Vault**, mỗi chức năng một secret tên `teams_webhook:{CODE}`;
- không nằm trong `.env` hay trong repo; API không bao giờ trả về, log và thông báo lỗi không chứa URL;
- admin (quyền `teams_webhook.manage`) nhập hoặc đổi URL ngay trên trang **Teams Webhook**: ô nhập dạng mật khẩu, bấm **Lưu URL**. Backend kiểm tra allowlist rồi ghi vào Vault qua `public.set_teams_webhook_url(code, url)`. Sau khi lưu, ô nhập được xoá trắng và trang chỉ còn hiện "Đã lưu";
- server gửi tin thì đọc URL qua `public.get_teams_webhook_url(code)`. Cả hai hàm chỉ `service_role` gọi được.

Cũng có thể nhập URL bằng SQL Editor như dưới đây. Hai cách ghi vào cùng một secret.

### Nhập URL bằng SQL (tuỳ chọn)

Lần đầu:

```sql
select vault.create_secret(
  '<HTTP POST URL của Workflow>',
  'teams_webhook:ORDER_STATUS_CHANGED',
  'Teams workflow: trạng thái đơn hàng'
);
```

Đổi URL:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'teams_webhook:ORDER_STATUS_CHANGED'),
  '<URL mới>'
);
```

Server giữ URL trong bộ nhớ tối đa 5 phút. Lưu URL từ trang thì cache bị xoá ngay; đổi bằng SQL thì chậm nhất 5 phút sau mới có hiệu lực. Nút **Gửi thử** luôn đọc URL mới nhất.

URL phải dùng `https`, host phải thuộc `*.logic.azure.com`, `*.powerplatform.com` hoặc `*.api.powerplatform.com` (hardcode trong `src/teams/urlPolicy.ts`). App không follow redirect.

## Cấu hình server (`server/.env`)

| Biến | Ý nghĩa |
|---|---|
| `SUPABASE_DB_URL` | Kết nối Postgres dùng cho `LISTEN`. Dùng **Session pooler** (cổng 5432) hoặc kết nối trực tiếp, **không dùng Transaction pooler (6543)**. Lấy ở Dashboard → Connect → Session pooler, thêm `?uselibpqcompat=true&sslmode=require`. Để trống thì server không gửi tin nào. |
| `TEAMS_LISTENER_ENABLED` | `false` để process này không nghe sự kiện, ví dụ script chạy một lần. |
| `ORIGIN_URL` | Base của link "👉 Xem chi tiết": `{ORIGIN_URL}/workspace/orders/{id}`. |

## Cách hoạt động

```
đổi trạng thái đơn (RPC, service hay SQL tay)
  → order_revisions INSERT (DB bắt buộc mọi lần đổi trạng thái phải có 1 revision, kể cả lúc tạo đơn)
  → trigger notify_order_status_teams_event → pg_notify('teams_webhook_events', {code, order_id, revision_id, old_status_id, new_status_id, actor_id})
  → NOTIFY chỉ phát khi transaction commit
  → backend (src/teams/listener.ts) giữ 1 kết nối LISTEN, tự kết nối lại khi rớt
  → src/teams/sender.ts: nếu is_active = false hoặc chưa có secret thì bỏ qua;
     nếu không: đọc dữ liệu (get_order_status_teams_event), build HTML, POST { html }
```

- **Gửi bất đồng bộ.** Không làm chậm hay làm fail thao tác đổi trạng thái.
- **Thứ tự:** mỗi đơn có một hàng đợi tuần tự trong bộ nhớ. Tin sau chờ tin trước, kể cả khi tin trước đang retry.
- **Retry:** timeout 10s. 2xx là thành công. 408, 429, 5xx và lỗi mạng thì thử lại tối đa 3 lần sau 5s, 30s, 2 phút (429 theo `Retry-After`). Các mã 4xx khác thất bại ngay. Sau lần gửi cuối cùng, server ghi `last_sent_at`, `last_success`, `last_http_status`, `last_error`.
- **Nhiều instance:** chỉ instance giữ advisory lock mới `LISTEN`, nên mỗi sự kiện chỉ gửi 1 lần. Các instance khác thử lấy lock lại mỗi 30s.

### Rủi ro đã chấp nhận (không có bảng outbox/log)

- Server khởi động lại đúng lúc một tin đang chờ retry thì **tin đó mất**.
- Kết nối LISTEN bị rớt (mạng, pooler khởi động lại) thì các sự kiện phát ra trong lúc rớt **không được gửi lại**.
- Trạng thái, người thao tác và thời gian lấy từ revision nên luôn đúng. Còn số lượng và lý do đọc lúc build tin: nếu đơn đổi 2 trạng thái liên tiếp rất nhanh, tin đầu có thể hiện số lượng của trạng thái sau.

## Thêm một Teams hook mới (không sửa UI)

1. **Tạo Workflow mới trên Teams** (trigger "When a Teams webhook request is received", đăng tin vào nhóm chat mong muốn) và copy HTTP POST URL.
2. **Thêm migration seed 1 dòng** vào `teams_webhooks`:
   ```sql
   insert into public.teams_webhooks (code, title, description, vault_secret_name)
   values ('CODE_MOI', 'Tiêu đề card', 'Mô tả ngắn', 'teams_webhook:CODE_MOI');
   ```
   Nếu sự kiện đến từ DB, thêm vào migration này một trigger gọi `pg_notify('teams_webhook_events', json_build_object('code', 'CODE_MOI', ...)::text)`. Payload chỉ chứa id, dưới 8000 byte.
3. **Thêm 1 entry vào registry** `src/teams/registry.ts`: `code`, `parseEvent` (đọc payload và chọn `queueKey` để giữ thứ tự), `loadEvent` (đọc dữ liệu), `buildHtml`, `buildTestHtml`.

4. **Nhập URL** trên card mới (tự hiện ở trang **Teams Webhook**), hoặc bằng `vault.create_secret('<URL>', 'teams_webhook:CODE_MOI', '...')`.

## Test

- Unit (`npm test`): template HTML (escape, từng trạng thái, cắt còn 20 vật tư), allowlist, retry/backoff, sender (thứ tự, bỏ qua khi tắt hoặc chưa có secret, URL không lọt vào log, `last_*` hay kết quả trả về).
- Integration (DB thật, mock HTTP server; tắt API server trước khi chạy):
  ```bash
  npm run build:ts
  SUPABASE_DB_URL='<session pooler URL của role postgres>' node test/integration/teams-webhook-flow.mjs
  ```
  Test tạm đặt một URL giả vào Vault, bật/tắt công tắc, rồi khôi phục cả hai. Test tạo các đơn `TEAMS-TEST-*`.

## Test thủ công

1. Điền `SUPABASE_DB_URL` vào `server/.env` rồi khởi động server. Log phải có `Teams webhook: listening on teams_webhook_events`.
2. Mở **Quản trị → Teams Webhook**, dán HTTP POST URL của Workflow vào ô "URL Workflow" rồi bấm **Lưu URL**. Nhãn "Chưa cấu hình URL trong Supabase" biến mất.
3. Bật công tắc.
4. Bấm **Gửi thử**. Nhóm chat nhận tin "🧪 Tin nhắn thử từ EDCThink" và card hiện "Thành công".
5. Tạo một đơn. Nhóm chat nhận "🔔 Thông báo đơn hàng mới".
6. Duyệt đơn. Nhóm chat nhận "🔄 Đơn hàng cập nhật trạng thái", kèm dòng "Từ: Chờ xác nhận → Đã xác nhận".
7. Kiểm tra lịch sử chạy của Workflow trong Teams/Power Automate.
