"""Pack reviewed GLBs for web delivery without changing any mesh/accessor bytes.

Usage: python tools/optimize-gltf.py assets/models/*-detail.glb
Requires Pillow with WebP support. Normal maps use lossless WebP encoding. Existing JPEG maps use quality 94.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct

from PIL import Image


def unpack(data):
    size, kind = struct.unpack_from('<II', data, 12)
    assert kind == 0x4E4F534A
    document = json.loads(data[20:20 + size])
    return document, data[28 + size:]


def optimize(source, limit):
    original = source.read_bytes()
    doc, binary = unpack(original)
    old_views = [binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']] for v in doc['bufferViews']]
    normal_sources = {doc['textures'][m['normalTexture']['index']]['source'] for m in doc['materials'] if 'normalTexture' in m}
    image_views = set()
    for index, image in enumerate(doc.get('images', [])):
        view = image['bufferView']
        image_views.add(view)
        texture = Image.open(io.BytesIO(old_views[view]))
        texture.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        texture.save(encoded, format='WEBP', quality=94, lossless=index in normal_sources, method=4)
        old_views[view] = encoded.getvalue()
        image['mimeType'] = 'image/webp'
    for texture in doc['textures']:
        texture.setdefault('extensions', {})['EXT_texture_webp'] = {'source': texture.pop('source')}
    for key in ['extensionsUsed', 'extensionsRequired']:
        doc[key] = list(dict.fromkeys([*doc.get(key, []), 'EXT_texture_webp']))
    packed = bytearray()
    for view, content in zip(doc['bufferViews'], old_views):
        packed += bytes(-len(packed) % 4)
        view['byteOffset'], view['byteLength'], view['buffer'] = len(packed), len(content), 0
        packed += content
    packed += bytes(-len(packed) % 4)
    doc['buffers'] = [{'byteLength': len(packed)}]
    meta = json.dumps(doc, separators=(',', ':'), ensure_ascii=False).encode()
    meta += b' ' * (-len(meta) % 4)
    result = struct.pack('<III', 0x46546C67, 2, 28 + len(meta) + len(packed)) + struct.pack('<II', len(meta), 0x4E4F534A) + meta + struct.pack('<II', len(packed), 0x004E4942) + packed
    check, new_binary = unpack(result)
    old_doc, old_binary = unpack(original)
    assert old_doc['accessors'] == check['accessors'] and old_doc['meshes'] == check['meshes']
    geometry_hash = hashlib.sha256()
    for index, (before, after) in enumerate(zip(old_doc['bufferViews'], check['bufferViews'])):
        if index in image_views:
            continue
        a = old_binary[before.get('byteOffset', 0):before.get('byteOffset', 0) + before['byteLength']]
        b = new_binary[after['byteOffset']:after['byteOffset'] + after['byteLength']]
        assert a == b, 'Geometry changed'
        geometry_hash.update(a)
    target = source.with_name(source.name.replace('-detail.glb', '-web.glb'))
    assert target != source
    target.write_bytes(result)
    return target, {'bytes': len(result), 'original_bytes': len(original), 'texture_max_dimension': limit, 'texture_format': 'webp', 'geometry_sha256': geometry_hash.hexdigest()}


if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('sources', nargs='+', type=Path)
    args.add_argument('--max-texture', type=int, default=2048)
    args.add_argument('--manifest', type=Path, default=Path('assets/models/manifest.json'))
    options = args.parse_args()
    manifest = json.loads(options.manifest.read_text(encoding='utf-8'))
    for source in options.sources:
        target, delivery = optimize(source, options.max_texture)
        for entry in [*manifest['shops'].values(), manifest['island']]:
            if Path(entry['model_url']).name in (source.name, target.name):
                entry['model_url'] = entry['model_url'].replace(source.name, target.name)
                entry['delivery'] = delivery
        print(source.name, delivery['original_bytes'], '->', delivery['bytes'], '(' + str(round((1 - delivery['bytes'] / delivery['original_bytes']) * 100)) + '% smaller)')
    options.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
