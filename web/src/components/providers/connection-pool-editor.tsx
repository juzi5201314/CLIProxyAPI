import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { NumberValue } from "./model-editor";
import { cn } from "@/lib/utils";

export interface ConnectionPoolConfig {
  enabled?: boolean;
  "idle-conn-timeout"?: string;
  "max-idle-conns-per-host"?: number;
}

/**
 * Reports whether an API-key ProxyConnectionPoolConfig enables pooling.
 * Presence of the connection-pool block is the opt-in, so omitted enabled means true.
 */
export function isProxyConnectionPoolEnabled(pool?: ConnectionPoolConfig | null): boolean {
  if (!pool || typeof pool !== "object") return false;
  return pool.enabled !== false;
}

/**
 * Reports whether an AntigravityConnectionPoolConfig enables pooling.
 * Antigravity defaults to disabled unless enabled is explicitly true.
 */
export function isAntigravityConnectionPoolEnabled(pool?: ConnectionPoolConfig | null): boolean {
  if (!pool || typeof pool !== "object") return false;
  return pool.enabled === true;
}

function cleanPoolFields(pool: ConnectionPoolConfig): ConnectionPoolConfig {
  const out: ConnectionPoolConfig = {};
  if (typeof pool.enabled === "boolean") {
    out.enabled = pool.enabled;
  }
  const idle = typeof pool["idle-conn-timeout"] === "string" ? pool["idle-conn-timeout"].trim() : "";
  if (idle) {
    out["idle-conn-timeout"] = idle;
  }
  if (typeof pool["max-idle-conns-per-host"] === "number" && Number.isFinite(pool["max-idle-conns-per-host"])) {
    out["max-idle-conns-per-host"] = pool["max-idle-conns-per-host"];
  }
  return out;
}

/** Shared connection-pool toggle + optional idle timeout and max idle conns inputs. */
export function ConnectionPoolEditor({
  value,
  onChange,
  variant = "proxy",
}: {
  value?: ConnectionPoolConfig;
  onChange: (next: ConnectionPoolConfig | undefined) => void;
  variant?: "proxy" | "antigravity";
}) {
  const { t } = useTranslation();
  const isAntigravity = variant === "antigravity";
  const enabled = isAntigravity
    ? isAntigravityConnectionPoolEnabled(value)
    : isProxyConnectionPoolEnabled(value);

  const idleTimeout = typeof value?.["idle-conn-timeout"] === "string" ? value["idle-conn-timeout"] : "";
  const maxIdle = typeof value?.["max-idle-conns-per-host"] === "number" ? value["max-idle-conns-per-host"] : undefined;

  const defaultIdlePlaceholder = isAntigravity ? "30s" : "300s";

  const toggle = (nextEnabled: boolean) => {
    if (!nextEnabled) {
      if (isAntigravity) {
        const cleaned = cleanPoolFields({ ...value, enabled: false });
        onChange(cleaned);
      } else {
        onChange(undefined);
      }
      return;
    }
    const next = cleanPoolFields({
      ...value,
      enabled: true,
    });
    onChange(next);
  };

  const patchPool = (changes: Partial<ConnectionPoolConfig>) => {
    const next = cleanPoolFields({
      ...value,
      enabled: true,
      ...changes,
    });
    onChange(next);
  };

  return (
    <div className="space-y-3 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm">{t("providers.connectionPool")}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {isAntigravity ? t("providers.antigravityConnectionPoolHint") : t("providers.connectionPoolHint")}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={toggle} />
      </div>

      {enabled ? (
        <div className="bg-secondary/30 grid grid-cols-1 gap-3 rounded-xl border border-border/50 p-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("providers.connectionPoolIdleTimeout")}</Label>
            <Input
              className="h-8 font-mono text-xs"
              value={idleTimeout}
              placeholder={defaultIdlePlaceholder}
              onChange={(event) => patchPool({ "idle-conn-timeout": event.target.value })}
            />
            <p className="text-muted-foreground text-[11px] leading-snug">
              {isAntigravity
                ? t("providers.antigravityConnectionPoolIdleTimeoutHint")
                : t("providers.connectionPoolIdleTimeoutHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("providers.connectionPoolMaxIdle")}</Label>
            <NumberValue
              className="h-8"
              value={maxIdle}
              placeholder="2"
              onChange={(val) => patchPool({ "max-idle-conns-per-host": val })}
            />
            <p className="text-muted-foreground text-[11px] leading-snug">
              {t("providers.connectionPoolMaxIdleHint")}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Per-key override popover for OpenAI-compatible API key rows (inherit / enabled / disabled). */
export function CompatKeyConnectionPoolPopover({
  value,
  groupPool,
  onChange,
}: {
  value?: ConnectionPoolConfig;
  groupPool?: ConnectionPoolConfig;
  onChange: (next: ConnectionPoolConfig | undefined) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const mode: "inherit" | "enabled" | "disabled" =
    value === undefined
      ? "inherit"
      : value.enabled === false
        ? "disabled"
        : "enabled";

  const groupEnabled = isProxyConnectionPoolEnabled(groupPool);
  const idlePlaceholder =
    (typeof groupPool?.["idle-conn-timeout"] === "string" && groupPool["idle-conn-timeout"].trim()) || "300s";
  const maxPlaceholder =
    typeof groupPool?.["max-idle-conns-per-host"] === "number"
      ? String(groupPool["max-idle-conns-per-host"])
      : "2";

  const setMode = (nextMode: "inherit" | "enabled" | "disabled") => {
    if (nextMode === "inherit") {
      onChange(undefined);
      return;
    }
    if (nextMode === "disabled") {
      onChange({ enabled: false });
      return;
    }
    onChange(cleanPoolFields({ ...value, enabled: true }));
  };

  const patchOverride = (changes: Partial<ConnectionPoolConfig>) => {
    onChange(cleanPoolFields({ ...value, enabled: true, ...changes }));
  };

  const tooltipText =
    mode === "enabled"
      ? t("providers.connectionPoolKeyEnabled")
      : mode === "disabled"
        ? t("providers.connectionPoolKeyDisabled")
        : groupEnabled
          ? t("providers.connectionPoolKeyInheritOn")
          : t("providers.connectionPoolKeyInheritOff");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "size-7",
            mode === "enabled" && "text-emerald-600 dark:text-emerald-400",
            mode === "disabled" && "text-amber-600 dark:text-amber-400",
            mode === "inherit" && groupEnabled && "text-sky-600/80 dark:text-sky-400/80",
          )}
          title={tooltipText}
        >
          <PlugZap className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3 p-3">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold">{t("providers.connectionPoolKeyOverride")}</p>
          <p className="text-muted-foreground text-[11px] leading-snug">{tooltipText}</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">{t("providers.connectionPoolMode")}</Label>
          <Select value={mode} onValueChange={(val) => setMode(val as "inherit" | "enabled" | "disabled")}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">{t("providers.connectionPoolFollowGroup")}</SelectItem>
              <SelectItem value="enabled">{t("providers.triOn")}</SelectItem>
              <SelectItem value="disabled">{t("providers.triOff")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {mode === "enabled" ? (
          <div className="space-y-2.5 border-t border-border/50 pt-2.5">
            <div className="space-y-1">
              <Label className="text-xs">{t("providers.connectionPoolIdleTimeout")}</Label>
              <Input
                className="h-8 font-mono text-xs"
                value={typeof value?.["idle-conn-timeout"] === "string" ? value["idle-conn-timeout"] : ""}
                placeholder={idlePlaceholder}
                onChange={(event) => patchOverride({ "idle-conn-timeout": event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("providers.connectionPoolMaxIdle")}</Label>
              <NumberValue
                className="h-8"
                value={typeof value?.["max-idle-conns-per-host"] === "number" ? value["max-idle-conns-per-host"] : undefined}
                placeholder={maxPlaceholder}
                onChange={(val) => patchOverride({ "max-idle-conns-per-host": val })}
              />
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
