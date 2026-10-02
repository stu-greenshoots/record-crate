"""Fake a phone photo of a sleeve and see whether the matcher finds it."""
import json, random, sys, time
import cv2, numpy as np
sys.path.insert(0, '.')
import identify.covers as C

random.seed(7); np.random.seed(7)
import identify.tests.manifest as M; manifest = M.build() if not __import__('os').path.exists('/tmp/manifest.json') else json.load(open('/tmp/manifest.json'))
recs = {r['instanceId']: r for r in json.load(open('/tmp/recs.json'))['records']}

def fake_photo(path, angle_deg, glare, blur, crop):
    """Perspective-warp, tilt, glare, crop, blur and re-compress — a phone snap."""
    img = cv2.imread(path)
    h, w = img.shape[:2]
    img = cv2.resize(img, (700, 700))
    h = w = 700
    # Perspective: push two corners in, as if shot off-axis
    d = int(700 * angle_deg / 100)
    src = np.float32([[0,0],[w,0],[w,h],[0,h]])
    dst = np.float32([[d,int(d*0.4)],[w-int(d*0.3),0],[w,h-int(d*0.5)],[int(d*0.2),h]])
    img = cv2.warpPerspective(img, cv2.getPerspectiveTransform(src,dst), (w,h),
                              borderMode=cv2.BORDER_REPLICATE)
    # Slight camera rotation
    M = cv2.getRotationMatrix2D((w/2,h/2), random.uniform(-7,7), 1.0)
    img = cv2.warpAffine(img, M, (w,h), borderMode=cv2.BORDER_REPLICATE)
    # Lamp glare: a bright blob over part of the sleeve
    if glare:
        ov = np.zeros_like(img, np.float32)
        cv2.circle(ov, (random.randint(150,550), random.randint(150,550)), 190, (255,255,255), -1)
        ov = cv2.GaussianBlur(ov, (221,221), 0)
        img = np.clip(img.astype(np.float32) + ov*0.55, 0, 255).astype(np.uint8)
    # Crop in (framing the sleeve loosely)
    if crop:
        c = int(700*crop); img = img[c:h-c, c:w-c]
    if blur: img = cv2.GaussianBlur(img, (5,5), 0)
    img = np.clip(img.astype(np.int16) + np.random.normal(0,6,img.shape), 0, 255).astype(np.uint8)
    ok, buf = cv2.imencode('.jpg', img, [cv2.IMWRITE_JPEG_QUALITY, 72])
    open('/tmp/q.jpg','wb').write(buf.tobytes())
    return '/tmp/q.jpg'

CONDITIONS = [
    ("straight-on, good light",   dict(angle_deg=3,  glare=False, blur=False, crop=0.02)),
    ("moderate angle",            dict(angle_deg=14, glare=False, blur=False, crop=0.04)),
    ("steep angle + glare",       dict(angle_deg=24, glare=True,  blur=False, crop=0.05)),
    ("angle + glare + soft focus",dict(angle_deg=18, glare=True,  blur=True,  crop=0.10)),
]

N = 25
sample = random.sample(manifest, N)
print(f"{N} sleeves per condition, drawn from your 607\n")
for label, kw in CONDITIONS:
    hits = top1 = 0; times = []; conf = {'high':0,'medium':0,'low':0}
    for entry in sample:
        q = fake_photo(entry['path'], **kw)
        t0 = time.time()
        res = C.identify(q, 'data/cover-index.npz')
        times.append(time.time()-t0)
        ms = res['matches']
        if ms:
            if ms[0]['id'] == entry['id']:
                top1 += 1; conf[ms[0]['confidence']] += 1
            if any(m['id'] == entry['id'] for m in ms): hits += 1
    print(f"  {label:28} top-1 {top1:>2}/{N}   in top-5 {hits:>2}/{N}   "
          f"{sum(times)/len(times)*1000:.0f}ms   conf {conf['high']}H/{conf['medium']}M/{conf['low']}L")
