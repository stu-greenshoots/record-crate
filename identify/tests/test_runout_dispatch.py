"""
Does the deadwax dispatcher pick the right backend?

Run: .venv/bin/python -m identify.tests.test_runout_dispatch

No live API calls: backend modules are stubbed into sys.modules, so what's under
test is the selection order (CLI argument beats RUNOUT_VISION_BACKEND beats the
Claude default), the unknown-backend error, and the missing-key message on the
real default path.
"""

from __future__ import annotations

import os
import sys
import types

sys.path.insert(0, '.')
from identify import runout

passed = failed = 0


def ok(cond, label, extra=''):
    global passed, failed
    passed += cond
    failed += not cond
    print(f"{' ok ' if cond else 'FAIL'}  {label}{'  ' + extra if extra else ''}")


def stub_backend(name, marker):
    module = types.ModuleType(f'identify.vision_backends.{name}')
    module.read_runout = lambda path: {'candidates': [], 'best': None, 'backend_used': marker}
    sys.modules[f'identify.vision_backends.{name}'] = module
    return module


env_backup = {k: os.environ.pop(k, None) for k in
              ('RUNOUT_VISION_BACKEND', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN')}

# A CLI-style explicit backend dispatches to exactly that module.
stub_backend('gemini', 'stub-gemini')
out = runout.read_runout('whatever.jpg', backend='gemini')
ok(out.get('backend_used') == 'stub-gemini', 'explicit backend argument wins', str(out))

# The env var picks the default when no argument is passed.
stub_backend('openai', 'stub-openai')
os.environ['RUNOUT_VISION_BACKEND'] = 'openai'
out = runout.read_runout('whatever.jpg')
ok(out.get('backend_used') == 'stub-openai', 'RUNOUT_VISION_BACKEND selects the default', str(out))

# ...and an explicit argument still beats it.
out = runout.read_runout('whatever.jpg', backend='gemini')
ok(out.get('backend_used') == 'stub-gemini', 'argument overrides the env var', str(out))
del os.environ['RUNOUT_VISION_BACKEND']

# Unknown names come back as the standard error dict, not a crash.
out = runout.read_runout('whatever.jpg', backend='tarot')
ok('error' in out and 'tarot' in out['error'] and 'claude' in out['error'],
   'unknown backend names the options', out.get('error', ''))

# The real default path (claude, unstubbed) explains a missing key clearly.
# The stubs above never registered 'claude', so this exercises the real module —
# with a real photo, because the image is validated before the key is.
out = runout.read_runout('data/label-src/691853_3.jpg')
ok('error' in out and 'ANTHROPIC_API_KEY' in out['error'] and '.env.example' in out['error'],
   'missing key on the default path points at .env.example', out.get('error', ''))

for key, value in env_backup.items():
    if value is not None:
        os.environ[key] = value

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
