import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LanguageToggle, ThemeToggle } from "@/components/layout/app-shell";
import faviconImage from "@/assets/favicon.png";
import { server } from "@/api/management";
import { errMessage } from "@/api/types";
import { useAuthStore } from "@/stores/auth";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const authKey = useAuthStore((state) => state.key);
  const setKey = useAuthStore((state) => state.setKey);

  const [value, setValue] = useState(authKey);
  const [remember, setRemember] = useState(useAuthStore.getState().remember);
  const [revealed, setRevealed] = useState(false);

  const connect = useMutation({
    mutationFn: async () => {
      const previous = useAuthStore.getState().key;
      useAuthStore.getState().setKey(value, false);
      try {
        return await server.info();
      } catch (error) {
        useAuthStore.getState().setKey(previous, false);
        throw error;
      }
    },
    onSuccess: () => {
      setKey(value.trim(), remember);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    },
  });

  // The optimistic key set inside the mutation makes authKey truthy mid-flight;
  // navigating then would unmount this form before the error branch renders.
  if (authKey && !connect.isPending && !connect.isError) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-background" />
        <div className="bg-primary/15 absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full blur-3xl" />
        <div className="bg-primary/8 absolute right-[10%] bottom-[-10rem] size-[28rem] rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_40%,black,transparent)]" />
      </div>

      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-sm rounded-3xl border border-slate-200/80 bg-white/95 py-6 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
        <CardHeader className="items-center text-center pb-2">
          <div className="mb-2 flex justify-center">
            <img
              src={faviconImage}
              alt=""
              width={72}
              height={72}
              className="size-[72px] object-contain"
            />
          </div>
          <CardTitle className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t("login.title")}
          </CardTitle>
          <CardDescription className="mx-auto max-w-xs text-xs text-slate-500 mt-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  className="inline-flex cursor-help items-center gap-1 underline decoration-dotted underline-offset-4 outline-none"
                >
                  {t("login.description")}
                  <Info className="size-3 shrink-0" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64 leading-relaxed">
                {t("login.descriptionTooltip")}
              </TooltipContent>
            </Tooltip>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (value.trim()) connect.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="key">{t("login.keyLabel")}</Label>
              <div className="relative">
                <Input
                  id="key"
                  autoFocus
                  type={revealed ? "text" : "password"}
                  className="h-9 pr-10 font-mono"
                  placeholder={t("login.keyPlaceholder")}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground absolute top-0 right-0 size-9 rounded-full hover:bg-transparent"
                  onClick={() => setRevealed((current) => !current)}
                >
                  {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={remember} onCheckedChange={(checked) => setRemember(checked === true)} />
              {t("login.remember")}
            </label>
            {connect.isError ? (
              <p className="text-destructive text-sm">{t("login.invalidKey", { message: errMessage(connect.error) })}</p>
            ) : null}
            <Button type="submit" className="h-9 w-full" disabled={!value.trim() || connect.isPending}>
              {connect.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t("login.connecting")}
                </>
              ) : (
                t("login.connect")
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
