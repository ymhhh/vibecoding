export type Priority = 'low' | 'medium' | 'high' | 'urgent';

/** Maps to project branch prefixes: feature → featurePrefix, bugfix → bugfixPrefix, hotfix → hotfixPrefix. */
export type IssueKind = 'feature' | 'bugfix' | 'hotfix';

export type IssueStatus = 'requirements' | 'backlog' | 'in_progress' | 'in_review' | 'completed';

export interface GitRepo {
  id: string;
  name: string;
  path: string; // 本地 Git 仓库绝对/相对磁盘路径 (例如 /Users/dev/workspace/order-service)
  defaultBranch: string;
  language: string;
  description?: string;
  filesCount?: number;
  url?: string; // 可选的远程备份 URL
  setupCommand?: string;
  testCommand?: string;
  lintCommand?: string;
}

export interface ModelConfig {
  useCustomOpenAI: boolean;
  openAIBaseUrl: string; // full chat completions URL, e.g. https://api.openai.com/v1/chat/completions
  openAIApiKey: string;
  openAIModel: string; // e.g. gpt-4o, gpt-4o-mini, deepseek-chat, deepseek-r1
  temperature: number;
  /** Wire protocol for the endpoint: 'chat_completions' (default) or 'responses'. */
  apiProtocol?: 'chat_completions' | 'responses' | '';
  keyConfigured?: boolean;
  keyHint?: string;
}

export interface BranchPrefixConfig {
  featurePrefix: string;  // 特性开发分支前缀 (如 feature/ 或 feat/)
  bugfixPrefix: string;   // 缺陷修复分支前缀 (如 fix/ 或 bugfix/)
  hotfixPrefix: string;   // 紧急修复分支前缀 (如 hotfix/)
  refactorPrefix: string; // 代码重构分支前缀 (如 refactor/)
  autoDevPrefix: string;  // AI自治改码分支前缀 (如 ai-dev/ 或 vibe/)
  releasePrefix: string;  // 版本发布分支前缀 (如 release/)
}

export interface Project {
  id: string;
  name: string;
  description: string;
  gitRepos: GitRepo[];
  branchPrefixConfig?: BranchPrefixConfig; // 工程级别 Git 分支前缀规范配置
  customModelConfig?: ModelConfig;
  useCustomModelConfig: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai' | 'system';
  text: string;
  timestamp: string;
}

export interface SpecFileChange {
  filePath: string;
  repoName: string;
  action: 'create' | 'modify' | 'delete';
  summary: string;
  symbol?: string;
  verified?: boolean;
  originalCode?: string;
  modifiedCode?: string;
}

export interface ReqDoc {
  title?: string;
  summary?: string;
  scope?: string;
  nonGoals?: string;
  acceptance?: string;
  constraints?: string;
  rawMarkdown: string;
  acceptedAt?: string;
  updatedAt?: string;
}

export type DocPhase = 'requirement' | 'design';

export interface DevSpec {
  title: string;
  summary: string;
  architectureDesign: string;
  fileChanges: SpecFileChange[];
  implementationSteps: string[];
  testCases: string[];
  rawMarkdown: string;
  acceptedAt?: string;
  updatedAt: string;
}

export type SubRequirementStatus = 'pending' | 'ready' | 'in_progress' | 'done' | 'failed';

export interface SubRequirement {
  id: string;
  title: string;
  description: string;
  order: number;
  status: SubRequirementStatus;
  devSpec?: DevSpec;
  chatMessages: ChatMessage[];
  autoDevLogs: AutoDevLog[];
  commitSha?: string;
  reviewFeedback?: string;
}

export interface AutoDevLog {
  id: string;
  timestamp: string;
  phase:
    | 'analyzing'
    | 'branching'
    | 'setup'
    | 'coding'
    | 'agent'
    | 'testing'
    | 'linting'
    | 'committing'
    | 'completed'
    | 'failed';
  message: string;
  details?: string;
}

export interface DiffComment {
  id: string;
  repoId: string;
  path: string;
  side: 'new' | 'old' | string;
  startLine: number;
  endLine: number;
  quote?: string;
  body: string;
  createdAt: string;
}

export interface QualityGate {
  testsRan: boolean;
  testsPassed: boolean;
  testsOutput?: string;
  lintRan: boolean;
  lintPassed: boolean;
  lintOutput?: string;
  repairRounds: number;
}

export interface WorktreeRef {
  repoId: string;
  repoName: string;
  path: string;
}

export interface PRInfo {
  id: string;
  branchName: string;
  title: string;
  description: string;
  author: string;
  createdAt: string;
  status: 'open' | 'merged' | 'rejected';
  diffStats: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
  worktrees?: WorktreeRef[];
  baseBranch?: string;
  quality?: QualityGate;
  executor?: string;
  remoteUrl?: string;
}

export type ExecutorType = 'llm' | 'agent';
export type ExecutorPreset = 'claude' | 'cursor' | 'codex' | 'custom';

export interface ExecutorConfig {
  type: ExecutorType;
  preset?: ExecutorPreset | string;
  command?: string;
  args?: string[];
  promptStdin?: boolean;
  timeoutSec: number;
  maxHeal: number;
}

export interface ExecutorProbe {
  id: string;
  name: string;
  type: string;
  preset?: string;
  available: boolean;
  binary?: string;
  hint?: string;
}

export interface DiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  truncated?: boolean;
}

export interface DiffCommit {
  sha: string;
  subject: string;
  date?: string;
}

export interface RepoDiff {
  repoId: string;
  repoName: string;
  baseBranch: string;
  stats: { additions: number; deletions: number; filesChanged: number };
  ahead: number;
  behind: number;
  files: DiffFile[];
  commits: DiffCommit[];
  error?: string;
}

export interface IssueDiff {
  issueId: string;
  branchName: string;
  baseBranch?: string;
  executor?: string;
  quality?: QualityGate;
  repos: RepoDiff[];
}

export interface IssueAttachment {
  id: string;
  name: string;
  mime?: string;
  size: number;
  kind: 'text' | 'image' | 'file';
  text?: string;
  dataUrl?: string;
}

export interface Issue {
  id: string;
  projectId: string;
  title: string;
  description: string;
  attachments?: IssueAttachment[];
  priority: Priority;
  /** feature | bugfix | hotfix — drives git branch prefix during auto-dev. */
  kind?: IssueKind;
  status: IssueStatus;
  associatedRepoIds: string[];
  assignee: string;
  chatMessages: ChatMessage[];
  reqDoc?: ReqDoc;
  docPhase?: DocPhase;
  devSpec?: DevSpec;
  subRequirements?: SubRequirement[];
  currentSubId?: string;
  reworkSubId?: string;
  autoDevLogs: AutoDevLog[];
  autoDevProgress: number; // 0 - 100
  prInfo?: PRInfo;
  reviewFeedback?: string;
  reviewComments?: DiffComment[];
  agentSessionId?: string;
  pendingLlm?: PendingLLMSession;
  createdAt: string;
  updatedAt: string;
}

export interface PendingLLMSession {
  prompt: string;
  scope?: string;
  split?: boolean;
  syncSpec?: boolean;
  syncReqDoc?: boolean;
  partial?: string;
  error?: string;
  attempts?: number;
  updatedAt?: string;
}
