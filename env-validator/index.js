import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REQUIRED_ENV_VARS = [
  { name: 'NODE_ENV', required: true, pattern: /^(development|staging|production)$/, description: 'Application environment' },
  { name: 'DATABASE_URL', required: true, pattern: /^postgres:\/\/|mysql:\/\/|mongodb:\/\//, description: 'Database connection string' },
  { name: 'JWT_SECRET', required: true, pattern: /^.{32,}$/, description: 'JWT signing secret (min 32 chars)' },
  { name: 'API_KEY', required: false, pattern: /^.+$/, description: 'External API key' }
];

const COMMON_SECRETS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'SENDGRID_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'GITHUB_TOKEN',
  'GITLAB_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'REDIS_URL',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'ENCRYPTION_IV'
];

function findEnvFiles(dirPath) {
  const envNames = ['.env', '.env.local', '.env.production', '.env.development', '.env.staging', '.env.example', '.env.sample'];
  const found = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isFile()) {
        if (envNames.includes(entry.name)) {
          found.push({ name: entry.name, path: fullPath });
        }
      }
    }
  } catch (error) {}
  
  return found;
}

function parseEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const vars = {};
    const comments = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('#')) {
        comments.push({ line: index + 1, text: trimmed.substring(1).trim() });
      } else if (trimmed.includes('=')) {
        const [key, ...valueParts] = trimmed.split('=');
        const value = valueParts.join('=').trim();
        
        if (key && key.trim()) {
          vars[key.trim()] = {
            value,
            hasValue: value.length > 0,
            isEmpty: value === '' || value === '""' || value === "''",
            commented: false,
            line: index + 1
          };
        }
      }
    });
    
    return { vars, comments, filePath };
  } catch (error) {
    return { vars: {}, comments: [], filePath, error: error.message };
  }
}

function validateEnvValue(name, value, requirements) {
  const issues = [];
  
  if (!value || value === '') {
    if (requirements.required) {
      issues.push({ type: 'error', message: `${name} is required but not set` });
    }
    return issues;
  }
  
  if (requirements.pattern && !requirements.pattern.test(value)) {
    issues.push({ 
      type: 'error', 
      message: `${name} does not match expected pattern: ${requirements.description}` 
    });
  }
  
  if (value.includes(' ')) {
    issues.push({ type: 'warning', message: `${name} contains spaces` });
  }
  
  if (value.includes('localhost') || value.includes('127.0.0.1')) {
    if (name.toUpperCase().includes('PRODUCTION')) {
      issues.push({ type: 'error', message: `${name} contains localhost - not suitable for production` });
    }
  }
  
  return issues;
}

function checkSecretRotation(envVars) {
  const issues = [];
  const secretNames = COMMON_SECRETS.filter(s => envVars[s]);
  
  secretNames.forEach(secret => {
    const value = envVars[secret];
    
    if (value && value.length < 16) {
      issues.push({ type: 'warning', message: `${secret} may be too short for secure rotation` });
    }
    
    if (value && (value.includes(' ') || value.includes('\t'))) {
      issues.push({ type: 'error', message: `${secret} contains whitespace` });
    }
  });
  
  return issues;
}

function checkForHardcodedPatterns(content) {
  const issues = [];
  const hardcodedPatterns = [
    { pattern: /password\s*=\s*['"][^'"]{1,8}['"]/gi, secret: 'password' },
    { pattern: /api[_-]?key\s*=\s*['"][^'"]{1,20}['"]/gi, secret: 'API key' },
    { pattern: /secret\s*=\s*['"][^'"]{1,20}['"]/gi, secret: 'secret' },
    { pattern: /token\s*=\s*['"][^'"]{1,20}['"]/gi, secret: 'token' }
  ];
  
  hardcodedPatterns.forEach(({ pattern, secret }) => {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      issues.push({
        type: 'error',
        message: `Potential hardcoded ${secret} found in source`,
        context: match[0].substring(0, 50)
      });
    }
  });
  
  return issues;
}

export const EnvValidatorPlugin = async ({ project, client, $, directory, worktree }) => {
  const targetDir = worktree || directory || process.cwd();
  
  return {
    tool: {
      env_validate: {
        description: 'Validate environment configuration',
        args: {
          path: { type: 'string', description: 'Path to project directory' },
          required: { type: 'string', description: 'Comma-separated required vars' }
        },
        async execute({ path: projectPath, required }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const envFiles = findEnvFiles(dirToScan);
          
          const allVars = {};
          const allIssues = [];
          
          envFiles.forEach(({ name, path: filePath }) => {
            const parsed = parseEnvFile(filePath);
            
            Object.keys(parsed.vars).forEach(key => {
              if (!allVars[key]) {
                allVars[key] = { 
                  value: parsed.vars[key].value, 
                  files: [name],
                  line: parsed.vars[key].line
                };
              } else {
                allVars[key].files.push(name);
              }
            });
          });
          
          const requiredVars = required 
            ? required.split(',').map(v => v.trim()).map(name => ({ name, required: true, pattern: /^.+$/ }))
            : REQUIRED_ENV_VARS;
          
          const validationResults = requiredVars.map(req => {
            const envVar = allVars[req.name];
            const value = envVar?.value || '';
            
            const issues = validateEnvValue(req.name, value, req);
            
            return {
              name: req.name,
              required: req.required,
              present: envVar && envVar.value && !envVar.isEmpty,
              value: req.name.includes('SECRET') || req.name.includes('KEY') || req.name.includes('PASSWORD')
                ? value.substring(0, 4) + '***' + value.substring(value.length - 4)
                : value.substring(0, 50),
              files: envVar?.files || [],
              issues
            };
          });
          
          const present = validationResults.filter(r => r.present).length;
          const missing = validationResults.filter(r => !r.present && r.required);
          
          const rotationIssues = checkSecretRotation(allVars);
          
          return {
            passed: missing.length === 0,
            summary: {
              totalRequired: validationResults.filter(r => r.required).length,
              present: present,
              missing: missing.map(r => r.name)
            },
            variables: validationResults,
            issues: [...validationResults.flatMap(r => r.issues), ...rotationIssues],
            envFiles: envFiles.map(f => f.name),
            recommendation: missing.length > 0 
              ? `Set these required variables: ${missing.map(r => r.name).join(', ')}`
              : rotationIssues.length > 0 
                ? `Address secret rotation issues`
                : 'Environment configuration looks good'
          };
        }
      },
      
      env_check: {
        description: 'Check for required secrets in environment',
        args: {
          path: { type: 'string', description: 'Project path' },
          secrets: { type: 'string', description: 'Secrets to check (comma-separated)' }
        },
        async execute({ path: projectPath, secrets }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const secretsToCheck = secrets 
            ? secrets.split(',').map(s => s.trim().toUpperCase())
            : COMMON_SECRETS;
          
          const envFiles = findEnvFiles(dirToScan);
          const envVars = {};
          
          envFiles.forEach(({ path: filePath }) => {
            const parsed = parseEnvFile(filePath);
            Object.keys(parsed.vars).forEach(key => {
              envVars[key.toUpperCase()] = parsed.vars[key].value;
            });
          });
          
          const found = [];
          const missing = [];
          
          secretsToCheck.forEach(secret => {
            if (envVars[secret] && envVars[secret].length > 0) {
              found.push({
                name: secret,
                present: true,
                masked: envVars[secret].substring(0, 4) + '***'
              });
            } else {
              missing.push(secret);
            }
          });
          
          return {
            passed: missing.length === 0,
            checked: secretsToCheck.length,
            found,
            missing,
            percentage: Math.round((found.length / secretsToCheck.length) * 100),
            recommendation: missing.length > 0 
              ? `Configure these secrets: ${missing.join(', ')}`
              : 'All checked secrets are present'
          };
        }
      },
      
      env_audit: {
        description: 'Audit environment configuration completeness',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const envFiles = findEnvFiles(dirToScan);
          
          let allVars = {};
          
          envFiles.forEach(({ path: filePath }) => {
            const parsed = parseEnvFile(filePath);
            Object.keys(parsed.vars).forEach(key => {
              allVars[key.toUpperCase()] = parsed.vars[key];
            });
          });
          
          const envFile = envFiles.find(f => f.name === '.env.example') || envFiles[0];
          const exampleVars = envFile ? parseEnvFile(envFile.path).vars : {};
          
          const hasExample = envFiles.some(f => f.name === '.env.example');
          const hasLocal = envFiles.some(f => f.name === '.env.local');
          const hasProduction = envFiles.some(f => f.name === '.env.production');
          
          const missingExample = [];
          const unusedExample = [];
          
          Object.keys(exampleVars).forEach(key => {
            if (!allVars[key.toUpperCase()]) {
              missingExample.push(key);
            }
          });
          
          Object.keys(allVars).forEach(key => {
            if (!exampleVars[key.toUpperCase()] && !exampleVars[key] && !exampleVars[key.toLowerCase()]) {
              unusedExample.push(key);
            }
          });
          
          const hasSecrets = Object.keys(allVars).some(k => 
            k.includes('SECRET') || k.includes('KEY') || k.includes('PASSWORD') || k.includes('TOKEN')
          );
          
          const hasDatabaseUrl = Object.keys(allVars).some(k => 
            k.includes('DATABASE') && k.includes('URL')
          );
          
          const hasAuth = Object.keys(allVars).some(k => 
            k.includes('AUTH') || k.includes('JWT') || k.includes('SESSION')
          );
          
          return {
            passed: hasExample && missingExample.length === 0,
            files: {
              example: hasExample,
              local: hasLocal,
              production: hasProduction
            },
            completeness: {
              hasSecrets,
              hasDatabaseUrl,
              hasAuth
            },
            missingFromExample: missingExample.slice(0, 10),
            notDocumented: unusedExample.slice(0, 10),
            recommendation: !hasExample 
              ? 'Create .env.example with all required variables'
              : missingExample.length > 0 
                ? `Add ${missingExample.length} variables to .env.example`
                : 'Environment configuration is well documented'
          };
        }
      }
    }
  };
};