"""Map each record to its locally cached cover, the way the image proxy stores them."""
import hashlib, json, os, re, urllib.request

def build(records_url='http://localhost:5177/api/records', out='/tmp/manifest.json'):
    recs = json.load(urllib.request.urlopen(records_url))['records']
    def cached(url):
        if not url:
            return None
        digest = hashlib.sha1(url.encode()).hexdigest()
        m = re.search(r'\.(jpe?g|png|gif|webp)(?:$|\?)', url, re.I)
        path = f"data/images/{digest}.{(m.group(1) if m else 'jpg').lower()}"
        return path if os.path.exists(path) else None
    manifest = []
    for r in recs:
        # Prefer the full cover: more keypoints than a 150px thumb.
        p = cached(r['cover']) or cached(r['thumb'])
        if p:
            manifest.append({'id': r['instanceId'], 'path': p})
    json.dump(manifest, open(out, 'w'))
    json.dump({'records': recs}, open('/tmp/recs.json', 'w'))
    return manifest

if __name__ == '__main__':
    print(f"{len(build())} covers on disk")
