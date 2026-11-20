"""Look up and fix custom-cat orders from the terminal (the same things docs/admin.html does).

    python page-cat/tools/admin.py list [search]          orders, newest first (search: order, email or cat name)
    python page-cat/tools/admin.py tickets                orders with open tickets
    python page-cat/tools/admin.py show ORDER             buyer, cats, every version and code, tickets, history
    python page-cat/tools/admin.py photos ORDER           download the photos to page-cat/orders/<ORDER>/photos
    python page-cat/tools/admin.py fix ORDER CAT spec.json [--note "..."] [--email]   add a hand-made version
    python page-cat/tools/admin.py remake ORDER CAT --note "..."                     run the cat maker again
    python page-cat/tools/admin.py close ORDER CAT TICKET [--reply "..."]            close a ticket (numbers from 1)
    python page-cat/tools/admin.py changes ORDER CAT [N]                             give N more changes

The order service address comes from PAGECAT_API (default: ORDER_API in docs/config.js). The admin
password comes from PAGECAT_ADMIN_PASSWORD or the file ~/.pagecat/admin-password (never commit it).

Fixing a ticket by hand: `photos`, then save the current design (from `show --json`) to a file, fix it,
check it with tools/preview_cat.py, and `fix` it in. The customer sees the new version and its code.
"""
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def api_base():
    if os.environ.get("PAGECAT_API"):
        return os.environ["PAGECAT_API"].rstrip("/")
    m = re.search(r"ORDER_API\s*=\s*'([^']+)'", (ROOT / "docs" / "config.js").read_text())
    return m.group(1).rstrip("/")


def password():
    if os.environ.get("PAGECAT_ADMIN_PASSWORD"):
        return os.environ["PAGECAT_ADMIN_PASSWORD"]
    f = Path.home() / ".pagecat" / "admin-password"
    if f.exists():
        return f.read_text().strip()
    sys.exit("No admin password: set PAGECAT_ADMIN_PASSWORD or put it in ~/.pagecat/admin-password")


def req(path, data=None, raw=False):
    r = urllib.request.Request(api_base() + path, data=None if data is None else json.dumps(data).encode(),
                               headers={"Authorization": "Bearer " + password(), "Content-Type": "application/json", "User-Agent": "page-cat-admin"},
                               method="GET" if data is None else "POST")
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            body = resp.read()
            return body if raw else json.loads(body or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"{e.code}: {json.loads(e.read() or b'{}').get('error', '')}")


def when(t):
    return datetime.fromtimestamp(t / 1000).strftime("%Y-%m-%d %H:%M") if t else "-"


def cmd_list(a, only_tickets=False):
    rows = req("/api/admin/orders" + (f"?q={urllib.parse.quote(a.search)}" if getattr(a, "search", None) else ""))["orders"]
    for o in rows:
        if only_tickets and not o.get("openTickets"):
            continue
        t = f"  {o['openTickets']} TICKET(S)" if o.get("openTickets") else ""
        print(f"{when(o.get('created'))}  {o['id']}  {o.get('status', ''):7}  ${(o.get('amount') or 0) / 100:.2f}  {o.get('email', '')}  {o.get('names', '')}{t}")


def cmd_show(a):
    d = req(f"/api/admin/orders/{a.order}")
    if a.json:
        print(json.dumps(d, indent=1))
        return
    o = d["order"]
    print(f"Order {o['id']}  {o['status']}  ordered {when(o.get('created'))}  paid {when(o.get('paidAt'))}  ${(o.get('amount') or 0) / 100:.2f}")
    print(f"Email {o.get('email')}  name {o.get('buyer', '-')}  payment {o.get('paymentIntent', '-')}")
    print(f"Customer page: {d['link']}")
    for i, c in enumerate(d["cats"]):
        print(f"\nCat {i}: {c['name']}  status {c['status']}  changes left {c['revisionsLeft']}  cost ${c.get('cost', 0):.2f}  photos {'kept' if c['photosKept'] else 'deleted'}")
        if c.get("message"):
            print(f"  message: {c['message']}")
        for k, v in enumerate(c["versions"]):
            print(f"  v{k + 1} {when(v['at'])} by {v['by']}" + (f"  note: {v['note']}" if v.get("note") else ""))
            print(f"     {v['code']}")
        for k, t in enumerate(c["tickets"]):
            print(f"  ticket {k + 1} {when(t['at'])} {'closed' if t['closed'] else 'OPEN'}: {t['message']}" + (f"  reply: {t['reply']}" if t.get("reply") else ""))
        for e in c.get("log", []):
            print(f"  . {when(e['at'])} {e['what']}" + (f": {e['detail']}" if e.get("detail") else ""))


def cmd_photos(a):
    d = req(f"/api/admin/orders/{a.order}")
    out = ROOT / "page-cat" / "orders" / a.order / "photos"
    out.mkdir(parents=True, exist_ok=True)
    for c in d["cats"]:
        for ph in c["photos"]:
            path = out / ph["file"]
            path.write_bytes(req(f"/api/admin/photo/{a.order}/{ph['file']}", raw=True))
            print(path)
        last = c["versions"][-1]["spec"] if c["versions"] else None
        if last:
            spec = ROOT / "page-cat" / "orders" / a.order / f"{c['name'].lower()}-current.json"
            spec.write_text(json.dumps(last, indent=1))
            print(spec)


def cmd_fix(a):
    spec = json.loads(Path(a.spec).read_text())
    d = req(f"/api/admin/orders/{a.order}/cats/{a.cat}/fix", {"spec": spec, "note": a.note or "Fixed by hand", "email": a.email})
    print("Added. New code:\n" + d["code"])


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = p.add_subparsers(dest="cmd", required=True)
    x = s.add_parser("list"); x.add_argument("search", nargs="?")
    s.add_parser("tickets")
    x = s.add_parser("show"); x.add_argument("order"); x.add_argument("--json", action="store_true")
    x = s.add_parser("photos"); x.add_argument("order")
    x = s.add_parser("fix"); x.add_argument("order"); x.add_argument("cat", type=int); x.add_argument("spec"); x.add_argument("--note"); x.add_argument("--email", action="store_true")
    x = s.add_parser("remake"); x.add_argument("order"); x.add_argument("cat", type=int); x.add_argument("--note", required=True)
    x = s.add_parser("close"); x.add_argument("order"); x.add_argument("cat", type=int); x.add_argument("ticket", type=int); x.add_argument("--reply")
    x = s.add_parser("changes"); x.add_argument("order"); x.add_argument("cat", type=int); x.add_argument("n", type=int, nargs="?", default=1)
    a = p.parse_args()
    if a.cmd == "list": cmd_list(a)
    elif a.cmd == "tickets": cmd_list(a, only_tickets=True)
    elif a.cmd == "show": cmd_show(a)
    elif a.cmd == "photos": cmd_photos(a)
    elif a.cmd == "fix": cmd_fix(a)
    elif a.cmd == "remake": print(req(f"/api/admin/orders/{a.order}/cats/{a.cat}/remake", {"note": a.note}))
    elif a.cmd == "close": print(req(f"/api/admin/orders/{a.order}/cats/{a.cat}/close", {"ticket": a.ticket - 1, "reply": a.reply}))
    elif a.cmd == "changes": print(req(f"/api/admin/orders/{a.order}/cats/{a.cat}/changes", {"add": a.n}))


if __name__ == "__main__":
    main()
