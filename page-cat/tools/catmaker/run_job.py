"""Runs one cat-making job for the order server (called by the GitHub Actions workflow).

    WORKER_URL=https://... JOB_SECRET=... python tools/catmaker/run_job.py <order-id> <cat-index>

Fetches the job (name, photos, previous spec and note for a revision) from the order server, makes the
cat, and posts the result back. Photos only ever sit in a temporary folder that is deleted afterwards.
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def api(path, data=None):
    req = urllib.request.Request(os.environ["WORKER_URL"].rstrip("/") + path,
                                 data=None if data is None else json.dumps(data).encode(),
                                 headers={"Authorization": "Bearer " + os.environ["JOB_SECRET"],
                                          "Content-Type": "application/json", "User-Agent": "page-cat-job"},
                                 method="GET" if data is None else "POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
        return body if r.headers.get("Content-Type", "").startswith("image/") else json.loads(body or b"{}")


def main():
    order, cat = sys.argv[1], sys.argv[2]
    try:
        run(order, cat)
    except Exception as e:  # report every failure, so a cat never sits on "making" forever
        api(f"/api/internal/result/{order}/{cat}", {"ok": False, "error": f"{type(e).__name__}: {e}"[:800]})
        raise


def run(order, cat):
    job = api(f"/api/internal/job/{order}/{cat}")
    with tempfile.TemporaryDirectory() as tmp:
        args = [sys.executable, str(HERE / "make_cat.py"), "--name", job["name"], "--out", str(Path(tmp) / "spec.json")]
        for i, ph in enumerate(job["photos"]):
            path = Path(tmp) / f"photo{i}.jpg"
            path.write_bytes(api(f"/api/internal/photo/{order}/{ph['file']}"))
            args += ["--photo", f"{ph.get('label') or ''}={path}"]
        if job.get("previous"):
            (Path(tmp) / "previous.json").write_text(json.dumps(job["previous"]))
            args += ["--previous", str(Path(tmp) / "previous.json"), "--note", job.get("note") or ""]
        run = subprocess.run(args, capture_output=True, text=True)
        try:
            result = json.loads(run.stdout.strip().splitlines()[-1])
        except (IndexError, ValueError):
            result = {"ok": False, "error": (run.stderr or "no output")[-800:]}
        if result.get("ok") and not result.get("reject"):
            result["spec"] = json.loads((Path(tmp) / "spec.json").read_text())
    api(f"/api/internal/result/{order}/{cat}", {k: result.get(k) for k in ("ok", "spec", "reject", "error", "cost_usd", "confidence")})
    print(json.dumps({k: result.get(k) for k in ("ok", "reject", "error", "cost_usd", "confidence")}))


if __name__ == "__main__":
    main()
