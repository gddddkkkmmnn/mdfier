# Optional installed Chrome smoke test. See docs/browser-testing.md.
import base64
import json
import os
import re
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket
from browser_fixture import start_server
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

root = Path(__file__).resolve().parent.parent
output = root / "dist" / "qa"
output.mkdir(parents=True, exist_ok=True)
(output / "chrome-report.json").unlink(missing_ok=True)
downloads = Path(tempfile.mkdtemp(prefix="chrome-downloads-", dir=output))


server = start_server()
opts = Options()
if os.environ.get("MDFIER_CHROME_BINARY"):
    opts.binary_location = os.environ["MDFIER_CHROME_BINARY"]
opts.add_argument("--headless=new")
opts.add_argument("--load-extension=" + str(root.parent / "mdfier-chrome-unpacked"))
d = webdriver.Chrome(options=opts)
d.set_window_size(1280, 900)
report = {
    "browser": d.capabilities["browserVersion"],
    "checks": [],
    "launch": "sidePanel.open with a CDP user gesture; native toolbar click still manual",
}


def targets():
    return json.load(
        urllib.request.urlopen(
            "http://"
            + d.capabilities["goog:chromeOptions"]["debuggerAddress"]
            + "/json"
        )
    )


def call(ws, method, params):
    call.n += 1
    ident = call.n
    ws.send(json.dumps({"id": ident, "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == ident:
            if "error" in msg:
                raise Exception(msg)
            return msg["result"]


call.n = 0


def val(code):
    r = call(
        ws,
        "Runtime.evaluate",
        {
            "expression": "(()=>{const doc=document;" + code + "})()",
            "returnByValue": True,
            "userGesture": True,
        },
    )
    if "exceptionDetails" in r:
        raise Exception(r)
    return r.get("result", {}).get("value")


def wait(code):
    return WebDriverWait(d, 15).until(lambda _: val(code))


def click(id):
    # Let the side-panel layout settle before sending trusted pointer input.
    call(
        ws,
        "Runtime.evaluate",
        {
            "expression": "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
            "awaitPromise": True,
        },
    )
    point = val(
        "const e=doc.getElementById("
        + json.dumps(id)
        + ");e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};"
    )
    for kind in ["mousePressed", "mouseReleased"]:
        call(
            ws,
            "Input.dispatchMouseEvent",
            dict(type=kind, button="left", clickCount=1, **point),
        )


def editor():
    return val("return doc.getElementById('editor')?.value")


try:
    worker = WebDriverWait(d, 10).until(
        lambda _: next((t for t in targets() if t["type"] == "service_worker"), None)
    )
    extension = worker["url"].split("/")[2]
    d.get("chrome-extension://" + extension + "/panel.html")
    first = d.current_window_handle
    tab = next(t for t in targets() if t["url"].endswith("/panel.html"))
    ws = websocket.create_connection(
        tab["webSocketDebuggerUrl"], suppress_origin=True, timeout=10
    )
    r = call(
        ws,
        "Runtime.evaluate",
        {
            "expression": "chrome.sidePanel.open({windowId:chrome.windows.WINDOW_ID_CURRENT})",
            "userGesture": True,
            "awaitPromise": True,
            "returnByValue": True,
        },
    )
    assert "exceptionDetails" not in r, r
    panel = WebDriverWait(d, 10).until(
        lambda _: next(
            (
                t
                for t in targets()
                if t["url"].endswith("/panel.html") and t["id"] != tab["id"]
            ),
            None,
        )
    )
    ws.close()
    ws = websocket.create_connection(
        panel["webSocketDebuggerUrl"], suppress_origin=True, timeout=10
    )
    d.get(f"http://127.0.0.1:{server.server_port}/24")
    wait("return !!doc.getElementById('mode-page')")
    click("mode-page")
    wait("return doc.getElementById('editor')?.value.includes('FINAL RECORD COMPLETE')")
    assert re.findall(r"Loaded route (\d{3})", editor()) == [
        f"{i:03}" for i in range(1, 25)
    ]
    assert "Navigation noise" not in editor()
    report["checks"].append("installed Page: 24 records and chrome removed")
    click("tab-preview")
    wait("return !doc.getElementById('preview').hidden")
    click("clear")
    wait(
        "return doc.getElementById('document').hidden && doc.activeElement?.id === 'paste'"
    )
    report["checks"].append("Preview Clear and paste focus")
    val("doc.getElementById('paste').focus();return true;")
    call(ws, "Input.insertText", {"text": "# Local note\n\nUseful text"})
    click("create-paste")
    wait("return doc.getElementById('editor')?.value.includes('Useful text')")
    # Exercise real browser downloads with an automated destination. The native
    # OS chooser remains a separate acceptance check.
    call(
        ws,
        "Browser.setDownloadBehavior",
        {
            "behavior": "allow",
            "downloadPath": str(downloads.resolve()),
        },
    )
    before = set(downloads.glob("*.md"))
    click("download")
    saved = WebDriverWait(d, 10).until(
        lambda _: next(iter(set(downloads.glob("*.md")) - before), None)
    )
    assert saved.read_text(encoding="utf-8").strip() == "# Local note\n\nUseful text"
    report["checks"].append(
        "real download writes expected UTF-8 bytes (automated destination)"
    )
    call(ws, "Browser.setDownloadBehavior", {"behavior": "deny"})
    click("download")
    wait("return doc.getElementById('status')?.classList.contains('error')")
    assert "Useful text" in editor()
    report["checks"].append("denied download preserves document")
    d.switch_to.new_window("tab")
    second = d.current_window_handle
    d.get(f"http://127.0.0.1:{server.server_port}/500")
    wait("return doc.getElementById('document').hidden")
    start = time.monotonic()
    click("mode-page")
    wait("return doc.getElementById('editor')?.value.includes('FINAL RECORD COMPLETE')")
    assert re.findall(r"Loaded route (\d{3})", editor()) == [
        f"{i:03}" for i in range(1, 501)
    ]
    report["capture500Seconds"] = round(time.monotonic() - start, 3)
    report["checks"].append("500 records and final paragraph")
    d.switch_to.window(first)
    wait("return doc.getElementById('editor')?.value.includes('Useful text')")
    click("clear")
    wait("return doc.getElementById('document').hidden")
    d.switch_to.window(second)
    wait("return doc.getElementById('editor')?.value.includes('FINAL RECORD COMPLETE')")
    report["checks"].append("tab isolation and Clear")
    click("mode-pick")
    WebDriverWait(d, 5).until(
        lambda _: d.find_elements(By.CSS_SELECTOR, "[data-md-capture-ui]")
    )
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.keys import Keys

    ActionChains(d).send_keys(Keys.ESCAPE).perform()
    WebDriverWait(d, 5).until(
        lambda _: not d.find_elements(By.CSS_SELECTOR, "[data-md-capture-ui]")
    )
    click("mode-pick")
    ActionChains(d).move_to_element(
        d.find_element(By.CSS_SELECTOR, "main section p")
    ).click().perform()
    wait("return doc.getElementById('capture-label')?.textContent === 'Selected block'")
    assert "Loaded route 002" not in editor()
    report["checks"].append("Block trusted click and Escape")
    # A second paste is deliberately staged without destroying the current draft.
    before_paste = editor()
    click("mode-paste")
    assert editor() == before_paste
    val(
        "const data=new DataTransfer();data.setData('text/html','<h1>Rich note</h1><p><strong>Useful</strong> content</p>');data.setData('text/plain','Rich note Useful content');doc.getElementById('paste').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));return true;"
    )
    wait("return doc.getElementById('editor')?.value.includes('**Useful**')")
    report["checks"].append("rich paste keeps formatting; Paste stages replacement")
    for route, required in [
        (
            "article",
            [
                "# How local Markdown capture works",
                "Readable structure matters.",
                "Loaded article text",
                "semantic capture guide",
            ],
        ),
        (
            "docs",
            [
                "# Request options",
                "const reply = await request",
                "Number of retry attempts",
                "error reference",
            ],
        ),
    ]:
        # Main page stays the active capture target.
        d.get(f"http://127.0.0.1:{server.server_port}/{route}")
        click("mode-page")
        wait(
            "return doc.getElementById('editor')?.value.includes("
            + json.dumps(required[0])
            + ")"
        )
        assert all(fragment in editor() for fragment in required)
    report["checks"].append(
        "installed article/docs preserve headings, quote, list, code, table and useful links"
    )
    # Main page stays the active capture target.
    d.get(f"http://127.0.0.1:{server.server_port}/empty")
    click("mode-page")
    wait("return doc.getElementById('status')?.classList.contains('error')")
    assert "Number of retry attempts" in editor()
    report["checks"].append("empty capture preserves the current document")
    for theme in ["light", "dark"]:
        call(
            ws,
            "Emulation.setEmulatedMedia",
            {"features": [{"name": "prefers-color-scheme", "value": theme}]},
        )
        call(
            ws,
            "Emulation.setDeviceMetricsOverride",
            {"width": 320, "height": 800, "deviceScaleFactor": 1, "mobile": False},
        )
        for lang in ["en", "uk"]:
            click("language-" + lang)
            assert val(
                "return doc.documentElement.scrollWidth<=doc.documentElement.clientWidth"
            )
    report["checks"].append("320px EN/UK light/dark no overflow")
    screenshot = call(ws, "Page.captureScreenshot", {"format": "png"})["data"]
    (output / "chrome-native.png").write_bytes(base64.b64decode(screenshot))
    (output / "chrome-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
except Exception:
    try:
        print(
            "Chrome failure diagnostics:",
            val(
                "return {status:doc.getElementById('status')?.textContent, text:doc.body.innerText, active:doc.activeElement?.id};"
            ),
        )
    except Exception as diagnostic_error:
        print("Diagnostic unavailable:", diagnostic_error)
    raise
finally:
    d.quit()
    server.shutdown()
