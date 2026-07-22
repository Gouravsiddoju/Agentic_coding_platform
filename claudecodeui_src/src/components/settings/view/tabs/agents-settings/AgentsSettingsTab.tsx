import { useMemo, useState } from 'react';

import type { AgentCategory, AgentProvider } from '../../../types/types';

import type { AgentContext, AgentsSettingsTabProps } from './types';
import AgentCategoryContentSection from './sections/AgentCategoryContentSection';
import AgentCategoryTabsSection from './sections/AgentCategoryTabsSection';
import AgentSelectorSection from './sections/AgentSelectorSection';

export default function AgentsSettingsTab({
  providerAuthStatus,
  onProviderLogin,
  optcodePermissions,
  onOptCodePermissionsChange,
  projects,
}: AgentsSettingsTabProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentProvider>('optcode');
  const [selectedCategory, setSelectedCategory] = useState<AgentCategory>('account');

  const visibleAgents = useMemo<AgentProvider[]>(() => {
    return ['optcode'];
  }, []);

  const agentContextById = useMemo<Record<AgentProvider, AgentContext>>(() => ({
    optcode: {
      authStatus: providerAuthStatus.optcode,
      onLogin: () => onProviderLogin('optcode'),
    },
  }), [
    onProviderLogin,
    providerAuthStatus.optcode,
  ]);

  return (
    <div className="-mx-4 -mb-4 -mt-2 flex min-h-[300px] flex-col overflow-hidden md:-mx-6 md:-mb-6 md:-mt-2 md:min-h-[500px]">
      <AgentSelectorSection
        agents={visibleAgents}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        agentContextById={agentContextById}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        <AgentCategoryTabsSection
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
        />

        <AgentCategoryContentSection
          selectedAgent={selectedAgent}
          selectedCategory={selectedCategory}
          agentContextById={agentContextById}
          optcodePermissions={optcodePermissions}
          onOptCodePermissionsChange={onOptCodePermissionsChange}
          projects={projects}
        />
      </div>
    </div>
  );
}
