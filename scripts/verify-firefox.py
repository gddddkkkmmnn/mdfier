# Optional native Firefox smoke test. See docs/browser-testing.md.
import json
import os
import re
import time
from pathlib import Path

from browser_fixture import start_server
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.support.ui import WebDriverWait

root = Path(__file__).resolve().parent.parent
version = json.loads((root / "package.json").read_text())["version"]
output = root / "dist" / "qa"
output.mkdir(parents=True, exist_ok=True)
(output / "firefox-report.json").unlink(missing_ok=True)


server = start_server()
opts = Options()
opts.add_argument("-headless")
opts.set_preference("sidebar.revamp", True)
d = webdriver.Firefox(
    options=opts, service=Service(service_args=["--allow-system-access"])
)
d.command_executor._client_config.timeout = 20
d.set_window_size(1280, 900)
d.set_script_timeout(10)


class Checks(list):
    def append(self, value):
        print(value, flush=True)
        super().append(value)


report = {"browser": d.capabilities["browserVersion"], "checks": Checks()}


def panel(code):
    d.set_context("chrome")
    return d.execute_async_script(
        """const done=arguments[arguments.length-1], code=arguments[0];
 const mm=document.getElementById('sidebar').contentDocument.getElementById('webext-panels-browser').messageManager;
 const name='mdfier-qa-'+Math.random();
 const listener=m=>{mm.removeMessageListener(name,listener);done(m.data)};mm.addMessageListener(name,listener);
 mm.loadFrameScript('data:application/javascript,'+encodeURIComponent('try { const doc=content.document; sendAsyncMessage('+JSON.stringify(name)+', {value:(()=>{'+code+'})()}); } catch(e) {sendAsyncMessage('+JSON.stringify(name)+', {error:String(e)});}'),false);""",
        code,
    )


def val(code):
    result = panel(code)
    if "error" in result:
        raise Exception(result)
    return result.get("value")


def wait(code):
    return WebDriverWait(d, 15).until(lambda _: val(code))


def click(id):
    val(f"doc.getElementById('{id}').click();return true;")


def editor():
    return val("return doc.getElementById('editor')?.value;")


def opened():
    d.set_context("chrome")
    d.execute_script(
        "CustomizableUI.addWidgetToArea('mdfier_gddddkkkmmnn-browser-action',CustomizableUI.AREA_NAVBAR);SidebarController.hide();"
    )
    d.find_element(By.ID, "mdfier_gddddkkkmmnn-BAP").click()
    WebDriverWait(d, 10).until(
        lambda _: d.execute_script("return SidebarController.isOpen")
    )
    wait("return !!doc.getElementById('mode-page')")


try:
    d.install_addon(str(root.parent / f"mdfier-{version}-firefox.zip"), temporary=True)
    d.get(f"http://127.0.0.1:{server.server_port}/24")
    first = d.current_window_handle
    opened()
    report["checks"].append("native toolbar click opens sidebar")
    click("mode-page")
    wait("return !!doc.getElementById('editor')?.value")
    text = editor()
    assert re.findall(r"Loaded route (\d{3})", text) == [
        f"{i:03}" for i in range(1, 25)
    ]
    assert "Navigation noise" not in text
    report["checks"].append("Page: 24/24 loaded records, chrome removed")
    click("tab-preview")
    wait("return !doc.getElementById('preview').hidden")
    click("clear")
    wait(
        "return doc.activeElement?.id === 'paste' && doc.getElementById('document').hidden"
    )
    report["checks"].append("Preview then Clear returns focus to paste")
    val(
        "const e=doc.getElementById('paste');e.value='# Local note\\n\\nUseful text';e.dispatchEvent(new content.Event('input',{bubbles:true}));return true;"
    )
    click("create-paste")
    wait("return doc.getElementById('editor')?.value.includes('Useful text')")
    report["checks"].append("typed paste creates Markdown")
    d.set_context("content")
    d.switch_to.new_window("tab")
    second = d.current_window_handle
    d.get(f"http://127.0.0.1:{server.server_port}/500")
    wait("return doc.getElementById('document').hidden")
    start = time.monotonic()
    click("mode-page")
    wait("return doc.getElementById('editor')?.value.includes('FINAL RECORD COMPLETE')")
    text = editor()
    assert re.findall(r"Loaded route (\d{3})", text) == [
        f"{i:03}" for i in range(1, 501)
    ]
    report["capture500Seconds"] = round(time.monotonic() - start, 3)
    report["checks"].append("Page: 500/500 and final paragraph")
    d.set_context("content")
    d.switch_to.window(first)
    wait("return doc.getElementById('editor')?.value.includes('Useful text')")
    click("clear")
    wait("return doc.getElementById('document').hidden")
    d.set_context("content")
    d.switch_to.window(second)
    wait("return doc.getElementById('editor')?.value.includes('FINAL RECORD COMPLETE')")
    report["checks"].append("tab drafts isolated; Clear leaves neighboring tab intact")
    click("language-uk")
    assert val("return doc.documentElement.lang") == "uk"
    click("language-en")
    report["checks"].append("EN/UK switches")

    if os.environ.get("MDFIER_TEST_CLIPBOARD") == "1":
        click("copy")
        wait("return doc.getElementById('status')?.textContent.includes('Copied')")
        d.set_context("chrome")
        copied = d.execute_script(
            "const t=Cc['@mozilla.org/widget/transferable;1'].createInstance(Ci.nsITransferable);t.init(null);t.addDataFlavor('text/plain');Services.clipboard.getData(t,Services.clipboard.kGlobalClipboard);const data={};t.getTransferData('text/plain',data);return data.value.QueryInterface(Ci.nsISupportsString).data;"
        )
        assert "FINAL RECORD COMPLETE" in copied
        report["checks"].append("Copy writes Markdown to system clipboard")
    click("mode-pick")
    d.set_context("content")
    WebDriverWait(d, 5).until(
        lambda _: d.find_elements(By.CSS_SELECTOR, "[data-md-capture-ui]")
    )
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.common.keys import Keys

    ActionChains(d).send_keys(Keys.ESCAPE).perform()
    WebDriverWait(d, 5).until(
        lambda _: not d.find_elements(By.CSS_SELECTOR, "[data-md-capture-ui]")
    )
    report["checks"].append("Block Escape removes overlay")
    click("mode-pick")
    d.set_context("content")
    target = d.find_element(By.CSS_SELECTOR, "main section p")
    ActionChains(d).move_to_element(target).send_keys(Keys.ARROW_UP).send_keys(
        Keys.ARROW_DOWN
    ).click().perform()
    wait("return doc.getElementById('capture-label')?.textContent === 'Selected block'")
    assert "Loaded route 001" in editor()
    assert "Loaded route 002" not in editor()
    report["checks"].append("Block trusted click, parent/back, exact scope")
    d.set_context("content")
    d.execute_script(
        "const r=document.createRange();r.selectNodeContents(document.querySelector('main section p'));getSelection().removeAllRanges();getSelection().addRange(r)"
    )
    ActionChains(d).context_click(
        d.find_element(By.CSS_SELECTOR, "main section p")
    ).perform()
    d.set_context("chrome")
    item = WebDriverWait(d, 5).until(
        lambda _: next(
            (
                e
                for e in d.find_elements(
                    By.CSS_SELECTOR, "#contentAreaContextMenu menuitem"
                )
                if e.get_attribute("label") == "Capture selection as Markdown"
            ),
            None,
        )
    )
    item.click()
    wait("return doc.getElementById('capture-label')?.textContent === 'Selection'")
    assert "Loaded route 001" in editor()
    assert "Loaded route 002" not in editor()
    report["checks"].append("native selection context menu captures exact text")
    d.set_context("chrome")
    d.execute_async_script(
        "const done=arguments[arguments.length-1];ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs').AddonManager.getAddonByID('mdfier@gddddkkkmmnn').then(a=>a.reload()).then(()=>done(true));"
    )
    opened()
    click("mode-page")
    wait("return doc.getElementById('editor')?.value.includes('FINAL RECORD COMPLETE')")
    assert re.findall(r"Loaded route (\d{3})", editor()) == [
        f"{i:03}" for i in range(1, 501)
    ]
    report["checks"].append("extension reload then Page without reloading website")
    d.set_context("content")
    d.get("about:config")
    click("mode-page")
    wait("return !!doc.getElementById('status')?.textContent")
    assert "FINAL RECORD COMPLETE" in editor()
    report["checks"].append("protected page shows error and preserves draft")
    d.set_context("chrome")
    d.execute_script(
        "document.getElementById('sidebar-box').style.width='320px';document.getElementById('sidebar-box').style.maxWidth='320px';"
    )
    before_paste = editor()
    click("mode-paste")
    assert editor() == before_paste
    click("mode-paste")
    assert editor() == before_paste
    report["checks"].append("Paste toggle preserves the current draft")
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
        d.set_context("content")
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
    d.set_context("content")
    d.get(f"http://127.0.0.1:{server.server_port}/empty")
    click("mode-page")
    wait("return doc.getElementById('status')?.classList.contains('error')")
    assert "Number of retry attempts" in editor()
    report["checks"].append("empty capture preserves the current document")
    for theme in [0, 1]:
        d.execute_script(
            "Services.prefs.setIntPref('ui.systemUsesDarkTheme',arguments[0])", theme
        )
        for lang in ["en", "uk"]:
            click("language-" + lang)
            assert val(
                "return doc.documentElement.scrollWidth <= doc.documentElement.clientWidth"
            )
    report["checks"].append("320px EN/UK light/dark no horizontal overflow")
    # A new browser window gets its own sidebar and active-tab draft.
    d.set_context("content")
    owner = d.current_window_handle
    d.switch_to.new_window("window")
    d.get(f"http://127.0.0.1:{server.server_port}/article")
    opened()
    wait("return doc.getElementById('document').hidden")
    click("mode-page")
    wait(
        "return doc.getElementById('editor')?.value.includes('# How local Markdown capture works')"
    )
    d.set_context("content")
    d.close()
    d.switch_to.window(owner)
    wait("return doc.getElementById('editor')?.value.includes('# Request options')")
    report["checks"].append(
        "two windows keep independent drafts and closing one preserves the other"
    )

    # Genuine screenshots of the installed extension, using our public fixture.
    d.set_context("chrome")
    d.execute_script(
        "Services.prefs.setIntPref('ui.systemUsesDarkTheme',0);document.getElementById('sidebar-box').style.width='380px';document.getElementById('sidebar-box').style.maxWidth='380px';"
    )
    d.set_window_size(1280, 800)
    click("language-en")
    d.set_context("content")
    d.get(f"http://127.0.0.1:{server.server_port}/docs")
    click("mode-page")
    wait("return doc.getElementById('editor')?.value.includes('# Request options')")
    d.set_context("chrome")
    d.save_screenshot(str(output / "firefox-markdown.png"))
    click("tab-preview")
    wait("return !doc.getElementById('preview').hidden")
    d.set_context("chrome")
    d.save_screenshot(str(output / "firefox-native.png"))
    click("clear")
    wait("return doc.getElementById('document').hidden")
    d.set_context("chrome")
    d.save_screenshot(str(output / "firefox-start.png"))

    (output / "firefox-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
finally:
    try:
        d.set_context("content")
        d.get("about:blank")
    finally:
        d.quit()
        server.shutdown()
