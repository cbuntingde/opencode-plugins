import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findPackageJson(dirPath) {
  const found = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isFile() && entry.name === 'package.json') {
        found.push(fullPath);
      } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        found.push(...findPackageJson(fullPath));
      }
    }
  } catch (error) {}
  
  return found;
}

function parsePackageJson(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const pkg = JSON.parse(content);
    
    return {
      name: pkg.name,
      version: pkg.version,
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
      peerDependencies: pkg.peerDependencies || {},
      optionalDependencies: pkg.optionalDependencies || {},
      engines: pkg.engines || {},
      license: pkg.license,
      repository: pkg.repository,
      hasLockFile: fs.existsSync(filePath.replace('package.json', 'package-lock.json')) ||
                   fs.existsSync(filePath.replace('package.json', 'yarn.lock')) ||
                   fs.existsSync(filePath.replace('package.json', 'pnpm-lock.yaml'))
    };
  } catch (error) {
    return null;
  }
}

function analyzeDependencyHealth(dependencies) {
  const outdated = [];
  const healthy = [];
  const abandoned = [];
  
  const abandonedPatterns = [
    'hapi', 'request', 'node-sass', 'phantomjs', 'phantomjs-prebuilt',
    'rethinkdb', 'oracledb', 'mssql', 'pg-query-stream'
  ];
  
  const deprecatedPatterns = [
    { pattern: /request$/, reason: 'deprecated - use fetch or axios' },
    { pattern: /hapi/, reason: 'deprecated - consider lighter alternatives' },
    { pattern: /node-sass/, reason: 'deprecated - use sass or dart-sass' },
    { pattern: /request-promise/, reason: 'deprecated - use native promises with fetch' },
    { pattern: /mongoose$/, reason: 'consider mongodb driver for lighter weight' },
    { pattern: /sequelize$/, reason: 'consider prisma or drizzle for better performance' }
  ];
  
  Object.keys(dependencies).forEach(dep => {
    const version = dependencies[dep];
    const isOutdated = version.startsWith('^') || version.startsWith('~') || version.startsWith('>=');
    const isAbandoned = abandonedPatterns.some(p => dep.includes(p));
    
    let deprecation = null;
    deprecatedPatterns.forEach(({ pattern, reason }) => {
      if (pattern.test(dep)) {
        deprecation = reason;
      }
    });
    
    if (deprecation) {
      outdated.push({ name: dep, version, warning: deprecation });
    } else if (isAbandoned) {
      abandoned.push({ name: dep, version, reason: 'Package may be abandoned' });
    } else if (isOutdated) {
      outdated.push({ name: dep, version, warning: 'Version constraint allows updates' });
    } else {
      healthy.push({ name: dep, version });
    }
  });
  
  return { outdated, healthy, abandoned };
}

function checkSecurityVulnerabilities(pkgPath) {
  const issues = [];
  
  try {
    if (fs.existsSync(path.join(pkgPath, 'package-lock.json'))) {
      const output = execSync('npm audit --json --package-lock-only', { 
        cwd: pkgPath, 
        encoding: 'utf-8',
        timeout: 30000 
      }).toString();
      
      const result = JSON.parse(output);
      
      if (result.vulnerabilities) {
        Object.entries(result.vulnerabilities).forEach(([name, vuln]) => {
          issues.push({
            name,
            severity: vuln.severity,
            via: vuln.via?.map(v => v.source || 'unknown'),
            recommendation: `Fix: ${vuln.recommendation || 'Run npm audit fix'}`,
            vulnerable_versions: vuln.vulnerable_versions
          });
        });
      }
    }
  } catch (error) {
    if (error.message.includes('audit')) {
      issues.push({ warning: 'Could not run npm audit', error: error.message.substring(0, 100) });
    }
  }
  
  return issues;
}

function analyzeLicenseCompliance(dependencies, projectLicense) {
  const issues = [];
  const licenses = dependencies.map(d => d.license).filter(Boolean);
  const licensesFound = [...new Set(licenses)];
  
  const incompatibleLicenses = [
    'GPL-1.0', 'GPL-2.0', 'GPL-3.0', 'AGPL-1.0', 'AGPL-3.0',
    'SSPL-1.0', 'OSL-1.0', 'OSL-2.0', 'OSL-3.0'
  ];
  
  const allowedLicenses = [
    'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 
    'BSD-4-Clause', 'Artistic-2.0', 'CC0-1.0', 'Unlicense'
  ];
  
  licensesFound.forEach(license => {
    const cleanLicense = license.replace(/\+/g, '').toUpperCase();
    
    if (incompatibleLicenses.some(il => cleanLicense.includes(il))) {
      issues.push({
        type: 'license',
        severity: 'warning',
        license,
        message: `${license} may have copyleft implications`
      });
    }
    
    if (!allowedLicenses.includes(license) && !incompatibleLicenses.some(il => cleanLicense.includes(il))) {
      issues.push({
        type: 'license',
        severity: 'info',
        license,
        message: `License ${license} should be reviewed`
      });
    }
  });
  
  return issues;
}

export const DependencyAuditPlugin = async ({ project, client, $, directory, worktree }) => {
  const targetDir = worktree || directory || process.cwd();
  
  return {
    tool: {
      deps_audit: {
        description: 'Run dependency audit for security and health',
        args: {
          path: { type: 'string', description: 'Project path' },
          severity: { type: 'string', description: 'Minimum severity to report (low, medium, high, critical)' }
        },
        async execute({ path: projectPath, severity = 'low' }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const packageFiles = findPackageJson(dirToScan);
          
          if (packageFiles.length === 0) {
            return { passed: false, error: 'No package.json found', recommendation: 'Add package.json to project root' };
          }
          
          const allDependencies = [];
          const allIssues = [];
          
          const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          const minSeverity = severityOrder[severity] || 3;
          
          for (const pkgPath of packageFiles) {
            const pkg = parsePackageJson(pkgPath);
            if (!pkg) continue;
            
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            const health = analyzeDependencyHealth(allDeps);
            
            allDependencies.push({
              package: pkg.name,
              version: pkg.version,
              path: pkgPath,
              hasLockFile: pkg.hasLockFile,
              health
            });
            
            const securityIssues = checkSecurityVulnerabilities(path.dirname(pkgPath));
            allIssues.push(...securityIssues);
            
            health.abandoned.forEach(dep => {
              allIssues.push({
                type: 'abandoned',
                severity: 'high',
                name: dep.name,
                message: dep.reason
              });
            });
            
            health.outdated.forEach(dep => {
              allIssues.push({
                type: 'outdated',
                severity: 'low',
                name: dep.name,
                message: dep.warning
              });
            });
          }
          
          const filteredIssues = allIssues.filter(issue => {
            if (!issue.severity) return true;
            return severityOrder[issue.severity] >= minSeverity;
          });
          
          const criticalIssues = filteredIssues.filter(i => i.severity === 'critical' || i.severity === 'high');
          
          return {
            passed: criticalIssues.length === 0,
            summary: {
              packages: packageFiles.length,
              totalIssues: filteredIssues.length,
              critical: filteredIssues.filter(i => i.severity === 'critical').length,
              high: filteredIssues.filter(i => i.severity === 'high').length,
              medium: filteredIssues.filter(i => i.severity === 'medium').length,
              low: filteredIssues.filter(i => i.severity === 'low').length
            },
            packages: allDependencies,
            issues: filteredIssues.slice(0, 50),
            recommendation: criticalIssues.length > 0 
              ? `Fix ${criticalIssues.length} critical/high severity issues before production`
              : filteredIssues.length > 0 
                ? `Address ${filteredIssues.length} issues (run npm audit fix)`
                : 'Dependencies are healthy'
          };
        }
      },
      
      deps_outdated: {
        description: 'List outdated packages',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const packageFiles = findPackageJson(dirToScan);
          
          const outdated = [];
          
          for (const pkgPath of packageFiles) {
            const pkg = parsePackageJson(pkgPath);
            if (!pkg) continue;
            
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            Object.entries(allDeps).forEach(([name, version]) => {
              if (version.startsWith('^') || version.startsWith('~')) {
                outdated.push({
                  package: pkg.name,
                  name,
                  currentVersion: version.replace(/[\^~]/, ''),
                  constrained: version,
                  file: path.basename(pkgPath)
                });
              }
            });
          }
          
          return {
            passed: outdated.length === 0,
            count: outdated.length,
            outdated: outdated.slice(0, 50),
            recommendation: outdated.length > 0 
              ? `Update ${outdated.length} packages to latest versions`
              : 'All packages are using exact versions'
          };
        }
      },
      
      deps_health: {
        description: 'Check overall dependency health',
        args: {
          path: { type: 'string', description: 'Project path' }
        },
        async execute({ path: projectPath }, { directory: ctxDir }) {
          const dirToScan = projectPath || ctxDir || targetDir;
          const packageFiles = findPackageJson(dirToScan);
          
          const health = {
            abandoned: [],
            deprecated: [],
            healthy: [],
            hasLockFile: false,
            licenseIssues: []
          };
          
          for (const pkgPath of packageFiles) {
            const pkg = parsePackageJson(pkgPath);
            if (!pkg) continue;
            
            if (pkg.hasLockFile) health.hasLockFile = true;
            
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            const analysis = analyzeDependencyHealth(allDeps);
            
            health.abandoned.push(...analysis.abandoned);
            health.deprecated.push(...analysis.outdated);
            health.healthy.push(...analysis.healthy);
            
            const licenses = analyzeLicenseCompliance(
              Object.entries(allDeps).map(([name, version]) => ({ name, version })),
              pkg.license
            );
            health.licenseIssues.push(...licenses);
          }
          
          const healthScore = health.abandoned.length === 0 && health.deprecated.length < 5 
            ? 100 
            : Math.max(0, 100 - (health.abandoned.length * 20) - (health.deprecated.length * 5));
          
          return {
            passed: health.abandoned.length === 0,
            score: healthScore,
            health,
            recommendations: health.abandoned.length > 0 
              ? `Replace abandoned packages: ${health.abandoned.map(a => a.name).join(', ')}`
              : health.deprecated.length > 0 
                ? `Consider updating deprecated packages`
                : 'Dependencies are healthy'
          };
        }
      }
    }
  };
};