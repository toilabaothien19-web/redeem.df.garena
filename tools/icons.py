"""Tạo biểu tượng màu khác từ icons/icon{16,48,128}.png (màu xanh lá Delta Force).

Chạy: python3 tools/icons.py   (cần Pillow)

Màu lấy theo theme của trang FADEX.VN (src/styles.css):
  - intl: xanh dương mặc định của trang, #0079d5   → icons/icon<cỡ>-intl.png (bản quốc tế)
  - red:  đỏ báo lỗi (.is-fault), #f7413d           → icons/icon<cỡ>-red.png  (có code lỗi)
Chỉ đổi phần hình tam giác màu xanh lá (#01fc94) và viền hòa trộn của nó; nền và các vệt vàng giữ nguyên.
"""
import colorsys
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = (1, 252, 148)  # màu xanh lá của biểu tượng gốc
TARGETS = {"intl": (0x00, 0x79, 0xD5), "red": (0xF7, 0x41, 0x3D)}
BG_GREEN = 40  # kênh G của nền tối


def hue_weight(r, g, b):
    """1 với điểm thuộc màu xanh lá (và viền), 0 với nền xanh ngọc tối và vệt vàng."""
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    deg = h * 360
    if s < 0.25:
        return 0.0
    if 120 <= deg <= 176:
        return 1.0
    if 100 <= deg < 120:
        return (deg - 100) / 20
    if 176 < deg < 192:
        return (192 - deg) / 16
    return 0.0


def recolor(img, target):
    out = img.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            weight = hue_weight(r, g, b)
            if weight <= 0:
                continue
            t = max(0.0, min(1.0, (g - BG_GREEN) / (SOURCE[1] - BG_GREEN))) * weight
            nr, ng, nb = (round(c + t * (tc - sc)) for c, sc, tc in zip((r, g, b), SOURCE, target))
            px[x, y] = (max(0, min(255, nr)), max(0, min(255, ng)), max(0, min(255, nb)), a)
    return out


def main():
    for size in (16, 48, 128):
        src = Image.open(os.path.join(ROOT, "icons", f"icon{size}.png")).convert("RGBA")
        for name, color in TARGETS.items():
            path = os.path.join(ROOT, "icons", f"icon{size}-{name}.png")
            recolor(src, color).save(path, optimize=True)
            print("đã ghi", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
