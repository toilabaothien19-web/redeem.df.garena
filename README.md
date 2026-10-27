<p align="center">
  <img src="icons/icon128.png" width="96" alt="DF Code Garena">
</p>

# DF Code Garena

Tiện ích Chrome / Edge để nhập danh sách code Delta Force trên trang đổi quà chính thức của Garena. Mã nguồn để công khai, không qua bước build: file bạn đọc trên GitHub là file được cài vào trình duyệt.

Phiên bản hiện tại: **1.9.9**

Trang đổi code: https://redeem.df.garena.sg/vi/cdkgarena.html

## Vì sao có tiện ích này

Đã có nhiều bài viết về việc dùng tiện ích nhập code của bên khác rồi bị xâm nhập tài khoản, bị đổi thông tin hoặc bị phá hoại. Những tiện ích đó thường xin quyền rộng, đọc cookie phiên đăng nhập, hoặc gửi dữ liệu về máy chủ riêng. Người dùng không đọc được mã, nên không biết tiện ích đang làm gì sau khi bấm Cài.

DF Code Garena được viết lại cho đúng một việc: điền code vào ô trên trang Garena và ghi lại câu trang trả về. Nó không thu thập tài khoản. Toàn bộ mã nằm trong kho này để ai cũng mở ra kiểm tra, không nhúng thư viện và không tải mã từ nơi khác lúc chạy.

Công khai mã nguồn không có nghĩa là mọi bản tải trên mạng đều an toàn. Một bản bị sửa, hoặc một bản đăng lại ở nơi khác, có thể thêm đoạn đọc cookie. Chỉ tin bản trong kho này, và đối chiếu hash trước khi cài.

## Việc tiện ích không làm

- Không hỏi mật khẩu, không đọc cookie, không đọc tên đăng nhập.
- Không có quyền `cookies`, không có `host_permissions`, không xin quyền trên mọi trang web.
- Popup và service worker không tự mở kết nối mạng. CSP để `connect-src 'none'`.
- Không có trình theo dõi, không gửi log về máy chủ nào.
- Không nhúng mã nguồn của tiện ích nhập code khác.

Log, danh sách code và tùy chọn chỉ nằm trong `chrome.storage.local` trên máy bạn, trừ khi chính bạn bấm xuất file.

## Việc tiện ích có làm

Chỉ khi tab Trung Tâm Đổi Quà đang mở, tiện ích điền code, bấm nút đổi trên trang đó, rồi đọc câu trang và máy chủ trả về cho đúng lần bấm ấy.

`inject.js` có bọc `fetch` và `XMLHttpRequest` của trang, nhưng chỉ để đọc phản hồi của request đổi code (`RedeemCDKey`) do chính trang Garena gửi. Nó không tạo request mới và không gửi nội dung đó đi đâu khác. Đoạn này nằm hết trong [inject.js](inject.js), có thể đọc trực tiếp.

Tiện ích vẫn là công cụ nhập tự động trên tài khoản bạn đã đăng nhập. Garena vẫn có thể giới hạn tài khoản vì nhập quá nhanh. Bật **Bảo vệ tài khoản** chỉ làm chậm lại và tạm nghỉ sau 5 lỗi liên tiếp. Không có gì cam kết tài khoản không bị khóa.

## Cài

Cần Chrome hoặc Edge từ phiên bản 111. Không dùng được trên Chrome điện thoại.

1. Tải `df-code-garena-1.9.9.zip` từ [Releases](https://github.com/toilabaothien19-web/redeem.df.garena/releases) của kho này. Không cài file đính kèm trong bài viết lạ, nhóm chat, hoặc kho fork chưa đối chiếu.
2. Nếu máy đã có thư mục bản cũ, xóa thư mục đó. Không giải nén đè.
3. Giải nén. Bên trong là thư mục `df-code-garena`. Tên file zip có số phiên bản, tên thư mục thì giữ nguyên.
4. Mở `chrome://extensions` hoặc `edge://extensions`.
5. Bật **Chế độ dành cho nhà phát triển**.
6. Bấm **Tải tiện ích đã giải nén** và chọn cả thư mục `df-code-garena`.
7. Đối chiếu `SHA256SUMS` như mục bên dưới. Hash lệch thì xóa và không dùng.

Đã cài bản cũ thì xóa thư mục cũ, giải nén bản mới, rồi bấm tải lại trên thẻ tiện ích. Trang đổi code đang mở thì bấm F5.

## Dùng

1. Mở trang đổi code và đăng nhập Garena. Tiện ích không hỏi mật khẩu.
2. Bấm biểu tượng DF.
3. Dán code, bấm **Mở file .txt**, hoặc **Demo Code** nếu chưa có danh sách. Mỗi dòng một code. Dòng bắt đầu bằng `#` bị bỏ qua. **Xóa toàn bộ** chỉ xóa ô danh sách, không xóa log. Demo Code là danh sách mẫu, có thể đã hết hạn. Mỗi code sai là một lần thử trên tài khoản của bạn.
4. Nên để bật **Bảo vệ tài khoản**. Khi bật: nghỉ ngẫu nhiên 20–30 giây, tối đa 30 code mỗi lần bấm, 30 code mỗi 60 phút và 60 code mỗi 24 giờ. Sau 5 lỗi liên tiếp, tiện ích tự nghỉ ngẫu nhiên 30,0–60,0 giây rồi nhập tiếp. Bấm **Dừng** trong lúc nghỉ thì không nhập tiếp. Tắt bảo vệ thì tối đa 100 code mỗi lần và có hỏi lại.
5. Bấm **Bắt đầu**. Đóng popup không làm dừng. Không mở hai tab đổi quà để chạy cùng lúc.
6. Log ghi câu trên trang và câu máy chủ, kèm mã lỗi. **Chép mã lỗi** copy đúng dòng đó.
7. **Xuất log** ra file `.txt`. Đọc file trước khi chia sẻ. **Tải log lên** để lần sau bỏ qua code đã thành công và code lỗi.

Khi tắt bảo vệ, khoảng cách mỗi lần nhập kéo từ 5 đến 60 giây, hoặc nghỉ ngẫu nhiên 10–15 giây. Khi bật bảo vệ, hai tùy chọn đó được ẩn.

Nhật ký thay đổi: [CHANGELOG.txt](CHANGELOG.txt).

## Tự kiểm tra an toàn

Làm các bước này trên bản sắp cài, không chỉ đọc phần giới thiệu.

### 1. Khớp hash với bản đã công bố

Trong thư mục `df-code-garena` vừa giải nén:

```bash
sha256sum -c SHA256SUMS
```

Windows PowerShell, đứng trong thư mục đó:

```powershell
Get-Content .\SHA256SUMS | ForEach-Object {
  $hash, $name = $_ -split '\s+', 2
  $actual = (Get-FileHash -Algorithm SHA256 -Path $name).Hash.ToLower()
  if ($actual -eq $hash) { "OK  $name" } else { "LECH  $name" }
}
```

Có dòng `LECH` thì không cài. `SHA256SUMS` khóa các file chạy được (`manifest.json`, `inject.js`, `parser.js`, `runner.js`, `popup.js`, `popup.html`, `popup.css`, `sw.js` và icon). File hướng dẫn không nằm trong bảng hash.

### 2. Đọc quyền trong manifest

Mở [manifest.json](manifest.json). Bản này chỉ có:

- `permissions`: `storage`, `activeTab`
- không có `cookies`
- không có `host_permissions`
- không có `<all_urls>`
- `content_scripts` chỉ khớp `https://redeem.df.garena.sg` và đường dẫn `cdkgarena.html`

Sau khi cài, vào `chrome://extensions`, bấm **Chi tiết**. Quyền trang web phải là trang đổi code Garena, không phải toàn bộ các trang bạn mở.

### 3. Tìm trong mã nguồn những lệnh đáng ngờ

Đứng ở thư mục gốc của kho hoặc thư mục vừa giải nén:

```bash
grep -RInE "document\.cookie|chrome\.cookies|sendBeacon|WebSocket|gtag|google-analytics|facebook\.net" \
  --include='*.js' --include='*.html' --include='*.json' .
```

Bản này không có các lệnh đó. `cookie` chỉ xuất hiện trong câu xóa token trước khi ghi log, trong [parser.js](parser.js).

Rồi tìm chỗ có mạng:

```bash
grep -RInE "window\.fetch|XMLHttpRequest|https?://" \
  --include='*.js' --include='*.html' --include='*.json' .
```

Kết quả hợp lệ là chỗ gán `window.fetch` và `XMLHttpRequest` trong [inject.js](inject.js), cùng địa chỉ `https://redeem.df.garena.sg` trong [manifest.json](manifest.json). Không có địa chỉ máy chủ thứ ba. Nếu bản bạn tải có URL lạ, domain lạ, hoặc `document.cookie`, đó không phải bản này.

### 4. Xem Network trên trình duyệt

- Chuột phải vào popup tiện ích, chọn **Kiểm tra** (Inspect). Thẻ **Network** phải trống. Popup không được gọi ra ngoài.
- Mở trang đổi code, bấm F12, thẻ **Network**, rồi bấm **Bắt đầu**. Request đổi code phải do trang `redeem.df.garena.sg` gửi, cột Initiator là trang đó. Không có request nào xuất phát từ `chrome-extension://` đi tới domain khác.
- Trang Garena tự tải script của chính họ (đo lường, cookie banner). Đó không phải do tiện ích thêm vào. Nhìn cột Initiator để phân biệt.

### 5. Đọc đúng file ngắn

| File | Việc cần thấy |
| --- | --- |
| [manifest.json](manifest.json) | Quyền hẹp, CSP `connect-src 'none'` |
| [sw.js](sw.js) | Chỉ xóa hoặc hiện số trên biểu tượng |
| [inject.js](inject.js) | Chỉ đọc phản hồi `RedeemCDKey`, gửi kết quả qua `MessageChannel` |
| [runner.js](runner.js) | Chỉ lưu log và trạng thái vào `chrome.storage.local` |
| [popup.js](popup.js) | Không có địa chỉ mạng |

`MessageChannel` nằm giữa phần chạy chung trang và phần chạy tách biệt. Script khác trên trang không giữ được kênh đó, nên không ra lệnh nhập hộ và không sửa câu kết quả trên đường về log.

## Giới hạn

- Chỉ chạy trên `https://redeem.df.garena.sg` khi tab đổi code đang mở.
- Không cam kết tài khoản không bị khóa. Bảo vệ tài khoản chỉ nhập chậm hơn, giới hạn số lần, và tạm nghỉ sau 5 lỗi liên tiếp.
- Câu trong log là câu trang Garena trả về lúc nhập. Trang đổi câu thì log đổi theo.
- Mã nguồn công khai để kiểm tra, không phải giấy phép dùng mã này trong một tiện ích khác rồi gắn thêm thu thập dữ liệu.
