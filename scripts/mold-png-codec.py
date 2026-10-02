"""PNG I/O and resampling only. All grade/marker rules live in shared TS."""
import sys
import os
import json
import base64
import struct
import zlib
from pathlib import Path
from PIL import Image

SIZE_MARK_ALPHA_THRESHOLD = 16
SIZE_MARK_MAX_DEPTH_PX = 6.5 * 72 / 25.4
BOUNDARY_BIN_SIZE = 16

def build_alpha_boundary_index(alpha):
    """Exact exposed pixel-edge segments for the alpha >16 cut silhouette."""
    occupied = alpha > SIZE_MARK_ALPHA_THRESHOLD
    height, width = occupied.shape
    ys, xs = np.nonzero(occupied)
    segments = []

    top = (ys == 0)
    top[ys > 0] |= ~occupied[ys[ys > 0] - 1, xs[ys > 0]]
    for x, y in zip(xs[top], ys[top]):
        segments.append((x, y, x + 1, y))

    right = (xs == width - 1)
    right[xs < width - 1] |= ~occupied[ys[xs < width - 1], xs[xs < width - 1] + 1]
    for x, y in zip(xs[right], ys[right]):
        segments.append((x + 1, y, x + 1, y + 1))

    bottom = (ys == height - 1)
    bottom[ys < height - 1] |= ~occupied[ys[ys < height - 1] + 1, xs[ys < height - 1]]
    for x, y in zip(xs[bottom], ys[bottom]):
        segments.append((x + 1, y + 1, x, y + 1))

    left = (xs == 0)
    left[xs > 0] |= ~occupied[ys[xs > 0], xs[xs > 0] - 1]
    for x, y in zip(xs[left], ys[left]):
        segments.append((x, y + 1, x, y))

    if not segments:
        raise ValueError('La silueta alpha >16 no tiene contorno.')
    segments = np.asarray(segments, dtype=np.float64)
    columns = (width + BOUNDARY_BIN_SIZE - 1) // BOUNDARY_BIN_SIZE
    rows = (height + BOUNDARY_BIN_SIZE - 1) // BOUNDARY_BIN_SIZE
    bins = {}
    radius = SIZE_MARK_MAX_DEPTH_PX
    for segment in segments:
        x1, y1, x2, y2 = segment
        min_x = max(0, int(np.floor((min(x1, x2) - radius) / BOUNDARY_BIN_SIZE)))
        max_x = min(columns - 1, int(np.floor((max(x1, x2) + radius) / BOUNDARY_BIN_SIZE)))
        min_y = max(0, int(np.floor((min(y1, y2) - radius) / BOUNDARY_BIN_SIZE)))
        max_y = min(rows - 1, int(np.floor((max(y1, y2) + radius) / BOUNDARY_BIN_SIZE)))
        for cell_y in range(min_y, max_y + 1):
            for cell_x in range(min_x, max_x + 1):
                bins.setdefault(cell_y * columns + cell_x, []).append(segment)
    return occupied, columns, bins

def make_exact_alpha_distance(occupied, columns, bins):
    cache = {}

    def distance(x, y):
        key = y * occupied.shape[1] + x
        if key in cache:
            return cache[key]
        point_x, point_y = x + 0.5, y + 0.5
        cell_x = int(point_x // BOUNDARY_BIN_SIZE)
        cell_y = int(point_y // BOUNDARY_BIN_SIZE)
        candidates = bins.get(cell_y * columns + cell_x)
        if not candidates:
            cache[key] = float('inf')
            return cache[key]
        seg = np.asarray(candidates, dtype=np.float64)
        ax, ay, bx, by = seg.T
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        t = np.zeros_like(length2)
        nonzero = length2 > 0
        t[nonzero] = np.clip(((point_x - ax[nonzero]) * dx[nonzero] +
                              (point_y - ay[nonzero]) * dy[nonzero]) / length2[nonzero], 0, 1)
        nearest_x, nearest_y = ax + t * dx, ay + t * dy
        result = float(np.sqrt(np.min((point_x - nearest_x) ** 2 + (point_y - nearest_y) ** 2)))
        cache[key] = result
        return result

    return distance

def add_png_text_chunk(file_path, keyword, value):
    path = Path(file_path)
    raw = path.read_bytes()
    if raw[:8] != b'\x89PNG\r\n\x1a\n' or raw[-8:-4] != b'IEND':
        raise ValueError('Invalid PNG for metadata insertion')
    payload = keyword.encode('latin1') + b'\0' + value.encode('utf-8')
    chunk_type = b'tEXt'
    chunk = struct.pack('>I', len(payload)) + chunk_type + payload + struct.pack('>I', zlib.crc32(chunk_type + payload) & 0xffffffff)
    path.write_bytes(raw[:-12] + chunk + raw[-12:])

mode = sys.argv[1]
if mode == 'resize':
    size = (int(sys.argv[2]), int(sys.argv[3]))
    with Image.open(sys.argv[4]) as source:
        image = source.convert('RGBA')
        # Premultiplied alpha avoids color fringes at transparent edges.
        if image.size != size:
            image = image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')
        sys.stdout.buffer.write(image.tobytes())
elif mode == 'crop':
    box = tuple(map(int, sys.argv[3:7]))
    with Image.open(sys.argv[2]) as source:
        image = source.convert('RGBA').crop((box[0], box[1], box[0] + box[2], box[1] + box[3]))
        if image.size != (box[2], box[3]):
            raise ValueError('Crop sample fuera del PNG staged')
        image.save(sys.argv[7], format='PNG')
        sys.stdout.buffer.write(image.tobytes())
elif mode == 'encode':
    size = (int(sys.argv[2]), int(sys.argv[3]))
    raw = sys.stdin.buffer.read()
    image = Image.frombytes('RGBA', size, raw)
    image.save(sys.argv[4], format='PNG', dpi=(72, 72))
    if len(sys.argv) > 5 and sys.argv[5]:
        add_png_text_chunk(sys.argv[4], 'NestraSizeMark', sys.argv[5])
    with Image.open(sys.argv[4]) as decoded:
        assert decoded.size == size
        assert decoded.convert('RGBA').tobytes() == raw, 'PNG roundtrip changed pixels'
elif mode == 'verify':
    sys.path.insert(0, os.environ['NESTRA_MOLD_PYTHONPATH'])
    import numpy as np
    request = json.loads(Path(sys.argv[2]).read_text(encoding='utf-8'))
    gaps = []
    min_gap = None
    max_gap = 0
    fallbacks = []
    for item in request['outputs']:
        size = (item['widthPx'], item['heightPx'])
        with Image.open(item['masterPath']) as master:
            original = master.convert('RGBA')
            if original.size != size:
                original = original.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')
            source = np.asarray(original).copy()
        with Image.open(item['stagedPath']) as staged:
            staged.load()
            if staged.size != size or staged.mode != 'RGBA':
                raise ValueError(f"PNG dimensiones/modo: {item['fileName']}")
            actual = np.asarray(staged).copy()
        if not np.array_equal(actual[:, :, 3], source[:, :, 3]):
            raise ValueError(f"Alpha cambió: {item['fileName']}")
        mask = np.frombuffer(base64.b64decode(item['mask']), dtype=np.uint8).reshape(item['maskHeight'], item['maskWidth']) != 0
        x, y = item['placement']['x'], item['placement']['y']
        width, height = item['maskWidth'], item['maskHeight']
        if height != 18 or x < 0 or y < 0 or x + width > size[0] or y + height > size[1]:
            raise ValueError(f"Bbox marcador incorrecto: {item['fileName']}")
        metadata = json.loads(staged.info.get('NestraSizeMark', 'null'))
        if metadata != {'version': 1, 'size': item['size'], 'x': x, 'y': y, 'width': width, 'height': height}:
            raise ValueError(f"Metadata del marcador incorrecta: {item['fileName']}")
        expected = source.copy()
        region = expected[y:y + height, x:x + width]
        for channel, value in enumerate((138, 255, 0)):
            region[:, :, channel][mask] = value
        if not np.array_equal(actual, expected):
            raise ValueError(f"Cambió un píxel fuera del marcador o el glifo/color no coincide: {item['fileName']}")
        alpha = source[:, :, 3]
        occupied, boundary_columns, boundary_bins = build_alpha_boundary_index(alpha)
        exact_distance = make_exact_alpha_distance(occupied, boundary_columns, boundary_bins)
        ys, xs = np.nonzero(occupied)
        preferred_x = int(np.floor((int(xs.min()) + int(xs.max()) + 1 - width) / 2 + 0.5))
        if abs(x - preferred_x) > 10:
            raise ValueError(f"Fallback se desplaza del centro más de 10 px: {item['fileName']}")
        mark_y, mark_x = np.nonzero(mask)
        top_columns = np.unique(mark_x[mark_y == mark_y.min()])
        edge_gaps = []
        for column in top_columns.tolist():
            row = y + int(mark_y[mark_x == column].min()) - 1
            count = 0
            while row >= 0 and alpha[row, x + column] > 16:
                count += 1
                row -= 1
            edge_gaps.append(count)
        gap = max(edge_gaps, default=0)
        for my, mx in zip(mark_y.tolist(), mark_x.tolist()):
            source_x, source_y = x + mx, y + my
            if not occupied[source_y, source_x]:
                raise ValueError(f"El glifo sale del alpha de corte: {item['fileName']}")
            if exact_distance(source_x, source_y) > SIZE_MARK_MAX_DEPTH_PX + 1e-9:
                raise ValueError(f"Profundidad Euclidiana fuente > 6,5 mm: {item['fileName']}")
        # Independently recompute the topmost centered placement by exact distance
        # to exposed unit segments of every alpha-threshold-16 boundary.
        expected_placement = None
        for candidate_y in range(int(ys.min()), size[1] - height + 1):
            for delta in range(11):
                candidate_xs = [preferred_x] if delta == 0 else [preferred_x - delta, preferred_x + delta]
                for candidate_x in candidate_xs:
                    if candidate_x < 0 or candidate_x + width > size[0]:
                        continue
                    safe = True
                    for my, mx in zip(mark_y.tolist(), mark_x.tolist()):
                        sx, sy = candidate_x + mx, candidate_y + my
                        if not occupied[sy, sx]:
                            safe = False
                            break
                        if exact_distance(sx, sy) > SIZE_MARK_MAX_DEPTH_PX + 1e-9:
                            safe = False
                            break
                    if safe:
                        expected_placement = (candidate_x, candidate_y)
                        break
                if expected_placement:
                    break
            if expected_placement:
                break
        if expected_placement != (x, y):
            raise ValueError(f"El marcador no usa la ubicación segura más alta: {item['fileName']}")
        gaps.append(gap)
        min_gap = gap if min_gap is None else min(min_gap, gap)
        max_gap = max(max_gap, gap)
        if x != preferred_x:
            fallbacks.append(item['fileName'])
    if len(gaps) != request['expectedCount']:
        raise ValueError('El conteo staged no coincide con el contract.')
    print(json.dumps({'validated': len(gaps), 'minGapPx': min_gap, 'maxGapPx': max_gap,
        'averageGapPx': sum(gaps) / len(gaps), 'minGapMm': min_gap * 25.4 / 72,
        'maxGapMm': max_gap * 25.4 / 72, 'over19': sum(value > 19 for value in gaps),
        'over7mm': sum(value * 25.4 / 72 > 7 for value in gaps), 'centerFallbacks': len(fallbacks)}, ensure_ascii=False))
else:
    raise ValueError(mode)
