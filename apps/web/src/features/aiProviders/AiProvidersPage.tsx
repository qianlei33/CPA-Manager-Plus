import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  AmpcodeSection,
  ClaudeSection,
  CodexSection,
  GeminiSection,
  OpenAISection,
  VertexSection,
  useProviderRecentRequests,
} from '@/components/providers';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import type { ProviderId } from '@/components/providers/ProviderNav';
import {
  buildClaudeMessagesEndpoint,
  buildOpenAIChatCompletionsEndpoint,
  hasDisableAllModelsRule,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { ampcodeApi, apiCallApi, getApiCallErrorMessage, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore, useThemeStore } from '@/stores';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import iconAmp from '@/assets/icons/amp.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconCodex from '@/assets/icons/codex.svg';
import iconGemini from '@/assets/icons/gemini.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconVertex from '@/assets/icons/vertex.svg';
import styles from './AiProvidersPage.module.scss';

const PROVIDER_ORDER: ProviderId[] = ['gemini', 'codex', 'claude', 'vertex', 'openai', 'ampcode'];

const PROVIDER_LABELS: Record<ProviderId, string> = {
  gemini: 'Gemini',
  codex: 'Codex',
  claude: 'Claude',
  vertex: 'Vertex',
  openai: 'OpenAI 兼容',
  ampcode: 'Amp CLI',
};

type TestModelStatus = 'idle' | 'running' | 'success' | 'error';

type ProviderModelTestTarget = {
  provider: Exclude<ProviderId, 'ampcode'>;
  title: string;
  config: GeminiKeyConfig | ProviderKeyConfig | OpenAIProviderConfig;
};

type TestModelRow = {
  name: string;
  status: TestModelStatus;
  message?: string;
  durationMs?: number;
};

const TEST_TIMEOUT_MS = 30_000;
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

const formatDuration = (durationMs?: number): string => {
  if (!Number.isFinite(durationMs)) return '';
  return `请求时长: ${((durationMs ?? 0) / 1000).toFixed(2)}s`;
};

const getModelNames = (models?: Array<{ name?: string }>): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  models?.forEach((model) => {
    const name = String(model?.name ?? '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    result.push(name);
  });
  return result;
};

export function AiProvidersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);
  const isCacheValid = useConfigStore((state) => state.isCacheValid);

  const hasMounted = useRef(false);
  const [loading, setLoading] = useState(() => !isCacheValid());
  const [error, setError] = useState('');

  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyConfig[]>(
    () => config?.geminiApiKeys || []
  );
  const [codexConfigs, setCodexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.codexApiKeys || []
  );
  const [claudeConfigs, setClaudeConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.claudeApiKeys || []
  );
  const [vertexConfigs, setVertexConfigs] = useState<ProviderKeyConfig[]>(
    () => config?.vertexApiKeys || []
  );
  const [openaiProviders, setOpenaiProviders] = useState<OpenAIProviderConfig[]>(
    () => config?.openaiCompatibility || []
  );

  const [configSwitchingKey, setConfigSwitchingKey] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<ProviderId>('codex');
  const [modelTestTarget, setModelTestTarget] = useState<ProviderModelTestTarget | null>(null);
  const [modelTestRows, setModelTestRows] = useState<TestModelRow[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [modelTestStream, setModelTestStream] = useState(false);

  const disableControls = connectionStatus !== 'connected';
  const isSwitching = Boolean(configSwitchingKey);

  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;

  const { usageByProvider, loadRecentRequests, refreshRecentRequests } = useProviderRecentRequests({
    enabled: isCurrentLayer,
  });

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  };

  const loadConfigs = useCallback(async () => {
    const hasValidCache = isCacheValid();
    if (!hasValidCache) {
      setLoading(true);
    }
    setError('');
    try {
      const [configResult, vertexResult, ampcodeResult, openaiResult] = await Promise.allSettled([
        fetchConfig(),
        providersApi.getVertexConfigs(),
        ampcodeApi.getAmpcode(),
        providersApi.getOpenAIProviders(),
      ]);

      if (configResult.status !== 'fulfilled') {
        throw configResult.reason;
      }

      const data = configResult.value;
      setGeminiKeys(data?.geminiApiKeys || []);
      setCodexConfigs(data?.codexApiKeys || []);
      setClaudeConfigs(data?.claudeApiKeys || []);
      setVertexConfigs(data?.vertexApiKeys || []);
      setOpenaiProviders(data?.openaiCompatibility || []);

      if (vertexResult.status === 'fulfilled') {
        setVertexConfigs(vertexResult.value || []);
        updateConfigValue('vertex-api-key', vertexResult.value || []);
        clearCache('vertex-api-key');
      }

      if (ampcodeResult.status === 'fulfilled') {
        updateConfigValue('ampcode', ampcodeResult.value);
        clearCache('ampcode');
      }

      if (openaiResult.status === 'fulfilled') {
        setOpenaiProviders(openaiResult.value || []);
        updateConfigValue('openai-compatibility', openaiResult.value || []);
        clearCache('openai-compatibility');
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err) || t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [clearCache, fetchConfig, isCacheValid, t, updateConfigValue]);

  useEffect(() => {
    if (hasMounted.current) return;
    hasMounted.current = true;
    loadConfigs();
  }, [loadConfigs]);

  useEffect(() => {
    if (!isCurrentLayer) return;
    void loadRecentRequests().catch(() => {});
  }, [isCurrentLayer, loadRecentRequests]);

  useEffect(() => {
    if (config?.geminiApiKeys) setGeminiKeys(config.geminiApiKeys);
    if (config?.codexApiKeys) setCodexConfigs(config.codexApiKeys);
    if (config?.claudeApiKeys) setClaudeConfigs(config.claudeApiKeys);
    if (config?.vertexApiKeys) setVertexConfigs(config.vertexApiKeys);
    if (config?.openaiCompatibility) setOpenaiProviders(config.openaiCompatibility);
  }, [
    config?.geminiApiKeys,
    config?.codexApiKeys,
    config?.claudeApiKeys,
    config?.vertexApiKeys,
    config?.openaiCompatibility,
  ]);

  const handleRecentRequestsRefresh = useCallback(async () => {
    await refreshRecentRequests();
  }, [refreshRecentRequests]);

  useHeaderRefresh(handleRecentRequestsRefresh, isCurrentLayer);

  const openEditor = useCallback(
    (path: string) => {
      navigate(path, { state: { fromAiProviders: true } });
    },
    [navigate]
  );

  const openModelTest = (target: ProviderModelTestTarget) => {
    const names = getModelNames(target.config.models);
    setModelTestTarget(target);
    setModelTestRows(names.map((name) => ({ name, status: 'idle' })));
    setModelSearch('');
    setModelTestStream(false);
  };

  const closeModelTest = () => {
    setModelTestTarget(null);
    setModelTestRows([]);
    setModelSearch('');
    setModelTestStream(false);
  };

  const updateModelTestRow = (modelName: string, patch: Partial<TestModelRow>) => {
    setModelTestRows((rows) => rows.map((row) => (row.name === modelName ? { ...row, ...patch } : row)));
  };

  const buildGeminiGenerateContentEndpoint = (baseUrl: string, modelName: string, stream: boolean): string => {
    const fallback = baseUrl?.trim() || 'https://generativelanguage.googleapis.com';
    const trimmed = fallback.replace(/\/+$/g, '').replace(/\/v1beta(?:\/.*)?$/i, '');
    const normalizedModel = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
    return `${trimmed}/v1beta/${normalizedModel}:${stream ? 'streamGenerateContent' : 'generateContent'}`;
  };

  const runModelRequest = async (target: ProviderModelTestTarget, modelName: string, stream: boolean) => {
    const configItem = target.config;
    const headers = buildHeaderObject(configItem.headers);
    const keyAuthIndex = normalizeAuthIndex(configItem.authIndex) ?? undefined;
    const apiKey = 'apiKey' in configItem ? String(configItem.apiKey ?? '').trim() : '';
    const configProxyUrl = 'proxyUrl' in configItem ? String(configItem.proxyUrl ?? '').trim() : '';

    const withProxy = <T extends Record<string, unknown>>(payload: T, proxyUrl: string = configProxyUrl): T => {
      const trimmed = proxyUrl.trim();
      if (!trimmed) return payload;
      return { ...payload, proxyUrl: trimmed, 'proxy-url': trimmed };
    };

    if (target.provider === 'claude') {
      const endpoint = buildClaudeMessagesEndpoint(configItem.baseUrl ?? '');
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      };
      if (!hasHeader(requestHeaders, 'anthropic-version')) {
        requestHeaders['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION;
      }
      if (!hasHeader(requestHeaders, 'x-api-key')) {
        requestHeaders['x-api-key'] = keyAuthIndex ? '$TOKEN$' : apiKey;
      }
      const result = await apiCallApi.request(
        withProxy({
          authIndex: keyAuthIndex,
          method: 'POST',
          url: endpoint,
          header: requestHeaders,
          data: JSON.stringify({
            model: modelName,
            max_tokens: 8,
            stream,
              messages: [{ role: 'user', content: 'Hi' }],
            }),
        }),
        { timeout: TEST_TIMEOUT_MS }
      );
      if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(getApiCallErrorMessage(result));
      return;
    }

    if (target.provider === 'gemini' || target.provider === 'vertex') {
      const endpoint = buildGeminiGenerateContentEndpoint(configItem.baseUrl ?? '', modelName, stream);
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...headers,
      };
      if (!hasHeader(requestHeaders, 'x-goog-api-key')) {
        requestHeaders['x-goog-api-key'] = keyAuthIndex ? '$TOKEN$' : apiKey;
      }
      const result = await apiCallApi.request(
        withProxy({
          authIndex: keyAuthIndex,
          method: 'POST',
          url: endpoint,
          header: requestHeaders,
          data: JSON.stringify({ contents: [{ parts: [{ text: 'Hi' }] }] }),
        }),
        { timeout: TEST_TIMEOUT_MS }
      );
      if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(getApiCallErrorMessage(result));
      return;
    }

    const openaiConfig = configItem as OpenAIProviderConfig | ProviderKeyConfig;
    const endpoint = buildOpenAIChatCompletionsEndpoint(openaiConfig.baseUrl ?? '');
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    let authIndex = keyAuthIndex;
    let resolvedApiKey = apiKey;
    let requestProxyUrl = configProxyUrl;
    if (target.provider === 'openai') {
      const firstEntry = (configItem as OpenAIProviderConfig).apiKeyEntries?.find(
        (entry) => entry.apiKey?.trim() || normalizeAuthIndex(entry.authIndex)
      );
      authIndex = normalizeAuthIndex(firstEntry?.authIndex) ?? undefined;
      resolvedApiKey = firstEntry?.apiKey?.trim() ?? '';
      requestProxyUrl = firstEntry?.proxyUrl?.trim() || configProxyUrl;
      Object.assign(requestHeaders, buildHeaderObject(firstEntry?.headers));
    }
    if (!hasHeader(requestHeaders, 'authorization')) {
      requestHeaders.Authorization = authIndex ? 'Bearer $TOKEN$' : `Bearer ${resolvedApiKey}`;
    }
    const result = await apiCallApi.request(
      withProxy({
        authIndex,
        method: 'POST',
        url: endpoint,
        header: requestHeaders,
        data: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: 'Hi' }],
          stream,
          max_tokens: 8,
        }),
      }, requestProxyUrl),
      { timeout: TEST_TIMEOUT_MS }
    );
    if (result.statusCode < 200 || result.statusCode >= 300) throw new Error(getApiCallErrorMessage(result));
  };

  const runModelTest = async (modelName: string) => {
    if (!modelTestTarget) return;
    updateModelTestRow(modelName, { status: 'running', message: '', durationMs: undefined });
    const startedAt = performance.now();
    try {
      await runModelRequest(modelTestTarget, modelName, modelTestStream);
      const durationMs = performance.now() - startedAt;
      updateModelTestRow(modelName, { status: 'success', message: '可用', durationMs });
      showNotification(
        `通道 ${modelTestTarget.title} 测试成功，模型 ${modelName} 耗时 ${formatDuration(durationMs).replace('请求时长: ', '')}`,
        'success'
      );
    } catch (err) {
      const message = getErrorMessage(err) || '测试失败';
      updateModelTestRow(modelName, { status: 'error', message, durationMs: performance.now() - startedAt });
    }
  };

  const runAllModelTests = async () => {
    const targets = modelTestRows.filter((row) => row.status !== 'running');
    for (const row of targets) {
      await runModelTest(row.name);
    }
  };

  const copyModelTestError = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      showNotification('错误信息已复制', 'success');
    } catch {
      showNotification('复制失败', 'error');
    }
  };

  const providerSummaries = useMemo(() => {
    const ampConfigured = Boolean(
      config?.ampcode?.upstreamUrl ||
      config?.ampcode?.upstreamApiKey ||
      config?.ampcode?.upstreamApiKeys?.length ||
      config?.ampcode?.modelMappings?.length
    );
    const providerIcon = (provider: ProviderId) => {
      if (provider === 'gemini') return iconGemini;
      if (provider === 'codex') return iconCodex;
      if (provider === 'claude') return iconClaude;
      if (provider === 'vertex') return iconVertex;
      if (provider === 'ampcode') return iconAmp;
      return resolvedTheme === 'dark' ? iconOpenaiDark : iconOpenaiLight;
    };
    const providerCount = (provider: ProviderId) => {
      if (provider === 'gemini') return geminiKeys.length;
      if (provider === 'codex') return codexConfigs.length;
      if (provider === 'claude') return claudeConfigs.length;
      if (provider === 'vertex') return vertexConfigs.length;
      if (provider === 'openai') return openaiProviders.length;
      return ampConfigured ? 1 : 0;
    };
    const providerActiveCount = (provider: ProviderId) => {
      if (provider === 'gemini') {
        return geminiKeys.filter((item) => !hasDisableAllModelsRule(item.excludedModels)).length;
      }
      if (provider === 'codex') {
        return codexConfigs.filter((item) => !hasDisableAllModelsRule(item.excludedModels)).length;
      }
      if (provider === 'claude') {
        return claudeConfigs.filter((item) => !hasDisableAllModelsRule(item.excludedModels)).length;
      }
      if (provider === 'vertex') {
        return vertexConfigs.filter((item) => !hasDisableAllModelsRule(item.excludedModels)).length;
      }
      if (provider === 'openai') return openaiProviders.filter((item) => !item.disabled).length;
      return ampConfigured ? 1 : 0;
    };

    return PROVIDER_ORDER.map((provider) => ({
      id: provider,
      label: PROVIDER_LABELS[provider],
      icon: providerIcon(provider),
      count: providerCount(provider),
      activeCount: providerActiveCount(provider),
      configured: provider === 'ampcode' ? ampConfigured : providerCount(provider) > 0,
    }));
  }, [
    claudeConfigs,
    codexConfigs,
    config?.ampcode,
    geminiKeys,
    openaiProviders,
    resolvedTheme,
    vertexConfigs,
  ]);

  const totalConfigured = providerSummaries.reduce((sum, item) => sum + item.count, 0);
  const totalActive = providerSummaries.reduce((sum, item) => sum + item.activeCount, 0);
  const activeSummary = providerSummaries.find((item) => item.id === activeProvider) ?? providerSummaries[0];

  const renderActiveSection = () => {
    if (activeProvider === 'gemini') {
      return (
        <GeminiSection
          configs={geminiKeys}
          usageByProvider={usageByProvider}
          loading={loading}
          disableControls={disableControls}
          isSwitching={isSwitching}
          onAdd={() => openEditor('/ai-providers/gemini/new')}
          onEdit={(index) => openEditor(`/ai-providers/gemini/${index}`)}
          onDelete={deleteGemini}
          onTest={(index) => openModelTest({ provider: 'gemini', title: `Gemini #${index + 1}`, config: geminiKeys[index] })}
          onToggle={(index, enabled) => void setConfigEnabled('gemini', index, enabled)}
        />
      );
    }
    if (activeProvider === 'codex') {
      return (
        <CodexSection
          configs={codexConfigs}
          usageByProvider={usageByProvider}
          loading={loading}
          disableControls={disableControls}
          isSwitching={isSwitching}
          onAdd={() => openEditor('/ai-providers/codex/new')}
          onEdit={(index) => openEditor(`/ai-providers/codex/${index}`)}
          onDelete={(index) => void deleteProviderEntry('codex', index)}
          onTest={(index) => openModelTest({ provider: 'codex', title: `Codex #${index + 1}`, config: codexConfigs[index] })}
          onToggle={(index, enabled) => void setConfigEnabled('codex', index, enabled)}
        />
      );
    }
    if (activeProvider === 'claude') {
      return (
        <ClaudeSection
          configs={claudeConfigs}
          usageByProvider={usageByProvider}
          loading={loading}
          disableControls={disableControls}
          isSwitching={isSwitching}
          onAdd={() => openEditor('/ai-providers/claude/new')}
          onEdit={(index) => openEditor(`/ai-providers/claude/${index}`)}
          onDelete={(index) => void deleteProviderEntry('claude', index)}
          onTest={(index) => openModelTest({ provider: 'claude', title: `Claude #${index + 1}`, config: claudeConfigs[index] })}
          onToggle={(index, enabled) => void setConfigEnabled('claude', index, enabled)}
        />
      );
    }
    if (activeProvider === 'vertex') {
      return (
        <VertexSection
          configs={vertexConfigs}
          usageByProvider={usageByProvider}
          loading={loading}
          disableControls={disableControls}
          isSwitching={isSwitching}
          onAdd={() => openEditor('/ai-providers/vertex/new')}
          onEdit={(index) => openEditor(`/ai-providers/vertex/${index}`)}
          onDelete={deleteVertex}
          onTest={(index) => openModelTest({ provider: 'vertex', title: `Vertex #${index + 1}`, config: vertexConfigs[index] })}
          onToggle={(index, enabled) => void setConfigEnabled('vertex', index, enabled)}
        />
      );
    }
    if (activeProvider === 'openai') {
      return (
        <OpenAISection
          configs={openaiProviders}
          usageByProvider={usageByProvider}
          loading={loading}
          disableControls={disableControls}
          isSwitching={isSwitching}
          resolvedTheme={resolvedTheme}
          onAdd={() => openEditor('/ai-providers/openai/new')}
          onEdit={(index) => openEditor(`/ai-providers/openai/${index}`)}
          onDelete={deleteOpenai}
          onTest={(index) => openModelTest({ provider: 'openai', title: openaiProviders[index]?.name || `OpenAI #${index + 1}`, config: openaiProviders[index] })}
          onToggle={(index, enabled) => void setOpenAIProviderEnabled(index, enabled)}
        />
      );
    }
    return (
      <AmpcodeSection
        config={config?.ampcode}
        loading={loading}
        disableControls={disableControls}
        isSwitching={isSwitching}
        onEdit={() => openEditor('/ai-providers/ampcode')}
      />
    );
  };

  const deleteGemini = async (index: number) => {
    const entry = geminiKeys[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.gemini_delete_title', { defaultValue: 'Delete Gemini Key' }),
      message: t('ai_providers.gemini_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteGeminiKey(entry.apiKey, entry.baseUrl);
          const next = geminiKeys.filter((_, idx) => idx !== index);
          setGeminiKeys(next);
          updateConfigValue('gemini-api-key', next);
          clearCache('gemini-api-key');
          showNotification(t('notification.gemini_key_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const setConfigEnabled = async (
    provider: 'gemini' | 'codex' | 'claude' | 'vertex',
    index: number,
    enabled: boolean
  ) => {
    if (provider === 'gemini') {
      const current = geminiKeys[index];
      if (!current) return;

      const switchingKey = `${provider}:${current.apiKey}`;
      setConfigSwitchingKey(switchingKey);

      const previousList = geminiKeys;
      const nextExcluded = enabled
        ? withoutDisableAllModelsRule(current.excludedModels)
        : withDisableAllModelsRule(current.excludedModels);
      const nextItem: GeminiKeyConfig = { ...current, excludedModels: nextExcluded };
      const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

      setGeminiKeys(nextList);
      updateConfigValue('gemini-api-key', nextList);
      clearCache('gemini-api-key');

      try {
        await providersApi.saveGeminiKeys(nextList);
        showNotification(
          enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
          'success'
        );
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        setGeminiKeys(previousList);
        updateConfigValue('gemini-api-key', previousList);
        clearCache('gemini-api-key');
        showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
      } finally {
        setConfigSwitchingKey(null);
      }
      return;
    }

    const source =
      provider === 'codex'
        ? codexConfigs
        : provider === 'claude'
          ? claudeConfigs
          : vertexConfigs;
    const current = source[index];
    if (!current) return;

    const switchingKey = `${provider}:${current.apiKey}`;
    setConfigSwitchingKey(switchingKey);

    const previousList = source;
    const nextExcluded = enabled
      ? withoutDisableAllModelsRule(current.excludedModels)
      : withDisableAllModelsRule(current.excludedModels);
    const nextItem: ProviderKeyConfig = { ...current, excludedModels: nextExcluded };
    const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

    if (provider === 'codex') {
      setCodexConfigs(nextList);
      updateConfigValue('codex-api-key', nextList);
      clearCache('codex-api-key');
    } else if (provider === 'claude') {
      setClaudeConfigs(nextList);
      updateConfigValue('claude-api-key', nextList);
      clearCache('claude-api-key');
    } else {
      setVertexConfigs(nextList);
      updateConfigValue('vertex-api-key', nextList);
      clearCache('vertex-api-key');
    }

    try {
      if (provider === 'codex') {
        await providersApi.saveCodexConfigs(nextList);
      } else if (provider === 'claude') {
        await providersApi.saveClaudeConfigs(nextList);
      } else {
        await providersApi.saveVertexConfigs(nextList);
      }
      showNotification(
        enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
        'success'
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if (provider === 'codex') {
        setCodexConfigs(previousList);
        updateConfigValue('codex-api-key', previousList);
        clearCache('codex-api-key');
      } else if (provider === 'claude') {
        setClaudeConfigs(previousList);
        updateConfigValue('claude-api-key', previousList);
        clearCache('claude-api-key');
      } else {
        setVertexConfigs(previousList);
        updateConfigValue('vertex-api-key', previousList);
        clearCache('vertex-api-key');
      }
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const setOpenAIProviderEnabled = async (index: number, enabled: boolean) => {
    const current = openaiProviders[index];
    if (!current) return;

    const switchingKey = `openai:${current.name}:${index}`;
    setConfigSwitchingKey(switchingKey);

    const previousList = openaiProviders;
    const nextItem: OpenAIProviderConfig = { ...current, disabled: !enabled };
    const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

    setOpenaiProviders(nextList);
    updateConfigValue('openai-compatibility', nextList);
    clearCache('openai-compatibility');

    try {
      await providersApi.updateOpenAIProviderDisabled(index, !enabled);
      showNotification(
        enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
        'success'
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setOpenaiProviders(previousList);
      updateConfigValue('openai-compatibility', previousList);
      clearCache('openai-compatibility');
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const deleteProviderEntry = async (type: 'codex' | 'claude', index: number) => {
    const source = type === 'codex' ? codexConfigs : claudeConfigs;
    const entry = source[index];
    if (!entry) return;
    showConfirmation({
      title: t(`ai_providers.${type}_delete_title`, { defaultValue: `Delete ${type === 'codex' ? 'Codex' : 'Claude'} Config` }),
      message: t(`ai_providers.${type}_delete_confirm`),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          if (type === 'codex') {
            await providersApi.deleteCodexConfig(entry.apiKey, entry.baseUrl);
            const next = codexConfigs.filter((_, idx) => idx !== index);
            setCodexConfigs(next);
            updateConfigValue('codex-api-key', next);
            clearCache('codex-api-key');
            showNotification(t('notification.codex_config_deleted'), 'success');
          } else {
            await providersApi.deleteClaudeConfig(entry.apiKey, entry.baseUrl);
            const next = claudeConfigs.filter((_, idx) => idx !== index);
            setClaudeConfigs(next);
            updateConfigValue('claude-api-key', next);
            clearCache('claude-api-key');
            showNotification(t('notification.claude_config_deleted'), 'success');
          }
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const deleteVertex = async (index: number) => {
    const entry = vertexConfigs[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.vertex_delete_title', { defaultValue: 'Delete Vertex Config' }),
      message: t('ai_providers.vertex_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteVertexConfig(entry.apiKey, entry.baseUrl);
          const next = vertexConfigs.filter((_, idx) => idx !== index);
          setVertexConfigs(next);
          updateConfigValue('vertex-api-key', next);
          clearCache('vertex-api-key');
          showNotification(t('notification.vertex_config_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const deleteOpenai = async (index: number) => {
    const entry = openaiProviders[index];
    if (!entry) return;
    showConfirmation({
      title: t('ai_providers.openai_delete_title', { defaultValue: 'Delete OpenAI Provider' }),
      message: t('ai_providers.openai_delete_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await providersApi.deleteOpenAIProvider(entry.name);
          const next = openaiProviders.filter((_, idx) => idx !== index);
          setOpenaiProviders(next);
          updateConfigValue('openai-compatibility', next);
          clearCache('openai-compatibility');
          showNotification(t('notification.openai_provider_deleted'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        }
      },
    });
  };

  const filteredModelTestRows = modelTestRows.filter((row) =>
    row.name.toLowerCase().includes(modelSearch.trim().toLowerCase())
  );
  const modelTestRunning = modelTestRows.some((row) => row.status === 'running');
  const modelTestSuccessCount = modelTestRows.filter((row) => row.status === 'success').length;
  const modelTestFailedCount = modelTestRows.filter((row) => row.status === 'error').length;

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <div>
          <h1>AI 提供商</h1>
          <div className={styles.summaryBadges}>
            <span>{totalActive}/{totalConfigured || 0} 个活跃资源</span>
            <span>{providerSummaries.filter((item) => item.configured).length} 个提供商家族</span>
            <span>更新于 {new Date().toLocaleString()}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button variant="secondary" onClick={() => void loadConfigs()} disabled={loading}>
            {t('common.refresh')}
          </Button>
        </div>
      </header>
      <div className={styles.content}>
        {error && <div className="error-box">{error}</div>}
        <aside className={styles.providerSidebar} aria-label="AI 提供商分类">
          <div className={styles.sidebarTitle}>提供商</div>
          <div className={styles.providerTabs}>
            {providerSummaries.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={`${styles.providerTab} ${provider.id === activeProvider ? styles.providerTabActive : ''}`}
                onClick={() => setActiveProvider(provider.id)}
              >
                <img src={provider.icon} alt="" className={styles.providerIcon} />
                <span className={styles.providerTabText}>
                  <strong>{provider.label}</strong>
                  <small>{provider.configured ? `${provider.activeCount}/${provider.count} 活跃` : '未配置'}</small>
                </span>
                <span className={styles.providerCount}>{provider.configured ? provider.count : '-'}</span>
              </button>
            ))}
          </div>
        </aside>

        <section id={`provider-${activeProvider}`} className={styles.providerPanel}>
          <div className={styles.activeProviderHeader}>
            <div className={styles.activeProviderTitle}>
              <img src={activeSummary?.icon} alt="" className={styles.activeProviderIcon} />
              <span>{activeSummary?.label}</span>
            </div>
            <div className={styles.activeProviderMeta}>
              {activeSummary?.configured ? `${activeSummary.activeCount}/${activeSummary.count} 活跃` : '未配置'}
            </div>
          </div>
          {renderActiveSection()}
        </section>
      </div>
      <Modal
        open={Boolean(modelTestTarget)}
        title={
          modelTestTarget
            ? `${modelTestTarget.title} 的模型测试`
            : '模型测试'
        }
        width={920}
        onClose={closeModelTest}
        closeDisabled={modelTestRunning}
        footer={
          <div className={styles.modelTestFooter}>
            <Button variant="secondary" onClick={closeModelTest} disabled={modelTestRunning}>
              取消
            </Button>
            <Button
              onClick={() => void runAllModelTests()}
              disabled={modelTestRunning || modelTestRows.length === 0}
            >
              批量测试{modelTestRows.length ? ` ${modelTestRows.length} 个模型` : ''}
            </Button>
          </div>
        }
      >
        <div className={styles.modelTestDialog}>
          <div className={styles.modelTestMeta}>
            <span>{modelTestTarget ? PROVIDER_LABELS[modelTestTarget.provider] : '-'}</span>
            <span>共 {modelTestRows.length} 个模型</span>
            <span>成功 {modelTestSuccessCount}</span>
            <span>失败 {modelTestFailedCount}</span>
          </div>
          <div className={styles.modelTestNotice}>
            说明：当前测试为{modelTestStream ? '流式' : '非流式'}最小请求，用于验证模型名称、密钥和服务地址是否可用；实际可用性仍以业务请求为准。
          </div>
          <div className={styles.modelTestToolbar}>
            <input
              className={styles.modelTestSearch}
              value={modelSearch}
              placeholder="搜索模型..."
              onChange={(event) => setModelSearch(event.target.value)}
            />
            <label className={styles.modelTestStreamToggle}>
              <span>流式</span>
              <input
                type="checkbox"
                checked={modelTestStream}
                disabled={modelTestRunning}
                onChange={(event) => setModelTestStream(event.target.checked)}
              />
              <i aria-hidden="true" />
            </label>
          </div>
          {modelTestRows.length === 0 ? (
            <div className={styles.modelTestEmpty}>当前配置没有模型，请先在配置中添加模型后再测试。</div>
          ) : (
            <div className={styles.modelTestTable}>
              <div className={styles.modelTestHead}>
                <span>模型名称</span>
                <span>状态</span>
                <span>耗时</span>
                <span>错误信息</span>
                <span>操作</span>
              </div>
              {filteredModelTestRows.map((row) => (
                <div key={row.name} className={styles.modelTestRow}>
                  <span className={styles.modelTestName}>{row.name}</span>
                  <span className={`${styles.modelTestStatus} ${styles[`modelTestStatus_${row.status}`]}`}>
                    {row.status === 'idle' ? '未开始' : row.status === 'running' ? '测试中' : row.status === 'success' ? '成功' : '失败'}
                  </span>
                  <span className={styles.modelTestDuration}>
                    {row.durationMs !== undefined ? formatDuration(row.durationMs).replace('请求时长: ', '') : '-'}
                  </span>
                  <span className={styles.modelTestErrorCell}>
                    {row.message && row.status === 'error' ? (
                      <>
                        <span title={row.message}>{row.message}</span>
                        <button type="button" onClick={() => void copyModelTestError(row.message ?? '')}>复制</button>
                      </>
                    ) : '-'}
                  </span>
                  <span className={styles.modelTestActions}>
                    <Button
                      size="xs"
                      variant="secondary"
                      onClick={() => void runModelTest(row.name)}
                      disabled={modelTestRunning}
                    >
                      测试
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
