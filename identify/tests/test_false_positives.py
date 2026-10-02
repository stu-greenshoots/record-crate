"""Records NOT in the index must come back empty, not confidently wrong."""
import json, random, sys
import cv2, numpy as np
sys.path.insert(0,'.'); import identify.covers as C
random.seed(11); np.random.seed(11)

import identify.tests.manifest as M; manifest = M.build() if not __import__('os').path.exists('/tmp/manifest.json') else json.load(open('/tmp/manifest.json'))
holdout = random.sample(manifest, 30)
held_ids = {e['id'] for e in holdout}
kept = [e for e in manifest if e['id'] not in held_ids]

json.dump(kept, open('/tmp/kept.json','w'))
C.build_index('/tmp/kept.json', '/tmp/kept-index.npz')
print(f"index built WITHOUT {len(holdout)} sleeves ({len(kept)} indexed)\n")

def photo(path):
    img = cv2.resize(cv2.imread(path), (700,700))
    M = cv2.getRotationMatrix2D((350,350), random.uniform(-8,8), 1.0)
    img = cv2.warpAffine(img, M, (700,700), borderMode=cv2.BORDER_REPLICATE)
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 75])
    open('/tmp/n.jpg','wb').write(buf.tobytes()); return '/tmp/n.jpg'

false_pos = 0; empties = 0; worst = 0
for e in holdout:
    res = C.identify(photo(e['path']), '/tmp/kept-index.npz')
    ms = res['matches']
    if not ms: empties += 1
    else:
        false_pos += 1
        worst = max(worst, ms[0]['inliers'])
        print(f"  false positive: {ms[0]['inliers']} inliers ({ms[0]['confidence']})")
print(f"\ncorrectly returned nothing : {empties}/{len(holdout)}")
print(f"false positives            : {false_pos}/{len(holdout)}")
if worst: print(f"highest false inlier count : {worst}  (real matches score 30+)")
