import type { AgentCategoryContentSectionProps } from '../types';
import type { McpProject } from '../../../../../mcp/types';
import { McpServers } from '../../../../../mcp';

import AccountContent from './content/AccountContent';
import PermissionsContent from './content/PermissionsContent';

export default function AgentCategoryContentSection({
  selectedAgent,
  selectedCategory,
  agentContextById,
  optcodePermissions,
  onOptCodePermissionsChange,
  projects,
}: AgentCategoryContentSectionProps) {
  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      {selectedCategory === 'account' && (
        <AccountContent
          agent={selectedAgent}
          authStatus={agentContextById[selectedAgent].authStatus}
          onLogin={agentContextById[selectedAgent].onLogin}
        />
      )}

      {selectedCategory === 'permissions' && selectedAgent === 'optcode' && (
        <PermissionsContent
          agent="optcode"
          skipPermissions={optcodePermissions.skipPermissions}
          onSkipPermissionsChange={(value) => {
            onOptCodePermissionsChange({ ...optcodePermissions, skipPermissions: value });
          }}
          allowedTools={optcodePermissions.allowedTools}
          onAllowedToolsChange={(value) => {
            onOptCodePermissionsChange({ ...optcodePermissions, allowedTools: value });
          }}
          disallowedTools={optcodePermissions.disallowedTools}
          onDisallowedToolsChange={(value) => {
            onOptCodePermissionsChange({ ...optcodePermissions, disallowedTools: value });
          }}
        />
      )}

      {selectedCategory === 'mcp' && (
        // SettingsProject.name is populated from the DB projectId by
        // normalizeProjectForSettings, so we can map it straight through.
        <McpServers
          selectedProvider={selectedAgent}
          currentProjects={projects.map<McpProject>((project) => ({
            projectId: project.name,
            displayName: project.displayName,
            fullPath: project.fullPath,
            path: project.path,
          }))}
        />
      )}
    </div>
  );
}
