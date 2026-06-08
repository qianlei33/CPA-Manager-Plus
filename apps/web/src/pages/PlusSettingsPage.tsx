import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore, useNotificationStore, useUsageServiceStore } from '@/stores';
import { usageServiceApi, type UsageServiceInfo, type ManagerConfigResponse } from '@/services/api/usageService';
import { detectApiBaseFromLocation } from '@/utils/connection';
import styles from './CPANodesPage.module.scss';

/**
 * Renders CPA Manager Plus global settings.
 */
export function PlusSettingsPage() {
  const managementKey = useAuthStore((state) => state.managementKey);
  const logout = useAuthStore((state) => state.logout);
  const { showNotification } = useNotificationStore();
  const serviceBase = useUsageServiceStore((state) => state.serviceBase || state.panelBase || '');
  const [info, setInfo] = useState<UsageServiceInfo | null>(null);
  const [managerConfig, setManagerConfig] = useState<ManagerConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [newToken, setNewToken] = useState('');
  const [confirmToken, setConfirmToken] = useState('');
  const [savingToken, setSavingToken] = useState(false);

  const panelBase = detectApiBaseFromLocation();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const base = serviceBase || panelBase;
        if (!base) return;
        const [infoData, configData] = await Promise.all([
          usageServiceApi.getInfo(base),
          managementKey ? usageServiceApi.getManagerConfig(base, managementKey).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setInfo(infoData);
        setManagerConfig(configData);
      } catch (error) {
        if (!cancelled) {
          showNotification(error instanceof Error ? error.message : String(error), 'error');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [serviceBase, panelBase, managementKey, showNotification]);

  const runtimeMode = info?.service ? 'embedded' : 'external';
  const runtimeLabel = runtimeMode === 'embedded' ? '内嵌模式' : '外部面板模式';

  const configSourceMap: Record<string, string> = {
    env: '环境变量',
    db: '数据库',
    '': '未配置',
  };

  const handleRotateToken = async (event: FormEvent) => {
    event.preventDefault();
    const token = newToken.trim();
    if (!token) {
      showNotification('请输入新的 Plus 登录 token', 'warning');
      return;
    }
    if (token !== confirmToken.trim()) {
      showNotification('两次输入的 token 不一致', 'warning');
      return;
    }
    const base = serviceBase || panelBase;
    if (!base || !managementKey) {
      showNotification('当前登录状态无效，请重新登录', 'error');
      return;
    }
    setSavingToken(true);
    try {
      await usageServiceApi.rotateAdminToken(base, managementKey, token);
      showNotification('Plus 登录 token 已更新，请使用新 token 重新登录', 'success');
      logout();
    } catch (error) {
      showNotification(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSavingToken(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.header}>
        <h1>Plus 设置</h1>
        <p>管理 CPA Manager Plus 自身的全局设置。CPA 节点连接和采集策略请在节点管理中配置。</p>
      </section>

      {loading ? (
        <section className={styles.toolbar}>
          <p className={styles.nodeDescription}>加载中...</p>
        </section>
      ) : (
        <>
          <section className={styles.toolbar}>
            <div className={styles.filterField} style={{ width: '100%' }}>
              <label>系统状态</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginTop: '8px' }}>
                <div className={styles.nodeCard} style={{ minHeight: 'auto', padding: '12px' }}>
                  <span className={styles.nodeDescription}>运行模式</span>
                  <strong style={{ fontSize: '15px', display: 'block', marginTop: '4px' }}>{runtimeLabel}</strong>
                </div>
                <div className={styles.nodeCard} style={{ minHeight: 'auto', padding: '12px' }}>
                  <span className={styles.nodeDescription}>服务地址</span>
                  <strong style={{ fontSize: '15px', display: 'block', marginTop: '4px' }}>{serviceBase || panelBase || '-'}</strong>
                </div>
                <div className={styles.nodeCard} style={{ minHeight: 'auto', padding: '12px' }}>
                  <span className={styles.nodeDescription}>项目初始化</span>
                  <strong style={{ fontSize: '15px', display: 'block', marginTop: '4px' }}>
                    {info?.projectInitialized ? '已完成' : '未完成'}
                  </strong>
                </div>
                <div className={styles.nodeCard} style={{ minHeight: 'auto', padding: '12px' }}>
                  <span className={styles.nodeDescription}>数据密钥</span>
                  <strong style={{ fontSize: '15px', display: 'block', marginTop: '4px' }}>
                    {info?.dataKeyReady ? '就绪' : '未就绪'}
                  </strong>
                </div>
                <div className={styles.nodeCard} style={{ minHeight: 'auto', padding: '12px' }}>
                  <span className={styles.nodeDescription}>配置来源</span>
                  <strong style={{ fontSize: '15px', display: 'block', marginTop: '4px' }}>
                    {configSourceMap[managerConfig?.source ?? ''] ?? '-'}
                  </strong>
                </div>
                <div className={styles.nodeCard} style={{ minHeight: 'auto', padding: '12px' }}>
                  <span className={styles.nodeDescription}>已配置节点</span>
                  <strong style={{ fontSize: '15px', display: 'block', marginTop: '4px' }}>
                    {info?.configured ? '是' : '否'}
                  </strong>
                </div>
              </div>
            </div>
          </section>

          <section className={styles.toolbar}>
            <div className={styles.filterField} style={{ width: '100%' }}>
              <label>配置说明</label>
              <div style={{ display: 'grid', gap: '8px', marginTop: '8px' }}>
                <p className={styles.nodeDescription}>
                  • <strong>CPA 节点连接</strong>与<strong>请求监控采集策略</strong>已迁移到【节点管理】页面，按节点独立配置。
                </p>
                <p className={styles.nodeDescription}>
                  • 此页面后续将用于管理 Plus 全局策略，如全局 Codex 巡检默认配置、管理员密钥轮换、数据密钥状态等。
                </p>
              </div>
            </div>
          </section>

          <form className={styles.toolbar} onSubmit={handleRotateToken}>
            <div className={styles.filterField} style={{ width: '100%' }}>
              <label>修改 Plus 登录 token</label>
              <p className={styles.nodeDescription}>
                更新后当前会话会退出，需要使用新的 token 重新登录。
              </p>
              <div style={{ display: 'grid', gap: '12px', marginTop: '8px' }}>
                <Input
                  label="新 token"
                  type="password"
                  value={newToken}
                  onChange={(event) => setNewToken(event.target.value)}
                  placeholder="输入新的 Plus 登录 token"
                />
                <Input
                  label="确认新 token"
                  type="password"
                  value={confirmToken}
                  onChange={(event) => setConfirmToken(event.target.value)}
                  placeholder="再次输入新的 Plus 登录 token"
                />
                <div className={styles.actions}>
                  <Button type="submit" loading={savingToken} disabled={savingToken}>
                    保存登录 token
                  </Button>
                </div>
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
