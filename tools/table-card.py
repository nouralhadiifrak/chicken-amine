#!/usr/bin/env python3
"""
Builds the table card: print/table-card.html (QR code to <siteUrl>/avis/) and the print-ready
print/table-card.pdf (A6, 105 x 148 mm, one card per page).

Run after changing siteUrl in js/config.js:  python3 tools/table-card.py
Needs: pip install "qrcode[pil]", and Chromium (or Google Chrome) for the PDF.
"""
import os
import re
import shutil
import subprocess
import sys

import qrcode
import qrcode.image.svg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
config = open(os.path.join(ROOT, "js", "config.js"), encoding="utf-8").read()
site = re.search(r'siteUrl:\s*"([^"]+)"', config).group(1).rstrip("/")
target = f"{site}/avis/"

qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2)
qr.add_data(target)
qr.make(fit=True)
svg = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage).to_string(encoding="unicode")
svg = re.sub(r"<\?xml[^>]*\?>", "", svg)
svg = re.sub(r'width="[^"]*" height="[^"]*"', 'class="qr" role="img" aria-label="QR code"', svg, count=1)

html = f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Chicken Amine · Carte de table</title>
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Cairo:wght@600;700&family=Poppins:wght@500;600&display=swap" rel="stylesheet">
<style>
  @page {{ size: 105mm 148mm; margin: 0; }}
  * {{ box-sizing: border-box; }}
  html, body {{ margin: 0; }}
  body {{ font-family: "Poppins", sans-serif; background: #ddd; }}
  .card {{ width: 105mm; height: 148mm; margin: 0 auto; background: #e1060f; padding: 7mm; display: flex; flex-direction: column; }}
  .inner {{ flex: 1; background: #fff; border-radius: 6mm; padding: 6mm 6mm 5mm; display: flex; flex-direction: column; align-items: center; text-align: center; }}
  .logo {{ width: 58mm; height: auto; }}
  h1 {{ font-family: "Baloo 2", sans-serif; color: #e1060f; font-size: 17pt; line-height: 1.1; margin: 3mm 0 1mm; }}
  .ar {{ font-family: "Cairo", sans-serif; direction: rtl; font-size: 12.5pt; font-weight: 700; margin: 0 0 2mm; color: #1d1d1d; }}
  .qr {{ width: 44mm; height: 44mm; margin: 2mm 0; }}
  .qr path {{ fill: #141414; }}
  .stars {{ color: #fbba00; font-size: 16pt; letter-spacing: 1.5mm; margin-top: auto; }}
  .hint {{ font-size: 8.5pt; color: #444; margin: 1mm 0 0; }}
  @media screen {{ body {{ padding: 10mm 0; }} }}
</style>
</head>
<body>
  <section class="card">
    <div class="inner">
      <img class="logo" src="../assets/logo.png" alt="Chicken Amine">
      <h1>Votre avis compte !</h1>
      <p class="ar">رأيك يهمنا!</p>
      {svg}
      <p class="hint">Scannez pour laisser un avis Google</p>
      <p class="hint ar" style="font-size:9pt;font-weight:600">امسح الرمز لتترك رأيك على <span dir="ltr">Google</span></p>
      <div class="stars">★★★★★</div>
    </div>
  </section>
</body>
</html>
"""
out_html = os.path.join(ROOT, "print", "table-card.html")
os.makedirs(os.path.dirname(out_html), exist_ok=True)
open(out_html, "w", encoding="utf-8").write(html)
print("print/table-card.html ->", target)

chrome = next((c for c in [os.environ.get("CHROME"), "/opt/pw-browsers/chromium", shutil.which("chromium"),
                           shutil.which("google-chrome"), shutil.which("chromium-browser")] if c and os.path.exists(c)), None)
if not chrome:
    sys.exit("Chromium not found: print/table-card.html is ready, print it to PDF from the browser (A6, no margins).")
out_pdf = os.path.join(ROOT, "print", "table-card.pdf")
subprocess.run([chrome, "--headless", "--no-sandbox", "--disable-gpu", "--no-pdf-header-footer",
                "--virtual-time-budget=8000", f"--print-to-pdf={out_pdf}", "file://" + out_html],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("print/table-card.pdf")
