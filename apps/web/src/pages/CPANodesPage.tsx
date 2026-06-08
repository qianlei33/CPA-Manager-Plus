import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  cpaNodeApi,
  usageServiceApi,
  type CPANode,
  type CPANodeInput,
  type UsageServiceNodeCollectorStatus,
} from '@/services/api/usageService';
import { useAuthStore, useCPANodeStore, useNotificationStore, useUsageServiceStore } from '@/stores';
import styles from './CPANodesPage.module.scss';

type WizardStep = 'connection' | 'secret' | 'monitoring' | 'polling' | 'review';

const steps: WizardStep[] = ['connection', 'secret', 'monitoring', 'polling', 'review'];

const emptyDraft: CPANodeInput = {
  name: '',
  baseUrl: '',
  managementKey: '',
  enabled: true,
  description: '',
  collectorEnabled: true,
  collectorMode: 'auto',
  queue: 'usage',
  popSide: 'right',
  batchSize: 100,
  pollIntervalMs: 500,
  queryLimit: 50000,
  tlsSkipVerify: false,
  ensureUsageStatisticsEnabled: true,
  requestMonitoringEnabled: true,
};

const stepLabels: Record<WizardStep, string> = {
  connection: 'CPA 连接',
  secret: 'CPA 密钥',
  monitoring: '请求监控',
  polling: '采集间隔',
  review: '确认提交',
};

const stepDescriptions: Record<WizardStep, string> = {
  connection: '定义节点身份、入口地址和启用状态。',
  secret: '配置 CPA 管理密钥，编辑时留空表示保留原密钥。',
  monitoring: '决定是否让 Manager Plus 从该节点采集请求用量。',
  polling: '设置采集轮询节奏，避免对节点造成额外压力。',
  review: '确认节点配置后保存并启动采集。',
};

function formatCollectorTime(value: number | undefined): string {
  if (!value) return '--';
  return new Date(value).toLocaleTimeString();
}

function collectorTone(value: string | undefined): 'ok' | 'warn' | 'error' | 'idle' {
  if (value === 'running') return 'ok';
  if (value === 'starting') return 'warn';
  if (value === 'error') return 'error';
  return 'idle';
}

export function CPANodesPage() {
  const managementKey = useAuthStore((state) => state.managementKey);
  const { showNotification } = useNotificationStore();
  const serviceBase = useUsageServiceStore((state) => state.serviceBase || state.panelBase || '');
  const nodes = useCPANodeStore((state) => state.nodes);
  const currentNodeId = useCPANodeStore((state) => state.currentNodeId);
  const fetchNodes = useCPANodeStore((state) => state.fetchNodes);
  const setCurrentNodeId = useCPANodeStore((state) => state.setCurrentNodeId);
  const [draft, setDraft] = useState<CPANodeInput>(emptyDraft);
  const [editing, setEditing] = useState<CPANode | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>('connection');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [collectorStatusMap, setCollectorStatusMap] = useState<Record<string, UsageServiceNodeCollectorStatus>>({});

  const loadCollectorStatuses = useCallback(async () => {
    if (!serviceBase) return;
    try {
      const status = await usageServiceApi.getStatus(serviceBase, managementKey);
      const nextMap: Record<string, UsageServiceNodeCollectorStatus> = {};
      status.nodeCollectors?.forEach((item) => {
        if (item.nodeId) nextMap[item.nodeId] = item;
      });
      setCollectorStatusMap(nextMap);
    } catch {
      setCollectorStatusMap({});
    }
  }, [managementKey, serviceBase]);

  useEffect(() => {
    if (!serviceBase) return;
    void fetchNodes(serviceBase, managementKey);
    void loadCollectorStatuses();
  }, [fetchNodes, loadCollectorStatuses, managementKey, serviceBase]);

  const stepIndex = steps.indexOf(step);
  const isFirstStep = stepIndex <= 0;
  const isLastStep = step === 'review';
  const title = useMemo(() => (editing ? `编辑节点：${editing.name}` : '新增 CPA 节点'), [editing]);
  const filteredNodes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return nodes.filter((node) => {
      if (statusFilter === 'enabled' && !node.enabled) return false;
      if (statusFilter === 'disabled' && node.enabled) return false;
      if (!normalized) return true;
      return [node.name, node.baseUrl, node.description ?? '']
        .join('\n')
        .toLowerCase()
        .includes(normalized);
    });
  }, [nodes, query, statusFilter]);

  const updateDraft = <K extends keyof CPANodeInput>(key: K, value: CPANodeInput[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const startEdit = (node: CPANode) => {
    setEditing(node);
    setWizardOpen(true);
    setStep('connection');
    setDraft({
      ...emptyDraft,
      name: node.name,
      baseUrl: node.baseUrl,
      managementKey: '',
      enabled: node.enabled,
      description: node.description ?? '',
      collectorEnabled: node.collectorEnabled ?? true,
      collectorMode: node.collectorMode ?? 'auto',
      queue: node.queue ?? 'usage',
      popSide: node.popSide ?? 'right',
      batchSize: node.batchSize ?? 100,
      pollIntervalMs: node.pollIntervalMs ?? 500,
      queryLimit: node.queryLimit ?? 50000,
      tlsSkipVerify: node.tlsSkipVerify ?? false,
      requestMonitoringEnabled: node.collectorEnabled ?? true,
      ensureUsageStatisticsEnabled: false,
    });
  };

  const startCreate = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setStep('connection');
    setWizardOpen(true);
  };

  const resetForm = () => {
    setEditing(null);
    setWizardOpen(false);
    setStep('connection');
    setDraft(emptyDraft);
  };

  const validateStep = (target: WizardStep) => {
    if (target === 'connection') {
      if (!draft.name.trim() || !draft.baseUrl.trim()) {
        showNotification('请填写节点名称和 CPA Base URL', 'warning');
        return false;
      }
    }
    if (target === 'secret' && !editing && !draft.managementKey?.trim()) {
      showNotification('请填写 CPA Management Key', 'warning');
      return false;
    }
    if (target === 'polling' && draft.requestMonitoringEnabled) {
      const pollInterval = Number(draft.pollIntervalMs);
      if (!Number.isFinite(pollInterval) || pollInterval <= 0) {
        showNotification('采集间隔必须大于 0', 'warning');
        return false;
      }
    }
    return true;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep(steps[Math.min(stepIndex + 1, steps.length - 1)]);
  };

  const goBack = () => {
    setStep(steps[Math.max(stepIndex - 1, 0)]);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!serviceBase || !validateStep(step)) return;
    setSaving(true);
    try {
      const payload: CPANodeInput = {
        ...draft,
        collectorEnabled: draft.requestMonitoringEnabled,
      };
      const saved = editing
        ? await cpaNodeApi.update(serviceBase, managementKey, editing.id, payload)
        : await cpaNodeApi.create(serviceBase, managementKey, payload);
      await fetchNodes(serviceBase, managementKey);
      await loadCollectorStatuses();
      if (!editing) setCurrentNodeId(saved.id);
      resetForm();
      showNotification('CPA 节点已保存', 'success');
    } catch (error) {
      showNotification(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeNode = async (node: CPANode) => {
    if (!serviceBase || !window.confirm(`确认删除节点 ${node.name}？`)) return;
    await cpaNodeApi.remove(serviceBase, managementKey, node.id);
    await fetchNodes(serviceBase, managementKey);
    await loadCollectorStatuses();
  };

  const validateNode = async (node: CPANode) => {
    if (!serviceBase) return;
    try {
      await cpaNodeApi.validate(serviceBase, managementKey, node.id);
      showNotification(`${node.name} 连接正常`, 'success');
    } catch (error) {
      showNotification(error instanceof Error ? error.message : String(error), 'error');
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.header}>
        <div>
          <span className={styles.eyebrow}>CPA Manager Plus</span>
          <h1>CPA 节点管理</h1>
          <p>管理上游 CPA 节点、连接密钥与请求采集策略。左侧页面始终操作当前选中节点。</p>
        </div>
        <Button type="button" onClick={startCreate}>新增节点</Button>
      </section>

      <section className={styles.toolbar} aria-label="节点查询条件">
        <div className={styles.filters}>
          <div className={styles.filterField}>
            <label htmlFor="node-search">查询节点</label>
            <input
              id="node-search"
              className={styles.filterInput}
              value={query}
              placeholder="按名称、地址、备注搜索"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className={styles.filterField}>
            <label htmlFor="node-status">状态</label>
            <select
              id="node-status"
              className={styles.filterSelect}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            >
              <option value="all">全部</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已禁用</option>
            </select>
          </div>
        </div>
      </section>

      <section className={styles.cards}>
        {filteredNodes.map((node) => {
          const collectorStatus = collectorStatusMap[node.id]?.status;
          const tone = collectorTone(collectorStatus?.collector);
          return (
            <div
              key={node.id}
              className={`${styles.nodeCard} ${node.id === currentNodeId ? styles.nodeCardActive : ''}`}
            >
              <div className={styles.nodeTop}>
                <div className={styles.nodeTitle}>
                  <span className={styles.nodeName}>{node.name}</span>
                  <span className={styles.nodeUrl}>{node.baseUrl}</span>
                </div>
                <div className={styles.badges}>
                  <span className={`${styles.badge} ${node.enabled ? styles.badgeEnabled : ''}`}>
                    {node.enabled ? '已启用' : '已禁用'}
                  </span>
                  <span className={`${styles.badge} ${node.collectorEnabled ? styles.badgeEnabled : ''}`}>
                    监控{node.collectorEnabled ? '开启' : '关闭'}
                  </span>
                </div>
              </div>

              {node.description ? <span className={styles.nodeDescription}>{node.description}</span> : null}

              <div className={styles.collectorStrip}>
                <span className={`${styles.collectorPill} ${styles[`collector_${tone}`]}`}>
                  <i aria-hidden="true" />{collectorStatus?.collector || '未运行'}
                </span>
                <span>传输：{collectorStatus?.transport || '--'}</span>
                <span>队列：{collectorStatus?.queue || node.queue || 'usage'}</span>
                <span>写入：{formatCollectorTime(collectorStatus?.lastInsertedAt)}</span>
              </div>

              {collectorStatus?.lastError ? (
                <div className={styles.collectorError}>{collectorStatus.lastError}</div>
              ) : null}

              <div className={styles.actions}>
                <Button size="sm" onClick={() => setCurrentNodeId(node.id)}>设为当前</Button>
                <Button size="sm" variant="secondary" onClick={() => startEdit(node)}>编辑</Button>
                <Button size="sm" variant="secondary" onClick={() => void validateNode(node)}>测试连接</Button>
                <Button size="sm" variant="danger" onClick={() => void removeNode(node)}>删除</Button>
              </div>
            </div>
          );
        })}
      </section>

      {wizardOpen && (
        <div className={styles.drawerBackdrop} role="presentation">
          <form onSubmit={submit} className={styles.wizard} role="dialog" aria-modal="true" aria-label={title}>
            <div className={styles.drawerHeader}>
              <div>
                <span className={styles.drawerEyebrow}>{editing ? 'EDIT NODE' : 'NEW NODE'}</span>
                <h2>{title}</h2>
                <p>按步骤完成节点连接、密钥和采集策略配置。</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={resetForm}>关闭</Button>
            </div>
            <div className={styles.steps}>
              {steps.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setStep(item)}
                  className={`${styles.stepButton} ${item === step ? styles.stepButtonActive : ''}`}
                >
                  <span className={styles.stepIndex}>{index + 1}</span>
                  <span className={styles.stepCopy}>
                    <strong>{stepLabels[item]}</strong>
                    <small>{index + 1 === stepIndex + 1 ? '当前步骤' : '配置项'}</small>
                  </span>
                </button>
              ))}
            </div>

            <div className={styles.stepProgress}>
              <span>步骤 {stepIndex + 1} / {steps.length}</span>
              <strong>{stepLabels[step]}</strong>
              <em>{stepDescriptions[step]}</em>
            </div>

            <div className={styles.drawerGrid}>
              <div className={styles.stepPanel}>
                {step === 'connection' && (
                  <div className={styles.fields}>
                    <Input label="节点名称" value={draft.name} placeholder="例如：生产 CPA" onChange={(event) => updateDraft('name', event.target.value)} />
                    <Input label="CPA Base URL" value={draft.baseUrl} placeholder="http://localhost:8317" onChange={(event) => updateDraft('baseUrl', event.target.value)} />
                    <Input label="备注" value={draft.description ?? ''} placeholder="可选" onChange={(event) => updateDraft('description', event.target.value)} />
                    <SelectionCheckbox checked={draft.enabled} onChange={(checked) => updateDraft('enabled', checked)} ariaLabel="启用节点" label="启用节点" />
                  </div>
                )}

                {step === 'secret' && (
                  <div className={styles.fields}>
                    <Input label="CPA Management Key" value={draft.managementKey ?? ''} type="password" placeholder={editing ? '留空表示不修改现有密钥' : '输入 CPA 管理密钥'} onChange={(event) => updateDraft('managementKey', event.target.value)} />
                    <SelectionCheckbox checked={Boolean(draft.ensureUsageStatisticsEnabled)} onChange={(checked) => updateDraft('ensureUsageStatisticsEnabled', checked)} ariaLabel="保存后启用 CPA usage statistics" label="保存后启用 CPA usage statistics" />
                  </div>
                )}

                {step === 'monitoring' && (
                  <div className={styles.fields}>
                    <SelectionCheckbox checked={Boolean(draft.requestMonitoringEnabled)} onChange={(checked) => { updateDraft('requestMonitoringEnabled', checked); updateDraft('collectorEnabled', checked); }} ariaLabel="启用请求监控采集" label="启用请求监控采集" />
                    <p className={styles.fieldHint}>开启后 Manager Plus 会从该节点采集请求用量，用于请求监控、统计与巡检分析。</p>
                  </div>
                )}

                {step === 'polling' && (
                  <div className={styles.fields}>
                    <Input label="采集间隔（毫秒）" type="number" value={String(draft.pollIntervalMs ?? 500)} onChange={(event) => updateDraft('pollIntervalMs', Number(event.target.value))} />
                    <p className={styles.fieldHint}>默认 500ms。请求量较大时可以适当增大，降低 Manager Plus 和 CPA 节点压力。</p>
                  </div>
                )}

                {step === 'review' && (
                  <div className={styles.review}>
                    <strong>{draft.name || '-'}</strong>
                    <span>{draft.baseUrl || '-'}</span>
                    <span>节点状态：{draft.enabled ? '启用' : '禁用'}</span>
                    <span>请求监控：{draft.requestMonitoringEnabled ? '启用' : '禁用'}</span>
                    <span>采集间隔：{draft.pollIntervalMs ?? 500} ms</span>
                    <span>Usage statistics 初始化：{draft.ensureUsageStatisticsEnabled ? '启用' : '跳过'}</span>
                  </div>
                )}

                {editing && (
                  <div className={styles.advancedSection}>
                    <button
                      type="button"
                      className={styles.advancedToggle}
                      onClick={() => setAdvancedOpen((prev) => !prev)}
                      aria-expanded={advancedOpen}
                    >
                      <span>高级采集配置</span>
                      <span className={styles.advancedToggleIcon}>{advancedOpen ? '▾' : '▸'}</span>
                    </button>
                    {advancedOpen && (
                      <div className={styles.advancedContent}>
                        <div className={styles.advancedField}>
                          <label>采集模式</label>
                          <select
                            className={styles.advancedSelect}
                            value={draft.collectorMode ?? 'auto'}
                            onChange={(e) => updateDraft('collectorMode', e.target.value)}
                          >
                            <option value="auto">auto</option>
                            <option value="http">http</option>
                            <option value="resp">resp</option>
                            <option value="subscribe">subscribe</option>
                          </select>
                        </div>
                        <Input label="队列名" value={draft.queue ?? ''} onChange={(event) => updateDraft('queue', event.target.value)} />
                        <div className={styles.advancedField}>
                          <label>弹出方向</label>
                          <select
                            className={styles.advancedSelect}
                            value={draft.popSide ?? 'right'}
                            onChange={(e) => updateDraft('popSide', e.target.value)}
                          >
                            <option value="right">right</option>
                            <option value="left">left</option>
                          </select>
                        </div>
                        <Input label="批量大小" type="number" value={String(draft.batchSize ?? 100)} onChange={(event) => updateDraft('batchSize', Number(event.target.value))} />
                        <Input label="查询上限" type="number" value={String(draft.queryLimit ?? 50000)} onChange={(event) => updateDraft('queryLimit', Number(event.target.value))} />
                        <SelectionCheckbox checked={Boolean(draft.tlsSkipVerify)} onChange={(checked) => updateDraft('tlsSkipVerify', checked)} ariaLabel="跳过 TLS 验证" label="跳过 TLS 验证" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.wizardActions}>
              <Button type="button" variant="secondary" disabled={isFirstStep || saving} onClick={goBack}>上一步</Button>
              {isLastStep ? (
                <Button type="submit" disabled={saving}>{saving ? '保存中...' : '保存节点'}</Button>
              ) : (
                <Button type="button" onClick={goNext}>下一步</Button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
