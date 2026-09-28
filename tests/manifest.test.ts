import { describe, expect, it } from 'vitest';
import config from '../wxt.config';

async function manifest(browser: 'chrome' | 'firefox') {
  const value = config.manifest;
  if (typeof value !== 'function') return await value;
  return await value({ browser, manifestVersion: 3, mode: 'production', command: 'build' } as never);
}

describe('browser manifests', () => {
  for (const browser of ['chrome', 'firefox'] as const) {
    it(`${browser} uses the approved persistent page access`, async () => {
      const value = await manifest(browser);
      expect(value?.host_permissions).toEqual(['<all_urls>']);
      expect(value?.permissions).toContain('scripting');
      expect(value?.permissions).not.toContain('activeTab');
    });
  }

  it('keeps browser-specific side panel declarations', async () => {
    const chrome = await manifest('chrome');
    const firefox = await manifest('firefox');
    expect(chrome).toHaveProperty('action.default_title', 'mdfier');
    expect(chrome).toHaveProperty('minimum_chrome_version', '116');
    expect(chrome).toHaveProperty('side_panel.default_path', 'panel.html');
    expect(firefox).toHaveProperty('action.default_title', 'mdfier');
    expect(firefox).toHaveProperty('browser_specific_settings.gecko.id', 'mdfier@gddddkkkmmnn');
    expect(firefox).toHaveProperty('sidebar_action.default_panel', 'panel.html');
    expect(firefox).toHaveProperty('sidebar_action.default_title', 'm↓');
    expect(firefox).toHaveProperty('sidebar_action.default_icon.32', 'icons/32.png');
  });
});
