"""Read-only extraction of unambiguous T8 front/back PSD groups into staging.

Optional inspection tool; psd-tools/composite dependencies live outside the app.
Pass --reader-dir for an isolated Python dependency directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--reader-dir', required=True)
parser.add_argument('--assets-root', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('folders', nargs='+')
args = parser.parse_args()
sys.path.insert(0, args.reader_dir)
from psd_tools import PSDImage

root, output = Path(args.assets_root), Path(args.output)
output.mkdir(exist_ok=False)
records = []
for folder in args.folders:
    sources = list((root / folder).glob('*.psd'))
    if len(sources) != 1:
        raise ValueError(f'{folder}: ambiguous PSD')
    source = sources[0]
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    psd = PSDImage.open(source)
    record = {'folder': folder, 'sourceDocument': str(source), 'sourceDocumentSha256': digest,
              'extraction': 'Named T8 group, intersect PSD document viewport, crop visible alpha; no canonical PNG used', 'groups': {}}
    for side, label in [('front', 't8 frente'), ('back', 't8 dorso')]:
        groups = [layer for layer in psd if layer.is_group() and layer.name.lower() == label]
        if len(groups) != 1:
            raise ValueError(f'{folder}: ambiguous {label}')
        group = groups[0]
        x0, y0, x1, y1 = group.bbox
        viewport = (max(0, x0), max(0, y0), min(psd.width, x1), min(psd.height, y1))
        image = group.composite(viewport=viewport).convert('RGBA')
        bounds = image.getbbox()
        if not bounds:
            raise ValueError('Empty group')
        image = image.crop(bounds)
        destination = output / f'{folder.replace("/", "_")}-{side}.png'
        image.save(destination, dpi=(72, 72))
        record[side] = str(destination)
        record['groups'][side] = {'name': group.name, 'groupBounds': list(group.bbox), 'documentViewport': list(viewport),
                                  'visibleBoundsWithinViewport': list(bounds), 'dimensions': list(image.size),
                                  'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}
    if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise ValueError('PSD changed')
    records.append(record)
(output / 'sources.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
print(json.dumps(records, indent=2))
