# Nhật ký thay đổi — DF Code Garena

Từ bản 1.0.0, số phiên bản được đánh lại. Mã trước khi viết lại, trước đây đánh số 1.9.9, nay là **0.5.0 beta**. Các mốc cũ 1.0 đến 1.9.9 vẫn giữ ở cuối file với số cũ, chỉ để tra cứu.

## 1.0.3

Phát hiện ký tự sai trong code.

- **Sửa lỗi của 1.0.2:** chữ trông giống chữ Latin nằm ở đầu hoặc cuối code bị cắt mất, khiến tiện ích nhập nhầm một code khác (`АBC123` với A Kirin thành `BC123`; `DFABC12З` thành `DFABC12`), tốn một lần thử. Giờ chỉ cắt emoji, dấu câu, ký hiệu ở hai đầu.
- Code có ký tự sai không được nhập và được liệt kê dưới ô danh sách, tô màu đúng ký tự sai, kèm lý do và số dòng: chữ Kirin/Hy Lạp trông giống chữ Latin, số La Mã, ký tự toàn chiều rộng, chữ in đậm/nghiêng kiểu đặc biệt, gạch ngang dài, chữ có dấu do bộ gõ Telex/VNI, ký tự đặc biệt giữa code.
- Nút **Sửa tự động** sửa: chữ trông giống chữ Latin, số La Mã, chữ toàn chiều rộng, chữ kiểu, gạch dài; **ký tự đặc biệt giữa code** (bỏ đi, vì 408 code đã biết không code nào có `.`, `@` hay chữ tiếng Việt); **chữ có dấu do Telex/VNI** (suy ngược phím đã gõ, kể cả phím dấu gõ muộn, so với code đã biết để chọn đúng; không khớp thì đoán theo cặp ký tự hay gặp trong code thật và ghi "đoán, cần xem lại"). Thử gõ 408 Demo Code bằng Telex: phát hiện đủ 293 code bị đổi, không nhập nhầm, sửa đúng 93% khi code đã biết và 74% khi là code mới.
- Bấm Bắt đầu khi còn code có ký tự sai thì popup hỏi lại.
- Không báo nhầm chữ tiếng Việt (kể cả in hoa), giá tiền, số có dấu phân cách, email.
- Bỏ thêm ký tự vô hình hay gặp khi dán emoji (chọn kiểu emoji, khung phím số).
- `tools/pack.mjs --check` chặn ký tự vô hình và ký tự đảo chiều chữ trong mã tiện ích. Các biểu thức trong mã viết dạng `\uXXXX` thay vì ký tự thật.

## 1.0.2

Tập trung vào log: xóa, xuất, nạp và đối chiếu code.

- Lỗi tạm thời (HTTP 403/429/5xx, "thử lại sau", "thao tác quá nhiều lần", lỗi mạng, cần xác minh) ghi là **chưa rõ** thay vì **lỗi**. Trước đây code gặp lỗi kiểu này bị bỏ qua vĩnh viễn dù máy chủ chưa hề xét nó. Một lỗi máy chủ lẻ thì nhập tiếp code sau; hai lỗi liên tiếp, 403 hoặc 429 thì vẫn dừng như cũ.
- Trang trả lỗi HTTP mà nội dung không đọc được (vd 502) vẫn ghi lại mã HTTP.
- Log lưu từ bản trước được sửa khi cập nhật: lỗi tạm thời đổi thành chưa rõ. File log cũ khi nạp cũng được tính lại như vậy.
- Log giữ tối đa 5000 lượt (trước là 2000). Khi đầy, bỏ trước lượt cũ đã có lượt mới hơn của cùng code, rồi tới lượt chưa rõ, nên không mất thông tin bỏ qua code.
- Nạp file log cũ không còn đẩy mất lượt mới đang có: log được sắp lại theo giờ trước khi cắt. Giờ trong file được đọc thành mốc thời gian thật, cả định dạng của 0.5.0 beta.
- Nhận file log tới 2 MB (trước 200 KB). File xuất từ log 2000 lượt nặng gần 400 KB nên trước đây không nạp lại được.
- File log xuất ra có thêm phần CHƯA RÕ, liệt kê code sẽ nhập lại.
- Popup ghi rõ bỏ qua bao nhiêu code đã có trong log (bao nhiêu dùng được, bao nhiêu lỗi). Sau khi nạp log thì báo kết quả đối chiếu với danh sách hiện tại.
- Hộp xác nhận Xóa log nói rõ code sẽ không còn được bỏ qua và nhắc xuất log trước.
- Ngày giờ vô lý trong file log (vd 32/13) bị bỏ qua thay vì bị đổi thành một ngày khác.
- Code từng ghi chưa rõ được xếp xuống cuối hàng đợi; code chưa có trong log nhập trước.
- Popup cũng tự sửa log cũ khi mở, phòng trường hợp cập nhật mà quên bấm tải lại.
- Đọc danh sách code: nhận code dán kèm emoji, dấu sao, dấu câu hay ngoặc kép kiểu Nhật (`DFABC123🔥`, `**DFABC123**`, `「DFABC123」`) và code nằm trong ngoặc (`(DFABC123)`); `(5000)` vẫn không bị tính. Dòng `#` ở đầu vẫn là chú thích; `#` giữa dòng chỉ là chú thích khi có khoảng trắng phía sau.
- Dán một dòng rất dài toàn dấu mở ngoặc không còn làm treo popup (trước đây 200 KB mất khoảng 20 giây, nay vài mili giây).
- Đọc giờ, xuất log không ném lỗi với dữ liệu hỏng trong bộ nhớ (thử ngẫu nhiên 20.000 lần).
- README nói đúng giới hạn: script trên chính trang Garena, nếu cố tình sửa hàm có sẵn của trình duyệt, có thể làm sai câu kết quả ghi vào log.

## 1.0.1

- Log ghi đủ câu trên trang cả khi hộp thoại của Garena hiện chậm hơn phản hồi máy chủ. Trước đây có lần chỉ ghi câu của máy chủ, ví dụ `The current cdkey has reached the redemption limit | 400068` thay vì `error_hint_400068 | The current cdkey has reached the redemption limit`; với code thành công có thể chỉ ghi số `0`. Giờ có phản hồi mà chưa thấy hộp thoại thì chờ thêm tối đa 2,5 giây.
- Nhận đúng câu mới khi nhiều code liên tiếp cùng một lỗi (trang hiện lại đúng câu cũ) và khi hộp thoại có hiệu ứng mờ dần.
- Demo Code: thêm 42 code, tổng cộng 408.
- HUONG-DAN.txt: thêm lại hướng dẫn nâng cấp (bấm nút tải lại trên thẻ tiện ích).

Cách đổi code trên trang, các mức bảo vệ và quyền giữ nguyên.

## 1.0.0

Viết lại toàn bộ mã, giữ nguyên cách nhập code trên trang và các mức bảo vệ của bản 0.5.0 beta (trước đây đánh số 1.9.9).

Sửa lỗi

- Lỗi thao tác trang (mất đăng nhập, trang hiện xác minh, không thấy nút Đổi) không còn bị ghi là "lỗi". Code đó chưa được gửi nên được ghi "chưa rõ", lần sau vẫn nhập, và không bị tính vào hạn mức.
- Câu "Đổi không thành công", "Redemption failed", "Not successful" được tính là lỗi. Trước đây bị ghi chưa rõ và làm dừng cả hàng đợi. Mã số và câu chữ mâu thuẫn thì vẫn ghi chưa xác định.
- Hạn mức mở lại đúng giờ khi số lượt đang vượt trần (ví dụ vừa bật lại bảo vệ sau khi chạy 80 code). Trước đây báo giờ mở sớm hơn thực tế.
- Xuất log rồi tải lại không còn mất các dòng thiếu giờ. Tải cùng một file log hai lần không nhân đôi dòng.
- Phần DÙNG ĐƯỢC và LỖI trong file log mỗi code chỉ hiện một lần, theo kết quả tốt nhất.
- Bộ đọc danh sách không còn gửi nhầm chữ mô tả thành code. Dòng `DFABC - 100 brick` chỉ lấy `DFABC`; dòng `Delta Force` không ra code nào. Bỏ dấu đầu dòng, số thứ tự, ghi chú trong ngoặc, liên kết và ký tự vô hình khi dán từ mạng xã hội.
- Phiên bị ngắt giữa chừng (tắt trình duyệt, đóng tab) không còn kẹt ở trạng thái đang chạy.
- Kiểm tra trang còn đăng nhập trước mỗi code. Bị đăng xuất giữa chừng thì dừng, không bấm tiếp.
- Câu trên hộp thoại và câu máy chủ không còn bị lặp trong log (ví dụ "Code đã được sử dụng | Code đã được sử dụng").
- Chữ trên các nút popup không còn bị thu nhỏ còn 75% (Chrome tự đặt cỡ chữ đó cho trang tiện ích).
- XMLHttpRequest dùng lại không còn giữ địa chỉ cũ. Đọc được phản hồi kiểu JSON và `fetch(new URL(...))`.

Thay đổi

- Bấm Dừng được từ bất kỳ tab nào, kể cả khi không mở tab đổi code. Dừng ngay cả khi đang nghỉ.
- Trước khi bấm Bắt đầu đã thấy: bao nhiêu code chưa nhập, lần này nhập bao nhiêu, hạn mức còn lại trong 60 phút và 24 giờ, giờ xong dự kiến, và thời gian phải chờ nếu chưa được chạy.
- Nút Bắt đầu ghi rõ số code sẽ nhập. Thanh tiến độ, đếm dùng được, lỗi, chưa rõ của phiên đang chạy.
- Nhật ký lọc theo Dùng được, Lỗi, Chưa rõ. Mỗi dòng có nút chép.
- Hộp hỏi lại nằm trong popup, mặc định chọn Hủy.
- Khi không ở trang đổi code: nút Mở trang. Khi trang cần tải lại: nút Tải lại.
- Ghi trạng thái ít hơn hẳn trong lúc nghỉ; popup tự đếm ngược.
- Bắt tay với trang ngay lúc tải, trước khi script của trang chạy. Lời chào bị chặn lại, listener khác trên trang không thấy.
- Demo Code lấy từ `demo-codes.txt` (366 code), không còn chép tay trong `popup.html`.
- Có bộ test (`node --test`) và công cụ đóng gói `node tools/pack.mjs` không cần cài thêm gì. File zip có thể tạo lại và ra đúng cùng hash.
- `SHA256SUMS` khóa thêm `demo-codes.js`. README giải thích vì sao phải so với bản trên GitHub chứ không chỉ với file trong zip.
- Thêm `homepage_url` trỏ về kho này. Quyền giữ nguyên: `storage`, `activeTab`.

## 0.5.0 beta

- Mã gốc trước khi viết lại, trước đây đánh số 1.9.9. Chỉ đổi số phiên bản; mã chạy giữ nguyên.
- Không phát hành file zip; mã giữ trong lịch sử git (tag `v0.5.0`, commit `83f3cfb`) để đối chiếu. Các lỗi của bản này đã được sửa ở 1.0.0.

## Lịch sử trước 0.5.0 (số cũ)

Các mốc 1.0 đến 1.9.1 ghi theo thứ tự chức năng đã làm để ra bản 1.9.2. Từ 1.9.2 trở đi, từng mục khớp với bản đã đóng gói.

### 1.9.9 (số cũ, nay là 0.5.0 beta)

- Sau 5 lỗi liên tiếp, tự nghỉ ngẫu nhiên từ 30,0 đến 60,0 giây rồi nhập tiếp. Không cần bấm Bắt đầu lại.
- Số giây có một chữ số lẻ, ví dụ 30,1 hoặc 59,5, và đếm ngược trên dòng trạng thái.

### 1.9.8 (số cũ)

- Log hiện ngay khi trang đã trả kết quả, không chờ thêm 3–5 giây.
- Ghi đủ câu trên hộp thoại, câu gợi ý và mã lỗi máy chủ. Không bỏ error_hint.

### 1.9.7 (số cũ)

- Dòng "Cần nghỉ … giây trước khi bấm Bắt đầu lại." đếm ngược từng giây.

### 1.9.6 (số cũ)

- Không ghi chữ "ok" của máy chủ khi trang còn hiện câu đầy đủ.
- Chờ hộp thoại hiện xong rồi mới ghi đúng câu trên trang, ví dụ "Successfully claimed! Please check your in-game mail."

### 1.9.5 (số cũ)

- Nút Chép mã lỗi copy đúng dòng được bấm, không còn lấy dòng cuối.
- Hai tab hoặc hai cửa sổ không chạy cùng lúc.
- Khi bật bảo vệ: tối đa 30 code mỗi lần, 30 code mỗi 60 phút, 60 code mỗi 24 giờ, nghỉ 60 giây giữa hai lần bấm Bắt đầu.
- Khi tắt bảo vệ: tối đa 100 code mỗi lần và có hỏi lại, 100 code mỗi 60 phút, 200 code mỗi 24 giờ, nghỉ 20 giây giữa hai lần bấm.
- Hết giờ hoặc không đọc được kết quả thì ghi "chưa xác định", không tính là lỗi, không bỏ qua lần sau, và dừng hàng đợi.
- Dừng khi trang trả 403 hoặc 429, hoặc hai lỗi máy chủ 5xx liên tiếp.
- Mã số và câu chữ mâu thuẫn nhau thì ghi chưa xác định, không đoán.
- Lệnh nhập code đi qua MessageChannel. Script trên trang không giữ kênh nên không ra lệnh và không sửa kết quả.
- Bỏ quyền scripting. Tab mở trước khi cài thì cần F5. Cần Chrome hoặc Edge 111 trở lên.
- Không xóa hoặc nạp log khi phiên đang chạy.
- Demo Code hỏi trước, vì danh sách mẫu có thể đã hết hạn.
- Ẩn dãy số dài trong log. Đọc file log trước khi chia sẻ.

### 1.9.4 (số cũ)

- Giữ nguyên cách nhập code của bản 1.9.3.
- Trang tiện ích không được tự kết nối mạng.
- Lệnh nhập code phải kèm mã ngẫu nhiên đúng 24 ký tự hex.
- Giữ khai báo UTF-8 để chữ tiếng Việt không bị vỡ.

### 1.9.3 (số cũ)

- Câu "không thành công" không còn bị tính là thành công.
- Chỉ nhận phản hồi RedeemCDKey của đúng code vừa bấm.
- Bỏ phản hồi gửi từ trước lúc bấm Đổi.
- Đọc được câu báo lỗi nằm trong data của máy chủ.
- Không tự viết câu thay cho phản hồi không đọc được.

### 1.9.2 (số cũ)

- Bản đã đăng lên GitHub, đủ các chức năng từ 1.0 đến 1.9.1.

### 1.9.1 (số cũ)

- Hết giờ chờ không bị ghi thành lỗi.
- Lỗi nội bộ không để phiên bị kẹt ở trạng thái đang chạy.
- Hai lượt của cùng một code đều được giữ trong lịch sử.

### 1.9.0 (số cũ)

- Không lấy kết quả của code trước gán cho code đang nhập.
- Hộp thoại phải đóng rồi mở lại mới được tính là kết quả mới.
- Trang hiện captcha thì dừng và nói rõ đang cần xác minh.
- Nhận "Redeemed successfully" và "Redemption successful" là thành công.

### 1.8 (số cũ)

- Thêm chế độ bảo vệ tài khoản.
- Khi bật, ẩn nghỉ ngẫu nhiên và thanh kéo. Mỗi code nghỉ ngẫu nhiên 20–30 giây.
- Dừng sau 30 code trong một phiên, hoặc sau 5 lỗi liên tiếp.
- Dừng nếu trang báo rủi ro tài khoản hoặc hiện captcha.
- Ghi số phiên bản ngay dưới tên tiện ích.
- Thêm hiệu ứng khi ẩn hiện tùy chọn và khi có dòng kết quả mới.

### 1.7 (số cũ)

- Bật nghỉ ngẫu nhiên thì thanh kéo biến mất. Tắt thì thanh kéo hiện lại.
- Ước tính thời gian hoàn thành theo giờ 24 giờ trên trình duyệt.
- Vùng log cuộn được.
- Dòng kết quả chỉ lấy đúng chữ trang trả về, không viết thêm.

### 1.6 (số cũ)

- Đổi ô nhập khoảng cách thành thanh kéo từ 5 đến 60 giây.
- Thêm nút Demo Code và nút Xóa toàn bộ. Nút này chỉ xóa danh sách trong ô.
- Đổi icon sang logo Delta Force và đổi màu giao diện thành #00fd9c.

### 1.5 (số cũ)

- Nhật ký giữ nguyên câu hiện trên trang và câu máy chủ gửi.
- Số trên biểu tượng được xóa khi chạy xong và khi xóa log.

### 1.4 (số cũ)

- Bỏ quyền đọc mọi địa chỉ của trang.
- Không nhận lệnh từ trang web. Chỉ popup mới bấm được Bắt đầu.
- Không đọc phản hồi đăng nhập. Chỉ nhìn phản hồi của lần đổi đang chạy.
- Giới hạn kích thước file code và file log.

### 1.3 (số cũ)

- Thêm tùy chọn nghỉ ngẫu nhiên từ 10 đến 15 giây.
- Thêm ước tính thời gian hoàn thành.
- Hiện số code đang có, số thành công và số lỗi.

### 1.2 (số cũ)

- Không lưu cookie, tên đăng nhập hay mật khẩu.
- Không có trình theo dõi.
- Tải file log lên để bỏ qua code đã nhập và code lỗi.
- Token, email và liên kết bị xóa trước khi ghi nhật ký.

### 1.1 (số cũ)

- Bỏ qua code đã thành công và code đã lỗi khi chạy lại.
- Log tiếng Việt có thời gian.
- Xuất file log để xem code dùng được và code lỗi.

### 1.0 (số cũ)

- Bản đầu cho Chrome và Edge.
- Chỉ chạy khi trang đổi code Garena đang mở.
- Dán code hoặc mở file .txt. Dòng bắt đầu bằng # được bỏ qua.
- Có nút dừng, tiến độ và số trên biểu tượng.
- Không hỏi mật khẩu.

### Đã làm rồi gỡ

Các bản 1.10 đến 1.11.5 thử bỏ cơ chế đọc phản hồi mạng, chuyển sang chỉ đọc chữ trên trang. Cách đó gây gán nhầm kết quả của code này cho code khác, nên đã quay lại cách làm của 1.9.3. Bản 1.0.0 vẫn giữ cách đọc phản hồi mạng.
