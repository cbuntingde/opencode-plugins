import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIN_COVERAGE_THRESHOLDS = {
  statements: 80,
  branches: 80,
  functions: 80,
  lines: 80
};

function findTestFiles(dirPath) {
  const testPatterns = [
    '**/*.test.js',
    '**/*.test.ts',
    '**/*.test.jsx',
    '**/*.test.tsx',
    '**/*.spec.js',
    '**/*.spec.ts',
    '**/*.spec.jsx',
    '**/*.spec.tsx',
    '**/__tests__/**/*.js',
    '**/__tests__/**/*.ts',
    '**/__tests__/**/*.jsx',
    '**/__tests__/**/*.tsx',
    '**/test/**/*.js',
    '**/test/**/*.ts',
    '**/tests/**/*.js',
    '**/tests/**/*.ts',
    '**/cypress/**/*.js',
    '**/cypress/**/*.ts'
  ];
  
  const found = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build' && !entry.name.startsWith('.')) {
          found.push(...findTestFiles(fullPath));
        }
      } else if (entry.isFile()) {
        if (entry.name.includes('.test.') || entry.name.includes('.spec.') || entry.name === '__tests__.js' || entry.name === '__tests__.ts') {
          found.push(fullPath);
        }
      }
    }
  } catch (error) {}
  
  return found;
}

function parseCoverageReport(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    
    if (filePath.endsWith('.json')) {
      const report = JSON.parse(content);
      return report;
    }
    
    return { raw: content };
  } catch {
    return null;
  }
}

function parseLcov(filePath) {
  const coverage = {
    files: [],
    totals: { statements: 0, branches: 0, functions: 0, lines: 0 }
  };
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    let currentFile = null;
    
    lines.forEach(line => {
      if (line.startsWith('SF:')) {
        currentFile = { path: line.substring(3), coverage: {} };
      } else if (line.startsWith('DA:')) {
        if (currentFile) {
          const parts = line.substring(3).split(',');
          if (!currentFile.coverage.lines) currentFile.coverage.lines = [];
          currentFile.coverage.lines.push({ line: parseInt(parts[0]), hit: parseInt(parts[1]) });
        }
      } else if (line.startsWith('FNF:')) {
        if (currentFile) currentFile.coverage.functionsMissed = parseInt(line.substring(4));
      } else if (line.startsWith('FNH:')) {
        if (currentFile) currentFile.coverage.functionsHit = parseInt(line.substring(4));
      } else if (line.startsWith('LF:')) {
        if (currentFile) currentFile.coverage.linesFound = parseInt(line.substring(3));
      } else if (line.startsWith('LH:')) {
        if (currentFile) currentFile.coverage.linesHit = parseInt(line.substring(3));
      } else if (line.startsWith('BRF:')) {
        if (currentFile) currentFile.coverage.branchesMissed = parseInt(line.substring(4));
      } else if (line.startsWith('BRH:')) {
        if (currentFile) currentFile.coverage.branchesHit = parseInt(line.substring(4));
      } else if (line.startsWith('end_of_record')) {
        if (currentFile) {
          coverage.files.push(currentFile);
          currentFile = null;
        }
      }
    });
    
  } catch (error) {}
  
  return coverage;
}

function findCoverageReports(dirPath) {
  const reportPatterns = [
    'coverage/coverage-final.json',
    'coverage/lcov.info',
    'coverage/lcov-report/index.html',
    'test-results/coverage.json',
    'nyc_output/coverage.json',
    'reports/coverage.json'
  ];
  
  const found = [];
  
  try {
    reportPatterns.forEach(pattern => {
      const fullPath = path.join(dirPath, pattern);
      if (fs.existsSync(fullPath)) {
        found.push({ path: fullPath, type: path.extname(pattern).replace('.', '') || 'directory' });
      }
    });
    
    const coverageDir = path.join(dirPath, 'coverage');
    if (fs.existsSync(coverageDir) && fs.statSync(coverageDir).isDirectory()) {
      const entries = fs.readdirSync(coverageDir);
      entries.forEach(entry => {
        const fullPath = path.join(coverageDir, entry);
        if (fs.statSync(fullPath).isFile() && (entry.endsWith('.json') || entry.endsWith('.info'))) {
          found.push({ path: fullPath, type: path.extname(entry).replace('.', '') });
        }
      });
    }
  } catch (error) {}
  
  return found;
}

function countTests(testFiles) {
  const counts = { total: 0, suites: 0, skipped: 0, todo: 0 };
  
  testFiles.forEach(filePath => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      
      const testCount = (content.match(/\b(it\.skip|test\.skip|describe\.skip|it\.todo|test\.todo|describe\.each)/g) || []).length;
      const actualTests = (content.match(/\b(it\(|test\(|describe\()/g) || []).length;
      
      counts.suites++;
      counts.total += Math.max(0, actualTests - testCount);
      counts.skipped += (content.match(/it\.skip|test\.skip/g) || []).length;
      counts.todo += (content.match(/it\.todo|test\.todo/g) || []).length;
    } catch (error) {}
  });
  
  return counts;
}

function identifyUntestedFiles(srcPath) {
  const srcExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rb'];
  const untested = [];
  
  function traverse(currentPath) {
    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && 
              entry.name !== 'dist' && entry.name !== 'build' && entry.name !== 'test' && 
              entry.name !== 'tests' && entry.name !== '__tests__' && entry.name !== 'coverage') {
            traverse(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (srcExtensions.includes(ext)) {
            const testPath = generateTestPath(fullPath);
            const hasTest = srcExtensions.some(testExt => {
              const testFile = fullPath.replace(ext, `.test${ext}`).replace('/src/', '/test/').replace('/lib/', '/test/');
              return fs.existsSync(testFile) || fs.existsSync(testFile.replace('.test.ts', '.spec.ts'));
            });
            
            if (!hasTest) {
              untested.push(fullPath);
            }
          }
        }
      }
    } catch (error) {}
  }
  
  if (fs.existsSync(srcPath)) {
    traverse(srcPath);
  }
  
  return untested.slice(0, 20);
}

function generateTestPath(filePath) {
  return filePath
    .replace('/src/', '/__tests__/')
    .replace('/lib/', '/__tests__/')
    .replace('/app/', '/__tests__/')
    .replace('.js', '.test.js')
    .replace('.ts', '.test.ts')
    .replace('.jsx', '.test.jsx')
    .replace('.tsx', '.test.tsx');
}

export const TestCoveragePlugin = async ({ project, client, $, directory, worktree }) => {
  const targetDir = worktree || directory || process.cwd();
  
  return {
    tool: {
      coverage_check: {
        description: 'Check test coverage against thresholds',
        args: {
          path: { type: 'string', description: 'Project path' },
          threshold: { type: 'number', description: 'Minimum coverage threshold' }
        },
        async execute({ path: projectPath, threshold = 80 }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const reports = findCoverageReports(dirToScan);
          
          let coverage = null;
          
          for (const report of reports) {
            if (report.path.endsWith('.json') && !report.path.includes('lcov')) {
              const parsed = parseCoverageReport(report.path);
              if (parsed && (parsed.totalCoverage || parsed.totals || parsed.coverage)) {
                coverage = parsed;
                break;
              }
            }
            
            if (report.path.endsWith('.info')) {
              const parsed = parseLcov(report.path);
              if (parsed && parsed.files.length > 0) {
                coverage = parsed;
                break;
              }
            }
          }
          
          const testFiles = findTestFiles(dirToScan);
          const testCounts = countTests(testFiles);
          
          if (!coverage) {
            return {
              passed: false,
              error: 'No coverage report found',
              tests: testCounts,
              files: testFiles.length,
              recommendation: 'Run tests with coverage (npm test -- --coverage)',
              searchedPath: dirToScan
            };
          }
          
          let actualCoverage = { statements: 0, branches: 0, functions: 0, lines: 0 };
          
          if (coverage.totalCoverage) {
            actualCoverage = coverage.totalCoverage;
          } else if (coverage.totals) {
            actualCoverage = coverage.totals;
          } else if (coverage.coverage) {
            actualCoverage = coverage.coverage;
          } else if (coverage.files) {
            const totals = { statements: 0, branches: 0, functions: 0, lines: 0, hit: 0, total: 0 };
            coverage.files.forEach(file => {
              if (file.coverage) {
                if (file.coverage.linesHit !== undefined) {
                  totals.lines += file.coverage.linesHit + (file.coverage.linesMissed || 0);
                }
              }
            });
            actualCoverage = totals;
          }
          
          const results = {};
          let allPassed = true;
          
          Object.entries(MIN_COVERAGE_THRESHOLDS).forEach(([key, min]) => {
            const actual = actualCoverage[key] || 0;
            results[key] = {
              actual: Math.round(actual * 100) / 100,
              threshold: threshold,
              passed: actual >= threshold
            };
            if (actual < threshold) allPassed = false;
          });
          
          return {
            passed: allPassed,
            summary: {
              ...results,
              overall: Math.round(
                ((results.statements.actual + results.branches.actual + 
                   results.functions.actual + results.lines.actual) / 4) * 10
              ) / 10
            },
            tests: testCounts,
            testFiles: testFiles.length,
            reportFile: reports[0]?.path,
            recommendation: allPassed 
              ? `Coverage meets threshold (${threshold}%)`
              : `Increase coverage: ${Object.entries(results).map(([k, v]) => !v.passed ? `${k} (${v.actual}%)` : '').filter(Boolean).join(', ')}`
          };
        }
      },
      
      coverage_report: {
        description: 'Generate detailed coverage report',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const reports = findCoverageReports(dirToScan);
          const testFiles = findTestFiles(dirToScan);
          const testCounts = countTests(testFiles);
          
          let coverage = null;
          
          for (const report of reports) {
            if (report.path.endsWith('.json') && !report.path.includes('lcov')) {
              const parsed = parseCoverageReport(report.path);
              if (parsed && (parsed.totalCoverage || parsed.totals || parsed.coverage)) {
                coverage = parsed;
                break;
              }
            }
            
            if (report.path.endsWith('.info')) {
              const parsed = parseLcov(report.path);
              if (parsed && parsed.files.length > 0) {
                coverage = parsed;
                break;
              }
            }
          }
          
          const srcDirs = ['src', 'lib', 'app', 'packages'];
          const srcPath = srcDirs.find(dir => fs.existsSync(path.join(dirToScan, dir))) || dirToScan;
          const untestedFiles = fs.existsSync(path.join(dirToScan, srcDirs.find(d => fs.existsSync(path.join(dirToScan, d))) || 'src'))
            ? identifyUntestedFiles(path.join(dirToScan, srcDirs.find(d => fs.existsSync(path.join(dirToScan, d))) || 'src'))
            : [];
          
          return {
            hasReport: !!coverage,
            reportFile: reports[0]?.path,
            tests: testCounts,
            untestedFiles,
            coverage,
            recommendation: untestedFiles.length > 0 
              ? `Add tests for ${untestedFiles.length} untested files`
              : coverage 
                ? 'Coverage report available'
                : 'Generate coverage report with npm test -- --coverage'
          };
        }
      },
      
      missing_tests: {
        description: 'Identify untested files and functions',
        args: {
          path: { type: 'string', description: 'Project path' },
          srcDir: { type: 'string', description: 'Source directory name' }
        },
        async execute({ path: projectPath, srcDir = 'src' }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const testFiles = findTestFiles(dirToScan);
          const srcPath = path.join(dirToScan, srcDir);
          
          const untested = identifyUntestedFiles(fs.existsSync(srcPath) ? srcPath : dirToScan);
          
          const criticalPaths = untested.filter(f => 
            f.includes('controller') || f.includes('service') || f.includes('utils') ||
            f.includes('lib') || f.includes('api')
          );
          
          const missingFunctions = [];
          
          if (criticalPaths.length > 0) {
            criticalPaths.slice(0, 5).forEach(filePath => {
              try {
                const content = fs.readFileSync(filePath, 'utf-8');
                
                const functions = content.match(/(?:function|const|export\s+(?:default\s+)?(?:async\s+)?)[A-Z][a-zA-Z0-9]*\s*\([^)]*\)/g) || [];
                const classMethods = content.match(/(?:public|private|protected)?\s*(?:async\s+)?[a-zA-Z][a-zA-Z0-9]*\s*\(/g) || [];
                
                if (functions.length > 0 || classMethods.length > 0) {
                  missingFunctions.push({
                    file: path.basename(filePath),
                    path: filePath,
                    functionsFound: functions.length + classMethods.length
                  });
                }
              } catch (error) {}
            });
          }
          
          return {
            untestedCount: untested.length,
            criticalUntested: criticalPaths.length,
            untestedFiles: untested.slice(0, 20),
            missingFunctions,
            recommendation: criticalPaths.length > 0 
              ? `Test these critical files first: ${criticalPaths.slice(0, 5).map(f => path.basename(f)).join(', ')}`
              : 'All critical files appear to be tested'
          };
        }
      }
    }
  };
};