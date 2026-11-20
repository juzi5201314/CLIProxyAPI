import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Coins,
  Search,
  Sparkles,
  Trash2,
  Edit3,
  ArrowRight,
  Database,
  ChevronsUpDown,
  Check,
  Tag,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { requestDB } from "@/api/management";
import { errMessage, type ModelPrice, type ModelPricesResponse } from "@/api/types";

interface ModelPricingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialModel?: string;
  observedModels?: string[];
}

type PriceUnit = "per_m" | "per_token";

export function ModelPricingDialog({
  open,
  onOpenChange,
  initialModel,
  observedModels = [],
}: ModelPricingDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<"configure" | "custom" | "catalog">("configure");
  const [modelName, setModelName] = useState(initialModel ?? "");
  const [unit, setUnit] = useState<PriceUnit>("per_m");

  // Input states in currently selected unit
  const [inputPrice, setInputPrice] = useState<string>("");
  const [outputPrice, setOutputPrice] = useState<string>("");
  const [cacheReadPrice, setCacheReadPrice] = useState<string>("");

  // Search filter states for dropdown and catalog
  const [prefillSearch, setPrefillSearch] = useState("");
  const [prefillOpen, setPrefillOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");

  // Query loaded prices catalog from backend
  const pricesQuery = useQuery<ModelPricesResponse>({
    queryKey: ["model-prices"],
    queryFn: () => requestDB.modelPrices(),
    enabled: open,
  });

  const catalog: Record<string, ModelPrice> = useMemo(
    () => pricesQuery.data?.prices ?? {},
    [pricesQuery.data?.prices]
  );
  const customOverrides: Record<string, ModelPrice> = useMemo(
    () => pricesQuery.data?.custom_prices ?? {},
    [pricesQuery.data?.custom_prices]
  );

  const customKeys = useMemo(() => Object.keys(customOverrides), [customOverrides]);

  // Sync initialModel when dialog opens or initialModel changes
  useEffect(() => {
    if (!open) return;
    const target = (initialModel ?? "").trim();
    setModelName(target);
    if (target) {
      setActiveTab("configure");
      const lower = target.toLowerCase();
      const existing = customOverrides[lower] ?? catalog[lower];
      if (existing) {
        setInputPrice(formatValueInUnit(existing.input_cost_per_token, unit));
        setOutputPrice(formatValueInUnit(existing.output_cost_per_token, unit));
        setCacheReadPrice(formatValueInUnit(existing.cache_read_cost_per_token ?? 0, unit));
      } else {
        setInputPrice("");
        setOutputPrice("");
        setCacheReadPrice("");
      }
    }
  }, [open, initialModel, customOverrides, catalog]);

  // Convert raw per-token price to display string in active unit
  const formatValueInUnit = (perToken: number | undefined, targetUnit: PriceUnit): string => {
    if (perToken === undefined || perToken === null || Number.isNaN(perToken)) return "";
    if (targetUnit === "per_m") {
      const perM = perToken * 1_000_000;
      // Truncate to reasonable decimals
      return Number(perM.toFixed(6)).toString();
    }
    return Number(perToken.toFixed(10)).toString();
  };

  // Convert active unit value to raw per-token number
  const parseValueToPerToken = (valStr: string, currentUnit: PriceUnit): number => {
    const parsed = Number.parseFloat(valStr.trim());
    if (Number.isNaN(parsed) || parsed < 0) return 0;
    if (currentUnit === "per_m") {
      return parsed / 1_000_000;
    }
    return parsed;
  };

  // Prefill the form with a given ModelPrice
  const applyPriceToForm = (price: ModelPrice, sourceModel?: string) => {
    setInputPrice(formatValueInUnit(price.input_cost_per_token, unit));
    setOutputPrice(formatValueInUnit(price.output_cost_per_token, unit));
    setCacheReadPrice(
      formatValueInUnit(price.cache_read_cost_per_token ?? 0, unit)
    );
    if (sourceModel) {
      toast.info(t("dashboard.pricing.prefilledFrom", { model: sourceModel, defaultValue: `已从 ${sourceModel} 填入单价` }));
    }
  };

  // Smart fuzzy matching helper to find a cached price for target model
  const smartMatch = useMemo(() => {
    const raw = modelName.trim().toLowerCase();
    if (!raw || Object.keys(catalog).length === 0) return null;

    // 1. Exact match
    if (catalog[raw]) {
      return { key: raw, price: catalog[raw] };
    }

    // 2. Stripped provider prefix
    const noPrefix = raw.includes("/") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
    if (catalog[noPrefix]) {
      return { key: noPrefix, price: catalog[noPrefix] };
    }

    // 3. Stripped date suffix
    const noDate = noPrefix.replace(/[-_](20\d{2}[-_]?\d{2}[-_]?\d{2}|[01]\d[0-3]\d)$/, "");
    if (catalog[noDate]) {
      return { key: noDate, price: catalog[noDate] };
    }

    // 4. Stem search
    for (const [k, p] of Object.entries(catalog)) {
      const kNorm = k.includes("/") ? k.slice(k.lastIndexOf("/") + 1) : k;
      if (kNorm === noPrefix || kNorm === noDate) {
        return { key: k, price: p };
      }
    }

    return null;
  }, [modelName, catalog]);

  // Filtered catalog for prefill selector
  const filteredPrefillOptions = useMemo(() => {
    const term = prefillSearch.trim().toLowerCase();
    const entries = Object.entries(catalog) as [string, ModelPrice][];
    if (!term) return entries.slice(0, 50);
    return entries.filter(([k]) => k.toLowerCase().includes(term)).slice(0, 50);
  }, [catalog, prefillSearch]);

  // Filtered catalog for catalog browser tab
  const filteredCatalogEntries = useMemo(() => {
    const term = catalogSearch.trim().toLowerCase();
    const entries = Object.entries(catalog) as [string, ModelPrice][];
    if (!term) return entries.slice(0, 100);
    return entries.filter(([k]) => k.toLowerCase().includes(term)).slice(0, 100);
  }, [catalog, catalogSearch]);

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedModel = modelName.trim();
      if (!trimmedModel) {
        throw new Error(t("dashboard.pricing.errModelRequired", "请输入模型 ID"));
      }

      const inputTok = parseValueToPerToken(inputPrice, unit);
      const outputTok = parseValueToPerToken(outputPrice, unit);
      const cacheTok = parseValueToPerToken(cacheReadPrice, unit);

      return requestDB.setModelPrice({
        model: trimmedModel,
        input_cost_per_token: inputTok,
        output_cost_per_token: outputTok,
        cache_read_cost_per_token: cacheTok,
      });
    },
    onSuccess: () => {
      toast.success(t("dashboard.pricing.saved", "模型价格已保存并生效"));
      void queryClient.invalidateQueries({ queryKey: ["model-prices"] });
      void queryClient.invalidateQueries({ queryKey: ["request-db-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["request-db-timeseries"] });
      void queryClient.invalidateQueries({ queryKey: ["request-db-breakdown"] });
      void queryClient.invalidateQueries({ queryKey: ["request-db-records"] });
    },
    onError: (err) => {
      toast.error(errMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (target: string) => {
      return requestDB.deleteModelPrice(target);
    },
    onSuccess: () => {
      toast.success(t("dashboard.pricing.deleted", "已删除自定义价格并恢复默认"));
      void queryClient.invalidateQueries({ queryKey: ["model-prices"] });
      void queryClient.invalidateQueries({ queryKey: ["request-db-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["request-db-timeseries"] });
      void queryClient.invalidateQueries({ queryKey: ["request-db-breakdown"] });
      void queryClient.invalidateQueries({ queryKey: ["request-db-records"] });
    },
    onError: (err) => {
      toast.error(errMessage(err));
    },
  });

  // Switch units without losing values
  const handleUnitChange = (newUnit: PriceUnit) => {
    if (newUnit === unit) return;
    const inTok = parseValueToPerToken(inputPrice, unit);
    const outTok = parseValueToPerToken(outputPrice, unit);
    const cacheTok = parseValueToPerToken(cacheReadPrice, unit);

    setUnit(newUnit);
    setInputPrice(formatValueInUnit(inTok, newUnit));
    setOutputPrice(formatValueInUnit(outTok, newUnit));
    setCacheReadPrice(formatValueInUnit(cacheTok, newUnit));
  };

  const isCurrentModelCustom = Boolean(customOverrides[modelName.trim().toLowerCase()]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-3xl overflow-hidden rounded-2xl border border-border/80 bg-background/95 backdrop-blur-md p-6 shadow-2xl">
        <DialogHeader className="space-y-1.5 pb-2 border-b border-border/50">
          <div className="flex items-center gap-2 text-primary">
            <Coins className="size-5 text-amber-500" />
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {t("dashboard.pricing.title", "模型定价管理")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {t(
              "dashboard.pricing.subtitle",
              "手动配置模型 Token 单价。当外部来源未收录某模型导致单价为 $0 时，可在此自定义单价，并直接从现有缓存模型填入。"
            )}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as typeof activeTab)}
          className="mt-3 w-full"
        >
          <TabsList className="grid w-full grid-cols-3 rounded-xl bg-muted/60 p-1">
            <TabsTrigger value="configure" className="text-xs gap-1.5">
              <Edit3 className="size-3.5" />
              <span>{t("dashboard.pricing.tabSet", "单价配置")}</span>
            </TabsTrigger>
            <TabsTrigger value="custom" className="text-xs gap-1.5">
              <Tag className="size-3.5" />
              <span>{t("dashboard.pricing.tabCustom", "自定义覆盖")}</span>
              {customKeys.length > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 size-5 p-0 justify-center text-[10px] bg-primary/15 text-primary"
                >
                  {customKeys.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="catalog" className="text-xs gap-1.5">
              <Database className="size-3.5" />
              <span>{t("dashboard.pricing.tabCatalog", "价格缓存库")}</span>
              {pricesQuery.data?.count ? (
                <span className="text-[10px] text-muted-foreground">
                  ({pricesQuery.data.count})
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: Configure Price */}
          <TabsContent value="configure" className="space-y-4 pt-3 focus-visible:outline-hidden">
            {/* Model Name Input & Suggestions */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span>{t("dashboard.pricing.modelName", "模型 ID")}</span>
                {isCurrentModelCustom && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500 bg-amber-500/10">
                    {t("dashboard.pricing.customBadge", "已生效自定义覆盖")}
                  </Badge>
                )}
              </label>
              <Input
                placeholder={t("dashboard.pricing.modelPlaceholder", "输入模型 ID，如 custom-gpt-4o、qwen-turbo...")}
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                className="font-mono text-sm h-9.5 rounded-xl bg-card/60"
              />

              {/* Observed model chips for fast selection */}
              {observedModels.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-muted-foreground mr-1">
                    {t("dashboard.pricing.observedSuggestions", "近期调用模型:")}
                  </span>
                  {observedModels.slice(0, 6).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setModelName(m)}
                      className={`cursor-pointer font-mono text-[10px] px-2 py-0.5 rounded-md border transition-all ${
                        modelName === m
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* PREFILL SECTION: "并且可以从现有缓存中直接填入" */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                  <Sparkles className="size-3.5 text-amber-500" />
                  <span>{t("dashboard.pricing.prefillTitle", "从现有缓存中直接填入")}</span>
                </div>
                {/* Reference Model Popover Selector */}
                <Popover open={prefillOpen} onOpenChange={setPrefillOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1 border-primary/30 bg-background/80 hover:bg-primary/10 cursor-pointer"
                    >
                      <span>{t("dashboard.pricing.prefillSelect", "选择缓存模型快速填入单价...")}</span>
                      <ChevronsUpDown className="size-3 opacity-60" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-2 rounded-xl" align="end">
                    <div className="space-y-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                        <Input
                          placeholder={t("dashboard.pricing.prefillSearch", "搜索缓存模型...")}
                          value={prefillSearch}
                          onChange={(e) => setPrefillSearch(e.target.value)}
                          className="h-8 pl-8 text-xs rounded-lg"
                        />
                      </div>
                      <ScrollArea className="h-48">
                        <div className="space-y-0.5 pr-2">
                          {filteredPrefillOptions.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">无匹配模型</p>
                          ) : (
                            filteredPrefillOptions.map(([key, price]) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => {
                                  applyPriceToForm(price, key);
                                  setPrefillOpen(false);
                                }}
                                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-left text-xs hover:bg-primary/10 transition-colors cursor-pointer group"
                              >
                                <span className="font-mono text-[11px] truncate max-w-44 text-foreground group-hover:text-primary">
                                  {key}
                                </span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  ${(price.input_cost_per_token * 1e6).toFixed(2)} / ${(price.output_cost_per_token * 1e6).toFixed(2)}
                                </span>
                              </button>
                            ))
                          )}
                        </div>
                      </ScrollArea>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Smart Match Banner */}
              {smartMatch ? (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-background/80 px-3 py-2 border border-primary/15">
                  <div className="min-w-0 flex items-center gap-2">
                    <Tag className="size-3.5 text-sky-500 shrink-0" />
                    <span className="text-xs text-muted-foreground truncate">
                      {t("dashboard.pricing.prefillDetected", {
                        model: smartMatch.key,
                        defaultValue: `检测到匹配缓存模型: ${smartMatch.key}`,
                      })}
                      <span className="font-mono font-medium text-foreground ml-1.5">
                        (入: ${(smartMatch.price.input_cost_per_token * 1e6).toFixed(3)}/1M, 出: ${(smartMatch.price.output_cost_per_token * 1e6).toFixed(3)}/1M)
                      </span>
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6.5 px-2.5 text-xs gap-1 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-2xs"
                    onClick={() => applyPriceToForm(smartMatch.price, smartMatch.key)}
                  >
                    <Check className="size-3" />
                    <span>{t("dashboard.pricing.prefillAction", "填入此价格")}</span>
                  </Button>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  可点击右上角从 4,000+ 款已知模型价格库中复制，或在上方输入模型名称自动检测关联单价。
                </p>
              )}
            </div>

            {/* Pricing Input Fields */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  {t("dashboard.pricing.unit", "单价配置")}
                </span>
                {/* Unit Switcher */}
                <div className="flex items-center rounded-lg bg-muted p-0.5 border border-border/50 text-[11px]">
                  <button
                    type="button"
                    onClick={() => handleUnitChange("per_m")}
                    className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                      unit === "per_m"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("dashboard.pricing.unitPerM", "$ / 1M Tokens (推荐)")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUnitChange("per_token")}
                    className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                      unit === "per_token"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t("dashboard.pricing.unitPerToken", "$ / Token")}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Input Tokens Cost */}
                <div className="space-y-1.5 rounded-xl border border-border/60 bg-card/40 p-3">
                  <label className="text-xs font-medium text-foreground flex items-center justify-between">
                    <span>{t("dashboard.pricing.inputPrice", "输入单价 (Input)")}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {unit === "per_m" ? "$/1M" : "$/token"}
                    </span>
                  </label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="如 2.50"
                    value={inputPrice}
                    onChange={(e) => setInputPrice(e.target.value)}
                    className="font-mono text-sm h-8.5 rounded-lg"
                  />
                  {inputPrice && (
                    <p className="text-[10px] font-mono text-muted-foreground truncate">
                      ≈ ${parseValueToPerToken(inputPrice, unit).toFixed(8)} / token
                    </p>
                  )}
                </div>

                {/* Output Tokens Cost */}
                <div className="space-y-1.5 rounded-xl border border-border/60 bg-card/40 p-3">
                  <label className="text-xs font-medium text-foreground flex items-center justify-between">
                    <span>{t("dashboard.pricing.outputPrice", "输出单价 (Output)")}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {unit === "per_m" ? "$/1M" : "$/token"}
                    </span>
                  </label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="如 10.00"
                    value={outputPrice}
                    onChange={(e) => setOutputPrice(e.target.value)}
                    className="font-mono text-sm h-8.5 rounded-lg"
                  />
                  {outputPrice && (
                    <p className="text-[10px] font-mono text-muted-foreground truncate">
                      ≈ ${parseValueToPerToken(outputPrice, unit).toFixed(8)} / token
                    </p>
                  )}
                </div>

                {/* Cache Read Tokens Cost */}
                <div className="space-y-1.5 rounded-xl border border-border/60 bg-card/40 p-3">
                  <label className="text-xs font-medium text-foreground flex items-center justify-between">
                    <span>{t("dashboard.pricing.cacheReadPrice", "缓存单价 (Cache)")}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {unit === "per_m" ? "$/1M" : "$/token"}
                    </span>
                  </label>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="如 1.25"
                    value={cacheReadPrice}
                    onChange={(e) => setCacheReadPrice(e.target.value)}
                    className="font-mono text-sm h-8.5 rounded-lg"
                  />
                  {cacheReadPrice && (
                    <p className="text-[10px] font-mono text-muted-foreground truncate">
                      ≈ ${parseValueToPerToken(cacheReadPrice, unit).toFixed(8)} / token
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Actions Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              {isCurrentModelCustom ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 gap-1.5 text-xs cursor-pointer"
                  onClick={() => deleteMutation.mutate(modelName.trim())}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="size-3.5" />
                  <span>{deleteMutation.isPending ? t("dashboard.pricing.deleting", "删除中...") : t("dashboard.pricing.delete", "删除自定义覆盖")}</span>
                </Button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-xl text-xs cursor-pointer"
                  onClick={() => onOpenChange(false)}
                >
                  {t("common.cancel", "取消")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="rounded-xl text-xs gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer shadow-sm"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !modelName.trim()}
                >
                  <Coins className="size-3.5" />
                  <span>{saveMutation.isPending ? t("dashboard.pricing.saving", "保存中...") : t("dashboard.pricing.save", "保存价格配置")}</span>
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: Custom Price Overrides List */}
          <TabsContent value="custom" className="pt-2 focus-visible:outline-hidden">
            {customKeys.length === 0 ? (
              <div className="py-12 text-center space-y-2 rounded-xl border border-dashed border-border/70 my-2">
                <Tag className="size-8 mx-auto text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  {t(
                    "dashboard.pricing.emptyCustom",
                    "暂无手动设置的模型价格，所有模型价格均遵循外部来源或内置种子配置。"
                  )}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs mt-2"
                  onClick={() => setActiveTab("configure")}
                >
                  {t("dashboard.pricing.configurePrice", "前往配置模型价格")}
                </Button>
              </div>
            ) : (
              <ScrollArea className="h-80 rounded-xl border border-border/60">
                <Table>
                  <TableHeader className="bg-muted/40 sticky top-0 backdrop-blur-sm z-10">
                    <TableRow>
                      <TableHead className="text-xs">{t("dashboard.pricing.modelName", "模型 ID")}</TableHead>
                      <TableHead className="text-xs text-right">输入 ($/1M)</TableHead>
                      <TableHead className="text-xs text-right">输出 ($/1M)</TableHead>
                      <TableHead className="text-xs text-right">缓存读取 ($/1M)</TableHead>
                      <TableHead className="text-xs text-right w-24">{t("common.actions", "操作")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customKeys.map((key) => {
                      const p = customOverrides[key];
                      if (!p) return null;
                      return (
                        <TableRow key={key} className="text-xs">
                          <TableCell className="font-mono font-medium text-foreground">
                            {key}
                          </TableCell>
                          <TableCell className="font-mono text-right tabular-nums text-sky-600 dark:text-sky-400">
                            ${(p.input_cost_per_token * 1e6).toFixed(4)}
                          </TableCell>
                          <TableCell className="font-mono text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                            ${(p.output_cost_per_token * 1e6).toFixed(4)}
                          </TableCell>
                          <TableCell className="font-mono text-right tabular-nums text-muted-foreground">
                            ${((p.cache_read_cost_per_token ?? 0) * 1e6).toFixed(4)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-muted-foreground hover:text-primary cursor-pointer"
                                onClick={() => {
                                  setModelName(key);
                                  applyPriceToForm(p);
                                  setActiveTab("configure");
                                }}
                                title="编辑"
                              >
                                <Edit3 className="size-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-7 text-muted-foreground hover:text-rose-500 cursor-pointer"
                                onClick={() => deleteMutation.mutate(key)}
                                title="恢复默认"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </TabsContent>

          {/* TAB 3: Price Catalog Browser */}
          <TabsContent value="catalog" className="space-y-2 pt-2 focus-visible:outline-hidden">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                placeholder={t("dashboard.pricing.searchCatalog", {
                  count: pricesQuery.data?.count ?? 0,
                  defaultValue: `搜索全部缓存模型 (共 ${pricesQuery.data?.count ?? 0} 款)...`,
                })}
                value={catalogSearch}
                onChange={(e) => setCatalogSearch(e.target.value)}
                className="h-8.5 pl-8 text-xs rounded-xl"
              />
            </div>

            <ScrollArea className="h-76 rounded-xl border border-border/60">
              <Table>
                <TableHeader className="bg-muted/40 sticky top-0 backdrop-blur-sm z-10">
                  <TableRow>
                    <TableHead className="text-xs">模型 ID</TableHead>
                    <TableHead className="text-xs text-right">输入 ($/1M)</TableHead>
                    <TableHead className="text-xs text-right">输出 ($/1M)</TableHead>
                    <TableHead className="text-xs text-right">缓存 ($/1M)</TableHead>
                    <TableHead className="text-xs text-right w-24">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCatalogEntries.map(([key, p]) => (
                    <TableRow key={key} className="text-xs hover:bg-muted/40">
                      <TableCell className="font-mono text-foreground font-medium truncate max-w-56">
                        {key}
                      </TableCell>
                      <TableCell className="font-mono text-right tabular-nums text-muted-foreground">
                        ${(p.input_cost_per_token * 1e6).toFixed(3)}
                      </TableCell>
                      <TableCell className="font-mono text-right tabular-nums text-muted-foreground">
                        ${(p.output_cost_per_token * 1e6).toFixed(3)}
                      </TableCell>
                      <TableCell className="font-mono text-right tabular-nums text-muted-foreground">
                        ${((p.cache_read_cost_per_token ?? 0) * 1e6).toFixed(3)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6.5 text-[11px] px-2 text-primary hover:bg-primary/10 gap-1 cursor-pointer"
                          onClick={() => {
                            setModelName(key);
                            applyPriceToForm(p, key);
                            setActiveTab("configure");
                          }}
                        >
                          <span>{t("dashboard.pricing.useTemplate", "以此为模板")}</span>
                          <ArrowRight className="size-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
