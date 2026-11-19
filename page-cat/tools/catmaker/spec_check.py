"""Checks a cat spec for anything the extension would ignore or misdraw."""

HEX = set("0123456789abcdefABCDEF")
LIMITS = {"body": (40, 20), "neck": (10, 10), "head": (20, 20), "tail": (24, 3)}


def problems(spec):
    """Everything the extension would silently ignore or misdraw, so the maker can fix it."""
    out = []
    ok_hex = lambda c: isinstance(c, str) and len(c) in (3, 6) and set(c) <= HEX
    if spec.get("v") != 1: out.append('"v" must be 1')
    c = spec.get("c")
    if not (isinstance(c, list) and len(c) == 5 and all(ok_hex(x) for x in c)): out.append('"c" must be 5 hex colors')
    p = spec.get("p")
    if p is not None:
        keys = p.get("k") or {}
        for ch, col in keys.items():
            if len(ch) != 1 or ch == "." or not ok_hex(col): out.append(f'paint key {ch!r}: must be one letter with a hex color')
        def grid(where, rows, maxw, maxh):
            if isinstance(rows, str): rows = [rows]
            if not isinstance(rows, list) or not rows: out.append(f"{where}: must be a list of strings"); return
            lens = {len(r) for r in rows}
            if len(lens) != 1: out.append(f"{where}: rows have different lengths {sorted(lens)} - the whole grid is ignored")
            if max(lens) > maxw or len(rows) > maxh: out.append(f"{where}: too big (max {maxw} x {maxh})")
            bad = {ch for r in rows for ch in r if ch != "." and ch not in keys}
            if bad: out.append(f"{where}: letters not in the paint key: {''.join(sorted(bad))}")
        for side in ("L", "R"):
            for part, (mw, mh) in LIMITS.items():
                if isinstance(p.get(side), dict) and part in p[side]: grid(f"{side}.{part}", p[side][part], mw, mh)
        for n, rows in (p.get("legs") or {}).items():
            if n not in ("fl", "fr", "hl", "hr"): out.append(f"legs.{n}: use fl, fr, hl, hr")
            else: grid(f"legs.{n}", rows, 2, 16)
    for m in spec.get("m", []):
        if not (isinstance(m, list) and m and isinstance(m[0], str)): out.append(f"marking {m!r}: must start with its kind")
    return out
