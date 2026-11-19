"""End-to-end test of the order flow against a local order service (wrangler dev with MOCK=1).

    python order-service/test/e2e.py   (from the repo root; server on 127.0.0.1:8787, docs on 127.0.0.1:8766)

Stripe and the GitHub job are stand-ins: the test signs its own Stripe webhook and runs the cat-making
job itself with CATMAKER_MOCK, so no keys or money are involved.
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = "http://127.0.0.1:8787"
SECRET, WHSEC = "testsecret", "whsec_test"
PHOTO = ROOT / "page-cat" / "orders" / "test5" / "photos" / "t5.jpg"
MOCK_SPECS = [ROOT / "page-cat" / "orders" / "boba.json", ROOT / "page-cat" / "orders" / "moe.json"]
ok = True


def check(cond, what):
    global ok
    print(("PASS " if cond else "FAIL ") + what)
    ok = ok and cond


def req(path, data=None, headers=None, raw=None):
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    h = {"Content-Type": "application/json", **(headers or {})} if body is not None else (headers or {})
    r = urllib.request.Request(API + path, data=body, headers=h, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def multipart(fields, files):
    b = uuid.uuid4().hex
    out = b""
    for k, v in fields.items():
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
    for k, (name, data, ctype) in files.items():
        out += f'--{b}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + data + b"\r\n"
    return out + f"--{b}--\r\n".encode(), f"multipart/form-data; boundary={b}"


def webhook(event):
    payload = json.dumps(event)
    t = str(int(time.time()))
    sig = hmac.new(WHSEC.encode(), f"{t}.{payload}".encode(), hashlib.sha256).hexdigest()
    return req("/api/stripe/webhook", raw=payload.encode(), headers={"stripe-signature": f"t={t},v1={sig}", "Content-Type": "application/json"})


def run_job(order, cat, mock):
    env = {**os.environ, "WORKER_URL": API, "JOB_SECRET": SECRET, "CATMAKER_MOCK": str(mock)}
    r = subprocess.run([sys.executable, str(ROOT / "page-cat/tools/catmaker/run_job.py"), order, str(cat)], env=env, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()[-300:]


def main():
    photo = PHOTO.read_bytes()
    # bad input is refused
    body, ct = multipart({"email": "nope", "cats": json.dumps([{"name": "X"}])}, {})
    st, data = req("/api/orders", raw=body, headers={"Content-Type": ct})
    check(st == 400 and "email" in data.get("error", ""), "order with a bad email is refused")

    # a two-cat order
    body, ct = multipart({"email": "buyer@example.com", "cats": json.dumps([{"name": "Pepper"}, {"name": "Salt"}])},
                         {"cat0_left": ("left.jpg", photo, "image/jpeg"), "cat0_face": ("face.jpg", photo, "image/jpeg"),
                          "cat1_right": ("right.jpg", photo, "image/jpeg")})
    st, data = req("/api/orders", raw=body, headers={"Content-Type": ct})
    check(st == 200 and "status.html?order=" in data.get("url", ""), "two-cat order is created")
    q = dict(kv.split("=") for kv in data["url"].split("?")[1].split("&"))
    order, key = q["order"], q["key"]
    print("status page:", data["url"].replace("status.html?", "status.html?api=http://127.0.0.1:8787&"))

    st, o = req(f"/api/orders/{order}?key={key}")
    check(o.get("status") == "unpaid", "order waits for payment")
    st, _ = req(f"/api/orders/{order}?key=wrong")
    check(st == 404, "wrong key can't see the order")

    # Stripe: a forged webhook is refused, a signed one marks the order paid
    st, _ = req("/api/stripe/webhook", raw=b'{"type":"checkout.session.completed"}', headers={"stripe-signature": "t=1,v1=00", "Content-Type": "application/json"})
    check(st == 400, "unsigned webhook is refused")
    st, _ = webhook({"type": "checkout.session.completed", "data": {"object": {"id": "cs_test", "client_reference_id": order, "customer_details": {"email": "paid@example.com"}}}})
    st2, o = req(f"/api/orders/{order}?key={key}")
    check(st == 200 and o["status"] == "paid" and all(c["status"] == "making" for c in o["cats"]), "paid order starts making both cats")
    check(o["email"] == "paid@example.com", "email taken from Stripe checkout")

    # the job: photos are only served with the job secret
    st, _ = req(f"/api/internal/job/{order}/0")
    check(st == 401, "job endpoint needs the secret")
    for i, mock in enumerate(MOCK_SPECS):
        code, out = run_job(order, i, mock)
        check(code == 0, f"job for cat {i} runs ({out[-120:]})")
    st, o = req(f"/api/orders/{order}?key={key}")
    check(all(c["status"] == "ready" and c["spec"] for c in o["cats"]), "both cats ready with a design")
    check(o["cats"][0]["spec"]["n"] == "Pepper", "the cat keeps the customer's name")

    # a revision
    st, d = req(f"/api/orders/{order}/revise", {"key": key, "cat": 0, "note": "Her left ear is black."})
    check(st == 200, "revision accepted")
    st, o = req(f"/api/orders/{order}?key={key}")
    check(o["cats"][0]["status"] == "making" and o["cats"][0]["revisionsLeft"] == 1, "revision uses one of two changes")
    st, job = req(f"/api/internal/job/{order}/0", headers={"Authorization": "Bearer " + SECRET})
    check(job.get("note") == "Her left ear is black." and job.get("previous"), "the job gets the note and the previous design")
    run_job(order, 0, MOCK_SPECS[1])
    st, o = req(f"/api/orders/{order}?key={key}")
    check(o["cats"][0]["status"] == "ready", "revised cat is ready")

    # approve both; codes check out with the extension's public key; photos are deleted afterwards
    codes = []
    for i in range(2):
        st, d = req(f"/api/orders/{order}/approve", {"key": key, "cat": i})
        check(st == 200 and d.get("code", "").startswith("PC1."), f"cat {i} approved with a code")
        codes.append(d.get("code", ""))
    for c in codes:
        r = subprocess.run(["node", str(ROOT / "page-cat/tools/catcode.mjs"), "read", c], capture_output=True, text=True)
        check(r.returncode == 0 and "Signature OK" in r.stdout, "code signature verifies")
    st, _ = req(f"/api/internal/photo/{order}/c0-left.jpg", headers={"Authorization": "Bearer " + SECRET})
    check(st == 404, "photos deleted after every cat is approved")
    st, o = req(f"/api/orders/{order}?key={key}")
    check(o["status"] == "done", "order is done")
    st, d = req(f"/api/orders/{order}/revise", {"key": key, "cat": 0, "note": "more changes"})
    check(st == 409, "no changes after approval")
    Path(ROOT / "order-service/test/last-order.txt").write_text(data["url"])
    print("ALL PASSED" if ok else "SOME FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
