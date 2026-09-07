"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/shared/components";
import { isNeedsCoreNode } from "@/lib/proxySubscription/needsCore";

interface SubscriptionRecord {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  mode: "global" | "rule";
  ruleProviders: string[] | null;
  localCoreEndpoint: string | null;
  updateIntervalMinutes: number;
  lastFetchedAt: string | null;
  status: "ok" | "error" | "empty";
  error: string | null;
  lastNodes: unknown[] | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
}

interface ProviderOption {
  id: string;
  name: string;
  provider: string;
}

type FormState = {
  name: string;
  url: string;
  mode: "global" | "rule";
  ruleProviders: string[];
  localCoreEndpoint: string;
  updateIntervalMinutes: number;
  enabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  url: "",
  mode: "global",
  ruleProviders: [],
  localCoreEndpoint: "",
  updateIntervalMinutes: 60,
  enabled: true,
};

export default function SubscriptionTab() {
  const [subs, setSubs] = useState<SubscriptionRecord[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t = useTranslations("settings");

  // Resolve a subscription `error` value into a localized message. Values are
  // either a `{ code, detail? }` JSON (user-facing, i18n'd) or a plain
  // diagnostic string (technical fetch/sync errors) shown verbatim.
  const resolveSubError = useCallback(
    (raw: string | null): string | null => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as { code?: string; detail?: string };
        if (parsed?.code) {
          const base = t(`proxySubscription.error.${parsed.code}`);
          return parsed.detail ? `${base}（${parsed.detail}）` : base;
        }
      } catch {
        // plain diagnostic string — show as-is
      }
      return raw;
    },
    [t]
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/management/proxy-subscriptions");
      if (!res.ok) throw new Error(t("proxySubscription.loadFailed"));
      const data = await res.json();
      setSubs(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/providers");
      if (!res.ok) return;
      const data = await res.json();
      const connections = Array.isArray(data.connections) ? data.connections : [];
      setProviders(
        connections.map((c: Record<string, unknown>) => ({
          id: String(c.id),
          name: typeof c.name === "string" && c.name ? c.name : String(c.provider),
          provider: String(c.provider),
        }))
      );
    } catch {
      /* non-fatal: rule mode just won't offer a provider picker */
    }
  }, []);

  useEffect(() => {
    load();
    loadProviders();
  }, [load, loadProviders]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError(null);
    setShowForm(false);
  };

  const startEdit = (sub: SubscriptionRecord) => {
    setEditingId(sub.id);
    setForm({
      name: sub.name,
      url: sub.url,
      mode: sub.mode,
      ruleProviders: sub.ruleProviders ?? [],
      localCoreEndpoint: sub.localCoreEndpoint ?? "",
      updateIntervalMinutes: sub.updateIntervalMinutes,
      enabled: sub.enabled,
    });
    setShowForm(true);
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (!form.name.trim()) throw new Error(t("proxySubscription.nameRequired"));
      if (!form.url.trim()) throw new Error(t("proxySubscription.urlRequired"));
      if (form.mode === "rule" && form.ruleProviders.length === 0) {
        throw new Error(t("proxySubscription.ruleModeProviderRequired"));
      }
      const payload = {
        name: form.name.trim(),
        url: form.url.trim(),
        mode: form.mode,
        ruleProviders: form.mode === "rule" ? form.ruleProviders : null,
        localCoreEndpoint: form.localCoreEndpoint.trim() || null,
        updateIntervalMinutes: Number(form.updateIntervalMinutes) || 60,
        enabled: form.enabled,
      };
      const res = editingId
        ? await fetch(`/api/v1/management/proxy-subscriptions/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/v1/management/proxy-subscriptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || t("proxySubscription.saveFailed"));
      }
      resetForm();
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (sub: SubscriptionRecord) => {
    setBusyId(sub.id);
    try {
      const res = await fetch(`/api/v1/management/proxy-subscriptions/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !sub.enabled }),
      });
      if (!res.ok) throw new Error(t("proxySubscription.toggleFailed"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const refresh = async (sub: SubscriptionRecord) => {
    setBusyId(sub.id);
    try {
      const res = await fetch(`/api/v1/management/proxy-subscriptions/${sub.id}/refresh`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(t("proxySubscription.refreshFailed"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (sub: SubscriptionRecord) => {
    if (!window.confirm(t("proxySubscription.confirmDelete", { name: sub.name }))) return;
    setBusyId(sub.id);
    try {
      const res = await fetch(`/api/v1/management/proxy-subscriptions/${sub.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(t("proxySubscription.deleteFailed"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const statusBadge: Record<SubscriptionRecord["status"], string> = {
    ok: "bg-green-500/15 text-green-600 border-green-500/30",
    error: "bg-red-500/15 text-red-600 border-red-500/30",
    empty: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{t("proxySubscription.description")}</p>
        {!showForm && (
          <Button size="sm" variant="primary" icon="add" onClick={() => setShowForm(true)}>
            {t("proxySubscription.addSubscription")}
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {showForm && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{editingId ? "编辑订阅" : "新增订阅"}</h3>
            <Button size="sm" variant="secondary" icon="close" onClick={resetForm}>
              {t("cancel")}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">{t("proxySubscription.name")}</span>
              <input
                className="rounded border border-border bg-surface px-2 py-1.5 text-text outline-none focus:border-primary"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("proxySubscription.namePlaceholder")}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">{t("proxySubscription.url")}</span>
              <input
                className="rounded border border-border bg-surface px-2 py-1.5 text-text outline-none focus:border-primary"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder={t("proxySubscription.urlPlaceholder")}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">{t("proxySubscription.mode")}</span>
              <div className="flex gap-2">
                {(["global", "rule"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setForm({ ...form, mode: m })}
                    className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                      form.mode === m
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border text-text-muted hover:text-text"
                    }`}
                  >
                    {m === "global"
                      ? t("proxySubscription.globalMode")
                      : t("proxySubscription.ruleMode")}
                  </button>
                ))}
              </div>
              <span className="text-xs text-text-muted">
                {form.mode === "global"
                  ? t("proxySubscription.globalModeDesc")
                  : t("proxySubscription.ruleModeDesc")}
              </span>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">{t("proxySubscription.localCoreEndpoint")}</span>
              <input
                className="rounded border border-border bg-surface px-2 py-1.5 text-text outline-none focus:border-primary"
                value={form.localCoreEndpoint}
                onChange={(e) => setForm({ ...form, localCoreEndpoint: e.target.value })}
                placeholder={t("proxySubscription.localCoreEndpointPlaceholder")}
              />
              <span className="text-xs text-text-muted">
                {t("proxySubscription.localCoreEndpointDesc")}
              </span>
            </label>
          </div>

          {form.mode === "rule" && (
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">{t("proxySubscription.routeByProvider")}</span>
              {providers.length === 0 ? (
                <span className="text-xs text-text-muted">
                  {t("proxySubscription.loadingProviders")}
                </span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {providers.map((p) => {
                    const checked = form.ruleProviders.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            ruleProviders: checked
                              ? form.ruleProviders.filter((x) => x !== p.id)
                              : [...form.ruleProviders, p.id],
                          })
                        }
                        className={`px-3 py-1 rounded text-xs border transition-colors ${
                          checked
                            ? "border-primary bg-primary/20 text-primary"
                            : "border-border text-text-muted hover:text-text"
                        }`}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-muted">{t("proxySubscription.autoRefreshInterval")}</span>
              <input
                type="number"
                min={5}
                className="rounded border border-border bg-surface px-2 py-1.5 text-text outline-none focus:border-primary"
                value={form.updateIntervalMinutes}
                onChange={(e) =>
                  setForm({ ...form, updateIntervalMinutes: Number(e.target.value) || 60 })
                }
              />
            </label>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              <span>{t("proxySubscription.enableAfterCreate")}</span>
            </label>
          </div>

          {formError && <div className="text-sm text-red-600">{formError}</div>}

          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={resetForm}>
              {t("cancel")}
            </Button>
            <Button size="sm" variant="primary" icon="save" onClick={save} disabled={saving}>
              {saving
                ? t("proxySubscription.saving")
                : editingId
                  ? t("proxySubscription.saveChanges")
                  : t("proxySubscription.createSubscription")}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {loading && <p className="text-sm text-text-muted">{t("proxySubscription.loading")}</p>}
        {!loading && subs.length === 0 && (
          <p className="text-sm text-text-muted">{t("proxySubscription.noSubscriptions")}</p>
        )}
        {subs.map((sub) => {
          const needsCoreNodes = (sub.lastNodes ?? []).filter(isNeedsCoreNode);
          const showCoreHint = needsCoreNodes.length > 0 && !sub.localCoreEndpoint;
          return (
            <div
              key={sub.id}
              className="rounded-lg border border-border bg-surface p-3 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{sub.name}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        statusBadge[sub.status] || statusBadge.empty
                      }`}
                    >
                      {sub.status === "ok" ? "正常" : sub.status === "error" ? "错误" : "空"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded border border-border text-text-muted">
                      {sub.mode === "global" ? "全局" : "规则"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded border border-border text-text-muted">
                      {sub.enabled ? "已启用" : "已停用"}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted truncate mt-1" title={sub.url}>
                    {sub.url}
                  </p>
                  {resolveSubError(sub.error) && (
                    <p className="text-xs text-amber-600 mt-1 break-words">
                      {resolveSubError(sub.error)}
                    </p>
                  )}
                  {showCoreHint && (
                    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 space-y-1.5">
                      <p className="font-medium">
                        该订阅有 {needsCoreNodes.length} 个节点需要本地代理内核（SS / VMess / Trojan
                        / VLESS 等），当前未被路由。
                      </p>
                      <p>
                        这些协议无法被 OmniRoute 直接转发。请在本机启动一个 <code>sing-box</code> 或{" "}
                        <code>clash（Clash.Meta）</code> 内核，并把它暴露为一个 SOCKS5/HTTP
                        端点，然后在「编辑」中填入该端点（仅接受 127.0.0.1 / localhost）。
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded bg-surface px-2 py-1 border border-border">
                          socks5://127.0.0.1:2080
                        </code>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard?.writeText("socks5://127.0.0.1:2080")}
                          className="px-2 py-1 rounded border border-border hover:border-primary/50"
                        >
                          复制
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(sub)}
                          className="px-2 py-1 rounded border border-border hover:border-primary/50"
                        >
                          去配置
                        </button>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-text-muted mt-1">
                    节点数：{sub.lastNodes?.length ?? 0}
                    {needsCoreNodes.length > 0 ? `（${needsCoreNodes.length} 个需本地内核）` : ""}
                    {sub.lastFetchedAt ? ` · 上次同步：${sub.lastFetchedAt}` : ""}
                    {sub.consecutiveFailures > 0 ? ` · 连续失败 ${sub.consecutiveFailures} 次` : ""}
                    {sub.lastErrorAt ? ` · 上次错误：${sub.lastErrorAt}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={busyId === sub.id}
                    onClick={() => toggleEnabled(sub)}
                    className="px-2 py-1 text-xs rounded border border-border hover:border-primary/50"
                    title={sub.enabled ? "停用" : "启用"}
                  >
                    {sub.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === sub.id}
                    onClick={() => refresh(sub)}
                    className="px-2 py-1 text-xs rounded border border-border hover:border-primary/50"
                    title="刷新节点"
                  >
                    刷新
                  </button>
                  <button
                    type="button"
                    disabled={busyId === sub.id}
                    onClick={() => startEdit(sub)}
                    className="px-2 py-1 text-xs rounded border border-border hover:border-primary/50"
                    title="编辑"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    disabled={busyId === sub.id}
                    onClick={() => remove(sub)}
                    className="px-2 py-1 text-xs rounded border border-red-500/30 text-red-600 hover:bg-red-500/10"
                    title="删除"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
