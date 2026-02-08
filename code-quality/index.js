import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPLEXITY_THRESHOLDS = {
  cyclomatic: 10,
  cognitive: 15,
  maxLines: 100,
  maxDepth: 4
};

function scanFileForQuality(filePath) {
  const issues = [];
  const stats = {
    lines: 0,
    functions: 0,
    classes: 0,
    comments: 0,
    blankLines: 0,
    complexity: 0,
    maxIndent: 0
  };
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    stats.lines = lines.length;
    
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      
      if (trimmed === '') {
        stats.blankLines++;
      } else if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#')) {
        stats.comments++;
      }
      
      const indent = line.search(/\S/);
      stats.maxIndent = Math.max(stats.maxIndent, indent);
      
      if (trimmed.startsWith('function ') || trimmed.includes('=>') || 
          trimmed.startsWith('class ') || trimmed.startsWith('def ') || trimmed.startsWith('func ')) {
        stats.functions++;
      }
      
      if (trimmed.startsWith('class ')) {
        stats.classes++;
      }
      
      const ifCount = (trimmed.match(/if|else if|elif|else/g) || []).length;
      const switchCount = (trimmed.match(/case|default/g) || []).length;
      const loopCount = (trimmed.match(/for|while|do/g) || []).length;
      const tryCount = (trimmed.match(/try|catch|except|finally/g) || []).length;
      stats.complexity += ifCount + switchCount + loopCount + tryCount;
      
      if (trimmed.length > 120) {
        issues.push({
          type: 'style',
          severity: 'low',
          line: index + 1,
          message: `Line exceeds 120 characters (${trimmed.length})`
        });
      }
    });
    
    if (stats.lines > COMPLEXITY_THRESHOLDS.maxLines) {
      issues.push({
        type: 'maintainability',
        severity: 'medium',
        message: `File has ${stats.lines} lines (recommended max: ${COMPLEXITY_THRESHOLDS.maxLines})`
      });
    }
    
  } catch (error) {
    issues.push({
      type: 'error',
      severity: 'low',
      message: `Could not scan file: ${error.message}`
    });
  }
  
  return { issues, stats };
}

function findCodeFiles(dirPath) {
  const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rb', '.php', '.rs'];
  const found = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          found.push(fullPath);
        }
      } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
        found.push(...findCodeFiles(fullPath));
      }
    }
  } catch (error) {}
  
  return found;
}

function checkNamingConventions(filePath, ext) {
  const issues = [];
  const fileName = path.basename(filePath, ext);
  
  if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) {
    const camelCasePattern = /^[a-z][a-zA-Z0-9]*$/;
    const componentPattern = /^[A-Z][a-zA-Z0-9]*\.?(jsx|tsx)?$/;
    
    if (!camelCasePattern.test(fileName) && !componentPattern.test(fileName) && !fileName.includes('.')) {
      issues.push({
        type: 'naming',
        severity: 'low',
        file: fileName,
        message: `Filename should use camelCase or PascalCase`
      });
    }
  }
  
  if (ext === '.py') {
    const snakeCasePattern = /^[a-z][a-z0-9_]*$/;
    if (!snakeCasePattern.test(fileName)) {
      issues.push({
        type: 'naming',
        severity: 'low',
        file: fileName,
        message: `Python filename should use snake_case`
      });
    }
  }
  
  return issues;
}

function detectCodeSmells(content) {
  const smells = [];
  
  const godObjects = content.match(/class\s+\w+\s*{[^}]{2000,}/g);
  if (godObjects && godObjects.length > 0) {
    smells.push({
      type: 'god-object',
      severity: 'high',
      message: `Potential god object class detected`
    });
  }
  
  const deepNesting = content.match(/{\s*{[^}]*{\s*[^}]*}/g);
  if (deepNesting && deepNesting.length > 3) {
    smells.push({
      type: 'deep-nesting',
      severity: 'medium',
      message: `Multiple instances of deep nesting found`
    });
  }
  
  const longParams = content.match(/function\s+\w+\s*\([^)]{100,}\)/g);
  if (longParams) {
    smells.push({
      type: 'long-parameter-list',
      severity: 'medium',
      count: longParams.length,
      message: `${longParams.length} functions have long parameter lists`
    });
  }
  
  return smells;
}

export const CodeQualityPlugin = async ({ project, client, $, directory, worktree }) => {
  const targetDir = worktree || directory || process.cwd();
  
  return {
    tool: {
      lint_check: {
        description: 'Run code quality checks',
        args: {
          path: { type: 'string', description: 'Project path' },
          strict: { type: 'boolean', description: 'Enable strict mode' }
        },
        async execute({ path: projectPath, strict = false }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const files = findCodeFiles(dirToScan);
          
          const allIssues = [];
          let totalFiles = 0;
          let totalLines = 0;
          
          for (const filePath of files) {
            const ext = path.extname(filePath);
            const { issues, stats } = scanFileForQuality(filePath);
            const namingIssues = checkNamingConventions(filePath, ext);
            
            totalFiles++;
            totalLines += stats.lines;
            
            if (strict && issues.length > 0) {
              issues.forEach(issue => {
                allIssues.push({ ...issue, file: path.basename(filePath) });
              });
            }
            
            namingIssues.forEach(issue => {
              allIssues.push({ ...issue, file: path.basename(filePath) });
            });
          }
          
          const critical = allIssues.filter(i => i.severity === 'high' && (i.type === 'complexity' || i.type === 'maintainability'));
          const passed = critical.length === 0;
          
          return {
            passed,
            summary: {
              filesScanned: totalFiles,
              totalLines,
              totalIssues: allIssues.length,
              bySeverity: {
                critical: critical.length,
                high: allIssues.filter(i => i.severity === 'high').length,
                medium: allIssues.filter(i => i.severity === 'medium').length,
                low: allIssues.filter(i => i.severity === 'low').length
              }
            },
            issues: allIssues.slice(0, 50),
            recommendation: critical.length > 0 
              ? `Fix ${critical.length} critical issues before production`
              : 'Code quality is good'
          };
        }
      },
      
      type_check: {
        description: 'Check TypeScript/JavaScript type safety',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const files = findCodeFiles(dirToScan);
          
          const tsFiles = files.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
          const issues = [];
          
          for (const filePath of tsFiles) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              
              const anyUsages = content.match(/:\s*any\b|as\s+any|\|\s*any\b/gi);
              if (anyUsages && anyUsages.length > 3) {
                issues.push({
                  file: path.basename(filePath),
                  type: 'any-usage',
                  count: anyUsages.length,
                  message: `${anyUsages.length} 'any' type usages found`
                });
              }
              
              const nonNullAssert = content.match(/!/g);
              if (nonNullAssert && nonNullAssert.length > 5) {
                issues.push({
                  file: path.basename(filePath),
                  type: 'non-null-assertion',
                  count: nonNullAssert.length,
                  message: 'Excessive non-null assertions'
                });
              }
              
            } catch (error) {}
          }
          
          const criticalTypeIssues = issues.filter(i => i.type === 'any-usage' && i.count > 5);
          
          return {
            passed: criticalTypeIssues.length === 0,
            typescriptFiles: tsFiles.length,
            issues,
            score: Math.max(0, 100 - (issues.length * 5)),
            recommendation: criticalTypeIssues.length > 0 
              ? 'Eliminate excessive any type usage'
              : 'Code is type-safe'
          };
        }
      },
      
      complexity_check: {
        description: 'Analyze code complexity',
        args: {
          path: { type: 'string', description: 'Project path' },
          threshold: { type: 'number', description: 'Complexity threshold' }
        },
        async execute({ path: projectPath, threshold = 10 }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const files = findCodeFiles(dirToScan);
          
          const results = [];
          
          for (const filePath of files) {
            const { stats, issues } = scanFileForQuality(filePath);
            
            const smells = [];
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              smells.push(...detectCodeSmells(content));
            } catch (error) {}
            
            const complexity = Math.round(stats.complexity / Math.max(stats.functions, 1));
            
            if (complexity > threshold || stats.lines > COMPLEXITY_THRESHOLDS.maxLines) {
              results.push({
                file: path.basename(filePath),
                path: filePath,
                metrics: {
                  lines: stats.lines,
                  functions: stats.functions,
                  complexity: stats.complexity,
                  averageComplexity: complexity
                },
                smells,
                exceedsThreshold: complexity > threshold
              });
            }
          }
          
          const sorted = results.sort((a, b) => b.metrics.complexity - a.metrics.complexity);
          
          return {
            passed: sorted.filter(r => r.exceedsThreshold).length === 0,
            filesAnalyzed: files.length,
            complexFiles: sorted.length,
            worstOffenders: sorted.slice(0, 10),
            thresholds: { complexity: threshold, maxLines: COMPLEXITY_THRESHOLDS.maxLines },
            recommendation: sorted.length > 0 
              ? `Refactor ${sorted.length} complex files`
              : 'Code complexity is within acceptable limits'
          };
        }
      }
    }
  };
};