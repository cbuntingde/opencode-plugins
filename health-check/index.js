import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'build', 'ci', 'revert'];
const MAX_COMMIT_LENGTH = 72;

function isGitRepository(dirPath) {
  try {
    const gitDir = path.join(dirPath, '.git');
    return fs.existsSync(gitDir);
  } catch {
    return false;
  }
}

function getGitCommits(dirPath, count = 10) {
  try {
    const output = execSync(`git log --oneline -${count}`, { cwd: dirPath, encoding: 'utf-8' });
    return output.trim().split('\n').map(line => {
      const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
      return match ? { hash: match[1], message: match[2] } : null;
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function validateCommitMessage(message, index = 0) {
  const issues = [];
  const warnings = [];
  
  if (message.length > MAX_COMMIT_LENGTH) {
    issues.push({
      type: 'length',
      severity: 'warning',
      message: `Commit message exceeds ${MAX_COMMIT_LENGTH} characters`
    });
  }
  
  if (!message.includes(':')) {
    issues.push({
      type: 'format',
      severity: 'error',
      message: 'Missing type prefix (e.g., "feat:", "fix:")'
    });
  }
  
  const colonIndex = message.indexOf(':');
  if (colonIndex > -1) {
    const type = message.substring(0, colonIndex).toLowerCase();
    
    if (!COMMIT_TYPES.includes(type)) {
      issues.push({
        type: 'type',
        severity: 'error',
        message: `Invalid commit type: "${type}". Valid types: ${COMMIT_TYPES.join(', ')}`
      });
    }
    
    const afterType = message.substring(colonIndex + 1).trim();
    if (!afterType || afterType.length === 0) {
      issues.push({
        type: 'content',
        severity: 'error',
        message: 'Missing commit subject after type prefix'
      });
    }
    
    if (afterType && afterType[0] !== afterType[0].toUpperCase() && !afterType.startsWith('Merge')) {
      warnings.push({
        type: 'capitalization',
        severity: 'low',
        message: 'Commit subject should start with capital letter'
      });
    }
  }
  
  const hasBody = message.includes('\n\n');
  if (message.length > 50 && !hasBody) {
    warnings.push({
      type: 'body',
      severity: 'low',
      message: 'Long commit message - consider adding a body for context'
    });
  }
  
  return { issues, warnings };
}

function checkForSecretsInCommits(commits, dirPath) {
  const secrets = [];
  const secretPatterns = [
    /api[_-]?key\s*[:=]\s*[a-zA-Z0-9]{20,}/i,
    /token\s*[:=]\s*[a-zA-Z0-9]{20,}/i,
    /password\s*[:=]\s*[^\s]+/i,
    /secret\s*[:=]\s*[^\s]+/i,
    /sk_live_[a-zA-Z0-9]{24,}/i,
    /AKIA[0-9A-Z]{16}/i
  ];
  
  commits.forEach(commit => {
    secretPatterns.forEach(pattern => {
      if (pattern.test(commit.message)) {
        secrets.push({
          hash: commit.hash,
          message: commit.message.substring(0, 50),
          type: 'potential-secret'
        });
      }
    });
  });
  
  return secrets;
}

function checkBranchNaming(dirPath) {
  const issues = [];
  
  try {
    const branches = execSync('git branch --format=%(refname:short)', { cwd: dirPath, encoding: 'utf-8' });
    const branchList = branches.trim().split('\n').filter(Boolean);
    
    branchList.forEach(branch => {
      if (branch === 'main' || branch === 'master' || branch === 'develop') return;
      
      const validPatterns = [
        /^feature\/.+$/,
        /^fix\/.+$/,
        /^bugfix\/.+$/,
        /^hotfix\/.+$/,
        /^release\/.+$/,
        /^ chore\/.+$/,
        /^docs\/.+$/,
        /^[a-z]{2,4}-\d+$/,
        /^TASK-[0-9]+$/i
      ];
      
      if (!validPatterns.some(p => p.test(branch))) {
        issues.push({
          branch,
          type: 'naming',
          severity: 'info',
          message: `Branch "${branch}" doesn't follow naming conventions`,
          suggestion: 'Use pattern: feature/..., fix/..., chore/..., TASK-123'
        });
      }
    });
    
  } catch (error) {
    issues.push({ type: 'error', severity: 'low', message: 'Could not list branches' });
  }
  
  return issues;
}

function checkUncommittedFiles(dirPath) {
  const issues = [];
  
  try {
    const status = execSync('git status --porcelain', { cwd: dirPath, encoding: 'utf-8' });
    const changes = status.trim().split('\n').filter(Boolean);
    
    if (changes.length > 0) {
      const secretPatterns = ['.env', '.pem', '.key', 'credentials', 'secrets'];
      
      changes.forEach(change => {
        const filePath = change.substring(3).trim();
        
        secretPatterns.forEach(secret => {
          if (filePath.toLowerCase().includes(secret.toLowerCase())) {
            issues.push({
              file: filePath,
              type: 'secret-risk',
              severity: 'critical',
              message: `Uncommitted file may contain secrets: ${filePath}`
            });
          }
        });
        
        if (filePath.endsWith('.log')) {
          issues.push({
            file: filePath,
            type: 'log-file',
            severity: 'low',
            message: 'Log file should not be committed'
          });
        }
      });
    }
    
  } catch (error) {
    issues.push({ type: 'error', severity: 'low', message: 'Could not check git status' });
  }
  
  return issues;
}

function checkGpgSigning(dirPath) {
  try {
    const output = execSync('git log --format="%GK" -1', { cwd: dirPath, encoding: 'utf-8' });
    const lastCommitKey = output.trim();
    
    if (lastCommitKey === 'GIT_COMMITTER_DATE' || lastCommitKey === '') {
      return {
        enabled: false,
        message: 'GPG signing is not configured for this repository'
      };
    }
    
    return {
      enabled: true,
      keyId: lastCommitKey,
      message: 'GPG signing is configured'
    };
  } catch {
    return {
      enabled: false,
      message: 'Could not verify GPG signing status'
    };
  }
}

export const GitHygienePlugin = async ({ project, client, $, directory, worktree }) => {
  const targetDir = worktree || directory || process.cwd();
  const isGit = isGitRepository(targetDir);
  
  return {
    tool: {
      git_validate: {
        description: 'Validate git practices and commit messages',
        args: {
          path: { type: 'string', description: 'Project path' },
          commits: { type: 'number', description: 'Number of commits to check' }
        },
        async execute({ path: projectPath, commits = 10 }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          
          if (!isGitRepository(dirToScan)) {
            return {
              passed: false,
              error: 'Not a git repository',
              recommendation: 'Initialize git repository with "git init"'
            };
          }
          
          const commitsList = getGitCommits(dirToScan, commits);
          const validationResults = commitsList.map((commit, index) => {
            const { issues, warnings } = validateCommitMessage(commit.message, index);
            return { hash: commit.hash, message: commit.message, issues, warnings };
          });
          
          const allIssues = validationResults.flatMap(r => r.issues);
          const allWarnings = validationResults.flatMap(r => r.warnings);
          
          const secretIssues = checkForSecretsInCommits(commitsList, dirToScan);
          
          const branchIssues = checkBranchNaming(dirToScan);
          
          const uncommittedIssues = checkUncommittedFiles(dirToScan);
          
          const gpgStatus = checkGpgSigning(dirToScan);
          
          const criticalIssues = allIssues.filter(i => i.severity === 'error' || i.type === 'secret-risk');
          
          return {
            passed: criticalIssues.length === 0,
            repository: isGit,
            summary: {
              commitsChecked: commitsList.length,
              commitIssues: allIssues.length,
              commitWarnings: allWarnings.length,
              secretIssues: secretIssues.length,
              branchIssues: branchIssues.length,
              uncommittedFiles: uncommittedIssues.length
            },
            commits: validationResults,
            secretIssues,
            branchIssues,
            uncommittedFiles: uncommittedIssues,
            gpg: gpgStatus,
            recommendation: criticalIssues.length > 0 
              ? 'Fix commit message format issues before merging'
              : secretIssues.length > 0 
                ? 'Remove potential secrets from commit history'
                : 'Git hygiene looks good'
          };
        }
      },
      
      git_status: {
        description: 'Check git working directory status',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          
          if (!isGitRepository(dirToScan)) {
            return {
              isGitRepository: false,
              recommendation: 'Initialize git repository'
            };
          }
          
          try {
            const status = execSync('git status --porcelain', { cwd: dirToScan, encoding: 'utf-8' });
            const changes = status.trim().split('\n').filter(Boolean);
            
            const staged = changes.filter(c => c.startsWith('A') || c.startsWith('M'));
            const unstaged = changes.filter(c => c.startsWith('??') || c.startsWith(' M') || c.startsWith('??'));
            
            const forbiddenPatterns = ['.env', '.pem', '.key', 'credentials', 'secrets', '.log'];
            const forbiddenFiles = unstaged.filter(f => 
              forbiddenPatterns.some(p => f.substring(3).toLowerCase().includes(p.toLowerCase()))
            );
            
            const branch = execSync('git branch --show-current', { cwd: dirToScan, encoding: 'utf-8' }).trim();
            const lastCommit = execSync('git log -1 --oneline', { cwd: dirToScan, encoding: 'utf-8' }).trim();
            
            return {
              isGitRepository: true,
              branch,
              lastCommit,
              changes: {
                total: changes.length,
                staged: staged.length,
                unstaged: unstaged.length
              },
              forbiddenFiles,
              warning: forbiddenFiles.length > 0 
                ? `Found ${forbiddenFiles.length} potentially sensitive uncommitted files`
                : null,
              recommendation: forbiddenFiles.length > 0 
                ? 'Remove or ignore sensitive files before committing'
                : changes.length === 0 
                  ? 'Working directory is clean'
                  : 'Review and commit or discard changes'
            };
          } catch (error) {
            return {
              isGitRepository: true,
              error: 'Could not read git status',
              recommendation: 'Check git configuration'
            };
          }
        }
      },
      
      commit_style_check: {
        description: 'Check commit message style',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          
          if (!isGitRepository(dirToScan)) {
            return { error: 'Not a git repository' };
          }
          
          const commitsList = getGitCommits(dirToScan, 20);
          const styleIssues = [];
          
          commitsList.forEach(commit => {
            const { issues } = validateCommitMessage(commit.message);
            
            if (issues.some(i => i.type === 'format')) {
              styleIssues.push({ hash: commit.hash, message: commit.message });
            }
          });
          
          const typeCounts = {};
          commitsList.forEach(commit => {
            const colonIndex = commit.message.indexOf(':');
            if (colonIndex > -1) {
              const type = commit.message.substring(0, colonIndex).toLowerCase();
              typeCounts[type] = (typeCounts[type] || 0) + 1;
            }
          });
          
          return {
            commitsChecked: commitsList.length,
            styleIssues: styleIssues.length,
            issuePercentage: Math.round((styleIssues.length / commitsList.length) * 100),
            examples: styleIssues.slice(0, 5),
            typeDistribution: typeCounts,
            recommendation: styleIssues.length > 0 
              ? `${styleIssues.length} commits don't follow conventional commits`
              : 'All commits follow conventional format'
          };
        }
      }
    }
  };
};