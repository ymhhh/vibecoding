import React, { useEffect, useState } from 'react';
import { ExecutorConfig, ExecutorProbe, ModelConfig } from '../types';
import { testOpenAPIConnection, fetchAvailableModels } from '../lib/llm';
import {
  APIProtocol,
  alignEndpointURLToProtocol,
  endpointExamples,
  endpointPlaceholder,
  protocolFromEndpointURL,
  resolveEndpointAlignment,
} from '../lib/apiProtocol';
import { Language, ThemeStyle, getTranslation } from '../lib/i18n';
import { THEME_CONFIGS } from '../lib/theme';
import { api } from '../lib/api';
import { ThemedSelect } from './ThemedSelect';
import {
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Key,
  Globe,
  Cpu,
  Sliders,
  Maximize2,
  Minimize2,
  RefreshCw,
} from 'lucide-react';

interface GlobalSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ModelConfig;
  onSave: (newConfig: ModelConfig) => void;
  themeStyle?: ThemeStyle;
  lang?: Language;
}

export const GlobalSettingsModal: React.FC<GlobalSettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
  themeStyle = 'light',
  lang = 'zh',
}) => {
  const themeConfig = THEME_CONFIGS[themeStyle] || THEME_CONFIGS.light;
  const isLight = themeConfig.isLight;
  const t = getTranslation(lang);

  const [openAIBaseUrl, setOpenAIBaseUrl] = useState(
    config.openAIBaseUrl || 'https://api.openai.com/v1/chat/completions'
  );
  const [openAIApiKey, setOpenAIApiKey] = useState('');
  const [openAIModel, setOpenAIModel] = useState(config.openAIModel || 'gpt-4o');
  const [temperature, setTemperature] = useState(config.temperature ?? 0.7);
  const [apiProtocol, setApiProtocol] = useState<APIProtocol>(
    config.apiProtocol === 'responses' ? 'responses' : 'chat_completions'
  );

  const setProtocolAligned = (next: APIProtocol) => {
    setApiProtocol(next);
    setOpenAIBaseUrl((prev) => alignEndpointURLToProtocol(prev, next));
  };

  const setBaseUrlAligned = (next: string) => {
    setOpenAIBaseUrl(next);
    const inferred = protocolFromEndpointURL(next);
    if (inferred) setApiProtocol(inferred);
  };


  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsMsg, setModelsMsg] = useState('');

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setModelsMsg('');
    const res = await fetchAvailableModels({
      openAIBaseUrl: openAIBaseUrl.trim(),
      // Blank key → server uses stored global key (same as test connection).
      openAIApiKey: openAIApiKey.trim(),
    });
    setFetchingModels(false);
    if (res.error) {
      setAvailableModels([]);
      setModelsMsg(t.fetchModelsFail.replace('{error}', res.error));
      return;
    }
    if (res.models.length === 0) {
      setAvailableModels([]);
      setModelsMsg(t.fetchModelsEmpty);
      return;
    }
    setAvailableModels(res.models);
    setModelsMsg(t.fetchModelsOk.replace('{count}', String(res.models.length)));
  };


  const baseUrlHint =
    apiProtocol === 'responses' ? t.baseUrlHintResponses : t.baseUrlHintChat;
  const urlExamples = endpointExamples(apiProtocol);

  const [execType, setExecType] = useState<'llm' | 'agent'>('llm');
  const [execPreset, setExecPreset] = useState('claude');
  const [maxHeal, setMaxHeal] = useState(2);
  const [customCommand, setCustomCommand] = useState('');
  const [customArgs, setCustomArgs] = useState('{prompt}');
  const [promptStdin, setPromptStdin] = useState(false);
  const [probes, setProbes] = useState<ExecutorProbe[]>([]);
  const [execMsg, setExecMsg] = useState('');
  const [maximized, setMaximized] = useState(false);

  const controlClass = `w-full px-3.5 py-2.5 border rounded-xl focus:outline-none transition-colors text-xs vc-control ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`;

  useEffect(() => {
    if (!isOpen) {
      setMaximized(false);
      return;
    }
    const savedProtocol: APIProtocol =
      config.apiProtocol === 'responses' ? 'responses' : 'chat_completions';
    const aligned = resolveEndpointAlignment(
      config.openAIBaseUrl || 'https://api.openai.com/v1/chat/completions',
      savedProtocol
    );
    setOpenAIBaseUrl(aligned.url);
    setApiProtocol(aligned.protocol);
    setOpenAIApiKey('');
    setOpenAIModel(config.openAIModel || 'gpt-4o');
    setTemperature(config.temperature ?? 0.7);
    setTestResult(null);
    setAvailableModels([]);
    setModelsMsg('');

    let cancelled = false;
    (async () => {
      try {
        const [cfg, listed] = await Promise.all([api.getExecutor(), api.listExecutors()]);
        if (cancelled) return;
        setExecType((cfg.type as 'llm' | 'agent') || 'llm');
        setExecPreset(cfg.preset || 'claude');
        setMaxHeal(cfg.maxHeal ?? 2);
        setCustomCommand(cfg.command || '');
        setCustomArgs((cfg.args || ['{prompt}']).join(' '));
        setPromptStdin(!!cfg.promptStdin);
        setProbes(listed.executors || []);
      } catch (e) {
        if (!cancelled) setExecMsg(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, config]);

  if (!isOpen) return null;

  const SelectField: React.FC<{
    value: string;
    onChange: (v: string) => void;
    children: React.ReactNode;
    className?: string;
  }> = ({ value, onChange, children, className }) => (
    <ThemedSelect
      value={value}
      onChange={(e) => onChange(e.target.value)}
      isLight={isLight}
      chevronClassName={themeConfig.textSecondary}
      className={`${controlClass} ${className || ''}`}
    >
      {children}
    </ThemedSelect>
  );

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    const res = await testOpenAPIConnection({
      openAIBaseUrl,
      openAIApiKey, // empty => server uses stored key
      openAIModel,
      apiProtocol,
    });
    setTesting(false);
    if (res.success) {
      setTestResult({
        success: true,
        message: t.testOpenAPIOk.replace('{message}', res.message || ''),
      });
    } else {
      setTestResult({
        success: false,
        message: t.testOpenAPIFail.replace('{error}', res.error || ''),
      });
    }
  };

  const handleSave = async () => {
    onSave({
      useCustomOpenAI: true,
      openAIBaseUrl: openAIBaseUrl.trim(),
      openAIApiKey: openAIApiKey.trim(), // empty keeps existing server-side key
      openAIModel: openAIModel.trim(),
      apiProtocol,
      temperature,
    });
    const execBody: ExecutorConfig = {
      type: execType,
      preset: execType === 'agent' ? execPreset : undefined,
      timeoutSec: 1800,
      maxHeal,
      command: execPreset === 'custom' ? customCommand.trim() : undefined,
      args:
        execPreset === 'custom'
          ? customArgs
              .trim()
              .split(/\s+/)
              .filter(Boolean)
          : undefined,
      promptStdin: execPreset === 'custom' ? promptStdin : undefined,
    };
    try {
      await api.putExecutor(execBody);
      setExecMsg(t.executorSaved);
      onClose();
    } catch (e) {
      setExecMsg(String(e));
    }
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md ${maximized ? 'p-0' : 'p-4'}`}>
      <div
        className={`border shadow-2xl overflow-hidden flex flex-col ${themeConfig.modalBg} ${
          maximized
            ? 'w-full h-full max-w-none max-h-none rounded-none'
            : 'w-full max-w-2xl max-h-[90vh] rounded-2xl'
        }`}
      >
        {/* Modal Header */}
        <div className={`p-6 border-b flex items-center justify-between ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-500">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h2 className={`text-xl font-bold flex items-center gap-2 ${themeConfig.textPrimary}`}>
                {t.llmSettingsTitle}
              </h2>
              <p className={`text-xs mt-0.5 ${themeConfig.textSecondary}`}>
                {t.llmSettingsSubtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMaximized((v) => !v)}
              title={maximized ? t.windowRestore : t.windowMaximize}
              className={`p-2 rounded-lg transition-colors ${themeConfig.textSecondary} hover:${themeConfig.textPrimary} hover:bg-black/5 dark:hover:bg-white/10`}
            >
              {maximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${themeConfig.textSecondary} hover:${themeConfig.textPrimary} hover:bg-black/5 dark:hover:bg-white/10`}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm">
          {/* Custom OpenAPI Form */}
          <div className="space-y-4 p-5 rounded-xl border border-indigo-500/30 bg-indigo-500/10">
            <div className="flex items-center gap-2 text-indigo-800 dark:text-indigo-300 font-medium pb-2 border-b border-indigo-500/20">
              <Globe className="w-4 h-4 text-indigo-500" />
              <span>{t.openAPIParamsConfig}</span>
            </div>

            {/* Full endpoint URL */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${themeConfig.textPrimary}`}>
                {t.baseUrlLabel}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={openAIBaseUrl}
                  onChange={(e) => setBaseUrlAligned(e.target.value)}
                  placeholder={endpointPlaceholder(apiProtocol)}
                  className={`w-full px-3.5 py-2.5 border rounded-xl focus:outline-none transition-colors font-mono text-xs ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                />
              </div>
              <p className={`text-[11px] mt-1 ${themeConfig.textMuted}`}>
                {baseUrlHint}
                <br />
                {t.baseUrlHint}
                <br />
                {urlExamples.map((ex, i) => (
                  <React.Fragment key={ex}>
                    {i > 0 ? ' | ' : null}
                    <code className="font-semibold">{ex}</code>
                  </React.Fragment>
                ))}
              </p>
            </div>

            {/* API protocol */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${themeConfig.textPrimary}`}>
                {t.apiProtocolLabel}
              </label>
              <div className="flex items-center gap-3">
                <SelectField value={apiProtocol} onChange={(v) => setProtocolAligned(v as APIProtocol)}>
                  <option value="chat_completions">Chat Completions</option>
                  <option value="responses">Responses</option>
                </SelectField>
              </div>
              <p className={`text-[11px] mt-1 ${themeConfig.textMuted}`}>{t.apiProtocolHint}</p>
            </div>

            {/* API Key */}
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${themeConfig.textPrimary}`}>
                {t.apiKeyLabel}
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={openAIApiKey}
                  onChange={(e) => setOpenAIApiKey(e.target.value)}
                  placeholder={
                    config.keyConfigured
                      ? t.keyConfiguredKeep.replace('{hint}', config.keyHint || '****')
                      : t.keyPlaceholderServer
                  }
                  className={`w-full px-3.5 py-2.5 border rounded-xl focus:outline-none transition-colors font-mono text-xs pr-10 ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                />
                <Key className={`w-4 h-4 absolute right-3 top-3 ${themeConfig.textMuted}`} />
              </div>
              {config.keyConfigured && (
                <p className={`text-[11px] mt-1 text-emerald-600 dark:text-emerald-300`}>
                  {t.keyStoredHint.replace('{hint}', config.keyHint || '****')}
                </p>
              )}
            </div>

            {/* Model Name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${themeConfig.textPrimary}`}>
                  {t.modelNameLabel}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    list="global-model-options"
                    value={openAIModel}
                    onChange={(e) => setOpenAIModel(e.target.value)}
                    placeholder="gpt-4o / deepseek-r1 / deepseek-chat"
                    className={`flex-1 min-w-0 px-3.5 py-2.5 border rounded-xl focus:outline-none transition-colors font-mono text-xs ${themeConfig.inputBg} ${themeConfig.inputText} ${themeConfig.inputBorder}`}
                  />
                  <datalist id="global-model-options">
                    {availableModels.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    onClick={handleFetchModels}
                    disabled={fetchingModels || !openAIBaseUrl.trim() || (!openAIApiKey.trim() && !config.keyConfigured)}
                    title={t.fetchModelsBtn}
                    className="shrink-0 px-3 py-2.5 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-xl text-xs font-semibold text-indigo-800 dark:text-indigo-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {fetchingModels ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5 text-indigo-500" />
                    )}
                    <span className="hidden sm:inline">{fetchingModels ? t.fetchModelsRunning : t.fetchModelsBtn}</span>
                  </button>
                </div>
                {modelsMsg && (
                  <p className={`text-[11px] mt-1 break-all ${availableModels.length > 0 ? 'text-emerald-600 dark:text-emerald-300' : themeConfig.textMuted}`}>
                    {modelsMsg}
                  </p>
                )}
              </div>

              {/* Temperature */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 flex items-center justify-between ${themeConfig.textPrimary}`}>
                  <span>{t.temperatureLabel}</span>
                  <span className="text-indigo-500 font-mono font-bold">{temperature}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-2 bg-slate-200 dark:bg-black/40"
                />
              </div>
            </div>

            {/* Test Connection Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing || !openAIBaseUrl || (!openAIApiKey && !config.keyConfigured)}
                className="px-4 py-2 bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 rounded-xl text-xs font-semibold text-indigo-800 dark:text-indigo-200 flex items-center gap-2 transition-colors disabled:opacity-50"
              >
                {testing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                    {t.testOpenAPIRunning}
                  </>
                ) : (
                  <>
                    <Sliders className="w-3.5 h-3.5 text-indigo-500" />
                    {t.testOpenAPI}
                  </>
                )}
              </button>

              {testResult && (
                <div
                  className={`mt-3 p-3 rounded-xl border text-xs flex items-start gap-2 ${
                    testResult.success
                      ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-800 dark:text-emerald-200'
                      : 'bg-rose-500/20 border-rose-500/30 text-rose-800 dark:text-rose-200'
                  }`}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  )}
                  <div className="break-all">{testResult.message}</div>
                </div>
              )}
            </div>
          </div>

          {/* Coding executor */}
          <div className="space-y-4 p-5 rounded-xl border border-violet-500/30 bg-violet-500/10">
            <div className="flex items-center gap-2 text-violet-800 dark:text-violet-300 font-medium pb-2 border-b border-violet-500/20">
              <Cpu className="w-4 h-4 text-violet-500" />
              <span>{t.codingExecutorTitle}</span>
            </div>
            <p className={`text-xs ${themeConfig.textSecondary}`}>{t.codingExecutorHint}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className={themeConfig.textPrimary}>{t.executorTypeLabel}</span>
                <SelectField value={execType} onChange={(v) => setExecType(v as 'llm' | 'agent')}>
                  <option value="llm">LLM (VibeBot)</option>
                  <option value="agent">Agent CLI</option>
                </SelectField>
              </label>
              <label className="block text-xs space-y-1">
                <span className={themeConfig.textPrimary}>{t.maxHealRounds}</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={maxHeal}
                  onChange={(e) => setMaxHeal(Number(e.target.value))}
                  className={controlClass}
                />
              </label>
            </div>
            {execType === 'agent' && (
              <div className="space-y-3">
                <label className="block text-xs space-y-1">
                  <span className={themeConfig.textPrimary}>Preset</span>
                  <SelectField value={execPreset} onChange={setExecPreset}>
                    {probes
                      .filter((p) => p.type === 'agent')
                      .map((p) => (
                        <option key={p.id} value={p.preset || p.id} disabled={!p.available && p.id !== 'custom'}>
                          {p.name}
                          {!p.available && p.id !== 'custom' ? t.executorNotInstalled : ''}
                        </option>
                      ))}
                  </SelectField>
                </label>
                {execPreset === 'custom' && (
                  <>
                    <label className="block text-xs space-y-1">
                      <span className={themeConfig.textPrimary}>Command</span>
                      <input
                        value={customCommand}
                        onChange={(e) => setCustomCommand(e.target.value)}
                        placeholder="my-agent"
                        className={`${controlClass} font-mono`}
                      />
                    </label>
                    <label className="block text-xs space-y-1">
                      <span className={themeConfig.textPrimary}>Args (space-separated, may include {'{prompt}'})</span>
                      <input
                        value={customArgs}
                        onChange={(e) => setCustomArgs(e.target.value)}
                        placeholder="--print {prompt}"
                        className={`${controlClass} font-mono`}
                      />
                    </label>
                    <label className={`flex items-center gap-2 text-xs ${themeConfig.textPrimary}`}>
                      <input type="checkbox" checked={promptStdin} onChange={(e) => setPromptStdin(e.target.checked)} />
                      Prompt via stdin
                    </label>
                  </>
                )}
                <div className="text-[11px] space-y-1 text-slate-500">
                  {probes
                    .filter((p) => p.type === 'agent' && !p.available && p.hint)
                    .map((p) => (
                      <div key={p.id}>
                        {p.name}: {p.hint}
                      </div>
                    ))}
                </div>
              </div>
            )}
            {execMsg && <div className="text-xs text-violet-700 dark:text-violet-300">{execMsg}</div>}
          </div>
        </div>

        {/* Modal Footer */}
        <div className={`p-4 border-t flex items-center justify-end gap-3 ${themeConfig.subtleBorder} ${themeConfig.modalHeaderBg}`}>
          <button
            onClick={onClose}
            className={`px-4 py-2 rounded-xl text-xs font-medium border transition-colors ${themeConfig.btnSecondary} ${themeConfig.btnSecondaryText}`}
          >
            {t.cancel}
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md transition-all"
          >
            {t.saveConfig}
          </button>
        </div>
      </div>
    </div>
  );
};

