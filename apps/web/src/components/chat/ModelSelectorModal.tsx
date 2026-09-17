import type { ProviderModelInfo,ProviderWithModels } from "@singulary/shared";
import { Check,Cpu, PieChart, Search, ShieldAlert, Sparkles, X } from "lucide-react";
import { useEffect,useState } from "react";

import { useAgentStore } from "@/stores/agent.store";

type ModelSelectorModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function ModelSelectorModal({ isOpen, onClose }: ModelSelectorModalProps) {
  const { providers, selectedProvider, selectedModel, isLoadingModels, fetchModels, selectModel } = useAgentStore();
  const [activeProviderName, setActiveProviderName] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (isOpen) {
      fetchModels();
    }
  }, [isOpen]);

  useEffect(() => {
    if (providers.length > 0 && !activeProviderName) {
      setActiveProviderName(selectedProvider || providers[0].provider);
    }
  }, [providers]);

  if (!isOpen) return null;

  const activeProvider = providers.find((p) => p.provider === activeProviderName);
  const activeModels = activeProvider ? activeProvider.models : [];

  // Filter models by search query
  const filteredModels = activeModels.filter((model) =>
    model.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelect = (provider: string, modelId: string) => {
    selectModel(provider, modelId);
    onClose();
  };

  // Quota breakdown helper
  const renderQuotaBar = (quota: { userUsed: number; userLimit: number | null; period: string | null }, isPersonal?: boolean) => {
    if (quota.userLimit === null) {
      return (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px] text-muted">
            <span>استخدام الحصة</span>
            <span className="font-mono text-ink font-semibold">{quota.userUsed.toLocaleString()} رمز</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-elevated overflow-hidden">
            <div className={`h-full ${isPersonal ? "bg-emerald-500" : "bg-indigo-500"} w-1/4 rounded-full`} />
          </div>
          <span className="text-[10px] text-dim">
            {isPersonal ? "مفتاحك الخاص (غير محدود)" : "حد غير محدود"}
          </span>
        </div>
      );
    }

    const pct = Math.min(100, (quota.userUsed / quota.userLimit) * 100);
    const color = pct > 90 ? "bg-rose-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500";

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>استخدام الحصة</span>
          <span className="font-mono text-ink font-semibold">
            {quota.userUsed.toLocaleString()} / {quota.userLimit.toLocaleString()} رمز
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-elevated overflow-hidden">
          <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between text-[9px] text-dim font-medium">
          <span>{pct.toFixed(0)}% مستخدم</span>
          <span className="capitalize">الفترة: {quota.period || "شهرية"}</span>
        </div>
      </div>
    );
  };

  const globalProviders = providers.filter(p => !p.isPersonal);
  const personalProviders = providers.filter(p => p.isPersonal);

  const renderProviderButton = (p: ProviderWithModels) => {
    const isActive = p.provider === activeProviderName;
    return (
      <button
        key={p.provider}
        onClick={() => {
          setActiveProviderName(p.provider);
          setSearchQuery("");
        }}
        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-semibold tracking-tight transition-all duration-150 outline-none ${
          isActive
            ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400"
            : "text-muted hover:bg-elevated hover:text-ink"
        }`}
      >
        <div className="flex items-center gap-2 truncate">
          <Cpu size={14} className="shrink-0" />
          <span className="capitalize truncate">{p.label}</span>
        </div>
        {p.quota && p.quota.userLimit && (
          <span className="rounded bg-elevated px-1 py-0.5 text-[9px] font-mono font-medium text-muted shrink-0 ml-2">
            Quota
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      {/* Modal Container */}
      <div className="flex h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-hairline bg-bg shadow-2xl transition-all duration-300">
        
        {/* Left Provider Sidebar */}
        <aside className="w-64 shrink-0 flex flex-col border-r border-hairline bg-surface py-4">
          <div className="px-4 mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted">Providers</h3>
            {isLoadingModels && <span className="h-1.5 w-1.5 animate-ping rounded-full bg-indigo-500" />}
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-1">
            {globalProviders.length > 0 && (
              <div className="mb-1 mt-2 px-3 text-[10px] font-bold uppercase tracking-wider text-muted/60">
                Global
              </div>
            )}
            {globalProviders.map(renderProviderButton)}

            {personalProviders.length > 0 && (
              <div className="mb-1 mt-4 px-3 text-[10px] font-bold uppercase tracking-wider text-muted/60">
                Personal
              </div>
            )}
            {personalProviders.map(renderProviderButton)}
            
            {providers.length === 0 && !isLoadingModels && (
              <div className="px-4 py-8 text-center text-xs text-dim">
                لا توجد مزودي نماذج لغة نشطين. يرجى إعداد واحد في إعدادات المنصة أولاً.
              </div>
            )}
          </div>

          {/* Quota overview inside left sidebar bottom */}
          {activeProvider?.quota && (
            <div className="border-t border-hairline mx-3 pt-3 mt-auto px-1">
              <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold uppercase tracking-wider text-muted">
                <PieChart size={13} className="text-indigo-500" />
                <span>حصة استخدامك</span>
              </div>
              {renderQuotaBar(
                { userUsed: activeProvider.quota.userUsed, userLimit: activeProvider.quota.userLimit, period: activeProvider.quota.period },
                activeProvider.isPersonal
              )}
            </div>
          )}
        </aside>

        {/* Right Models Panel */}
        <main className="flex-1 flex flex-col min-w-0 bg-bg">
          {/* Header */}
          <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
            <div>
              <h2 className="text-base font-bold tracking-tightish text-ink">Select LLM Model</h2>
              <p className="text-xs text-muted">Choose the model to power the workspace coding agent.</p>
            </div>
            <button
              onClick={onClose}
              className="focus-ring grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-elevated hover:text-ink outline-none"
            >
              <X size={18} />
            </button>
          </header>

          {/* Search bar */}
          <div className="px-6 py-3 border-b border-hairline/60 flex items-center gap-2 bg-surface/30">
            <Search size={15} className="text-dim" />
            <input
              type="text"
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-xs text-ink placeholder-dim outline-none"
            />
          </div>

          {/* Models list */}
          <div className="flex-1 overflow-y-auto p-6 space-y-2">
            {filteredModels.map((model) => {
              const isSelected = selectedProvider === activeProviderName && selectedModel === model.id;
              
              return (
                <button
                  key={model.id}
                  onClick={() => handleSelect(activeProviderName, model.id)}
                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition-all duration-200 outline-none ${
                    isSelected
                      ? "border-indigo-500/80 bg-indigo-50/20 dark:bg-indigo-950/20 shadow-sm"
                      : "border-hairline hover:border-muted/30 hover:bg-surface"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`grid h-8 w-8 place-items-center rounded-xl transition-colors ${
                      isSelected
                        ? "bg-indigo-500 text-white"
                        : "bg-elevated text-muted"
                    }`}>
                      <Sparkles size={15} />
                    </div>
                    <div>
                      <div className="text-xs font-bold tracking-tight text-ink font-mono">{model.id}</div>
                      <div className="text-[10px] text-muted">Owned by: {model.ownedBy || activeProviderName}</div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-white">
                      <Check size={12} strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}

            {filteredModels.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <ShieldAlert size={28} className="text-dim mb-2" />
                <h4 className="text-xs font-semibold text-ink">No models found</h4>
                <p className="text-[11px] text-muted mt-0.5">Try searching with a different name or query.</p>
              </div>
            )}
          </div>
        </main>

      </div>
    </div>
  );
}
