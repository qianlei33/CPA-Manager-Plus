import { useEffect, useMemo, useState } from 'react';
import {
  isUsageServiceId,
  normalizeUsageServiceBase,
  cpaNodeApi,
  usageServiceApi,
  type ManagerConfig,
} from '@/services/api/usageService';
import { useAuthStore, useCPANodeStore } from '@/stores';
import { detectApiBaseFromLocation } from '@/utils/connection';

export type PanelHostMode = 'manager_embedded' | 'external_panel';

export type PanelFeatureUnavailableReason =
  | 'checking'
  | 'service_not_configured'
  | 'service_unavailable'
  | 'monitoring_disabled';

export interface PanelFeatureAvailability {
  checking: boolean;
  panelHostMode: PanelHostMode;
  panelBase: string;
  managerServiceBase: string;
  managerServiceAvailable: boolean;
  requestMonitoringAvailable: boolean;
  modelPricesAvailable: boolean;
  serverCodexInspectionAvailable: boolean;
  dockerSetupAvailable: boolean;
  externalManagerConfigAvailable: boolean;
  reason: PanelFeatureUnavailableReason | '';
}

export interface ResolvePanelFeatureAvailabilityInput {
  checking?: boolean;
  panelHostedByUsageService: boolean;
  panelBase: string;
  managerServiceBase: string;
  managerConfig: ManagerConfig | null;
  hasConfiguredNodes?: boolean;
  hasRequestMonitoringNode?: boolean;
  hasManagerCandidate: boolean;
  managementKey: string;
}

const normalizeBase = (value?: string) => normalizeUsageServiceBase(value || '');

const buildUnavailableState = (
  input: ResolvePanelFeatureAvailabilityInput,
  reason: PanelFeatureUnavailableReason
): PanelFeatureAvailability => ({
  checking: input.checking === true,
  panelHostMode: input.panelHostedByUsageService ? 'manager_embedded' : 'external_panel',
  panelBase: normalizeBase(input.panelBase),
  managerServiceBase: '',
  managerServiceAvailable: false,
  requestMonitoringAvailable: false,
  modelPricesAvailable: false,
  serverCodexInspectionAvailable: false,
  dockerSetupAvailable: input.panelHostedByUsageService,
  externalManagerConfigAvailable: false,
  reason,
});

export function resolvePanelFeatureAvailability(
  input: ResolvePanelFeatureAvailabilityInput
): PanelFeatureAvailability {
  if (!input.managementKey) {
    return buildUnavailableState(input, 'service_not_configured');
  }
  if (!input.panelHostedByUsageService) {
    return buildUnavailableState(input, 'service_not_configured');
  }

  const managerServiceBase = normalizeBase(input.managerServiceBase);
  if (!managerServiceBase || !input.managerConfig) {
    return buildUnavailableState(
      input,
      input.hasManagerCandidate ? 'service_unavailable' : 'service_not_configured'
    );
  }

  const hasNodeConnection = input.hasConfiguredNodes === true;
  const requestMonitoringAvailable = input.hasRequestMonitoringNode === true;

  return {
    checking: input.checking === true,
    panelHostMode: input.panelHostedByUsageService ? 'manager_embedded' : 'external_panel',
    panelBase: normalizeBase(input.panelBase),
    managerServiceBase,
    managerServiceAvailable: true,
    requestMonitoringAvailable,
    modelPricesAvailable: true,
    serverCodexInspectionAvailable: true,
    dockerSetupAvailable: input.panelHostedByUsageService,
    externalManagerConfigAvailable: false,
    reason: requestMonitoringAvailable
      ? ''
      : !hasNodeConnection
        ? 'service_not_configured'
        : 'monitoring_disabled',
  };
}

export interface BuildPanelManagerServiceCandidatesInput {
  panelHostedByUsageService: boolean;
  panelBase: string;
}

export function buildPanelManagerServiceCandidates({
  panelHostedByUsageService,
  panelBase,
}: BuildPanelManagerServiceCandidatesInput): string[] {
  const normalizedPanelBase = normalizeBase(panelBase);
  if (panelHostedByUsageService) {
    return normalizedPanelBase ? [normalizedPanelBase] : [];
  }

  return [];
}

export function managerConfigMatchesPanel({
  panelHostedByUsageService,
}: {
  panelHostedByUsageService: boolean;
  apiBase: string;
  config: ManagerConfig;
}): boolean {
  return panelHostedByUsageService;
}

type PanelFeatureAvailabilityRequestInput = {
  apiBase: string;
  managementKey: string;
  usageServiceRevision: number | string;
  panelBase: string;
};

type PanelFeatureAvailabilityRequest = {
  key: string;
  promise: Promise<PanelFeatureAvailability>;
};

const initialAvailability: PanelFeatureAvailability = {
  checking: true,
  panelHostMode: 'external_panel',
  panelBase: '',
  managerServiceBase: '',
  managerServiceAvailable: false,
  requestMonitoringAvailable: false,
  modelPricesAvailable: false,
  serverCodexInspectionAvailable: false,
  dockerSetupAvailable: false,
  externalManagerConfigAvailable: false,
  reason: 'checking',
};

let cachedAvailabilityKey = '';
let cachedAvailability: PanelFeatureAvailability | null = null;
let inFlightAvailabilityRequest: PanelFeatureAvailabilityRequest | null = null;
let latestAvailabilityRequestKey = '';

const buildAvailabilityRequestKey = ({
  apiBase,
  managementKey,
  usageServiceRevision,
  panelBase,
}: PanelFeatureAvailabilityRequestInput): string =>
  [
    normalizeBase(panelBase),
    normalizeBase(apiBase),
    managementKey,
    String(usageServiceRevision),
  ].join('\u001f');

async function detectPanelFeatureAvailability({
  apiBase,
  managementKey,
  panelBase,
}: PanelFeatureAvailabilityRequestInput): Promise<PanelFeatureAvailability> {
  const normalizedPanelBase = normalizeBase(panelBase);
  if (!managementKey) {
    return resolvePanelFeatureAvailability({
      checking: false,
      panelHostedByUsageService: false,
      panelBase: normalizedPanelBase,
      managerServiceBase: '',
      managerConfig: null,
      hasManagerCandidate: false,
      managementKey,
    });
  }

  let panelHostedByUsageService = false;
  try {
    const info = await usageServiceApi.getInfo(normalizedPanelBase);
    panelHostedByUsageService = isUsageServiceId(info.service);
  } catch {
    panelHostedByUsageService = false;
  }

  const candidates = buildPanelManagerServiceCandidates({
    panelHostedByUsageService,
    panelBase: normalizedPanelBase,
  });

  for (const candidate of candidates) {
    try {
      const info = await usageServiceApi.getInfo(candidate);
      if (!isUsageServiceId(info.service)) continue;
      const response = await usageServiceApi.getManagerConfig(candidate, managementKey);
      const nodes = await cpaNodeApi.list(candidate, managementKey);
      const hasRequestMonitoringNode = nodes.some(
        (node) => node.enabled && node.collectorEnabled !== false
      );
      if (
        !managerConfigMatchesPanel({
          panelHostedByUsageService,
          apiBase,
          config: response.config,
        })
      ) {
        continue;
      }
      return resolvePanelFeatureAvailability({
        checking: false,
        panelHostedByUsageService,
        panelBase: normalizedPanelBase,
        managerServiceBase: candidate,
        managerConfig: response.config,
        hasConfiguredNodes: info.configured === true,
        hasRequestMonitoringNode,
        hasManagerCandidate: candidates.length > 0,
        managementKey,
      });
    } catch {
      // Continue probing; a regular CPA endpoint or unreachable Manager Server is expected here.
    }
  }

  const unavailableState = resolvePanelFeatureAvailability({
    checking: false,
    panelHostedByUsageService,
    panelBase: normalizedPanelBase,
    managerServiceBase: '',
    managerConfig: null,
    hasManagerCandidate: candidates.length > 0,
    managementKey,
  });
  return unavailableState;
}

function requestPanelFeatureAvailability(
  input: PanelFeatureAvailabilityRequestInput
): { key: string; promise: Promise<PanelFeatureAvailability> } {
  const key = buildAvailabilityRequestKey(input);
  if (cachedAvailabilityKey === key && cachedAvailability) {
    return { key, promise: Promise.resolve(cachedAvailability) };
  }
  if (inFlightAvailabilityRequest?.key === key) {
    return inFlightAvailabilityRequest;
  }

  latestAvailabilityRequestKey = key;
  const promise = detectPanelFeatureAvailability(input).then((availability) => {
    if (latestAvailabilityRequestKey === key) {
      cachedAvailabilityKey = key;
      cachedAvailability = availability;
    }
    return availability;
  });
  inFlightAvailabilityRequest = { key, promise };
  promise.finally(() => {
    if (inFlightAvailabilityRequest?.key === key) {
      inFlightAvailabilityRequest = null;
    }
  });
  return inFlightAvailabilityRequest;
}

export function usePanelFeatureAvailability(): PanelFeatureAvailability {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const nodes = useCPANodeStore((state) => state.nodes);
  const panelBase = useMemo(() => detectApiBaseFromLocation(), []);
  const nodeRevision = useMemo(
    () => nodes.map((node) => `${node.id}:${node.enabled}:${node.collectorEnabled !== false}`).join('|'),
    [nodes]
  );
  const requestInput = useMemo(
    () => ({
      apiBase,
      managementKey,
      usageServiceRevision: nodeRevision,
      panelBase,
    }),
    [apiBase, managementKey, nodeRevision, panelBase]
  );
  const requestKey = useMemo(
    () => buildAvailabilityRequestKey(requestInput),
    [requestInput]
  );
  const [state, setState] = useState<PanelFeatureAvailability>(() =>
    cachedAvailabilityKey === requestKey && cachedAvailability
      ? cachedAvailability
      : initialAvailability
  );

  useEffect(() => {
    let cancelled = false;
    const hasCachedAvailability = cachedAvailabilityKey === requestKey && cachedAvailability;
    if (!hasCachedAvailability) {
      queueMicrotask(() => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          checking: true,
          panelBase: normalizeBase(panelBase),
          reason: 'checking',
        }));
      });
    }

    const request = requestPanelFeatureAvailability(requestInput);
    request.promise.then((availability) => {
      if (cancelled || request.key !== requestKey) return;
      setState(availability);
    });

    return () => {
      cancelled = true;
    };
  }, [
    panelBase,
    requestInput,
    requestKey,
  ]);

  return state;
}
