import { defineConfig } from 'wxt';
export default defineConfig({
 manifestVersion: 3,
 manifest: ({ browser }) => ({
  name: 'mdfier', description: 'Turn pages, selections and clipboard text into Markdown, locally.',
  permissions: ['scripting','storage','contextMenus','downloads','clipboardWrite', ...(browser === 'chrome' ? ['sidePanel'] : [])],
  host_permissions: ['<all_urls>'],
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  action: { default_title: 'mdfier', default_icon: {16: 'icons/16.png',32:'icons/32.png'} },
  ...(browser === 'firefox'
    ? { sidebar_action: { default_panel: 'panel.html', default_title: 'm↓', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png' } }, browser_specific_settings: { gecko: { id: 'mdfier@gddddkkkmmnn', strict_min_version: '142.0', data_collection_permissions: { required: ['none'] } } } }
    : { minimum_chrome_version: '116', side_panel: { default_path: 'panel.html' } }),
 }),
});
