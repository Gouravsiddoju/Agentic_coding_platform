import type {
  AgentProvider,
  AuthStatus,
  AgentCategory,
  OptCodePermissionsState,
  SettingsProject,
} from '../../../types/types';

export type AgentContext = {
  authStatus: AuthStatus;
  onLogin: () => void;
};

export type AgentContextByProvider = Record<AgentProvider, AgentContext>;
export type ProviderAuthStatusByProvider = Record<AgentProvider, AuthStatus>;

export type AgentsSettingsTabProps = {
  providerAuthStatus: ProviderAuthStatusByProvider;
  onProviderLogin: (provider: AgentProvider) => void;
  optcodePermissions: OptCodePermissionsState;
  onOptCodePermissionsChange: (value: OptCodePermissionsState) => void;
  projects: SettingsProject[];
};

export type AgentCategoryTabsSectionProps = {
  selectedCategory: AgentCategory;
  onSelectCategory: (category: AgentCategory) => void;
};

export type AgentSelectorSectionProps = {
  agents: AgentProvider[];
  selectedAgent: AgentProvider;
  onSelectAgent: (agent: AgentProvider) => void;
  agentContextById: AgentContextByProvider;
};

export type AgentCategoryContentSectionProps = {
  selectedAgent: AgentProvider;
  selectedCategory: AgentCategory;
  agentContextById: AgentContextByProvider;
  optcodePermissions: OptCodePermissionsState;
  onOptCodePermissionsChange: (value: OptCodePermissionsState) => void;
  projects: SettingsProject[];
};
