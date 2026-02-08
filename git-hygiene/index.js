import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMMIT_MESSAGE_REGEX = /^(feat|fix|docs|style|refactor|perf|test|chore|build|ci|revert)(\([a-z0-9-]+\))?: (.+)$/;

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
    maxIndent: 0,
    currentIndent: 0
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
      
      if (trimmed.startsWith('function ') || trimmed.startsWith('const ') && trimmed.includes('=>') || 
          trimmed.startsWith('class ') || trimmed.startsWith('def ') || trimmed.startsWith('func ')) {
        stats.functions++;
      }
      
      if (trimmed.startsWith('class ') || trimmed.startsWith('class(')) {
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
          message: `Line exceeds 120 characters (${trimmed.length})`,
          code: trimmed.substring(0, 50) + '...'
        });
      }
      
      if (stats.maxIndent > 8) {
        issues.push({
          type: 'style',
          severity: 'medium',
          line: index + 1,
          message: `Excessive indentation (${stats.maxIndent} spaces)`,
          code: trimmed.substring(0, 50)
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
    
    if (stats.complexity > stats.lines * 0.3) {
      issues.push({
        type: 'complexity',
        severity: 'high',
        message: `High cyclomatic complexity detected`
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
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath, ext);
    
    if (ext === '.js' || ext === '.ts' || ext === '.jsx' || ext === '.tsx') {
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
      
      const privateProps = content.match(/_[a-zA-Z0-9]+\s*=/g);
      if (privateProps && privateProps.length > 5) {
        issues.push({
          type: 'naming',
          severity: 'medium',
          message: `Many private properties found - consider using closures or modules`
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
    
  } catch (error) {}
  
  return issues;
}

function detectCodeSmells(content) {
  const smells = [];
  
  const godObjects = content.match(/class\s+\w+\s*{[^}]{2000,}/g);
  if (godObjects && godObjects.length > 0) {
    smells.push({
      type: 'god-object',
      severity: 'high',
      message: `Potential god object class detected (>2000 chars without brace)`
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
      message: `${longParams.length} functions have long parameter lists (>100 chars)`
    });
  }
  
  const switchStatements = content.match(/switch\s*\([^)]+\)\s*{[^}]*case[^}]*default/g);
  if (switchStatements && switchStatements.length > 3) {
    smells.push({
      type: 'switch-abuse',
      severity: 'low',
      count: switchStatements.length,
      message: `Consider using polymorphism instead of multiple switch statements`
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
              },
              byType: allIssues.reduce((acc, i) => {
                acc[i.type] = (acc[i.type] || 0) + 1;
                return acc;
              }, {})
            },
            issues: allIssues.slice(0, 50),
            recommendation: critical.length > 0 
              ? `Fix ${critical.length} critical issues before production`
              : allIssues.length > 0 
                ? `Address ${allIssues.length} code quality issues`
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
          const jsFiles = files.filter(f => f.endsWith('.js') || f.endsWith('.jsx'));
          
          const issues = [];
          
          for (const filePath of tsFiles) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              
              const anyUsages = content.match(/:\s*any\b|as\s+any|\bas\s+Any\b|\|\s*any\b|any\[\]/g);
              if (anyUsages) {
                issues.push({
                  file: path.basename(filePath),
                  type: 'any-usage',
                  count: anyUsages.length,
                  message: `${anyUsages.length} 'any' type usages found - use specific types`
                });
              }
              
              const implicitAny = content.match(/const\s+[a-z][a-zA-Z0-9]*\s*=/g);
              if (implicitAny && !content.includes('@ts-nocheck') && !content.includes('ts-expect-error')) {
                const varDeclarations = content.match(/let\s+[a-z][a-zA-Z0-9]*\s*=/g);
                if ((implicitAny.length + (varDeclarations || []).length) > 5) {
                  issues.push({
                    file: path.basename(filePath),
                    type: 'implicit-any',
                    count: implicitAny.length,
                    message: 'Consider explicit type annotations'
                  });
                }
              }
              
              const nonNullAssert = content.match(/![.!]/g);
              if (nonNullAssert && nonNullAssert.length > 3) {
                issues.push({
                  file: path.basename(filePath),
                  type: 'non-null-assertion',
                  count: nonNullAssert.length,
                  message: 'Excessive non-null assertions may indicate design issues'
                });
              }
              
            } catch (error) {}
          }
          
          for (const filePath of jsFiles) {
            try {
              const content = fs.readFileSync(filePath, 'utf-8');
              
              if (content.includes('@ts-check') || content.includes('// @ts-check')) {
                const jsDocTypes = content.match(/\* @param\s+{[a-zA-Z]+}/g);
                const missingTypes = (content.match(/\* @param\s+[a-z]+/g) || []).length - (jsDocTypes || []).length;
                
                if (missingTypes > 0) {
                  issues.push({
                    file: path.basename(filePath),
                    type: 'jsdoc-missing-types',
                    count: missingTypes,
                    message: `${missingTypes} JSDoc params missing types`
                  });
                }
              }
            } catch (error) {}
          }
          
          const criticalTypeIssues = issues.filter(i => i.type === 'any-usage' && i.count > 3);
          
          return {
            passed: criticalTypeIssues.length === 0,
            typescriptFiles: tsFiles.length,
            javascriptFiles: jsFiles.length,
            issues,
            score: Math.max(0, 100 - (issues.length * 5)),
            recommendation: criticalTypeIssues.length > 0 
              ? 'Eliminate excessive any type usage'
              : issues.length > 0 
                ? 'Improve type safety'
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
            
            if (complexity > threshold || stats.lines > COMPLEXITY_THRESHOLDS.maxLines || smells.length > 0) {
              results.push({
                file: path.basename(filePath),
                path: filePath,
                metrics: {
                  lines: stats.lines,
                  functions: stats.functions,
                  complexity: stats.complexity,
                  averageComplexity: complexity,
                  comments: stats.comments,
                  commentRatio: Math.round((stats.comments / stats.lines) * 100)
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
            thresholds: {
              complexity: threshold,
              maxLines: COMPLEXITY_THRESHOLDS.maxLines
            },
            recommendation: sorted.length > 0 
              ? `Refactor ${sorted.length} complex files - start with ${sorted[0]?.file}`
              : 'Code complexity is within acceptable limits'
          };
        }
      }
    }
  };
};