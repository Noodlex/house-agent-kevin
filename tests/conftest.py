"""Load Kevin's HA-independent modules under a synthetic package.

`custom_components/kevin/__init__.py` imports Home Assistant, so importing the
package directly would require a full HA install. The model / sun / generator
modules are deliberately HA-free, so we load them here under `kevin_pure.*` and
let their relative imports resolve within that package — the unit tests below run
with just `astral` installed.
"""

import importlib.util
import os
import sys
import types

_BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "custom_components", "kevin"))

_pkg = types.ModuleType("kevin_pure")
_pkg.__path__ = [_BASE]
sys.modules["kevin_pure"] = _pkg

for _name in ("const", "models", "sun", "generator", "preset"):
    _spec = importlib.util.spec_from_file_location(f"kevin_pure.{_name}", os.path.join(_BASE, f"{_name}.py"))
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules[f"kevin_pure.{_name}"] = _mod
    _spec.loader.exec_module(_mod)


def preset_dict() -> dict:
    import json

    with open(os.path.join(_BASE, "presets", "reference.json"), encoding="utf-8") as fp:
        return json.load(fp)
