import { describe, it, expect, beforeEach } from 'vitest';
import { Settings, type SettingsStore } from '../settings';

function mapStore(): SettingsStore {
  const m = new Map<string, unknown>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) };
}

let settings: Settings;
beforeEach(() => {
  settings = new Settings(mapStore());
});

describe('Settings — company brand profiles', () => {
  it('persists multiple companies and platform assignments', () => {
    settings.setBrandProfiles([
      {
        id: 'one',
        name: 'Company One',
        bio: 'First bio',
        voice: 'warm',
        audience: 'buyers',
        hashtags: [],
        bannedWords: [],
        signature: '',
      },
      {
        id: 'two',
        name: 'Company Two',
        bio: 'Second bio',
        voice: 'direct',
        audience: 'sellers',
        hashtags: ['#Two'],
        bannedWords: [],
        signature: 'Call us',
      },
    ]);
    settings.setPlatformBrandAssignment('facebook', 'two');

    expect(settings.getBrandProfiles()).toHaveLength(2);
    expect(settings.getBrandProfiles()[1].bio).toBe('Second bio');
    expect(settings.getPlatformBrandAssignments().facebook).toBe('two');
    expect(settings.getBrandKit()).toMatchObject({
      brandName: 'Company One',
      bio: 'First bio',
    });
  });
});

describe('Settings — active company scope', () => {
  const profiles = [
    {
      id: 'one',
      name: 'Company One',
      bio: 'First bio',
      voice: 'warm',
      audience: 'buyers',
      hashtags: [],
      bannedWords: [],
      signature: '',
    },
    {
      id: 'two',
      name: 'Company Two',
      bio: 'Second bio',
      voice: 'direct',
      audience: 'sellers',
      hashtags: ['#Two'],
      bannedWords: [],
      signature: 'Call us',
    },
  ];

  it('defaults to null ("All companies") and falls back to the first profile for AI briefs', () => {
    settings.setBrandProfiles(profiles);
    expect(settings.getActiveBrandId()).toBeNull();
    expect(settings.getActiveBrandKit()).toMatchObject({ name: 'Company One' });
  });

  it('persists an explicit active company and resolves its kit', () => {
    settings.setBrandProfiles(profiles);
    settings.setActiveBrandId('two');
    expect(settings.getActiveBrandId()).toBe('two');
    expect(settings.getActiveBrandKit()).toMatchObject({ name: 'Company Two' });
  });

  it('clears a stale active id once that company is deleted', () => {
    settings.setBrandProfiles(profiles);
    settings.setActiveBrandId('two');
    settings.setBrandProfiles(profiles.filter((p) => p.id !== 'two'));
    expect(settings.getActiveBrandId()).toBeNull();
    expect(settings.getActiveBrandKit()).toMatchObject({ name: 'Company One' });
  });

  it('returns null from getActiveBrandKit when there are no companies at all', () => {
    expect(settings.getActiveBrandKit()).toBeNull();
  });
});

describe('Settings — competitor tracking', () => {
  it('round-trips competitors including their company assignment', () => {
    settings.setCompetitors([
      {
        id: 'c1',
        name: 'Rival Realty',
        platform: 'instagram',
        handle: '@rivalrealty',
        notes: '',
        brandId: 'one',
        snapshots: [],
      },
      {
        id: 'c2',
        name: 'Unassigned Co',
        platform: 'facebook',
        handle: '@unassigned',
        notes: '',
        brandId: null,
        snapshots: [],
      },
    ]);

    const stored = settings.getCompetitors();
    expect(stored).toHaveLength(2);
    expect(stored[0].brandId).toBe('one');
    expect(stored[1].brandId).toBeNull();
  });

  it('defaults to an empty list when nothing has been tracked yet', () => {
    expect(settings.getCompetitors()).toEqual([]);
  });
});

describe('Settings — platform OAuth', () => {
  it('returns null until configured', () => {
    expect(settings.getPlatformOAuth('facebook')).toBeNull();
  });

  it('round-trips an OAuth client config', () => {
    settings.setPlatformOAuth('facebook', {
      clientId: 'id',
      clientSecret: 's',
      redirectUri: 'http://cb',
    });
    expect(settings.getPlatformOAuth('facebook')).toEqual({
      clientId: 'id',
      clientSecret: 's',
      redirectUri: 'http://cb',
    });
  });

  it('rejects a partial config (missing redirectUri)', () => {
    const store = mapStore();
    store.set('mas.settings.oauth.twitter', { clientId: 'x' });
    expect(new Settings(store).getPlatformOAuth('twitter')).toBeNull();
  });
});

describe('Settings — AI providers', () => {
  it('returns the active provider only when a key exists', () => {
    settings.setActiveAIProvider('claude');
    expect(settings.getActiveAIProvider()).toBeNull(); // no key yet
    settings.setAIProviderKey('claude', 'sk-123');
    const active = settings.getActiveAIProvider();
    expect(active).toMatchObject({
      name: 'claude',
      apiKey: 'sk-123',
      authMethod: 'api_key',
    });
  });

  it('image provider resolves to OpenAI when its key is set', () => {
    expect(settings.getImageProvider()).toBeNull();
    settings.setAIProviderKey('openai', 'sk-openai');
    expect(settings.getImageProvider()).toMatchObject({
      name: 'openai',
      apiKey: 'sk-openai',
      authMethod: 'api_key',
    });
  });

  it('auto-activates provider when key is saved and none is active (via setAIProviderKey)', () => {
    // direct Settings method — no auto-activate here, that logic is in IPC
    settings.setAIProviderKey('groq', 'gsk-xxx');
    expect(settings.getActiveAIProvider()).toBeNull(); // still null until setActiveAIProvider called
  });

  it('ollama is available without an api key', () => {
    settings.setActiveAIProvider('ollama');
    const active = settings.getActiveAIProvider();
    expect(active).toMatchObject({
      name: 'ollama',
      authMethod: 'local',
      apiKey: '',
    });
  });

  it('getOllamaBaseUrl returns default when not set', () => {
    expect(settings.getOllamaBaseUrl()).toBe('http://localhost:11434');
  });

  it('getOllamaBaseUrl returns custom URL after setOllamaBaseUrl', () => {
    settings.setOllamaBaseUrl('http://192.168.1.50:11434');
    expect(settings.getOllamaBaseUrl()).toBe('http://192.168.1.50:11434');
  });

  it('openrouter uses oauth_key auth method', () => {
    settings.setActiveAIProvider('openrouter');
    settings.setAIProviderKey('openrouter', 'sk-or-v1-test');
    expect(settings.getActiveAIProvider()).toMatchObject({
      name: 'openrouter',
      authMethod: 'oauth_key',
      apiKey: 'sk-or-v1-test',
    });
  });

  it('getProviderSettings returns null for unconfigured api_key provider', () => {
    expect(settings.getProviderSettings('openai')).toBeNull();
  });

  it('setAIProviderModel persists model override', () => {
    settings.setActiveAIProvider('openrouter');
    settings.setAIProviderKey('openrouter', 'sk-or-v1-test');
    settings.setAIProviderModel('openrouter', 'mistralai/mistral-7b-instruct');
    expect(settings.getActiveAIProvider()?.model).toBe(
      'mistralai/mistral-7b-instruct',
    );
  });
});
