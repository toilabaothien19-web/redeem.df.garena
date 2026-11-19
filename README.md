<p align="center">
  <img src="icons/icon128.png" width="96" alt="DF Code Garena">
</p>

# DF Code Garena

Tiện ích Chrome / Edge để nhập danh sách code Delta Force trên trang đổi quà chính thức của Garena. Mã nguồn để công khai, không qua bước build: file bạn đọc trên GitHub là file được cài vào trình duyệt.

Phiên bản hiện tại: **1.0.2** · [Nhật ký thay đổi](CHANGELOG.md)

Bản trước khi viết lại (trước đây đánh số 1.9.9) được đánh số lại thành **0.5.0 beta** và chỉ giữ trong lịch sử mã (tag `v0.5.0`, commit `83f3cfb`) để đối chiếu, không phát hành file zip. Hãy dùng bản mới nhất.

Trang đổi code: https://redeem.df.garena.sg/vi/cdkgarena.html

## Vì sao có tiện ích này

Một ngày đẹp trời, tài khoản của tôi bị người khác xâm nhập và phá hoại, dẫn đến lệnh cấm 10 năm. Khi tôi kể chuyện này với bạn bè, một người hỏi tôi có dùng tiện ích nhập code nào của bên ngoài không. Tôi chắc chắn là không. Nhưng câu hỏi đó làm tôi nhận ra chuyện mất tài khoản kiểu này không phải lần đầu xảy ra.

Đã có nhiều bài viết về việc dùng tiện ích nhập code của bên khác rồi bị xâm nhập tài khoản, bị đổi thông tin hoặc bị phá hoại. Những tiện ích đó thường xin quyền rộng, đọc cookie phiên đăng nhập, hoặc gửi dữ liệu về máy chủ riêng. Người dùng không đọc được mã, nên không biết tiện ích đang làm gì sau khi bấm Cài.

Vì vậy tôi làm thêm một tiện ích nhập code nữa. Đúng vậy, lại thêm một tiện ích, nhưng lần này toàn bộ mã được công khai để bất kỳ ai cũng có thể tự kiểm tra độ an toàn rồi mới dùng.

DF Code Garena được viết cho đúng một việc: điền code vào ô trên trang Garena và ghi lại câu trang trả về. Nó không thu thập tài khoản. Toàn bộ mã nằm trong kho này để ai cũng mở ra kiểm tra, không nhúng thư viện và không tải mã từ nơi khác lúc chạy.

Công khai mã nguồn không có nghĩa là mọi bản tải trên mạng đều an toàn. Một bản bị sửa, hoặc một bản đăng lại ở nơi khác, có thể thêm đoạn đọc cookie. Chỉ tin bản trong kho này, và đối chiếu hash trước khi cài.

## Việc tiện ích không làm

- Không hỏi mật khẩu, không đọc cookie, không đọc tên đăng nhập.
- Không có quyền `cookies`, không có `host_permissions`, không xin quyền trên mọi trang web.
- Popup và service worker không tự mở kết nối mạng. CSP để `connect-src 'none'`.
- Không có trình theo dõi, không gửi log về máy chủ nào.
- Không nhúng mã nguồn của tiện ích nhập code khác.

Danh sách code, log và tùy chọn chỉ nằm trong `chrome.storage.local` trên máy bạn, trừ khi chính bạn bấm xuất file.

## Việc tiện ích có làm

Chỉ khi tab Trung Tâm Đổi Quà đang mở, tiện ích điền code, bấm nút Đổi trên trang đó, rồi đọc câu trang và máy chủ trả về cho đúng lần bấm ấy.

[inject.js](inject.js) có bọc `fetch` và `XMLHttpRequest` của trang, nhưng chỉ để đọc phản hồi của request đổi code (`RedeemCDKey`) do chính trang Garena gửi. Nó không tạo request mới và không gửi nội dung đó đi đâu khác.

Tiện ích vẫn là công cụ nhập tự động trên tài khoản bạn đã đăng nhập. Garena vẫn có thể giới hạn tài khoản vì nhập quá nhanh. **Bảo vệ tài khoản** chỉ làm chậm lại, giới hạn số lần và tạm nghỉ sau chuỗi lỗi. Không có gì cam kết tài khoản không bị khóa.

## Cài

Cần Chrome hoặc Edge từ phiên bản 111. Không dùng được trên Chrome điện thoại.

1. Tải `df-code-garena-1.0.2.zip` từ [Releases](https://github.com/toilabaothien19-web/redeem.df.garena/releases) của kho này. Không cài file đính kèm trong bài viết lạ, nhóm chat, hoặc kho fork chưa đối chiếu.
2. Đối chiếu hash như mục [Tự kiểm tra an toàn](#tự-kiểm-tra-an-toàn). Hash lệch thì xóa và không dùng.
3. Nếu máy đã có thư mục bản cũ, xóa thư mục đó. Không giải nén đè.
4. Giải nén. Bên trong là thư mục `df-code-garena`. Tên file zip có số phiên bản, tên thư mục thì giữ nguyên.
5. Mở `chrome://extensions` hoặc `edge://extensions`, bật **Chế độ dành cho nhà phát triển**.
6. Bấm **Tải tiện ích đã giải nén** và chọn cả thư mục `df-code-garena`.

Nâng cấp từ bản cũ (0.5.0 beta, hay 1.9.9 theo số cũ): xóa thư mục cũ, giải nén bản mới vào đúng chỗ đó, rồi **bấm nút tải lại trên thẻ tiện ích** trong `chrome://extensions`. Chỉ khởi động lại trình duyệt thì chưa đủ: Chrome vẫn chạy service worker của bản cũ. Log, danh sách và hạn mức đã dùng vẫn giữ nguyên. Trang đổi code đang mở thì bấm F5.

Cũng có thể tải mã nguồn (Code → Download ZIP hoặc `git clone`) rồi chọn thư mục gốc của kho khi bấm **Tải tiện ích đã giải nén**. Thư mục `tests` và `tools` không ảnh hưởng gì tới tiện ích.

## Dùng

1. Mở trang đổi code và đăng nhập Garena. Tiện ích không hỏi mật khẩu. Đang ở trang khác thì bấm **Mở trang** trên popup.
2. Bấm biểu tượng DF. Nếu popup báo cần tải lại, bấm **Tải lại** (hoặc F5 trên trang).
3. Dán code, bấm **Mở file .txt**, hoặc **Demo Code** nếu chưa có danh sách. Popup cho biết nhận được bao nhiêu code, bỏ bao nhiêu code trùng và bao nhiêu dòng không nhận ra.
4. Nên để bật **Bảo vệ tài khoản**. Ô **lần này** và nút **Bắt đầu** cho biết sẽ nhập bao nhiêu code, kèm hạn mức còn lại và giờ xong dự kiến.
5. Bấm **Bắt đầu** (hoặc Ctrl+Enter trong ô danh sách). Đóng popup không làm dừng. Không mở hai tab đổi quà để chạy cùng lúc.
6. Bấm **Dừng** ở bất kỳ tab nào. Đang nghỉ thì dừng ngay; đang nhập thì dừng sau code đó.
7. Danh sách dài hơn trần mỗi lần thì bấm Bắt đầu lại sau khi hết thời gian chờ. Code đã có trong log tự được bỏ qua.

Để tab đổi code mở trong lúc chạy. Tab bị ẩn quá 5 phút thì Chrome có thể làm chậm bộ đếm, nên thời gian thực tế có thể dài hơn ước tính.

### Bảo vệ tài khoản

| | Bật bảo vệ (mặc định) | Tắt bảo vệ |
| --- | --- | --- |
| Nghỉ giữa hai code | ngẫu nhiên 20–30 giây | cố định 5–60 giây, hoặc ngẫu nhiên 10–15 giây |
| Tối đa mỗi lần bấm Bắt đầu | 30 code | 100 code, có hỏi lại |
| Tối đa mỗi 60 phút | 30 code | 100 code |
| Tối đa mỗi 24 giờ | 60 code | 200 code |
| Nghỉ giữa hai lần bấm Bắt đầu | 60 giây | 20 giây |
| 5 lỗi liên tiếp | tự nghỉ 30,0–60,0 giây rồi nhập tiếp | nhập tiếp |

Ở cả hai chế độ, tiện ích dừng hẳn khi:

- trang trả mã HTTP 403 hoặc 429, hoặc hai lỗi máy chủ 5xx liên tiếp;
- câu trên trang nói tới captcha, xác minh, quá nhiều lần, thử lại sau, khóa tài khoản…;
- không đọc được kết quả của code vừa bấm (ghi "chưa rõ");
- trang bị đăng xuất, hoặc không thấy ô nhập hay nút Đổi.

Hạn mức được đếm theo từng lần thật sự bấm Đổi, nằm trên máy bạn, và không mất khi xóa log.

### Danh sách code

- Mỗi dòng một code là chắc nhất. Code gồm chữ, số, `_` hoặc `-`, dài 4–80 ký tự.
- Dòng bắt đầu bằng `#` hoặc `//` bị bỏ qua. Phần sau ` #` hoặc ` //` cuối dòng cũng vậy.
- Một dòng có thể chứa nhiều code, ngăn bằng dấu phẩy, chấm phẩy, `|`, tab hoặc khoảng trắng.
- Dán từ bài viết cũng được: `1. DFABC123`, `Code: DFABC123`, `DFABC123 - 100 brick`, `DFABC123 (hết hạn 30/11)` đều chỉ lấy `DFABC123`.
- Trên dòng có nhiều chữ, chỉ chữ trông rõ là code mới được lấy (có số, bắt đầu bằng `DF`, viết hoa dài từ 8 ký tự, hoặc kiểu `TrickOrTreat`), để không tốn một lần thử cho chữ như `brick` hay `Delta`. Code nào đứng một mình trên dòng thì luôn được lấy.
- Tối đa 1000 code và 200 KB mỗi lần.

### Nhật ký

- Mỗi lần nhập ghi nguyên câu trên trang và câu máy chủ, kèm mã lỗi. Token, email, liên kết và dãy số dài bị ẩn trước khi ghi.
- **Dùng được**: code đổi thành công. **Lỗi**: máy chủ đã xét code và báo lỗi (hết lượt, không hợp lệ…). **Chưa rõ**: không đọc được kết quả, code chưa được gửi, hoặc trang báo lỗi tạm thời (quá nhiều lần, thử lại sau, lỗi mạng, HTTP 403/429/5xx). Code chưa rõ không bị bỏ qua lần sau.
- Lọc theo từng loại. **Chép mã lỗi** copy đúng dòng đó.
- Log giữ tối đa 5000 lượt. Khi đầy, lượt cũ đã có lượt mới hơn của cùng code bị bỏ trước, rồi tới lượt chưa rõ, nên thông tin dùng để bỏ qua code được giữ lâu nhất có thể.

**Đối chiếu với log.** Khi bật "Bỏ qua code đã có trong log", mỗi code trong danh sách được so với log theo kết quả tốt nhất của nó: đã dùng được hoặc đã lỗi thì bỏ qua, chưa rõ hoặc chưa có thì nhập. Ngay dưới ô số liệu, popup ghi rõ bỏ qua bao nhiêu code và vì sao. So khớp phân biệt chữ hoa/thường, để một code gõ sai hoa/thường không chặn code đúng.

**Xuất log** ra file `.txt` gồm các phần DÙNG ĐƯỢC, LỖI, CHƯA RÕ (sẽ nhập lại), rồi CHI TIẾT từng lượt. Đọc file trước khi chia sẻ.

**Tải log lên** để gộp file log đã xuất (của bản này, hoặc của 0.5.0 beta / 1.9.9 cũ), tối đa 2 MB. Lượt trùng không bị thêm lại. Lỗi tạm thời mà bản cũ ghi là "lỗi" được tính lại thành "chưa rõ". Sau khi nạp, popup cho biết bao nhiêu code trong danh sách hiện tại đã có trong log.

**Xóa log** xóa toàn bộ lượt đã ghi. Sau đó các code đó không còn được bỏ qua khi chạy lại, nên xuất log trước khi xóa. Hạn mức đã dùng không bị xóa theo.

## Tự kiểm tra an toàn

Làm các bước này trên bản sắp cài, không chỉ đọc phần giới thiệu.

### 1. Khớp hash với bản trên GitHub

File `SHA256SUMS` nằm **trong** zip chỉ chứng minh các file khớp với nhau. Ai sửa mã cũng có thể sửa luôn file đó. Muốn chắc bản tải về là bản gốc, so hash với nguồn nằm trên GitHub:

- hash của file zip ghi trong trang [Releases](https://github.com/toilabaothien19-web/redeem.df.garena/releases) của đúng phiên bản; hoặc
- file [SHA256SUMS](SHA256SUMS) trong kho, ở đúng tag phiên bản.

Hash của file zip:

```bash
sha256sum df-code-garena-1.0.2.zip
```

```powershell
(Get-FileHash -Algorithm SHA256 .\df-code-garena-1.0.2.zip).Hash.ToLower()
```

Hash từng file, đứng trong thư mục `df-code-garena` vừa giải nén:

```bash
sha256sum -c SHA256SUMS
```

```powershell
Get-Content .\SHA256SUMS | ForEach-Object {
  $hash, $name = $_ -split '\s+', 2
  $actual = (Get-FileHash -Algorithm SHA256 -Path $name).Hash.ToLower()
  if ($actual -eq $hash) { "OK  $name" } else { "LECH  $name" }
}
```

Có dòng `LECH` hoặc hash zip khác trang Releases thì không cài. `SHA256SUMS` khóa mọi file chạy được: `manifest.json`, `inject.js`, `parser.js`, `runner.js`, `popup.js`, `popup.html`, `popup.css`, `demo-codes.js`, `sw.js` và icon. File hướng dẫn không nằm trong bảng hash.

File zip được đóng gói không nén và có giờ cố định, nên có thể tự tạo lại từ mã nguồn ở đúng tag rồi so: `node tools/pack.mjs` phải ra đúng hash trên trang Releases.

### 2. Đọc quyền trong manifest

Mở [manifest.json](manifest.json). Bản này chỉ có:

- `permissions`: `storage`, `activeTab`
- không có `cookies`, không có `host_permissions`, không có `<all_urls>`
- `content_scripts` chỉ khớp `https://redeem.df.garena.sg` và đường dẫn `cdkgarena.html`
- `homepage_url` trỏ về kho này

Sau khi cài, vào `chrome://extensions`, bấm **Chi tiết**. Quyền trang web phải là trang đổi code Garena, không phải toàn bộ các trang bạn mở.

### 3. Tìm trong mã nguồn những lệnh đáng ngờ

Đứng ở thư mục vừa giải nén:

```bash
grep -RInE "document\.cookie|chrome\.cookies|sendBeacon|WebSocket|EventSource|eval\(|new Function|gtag|google-analytics|facebook\.net" \
  --include='*.js' --include='*.html' --include='*.json' .
```

Bản này không có các lệnh đó. Chữ `cookie` chỉ còn xuất hiện trong biểu thức xóa token trước khi ghi log ([parser.js](parser.js)) và trong các câu chú thích "không đọc cookie".

Rồi tìm chỗ có mạng:

```bash
grep -RInE "fetch|XMLHttpRequest|https?://" --include='*.js' --include='*.html' --include='*.json' .
```

Kết quả hợp lệ:

- chỗ bọc `fetch` và `XMLHttpRequest` trong [inject.js](inject.js);
- địa chỉ `https://redeem.df.garena.sg/...cdkgarena.html` trong [manifest.json](manifest.json) và [parser.js](parser.js) (để nhận đúng trang và cho nút **Mở trang**);
- địa chỉ kho `https://github.com/toilabaothien19-web/redeem.df.garena` ở `homepage_url`.

Không có địa chỉ máy chủ thứ ba. Nếu bản bạn tải có URL lạ, domain lạ, hoặc `document.cookie`, đó không phải bản này. Công cụ `node tools/pack.mjs --check` làm đúng các bước rà soát này một cách tự động.

### 4. Xem Network trên trình duyệt

- Chuột phải vào popup tiện ích, chọn **Kiểm tra** (Inspect). Thẻ **Network** phải trống. Popup không được gọi ra ngoài.
- Mở trang đổi code, bấm F12, thẻ **Network**, rồi bấm **Bắt đầu**. Request đổi code phải do trang `redeem.df.garena.sg` gửi, cột Initiator là trang đó. Không có request nào xuất phát từ `chrome-extension://` đi tới domain khác.
- Trang Garena tự tải script của chính họ (đo lường, cookie banner). Đó không phải do tiện ích thêm vào. Nhìn cột Initiator để phân biệt.

### 5. Đọc đúng file ngắn

| File | Chạy ở đâu | Việc cần thấy |
| --- | --- | --- |
| [manifest.json](manifest.json) | | Quyền hẹp, CSP `connect-src 'none'` |
| [sw.js](sw.js) | service worker | Chỉ hiện hoặc xóa số trên biểu tượng, dọn phiên bị bỏ dở |
| [parser.js](parser.js) | mọi nơi | Logic thuần: đọc code, hạn mức, đọc kết quả, file log. Không DOM, không mạng |
| [inject.js](inject.js) | trang Garena (MAIN) | Điền code, bấm Đổi, chỉ đọc phản hồi `RedeemCDKey`, trả kết quả qua `MessagePort` |
| [runner.js](runner.js) | trang Garena (tách biệt) | Điều phối từng code, chỉ lưu log và trạng thái vào `chrome.storage.local` |
| [popup.js](popup.js) | popup | Giao diện. Không có lệnh mạng |
| [demo-codes.js](demo-codes.js) | popup | Danh sách Demo Code, tạo từ [demo-codes.txt](demo-codes.txt) |

`runner.js` bắt tay với `inject.js` qua `MessageChannel` ngay lúc trang bắt đầu tải, trước khi script của trang chạy, và `inject.js` chặn lời chào đó lại. Nhờ vậy script khác trên trang không xin được kênh để ra lệnh nhập code, không gửi được lệnh hay kết quả giả qua `window.postMessage`, và không gọi được tiện ích qua `chrome.runtime`.

Giới hạn cần biết: `inject.js` buộc phải chạy chung môi trường JavaScript với trang Garena mới đọc được phản hồi đổi code. Nếu chính trang đó cố tình sửa các hàm có sẵn của trình duyệt, nó có thể làm sai câu kết quả ghi vào log. Nó vẫn không đọc được bộ nhớ của tiện ích, không chạy được mã trong popup và không khiến tiện ích nhập code ngoài danh sách của bạn. Trang đổi code là trang của Garena, nơi vốn đã giữ phiên đăng nhập của bạn, nên trường hợp này chỉ xảy ra khi chính trang Garena bị chiếm.

## Dành cho người phát triển

Không cần `npm install`. Chỉ cần Node 18 trở lên.

```bash
node --test                 # chạy bộ test
node tools/pack.mjs --check # rà soát quyền, URL, lệnh cấm; kiểm tra demo-codes.js và SHA256SUMS
node tools/pack.mjs         # đồng bộ demo-codes.js, ghi SHA256SUMS, tạo dist/df-code-garena-<phiên bản>.zip
```

Sửa Demo Code: sửa `demo-codes.txt` rồi chạy `node tools/pack.mjs`. Đừng sửa tay `demo-codes.js`.

Ra phiên bản mới:

1. Đổi `version` trong `manifest.json`, thêm mục mới vào đầu `CHANGELOG.md`, đổi số phiên bản trong README.
2. Chạy `node tools/pack.mjs`, rồi commit cả `SHA256SUMS` và `demo-codes.js`.
3. Đẩy tag `v<phiên bản>` (ví dụ `v1.0.0`; số 0.x được đăng dạng beta). GitHub Actions chạy test, đóng gói và đăng file zip kèm hash lên Releases.

## Giới hạn

- Chỉ chạy trên `https://redeem.df.garena.sg` khi tab đổi code đang mở.
- Không cam kết tài khoản không bị khóa. Bảo vệ tài khoản chỉ nhập chậm hơn, giới hạn số lần, và tạm nghỉ sau chuỗi lỗi.
- Câu trong log là câu trang Garena trả về lúc nhập. Trang đổi câu hoặc đổi giao diện thì log, hoặc cả việc nhập, có thể đổi theo.
- Mã nguồn công khai để kiểm tra, không phải giấy phép dùng mã này trong một tiện ích khác rồi gắn thêm thu thập dữ liệu.
