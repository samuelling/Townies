# Renders the Townies app icon (ios/tools/icon.html) to a 1024x1024 PNG with a headless browser:
#   python3 ios/tools/make_icon.py   (needs: pip install playwright && playwright install chromium)
# -> ios/Townies/Assets.xcassets/AppIcon.appiconset/AppIcon.png
import os, sys
from playwright.sync_api import sync_playwright

here = os.path.dirname(os.path.abspath(__file__))
out = os.path.normpath(os.path.join(here, '..', 'Townies', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon.png'))
exe = os.environ.get('CHROMIUM')  # optional: a specific Chromium build
with sync_playwright() as p:
    b = p.chromium.launch(**({'executable_path': exe} if exe else {}), args=['--allow-file-access-from-files'])
    pg = b.new_page(viewport={'width': 1024, 'height': 1024}, device_scale_factor=1)
    pg.goto('file://' + os.path.join(here, 'icon.html'))
    pg.wait_for_selector('body[data-ready="1"]')
    pg.wait_for_timeout(300)
    pg.screenshot(path=out)
    b.close()
print('wrote', out)
