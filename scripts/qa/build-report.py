"""Build the self-contained QA report from a hand-written template.

    python scripts/qa/build-report.py <template.html> <out.html> [--style-from <previous report.html>]

The template is ordinary HTML with three kinds of placeholders:
  {{STYLE}}            replaced by the <style> block of --style-from (house style)
  {{figs:S01,S02}}     phone screenshots from $QA_DIR/shots, captioned from shots.tsv
  {{wide:DK1,DK2}}     the same, rendered wider (desktop pass)
  {{TIMELINE}}         every row of $QA_DIR/timeline.tsv as an ordered list
Screenshots are embedded as base64 JPEG. Invite tokens in URLs are shortened.
Then make the PDF with Playwright (Edge headless silently writes nothing here):
    node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage();await p.goto('file:///<out.html>');await p.pdf({path:'<out.pdf>',format:'Letter',printBackground:true});await b.close()})()"
"""
import argparse
import base64
import html
import io
import os
import re
import tempfile

from PIL import Image

QA_DIR = os.environ.get("QA_DIR") or os.path.join(tempfile.gettempdir(), "joshing-qa")
TOKEN_RE = re.compile(r"(inviteUserToken=|/u/[^/\s]+/|/invite/)([A-Za-z0-9_-]{12,})")


def short_tokens(text):
    return TOKEN_RE.sub(lambda m: m.group(1) + m.group(2)[:6] + "…", text)


def load_captions():
    caps = {}
    with open(os.path.join(QA_DIR, "shots.tsv"), encoding="utf-8") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("\t")
            if len(parts) >= 5:
                caps[parts[0]] = parts  # the last capture of an id wins
    return caps


def figure(sid, caps, wide):
    path = os.path.join(QA_DIR, "shots", sid + ".png")
    if sid not in caps or not os.path.exists(path):
        raise SystemExit("missing shot " + sid)
    _, when, acct, url, cap = caps[sid][:5]
    im = Image.open(path).convert("RGB")
    width = 640 if wide else 390
    height = int(im.size[1] * width / im.size[0])
    buf = io.BytesIO()
    im.resize((width, height), Image.LANCZOS).save(buf, "JPEG", quality=68, optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode()
    shown = 300 if wide else 172
    style = ' style="width:%dpx"' % max(90, int(900 * width / height)) if height / width * shown > 900 else ""
    cls = ' class="wide"' if wide else ""
    return (
        '<figure%s%s><img alt="%s" src="data:image/jpeg;base64,%s"><figcaption><b>%s</b> · %s · %s · '
        '<span class="mono">%s</span><br>%s</figcaption></figure>'
        % (cls, style, html.escape(cap), b64, sid, when.replace(" ET", ""), acct, html.escape(short_tokens(url)), html.escape(cap))
    )


def timeline():
    items = []
    with open(os.path.join(QA_DIR, "timeline.tsv"), encoding="utf-8") as fh:
        for row in fh:
            if not row.strip():
                continue
            parts = row.rstrip("\n").split("\t") + ["", "", ""]
            when, acct, url, action = parts[0], parts[1], parts[2], "\t".join(p for p in parts[3:] if p)
            items.append(
                "<li>%s · <b>%s</b> · %s · %s</li>"
                % (html.escape(when), html.escape(acct), html.escape(short_tokens(url)), html.escape(short_tokens(action)))
            )
    return '<ol class="timeline">' + "\n".join(items) + "</ol>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("template")
    ap.add_argument("out")
    ap.add_argument("--style-from")
    args = ap.parse_args()

    tpl = open(args.template, encoding="utf-8").read()
    if "{{STYLE}}" in tpl:
        if not args.style_from:
            raise SystemExit("template has {{STYLE}}: pass --style-from <previous report>")
        style = re.search(r"<style>.*?</style>", open(args.style_from, encoding="utf-8").read(), re.S).group(0)
        tpl = tpl.replace("{{STYLE}}", style)

    caps = load_captions()
    used = set()

    def figs(match, wide=False):
        ids = [s.strip() for s in match.group(1).split(",") if s.strip()]
        used.update(ids)
        return '<div class="shots">' + "".join(figure(s, caps, wide) for s in ids) + "</div>"

    tpl = re.sub(r"\{\{figs:([^}]*)\}\}", figs, tpl)
    tpl = re.sub(r"\{\{wide:([^}]*)\}\}", lambda m: figs(m, True), tpl)
    tpl = tpl.replace("{{TIMELINE}}", timeline())
    leftover = re.findall(r"\{\{[^}]*\}\}", tpl)
    if leftover:
        raise SystemExit("unfilled placeholders: %s" % leftover)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(tpl)
    print("wrote %s (%.2f MB, %d screenshots)" % (args.out, os.path.getsize(args.out) / 1e6, len(used)))


if __name__ == "__main__":
    main()
