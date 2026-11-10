"""Download each release's secondary Discogs photos (the label is usually among them)
into data/label-src/<releaseId>_<n>.jpg. Skips files already there, so it can be re-run.

    .venv/bin/python scripts/fetch-label-photos.py
"""
import json
import pathlib
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'label-src'
OUT.mkdir(exist_ok=True)
UA = {'User-Agent': 'RecordCrate/0.1 (personal collection browser)'}

jobs = []
for f in sorted((ROOT / 'data' / 'releases').glob('*.json')):
    images = json.loads(f.read_text()).get('images') or []
    for n, image in enumerate(images[1:], start=1):
        dst = OUT / f'{f.stem}_{n}.jpg'
        if not dst.exists() and image.get('uri'):
            jobs.append((image['uri'], dst))


def fetch(job):
    uri, dst = job
    try:
        body = urllib.request.urlopen(urllib.request.Request(uri, headers=UA), timeout=30).read()
        dst.with_suffix('.part').write_bytes(body)
        dst.with_suffix('.part').rename(dst)
        return None
    except Exception as e:
        return f'{dst.stem}: {e}'
    finally:
        time.sleep(0.25)


# A few at a time: one by one it's an hour, mostly spent waiting on the round trip.
with ThreadPoolExecutor(4) as pool:
    errors = [e for e in pool.map(fetch, jobs) if e]
for e in errors:
    print(e)
print(f'{len(jobs)} wanted, {len(errors)} failed', flush=True)
