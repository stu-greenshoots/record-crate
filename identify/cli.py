"""Command-line bridge: the Node server shells out to this and reads JSON back."""
import argparse, json, sys
from . import backcover, covers, text

def main() -> int:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest='cmd', required=True)

    b = sub.add_parser('index')
    b.add_argument('--manifest', required=True)
    b.add_argument('--out', required=True)

    i = sub.add_parser('identify')
    i.add_argument('--image', required=True)
    i.add_argument('--index')
    i.add_argument('--ocr', action='store_true')

    k = sub.add_parser('backcover')
    k.add_argument('--image', required=True)
    k.add_argument('--no-deskew', action='store_true')

    a = p.parse_args()
    try:
        if a.cmd == 'index':
            out = covers.build_index(a.manifest, a.out)
        elif a.cmd == 'backcover':
            out = backcover.read_back(a.image, deskew=not a.no_deskew)
        else:
            out = {}
            if a.index:
                out.update(covers.identify(a.image, a.index))
            if a.ocr:
                out['text'] = text.read_sleeve(a.image)
        print(json.dumps(out))
        return 0
    except Exception as exc:  # surface the reason to the server rather than a bare crash
        print(json.dumps({'error': f'{type(exc).__name__}: {exc}'}))
        return 1

if __name__ == '__main__':
    sys.exit(main())
