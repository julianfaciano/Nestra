"""Measure the actual 300 PPI native Imprenta 2 marker raster against its cut contours."""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, r'C:\Users\julian\AppData\Local\Temp\nestra-psd-reader')
import numpy as np
from PIL import Image

PPM = 300 / 25.4
HALF_STROKE_PX = 1.5 * PPM
GREEN = np.array([138, 255, 0], dtype=np.uint8)

def point_in_polygon(point, polygon):
    x, y = point
    inside = False
    for index, a in enumerate(polygon):
        b = polygon[(index + 1) % len(polygon)]
        if (a[1] > y) != (b[1] > y):
            crossing = (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]
            if x < crossing:
                inside = not inside
    return inside

def distance_to_contour(point, contours):
    best = float('inf')
    for polygon in contours:
        for index, a in enumerate(polygon):
            b = polygon[(index + 1) % len(polygon)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            length2 = dx * dx + dy * dy
            t = 0 if length2 == 0 else max(0, min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length2))
            best = min(best, math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy)))
    return best

def measure_outer_black_band(rgb, contours):
    height, width, _ = rgb.shape
    band_widths = []
    for polygon_index, polygon in enumerate(contours):
        for index, a in enumerate(polygon):
            b = polygon[(index + 1) % len(polygon)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dy)
            if length < 1e-8:
                continue
            count = max(1, math.ceil(length))
            normal = (-dy / length, dx / length)
            for sample in range(count):
                t = (sample + 0.5) / count
                px, py = a[0] + t * dx, a[1] + t * dy
                outward = normal
                test = (px + outward[0] * 0.25, py + outward[1] * 0.25)
                if point_in_polygon(test, polygon):
                    outward = (-outward[0], -outward[1])
                black_run = 0.0
                started = False
                for distance in np.arange(0.5, HALF_STROKE_PX + 2.5, 0.5):
                    sx = int(math.floor(px + outward[0] * distance))
                    sy = int(math.floor(py + outward[1] * distance))
                    if not (0 <= sx < width and 0 <= sy < height):
                        break
                    color = rgb[sy, sx]
                    # Count antialiased black coverage to the edge of the 300-PPI vector stroke.
                    black = bool(np.any(color < 255))
                    if black:
                        started = True
                        center_projection = (sx + 0.5 - px) * outward[0] + (sy + 0.5 - py) * outward[1]
                        pixel_half_extent = 0.5 * (abs(outward[0]) + abs(outward[1]))
                        black_run = center_projection + pixel_half_extent
                    elif started:
                        break
                    else:
                        break
                band_widths.append((black_run / PPM, {
                    'contour': polygon_index, 'pointPx': [px, py],
                    'outwardNormal': list(outward), 'blackRunPx': black_run,
                }))
    if not band_widths:
        raise ValueError('No se pudo muestrear la banda negra exterior.')
    return min(band_widths, key=lambda item: item[0])

manifest_path = Path(sys.argv[1])
output_dir = Path(sys.argv[2])
report_path = Path(sys.argv[3])
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
results = []
for sample in manifest['samples']:
    plan = sample['plan']
    outline = plan['laserOutline']
    contours = [outline['contours'][index] for index in plan['sizeMarks'][0]['contourIndices']]
    export_path = output_dir / plan['name']
    with Image.open(export_path) as image:
        if image.mode != 'RGB':
            raise ValueError(f"El raster exportado no es RGB: {export_path}")
        rgb = np.asarray(image).copy()
    exact_green_mask = np.all(rgb == GREEN, axis=2)
    green_mask = (rgb[:, :, 1].astype(np.int16) > rgb[:, :, 0].astype(np.int16) + 10) & \
                 (rgb[:, :, 1].astype(np.int16) > rgb[:, :, 2].astype(np.int16) + 10) & \
                 (rgb[:, :, 1] > 32)
    gy, gx = np.nonzero(green_mask)
    if not len(gx):
        raise ValueError(f"No hay marcador verde exacto en {export_path}")
    inside = []
    contour_distances = []
    for x, y in zip(gx.tolist(), gy.tolist()):
        point = (x + 0.5, y + 0.5)
        containing = [polygon for polygon in contours if point_in_polygon(point, polygon)]
        inside.append(bool(containing))
        contour_distances.append(min(distance_to_contour(point, [polygon]) for polygon in containing) if containing else float('inf'))
    if not all(inside):
        raise ValueError(f"Píxel verde fuera del contorno de corte: {export_path}")
    min_inset_mm = min(contour_distances) / PPM
    max_inset_mm = max(contour_distances) / PPM
    height_px = int(gy.max() - gy.min() + 1)
    height_mm = height_px / PPM
    marker = plan['sizeMarks'][0]
    marker_mask = plan['sizeMarkMasks'][marker['maskIndex']]
    piece = plan['pieces'][0]
    scale_x = piece['width'] / sample['sourceWidth']
    scale_y = piece['height'] / sample['sourceHeight']
    marker_left = piece['translateX'] + marker['x'] * scale_x
    marker_top = piece['translateY'] + marker['y'] * scale_y
    marker_right = marker_left + marker_mask['width'] * scale_x
    marker_bottom = marker_top + marker_mask['height'] * scale_y
    ix0, iy0 = max(0, int(math.floor(marker_left - 4))), max(0, int(math.floor(marker_top - 4)))
    ix1, iy1 = min(rgb.shape[1], int(math.ceil(marker_right + 4))), min(rgb.shape[0], int(math.ceil(marker_bottom + 4)))
    detail = rgb[iy0:iy1, ix0:ix1]
    detail_green = (detail[:, :, 1].astype(np.int16) > detail[:, :, 0].astype(np.int16) + 10) & \
                   (detail[:, :, 1].astype(np.int16) > detail[:, :, 2].astype(np.int16) + 10) & \
                   (detail[:, :, 1] > 32)
    dgy, dgx = np.nonzero(detail_green)
    detail_height_px = int(dgy.max() - dgy.min() + 1) if len(dgy) else 0
    detail_path = output_dir / (Path(plan['name']).stem + '-detail.png')
    Image.fromarray(detail).save(detail_path)
    black_band_mm, black_band_sample = measure_outer_black_band(rgb, contours)
    green_start_mm = 1.5 + min_inset_mm
    max_green_depth_mm = 1.5 + max_inset_mm
    seam_margin_mm = 10.0 - max_green_depth_mm
    metrics = {
        'folder': sample['folder'], 'fileName': sample['fileName'],
        'size': sample['size'], 'side': sample['side'],
        'heightPx300': height_px, 'heightMm': height_mm,
        'exactGreenHeightPx300': int(np.ptp(np.nonzero(exact_green_mask)[0]) + 1) if exact_green_mask.any() else 0,
        'markerRectGreenHeightPx300': detail_height_px,
        'markerDetailPng': str(detail_path),
        'outerBlackBandMinMm': black_band_mm,
        'outerBlackBandSample': black_band_sample,
        'greenStartFromOuterEdgeMm': green_start_mm,
        'maxGreenDepthFromOuterEdgeMm': max_green_depth_mm,
        'seamMarginTo10Mm': seam_margin_mm,
        'greenPixels': int(len(gx)), 'exact8aff00Pixels': int(exact_green_mask.sum()),
        'allGreenInsideCut': True,
        'exportPng': str(export_path),
    }
    metrics['heightPass'] = height_px == 75 and abs(height_mm - 6.35) <= 1e-9
    metrics['outerBlackBandPass'] = black_band_mm >= 1.5 - 1e-9
    metrics['greenStartPass'] = green_start_mm >= 1.5 - 1e-9
    metrics['maxGreenDepthPass'] = max_green_depth_mm <= 8.0 + 1e-9
    metrics['seamMarginPass'] = seam_margin_mm >= 2.0 - 1e-9
    metrics['pass'] = all(metrics[key] for key in ('heightPass', 'outerBlackBandPass', 'greenStartPass', 'maxGreenDepthPass', 'seamMarginPass'))
    results.append(metrics)

report = {
    'ppi': 300, 'strokeMm': 3, 'pageWidthMm': 1560,
    'samples': results,
    'worstOuterBlackBandMinMm': min(item['outerBlackBandMinMm'] for item in results),
    'worstMaxGreenDepthMm': max(item['maxGreenDepthFromOuterEdgeMm'] for item in results),
    'worstSeamMarginMm': min(item['seamMarginTo10Mm'] for item in results),
    'allPass': len(results) == 6 and all(item['pass'] for item in results),
}
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False))
