import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  BarChart3,
  Blocks,
  Coins,
  Database,
  FileCode2,
  KeyRound,
  Languages,
  Layers,
  LayoutDashboard,
  LogOut,
  Moon,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sun,
  Terminal,
  UserCheck,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useAuthStore } from "@/stores/auth";
import { usePrefsStore } from "@/stores/prefs";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const clearAuth = useAuthStore((state) => state.clear);
  const locale = usePrefsStore((state) => state.locale);
  const setLocale = usePrefsStore((state) => state.setLocale);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && (e.target as HTMLElement).tagName !== "INPUT" && (e.target as HTMLElement).tagName !== "TEXTAREA")) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  const runCommand = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("common.search") + " (⌘K)..."} />
      <CommandList>
        <CommandEmpty>{t("common.empty")}</CommandEmpty>

        <CommandGroup heading={t("nav.observability")}>
          <CommandItem
            keywords={["dashboard", "home", "监控仪表盘", "大盘", "概览", "/"]}
            onSelect={() => runCommand(() => navigate("/"))}
          >
            <LayoutDashboard className="mr-2 size-4" />
            <span>{t("nav.dashboard")}</span>
          </CommandItem>
          <CommandItem
            keywords={["playground", "chat", "debug", "test", "接口调试", "调试", "/playground"]}
            onSelect={() => runCommand(() => navigate("/playground"))}
          >
            <Terminal className="mr-2 size-4 text-blue-500" />
            <span>{t("playground.title") || "接口调试"}</span>
          </CommandItem>
          <CommandItem
            keywords={["request-logs", "requests", "access", "请求日志", "调用记录", "/request-logs"]}
            onSelect={() => runCommand(() => navigate("/request-logs"))}
          >
            <Activity className="mr-2 size-4" />
            <span>{t("nav.requestLogs")}</span>
          </CommandItem>
          <CommandItem
            keywords={["request-db", "database", "sqlite", "storage", "日志存储管理", "请求数据库", "/request-db"]}
            onSelect={() => runCommand(() => navigate("/request-db"))}
          >
            <Database className="mr-2 size-4" />
            <span>{t("nav.requestDb")}</span>
          </CommandItem>
          <CommandItem
            keywords={["logs", "file", "system-logs", "运行日志", "日志", "/logs"]}
            onSelect={() => runCommand(() => navigate("/logs"))}
          >
            <ScrollText className="mr-2 size-4" />
            <span>{t("nav.logs")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("nav.providers")}>
          <CommandItem
            keywords={["providers", "models", "upstream", "供应商管理", "模型", "/providers"]}
            onSelect={() => runCommand(() => navigate("/providers"))}
          >
            <BarChart3 className="mr-2 size-4" />
            <span>{t("nav.providersItem")}</span>
          </CommandItem>
          <CommandItem
            keywords={["auth-files", "auth", "credentials", "keys", "tokens", "凭据文件", "凭据", "/auth-files"]}
            onSelect={() => runCommand(() => navigate("/auth-files"))}
          >
            <KeyRound className="mr-2 size-4" />
            <span>{t("nav.authFiles")}</span>
          </CommandItem>
          <CommandItem
            keywords={["oauth", "authorize", "login", "OAuth 授权", "授权", "/oauth"]}
            onSelect={() => runCommand(() => navigate("/oauth"))}
          >
            <UserCheck className="mr-2 size-4" />
            <span>{t("nav.oauth")}</span>
          </CommandItem>
          <CommandItem
            keywords={["quota", "balance", "usage", "limits", "配额调度", "配额", "/quota"]}
            onSelect={() => runCommand(() => navigate("/quota"))}
          >
            <Coins className="mr-2 size-4" />
            <span>{t("nav.quota")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("nav.management")}>
          <CommandItem
            keywords={["config", "settings", "系统配置", "配置", "/config"]}
            onSelect={() => runCommand(() => navigate("/config"))}
          >
            <Settings2 className="mr-2 size-4" />
            <span>{t("nav.config")}</span>
          </CommandItem>
          <CommandItem
            keywords={["yaml", "raw-config", "editor", "YAML 配置编辑", "配置编辑", "/config?tab=yaml"]}
            onSelect={() => runCommand(() => navigate("/config?tab=yaml"))}
          >
            <FileCode2 className="mr-2 size-4" />
            <span>{t("nav.yamlConfig", "YAML 配置编辑")}</span>
          </CommandItem>
          <CommandItem
            keywords={["plugins", "extensions", "store", "插件扩展", "插件", "/plugins"]}
            onSelect={() => runCommand(() => navigate("/plugins"))}
          >
            <Blocks className="mr-2 size-4" />
            <span>{t("nav.plugins")}</span>
          </CommandItem>
          <CommandItem
            keywords={["plugin-pages", "plugin-config", "插件配置", "插件页面", "/plugin-pages"]}
            onSelect={() => runCommand(() => navigate("/plugin-pages"))}
          >
            <Layers className="mr-2 size-4" />
            <span>{t("nav.pluginPages")}</span>
          </CommandItem>
          <CommandItem
            keywords={["system", "health", "status", "info", "系统信息", "系统", "/system"]}
            onSelect={() => runCommand(() => navigate("/system"))}
          >
            <ShieldCheck className="mr-2 size-4" />
            <span>{t("nav.systemItem")}</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={t("common.actions")}>
          <CommandItem
            keywords={["theme", "dark", "light", "mode", "主题", "暗色", "浅色", "夜间模式"]}
            onSelect={() => runCommand(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}
          >
            {resolvedTheme === "dark" ? <Sun className="mr-2 size-4 text-amber-500" /> : <Moon className="mr-2 size-4 text-blue-500" />}
            <span>{t("nav.toggleTheme", "切换暗色 / 浅色模式")}</span>
          </CommandItem>
          <CommandItem
            keywords={["language", "locale", "english", "chinese", "语言", "中文", "英文"]}
            onSelect={() => runCommand(() => setLocale(locale === "zh-CN" ? "en" : "zh-CN"))}
          >
            <Languages className="mr-2 size-4" />
            <span>{t("nav.switchLanguage", "切换语言 (中文 / EN)")}</span>
          </CommandItem>
          <CommandItem
            keywords={["logout", "exit", "sign out", "退出登录", "退出"]}
            onSelect={() => runCommand(clearAuth)}
          >
            <LogOut className="mr-2 size-4 text-destructive" />
            <span>{t("nav.logout")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
