import { useCallback } from 'react';
import type { AIProviderName } from '@mas/types';
import type { SettingsStatus } from '@mas/ui';

/**
 * Thin typed wrapper over window.ipcRenderer for MAS-specific IPC calls.
 * The renderer never holds a stable reference to the raw ipcRenderer; all
 * calls are isolated here to keep components testable.
 */
export function useMasIpc() {
  /** Fetch all provider status flags (configured, active, etc.). */
  const getSettingsStatus = useCallback(async (): Promise<SettingsStatus> => {
    return window.ipcRenderer.invoke(
      'mas:settings:status',
    ) as Promise<SettingsStatus>;
  }, []);

  /** Save an API key for a provider. Returns { ok: true }. */
  const setAIKey = useCallback(async (name: AIProviderName, key: string) => {
    return window.ipcRenderer.invoke(
      'mas:settings:set-ai-key',
      name,
      key,
    ) as Promise<{ ok: boolean }>;
  }, []);

  /** Change the active AI provider. Returns { ok: true }. */
  const setActiveProvider = useCallback(async (name: AIProviderName) => {
    return window.ipcRenderer.invoke(
      'mas:settings:set-active-provider',
      name,
    ) as Promise<{ ok: boolean }>;
  }, []);

  /** Save a model override for a provider. Returns { ok: true }. */
  const setAIModel = useCallback(
    async (name: AIProviderName, model: string) => {
      return window.ipcRenderer.invoke(
        'mas:settings:set-ai-model',
        name,
        model,
      ) as Promise<{ ok: boolean }>;
    },
    [],
  );

  /**
   * Start the OpenRouter OAuth flow in a child browser window.
   * Resolves when the user completes auth; rejects if they close the window.
   */
  const connectOpenRouter = useCallback(async () => {
    return window.ipcRenderer.invoke('mas:ai:openrouter-oauth') as Promise<{
      ok: boolean;
    }>;
  }, []);

  /**
   * Ping the local Ollama daemon and return available models.
   * Returns { running: boolean, models: { name: string; size: number }[] }.
   */
  const discoverOllama = useCallback(async (baseUrl?: string) => {
    return window.ipcRenderer.invoke(
      'mas:ai:ollama-discover',
      baseUrl,
    ) as Promise<{
      running: boolean;
      models: Array<{ name: string; size: number; modified_at: string }>;
    }>;
  }, []);

  /** Persist a custom Ollama base URL. */
  const setOllamaUrl = useCallback(async (url: string) => {
    return window.ipcRenderer.invoke('mas:ai:ollama-set-url', url) as Promise<{
      ok: boolean;
    }>;
  }, []);

  /** Open the Ollama install page in the system browser. */
  const openOllamaInstallPage = useCallback(async () => {
    return window.ipcRenderer.invoke('mas:ai:ollama-install-page') as Promise<{
      ok: boolean;
    }>;
  }, []);

  /**
   * Run the "Sign in with ChatGPT" device-code flow. Resolves when the user
   * has approved the code and tokens are stored. Subscribe with
   * onChatGPTUserCode BEFORE calling this to receive the code to display.
   */
  const connectChatGPT = useCallback(async () => {
    return window.ipcRenderer.invoke('mas:ai:chatgpt-oauth') as Promise<{
      ok: boolean;
    }>;
  }, []);

  /**
   * Listen for the sign-in user code pushed by the main process. Returns an
   * unsubscribe function — call it on unmount.
   */
  const onChatGPTUserCode = useCallback(
    (
      handler: (info: { userCode: string; verificationUrl: string }) => void,
    ) => {
      const listener = (...args: unknown[]) => {
        const info = args[args.length - 1] as {
          userCode: string;
          verificationUrl: string;
        };
        if (info && typeof info.userCode === 'string') handler(info);
      };
      window.ipcRenderer.on('mas:ai:chatgpt-user-code', listener);
      return () => {
        window.ipcRenderer.off('mas:ai:chatgpt-user-code', listener);
      };
    },
    [],
  );

  /** Sign out of ChatGPT (forget stored tokens). */
  const disconnectChatGPT = useCallback(async () => {
    return window.ipcRenderer.invoke('mas:ai:chatgpt-disconnect') as Promise<{
      ok: boolean;
    }>;
  }, []);

  /** Voice Studio: whether an ElevenLabs key is configured, and the active voice ID. */
  const getElevenLabsStatus = useCallback(async () => {
    return window.ipcRenderer.invoke('mas:tts:elevenlabs-get') as Promise<{
      configured: boolean;
      voiceId: string;
    }>;
  }, []);

  /** Save an ElevenLabs API key (and optional voice ID) for Voice Studio. */
  const setElevenLabsKey = useCallback(
    async (apiKey: string, voiceId?: string) => {
      return window.ipcRenderer.invoke(
        'mas:tts:elevenlabs-set',
        apiKey,
        voiceId,
      ) as Promise<{ ok: boolean }>;
    },
    [],
  );

  /** Forget the stored ElevenLabs key — Voice Studio falls back to Windows SAPI. */
  const disconnectElevenLabs = useCallback(async () => {
    return window.ipcRenderer.invoke(
      'mas:tts:elevenlabs-disconnect',
    ) as Promise<{ ok: boolean }>;
  }, []);

  return {
    getSettingsStatus,
    setAIKey,
    setActiveProvider,
    setAIModel,
    connectOpenRouter,
    connectChatGPT,
    onChatGPTUserCode,
    disconnectChatGPT,
    discoverOllama,
    setOllamaUrl,
    openOllamaInstallPage,
    getElevenLabsStatus,
    setElevenLabsKey,
    disconnectElevenLabs,
  };
}
