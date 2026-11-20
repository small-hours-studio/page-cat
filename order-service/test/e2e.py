"""End-to-end test of the order flow against a local order service (wrangler dev with MOCK=1).

    python order-service/test/e2e.py   (from the repo root; server on 127.0.0.1:8787, docs on 127.0.0.1:8766)

Stripe and the GitHub job are stand-ins: the test signs its own Stripe webhook and runs the cat-making
job itself with CATMAKER_MOCK, so no keys or money are involved. .dev.vars must set ADMIN_PASSWORD to
the value below.
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
SECRET, WHSEC, ADMIN = "testsecret", "whsec_test", "test-admin-password"
PHOTO = ROOT / "page-cat" / "orders" / "test5" / "photos" / "t5.jpg"
MOCK_SPECS = [ROOT / "page-cat" / "orders" / "boba.json", ROOT / "page-cat" / "orders" / "moe.json"]
ok = True


def check(cond, what):
    global ok
    print(("PASS " if cond else "FAIL ") + what)
    ok = ok and cond


def req(path, data=None, headers=None, raw=None, binary=False):
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    h = {"Content-Type": "application/json", **(headers or {})} if body is not None else (headers or {})
    r = urllib.request.Request(API + path, data=body, headers=h, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(r) as resp:
            b = resp.read()
            return resp.status, (b if binary else json.loads(b or b"{}"))
    except urllib.error.HTTPError as e:
        b = e.read()
        try:
            return e.code, json.loads(b or b"{}")
        except ValueError:
            return e.code, {}


def admin(path, data=None, pw=ADMIN, binary=False):
    return req(path, data, headers={"Authorization": "Bearer " + pw}, binary=binary)


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


def code_ok(code):
    r = subprocess.run(["node", str(ROOT / "page-cat/tools/catcode.mjs"), "read", code], capture_output=True, text=True)
    return r.returncode == 0 and "Signature OK" in r.stdout


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
    check(st == 200 and "making.html?order=" in data.get("url", ""), "two-cat order is created and goes to the making page")
    q = dict(kv.split("=") for kv in data["url"].split("?")[1].split("&"))
    order, key = q["order"], q["key"]

    st, o = req(f"/api/orders/{order}?key={key}")
    check(o.get("status") == "unpaid", "order waits for payment")
    st, _ = req(f"/api/orders/{order}?key=wrong")
    check(st == 404, "wrong key can't see the order")

    # Stripe: a forged webhook is refused, a signed one marks the order paid
    st, _ = req("/api/stripe/webhook", raw=b'{"type":"checkout.session.completed"}', headers={"stripe-signature": "t=1,v1=00", "Content-Type": "application/json"})
    check(st == 400, "unsigned webhook is refused")
    st, _ = webhook({"type": "checkout.session.completed", "data": {"object": {"id": "cs_test", "client_reference_id": order, "payment_intent": "pi_test",
                                                                               "customer_details": {"email": "paid@example.com", "name": "Pat Buyer"}}}})
    st2, o = req(f"/api/orders/{order}?key={key}")
    check(st == 200 and o["status"] == "paid" and all(c["status"] == "making" for c in o["cats"]), "paid order starts making both cats")
    check("email" not in o, "customer view doesn't echo the email")

    # the job: photos are only served with the job secret
    st, _ = req(f"/api/internal/job/{order}/0")
    check(st == 401, "job endpoint needs the secret")
    for i, mock in enumerate(MOCK_SPECS):
        code, out = run_job(order, i, mock)
        check(code == 0, f"job for cat {i} runs ({out[-120:]})")
    st, o = req(f"/api/orders/{order}?key={key}")
    check(all(c["status"] == "ready" and len(c["versions"]) == 1 for c in o["cats"]), "both cats ready with a first version")
    check(o["cats"][0]["versions"][0]["spec"]["n"] == "Pepper", "the cat keeps the customer's name")
    first_codes = [c["versions"][0]["code"] for c in o["cats"]]
    check(all(c.startswith("PC1.") and code_ok(c) for c in first_codes), "each first version has a signed code right away")

    # the customer can see their photos (with the key) next to the cat
    files = [p["file"] for p in o["cats"][0]["photos"]]
    check(len(files) == 2, "customer view lists the cat's photos")
    st, img = req(f"/api/orders/{order}/photo/{files[0]}?key={key}", binary=True)
    check(st == 200 and img[:2] == b"\xff\xd8", "customer photo loads with the key")
    st, _ = req(f"/api/orders/{order}/photo/{files[0]}?key=wrong")
    check(st == 404, "photo needs the right key")

    # a change: new version with its own code, the old one kept
    st, d = req(f"/api/orders/{order}/revise", {"key": key, "cat": 0, "note": "Her left ear is black."})
    check(st == 200, "change accepted")
    st, o = req(f"/api/orders/{order}?key={key}")
    check(o["cats"][0]["status"] == "making" and o["cats"][0]["revisionsLeft"] == 1 and o["cats"][0]["pendingNote"] == "Her left ear is black.", "change uses one of two and shows what's being changed")
    st, job = req(f"/api/internal/job/{order}/0", headers={"Authorization": "Bearer " + SECRET})
    check(job.get("note") == "Her left ear is black." and job.get("previous"), "the job gets the note and the previous design")
    run_job(order, 0, MOCK_SPECS[1])
    st, o = req(f"/api/orders/{order}?key={key}")
    c0 = o["cats"][0]
    check(c0["status"] == "ready" and len(c0["versions"]) == 2 and c0["versions"][1]["note"] == "Her left ear is black.", "changed cat has a second version with the note")
    check(c0["versions"][0]["code"] == first_codes[0] and c0["versions"][1]["code"] != first_codes[0] and code_ok(c0["versions"][1]["code"]), "new code for the new version, old code kept")

    # a change that fails gives the change back and keeps the cat
    req(f"/api/orders/{order}/revise", {"key": key, "cat": 0, "note": "Make the tail longer."})
    run_job(order, 0, ROOT / "does-not-exist.json")
    st, o = req(f"/api/orders/{order}?key={key}")
    c0 = o["cats"][0]
    check(c0["status"] == "ready" and c0["revisionsLeft"] == 1 and len(c0["versions"]) == 2 and c0["message"], "failed change keeps the cat and refunds the change")
    req(f"/api/orders/{order}/revise", {"key": key, "cat": 0, "note": "Make the tail longer."})
    run_job(order, 0, MOCK_SPECS[0])
    st, d = req(f"/api/orders/{order}/revise", {"key": key, "cat": 0, "note": "more"})
    check(st == 409, "no third change")

    # a ticket
    st, _ = req(f"/api/orders/{order}/ticket", {"key": key, "cat": 1, "message": "Her nose should be black."})
    check(st == 200, "ticket opened")

    # admin: password, list, detail, photos, fix, remake, close, changes
    st, _ = admin("/api/admin/orders", pw="wrong-password-123")
    check(st == 401, "admin needs the password")
    st, lst = admin("/api/admin/orders")
    row = next((r for r in lst.get("orders", []) if r["id"] == order), None)
    check(row and row["email"] == "paid@example.com" and row["names"] == "Pepper, Salt" and row["openTickets"] == 1 and row["status"] == "paid", "admin list shows buyer, cats, tickets")
    st, lst = admin("/api/admin/orders?q=salt")
    check(any(r["id"] == order for r in lst["orders"]), "admin search by cat name")
    st, d = admin(f"/api/admin/orders/{order}")
    check(d["order"]["buyer"] == "Pat Buyer" and d["order"]["paymentIntent"] == "pi_test" and "key" not in d["order"], "admin order shows payment and buyer")
    check([len(c["versions"]) for c in d["cats"]] == [3, 1] and d["cats"][1]["tickets"][0]["message"] == "Her nose should be black.", "admin sees every version and the ticket")
    check(all(v["code"] for c in d["cats"] for v in c["versions"]) and d["cats"][0]["log"], "every version's code and a history are recorded")
    st, img = admin(f"/api/admin/photo/{order}/{files[0]}", binary=True)
    check(st == 200 and img[:2] == b"\xff\xd8", "admin can load the photos")

    spec = json.loads(MOCK_SPECS[0].read_text())
    st, d = admin(f"/api/admin/orders/{order}/cats/1/fix", {"spec": spec, "note": "Black nose, fixed by hand"})
    check(st == 200 and code_ok(d.get("code", "")), "admin fix adds a signed version")
    st, o = req(f"/api/orders/{order}?key={key}")
    check(len(o["cats"][1]["versions"]) == 2 and o["cats"][1]["versions"][1]["spec"]["n"] == "Salt", "customer sees the fixed version under their cat's name")
    st, _ = admin(f"/api/admin/orders/{order}/cats/1/close", {"ticket": 0, "reply": "Fixed the nose"})
    st, lst = admin("/api/admin/orders")
    check(next(r for r in lst["orders"] if r["id"] == order)["openTickets"] == 0, "closing the ticket clears it from the list")
    st, _ = admin(f"/api/admin/orders/{order}/cats/0/changes", {"add": 1})
    st, o = req(f"/api/orders/{order}?key={key}")
    check(o["cats"][0]["revisionsLeft"] == 1, "admin can give an extra change")
    st, _ = admin(f"/api/admin/orders/{order}/cats/0/remake", {"note": "Try the white socks again"})
    st, job = req(f"/api/internal/job/{order}/0", headers={"Authorization": "Bearer " + SECRET})
    check(st == 200 and job.get("note") == "Try the white socks again", "admin remake runs the maker with the note")
    run_job(order, 0, MOCK_SPECS[1])
    st, o = req(f"/api/orders/{order}?key={key}")
    check(o["cats"][0]["revisionsLeft"] == 1 and len(o["cats"][0]["versions"]) == 4, "admin remake doesn't use the customer's change")

    # the admin command line tool
    env = {**os.environ, "PAGECAT_API": API, "PAGECAT_ADMIN_PASSWORD": ADMIN}
    r = subprocess.run([sys.executable, str(ROOT / "page-cat/tools/admin.py"), "show", order], env=env, capture_output=True, text=True)
    check(r.returncode == 0 and "Pepper" in r.stdout and "PC1." in r.stdout, "admin.py show prints the order")

    st, _ = req(f"/api/internal/photo/{order}/{files[0]}", headers={"Authorization": "Bearer " + SECRET}, binary=True)
    check(st == 200, "photos are kept after the order (deleted after 30 days)")
    Path(ROOT / "order-service/test/last-order.txt").write_text(data["url"] if isinstance(data, dict) and "url" in data else f"{order} {key}")
    print(f"status page: http://127.0.0.1:8766/status.html?order={order}&key={key}&api={API}")
    print("ALL PASSED" if ok else "SOME FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
